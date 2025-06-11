<script setup lang="ts">
import type { ConfigProviderThemeVars } from 'wot-design-uni'
import { useTabBarStore } from '@/stores/useTabBarStore'

defineOptions({
  options: {
    addGlobalClass: true,
    virtualHost: true,
    styleIsolation: 'shared',
  },
})

const themeVars = reactive<ConfigProviderThemeVars>({
  colorTheme: '#00DFBF',
  tabsNavLineBgColor: 'red',
})

const tabBarStore = useTabBarStore()
const { menus, current, isShowTabBar } = storeToRefs(tabBarStore)

function handleChange({ value: index }: { value: number }) {
  const targetMenu = menus.value[index]

  if (!targetMenu) { return }

  const { url, openType } = targetMenu
  if (openType === 'switchTab') {
    uni.switchTab({ url })
  }
  else {
    uni.reLaunch({ url })
  }
}

onMounted(() => {
  // #ifdef MP-WEIXIN
  wx.setPageStyle({
    style: {
      overflow: 'hidden',
    },
  })
  // #endif
})
</script>

<template>
  <wd-config-provider :theme-vars="themeVars">
    <wd-notify />
    <wd-toast />
    <wd-message-box />
    <slot />
    <wd-tabbar
      v-if="isShowTabBar"
      :model-value="current"
      activeColor="#3F79FE"
      fixed
      bordered
      safeAreaInsetBottom
      placeholder
      @change="handleChange"
    >
      <wd-tabbar-item
        v-for="item in menus"
        :key="item.id"
        :title="item.text"
        icon="home"
      />
    </wd-tabbar>
  </wd-config-provider>
</template>
