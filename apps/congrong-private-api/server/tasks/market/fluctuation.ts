interface KlineApiResponse {
  retCode: number
  retMsg: string
  result: {
    category: string
    symbol: string
    list: string[][]
  }
}

interface CryptoPriceData {
  symbol: string
  currentPrice: number
  previousPrice: number
  changeAmount: number
  changeRate: number
  changeRateFormatted: string
  highPrice: number
  lowPrice: number
  volume: number
  turnover: number
  formattedTime: string
  timestamp: number
}

interface MonitorConfig {
  symbol: string
  displayName: string
  priceChangeThreshold: number
  significantChangeThreshold: number
  monitorPeriodMinutes?: number // 监控时间段（分钟），默认5分钟
}

interface MonitorResult {
  symbol: string
  data: CryptoPriceData
  shouldNotify: boolean
  isSignificantChange: boolean
  error?: string
}

// 定义历史记录接口
interface FluctuationHistoryRecord {
  symbol: string
  timestamp: number
  changeRate: number
  notifiedAt: number
}

// 检查是否为重复通知 - 如果波动率变化在1%范围内则认为是重复
function isDuplicateFluctuationAlert(
  currentChangeRate: number,
  symbol: string,
  historyRecords: FluctuationHistoryRecord[]
): boolean {
  // 查找该币种最近的通知记录
  const recentRecord = historyRecords
    .filter(record => record.symbol === symbol)
    .sort((a, b) => b.notifiedAt - a.notifiedAt)[0]
  
  if (!recentRecord) {
    return false // 没有历史记录，不是重复
  }
  
  // 检查方向是否相同
  const currentDirection = currentChangeRate >= 0 ? 'up' : 'down'
  const recentDirection = recentRecord.changeRate >= 0 ? 'up' : 'down'
  
  // 如果方向不同，不认为是重复
  if (currentDirection !== recentDirection) {
    return false
  }
  
  // 检查波动率变化是否在2%范围内
  const rateChange = Math.abs(Math.abs(currentChangeRate) - Math.abs(recentRecord.changeRate))
  const isDuplicate = rateChange <= 2
  
  return isDuplicate
}

// 清理过期的历史记录（保留最近2小时的记录）
function cleanExpiredFluctuationRecords(records: FluctuationHistoryRecord[]): FluctuationHistoryRecord[] {
  const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000)
  return records.filter(record => record.notifiedAt > twoHoursAgo)
}

export default defineTask({
  meta: {
    name: 'market:fluctuation',
    description: '多币种价格波动监控 - BTC/ETH/SOL等主流币种',
  },
  async run() {
    const startTime = Date.now()

    try {
      // 多币种监控配置
      const monitorConfigs = (await useStorage('db').getItem('telegram:fluctuation') || []) as MonitorConfig[]
      console.log(`🚀 多币种价格波动监控任务开始 - 监控${monitorConfigs.length}个币种`)

      const category = 'linear'
      const klineInterval = '1'
      
      // 计算需要获取的K线数量（取最大监控时间段+1）
      const maxMonitorPeriod = Math.max(...monitorConfigs.map(c => c.monitorPeriodMinutes || 5))
      const klineLimit = maxMonitorPeriod + 1

      // 获取配置信息
      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl

      // 初始化存储（但不立即获取历史记录）
      const storage = useStorage('db')
      const historyKey = 'telegram:fluctuation_history'

      // 创建请求队列
      const requestQueue = new RequestQueue({
        maxRandomDelay: 1000,
        minDelay: 500
      })

      // 获取单个币种K线数据的函数
      const fetchCryptoKlineData = async (monitorConfig: MonitorConfig): Promise<CryptoPriceData> => {
        return await requestQueue.add(async () => {
          // 构建查询参数
          const params = new URLSearchParams({
            category,
            symbol: monitorConfig.symbol,
            interval: klineInterval,
            limit: klineLimit.toString(),
          })

          // 构建请求URL
          const url = `${bybitApiUrl}/v5/market/kline?${params.toString()}`

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
          const apiResponse = await response.json() as KlineApiResponse

          // 检查API响应状态
          if (apiResponse.retCode !== 0) {
            throw new Error(`Bybit API 错误: ${apiResponse.retMsg}`)
          }

          // 处理K线数据
          if (!apiResponse.result.list || apiResponse.result.list.length === 0) {
            throw new Error('没有可用的K线数据')
          }

          // 获取最新K线数据
          const latestKline = apiResponse.result.list[0]
          const currentPrice = parseFloat(latestKline[4]) // closePrice
          const volume = parseFloat(latestKline[5]) // volume
          const turnover = parseFloat(latestKline[6]) // turnover
          const timestamp = parseInt(latestKline[0])

          // 计算监控时间段内的价格变化
          const monitorPeriod = monitorConfig.monitorPeriodMinutes || 5
          let previousPrice = currentPrice
          let changeAmount = 0
          let changeRate = 0

          // 获取监控时间段前的价格
          if (apiResponse.result.list.length > monitorPeriod) {
            const periodAgoKline = apiResponse.result.list[monitorPeriod]
            previousPrice = parseFloat(periodAgoKline[4])
          } else if (apiResponse.result.list.length > 1) {
            // 如果K线数据不足监控时间段，则使用最早的K线
            const earliestKline = apiResponse.result.list[apiResponse.result.list.length - 1]
            previousPrice = parseFloat(earliestKline[4])
          }

          // 计算变化
          changeAmount = currentPrice - previousPrice
          changeRate = previousPrice !== 0 ? (changeAmount / previousPrice) * 100 : 0

          // 计算监控时间段内的最高价和最低价
          let periodHighPrice = currentPrice
          let periodLowPrice = currentPrice
          const periodKlines = apiResponse.result.list.slice(0, Math.min(monitorPeriod, apiResponse.result.list.length))
          
          for (const kline of periodKlines) {
            const high = parseFloat(kline[2])
            const low = parseFloat(kline[3])
            periodHighPrice = Math.max(periodHighPrice, high)
            periodLowPrice = Math.min(periodLowPrice, low)
          }

          return {
            symbol: monitorConfig.symbol,
            currentPrice,
            previousPrice,
            changeAmount: parseFloat(changeAmount.toFixed(2)),
            changeRate: parseFloat(changeRate.toFixed(4)),
            changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`,
            highPrice: periodHighPrice,
            lowPrice: periodLowPrice,
            volume,
            turnover,
            timestamp,
            formattedTime: formatDateTime(timestamp)
          }
        })
      }

      // 获取所有币种的数据 - 串行执行避免API限制
      const monitorResults: MonitorResult[] = []
      
      for (const [index, monitorConfig] of monitorConfigs.entries()) {
        try {
          const data = await fetchCryptoKlineData(monitorConfig)
          const shouldNotify = Math.abs(data.changeRate) > monitorConfig.priceChangeThreshold
          const isSignificantChange = Math.abs(data.changeRate) > monitorConfig.significantChangeThreshold

          console.log(`✅ ${monitorConfig.symbol}: ${data.changeRateFormatted} (${shouldNotify ? '需要通知' : '无需通知'})`)

          monitorResults.push({
            symbol: monitorConfig.symbol,
            data,
            shouldNotify,
            isSignificantChange
          })
        } catch (error) {
          console.error(`❌ ${monitorConfig.symbol} 数据获取失败: ${error instanceof Error ? error.message : '获取数据失败'}`)
          
          monitorResults.push({
            symbol: monitorConfig.symbol,
            data: {
              symbol: '',
              currentPrice: 0,
              previousPrice: 0,
              changeAmount: 0,
              changeRate: 0,
              changeRateFormatted: '0.00%',
              highPrice: 0,
              lowPrice: 0,
              volume: 0,
              turnover: 0,
              formattedTime: '',
              timestamp: 0
            },
            shouldNotify: false,
            isSignificantChange: false,
            error: error instanceof Error ? error.message : '获取数据失败'
          })
        }
      }

      // 数据获取结果汇总
      const successfulResults = monitorResults.filter(r => !r.error)
      const failedResults = monitorResults.filter(r => r.error)
      
      console.log(`📊 获取结果: 成功${successfulResults.length}个, 失败${failedResults.length}个`)

      // 筛选需要通知的币种
      const notifyResults = monitorResults.filter(result => result.shouldNotify && !result.error)
      
      console.log(`🔔 需要通知: ${notifyResults.length}个币种`)

      // 如果没有需要通知的变化，直接返回，不需要获取历史记录
      if (notifyResults.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`📋 任务完成 - 无需通知 (${executionTime}ms)`)
        
        return {
          result: 'ok',
          monitored: monitorConfigs.length,
          successful: successfulResults.length,
          failed: failedResults.length,
          message: '所有币种价格变化均不显著，未发送通知',
          executionTimeMs: executionTime,
          details: monitorResults.map(r => ({
            symbol: r.symbol,
            currentPrice: r.data.currentPrice || 0,
            changeRate: r.data.changeRate || 0,
            threshold: monitorConfigs.find(c => c.symbol === r.symbol)?.priceChangeThreshold || 0,
            shouldNotify: r.shouldNotify,
            error: r.error
          }))
        }
      }

      // 只有当有需要通知的变化时，才获取历史记录
      console.log(`📚 开始获取历史记录用于重复检测...`)
      let historyRecords = (await storage.getItem(historyKey) || []) as FluctuationHistoryRecord[]
      
      // 清理过期记录
      const beforeCleanCount = historyRecords.length
      historyRecords = cleanExpiredFluctuationRecords(historyRecords)
      console.log(`📚 历史记录清理: ${beforeCleanCount} -> ${historyRecords.length}`)

      // 过滤重复通知
      const newAlerts = notifyResults.filter(result => {
        const isDuplicate = isDuplicateFluctuationAlert(result.data.changeRate, result.symbol, historyRecords)
        return !isDuplicate
      })

      console.log(`🔍 重复过滤: ${notifyResults.length} -> ${newAlerts.length}`)

      // 如果没有新的警报数据，不发送消息
      if (newAlerts.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`📋 任务完成 - 重复数据过滤 (${executionTime}ms)`)
        
        return { 
          result: 'ok', 
          monitored: monitorConfigs.length,
          successful: successfulResults.length,
          failed: failedResults.length,
          filtered: notifyResults.length,
          duplicates: notifyResults.length,
          executionTimeMs: executionTime,
          message: '检测到重复波动数据，未发送消息'
        }
      }

      const significantResults = newAlerts.filter(result => result.isSignificantChange)
      const normalResults = newAlerts.filter(result => !result.isSignificantChange)

      console.log(`🚨 通知分类: 重大异动${significantResults.length}个, 一般变化${normalResults.length}个`)

      // 构建消息
      let message = `📊 多币种价格波动监控\n⏰ ${formatCurrentTime()}\n\n`

      // 重大异动警报 - 优先显示
      if (significantResults.length > 0) {
        message += `🚨 重大异动警报 🚨\n\n`
        
        for (const result of significantResults) {
          const config = monitorConfigs.find(c => c.symbol === result.symbol)!
          const data = result.data
          const alertIcon = data.changeRate > 0 ? '🚀🚀🚀' : '💥💥💥'
          const trendIcon = data.changeRate > 0 ? '📈' : '📉'
          const monitorPeriod = config.monitorPeriodMinutes || 5
          
          message += `${alertIcon} ${config.displayName} 重大异动 ${alertIcon}\n`
          message += `${trendIcon} ${data.symbol}\n`
          message += `💰 当前价格: $${data.currentPrice.toLocaleString()}\n`
          message += `📊 ${monitorPeriod}分钟变化: ${data.changeRateFormatted}\n`
          message += `📈 ${monitorPeriod}分钟最高: $${data.highPrice.toLocaleString()}\n`
          message += `📉 ${monitorPeriod}分钟最低: $${data.lowPrice.toLocaleString()}\n`
          message += `⏰ 时间: ${data.formattedTime}\n\n`
        }
      }

      // 一般变化通知
      if (normalResults.length > 0) {
        for (const result of normalResults) {
          const config = monitorConfigs.find(c => c.symbol === result.symbol)!
          const data = result.data
          const changeIcon = data.changeRate > 0 ? '📈' : '📉'
          const monitorPeriod = config.monitorPeriodMinutes || 5
          
          message += `${changeIcon} ${config.displayName} (${data.symbol})\n`
          message += `💰 价格: $${data.currentPrice.toLocaleString()}\n`
          message += `📊 ${monitorPeriod}分钟变化: ${data.changeRateFormatted}\n`
          message += `⏰ ${data.formattedTime}\n\n`
        }
      }

      // 添加失败信息（如果有）
      if (failedResults.length > 0) {
        message += `⚠️ 获取失败的币种:\n`
        failedResults.forEach(result => {
          message += `❌ ${result.symbol}: ${result.error}\n`
        })
        message += `\n`
      }

      console.log(`📤 发送Telegram消息 (${message.length}字符)`)
      
      // 发送消息到 Telegram
      await bot.api.sendMessage('-1002663808019', message)
      console.log(`✅ 消息发送成功`)

      // 记录新的通知历史
      const newHistoryRecords: FluctuationHistoryRecord[] = newAlerts.map(result => ({
        symbol: result.symbol,
        timestamp: result.data.timestamp,
        changeRate: result.data.changeRate,
        notifiedAt: Date.now()
      }))

      // 更新历史记录
      historyRecords.push(...newHistoryRecords)
      
      // 再次清理过期记录并保存
      historyRecords = cleanExpiredFluctuationRecords(historyRecords)
      await storage.setItem(historyKey, historyRecords)
      
      console.log(`💾 历史记录已更新: ${historyRecords.length}条`)

      const executionTime = Date.now() - startTime
      
      console.log(`🎉 任务完成: 监控${monitorConfigs.length}个, 通知${newAlerts.length}个, 用时${executionTime}ms`)

      return {
        result: 'ok',
        monitored: monitorConfigs.length,
        successful: successfulResults.length,
        failed: failedResults.length,
        notified: newAlerts.length,
        duplicates: notifyResults.length - newAlerts.length,
        significantChanges: significantResults.length,
        normalChanges: normalResults.length,
        historyRecords: historyRecords.length,
        executionTimeMs: executionTime,
        details: monitorResults.map(r => ({
          symbol: r.symbol,
          currentPrice: r.data.currentPrice || 0,
          changeRate: r.data.changeRate || 0,
          changeAmount: r.data.changeAmount || 0,
          volume: r.data.volume || 0,
          turnover: r.data.turnover || 0,
          monitorPeriod: monitorConfigs.find(c => c.symbol === r.symbol)?.monitorPeriodMinutes || 5,
          shouldNotify: r.shouldNotify,
          isSignificantChange: r.isSignificantChange,
          error: r.error
        }))
      }

    } catch (error) {
      const executionTime = Date.now() - startTime
      
      console.error(`💥 任务失败: ${error instanceof Error ? error.message : '未知错误'} (${executionTime}ms)`)
      
      try {
        await bot.api.sendMessage('-1002663808019', `❌ 多币种价格监控任务失败\n⏰ ${formatCurrentTime()}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch (botError) {
        console.error(`❌ 发送错误消息失败:`, botError)
      }

      return { 
        result: 'error',
        error: error instanceof Error ? error.message : '未知错误',
        executionTimeMs: executionTime
      }
    }
  },
})