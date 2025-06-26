import type { BybitApiResponse } from './types'

/**
 * 获取Bybit未平仓合约数量
 * 返回指定交易对的未平仓合约数量历史数据
 * 使用: GET /exchanges/bybit/openInterest
 * 参数: 
 *   - category: 产品类型 (linear, inverse)
 *   - symbol: 合约名称，如 BTCUSDT
 *   - intervalTime: 时间粒度 (5min, 15min, 30min, 1h, 4h, 1d)
 *   - startTime: 开始时间戳 (毫秒) - 可选
 *   - endTime: 结束时间戳 (毫秒) - 可选
 *   - limit: 每页数量限制 [1, 200] - 可选，默认50
 *   - cursor: 游标，用于翻页 - 可选
 */
export default defineEventHandler(async (event) => {
  try {
    // 获取查询参数
    const query = getQuery(event)

    // 验证参数
    const schema = z.object({
      category: z.enum(['linear', 'inverse'], {
        invalid_type_error: 'category 必须是 linear 或 inverse',
      }).default('linear'),
      symbol: z.string({
        required_error: '缺少必要参数 symbol',
      }),
      intervalTime: z.enum(['5min', '15min', '30min', '1h', '4h', '1d'], {
        invalid_type_error: 'intervalTime 必须是 5min, 15min, 30min, 1h, 4h, 1d 中的一个',
      }).default('5min'),
      startTime: z.string().optional().transform(val => val ? parseInt(val) : undefined),
      endTime: z.string().optional().transform(val => val ? parseInt(val) : undefined),
      limit: z.string().optional().transform(val => val ? parseInt(val) : 50),
      cursor: z.string().optional(),
    })

    const validationResult = schema.safeParse(query)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { category, symbol, intervalTime, startTime, endTime, limit, cursor } = validationResult.data

    // 验证limit范围
    if (limit && (limit < 1 || limit > 200)) {
      return createErrorResponse('limit 必须在 1-200 之间', 400)
    }

    // 获取配置信息
    const config = useRuntimeConfig()
    const bybitApiUrl = config.bybit?.bybitApiUrl

    // 构建查询参数
    const params = new URLSearchParams({
      category,
      symbol,
      intervalTime,
    })

    if (startTime) params.append('startTime', startTime.toString())
    if (endTime) params.append('endTime', endTime.toString())
    if (limit) params.append('limit', limit.toString())
    if (cursor) params.append('cursor', cursor)

    // 构建请求URL
    const url = `${bybitApiUrl}/v5/market/open-interest?${params.toString()}`

    // 发送请求到Bybit API
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
    const apiResponse = await response.json() as BybitApiResponse

    // 检查API响应状态
    if (apiResponse.retCode !== 0) {
      throw new Error(`Bybit API 错误: ${apiResponse.retMsg}`)
    }

    // 处理list中的时间戳
    const processedList = apiResponse.result.list.map((item, index) => {
      let changeRate = 0
      let changeAmount = 0
      let previousOpenInterest = 0

      // 计算相对于前一个数据点的变化（注意：数据是按时间倒序排列的）
      if (index < apiResponse.result.list.length - 1) {
        const nextItem = apiResponse.result.list[index + 1] // 时间上的前一个数据点
        const currentOI = parseFloat(item.openInterest)
        previousOpenInterest = parseFloat(nextItem.openInterest)

        changeAmount = currentOI - previousOpenInterest
        changeRate = previousOpenInterest !== 0 ? (changeAmount / previousOpenInterest) * 100 : 0
      }

      return {
        ...item,
        timestamp: item.timestamp,
        formattedTime: new Date(parseInt(item.timestamp)).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }),
        timestampMs: parseInt(item.timestamp),
        openInterestFloat: parseFloat(item.openInterest),
        previousOpenInterest,
        changeAmount: parseFloat(changeAmount.toFixed(8)),
        changeRate: parseFloat(changeRate.toFixed(4)), // 百分比，保留4位小数
        changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`
      }
    })

    // 返回成功响应
    return createSuccessResponse({
      category: apiResponse.result.category,
      symbol: apiResponse.result.symbol,
      list: processedList,
      nextPageCursor: apiResponse.result.nextPageCursor,
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