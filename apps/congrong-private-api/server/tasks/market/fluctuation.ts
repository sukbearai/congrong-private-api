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
  monitorPeriodMinutes?: number // 监控时间段（分钟），默认5分钟
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
          priceChangeThreshold: 3.0,
          significantChangeThreshold: 10.0,
          monitorPeriodMinutes: 60 // 监控60分钟内的价格变化
        },
        {
          symbol: 'HUSDT',
          displayName: 'H',
          priceChangeThreshold: 5.0,
          significantChangeThreshold: 30.0,
          monitorPeriodMinutes: 30 // 监控45分钟内的价格变化
        },
        // {
        //   symbol: 'ETHUSDT',
        //   displayName: 'ETH',
        //   priceChangeThreshold: 3.0,
        //   significantChangeThreshold: 10.0,
        //   monitorPeriodMinutes: 5
        // },
        // {
        //   symbol: 'SOLUSDT',
        //   displayName: 'SOL',
        //   priceChangeThreshold: 3.0,
        //   significantChangeThreshold: 10.0,
        //   monitorPeriodMinutes: 5
        // },
        // {
        //   symbol: 'BNBUSDT',
        //   displayName: 'BNB',
        //   priceChangeThreshold: 3.0,
        //   significantChangeThreshold: 10.0,
        //   monitorPeriodMinutes: 5
        // }
      ]

      const category = 'linear'
      const klineInterval = '1' // 1分钟K线
      
      // 计算需要获取的K线数量（取最大监控时间段+1）
      const maxMonitorPeriod = Math.max(...monitorConfigs.map(c => c.monitorPeriodMinutes || 5))
      const klineLimit = maxMonitorPeriod + 1

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
          const volume = parseFloat(latestKline[5]) // volume
          const turnover = parseFloat(latestKline[6]) // turnover
          const timestamp = parseInt(latestKline[0])

          // 计算监控时间段内的价格变化
          const monitorPeriod = monitorConfig.monitorPeriodMinutes || 5
          let previousPrice = currentPrice
          let changeAmount = 0
          let changeRate = 0

          // 获取监控时间段前的价格
          if (apiResponse.result.list.length > monitorPeriod) {
            const periodAgoKline = apiResponse.result.list[monitorPeriod]
            previousPrice = parseFloat(periodAgoKline[4])
          } else if (apiResponse.result.list.length > 1) {
            // 如果K线数据不足监控时间段，则使用最早的K线
            const earliestKline = apiResponse.result.list[apiResponse.result.list.length - 1]
            previousPrice = parseFloat(earliestKline[4])
          }

          // 计算变化
          changeAmount = currentPrice - previousPrice
          changeRate = previousPrice !== 0 ? (changeAmount / previousPrice) * 100 : 0

          // 计算监控时间段内的最高价和最低价
          let periodHighPrice = currentPrice
          let periodLowPrice = currentPrice
          const periodKlines = apiResponse.result.list.slice(0, Math.min(monitorPeriod, apiResponse.result.list.length))
          
          for (const kline of periodKlines) {
            const high = parseFloat(kline[2])
            const low = parseFloat(kline[3])
            periodHighPrice = Math.max(periodHighPrice, high)
            periodLowPrice = Math.min(periodLowPrice, low)
          }

          return {
            symbol: monitorConfig.symbol,
            currentPrice,
            previousPrice,
            changeAmount: parseFloat(changeAmount.toFixed(2)),
            changeRate: parseFloat(changeRate.toFixed(4)),
            changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`,
            highPrice: periodHighPrice, // 使用时间段内的最高价
            lowPrice: periodLowPrice,   // 使用时间段内的最低价
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
          console.error(`获取 ${monitorConfig.symbol} 数据失败:`, error)
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
        console.log(`所有币种价格变化均不显著，未发送通知 - ${new Date().toLocaleString('zh-CN')}`)
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
            monitorPeriod: monitorConfigs.find(c => c.symbol === r.symbol)?.monitorPeriodMinutes || 5,
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
          const monitorPeriod = config.monitorPeriodMinutes || 5
          
          message += `${alertIcon} ${config.displayName} 重大异动 ${alertIcon}\n`
          message += `${trendIcon} ${data.symbol}\n`
          message += `💰 当前价格: $${data.currentPrice.toLocaleString()}\n`
          message += `📊 ${monitorPeriod}分钟变化: ${data.changeRateFormatted}\n`
          message += `📈 ${monitorPeriod}分钟最高: $${data.highPrice.toLocaleString()}\n`
          message += `📉 ${monitorPeriod}分钟最低: $${data.lowPrice.toLocaleString()}\n`
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
          const monitorPeriod = config.monitorPeriodMinutes || 5
          
          message += `${changeIcon} ${config.displayName} (${data.symbol})\n`
          message += `💰 价格: $${data.currentPrice.toLocaleString()}\n`
          message += `📊 ${monitorPeriod}分钟变化: ${data.changeRateFormatted}\n`
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
          monitorPeriod: monitorConfigs.find(c => c.symbol === r.symbol)?.monitorPeriodMinutes || 5,
          shouldNotify: r.shouldNotify,
          isSignificantChange: r.isSignificantChange,
          error: r.error
        }))
      }

    } catch (error) {
      console.error('多币种价格监控任务失败:', error)
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