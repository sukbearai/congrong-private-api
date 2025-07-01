import type { 
  BybitApiResponse, 
  ProcessedOpenInterestData, 
  OpenInterestLatestItem,
  OpenInterestError 
} from '../../routes/exchanges/bybit/openInterest/types'

export default defineTask({
  meta: {
    name: 'ol:alarm',
    description: '未平仓合约定时消息推送',
  },
  async run() {
    try {
      // 配置要监控的币种
      const symbols = ['HUSDT','TRUMPUSDT','SAHARAUSDT']
      const category = 'linear'
      const intervalTime = '5min'
      
      // 配置监控时间间隔（分钟）
      const monitoringInterval = 15 // 可以设置为 5, 15, 30 等
      // 持仓变化率阈值
      const openInterestThreshold = 5
      
      // 根据监控间隔计算需要获取的数据条数
      const intervalMinutes = parseInt(intervalTime.replace('min', ''))
      const limit = Math.ceil(monitoringInterval / intervalMinutes) + 1 // +1 确保有足够数据
    
      // 获取配置信息
      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl

      // 创建请求队列
      const requestQueue = new RequestQueue({
        maxRandomDelay: 5000,
        minDelay: 1000
      })

      // 创建获取单个symbol数据的函数
      const fetchSymbolData = async (symbol: string): Promise<ProcessedOpenInterestData> => {
        return await requestQueue.add(async () => {
          // 构建查询参数
          const params = new URLSearchParams({
            category,
            symbol,
            intervalTime,
            limit: limit.toString(),
          })

          // 构建请求URL
          const url = `${bybitApiUrl}/v5/market/open-interest?${params.toString()}`

          // 发送请求到Bybit API
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          })

          // 检查HTTP响应状态
          if (!response.ok) {
            throw new Error(`HTTP 错误: ${response.status}`)
          }

          // 解析响应数据
          const apiResponse = await response.json() as BybitApiResponse

          // 检查API响应状态
          if (apiResponse.retCode !== 0) {
            throw new Error(`Bybit API 错误: ${apiResponse.retMsg}`)
          }

          // 处理数据 - 计算指定时间间隔的变化
          if (!apiResponse.result.list || apiResponse.result.list.length === 0) {
            throw new Error('没有可用数据')
          }

          const latestItem = apiResponse.result.list[0]
          let changeRate = 0
          let changeAmount = 0
          let previousOpenInterest = 0

          // 计算目标时间间隔前的数据索引
          const targetIndex = Math.ceil(monitoringInterval / intervalMinutes)
          
          // 如果有足够的历史数据，计算变化率
          if (apiResponse.result.list.length > targetIndex) {
            const targetItem = apiResponse.result.list[targetIndex]
            const currentOI = parseFloat(latestItem.openInterest)
            previousOpenInterest = parseFloat(targetItem.openInterest)

            changeAmount = currentOI - previousOpenInterest
            changeRate = previousOpenInterest !== 0 ? (changeAmount / previousOpenInterest) * 100 : 0
          }

          const processedItem: OpenInterestLatestItem = {
            ...latestItem,
            timestamp: latestItem.timestamp,
            formattedTime: new Date(parseInt(latestItem.timestamp)).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            }),
            timestampMs: parseInt(latestItem.timestamp),
            openInterestFloat: parseFloat(latestItem.openInterest),
            previousOpenInterest,
            changeAmount: parseFloat(changeAmount.toFixed(8)),
            changeRate: parseFloat(changeRate.toFixed(4)),
            changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`
          }

          return {
            category: apiResponse.result.category,
            symbol: apiResponse.result.symbol,
            latest: processedItem,
            nextPageCursor: apiResponse.result.nextPageCursor,
          }
        })
      }

      // 获取所有symbols的数据 - 串行执行
      const successful: ProcessedOpenInterestData[] = []
      const failed: OpenInterestError[] = []

      for (const symbol of symbols) {
        try {
          const data = await fetchSymbolData(symbol)
          successful.push(data)
        } catch (error) {
          failed.push({
            symbol,
            error: error instanceof Error ? error.message : '获取数据失败'
          })
        }
      }

      // 如果所有请求都失败
      if (successful.length === 0) {
        // 403 是美国ip受限
        // throw new Error(`所有交易对数据获取失败`)
        return {
          result: 'error'
        }
      }

      if(failed.length > 0) {
        // throw new Error(`数据获取失败: ${failed.map(f => `${f.symbol}(${f.error})`).join(', ')}`)
        return {
          result: 'error'
        }
      }

      const filteredData = successful.filter(item => 
        Math.abs(item?.latest?.changeRate) > openInterestThreshold
      )

      // 如果没有数据超过阈值，不发送消息
      if (filteredData.length === 0) {
        console.log(`没有超过阈值的变化，未发送消息 - ${new Date().toLocaleString('zh-CN')}`)
        return { 
          result: 'ok', 
          processed: symbols.length,
          successful: successful.length,
          failed: failed.length,
          message: '没有超过阈值的变化，未发送消息'
        }
      }

      // 构建消息
      let message = `📊 未平仓合约监控报告 (${monitoringInterval}分钟变化)\n⏰ ${new Date().toLocaleString('zh-CN')}\n\n`
      
      // 处理成功的数据
      filteredData.forEach((item: ProcessedOpenInterestData) => {
        const changeIcon = item.latest.changeRate > 0 ? '📈' : item.latest.changeRate < 0 ? '📉' : '➡️'
        
        message += `${changeIcon} ${item.symbol}\n`
        message += `   持仓: ${item.latest.openInterestFloat.toLocaleString()}\n`
        message += `   变化: ${item.latest.changeRateFormatted}\n`
        message += `   时间: ${item.latest.formattedTime}\n\n`
      })
    
      
      // 发送消息到 Telegram
      await bot.api.sendMessage('-1002663808019', message)
      
      return { 
        result: 'ok', 
        processed: symbols.length,
        successful: successful.length,
        failed: failed.length
      }
    }
    catch (error) {
      try {
        await bot.api.sendMessage('-1002663808019', `❌ 未平仓合约监控任务失败\n⏰ ${new Date().toLocaleString('zh-CN')}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch (botError) {
        console.error('发送错误消息失败:', botError)
      }
      
      return { result: 'error' }
    }
  },
})