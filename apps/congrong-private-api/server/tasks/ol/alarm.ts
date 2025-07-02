import type { 
  BybitApiResponse, 
  ProcessedOpenInterestData, 
  OpenInterestLatestItem,
  OpenInterestError 
} from '../../routes/exchanges/bybit/openInterest/types'

// 定义历史记录接口
interface AlarmHistoryRecord {
  symbol: string
  timestamp: number
  openInterest: number
  changeRate: number
  notifiedAt: number
}

// 生成数据指纹，用于判断数据重复性
function generateDataFingerprint(symbol: string, timestamp: number, openInterest: number): string {
  return `${symbol}_${timestamp}_${Math.floor(openInterest)}`
}

// 检查是否为重复数据
function isDuplicateAlert(
  currentData: ProcessedOpenInterestData,
  historyRecords: AlarmHistoryRecord[]
): boolean {
  const currentFingerprint = generateDataFingerprint(
    currentData.symbol,
    currentData.latest.timestampMs,
    currentData.latest.openInterestFloat
  )
  
  console.log(`=== ${currentData.symbol} 重复检测 ===`)
  console.log(`当前指纹: ${currentFingerprint}`)
  console.log(`历史记录数量: ${historyRecords.length}`)
  
  // 检查历史记录中是否有相同的数据指纹
  const isDuplicate = historyRecords.some(record => {
    const historyFingerprint = generateDataFingerprint(
      record.symbol,
      record.timestamp,
      record.openInterest
    )
    const match = historyFingerprint === currentFingerprint
    if (match) {
      console.log(`找到匹配的历史指纹: ${historyFingerprint}`)
    }
    return match
  })
  
  console.log(`${currentData.symbol}: 重复检测结果 = ${isDuplicate}`)
  return isDuplicate
}

// 清理过期的历史记录（保留最近2小时的记录）
function cleanExpiredRecords(records: AlarmHistoryRecord[]): AlarmHistoryRecord[] {
  const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000)
  return records.filter(record => record.notifiedAt > twoHoursAgo)
}

export default defineTask({
  meta: {
    name: 'ol:alarm',
    description: '未平仓合约定时消息推送',
  },
  async run() {
    try {
      // 配置要监控的币种
      const symbols = (await useStorage('db').getItem('telegram:ol') || []) as []
      const category = 'linear'
      const intervalTime = '5min'
      
      // 配置监控时间间隔（分钟）
      const monitoringInterval = 15 // 可以设置为 5, 15, 30 等
      // 持仓变化率阈值
      const openInterestThreshold = 5
      
      // 根据监控间隔计算需要获取的数据条数
      const intervalMinutes = parseInt(intervalTime.replace('min', ''))
      const limit = Math.ceil(monitoringInterval / intervalMinutes) + 1 // +1 确保有足够数据
    
      console.log(`=== OI监控任务开始 ===`)
      console.log(`监控币种: ${symbols.join(', ')}`)
      console.log(`监控间隔: ${monitoringInterval}分钟`)
      console.log(`变化阈值: ${openInterestThreshold}%`)
      console.log(`数据条数: ${limit}`)

      // 获取配置信息
      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl

      // 初始化存储
      const storage = useStorage('db')
      const historyKey = 'telegram:ol_alarm_history'

      // 获取历史记录
      let historyRecords = (await storage.getItem(historyKey) || [] ) as AlarmHistoryRecord[]
      
      // 添加调试日志
      console.log(`=== 历史记录调试 ===`)
      console.log(`获取到的历史记录数量: ${historyRecords.length}`)
      if (historyRecords.length > 0) {
        console.log(`最近的记录:`, historyRecords.slice(0, 3))
      }
      
      // 清理过期记录
      historyRecords = cleanExpiredRecords(historyRecords)
      console.log(`清理后的历史记录数量: ${historyRecords.length}`)

      // 创建请求队列
      const requestQueue = new RequestQueue({
        maxRandomDelay: 5000,
        minDelay: 1000
      })

      // 创建获取单个symbol数据的函数
      const fetchSymbolData = async (symbol: string): Promise<ProcessedOpenInterestData> => {
        return await requestQueue.add(async () => {
          console.log(`开始获取 ${symbol} 数据...`)
          
          // 构建查询参数
          const params = new URLSearchParams({
            category,
            symbol,
            intervalTime,
            limit: limit.toString(),
          })

          // 构建请求URL
          const url = `${bybitApiUrl}/v5/market/open-interest?${params.toString()}`
          console.log(`请求URL: ${url}`)

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

          // 处理数据 - 计算指定时间间隔的变化
          if (!apiResponse.result.list || apiResponse.result.list.length === 0) {
            throw new Error('没有可用数据')
          }

          console.log(`${symbol}: 获取到 ${apiResponse.result.list.length} 条数据`)

          const latestItem = apiResponse.result.list[0]
          let changeRate = 0
          let changeAmount = 0
          let previousOpenInterest = 0

          // 计算目标时间间隔前的数据索引
          const targetIndex = Math.ceil(monitoringInterval / intervalMinutes)
          
          console.log(`${symbol}: 目标索引 = ${targetIndex}`)
          
          // 如果有足够的历史数据，计算变化率
          if (apiResponse.result.list.length > targetIndex) {
            const targetItem = apiResponse.result.list[targetIndex]
            const currentOI = parseFloat(latestItem.openInterest)
            previousOpenInterest = parseFloat(targetItem.openInterest)

            changeAmount = currentOI - previousOpenInterest
            changeRate = previousOpenInterest !== 0 ? (changeAmount / previousOpenInterest) * 100 : 0
            
            console.log(`${symbol}: 当前OI = ${currentOI}, 历史OI = ${previousOpenInterest}`)
            console.log(`${symbol}: 变化量 = ${changeAmount}, 变化率 = ${changeRate.toFixed(4)}%`)
          } else {
            console.log(`${symbol}: 数据不足，无法计算变化率`)
          }

          const processedItem: OpenInterestLatestItem = {
            ...latestItem,
            timestamp: latestItem.timestamp,
            formattedTime: new Date(parseInt(latestItem.timestamp)).toLocaleString('zh-CN', {
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

          console.log(`${symbol}: 处理完成，变化率 = ${processedItem.changeRate}%`)

          return {
            category: apiResponse.result.category,
            symbol: apiResponse.result.symbol,
            latest: processedItem,
            nextPageCursor: apiResponse.result.nextPageCursor,
          }
        })
      }

      // 获取所有symbols的数据 - 串行执行
      const successful: ProcessedOpenInterestData[] = []
      const failed: OpenInterestError[] = []

      for (const symbol of symbols) {
        try {
          const data = await fetchSymbolData(symbol)
          successful.push(data)
          console.log(`✅ ${symbol} 数据获取成功`)
        } catch (error) {
          console.error(`❌ ${symbol} 数据获取失败:`, error)
          failed.push({
            symbol,
            error: error instanceof Error ? error.message : '获取数据失败'
          })
        }
      }

      console.log(`=== 数据获取结果 ===`)
      console.log(`成功: ${successful.length}, 失败: ${failed.length}`)

      // 如果所有请求都失败
      if (successful.length === 0) {
        console.log('所有数据获取失败，任务结束')
        return {
          result: 'error'
        }
      }

      if(failed.length > 0) {
        console.log('部分数据获取失败，任务结束')
        return {
          result: 'error'
        }
      }

      // 过滤超过阈值的数据
      const filteredData = successful.filter(item => {
        const shouldNotify = Math.abs(item?.latest?.changeRate) > openInterestThreshold
        console.log(`=== ${item.symbol} 阈值检测 ===`)
        console.log(`变化率: ${item.latest.changeRate.toFixed(4)}%`)
        console.log(`绝对值: ${Math.abs(item.latest.changeRate).toFixed(4)}%`)
        console.log(`阈值: ${openInterestThreshold}%`)
        console.log(`比较结果: ${Math.abs(item.latest.changeRate).toFixed(4)} > ${openInterestThreshold} = ${shouldNotify}`)
        console.log(`应该通知: ${shouldNotify}`)
        return shouldNotify
      })

      console.log(`需要通知的币种数量: ${filteredData.length}`)
      filteredData.forEach(item => {
        console.log(`- ${item.symbol}: ${item.latest.changeRate.toFixed(2)}%`)
      })

      // 如果没有数据超过阈值，不发送消息
      if (filteredData.length === 0) {
        console.log(`没有超过阈值的变化，未发送消息 - ${new Date().toLocaleString('zh-CN')}`)
        return { 
          result: 'ok', 
          processed: symbols.length,
          successful: successful.length,
          failed: failed.length,
          message: '没有超过阈值的变化，未发送消息'
        }
      }

      // 检查重复数据，过滤掉已经通知过的数据
      const newAlerts = filteredData.filter(item => {
        const isDuplicate = isDuplicateAlert(item, historyRecords)
        console.log(`=== ${item.symbol} 重复检测结果: ${!isDuplicate ? '通过' : '被过滤'} ===`)
        return !isDuplicate
      })

      console.log(`经过重复过滤后的币种数量: ${newAlerts.length}`)

      // 如果没有新的警报数据，不发送消息
      if (newAlerts.length === 0) {
        console.log(`检测到重复OI数据，未发送消息 - ${new Date().toLocaleString('zh-CN')}`)
        return { 
          result: 'ok', 
          processed: symbols.length,
          successful: successful.length,
          failed: failed.length,
          filtered: filteredData.length,
          duplicates: filteredData.length,
          message: '检测到重复数据，未发送消息'
        }
      }

      // 构建消息
      let message = `📊 未平仓合约监控报告 (${monitoringInterval}分钟变化)\n⏰ ${new Date().toLocaleString('zh-CN')}\n\n`
      
      // 处理新的警报数据
      newAlerts.forEach((item: ProcessedOpenInterestData) => {
        const changeIcon = item.latest.changeRate > 0 ? '📈' : item.latest.changeRate < 0 ? '📉' : '➡️'
        
        message += `${changeIcon} ${item.symbol}\n`
        message += `   持仓: ${item.latest.openInterestFloat.toLocaleString()}\n`
        message += `   变化: ${item.latest.changeRateFormatted}\n`
        message += `   时间: ${item.latest.formattedTime}\n\n`
      })
      
      console.log(`准备发送消息到Telegram...`)
      console.log(`消息内容:`, message)
      
      // 发送消息到 Telegram
      await bot.api.sendMessage('-1002663808019', message)
      
      // 记录新的通知历史
      const newHistoryRecords: AlarmHistoryRecord[] = newAlerts.map(item => ({
        symbol: item.symbol,
        timestamp: item.latest.timestampMs,
        openInterest: item.latest.openInterestFloat,
        changeRate: item.latest.changeRate,
        notifiedAt: item.latest.timestampMs
      }))

      // 更新历史记录
      historyRecords.push(...newHistoryRecords)
      
      // 再次清理过期记录并保存
      historyRecords = cleanExpiredRecords(historyRecords)
      await storage.setItem(historyKey, historyRecords)

      console.log(`=== 任务完成 ===`)
      console.log(`发送通知: ${newAlerts.length} 个币种`)
      console.log(`历史记录总数: ${historyRecords.length}`)
      
      return { 
        result: 'ok', 
        processed: symbols.length,
        successful: successful.length,
        failed: failed.length,
        filtered: filteredData.length,
        newAlerts: newAlerts.length,
        duplicates: filteredData.length - newAlerts.length,
        historyRecords: historyRecords.length
      }
    }
    catch (error) {
      console.error('未平仓合约监控任务失败:', error)
      try {
        await bot.api.sendMessage('-1002663808019', `❌ 未平仓合约监控任务失败\n⏰ ${new Date().toLocaleString('zh-CN')}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      } catch (botError) {
        console.error('发送错误消息失败:', botError)
      }
      
      return { result: 'error' }
    }
  },
})