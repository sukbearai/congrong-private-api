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

function cleanExpiredAnnouncementRecords(records: AnnouncementHistoryRecord[]): AnnouncementHistoryRecord[] {
  // 只保留最近7天的记录
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  return records.filter(r => r.notifiedAt > sevenDaysAgo)
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
    const telegramChannelId = '-1002663808019'

    // 获取配置信息
    const config = useRuntimeConfig()
    const bybitApiUrl = config.bybit?.bybitApiUrl
    const apiUrl = `${bybitApiUrl}/v5/announcements/index?locale=zh-TW&type=new_crypto&limit=50`

    try {
      // 获取历史记录
      let historyRecords = (await storage.getItem(historyKey) || []) as AnnouncementHistoryRecord[]
      historyRecords = cleanExpiredAnnouncementRecords(historyRecords)

      // 拉取Bybit公告
      const response = await fetch(apiUrl, { method: 'GET' })
      if (!response.ok) throw new Error(`HTTP 错误: ${response.status}`)
      const data = (await response.json()) as BybitAnnouncementResponse
      if (data.retCode !== 0) throw new Error(`Bybit API 错误: ${data.retMsg}`)
      if (!data.result.list || data.result.list.length === 0) return { result: 'ok', message: '无公告' }

      // 过滤出未通知过的新公告
      const newItems = data.result.list.filter(item => {
        return !historyRecords.some(r => r.url === item.url && r.publishTime === item.publishTime)
      })

      const isFirstRun = historyRecords.length === 0

      if (isFirstRun) {
        // 首次运行，全部公告都记录，不发送通知
        const allHistory: AnnouncementHistoryRecord[] = data.result.list.map(item => ({
          url: item.url,
          publishTime: item.publishTime,
          notifiedAt: Date.now(),
        }))
        historyRecords.push(...allHistory)
        historyRecords = cleanExpiredAnnouncementRecords(historyRecords)
        await storage.setItem(historyKey, historyRecords)
        return { result: 'ok', message: '首次运行，仅记录公告，不发送通知' }
      }

      if (newItems.length === 0) {
        // 没有新公告
        return { result: 'ok', message: '无新公告' }
      }

      // 构建消息
      let message = `📢 Bybit 新币公告监控\n⏰ ${formatDateTime(Date.now())}\n\n`
      for (const item of newItems) {
        message += `【${item.type.title}】${item.title}\n${item.description}\n🔗 [查看公告](${item.url})\n🕒 ${formatDateTime(item.publishTime)}\n\n`
      }

      // 发送到Telegram
      await bot.api.sendMessage(telegramChannelId, message, { parse_mode: 'Markdown' })

      // 记录新通知
      const newHistory: AnnouncementHistoryRecord[] = newItems.map(item => ({
        url: item.url,
        publishTime: item.publishTime,
        notifiedAt: Date.now(),
      }))
      historyRecords.push(...newHistory)
      historyRecords = cleanExpiredAnnouncementRecords(historyRecords)
      await storage.setItem(historyKey, historyRecords)

      const executionTime = Date.now() - startTime
      return { result: 'ok', notified: newItems.length, executionTimeMs: executionTime }
    } catch (error) {
      const executionTime = Date.now() - startTime
      try {
        await bot.api.sendMessage(telegramChannelId, `❌ Bybit新币公告监控任务失败\n⏰ ${formatDateTime(Date.now())}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch { }
      return { result: 'error', error: error instanceof Error ? error.message : '未知错误', executionTimeMs: executionTime }
    }
  },
})