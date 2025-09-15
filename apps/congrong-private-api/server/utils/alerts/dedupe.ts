export interface DedupeRecord {
  symbol: string
  direction?: 'up' | 'down' | 'flat'
  value: number // primary metric (e.g., change rate % or absolute)
  timestamp: number
}

export interface DedupeOptions {
  lookbackMs: number
  toleranceAbs?: number
  tolerancePercent?: number
  directionSensitive?: boolean
}

export function filterDuplicates<T>(
  inputs: T[],
  mapToRecord: (t: T) => DedupeRecord,
  history: DedupeRecord[],
  options: DedupeOptions,
): { fresh: T[], duplicates: T[] } {
  const { lookbackMs, toleranceAbs = 0, tolerancePercent, directionSensitive = true } = options
  const now = Date.now()
  const cutoff = now - lookbackMs
  const recent = history.filter(h => h.timestamp >= cutoff)
  const fresh: T[] = []
  const duplicates: T[] = []

  for (const item of inputs) {
    const rec = mapToRecord(item)
    const dir = rec.direction
    const isDup = recent.some((h) => {
      if (h.symbol !== rec.symbol) { return false }
      if (directionSensitive && dir && h.direction && dir !== h.direction) { return false }
      const absDiff = Math.abs(h.value - rec.value)
      const pctDiff = tolerancePercent != null ? Math.abs(absDiff / (h.value === 0 ? 1 : h.value)) * 100 : undefined
      const absOk = absDiff <= toleranceAbs
      const pctOk = tolerancePercent != null ? (pctDiff ?? Infinity) <= tolerancePercent : true
      return absOk && pctOk
    })
    if (isDup) {
      duplicates.push(item)
    }
    else { fresh.push(item) }
  }
  return { fresh, duplicates }
}
