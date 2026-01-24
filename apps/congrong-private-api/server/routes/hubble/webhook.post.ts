import { addHours, format } from 'date-fns'
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
    else if (payload.type === 'Inflow' || payload.type === 'Outflow') {
      message = formatFlowMessage(payload as HubbleSignalPayload)
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

function formatNumber(num: number | string, min = 2, max = 2) {
  return Number(num).toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max })
}

function formatFlowMessage(payload: HubbleSignalPayload): string {
  const { data, tag, type } = payload
  const isInflow = type === 'Inflow'

  // Format numbers
  const amount = formatNumber(data.amount, 0, 4)
  const amountUsdValue = Number(data.amount_usd) || 0
  const amountUsd = amountUsdValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  // Solscan helpers
  const getTxLink = (sig: string) => `<a href="https://solscan.io/tx/${sig}">Solana Transaction</a>`
  const getAddrLink = (addr: string, label: string) => `<a href="https://solscan.io/account/${addr}">${label}</a>`
  const getTokenLink = (addr: string, symbol: string) => `<a href="https://solscan.io/token/${addr}">${symbol}</a>`

  // Get address labels
  const getLabel = (address: string) => {
    let label = `${address.slice(0, 4)}...${address.slice(-4)}`
    if (tag && tag[address]) {
      const info = tag[address]
      const tags = info.tag.filter(t => t !== 'CEX' && t !== 'Deposit Address').join(', ')
      const source = info.source || ''
      if (source && tags) { label = `${source} (${tags})` }
      else if (source) { label = source }
      else if (tags) { label = tags }
    }
    return getAddrLink(address, label)
  }

  const senderLabel = getLabel(data.sender)
  const receiverLabel = getLabel(data.receiver)

  // Handle Symbol display
  const hasSymbol = data.symbol && data.symbol !== 'UNKNOWN'
  const displaySymbol = hasSymbol ? data.symbol : (data.token ? `${data.token.slice(0, 4)}...${data.token.slice(-4)}` : 'Token')
  const tokenLabel = getTokenLink(data.token, displaySymbol)

  // Build message
  const emoji = isInflow ? '🟢' : '🔴'
  const action = isInflow ? '大额流入' : '大额流出'

  const lines = [
    `${emoji} <b>${action}提醒</b>`,
    '',
    `💰 <b>金额:</b> ${amount} ${tokenLabel} (${amountUsd})`,
  ]

  if (!hasSymbol && data.token) {
    lines.push(`🔑 <b>Token:</b> <code>${data.token}</code>`)
  }

  lines.push(
    `📤 <b>发送方:</b> ${senderLabel}`,
    `📥 <b>接收方:</b> ${receiverLabel}`,
    '',
    `🔗 ${getTxLink(payload.signature)}`,
  )

  return lines.join('\n')
}

function formatPolymarketMessage(payload: PolymarketPayload): string {
  const { data, tag } = payload
  const trader = Object.keys(tag || {})[0]
  const traderInfo = trader ? tag![trader] : null

  // Format numbers
  const amount = formatNumber(data.CollateralAmount)
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
    const totalPnl = formatNumber(indicator.total_pnl)
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
  // Hyperliquid times are in ms. Cloudflare Workers usage implies UTC environment usually.
  // We want Asia/Shanghai (UTC+8).
  const tradeTime = format(addHours(new Date(data.time), 8), 'yyyy/MM/dd HH:mm')

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
    `├ 成交价格: $${formatNumber(price, 2, 4)}`,
    `├ 成交数量: ${formatNumber(size, 1, 1)} ${data.coin}`,
    `├ 名义价值: $${formatNumber(notional)}`,
    `├ 起始仓位: ${formatNumber(data.start_position, 0, 20)}`,
    `└ 杠杆模式: ${data.crossed ? '全仓' : '逐仓'}`,
  ]

  // Add PnL info
  lines.push(
    '',
    `${pnlEmoji} <b>盈亏情况:</b>`,
    `├ 平仓盈亏: ${closedPnl > 0 ? '+' : ''}$${formatNumber(closedPnl)}`,
    `├ 手续费: $${formatNumber(fee)}`,
    `└ 净盈亏: ${netPnl > 0 ? '+' : ''}$${formatNumber(netPnl)}`,
  )

  // Add trader info if available
  if (traderInfo && traderInfo.metrics && traderInfo.metrics.length > 0) {
    const metric = traderInfo.metrics[0]
    const totalPnl = formatNumber(metric.total_pnl)
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
