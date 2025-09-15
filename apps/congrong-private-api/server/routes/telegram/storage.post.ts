// 定义请求验证模式
const storageSchema = z.object({
  key: z.string({
    required_error: '缺少必要参数 key',
    invalid_type_error: 'key 必须是字符串',
  }),
  data: z.any().optional(),
  action: z.enum(['set', 'get', 'delete', 'exists']).default('set'),
})

// 定义接口返回值类型
interface StorageResponse {
  key: string
  data?: any
  exists?: boolean
  message?: string
}

/**
 * Telegram 数据存储API
 * 使用 useStorage('db') 进行数据持久化存储
 * 使用: POST /telegram/storage
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = storageSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { key, data, action } = validationResult.data
    const storage = useStorage('db')
    const storageKey = `telegram:${key}`

    switch (action) {
      case 'set': {
        if (data === undefined) {
          return createErrorResponse('action 为 set 时，data 参数不能为空', 400)
        }

        await storage.setItem(storageKey, data)

        const responseData: StorageResponse = {
          key,
          message: '数据存储成功',
        }

        return createSuccessResponse(responseData, '数据存储成功')
      }

      case 'get': {
        const result = await storage.getItem(storageKey)

        const responseData: StorageResponse = {
          key,
          data: result,
        }

        return createSuccessResponse(responseData, '数据获取成功')
      }

      case 'delete': {
        await storage.removeItem(storageKey)

        const responseData: StorageResponse = {
          key,
          message: '数据删除成功',
        }

        return createSuccessResponse(responseData, '数据删除成功')
      }

      case 'exists': {
        const exists = await storage.hasItem(storageKey)

        const responseData: StorageResponse = {
          key,
          exists,
        }

        return createSuccessResponse(responseData, '检查完成')
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
