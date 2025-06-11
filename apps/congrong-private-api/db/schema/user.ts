import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const usersTable = sqliteTable('users_table', {
  id: int().primaryKey({ autoIncrement: true }),
  nickname: text().notNull(),
  phone: text().notNull(),
  password: text(),
  role: text().default('user'),
  deviceIds: text(),
})
