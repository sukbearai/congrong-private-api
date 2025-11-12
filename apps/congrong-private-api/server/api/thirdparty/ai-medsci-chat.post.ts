import { z } from 'zod'

const chatMessageSchema = z.object({
  inputs: z.record(z.any()).optional().default({}),
  query: z.string({
    required_error: '缺少必要参数 query',
  }),
  response_mode: z.enum(['streaming', 'blocking']).default('streaming'),
  conversation_id: z.string().optional().default(''),
  user: z.string({
    required_error: '缺少必要参数 user',
  }),
  files: z.array(z.any()).optional().default([]),
})


/**
 * AI医学助手聊天消息转发API
 * 转发请求到 ai.medsci.cn 聊天接口，支持 SSE 流式响应
 * 使用: POST /api/thirdparty/ai-medsci-chat
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = chatMessageSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    // 获取验证后的数据
    const chatData = validationResult.data

    // 构建请求URL
    const url = 'https://ai.medsci.cn/v1/chat-messages'

    // 发送请求到第三方API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer app-trwObvQNWNxRfmzFZiITaZut',
        'Content-Type': 'application/json',
        ...(chatData.response_mode === 'streaming' && { 'Accept': 'text/event-stream' }),
      },
      body: JSON.stringify(chatData),
    })

    // 检查HTTP响应状态
    if (!response.ok) {
      return createErrorResponse(`HTTP 错误: ${response.status}`, response.status)
    }

    // 根据响应模式处理返回数据
    if (chatData.response_mode === 'blocking') {
      // 阻塞模式：直接返回 JSON 数据
      const responseData = await response.json()
      return createSuccessResponse(responseData, '聊天消息发送成功')
    }

    // 流式模式：设置 SSE 响应头
    setHeader(event, 'Content-Type', 'text/event-stream')
    setHeader(event, 'Cache-Control', 'no-cache')
    setHeader(event, 'Connection', 'keep-alive')
    setHeader(event, 'Access-Control-Allow-Origin', '*')
    setHeader(event, 'Access-Control-Allow-Headers', 'Cache-Control')

    // 流式转发响应
    const reader = response.body?.getReader()

    if (!reader) {
      return createErrorResponse('无法读取响应流', 500)
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              break
            }
            controller.enqueue(value)
          }
        } catch (error) {
          controller.error(error)
        } finally {
          reader.releaseLock()
        }
      }
    })

    return sendStream(event, stream)
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '聊天消息发送失败',
      500,
    )
  }
})