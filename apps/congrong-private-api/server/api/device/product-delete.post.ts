import { eq } from 'drizzle-orm'

// 定义请求验证模式
const productDeleteSchema = z.object({
  id: z.number({
    required_error: '产品ID不能为空',
  }),
})

/**
 * 删除设备产品信息API
 * 根据产品ID删除指定的产品信息
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

    const { id } = validationResult.data

    // 检查产品是否存在
    const existingProducts = await event.context.db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, id))
      .limit(1)

    if (existingProducts.length === 0) {
      return createErrorResponse('产品记录不存在', 404)
    }

    // 删除产品记录
    await event.context.db
      .delete(productsTable)
      .where(eq(productsTable.id, id))

    // 返回成功响应
    return createSuccessResponse({ id }, '产品记录删除成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '删除产品记录失败',
      500,
    )
  }
})