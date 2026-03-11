/**
 * GET /discord/test
 *
 * Send a test notification to the default Discord webhook (if configured).
 * Useful for verifying that the webhook URL is correct.
 */
import { getDiscordWebhookUrl, sendDiscordMessage } from '../../utils/discord'

export default defineEventHandler(async () => {
  try {
    const webhookUrl = await getDiscordWebhookUrl('default')
    if (!webhookUrl) {
      return createErrorResponse('未配置 Discord Webhook URL，请先通过 POST /discord/storage 设置', 400)
    }

    await sendDiscordMessage(webhookUrl, `🔔 Discord 消息发送测试 time: ${new Date().toLocaleString()}`)

    return createSuccessResponse({ webhookUrl: webhookUrl.replace(/\/api\/webhooks\/.+$/, '/api/webhooks/***') }, 'Discord 消息发送测试成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Discord 消息发送测试失败',
      500,
    )
  }
})
