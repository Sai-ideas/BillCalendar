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

/**
 * Families table (Issue #3).
 * Represents a collaborative family space.
 */
export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Family members table (Issue #3).
 * Associates a user with a family and specifies their role ('admin' | 'member').
 * Protected by UNIQUE(family_id, user_id) to prevent duplicate joins.
 */
export const familyMembers = sqliteTable(
  'family_members',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'), // 'admin' | 'member'
    joinedAt: text('joined_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_family_members_family_user').on(table.familyId, table.userId),
    index('idx_family_members_user_id').on(table.userId),
    index('idx_family_members_family_id').on(table.familyId),
  ],
);

/**
 * Family invitations table (Issue #3).
 * In-app pending invitation mechanism for synthetic demo environment without SMTP.
 * Status lifecycle: pending -> accepted | rejected | revoked.
 */
export const familyInvitations = sqliteTable(
  'family_invitations',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    invitedEmail: text('invited_email').notNull(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'), // 'admin' | 'member'
    status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'rejected' | 'revoked'
    expiresAt: text('expires_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_family_invitations_email_status').on(table.invitedEmail, table.status),
    index('idx_family_invitations_family_id').on(table.familyId),
  ],
);
