import type { 
  BybitApiResponse, 
  ProcessedOpenInterestData, 
  OpenInterestLatestItem,
  OpenInterestError 
} from '../../routes/exchanges/bybit/openInterest/types'

// 定义历史记录接口
interface AlarmHistoryRecord {
  symbol: string
  timestamp: number
  openInterest: number
  changeRate: number
  notifiedAt: number
}

// 生成数据指纹，用于判断数据重复性
function generateDataFingerprint(symbol: string, timestamp: number, openInterest: number): string {
  return `${symbol}_${timestamp}_${Math.floor(openInterest)}`
}

// 检查是否为重复数据
function isDuplicateAlert(
  currentData: ProcessedOpenInterestData,
  historyRecords: AlarmHistoryRecord[]
): boolean {
  const currentFingerprint = generateDataFingerprint(
    currentData.symbol,
    currentData.latest.timestampMs,
    currentData.latest.openInterestFloat
  )
  
  // 检查历史记录中是否有相同的数据指纹
  const isDuplicate = historyRecords.some(record => {
    const historyFingerprint = generateDataFingerprint(
      record.symbol,
      record.timestamp,
      record.openInterest
    )
    return historyFingerprint === currentFingerprint
  })
  
  return isDuplicate
}

// 清理过期的历史记录（保留最近2小时的记录）
function cleanExpiredRecords(records: AlarmHistoryRecord[]): AlarmHistoryRecord[] {
  const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000)
  return records.filter(record => record.notifiedAt > twoHoursAgo)
}

export default defineTask({
  meta: {
    name: 'ol:alarm',
    description: '未平仓合约定时消息推送',
  },
  async run() {
    const startTime = Date.now()
    
    try {
      // 配置要监控的币种
      const symbols = (await useStorage('db').getItem('telegram:ol') || []) as []
      const category = 'linear'
      const intervalTime = '5min'
      
      // 配置监控时间间隔（分钟）
      const monitoringInterval = 15 // 可以设置为 5, 15, 30 等
      // 持仓变化率阈值
      const openInterestThreshold = 5
      
      // 根据监控间隔计算需要获取的数据条数
      const intervalMinutes = parseInt(intervalTime.replace('min', ''))
      const limit = Math.ceil(monitoringInterval / intervalMinutes) + 1 // +1 确保有足够数据
    
      console.log(`🚀 未平仓合约监控任务开始 - 监控${symbols.length}个币种, 阈值${openInterestThreshold}%`)

      // 获取配置信息
      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl

      // 初始化存储（但不立即获取历史记录）
      const storage = useStorage('db')
      const historyKey = 'telegram:ol_alarm_history'

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
          console.log(`✅ ${symbol}: ${data.latest.changeRateFormatted}`)
        } catch (error) {
          console.error(`❌ ${symbol} 数据获取失败: ${error instanceof Error ? error.message : '获取数据失败'}`)
          failed.push({
            symbol,
            error: error instanceof Error ? error.message : '获取数据失败'
          })
        }
      }

      console.log(`📊 获取结果: 成功${successful.length}个, 失败${failed.length}个`)

      // 如果所有请求都失败
      if (successful.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`所有数据获取失败，任务结束 (${executionTime}ms)`)
        return {
          result: 'error',
          executionTimeMs: executionTime
        }
      }

      if(failed.length > 0) {
        const executionTime = Date.now() - startTime
        console.log(`部分数据获取失败，任务结束 (${executionTime}ms)`)
        return {
          result: 'error',
          executionTimeMs: executionTime
        }
      }

      // 过滤超过阈值的数据
      const filteredData = successful.filter(item => {
        const shouldNotify = Math.abs(item?.latest?.changeRate) > openInterestThreshold
        return shouldNotify
      })

      console.log(`🔔 需要通知: ${filteredData.length}个币种`)

      // 如果没有数据超过阈值，不发送消息，不需要获取历史记录
      if (filteredData.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`📋 任务完成 - 无需通知 (${executionTime}ms)`)
        return { 
          result: 'ok', 
          processed: symbols.length,
          successful: successful.length,
          failed: failed.length,
          message: '没有超过阈值的变化，未发送消息',
          executionTimeMs: executionTime
        }
      }

      // 只有当有需要通知的变化时，才获取历史记录
      console.log(`📚 开始获取历史记录用于重复检测...`)
      let historyRecords = (await storage.getItem(historyKey) || [] ) as AlarmHistoryRecord[]
      
      // 清理过期记录
      const beforeCleanCount = historyRecords.length
      historyRecords = cleanExpiredRecords(historyRecords)
      console.log(`📚 历史记录清理: ${beforeCleanCount} -> ${historyRecords.length}`)

      // 检查重复数据，过滤掉已经通知过的数据
      const newAlerts = filteredData.filter(item => {
        const isDuplicate = isDuplicateAlert(item, historyRecords)
        return !isDuplicate
      })

      console.log(`🔍 重复过滤: ${filteredData.length} -> ${newAlerts.length}`)

      // 如果没有新的警报数据，不发送消息
      if (newAlerts.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`📋 任务完成 - 重复数据过滤 (${executionTime}ms)`)
        return { 
          result: 'ok', 
          processed: symbols.length,
          successful: successful.length,
          failed: failed.length,
          filtered: filteredData.length,
          duplicates: filteredData.length,
          message: '检测到重复数据，未发送消息',
          executionTimeMs: executionTime
        }
      }

      // 构建消息
      let message = `📊 未平仓合约监控报告 (${monitoringInterval}分钟变化)\n⏰ ${new Date().toLocaleString('zh-CN')}\n\n`
      
      // 处理新的警报数据
      newAlerts.forEach((item: ProcessedOpenInterestData) => {
        const changeIcon = item.latest.changeRate > 0 ? '📈' : item.latest.changeRate < 0 ? '📉' : '➡️'
        
        message += `${changeIcon} ${item.symbol}\n`
        message += `   持仓: ${item.latest.openInterestFloat.toLocaleString()}\n`
        message += `   变化: ${item.latest.changeRateFormatted}\n`
        message += `   时间: ${item.latest.formattedTime}\n\n`
      })
      
      console.log(`📤 发送Telegram消息 (${message.length}字符)`)
      
      // 发送消息到 Telegram
      await bot.api.sendMessage('-1002663808019', message)
      console.log(`✅ 消息发送成功`)
      
      // 记录新的通知历史
      const newHistoryRecords: AlarmHistoryRecord[] = newAlerts.map(item => ({
        symbol: item.symbol,
        timestamp: item.latest.timestampMs,
        openInterest: item.latest.openInterestFloat,
        changeRate: item.latest.changeRate,
        notifiedAt: item.latest.timestampMs
      }))

      // 更新历史记录
      historyRecords.push(...newHistoryRecords)
      
      // 再次清理过期记录并保存
      historyRecords = cleanExpiredRecords(historyRecords)
      await storage.setItem(historyKey, historyRecords)

      console.log(`💾 历史记录已更新: ${historyRecords.length}条`)
      
      const executionTime = Date.now() - startTime
      console.log(`🎉 任务完成: 监控${symbols.length}个, 通知${newAlerts.length}个, 用时${executionTime}ms`)
      
      return { 
        result: 'ok', 
        processed: symbols.length,
        successful: successful.length,
        failed: failed.length,
        filtered: filteredData.length,
        newAlerts: newAlerts.length,
        duplicates: filteredData.length - newAlerts.length,
        historyRecords: historyRecords.length,
        executionTimeMs: executionTime
      }
    }
    catch (error) {
      const executionTime = Date.now() - startTime
      console.error(`💥 未平仓合约监控任务失败: ${error instanceof Error ? error.message : '未知错误'} (${executionTime}ms)`)
      
      try {
        await bot.api.sendMessage('-1002663808019', `❌ 未平仓合约监控任务失败\n⏰ ${new Date().toLocaleString('zh-CN')}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch (botError) {
        console.error('❌ 发送错误消息失败:', botError)
      }
      
      return { 
        result: 'error',
        error: error instanceof Error ? error.message : '未知错误',
        executionTimeMs: executionTime
      }
    }
  },
})