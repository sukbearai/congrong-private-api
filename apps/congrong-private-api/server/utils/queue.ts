export class RequestQueue {
  private queue: (() => Promise<any>)[] = []
  private processing: boolean = false
  private maxRandomDelay: number
  private minDelay: number

  constructor(options: { maxRandomDelay?: number, minDelay?: number } = {}) {
    this.maxRandomDelay = options.maxRandomDelay ?? 2000
    this.minDelay = options.minDelay ?? 1500
  }

  async add<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await request()
          resolve(result)
        }
        catch (error) {
          reject(error)
        }
      })
      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return
    }
    this.processing = true

    while (this.queue.length > 0) {
      const request = this.queue.shift()!
      try {
        await request()
      }
      catch (error) {
        console.error('Error processing request:', error)
        this.queue.unshift(request)
        await this.exponentialBackoff(this.queue.length)
      }
      await this.randomDelay()
    }

    this.processing = false
  }

  private async exponentialBackoff(retryCount: number): Promise<void> {
    const delay = 2 ** retryCount * 1000
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  private async randomDelay(): Promise<void> {
    const delay = Math.floor(Math.random() * this.maxRandomDelay) + this.minDelay
    await new Promise(resolve => setTimeout(resolve, delay))
  }
}
