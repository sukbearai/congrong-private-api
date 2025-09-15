<script lang='ts' setup>
import type { UploadFile, UploadFiles, UploadInstance } from 'element-plus'
import type { XElUploadProps } from './props'
import { parseExcel } from '@x-dev-uni/utils'
import { ElButton, ElUpload } from 'element-plus'
import { computed, ref } from 'vue'

defineOptions({
  name: 'XElUpload',
})

const props = withDefaults(defineProps<XElUploadProps>(), {})

const uploadRef = ref<UploadInstance>()

// 处理文件变化
async function handleChange(uploadFile: UploadFile, uploadFiles: UploadFiles) {
  try {
    const data = await parseExcel(uploadFile.raw!)
    props.onParseExcelSuccess?.(data)
    props.onChange?.(uploadFile, uploadFiles)
  }
  catch (error) {
    console.error('Parse excel failed:', error)
    props.onParseExcelFailed?.(error)
  }
}

// 合并默认属性和透传属性
const uploadAttrs = computed(() => ({
  ...props,
  onChange: handleChange,
}))
</script>

<template>
  <ElUpload
    ref="uploadRef"
    v-bind="uploadAttrs"
  >
    <template #trigger>
      <slot name="trigger">
        <ElButton type="primary">
          上传文件
        </ElButton>
      </slot>
    </template>
    <template #tip>
      <slot name="tip" />
    </template>
  </ElUpload>
</template>
