/* eslint-disable no-console */
// Discord Incoming Webhook helper
// OpenClaw-comparable multi-channel notification support

const DISCORD_MAX_MESSAGE_LENGTH = 2000

/**
 * Split a message into chunks within Discord's 2000-character limit.
 */
function splitDiscordMessage(message: string): string[] {
  if (message.length <= DISCORD_MAX_MESSAGE_LENGTH) {
    return [message]
  }
  const parts: string[] = []
  let remaining = message
  while (remaining.length > DISCORD_MAX_MESSAGE_LENGTH) {
    // Try to split at a newline to avoid cutting mid-line
    const slice = remaining.slice(0, DISCORD_MAX_MESSAGE_LENGTH)
    const lastNewline = slice.lastIndexOf('\n')
    const splitAt = lastNewline > 0 ? lastNewline + 1 : DISCORD_MAX_MESSAGE_LENGTH
    parts.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt)
  }
  if (remaining) {
    parts.push(remaining)
  }
  return parts
}

/**
 * Send a message to a Discord channel via Incoming Webhook.
 * Automatically splits messages that exceed Discord's 2000-character limit.
 */
export async function sendDiscordMessage(webhookUrl: string, message: string): Promise<void> {
  const parts = splitDiscordMessage(message)
  for (const part of parts) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: part,
        username: 'CongRong 市场监控',
      }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error(`Discord webhook 发送失败: HTTP ${response.status} - ${body}`)
      throw new Error(`Discord webhook 发送失败: HTTP ${response.status}`)
    }
  }
}

/**
 * Retrieve the Discord webhook URL for a given task name from KV storage.
 * Returns undefined when no webhook is configured.
 */
export async function getDiscordWebhookUrl(taskName: string): Promise<string | undefined> {
  const storage = useStorage('db')
  const raw = await storage.getItem('discord:webhooks')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const webhooks = raw as Record<string, unknown>
  const url = webhooks[taskName] ?? webhooks.default
  return typeof url === 'string' ? url : undefined
}
