import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const productsTable = sqliteTable('products_table', {
  id: int().primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  content: text().notNull(),
  checkedImg: text('checked_img').notNull(),
  uncheckedImg: text('unchecked_img').notNull(),
  deviceIds: text('device_ids').notNull(),
  constitutions: text().notNull(),
  createdAt: int('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: int('updated_at').notNull().$defaultFn(() => Date.now()),
})
