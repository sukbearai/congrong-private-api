// 定义请求验证模式，更新字段定义
const productUpdateSchema = z.object({
  deviceIds: z.string().optional(), // 多个设备ID，如："sn1001,sn1002,sn1003"
  constitutions: z.string().optional(), // 改为字符串形式的体质列表，如："阴虚,阳虚"
  title: z.string().optional(),
  content: z.string().optional(),
  checkedImg: z.string().optional(),
  uncheckedImg: z.string().optional(),
})

/**
 * 更新设备产品信息API
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
      deviceIds = '',
      constitutions = '',
      title = '',
      content = '',
      checkedImg = '',
      uncheckedImg = '',
    } = validationResult.data

    // 构建产品信息对象
    const productInfo = {
      title,
      content,
      checkedImg,
      uncheckedImg,
      constitutions,
      deviceIds,
    }

    // 使用存储服务
    const storage = useStorage('db')

    // 直接使用设备ID和体质组合生成存储键
    const storageKey = `device:product:${deviceIds}:${constitutions}`
    await storage.setItem(storageKey, productInfo)

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
