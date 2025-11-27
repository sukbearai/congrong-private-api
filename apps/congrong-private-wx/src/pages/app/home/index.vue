<script lang="ts" setup>
import { useThirdPartyService } from '@/services/thirdparty'
import { useWxService } from '@/services/wx'
import { useInfoStore } from '@/stores/useInfo'
import { useWxStore } from '@/stores/useWxStore'
import { useToast } from 'wot-design-uni'

const deviceId = ref('')
const infoStore = useInfoStore()
const wxService = useWxService()
const wxStore = useWxStore()
const thirdPartyService = useThirdPartyService()
const { success: showSuccess, error: showError } = useToast()
const submitting = ref(false)

onLoad((query) => {
  const scene = decodeURIComponent(query?.scene)

  // 解析场景值中的 device_id 参数
  if (scene) {
    // 假设场景值格式为 device_id=123 或 device_id=123&param2=value2
    const params = scene.split('&')
    for (const param of params) {
      const [key, value] = param.split('=')
      if (key === 'device_id') {
        deviceId.value = value
        break
      }
    }
  }
  // 页面加载时自动登录微信
  handleWxLogin()
})

// 从infoStore读取存储的昵称和手机号
onShow(() => {
  if (infoStore.nickname) {
    model.nickname = infoStore.nickname
  }

  if (infoStore.phoneNumber) {
    model.phone = infoStore.phoneNumber
  }
})

const model = reactive<{
  nickname: string
  phone: string
}>({
  nickname: '',
  phone: '',
})

const form = ref()

function handleCheckReport() {
  const unionId = `${wxStore.loginInfo.appid}_${wxStore.getOpenid()}`
  const url = encodeURIComponent(`https://www.maixiangjk.com/huatuo/wechat/mp/getReportList?appId=${wxStore.loginInfo.appid}&unionId=${unionId}&openId=${wxStore.getOpenid()}`)
  // 这里可以添加提交成功后的跳转
  uni.navigateTo({ url: `/pages/common/webview/index?url=${url}` })
}

// 微信登录
async function handleWxLogin() {
  try {
    // 如果已经有openid，则不再重复登录
    if (wxStore.loginInfo.openid) {
      return
    }

    // 调用微信登录获取code
    const loginResult = await new Promise<UniApp.LoginRes>((resolve, reject) => {
      uni.login({
        provider: 'weixin',
        success: (res) => {
          if (res.code) {
            resolve(res)
          }
          else {
            reject(new Error('登录失败'))
          }
        },
        fail: (err) => {
          reject(err)
        },
      })
    })

    // 将code发送到后端换取用户信息
    const wxLoginResult = await wxService.wxLogin(loginResult.code)

    // 保存登录结果到store中
    wxStore.setLoginInfo(wxLoginResult)
  }
  catch (error: any) {
    showError({ msg: error?.message || '微信登录失败' })
    console.error('微信登录失败:', error)
  }
}

// 获取用户手机号
async function getPhoneNumber(e: any) {
  try {
    if (e.errMsg !== 'getPhoneNumber:ok') {
      showError({ msg: '用户拒绝授权获取手机号' })
      return
    }

    const code = e.code
    if (!code) {
      showError({ msg: '获取授权码失败' })
      return
    }

    // 调用服务端API获取手机号，如果有openid可以一并传递
    const res = await wxService.getPhoneNumber(code, wxStore.getOpenid())

    if (res.phoneNumber) {
      // 仅使用不含国家代码的手机号
      const phone = res.purePhoneNumber
      model.phone = phone

      // 保存到store中
      infoStore.setPhoneNumber(phone)
      showSuccess({ msg: '获取手机号成功' })
    }
  }
  catch (error: any) {
    console.error('获取手机号出错:', error)
  }
}

async function handleSubmit() {
  if (submitting.value) {
    return
  }

  form.value
    .validate()
    .then(async ({ valid, errors }: { valid: unknown, errors: unknown }) => {
      if (valid) {
        try {
          submitting.value = true

          // 保存到store中
          infoStore.setUserInfo({
            nickname: model.nickname,
            phoneNumber: model.phone,
          })

          // 检查是否有必要的数据用于提交表单
          const openid = wxStore.getOpenid()
          if (!openid) {
            showError({ msg: '未获取到微信登录信息，请重新进入小程序' })
            return
          }

          if (!deviceId.value) {
            showError({ msg: '未检测到设备ID，请扫描设备二维码进入' })
            return
          }

          // 显示加载提示
          // showLoading({ msg: '提交中...' })
          const unionId = `${wxStore.loginInfo.appid}_${openid}` // appid_openid 拼接
          // 提交表单到第三方接口
          await thirdPartyService.submitHuatuoForm({
            deviceId: deviceId.value,
            name: model.nickname,
            mobile: model.phone,
            openId: openid,
            unionId,
          })

          // closeLoading()

          showSuccess({ msg: '表单提交成功', duration: 3000, closed: () => {
            // 提交成功后跳转到报告列表页面
            const url = encodeURIComponent(`https://www.maixiangjk.com/huatuo/wechat/mp/getReportList?appId=${wxStore.loginInfo.appid}&unionId=${unionId}&openId=${openid}`)
            // 这里可以添加提交成功后的跳转
            uni.navigateTo({ url: `/pages/common/webview/index?url=${url}` })
          } })
        }
        catch (error: any) {
          console.error('表单提交失败:', error)
          showError({ msg: error?.message || '表单提交失败，请重试' })
        }
        finally {
          submitting.value = false
        }
      }
      else {
        console.log(errors, 'validation errors')
      }
    })
    .catch((error: unknown) => {
      console.log(error, 'error')
      submitting.value = false
    })
}
</script>

<template>
  <view class="page">
    <wd-form ref="form" :model="model">
      <wd-cell-group border>
        <wd-input
          v-model="model.nickname"
          label="名字"
          label-width="60px"
          prop="nickname"
          clearable
          placeholder="请输入名字"
          :rules="[{ required: true, message: '请输入名字' }]"
        >
          <!-- <template #suffix>
            <wd-button size="small" type="primary" open-type="getUserInfo" @getuserinfo="getNickname">
              获取昵称
            </wd-button>
          </template> -->
        </wd-input>
        <wd-input
          v-model="model.phone"
          label="手机号"
          label-width="60px"
          prop="phone"
          clearable
          placeholder="请获取手机号"
          :rules="[{ required: true, message: '请获取手机号' }]"
          disabled
        >
          <template #suffix>
            <wd-button size="small" type="primary" open-type="getPhoneNumber" :disabled="!!model.phone" @getphonenumber="getPhoneNumber">
              点击获取号码
            </wd-button>
          </template>
        </wd-input>
      </wd-cell-group>
      <view class="px-4 py-10 text-center text-xs text-gray-400">
        <view>
          <view>设备编号：{{ deviceId || '未检测到' }}</view>
          <wd-button type="text" size="small" @click="handleCheckReport">
            点击查看历史报告
          </wd-button>
        </view>
        <!-- <view>您提供的信息仅用于生成体质识别报告</view> -->
        <view>本小程序仅支持协议客户用户内部使用</view>
        <wd-button custom-class="mt-2 " type="primary" size="large" block @click="handleSubmit">
          提交
        </wd-button>
      </view>
    </wd-form>
  </view>
</template>
