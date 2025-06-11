const telegram = useRuntimeConfig().telegram
const clientOptions = {
  client: {
    baseFetchConfig: {
      agent: undefined,
      compress: true,
    },
  },

}

if (telegram.proxyUrl) {
  clientOptions.client.baseFetchConfig.agent = new SocksProxyAgent(telegram.proxyUrl)
}

export const bot = new Bot(telegram.botToken, clientOptions)
