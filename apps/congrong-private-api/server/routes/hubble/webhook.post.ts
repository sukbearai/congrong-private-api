/* eslint-disable ts/no-use-before-define */
import { bot } from '~/utils/bot'
import { getTelegramChannel } from '~/utils/telegram'

export default eventHandler(async (event) => {
  const body = await readBody(event)

  try {
    const channelId = getTelegramChannel('signal:hubble')

    // Parse payload - use union type
    const payload = body as HubbleSignalPayload | PolymarketPayload

    // Format message based on type
    let message: string
    if (payload.type === 'Polymarket') {
      message = formatPolymarketMessage(payload as PolymarketPayload)
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
