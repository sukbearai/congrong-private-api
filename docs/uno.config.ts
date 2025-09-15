import { presetXui } from '@x-dev-uni/preset'
import { defineConfig, transformerDirectives, transformerVariantGroup } from 'unocss'

export default defineConfig({
  envMode: 'dev',
  presets: [
    presetXui({
      color: '#608e57',
      preflights: false,
    }),
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
})
