import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const wordsCountTable = sqliteTable('words_count', {
  id: int().primaryKey({ autoIncrement: true }),
  clientWordsCount: int('client_words_count').notNull(),
  serverWordsCount: int('server_words_count'),
  downloadUrl: text('download_url'),
  createTime: text('create_time'),
  orderId: text('order_id'),
})
