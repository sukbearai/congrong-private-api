import { int, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const snapshootTable = sqliteTable('snapshoot_table', {
  id: int().primaryKey({ autoIncrement: true }),
  symbol: text().notNull(),
  indexPrice: text().notNull(),
  markPrice: text().notNull(),
  topTraderAccountLsRatio: text().notNull(),
  openInterest: text().notNull(),
  timestamp: int().notNull(),
  oiChangePctPositive: real().notNull(),
  basisPercentNegative: real().notNull(),
  signal: text().notNull(),
})
