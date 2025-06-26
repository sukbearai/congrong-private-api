import type { ProcessedOpenInterestData, MultipleOpenInterestResponse } from '../../routes/exchanges/bybit/openInterest/types'

export default defineTask({
  meta: {
    name: 'ol:alarm',
    description: '未平仓合约定时消息推送',
  },
  async run() {
    try {
      // 配置要监控的币种
      const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
      
      // 调用内部API
      const response = await $fetch<{ code: number; data: MultipleOpenInterestResponse; message: string }>('/exchanges/bybit/openInterest', {
        params: {
          symbol: symbols.join(','),
        }
      })
      
      if (response.code !== 0) {
        throw new Error(`API调用失败: ${response.message}`)
      }
      
      // 构建消息
      let message = `📊 未平仓合约监控报告\n⏰ ${new Date().toLocaleString('zh-CN')}\n\n`
      
      // 处理成功的数据
      response.data.list.forEach((item: ProcessedOpenInterestData) => {
        const changeIcon = item.latest.changeRate > 0 ? '📈' : item.latest.changeRate < 0 ? '📉' : '➡️'
        
        message += `${changeIcon} ${item.symbol}\n`
        message += `   持仓: ${item.latest.openInterestFloat.toLocaleString()}\n`
        message += `   变化: ${item.latest.changeRateFormatted}\n`
        message += `   时间: ${item.latest.formattedTime}\n\n`
      })
      
      // 处理失败的数据
      if (response.data.errors && response.data.errors.length > 0) {
        message += `❌ 获取失败的交易对:\n`
        response.data.errors.forEach(error => {
          message += `   ${error.symbol}: ${error.error}\n`
        })
        message += '\n'
      }
      
      // 添加统计信息
      message += `📈 统计: ${response.data.summary.successful}/${response.data.summary.total} 成功`
      
      // 发送消息到 Telegram
      await bot.api.sendMessage('-1002663808019', message)
      
      return { 
        result: 'ok', 
        processed: response.data.summary.total,
        successful: response.data.summary.successful,
        failed: response.data.summary.failed
      }
    }
    catch (error) {
      console.error('定时任务执行失败:', error)
      
      // 发送错误消息
      try {
        await bot.api.sendMessage('-1002663808019', `❌ 未平仓合约监控任务失败\n⏰ ${new Date().toLocaleString('zh-CN')}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch (botError) {
        console.error('发送错误消息失败:', botError)
      }
      
      return { result: 'error', message: error instanceof Error ? error.message : '任务执行失败' }
    }
  },
})
