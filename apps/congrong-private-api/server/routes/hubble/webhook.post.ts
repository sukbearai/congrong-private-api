/* eslint-disable ts/no-use-before-define */
import { bot } from '~/utils/bot'
import { getTelegramChannel } from '~/utils/telegram'

export default eventHandler(async (event) => {
  const body = await readBody(event)

  try {
    const channelId = getTelegramChannel('signal:hubble')

    // Parse payload - use union type
    const payload = body as HubbleSignalPayload | PolymarketPayload | HyperliquidFillPayload

    // Format message based on type
    let message: string
    if (payload.type === 'Polymarket') {
      message = formatPolymarketMessage(payload as PolymarketPayload)
    }
    else if (payload.type === 'hyperliquid_fill') {
      message = formatHyperliquidFillMessage(payload as HyperliquidFillPayload)
    }
    else {
      // Send raw JSON for other types
      message = JSON.stringify(payload, null, 2)
    }

    await bot.api.sendMessage(channelId, message, { parse_mode: 'HTML' })

    return { status: 'received' }
  }
  catch (error) {
    console.error('Error processing Hubble webhook:', error)
    return { status: 'error', message: String(error) }
  }
})

function formatPolymarketMessage(payload: PolymarketPayload): string {
  const { data, tag } = payload
  const trader = Object.keys(tag || {})[0]
  const traderInfo = trader ? tag![trader] : null

  // Format numbers
  const amount = Number.parseFloat(data.CollateralAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const price = Number.parseFloat(data.PriceStr)
  const potentialReturn = ((1 / price - 1) * 100).toFixed(1)

  // Build message
  const lines = [
    `🎯 <b>Polymarket 交易信号</b>`,
    '',
    `📊 <b>事件:</b> ${data.EventName}`,
    `🏷️ <b>标签:</b> ${data.Tags}`,
    `📈 <b>结果:</b> ${data.Outcome}`,
    '',
    `💰 <b>交易详情:</b>`,
    `├ 方向: ${data.MakerDirection === 'BUY' ? '🟢 买入' : '🔴 卖出'}`,
    `├ 金额: $${amount} ${data.CollateralTokenSymbol}`,
    `├ 价格: ${data.PriceStr} (${(price * 100).toFixed(0)}% 概率)`,
    `└ 潜在收益: ${potentialReturn}%`,
  ]

  // Add trader info if available
  if (traderInfo) {
    const indicator = traderInfo.indicator
    const totalPnl = indicator.total_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const roi = (indicator.roi * 100).toFixed(1)
    const winRate = (indicator.win_rate * 100).toFixed(1)

    lines.push(
      '',
      `👤 <b>交易者:</b> Smart Money`,
      `├ 排名: #${indicator.rank}`,
      `├ 总盈亏: $${totalPnl}`,
      `├ ROI: ${roi}%`,
      `└ 胜率: ${winRate}%`,
    )
  }

  lines.push(
    '',
    `🔗 <a href="${data.URL}">查看详情</a>`,
    `⛓️ ${payload.chain} | TX: ${payload.signature.slice(0, 10)}...`,
  )

  return lines.join('\n')
}

function formatHyperliquidFillMessage(payload: HyperliquidFillPayload): string {
  const { data, tag } = payload
  const trader = Object.keys(tag || {})[0]
  const traderInfo = trader ? tag![trader] : null

  // Parse numbers
  const price = Number.parseFloat(data.px)
  const size = Number.parseFloat(data.sz)
  const notional = data.notional_value_usd
  const closedPnl = Number.parseFloat(data.closed_pnl)
  const fee = Number.parseFloat(data.fee)
  const netPnl = closedPnl - fee

  // Format time
  const tradeTime = new Date(data.time).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  // Determine emoji based on direction and side
  const directionEmoji = data.dir === 'Long > Short' ? '🔴' : '🟢'
  const sideText = data.side === 'S' ? '做空' : '做多'
  const pnlEmoji = netPnl > 0 ? '💰' : '📉'

  // Build message
  const lines = [
    `${directionEmoji} <b>Hyperliquid 永续合约交易</b>`,
    '',
    `💎 <b>币种:</b> ${data.coin}`,
    `📊 <b>操作:</b> ${data.dir} (${sideText})`,
    '',
    `💰 <b>交易详情:</b>`,
    `├ 成交价格: $${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
    `├ 成交数量: ${size.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${data.coin}`,
    `├ 名义价值: $${notional.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `├ 起始仓位: ${Number.parseFloat(data.start_position).toLocaleString('en-US')}`,
    `└ 杠杆模式: ${data.crossed ? '全仓' : '逐仓'}`,
  ]

  // Add PnL info
  lines.push(
    '',
    `${pnlEmoji} <b>盈亏情况:</b>`,
    `├ 平仓盈亏: ${closedPnl > 0 ? '+' : ''}$${closedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `├ 手续费: $${fee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `└ 净盈亏: ${netPnl > 0 ? '+' : ''}$${netPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  )

  // Add trader info if available
  if (traderInfo && traderInfo.metrics && traderInfo.metrics.length > 0) {
    const metric = traderInfo.metrics[0]
    const totalPnl = metric.total_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const roi = (metric.roi * 100).toFixed(2)
    const tags = traderInfo.tag.join(', ')

    lines.push(
      '',
      `👤 <b>交易者:</b> ${tags}`,
      `├ 排名: #${metric.rank}`,
      `├ 总盈亏(30天): $${totalPnl}`,
      `└ ROI(30天): ${roi}%`,
    )
  }

  lines.push(
    '',
    `🕒 ${tradeTime}`,
    `⛓️ ${payload.chain} | TX: <code>${payload.signature.slice(0, 16)}...</code>`,
  )

  return lines.join('\n')
}

// Types based on observed payload
interface HubbleSignalPayload {
  signature: string
  block: number
  chain: string
  type: 'Inflow' | 'Outflow' | 'Polymarket'
  tag?: Record<string, {
    tag: string[]
    source: string
    indicator?: {
      rank: number
      total_pnl: number
      roi: number
      win_rate: number
      market_pref?: Array<{
        market_type: string
        pnl: number
      }>
    }
  }>
  data: {
    sender: string
    receiver: string
    amount: string
    token: string
    symbol: string
    amount_usd: number | string
  }
}

interface PolymarketPayload extends Omit<HubbleSignalPayload, 'data'> {
  type: 'Polymarket'
  data: {
    AssetID: string
    BlockNumber: number
    BlockTimestamp: string
    CollateralAmount: string
    CollateralAmountRaw: string
    CollateralTokenAddress: string
    CollateralTokenDecimals: number
    CollateralTokenName: string
    CollateralTokenSymbol: string
    ConditionID: string
    CreatedAt: string
    EventName: string
    ExchangeType: string
    FeeAmount: string
    FeeRaw: string
    LogIndex: number
    Maker: string
    MakerAmountRaw: string
    MakerDirection: 'BUY' | 'SELL'
    MarketAddress: string
    OrderHash: string
    Outcome: string
    Price: number
    PriceStr: string
    Project: string
    Protocol: string
    Tags: string
    Taker: string
    TakerAmountRaw: string
    TakerDirection: 'BUY' | 'SELL'
    TokenAmountRaw: string
    TransactionHash: string
    TransactionIndex: number
    URL: string
    USDCollateralAmount: number
    USDExchangeRate: number
    USDFeeAmount: number
    UniqueID: string
  }
}

interface HyperliquidFillPayload {
  signature: string
  chain: string
  type: 'hyperliquid_fill'
  tag?: Record<string, {
    tag: string[]
    source: string
    metrics: Array<{
      time_range: string
      rank: number
      total_pnl: number
      roi: number
      account_value: number
    }>
  }>
  data: {
    coin: string
    px: string // price
    sz: string // size
    notional_value_usd: number
    side: 'B' | 'S' // Buy or Sell
    dir: 'Long > Short' | 'Short > Long' | 'Open Long' | 'Close Long' | 'Open Short' | 'Close Short'
    crossed: boolean // true for cross margin, false for isolated
    time: number // timestamp in milliseconds
    tid: number // trade id
    hash: string
    user: string // user address
    closed_pnl: string
    fee: string
    start_position: string
    oid: number // order id
  }
}
