/**
 * 花图表单提交请求参数
 */
export interface HuatuoSubmitRequest {
  /**
   * 第三方应用编码
   */
  thirdAppCode: string

  /**
   * 设备ID
   */
  deviceId: string

  /**
   * 用户UnionID，如果没有则使用OpenID
   */
  unionId: string

  /**
   * 用户OpenID
   */
  openId: string

  /**
   * 手机号
   */
  mobile: string

  /**
   * 用户姓名
   */
  name: string

  /**
   * 账号类型，默认为wx_applet
   */
  accountType?: string
}

/**
 * 花图表单提交响应
 */
export interface HuatuoSubmitResponse {
  /**
   * 响应值，接口成功时返回
   */
  value: any
}
