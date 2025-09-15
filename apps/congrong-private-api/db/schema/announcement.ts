import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const announcementTable = sqliteTable('announcement_table', {
  id: int().primaryKey({ autoIncrement: true }),
  userId: int('user_id').notNull(),
  title: text().notNull(),
  content: text().notNull(),
  wechatUrl: text().notNull(),
  createdAt: int('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: int('updated_at').notNull().$defaultFn(() => Date.now()),
})
