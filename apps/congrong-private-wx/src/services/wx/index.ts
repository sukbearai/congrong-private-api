import type { PhoneNumberResponse, WxLoginResponse } from './types'
import { alovaInstance as request } from '../request'

/**
 * 获取用户手机号
 * @param code 微信授权获取到的code
 * @param openid 可选，用户openid
 * @returns 手机号信息
 */
export function getPhoneNumber(code: string, openid?: string) {
  return request.Post<PhoneNumberResponse>('/api/phone', {
    code,
    openid,
  })
}

/**
 * 微信小程序登录
 * @param code wx.login获取的code
 * @returns 登录信息，包含session_key、openid和可能的unionid
 */
export function wxLogin(code: string) {
  return request.Post<WxLoginResponse>('/api/wx-login', {
    code,
    ignore: true,
  })
}

/**
 * 微信服务相关API
 */
export function useWxService() {
  return {
    getPhoneNumber,
    wxLogin,
  }
}
