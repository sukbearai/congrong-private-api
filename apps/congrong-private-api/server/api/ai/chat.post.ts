const textGenerationSchema = z.object({
  prompt: z.string({
    required_error: '提示词不能为空',
  }).min(1, '提示词不能为空').max(2000, '提示词长度不能超过2000个字符'),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().min(1).max(8000).optional().default(4000),
  system: z.string().max(1000, '系统提示词长度不能超过1000个字符').optional().default(systemPrompt)
})

// 定义响应数据类型
interface TextGenerationData {
  text: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  },
  logId?: string
}

/**
 * AI文本生成API
 * 使用DeepSeek模型生成文本内容
 * 使用: POST /api/ai/chat
 */
export default defineEventHandler(async (event) => {
  try {
    const { ai } = event.context
    const config = useRuntimeConfig()
    
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = textGenerationSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { prompt, temperature, maxTokens, system } = validationResult.data

    const deepseek = createDeepSeek({
      baseURL: await ai.gateway('congrong-private-ai').getUrl("deepseek"),
      apiKey: config.deepseek.apiKey
    })

    const res = await generateText({
      model: deepseek('deepseek-chat'),
      system,
      prompt,
      temperature,
      maxTokens,
    })

    // 构建响应数据
    const responseData: TextGenerationData = {
      text: res.text,
      usage: res.usage ? {
        promptTokens: res.usage.promptTokens,
        completionTokens: res.usage.completionTokens,
        totalTokens: res.usage.totalTokens
      } : undefined,
      logId: res?.response.headers['cf-aig-log-id']
    }

    // 返回成功响应
    return createSuccessResponse(responseData, '文本生成成功')

  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '文本生成失败',
      500,
    )
  }
})