declare module 'h3' {
  interface H3EventContext {
    ai: Ai
  }
}

export default defineEventHandler(async (event) => {
  const cloudflare = event.context.cloudflare
  const { AI } = cloudflare.env
  event.context.ai = AI as Ai
})
