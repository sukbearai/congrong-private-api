import { formatDate } from 'date-fns'
import type { BybitApiResponse, KlineApiResponse } from './types'
import type { 
  InstrumentInfoItem, 
  InstrumentError, 
  KlineData
} from './types'

// 创建全局请求队列实例
const requestQueue = new RequestQueue({ 
  maxRandomDelay: 3000, // 最大随机延迟3秒
  minDelay: 1000        // 最小延迟1秒
})

/**
 * 获取Bybit合约信息和K线数据
 * 返回指定交易对的合约信息和完整K线数据
 * 使用: GET /exchanges/bybit/vwap
 * 参数: 
 *   - symbol: 合约名称，支持单个或多个（逗号分隔），如 BTCUSDT 或 BTCUSDT,ETHUSDT
 *   - category: 产品类型 (linear, inverse, spot) - 可选，默认linear
 *   - interval: 时间粒度 (1,3,5,15,30,60,120,240,360,720,D,M,W) - 可选，默认D
 *   - status: 合约状态过滤 (Trading, Settled, Closed) - 可选
 *   - baseCoin: 交易币种过滤 - 可选
 */
export default defineEventHandler(async (event) => {
  try {
    // 获取查询参数
    const query = getQuery(event)

    // 验证参数
    const schema = z.object({
      category: z.enum(['linear', 'inverse', 'spot'], {
        invalid_type_error: 'category 必须是 linear, inverse 或 spot',
      }).default('linear'),
      symbol: z.string({
        required_error: '缺少必要参数 symbol',
      }).transform(str => str.includes(',') ? str.split(',').map(s => s.trim()) : [str]),
      interval: z.enum(['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'M', 'W'], {
        invalid_type_error: 'interval 必须是有效的时间粒度',
      }).default('D'),
      status: z.enum(['Trading', 'Settled', 'Closed'], {
        invalid_type_error: 'status 必须是 Trading, Settled 或 Closed',
      }).optional(),
      baseCoin: z.string().optional(),
    })

    const validationResult = schema.safeParse(query)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { category, symbol: symbols, interval, status, baseCoin } = validationResult.data

    // 验证symbols数量限制
    if (symbols.length > 5) {
      return createErrorResponse('最多支持同时查询5个交易对', 400)
    }

    // 获取配置信息
    const config = useRuntimeConfig()
    const bybitApiUrl = config.bybit?.bybitApiUrl

    // 获取合约信息的函数（使用队列）
    const fetchInstrumentInfo = async (symbol: string) => {
      return await requestQueue.add(async () => {
        const params = new URLSearchParams({
          category,
          symbol,
        })

        if (status) params.append('status', status)
        if (baseCoin) params.append('baseCoin', baseCoin)

        const url = `${bybitApiUrl}/v5/market/instruments-info?${params.toString()}`

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          throw new Error(`HTTP 错误: ${response.status}`)
        }

        const apiResponse = await response.json() as BybitApiResponse

        if (apiResponse.retCode !== 0) {
          throw new Error(`Bybit API 错误: ${apiResponse.retMsg}`)
        }

        return apiResponse
      })
    }

    // 获取K线数据的函数（使用队列）
    const fetchKlineData = async (symbol: string, start: number, end: number): Promise<string[][]> => {
      return await requestQueue.add(async () => {
        const params = new URLSearchParams({
          category,
          symbol,
          interval,
          start: start.toString(),
          end: end.toString(),
          limit: '1000'
        })

        const url = `${bybitApiUrl}/v5/market/kline?${params.toString()}`

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          throw new Error(`K线数据HTTP错误: ${response.status}`)
        }

        const apiResponse = await response.json() as KlineApiResponse

        if (apiResponse.retCode !== 0) {
          throw new Error(`K线数据API错误: ${apiResponse.retMsg}`)
        }

        return apiResponse.result.list || []
      })
    }

    // 获取完整K线数据的函数
    const fetchAllKlineData = async (symbol: string, launchTime: number): Promise<KlineData[]> => {
      const allKlineData: string[][] = []
      let currentEnd = Date.now()
      let currentStart = launchTime

      while (true) {
        // 每次K线请求都通过队列处理
        const klineData = await fetchKlineData(symbol, currentStart, currentEnd)
        
        if (klineData.length === 0) {
          break
        }

        allKlineData.push(...klineData)

        // 如果返回的数据少于1000条，说明已经获取完所有数据
        if (klineData.length < 1000) {
          break
        }

        // 更新时间范围，继续获取更早的数据
        const earliestTime = parseInt(klineData[klineData.length - 1][0])
        currentEnd = earliestTime - 1
      }

      // 转换为KlineData格式并按时间正序排列
      return allKlineData
        .map(item => ({
          startTime: parseInt(item[0]),
          openPrice: parseFloat(item[1]),
          highPrice: parseFloat(item[2]),
          lowPrice: parseFloat(item[3]),
          closePrice: parseFloat(item[4]),
          volume: parseFloat(item[5]),
          turnover: parseFloat(item[6]),
          formattedTime: formatDateTime(parseInt(item[0]))
        }))
        .sort((a, b) => a.startTime - b.startTime)
    }

    // 处理单个symbol的完整流程
    const processSymbolData = async (symbol: string) => {
      // 1. 获取合约信息（通过队列）
      const instrumentResponse = await fetchInstrumentInfo(symbol)
      
      if (!instrumentResponse.result.list || instrumentResponse.result.list.length === 0) {
        throw new Error('没有可用的合约信息')
      }

      const instrumentInfo = instrumentResponse.result.list[0]
      const launchTime = parseInt(instrumentInfo.launchTime)

      // 2. 获取完整K线数据（每个请求都通过队列）
      const klineData = await fetchAllKlineData(symbol, launchTime)

      // 3. 处理合约信息
      const processedItem: InstrumentInfoItem = {
        ...instrumentInfo,
        launchTime: instrumentInfo.launchTime,
        launchTimeMs: launchTime,
        formattedLaunchTime: new Date(launchTime).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }),
        daysFromLaunch: Math.floor((Date.now() - launchTime) / (1000 * 60 * 60 * 24)),
        priceScaleNumber: parseInt(instrumentInfo.priceScale),
        tickSizeFloat: parseFloat(instrumentInfo.priceFilter.tickSize),
        minOrderQtyFloat: parseFloat(instrumentInfo.lotSizeFilter.minOrderQty),
        maxOrderQtyFloat: parseFloat(instrumentInfo.lotSizeFilter.maxOrderQty),
      }

      return {
        category: instrumentResponse.result.category,
        symbol: instrumentInfo.symbol,
        instrumentInfo: processedItem,
        klineData: {
          interval,
          total: klineData.length,
          data: klineData
        }
      }
    }

    // 如果只有一个symbol
    if (symbols.length === 1) {
      const result = await processSymbolData(symbols[0])
      return createSuccessResponse(result, '获取合约信息和K线数据成功')
    }

    // 多个symbol的情况，使用Promise.allSettled并行处理（但每个请求内部使用队列）
    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        try {
          const result = await processSymbolData(symbol)
          return {
            success: true,
            symbol,
            data: result
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
    const successful: any[] = []
    const failed: InstrumentError[] = []

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

    // 返回成功响应
    return createSuccessResponse({
      list: successful,
      errors: failed.length > 0 ? failed : undefined,
      summary: {
        total: symbols.length,
        successful: successful.length,
        failed: failed.length
      }
    }, `获取合约信息和K线数据完成: ${successful.length}/${symbols.length} 成功`)

  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '获取数据失败',
      500,
    )
  }
})