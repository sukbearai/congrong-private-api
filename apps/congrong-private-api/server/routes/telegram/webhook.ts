export default eventHandler(async (event) => {
  // const { bot } = event.context
  const handle = webhookCallback(bot, 'http', {
    secretToken: useRuntimeConfig().telegram.authToken,
  })
  return handle(event.node.req, event.node.res)
})
