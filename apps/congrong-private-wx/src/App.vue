<script setup lang="ts">
import { useAuthStore } from '@/stores/useAuthStore'
import { onLaunch } from '@dcloudio/uni-app'
import useUpdateManager from './composables/useUpdateManager'

useUpdateManager()

const isInitialized = ref(false)

onLaunch(() => {
  console.log('App Launch')
})

onShow(async () => {
  console.log('App Show')
  // 避免重复初始化
  if (isInitialized.value) { return }

  try {
    const authStore = useAuthStore()
    await authStore.initAuth()
    isInitialized.value = true
  }
  catch (error) {
    console.error('初始化认证状态失败:', error)
    uni.showToast({
      title: '初始化失败，请重新登录',
      icon: 'none',
      duration: 2000,
    })
    // 初始化失败时重置状态
    isInitialized.value = false
  }
})

onHide(() => {
  console.log('App Hide')
})
</script>

<style lang="scss">
@use 'tailwindcss/base';
@use 'tailwindcss/components';
@use 'tailwindcss/utilities';

::-webkit-scrollbar {
  width: 0;
  height: 0;
}

/*  #ifdef  H5  */
svg {
  display: initial;
}

/*  #endif  */

@layer components {
  .raw-btn {
    // 注意 after: 后面不能加任何空格，有些格式化工具可能会在这里自动加一个空格
    @apply after:border-none inline-flex items-center gap-2 rounded text-sm font-semibold transition-all;
  }

  .btn {
    // 使用上面定义的 raw-btn
    @apply raw-btn bg-gradient-to-r from-[#9e58e9] to-blue-500 px-2 py-1 text-white;
  }
}

page {
  background-color: #f0f0f0;
}
</style>
