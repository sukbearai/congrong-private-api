// 创建用户请求验证模式
const createUserSchema = z.object({
  nickname: z.string().min(1, '昵称不能为空').max(50, '昵称不超过50个字符'),
  phone: z.string().min(11).max(11).regex(/^1[3-9]\d{9}$/, '请输入有效的手机号'),
  password: z.string().min(6, '密码至少6位').max(50, '密码不超过50位').optional(),
  role: z.string().default('user'),
  deviceIds: z.string().optional(),
  aiEnabled: z.number().default(0),
})

/**
 * 创建用户API
 * 创建新用户账户
 * 使用: POST /api/user/create
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = createUserSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { nickname, phone, password, role, deviceIds, aiEnabled } = validationResult.data

    // 检查手机号是否已存在
    const existingUsers = await event.context.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.phone, phone))
      .limit(1)

    if (existingUsers.length > 0) {
      return createErrorResponse('该手机号已被注册', 409)
    }

    // 创建新用户
    const newUser = await event.context.db
      .insert(usersTable)
      .values({
        nickname,
        phone,
        password,
        role,
        deviceIds: deviceIds || '',
        aiEnabled,
      })
      .returning()

    // 返回创建的用户信息（不包含密码）
    const userInfo = {
      ...newUser[0],
      deviceIds: newUser[0].deviceIds || '',
      password: undefined, // 不返回密码
    }

    return createSuccessResponse(userInfo, '用户创建成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '创建用户失败',
      500,
    )
  }
})
