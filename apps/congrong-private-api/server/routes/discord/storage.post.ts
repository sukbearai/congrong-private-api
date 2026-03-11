/**
 * POST /discord/storage
 *
 * Manage Discord webhook URL configuration stored in KV.
 * Works the same as /telegram/storage — stores webhook URLs keyed by task name.
 *
 * Request body:
 *   { key: string, data?: any, action: 'set' | 'get' | 'delete' | 'exists' }
 *
 * Storage key format:  discord:<key>
 *
 * Example — set the default webhook URL:
 *   POST /discord/storage
 *   { "key": "webhooks", "data": { "default": "https://discord.com/api/webhooks/..." }, "action": "set" }
 *
 * Example — set a per-task webhook URL:
 *   POST /discord/storage
 *   { "key": "webhooks", "data": { "default": "...", "ol:alarm": "https://..." }, "action": "set" }
 */

// Discord webhook URL pattern: https://discord.com/api/webhooks/{id}/{token}
const DISCORD_WEBHOOK_URL_PATTERN = /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/.+$/

const storageSchema = z.object({
  key: z.string({ required_error: '缺少必要参数 key' }),
  data: z.any().optional(),
  action: z.enum(['set', 'get', 'delete', 'exists']).default('set'),
})

interface StorageResponse {
  key: string
  data?: any
  exists?: boolean
  message?: string
}

export default defineEventHandler(async (event) => {
  try {
    const rawBody = await readBody(event)
    const validationResult = storageSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { key, data, action } = validationResult.data
    const storage = useStorage('db')
    const storageKey = `discord:${key}`

    switch (action) {
      case 'set': {
        if (data === undefined) {
          return createErrorResponse('action 为 set 时，data 参数不能为空', 400)
        }
        // Validate webhook URLs when storing the 'webhooks' config
        if (key === 'webhooks') {
          if (typeof data !== 'object' || Array.isArray(data) || data === null) {
            return createErrorResponse('webhooks 必须是对象格式，例如 { "default": "https://discord.com/api/webhooks/..." }', 400)
          }
          const invalidEntries = Object.entries(data as Record<string, unknown>).filter(
            ([, url]) => typeof url !== 'string' || !DISCORD_WEBHOOK_URL_PATTERN.test(url),
          )
          if (invalidEntries.length > 0) {
            return createErrorResponse(`无效的 Discord Webhook URL: ${invalidEntries.map(([k]) => k).join(', ')}`, 400)
          }
        }
        await storage.setItem(storageKey, data)
        return createSuccessResponse({ key, message: '数据存储成功' } as StorageResponse, '数据存储成功')
      }

      case 'get': {
        const result = await storage.getItem(storageKey)
        return createSuccessResponse({ key, data: result } as StorageResponse, '数据获取成功')
      }

      case 'delete': {
        await storage.removeItem(storageKey)
        return createSuccessResponse({ key, message: '数据删除成功' } as StorageResponse, '数据删除成功')
      }

      case 'exists': {
        const exists = await storage.hasItem(storageKey)
        return createSuccessResponse({ key, exists } as StorageResponse, '检查完成')
      }

      default:
        return createErrorResponse('不支持的操作类型', 400)
    }
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '存储操作失败',
      500,
    )
  }
})
