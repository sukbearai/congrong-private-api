declare module 'h3' {
  interface H3EventContext {
    bucket: R2Bucket
  }
}

export default defineEventHandler(async (event) => {
  const cloudflare = event.context.cloudflare
  const { BUCKET } = cloudflare.env
  event.context.bucket = BUCKET as R2Bucket
})
