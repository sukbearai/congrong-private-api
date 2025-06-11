// 删除用户请求验证模式
const deleteUserSchema = z.object({
  id: z.number({
    required_error: '用户ID不能为空',
  }),
})

/**
 * 删除用户API
 * 删除指定ID的用户账户
 * 使用: POST /api/user/delete
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = deleteUserSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { id } = validationResult.data

    // 检查用户是否存在
    const existingUsers = await event.context.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1)

    if (existingUsers.length === 0) {
      return createErrorResponse('用户不存在', 404)
    }

    // 删除用户
    await event.context.db
      .delete(usersTable)
      .where(eq(usersTable.id, id))

    return createSuccessResponse({ id }, '用户删除成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '删除用户失败',
      500,
    )
  }
})
