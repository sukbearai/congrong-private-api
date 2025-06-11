import { randomUUID } from 'node:crypto'

/**
 * 图片上传API
 * 使用: POST /api/upload/image
 * Content-Type: multipart/form-data
 */
export default defineEventHandler(async (event) => {
  try {
    // 获取上传的文件
    const formData = await readMultipartFormData(event)

    if (!formData || formData.length === 0) {
      return createErrorResponse('未找到上传文件', 400)
    }

    const file = formData[0]

    // 验证文件类型
    if (!file.type || !file.type.startsWith('image/')) {
      return createErrorResponse('只支持上传图片文件', 400)
    }

    // 生成唯一文件名
    const fileExt = file.type.split('/')[1] || 'png'
    const fileName = `${randomUUID()}.${fileExt}`
    const key = `images/${fileName}`

    // 获取R2 bucket
    const { bucket } = event.context

    // 上传到R2
    await bucket.put(key, file.data, {
      httpMetadata: {
        contentType: file.type,
      },
    })

    // 返回公网访问URL
    const publicUrl = `https://bucket.congrongtech.cn/${key}`

    return createSuccessResponse({
      url: publicUrl,
      fileName,
      size: file.data.length,
      type: file.type,
    }, '图片上传成功')
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : '图片上传失败',
      500,
    )
  }
})
