import { BybitApiResponse, InstrumentError, InstrumentInfoItem, KlineApiResponse, KlineData, VWAPCalculation, VWAPData } from "./types"

// 定义 JSON 存储 API 写入响应的类型
interface JsonStorageWriteResponse {
  code: number
  message: string
  data?: {
    key: string
    size: number
    timestamp: string
  }
}

// 定义Telegram发送结果类型
interface TelegramSendResult {
  success: boolean
  messageId?: number
  error?: string
}

// 创建全局请求队列实例
const requestQueue = new RequestQueue({
  maxRandomDelay: 3000, // 最大随机延迟3秒
  minDelay: 1000        // 最小延迟1秒
})

// 格式化成交额显示
const formatTurnover = (turnover: number): string => {
  if (turnover >= 1000000000) {
    return `${(turnover / 1000000000).toFixed(2)}B`
  } else if (turnover >= 1000000) {
    return `${(turnover / 1000000).toFixed(2)}M`
  } else if (turnover >= 1000) {
    return `${(turnover / 1000).toFixed(2)}K`
  }
  return turnover.toFixed(2)
}

// 发送消息到Telegram频道的函数 - 使用bot实例
const sendToTelegram = async (message: string, channelId?: string): Promise<TelegramSendResult> => {
  try {
    // 使用默认频道ID或传入的频道ID
    const targetChannelId = channelId || '-1002663808019' // 使用你的频道ID作为默认值

    const result = await bot.api.sendMessage(targetChannelId, message, {
      parse_mode: 'Markdown',
    })

    return {
      success: true,
      messageId: result.message_id
    }

  } catch (error) {
    console.error('发送Telegram消息失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '发送失败'
    }
  }
}

// 格式化VWAP分析结果为Telegram消息
const formatVWAPResultForTelegram = (data: any): string => {
  const { symbol, costPriceAnalysis, turnover7DaysAnalysis, vwap } = data

  // 获取基础信息
  const costPrice = costPriceAnalysis?.averageCostPrice || vwap?.finalVWAP || 0
  const currentPrice = costPriceAnalysis?.currentPrice || vwap?.currentPrice || 0
  const deviation = costPriceAnalysis?.priceDeviation || vwap?.currentDeviation || 0
  const status = costPriceAnalysis?.marketStatus || 'unknown'

  // 状态emoji和文本
  const statusEmoji = status === 'above_cost' ? '🚀' : status === 'below_cost' ? '🔻' : '⚖️'
  const statusText = status === 'above_cost' ? '高于成本价' : status === 'below_cost' ? '低于成本价' : '接近成本价'

  // 7天成交额信息
  const turnover7Days = turnover7DaysAnalysis
  const changePercent = turnover7Days?.comparison?.changePercent || 0
  const trendEmoji = turnover7Days?.last7Days?.trend === 'increasing' ? '📈' :
    turnover7Days?.last7Days?.trend === 'decreasing' ? '📉' : '➡️'

  // 构建消息
  let message = `💎 *${symbol} VWAP成本价分析*\n\n`

  // 基础价格信息
  message += `💰 *平均成本价*: \`${costPrice.toFixed(8)} USDT\`\n`
  message += `🔹 *当前价格*: \`${currentPrice.toFixed(8)} USDT\`\n`
  message += `📊 *价格偏离*: \`${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)}%\` ${statusEmoji} ${statusText}\n\n`

  // 价格区间
  if (vwap?.highestPrice && vwap?.lowestPrice) {
    message += `📈 *最高价*: \`${vwap.highestPrice.toFixed(8)} USDT\`\n`
    message += `📉 *最低价*: \`${vwap.lowestPrice.toFixed(8)} USDT\`\n\n`
  }

  // 交易数据
  if (vwap) {
    // message += `📊 *总成交量*: \`${vwap.totalVolume.toLocaleString()}\` ${symbol.replace('USDT', '')}\n`
    message += `💵 *总成交额*: \`${vwap.totalTurnover.toLocaleString()}\` USDT\n\n`
  }

  // 7天成交额分析
  if (turnover7Days) {
    const intervalType = turnover7Days.last7Days.intervalType
    message += `📈 *历史成交额 7d* (${intervalType}间隔)\n`
    message += `💰 总成交额: \`${turnover7Days.last7Days.totalTurnover.toLocaleString()}\` USDT\n`
    message += `📊 平均${intervalType}成交额: \`${turnover7Days.last7Days.averageIntervalTurnover.toLocaleString()}\` USDT\n`
    // message += `🔄 环比变化: \`${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%\` ${trendEmoji}\n`
    message += `📈 波动率: \`${turnover7Days.last7Days.volatility.toFixed(2)}%\`\n`
    message += `📝 趋势分析: ${turnover7Days.comparison.trendAnalysis}\n\n`

    // 每个时间间隔的成交额明细
    message += `📅 *${intervalType}成交额明细*\n`
    turnover7Days.last7Days.intervalTurnover.forEach((interval, index) => {
      // 根据变化方向选择emoji
      let statusEmoji = '📊' // 默认或第一个间隔
      if (index > 0 && interval.changeFromPrevious !== undefined) {
        if (interval.changeFromPrevious > 0) {
          statusEmoji = '🟢' // 上涨
        } else if (interval.changeFromPrevious < 0) {
          statusEmoji = '🔴' // 下跌
        } else {
          statusEmoji = '🟡' // 持平
        }
      }

      // 如果是当前进行的时间段，使用特殊emoji
      if (interval.isCurrentInterval) {
        statusEmoji = '⏰' // 当前进行中
      }

      // 变化文本 - 包含变化百分比
      let changeText = ''
      if (interval.changePercentFromPrevious !== undefined && index > 0) {
        const sign = interval.changePercentFromPrevious >= 0 ? '+' : ''
        const changePercent = interval.changePercentFromPrevious.toFixed(1)

        // 根据变化幅度选择更详细的emoji
        // let changeEmoji = ''
        // if (interval.changePercentFromPrevious > 10) {
        //   changeEmoji = '🚀' // 大幅上涨
        // } else if (interval.changePercentFromPrevious > 0) {
        //   changeEmoji = '📈' // 小幅上涨
        // } else if (interval.changePercentFromPrevious < -10) {
        //   changeEmoji = '💥' // 大幅下跌
        // } else if (interval.changePercentFromPrevious < 0) {
        //   changeEmoji = '📉' // 小幅下跌
        // } else {
        //   changeEmoji = '➡️' // 持平
        // }

        changeText = ` (${sign}${changePercent}%)`
      }

      message += `${statusEmoji} \`${interval.timeLabel}\`: \`${interval.formattedTurnover} USDT\`${changeText}\n`
    })

    message += '\n'
  }

  // 投资建议
  if (deviation > 5) {
    message += `🚀 *建议*: 当前价格明显高于成本价，可能存在获利机会\n`
  } else if (deviation < -5) {
    message += `🔻 *建议*: 当前价格明显低于成本价，可能存在抄底机会\n`
  } else {
    message += `⚖️ *建议*: 当前价格接近成本价，市场相对平衡\n`
  }

  return message
}

// 格式化多交易对结果为Telegram消息
const formatMultipleResultsForTelegram = (results: any[], summary: any): string => {
  let message = `🌟 *多交易对VWAP成本价汇总*\n\n`

  results.forEach((item, index) => {
    const costPrice = item.costPriceAnalysis?.averageCostPrice || item.vwap?.finalVWAP || 0
    const currentPrice = item.costPriceAnalysis?.currentPrice || item.vwap?.currentPrice || 0
    const deviation = item.costPriceAnalysis?.priceDeviation || item.vwap?.currentDeviation || 0
    const status = item.costPriceAnalysis?.marketStatus || 'unknown'

    const statusEmoji = status === 'above_cost' ? '🚀' : status === 'below_cost' ? '🔻' : '⚖️'
    const statusText = status === 'above_cost' ? '高于成本' : status === 'below_cost' ? '低于成本' : '接近成本'

    message += `*${index + 1}\\. ${item.symbol}*\n`
    message += `💰 成本价: \`${costPrice.toFixed(8)}\` USDT\n`
    message += `🔹 当前价: \`${currentPrice.toFixed(8)}\` USDT\n`
    message += `📊 偏离度: \`${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)}%\` ${statusEmoji} ${statusText}\n\n`
  })

  message += `📊 *汇总信息*\n`
  message += `✅ 成功: ${summary.successful}/${summary.total}\n`
  if (summary.failed > 0) {
    message += `❌ 失败: ${summary.failed}\n`
  }

  message += `\n⏰ 分析时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`

  return message
}

// 添加7天成交额统计的函数 - 支持不同时间间隔
const calculate7DaysTurnoverAnalysis = (klineData: KlineData[], intervalHours: number = 24): {
  last7Days: {
    totalTurnover: number
    intervalTurnover: {
      startTime: number;
      endTime: number;
      date: string;
      turnover: number;
      formattedTurnover: string;
      timeLabel: string;
      changeFromPrevious?: number;
      changePercentFromPrevious?: number;
      changeDirection?: 'up' | 'down' | 'same';
      isCurrentInterval?: boolean; // 标记是否为当前正在进行的时间段
    }[]
    averageIntervalTurnover: number
    highestIntervalTurnover: number
    lowestIntervalTurnover: number
    trend: 'increasing' | 'decreasing' | 'stable'
    changePercent: number
    volatility: number
    intervalType: string
  }
  comparison: {
    previous7Days: {
      totalTurnover: number
      averageIntervalTurnover: number
    }
    changeAmount: number
    changePercent: number
    trendAnalysis: string
  }
} => {
  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000
  const intervalMs = intervalHours * 60 * 60 * 1000
  const sevenDaysMs = 7 * oneDayMs

  // 最近7天的时间范围：从现在向前推7天
  const last7DaysStart = now - sevenDaysMs
  const last7DaysData = klineData.filter(k => k.startTime >= last7DaysStart && k.startTime <= now)

  // 前7天的时间范围（用于比较）：从14天前到7天前
  const previous7DaysStart = now - (2 * sevenDaysMs)
  const previous7DaysEnd = last7DaysStart
  const previous7DaysData = klineData.filter(k =>
    k.startTime >= previous7DaysStart && k.startTime < previous7DaysEnd
  )

  console.log(`当前时间: ${formatDateTime(now)}`)
  console.log(`最近7天范围: ${formatDateTime(last7DaysStart)} 到 ${formatDateTime(now)}`)
  console.log(`K线数据范围: ${last7DaysData.length} 条数据`)

  // 生成时间标签的函数
  const getTimeLabel = (startTime: number, endTime: number, intervalHours: number, isCurrentInterval: boolean = false): string => {
    const startDate = new Date(startTime)
    let endDate: Date

    if (isCurrentInterval) {
      // 对于当前进行中的时间段，显示该时间段的理论结束时间而不是当前时间
      const theoreticalEndTime = startTime + (intervalHours * 60 * 60 * 1000)
      endDate = new Date(theoreticalEndTime)
    } else {
      endDate = new Date(endTime)
    }

    if (intervalHours === 24) {
      // 24小时间隔：只显示月/日
      const monthDay = `${startDate.getMonth() + 1}/${startDate.getDate()}`
      return isCurrentInterval ? `${monthDay}*` : monthDay
    } else if (intervalHours === 4) {
      // 4小时间隔：显示日期和时间段
      const monthDay = `${startDate.getMonth() + 1}/${startDate.getDate()}`
      const startHour = startDate.getHours().toString().padStart(2, '0')
      const endHour = endDate.getHours().toString().padStart(2, '0')
      const timeRange = `${monthDay} ${startHour}:00-${endHour}:00`
      return isCurrentInterval ? `${timeRange}*` : timeRange
    } else {
      // 其他间隔：显示完整时间
      const formatTime = (date: Date) => {
        const month = (date.getMonth() + 1).toString().padStart(2, '0')
        const day = date.getDate().toString().padStart(2, '0')
        const hour = date.getHours().toString().padStart(2, '0')
        const minute = date.getMinutes().toString().padStart(2, '0')
        return `${month}/${day} ${hour}:${minute}`
      }
      const timeRange = `${formatTime(startDate)}-${formatTime(endDate)}`
      return isCurrentInterval ? `${timeRange}*` : timeRange
    }
  }

  // 计算对齐到间隔边界的时间函数
  const alignToIntervalBoundary = (timestamp: number, intervalMs: number): number => {
    // 计算从UTC 00:00:00开始的时间偏移
    const utcMidnight = Math.floor(timestamp / oneDayMs) * oneDayMs
    const timeFromMidnight = timestamp - utcMidnight

    // 计算当前时间属于哪个间隔（从0开始）
    const intervalIndex = Math.floor(timeFromMidnight / intervalMs)

    // 返回该间隔的开始时间
    return utcMidnight + (intervalIndex * intervalMs)
  }

  // 生成时间间隔数组
  const intervals: Array<{ startTime: number, endTime: number, isCurrentInterval: boolean }> = []

  // 找到最近7天范围内的所有间隔
  // 从7天前开始，到现在为止
  let currentIntervalStart = alignToIntervalBoundary(last7DaysStart, intervalMs)

  // 如果对齐后的时间早于7天前，则向前移动一个间隔
  if (currentIntervalStart < last7DaysStart) {
    currentIntervalStart += intervalMs
  }

  // 计算当前时间所在的间隔起始时间
  const nowIntervalStart = alignToIntervalBoundary(now, intervalMs)

  while (currentIntervalStart <= now) {
    let intervalEnd: number
    let isCurrentInterval = false

    if (currentIntervalStart === nowIntervalStart) {
      // 这是当前正在进行的时间段，结束时间就是当前时间
      intervalEnd = now
      isCurrentInterval = true
    } else {
      // 这是已完成的时间段，结束时间是下一个间隔的开始时间
      intervalEnd = Math.min(currentIntervalStart + intervalMs, now)
    }

    // 只包含有意义的间隔（至少有部分时间在7天范围内）
    if (intervalEnd > last7DaysStart && currentIntervalStart < now) {
      intervals.push({
        startTime: Math.max(currentIntervalStart, last7DaysStart),
        endTime: intervalEnd,
        isCurrentInterval
      })
    }

    // 如果这是当前时间段，就停止循环
    if (isCurrentInterval) {
      break
    }

    currentIntervalStart += intervalMs
  }

  // 计算每个时间间隔的成交额
  const intervalTurnover: {
    startTime: number;
    endTime: number;
    date: string;
    turnover: number;
    formattedTurnover: string;
    timeLabel: string;
    changeFromPrevious?: number;
    changePercentFromPrevious?: number;
    changeDirection?: 'up' | 'down' | 'same';
    isCurrentInterval?: boolean;
  }[] = []

  let previousIntervalTurnover: number | null = null

  intervals.forEach((interval, index) => {
    // 计算该间隔内的成交额 - 使用 <= 确保包含边界数据
    const intervalData = last7DaysData.filter(k =>
      k.startTime >= interval.startTime && k.startTime < interval.endTime
    )
    const turnover = intervalData.reduce((sum, k) => sum + k.turnover, 0)

    const date = new Date(interval.startTime).toISOString().split('T')[0]
    const timeLabel = getTimeLabel(interval.startTime, interval.endTime, intervalHours, interval.isCurrentInterval)

    const status = interval.isCurrentInterval ? '(进行中)' : ''
    // console.log(`${timeLabel} ${status}: ${intervalData.length} 条数据, 成交额 ${formatTurnover(turnover)}`)

    // 计算与前一个间隔的变化
    let changeFromPrevious: number | undefined
    let changePercentFromPrevious: number | undefined
    let changeDirection: 'up' | 'down' | 'same' | undefined

    if (previousIntervalTurnover !== null) {
      changeFromPrevious = turnover - previousIntervalTurnover
      changePercentFromPrevious = previousIntervalTurnover > 0 ?
        (changeFromPrevious / previousIntervalTurnover * 100) : 0

      if (changeFromPrevious > 0) {
        changeDirection = 'up'
      } else if (changeFromPrevious < 0) {
        changeDirection = 'down'
      } else {
        changeDirection = 'same'
      }
    }

    intervalTurnover.push({
      startTime: interval.startTime,
      endTime: interval.endTime,
      date,
      turnover,
      formattedTurnover: formatTurnover(turnover),
      timeLabel,
      changeFromPrevious,
      changePercentFromPrevious,
      changeDirection,
      isCurrentInterval: interval.isCurrentInterval
    })

    previousIntervalTurnover = turnover
  })

  // 计算最近7天统计
  const last7DaysTotalTurnover = last7DaysData.reduce((sum, k) => sum + k.turnover, 0)
  const averageIntervalTurnover = intervals.length > 0 ? last7DaysTotalTurnover / intervals.length : 0
  const turnoverValues = intervalTurnover.map(d => d.turnover)
  const highestIntervalTurnover = turnoverValues.length > 0 ? Math.max(...turnoverValues) : 0
  const lowestIntervalTurnover = turnoverValues.length > 0 ? Math.min(...turnoverValues) : 0

  // 计算波动率（标准差）
  const mean = averageIntervalTurnover
  const variance = turnoverValues.length > 0 ?
    turnoverValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / turnoverValues.length : 0
  const volatility = mean > 0 ? Math.sqrt(variance) / mean * 100 : 0 // 变异系数

  // 计算趋势（比较前1/3和后1/3的平均值）
  const firstThirdCount = Math.floor(turnoverValues.length / 3)
  const lastThirdCount = Math.floor(turnoverValues.length / 3)

  let trend: 'increasing' | 'decreasing' | 'stable' = 'stable'
  let trendChangePercent = 0

  if (firstThirdCount > 0 && lastThirdCount > 0) {
    const firstThirdAvg = turnoverValues.slice(0, firstThirdCount).reduce((a, b) => a + b, 0) / firstThirdCount
    const lastThirdAvg = turnoverValues.slice(-lastThirdCount).reduce((a, b) => a + b, 0) / lastThirdCount
    trendChangePercent = firstThirdAvg > 0 ? ((lastThirdAvg - firstThirdAvg) / firstThirdAvg * 100) : 0

    if (trendChangePercent > 10) {
      trend = 'increasing'
    } else if (trendChangePercent < -10) {
      trend = 'decreasing'
    } else {
      trend = 'stable'
    }
  }

  // 计算前7天统计用于比较
  const previous7DaysTotalTurnover = previous7DaysData.reduce((sum, k) => sum + k.turnover, 0)
  const previousAverageIntervalTurnover = intervals.length > 0 ? previous7DaysTotalTurnover / intervals.length : 0

  // 计算环比变化
  const changeAmount = last7DaysTotalTurnover - previous7DaysTotalTurnover
  const changePercent = previous7DaysTotalTurnover > 0 ?
    (changeAmount / previous7DaysTotalTurnover * 100) : 0

  // 趋势分析文本
  let trendAnalysis = ''
  if (changePercent > 20) {
    trendAnalysis = '成交额显著增长，市场活跃度大幅提升'
  } else if (changePercent > 5) {
    trendAnalysis = '成交额稳步增长，市场热度上升'
  } else if (changePercent > -5) {
    trendAnalysis = '成交额基本持平，市场相对稳定'
  } else if (changePercent > -20) {
    trendAnalysis = '成交额有所下降，市场活跃度减弱'
  } else {
    trendAnalysis = '成交额显著下降，市场趋于冷清'
  }

  // 生成间隔类型描述
  const intervalType = intervalHours === 24 ? '24小时' :
    intervalHours === 4 ? '4小时' :
      `${intervalHours}小时`

  console.log(`统计结果：最近7天总成交额 ${formatTurnover(last7DaysTotalTurnover)}, 平均间隔成交额 ${formatTurnover(averageIntervalTurnover)}`)

  return {
    last7Days: {
      totalTurnover: parseFloat(last7DaysTotalTurnover.toFixed(2)),
      intervalTurnover,
      averageIntervalTurnover: parseFloat(averageIntervalTurnover.toFixed(2)),
      highestIntervalTurnover: parseFloat(highestIntervalTurnover.toFixed(2)),
      lowestIntervalTurnover: parseFloat(lowestIntervalTurnover.toFixed(2)),
      trend,
      changePercent: parseFloat(trendChangePercent.toFixed(2)),
      volatility: parseFloat(volatility.toFixed(2)),
      intervalType
    },
    comparison: {
      previous7Days: {
        totalTurnover: parseFloat(previous7DaysTotalTurnover.toFixed(2)),
        averageIntervalTurnover: parseFloat(previousAverageIntervalTurnover.toFixed(2))
      },
      changeAmount: parseFloat(changeAmount.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      trendAnalysis
    }
  }
}

// 保存K线数据到API
async function saveKlineDataToAPI(symbol: string, klineData: KlineData[], vwapCalculation: VWAPCalculation, interval: string, timeRange: any): Promise<void> {
  const apiUrl = 'https://shebei.congrongtech.cn/telegram/upload'
  const dataKey = `data/kline-vwap-${symbol.toLowerCase()}-${interval}`

  try {
    const saveData = {
      symbol,
      interval,
      dataCount: klineData.length,
      lastUpdated: Date.now(),
      formattedLastUpdated: formatDateTime(Date.now()),
      timeRange: {
        startTime: klineData[0]?.startTime || 0,
        endTime: klineData[klineData.length - 1]?.startTime || 0,
        formattedStartTime: klineData[0]?.formattedTime || '',
        formattedEndTime: klineData[klineData.length - 1]?.formattedTime || '',
        ...timeRange
      },
      klineData: klineData.map(candle => ({
        timestamp: candle.startTime,
        formattedTime: candle.formattedTime,
        open: candle.openPrice,
        high: candle.highPrice,
        low: candle.lowPrice,
        close: candle.closePrice,
        volume: candle.volume,
        turnover: candle.turnover
      }))
    }

    const response = await fetch(`${apiUrl}?key=${dataKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(saveData),
    })

    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status}`)
    }

    const result = await response.json() as JsonStorageWriteResponse

    if (result.code !== 0) {
      throw new Error(`API 错误: ${result.message}`)
    }

    console.log(`💾 ${symbol} (${interval}) K线和VWAP数据保存成功: ${klineData.length}条K线数据`)
  } catch (error) {
    console.error(`❌ ${symbol} (${interval}) 保存K线数据失败:`, error)
    // 不抛出错误，避免影响主流程
  }
}

// 计算VWAP的函数
const calculateVWAP = (klineData: KlineData[]): VWAPCalculation => {
  let totalVolume = 0 // 总成交量
  let totalTurnover = 0 // 总成交额

  // 按时间段计算的VWAP数据
  const vwapByPeriod: VWAPData[] = []

  // 累计计算
  let cumulativeVolume = 0
  let cumulativeTurnover = 0

  klineData.forEach((candle, index) => {
    // 典型价格 (High + Low + Close) / 3，仅用于参考
    const typicalPrice = (candle.highPrice + candle.lowPrice + candle.closePrice) / 3

    // 累计数据 - 使用实际成交数据
    cumulativeVolume += candle.volume
    cumulativeTurnover += candle.turnover

    // 累计VWAP = 累计成交额 / 累计成交量（基于真实成交数据）
    const cumulativeVWAP = cumulativeVolume > 0 ? cumulativeTurnover / cumulativeVolume : 0

    // 当前周期VWAP（基于实际成交计算）
    const periodVWAP = candle.volume > 0 ? candle.turnover / candle.volume : candle.closePrice

    vwapByPeriod.push({
      timestamp: candle.startTime,
      formattedTime: candle.formattedTime,
      openPrice: candle.openPrice,
      typicalPrice: parseFloat(typicalPrice.toFixed(8)),
      volume: candle.volume,
      turnover: candle.turnover,
      periodVWAP: parseFloat(periodVWAP.toFixed(8)),
      cumulativeVWAP: parseFloat(cumulativeVWAP.toFixed(8)),
      cumulativeVolume: parseFloat(cumulativeVolume.toFixed(8)),
      cumulativeTurnover: parseFloat(cumulativeTurnover.toFixed(8)),
      // 价格偏离度基于真实VWAP计算
      priceDeviation: cumulativeVWAP > 0 ? parseFloat(((candle.closePrice - cumulativeVWAP) / cumulativeVWAP * 100).toFixed(4)) : 0,
      // 当前价格相对VWAP的位置
      pricePosition: candle.closePrice > cumulativeVWAP ? 'above' : candle.closePrice < cumulativeVWAP ? 'below' : 'equal'
    })
  })

  // 最终总计算
  totalVolume = cumulativeVolume
  totalTurnover = cumulativeTurnover

  // 最终VWAP = 总成交额 / 总成交量
  const finalVWAP = totalVolume > 0 ? totalTurnover / totalVolume : 0

  // 获取价格范围
  const prices = klineData.map(k => k.closePrice)
  const highestPrice = Math.max(...prices)
  const lowestPrice = Math.min(...prices)
  const currentPrice = prices[prices.length - 1]

  // 计算统计信息
  const aboveVWAPCount = vwapByPeriod.filter(v => v.pricePosition === 'above').length
  const belowVWAPCount = vwapByPeriod.filter(v => v.pricePosition === 'below').length

  return {
    // 最终VWAP结果 - 基于真实成交数据
    finalVWAP: parseFloat(finalVWAP.toFixed(8)),
    turnoverBasedVWAP: parseFloat(finalVWAP.toFixed(8)), // 与finalVWAP相同，因为都基于turnover

    // 统计信息
    totalVolume: parseFloat(totalVolume.toFixed(8)),
    totalTurnover: parseFloat(totalTurnover.toFixed(8)),
    totalValue: parseFloat(totalTurnover.toFixed(8)), // 使用实际成交额
    periodCount: klineData.length,

    // 价格信息
    currentPrice: parseFloat(currentPrice.toFixed(8)),
    highestPrice: parseFloat(highestPrice.toFixed(8)),
    lowestPrice: parseFloat(lowestPrice.toFixed(8)),

    // 偏离度分析
    currentDeviation: finalVWAP > 0 ? parseFloat(((currentPrice - finalVWAP) / finalVWAP * 100).toFixed(4)) : 0,
    maxDeviation: Math.max(...vwapByPeriod.map(v => Math.abs(v.priceDeviation))),

    // 市场趋势分析
    aboveVWAPPercentage: parseFloat((aboveVWAPCount / vwapByPeriod.length * 100).toFixed(2)),
    belowVWAPPercentage: parseFloat((belowVWAPCount / vwapByPeriod.length * 100).toFixed(2)),

    // 时间范围
    startTime: klineData[0]?.startTime || 0,
    endTime: klineData[klineData.length - 1]?.startTime || 0,

    // 详细数据
    vwapByPeriod: vwapByPeriod
  }
}

/**
 * 获取Bybit合约信息和K线数据，并计算VWAP
 * 返回指定交易对的合约信息、完整K线数据和VWAP计算结果
 * 使用: GET /exchanges/bybit/vwap
 * 参数: 
 *   - symbol: 合约名称，支持单个或多个（逗号分隔），如 BTCUSDT 或 BTCUSDT,ETHUSDT
 *   - category: 产品类型 (linear, inverse, spot) - 可选，默认linear
 *   - interval: 时间粒度 (1,3,5,15,30,60,120,240,360,720,D,M,W) - 可选，默认1（1分钟，最精确）
 *   - status: 合约状态过滤 (Trading, Settled, Closed) - 可选
 *   - baseCoin: 交易币种过滤 - 可选
 *   - includeDetails: 是否包含详细的VWAP计算过程 - 可选，默认false
 *   - startTime: K线数据起始时间（毫秒时间戳）- 可选，默认使用合约上线时间(launchTime)
 *   - endTime: K线数据结束时间（毫秒时间戳）- 可选，默认使用当前时间
 *   - saveData: 是否保存数据到API - 可选，默认false
 *   - sendToTelegram: 是否发送结果到Telegram - 可选，默认false
 *   - telegramChannelId: 指定Telegram频道ID - 可选，默认使用默认频道
 *   - turnoverInterval: 成交额统计的时间间隔（小时）- 可选，默认24小时
 */
export default defineEventHandler(async (event) => {
  try {
    // 获取查询参数
    const query = getQuery(event)
    // 验证参数
    const schema = z.object({
      category: z.enum(['linear', 'inverse', 'spot'], {
        invalid_type_error: 'category 必须是 linear, inverse 或 spot',
      }).default('linear'),
      symbol: z.string({
        required_error: '缺少必要参数 symbol',
      }).transform(str => str.includes(',') ? str.split(',').map(s => s.trim()) : [str]),
      interval: z.enum(['1'], {
        invalid_type_error: 'interval 必须是有效的时间粒度',
      }).default('1'), // 默认1分钟，获取最精确的VWAP
      status: z.enum(['Trading', 'Settled', 'Closed'], {
        invalid_type_error: 'status 必须是 Trading, Settled 或 Closed',
      }).optional(),
      baseCoin: z.string().optional(),
      includeDetails: z.string().optional().transform(val => val === 'true'),
      saveData: z.string().optional().transform(val => val === 'true'),
      // 新增参数：是否发送到Telegram
      sendToTelegram: z.string().optional().transform(val => val === 'true').default('true'),
      // 可选的Telegram频道ID
      telegramChannelId: z.string().optional(),
      // 新增参数：成交额统计的时间间隔（小时）
      turnoverInterval: z.string().optional().transform(val => {
        if (!val) return 4 // 默认4小时
        const hours = parseInt(val)
        if (isNaN(hours) || hours <= 0 || hours > 24) {
          throw new Error('turnoverInterval 必须是1-24之间的有效小时数')
        }
        return hours
      }).default('4'),
      // 新增参数：自定义起始时间
      startTime: z.string().optional().transform(val => {
        if (!val) return undefined
        const timestamp = parseInt(val)
        if (isNaN(timestamp)) {
          throw new Error('startTime 必须是有效的时间戳')
        }
        return timestamp
      }),
      // 新增参数：自定义结束时间
      endTime: z.string().optional().transform(val => {
        if (!val) return undefined
        const timestamp = parseInt(val)
        if (isNaN(timestamp)) {
          throw new Error('endTime 必须是有效的时间戳')
        }
        return timestamp
      }),
    })

    const validationResult = schema.safeParse(query)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const {
      category,
      symbol: symbols,
      interval,
      status,
      baseCoin,
      includeDetails,
      saveData,
      sendToTelegram: shouldSendToTelegram,
      telegramChannelId,
      turnoverInterval,
      startTime: customStartTime,
      endTime: customEndTime
    } = validationResult.data

    // 验证symbols数量限制
    if (symbols.length > 3) {
      return createErrorResponse('计算VWAP时最多支持同时查询3个交易对', 400)
    }

    // 验证时间范围的合理性
    if (customStartTime && customEndTime && customStartTime >= customEndTime) {
      return createErrorResponse('起始时间必须小于结束时间', 400)
    }

    // 获取配置信息
    const config = useRuntimeConfig()
    const bybitApiUrl = config.bybit?.bybitApiUrl

    if (!bybitApiUrl) {
      return createErrorResponse('Bybit API URL 配置未找到', 500)
    }

    // 获取合约信息的函数（使用队列）
    const fetchInstrumentInfo = async (symbol: string) => {
      return await requestQueue.add(async () => {
        const params = new URLSearchParams({
          category,
          symbol,
        })

        if (status) params.append('status', status)
        if (baseCoin) params.append('baseCoin', baseCoin)

        const url = `${bybitApiUrl}/v5/market/instruments-info?${params.toString()}`

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          throw new Error(`HTTP 错误: ${response.status}`)
        }

        const apiResponse = await response.json() as BybitApiResponse

        if (apiResponse.retCode !== 0) {
          throw new Error(`API 错误: ${apiResponse.retMsg}`)
        }

        return apiResponse
      })
    }

    // 获取K线数据的函数（使用队列）
    const fetchKlineData = async (symbol: string, start: number, end: number): Promise<string[][]> => {
      return await requestQueue.add(async () => {
        const params = new URLSearchParams({
          category,
          symbol,
          interval,
          start: start.toString(),
          end: end.toString(),
          limit: '1000'
        })

        const url = `${bybitApiUrl}/v5/market/kline?${params.toString()}`

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          throw new Error(`HTTP 错误: ${response.status}`)
        }

        const apiResponse = await response.json() as KlineApiResponse

        if (apiResponse.retCode !== 0) {
          throw new Error(`API 错误: ${apiResponse.retMsg}`)
        }

        return apiResponse.result.list || []
      })
    }

    // 获取完整K线数据的函数 - 简化分页逻辑
    const fetchAllKlineData = async (symbol: string, launchTime: number): Promise<KlineData[]> => {
      const allKlineData: string[][] = []

      // 使用自定义时间范围，如果没有提供则使用默认值
      let targetStartTime = customStartTime || launchTime
      let targetEndTime = customEndTime || Date.now()

      // 如果自定义起始时间早于合约上线时间，则使用合约上线时间
      if (targetStartTime < launchTime) {
        console.warn(`自定义起始时间早于合约上线时间，将使用合约上线时间`)
        targetStartTime = launchTime
      }

      // 从目标结束时间开始，向历史时间倒推获取数据
      let currentEndTime = targetEndTime
      const finalStartTime = targetStartTime

      // 每次获取的时间跨度（分钟）
      const batchMinutes = 1000 // 对应limit=1000的1分钟K线
      const batchMilliseconds = batchMinutes * 60 * 1000

      // 添加数据获取限制，防止过量请求
      let requestCount = 0
      const maxRequests = 1000

      console.log(`开始获取 ${symbol} 的K线数据`)
      console.log(`目标时间范围: ${formatDateTime(targetStartTime)} 到 ${formatDateTime(targetEndTime)}`)

      while (requestCount < maxRequests) {
        // 计算当前批次的开始时间
        let currentStartTime = currentEndTime - batchMilliseconds

        // 如果计算出的开始时间小于目标开始时间，则使用目标开始时间
        if (currentStartTime < finalStartTime) {
          currentStartTime = finalStartTime
        }

        // 获取当前时间窗口的数据
        const klineData = await fetchKlineData(symbol, currentStartTime, currentEndTime)
        requestCount++

        console.log(`第${requestCount}次请求 ${symbol}`)
        console.log(`时间范围: ${formatDateTime(currentStartTime)} - ${formatDateTime(currentEndTime)}`)
        console.log(`获取到 ${klineData.length} 条K线数据`)

        if (klineData.length === 0) {
          console.log(`${symbol} 没有更多数据，停止获取`)
          break
        }

        // 添加到总数据中
        allKlineData.push(...klineData)

        // 如果当前开始时间已经达到目标开始时间，说明获取完成
        if (currentStartTime <= finalStartTime) {
          console.log(`${symbol} 已到达目标起始时间，数据获取完成`)
          break
        }

        // 更新下次循环的结束时间为当前循环的开始时间
        currentEndTime = currentStartTime

        console.log(`下次请求结束时间: ${formatDateTime(currentEndTime)}`)
      }

      console.log(`${symbol} K线数据获取完成，共 ${requestCount} 次请求，获取到 ${allKlineData.length} 条原始数据`)

      // 转换为KlineData格式并去重、排序
      const processedData = allKlineData
        .map(item => ({
          startTime: parseInt(item[0]),
          openPrice: parseFloat(item[1]),
          highPrice: parseFloat(item[2]),
          lowPrice: parseFloat(item[3]),
          closePrice: parseFloat(item[4]),
          volume: parseFloat(item[5]),
          turnover: parseFloat(item[6]),
          formattedTime: formatDateTime(parseInt(item[0]))
        }))
        // 严格过滤时间范围
        .filter(item => {
          return item.startTime >= targetStartTime && item.startTime <= targetEndTime
        })
        // 去重：使用 Map 确保每个时间戳只有一条数据
        .reduce((acc, item) => {
          acc.set(item.startTime, item)
          return acc
        }, new Map())

      // 转换回数组并按时间正序排列
      const finalData = Array.from(processedData.values()).sort((a, b) => a.startTime - b.startTime)

      console.log(`${symbol} 处理后的K线数据: ${finalData.length} 条`)
      console.log(`实际时间范围: ${finalData[0]?.formattedTime} 到 ${finalData[finalData.length - 1]?.formattedTime}`)
      console.log(`目标时间范围: ${formatDateTime(targetStartTime)} 到 ${formatDateTime(targetEndTime)}`)

      // 计算并打印成本价信息
      if (finalData.length > 0) {
        // 计算总成交量和总成交额
        let totalVolume = 0
        let totalTurnover = 0

        finalData.forEach(candle => {
          totalVolume += candle.volume
          totalTurnover += candle.turnover
        })

        const averageCostPrice = totalVolume > 0 ? totalTurnover / totalVolume : 0
        const currentPrice = finalData[finalData.length - 1].closePrice
        const priceDeviation = averageCostPrice > 0 ? ((currentPrice - averageCostPrice) / averageCostPrice * 100) : 0

        console.log(`${symbol} 成本价分析:`)
        console.log(`- 平均成本价: ${averageCostPrice.toFixed(8)} USDT`)
        console.log(`- 当前价格: ${currentPrice.toFixed(8)} USDT`)
        console.log(`- 价格偏离: ${priceDeviation.toFixed(2)}%`)
        console.log(`- 总成交量: ${totalVolume.toLocaleString()} ${symbol.replace('USDT', '')}`)
        console.log(`- 总成交额: ${totalTurnover.toLocaleString()} USDT`)
      }

      return finalData
    }

    // 处理单个symbol的完整流程
    const processSymbolData = async (symbol: string) => {
      // 1. 获取合约信息（通过队列）
      const instrumentResponse = await fetchInstrumentInfo(symbol)

      if (!instrumentResponse.result.list || instrumentResponse.result.list.length === 0) {
        throw new Error('没有可用的合约信息')
      }

      const instrumentInfo = instrumentResponse.result.list[0]
      const launchTime = parseInt(instrumentInfo.launchTime)

      // 2. 获取完整K线数据（每个请求都通过队列）
      const klineData = await fetchAllKlineData(symbol, launchTime)

      if (klineData.length === 0) {
        throw new Error('没有可用的K线数据')
      }

      // 3. 计算VWAP
      const vwapCalculation = calculateVWAP(klineData)

      // 4. 计算7天成交额统计 - 使用指定的时间间隔
      const turnover7Days = calculate7DaysTurnoverAnalysis(klineData, turnoverInterval)

      // 5. 计算实际使用的时间范围
      const actualStartTime = customStartTime && customStartTime >= launchTime ? customStartTime : launchTime
      const actualEndTime = customEndTime || Date.now()

      const timeRange = {
        requestedStartTime: customStartTime,
        requestedEndTime: customEndTime,
        actualStartTime: actualStartTime,
        actualEndTime: actualEndTime,
        contractLaunchTime: launchTime,
        formattedActualStartTime: formatDateTime(actualStartTime),
        formattedActualEndTime: formatDateTime(actualEndTime),
        formattedContractLaunchTime: formatDateTime(launchTime),
        isCustomRange: !!(customStartTime || customEndTime),
        durationDays: Math.floor((actualEndTime - actualStartTime) / (1000 * 60 * 60 * 24))
      }

      // 6. 保存K线数据到API（如果启用）
      if (saveData) {
        try {
          await saveKlineDataToAPI(symbol, klineData, vwapCalculation, interval, timeRange)
        } catch (error) {
          console.warn(`保存数据失败，但不影响主流程:`, error)
        }
      }

      // 7. 处理合约信息
      const processedItem: InstrumentInfoItem = {
        ...instrumentInfo,
        launchTime: instrumentInfo.launchTime,
        launchTimeMs: launchTime,
        formattedLaunchTime: formatDateTime(launchTime),
        daysFromLaunch: Math.floor((Date.now() - launchTime) / (1000 * 60 * 60 * 24)),
        priceScaleNumber: parseInt(instrumentInfo.priceScale),
        tickSizeFloat: parseFloat(instrumentInfo.priceFilter.tickSize),
        minOrderQtyFloat: parseFloat(instrumentInfo.lotSizeFilter.minOrderQty),
        maxOrderQtyFloat: parseFloat(instrumentInfo.lotSizeFilter.maxOrderQty),
      }

      return {
        category: instrumentResponse.result.category,
        symbol: instrumentInfo.symbol,
        latestCostPrice: vwapCalculation.finalVWAP,
        instrumentInfo: processedItem,
        klineData: {
          interval,
          total: klineData.length,
          timeRange,
          data: includeDetails ? klineData : []
        },
        vwap: {
          ...vwapCalculation,
          vwapByPeriod: includeDetails ? vwapCalculation.vwapByPeriod : []
        },
        dataSaved: saveData,
        // 添加成本价信息到返回结果
        costPriceAnalysis: {
          averageCostPrice: vwapCalculation.finalVWAP,
          currentPrice: vwapCalculation.currentPrice,
          priceDeviation: vwapCalculation.currentDeviation,
          totalVolume: vwapCalculation.totalVolume,
          totalTurnover: vwapCalculation.totalTurnover,
          priceRange: {
            highest: vwapCalculation.highestPrice,
            lowest: vwapCalculation.lowestPrice
          },
          marketStatus: vwapCalculation.currentDeviation > 5 ? 'above_cost' :
            vwapCalculation.currentDeviation < -5 ? 'below_cost' : 'near_cost'
        },
        // 添加7天成交额分析
        turnover7DaysAnalysis: turnover7Days
      }
    }

    // 如果只有一个symbol
    if (symbols.length === 1) {
      const result = await processSymbolData(symbols[0])

      // 发送到Telegram（如果启用）
      let telegramResult: TelegramSendResult | undefined
      if (shouldSendToTelegram) {
        try {
          const telegramMessage = formatVWAPResultForTelegram(result)
          telegramResult = await sendToTelegram(telegramMessage, telegramChannelId)

          if (telegramResult.success) {
            console.log(`✅ ${symbols[0]} Telegram消息发送成功，消息ID: ${telegramResult.messageId}`)
          } else {
            console.warn(`⚠️ ${symbols[0]} Telegram消息发送失败: ${telegramResult.error}`)
          }
        } catch (error) {
          console.warn(`⚠️ ${symbols[0]} Telegram发送出错:`, error)
          telegramResult = {
            success: false,
            error: error instanceof Error ? error.message : 'Telegram发送失败'
          }
        }
      }

      const message = `获取 ${symbols[0]} 合约信息、K线数据和VWAP计算完成${saveData ? '，数据已保存' : ''}${shouldSendToTelegram ? (telegramResult?.success ? '，已发送到Telegram' : '，Telegram发送失败') : ''}`

      return createSuccessResponse({
        ...result,
        telegramSent: shouldSendToTelegram ? telegramResult : undefined
      }, message)
    }

    // 多个symbol的情况，使用Promise.allSettled并行处理（但每个请求内部使用队列）
    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        try {
          const result = await processSymbolData(symbol)
          return {
            success: true,
            symbol,
            data: result
          }
        } catch (error) {
          return {
            success: false,
            symbol,
            error: error instanceof Error ? error.message : '获取数据失败'
          }
        }
      })
    )

    // 分离成功和失败的结果
    const successful: any[] = []
    const failed: InstrumentError[] = []

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          successful.push(result.value.data)
        } else {
          failed.push({
            symbol: result.value.symbol,
            error: result.value.error
          })
        }
      } else {
        failed.push({
          symbol: 'unknown',
          error: result.reason instanceof Error ? result.reason.message : '请求失败'
        })
      }
    })

    // 如果所有请求都失败
    if (successful.length === 0) {
      return createErrorResponse('所有交易对数据获取失败', 500)
    }

    // 在多个symbol的最终返回之前添加Telegram发送逻辑
    let telegramResult: TelegramSendResult | undefined
    if (shouldSendToTelegram && successful.length > 0) {
      try {
        const telegramMessage = formatMultipleResultsForTelegram(successful, {
          total: symbols.length,
          successful: successful.length,
          failed: failed.length
        })
        telegramResult = await sendToTelegram(telegramMessage, telegramChannelId)

        if (telegramResult.success) {
          console.log(`✅ 多交易对Telegram消息发送成功，消息ID: ${telegramResult.messageId}`)
        } else {
          console.warn(`⚠️ 多交易对Telegram消息发送失败: ${telegramResult.error}`)
        }
      } catch (error) {
        console.warn(`⚠️ 多交易对Telegram发送出错:`, error)
        telegramResult = {
          success: false,
          error: error instanceof Error ? error.message : 'Telegram发送失败'
        }
      }
    }

    // 返回成功响应
    const message = `获取合约信息、K线数据和VWAP计算完成: ${successful.length}/${symbols.length} 成功${saveData ? '，数据已保存' : ''}${shouldSendToTelegram ? (telegramResult?.success ? '，已发送到Telegram' : '，Telegram发送失败') : ''}`

    return createSuccessResponse({
      list: successful,
      errors: failed.length > 0 ? failed : undefined,
      summary: {
        total: symbols.length,
        successful: successful.length,
        failed: failed.length,
        interval,
        includeDetails,
        saveData,
        sendToTelegram: shouldSendToTelegram,
        turnoverInterval,
        timeRange: {
          customStartTime,
          customEndTime,
          isCustomRange: !!(customStartTime || customEndTime)
        }
      },
      telegramSent: shouldSendToTelegram ? telegramResult : undefined
    }, message)

  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '获取数据失败',
      500,
    )
  }
})