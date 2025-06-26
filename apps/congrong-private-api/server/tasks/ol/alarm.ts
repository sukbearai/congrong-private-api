export default defineTask({
  meta: {
    name: 'ol:alarm',
    description: '未平仓合约定时消息推送',
  },
  async run() {
    try {
      await bot.api.sendMessage('-1002663808019', `定时消息测试 time: ${new Date().toLocaleString()}`)
      return { result: 'ok' }
    }
    catch (error) {
      return { result: 'error', message: error instanceof Error ? error.message : '机器人消息发送失败' }
    }
  },
})
