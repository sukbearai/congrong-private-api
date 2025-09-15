import { like, or } from 'drizzle-orm'

// 定义请求验证模式，deviceId和physique为必填项
const productQuerySchema = z.object({
  deviceId: z.string({
    required_error: '设备ID不能为空',
  }),
  physique: z.string({
    required_error: '体质不能为空',
  }), // 支持单个体质或夹杂体质,如：阴虚夹气虚夹湿热
  healthLevel: z.string().optional(),
  tenantId: z.string().optional(),
})

// 定义产品信息接口
interface ProductInfo {
  title: string
  content: string
  checkedImg: string
  uncheckedImg: string
  deviceIds: string
  constitutions: string
}

/**
 * 查询设备产品信息API
 * 根据设备ID、体质查询产品信息
 * 使用: POST /api/device/product
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = productQuerySchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { deviceId, physique } = validationResult.data

    if (!physique) {
      return createErrorResponse('体质不能为空', 400)
    }

    // 查询包含指定设备ID的产品
    const products = await event.context.db
      .select()
      .from(productsTable)
      .where(
        or(
          like(productsTable.deviceIds, `%${deviceId}%`),
          like(productsTable.deviceIds, `${deviceId},%`),
          like(productsTable.deviceIds, `%,${deviceId}%`),
          like(productsTable.deviceIds, deviceId),
        ),
      )

    // 将夹杂体质转换为逗号分隔的格式，便于匹配
    const physiqueArray = physique.split('夹').filter(p => p.trim())

    let productInfo: ProductInfo | null = null
    let bestMatchScore = -1 // 用于跟踪最佳匹配的分数

    // 遍历所有产品，查找匹配的产品信息
    for (const product of products) {
      if (!product.deviceIds || !product.constitutions) { continue }

      // 检查设备ID是否匹配
      const storedDeviceIds = product.deviceIds.split(',')
      if (!storedDeviceIds.includes(deviceId)) { continue }

      // 检查体质是否匹配
      const storedConstitutions = product.constitutions.split(',')

      // 情况1: 完全匹配 - 用户的所有体质都在存储的体质列表中
      const allPhysiqueMatched = physiqueArray.every(p =>
        storedConstitutions.includes(p),
      )

      if (allPhysiqueMatched) {
        // 计算匹配分数 - 越接近用户体质数量的匹配越好
        // 例如：用户体质为["阴虚"]，存储体质为["阴虚"]比["阴虚","阳虚"]更精确
        const matchScore = physiqueArray.length / storedConstitutions.length

        // 如果找到更好的匹配，更新产品信息
        if (matchScore > bestMatchScore) {
          bestMatchScore = matchScore
          productInfo = {
            title: product.title,
            content: product.content,
            checkedImg: product.checkedImg,
            uncheckedImg: product.uncheckedImg,
            deviceIds: product.deviceIds,
            constitutions: product.constitutions,
          }
        }
      }
      else {
        // 情况2: 部分匹配 - 用户的至少一个体质在存储的体质列表中
        const anyPhysiqueMatched = physiqueArray.some(p =>
          storedConstitutions.includes(p),
        )

        // 如果没有找到完全匹配但有部分匹配，暂存结果
        if (bestMatchScore < 0 && anyPhysiqueMatched) {
          productInfo = {
            title: product.title,
            content: product.content,
            checkedImg: product.checkedImg,
            uncheckedImg: product.uncheckedImg,
            deviceIds: product.deviceIds,
            constitutions: product.constitutions,
          }
        }
      }
    }

    if (!productInfo) {
      // 如果没有找到产品信息，返回错误
      return createErrorResponse(`未找到匹配的产品信息`, 404)
    }

    // 返回成功响应
    return createSuccessResponse(productInfo, '产品信息获取成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '获取产品信息失败',
      500,
    )
  }
})
