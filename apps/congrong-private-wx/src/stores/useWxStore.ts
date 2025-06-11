import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 微信登录信息
 */
export interface WxLoginInfo {
  /**
   * 会话密钥
   */
  session_key?: string

  /**
   * 用户唯一标识
   */
  openid?: string

  /**
   * 用户在开放平台的唯一标识符(如果小程序已绑定到微信开放平台)
   */
  unionid?: string

  /**
   * appid
   */
  appid?: string
}

/**
 * 微信状态管理Store
 * 用于管理微信登录信息
 */
export const useWxStore = defineStore('wx', () => {
  // 存储微信登录信息
  const loginInfo = ref<WxLoginInfo>({})

  /**
   * 设置微信登录信息
   * @param info 微信登录信息
   */
  function setLoginInfo(info: WxLoginInfo) {
    loginInfo.value = info
  }

  /**
   * 清除微信登录信息
   */
  function clearLoginInfo() {
    loginInfo.value = {}
  }

  /**
   * 获取openid
   * @returns openid 如果存在
   */
  function getOpenid(): string | undefined {
    return loginInfo.value.openid
  }

  return {
    loginInfo,
    setLoginInfo,
    clearLoginInfo,
    getOpenid,
  }
})
