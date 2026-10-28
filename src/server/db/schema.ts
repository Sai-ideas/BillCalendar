import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Bootstrap metadata table for verifying D1 migrations and schema state in Issue #1.
 */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Users table (Issue #2).
 * Uses a stable internal UUID `id` as primary key; `email_normalized` has a UNIQUE constraint
 * and is used strictly as a lookup key in test identity simulation (never as a foreign key).
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    emailNormalized: text('email_normalized').notNull(),
    displayName: text('display_name').notNull(),
    defaultTimezone: text('default_timezone').notNull().default('Asia/Taipei'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_users_email_normalized').on(table.emailNormalized)],
);

/**
 * Demo/test sessions table (Issue #2).
 * Maps a temporary session token to an internal `user_id` for synthetic identity simulation.
 * Not a real authentication mechanism.
 */
export const testSessions = sqliteTable(
  'test_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_test_sessions_user_id').on(table.userId)],
);
