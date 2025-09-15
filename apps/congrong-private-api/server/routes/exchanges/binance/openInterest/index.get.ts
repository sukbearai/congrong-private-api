import type { BinanceOpenInterest } from './types'

/**
 * 获取币安未平仓合约数量
 * 返回指定交易对的未平仓合约数量
 * 使用: GET /exchanges/binance/openInterest
 * 参数: symbol - 交易对名称，如 BTCUSDT
 */
export default defineEventHandler(async (event) => {
  try {
    // 获取查询参数
    const query = getQuery(event)
    const { binance } = useRuntimeConfig()

    // 验证参数
    const schema = z.object({
      symbol: z.string({
        required_error: '缺少必要参数 symbol',
      }),
    })

    const validationResult = schema.safeParse(query)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { symbol } = validationResult.data
    const binanceApiUrl = binance?.binanceApiUrl

    // 构建请求URL
    const url = `${binanceApiUrl}/fapi/v1/openInterest?symbol=${symbol}`

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
    const data = await response.json() as BinanceOpenInterest

    // 返回成功响应
    return createSuccessResponse({
      openInterest: data.openInterest,
      symbol: data.symbol,
      time: data.time,
    }, '获取未平仓合约数量成功')
  }
  catch (error) {
    // 返回错误响应
    return createErrorResponse(
      error instanceof Error ? error.message : '获取未平仓合约数量失败',
      500,
    )
  }
})
