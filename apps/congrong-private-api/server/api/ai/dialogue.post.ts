import { CoreMessage } from "ai"

const textGenerationSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1, '消息内容不能为空')
  })).min(1, '消息数组不能为空').refine(
    (messages) => messages.some(msg => msg.role === 'user'),
    '至少需要一条用户消息'
  ),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().min(1).max(4000).optional().default(1000),
  model: z.enum(['deepseek-chat', 'deepseek-reasoner']).optional().default('deepseek-chat'),
  system: z.string().max(1000, '系统提示词长度不能超过1000个字符').optional().default(systemPrompt)
})

/**
 * AI多轮对话
 * 使用DeepSeek模型生成文本内容
 * 使用: POST /api/ai/dialogue
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

    const { messages, temperature, maxTokens, system,model } = validationResult.data

    const deepseek = createDeepSeek({
      baseURL: await ai.gateway('congrong-private-ai').getUrl("deepseek"),
      apiKey: config.deepseek.apiKey
    })

    const res = await streamText({
      model: deepseek(model),
      system,
      messages: messages as CoreMessage[],
      temperature,
      maxTokens,
    })

    return res.toDataStreamResponse({
      sendReasoning: model === 'deepseek-reasoner',
    });

  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '文本生成失败',
      500,
    )
  }
})