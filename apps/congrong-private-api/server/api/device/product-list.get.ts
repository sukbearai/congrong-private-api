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

    // 使用存储服务
    const storage = useStorage('db')

    // 获取所有产品信息的键
    let keys = await storage.getKeys('device:product:')

    keys = keys.filter(key => key.includes(deviceIds))

    // 计算总记录数
    const total = keys.length

    // 计算分页
    const startIndex = (page - 1) * pageSize
    const endIndex = Math.min(startIndex + pageSize, total)
    const paginatedKeys = keys.slice(startIndex, endIndex)

    // 获取分页后的产品信息
    const productList = await Promise.all(
      paginatedKeys.map(async (key) => {
        const item = await storage.getItem(key)
        return {
          key,
          ...(item as Record<string, any>),
        }
      }),
    )

    // 构建分页信息
    const pagination = {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    }

    // 返回成功响应
    return createSuccessResponse({
      list: productList,
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
