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
  averagePrice: number
  averagePriceFormatted: string
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
import { createHistoryManager, buildFingerprint } from '../../utils/historyManager'
import { alertThresholds, getRetention } from '../../config/alertThresholds'
import { getTelegramChannel } from '../../utils/telegram'
import { fetchWithRetry } from '../../utils/fetchWithRetry'
import { buildTaskResult } from '../../utils/taskResult'
import { buildHeader, appendEntry, assemble, splitMessage } from '../../utils/alerts/message'
import { filterDuplicates } from '../../utils/alerts/dedupe'

interface FluctuationHistoryRecord {
  symbol: string
  timestamp: number
  changeRate: number
  notifiedAt: number
}

// 复用旧逻辑的“重复”判定，但改造成直接接受最近一条记录
function isDuplicateWithRecent(currentChangeRate: number, recent?: FluctuationHistoryRecord): boolean {
  if (!recent) return false
  const currentDirection = currentChangeRate >= 0 ? 'up' : 'down'
  const recentDirection = recent.changeRate >= 0 ? 'up' : 'down'
  if (currentDirection !== recentDirection) return false
  const tolerance = alertThresholds.fluctuationDuplicateTolerancePercent
  const rateChange = Math.abs(Math.abs(currentChangeRate) - Math.abs(recent.changeRate))
  return rateChange <= tolerance
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

      if (!monitorConfigs.length) {
        return buildTaskResult({ startTime, result: 'ok', message: '无监控目标', counts: { processed: 0 } })
      }

      const category = 'linear'
      const klineInterval = '1'
      
      // 计算需要获取的K线数量（取最大监控时间段+1）
      const maxMonitorPeriod = Math.max(...monitorConfigs.map(c => c.monitorPeriodMinutes || 5))
      const klineLimit = maxMonitorPeriod + 1

      // 获取配置信息
      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl

      // 初始化历史管理器
      const storage = useStorage('db')
      const historyKey = 'telegram:fluctuation_history'
      const manager = createHistoryManager<FluctuationHistoryRecord>({
        storage,
        key: historyKey,
        retentionMs: getRetention('shortWindow'),
        getFingerprint: r => buildFingerprint([r.symbol, r.timestamp, Math.round(r.changeRate * 100) / 100]),
      })
      await manager.load()

      // 创建请求队列
      const requestQueue = new RequestQueue({
        maxRandomDelay: 1000,
        minDelay: 500
      })

      // 获取单个币种K线数据的函数
      const fetchCryptoKlineData = async (monitorConfig: MonitorConfig): Promise<CryptoPriceData> => {
        return await requestQueue.add(async () => {
           // 计算时间范围
          const now = Date.now()

          // 结束时间
          const endTime = now
          // 开始时间 - 监控时间段前
          const startTime = now - (klineLimit * 60 * 1000)

          // 构建查询参数
          const params = new URLSearchParams({
            category,
            symbol: monitorConfig.symbol,
            interval: klineInterval,
            start: startTime.toString(),
            end: endTime.toString(),
            limit: klineLimit.toString(),
          })

          // 构建请求URL
          const url = `${bybitApiUrl}/v5/market/kline?${params.toString()}`

          // 发送请求到Bybit API
          const response = await fetchWithRetry(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } }, { retries: 2, timeoutMs: 7000 })

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

          // 计算成交量加权平均价格 (VWAP)
          let totalWeightedPrice = 0
          let totalVolume = 0
          
          for (const kline of periodKlines) {
            const closePrice = parseFloat(kline[4])
            const klineVolume = parseFloat(kline[5])
            totalWeightedPrice += closePrice * klineVolume
            totalVolume += klineVolume
          }
          
          const averagePrice = totalVolume > 0 ? totalWeightedPrice / totalVolume : currentPrice

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
            formattedTime: formatDateTime(timestamp),
            averagePrice: parseFloat(averagePrice.toFixed(2)),
            averagePriceFormatted: `$${averagePrice.toLocaleString()}`
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
              timestamp: 0,
              averagePrice: 0,
              averagePriceFormatted: '$0'
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

  // 如果没有需要通知的变化
      if (notifyResults.length === 0) {
        return buildTaskResult({ startTime, result: 'ok', counts: { processed: monitorConfigs.length, successful: successfulResults.length, failed: failedResults.length, filtered: 0, newAlerts: 0 }, message: '所有币种价格变化均不显著，未发送通知', meta: { details: monitorResults.map(r => ({ symbol: r.symbol, currentPrice: r.data.currentPrice || 0, changeRate: r.data.changeRate || 0, threshold: monitorConfigs.find(c => c.symbol === r.symbol)?.priceChangeThreshold || 0, shouldNotify: r.shouldNotify, error: r.error })) } })
      }

      // 只有当有需要通知的变化时，才获取历史记录
      // 利用 manager 中的历史记录做重复检测
      const existing = manager.getAll()
      // 每个 symbol 找最近记录
      const latestBySymbol = new Map<string, FluctuationHistoryRecord>()
      for (const rec of existing) {
        const prev = latestBySymbol.get(rec.symbol)
        if (!prev || rec.notifiedAt > prev.notifiedAt) latestBySymbol.set(rec.symbol, rec)
      }

      const newAlerts = notifyResults.filter(result => {
        const recent = latestBySymbol.get(result.symbol)
        return !isDuplicateWithRecent(result.data.changeRate, recent)
      })

      console.log(`🔍 重复过滤: ${notifyResults.length} -> ${newAlerts.length}`)

      // 如果没有新的警报数据，不发送消息
      if (newAlerts.length === 0) {
        return buildTaskResult({ startTime, result: 'ok', counts: { processed: monitorConfigs.length, successful: successfulResults.length, failed: failedResults.length, filtered: notifyResults.length, newAlerts: 0, duplicates: notifyResults.length }, message: '检测到重复波动数据，未发送消息' })
      }

      const significantResults = newAlerts.filter(result => result.isSignificantChange)
      const normalResults = newAlerts.filter(result => !result.isSignificantChange)

      console.log(`🚨 通知分类: 重大异动${significantResults.length}个, 一般变化${normalResults.length}个`)

      // 构建消息
      // 二次软去重
      const { fresh: finalAlerts, duplicates: softDup } = filterDuplicates(newAlerts, a => ({
        symbol: a.symbol,
        direction: a.data.changeRate > 0 ? 'up' : a.data.changeRate < 0 ? 'down' : 'flat',
        value: parseFloat(a.data.changeRate.toFixed(2)),
        timestamp: a.data.timestamp,
      }), [], { lookbackMs: 10 * 60 * 1000, toleranceAbs: alertThresholds.fluctuationDuplicateTolerancePercent / 2, directionSensitive: true })

      let lines: string[] = []
      lines.push(buildHeader('📊 多币种价格波动监控'))

      // 重大异动警报 - 优先显示
      if (significantResults.length > 0) {
        appendEntry(lines, '🚨 重大异动警报 🚨')

        for (const result of significantResults) {
          const config = monitorConfigs.find(c => c.symbol === result.symbol)!
          const data = result.data
          const alertIcon = data.changeRate > 0 ? '🚀🚀🚀' : '💥💥💥'
          const trendIcon = data.changeRate > 0 ? '📈' : '📉'
          const monitorPeriod = config.monitorPeriodMinutes || 5
          
    appendEntry(lines, `${alertIcon} ${config.displayName} ${data.symbol} 重大异动 ${alertIcon}\n  ${trendIcon} 变化: ${data.changeRateFormatted}\n  当前: $${data.currentPrice.toLocaleString()}  ${monitorPeriod}分钟前: $${data.previousPrice.toLocaleString()}\n  VWAP: ${data.averagePriceFormatted} 高: $${data.highPrice.toLocaleString()} 低: $${data.lowPrice.toLocaleString()}\n  时间: ${data.formattedTime}`)
        }
      }

      // 一般变化通知
      if (normalResults.length > 0) {
        for (const result of normalResults) {
          const config = monitorConfigs.find(c => c.symbol === result.symbol)!
          const data = result.data
          const changeIcon = data.changeRate > 0 ? '📈' : '📉'
          const monitorPeriod = config.monitorPeriodMinutes || 5
          
          appendEntry(lines, `${changeIcon} ${config.displayName} (${data.symbol})\n  变化: ${data.changeRateFormatted} 当前: $${data.currentPrice.toLocaleString()}  ${monitorPeriod}分钟前: $${data.previousPrice.toLocaleString()}  VWAP: ${data.averagePriceFormatted}\n  时间: ${data.formattedTime}`)
        }
      }

      // 添加失败信息（如果有）
      if (failedResults.length > 0) {
        appendEntry(lines, `⚠️ 获取失败: ${failedResults.map(r => r.symbol).join(', ')}`)
      }
      const assembled = assemble(lines)
      const parts = splitMessage(assembled)
      for (const p of parts) await bot.api.sendMessage(getTelegramChannel('market:fluctuation'), p)
      console.log(`✅ 消息发送成功`)

      // 新记录加入 manager
      const newRecords: FluctuationHistoryRecord[] = newAlerts.map(result => ({
        symbol: result.symbol,
        timestamp: result.data.timestamp,
        changeRate: result.data.changeRate,
        notifiedAt: Date.now(),
      }))
      manager.addRecords(newRecords)
      await manager.persist()
      console.log(`💾 历史记录已更新: ${manager.getAll().length}条`)

      const executionTime = Date.now() - startTime

      console.log(`🎉 任务完成: 监控${monitorConfigs.length}个, 通知${newAlerts.length}个, 用时${executionTime}ms`)

  return buildTaskResult({ startTime, result: 'ok', counts: { processed: monitorConfigs.length, successful: successfulResults.length, failed: failedResults.length, filtered: notifyResults.length, newAlerts: finalAlerts.length, duplicates: (notifyResults.length - newAlerts.length) + softDup.length, historyRecords: manager.getAll().length }, meta: { significantChanges: significantResults.length, normalChanges: normalResults.length } })

    } catch (error) {
      const executionTime = Date.now() - startTime
      
      console.error(`💥 任务失败: ${error instanceof Error ? error.message : '未知错误'} (${executionTime}ms)`)
      
      try {
        await bot.api.sendMessage(getTelegramChannel('market:fluctuation'), `❌ 多币种价格监控任务失败\n⏰ ${formatCurrentTime()}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch (botError) {
        console.error(`❌ 发送错误消息失败:`, botError)
      }

  return buildTaskResult({ startTime, result: 'error', error: error instanceof Error ? error.message : '未知错误', message: '任务失败' })
    }
  },
})