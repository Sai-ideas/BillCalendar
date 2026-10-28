import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Bootstrap metadata table for verifying D1 migrations and schema state in Issue #1.
 * Domain tables (users, families, calendars, events, tasks, messages, diaries, ledgers)
 * are introduced incrementally in their dedicated issues (#2-#13).
 */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});
