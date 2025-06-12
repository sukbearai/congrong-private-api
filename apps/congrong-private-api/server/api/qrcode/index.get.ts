import type { WechatApiError } from '~~/types'
import { Buffer } from 'node:buffer'

// 申明 H3 扩展类型，让 TypeScript 识别我们添加的 context 字段
declare module 'h3' {
  interface H3EventContext {
    wechatToken?: {
      access_token: string
      expires_in: number
      from_cache: boolean
    }
  }
}

const QrcodeRequestSchema = z.object({
  device_id: z.string({
    required_error: '缺少必要参数 device_id',
    invalid_type_error: 'device_id 必须是字符串',
  }),
  width: z.number({
    invalid_type_error: 'width 必须是数字',
  })
    .int()
    .min(280, 'width 最小值为 280px')
    .max(1280, 'width 最大值为 1280px')
    .optional()
    .default(430),
})

/**
 * 生成小程序码API
 * 根据设备ID生成用于小程序设备绑定的二维码
 * 使用: GET /api/qrcode?device_id=xxx&width=430
 */
export default defineEventHandler(async (event) => {
  try {
    // 获取查询参数
    const query = getQuery(event)

    // 构建请求体
    const requestBody = {
      device_id: query.device_id,
      width: query.width ? Number(query.width) : undefined,
    }

    // 使用 Zod 验证请求参数
    const validationResult = QrcodeRequestSchema.safeParse(requestBody)

    if (!validationResult.success) {
      // 格式化验证错误信息
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    // 提取验证后的数据
    const validatedData = validationResult.data

    // 从 event.context 获取微信 token
    if (!event.context.wechatToken || !event.context.wechatToken.access_token) {
      return createErrorResponse('无法获取微信 access_token', 500)
    }

    const accessToken = event.context.wechatToken.access_token

    // 使用 token 调用微信接口生成小程序码
    const url = `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${accessToken}`

    const requestData = {
      scene: `device_id=${validatedData.device_id}`,
      page: 'pages/app/home/index',
      check_path: false,
      width: validatedData.width,
    }

    // 发送请求到微信接口
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    })

    // 检查是否请求成功
    if (!response.ok) {
      return createErrorResponse(`HTTP 错误: ${response.status}`, response.status)
    }

    // 检查返回的是否是错误信息
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      const errorData = await response.json() as WechatApiError
      if (errorData.errcode) {
        return createErrorResponse(
          `错误码: ${errorData.errcode}, 错误信息: ${errorData.errmsg}`,
          500,
        )
      }
    }

    // 获取二维码图片的二进制数据
    const imageBuffer = await response.arrayBuffer()

    // 设置响应头部为图片格式
    setResponseHeader(event, 'Content-Type', 'image/png')

    // 返回二进制数据

    return Buffer.from(imageBuffer)
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '获取小程序码出错',
      500,
    )
  }
})
