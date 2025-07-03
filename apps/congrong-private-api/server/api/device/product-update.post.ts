// 定义请求验证模式，更新字段定义
const productUpdateSchema = z.object({
  deviceIds: z.string({
    required_error: '设备ID不能为空',
  }), // 多个设备ID，如："sn1001,sn1002,sn1003"
  constitutions: z.string({
    required_error: '体质不能为空',
  }), // 改为字符串形式的体质列表，如："阴虚,阳虚"
  title: z.string({
    required_error: '标题不能为空',
  }),
  content: z.string({
    required_error: '内容不能为空',
  }),
  checkedImg: z.string({
    required_error: '选中图片不能为空',
  }),
  uncheckedImg: z.string({
    required_error: '未选中图片不能为空',
  }),
})

/**
 * 更新设备产品信息API
 * 创建新的产品信息记录
 * 使用: POST /api/device/product-update
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = productUpdateSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const {
      deviceIds,
      constitutions,
      title,
      content,
      checkedImg,
      uncheckedImg,
    } = validationResult.data

    // 插入新产品到数据库
    const newProduct = await event.context.db
      .insert(productsTable)
      .values({
        title,
        content,
        checkedImg,
        uncheckedImg,
        deviceIds,
        constitutions,
      })
      .returning()

    // 构建返回的产品信息对象
    const productInfo = {
      id: newProduct[0].id,
      title,
      content,
      checkedImg,
      uncheckedImg,
      deviceIds,
      constitutions,
      createdAt: newProduct[0].createdAt,
      updatedAt: newProduct[0].updatedAt,
    }

    // 返回成功响应
    return createSuccessResponse(productInfo, '产品信息更新成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '更新产品信息失败',
      500,
    )
  }
})