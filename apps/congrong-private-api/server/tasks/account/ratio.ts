import type { OpenInterestError } from '../../routes/exchanges/bybit/openInterest/types'
import { createHistoryManager, buildFingerprint } from '../../utils/historyManager'
import { alertThresholds, getRetention } from '../../config/alertThresholds'
import { getTelegramChannel } from '../../utils/telegram'
import { fetchWithRetry } from '../../utils/fetchWithRetry'
import { buildTaskResult } from '../../utils/taskResult'
import { buildHeader, appendEntry, assemble, splitMessage } from '../../utils/alerts/message'
import { filterDuplicates } from '../../utils/alerts/dedupe'

// 定义大户多空比值数据接口
interface LongShortRatioItem {
  symbol: string
  longShortRatio: string
  longAccount: string
  shortAccount: string
  timestamp: string
  // 计算字段
  timestampMs: number
  formattedTime: string
  longShortRatioFloat: number
  longAccountFloat: number
  shortAccountFloat: number
  changeRate: number
  previousRatio: number
  changeAmount: number
  changeRateFormatted: string
}

interface ProcessedLongShortRatioData {
  symbol: string
  latest: LongShortRatioItem
}

// 定义历史记录接口（用于 HistoryManager）
interface LongShortRatioHistoryRecord {
  symbol: string
  timestamp: number
  longShortRatio: number
  changeRate: number
  notifiedAt: number
}

export default defineTask({
  meta: {
    name: 'account:ratio',
    description: '大户多空账户数比值定时消息推送',
  },
  async run() {
    const startTime = Date.now()

    try {
      // 配置要监控的币种
      const symbols = (await useStorage('db').getItem('telegram:ol') || []) as string[]
      const period = '5m' // 可选: "5m","15m","30m","1h","2h","4h","6h","12h","1d"

      // 空目标快速返回，避免后续不必要调用
      if (!symbols.length) {
        return buildTaskResult({ startTime, result: 'ok', message: '无监控目标', counts: { processed: 0 } })
      }

      // 配置监控时间间隔（分钟）
  const monitoringInterval = 15
  const ratioChangeThreshold = alertThresholds.longShortRatioChangePercent

      // 根据监控间隔计算需要获取的数据条数
      const periodMinutes = period === '5m' ? 5 : period === '15m' ? 15 : period === '30m' ? 30 : 60
      const limit = Math.ceil(monitoringInterval / periodMinutes) + 1 // +1 确保有足够数据

      console.log(`🚀 大户多空比监控任务开始 - 监控${symbols.length}个币种, 阈值${ratioChangeThreshold}%`)

      // 获取配置信息
      const config = useRuntimeConfig()
      const binanceApiUrl = config.binance.binanceApiUrl // Binance Futures API

      // 初始化 HistoryManager（仅在真正需要通知时才会触发 load/persist）
      const storage = useStorage('db')
      const historyManager = createHistoryManager<LongShortRatioHistoryRecord>({
        storage,
        key: 'telegram:longShortRatio_alarm_history',
        retentionMs: getRetention('shortWindow'),
        getFingerprint: r => buildFingerprint([r.symbol, r.timestamp, Math.round(r.longShortRatio * 10000)])
      })

      // 创建请求队列
      const requestQueue = new RequestQueue({
        maxRandomDelay: 5000,
        minDelay: 1000
      })

      // 创建获取单个symbol数据的函数
      const fetchSymbolData = async (symbol: string): Promise<ProcessedLongShortRatioData> => {
        return await requestQueue.add(async () => {
          // 构建查询参数
          const params = new URLSearchParams({
            symbol,
            period,
            limit: limit.toString(),
          })

          // 构建请求URL
          const url = `${binanceApiUrl}/futures/data/topLongShortAccountRatio?${params.toString()}`

          // 发送请求到Binance API
          const response = await fetchWithRetry(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } }, { retries: 2, timeoutMs: 7000 })

          // 检查HTTP响应状态
          if (!response.ok) {
            throw new Error(`HTTP 错误: ${response.status}`)
          }

          // 解析响应数据
          let apiResponse = (await response.json() as LongShortRatioItem[])

          // 反转数组，使最新数据在前
          apiResponse = apiResponse.reverse()

          // 检查API响应
          if (!apiResponse || apiResponse.length === 0) {
            throw new Error('没有可用数据')
          }

          // 处理数据 - 计算指定时间间隔的变化
          const latestItem = apiResponse[0]
          let changeRate = 0
          let changeAmount = 0
          let previousRatio = 0

          // 计算目标时间间隔前的数据索引
          const targetIndex = Math.ceil(monitoringInterval / periodMinutes)

          // 如果有足够的历史数据，计算变化率
          if (apiResponse.length > targetIndex) {
            const targetItem = apiResponse[targetIndex]
            const currentRatio = parseFloat(latestItem.longShortRatio)
            previousRatio = parseFloat(targetItem.longShortRatio)

            changeAmount = currentRatio - previousRatio
            changeRate = previousRatio !== 0 ? (changeAmount / previousRatio) * 100 : 0
          }

          const processedItem: LongShortRatioItem = {
            ...latestItem,
            timestampMs: parseInt(latestItem.timestamp),
            formattedTime: formatDateTime(parseInt(latestItem.timestamp)),
            longShortRatioFloat: parseFloat(latestItem.longShortRatio),
            longAccountFloat: parseFloat(latestItem.longAccount),
            shortAccountFloat: parseFloat(latestItem.shortAccount),
            previousRatio,
            changeAmount: parseFloat(changeAmount.toFixed(4)),
            changeRate: parseFloat(changeRate.toFixed(4)),
            changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`
          }

          return {
            symbol: latestItem.symbol,
            latest: processedItem,
          }
        })
      }

      // 获取所有symbols的数据 - 串行执行
      const successful: ProcessedLongShortRatioData[] = []
      const failed: OpenInterestError[] = []

      for (const symbol of symbols) {
        try {
          const data = await fetchSymbolData(symbol)
          successful.push(data)
          console.log(`✅ ${symbol}: 多空比${data.latest.longShortRatioFloat.toFixed(4)}, 变化${data.latest.changeRateFormatted}`)
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
      let status: 'ok' | 'partial' | 'error' = 'ok'
      if (successful.length === 0) status = 'error'
      else if (failed.length > 0) status = 'partial'
      if (status === 'error') {
        return buildTaskResult({ startTime, result: 'error', counts: { processed: symbols.length, failed: failed.length }, message: '全部失败' })
      }

      // 过滤超过阈值的数据
      const filteredData = successful.filter(item => {
        const shouldNotify = Math.abs(item?.latest?.changeRate) > ratioChangeThreshold
        return shouldNotify
      })

      console.log(`🔔 需要通知: ${filteredData.length}个币种`)

      // 如果没有数据超过阈值，不发送消息
      if (filteredData.length === 0) {
        return buildTaskResult({ startTime, result: status, counts: { processed: symbols.length, successful: successful.length, failed: failed.length, filtered: 0, newAlerts: 0 }, message: '没有超过阈值的变化' })
      }
      // 使用 HistoryManager 进行重复过滤与转换
      const { newInputs: newAlerts, duplicateInputs, newRecords } = await historyManager.filterNew(
        filteredData,
        (item): LongShortRatioHistoryRecord => ({
          symbol: item.symbol,
          timestamp: item.latest.timestampMs,
          longShortRatio: item.latest.longShortRatioFloat,
          changeRate: item.latest.changeRate,
          // 采用最新数据时间戳作为通知时间
          notifiedAt: item.latest.timestampMs
        })
      )

      console.log(`🔍 重复过滤: ${filteredData.length} -> 新${newAlerts.length}, 重复${duplicateInputs.length}`)

      if (newRecords.length === 0) {
        return buildTaskResult({ startTime, result: status, counts: { processed: symbols.length, successful: successful.length, failed: failed.length, filtered: filteredData.length, newAlerts: 0, duplicates: duplicateInputs.length }, message: '重复数据' })
      }

      // 构建消息
      // 二次软去重 (进一步聚合变化幅度相近的一组)
      const { fresh: finalAlerts, duplicates: softDup } = filterDuplicates(newAlerts, a => ({
        symbol: a.symbol,
        direction: a.latest.changeRate > 0 ? 'up' : a.latest.changeRate < 0 ? 'down' : 'flat',
        value: parseFloat(a.latest.changeRate.toFixed(2)),
        timestamp: a.latest.timestampMs,
      }), [], { lookbackMs: 10 * 60 * 1000, toleranceAbs: 0.05, directionSensitive: true })

      const lines: string[] = []
      lines.push(buildHeader(`📊 大户多空账户数比值监控 (${monitoringInterval}分钟变化)`))
      for (const item of finalAlerts) {
        const changeRate = item.latest.changeRate
        const changeIcon = changeRate > 0 ? '📈' : changeRate < 0 ? '📉' : '➡️'
        const trendDescription = changeRate > 0 ? '🟢 多仓占比增加' : changeRate < 0 ? '🔴 空仓占比增加' : '🟡 持平'
        const previousLongRatio = item.latest.previousRatio
        const currentLongRatio = item.latest.longShortRatioFloat
        const ratioChange = (currentLongRatio - previousLongRatio).toFixed(4)
        appendEntry(lines, `${changeIcon} ${item.symbol} - ${trendDescription}\n  多空比: ${currentLongRatio.toFixed(4)}\n  多仓比: ${(item.latest.longAccountFloat * 100).toFixed(2)}%  空仓比: ${(item.latest.shortAccountFloat * 100).toFixed(2)}%\n  变化率: ${item.latest.changeRateFormatted}\n  比值变化: ${previousLongRatio.toFixed(4)} → ${currentLongRatio.toFixed(4)} (${ratioChange.startsWith('-') ? '' : '+'}${ratioChange})\n  时间: ${item.latest.formattedTime}`)
      }
      const assembled = assemble(lines)
      const parts = splitMessage(assembled)
      for (const p of parts) await bot.api.sendMessage(getTelegramChannel('account:ratio'), p)
      console.log(`✅ 消息发送成功`)

      // 持久化新历史记录（内部会做一次过期裁剪与远端合并）
      await historyManager.persist()
      const historySize = historyManager.getAll().length
      console.log(`💾 历史记录已更新: ${historySize}条`)

  console.log(`🎉 任务完成: 监控${symbols.length}个, 通知${finalAlerts.length}个`)
  return buildTaskResult({ startTime, result: status, counts: { processed: symbols.length, successful: successful.length, failed: failed.length, filtered: filteredData.length, newAlerts: finalAlerts.length, duplicates: duplicateInputs.length + softDup.length, historyRecords: historySize } })
    }
    catch (error) {
  console.error(`💥 大户多空比监控任务失败: ${error instanceof Error ? error.message : '未知错误'}`)

      try {
        await bot.api.sendMessage(getTelegramChannel('account:ratio'), `❌ 大户多空比监控任务失败\n⏰ ${formatCurrentTime()}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch (botError) {
        console.error('❌ 发送错误消息失败:', botError)
      }

  return buildTaskResult({ startTime, result: 'error', error: error instanceof Error ? error.message : '未知错误', message: '任务失败' })
    }
  },
})