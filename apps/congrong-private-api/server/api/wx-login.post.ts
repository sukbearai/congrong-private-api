import type { WechatApiError } from '~~/types'
import { z } from 'zod'

// 定义请求验证模式
const wxLoginSchema = z.object({
  code: z.string({
    required_error: '缺少必要参数 code',
    invalid_type_error: 'code 必须是字符串',
  }),
})

// 微信登录接口返回数据结构
interface WxLoginResponse {
  session_key: string
  unionid?: string
  openid: string
  appid: string
}

/**
 * 微信小程序登录API
 * 通过wx.login获取的code换取用户信息
 * 使用: POST /api/wx-login
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = wxLoginSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { code } = validationResult.data

    // 获取配置信息
    const config = useRuntimeConfig()
    const appId = config.appId
    const appSecret = config.appSecret

    if (!appId || !appSecret) {
      return createErrorResponse('应用配置缺失', 500)
    }

    // 构建请求URL
    const url = 'https://api.weixin.qq.com/sns/jscode2session'
    const queryParams = new URLSearchParams({
      appid: appId,
      secret: appSecret,
      js_code: code,
      grant_type: 'authorization_code',
    })

    // 发送请求到微信API
    const response = await fetch(`${url}?${queryParams.toString()}`)

    if (!response.ok) {
      return createErrorResponse(`HTTP 错误: ${response.status}`, response.status)
    }

    // 解析响应
    const data = await response.json() as WxLoginResponse | WechatApiError

    // 检查是否请求成功
    if ('errcode' in data && data.errcode !== 0) {
      return createErrorResponse(`错误码: ${data.errcode}, 错误信息: ${data.errmsg}`, 500)
    }

    // 获取用户信息（如果需要可以查询数据库）
    const wxLoginData = data as WxLoginResponse

    // 返回微信登录结果
    return createSuccessResponse({
      session_key: wxLoginData.session_key,
      openid: wxLoginData.openid,
      unionid: wxLoginData.unionid,
      appid: appId,
    }, '微信登录成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '微信登录失败',
      500,
    )
  }
})
