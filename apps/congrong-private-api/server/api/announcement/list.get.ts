const announcementListSchema = z.object({
  page: z.string().optional().transform(val => val ? Number.parseInt(val, 10) : 1),
  pageSize: z.string().optional().transform(val => val ? Number.parseInt(val, 10) : 10),
})

/**
 * 公告列表分页查询
 * GET /api/announcement/list?page=1&pageSize=10
 */
export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const validationResult = announcementListSchema.safeParse(query)
    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }
    const { page, pageSize } = validationResult.data
    if (page < 1) return createErrorResponse('页码必须大于0', 400)
    if (pageSize < 1 || pageSize > 100) return createErrorResponse('每页数量必须在1-100之间', 400)
    const offset = (page - 1) * pageSize
    const totalCountResult = await event.context.db
      .select({ count: sql<number>`count(*)` })
      .from(announcementTable)
    const total = totalCountResult[0]?.count || 0
    const list = await event.context.db
      .select()
      .from(announcementTable)
      .orderBy(desc(announcementTable.createdAt))
      .limit(pageSize)
      .offset(offset)
    const pagination = {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    }
    return createSuccessResponse({ list, pagination }, '公告列表获取成功')
  } catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : '获取公告列表失败', 500)
  }
})
