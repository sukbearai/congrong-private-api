// 登录请求验证模式
const loginSchema = z.object({
  phone: z.string().min(11).max(11).regex(/^1[3-9]\d{9}$/, '请输入有效的手机号'),
  password: z.string().min(6, '密码至少6位').max(50, '密码不超过50位'),
})

/**
 * 用户登录API
 * 使用手机号和密码进行身份验证
 * 验证用户存在且密码正确后生成JWT令牌
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = loginSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { phone, password } = validationResult.data

    // 查询用户
    const users = await event.context.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.phone, phone))
      .limit(1)

    const user = users.length > 0 ? users[0] : null

    // 获取JWT密钥
    const config = useRuntimeConfig()
    const jwtSecret = config.jwtSecret
    const secretKey = new TextEncoder().encode(jwtSecret)

    // 检查用户是否存在
    if (!user) {
      return createErrorResponse('手机号或密码错误', 401)
    }

    // 验证密码
    if (user.password !== password) {
      return createErrorResponse('手机号或密码错误', 401)
    }

    // 生成JWT令牌
    const token = await new jose.SignJWT({ user_id: user.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d') // 30天有效期
      .sign(secretKey)

    return createSuccessResponse({
      token,
      user,
    }, '登录成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '登录处理失败',
      500,
    )
  }
})
