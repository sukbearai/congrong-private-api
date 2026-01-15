import { bot } from '~/utils/bot'
import { getTelegramChannel } from '~/utils/telegram'

export default eventHandler(async (event) => {
  const body = await readBody(event)

  try {
    const channelId = getTelegramChannel('signal:hubble')

    // Parse payload
    const payload = body as HubbleSignalPayload

    // Send raw JSON to Telegram
    const message = JSON.stringify(payload, null, 2)

    await bot.api.sendMessage(channelId, message)

    return { status: 'received' }
  }
  catch (error) {
    console.error('Error processing Hubble webhook:', error)
    return { status: 'error', message: String(error) }
  }
})

// Types based on observed payload
interface HubbleSignalPayload {
  signature: string
  block: number
  chain: string
  type: 'Inflow' | 'Outflow'
  tag?: Record<string, {
    tag: string[]
    source: string
  }>
  data: {
    sender: string
    receiver: string
    amount: string
    token: string
    symbol: string
    amount_usd: number | string
  }
}
