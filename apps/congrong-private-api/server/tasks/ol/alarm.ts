import type { 
  BybitApiResponse, 
  ProcessedOpenInterestData, 
  OpenInterestLatestItem,
  OpenInterestError 
} from '../../routes/exchanges/bybit/openInterest/types'
import { createHistoryManager } from '../../utils/historyManager'

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
      const openInterestThreshold = 5
      const intervalMinutes = parseInt(intervalTime.replace('min', ''))
      const limit = Math.ceil(monitoringInterval / intervalMinutes) + 1

      console.log(`🚀 未平仓合约监控任务开始 - 监控${symbols.length}个币种, 阈值${openInterestThreshold}%`)

      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl
      const storage = useStorage('db')
      const historyKey = 'telegram:ol_alarm_history'
      const historyManager = createHistoryManager<AlarmHistoryRecord>({
        storage,
        key: historyKey,
        retentionMs: 2 * 60 * 60 * 1000,
        getFingerprint: r => `${r.symbol}_${r.timestamp}_${Math.floor(r.openInterest)}`,
      })

      const requestQueue = new RequestQueue({ maxRandomDelay: 5000, minDelay: 1000 })

      const fetchSymbolData = async (symbol: string): Promise<ProcessedOpenInterestData> => {
        return await requestQueue.add(async () => {
          const params = new URLSearchParams({ category, symbol, intervalTime, limit: limit.toString() })
          const url = `${bybitApiUrl}/v5/market/open-interest?${params.toString()}`
          const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
          if (!response.ok) throw new Error(`HTTP 错误: ${response.status}`)
            const apiResponse = await response.json() as BybitApiResponse
          if (apiResponse.retCode !== 0) throw new Error(`Bybit API 错误: ${apiResponse.retMsg}`)
          if (!apiResponse.result.list || apiResponse.result.list.length === 0) throw new Error('没有可用数据')
          const latestItem = apiResponse.result.list[0]
          let changeRate = 0, changeAmount = 0, previousOpenInterest = 0
          const targetIndex = Math.ceil(monitoringInterval / intervalMinutes)
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
            formattedTime: formatDateTime(parseInt(latestItem.timestamp)),
            timestampMs: parseInt(latestItem.timestamp),
            openInterestFloat: parseFloat(latestItem.openInterest),
            previousOpenInterest,
            changeAmount: parseFloat(changeAmount.toFixed(8)),
            changeRate: parseFloat(changeRate.toFixed(4)),
            changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`
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
        } catch (e) {
          console.error(`❌ ${symbol} 数据获取失败: ${e instanceof Error ? e.message : '获取数据失败'}`)
          failed.push({ symbol, error: e instanceof Error ? e.message : '获取数据失败' })
        }
      }
      console.log(`📊 获取结果: 成功${successful.length}个, 失败${failed.length}个`)
      if (successful.length === 0 || failed.length > 0) {
        const executionTime = Date.now() - startTime
        return { result: 'error', executionTimeMs: executionTime }
      }

      const filteredData = successful.filter(i => Math.abs(i.latest.changeRate) > openInterestThreshold)
      console.log(`🔔 需要通知: ${filteredData.length}个币种`)
      if (!filteredData.length) {
        const executionTime = Date.now() - startTime
        return { result: 'ok', processed: symbols.length, successful: successful.length, failed: failed.length, message: '没有超过阈值的变化，未发送消息', executionTimeMs: executionTime }
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
        const executionTime = Date.now() - startTime
        return { result: 'ok', processed: symbols.length, successful: successful.length, failed: failed.length, filtered: filteredData.length, duplicates: duplicateInputs.length, message: '检测到重复数据，未发送消息', executionTimeMs: executionTime }
      }

      let message = `📊 未平仓合约监控报告 (${monitoringInterval}分钟变化)\n⏰ ${formatCurrentTime()}\n\n`
      for (const a of newAlerts) {
        const changeIcon = a.latest.changeRate > 0 ? '📈' : a.latest.changeRate < 0 ? '📉' : '➡️'
        message += `${changeIcon} ${a.symbol}\n`
        message += `   持仓: ${a.latest.openInterestFloat.toLocaleString()}\n`
        message += `   变化: ${a.latest.changeRateFormatted}\n`
        message += `   时间: ${a.latest.formattedTime}\n\n`
      }
      await bot.api.sendMessage('-1002663808019', message)
      console.log('✅ 消息发送成功')

      if (newRecords.length) await historyManager.persist()
      const historyCount = historyManager.getAll().length
      console.log(`💾 历史记录已更新: ${historyCount}条`)

      const executionTime = Date.now() - startTime
      return { result: 'ok', processed: symbols.length, successful: successful.length, failed: failed.length, filtered: filteredData.length, newAlerts: newAlerts.length, duplicates: duplicateInputs.length, historyRecords: historyCount, executionTimeMs: executionTime }
    } catch (error) {
      const executionTime = Date.now() - startTime
      console.error(`💥 未平仓合约监控任务失败: ${error instanceof Error ? error.message : '未知错误'} (${executionTime}ms)`)
      try { await bot.api.sendMessage('-1002663808019', `❌ 未平仓合约监控任务失败\n⏰ ${formatCurrentTime()}\n错误: ${error instanceof Error ? error.message : '未知错误'}`) } catch {}
      return { result: 'error', error: error instanceof Error ? error.message : '未知错误', executionTimeMs: executionTime }
    }
  }
})