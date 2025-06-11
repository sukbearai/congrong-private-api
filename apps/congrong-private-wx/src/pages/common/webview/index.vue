<script lang="ts" setup>
import { ref } from 'vue'

const url = ref('')

onLoad((options) => {
  // 获取navigator传递的url参数
  if (options && options.url) {
    // 需要对URL进行解码，因为在传递时可能被编码
    url.value = decodeURIComponent(options.url)
    console.log(decodeURIComponent(options.url), 'url of webview')
  }
  else {
    // 如果没有传递url参数，使用默认值
    url.value = 'https://uniapp.dcloud.io/static/web-view.html'
  }
})
</script>

<template>
  <view>
    <web-view :src="url" />
  </view>
</template>
