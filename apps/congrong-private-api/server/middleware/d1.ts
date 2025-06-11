declare module 'h3' {
  interface H3EventContext {
    db: DrizzleD1Database<typeof schema>
  }
}

export default defineEventHandler(async ({ context }) => {
  const cloudflare = context.cloudflare
  const { DB } = cloudflare.env
  context.db = drizzle(DB as D1Database, { schema, logger: true })
})
