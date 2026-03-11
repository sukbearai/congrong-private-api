/* eslint-disable no-console */
/**
 * Unified multi-channel notification sender.
 *
 * Sends alerts to Telegram (always) and optionally to Discord when a webhook
 * URL is configured for the given task name in KV storage.
 *
 * This mirrors OpenClaw's multi-channel messaging architecture where the same
 * notification can be delivered to multiple platforms simultaneously.
 *
 * Usage:
 *   import { sendNotification } from '../utils/notify'
 *   await sendNotification('ol:alarm', message)
 */

import { getDiscordWebhookUrl, sendDiscordMessage } from './discord'
import { getTelegramChannel } from './telegram'
import { bot } from './bot'

export interface SendNotificationOptions {
  /** Telegram parse_mode (default: plain text) */
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
}

/**
 * Send a notification to all configured channels for the given task name.
 *
 * @param taskName - The task or channel identifier (e.g. 'ol:alarm', 'funding:rate')
 * @param message  - The message text to send
 * @param options  - Optional Telegram parse_mode and other settings
 */
export async function sendNotification(taskName: string, message: string, options?: SendNotificationOptions): Promise<void> {
  const telegramChannel = getTelegramChannel(taskName)

  // Always send to Telegram
  const sendOptions = options?.parseMode ? { parse_mode: options.parseMode } : {}
  await bot.api.sendMessage(telegramChannel, message, sendOptions)

  // Send to Discord if a webhook URL is configured for this task
  try {
    const discordUrl = await getDiscordWebhookUrl(taskName)
    if (discordUrl) {
      await sendDiscordMessage(discordUrl, message)
    }
  }
  catch (error) {
    // Discord errors are non-fatal — log but don't rethrow to keep Telegram flow unaffected
    console.error(`Discord 通知发送失败 (${taskName}):`, error instanceof Error ? error.message : error)
  }
}
