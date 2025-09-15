import type { Theme } from 'vitepress'
import TwoslashFloatingVue from '@shikijs/vitepress-twoslash/client'
import XUI from '@x-dev-uni/ui'
import FloatingVue, { Menu } from 'floating-vue'
import DefaultTheme from 'vitepress/theme'

import 'floating-vue/dist/style.css'
import '@shikijs/vitepress-twoslash/style.css'
import '@x-dev-uni/ui/ui.css'
import 'uno.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('VMenu', Menu)

    app.use(TwoslashFloatingVue)
    app.use(FloatingVue)
    app.use(XUI)
  },
} satisfies Theme
