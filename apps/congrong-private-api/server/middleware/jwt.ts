declare module 'h3' {
  interface H3EventContext {
    userId?: number
    user?: typeof usersTable.$inferSelect
  }
}

/**
 * JWT认证中间件
 * 验证请求的JWT令牌，并将用户信息添加到请求上下文
 */
export default defineEventHandler(async (event) => {
  const { jwtSecret } = useRuntimeConfig()

  // 不需要认证的API路径
  const publicPaths = [
    '/',
    '/api/device',
    '/api/qrcode',
    '/api/thirdparty',
    '/api/upload',
    '/api/user/login',
    '/api/phone',
    '/api/wx-login',
    '/api/ai',
    '/telegram',
    '/exchanges',
    '/finance',
    '/api/thirdparty/twitter',
  ]

  // 需要特殊token鉴权的路径
  const specialTokenPaths = [
    '/api/thirdparty/ai-medsci-chat',
  ]

  // 检查是否需要特殊token鉴权
  if (specialTokenPaths.includes(event.path)) {
    const authHeader = getHeader(event, 'authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return createErrorResponse('Missing or invalid authorization header', 401)
    }

    const token = authHeader.substring(7)
    // 简单的token验证
    const validTokens = [
      'app-trwObvQNWNxRfmzFZiITaZut',
      'sk-test-token',
      // 可以添加更多有效token
    ]

    if (!validTokens.includes(token)) {
      return createErrorResponse('Unauthorized: Invalid token', 401)
    }

    // 特殊鉴权通过，继续执行
    return
  }

  // 如果是公共路径或OPTIONS请求，跳过认证
  if (publicPaths.some(path => event.path === path || (path !== '/' && event.path.startsWith(path))) || event.method === 'OPTIONS') {
    return
  }

  // 从请求头获取令牌
  const authorization = getHeader(event, 'Authorization')

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return createErrorResponse(`未提供认证令牌-${event.path}`, 401)
  }

  try {
    const token = authorization.split(' ')[1]

    // 验证令牌
    const secretKey = new TextEncoder().encode(jwtSecret)
    const { payload } = await jose.jwtVerify(token, secretKey)

    // eslint-disable-next-line no-console
    console.log(payload, 'payload')

    const userId = payload.user_id as number
    if (!userId) {
      return createErrorResponse('无效的令牌内容', 401)
    }

    event.context.userId = userId

    // 查询用户信息
    const users = await event.context.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1)

    const user = users.length > 0 ? users[0] : null

    if (!user) {
      return createErrorResponse('用户不存在', 404)
    }

    // 将用户信息添加到请求上下文
    event.context.user = user
  }
  catch (error) {
    // 处理不同类型的JWT错误
    if (error instanceof jose.errors.JWTExpired) {
      return createErrorResponse('令牌已过期', 401)
    }
    else if (error instanceof jose.errors.JWTInvalid
      || error instanceof jose.errors.JWTClaimValidationFailed) {
      return createErrorResponse('无效的令牌', 401)
    }
    return createErrorResponse('认证失败', 500)
  }
})
