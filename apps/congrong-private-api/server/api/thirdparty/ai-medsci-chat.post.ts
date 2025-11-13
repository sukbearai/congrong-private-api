// ~/server/api/thirdparty/ai-medsci-chat.post.ts
import { z } from 'zod'

/* -------------------- 类型校验 -------------------- */
const chatMessageSchema = z.object({
  inputs: z.record(z.any()).optional().default({}),
  query: z.string({ required_error: '缺少必要参数 query' }),
  response_mode: z.enum(['streaming', 'blocking']).default('streaming'),
  conversation_id: z.string().optional().default(''),
  user: z.string({ required_error: '缺少必要参数 user' }),
  files: z.array(z.any()).optional().default([]),
})

/* -------------------- 主函数 -------------------- */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  /* ---------- 0. 权限校验 ---------- */
  const aiEnabled = event.context.user.aiEnabled
  if (!aiEnabled) {
    throw createError({ statusCode: 400, statusMessage: '当前用户没有激活AI' })
  }
  /* ---------- 1. 读体 & 校验 ---------- */
  const rawBody = await readBody(event)
  const parsed = chatMessageSchema.safeParse(rawBody)
  if (!parsed.success) {
    const msg = parsed.error.errors.map(e => e.message).join('; ')
    throw createError({ statusCode: 400, statusMessage: msg })
  }
  const chatData = parsed.data

  /* ---------- 2. 调上游 ---------- */
  const upstream = await fetch('https://ai.medsci.cn/v1/chat-messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.aiMedsciApiToken}`,
      'Content-Type': 'application/json',
      'Accept': chatData.response_mode === 'streaming' ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(chatData),
  })

  if (!upstream.ok) {
    throw createError({ statusCode: upstream.status, statusMessage: `上游错误 ${upstream.status}` })
  }

  /* ---------- 3. 阻塞模式 ---------- */
  if (chatData.response_mode === 'blocking') {
    return await upstream.json()
  }

  /* ---------- 4. 流式模式 ---------- */
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })

  const reader = upstream.body!.getReader()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  return sendStream(event, new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let buf = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) { break }

          buf += decoder.decode(value, { stream: true })
          const lines = buf.split(/\r?\n/)
          buf = lines.pop()! // 最后一行可能不完整

          for (const line of lines) {
            ctrl.enqueue(encoder.encode(`${line}\n`))
          }
        }
        /* 把尾巴写出去 */
        if (buf.trim()) { ctrl.enqueue(encoder.encode(`${buf}\n`)) }
      }
      catch (e) {
        ctrl.error(e)
      }
      finally {
        reader.releaseLock()
        ctrl.close()
      }
    },
  }))
})
