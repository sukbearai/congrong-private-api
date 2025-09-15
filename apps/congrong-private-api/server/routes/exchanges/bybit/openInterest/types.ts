/**
 * Bybit未平仓合约数量接口响应
 */
export interface BybitOpenInterestItem {
  openInterest: string // 未平仓合约数量
  timestamp: string // 数据产生的时间戳（毫秒）
}

export interface BybitOpenInterestResponse {
  category: string // 产品类型
  symbol: string // 合约名称
  list: BybitOpenInterestItem[] // 数据列表
  nextPageCursor: string // 游标，用于翻页
}

/**
 * Bybit API响应格式
 */
export interface BybitApiResponse {
  retCode: number
  retMsg: string
  result: BybitOpenInterestResponse
  retExtInfo: object
  time: number
}

export interface OpenInterestLatestItem {
  openInterest: string
  timestamp: string
  formattedTime: string
  timestampMs: number
  openInterestFloat: number
  previousOpenInterest: number
  changeAmount: number
  changeRate: number
  changeRateFormatted: string
}

export interface ProcessedOpenInterestData {
  category: string
  symbol: string
  latest: OpenInterestLatestItem
  nextPageCursor: string
}

export interface OpenInterestError {
  symbol: string
  error: string
}

export interface OpenInterestSummary {
  total: number
  successful: number
  failed: number
}

export interface MultipleOpenInterestResponse {
  list: ProcessedOpenInterestData[]
  errors?: OpenInterestError[]
  summary: OpenInterestSummary
}
