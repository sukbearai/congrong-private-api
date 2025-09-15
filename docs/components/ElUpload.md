# XElUpload

二次封装的Element Plus的Upload组件,支持所有props透传，以及支持excel导入功能。

<script setup lang="ts">
import { ref } from 'vue'

const example1 = ref()
const example2 = ref()

function handleParseExcelSuccessExample1(data) {
    example1.value = JSON.stringify(data, null, 2)
}

function handleParseExcelSuccessExample2(data) {
    example2.value = JSON.stringify(data, null, 2)
}
</script>

### <i i-logos-vue /> 基本使用

```vue
<script setup lang="ts">
function handleParseExcelSuccess(data) {
  console.log(data)
}
</script>

<template>
  <x-el-upload
    :show-file-list="false"
    accept=".xlsx"
    :on-parse-excel-success="handleParseExcelSuccess"
  />
</template>
```

<x-el-upload
:show-file-list="false"
accept=".xlsx"
:on-parse-excel-success="handleParseExcelSuccessExample1"
/>

<pre>
 {{ example1 }}
</pre>

### <i i-logos-vue /> 插槽

```vue
<script setup lang="ts">
function handleParseExcelSuccess(data) {
  console.log(data)
}
</script>

<x-el-upload
    :show-file-list="false"
    accept=".xlsx"
    :on-parse-excel-success="handleParseExcelSuccess"
>
    <template #tip>
        <div class="el-upload__tip">
            小于500kb的xlsx文件
        </div>
    </template>
    <template #trigger>
        <x-button type="primary">上传文件</x-button>
    </template>
</x-el-upload>
```

<x-el-upload
:show-file-list="false"
accept=".xlsx"
:on-parse-excel-success="handleParseExcelSuccessExample2"

>

    <template #tip>
        <div class="el-upload__tip">
            小于500kb的xlsx文件
        </div>
    </template>
    <template #trigger>
        <x-button type="primary">上传文件</x-button>
    </template>

</x-el-upload>

<pre>
 {{ example2 }}
</pre>
