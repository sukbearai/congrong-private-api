export default eventHandler(async () => {
  const { telegram } = useRuntimeConfig()

  try {
    const response = await fetch(`https://api.telegram.org/bot${telegram.botToken}/getMe`)

    if (!response.ok) {
      return createErrorResponse(`HTTP 错误: ${response.status}`, response.status)
    }

    const data: { ok: boolean, description: string, result: { id: number, is_bot: boolean, first_name: string, username: string } } = await response.json()

    // 检查API是否返回错误
    if ('ok' in data && !data.ok) {
      return createErrorResponse(`Telegram API 错误: ${data.description || '未知错误'}`, 500)
    }

    return createSuccessResponse(data.result, 'Telegram Bot 信息获取成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Error fetching Telegram API',
      500,
    )
  }
})
