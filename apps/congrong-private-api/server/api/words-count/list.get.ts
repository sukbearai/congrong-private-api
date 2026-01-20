import { wordsCountTable } from '~~/db/schema'

/**
 * 查询所有字数统计记录
 * GET /api/words-count/list
 */
export default defineEventHandler(async (event) => {
  try {
    const list = await event.context.db
      .select()
      .from(wordsCountTable)
    return createSuccessResponse(list, '字数统计记录获取成功')
  }
  catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : '获取字数统计记录失败', 500)
  }
})
