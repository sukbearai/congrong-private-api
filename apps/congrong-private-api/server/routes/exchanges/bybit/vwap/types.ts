// Bybit API 原始响应类型
export interface BybitApiResponse {
  retCode: number
  retMsg: string
  result: {
    category: string
    list: RawInstrumentInfo[]
    nextPageCursor?: string
  }
  retExtInfo: object
  time: number
}

// Bybit API 原始合约信息
export interface RawInstrumentInfo {
  symbol: string
  contractType: string
  status: string
  baseCoin: string
  quoteCoin: string
  launchTime: string
  deliveryTime: string
  deliveryFeeRate: string
  priceScale: string
  leverageFilter: {
    minLeverage: string
    maxLeverage: string
    leverageStep: string
  }
  priceFilter: {
    minPrice: string
    maxPrice: string
    tickSize: string
  }
  lotSizeFilter: {
    maxOrderQty: string
    maxMktOrderQty: string
    minOrderQty: string
    qtyStep: string
    postOnlyMaxOrderQty: string
    minNotionalValue: string
  }
  unifiedMarginTrade: boolean
  fundingInterval: number
  settleCoin: string
  copyTrading: string
  upperFundingRate: string
  lowerFundingRate: string
  displayName: string
  riskParameters: {
    priceLimitRatioX: string
    priceLimitRatioY: string
  }
  isPreListing: boolean
  preListingInfo?: {
    curAuctionPhase: string
    phases: Array<{
      phase: string
      startTime: string
      endTime: string
    }>
    auctionFeeInfo: {
      auctionFeeRate: string
      takerFeeRate: string
      makerFeeRate: string
    }
  }
}

// 处理后的合约信息项
export interface InstrumentInfoItem extends RawInstrumentInfo {
  // 原始字段保持不变
  launchTime: string

  // 新增的计算字段
  launchTimeMs: number
  formattedLaunchTime: string
  daysFromLaunch: number
  priceScaleNumber: number
  tickSizeFloat: number
  minOrderQtyFloat: number
  maxOrderQtyFloat: number
}

// 处理后的单个合约数据
export interface ProcessedInstrumentData {
  category: string
  symbol: string
  instrumentInfo: InstrumentInfoItem
  nextPageCursor?: string
}

// 合约查询错误信息
export interface InstrumentError {
  symbol: string
  error: string
}

// 多个合约响应
export interface MultipleInstrumentResponse {
  list: ProcessedInstrumentData[]
  errors?: InstrumentError[]
  summary: {
    total: number
    successful: number
    failed: number
  }
}

// K线API响应类型
export interface KlineApiResponse {
  retCode: number
  retMsg: string
  result: {
    category: string
    symbol: string
    list: string[][]
  }
  retExtInfo: object
  time: number
}

// 处理后的K线数据项
export interface KlineData {
  startTime: number
  openPrice: number
  highPrice: number
  lowPrice: number
  closePrice: number
  volume: number
  turnover: number
  formattedTime: string
}

// VWAP数据项
export interface VWAPData {
  timestamp: number
  formattedTime: string
  openPrice: number
  typicalPrice: number
  volume: number
  turnover: number
  periodVWAP: number
  cumulativeVWAP: number
  cumulativeVolume: number
  cumulativeTurnover: number
  priceDeviation: number
  pricePosition: 'above' | 'below' | 'equal'
}

// VWAP计算结果
export interface VWAPCalculation {
  // 最终VWAP结果
  finalVWAP: number
  turnoverBasedVWAP: number

  // 统计信息
  totalVolume: number
  totalTurnover: number
  totalValue: number
  periodCount: number

  // 价格信息
  currentPrice: number
  highestPrice: number
  lowestPrice: number

  // 偏离度分析
  currentDeviation: number
  maxDeviation: number

  // 市场趋势分析
  aboveVWAPPercentage: number
  belowVWAPPercentage: number

  // 时间范围
  startTime: number
  endTime: number

  // 详细数据
  vwapByPeriod: VWAPData[]
}
