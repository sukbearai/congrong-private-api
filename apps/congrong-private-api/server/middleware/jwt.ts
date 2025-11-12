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

  const isPathMatched = (paths: string[]) =>
    paths.some(path => event.path === path || (path !== '/' && event.path.startsWith(path)))

  if (event.method === 'OPTIONS') {
    return
  }

  const isSpecialPath = isPathMatched(specialTokenPaths)

  // 如果是公共路径，跳过认证
  if (!isSpecialPath && isPathMatched(publicPaths)) {
    return
  }

  // 从请求头获取令牌
  const authorization = getHeader(event, 'Authorization') || getHeader(event, 'authorization')

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return createErrorResponse(`未提供认证令牌-${event.path}`, 401)
  }

  try {
    const token = authorization.substring(7)

    // 验证令牌
    const secretKey = new TextEncoder().encode(jwtSecret)
    const { payload } = await jose.jwtVerify(token, secretKey)

    // eslint-disable-next-line no-console
    console.log(payload, 'payload')

    const userId = payload.user_id as number | undefined

    // 非特殊路径必须包含 user_id，并写入上下文
    if (!isSpecialPath) {
      if (!userId) {
        return createErrorResponse('无效的令牌内容', 401)
      }

      event.context.userId = userId

      const users = await event.context.db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1)

      const user = users.length > 0 ? users[0] : null

      if (!user) {
        return createErrorResponse('用户不存在', 404)
      }

      event.context.user = user
    }
    else if (userId) {
      // 特殊路径支持附带 user_id，尽量保持上下文一致
      event.context.userId = userId

      const users = await event.context.db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1)

      const user = users.length > 0 ? users[0] : null
      if (user) {
        event.context.user = user
      }
    }
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
