import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import ElementPlus from 'unplugin-element-plus/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const r = (path: string) => resolve(__dirname, path)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    UnoCSS(),
    ElementPlus({}),
    dts({ rollupTypes: true }),
    Components({
      dts: false,
      resolvers: [
        ElementPlusResolver({
          directives: true,
        }),
      ],
      include: [],
    }),
  ],
  resolve: {
    alias: {
      '@': r('src'),
    },
  },
  build: {
    cssCodeSplit: true,
    lib: {
      entry: r('src/index.ts'),
      name: '@x-dev-uni/ui',
      fileName: format => `index.${format}.js`,
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        // Provide global variables to use in the UMD build
        // for externalized deps
        globals: {
          vue: 'Vue',
        },
      },
    },
  },
})
