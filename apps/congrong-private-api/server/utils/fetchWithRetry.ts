interface RetryOptions {
  retries?: number
  timeoutMs?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitter?: boolean
  retryOn?: (response: Response | null, error: unknown) => boolean
}

export async function fetchWithRetry(url: string, init: RequestInit = {}, options: RetryOptions = {}): Promise<Response> {
  const {
    retries = 2,
    timeoutMs = 8000,
    baseDelayMs = 400,
    maxDelayMs = 4000,
    jitter = true,
    retryOn = (res, err) => {
      if (err) return true
      if (!res) return true
      if (res.status >= 500 || res.status === 429) return true
      return false
    }
  } = options

  let attempt = 0
  let lastError: unknown

  while (attempt <= retries) {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(t)
      if (!retryOn(res, null)) return res
      lastError = new Error(`Retryable status ${res.status}`)
    } catch (e) {
      clearTimeout(t)
      lastError = e
      if (!retryOn(null, e)) throw e
    }
    if (attempt === retries) break
    const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
    const sleep = jitter ? backoff * (0.5 + Math.random() * 0.5) : backoff
    await new Promise(r => setTimeout(r, sleep))
    attempt++
  }
  throw lastError instanceof Error ? lastError : new Error('fetchWithRetry failed')
}
