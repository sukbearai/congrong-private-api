/* eslint-disable node/prefer-global/process */
// https://nitro.unjs.io/config
import nitroCloudflareBindings from 'nitro-cloudflare-dev'

export default defineNitroConfig({
  modules: [nitroCloudflareBindings],
  srcDir: 'server',

  experimental: {
    tasks: true,
  },

  scheduledTasks: {
    // Run `cms:update` task every minute
    '* * * * *': ['ol:alarm','market:fluctuation','funding:rate'],
  },

  routeRules: {
    '/api/ai/dialogue': {
      cors: true,
      headers: {
        'access-control-allow-methods': 'POST, GET, OPTIONS',
      },
    },
    '/api/ai/**': {
      cors: true,
      headers: {
        'access-control-allow-methods': 'POST, GET, OPTIONS',
      },
    },
    '/api/upload/**': {
      cors: true,
      headers: {
        'access-control-allow-methods': 'POST, GET, OPTIONS',
      },
    },
    '/api/device/**': {
      cors: true,
      headers: {
        'access-control-allow-methods': 'POST, GET, OPTIONS',
      },
    },
    '/api/user/**': {
      cors: true,
      headers: {
        'access-control-allow-methods': 'POST, GET, OPTIONS',
      },
    },
  },

  storage: {
    db: {
      driver: 'cloudflareKVBinding',
      binding: 'congrong-private-api',
    },
  },

  devStorage: {
    db: {
      driver: 'fs',
      base: './.data/db',
    },
  },

  runtimeConfig: {
    appId: process.env.appId,
    appSecret: process.env.appSecret,
    jwtSecret: process.env.jwtSecret,
    telegram: {
      botToken: process.env.botToken,
      proxyUrl: process.env.proxyUrl,
      authToken: process.env.authToken,
      tunnelUrl: process.env.tunnelUrl,
    },
    bybit: {
      apiKey: process.env.bybitApiKey,
      secretKey: process.env.bybitSecretKey,
      bybitApiUrl: process.env.bybitApiUrl,
    },
    binance: {
      apiKey: process.env.binanceApiKey,
      secretKey: process.env.binanceSecretKey,
      binanceApiUrl: process.env.binanceApiUrl,
    },
    deepseek: {
      apiKey: process.env.deepseekApiKey,
    }
  },

  preset: 'cloudflare_module',

  compatibilityDate: '2025-04-02',
})
