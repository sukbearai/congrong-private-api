import type { BybitApiResponse } from './types'
import type { 
  OpenInterestLatestItem, 
  ProcessedOpenInterestData, 
  OpenInterestError, 
  MultipleOpenInterestResponse 
} from './types'


// 创建全局请求队列实例
const requestQueue = new RequestQueue({ 
  maxRandomDelay: 5000, // 最大随机延迟5秒
  minDelay: 2000         // 最小延迟2秒
})

/**
 * 获取Bybit未平仓合约数量
 * 返回指定交易对的未平仓合约数量最新数据
 * 使用: GET /exchanges/bybit/openInterest
 * 参数: 
 *   - symbol: 合约名称，支持单个或多个（逗号分隔），如 BTCUSDT 或 BTCUSDT,ETHUSDT
 *   - category: 产品类型 (linear, inverse) - 可选，默认linear
 *   - intervalTime: 时间粒度 (5min, 15min, 30min, 1h, 4h, 1d) - 可选，默认5min
 *   - startTime: 开始时间戳 (毫秒) - 可选
 *   - endTime: 结束时间戳 (毫秒) - 可选
 *   - limit: 每页数量限制 [1, 200] - 可选，默认2（只需要最新的2条数据用于计算变化）
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
      }).transform(str => str.includes(',') ? str.split(',').map(s => s.trim()) : [str]),
      intervalTime: z.enum(['5min', '15min', '30min', '1h', '4h', '1d'], {
        invalid_type_error: 'intervalTime 必须是 5min, 15min, 30min, 1h, 4h, 1d 中的一个',
      }).default('5min'),
      startTime: z.string().optional().transform(val => val ? parseInt(val) : undefined),
      endTime: z.string().optional().transform(val => val ? parseInt(val) : undefined),
      limit: z.string().optional().transform(val => val ? parseInt(val) : 2), // 默认2条数据
      cursor: z.string().optional(),
    })

    const validationResult = schema.safeParse(query)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { category, symbol: symbols, intervalTime, startTime, endTime, limit, cursor } = validationResult.data

    // 验证symbols数量限制
    if (symbols.length > 10) {
      return createErrorResponse('最多支持同时查询10个交易对', 400)
    }

    // 验证limit范围
    if (limit && (limit < 1 || limit > 200)) {
      return createErrorResponse('limit 必须在 1-200 之间', 400)
    }

    // 获取配置信息
    const config = useRuntimeConfig()
    const bybitApiUrl = config.bybit?.bybitApiUrl

    // 创建获取单个symbol数据的函数
    const fetchSymbolData = async (symbol: string) => {
      return await requestQueue.add(async () => {
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

        return apiResponse
      })
    }

    // 处理数据的函数 - 只返回最新数据
    const processApiResponse = (apiResponse: BybitApiResponse): ProcessedOpenInterestData => {
      if (!apiResponse.result.list || apiResponse.result.list.length === 0) {
        throw new Error('没有可用数据')
      }

      // 只处理第一项（最新数据）
      const latestItem = apiResponse.result.list[0]
      let changeRate = 0
      let changeAmount = 0
      let previousOpenInterest = 0

      // 如果有第二项数据，计算变化率
      if (apiResponse.result.list.length > 1) {
        const previousItem = apiResponse.result.list[1]
        const currentOI = parseFloat(latestItem.openInterest)
        previousOpenInterest = parseFloat(previousItem.openInterest)

        changeAmount = currentOI - previousOpenInterest
        changeRate = previousOpenInterest !== 0 ? (changeAmount / previousOpenInterest) * 100 : 0
      }

      const processedItem: OpenInterestLatestItem = {
        ...latestItem,
        timestamp: latestItem.timestamp,
        formattedTime: new Date(parseInt(latestItem.timestamp)).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }),
        timestampMs: parseInt(latestItem.timestamp),
        openInterestFloat: parseFloat(latestItem.openInterest),
        previousOpenInterest,
        changeAmount: parseFloat(changeAmount.toFixed(8)),
        changeRate: parseFloat(changeRate.toFixed(4)),
        changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`
      }

      return {
        category: apiResponse.result.category,
        symbol: apiResponse.result.symbol,
        latest: processedItem, // 只返回最新的一项数据
        nextPageCursor: apiResponse.result.nextPageCursor,
      }
    }

    // 如果只有一个symbol，返回单个结果
    if (symbols.length === 1) {
      try {
        const apiResponse = await fetchSymbolData(symbols[0])
        const processedData = processApiResponse(apiResponse)
        
        return createSuccessResponse<ProcessedOpenInterestData>(processedData, '获取未平仓合约数量成功')
      } catch (error) {
        throw error
      }
    }

    // 多个symbol的情况，使用Promise.allSettled处理所有请求
    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        try {
          const apiResponse = await fetchSymbolData(symbol)
          return {
            success: true,
            symbol,
            data: processApiResponse(apiResponse)
          }
        } catch (error) {
          return {
            success: false,
            symbol,
            error: error instanceof Error ? error.message : '获取数据失败'
          }
        }
      })
    )

    // 分离成功和失败的结果
    const successful: ProcessedOpenInterestData[] = []
    const failed: OpenInterestError[] = []

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          successful.push(result.value.data)
        } else {
          failed.push({
            symbol: result.value.symbol,
            error: result.value.error
          })
        }
      } else {
        failed.push({
          symbol: 'unknown',
          error: result.reason instanceof Error ? result.reason.message : '请求失败'
        })
      }
    })

    // 如果所有请求都失败
    if (successful.length === 0) {
      return createErrorResponse('所有交易对数据获取失败', 500)
    }

    // 返回成功响应 - 只包含最新数据
    return createSuccessResponse<MultipleOpenInterestResponse>({
      list: successful,
      errors: failed.length > 0 ? failed : undefined,
      summary: {
        total: symbols.length,
        successful: successful.length,
        failed: failed.length
      }
    }, `获取未平仓合约数量完成: ${successful.length}/${symbols.length} 成功`)
  }
  catch (error) {
    // 返回错误响应
    return createErrorResponse(
      error instanceof Error ? error.message : '获取未平仓合约数量失败',
      500,
    )
  }
})