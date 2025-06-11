// 查询参数验证模式
const listUserSchema = z.object({
  page: z.string().optional().transform(val => val ? Number.parseInt(val, 10) : 1),
  pageSize: z.string().optional().transform(val => val ? Number.parseInt(val, 10) : 10),
  role: z.string().optional(),
})

/**
 * 获取用户列表API
 * 支持分页和角色筛选
 * 使用: GET /api/user/list?page=1&pageSize=10&role=user
 */
export default defineEventHandler(async (event) => {
  try {
    // 获取并验证查询参数
    const query = getQuery(event)
    const validationResult = listUserSchema.safeParse(query)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { page, pageSize, role } = validationResult.data

    // 验证分页参数
    if (page < 1) {
      return createErrorResponse('页码必须大于0', 400)
    }
    if (pageSize < 1 || pageSize > 100) {
      return createErrorResponse('每页数量必须在1-100之间', 400)
    }

    // 构建查询条件
    let whereCondition
    if (role) {
      whereCondition = eq(usersTable.role, role)
    }

    // 查询用户总数
    const totalCountResult = await event.context.db
      .select({ count: sql<number>`count(*)` })
      .from(usersTable)
      .where(whereCondition)

    const total = totalCountResult[0]?.count || 0

    // 查询用户列表
    const offset = (page - 1) * pageSize
    const users = await event.context.db
      .select({
        id: usersTable.id,
        nickname: usersTable.nickname,
        phone: usersTable.phone,
        role: usersTable.role,
        deviceIds: usersTable.deviceIds,
        password: usersTable.password,
      })
      .from(usersTable)
      .where(whereCondition)
      .limit(pageSize)
      .offset(offset)
      .orderBy(usersTable.id)

    // 处理用户数据，解析 deviceIds
    const userList = users.map(user => ({
      ...user,
      // 不再需要解析 JSON
      deviceIds: user.deviceIds || '',
    }))

    // 构建分页信息
    const pagination = {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    }

    return createSuccessResponse({
      list: userList,
      pagination,
    }, '获取用户列表成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '获取用户列表失败',
      500,
    )
  }
})
