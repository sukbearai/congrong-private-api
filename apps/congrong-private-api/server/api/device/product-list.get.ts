import { like, or, sql, desc } from 'drizzle-orm'

const productListSchema = z.object({
  deviceIds: z.string({
    required_error: '设备ID不能为空',
  }),
  page: z.string().optional().transform(val => val ? Number.parseInt(val, 10) : 1),
  pageSize: z.string().optional().transform(val => val ? Number.parseInt(val, 10) : 10),
})

/**
 * 查询设备产品发布记录API
 * 获取产品发布历史记录，支持按多个设备ID筛选和分页
 * 使用: GET /api/device/product-list?deviceIds=id1,id2,id3&page=1&pageSize=10
 */
export default defineEventHandler(async (event) => {
  try {
    // 获取并验证查询参数
    const query = getQuery(event)
    const validationResult = productListSchema.safeParse(query)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { deviceIds, page, pageSize } = validationResult.data

    // 验证分页参数
    if (page < 1) {
      return createErrorResponse('页码必须大于0', 400)
    }
    if (pageSize < 1 || pageSize > 100) {
      return createErrorResponse('每页数量必须在1-100之间', 400)
    }

    // 解析设备ID列表
    const deviceIdArray = deviceIds.split(',').map(id => id.trim())
    
    // 构建查询条件 - 匹配任意一个设备ID
    const deviceConditions = deviceIdArray.map(deviceId => 
      or(
        like(productsTable.deviceIds, `%${deviceId}%`),
        like(productsTable.deviceIds, `${deviceId},%`),
        like(productsTable.deviceIds, `%,${deviceId}%`),
        like(productsTable.deviceIds, deviceId)
      )
    )

    const whereCondition = or(...deviceConditions)

    // 查询产品总数
    const totalCountResult = await event.context.db
      .select({ count: sql<number>`count(*)` })
      .from(productsTable)
      .where(whereCondition)

    const total = totalCountResult[0]?.count || 0

    // 查询产品列表
    const offset = (page - 1) * pageSize
    const products = await event.context.db
      .select({
        id: productsTable.id,
        title: productsTable.title,
        content: productsTable.content,
        checkedImg: productsTable.checkedImg,
        uncheckedImg: productsTable.uncheckedImg,
        deviceIds: productsTable.deviceIds,
        constitutions: productsTable.constitutions,
        createdAt: productsTable.createdAt,
        updatedAt: productsTable.updatedAt,
      })
      .from(productsTable)
      .where(whereCondition)
      .orderBy(desc(productsTable.createdAt))
      .limit(pageSize)
      .offset(offset)

    // 构建分页信息
    const pagination = {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    }

    // 返回成功响应
    return createSuccessResponse({
      list: products,
      pagination,
    }, '产品发布记录获取成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '获取产品发布记录失败',
      500,
    )
  }
})