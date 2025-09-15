/**
 * TwitterAPI.io Webhook 接收端点
 * 路径: POST /api/thirdparty/twitter/webhook
 * 校验: 请求头 X-API-Key 必须等于 runtimeConfig.twitter.apiKey
 * 负载: 参考 twitterapi.io 文档，包含 event_type、rule_id、rule_tag、tweets、timestamp 等
 * 日志: 收到事件后发送 Telegram 简报（不影响主流程）
 */

import { appendEntry, assemble, buildHeader, splitMessage } from '../../../utils/alerts/message'
import { bot } from '../../../utils/bot'
import { getTelegramChannel } from '../../../utils/telegram'

const twitterWebhookSchema = z.object({
  event_type: z.string().min(1, 'event_type 不能为空'),
  rule_id: z.string().optional(),
  rule_tag: z.string().optional(),
  tweets: z.array(z.object({
    id: z.string(),
    text: z.string().optional(),
    author: z.object({
      id: z.string().optional(),
      username: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
    created_at: z.string().optional(),
  })).optional().default([]),
  timestamp: z.number().optional(),
}).passthrough()

export default defineEventHandler(async (event) => {
  try {
    // 校验来源：X-API-Key
    const { twitter } = useRuntimeConfig()
    const headerKey = getHeader(event, 'X-API-Key') || getHeader(event, 'x-api-key')

    if (!twitter?.apiKey) {
      return createErrorResponse('服务器未配置 twitter.apiKey', 500)
    }

    if (!headerKey || headerKey !== twitter.apiKey) {
      return createErrorResponse('Unauthorized request: invalid X-API-Key', 401)
    }

    // 读取并校验请求体
    const body = await readBody(event)
    const validation = twitterWebhookSchema.safeParse(body)
    if (!validation.success) {
      const errorMessages = validation.error.errors.map(e => e.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const payload = validation.data

    // 可在此处加入持久化/转发逻辑（例如入库、推送到队列等）
    // 发送 Telegram 简报（异步执行，失败不影响响应）
    ;(async () => {
      try {
        const channel = getTelegramChannel('thirdparty:twitter:webhook')
        const lines: string[] = []
        lines.push(buildHeader('📥 Twitter Webhook'))
        appendEntry(lines, `Event: ${payload.event_type}`)
        appendEntry(lines, `Rule: ${payload.rule_tag || '-'} (${payload.rule_id || '-'})`)
        appendEntry(lines, `Tweets: ${payload.tweets?.length ?? 0}`)

        const sample = payload.tweets?.slice(0, 3) ?? []
        for (const t of sample) {
          const preview = (t.text || '').slice(0, 140).replace(/\s+/g, ' ')
          appendEntry(lines, `• ${t.id}${preview ? ` — ${preview}` : ''}`)
        }

        const message = assemble(lines)
        const parts = splitMessage(message)
        for (const part of parts) {
          await bot.api.sendMessage(channel, part)
        }
      }
      catch (err) {
        // 忽略通知失败，避免影响 webhook 主流程
        // eslint-disable-next-line no-console
        console.error('发送 Telegram 通知失败:', err)
      }
    })()

    return createSuccessResponse({
      received: true,
      eventType: payload.event_type,
      ruleId: payload.rule_id,
      ruleTag: payload.rule_tag,
      tweetsCount: payload.tweets?.length ?? 0,
    }, 'Webhook received')
  }
  catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : '处理 Webhook 失败', 500)
  }
})
