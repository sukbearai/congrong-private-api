const announcementUpdateSchema = z.object({
  id: z.number({ required_error: '公告ID不能为空' }),
  title: z.string({ required_error: '标题不能为空' }),
  content: z.string({ required_error: '内容不能为空' }),
  wechatUrl: z.string({ required_error: '微信链接不能为空' }),
})

/**
 * 更新公告
 * POST /api/announcement/update
 */
export default defineEventHandler(async (event) => {
  try {
    const rawBody = await readBody(event)
    const validationResult = announcementUpdateSchema.safeParse(rawBody)
    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }
    const { id, title, content, wechatUrl } = validationResult.data
    const [updated] = await event.context.db.update(announcementTable)
      .set({ title, content, wechatUrl, updatedAt: Date.now() })
      .where(eq(announcementTable.id, id))
      .returning()
    if (!updated) { return createErrorResponse('公告不存在', 404) }
    return createSuccessResponse(updated, '公告更新成功')
  }
  catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : '公告更新失败', 500)
  }
})
