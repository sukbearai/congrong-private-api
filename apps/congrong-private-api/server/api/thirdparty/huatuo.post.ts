const huatuoSchema = z.object({
  thirdAppCode: z.string({
    required_error: '缺少必要参数 thirdAppCode',
  }),
  deviceId: z.string({
    required_error: '缺少必要参数 deviceId',
  }),
  unionId: z.string({
    required_error: '缺少必要参数 unionId',
  }),
  openId: z.string({
    required_error: '缺少必要参数 openId',
  }),
  mobile: z.string({
    required_error: '缺少必要参数 mobile',
  }),
  name: z.string({
    required_error: '缺少必要参数 name',
  }),
  accountType: z.string().default('wx_applet'),
})

interface HuatuoResponse {
  message: string | null
  value: any | null
  success: boolean
  msgCode: string
  resultMap: Record<string, any> | null
}

/**
 * 第三方花图表单提交API
 * 转发请求到花图服务器
 * 使用: POST /api/thirdparty/huatuo
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = huatuoSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    // 获取验证后的数据
    const formData = validationResult.data

    // 构建请求URL和请求体
    const url = 'https://www.maixiangjk.com/huatuo/wechat/callback'

    // 发送请求到第三方API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData),
    })

    // 检查HTTP响应状态
    if (!response.ok) {
      return createErrorResponse(`HTTP 错误: ${response.status}`, response.status)
    }

    // 解析响应数据
    const responseData: HuatuoResponse = await response.json()

    // 检查业务状态码
    if (!responseData.success) {
      return createErrorResponse(responseData.message || '第三方服务调用失败', 500, {
        msgCode: responseData.msgCode,
        resultMap: responseData.resultMap,
      })
    }

    // 返回成功响应
    return createSuccessResponse(responseData.success, '表单提交成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '表单提交失败',
      500,
    )
  }
})
