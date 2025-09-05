export interface TaskCounts {
  processed?: number
  successful?: number
  failed?: number
  filtered?: number
  newAlerts?: number
  duplicates?: number
  historyRecords?: number
  timeSeriesRecords?: number
}

export interface TaskResultBase {
  result: 'ok' | 'partial' | 'error'
  executionTimeMs: number
  message?: string
  error?: string
  counts?: TaskCounts
  meta?: Record<string, any>
}

export function buildTaskResult(partial: Omit<TaskResultBase, 'executionTimeMs'> & { startTime: number }): TaskResultBase {
  const executionTimeMs = Date.now() - partial.startTime
  const { startTime, ...rest } = partial as any
  return { ...rest, executionTimeMs }
}
