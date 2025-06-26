export default defineTask({
  meta: {
    name: 'open-interest:alarm',
    description: '未平仓合约定时消息推送',
  },
  async run() {
    await bot.api.sendMessage('-1002663808019', `定时消息测试 time: ${new Date().toLocaleString()}`)
    return { result: 'ok' }
  },
})
