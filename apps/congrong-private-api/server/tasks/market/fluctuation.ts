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
    console.log(`${symbol}: 没有历史记录，不是重复`)
    return false // 没有历史记录，不是重复
  }
  
  // 检查方向是否相同
  const currentDirection = currentChangeRate >= 0 ? 'up' : 'down'
  const recentDirection = recentRecord.changeRate >= 0 ? 'up' : 'down'
  
  // 如果方向不同，不认为是重复
  if (currentDirection !== recentDirection) {
    console.log(`${symbol}: 方向不同 (${currentDirection} vs ${recentDirection})，不是重复`)
    return false
  }
  
  // 检查波动率变化是否在1%范围内
  const rateChange = Math.abs(Math.abs(currentChangeRate) - Math.abs(recentRecord.changeRate))
  const isDuplicate = rateChange <= 1.0
  
  console.log(`${symbol}: 当前${currentChangeRate.toFixed(2)}% vs 历史${recentRecord.changeRate.toFixed(2)}%, 差值${rateChange.toFixed(2)}%, 重复=${isDuplicate}`)
  
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
    console.log(`========================================`)
    console.log(`🚀 多币种价格波动监控任务开始`)
    console.log(`📅 开始时间: ${new Date().toLocaleString('zh-CN')}`)
    console.log(`========================================`)

    try {
      // 多币种监控配置
      const monitorConfigs: MonitorConfig[] = [
        {
          symbol: 'BTCUSDT',
          displayName: 'BTC',
          priceChangeThreshold: 3.0,
          significantChangeThreshold: 10.0,
          monitorPeriodMinutes: 30 // 监控30分钟内的价格变化
        },
        {
          symbol: 'HUSDT',
          displayName: 'H',
          priceChangeThreshold: 5.0,
          significantChangeThreshold: 10.0,
          monitorPeriodMinutes: 30 // 监控30分钟内的价格变化
        },
        {
          symbol: 'TRUMPUSDT',
          displayName: 'TRUMP',
          priceChangeThreshold: 3.0,
          significantChangeThreshold: 10.0,
          monitorPeriodMinutes: 30 // 监控30分钟内的价格变化
        },
      ]

      // 监控配置日志
      console.log(`📊 监控配置:`)
      monitorConfigs.forEach(config => {
        console.log(`  - ${config.displayName} (${config.symbol}):`)
        console.log(`    通知阈值: ${config.priceChangeThreshold}%`)
        console.log(`    重大异动阈值: ${config.significantChangeThreshold}%`)
        console.log(`    监控时间段: ${config.monitorPeriodMinutes}分钟`)
      })

      const category = 'linear'
      const klineInterval = '1' // 1分钟K线
      
      // 计算需要获取的K线数量（取最大监控时间段+1）
      const maxMonitorPeriod = Math.max(...monitorConfigs.map(c => c.monitorPeriodMinutes || 5))
      const klineLimit = maxMonitorPeriod + 1

      console.log(`📈 K线配置: 间隔=${klineInterval}分钟, 数量=${klineLimit}条`)

      // 获取配置信息
      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl
      console.log(`🔗 API地址: ${bybitApiUrl}`)

      // 初始化存储
      const storage = useStorage('db')
      const historyKey = 'telegram:fluctuation_history'

      // 获取历史记录
      let historyRecords = (await storage.getItem(historyKey) || []) as FluctuationHistoryRecord[]
      
      // 历史记录调试日志
      console.log(`📚 历史记录管理:`)
      console.log(`  - 获取到的历史记录数量: ${historyRecords.length}`)
      if (historyRecords.length > 0) {
        console.log(`  - 最近3条记录:`)
        historyRecords.slice(0, 3).forEach((record, index) => {
          console.log(`    ${index + 1}. ${record.symbol}: ${record.changeRate.toFixed(2)}% (${new Date(record.notifiedAt).toLocaleString('zh-CN')})`)
        })
      }
      
      // 清理过期记录
      const beforeCleanCount = historyRecords.length
      historyRecords = cleanExpiredFluctuationRecords(historyRecords)
      const afterCleanCount = historyRecords.length
      console.log(`  - 清理过期记录: ${beforeCleanCount} -> ${afterCleanCount} (清理了${beforeCleanCount - afterCleanCount}条)`)

      // 创建请求队列
      const requestQueue = new RequestQueue({
        maxRandomDelay: 1000,
        minDelay: 500
      })
      console.log(`⏳ 请求队列配置: 最小延迟500ms, 最大随机延迟1000ms`)

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
          console.log(`    🌐 请求URL: ${url}`)

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

          console.log(`    📊 获取到 ${apiResponse.result.list.length} 条K线数据`)

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
            console.log(`    ⏱️ 使用${monitorPeriod}分钟前的数据作为基准`)
          } else if (apiResponse.result.list.length > 1) {
            // 如果K线数据不足监控时间段，则使用最早的K线
            const earliestKline = apiResponse.result.list[apiResponse.result.list.length - 1]
            previousPrice = parseFloat(earliestKline[4])
            console.log(`    ⚠️ 数据不足${monitorPeriod}分钟，使用最早的${apiResponse.result.list.length - 1}分钟前数据`)
          }

          // 计算变化
          changeAmount = currentPrice - previousPrice
          changeRate = previousPrice !== 0 ? (changeAmount / previousPrice) * 100 : 0

          console.log(`    💹 价格计算: 当前$${currentPrice} vs 历史$${previousPrice} = ${changeRate.toFixed(4)}%`)

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

          console.log(`    📊 期间范围: 最高$${periodHighPrice}, 最低$${periodLowPrice}`)

          return {
            symbol: monitorConfig.symbol,
            currentPrice,
            previousPrice,
            changeAmount: parseFloat(changeAmount.toFixed(2)),
            changeRate: parseFloat(changeRate.toFixed(4)),
            changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`,
            highPrice: periodHighPrice, // 使用时间段内的最高价
            lowPrice: periodLowPrice,   // 使用时间段内的最低价
            volume,
            turnover,
            timestamp,
            formattedTime: new Date(timestamp).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })
          }
        })
      }

      // 获取所有币种的数据 - 串行执行避免API限制
      const monitorResults: MonitorResult[] = []
      
      console.log(`\n🔄 开始获取${monitorConfigs.length}个币种的数据...`)
      
      for (const [index, monitorConfig] of monitorConfigs.entries()) {
        console.log(`\n📊 [${index + 1}/${monitorConfigs.length}] 正在获取 ${monitorConfig.symbol} 数据...`)
        
        try {
          const data = await fetchCryptoKlineData(monitorConfig)
          const shouldNotify = Math.abs(data.changeRate) > monitorConfig.priceChangeThreshold
          const isSignificantChange = Math.abs(data.changeRate) > monitorConfig.significantChangeThreshold

          // 详细的监控结果日志
          console.log(`✅ ${monitorConfig.symbol} 数据获取成功:`)
          console.log(`  - 当前价格: $${data.currentPrice.toLocaleString()}`)
          console.log(`  - 历史价格: $${data.previousPrice.toLocaleString()}`)
          console.log(`  - 变化金额: $${data.changeAmount.toLocaleString()}`)
          console.log(`  - 变化率: ${data.changeRate.toFixed(4)}% (绝对值: ${Math.abs(data.changeRate).toFixed(4)}%)`)
          console.log(`  - 格式化变化: ${data.changeRateFormatted}`)
          console.log(`  - 最高价: $${data.highPrice.toLocaleString()}`)
          console.log(`  - 最低价: $${data.lowPrice.toLocaleString()}`)
          console.log(`  - 成交量: ${data.volume.toLocaleString()}`)
          console.log(`  - 成交额: $${data.turnover.toLocaleString()}`)
          console.log(`  - 时间: ${data.formattedTime}`)
          
          // 阈值判断日志
          console.log(`  📏 阈值判断:`)
          console.log(`    - 通知阈值: ${monitorConfig.priceChangeThreshold}%`)
          console.log(`    - 重大异动阈值: ${monitorConfig.significantChangeThreshold}%`)
          console.log(`    - 变化率绝对值: ${Math.abs(data.changeRate).toFixed(4)}%`)
          console.log(`    - 超过通知阈值: ${Math.abs(data.changeRate).toFixed(4)} > ${monitorConfig.priceChangeThreshold} = ${shouldNotify}`)
          console.log(`    - 重大异动: ${Math.abs(data.changeRate).toFixed(4)} > ${monitorConfig.significantChangeThreshold} = ${isSignificantChange}`)
          console.log(`    - 最终结果: 应该通知=${shouldNotify}, 重大异动=${isSignificantChange}`)

          monitorResults.push({
            symbol: monitorConfig.symbol,
            data,
            shouldNotify,
            isSignificantChange
          })
        } catch (error) {
          console.error(`❌ ${monitorConfig.symbol} 数据获取失败:`, error)
          console.error(`  - 错误类型: ${error instanceof Error ? error.constructor.name : 'Unknown'}`)
          console.error(`  - 错误消息: ${error instanceof Error ? error.message : '获取数据失败'}`)
          
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
      
      console.log(`\n📊 数据获取结果汇总:`)
      console.log(`  ✅ 成功: ${successfulResults.length}/${monitorConfigs.length}`)
      console.log(`  ❌ 失败: ${failedResults.length}/${monitorConfigs.length}`)
      
      if (failedResults.length > 0) {
        console.log(`  失败的币种:`)
        failedResults.forEach(result => {
          console.log(`    - ${result.symbol}: ${result.error}`)
        })
      }

      // 筛选需要通知的币种
      const notifyResults = monitorResults.filter(result => result.shouldNotify && !result.error)
      
      console.log(`\n🔔 通知筛选结果:`)
      console.log(`  需要通知的币种数量: ${notifyResults.length}/${successfulResults.length}`)
      if (notifyResults.length > 0) {
        console.log(`  详细列表:`)
        notifyResults.forEach(result => {
          const icon = result.data.changeRate > 0 ? '📈' : '📉'
          console.log(`    ${icon} ${result.symbol}: ${result.data.changeRate.toFixed(2)}%`)
        })
      }

      // 过滤重复通知
      console.log(`\n🔍 重复通知过滤:`)
      const newAlerts = notifyResults.filter(result => {
        const isDuplicate = isDuplicateFluctuationAlert(result.data.changeRate, result.symbol, historyRecords)
        const status = !isDuplicate ? '✅ 通过' : '🚫 被过滤'
        console.log(`  ${result.symbol}: ${status}`)
        return !isDuplicate
      })

      console.log(`  过滤结果: ${notifyResults.length} -> ${newAlerts.length} (过滤了${notifyResults.length - newAlerts.length}个重复)`)

      // 如果没有需要通知的变化
      if (notifyResults.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`\n📋 任务完成 - 无需通知:`)
        console.log(`  - 原因: 所有币种价格变化均不显著`)
        console.log(`  - 执行时间: ${executionTime}ms`)
        console.log(`  - 完成时间: ${new Date().toLocaleString('zh-CN')}`)
        console.log(`========================================`)
        
        return {
          result: 'ok',
          monitored: monitorConfigs.length,
          successful: monitorResults.filter(r => !r.error).length,
          failed: monitorResults.filter(r => r.error).length,
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

      // 如果没有新的警报数据，不发送消息
      if (newAlerts.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`\n📋 任务完成 - 重复数据:`)
        console.log(`  - 原因: 检测到重复波动数据`)
        console.log(`  - 筛选出的通知: ${notifyResults.length}个`)
        console.log(`  - 重复过滤: ${notifyResults.length}个`)
        console.log(`  - 执行时间: ${executionTime}ms`)
        console.log(`  - 完成时间: ${new Date().toLocaleString('zh-CN')}`)
        console.log(`========================================`)
        
        return { 
          result: 'ok', 
          monitored: monitorConfigs.length,
          successful: monitorResults.filter(r => !r.error).length,
          failed: monitorResults.filter(r => r.error).length,
          filtered: notifyResults.length,
          duplicates: notifyResults.length,
          executionTimeMs: executionTime,
          message: '检测到重复波动数据，未发送消息'
        }
      }

      const significantResults = newAlerts.filter(result => result.isSignificantChange)
      const normalResults = newAlerts.filter(result => !result.isSignificantChange)

      console.log(`\n🚨 最终通知分类:`)
      console.log(`  - 重大异动: ${significantResults.length}个`)
      console.log(`  - 一般变化: ${normalResults.length}个`)
      console.log(`  - 总计发送: ${newAlerts.length}个`)

      if (significantResults.length > 0) {
        console.log(`  重大异动详情:`)
        significantResults.forEach(result => {
          const icon = result.data.changeRate > 0 ? '🚀' : '💥'
          console.log(`    ${icon} ${result.symbol}: ${result.data.changeRate.toFixed(2)}%`)
        })
      }

      if (normalResults.length > 0) {
        console.log(`  一般变化详情:`)
        normalResults.forEach(result => {
          const icon = result.data.changeRate > 0 ? '📈' : '📉'
          console.log(`    ${icon} ${result.symbol}: ${result.data.changeRate.toFixed(2)}%`)
        })
      }

      // 构建消息
      let message = `📊 多币种价格波动监控\n⏰ ${new Date().toLocaleString('zh-CN')}\n\n`

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

      console.log(`\n📤 正在发送Telegram消息...`)
      console.log(`  - 消息长度: ${message.length}字符`)
      console.log(`  - 目标群组: -1002663808019`)
      
      // 发送消息到 Telegram
      await bot.api.sendMessage('-1002663808019', message)
      console.log(`✅ Telegram消息发送成功`)

      // 记录新的通知历史
      const newHistoryRecords: FluctuationHistoryRecord[] = newAlerts.map(result => ({
        symbol: result.symbol,
        timestamp: result.data.timestamp,
        changeRate: result.data.changeRate,
        notifiedAt: Date.now()
      }))

      console.log(`\n💾 更新历史记录:`)
      console.log(`  - 新增记录: ${newHistoryRecords.length}条`)
      
      // 更新历史记录
      historyRecords.push(...newHistoryRecords)
      
      // 再次清理过期记录并保存
      const beforeFinalClean = historyRecords.length
      historyRecords = cleanExpiredFluctuationRecords(historyRecords)
      const afterFinalClean = historyRecords.length
      
      await storage.setItem(historyKey, historyRecords)
      
      console.log(`  - 清理前: ${beforeFinalClean}条`)
      console.log(`  - 清理后: ${afterFinalClean}条`)
      console.log(`  - 最终保存: ${historyRecords.length}条`)

      const executionTime = Date.now() - startTime
      
      console.log(`\n🎉 任务成功完成:`)
      console.log(`  - 监控币种: ${monitorConfigs.length}个`)
      console.log(`  - 成功获取: ${successfulResults.length}个`)
      console.log(`  - 获取失败: ${failedResults.length}个`)
      console.log(`  - 发送通知: ${newAlerts.length}个`)
      console.log(`  - 重复过滤: ${notifyResults.length - newAlerts.length}个`)
      console.log(`  - 重大异动: ${significantResults.length}个`)
      console.log(`  - 一般变化: ${normalResults.length}个`)
      console.log(`  - 历史记录: ${historyRecords.length}条`)
      console.log(`  - 执行时间: ${executionTime}ms`)
      console.log(`  - 完成时间: ${new Date().toLocaleString('zh-CN')}`)
      console.log(`========================================`)

      return {
        result: 'ok',
        monitored: monitorConfigs.length,
        successful: monitorResults.filter(r => !r.error).length,
        failed: monitorResults.filter(r => r.error).length,
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
      
      console.error(`\n💥 任务执行失败:`)
      console.error(`  - 错误类型: ${error instanceof Error ? error.constructor.name : 'Unknown'}`)
      console.error(`  - 错误消息: ${error instanceof Error ? error.message : '未知错误'}`)
      console.error(`  - 执行时间: ${executionTime}ms`)
      console.error(`  - 失败时间: ${new Date().toLocaleString('zh-CN')}`)
      console.error(`  - 错误堆栈:`, error)
      console.log(`========================================`)
      
      try {
        console.log(`📤 正在发送错误通知到Telegram...`)
        await bot.api.sendMessage('-1002663808019', `❌ 多币种价格监控任务失败\n⏰ ${new Date().toLocaleString('zh-CN')}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
        console.log(`✅ 错误通知发送成功`)
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