const announcementCreateSchema = z.object({
  userId: z.number({ required_error: '用户ID不能为空' }),
  title: z.string({ required_error: '标题不能为空' }),
  content: z.string({ required_error: '内容不能为空' }),
  wechatUrl: z.string({ required_error: '微信链接不能为空' }),
})

/**
 * 创建公告
 * POST /api/announcement/create
 */
export default defineEventHandler(async (event) => {
  try {
    const rawBody = await readBody(event)
    const validationResult = announcementCreateSchema.safeParse(rawBody)
    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }
    const { userId, title, content, wechatUrl } = validationResult.data
    const [inserted] = await event.context.db.insert(announcementTable).values({
      userId,
      title,
      content,
      wechatUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).returning()
    return createSuccessResponse(inserted, '公告创建成功')
  }
  catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : '公告创建失败', 500)
  }
})
