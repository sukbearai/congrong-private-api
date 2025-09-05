// Basic Telegram channel resolution helper (placeholder for future expansion)

const DEFAULT_CHANNEL = '-1002663808019'

// Map task name prefix -> channel id (can be extended or loaded from runtimeConfig later)
const channelMap: Record<string, string> = {
  'funding:rate': DEFAULT_CHANNEL,
  'account:ratio': DEFAULT_CHANNEL,
  'ol:alarm': DEFAULT_CHANNEL,
  'market:fluctuation': DEFAULT_CHANNEL,
  'market:announcement': DEFAULT_CHANNEL,
}

export function getTelegramChannel(taskName: string): string {
  return channelMap[taskName] || DEFAULT_CHANNEL
}
