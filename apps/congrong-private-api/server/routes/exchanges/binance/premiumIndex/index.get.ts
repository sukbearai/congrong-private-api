import type { BinancePremiumIndex } from './types'

/**
 * 获取币安标记价格和资金费率
 * 返回交易对的标记价格、指数价格和资金费率信息
 * 使用: GET /exchanges/binance/premiumindex
 * 参数: symbol (可选) - 交易对名称，如 BTCUSDT
 */
export default defineEventHandler(async (event) => {
  try {
    // 获取查询参数
    const query = getQuery(event)
    const symbol = query.symbol as string | undefined

    // 获取配置信息
    const config = useRuntimeConfig()
    const binanceApiUrl = config.binance?.binanceApiUrl

    // 构建请求URL
    let url = `${binanceApiUrl}/fapi/v1/premiumIndex`

    // 如果提供了symbol参数，添加到请求URL中
    if (symbol) {
      url += `?symbol=${symbol}`
    }

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
    const data = await response.json() as BinancePremiumIndex[]

    // 返回成功响应
    return createSuccessResponse({
      total: data.length,
      premiumIndexes: data,
    }, '获取标记价格和资金费率成功')
  }
  catch (error) {
    // 返回错误响应
    return createErrorResponse(
      error instanceof Error ? error.message : '获取标记价格和资金费率失败',
      500,
    )
  }
})
