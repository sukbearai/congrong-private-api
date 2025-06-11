/**
 * 币安大户多空比率接口响应
 */
export interface BinanceTopLongShortAccountRatio {
  symbol: string        // 交易对
  longShortRatio: string // 大户多空账户数比值
  longAccount: string    // 大户多仓账户数比例
  shortAccount: string   // 大户空仓账户数比例
  timestamp: number      // 时间戳
}