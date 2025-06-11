/**
 * 币安标记价格和资金费率接口响应
 */
export interface BinancePremiumIndex {
  symbol: string // 交易对
  markPrice: string // 标记价格
  indexPrice: string // 指数价格
  estimatedSettlePrice: string // 预估结算价,仅在交割开始前最后一小时有意义
  lastFundingRate: string // 最近更新的资金费率
  interestRate: string // 标的资产基础利率
  nextFundingTime: number // 下次资金费时间
  time: number // 更新时间
}
