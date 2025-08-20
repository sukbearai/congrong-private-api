const announcementDeleteSchema = z.object({
  id: z.number({ required_error: '公告ID不能为空' }),
})

/**
 * 删除公告
 * POST /api/announcement/delete
 */
export default defineEventHandler(async (event) => {
  try {
    const rawBody = await readBody(event)
    const validationResult = announcementDeleteSchema.safeParse(rawBody)
    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }
    const { id } = validationResult.data
    const existing = await event.context.db
      .select()
      .from(announcementTable)
      .where(eq(announcementTable.id, id))
      .limit(1)
    if (existing.length === 0) {
      return createErrorResponse('公告不存在', 404)
    }
    await event.context.db.delete(announcementTable).where(eq(announcementTable.id, id))
    return createSuccessResponse(null, '公告删除成功')
  } catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : '公告删除失败', 500)
  }
})
