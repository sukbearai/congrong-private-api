// 编辑用户请求验证模式
const updateUserSchema = z.object({
  id: z.number({
    required_error: '用户ID不能为空',
  }),
  nickname: z.string().min(1, '昵称不能为空').max(50, '昵称不超过50个字符').optional(),
  phone: z.string().min(11).max(11).regex(/^1[3-9]\d{9}$/, '请输入有效的手机号').optional(),
  password: z.string().min(6, '密码至少6位').max(50, '密码不超过50位').optional(),
  role: z.string().optional(),
  deviceIds: z.string().optional(),
  aiEnabled: z.number().optional(),
})

/**
 * 编辑用户API
 * 更新用户账户信息
 * 使用: POST /api/user/update
 */
export default defineEventHandler(async (event) => {
  try {
    // 读取并验证请求体数据
    const rawBody = await readBody(event)
    const validationResult = updateUserSchema.safeParse(rawBody)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { id, ...updateData } = validationResult.data

    // 检查用户是否存在
    const existingUsers = await event.context.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1)

    if (existingUsers.length === 0) {
      return createErrorResponse('用户不存在', 404)
    }

    // 如果更新手机号，检查是否与其他用户冲突
    if (updateData.phone) {
      const phoneUsers = await event.context.db
        .select()
        .from(usersTable)
        .where(eq(usersTable.phone, updateData.phone))
        .limit(1)

      if (phoneUsers.length > 0 && phoneUsers[0].id !== id) {
        return createErrorResponse('该手机号已被其他用户注册', 409)
      }
    }

    // 更新用户信息
    const updatedUser = await event.context.db
      .update(usersTable)
      .set(updateData)
      .where(eq(usersTable.id, id))
      .returning()

    // 返回更新后的用户信息（不包含密码）
    const userInfo = {
      ...updatedUser[0],
      deviceIds: updatedUser[0].deviceIds || '',
      password: undefined, // 不返回密码
    }

    return createSuccessResponse(userInfo, '用户信息更新成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '更新用户失败',
      500,
    )
  }
})
