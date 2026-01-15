const BASE_URL = 'https://api.hubble.xyz'

export interface HubbleSignalConfig {
  name: string
  callback_url: string
  chain: 'ETH' | 'SOL'
  activity: 'CEX'
  action: 'Inflow' | 'Outflow'
  exchanges: string[] // e.g. ["Binance", "OKX"] or ["All"]
  token_addresses?: string[] // Optional
  wallet_addresses?: string[] // Optional
  min_amount?: string
  max_amount?: string
}

interface HubbleResponse<T = any> {
  code: number
  message: string
  data?: T
}

export const hubbleApi = {
  /**
   * Create a new signal configuration
   */
  async createSignal(config: HubbleSignalConfig) {
    return await this.request('/signal/config', 'POST', config)
  },

  /**
   * Get list of signals
   */
  async getSignalList(params?: { name?: string, status?: 'ongoing' | 'paused', page?: number, size?: number }) {
    const query = new URLSearchParams()
    if (params?.name) { query.append('name', params.name) }
    if (params?.status) { query.append('status', params.status) }
    if (params?.page) { query.append('page', String(params.page)) }
    if (params?.size) { query.append('size', String(params.size)) }

    return await this.request(`/signal/config?${query.toString()}`, 'GET')
  },

  /**
   * Update a signal configuration
   */
  async updateSignal(webhookId: string, config: Partial<HubbleSignalConfig>) {
    return await this.request(`/signal/config/${webhookId}`, 'PUT', config)
  },

  /**
   * Pause or Activate a signal
   */
  async setSignalStatus(webhookId: string, status: 'ongoing' | 'paused') {
    return await this.request(`/signal/config/${webhookId}`, 'PATCH', { status })
  },

  /**
   * Delete a signal
   */
  async deleteSignal(webhookId: string) {
    return await this.request(`/signal/config/${webhookId}`, 'DELETE')
  },

  /**
   * Internal request helper
   */
  async request(path: string, method: string, body?: any) {
    const { hubble } = useRuntimeConfig()
    if (!hubble.apiKey) {
      throw new Error('HUBBLE_API_KEY is not configured')
    }

    // Replace {YOUR HUBBLE-API-KEY} with actual key
    const headers = {
      'Content-Type': 'application/json',
      'HUBBLE-API-KEY': hubble.apiKey,
    }

    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      const data = await response.json() as HubbleResponse

      if (!response.ok) {
        throw new Error(`Hubble API Error: ${response.status} ${response.statusText} - ${JSON.stringify(data)}`)
      }

      return data
    }
    catch (error) {
      console.error('Hubble API Request Failed:', error)
      throw error
    }
  },
}
