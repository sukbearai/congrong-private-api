import type { BybitApiResponse, KlineApiResponse } from './types'
import type { 
  InstrumentInfoItem, 
  InstrumentError, 
  KlineData,
  VWAPData,
  VWAPCalculation
} from './types'

// 定义 JSON 存储 API 写入响应的类型
interface JsonStorageWriteResponse {
  code: number
  message: string
  data?: {
    key: string
    size: number
    timestamp: string
  }
}

// 创建全局请求队列实例
const requestQueue = new RequestQueue({ 
  maxRandomDelay: 3000, // 最大随机延迟3秒
  minDelay: 1000        // 最小延迟1秒
})

// 保存K线数据到API
async function saveKlineDataToAPI(symbol: string, klineData: KlineData[], vwapCalculation: VWAPCalculation, interval: string, timeRange: any): Promise<void> {
  const apiUrl = 'https://shebei.congrongtech.cn/telegram/upload'
  const dataKey = `data/kline-vwap-${symbol.toLowerCase()}-${interval}`
  
  try {
    const saveData = {
      symbol,
      interval,
      dataCount: klineData.length,
      lastUpdated: Date.now(),
      formattedLastUpdated: formatDateTime(Date.now()),
      timeRange: {
        startTime: klineData[0]?.startTime || 0,
        endTime: klineData[klineData.length - 1]?.startTime || 0,
        formattedStartTime: klineData[0]?.formattedTime || '',
        formattedEndTime: klineData[klineData.length - 1]?.formattedTime || '',
        ...timeRange
      },
      klineData: klineData.map(candle => ({
        timestamp: candle.startTime,
        formattedTime: candle.formattedTime,
        open: candle.openPrice,
        high: candle.highPrice,
        low: candle.lowPrice,
        close: candle.closePrice,
        volume: candle.volume,
        turnover: candle.turnover
      }))
    }
    
    const response = await fetch(`${apiUrl}?key=${dataKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(saveData),
    })
    
    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status}`)
    }
    
    const result = await response.json() as JsonStorageWriteResponse
    
    if (result.code !== 0) {
      throw new Error(`API 错误: ${result.message}`)
    }
    
    console.log(`💾 ${symbol} (${interval}) K线和VWAP数据保存成功: ${klineData.length}条K线数据`)
  } catch (error) {
    console.error(`❌ ${symbol} (${interval}) 保存K线数据失败:`, error)
    // 不抛出错误，避免影响主流程
  }
}

// 计算VWAP的函数
const calculateVWAP = (klineData: KlineData[]): VWAPCalculation => {
  let totalVolume = 0 // 总成交量
  let totalTurnover = 0 // 总成交额
  
  // 按时间段计算的VWAP数据
  const vwapByPeriod: VWAPData[] = []
  
  // 累计计算
  let cumulativeVolume = 0
  let cumulativeTurnover = 0
  
  klineData.forEach((candle, index) => {
    // 典型价格 (High + Low + Close) / 3，仅用于参考
    const typicalPrice = (candle.highPrice + candle.lowPrice + candle.closePrice) / 3
    
    // 累计数据 - 使用实际成交数据
    cumulativeVolume += candle.volume
    cumulativeTurnover += candle.turnover
    
    // 累计VWAP = 累计成交额 / 累计成交量（基于真实成交数据）
    const cumulativeVWAP = cumulativeVolume > 0 ? cumulativeTurnover / cumulativeVolume : 0
    
    // 当前周期VWAP（基于实际成交计算）
    const periodVWAP = candle.volume > 0 ? candle.turnover / candle.volume : candle.closePrice
    
    vwapByPeriod.push({
      timestamp: candle.startTime,
      formattedTime: candle.formattedTime,
      typicalPrice: parseFloat(typicalPrice.toFixed(8)),
      volume: candle.volume,
      turnover: candle.turnover,
      periodVWAP: parseFloat(periodVWAP.toFixed(8)),
      cumulativeVWAP: parseFloat(cumulativeVWAP.toFixed(8)),
      cumulativeVolume: parseFloat(cumulativeVolume.toFixed(8)),
      cumulativeTurnover: parseFloat(cumulativeTurnover.toFixed(8)),
      // 价格偏离度基于真实VWAP计算
      priceDeviation: candle.closePrice > 0 ? parseFloat(((cumulativeVWAP - candle.closePrice) / candle.closePrice * 100).toFixed(4)) : 0,
      // 当前价格相对VWAP的位置
      pricePosition: candle.closePrice > cumulativeVWAP ? 'above' : candle.closePrice < cumulativeVWAP ? 'below' : 'equal'
    })
  })
  
  // 最终总计算
  totalVolume = cumulativeVolume
  totalTurnover = cumulativeTurnover
  
  // 最终VWAP = 总成交额 / 总成交量
  const finalVWAP = totalVolume > 0 ? totalTurnover / totalVolume : 0
  
  // 获取价格范围
  const prices = klineData.map(k => k.closePrice)
  const highestPrice = Math.max(...prices)
  const lowestPrice = Math.min(...prices)
  const currentPrice = prices[prices.length - 1]
  
  // 计算统计信息
  const aboveVWAPCount = vwapByPeriod.filter(v => v.pricePosition === 'above').length
  const belowVWAPCount = vwapByPeriod.filter(v => v.pricePosition === 'below').length
  
  return {
    // 最终VWAP结果 - 基于真实成交数据
    finalVWAP: parseFloat(finalVWAP.toFixed(8)),
    turnoverBasedVWAP: parseFloat(finalVWAP.toFixed(8)), // 与finalVWAP相同，因为都基于turnover
    
    // 统计信息
    totalVolume: parseFloat(totalVolume.toFixed(8)),
    totalTurnover: parseFloat(totalTurnover.toFixed(8)),
    totalValue: parseFloat(totalTurnover.toFixed(8)), // 使用实际成交额
    periodCount: klineData.length,
    
    // 价格信息
    currentPrice: parseFloat(currentPrice.toFixed(8)),
    highestPrice: parseFloat(highestPrice.toFixed(8)),
    lowestPrice: parseFloat(lowestPrice.toFixed(8)),
    
    // 偏离度分析
    currentDeviation: currentPrice > 0 ? parseFloat(((finalVWAP - currentPrice) / currentPrice * 100).toFixed(4)) : 0,
    maxDeviation: Math.max(...vwapByPeriod.map(v => Math.abs(v.priceDeviation))),
    
    // 市场趋势分析
    aboveVWAPPercentage: parseFloat((aboveVWAPCount / vwapByPeriod.length * 100).toFixed(2)),
    belowVWAPPercentage: parseFloat((belowVWAPCount / vwapByPeriod.length * 100).toFixed(2)),
    
    // 时间范围
    startTime: klineData[0]?.startTime || 0,
    endTime: klineData[klineData.length - 1]?.startTime || 0,
    
    // 详细数据
    vwapByPeriod: vwapByPeriod
  }
}

/**
 * 获取Bybit合约信息和K线数据，并计算VWAP
 * 返回指定交易对的合约信息、完整K线数据和VWAP计算结果
 * 使用: GET /exchanges/bybit/vwap
 * 参数: 
 *   - symbol: 合约名称，支持单个或多个（逗号分隔），如 BTCUSDT 或 BTCUSDT,ETHUSDT
 *   - category: 产品类型 (linear, inverse, spot) - 可选，默认linear
 *   - interval: 时间粒度 (1,3,5,15,30,60,120,240,360,720,D,M,W) - 可选，默认1（1分钟，最精确）
 *   - status: 合约状态过滤 (Trading, Settled, Closed) - 可选
 *   - baseCoin: 交易币种过滤 - 可选
 *   - includeDetails: 是否包含详细的VWAP计算过程 - 可选，默认false
 *   - startTime: K线数据起始时间（毫秒时间戳）- 可选，默认使用合约上线时间(launchTime)
 *   - endTime: K线数据结束时间（毫秒时间戳）- 可选，默认使用当前时间
 *   - saveData: 是否保存数据到API - 可选，默认false
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
      }).default('1'), // 默认1分钟，获取最精确的VWAP
      status: z.enum(['Trading', 'Settled', 'Closed'], {
        invalid_type_error: 'status 必须是 Trading, Settled 或 Closed',
      }).optional(),
      baseCoin: z.string().optional(),
      includeDetails: z.string().optional().transform(val => val === 'true'),
      saveData: z.string().optional().transform(val => val === 'true'),
      // 新增参数：自定义起始时间
      startTime: z.string().optional().transform(val => {
        if (!val) return undefined
        const timestamp = parseInt(val)
        if (isNaN(timestamp)) {
          throw new Error('startTime 必须是有效的时间戳')
        }
        return timestamp
      }),
      // 新增参数：自定义结束时间
      endTime: z.string().optional().transform(val => {
        if (!val) return undefined
        const timestamp = parseInt(val)
        if (isNaN(timestamp)) {
          throw new Error('endTime 必须是有效的时间戳')
        }
        return timestamp
      }),
    })

    const validationResult = schema.safeParse(query)

    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => err.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { 
      category, 
      symbol: symbols, 
      interval, 
      status, 
      baseCoin, 
      includeDetails,
      saveData,
      startTime: customStartTime,
      endTime: customEndTime
    } = validationResult.data

    // 验证symbols数量限制
    if (symbols.length > 3) {
      return createErrorResponse('计算VWAP时最多支持同时查询3个交易对', 400)
    }

    // 验证时间范围的合理性
    if (customStartTime && customEndTime && customStartTime >= customEndTime) {
      return createErrorResponse('起始时间必须小于结束时间', 400)
    }

    // 获取配置信息
    const config = useRuntimeConfig()
    const bybitApiUrl = config.bybit?.bybitApiUrl

    if (!bybitApiUrl) {
      return createErrorResponse('Bybit API URL 配置未找到', 500)
    }

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

    // 获取完整K线数据的函数 - 简化分页逻辑
    const fetchAllKlineData = async (symbol: string, launchTime: number): Promise<KlineData[]> => {
      const allKlineData: string[][] = []
      
      // 使用自定义时间范围，如果没有提供则使用默认值
      let targetStartTime = customStartTime || launchTime
      let targetEndTime = customEndTime || Date.now()
      
      // 如果自定义起始时间早于合约上线时间，则使用合约上线时间
      if (targetStartTime < launchTime) {
        console.warn(`自定义起始时间早于合约上线时间，将使用合约上线时间`)
        targetStartTime = launchTime
      }

      // 从目标结束时间开始，向历史时间倒推获取数据
      let currentEndTime = targetEndTime
      const finalStartTime = targetStartTime
      
      // 每次获取的时间跨度（分钟）
      const batchMinutes = 1000 // 对应limit=1000的1分钟K线
      const batchMilliseconds = batchMinutes * 60 * 1000

      // 添加数据获取限制，防止过量请求
      let requestCount = 0
      const maxRequests = 1000

      console.log(`开始获取 ${symbol} 的K线数据`)
      console.log(`目标时间范围: ${formatDateTime(targetStartTime)} 到 ${formatDateTime(targetEndTime)}`)

      while (requestCount < maxRequests) {
        // 计算当前批次的开始时间
        let currentStartTime = currentEndTime - batchMilliseconds
        
        // 如果计算出的开始时间小于目标开始时间，则使用目标开始时间
        if (currentStartTime < finalStartTime) {
          currentStartTime = finalStartTime
        }

        // 获取当前时间窗口的数据
        const klineData = await fetchKlineData(symbol, currentStartTime, currentEndTime)
        requestCount++
        
        console.log(`第${requestCount}次请求 ${symbol}`)
        console.log(`时间范围: ${formatDateTime(currentStartTime)} - ${formatDateTime(currentEndTime)}`)
        console.log(`获取到 ${klineData.length} 条K线数据`)
        
        if (klineData.length === 0) {
          console.log(`${symbol} 没有更多数据，停止获取`)
          break
        }

        // 添加到总数据中
        allKlineData.push(...klineData)

        // 如果当前开始时间已经达到目标开始时间，说明获取完成
        if (currentStartTime <= finalStartTime) {
          console.log(`${symbol} 已到达目标起始时间，数据获取完成`)
          break
        }
        
        // 更新下次循环的结束时间为当前循环的开始时间
        currentEndTime = currentStartTime
        
        console.log(`下次请求结束时间: ${formatDateTime(currentEndTime)}`)
      }

      console.log(`${symbol} K线数据获取完成，共 ${requestCount} 次请求，获取到 ${allKlineData.length} 条原始数据`)

      // 转换为KlineData格式并去重、排序
      const processedData = allKlineData
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
        // 严格过滤时间范围
        .filter(item => {
          return item.startTime >= targetStartTime && item.startTime <= targetEndTime
        })
        // 去重：使用 Map 确保每个时间戳只有一条数据
        .reduce((acc, item) => {
          acc.set(item.startTime, item)
          return acc
        }, new Map())

      // 转换回数组并按时间正序排列
      const finalData = Array.from(processedData.values()).sort((a, b) => a.startTime - b.startTime)

      console.log(`${symbol} 处理后的K线数据: ${finalData.length} 条`)
      console.log(`实际时间范围: ${finalData[0]?.formattedTime} 到 ${finalData[finalData.length - 1]?.formattedTime}`)
      console.log(`目标时间范围: ${formatDateTime(targetStartTime)} 到 ${formatDateTime(targetEndTime)}`)

      return finalData
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

      if (klineData.length === 0) {
        throw new Error('没有可用的K线数据')
      }

      // 3. 计算VWAP
      const vwapCalculation = calculateVWAP(klineData)

      // 4. 计算实际使用的时间范围
      const actualStartTime = customStartTime && customStartTime >= launchTime ? customStartTime : launchTime
      const actualEndTime = customEndTime || Date.now()
      
      const timeRange = {
        requestedStartTime: customStartTime,
        requestedEndTime: customEndTime,
        actualStartTime: actualStartTime,
        actualEndTime: actualEndTime,
        contractLaunchTime: launchTime,
        formattedActualStartTime: formatDateTime(actualStartTime),
        formattedActualEndTime: formatDateTime(actualEndTime),
        formattedContractLaunchTime: formatDateTime(launchTime),
        isCustomRange: !!(customStartTime || customEndTime),
        durationDays: Math.floor((actualEndTime - actualStartTime) / (1000 * 60 * 60 * 24))
      }

      // 5. 保存K线数据到API（如果启用）
      if (saveData) {
        try {
          await saveKlineDataToAPI(symbol, klineData, vwapCalculation, interval, timeRange)
        } catch (error) {
          console.warn(`⚠️ ${symbol} 数据保存失败，但不影响返回结果:`, error)
        }
      }

      // 6. 处理合约信息
      const processedItem: InstrumentInfoItem = {
        ...instrumentInfo,
        launchTime: instrumentInfo.launchTime,
        launchTimeMs: launchTime,
        formattedLaunchTime: formatDateTime(launchTime),
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
          timeRange,
          data: includeDetails ? klineData : []
        },
        vwap: {
          ...vwapCalculation,
          vwapByPeriod: includeDetails ? vwapCalculation.vwapByPeriod : []
        },
        dataSaved: saveData
      }
    }

    // 如果只有一个symbol
    if (symbols.length === 1) {
      const result = await processSymbolData(symbols[0])
      const message = `获取 ${symbols[0]} 合约信息、K线数据和VWAP计算完成${saveData ? '，数据已保存' : ''}`
      return createSuccessResponse(result, message)
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
    const message = `获取合约信息、K线数据和VWAP计算完成: ${successful.length}/${symbols.length} 成功${saveData ? '，数据已保存' : ''}`
    return createSuccessResponse({
      list: successful,
      errors: failed.length > 0 ? failed : undefined,
      summary: {
        total: symbols.length,
        successful: successful.length,
        failed: failed.length,
        interval,
        includeDetails,
        saveData,
        timeRange: {
          customStartTime,
          customEndTime,
          isCustomRange: !!(customStartTime || customEndTime)
        }
      }
    }, message)

  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '获取数据失败',
      500,
    )
  }
})