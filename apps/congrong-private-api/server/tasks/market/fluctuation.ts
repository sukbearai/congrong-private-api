// K线数据相关类型
interface KlineItem {
  startTime: string
  openPrice: string
  highPrice: string
  lowPrice: string
  closePrice: string
  volume: string
  turnover: string
}

interface KlineApiResponse {
  retCode: number
  retMsg: string
  result: {
    category: string
    symbol: string
    list: string[][]
  }
}

interface CryptoPriceData {
  symbol: string
  currentPrice: number
  previousPrice: number
  changeAmount: number
  changeRate: number
  changeRateFormatted: string
  highPrice: number
  lowPrice: number
  volume: number
  turnover: number
  formattedTime: string
  timestamp: number
}

interface MonitorConfig {
  symbol: string
  displayName: string
  priceChangeThreshold: number
  significantChangeThreshold: number
}

interface MonitorResult {
  symbol: string
  data: CryptoPriceData
  shouldNotify: boolean
  isSignificantChange: boolean
  error?: string
}

export default defineTask({
  meta: {
    name: 'market:fluctuation',
    description: '多币种价格波动监控 - BTC/ETH/SOL等主流币种',
  },
  async run() {
    try {
      // 多币种监控配置
      const monitorConfigs: MonitorConfig[] = [
        {
          symbol: 'BTCUSDT',
          displayName: 'BTC',
          priceChangeThreshold: 3.0, // 3%
          significantChangeThreshold: 10.0, // 10.0%
        },
        {
          symbol: 'HUSDT',
          displayName: 'H',
          priceChangeThreshold: 5.0, // 5%
          significantChangeThreshold: 30.0, // 10.0%
        },
        // {
        //   symbol: 'ETHUSDT',
        //   displayName: 'ETH',
        //   priceChangeThreshold: 3.0, // 3%
        //   significantChangeThreshold: 10.0, // 10.0%
        //   altcoinsCategory: 'ETH生态山寨币'
        // },
        // {
        //   symbol: 'SOLUSDT',
        //   displayName: 'SOL',
        //   priceChangeThreshold: 3.0, // 3%
        //   significantChangeThreshold: 10.0, // 10.0%
        //   altcoinsCategory: 'SOL生态山寨币'
        // },
        // {
        //   symbol: 'BNBUSDT',
        //   displayName: 'BNB',
        //   priceChangeThreshold: 3.0, // 3%
        //   significantChangeThreshold: 10.0, // 10.0%
        //   altcoinsCategory: 'BSC生态山寨币'
        // }
      ]

      const category = 'linear'
      const klineInterval = '1' // 1分钟K线
      const klineLimit = 2 // 获取2条K线数据用于计算变化

      // 获取配置信息
      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl

      // 创建请求队列
      const requestQueue = new RequestQueue({
        maxRandomDelay: 1000,
        minDelay: 500
      })

      // 获取单个币种K线数据的函数
      const fetchCryptoKlineData = async (monitorConfig: MonitorConfig): Promise<CryptoPriceData> => {
        return await requestQueue.add(async () => {
          // 构建查询参数
          const params = new URLSearchParams({
            category,
            symbol: monitorConfig.symbol,
            interval: klineInterval,
            limit: klineLimit.toString(),
          })

          // 构建请求URL
          const url = `${bybitApiUrl}/v5/market/kline?${params.toString()}`

          // 发送请求到Bybit API
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          })

          // 检查HTTP响应状态
          if (!response.ok) {
            throw new Error(`HTTP 错误: ${response.status}`)
          }

          // 解析响应数据
          const apiResponse = await response.json() as KlineApiResponse

          // 检查API响应状态
          if (apiResponse.retCode !== 0) {
            throw new Error(`Bybit API 错误: ${apiResponse.retMsg}`)
          }

          // 处理K线数据
          if (!apiResponse.result.list || apiResponse.result.list.length === 0) {
            throw new Error('没有可用的K线数据')
          }

          // 获取最新K线数据
          const latestKline = apiResponse.result.list[0]
          const currentPrice = parseFloat(latestKline[4]) // closePrice
          const highPrice = parseFloat(latestKline[2]) // highPrice
          const lowPrice = parseFloat(latestKline[3]) // lowPrice
          const volume = parseFloat(latestKline[5]) // volume
          const turnover = parseFloat(latestKline[6]) // turnover
          const timestamp = parseInt(latestKline[0])

          let previousPrice = currentPrice
          let changeAmount = 0
          let changeRate = 0

          // 如果有前一根K线，计算变化率
          if (apiResponse.result.list.length > 1) {
            const previousKline = apiResponse.result.list[1]
            previousPrice = parseFloat(previousKline[4])
            changeAmount = currentPrice - previousPrice
            changeRate = previousPrice !== 0 ? (changeAmount / previousPrice) * 100 : 0
          }

          return {
            symbol: monitorConfig.symbol,
            currentPrice,
            previousPrice,
            changeAmount: parseFloat(changeAmount.toFixed(2)),
            changeRate: parseFloat(changeRate.toFixed(4)),
            changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`,
            highPrice,
            lowPrice,
            volume,
            turnover,
            timestamp,
            formattedTime: new Date(timestamp).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })
          }
        })
      }

      // 获取所有币种的数据 - 串行执行避免API限制
      const monitorResults: MonitorResult[] = []
      
      for (const monitorConfig of monitorConfigs) {
        try {
          const data = await fetchCryptoKlineData(monitorConfig)
          const shouldNotify = Math.abs(data.changeRate) > monitorConfig.priceChangeThreshold
          const isSignificantChange = Math.abs(data.changeRate) > monitorConfig.significantChangeThreshold

          monitorResults.push({
            symbol: monitorConfig.symbol,
            data,
            shouldNotify,
            isSignificantChange
          })
        } catch (error) {
          monitorResults.push({
            symbol: monitorConfig.symbol,
            data: {} as CryptoPriceData,
            shouldNotify: false,
            isSignificantChange: false,
            error: error instanceof Error ? error.message : '获取数据失败'
          })
        }
      }

      // 筛选需要通知的币种
      const notifyResults = monitorResults.filter(result => result.shouldNotify && !result.error)
      const significantResults = notifyResults.filter(result => result.isSignificantChange)

      // 如果没有需要通知的变化
      if (notifyResults.length === 0) {
        return {
          result: 'ok',
          monitored: monitorConfigs.length,
          successful: monitorResults.filter(r => !r.error).length,
          failed: monitorResults.filter(r => r.error).length,
          message: '所有币种价格变化均不显著，未发送通知',
          details: monitorResults.map(r => ({
            symbol: r.symbol,
            currentPrice: r.data.currentPrice || 0,
            changeRate: r.data.changeRate || 0,
            error: r.error
          }))
        }
      }

      // 构建消息
      let message = `📊 多币种价格波动监控\n⏰ ${new Date().toLocaleString('zh-CN')}\n\n`

      // 重大异动警报 - 优先显示
      if (significantResults.length > 0) {
        message += `🚨 重大异动警报 🚨\n\n`
        
        for (const result of significantResults) {
          const config = monitorConfigs.find(c => c.symbol === result.symbol)!
          const data = result.data
          const alertIcon = data.changeRate > 0 ? '🚀🚀🚀' : '💥💥💥'
          const trendIcon = data.changeRate > 0 ? '📈' : '📉'
          // const suggestion = data.changeRate > 0 
          //   ? `🔥 ${config.displayName}强势突破，考虑做多${config.altcoinsCategory}！` 
          //   : `⚠️ ${config.displayName}急速下跌，考虑做空${config.altcoinsCategory}！`
          
          message += `${alertIcon} ${config.displayName} 重大异动 ${alertIcon}\n`
          message += `${trendIcon} ${data.symbol}\n`
          message += `💰 当前价格: $${data.currentPrice.toLocaleString()}\n`
          message += `📊 变化幅度: ${data.changeRateFormatted}\n`
          message += `📈 最高价: $${data.highPrice.toLocaleString()}\n`
          message += `📉 最低价: $${data.lowPrice.toLocaleString()}\n`
          // message += `💹 成交量: ${data.volume.toLocaleString()}\n`
          // message += `💵 成交额: $${(data.turnover / 1000000).toFixed(2)}M\n`
          // message += `🎯 建议: ${suggestion}\n`
          message += `⏰ 时间: ${data.formattedTime}\n\n`
        }
      }

      // 一般变化通知
      const normalResults = notifyResults.filter(result => !result.isSignificantChange)
      if (normalResults.length > 0) {
        for (const result of normalResults) {
          const config = monitorConfigs.find(c => c.symbol === result.symbol)!
          const data = result.data
          const changeIcon = data.changeRate > 0 ? '📈' : '📉'
          // const actionHint = data.changeRate > 0 ? '关注做多机会' : '关注做空机会'
          
          message += `${changeIcon} ${config.displayName} (${data.symbol})\n`
          message += `💰 价格: $${data.currentPrice.toLocaleString()}\n`
          message += `📊 变化: ${data.changeRateFormatted}\n`
          // message += `💹 成交量: ${data.volume.toLocaleString()}\n`
          // message += `🎯 ${actionHint}${config.altcoinsCategory}\n`
          message += `⏰ ${data.formattedTime}\n\n`
        }
      }

      // 添加失败信息（如果有）
      const failedResults = monitorResults.filter(r => r.error)
      if (failedResults.length > 0) {
        message += `⚠️ 获取失败的币种:\n`
        failedResults.forEach(result => {
          message += `❌ ${result.symbol}: ${result.error}\n`
        })
        message += `\n`
      }

      // 发送消息到 Telegram
      await bot.api.sendMessage('-1002663808019', message)

      return {
        result: 'ok',
        monitored: monitorConfigs.length,
        successful: monitorResults.filter(r => !r.error).length,
        failed: monitorResults.filter(r => r.error).length,
        notified: notifyResults.length,
        significantChanges: significantResults.length,
        normalChanges: normalResults.length,
        details: monitorResults.map(r => ({
          symbol: r.symbol,
          currentPrice: r.data.currentPrice || 0,
          changeRate: r.data.changeRate || 0,
          changeAmount: r.data.changeAmount || 0,
          volume: r.data.volume || 0,
          turnover: r.data.turnover || 0,
          shouldNotify: r.shouldNotify,
          isSignificantChange: r.isSignificantChange,
          error: r.error
        }))
      }

    } catch (error) {
      try {
        await bot.api.sendMessage('-1002663808019', `❌ 多币种价格监控任务失败\n⏰ ${new Date().toLocaleString('zh-CN')}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch (botError) {
        console.error('发送错误消息失败:', botError)
      }

      return { 
        result: 'error',
        error: error instanceof Error ? error.message : '未知错误'
      }
    }
  },
})