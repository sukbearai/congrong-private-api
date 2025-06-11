import type { BinanceTopLongShortAccountRatio } from './types'
import { z } from 'zod'

/**
 * 获取币安大户多空账户比率
 * 返回大户多空账户数比值、多仓账户数比例和空仓账户数比例
 * 使用: GET /exchanges/binance/topLongShortAccountRatio
 * 参数:
 *   symbol - 交易对名称，如 BTCUSDT
 *   period - 时间周期，如 "5m","15m","30m","1h","2h","4h","6h","12h","1d"
 *   limit - 返回数据条数，默认30，最大500
 *   startTime - 开始时间戳
 *   endTime - 结束时间戳
 */
export default defineEventHandler(async (event) => {
  try {
    // 获取查询参数
    const query = getQuery(event)

    // 验证参数
    const schema = z.object({
      symbol: z.string({
        required_error: '缺少必要参数 symbol',
      }),
      period: z.enum(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'], {
        required_error: '缺少必要参数 period',
        invalid_type_error: 'period 必须是有效的时间周期',
      }),
      limit: z.coerce.number().min(1).max(500).optional().default(30),
      startTime: z.coerce.number().optional(),
      endTime: z.coerce.number().optional(),
    })

    const validationResult = schema.safeParse(query)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { symbol, period, limit, startTime, endTime } = validationResult.data

    // 获取配置信息
    const config = useRuntimeConfig()
    const binanceApiUrl = config.binance?.binanceApiUrl

    // 构建请求URL
    let url = `${binanceApiUrl}/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`

    if (startTime) { url += `&startTime=${startTime}` }
    if (endTime) { url += `&endTime=${endTime}` }

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
    const data = await response.json() as BinanceTopLongShortAccountRatio[]

    // 返回成功响应
    return createSuccessResponse({
      total: data.length,
      ratios: data,
    }, '获取大户多空账户比率成功')
  }
  catch (error) {
    // 返回错误响应
    return createErrorResponse(
      error instanceof Error ? error.message : '获取大户多空账户比率失败',
      500,
    )
  }
})
