import type { WechatApiError } from '~~/types'
import { z } from 'zod'

// 定义请求验证模式
const phoneSchema = z.object({
  code: z.string({
    required_error: '缺少必要参数 code',
    invalid_type_error: 'code 必须是字符串',
  }),
  openid: z.string().optional(),
})

// 定义微信返回的手机号数据结构
interface PhoneNumberResponse {
  errcode: number
  errmsg: string
  phone_info: {
    phoneNumber: string
    purePhoneNumber: string
    countryCode: string
    watermark: {
      timestamp: number
      appid: string
    }
  }
}

// 定义接口返回值类型
interface ApiPhoneNumberResponse {
  phoneNumber: string
  purePhoneNumber: string
  countryCode: string
}

/**
 * 获取用户手机号API
 * 通过微信服务端API解密获取用户手机号
 * 使用: POST /api/phone
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = phoneSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { code, openid } = validationResult.data

    // 从 event.context 获取微信 token
    if (!event.context.wechatToken || !event.context.wechatToken.access_token) {
      return createErrorResponse('无法获取微信 access_token', 500)
    }

    const accessToken = event.context.wechatToken.access_token

    // 构建请求URL
    const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`

    // 构建请求数据
    const requestData: { code: string, openid?: string } = { code }
    if (openid) { requestData.openid = openid }

    // 发送请求到微信API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    })

    // 解析响应
    const data = await response.json() as PhoneNumberResponse | WechatApiError

    // 检查是否请求成功
    if ('errcode' in data && data.errcode !== 0) {
      return createErrorResponse(`错误码: ${data.errcode}, 错误信息: ${data.errmsg}`, 500)
    }

    // 提取并返回手机号数据，保持与前端类型一致
    const phoneData: ApiPhoneNumberResponse = {
      phoneNumber: (data as PhoneNumberResponse).phone_info.phoneNumber,
      purePhoneNumber: (data as PhoneNumberResponse).phone_info.purePhoneNumber,
      countryCode: (data as PhoneNumberResponse).phone_info.countryCode,
    }

    return createSuccessResponse(phoneData, '获取手机号成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '获取手机号失败',
      500,
    )
  }
})
