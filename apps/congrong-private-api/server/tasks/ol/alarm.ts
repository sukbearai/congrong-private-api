import type {
  BybitApiResponse,
  OpenInterestError,
  OpenInterestLatestItem,
  ProcessedOpenInterestData,
} from '../../routes/exchanges/bybit/openInterest/types'
import { alertThresholds, getRetention } from '../../config/alertThresholds'
import { filterDuplicates } from '../../utils/alerts/dedupe'
import { appendEntry, assemble, buildHeader, splitMessage } from '../../utils/alerts/message'
import { fetchWithRetry } from '../../utils/fetchWithRetry'
import { createHistoryManager } from '../../utils/historyManager'
import { buildTaskResult } from '../../utils/taskResult'
import { getTelegramChannel } from '../../utils/telegram'

interface AlarmHistoryRecord {
  symbol: string
  timestamp: number
  openInterest: number
  changeRate: number
  notifiedAt: number
}

export default defineTask({
  meta: { name: 'ol:alarm', description: '未平仓合约定时消息推送' },
  async run() {
    const startTime = Date.now()
    try {
      const symbols = (await useStorage('db').getItem('telegram:ol') || []) as string[]
      const category = 'linear'
      const intervalTime = '5min'
      const monitoringInterval = 15
      const openInterestThreshold = alertThresholds.openInterestChangePercent

      if (!symbols.length) {
        return buildTaskResult({ startTime, result: 'ok', message: '无监控目标', counts: { processed: 0 } })
      }
      const intervalMinutes = Number.parseInt(intervalTime.replace('min', ''))
      const limit = Math.ceil(monitoringInterval / intervalMinutes) + 1

      console.log(`🚀 未平仓合约监控任务开始 - 监控${symbols.length}个币种, 阈值${openInterestThreshold}%`)

      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl
      const storage = useStorage('db')
      const historyKey = 'telegram:ol_alarm_history'
      const historyManager = createHistoryManager<AlarmHistoryRecord>({
        storage,
        key: historyKey,
        retentionMs: getRetention('shortWindow'),
        getFingerprint: r => `${r.symbol}_${r.timestamp}_${Math.round(r.openInterest)}`,
      })

      const requestQueue = new RequestQueue({ maxRandomDelay: 5000, minDelay: 1000 })

      const fetchSymbolData = async (symbol: string): Promise<ProcessedOpenInterestData> => {
        return await requestQueue.add(async () => {
          const params = new URLSearchParams({ category, symbol, intervalTime, limit: limit.toString() })
          const url = `${bybitApiUrl}/v5/market/open-interest?${params.toString()}`
          const response = await fetchWithRetry(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } }, { retries: 2, timeoutMs: 7000 })
          if (!response.ok) { throw new Error(`HTTP 错误: ${response.status}`) }
          const apiResponse = await response.json() as BybitApiResponse
          if (apiResponse.retCode !== 0) { throw new Error(`Bybit API 错误: ${apiResponse.retMsg}`) }
          if (!apiResponse.result.list || apiResponse.result.list.length === 0) { throw new Error('没有可用数据') }
          const latestItem = apiResponse.result.list[0]
          let changeRate = 0; let changeAmount = 0; let previousOpenInterest = 0
          const targetIndex = Math.ceil(monitoringInterval / intervalMinutes)
          if (apiResponse.result.list.length > targetIndex) {
            const targetItem = apiResponse.result.list[targetIndex]
            const currentOI = Number.parseFloat(latestItem.openInterest)
            previousOpenInterest = Number.parseFloat(targetItem.openInterest)
            changeAmount = currentOI - previousOpenInterest
            changeRate = previousOpenInterest !== 0 ? (changeAmount / previousOpenInterest) * 100 : 0
          }
          const processedItem: OpenInterestLatestItem = {
            ...latestItem,
            timestamp: latestItem.timestamp,
            formattedTime: formatDateTime(Number.parseInt(latestItem.timestamp)),
            timestampMs: Number.parseInt(latestItem.timestamp),
            openInterestFloat: Number.parseFloat(latestItem.openInterest),
            previousOpenInterest,
            changeAmount: Number.parseFloat(changeAmount.toFixed(8)),
            changeRate: Number.parseFloat(changeRate.toFixed(4)),
            changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`,
          }
          return { category: apiResponse.result.category, symbol: apiResponse.result.symbol, latest: processedItem, nextPageCursor: apiResponse.result.nextPageCursor }
        })
      }

      const successful: ProcessedOpenInterestData[] = []
      const failed: OpenInterestError[] = []
      for (const symbol of symbols) {
        try {
          const data = await fetchSymbolData(symbol)
          successful.push(data)
          console.log(`✅ ${symbol}: ${data.latest.changeRateFormatted}`)
        }
        catch (e) {
          console.error(`❌ ${symbol} 数据获取失败: ${e instanceof Error ? e.message : '获取数据失败'}`)
          failed.push({ symbol, error: e instanceof Error ? e.message : '获取数据失败' })
        }
      }
      console.log(`📊 获取结果: 成功${successful.length}个, 失败${failed.length}个`)
      let status: 'ok' | 'partial' | 'error' = 'ok'
      if (successful.length === 0) { status = 'error' }
      else if (failed.length > 0) { status = 'partial' }
      if (status === 'error') {
        return buildTaskResult({ startTime, result: 'error', counts: { processed: symbols.length, successful: 0, failed: failed.length }, message: '全部失败' })
      }

      const filteredData = successful.filter(i => Math.abs(i.latest.changeRate) > openInterestThreshold)
      console.log(`🔔 需要通知: ${filteredData.length}个币种`)
      if (!filteredData.length) {
        return buildTaskResult({ startTime, result: status, counts: { processed: symbols.length, successful: successful.length, failed: failed.length, filtered: 0, newAlerts: 0 }, message: '没有超过阈值的变化' })
      }

      const { newInputs: newAlerts, duplicateInputs, newRecords } = await historyManager.filterNew(filteredData, item => ({
        symbol: item.symbol,
        timestamp: item.latest.timestampMs,
        openInterest: item.latest.openInterestFloat,
        changeRate: item.latest.changeRate,
        notifiedAt: item.latest.timestampMs,
      }))
      console.log(`🔍 重复过滤: 原始 ${filteredData.length} -> 新 ${newAlerts.length} / 重复 ${duplicateInputs.length}`)
      if (!newAlerts.length) {
        return buildTaskResult({ startTime, result: status, counts: { processed: symbols.length, successful: successful.length, failed: failed.length, filtered: filteredData.length, newAlerts: 0, duplicates: duplicateInputs.length }, message: '重复数据' })
      }
      // 进一步细小变化去重（方向+数值容差）：避免短期内多次触发近似同幅度变化
      const { fresh: finalAlerts, duplicates: softDup } = filterDuplicates(newAlerts, a => ({
        symbol: a.symbol,
        direction: a.latest.changeRate > 0 ? 'up' : a.latest.changeRate < 0 ? 'down' : 'flat',
        value: Number.parseFloat(a.latest.changeRate.toFixed(2)),
        timestamp: a.latest.timestampMs,
      }), [], { lookbackMs: 10 * 60 * 1000, toleranceAbs: 0.05, directionSensitive: true })

      const lines: string[] = []
      lines.push(buildHeader(`📊 未平仓合约监控 (${monitoringInterval}分钟变化)`))
      for (const a of finalAlerts) {
        const changeIcon = a.latest.changeRate > 0 ? '📈' : a.latest.changeRate < 0 ? '📉' : '➡️'
        appendEntry(lines, `${changeIcon} ${a.symbol}\n  持仓: ${a.latest.openInterestFloat.toLocaleString()}\n  变化: ${a.latest.changeRateFormatted}\n  时间: ${a.latest.formattedTime}`)
      }
      const assembled = assemble(lines)
      const parts = splitMessage(assembled)
      for (const part of parts) {
        await bot.api.sendMessage(getTelegramChannel('ol:alarm'), part)
      }
      console.log('✅ 消息发送成功')

      if (newRecords.length) { await historyManager.persist() }
      const historyCount = historyManager.getAll().length
      console.log(`💾 历史记录已更新: ${historyCount}条`)

      return buildTaskResult({ startTime, result: status, counts: { processed: symbols.length, successful: successful.length, failed: failed.length, filtered: filteredData.length, newAlerts: newAlerts.length, duplicates: duplicateInputs.length + softDup.length, historyRecords: historyCount }, message: '' })
    }
    catch (error) {
      console.error(`💥 未平仓合约监控任务失败: ${error instanceof Error ? error.message : '未知错误'}`)
      try { await bot.api.sendMessage(getTelegramChannel('ol:alarm'), `❌ 未平仓合约监控任务失败\n⏰ ${formatCurrentTime()}\n错误: ${error instanceof Error ? error.message : '未知错误'}`) }
      catch {}
      return buildTaskResult({ startTime, result: 'error', error: error instanceof Error ? error.message : '未知错误', message: '任务失败' })
    }
  },
})
