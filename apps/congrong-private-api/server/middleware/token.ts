/**
 * 获取微信接口调用凭证
 * 优先从缓存中获取，过期则重新请求微信接口
 * 将 token 放入 event.context 中供后续中间件和处理器使用
 */
export default defineEventHandler(async (event) => {
  const { appId, appSecret } = useRuntimeConfig(event)

  if (event.path.startsWith('/webhooks') || event.path.startsWith('/telegram') || event.path.startsWith('/hubble')) {
    return
  }

  if (!appId || !appSecret) {
    return createErrorResponse('请配置 appId 和 appSecret 环境变量', 500)
  }

  // 使用数据存储来缓存 token
  const storage = useStorage('db')
  const CACHE_KEY = 'wechat:access_token'

  try {
    // 先尝试从缓存中获取 token
    const cachedToken = await storage.getItem(CACHE_KEY) as { access_token: string, expireTime: number } | null

    // 如果缓存存在且未过期，使用缓存的 token
    if (cachedToken && cachedToken.expireTime > Date.now()) {
      // 将 token 信息存入 event.context
      event.context.wechatToken = {
        access_token: cachedToken.access_token,
        expires_in: Math.floor((cachedToken.expireTime - Date.now()) / 1000),
        from_cache: true,
      }

      // 继续执行下一个处理器
      return
    }

    // 缓存不存在或已过期，请求微信接口
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`

    const response = await fetch(url)
    const data = await response.json() as WechatTokenResponse | WechatApiError

    // 检查是否请求成功
    if ('errcode' in data) {
      return createErrorResponse(`错误码: ${data.errcode}, 错误信息: ${data.errmsg}`, 500)
    }

    // 计算过期时间（当前时间 + expires_in 秒 - 5分钟的安全边界）
    // 提前5分钟过期是为了避免临界点时的问题
    const expireTime = Date.now() + (data.expires_in * 1000) - (5 * 60 * 1000)

    // 缓存 token
    await storage.setItem(CACHE_KEY, {
      access_token: data.access_token,
      expireTime,
    })

    // 将 token 信息存入 event.context
    event.context.wechatToken = {
      access_token: data.access_token,
      expires_in: data.expires_in,
      from_cache: false,
    }

    // 继续执行下一个处理器
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '获取微信 access_token 出错',
      500,
    )
  }
})
