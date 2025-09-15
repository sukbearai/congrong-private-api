/**
 * HistoryManager
 * 统一管理各监控任务产生的短期历史记录，用于：
 *  - 去重 (fingerprint)
 *  - 过期裁剪 (retentionMs)
 *  - 批量新增与一次性保存 (减少多次 IO)
 *  - 可选的“输入项 -> 历史记录”转换与重复过滤
 *
 * 设计目标：
 *  - 不绑定具体业务字段 (open interest / funding / ratio / price ...)
 *  - 最小侵入：旧代码只需替换 手动 getItem/setItem + 过滤 逻辑
 *  - 允许后续平滑替换底层存储 (KV / D1 / JSON / 内存)
 *
 * 使用示例（以未平仓合约告警任务为例）:
 *
 * const storage = useStorage('db')
 * const manager = createHistoryManager<OIHistoryRecord>({
 *   storage,
 *   key: 'telegram:ol_alarm_history',
 *   retentionMs: 2 * 60 * 60 * 1000, // 2小时
 *   getFingerprint: r => `${r.symbol}_${r.timestamp}_${Math.floor(r.openInterest)}`,
 * })
 *
 * await manager.load() // 懒加载也可以不手动调用
 * const { newInputs, duplicateInputs, newRecords } = await manager.filterNew(processedAlerts, item => ({
 *   symbol: item.symbol,
 *   timestamp: item.latest.timestampMs,
 *   openInterest: item.latest.openInterestFloat,
 *   changeRate: item.latest.changeRate,
 *   notifiedAt: item.latest.timestampMs,
 * }))
 *
 * if (newRecords.length) {
 *   manager.addRecords(newRecords)
 *   await manager.persist() // 写回存储 (自动做一次过期清理和与远端合并)
 * }
 */

import type { Storage } from 'unstorage'

// 基础历史记录约束：必须有 notifiedAt 时间戳，用于 retention 裁剪
export interface BaseHistoryRecord {
  notifiedAt: number
  // 其余字段任意 (symbol / timestamp / value / changeRate ...)
  [k: string]: any
}

export interface HistoryManagerOptions<TRecord extends BaseHistoryRecord> {
  storage: Storage
  key: string
  /** 过期时间窗口 (ms) */
  retentionMs: number
  /** 生成唯一指纹用于去重 */
  getFingerprint: (record: TRecord) => string
  /** 可自定义当前时间，默认 Date.now */
  now?: () => number
  /** 是否在 persist 前后打印调试日志 */
  debug?: boolean
}

export interface FilterNewResult<TInput, TRecord> {
  newInputs: TInput[]
  duplicateInputs: TInput[]
  newRecords: TRecord[]
}

export interface HistoryManager<TRecord extends BaseHistoryRecord> {
  /** 懒加载 (幂等) */
  load: () => Promise<void>
  /** 获取当前内存里的记录 (已去重 + 已裁剪) */
  getAll: () => TRecord[]
  /** 判断某条记录指纹是否已存在 */
  has: (record: TRecord) => boolean
  /** 新增若干记录 (不立即持久化) */
  addRecords: (records: TRecord[]) => void
  /** 过滤输入集合中的“新”数据，转换为记录；不自动保存 */
  filterNew: <TInput>(inputs: TInput[], toRecord: (input: TInput) => TRecord) => Promise<FilterNewResult<TInput, TRecord>>
  /** 主动触发过期清理 */
  prune: () => void
  /** 持久化：与存储中的最新数据合并（防止并发覆盖），再写回 */
  persist: () => Promise<void>
  /** 清空（内存+存储）谨慎使用 */
  clearAll: () => Promise<void>
}

export function createHistoryManager<TRecord extends BaseHistoryRecord>(options: HistoryManagerOptions<TRecord>): HistoryManager<TRecord> {
  const { storage, key, retentionMs, getFingerprint, now = () => Date.now(), debug = false } = options

  // 指纹 -> 记录
  let map: Map<string, TRecord> | null = null
  let loaded = false

  function log(...args: any[]) {
    if (debug) { console.log('[HistoryManager]', key, ...args) }
  }

  async function load() {
    if (loaded && map) { return }
    const raw = (await storage.getItem(key)) as TRecord[] | null
    map = new Map<string, TRecord>()
    if (raw?.length) {
      for (const r of raw) {
        if (!r || typeof r !== 'object') { continue }
        const fp = safeFingerprint(r)
        if (fp) { map.set(fp, r) }
      }
    }
    // 先标记 loaded 再调用 prune，避免 prune 内部 ensureLoaded 抛错
    loaded = true
    prune() // 初始加载时裁剪
    log('loaded', map.size)
  }

  function ensureLoaded() {
    if (!loaded || !map) { throw new Error('HistoryManager not loaded. Call load() first or await filterNew/add/persist which load lazily.') }
  }

  function safeFingerprint(record: TRecord): string | null {
    try { return getFingerprint(record) }
    catch { return null }
  }

  function prune() {
    ensureLoaded()
    const cutoff = now() - retentionMs
    let removed = 0
    for (const [fp, rec] of map!) {
      if (!rec?.notifiedAt || rec.notifiedAt <= cutoff) {
        map!.delete(fp)
        removed++
      }
    }
    if (removed) { log('prune removed', removed, 'remain', map!.size) }
  }

  function getAll(): TRecord[] {
    ensureLoaded()
    return Array.from(map!.values())
  }

  function has(record: TRecord): boolean {
    ensureLoaded()
    const fp = safeFingerprint(record)
    return !!(fp && map!.has(fp))
  }

  function addRecords(records: TRecord[]) {
    ensureLoaded()
    let added = 0
    for (const r of records) {
      const fp = safeFingerprint(r)
      if (!fp) { continue }
      // 后写覆盖旧值（一般包含最新 changeRate 等）
      map!.set(fp, r)
      added++
    }
    if (added) { log('addRecords added', added, 'total', map!.size) }
  }

  async function filterNew<TInput>(inputs: TInput[], toRecord: (input: TInput) => TRecord): Promise<FilterNewResult<TInput, TRecord>> {
    if (!loaded) { await load() }
    const newInputs: TInput[] = []
    const duplicateInputs: TInput[] = []
    const newRecords: TRecord[] = []
    for (const input of inputs) {
      const rec = toRecord(input)
      const fp = safeFingerprint(rec)
      if (!fp) {
        // 指纹异常的一律当作新记录，但不加入 map (避免污染)
        newInputs.push(input)
        newRecords.push(rec)
        continue
      }
      if (map!.has(fp)) {
        duplicateInputs.push(input)
      }
      else {
        newInputs.push(input)
        newRecords.push(rec)
        map!.set(fp, rec)
      }
    }
    log('filterNew result new=', newRecords.length, 'dup=', duplicateInputs.length)
    return { newInputs, duplicateInputs, newRecords }
  }

  async function persist() {
    if (!loaded) { await load() }
    prune()
    // 合并一次“远端最新”，减少覆盖丢数据风险（仍非严格并发安全，仅减轻）
    let remote: TRecord[] = []
    try {
      const raw = (await storage.getItem(key)) as TRecord[] | null
      remote = Array.isArray(raw) ? raw : []
    }
    catch {
      // ignore
    }
    let merged = 0
    for (const r of remote) {
      const fp = safeFingerprint(r)
      if (!fp) { continue }
      if (!map!.has(fp)) {
        // 仍需 retention 过滤
        if (r.notifiedAt && r.notifiedAt >= now() - retentionMs) {
          map!.set(fp, r)
          merged++
        }
      }
    }
    if (merged) { log('merged remote new', merged) }
    const all = Array.from(map!.values())
    await storage.setItem(key, all)
    log('persist saved', all.length)
  }

  async function clearAll() {
    if (!loaded) { await load() }
    map!.clear()
    await storage.setItem(key, [])
    log('cleared')
  }

  return {
    load,
    getAll,
    has,
    addRecords,
    filterNew,
    prune,
    persist,
    clearAll,
  }
}

// --- 可选：为常见“指纹=字段拼接”提供一个简单帮助函数 ---
export function buildFingerprint(fields: Array<string | number | undefined | null>): string {
  return fields.map(v => (v === undefined || v === null ? '' : String(v))).join('_')
}

// --- 简单防抖封装（某些任务希望多次 add 后一并 persist） ---
export function createPersistScheduler(fn: () => Promise<void>, delayMs: number) {
  let timer: any = null
  return () => {
    if (timer) { return }
    timer = setTimeout(async () => {
      timer = null
      await fn()
    }, delayMs)
  }
}

// --- 未来迁移 D1 的适配点（示例接口，未实现） ---
/**
 * 如果后续迁移到 D1，可实现同样签名的 storage 适配器：
 * const d1Storage: Storage = {
 *   async getItem(key) { ...SELECT... },
 *   async setItem(key, value) { ...UPSERT/事务... },
 *   // 其它方法按需实现 (HistoryManager 只用到 getItem / setItem)
 * }
 */
