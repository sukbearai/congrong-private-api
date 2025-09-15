import { Bot } from 'grammy'

class TelegramBotSingleton {
  private static instance: Bot | null = null

  private constructor() {}

  public static getInstance(): Bot {
    if (!TelegramBotSingleton.instance) {
      const telegram = useRuntimeConfig().telegram
      const clientOptions = {
        client: {
          baseFetchConfig: {
            agent: undefined,
            compress: true,
          },
        },
      }

      const isProduction = process.env.NODE_ENV === 'production'

      if (telegram.proxyUrl && !isProduction) {
        clientOptions.client.baseFetchConfig.agent = new SocksProxyAgent(telegram.proxyUrl)
      }

      TelegramBotSingleton.instance = new Bot(telegram.botToken, clientOptions)
    }

    return TelegramBotSingleton.instance
  }
}

export const bot = TelegramBotSingleton.getInstance()
