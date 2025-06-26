export default eventHandler(async (event) => {
  const { telegram } = useRuntimeConfig()
  // const { bot } = event.context

  try {
    // 获取主机信息
    let host = getRequestHeader(event, 'x-forwarded-host') || getRequestHost(event)
    host = host.toLowerCase().includes('localhost') ? telegram.tunnelUrl : host
    const webhookUrl = `https://${host}/telegram/webhook`

    // 设置 webhook
    const success = await bot.api.setWebhook(webhookUrl, {
      drop_pending_updates: true,
      secret_token: telegram.authToken,
    })

    // 获取 webhook 信息
    const info = await bot.api.getWebhookInfo()

    // 返回成功响应
    return createSuccessResponse(
      { success, info },
      'Telegram Bot webhook 设置成功',
    )
  }
  catch (error) {
    // 返回错误响应
    return createErrorResponse(
      error instanceof Error ? error.message : 'Telegram webhook 设置失败',
      500,
    )
  }
})
