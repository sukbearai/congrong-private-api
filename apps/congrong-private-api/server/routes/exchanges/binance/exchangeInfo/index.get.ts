import type { BinanceExchangeInfo } from './types'

/**
 * 获取币安交易所信息
 * 返回交易所的交易规则和交易对信息
 * 使用: GET /exchanges/binance/exchangeInfo
 */
export default defineEventHandler(async () => {
  try {
    // 获取配置信息
    const config = useRuntimeConfig()
    const binanceApiUrl = config.binance?.binanceApiUrl

    // 构建请求URL
    const url = `${binanceApiUrl}/fapi/v1/exchangeInfo`

    // 发送请求到币安API
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // 检查HTTP响应状态
    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status}`)
    }

    // 解析响应数据
    const data = await response.json() as BinanceExchangeInfo

    const symbols = data.symbols.map(item => ({
      symbol: item.symbol,
      status: item.status,
      onboardDate: format(item.onboardDate, 'yyyy-MM-dd hh:mm'),
    })).filter(item => item.status === 'TRADING')

    // 返回成功响应
    return createSuccessResponse({
      total: symbols.length,
      rateLimits: data.rateLimits,
      symbols,
    }, '获取交易所信息成功')
  }
  catch (error) {
    // 返回错误响应
    return createErrorResponse(
      error instanceof Error ? error.message : '获取交易所信息失败',
      500,
    )
  }
})
