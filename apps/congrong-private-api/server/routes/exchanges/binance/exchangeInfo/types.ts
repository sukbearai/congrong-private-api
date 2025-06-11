/**
 * 币安交易所API响应类型定义
 */

/**
 * 币安交易所信息响应
 */
export interface BinanceExchangeInfo {
  exchangeFilters: any[]
  rateLimits: RateLimit[]
  serverTime: number
  assets: Asset[]
  symbols: Symbol[]
  timezone: string
}

/**
 * 访问限制信息
 */
export interface RateLimit {
  interval: string // 时间间隔单位，例如：'MINUTE'
  intervalNum: number // 时间间隔数值，例如：1
  limit: number // 上限次数
  rateLimitType: string // 限制类型，例如：'REQUEST_WEIGHT'、'ORDERS'
}

/**
 * 资产信息
 */
export interface Asset {
  asset: string // 资产名称，例如：'BUSD'、'USDT'
  marginAvailable: boolean // 是否可用作保证金
  autoAssetExchange: number | null // 保证金资产自动兑换阈值
}

/**
 * 交易对信息
 */
export interface Symbol {
  symbol: string // 交易对，例如：'BTCUSDT'
  pair: string // 标的交易对
  contractType: string // 合约类型，例如：'PERPETUAL'
  deliveryDate: number // 交割日期
  onboardDate: number // 上线日期
  status: string // 交易对状态，例如：'TRADING'
  maintMarginPercent: string // 维持保证金率
  requiredMarginPercent: string // 所需保证金率
  baseAsset: string // 标的资产，例如：'BTC'
  quoteAsset: string // 报价资产，例如：'USDT'
  marginAsset: string // 保证金资产，例如：'USDT'
  pricePrecision: number // 价格小数点位数
  quantityPrecision: number // 数量小数点位数
  baseAssetPrecision: number // 标的资产精度
  quotePrecision: number // 报价资产精度
  underlyingType: string // 底层类型，例如：'COIN'
  underlyingSubType: string[] // 底层子类型，例如：['STORAGE']
  settlePlan: number // 结算计划
  triggerProtect: string // 触发保护阈值
  filters: Filter[] // 交易规则过滤器
  OrderType: string[] // 支持的订单类型
  timeInForce: string[] // 有效方式
  liquidationFee: string // 强平费率
  marketTakeBound: string // 市价吃单允许的最大价格偏离比例
}

/**
 * 交易规则过滤器
 */
export type Filter = PriceFilter | LotSizeFilter | MarketLotSizeFilter | MaxNumOrdersFilter | MaxNumAlgoOrdersFilter | MinNotionalFilter | PercentPriceFilter

/**
 * 价格限制过滤器
 */
export interface PriceFilter {
  filterType: 'PRICE_FILTER'
  maxPrice: string // 最大价格
  minPrice: string // 最小价格
  tickSize: string // 价格步长
}

/**
 * 数量限制过滤器
 */
export interface LotSizeFilter {
  filterType: 'LOT_SIZE'
  maxQty: string // 最大数量
  minQty: string // 最小数量
  stepSize: string // 数量步长
}

/**
 * 市价订单数量限制过滤器
 */
export interface MarketLotSizeFilter {
  filterType: 'MARKET_LOT_SIZE'
  maxQty: string // 最大数量
  minQty: string // 最小数量
  stepSize: string // 数量步长
}

/**
 * 最多订单数限制过滤器
 */
export interface MaxNumOrdersFilter {
  filterType: 'MAX_NUM_ORDERS'
  limit: number // 限制数量
}

/**
 * 最多条件订单数限制过滤器
 */
export interface MaxNumAlgoOrdersFilter {
  filterType: 'MAX_NUM_ALGO_ORDERS'
  limit: number // 限制数量
}

/**
 * 最小名义价值过滤器
 */
export interface MinNotionalFilter {
  filterType: 'MIN_NOTIONAL'
  notional: string // 最小名义价值
}

/**
 * 价格比限制过滤器
 */
export interface PercentPriceFilter {
  filterType: 'PERCENT_PRICE'
  multiplierUp: string // 价格上限百分比
  multiplierDown: string // 价格下限百分比
  multiplierDecimal: number // 百分比精度
}
