export default eventHandler(async (event) => {
  // const { bot } = event.context
  await bot.api.sendMessage('-1002663808019', `消息发送测试 time: ${new Date().toLocaleString()}`)
  return 'ok'
})
