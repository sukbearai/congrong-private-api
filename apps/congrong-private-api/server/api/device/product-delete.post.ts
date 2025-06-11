// 定义请求验证模式
const productDeleteSchema = z.object({
  key: z.string({
    required_error: '产品记录键不能为空',
  }),
})

/**
 * 删除设备产品信息API
 * 根据存储键删除指定的产品信息
 * 使用: POST /api/device/product-delete
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = productDeleteSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { key } = validationResult.data

    // 使用存储服务
    const storage = useStorage('db')

    // 检查记录是否存在
    const item = await storage.getItem(key)
    if (!item) {
      return createErrorResponse('产品记录不存在', 404)
    }

    // 删除记录
    await storage.removeItem(key, { removeMeta: true })

    // 返回成功响应
    return createSuccessResponse({ key }, '产品记录删除成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '删除产品记录失败',
      500,
    )
  }
})
