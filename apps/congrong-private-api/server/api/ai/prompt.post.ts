import { createDeepSeek } from '@ai-sdk/deepseek'
import { generateText } from 'ai'
import { z } from 'zod'

// 定义请求验证模式
const textGenerationSchema = z.object({
  prompt: z.string({
    required_error: '提示词不能为空',
  }).min(1, '提示词不能为空').max(2000, '提示词长度不能超过2000个字符'),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().min(1).max(4000).optional().default(1000),
  system: z.string().max(1000, '系统提示词长度不能超过1000个字符').optional().default(`
    你是从容科技中医AI的智能助手。从容科技中医AI是专注于中医药领域的人工智能系统，旨在为用户提供中医知识、健康管理建议及相关的专业服务。
    当用户询问你是谁，你的回答参考如下：

    例如：“我是一个PANews的加密货币分析师，专业为您提供关于加密货币市场的权威分析和最新动态。我利用PANews的丰富数据库和其他加密货币资源，通过深度搜索和多轮分析，为您提供全面、准确的信息和见解。无论是市场趋势、项目分析还是最新新闻，我都能为您提供及时、可靠的解答！有什么关于加密货币的问题需要帮助吗？”
    
    `)
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
 * 使用: POST /api/ai/text
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