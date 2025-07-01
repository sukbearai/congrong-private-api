export default eventHandler(async () => {
  try {
    
    // 删除 webhook
    const success = await bot.api.deleteWebhook({
      drop_pending_updates: true,
    })

    // 获取 webhook 信息确认删除
    const info = await bot.api.getWebhookInfo()

    // 返回成功响应
    return createSuccessResponse(
      { success, info },
      'Telegram Bot webhook 已删除',
    )
  }
  catch (error) {
    // 返回错误响应
    return createErrorResponse(
      error instanceof Error ? error.message : 'Telegram webhook 删除失败',
      500,
    )
  }
})