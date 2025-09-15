/**
 * JSON文件存储API
 * 支持多种HTTP方法：
 * - GET: 读取JSON文件
 * - POST: 写入JSON文件
 * - PUT: 写入JSON文件
 * - DELETE: 删除JSON文件
 */
export default defineEventHandler(async (event) => {
  try {
    const method = getMethod(event)
    const query = getQuery(event)
    const key = query.key as string

    if (!key) {
      return createErrorResponse('缺少必要参数: key', 400)
    }

    // 获取R2 bucket
    const { bucket } = event.context

    if (!bucket) {
      return createErrorResponse('R2 bucket 未配置', 500)
    }

    // 确保key以json结尾
    const jsonKey = key.endsWith('.json') ? key : `${key}.json`

    switch (method) {
      case 'GET':
        // 读取JSON文件
        try {
          const object = await bucket.get(jsonKey)

          if (!object) {
            return createSuccessResponse(null, '文件不存在')
          }

          const jsonData = await object.json()

          return createSuccessResponse({
            key: jsonKey,
            data: jsonData,
            size: object.size,
            lastModified: object.uploaded?.toISOString(),
          }, '读取成功')
        }
        catch (error) {
          return createErrorResponse(
            `读取文件失败: ${error instanceof Error ? error.message : '未知错误'}`,
            500,
          )
        }

      case 'POST':
      case 'PUT':
        // 写入JSON文件
        const data = await readBody(event)

        if (data === undefined) {
          return createErrorResponse('请求体不能为空', 400)
        }

        try {
          const jsonString = JSON.stringify(data, null, 2)

          await bucket.put(jsonKey, jsonString, {
            httpMetadata: {
              contentType: 'application/json',
            },
          })

          return createSuccessResponse({
            key: jsonKey,
            size: jsonString.length,
            timestamp: new Date().toISOString(),
          }, '写入成功')
        }
        catch (error) {
          return createErrorResponse(
            `写入文件失败: ${error instanceof Error ? error.message : '未知错误'}`,
            500,
          )
        }

      case 'DELETE':
        // 删除JSON文件
        try {
          const object = await bucket.get(jsonKey)

          if (!object) {
            return createSuccessResponse(null, '文件不存在')
          }

          await bucket.delete(jsonKey)

          return createSuccessResponse({
            key: jsonKey,
            deletedAt: new Date().toISOString(),
          }, '删除成功')
        }
        catch (error) {
          return createErrorResponse(
            `删除文件失败: ${error instanceof Error ? error.message : '未知错误'}`,
            500,
          )
        }

      default:
        return createErrorResponse('不支持的HTTP方法', 405)
    }
  }
  catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'JSON存储操作失败',
      500,
    )
  }
})
