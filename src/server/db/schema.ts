import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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


/**
 * Calendars table (Issue #4 / Architecture V0.3).
 * Exactly one owner: either `owner_user_id` (personal) or `family_id` (family).
 */
export const calendars = sqliteTable(
  'calendars',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    familyId: text('family_id').references(() => families.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Taipei'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_calendars_owner_user_id').on(table.ownerUserId),
    uniqueIndex('idx_calendars_family_id').on(table.familyId),
    check(
      'chk_calendars_single_owner',
      sql`(${table.ownerUserId} IS NOT NULL AND ${table.familyId} IS NULL) OR (${table.ownerUserId} IS NULL AND ${table.familyId} IS NOT NULL)`,
    ),
  ],
);

/**
 * Chat rooms table (Issue #4 / Architecture V0.3).
 * `kind = 'personal'` ("心情") belongs to a single `user_id`;
 * `kind = 'family'` is the single shared chat room of a `family_id`.
 */
export const chatRooms = sqliteTable(
  'chat_rooms',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(), // 'personal' | 'family'
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    familyId: text('family_id').references(() => families.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('Asia/Taipei'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_chat_rooms_user_id').on(table.userId),
    uniqueIndex('idx_chat_rooms_family_id').on(table.familyId),
    check(
      'chk_chat_rooms_kind_owner',
      sql`(${table.kind} = 'personal' AND ${table.userId} IS NOT NULL AND ${table.familyId} IS NULL) OR (${table.kind} = 'family' AND ${table.userId} IS NULL AND ${table.familyId} IS NOT NULL)`,
    ),
  ],
);

/**
 * Messages table (Issue #4 / Architecture V0.3 / Review A2).
 * Uses `deleted_at` for soft deletion so source foreign keys remain intact while hiding deleted content.
 * `local_date` is the room-timezone calendar date at send time; `record_date` is optional backdate.
 */
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
    senderUserId: text('sender_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    localDate: text('local_date').notNull(),
    recordDate: text('record_date'),
    deletedAt: text('deleted_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_messages_room_date_created').on(
      table.roomId,
      table.localDate,
      table.createdAt,
      table.id,
    ),
    index('idx_messages_room_created').on(table.roomId, table.createdAt, table.id),
  ],
);

/**
 * Events table (Issue #4 / Architecture V0.3 / Review A1).
 * Belongs to a `calendar_id` (personal or family) and optionally references a single `source_message_id`.
 */
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    calendarId: text('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    timezone: text('timezone').notNull().default('Asia/Taipei'),
    sourceMessageId: text('source_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_events_calendar_id').on(table.calendarId),
    index('idx_events_source_message_id').on(table.sourceMessageId),
  ],
);

/**
 * Task lists table (Issue #4 / Architecture V0.3).
 * Exactly one owner: either `owner_user_id` (personal) or `family_id` (family).
 */
export const taskLists = sqliteTable(
  'task_lists',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    familyId: text('family_id').references(() => families.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_task_lists_owner_user_id').on(table.ownerUserId),
    uniqueIndex('idx_task_lists_family_id').on(table.familyId),
    check(
      'chk_task_lists_single_owner',
      sql`(${table.ownerUserId} IS NOT NULL AND ${table.familyId} IS NULL) OR (${table.ownerUserId} IS NULL AND ${table.familyId} IS NOT NULL)`,
    ),
  ],
);

/**
 * Tasks table (Issue #4 / Architecture V0.3 / Review A1).
 * Belongs to a `list_id` (personal or family) and optionally references a single `source_message_id`.
 */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => taskLists.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    dueDate: text('due_date'),
    completedAt: text('completed_at'),
    sourceMessageId: text('source_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_tasks_list_id').on(table.listId),
    index('idx_tasks_source_message_id').on(table.sourceMessageId),
  ],
);

/**
 * Ledgers table (Issue #4 / Architecture V0.3).
 * Exactly one owner: either `owner_user_id` (personal) or `family_id` (family).
 */
export const ledgers = sqliteTable(
  'ledgers',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    familyId: text('family_id').references(() => families.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    currency: text('currency').notNull().default('TWD'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_ledgers_owner_user_id').on(table.ownerUserId),
    uniqueIndex('idx_ledgers_family_id').on(table.familyId),
    check(
      'chk_ledgers_single_owner',
      sql`(${table.ownerUserId} IS NOT NULL AND ${table.familyId} IS NULL) OR (${table.ownerUserId} IS NULL AND ${table.familyId} IS NOT NULL)`,
    ),
  ],
);

/**
 * Diaries table (Issue #4 / Architecture V0.3).
 * Strictly private to `user_id` (NOT NULL); never shared with any family.
 */
export const diaries = sqliteTable(
  'diaries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entryDate: text('entry_date').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_diaries_user_entry_date').on(table.userId, table.entryDate)],
);
