import type { HuatuoSubmitRequest, HuatuoSubmitResponse } from './types'
import { alovaInstance as request } from '../request'

// 花图第三方服务的应用代码
const HUATUO_APP_CODE = 'congrong_wx_applet'

/**
 * 提交花图表单数据
 * @param data 表单数据
 * @returns 表单提交响应
 */
export function submitHuatuoForm(data: Omit<HuatuoSubmitRequest, 'thirdAppCode' | 'accountType'>) {
  return request.Post<HuatuoSubmitResponse>('/api/thirdparty/huatuo', {
    ...data,
    thirdAppCode: HUATUO_APP_CODE,
    accountType: 'wx_applet',
  })
}

/**
 * 第三方服务相关API
 */
export function useThirdPartyService() {
  return {
    submitHuatuoForm,
  }
}
