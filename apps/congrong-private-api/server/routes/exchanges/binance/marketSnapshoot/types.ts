/**
 * 币安市场快照接口响应
 */
export interface BinanceMarketSnapshoot {
  symbol: string // 交易对
  indexPrice: string // 现货价格(指数价格)
  markPrice: string // 合约价格(标记价格)
  topTraderAccountLsRatio: string // 大户多空账户比例
  openInterest: string // 未平仓合约数量
  timestamp: number // 时间戳
}
