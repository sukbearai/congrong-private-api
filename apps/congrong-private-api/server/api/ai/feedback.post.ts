const FeedbackType = {
  THUMBS_UP: 'thumbs_up', // 点赞
  THUMBS_DOWN: 'thumbs_down', // 点踩
} as const

// 定义反馈验证模式
const feedbackSchema = z.object({
  logId: z.string({
    required_error: '日志ID不能为空',
  }).min(1, '日志ID不能为空'),
  type: z.enum([FeedbackType.THUMBS_UP, FeedbackType.THUMBS_DOWN], {
    required_error: '反馈类型不能为空',
  }),
  comment: z.string().max(500, '评论内容不能超过500个字符').optional(),
  reason: z.string().max(200, '原因不能超过200个字符').optional(),
  userId: z.string().optional(), // 可选的用户ID
})

// 定义响应数据类型
interface FeedbackData {
  logId: string
  type: string
}

// 将反馈类型转换为分数
function getFeedbackScore(type: string): number {
  switch (type) {
    case FeedbackType.THUMBS_UP:
      return 100 // 正面反馈
    case FeedbackType.THUMBS_DOWN:
      return 0 // 负面反馈
    default:
      return null // 中性
  }
}

// 将反馈类型转换为数值
function getFeedbackValue(type: string) {
  switch (type) {
    case FeedbackType.THUMBS_UP:
      return 1
    case FeedbackType.THUMBS_DOWN:
      return -1
    default:
      return null
  }
}

/**
 * AI内容反馈API
 * 用户对AI生成的内容进行反馈（点赞/点踩）
 * 使用: POST /api/ai/feedback
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = feedbackSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { ai } = event.context
    const { logId, type, comment, reason, userId } = validationResult.data

    // 使用 AI Gateway 的 patchLog 方法提交反馈
    await ai.gateway('congrong-private-ai').patchLog(logId, {
      feedback: getFeedbackValue(type),
      score: getFeedbackScore(type),
      metadata: {
        user: userId || 'anonymous',
        type,
        comment,
        reason,
        timestamp: new Date().toISOString(),
        userAgent: getHeader(event, 'user-agent'),
        feedback: getFeedbackValue(type),
        score: getFeedbackScore(type),
      },
    })

    // 构建响应数据
    const responseData: FeedbackData = {
      logId,
      type,
    }

    return createSuccessResponse(responseData, '反馈提交成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '反馈提交失败',
      500,
    )
  }
})
