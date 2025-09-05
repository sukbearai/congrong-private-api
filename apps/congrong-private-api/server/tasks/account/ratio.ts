import type { OpenInterestError } from '../../routes/exchanges/bybit/openInterest/types'
import { createHistoryManager, buildFingerprint } from '../../utils/historyManager'

// 定义大户多空比值数据接口
interface LongShortRatioItem {
  symbol: string
  longShortRatio: string
  longAccount: string
  shortAccount: string
  timestamp: string
  // 计算字段
  timestampMs: number
  formattedTime: string
  longShortRatioFloat: number
  longAccountFloat: number
  shortAccountFloat: number
  changeRate: number
  previousRatio: number
  changeAmount: number
  changeRateFormatted: string
}

interface ProcessedLongShortRatioData {
  symbol: string
  latest: LongShortRatioItem
}

// 定义历史记录接口（用于 HistoryManager）
interface LongShortRatioHistoryRecord {
  symbol: string
  timestamp: number
  longShortRatio: number
  changeRate: number
  notifiedAt: number
}

export default defineTask({
  meta: {
    name: 'account:ratio',
    description: '大户多空账户数比值定时消息推送',
  },
  async run() {
    const startTime = Date.now()

    try {
      // 配置要监控的币种
      const symbols = (await useStorage('db').getItem('telegram:ol') || []) as string[]
      const period = '5m' // 可选: "5m","15m","30m","1h","2h","4h","6h","12h","1d"

      // 配置监控时间间隔（分钟）
      const monitoringInterval = 15 // 可以设置为5, 15, 30, 60 等
      // 多空比变化率阈值
      const ratioChangeThreshold = 20 // 20% 的变化率阈值，比较合理

      // 根据监控间隔计算需要获取的数据条数
      const periodMinutes = period === '5m' ? 5 : period === '15m' ? 15 : period === '30m' ? 30 : 60
      const limit = Math.ceil(monitoringInterval / periodMinutes) + 1 // +1 确保有足够数据

      console.log(`🚀 大户多空比监控任务开始 - 监控${symbols.length}个币种, 阈值${ratioChangeThreshold}%`)

      // 获取配置信息
      const config = useRuntimeConfig()
      const binanceApiUrl = config.binance.binanceApiUrl // Binance Futures API

      // 初始化 HistoryManager（仅在真正需要通知时才会触发 load/persist）
      const storage = useStorage('db')
      const historyManager = createHistoryManager<LongShortRatioHistoryRecord>({
        storage,
        key: 'telegram:longShortRatio_alarm_history',
        retentionMs: 2 * 60 * 60 * 1000, // 2小时
        getFingerprint: r => buildFingerprint([r.symbol, r.timestamp, Math.floor(r.longShortRatio * 10000)])
        // debug: true,
      })

      // 创建请求队列
      const requestQueue = new RequestQueue({
        maxRandomDelay: 5000,
        minDelay: 1000
      })

      // 创建获取单个symbol数据的函数
      const fetchSymbolData = async (symbol: string): Promise<ProcessedLongShortRatioData> => {
        return await requestQueue.add(async () => {
          // 构建查询参数
          const params = new URLSearchParams({
            symbol,
            period,
            limit: limit.toString(),
          })

          // 构建请求URL
          const url = `${binanceApiUrl}/futures/data/topLongShortAccountRatio?${params.toString()}`

          // 发送请求到Binance API
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
          let apiResponse = (await response.json() as LongShortRatioItem[])

          // 反转数组，使最新数据在前
          apiResponse = apiResponse.reverse()

          // 检查API响应
          if (!apiResponse || apiResponse.length === 0) {
            throw new Error('没有可用数据')
          }

          // 处理数据 - 计算指定时间间隔的变化
          const latestItem = apiResponse[0]
          let changeRate = 0
          let changeAmount = 0
          let previousRatio = 0

          // 计算目标时间间隔前的数据索引
          const targetIndex = Math.ceil(monitoringInterval / periodMinutes)

          // 如果有足够的历史数据，计算变化率
          if (apiResponse.length > targetIndex) {
            const targetItem = apiResponse[targetIndex]
            const currentRatio = parseFloat(latestItem.longShortRatio)
            previousRatio = parseFloat(targetItem.longShortRatio)

            changeAmount = currentRatio - previousRatio
            changeRate = previousRatio !== 0 ? (changeAmount / previousRatio) * 100 : 0
          }

          const processedItem: LongShortRatioItem = {
            ...latestItem,
            timestampMs: parseInt(latestItem.timestamp),
            formattedTime: formatDateTime(parseInt(latestItem.timestamp)),
            longShortRatioFloat: parseFloat(latestItem.longShortRatio),
            longAccountFloat: parseFloat(latestItem.longAccount),
            shortAccountFloat: parseFloat(latestItem.shortAccount),
            previousRatio,
            changeAmount: parseFloat(changeAmount.toFixed(4)),
            changeRate: parseFloat(changeRate.toFixed(4)),
            changeRateFormatted: `${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}%`
          }

          return {
            symbol: latestItem.symbol,
            latest: processedItem,
          }
        })
      }

      // 获取所有symbols的数据 - 串行执行
      const successful: ProcessedLongShortRatioData[] = []
      const failed: OpenInterestError[] = []

      for (const symbol of symbols) {
        try {
          const data = await fetchSymbolData(symbol)
          successful.push(data)
          console.log(`✅ ${symbol}: 多空比${data.latest.longShortRatioFloat.toFixed(4)}, 变化${data.latest.changeRateFormatted}`)
        } catch (error) {
          console.error(`❌ ${symbol} 数据获取失败: ${error instanceof Error ? error.message : '获取数据失败'}`)
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

      if (failed.length > 0) {
        const executionTime = Date.now() - startTime
        console.log(`部分数据获取失败，任务结束 (${executionTime}ms)`)
        return {
          result: 'error',
          executionTimeMs: executionTime
        }
      }

      // 过滤超过阈值的数据
      const filteredData = successful.filter(item => {
        const shouldNotify = Math.abs(item?.latest?.changeRate) > ratioChangeThreshold
        return shouldNotify
      })

      console.log(`🔔 需要通知: ${filteredData.length}个币种`)

      // 如果没有数据超过阈值，不发送消息
      if (filteredData.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`📋 任务完成 - 无需通知 (${executionTime}ms)`)
        return {
          result: 'ok',
          processed: symbols.length,
          successful: successful.length,
          failed: failed.length,
          message: '没有超过阈值的变化，未发送消息',
          executionTimeMs: executionTime
        }
      }
      // 使用 HistoryManager 进行重复过滤与转换
      const { newInputs: newAlerts, duplicateInputs, newRecords } = await historyManager.filterNew(
        filteredData,
        (item): LongShortRatioHistoryRecord => ({
          symbol: item.symbol,
          timestamp: item.latest.timestampMs,
          longShortRatio: item.latest.longShortRatioFloat,
          changeRate: item.latest.changeRate,
          // 采用最新数据时间戳作为通知时间
          notifiedAt: item.latest.timestampMs
        })
      )

      console.log(`🔍 重复过滤: ${filteredData.length} -> 新${newAlerts.length}, 重复${duplicateInputs.length}`)

      if (newRecords.length === 0) {
        const executionTime = Date.now() - startTime
        console.log(`📋 任务完成 - 全部为重复数据 (${executionTime}ms)`)
        return {
          result: 'ok',
          processed: symbols.length,
          successful: successful.length,
          failed: failed.length,
          filtered: filteredData.length,
          newAlerts: 0,
          duplicates: duplicateInputs.length,
          message: '检测到重复数据，未发送消息',
          executionTimeMs: executionTime
        }
      }

      // 构建消息
      let message = `📊 大户多空账户数比值监控报告 (${monitoringInterval}分钟变化)\n⏰ ${formatCurrentTime()}\n\n`

      // 处理新的警报数据
      newAlerts.forEach((item: ProcessedLongShortRatioData) => {
        const changeRate = item.latest.changeRate
        const changeIcon = changeRate > 0 ? '📈' : changeRate < 0 ? '📉' : '➡️'

        // 判断是多仓增加还是空仓增加
        const trendDescription = changeRate > 0
          ? '🟢 多仓占比增加'
          : changeRate < 0
            ? '🔴 空仓占比增加'
            : '🟡 持平'

        message += `${changeIcon} ${item.symbol} - ${trendDescription}\n`
        message += `   多空比: ${item.latest.longShortRatioFloat.toFixed(4)}\n`
        message += `   多仓比: ${(item.latest.longAccountFloat * 100).toFixed(2)}%\n`
        message += `   空仓比: ${(item.latest.shortAccountFloat * 100).toFixed(2)}%\n`
        message += `   变化率: ${item.latest.changeRateFormatted}\n`

        // 添加更详细的变化说明
        if (Math.abs(changeRate) > 0) {
          const previousLongRatio = item.latest.previousRatio
          const currentLongRatio = item.latest.longShortRatioFloat
          const ratioChange = (currentLongRatio - previousLongRatio).toFixed(4)

          message += `   比值变化: ${previousLongRatio.toFixed(4)} → ${currentLongRatio.toFixed(4)} (${ratioChange >= '0' ? '+' : ''}${ratioChange})\n`
        }

        message += `   最新变化时间: ${item.latest.formattedTime}\n\n`
      })

      console.log(`📤 发送Telegram消息 (${message.length}字符)`)

      // 发送消息到 Telegram
      await bot.api.sendMessage('-1002663808019', message)
      console.log(`✅ 消息发送成功`)

      // 持久化新历史记录（内部会做一次过期裁剪与远端合并）
      await historyManager.persist()
      const historySize = historyManager.getAll().length
      console.log(`💾 历史记录已更新: ${historySize}条`)

      const executionTime = Date.now() - startTime
      console.log(`🎉 任务完成: 监控${symbols.length}个, 通知${newAlerts.length}个, 用时${executionTime}ms`)

      return {
        result: 'ok',
        processed: symbols.length,
        successful: successful.length,
        failed: failed.length,
        filtered: filteredData.length,
        newAlerts: newAlerts.length,
        duplicates: duplicateInputs.length,
        historyRecords: historySize,
        executionTimeMs: executionTime
      }
    }
    catch (error) {
      const executionTime = Date.now() - startTime
      console.error(`💥 大户多空比监控任务失败: ${error instanceof Error ? error.message : '未知错误'} (${executionTime}ms)`)

      try {
        await bot.api.sendMessage('-1002663808019', `❌ 大户多空比监控任务失败\n⏰ ${formatCurrentTime()}\n错误: ${error instanceof Error ? error.message : '未知错误'}`)
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