/**
 * Open Interest Value / Market Cap (OL/MC) 指标监控任务
 * 数据来源:
 *  - Bybit: GET /v5/market/tickers (获取最新行情含 openInterestValue)
 *  - CoinGecko: /api/v3/simple/price (获取 usd_market_cap)
 *
 * 监控逻辑(可扩展, 当前实现基础版):
 *  - 针对多个交易对(合约)计算 ratio = openInterestValue / marketCap * 100%
 *  - 支持两个触发条件 (任一满足即进入候选):
 *      1) ratio 超过配置的 ratioThresholdPercent
 *      2) 自上次通知以来 ratio 变化幅度超过 changeThresholdPercent (绝对值)
 *  - 去重策略: 若距上次已通知记录方向相同且差值在 duplicateTolerancePercent 以内则不再推送
 *  - 历史保留: 使用 historyManager, retention 采用 shortWindow 策略
 *
 * 配置存储键: telegram:olmc  (数组)
 *  每项示例: {
 *    symbol: 'BTCUSDT',          // Bybit 合约/交易对
 *    displayName: 'BTC',         // 展示名称
 *    category: 'linear',         // Bybit category: spot|linear|inverse|option
 *    cgId: 'bitcoin',            // CoinGecko coin id
 *    ratioThresholdPercent: 0.8, // (可选) 触发阈值, 默认 0 (不限制)
 *    changeThresholdPercent: 5   // (可选) 变化触发阈值, 默认 3
 *  }
 *
 * 历史记录键: telegram:olmc_history
 *  历史记录用于: 去重 & 变化计算
 *
 * 说明: Bybit openInterestValue 单位官方文档通常为 USD 价值 (对线性合约 / USDT 本位),
 * 若为 inverse / 其他品类请确保转换为 USD 价值以保证与市值一致. 当前实现直接使用返回值做除法.
 */

interface BybitTickerResponse {
    retCode: number
    retMsg: string
    result: {
        category: string
        list: Array<{
            symbol: string
            lastPrice: string
            openInterestValue?: string
        }>
    }
    time: number
}

interface CoinGeckoSimplePriceResponse {
    [cgId: string]: {
        usd?: number
        usd_market_cap?: number
    }
}

interface OlMcMonitorConfig {
    symbol: string
    displayName: string
    category: string
    cgId: string
    ratioThresholdPercent?: number
    changeThresholdPercent?: number
    // 以下为交易信号可选自定义阈值 (没有则使用全局默认)
    ratioOverheatedPercent?: number   // 过热 / 极端注意阈值 (如 1.2)
    ratioElevatedPercent?: number     // 杠杆明显升高阈值 (如 0.8)
    changeSurgeUpPercent?: number     // 快速放大判定 (如 +5)
    changeSurgeDownPercent?: number   // 快速去杠杆判定 (如 -5)
}

interface OlMcComputedItem {
    symbol: string
    displayName: string
    category: string
    cgId: string
    openInterestValue: number
    marketCap: number
    ratioPercent: number
    ratioChangePercent: number
    ratioPercentFormatted: string
    ratioChangePercentFormatted: string
    timestamp: number
    signal?: OlMcSignal
}

interface HistoryRecord {
    symbol: string
    ratioPercent: number
    timestamp: number
    notifiedAt: number
    direction?: 'up' | 'down' | 'flat'
}

import { createHistoryManager, buildFingerprint } from '../../utils/historyManager'
import { getRetention } from '../../config/alertThresholds'
import { fetchWithRetry } from '../../utils/fetchWithRetry'
import { buildTaskResult } from '../../utils/taskResult'
import { getTelegramChannel } from '../../utils/telegram'
import { buildHeader, appendEntry, assemble, splitMessage } from '../../utils/alerts/message'
import { filterDuplicates } from '../../utils/alerts/dedupe'
import { RequestQueue } from '../../utils/queue'
import { bot } from '../../../bot'
import { formatDateTime, formatCurrentTime } from '../../utils/date-fns'

const DEFAULT_RATIO_THRESHOLD = 0
const DEFAULT_CHANGE_THRESHOLD = 3
const DUPLICATE_TOLERANCE_PERCENT = 0.2 // 0.2 个百分点 (percentage points)
const DEDUPE_LOOKBACK_MS = 10 * 60 * 1000

// ---- 交易信号判定默认阈值 ----
const SIGNAL_DEFAULTS = {
    ratioOverheatedPercent: 1.2,  // 过热 (可根据经验调整)
    ratioElevatedPercent: 0.8,    // 杠杆显著升高区
    changeSurgeUpPercent: 5,      // 短期快速放大
    changeSurgeDownPercent: -5    // 短期快速下降 / 去杠杆
}

type OlMcSignalLevel = 'overheated' | 'elevated' | 'surgeUp' | 'surgeDown' | 'neutral'

interface OlMcSignal {
    level: OlMcSignalLevel
    icon: string
    label: string
    note: string
}

function classifySignal(item: OlMcComputedItem, cfg: OlMcMonitorConfig): OlMcSignal {
    const ratio = item.ratioPercent
    const change = item.ratioChangePercent
    const over = cfg.ratioOverheatedPercent ?? SIGNAL_DEFAULTS.ratioOverheatedPercent
    const elevated = cfg.ratioElevatedPercent ?? SIGNAL_DEFAULTS.ratioElevatedPercent
    const surgeUp = cfg.changeSurgeUpPercent ?? SIGNAL_DEFAULTS.changeSurgeUpPercent
    const surgeDown = cfg.changeSurgeDownPercent ?? SIGNAL_DEFAULTS.changeSurgeDownPercent

    // 优先级: 过热 > 快速放大 > 快速下降 > 升高 > 中性
    if (ratio >= over && change >= 0) {
        return { level: 'overheated', icon: '🔥', label: '过热上行', note: '杠杆集中且继续放大, 警惕挤仓/回撤风险' }
    }
    if (change >= surgeUp) {
        return { level: 'surgeUp', icon: '⚡️', label: '快速放大', note: '短期资金迅速堆积, 波动风险上升' }
    }
    if (change <= surgeDown) {
        return { level: 'surgeDown', icon: '💨', label: '快速去杠杆', note: '强制/主动减仓, 留意是否进入修复段' }
    }
    if (ratio >= elevated && change >= 0) {
        return { level: 'elevated', icon: '📈', label: '杠杆升高', note: '杠杆结构走高, 注意过度堆积迹象' }
    }
    return { level: 'neutral', icon: '➡️', label: '中性', note: '暂无显著结构信号' }
}

export default defineTask({
    meta: { name: 'ol:mc', description: 'Open Interest / Market Cap 指标监控' },
    async run() {
        const startTime = Date.now()
        try {
            const storage = useStorage('db')
            const monitorConfigs = (await storage.getItem('telegram:olmc') || []) as OlMcMonitorConfig[]
            if (!monitorConfigs.length) {
                return buildTaskResult({ startTime, result: 'ok', message: '无监控目标', counts: { processed: 0 } })
            }
            console.log(`🚀 OL/MC 指标监控开始 - 监控${monitorConfigs.length}个标的`)

            const config = useRuntimeConfig()
            const bybitApiUrl = config.bybit?.bybitApiUrl
            const coinGeckoApiUrl = config.coingecko?.apiUrl

            const uniqueCgIds = Array.from(new Set(monitorConfigs.map(c => c.cgId))).filter(Boolean)
            let mcMap: Record<string, number> = {}
            if (uniqueCgIds.length) {
                const cgUrl = `${coinGeckoApiUrl}/api/v3/simple/price?ids=${uniqueCgIds.join(',')}&vs_currencies=usd&include_market_cap=true`
                try {
                    const resp = await fetchWithRetry(cgUrl, { method: 'GET' }, { retries: 1, timeoutMs: 8000 })
                    if (!resp.ok) throw new Error(`CoinGecko HTTP ${resp.status}`)
                    const data = await resp.json() as CoinGeckoSimplePriceResponse
                    for (const id of uniqueCgIds) {
                        const mc = data[id]?.usd_market_cap
                        if (typeof mc === 'number' && mc > 0) mcMap[id] = mc
                    }
                } catch (e) {
                    console.error('⚠️ CoinGecko 获取失败:', e)
                }
            }

            // 请求队列(节流 + 随机延迟)，显式导入避免全局依赖模糊
            const requestQueue = new RequestQueue({ maxRandomDelay: 1000, minDelay: 400 })
            const fetchTicker = async (cfg: OlMcMonitorConfig) => {
                return await requestQueue.add(async () => {
                    const params = new URLSearchParams({ category: cfg.category, symbol: cfg.symbol })
                    const url = `${bybitApiUrl}/v5/market/tickers?${params.toString()}`
                    const resp = await fetchWithRetry(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } }, { retries: 2, timeoutMs: 7000 })
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
                    const json = await resp.json() as BybitTickerResponse
                    if (json.retCode !== 0) throw new Error(`Bybit API ${json.retMsg}`)
                    if (!json.result.list?.length) throw new Error('空数据')
                    const item = json.result.list[0]
                    const oiValue = parseFloat(item.openInterestValue || '0')
                    if (!oiValue) throw new Error('openInterestValue 缺失或为 0')
                    const marketCap = mcMap[cfg.cgId] || 0
                    if (!marketCap) throw new Error('未获取到市值')
                    const ratio = marketCap > 0 ? (oiValue / marketCap) * 100 : 0
                    return {
                        symbol: cfg.symbol,
                        displayName: cfg.displayName,
                        category: cfg.category,
                        cgId: cfg.cgId,
                        openInterestValue: parseFloat(oiValue.toFixed(2)),
                        marketCap: parseFloat(marketCap.toFixed(2)),
                        ratioPercent: parseFloat(ratio.toFixed(4)),
                        ratioChangePercent: 0,
                        ratioPercentFormatted: '',
                        ratioChangePercentFormatted: '',
                        timestamp: Date.now(),
                    } as OlMcComputedItem
                })
            }

            const computed: OlMcComputedItem[] = []
            const failures: Array<{ symbol: string; error: string }> = []
            for (const cfg of monitorConfigs) {
                try {
                    const item = await fetchTicker(cfg)
                    computed.push(item)
                    console.log(`✅ ${cfg.symbol} ratio=${item.ratioPercent.toFixed(4)}%`)
                } catch (e) {
                    failures.push({ symbol: cfg.symbol, error: e instanceof Error ? e.message : '获取失败' })
                    console.error(`❌ ${cfg.symbol} 失败:`, e)
                }
            }

            if (!computed.length) {
                return buildTaskResult({ startTime, result: 'error', message: '全部请求失败', counts: { processed: monitorConfigs.length, successful: 0, failed: failures.length } })
            }

            const historyKey = 'telegram:olmc_history'
            const manager = createHistoryManager<HistoryRecord>({
                storage,
                key: historyKey,
                retentionMs: getRetention('shortWindow'),
                // 去掉 timestamp 使相同 symbol + 归一化 ratio 归为同一指纹
                getFingerprint: r => buildFingerprint([r.symbol, Math.round(r.ratioPercent * 100) / 100])
            })
            await manager.load()
            const latestBySymbol = new Map<string, HistoryRecord>()
            for (const h of manager.getAll()) {
                const prev = latestBySymbol.get(h.symbol)
                if (!prev || h.notifiedAt > prev.notifiedAt) latestBySymbol.set(h.symbol, h)
            }

            for (const item of computed) {
                const prev = latestBySymbol.get(item.symbol)
                if (prev) {
                    const change = item.ratioPercent - prev.ratioPercent
                    item.ratioChangePercent = parseFloat(change.toFixed(4))
                }
                item.ratioPercentFormatted = `${item.ratioPercent.toFixed(4)}%`
                item.ratioChangePercentFormatted = `${item.ratioChangePercent >= 0 ? '+' : ''}${item.ratioChangePercent.toFixed(4)}%`
                // 先不赋 signal, 筛选完成后再做 (避免无意义采样写入)
            }

            const candidates = computed.filter(item => {
                const cfg = monitorConfigs.find(c => c.symbol === item.symbol)!
                const ratioThreshold = cfg.ratioThresholdPercent ?? DEFAULT_RATIO_THRESHOLD
                const changeThreshold = cfg.changeThresholdPercent ?? DEFAULT_CHANGE_THRESHOLD
                const hitRatio = ratioThreshold > 0 ? item.ratioPercent >= ratioThreshold : false
                const hitChange = Math.abs(item.ratioChangePercent) >= changeThreshold
                // 若无历史通知记录且当前也未命中 ratio 阈值，但这是首次采样：允许作为基准（不推送）——此处只筛候选，真正推送再做去重
                const prev = latestBySymbol.get(item.symbol)
                if (prev) {
                    const delta = item.ratioPercent - prev.ratioPercent
                    const sameDirection = (delta >= 0 && item.ratioChangePercent >= 0) || (delta < 0 && item.ratioChangePercent < 0)
                    if (sameDirection && Math.abs(delta) <= DUPLICATE_TOLERANCE_PERCENT) {
                        // 与上次通知方向一致且差值在容差内 -> 直接过滤掉
                        return false
                    }
                }
                return hitRatio || hitChange
            })
            console.log(`🔔 初步筛选: ${candidates.length} / ${computed.length}`)

            if (!candidates.length) {
                return buildTaskResult({ startTime, result: failures.length ? 'partial' : 'ok', message: '无满足阈值的标的', counts: { processed: monitorConfigs.length, successful: computed.length, failed: failures.length, filtered: 0, newAlerts: 0 } })
            }

            // 构造历史已通知用于跨运行去重
            const now = Date.now()
            const existingAlerts = manager.getAll()
                .filter(r => now - r.notifiedAt <= DEDUPE_LOOKBACK_MS)
                .map(r => ({
                    symbol: r.symbol,
                    direction: r.direction || 'flat',
                    value: parseFloat(r.ratioPercent.toFixed(2)),
                    timestamp: r.notifiedAt,
                }))
            const { fresh: deduped, duplicates: softDup } = filterDuplicates(
                candidates,
                a => ({
                    symbol: a.symbol,
                    direction: a.ratioChangePercent > 0 ? 'up' : a.ratioChangePercent < 0 ? 'down' : 'flat',
                    value: parseFloat(a.ratioPercent.toFixed(2)),
                    timestamp: a.timestamp,
                }),
                existingAlerts,
                { lookbackMs: DEDUPE_LOOKBACK_MS, toleranceAbs: DUPLICATE_TOLERANCE_PERCENT, directionSensitive: true }
            )

            if (!deduped.length) {
                return buildTaskResult({ startTime, result: failures.length ? 'partial' : 'ok', message: '全部为重复/微小变化', counts: { processed: monitorConfigs.length, successful: computed.length, failed: failures.length, filtered: candidates.length, newAlerts: 0, duplicates: softDup.length } })
            }

            let lines: string[] = []
            lines.push(buildHeader('📊 OL/MC 指标监控'))
            for (const item of deduped) {
                const cfg = monitorConfigs.find(c => c.symbol === item.symbol)!
                // 交易信号判定
                item.signal = classifySignal(item, cfg)
                appendEntry(
                    lines,
                    `${item.signal.icon} ${cfg.displayName} (${item.symbol})\n  Ratio: ${item.ratioPercentFormatted} (${item.ratioChangePercentFormatted})\n  Signal: ${item.signal.label} | ${item.signal.note}\n  OI: ${item.openInterestValue.toLocaleString()}  MC: ${item.marketCap.toLocaleString()}\n  时间: ${formatDateTime(item.timestamp)}`
                )
            }
            if (failures.length) appendEntry(lines, `⚠️ 获取失败: ${failures.map(f => f.symbol).join(', ')}`)
            const assembled = assemble(lines)
            const parts = splitMessage(assembled)
            for (const part of parts) await bot.api.sendMessage(getTelegramChannel('ol:mc'), part)
            console.log('✅ 消息发送成功')

            const newRecords: HistoryRecord[] = deduped.map(i => ({
                symbol: i.symbol,
                ratioPercent: i.ratioPercent,
                timestamp: i.timestamp,
                notifiedAt: Date.now(),
                direction: i.ratioChangePercent > 0 ? 'up' : i.ratioChangePercent < 0 ? 'down' : 'flat'
            }))
            manager.addRecords(newRecords)
            await manager.persist()
            console.log(`💾 历史记录已更新: ${manager.getAll().length}条`)

            return buildTaskResult({ startTime, result: failures.length ? 'partial' : 'ok', counts: { processed: monitorConfigs.length, successful: computed.length, failed: failures.length, filtered: candidates.length, newAlerts: deduped.length, duplicates: softDup.length, historyRecords: manager.getAll().length } })
        } catch (error) {
            console.error('💥 OL/MC 监控任务失败:', error)
            try { await bot.api.sendMessage(getTelegramChannel('ol:mc'), `❌ OL/MC 监控任务失败\n⏰ ${formatCurrentTime()}\n错误: ${error instanceof Error ? error.message : '未知错误'}`) } catch { }
            return buildTaskResult({ startTime, result: 'error', error: error instanceof Error ? error.message : '未知错误', message: '任务失败' })
        }
    }
})
