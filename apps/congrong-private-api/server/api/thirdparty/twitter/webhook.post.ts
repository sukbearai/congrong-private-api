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
  rule_value: z.string().optional(),
  tweets: z.array(z.object({
    id: z.string(),
    text: z.string().optional(),
    // 兼容 author 字段，并保留额外字段
    author: z.object({
      id: z.string().optional(),
      username: z.string().optional(),
      name: z.string().optional(),
    }).passthrough().optional(),
    // 兼容 created_at / createdAt
    created_at: z.string().optional(),
    createdAt: z.string().optional(),
    // 常见链接字段（twitterapi.io 示例）
    url: z.string().url().optional(),
    twitterUrl: z.string().url().optional(),
  }).passthrough()).optional().default([]),
  timestamp: z.number().optional(),
}).passthrough()

export default defineEventHandler(async (event) => {
  try {
    // 校验来源：X-API-Key !
    const { twitter } = useRuntimeConfig()
    const headerKey
      = getHeader(event, 'X-API-Key')
        || getHeader(event, 'x-api-key')
        || getHeader(event, 'X-Api-Key')
        || getHeader(event, 'x-api-Key')
        || getHeader(event, 'X-API-KEY')

    if (!twitter?.apiKey) {
      // 调试通知：配置缺失
      ;(async () => {
        try {
          const channel = getTelegramChannel('thirdparty:twitter:webhook')
          const lines: string[] = []
          lines.push(buildHeader('⚠️ Twitter Webhook 配置错误'))
          appendEntry(lines, '原因: 服务器未配置 twitter.apiKey')
          appendEntry(lines, `时间: ${new Date().toISOString()}`)
          const msg = assemble(lines)
          const parts = splitMessage(msg)
          for (const part of parts) {
            await bot.api.sendMessage(channel, part)
          }
        }
        catch (_) { /* 忽略调试通知失败 */ }
      })()
      return createErrorResponse('服务器未配置 twitter.apiKey', 500)
    }

    if (!headerKey || headerKey !== twitter.apiKey) {
      // 调试通知：鉴权失败（遮蔽提供的 key）
      ;(async () => {
        try {
          const channel = getTelegramChannel('thirdparty:twitter:webhook')
          const mask = (v?: string | null) => (v ? `${v.slice(0, 3)}***${v.slice(-3)}` : 'null')
          const lines: string[] = []
          lines.push(buildHeader('🚫 Twitter Webhook 未授权'))
          appendEntry(lines, `提供的 X-API-Key: ${mask(headerKey || null)}`)
          appendEntry(lines, '匹配结果: 不一致')
          appendEntry(lines, `时间: ${new Date().toISOString()}`)
          const msg = assemble(lines)
          const parts = splitMessage(msg)
          for (const part of parts) {
            await bot.api.sendMessage(channel, part)
          }
        }
        catch (_) { /* 忽略调试通知失败 */ }
      })()
      return createErrorResponse('Unauthorized request: invalid X-API-Key', 401)
    }

    // 读取并校验请求体
    const body = await readBody(event)
    const validation = twitterWebhookSchema.safeParse(body)
    if (!validation.success) {
      const errorMessages = validation.error.errors.map(e => e.message).join('; ')
      // 调试通知：请求体验证失败
      ;(async () => {
        try {
          const channel = getTelegramChannel('thirdparty:twitter:webhook')
          const preview = (() => {
            try { return JSON.stringify(body).slice(0, 400) }
            catch { return '[无法序列化请求体]' }
          })()
          const lines: string[] = []
          lines.push(buildHeader('❌ Twitter Webhook 验证失败'))
          appendEntry(lines, `错误: ${errorMessages}`)
          appendEntry(lines, `请求体片段: ${preview}`)
          appendEntry(lines, `时间: ${new Date().toISOString()}`)
          const msg = assemble(lines)
          const parts = splitMessage(msg)
          for (const part of parts) {
            await bot.api.sendMessage(channel, part)
          }
        }
        catch (_) { /* 忽略调试通知失败 */ }
      })()
      return createErrorResponse(errorMessages, 400)
    }

    const payload = validation.data
    interface TweetPreview {
      id: string
      text?: string
      author?: { id?: string, username?: string, userName?: string, name?: string }
      created_at?: string
      createdAt?: string
      url?: string
      twitterUrl?: string
    }

    // 处理首次验证事件（twitterapi.io 会发送 test_webhook_url）
    if (payload.event_type === 'test_webhook_url') {
      ;(async () => {
        try {
          const channel = getTelegramChannel('thirdparty:twitter:webhook')
          const lines: string[] = []
          lines.push(buildHeader('🧪 Twitter Webhook 验证'))
          appendEntry(lines, '收到 event_type: test_webhook_url')
          appendEntry(lines, `时间: ${new Date().toISOString()}`)
          const msg = assemble(lines)
          const parts = splitMessage(msg)
          for (const part of parts) {
            await bot.api.sendMessage(channel, part)
          }
        }
        catch (_) { /* 忽略调试通知失败 */ }
      })()

      return createSuccessResponse({ received: true, verification: true, eventType: payload.event_type }, 'Webhook test acknowledged')
    }

    // 可在此处加入持久化/转发逻辑（例如入库、推送到队列等）
    // 发送 Telegram 简报（异步执行，失败不影响响应）
    ;(async () => {
      try {
        const channel = getTelegramChannel('thirdparty:twitter:webhook')
        const lines: string[] = []
        lines.push(buildHeader('📥 Twitter Webhook'))
        appendEntry(lines, `Event: ${payload.event_type}`)
        appendEntry(lines, `Rule: ${payload.rule_tag || '-'} (${payload.rule_id || '-'})`)
        if (payload.rule_value) {
          appendEntry(lines, `Rule Value: ${payload.rule_value}`)
        }
        appendEntry(lines, `Tweets: ${payload.tweets?.length ?? 0}`)

        const tweets = (payload.tweets as unknown as TweetPreview[]) ?? []
        const sample = tweets.slice(0, 3)
        for (const t of sample) {
          const preview = (t.text || '').slice(0, 140).replace(/\s+/g, ' ')
          // 链接优先顺序：twitterUrl > url > 根据 author/用户名拼接 > 通用 i/web/status
          const authorUser = t.author?.username || (t.author as any)?.userName
          const link = (t as any).twitterUrl || (t as any).url || (authorUser ? `https://x.com/${authorUser}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`)
          appendEntry(lines, `• ${t.id}${preview ? ` — ${preview}` : ''} (${link})`)
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
    // 调试通知：处理过程异常
    ;(async () => {
      try {
        const channel = getTelegramChannel('thirdparty:twitter:webhook')
        const lines: string[] = []
        lines.push(buildHeader('🔥 Twitter Webhook 处理异常'))
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        appendEntry(lines, `错误: ${message}`)
        if (error instanceof Error && error.stack) {
          appendEntry(lines, `堆栈: ${error.stack.split('\n').slice(0, 3).join(' | ')}`)
        }
        appendEntry(lines, `时间: ${new Date().toISOString()}`)
        const msg = assemble(lines)
        const parts = splitMessage(msg)
        for (const part of parts) {
          await bot.api.sendMessage(channel, part)
        }
      }
      catch (_) { /* 忽略调试通知失败 */ }
    })()
    return createErrorResponse(error instanceof Error ? error.message : '处理 Webhook 失败', 500)
  }
})
