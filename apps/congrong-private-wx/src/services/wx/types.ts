/**
 * 微信手机号信息响应接口
 */
export interface PhoneNumberResponse {
  /**
   * 带有国家代码的手机号，例如：+86 13800138000
   */
  phoneNumber: string

  /**
   * 不带国家代码的手机号，例如：13800138000
   */
  purePhoneNumber: string

  /**
   * 国家/地区代码，例如：86
   */
  countryCode: string
}

/**
 * 微信登录响应接口
 */
export interface WxLoginResponse {
  /**
   * 会话密钥
   */
  session_key: string

  /**
   * 用户唯一标识
   */
  openid: string

  /**
   * 用户在开放平台的唯一标识符(如果小程序已绑定到微信开放平台)
   */
  unionid?: string

  /**
   * 小程序 appid
   */
  appid?: string
}
