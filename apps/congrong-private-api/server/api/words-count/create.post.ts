import { wordsCountTable } from '~~/db/schema'

const wordsCountCreateSchema = z.object({
  clientWordsCount: z.number({ required_error: 'clientWordsCount不能为空' }),
  serverWordsCount: z.number().optional(),
  downloadUrl: z.string().optional(),
  createTime: z.string().optional(),
  orderId: z.string().optional(),
})

/**
 * 创建字数统计记录
 * POST /api/words-count/create
 */
export default defineEventHandler(async (event) => {
  try {
    const rawBody = await readBody(event)
    const validationResult = wordsCountCreateSchema.safeParse(rawBody)
    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }
    const { clientWordsCount, serverWordsCount, downloadUrl, createTime, orderId } = validationResult.data
    const [inserted] = await event.context.db.insert(wordsCountTable).values({
      clientWordsCount,
      serverWordsCount,
      downloadUrl,
      createTime,
      orderId,
    }).returning()
    return createSuccessResponse(inserted, '字数统计记录创建成功')
  }
  catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : '字数统计记录创建失败', 500)
  }
})
