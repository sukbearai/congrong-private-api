import { createHistoryManager, buildFingerprint } from '../../utils/historyManager'

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
    const telegramChannelId = '-1002663808019'

    // 获取配置信息
    const config = useRuntimeConfig()
    const bybitApiUrl = config.bybit?.bybitApiUrl
    const apiUrl = `${bybitApiUrl}/v5/announcements/index?locale=zh-TW&type=new_crypto&limit=50`

    try {
      // 初始化历史记录管理
      const manager = createHistoryManager<AnnouncementHistoryRecord>({
        storage,
        key: historyKey,
        retentionMs: 7 * 24 * 60 * 60 * 1000, // 7天
        getFingerprint: r => buildFingerprint([r.url, r.publishTime]),
      })
      await manager.load()

      // 拉取Bybit公告
      const response = await fetch(apiUrl, { method: 'GET' })
      if (!response.ok) throw new Error(`HTTP 错误: ${response.status}`)
      const data = (await response.json()) as BybitAnnouncementResponse
      if (data.retCode !== 0) throw new Error(`Bybit API 错误: ${data.retMsg}`)
      if (!data.result.list || data.result.list.length === 0) return { result: 'ok', message: '无公告' }

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
        return { result: 'ok', message: '首次运行，仅记录公告，不发送通知' }
      }

      if (newRecords.length === 0) {
        return { result: 'ok', message: '无新公告' }
      }

      // 构建消息
      let message = `📢 Bybit 新币公告监控\n⏰ ${formatDateTime(Date.now())}\n\n`
  const latestItem = newItems[0]
      message += `【${latestItem.type.title}】${latestItem.title}\n${latestItem.description}\n🔗 [查看公告](${latestItem.url})\n🕒 ${formatDateTime(latestItem.publishTime)}\n\n`

      // 发送到Telegram
      await bot.api.sendMessage(telegramChannelId, message, { parse_mode: 'Markdown' })

  // 已在 filterNew 中放入内存 map，此处只需持久化
  await manager.persist()

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