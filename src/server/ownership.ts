import type { MiddlewareHandler } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  DATA_OWNERSHIP_SECURITY_NOTICE,
  DEFAULT_TIMEZONE,
  type DerivedEventSummary,
  type DerivedTaskSummary,
  type FamilyRole,
  type ResourceScope,
  type SimulatedUser,
  type SourceMessagePreview,
  type SourceMessageStatus,
} from '../shared';
import type { AuthAppEnv } from './auth';
import type { AppDatabase } from './db/client';
import {
  calendars,
  chatRooms,
  events,
  families,
  familyMembers,
  ledgers,
  messages,
  taskLists,
  tasks,
  users,
} from './db/schema';

/**
 * Formats a UTC Date into YYYY-MM-DD in the specified IANA timezone (default Asia/Taipei).
 */
export function formatLocalDateInTimezone(
  date: Date = new Date(),
  timezone: string = DEFAULT_TIMEZONE,
): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    const fallbackFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fallbackFormatter.format(date);
  }
}

/**
 * Checks whether a user is an active member of a family and returns their role.
 */
export async function getFamilyMembership(
  db: AppDatabase,
  userId: string,
  familyId: string,
): Promise<{ familyId: string; role: FamilyRole } | null> {
  const rows = await db
    .select({
      familyId: familyMembers.familyId,
      role: familyMembers.role,
    })
    .from(familyMembers)
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId)))
    .limit(1);

  const match = rows[0];
  if (!match) return null;
  return {
    familyId: match.familyId,
    role: match.role as FamilyRole,
  };
}

/**
 * Reusable Hono middleware that enforces family membership (and optionally admin role)
 * for routes with a familyId path parameter or query parameter.
 */
export function requireFamilyMemberMiddleware(
  paramName = 'id',
  options?: { requireAdmin?: boolean },
): MiddlewareHandler<AuthAppEnv> {
  return async (c, next) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const familyId = c.req.param(paramName) ?? c.req.query('familyId');

    if (!familyId) {
      return c.json(
        {
          error: 'VALIDATION_ERROR',
          simulationMode: true,
          isAuthenticatedSecurity: false,
          securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
          message: '缺少必要的家庭空間識別碼 (familyId)',
        },
        400,
      );
    }

    const membership = await getFamilyMembership(db, currentUser.id, familyId);
    if (!membership) {
      return c.json(
        {
          error: 'FORBIDDEN',
          simulationMode: true,
          isAuthenticatedSecurity: false,
          securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
          message: '您不是該家庭空間的成員或已退出',
        },
        403,
      );
    }

    if (options?.requireAdmin && membership.role !== 'admin') {
      return c.json(
        {
          error: 'FORBIDDEN',
          simulationMode: true,
          isAuthenticatedSecurity: false,
          securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
          message: '僅家庭管理員有權執行此操作',
        },
        403,
      );
    }

    c.set('familyMembership', membership);
    await next();
  };
}

/**
 * Guard against cross-user parameter tampering in query strings or request bodies.
 * Personal resources are strictly bound to `currentUser.id`; any attempt to supply another
 * user's `userId` or `ownerUserId` is rejected with 403 FORBIDDEN.
 */
export function hasCrossUserOverrideAttempt(
  currentUser: SimulatedUser,
  queryUserId?: string | null,
  queryOwnerUserId?: string | null,
  rawBody?: unknown,
): boolean {
  if (queryUserId && queryUserId.trim() !== currentUser.id) {
    return true;
  }
  if (queryOwnerUserId && queryOwnerUserId.trim() !== currentUser.id) {
    return true;
  }
  if (typeof rawBody === 'object' && rawBody !== null) {
    const record = rawBody as Record<string, unknown>;
    if (typeof record.userId === 'string' && record.userId.trim() !== currentUser.id) {
      return true;
    }
    if (typeof record.ownerUserId === 'string' && record.ownerUserId.trim() !== currentUser.id) {
      return true;
    }
  }
  return false;
}

/**
 * Idempotently provisions and returns the default personal containers
 * (`calendars`, `task_lists`, `ledgers`, `chat_rooms`) for `userId`.
 */
export async function ensurePersonalContainers(
  db: AppDatabase,
  userId: string,
  timezone: string = DEFAULT_TIMEZONE,
) {
  const nowIso = new Date().toISOString();

  await db
    .insert(calendars)
    .values({
      id: crypto.randomUUID(),
      ownerUserId: userId,
      familyId: null,
      name: '個人行事曆',
      timezone,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing({ target: calendars.ownerUserId });

  await db
    .insert(taskLists)
    .values({
      id: crypto.randomUUID(),
      ownerUserId: userId,
      familyId: null,
      name: '個人待辦清單',
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing({ target: taskLists.ownerUserId });

  await db
    .insert(ledgers)
    .values({
      id: crypto.randomUUID(),
      ownerUserId: userId,
      familyId: null,
      name: '個人帳本',
      currency: 'TWD',
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing({ target: ledgers.ownerUserId });

  await db
    .insert(chatRooms)
    .values({
      id: crypto.randomUUID(),
      kind: 'personal',
      userId,
      familyId: null,
      timezone,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing({ target: chatRooms.userId });

  const [calendarRow] = await db
    .select()
    .from(calendars)
    .where(eq(calendars.ownerUserId, userId))
    .limit(1);
  const [taskListRow] = await db
    .select()
    .from(taskLists)
    .where(eq(taskLists.ownerUserId, userId))
    .limit(1);
  const [ledgerRow] = await db
    .select()
    .from(ledgers)
    .where(eq(ledgers.ownerUserId, userId))
    .limit(1);
  const [chatRoomRow] = await db
    .select()
    .from(chatRooms)
    .where(eq(chatRooms.userId, userId))
    .limit(1);

  return {
    calendar: calendarRow!,
    taskList: taskListRow!,
    ledger: ledgerRow!,
    chatRoom: chatRoomRow!,
  };
}

/**
 * Idempotently provisions and returns the default family containers
 * (`calendars`, `task_lists`, `ledgers`, `chat_rooms`) for `familyId`.
 */
export async function ensureFamilyContainers(
  db: AppDatabase,
  familyId: string,
  familyName = '家庭空間',
  timezone: string = DEFAULT_TIMEZONE,
) {
  const nowIso = new Date().toISOString();

  await db
    .insert(calendars)
    .values({
      id: crypto.randomUUID(),
      ownerUserId: null,
      familyId,
      name: `${familyName} 行事曆`,
      timezone,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing({ target: calendars.familyId });

  await db
    .insert(taskLists)
    .values({
      id: crypto.randomUUID(),
      ownerUserId: null,
      familyId,
      name: `${familyName} 待辦清單`,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing({ target: taskLists.familyId });

  await db
    .insert(ledgers)
    .values({
      id: crypto.randomUUID(),
      ownerUserId: null,
      familyId,
      name: `${familyName} 帳本`,
      currency: 'TWD',
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing({ target: ledgers.familyId });

  await db
    .insert(chatRooms)
    .values({
      id: crypto.randomUUID(),
      kind: 'family',
      userId: null,
      familyId,
      timezone,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoNothing({ target: chatRooms.familyId });

  const [calendarRow] = await db
    .select()
    .from(calendars)
    .where(eq(calendars.familyId, familyId))
    .limit(1);
  const [taskListRow] = await db
    .select()
    .from(taskLists)
    .where(eq(taskLists.familyId, familyId))
    .limit(1);
  const [ledgerRow] = await db
    .select()
    .from(ledgers)
    .where(eq(ledgers.familyId, familyId))
    .limit(1);
  const [chatRoomRow] = await db
    .select()
    .from(chatRooms)
    .where(eq(chatRooms.familyId, familyId))
    .limit(1);

  return {
    calendar: calendarRow!,
    taskList: taskListRow!,
    ledger: ledgerRow!,
    chatRoom: chatRoomRow!,
  };
}

export type ChatRoomAccessResult =
  | {
      allowed: true;
      room: typeof chatRooms.$inferSelect;
      familyRole: FamilyRole | null;
    }
  | {
      allowed: false;
      status: 403 | 404;
      error: 'FORBIDDEN' | 'NOT_FOUND';
      message: string;
    };

/**
 * Verifies whether `currentUser` has read/write access to a `chat_room` by `roomId`.
 * Returns uniform 404 when a direct URL ID belongs to another user's private room or a non-member family,
 * preventing private room existence enumeration.
 */
export async function authorizeChatRoomById(
  db: AppDatabase,
  currentUser: SimulatedUser,
  roomId: string,
): Promise<ChatRoomAccessResult> {
  const rows = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId)).limit(1);
  const room = rows[0];
  if (!room) {
    return {
      allowed: false,
      status: 404,
      error: 'NOT_FOUND',
      message: '找不到該聊天室或無權限存取',
    };
  }

  if (room.kind === 'personal') {
    if (room.userId !== currentUser.id) {
      return {
        allowed: false,
        status: 404,
        error: 'NOT_FOUND',
        message: '找不到該聊天室或無權限存取',
      };
    }
    return { allowed: true, room, familyRole: null };
  }

  if (room.kind === 'family' && room.familyId) {
    const membership = await getFamilyMembership(db, currentUser.id, room.familyId);
    if (!membership) {
      return {
        allowed: false,
        status: 404,
        error: 'NOT_FOUND',
        message: '找不到該聊天室或無權限存取',
      };
    }
    return { allowed: true, room, familyRole: membership.role };
  }

  return {
    allowed: false,
    status: 404,
    error: 'NOT_FOUND',
    message: '找不到該聊天室或無權限存取',
  };
}

/**
 * Validates at target creation time (`POST /api/tasks` or `POST /api/events`) that a referenced
 * `sourceMessageId` exists, is not soft-deleted, and is currently readable by `currentUser`.
 * Returns a uniform 403 error on any failure so attackers cannot probe private message IDs.
 */
export async function authorizeSourceMessageForCreation(
  db: AppDatabase,
  currentUser: SimulatedUser,
  sourceMessageId: string,
): Promise<
  | {
      allowed: true;
      message: typeof messages.$inferSelect;
      room: typeof chatRooms.$inferSelect;
    }
  | {
      allowed: false;
      status: 403;
      error: 'SOURCE_MESSAGE_INACCESSIBLE';
      message: string;
    }
> {
  const rows = await db
    .select({
      message: messages,
      room: chatRooms,
      senderDisplayName: users.displayName,
    })
    .from(messages)
    .innerJoin(chatRooms, eq(messages.roomId, chatRooms.id))
    .leftJoin(users, eq(messages.senderUserId, users.id))
    .where(eq(messages.id, sourceMessageId))
    .limit(1);

  const match = rows[0];
  if (!match) {
    return {
      allowed: false,
      status: 403,
      error: 'SOURCE_MESSAGE_INACCESSIBLE',
      message: '來源訊息不存在、已移除或您無權限讀取',
    };
  }

  // Check room permission first
  if (match.room.kind === 'personal') {
    if (match.room.userId !== currentUser.id) {
      return {
        allowed: false,
        status: 403,
        error: 'SOURCE_MESSAGE_INACCESSIBLE',
        message: '來源訊息不存在、已移除或您無權限讀取',
      };
    }
  } else if (match.room.kind === 'family' && match.room.familyId) {
    const membership = await getFamilyMembership(db, currentUser.id, match.room.familyId);
    if (!membership) {
      return {
        allowed: false,
        status: 403,
        error: 'SOURCE_MESSAGE_INACCESSIBLE',
        message: '來源訊息不存在、已移除或您無權限讀取',
      };
    }
  } else {
    return {
      allowed: false,
      status: 403,
      error: 'SOURCE_MESSAGE_INACCESSIBLE',
      message: '來源訊息不存在、已移除或您無權限讀取',
    };
  }

  // Soft-deleted messages cannot be used to create new derived records
  if (match.message.deletedAt !== null) {
    return {
      allowed: false,
      status: 403,
      error: 'SOURCE_MESSAGE_INACCESSIBLE',
      message: '來源訊息不存在、已移除或您無權限讀取',
    };
  }

  return {
    allowed: true,
    message: match.message,
    room: match.room,
  };
}

/**
 * Independently resolves a target record's `source_message_id` for `currentUser` (Architecture Rule 4 / Review A1).
 * - Checks room access BEFORE `deleted_at`, so a former family member who left the group always receives
 *   `sourceStatus: 'inaccessible'` and `sourceMessage: null`, never learning whether the group message
 *   was later deleted or reading its contents.
 * - If the viewer has current room access and `deleted_at !== null`, returns `sourceStatus: 'deleted'`.
 */
export async function resolveSourceMessageForTarget(
  db: AppDatabase,
  currentUser: SimulatedUser,
  sourceMessageId: string | null,
): Promise<{
  sourceStatus: SourceMessageStatus;
  sourceMessage: SourceMessagePreview | null;
}> {
  if (!sourceMessageId) {
    return { sourceStatus: 'none', sourceMessage: null };
  }

  const rows = await db
    .select({
      message: messages,
      room: chatRooms,
      senderDisplayName: users.displayName,
    })
    .from(messages)
    .innerJoin(chatRooms, eq(messages.roomId, chatRooms.id))
    .leftJoin(users, eq(messages.senderUserId, users.id))
    .where(eq(messages.id, sourceMessageId))
    .limit(1);

  const match = rows[0];
  if (!match) {
    return { sourceStatus: 'deleted', sourceMessage: null };
  }

  // Step 1: Verify current read authorization on the source chat room
  if (match.room.kind === 'personal') {
    if (match.room.userId !== currentUser.id) {
      return { sourceStatus: 'inaccessible', sourceMessage: null };
    }
  } else if (match.room.kind === 'family' && match.room.familyId) {
    const membership = await getFamilyMembership(db, currentUser.id, match.room.familyId);
    if (!membership) {
      return { sourceStatus: 'inaccessible', sourceMessage: null };
    }
  } else {
    return { sourceStatus: 'inaccessible', sourceMessage: null };
  }

  // Step 2: Only after room authorization succeeds, check whether the message was soft-deleted
  if (match.message.deletedAt !== null) {
    return { sourceStatus: 'deleted', sourceMessage: null };
  }

  return {
    sourceStatus: 'accessible',
    sourceMessage: {
      id: match.message.id,
      roomId: match.message.roomId,
      roomKind: match.room.kind as ResourceScope,
      familyId: match.room.familyId,
      senderUserId: match.message.senderUserId,
      senderDisplayName: match.senderDisplayName ?? undefined,
      body: match.message.body,
      localDate: match.message.localDate,
      recordDate: match.message.recordDate,
      createdAt: match.message.createdAt,
    },
  };
}

/**
 * Fetches derived `tasks` and `events` referencing `messageId`, strictly filtered by `currentUser`'s
 * read permissions (Architecture Rule 4 / Review A1).
 *
 * CRITICAL PRIVACY INVARIANT:
 * When a family chat message is used by User A to create a personal task or personal event,
 * User B (another member of the same family) MUST NOT see the private record's title, status,
 * count, or even its existence. Only records owned by `currentUser` or belonging to a family
 * where `currentUser` is an active member are returned and counted.
 */
export async function getAuthorizedDerivedRecordsForMessage(
  db: AppDatabase,
  currentUser: SimulatedUser,
  messageId: string,
): Promise<{
  derivedTasks: DerivedTaskSummary[];
  derivedEvents: DerivedEventSummary[];
  derivedCount: number;
}> {
  const authorizedTaskRows = await db
    .select({
      task: tasks,
      taskList: taskLists,
    })
    .from(tasks)
    .innerJoin(taskLists, eq(tasks.listId, taskLists.id))
    .where(
      and(
        eq(tasks.sourceMessageId, messageId),
        sql`(
          ${taskLists.ownerUserId} = ${currentUser.id}
          OR (
            ${taskLists.familyId} IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM ${familyMembers}
              WHERE ${familyMembers.familyId} = ${taskLists.familyId}
                AND ${familyMembers.userId} = ${currentUser.id}
            )
          )
        )`,
      ),
    )
    .orderBy(asc(tasks.createdAt), asc(tasks.id));

  const authorizedEventRows = await db
    .select({
      event: events,
      calendar: calendars,
    })
    .from(events)
    .innerJoin(calendars, eq(events.calendarId, calendars.id))
    .where(
      and(
        eq(events.sourceMessageId, messageId),
        sql`(
          ${calendars.ownerUserId} = ${currentUser.id}
          OR (
            ${calendars.familyId} IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM ${familyMembers}
              WHERE ${familyMembers.familyId} = ${calendars.familyId}
                AND ${familyMembers.userId} = ${currentUser.id}
            )
          )
        )`,
      ),
    )
    .orderBy(asc(events.createdAt), asc(events.id));

  const derivedTasks: DerivedTaskSummary[] = authorizedTaskRows.map(({ task, taskList }) => ({
    id: task.id,
    scope: taskList.ownerUserId ? 'personal' : 'family',
    ownerUserId: taskList.ownerUserId,
    familyId: taskList.familyId,
    title: task.title,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
  }));

  const derivedEvents: DerivedEventSummary[] = authorizedEventRows.map(({ event, calendar }) => ({
    id: event.id,
    scope: calendar.ownerUserId ? 'personal' : 'family',
    ownerUserId: calendar.ownerUserId,
    familyId: calendar.familyId,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    createdAt: event.createdAt,
  }));

  return {
    derivedTasks,
    derivedEvents,
    derivedCount: derivedTasks.length + derivedEvents.length,
  };
}

/**
 * Lists all spaces (personal + active family memberships) authorized for `currentUser`.
 */
export async function getAuthorizedSpaceOverview(db: AppDatabase, currentUser: SimulatedUser) {
  const personal = await ensurePersonalContainers(
    db,
    currentUser.id,
    currentUser.defaultTimezone || DEFAULT_TIMEZONE,
  );

  const memberRows = await db
    .select({
      family: families,
      role: familyMembers.role,
    })
    .from(familyMembers)
    .innerJoin(families, eq(familyMembers.familyId, families.id))
    .where(eq(familyMembers.userId, currentUser.id))
    .orderBy(asc(familyMembers.joinedAt));

  const familySpaces = [];
  for (const row of memberRows) {
    const containers = await ensureFamilyContainers(
      db,
      row.family.id,
      row.family.name,
      currentUser.defaultTimezone || DEFAULT_TIMEZONE,
    );
    familySpaces.push({
      familyId: row.family.id,
      familyName: row.family.name,
      role: row.role as FamilyRole,
      calendarId: containers.calendar.id,
      taskListId: containers.taskList.id,
      ledgerId: containers.ledger.id,
      chatRoomId: containers.chatRoom.id,
    });
  }

  return {
    simulationMode: true as const,
    isAuthenticatedSecurity: false as const,
    securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
    personalSpace: {
      ownerUserId: currentUser.id,
      calendarId: personal.calendar.id,
      taskListId: personal.taskList.id,
      ledgerId: personal.ledger.id,
      chatRoomId: personal.chatRoom.id,
    },
    familySpaces,
  };
}
