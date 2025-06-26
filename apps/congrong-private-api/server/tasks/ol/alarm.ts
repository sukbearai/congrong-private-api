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
      const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
      const category = 'linear'
      const intervalTime = '5min'
      const limit = 2 // 获取2条数据用于计算变化

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

          // 处理数据 - 只返回最新数据
          if (!apiResponse.result.list || apiResponse.result.list.length === 0) {
            throw new Error('没有可用数据')
          }

          // 只处理第一项（最新数据）
          const latestItem = apiResponse.result.list[0]
          let changeRate = 0
          let changeAmount = 0
          let previousOpenInterest = 0

          // 如果有第二项数据，计算变化率
          if (apiResponse.result.list.length > 1) {
            const previousItem = apiResponse.result.list[1]
            const currentOI = parseFloat(latestItem.openInterest)
            previousOpenInterest = parseFloat(previousItem.openInterest)

            changeAmount = currentOI - previousOpenInterest
            changeRate = previousOpenInterest !== 0 ? (changeAmount / previousOpenInterest) * 100 : 0
          }

          const processedItem: OpenInterestLatestItem = {
            ...latestItem,
            timestamp: latestItem.timestamp,
            formattedTime: new Date(parseInt(latestItem.timestamp)).toLocaleString('zh-CN', {
              year: 'numeric',
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

      // 获取所有symbols的数据
      const results = await Promise.allSettled(
        symbols.map(async (symbol) => {
          try {
            const data = await fetchSymbolData(symbol)
            return {
              success: true,
              symbol,
              data
            }
          } catch (error) {
            return {
              success: false,
              symbol,
              error: error instanceof Error ? error.message : '获取数据失败'
            }
          }
        })
      )

      // 分离成功和失败的结果
      const successful: ProcessedOpenInterestData[] = []
      const failed: OpenInterestError[] = []

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            successful.push(result.value.data)
          } else {
            failed.push({
              symbol: result.value.symbol,
              error: result.value.error
            })
          }
        } else {
          failed.push({
            symbol: 'unknown',
            error: result.reason instanceof Error ? result.reason.message : '请求失败'
          })
        }
      })

      // 如果所有请求都失败
      if (successful.length === 0) {
        throw new Error('所有交易对数据获取失败')
      }

      // 构建消息
      let message = `📊 未平仓合约监控报告\n⏰ ${new Date().toLocaleString('zh-CN')}\n\n`
      
      // 处理成功的数据
      successful.forEach((item: ProcessedOpenInterestData) => {
        const changeIcon = item.latest.changeRate > 0 ? '📈' : item.latest.changeRate < 0 ? '📉' : '➡️'
        
        message += `${changeIcon} ${item.symbol}\n`
        message += `   持仓: ${item.latest.openInterestFloat.toLocaleString()}\n`
        message += `   变化: ${item.latest.changeRateFormatted}\n`
        message += `   时间: ${item.latest.formattedTime}\n\n`
      })
      
      // 处理失败的数据
      if (failed.length > 0) {
        message += `❌ 获取失败的交易对:\n`
        failed.forEach(error => {
          message += `   ${error.symbol}: ${error.error}\n`
        })
        message += '\n'
      }
      
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
      console.error('定时任务执行失败:', error)
      
      // 发送错误消息
      try {
        await bot.api.sendMessage('-1002663808019', `❌ 未平仓合约监控任务失败\n⏰ ${new Date().toLocaleString('zh-CN')}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch (botError) {
        console.error('发送错误消息失败:', botError)
      }
      
      return { result: 'error', message: error instanceof Error ? error.message : '任务执行失败' }
    }
  },
})