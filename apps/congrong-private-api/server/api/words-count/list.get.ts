import { and, count, desc, eq, like } from 'drizzle-orm'
import { wordsCountTable } from '~~/db/schema'

/**
 * 查询字数统计记录
 * 支持分页、按月查询、ID查询
 * GET /api/words-count/list
 * Query: id, month, page, limit
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { id, month, page = 1, limit = 20 } = query

  try {
    // ID 查询单条数据
    if (id) {
      const result = await event.context.db
        .select()
        .from(wordsCountTable)
        .where(eq(wordsCountTable.id, Number(id)))
        .get()
      return createSuccessResponse(result, '获取详情成功')
    }

    const pageNum = Number(page)
    const pageSize = Number(limit)
    const conditions = []

    if (month) {
      conditions.push(like(wordsCountTable.createTime, `${month}%`))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    // 查询总数
    const totalRes = await event.context.db
      .select({ count: count() })
      .from(wordsCountTable)
      .where(whereClause)
      .get()
    const total = totalRes?.count || 0

    // 分页查询
    const list = await event.context.db
      .select()
      .from(wordsCountTable)
      .where(whereClause)
      .orderBy(desc(wordsCountTable.createTime))
      .limit(pageSize)
      .offset((pageNum - 1) * pageSize)

    return createSuccessResponse({
      list,
      total,
      page: pageNum,
      pageSize,
    }, '字数统计记录获取成功')
  }
  catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : '获取字数统计记录失败', 500)
  }
})
