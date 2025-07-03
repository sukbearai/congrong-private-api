import type { 
  BybitApiResponse, 
  OpenInterestError 
} from '../../routes/exchanges/bybit/openInterest/types'

// 定义 JSON 存储 API 读取响应的类型
interface JsonStorageReadResponse {
  code: number
  message: string
  data?: {
    key: string
    data: any
    size: number
    lastModified?: string
  }
}

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

// 定义资金费率响应接口
interface FundingRateTickerResponse {
  category: string
  list: FundingRateTicker[]
}

interface FundingRateTicker {
  symbol: string
  lastPrice: string
  markPrice: string
  indexPrice: string
  prevPrice24h: string
  price24hPcnt: string
  highPrice24h: string
  lowPrice24h: string
  prevPrice1h: string
  openInterest: string
  openInterestValue: string
  turnover24h: string
  volume24h: string
  fundingRate: string
  nextFundingTime: string
  predictedDeliveryPrice: string
  basisRate: string
  basis: string
  deliveryFeeRate: string
  deliveryTime: string
  ask1Size: string
  bid1Price: string
  ask1Price: string
  bid1Size: string
  preOpenPrice: string
  preQty: string
  curPreListingPhase: string
}

// 资金费率历史记录（用于时间窗口分析）
interface FundingRateTimeSeriesRecord {
  symbol: string
  fundingRate: number
  timestamp: number
  nextFundingTime: number
}

// 处理后的资金费率数据
interface ProcessedFundingRateData {
  symbol: string
  fundingRate: number
  fundingRatePercent: number
  lastPrice: string
  markPrice: string
  nextFundingTime: string
  formattedNextFundingTime: string
  volume24h: string
  openInterest: string
  // 时间窗口分析数据
  windowAnalysis?: {
    windowMinutes: number
    oldestRate: number
    newestRate: number
    changeRate: number
    changeRatePercent: number
    maxRate: number
    minRate: number
    volatility: number
    recordCount: number
    isDirectionChange: boolean
    changeDirection: string
  }
}

// 资金费率历史记录（用于重复检测）
interface FundingRateHistoryRecord {
  symbol: string
  fundingRate: number
  changeRate: number
  notifiedAt: number
  nextFundingTime: number
  windowMinutes: number
}

// 数据文件结构
interface FundingRateDataFile {
  timeSeriesData: FundingRateTimeSeriesRecord[]
  historyRecords: FundingRateHistoryRecord[]
  lastUpdated: number
}

// 清理过期的时间序列记录
function cleanExpiredTimeSeriesRecords(records: FundingRateTimeSeriesRecord[], windowMinutes: number): FundingRateTimeSeriesRecord[] {
  const cutoffTime = Date.now() - (windowMinutes * 60 * 1000)
  return records.filter(record => record.timestamp > cutoffTime)
}

// 清理过期的历史记录（保留最近2小时的记录）
function cleanExpiredFundingRateRecords(records: FundingRateHistoryRecord[]): FundingRateHistoryRecord[] {
  const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000)
  return records.filter(record => record.notifiedAt > twoHoursAgo)
}

// 分析时间窗口内的资金费率变化
function analyzeTimeWindow(records: FundingRateTimeSeriesRecord[], windowMinutes: number) {
  if (records.length < 2) {
    return null
  }

  // 按时间排序
  const sortedRecords = records.sort((a, b) => a.timestamp - b.timestamp)
  
  const oldestRecord = sortedRecords[0]
  const newestRecord = sortedRecords[sortedRecords.length - 1]
  
  const changeRate = newestRecord.fundingRate - oldestRecord.fundingRate
  const changeRatePercent = Math.abs(changeRate) * 100
  
  const rates = sortedRecords.map(r => r.fundingRate)
  const maxRate = Math.max(...rates)
  const minRate = Math.min(...rates)
  const volatility = maxRate - minRate
  
  // 🔥 新增：方向性分析
  const isDirectionChange = (oldestRecord.fundingRate >= 0) !== (newestRecord.fundingRate >= 0)
  const changeDirection = changeRate > 0 ? 'increase' : 'decrease'
  
  return {
    windowMinutes,
    oldestRate: oldestRecord.fundingRate,
    newestRate: newestRecord.fundingRate,
    changeRate,
    changeRatePercent,
    maxRate,
    minRate,
    volatility,
    recordCount: sortedRecords.length,
    isDirectionChange,
    changeDirection
  }
}

// 生成资金费率数据指纹
function generateFundingRateFingerprint(symbol: string, fundingRate: number, nextFundingTime: number, windowMinutes: number): string {
  return `${symbol}_${Math.floor(fundingRate * 10000)}_${nextFundingTime}_${windowMinutes}m`
}

// 检查是否为重复资金费率警报
function isDuplicateFundingRateAlert(
  currentData: ProcessedFundingRateData,
  historyRecords: FundingRateHistoryRecord[]
): boolean {
  if (!currentData.windowAnalysis) return false
  
  const currentFingerprint = generateFundingRateFingerprint(
    currentData.symbol,
    currentData.fundingRate,
    parseInt(currentData.nextFundingTime),
    currentData.windowAnalysis.windowMinutes
  )
  
  const isDuplicate = historyRecords.some(record => {
    const historyFingerprint = generateFundingRateFingerprint(
      record.symbol,
      record.fundingRate,
      record.nextFundingTime,
      record.windowMinutes
    )
    return historyFingerprint === currentFingerprint
  })
  
  return isDuplicate
}

// 从API读取数据文件
async function loadDataFromAPI(): Promise<FundingRateDataFile> {
  const apiUrl = 'https://shebei.congrongtech.cn/telegram/upload'
  const dataKey = 'data/funding-rate-data'
  
  try {
    const response = await fetch(`${apiUrl}?key=${dataKey}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })
    
    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status}`)
    }
    
    const result = await response.json() as JsonStorageReadResponse
    
    if (result.code !== 0) {
      console.log('📁 数据文件不存在，返回空数据')
      return {
        timeSeriesData: [],
        historyRecords: [],
        lastUpdated: 0
      }
    }
    
    // 确保数据存在并且有正确的结构
    if (!result.data || !result.data.data) {
      console.log('📁 数据格式不正确，返回空数据')
      return {
        timeSeriesData: [],
        historyRecords: [],
        lastUpdated: 0
      }
    }
    
    const data = result.data.data as FundingRateDataFile
    console.log(`📁 从API读取数据: 时间序列${data.timeSeriesData.length}条, 历史记录${data.historyRecords.length}条`)
    return data
  } catch (error) {
    console.error('❌ 读取API数据文件失败:', error)
    return {
      timeSeriesData: [],
      historyRecords: [],
      lastUpdated: 0
    }
  }
}

// 保存数据到API
async function saveDataToAPI(data: FundingRateDataFile): Promise<void> {
  const apiUrl = 'https://shebei.congrongtech.cn/telegram/upload'
  const dataKey = 'data/funding-rate-data'
  
  try {
    data.lastUpdated = Date.now()
    
    const response = await fetch(`${apiUrl}?key=${dataKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
    
    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status}`)
    }
    
    const result = await response.json() as JsonStorageWriteResponse
    
    if (result.code !== 0) {
      throw new Error(`API 错误: ${result.message}`)
    }
    
    console.log(`💾 数据保存到API: 时间序列${data.timeSeriesData.length}条, 历史记录${data.historyRecords.length}条`)
  } catch (error) {
    console.error('❌ 保存API数据文件失败:', error)
    throw error
  }
}

export default defineTask({
  meta: {
    name: 'ol:funding-rate-alarm',
    description: '资金费率时间窗口变化监控报警',
  },
  async run() {
    const startTime = Date.now()
    
    try {
      // 配置要监控的币种
      const symbols = (await useStorage('db').getItem('telegram:ol') || []) as string[]
      const category = 'linear'
      
      // 配置监控参数
      const windowMinutes = 10 // 时间窗口：5分钟或15分钟
      const fundingRateThreshold = 0.005 // 0.5% 的资金费率变化阈值
      
      console.log(`🚀 资金费率监控任务开始 - 监控${symbols.length}个币种, 时间窗口${windowMinutes}分钟, 阈值${fundingRateThreshold * 100}%`)

      // 从API读取历史数据
      const dataFile = await loadDataFromAPI()
      let { timeSeriesData, historyRecords } = dataFile

      // 获取配置信息
      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl

      // 创建请求队列
      const requestQueue = new RequestQueue({
        maxRandomDelay: 5000,
        minDelay: 1000
      })

      // 创建获取单个symbol资金费率数据的函数
      const fetchSymbolFundingRate = async (symbol: string): Promise<ProcessedFundingRateData> => {
        return await requestQueue.add(async () => {
          // 构建查询参数
          const params = new URLSearchParams({
            category,
            symbol,
          })

          // 构建请求URL
          const url = `${bybitApiUrl}/v5/market/tickers?${params.toString()}`

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
          const apiResponse = await response.json() as BybitApiResponse & { result: FundingRateTickerResponse }

          // 检查API响应状态
          if (apiResponse.retCode !== 0) {
            throw new Error(`Bybit API 错误: ${apiResponse.retMsg}`)
          }

          // 处理数据
          if (!apiResponse.result.list || apiResponse.result.list.length === 0) {
            throw new Error('没有可用数据')
          }

          const ticker = apiResponse.result.list[0]
          const fundingRate = parseFloat(ticker.fundingRate)
          const fundingRatePercent = fundingRate * 100
          const currentTimestamp = Date.now()

          // 获取当前symbol的历史时间序列数据
          let symbolTimeSeriesData = timeSeriesData.filter(record => record.symbol === symbol)
          
          // 清理过期数据
          symbolTimeSeriesData = cleanExpiredTimeSeriesRecords(symbolTimeSeriesData, windowMinutes)
          
          // 添加当前数据点
          const newRecord: FundingRateTimeSeriesRecord = {
            symbol,
            fundingRate,
            timestamp: currentTimestamp,
            nextFundingTime: parseInt(ticker.nextFundingTime)
          }
          
          symbolTimeSeriesData.push(newRecord)
          
          // 分析时间窗口数据
          const windowAnalysis = analyzeTimeWindow(symbolTimeSeriesData, windowMinutes)
          
          // 更新时间序列数据
          timeSeriesData = [
            ...timeSeriesData.filter(record => record.symbol !== symbol),
            ...symbolTimeSeriesData
          ]
          
          // 清理所有symbol的过期数据
          timeSeriesData = timeSeriesData.filter(record => 
            record.timestamp > (currentTimestamp - (windowMinutes * 60 * 1000))
          )

          return {
            symbol,
            fundingRate,
            fundingRatePercent,
            lastPrice: ticker.lastPrice,
            markPrice: ticker.markPrice,
            nextFundingTime: ticker.nextFundingTime,
            formattedNextFundingTime: formatDateTime(parseInt(ticker.nextFundingTime)),
            volume24h: ticker.volume24h,
            openInterest: ticker.openInterest,
            windowAnalysis
          }
        })
      }

      // 获取所有symbols的资金费率数据
      const successful: ProcessedFundingRateData[] = []
      const failed: OpenInterestError[] = []

      for (const symbol of symbols) {
        try {
          const data = await fetchSymbolFundingRate(symbol)
          successful.push(data)
          const windowInfo = data.windowAnalysis 
            ? `(${windowMinutes}分钟变化: ${data.windowAnalysis.changeRatePercent.toFixed(4)}%)`
            : '(数据不足)'
          console.log(`✅ ${symbol}: 资金费率 ${data.fundingRatePercent.toFixed(4)}% ${windowInfo}`)
        } catch (error) {
          console.error(`❌ ${symbol} 资金费率数据获取失败: ${error instanceof Error ? error.message : '获取数据失败'}`)
          failed.push({
            symbol,
            error: error instanceof Error ? error.message : '获取数据失败'
          })
        }
      }

      console.log(`📊 获取结果: 成功${successful.length}个, 失败${failed.length}个`)

      // 如果所有请求都失败
      if (successful.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`所有数据获取失败，任务结束 (${executionTime}ms)`)
        return {
          result: 'error',
          executionTimeMs: executionTime
        }
      }

      // 🔥 更新过滤逻辑 - 考虑多种触发条件
      const filteredData = successful.filter(item => {
        if (!item.windowAnalysis) return false
        
        const analysis = item.windowAnalysis
        
        // 多重判断条件
        const absoluteChangeExceeds = Math.abs(analysis.changeRate) > fundingRateThreshold
        const volatilityExceeds = analysis.volatility > (fundingRateThreshold * 1.5) // 波动性阈值
        const hasDirectionChange = analysis.isDirectionChange && Math.abs(analysis.changeRate) > (fundingRateThreshold * 0.5)
        
        const shouldNotify = absoluteChangeExceeds || volatilityExceeds || hasDirectionChange
        
        if (shouldNotify) {
          const reasons = []
          if (absoluteChangeExceeds) reasons.push(`绝对变化${Math.abs(analysis.changeRate).toFixed(4)}`)
          if (volatilityExceeds) reasons.push(`高波动${analysis.volatility.toFixed(4)}`)
          if (hasDirectionChange) reasons.push('正负转换')
          
          console.log(`🔔 ${item.symbol} 触发警报: ${reasons.join(', ')}`)
        }
        
        return shouldNotify
      })

      console.log(`🔔 需要通知: ${filteredData.length}个币种`)

      // 清理过期的历史记录
      console.log(`📚 清理历史记录...`)
      const beforeCleanCount = historyRecords.length
      historyRecords = cleanExpiredFundingRateRecords(historyRecords)
      console.log(`📚 历史记录清理: ${beforeCleanCount} -> ${historyRecords.length}`)

      // 保存数据到API
      try {
        await saveDataToAPI({
          timeSeriesData,
          historyRecords,
          lastUpdated: Date.now()
        })
      } catch (error) {
        // console.error('❌ 保存数据到API失败:', error)
      }

      // 如果没有资金费率变化超过阈值
      if (filteredData.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`📋 任务完成 - 无需通知 (${executionTime}ms)`)
        return { 
          result: 'ok', 
          processed: symbols.length,
          successful: successful.length,
          failed: failed.length,
          message: `没有超过阈值的${windowMinutes}分钟资金费率变化，未发送消息`,
          executionTimeMs: executionTime
        }
      }

      // 检查重复数据
      const newAlerts = filteredData.filter(item => {
        const isDuplicate = isDuplicateFundingRateAlert(item, historyRecords)
        return !isDuplicate
      })

      console.log(`🔍 重复过滤: ${filteredData.length} -> ${newAlerts.length}`)

      // 如果没有新的警报数据
      if (newAlerts.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`📋 任务完成 - 重复数据过滤 (${executionTime}ms)`)
        return { 
          result: 'ok', 
          processed: symbols.length,
          successful: successful.length,
          failed: failed.length,
          filtered: filteredData.length,
          duplicates: filteredData.length,
          message: '检测到重复数据，未发送消息',
          executionTimeMs: executionTime
        }
      }

      // 🔥 更新消息构建 - 添加新指标
      let message = `💰 资金费率监控报告 (${windowMinutes}分钟窗口)\n⏰ ${formatCurrentTime()}\n\n`
      
      newAlerts.forEach((item: ProcessedFundingRateData) => {
        if (!item.windowAnalysis) return
        
        const analysis = item.windowAnalysis
        const changeIcon = analysis.changeRate > 0 ? '📈' : '📉'
        const fundingRateIcon = item.fundingRatePercent > 0 ? '🔴' : '🟢'
        
        message += `${changeIcon} ${item.symbol} ${fundingRateIcon}\n`
        message += `   当前费率: ${item.fundingRatePercent.toFixed(4)}%\n`
        message += `   ${windowMinutes}分钟前: ${(analysis.oldestRate * 100).toFixed(4)}%\n`
        message += `   变化: ${analysis.changeRate >= 0 ? '+' : ''}${(analysis.changeRate * 100).toFixed(4)}%\n`
        
        // 🔥 新增：方向性信息
        if (analysis.isDirectionChange) {
          message += `   ⚠️ 正负转换 (${analysis.oldestRate >= 0 ? '正→负' : '负→正'})\n`
        }
        
        message += `   波动性: ${(analysis.volatility * 100).toFixed(4)}%\n`
        message += `   最高/最低: ${(analysis.maxRate * 100).toFixed(4)}% / ${(analysis.minRate * 100).toFixed(4)}%\n`
        message += `   数据点: ${analysis.recordCount}个\n`
        message += `   下次结算: ${item.formattedNextFundingTime}\n`
        message += `   价格: $${parseFloat(item.lastPrice).toLocaleString()}\n\n`
      })
      
      console.log(`📤 发送Telegram消息 (${message.length}字符)`)
      
      // 发送消息到 Telegram
      await bot.api.sendMessage('-1002663808019', message)
      console.log(`✅ 消息发送成功`)
      
      // 记录新的通知历史
      const newHistoryRecords: FundingRateHistoryRecord[] = newAlerts.map(item => ({
        symbol: item.symbol,
        fundingRate: item.fundingRate,
        changeRate: item.windowAnalysis?.changeRate || 0,
        notifiedAt: Date.now(),
        nextFundingTime: parseInt(item.nextFundingTime),
        windowMinutes
      }))

      // 更新历史记录
      historyRecords.push(...newHistoryRecords)
      historyRecords = cleanExpiredFundingRateRecords(historyRecords)

      // 最终保存数据到API
      try {
        const res = await saveDataToAPI({
          timeSeriesData,
          historyRecords,
          lastUpdated: Date.now()
        })
        console.log(res,'数据保存成功')
      } catch (error) {
        // console.error('❌ 最终保存数据到API失败:', error)
      }

      console.log(`💾 历史记录已更新: ${historyRecords.length}条`)
      
      const executionTime = Date.now() - startTime
      console.log(`🎉 任务完成: 监控${symbols.length}个, 通知${newAlerts.length}个, 用时${executionTime}ms`)
      console.log(`📊 最终数据: 时间序列${timeSeriesData.length}条, 历史记录${historyRecords.length}条`)
      
      return { 
        result: 'ok', 
        processed: symbols.length,
        successful: successful.length,
        failed: failed.length,
        filtered: filteredData.length,
        newAlerts: newAlerts.length,
        duplicates: filteredData.length - newAlerts.length,
        historyRecords: historyRecords.length,
        timeSeriesRecords: timeSeriesData.length,
        windowMinutes,
        executionTimeMs: executionTime
      }
    }
    catch (error) {
      const executionTime = Date.now() - startTime
      console.error(`💥 资金费率监控任务失败: ${error instanceof Error ? error.message : '未知错误'} (${executionTime}ms)`)
      
      try {
        await bot.api.sendMessage('-1002663808019', `❌ 资金费率监控任务失败\n⏰ ${formatCurrentTime()}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch (botError) {
        console.error('❌ 发送错误消息失败:', botError)
      }
      
      return { 
        result: 'error',
        error: error instanceof Error ? error.message : '未知错误',
        executionTimeMs: executionTime
      }
    }
  },
})