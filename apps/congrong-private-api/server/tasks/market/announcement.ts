import { createHistoryManager, buildFingerprint } from '../../utils/historyManager'
import { getRetention } from '../../config/alertThresholds'
import { escapeMarkdown, truncate } from '../../utils/markdown'
import { getTelegramChannel } from '../../utils/telegram'
import { fetchWithRetry } from '../../utils/fetchWithRetry'
import { buildTaskResult } from '../../utils/taskResult'
import { buildHeader, appendEntry, assemble, splitMessage } from '../../utils/alerts/message'

interface BybitAnnouncementItem {
  title: string
  description: string
  type: { title: string; key: string }
  tags: string[]
  url: string
  dateTimestamp: number
  startDateTimestamp: number
  endDateTimestamp: number
  publishTime: number
}

interface BybitAnnouncementResponse {
  retCode: number
  retMsg: string
  result: {
    total: number
    list: BybitAnnouncementItem[]
  }
  retExtInfo: Record<string, unknown>
  time: number
}

interface AnnouncementHistoryRecord {
  url: string
  publishTime: number
  notifiedAt: number
}

export default defineTask({
  meta: {
    name: 'market:announcement',
    description: 'Bybit新币公告监控，有新公告推送Telegram',
  },
  async run() {
    const startTime = Date.now()
    const storage = useStorage('db')
    const historyKey = 'telegram:announcement_history'
    const taskName = 'market:announcement'
    const telegramChannelId = getTelegramChannel(taskName)

    // 获取配置信息
    const config = useRuntimeConfig()
    const bybitApiUrl = config.bybit?.bybitApiUrl
    const apiUrl = `${bybitApiUrl}/v5/announcements/index?locale=zh-TW&type=new_crypto&limit=50`

    try {
      // 初始化历史记录管理
      const manager = createHistoryManager<AnnouncementHistoryRecord>({
        storage,
        key: historyKey,
        retentionMs: getRetention('announcement'),
        getFingerprint: r => buildFingerprint([r.url, r.publishTime]),
      })
      await manager.load()

      // 拉取Bybit公告
  const response = await fetchWithRetry(apiUrl, { method: 'GET' }, { retries: 2, timeoutMs: 8000 })
      if (!response.ok) throw new Error(`HTTP 错误: ${response.status}`)
      const data = (await response.json()) as BybitAnnouncementResponse
      if (data.retCode !== 0) throw new Error(`Bybit API 错误: ${data.retMsg}`)
  if (!data.result.list || data.result.list.length === 0) return buildTaskResult({ startTime, result: 'ok', message: '无公告' })

      // 首次运行判定
      const isFirstRun = manager.getAll().length === 0

      // 只考虑最近1天的公告
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
      const recentList = data.result.list.filter(item => item.publishTime > oneDayAgo)

      // 使用 HistoryManager 去重
      const { newInputs: newItems, newRecords } = await manager.filterNew(recentList, item => ({
        url: item.url,
        publishTime: item.publishTime,
        notifiedAt: Date.now(),
      }))

      if (isFirstRun) {
        // 首次运行：记录全部（含历史）不通知
        const firstRecords: AnnouncementHistoryRecord[] = data.result.list.map(item => ({
          url: item.url,
          publishTime: item.publishTime,
          notifiedAt: Date.now(),
        }))
        manager.addRecords(firstRecords)
        await manager.persist()
        return buildTaskResult({ startTime, result: 'ok', message: '首次运行，仅记录公告，不发送通知' })
      }

      if (newRecords.length === 0) {
        return buildTaskResult({ startTime, result: 'ok', message: '无新公告', counts: { newAlerts: 0 } })
      }

      // 构建消息
      const lines: string[] = []
      lines.push(buildHeader('📢 Bybit 新币公告监控'))
      for (const item of newItems.slice(0, 5)) { // 最多展示5条，避免超长
        const safeTitle = escapeMarkdown(truncate(item.title, 120))
        const safeDesc = escapeMarkdown(truncate(item.description || '', 260))
        const safeType = escapeMarkdown(item.type.title)
        appendEntry(lines, `【${safeType}】${safeTitle}\n${safeDesc}\n🔗 ${item.url}\n🕒 ${formatDateTime(item.publishTime)}`)
      }
      if (newItems.length > 5) {
        appendEntry(lines, `… 其余 ${newItems.length - 5} 条公告已省略`)
      }
      const assembled = assemble(lines)
      const parts = splitMessage(assembled)
      for (const p of parts) await bot.api.sendMessage(telegramChannelId, p)

  // 已在 filterNew 中放入内存 map，此处只需持久化
  await manager.persist()
  return buildTaskResult({ startTime, result: 'ok', counts: { newAlerts: newItems.length } })
    } catch (error) {
      try {
        await bot.api.sendMessage(telegramChannelId, `❌ Bybit新币公告监控任务失败\n⏰ ${formatDateTime(Date.now())}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch { }
  return buildTaskResult({ startTime, result: 'error', error: error instanceof Error ? error.message : '未知错误', message: '任务失败' })
    }
  },
})