/* eslint-disable ts/no-use-before-define */
import { useAuthStore } from '@/stores/useAuthStore'
import AdapterUniapp from '@alova/adapter-uniapp'
import { createAlova } from 'alova'

export type ServerType = 'teach' | 'study'

let isLogout = false

// 根据用户角色获取不同的 baseURL
function getBaseURL(_forceServer?: ServerType): string {
  // if (forceServer) {
  //   return forceServer === 'teach'
  //     ? import.meta.env.VITE_SERVER
  //     : import.meta.env.VITE_SERVER
  // }

  // try {
  //   const role = uni.getStorageSync('role')
  //   return role === 'teacher'
  //     ? import.meta.env.VITE_TEACH_SERVER
  //     : import.meta.env.VITE_STUDY_SERVER
  // }
  // catch {
  //   return import.meta.env.VITE_STUDY_SERVER
  // }
  return import.meta.env.VITE_SERVER
}

/**
 * API 响应格式
 */
export interface ApiResponse<T = any> {
  code: number // 状态码: 0 表示成功, 其他表示错误
  message: string // 响应消息
  data: T | null // 响应数据
  timestamp: number // 响应时间戳
}

export const alovaInstance = createAlova({
  cacheLogger: false,
  baseURL: getBaseURL(),

  beforeRequest(method) {
    const authStore = useAuthStore()

    // 设置认证头
    if (authStore.token) {
      method.config.headers.authorization = `Bearer ${authStore.token}`
      method.config.headers.token = authStore.token
    }

    // 设置默认 Content-Type
    if (!method.config.headers['Content-Type']) {
      method.config.headers['Content-Type'] = 'application/json'
    }

    // 处理加载状态
    if ((method?.data as any)?.ignore === true) { return }
    uni.showLoading({
      title: '加载中....',
      icon: 'loading',
      mask: true,
    })
  },

  ...AdapterUniapp(),

  responded: {
    onSuccess: async (response) => {
      const { statusCode, data: rawData } = response as any

      // 判断HTTP状态码
      if (statusCode === 401) {
        if (!isLogout) {
          await handleError(rawData.message || '登录失效', 1000)
          const authStore = useAuthStore()
          authStore.logout()
          isLogout = true
        }
        return Promise.reject(rawData)
      }

      if (statusCode >= 400) {
        await handleError(rawData.message || '请求失败')
        return Promise.reject(rawData)
      }

      // 处理业务状态码，成功时code为0
      if (rawData.code === 0 || rawData.success) {
        return rawData.data
      }
      else {
        if (rawData.message) {
          await handleError(rawData.message)
        }
        return Promise.reject(rawData)
      }
    },
    onComplete: async () => {
      uni.hideLoading()
    },
  },
})

async function handleError(message: string, time: number = 3000): Promise<void> {
  uni.hideLoading()
  await new Promise(resolve => setTimeout(resolve, 300))
  uni.showToast({
    title: message,
    icon: 'none',
    duration: time,
  })
}

export function switchServer(serverType: ServerType) {
  uni.setStorageSync('role', serverType)
  alovaInstance.options.baseURL = getBaseURL(serverType)
}
