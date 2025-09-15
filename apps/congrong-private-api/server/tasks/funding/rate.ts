import type {
  BybitApiResponse,
  OpenInterestError,
} from '../../routes/exchanges/bybit/openInterest/types'
import { alertThresholds, getRetention } from '../../config/alertThresholds'
import { filterDuplicates } from '../../utils/alerts/dedupe'
import { appendEntry, assemble, buildHeader, splitMessage } from '../../utils/alerts/message'
import { fetchWithRetry } from '../../utils/fetchWithRetry'
import { buildFingerprint, createHistoryManager } from '../../utils/historyManager'
import { buildTaskResult } from '../../utils/taskResult'
import { getTelegramChannel } from '../../utils/telegram'

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
  formatCurrentTime: string
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

// 历史记录保留与去重由 HistoryManager 接管 (retention=2h)

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
  }
}

// 简化的重复检测函数
function isDuplicateAlert(
  currentData: ProcessedFundingRateData,
  historyRecords: FundingRateHistoryRecord[],
  threshold: number = 0.01, // 默认1%阈值
): boolean {
  if (!currentData.windowAnalysis) { return false }

  const currentSymbol = currentData.symbol
  const currentChangeRate = currentData.windowAnalysis.changeRate

  // 检查最近30分钟内是否有相似的警报
  const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000)

  return historyRecords.some((record) => {
    if (record.symbol !== currentSymbol) { return false }
    if (record.notifiedAt < thirtyMinutesAgo) { return false }

    // 使用与触发阈值相同的容忍度
    const isSimilar = Math.abs(record.changeRate - currentChangeRate) <= threshold

    if (isSimilar) {
      console.log(`🚫 ${currentSymbol} 检测到相似警报: 当前变化${(currentChangeRate * 100).toFixed(4)}%, 历史变化${(record.changeRate * 100).toFixed(4)}%`)
    }

    return isSimilar
  })
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
        lastUpdated: 0,
      }
    }

    // 确保数据存在并且有正确的结构
    if (!result.data || !result.data.data) {
      console.log('📁 数据格式不正确，返回空数据')
      return {
        timeSeriesData: [],
        historyRecords: [],
        lastUpdated: 0,
      }
    }

    const data = result.data.data as FundingRateDataFile
    console.log(`📁 从API读取数据: 时间序列${data.timeSeriesData.length}条, 历史记录${data.historyRecords.length}条`)
    return data
  }
  catch (error) {
    console.error('❌ 读取API数据文件失败:', error)
    return {
      timeSeriesData: [],
      historyRecords: [],
      lastUpdated: 0,
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
  }
  catch (error) {
    console.error('❌ 保存API数据文件失败:', error)
    throw error
  }
}

export default defineTask({
  meta: {
    name: 'funding:rate',
    description: '资金费率时间窗口变化监控报警',
  },
  async run() {
    const startTime = Date.now()

    try {
      // 配置要监控的币种
      const symbols = (await useStorage('db').getItem('telegram:ol') || []) as string[]
      const category = 'linear'

      if (!symbols.length) {
        return buildTaskResult({ startTime, result: 'ok', message: '无监控目标', counts: { processed: 0 } })
      }

      // 配置监控参数
      const windowMinutes = 2
      const fundingRateThreshold = alertThresholds.fundingRateWindowChange
      const taskName = 'funding:rate'
      const channelId = getTelegramChannel(taskName)

      console.log(`🚀 资金费率监控任务开始 - 监控${symbols.length}个币种, 时间窗口${windowMinutes}分钟, 阈值${fundingRateThreshold * 100}%`)

      // 从API读取历史数据（仅用于 timeSeriesData，历史记录改由 HistoryManager 管理）
      const dataFile = await loadDataFromAPI()
      let { timeSeriesData } = dataFile

      // 初始化 HistoryManager（2 小时保留）
      const historyManager = createHistoryManager<FundingRateHistoryRecord>({
        storage: useStorage('db'),
        key: 'telegram:funding_rate_history',
        retentionMs: getRetention('shortWindow'),
        // 指纹：symbol + windowMinutes + 下次结算时间(小时粒度) + notifiedAt（保证唯一，重复过滤走自定义逻辑）
        getFingerprint: r => buildFingerprint([
          r.symbol,
          r.windowMinutes,
          Math.floor(r.nextFundingTime / (60 * 60 * 1000)),
          r.notifiedAt,
        ]),
      })

      await historyManager.load()
      // 如果 KV 中还没有历史记录，尝试用旧 API 里的历史数据做一次迁移（平滑过渡）
      if (historyManager.getAll().length === 0 && dataFile.historyRecords?.length) {
        historyManager.addRecords(dataFile.historyRecords as FundingRateHistoryRecord[])
        await historyManager.persist()
        console.log('⬇️  已迁移旧历史记录到 HistoryManager:', dataFile.historyRecords.length)
      }

      // 获取配置信息
      const config = useRuntimeConfig()
      const bybitApiUrl = config.bybit?.bybitApiUrl

      // 创建请求队列
      const requestQueue = new RequestQueue({
        maxRandomDelay: 5000,
        minDelay: 1000,
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
          const response = await fetchWithRetry(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } }, { retries: 2, timeoutMs: 7000 })

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
          const fundingRate = Number.parseFloat(ticker.fundingRate)
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
            formatCurrentTime: formatDateTime(currentTimestamp),
            nextFundingTime: Number.parseInt(ticker.nextFundingTime),
          }

          symbolTimeSeriesData.push(newRecord)

          // 分析时间窗口数据
          const windowAnalysis = analyzeTimeWindow(symbolTimeSeriesData, windowMinutes)

          // 更新时间序列数据
          timeSeriesData = [
            ...timeSeriesData.filter(record => record.symbol !== symbol),
            ...symbolTimeSeriesData,
          ]

          // 清理所有symbol的过期数据
          timeSeriesData = timeSeriesData.filter(record =>
            record.timestamp > (currentTimestamp - (windowMinutes * 60 * 1000)),
          )

          return {
            symbol,
            fundingRate,
            fundingRatePercent,
            lastPrice: ticker.lastPrice,
            markPrice: ticker.markPrice,
            nextFundingTime: ticker.nextFundingTime,
            formattedNextFundingTime: formatDateTime(Number.parseInt(ticker.nextFundingTime)),
            volume24h: ticker.volume24h,
            openInterest: ticker.openInterest,
            windowAnalysis,
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
        }
        catch (error) {
          console.error(`❌ ${symbol} 资金费率数据获取失败: ${error instanceof Error ? error.message : '获取数据失败'}`)
          failed.push({
            symbol,
            error: error instanceof Error ? error.message : '获取数据失败',
          })
        }
      }

      console.log(`📊 获取结果: 成功${successful.length}个, 失败${failed.length}个`)

      // 如果所有请求都失败
      if (successful.length === 0) {
        return buildTaskResult({ startTime, result: 'error', counts: { processed: symbols.length, successful: 0, failed: failed.length }, message: '全部获取失败' })
      }

      // 简化过滤逻辑 - 只检查1%阈值
      const filteredData = successful.filter((item) => {
        if (!item.windowAnalysis) { return false }

        const analysis = item.windowAnalysis

        // 简化为只检查绝对变化是否超过1%阈值
        const absoluteChangeExceeds = Math.abs(analysis.changeRate) > fundingRateThreshold

        if (absoluteChangeExceeds) {
          console.log(`🔔 ${item.symbol} 触发警报: 变化${(analysis.changeRate * 100).toFixed(4)}% (阈值${fundingRateThreshold * 100}%)`)
        }

        return absoluteChangeExceeds
      })

      console.log(`🔔 需要通知: ${filteredData.length}个币种`)

      // 触发一次 prune（HistoryManager 自带 retention 裁剪）
      // 再次显式 load 以防意外（容错：如果上面某段提前 return 或 future 代码调整导致未加载）
      await historyManager.load()
      historyManager.prune()
      const historyRecords = historyManager.getAll()
      console.log(`📚 历史记录裁剪后剩余: ${historyRecords.length}`)

      // 保存数据到API
      try {
        await saveDataToAPI({
          timeSeriesData,
          historyRecords,
          lastUpdated: Date.now(),
        })
      }
      catch (error) {
        console.error('❌ 保存数据到API失败:', error)
      }

      // 如果没有资金费率变化超过阈值
      if (filteredData.length === 0) {
        return buildTaskResult({ startTime, result: 'ok', counts: { processed: symbols.length, successful: successful.length, failed: failed.length, filtered: 0, newAlerts: 0 }, message: `没有超过阈值的${windowMinutes}分钟资金费率变化，未发送消息` })
      }

      // 简化重复检测（仍旧基于窗口变化阈值 diff）
      const existingRecordsForDup = historyManager.getAll()
      const newAlerts = filteredData.filter((item, index) => {
        const isDup = isDuplicateAlert(item, existingRecordsForDup, fundingRateThreshold)
        if (isDup) {
          console.log(`🔍 [${index + 1}/${filteredData.length}] ${item.symbol} - 重复数据已过滤`)
        }
        else {
          console.log(`✅ [${index + 1}/${filteredData.length}] ${item.symbol} - 新警报数据`)
        }
        return !isDup
      })

      console.log(`🔍 重复过滤结果: 总数${filteredData.length} -> 新警报${newAlerts.length} (过滤掉${filteredData.length - newAlerts.length}个重复)`)

      // 如果没有新的警报数据
      if (newAlerts.length === 0) {
        return buildTaskResult({ startTime, result: 'ok', counts: { processed: symbols.length, successful: successful.length, failed: failed.length, filtered: filteredData.length, newAlerts: 0, duplicates: filteredData.length }, message: '检测到重复数据，未发送消息' })
      }

      // 简化消息构建
      // 二次软去重（近似变化幅度合并）
      const { fresh: finalAlerts, duplicates: softDup } = filterDuplicates(newAlerts, a => ({
        symbol: a.symbol,
        direction: a.windowAnalysis && a.windowAnalysis.changeRate > 0 ? 'up' : 'down',
        value: Number.parseFloat(String(a.windowAnalysis?.changeRate || 0)),
        timestamp: Date.now(),
      }), [], { lookbackMs: 15 * 60 * 1000, toleranceAbs: fundingRateThreshold / 4, directionSensitive: true })

      const lines: string[] = []
      lines.push(buildHeader(`💰 资金费率监控 (${windowMinutes}分钟窗口)`))
      for (const item of finalAlerts) {
        if (!item.windowAnalysis) { continue }
        const analysis = item.windowAnalysis
        const changeIcon = analysis.changeRate > 0 ? '📈' : '📉'
        const fundingRateIcon = item.fundingRatePercent > 0 ? '🔴' : '🟢'
        appendEntry(lines, `${changeIcon} ${item.symbol} ${fundingRateIcon}\n  当前: ${item.fundingRatePercent.toFixed(4)}%\n  ${windowMinutes}分钟前: ${(analysis.oldestRate * 100).toFixed(4)}%\n  变化: ${analysis.changeRate >= 0 ? '+' : ''}${(analysis.changeRate * 100).toFixed(4)}%\n  下次结算: ${item.formattedNextFundingTime}`)
      }
      const assembled = assemble(lines)
      const parts = splitMessage(assembled)
      for (const p of parts) { await bot.api.sendMessage(channelId, p) }
      console.log(`✅ 消息发送成功`)

      // 记录新的通知历史并写入 HistoryManager
      const newHistoryRecords: FundingRateHistoryRecord[] = newAlerts.map(item => ({
        symbol: item.symbol,
        fundingRate: item.fundingRate,
        changeRate: item.windowAnalysis?.changeRate || 0,
        notifiedAt: Date.now(),
        nextFundingTime: Number.parseInt(item.nextFundingTime),
        windowMinutes,
      }))
      if (newHistoryRecords.length) {
        historyManager.addRecords(newHistoryRecords)
        await historyManager.persist()
      }

      const historyRecordsAfterPersist = historyManager.getAll()

      // 最终保存数据到API
      try {
        await saveDataToAPI({
          timeSeriesData,
          // 为兼容旧数据结构，仍把最新历史记录快照写入 API 文件
          historyRecords: historyRecordsAfterPersist,
          lastUpdated: Date.now(),
        })
      }
      catch (error) {
        console.error('❌ 最终保存数据到API失败:', error)
      }

      console.log(`💾 历史记录已更新: ${historyRecordsAfterPersist.length}条 (新增 ${newHistoryRecords.length} 条)`)

      const executionTime = Date.now() - startTime
      console.log(`🎉 任务完成: 监控${symbols.length}个, 通知${newAlerts.length}个, 用时${executionTime}ms`)
      console.log(`📊 最终数据: 时间序列${timeSeriesData.length}条, 历史记录${historyRecordsAfterPersist.length}条`)

      return buildTaskResult({ startTime, result: 'ok', counts: { processed: symbols.length, successful: successful.length, failed: failed.length, filtered: filteredData.length, newAlerts: finalAlerts.length, duplicates: (filteredData.length - newAlerts.length) + softDup.length, historyRecords: historyRecordsAfterPersist.length, timeSeriesRecords: timeSeriesData.length }, meta: { windowMinutes } })
    }
    catch (error) {
      const executionTime = Date.now() - startTime
      console.error(`💥 资金费率监控任务失败: ${error instanceof Error ? error.message : '未知错误'} (${executionTime}ms)`)

      try {
        const channel = getTelegramChannel('funding:rate')
        await bot.api.sendMessage(channel, `❌ 资金费率监控任务失败\n⏰ ${formatCurrentTime()}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
      }
      catch (botError) {
        console.error('❌ 发送错误消息失败:', botError)
      }

      return buildTaskResult({ startTime, result: 'error', error: error instanceof Error ? error.message : '未知错误', message: '任务失败' })
    }
  },
})
