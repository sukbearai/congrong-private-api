import { hubbleApi, type HubbleSignalConfig } from '~/utils/hubble'

export default eventHandler(async (event) => {
  const body = await readBody(event)

  if (!body.callback_url) {
    throw createError({ statusCode: 400, message: 'Missing callback_url' })
  }

  // Default configuration for a broad CEX monitor if minimal params provided
  const config: HubbleSignalConfig = {
    name: body.name || `CEX Monitor ${new Date().toISOString()}`,
    callback_url: body.callback_url,
    chain: body.chain || 'ETH',
    activity: 'CEX',
    action: body.action || 'Inflow',
    exchanges: body.exchanges || ['All'],
    token_addresses: body.token_addresses || [],
    wallet_addresses: body.wallet_addresses || [],
    min_amount: body.min_amount,
    max_amount: body.max_amount,
  }

  try {
    const res = await hubbleApi.createSignal(config)
    return res
  }
  catch (e) {
    throw createError({
      statusCode: 500,
      statusMessage: String(e),
    })
  }
})
