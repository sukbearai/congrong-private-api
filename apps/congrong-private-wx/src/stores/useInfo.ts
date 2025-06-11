import { defineStore } from 'pinia'
import { ref } from 'vue'

// 用户信息接口定义
interface UserInfo {
  nickname: string
  phoneNumber: string
}

export const useInfoStore = defineStore('info', () => {
  // 状态定义
  const nickname = ref('')
  const phoneNumber = ref('')

  // 更新昵称
  function setNickname(name: string) {
    nickname.value = name
  }

  // 更新手机号
  function setPhoneNumber(phone: string) {
    phoneNumber.value = phone
  }

  // 同时设置昵称和手机号
  function setUserInfo({ nickname: name, phoneNumber: phone }: UserInfo) {
    nickname.value = name
    phoneNumber.value = phone
  }

  // 清除用户信息
  function clearUserInfo() {
    nickname.value = ''
    phoneNumber.value = ''
  }

  return {
    nickname,
    phoneNumber,
    setNickname,
    setPhoneNumber,
    setUserInfo,
    clearUserInfo,
  }
})
