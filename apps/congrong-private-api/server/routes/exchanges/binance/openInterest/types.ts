/**
 * 币安未平仓合约数量接口响应
 */
export interface BinanceOpenInterest {
  openInterest: string  // 未平仓合约数量
  symbol: string        // 交易对
  time: number          // 撮合引擎时间
}