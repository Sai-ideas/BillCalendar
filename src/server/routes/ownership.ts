import { Hono } from 'hono';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  CreateDiaryRequestSchema,
  CreateEventRequestSchema,
  CreateMessageRequestSchema,
  CreateTaskRequestSchema,
  DATA_OWNERSHIP_SECURITY_NOTICE,
  DEFAULT_TIMEZONE,
  UpdateDiaryRequestSchema,
  UpdateEventRequestSchema,
  UpdateTaskRequestSchema,
  addDaysToLocalDate,
  buildMonthCalendarGrid,
  isValidLocalDateString,
  isValidUtcIsoTimestamp,
  normalizeToUtcIsoTimestamp,
  resolveEventCalendarDates,
  type ChatRoomSummary,
  type DiaryEntry,
  type EventDetail,
  type MessageWithAuthorizedDerived,
  type PaginatedMessagesResponse,
  type ResourceScope,
  type TaskDetail,
} from '../../shared';
import {
  requireAuthMiddleware,
  testIdentitySecurityHeadersMiddleware,
  type AuthAppEnv,
} from '../auth';
import {
  calendars,
  diaries,
  events,
  families,
  familyMembers,
  messages,
  taskLists,
  tasks,
  users,
} from '../db/schema';
import {
  authorizeChatRoomById,
  authorizeSourceMessageForCreation,
  ensureFamilyContainers,
  ensurePersonalContainers,
  formatLocalDateInTimezone,
  getAuthorizedDerivedRecordsForMessage,
  getAuthorizedSpaceOverview,
  getFamilyMembership,
  hasCrossUserOverrideAttempt,
  requireFamilyMemberMiddleware,
  resolveSourceMessageForTarget,
} from '../ownership';

function crossUserForbiddenResponse() {
  return {
    error: 'FORBIDDEN',
    simulationMode: true as const,
    isAuthenticatedSecurity: false as const,
    securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
    message: '禁止指定或存取其他使用者的個人空間資源 (user_id 越權存取拒絕)',
  };
}

function familyAccessForbiddenResponse(message = '您不是該家庭空間的成員或已退出') {
  return {
    error: 'FORBIDDEN',
    simulationMode: true as const,
    isAuthenticatedSecurity: false as const,
    securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
    message,
  };
}

function resourceNotFoundOrInaccessibleResponse(message = '找不到該資源或無權限存取') {
  return {
    error: 'NOT_FOUND',
    simulationMode: true as const,
    isAuthenticatedSecurity: false as const,
    securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
    message,
  };
}

export function createSpacesRouter() {
  const router = new Hono<AuthAppEnv>();

  router.use('*', testIdentitySecurityHeadersMiddleware);
  router.use('*', requireAuthMiddleware);

  // GET /api/spaces - Overview of current user's personal space and active family spaces
  router.get('/', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');

    if (
      hasCrossUserOverrideAttempt(
        currentUser,
        c.req.query('userId'),
        c.req.query('ownerUserId'),
      )
    ) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    const overview = await getAuthorizedSpaceOverview(db, currentUser);
    return c.json(overview, 200);
  });

  // GET /api/spaces/families/:familyId - Verify family membership via middleware and return space containers
  router.get('/families/:familyId', requireFamilyMemberMiddleware('familyId'), async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const membership = c.get('familyMembership')!;

    const [familyRow] = await db
      .select()
      .from(families)
      .where(eq(families.id, membership.familyId))
      .limit(1);

    if (!familyRow) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該家庭空間'), 404);
    }

    const containers = await ensureFamilyContainers(
      db,
      familyRow.id,
      familyRow.name,
      currentUser.defaultTimezone || DEFAULT_TIMEZONE,
    );

    return c.json(
      {
        simulationMode: true,
        isAuthenticatedSecurity: false,
        securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
        familyId: familyRow.id,
        familyName: familyRow.name,
        role: membership.role,
        calendarId: containers.calendar.id,
        taskListId: containers.taskList.id,
        ledgerId: containers.ledger.id,
        chatRoomId: containers.chatRoom.id,
      },
      200,
    );
  });

  return router;
}

export function createDiariesRouter() {
  const router = new Hono<AuthAppEnv>();

  router.use('*', testIdentitySecurityHeadersMiddleware);
  router.use('*', requireAuthMiddleware);

  // GET /api/diaries - List personal diaries strictly filtered by currentUser.id
  router.get('/', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');

    if (c.req.query('familyId') || c.req.query('scope') === 'family') {
      return c.json(
        {
          error: 'DIARY_ALWAYS_PRIVATE',
          simulationMode: true,
          isAuthenticatedSecurity: false,
          securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
          message: '私人日記僅限個人擁有，禁止公開或家庭共享',
        },
        403,
      );
    }

    if (
      hasCrossUserOverrideAttempt(
        currentUser,
        c.req.query('userId'),
        c.req.query('ownerUserId'),
      )
    ) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    const entryDate = c.req.query('entryDate')?.trim();
    const rows = entryDate
      ? await db
          .select()
          .from(diaries)
          .where(and(eq(diaries.userId, currentUser.id), eq(diaries.entryDate, entryDate)))
          .orderBy(desc(diaries.entryDate), desc(diaries.createdAt))
      : await db
          .select()
          .from(diaries)
          .where(eq(diaries.userId, currentUser.id))
          .orderBy(desc(diaries.entryDate), desc(diaries.createdAt));

    const payload: DiaryEntry[] = rows;
    return c.json(payload, 200);
  });

  // POST /api/diaries - Create a personal diary entry (strictly personal)
  router.post('/', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    if (typeof rawBody === 'object' && rawBody !== null) {
      const record = rawBody as Record<string, unknown>;
      if (record.familyId !== undefined || record.scope === 'family') {
        return c.json(
          {
            error: 'DIARY_ALWAYS_PRIVATE',
            simulationMode: true,
            isAuthenticatedSecurity: false,
            securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
            message: '私人日記僅限個人擁有，禁止公開或家庭共享',
          },
          403,
        );
      }
    }

    if (hasCrossUserOverrideAttempt(currentUser, null, null, rawBody)) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    const parsed = CreateDiaryRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的日記資料';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    const nowIso = new Date().toISOString();
    const diaryId = crypto.randomUUID();
    const entry: DiaryEntry = {
      id: diaryId,
      userId: currentUser.id,
      entryDate: parsed.data.entryDate,
      title: parsed.data.title,
      body: parsed.data.body,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await db.insert(diaries).values(entry);
    return c.json(entry, 201);
  });

  // GET /api/diaries/:id - Get personal diary by ID (uniform 404 if not owned by currentUser)
  router.get('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const diaryId = c.req.param('id');

    const rows = await db
      .select()
      .from(diaries)
      .where(and(eq(diaries.id, diaryId), eq(diaries.userId, currentUser.id)))
      .limit(1);

    const entry = rows[0];
    if (!entry) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該私人日記或無權限存取'), 404);
    }

    return c.json(entry, 200);
  });

  // PATCH /api/diaries/:id - Update personal diary by ID (uniform 404 if not owned by currentUser)
  router.patch('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const diaryId = c.req.param('id');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    if (typeof rawBody === 'object' && rawBody !== null) {
      const record = rawBody as Record<string, unknown>;
      if (record.familyId !== undefined || record.scope === 'family') {
        return c.json(
          {
            error: 'DIARY_ALWAYS_PRIVATE',
            simulationMode: true,
            isAuthenticatedSecurity: false,
            securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
            message: '私人日記僅限個人擁有，禁止公開或家庭共享',
          },
          403,
        );
      }
    }

    if (hasCrossUserOverrideAttempt(currentUser, null, null, rawBody)) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    const existingRows = await db
      .select()
      .from(diaries)
      .where(and(eq(diaries.id, diaryId), eq(diaries.userId, currentUser.id)))
      .limit(1);

    if (existingRows.length === 0) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該私人日記或無權限存取'), 404);
    }

    const parsed = UpdateDiaryRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的日記更新資料';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    const nowIso = new Date().toISOString();
    const updatedRows = await db
      .update(diaries)
      .set({
        ...(parsed.data.entryDate !== undefined ? { entryDate: parsed.data.entryDate } : {}),
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
        updatedAt: nowIso,
      })
      .where(and(eq(diaries.id, diaryId), eq(diaries.userId, currentUser.id)))
      .returning();

    if (updatedRows.length === 0) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該私人日記或無權限存取'), 404);
    }

    return c.json(updatedRows[0], 200);
  });

  // DELETE /api/diaries/:id - Delete personal diary by ID (uniform 404 if not owned by currentUser)
  router.delete('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const diaryId = c.req.param('id');

    const deletedRows = await db
      .delete(diaries)
      .where(and(eq(diaries.id, diaryId), eq(diaries.userId, currentUser.id)))
      .returning({ id: diaries.id });

    if (deletedRows.length === 0) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該私人日記或無權限存取'), 404);
    }

    return c.json({ success: true, id: diaryId }, 200);
  });

  return router;
}

export function createChatRoomsRouter() {
  const router = new Hono<AuthAppEnv>();

  router.use('*', testIdentitySecurityHeadersMiddleware);
  router.use('*', requireAuthMiddleware);

  // GET /api/chat-rooms - List authorized chat rooms (personal "心情" room + active family rooms)
  router.get('/', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');

    if (
      hasCrossUserOverrideAttempt(
        currentUser,
        c.req.query('userId'),
        c.req.query('ownerUserId'),
      )
    ) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    const scopeQuery = c.req.query('scope');
    const familyIdQuery = c.req.query('familyId')?.trim();

    if (familyIdQuery || scopeQuery === 'family') {
      if (!familyIdQuery) {
        return c.json({ error: 'VALIDATION_ERROR', message: '查詢家庭聊天室必須提供 familyId' }, 400);
      }
      const membership = await getFamilyMembership(db, currentUser.id, familyIdQuery);
      if (!membership) {
        return c.json(familyAccessForbiddenResponse(), 403);
      }
      const [fam] = await db
        .select()
        .from(families)
        .where(eq(families.id, familyIdQuery))
        .limit(1);
      const containers = await ensureFamilyContainers(
        db,
        familyIdQuery,
        fam?.name ?? '家庭空間',
        currentUser.defaultTimezone || DEFAULT_TIMEZONE,
      );
      const roomSummary: ChatRoomSummary = {
        id: containers.chatRoom.id,
        kind: 'family',
        userId: null,
        familyId: containers.chatRoom.familyId,
        timezone: containers.chatRoom.timezone,
        createdAt: containers.chatRoom.createdAt,
        updatedAt: containers.chatRoom.updatedAt,
      };
      return c.json([roomSummary], 200);
    }

    const personal = await ensurePersonalContainers(
      db,
      currentUser.id,
      currentUser.defaultTimezone || DEFAULT_TIMEZONE,
    );
    const personalSummary: ChatRoomSummary = {
      id: personal.chatRoom.id,
      kind: 'personal',
      userId: personal.chatRoom.userId,
      familyId: null,
      timezone: personal.chatRoom.timezone,
      createdAt: personal.chatRoom.createdAt,
      updatedAt: personal.chatRoom.updatedAt,
    };

    if (scopeQuery === 'personal') {
      return c.json([personalSummary], 200);
    }

    const memberRows = await db
      .select({
        family: families,
      })
      .from(familyMembers)
      .innerJoin(families, eq(familyMembers.familyId, families.id))
      .where(eq(familyMembers.userId, currentUser.id))
      .orderBy(asc(familyMembers.joinedAt));

    const rooms: ChatRoomSummary[] = [personalSummary];
    for (const row of memberRows) {
      const containers = await ensureFamilyContainers(
        db,
        row.family.id,
        row.family.name,
        currentUser.defaultTimezone || DEFAULT_TIMEZONE,
      );
      rooms.push({
        id: containers.chatRoom.id,
        kind: 'family',
        userId: null,
        familyId: containers.chatRoom.familyId,
        timezone: containers.chatRoom.timezone,
        createdAt: containers.chatRoom.createdAt,
        updatedAt: containers.chatRoom.updatedAt,
      });
    }

    return c.json(rooms, 200);
  });

  // GET /api/chat-rooms/:roomId/messages - List active messages in a room with viewer-scoped derived records
    // GET /api/chat-rooms/:roomId/messages - List active messages in a room with pagination, anchor date, and viewer-scoped derived records
  router.get('/:roomId/messages', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const roomId = c.req.param('roomId');

    const access = await authorizeChatRoomById(db, currentUser, roomId);
    if (!access.allowed) {
      return c.json(resourceNotFoundOrInaccessibleResponse(access.message), access.status);
    }

    const url = new URL(c.req.url);
    const anchorDate = url.searchParams.get('anchorDate')?.trim() || undefined;
    const targetMessageId = url.searchParams.get('targetMessageId')?.trim() || undefined;
    const beforeCursor = url.searchParams.get('before')?.trim() || undefined;
    const afterCursor = url.searchParams.get('after')?.trim() || undefined;
    const limitRaw = url.searchParams.get('limit');
    let limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100;

    async function getAnchorMessage(cursorId: string) {
      const rows = await db
        .select({
          id: messages.id,
          createdAt: messages.createdAt,
          localDate: messages.localDate,
          deletedAt: messages.deletedAt,
        })
        .from(messages)
        .where(and(eq(messages.roomId, roomId), eq(messages.id, cursorId)))
        .limit(1);
      return rows[0] ?? null;
    }

    let selectedRows: { message: typeof messages.$inferSelect; senderDisplayName: string | null }[] = [];
    let hasMoreBefore = false;
    let hasMoreAfter = false;
    let targetMessageFound: boolean | undefined = undefined;

    if (targetMessageId) {
      const target = await getAnchorMessage(targetMessageId);
      if (!target || target.deletedAt !== null) {
        targetMessageFound = false;
      } else {
        targetMessageFound = true;
        const half = Math.floor(limit / 2);
        const earlierRows = await db
          .select({ message: messages, senderDisplayName: users.displayName })
          .from(messages)
          .leftJoin(users, eq(messages.senderUserId, users.id))
          .where(
            and(
              eq(messages.roomId, roomId),
              isNull(messages.deletedAt),
              sql`(${messages.createdAt} < ${target.createdAt} OR (${messages.createdAt} = ${target.createdAt} AND ${messages.id} < ${target.id}))`,
            ),
          )
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(half + 1);

        if (earlierRows.length > half) {
          hasMoreBefore = true;
          earlierRows.splice(half);
        }

        const laterRows = await db
          .select({ message: messages, senderDisplayName: users.displayName })
          .from(messages)
          .leftJoin(users, eq(messages.senderUserId, users.id))
          .where(
            and(
              eq(messages.roomId, roomId),
              isNull(messages.deletedAt),
              sql`(${messages.createdAt} > ${target.createdAt} OR (${messages.createdAt} = ${target.createdAt} AND ${messages.id} >= ${target.id}))`,
            ),
          )
          .orderBy(asc(messages.createdAt), asc(messages.id))
          .limit(limit - half + 1);

        if (laterRows.length > limit - half) {
          hasMoreAfter = true;
          laterRows.splice(limit - half);
        }

        selectedRows = [...earlierRows.reverse(), ...laterRows];
      }
    }

    if (!targetMessageId || targetMessageFound === false) {
      if (beforeCursor) {
        const cursor = await getAnchorMessage(beforeCursor);
        if (cursor) {
          const rows = await db
            .select({ message: messages, senderDisplayName: users.displayName })
            .from(messages)
            .leftJoin(users, eq(messages.senderUserId, users.id))
            .where(
              and(
                eq(messages.roomId, roomId),
                isNull(messages.deletedAt),
                sql`(${messages.createdAt} < ${cursor.createdAt} OR (${messages.createdAt} = ${cursor.createdAt} AND ${messages.id} < ${cursor.id}))`,
              ),
            )
            .orderBy(desc(messages.createdAt), desc(messages.id))
            .limit(limit + 1);

          if (rows.length > limit) {
            hasMoreBefore = true;
            rows.splice(limit);
          }
          hasMoreAfter = true;
          selectedRows = rows.reverse();
        }
      } else if (afterCursor) {
        const cursor = await getAnchorMessage(afterCursor);
        if (cursor) {
          const rows = await db
            .select({ message: messages, senderDisplayName: users.displayName })
            .from(messages)
            .leftJoin(users, eq(messages.senderUserId, users.id))
            .where(
              and(
                eq(messages.roomId, roomId),
                isNull(messages.deletedAt),
                sql`(${messages.createdAt} > ${cursor.createdAt} OR (${messages.createdAt} = ${cursor.createdAt} AND ${messages.id} > ${cursor.id}))`,
              ),
            )
            .orderBy(asc(messages.createdAt), asc(messages.id))
            .limit(limit + 1);

          if (rows.length > limit) {
            hasMoreAfter = true;
            rows.splice(limit);
          }
          hasMoreBefore = true;
          selectedRows = rows;
        }
      } else if (anchorDate) {
        // Issue #10: Locate message close to anchorDate utilizing idx_messages_room_date_created
        const exactRows = await db
          .select({ id: messages.id, createdAt: messages.createdAt })
          .from(messages)
          .where(
            and(
              eq(messages.roomId, roomId),
              eq(messages.localDate, anchorDate),
              isNull(messages.deletedAt),
            ),
          )
          .orderBy(asc(messages.createdAt), asc(messages.id))
          .limit(1);

        let anchor = exactRows[0];
        if (!anchor) {
          const nextRows = await db
            .select({ id: messages.id, createdAt: messages.createdAt })
            .from(messages)
            .where(
              and(
                eq(messages.roomId, roomId),
                sql`${messages.localDate} > ${anchorDate}`,
                isNull(messages.deletedAt),
              ),
            )
            .orderBy(asc(messages.localDate), asc(messages.createdAt), asc(messages.id))
            .limit(1);
          anchor = nextRows[0];
        }
        if (!anchor) {
          const prevRows = await db
            .select({ id: messages.id, createdAt: messages.createdAt })
            .from(messages)
            .where(
              and(
                eq(messages.roomId, roomId),
                sql`${messages.localDate} < ${anchorDate}`,
                isNull(messages.deletedAt),
              ),
            )
            .orderBy(desc(messages.localDate), desc(messages.createdAt), desc(messages.id))
            .limit(1);
          anchor = prevRows[0];
        }

        if (anchor) {
          const half = Math.floor(limit / 2);
          const earlierRows = await db
            .select({ message: messages, senderDisplayName: users.displayName })
            .from(messages)
            .leftJoin(users, eq(messages.senderUserId, users.id))
            .where(
              and(
                eq(messages.roomId, roomId),
                isNull(messages.deletedAt),
                sql`(${messages.createdAt} < ${anchor.createdAt} OR (${messages.createdAt} = ${anchor.createdAt} AND ${messages.id} < ${anchor.id}))`,
              ),
            )
            .orderBy(desc(messages.createdAt), desc(messages.id))
            .limit(half + 1);

          if (earlierRows.length > half) {
            hasMoreBefore = true;
            earlierRows.splice(half);
          }

          const laterRows = await db
            .select({ message: messages, senderDisplayName: users.displayName })
            .from(messages)
            .leftJoin(users, eq(messages.senderUserId, users.id))
            .where(
              and(
                eq(messages.roomId, roomId),
                isNull(messages.deletedAt),
                sql`(${messages.createdAt} > ${anchor.createdAt} OR (${messages.createdAt} = ${anchor.createdAt} AND ${messages.id} >= ${anchor.id}))`,
              ),
            )
            .orderBy(asc(messages.createdAt), asc(messages.id))
            .limit(limit - half + 1);

          if (laterRows.length > limit - half) {
            hasMoreAfter = true;
            laterRows.splice(limit - half);
          }

          selectedRows = [...earlierRows.reverse(), ...laterRows];
        }
      } else {
        // Default: most recent messages
        const rows = await db
          .select({ message: messages, senderDisplayName: users.displayName })
          .from(messages)
          .leftJoin(users, eq(messages.senderUserId, users.id))
          .where(and(eq(messages.roomId, roomId), isNull(messages.deletedAt)))
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(limit + 1);

        if (rows.length > limit) {
          hasMoreBefore = true;
          rows.splice(limit);
        }
        hasMoreAfter = false;
        selectedRows = rows.reverse();
      }
    }

    const resultList: MessageWithAuthorizedDerived[] = [];
    for (const row of selectedRows) {
      const msg = row.message;
      const derived = await getAuthorizedDerivedRecordsForMessage(db, currentUser, msg.id);
      resultList.push({
        id: msg.id,
        roomId: msg.roomId,
        roomKind: access.room.kind as ResourceScope,
        familyId: access.room.familyId,
        senderUserId: msg.senderUserId,
        senderDisplayName: row.senderDisplayName ?? undefined,
        body: msg.body,
        localDate: msg.localDate,
        recordDate: msg.recordDate,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
        derivedTasks: derived.derivedTasks,
        derivedEvents: derived.derivedEvents,
        derivedCount: derived.derivedCount,
      });
    }

    const payload: PaginatedMessagesResponse = {
      messages: resultList,
      hasMoreBefore,
      hasMoreAfter,
      startCursor: resultList.length > 0 ? resultList[0].id : null,
      endCursor: resultList.length > 0 ? resultList[resultList.length - 1].id : null,
      anchorDate: anchorDate ?? null,
      targetMessageFound,
    };

    return c.json(payload, 200);
  });

  // POST /api/chat-rooms/:roomId/messages - Post a message to an authorized personal or family chat room
  router.post('/:roomId/messages', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const roomId = c.req.param('roomId');

    const access = await authorizeChatRoomById(db, currentUser, roomId);
    if (!access.allowed) {
      return c.json(resourceNotFoundOrInaccessibleResponse(access.message), access.status);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    if (hasCrossUserOverrideAttempt(currentUser, null, null, rawBody)) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    const parsed = CreateMessageRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的訊息資料';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const localDate =
      parsed.data.localDate ?? formatLocalDateInTimezone(now, access.room.timezone);
    const recordDate = parsed.data.recordDate ?? null;
    const messageId = crypto.randomUUID();

    // Statement-level SQL ownership/membership guard preventing TOCTOU race if membership is revoked concurrently
    const insertResult = await c.env.DB!.prepare(`
      INSERT INTO messages (id, room_id, sender_user_id, body, created_at, local_date, record_date, deleted_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?
      WHERE EXISTS (
        SELECT 1 FROM chat_rooms cr
        WHERE cr.id = ?
          AND (
            (cr.kind = 'personal' AND cr.user_id = ?)
            OR (
              cr.kind = 'family'
              AND EXISTS (
                SELECT 1 FROM family_members fm
                WHERE fm.family_id = cr.family_id AND fm.user_id = ?
              )
            )
          )
      )
    `)
      .bind(
        messageId,
        access.room.id,
        currentUser.id,
        parsed.data.body,
        nowIso,
        localDate,
        recordDate,
        nowIso,
        access.room.id,
        currentUser.id,
        currentUser.id,
      )
      .run();

    if ((insertResult.meta?.changes ?? 0) === 0) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該聊天室或無權限存取'), 404);
    }

    const payload: MessageWithAuthorizedDerived = {
      id: messageId,
      roomId: access.room.id,
      roomKind: access.room.kind as ResourceScope,
      familyId: access.room.familyId,
      senderUserId: currentUser.id,
      senderDisplayName: currentUser.displayName,
      body: parsed.data.body,
      localDate,
      recordDate,
      createdAt: nowIso,
      updatedAt: nowIso,
      derivedTasks: [],
      derivedEvents: [],
      derivedCount: 0,
    };

    return c.json(payload, 201);
  });

  return router;
}

export function createMessagesRouter() {
  const router = new Hono<AuthAppEnv>();

  router.use('*', testIdentitySecurityHeadersMiddleware);
  router.use('*', requireAuthMiddleware);

  // GET /api/messages/:id - Get a single message with viewer-authorized derived records
  router.get('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const messageId = c.req.param('id');

    const rows = await db
      .select({
        message: messages,
        senderDisplayName: users.displayName,
      })
      .from(messages)
      .leftJoin(users, eq(messages.senderUserId, users.id))
      .where(eq(messages.id, messageId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該訊息或無權限存取'), 404);
    }
    const msg = row.message;

    const access = await authorizeChatRoomById(db, currentUser, msg.roomId);
    if (!access.allowed) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該訊息或無權限存取'), 404);
    }

    if (msg.deletedAt !== null) {
      return c.json(resourceNotFoundOrInaccessibleResponse('該訊息已移除'), 404);
    }

    const derived = await getAuthorizedDerivedRecordsForMessage(db, currentUser, msg.id);
    const payload: MessageWithAuthorizedDerived = {
      id: msg.id,
      roomId: msg.roomId,
      roomKind: access.room.kind as ResourceScope,
      familyId: access.room.familyId,
      senderUserId: msg.senderUserId,
      senderDisplayName: row.senderDisplayName ?? undefined,
      body: msg.body,
      localDate: msg.localDate,
      recordDate: msg.recordDate,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
      derivedTasks: derived.derivedTasks,
      derivedEvents: derived.derivedEvents,
      derivedCount: derived.derivedCount,
    };

    return c.json(payload, 200);
  });

  // DELETE /api/messages/:id - Soft-delete a message (retains ID for source_message_id foreign keys)
  router.delete('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const messageId = c.req.param('id');

    const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    const msg = rows[0];
    if (!msg) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該訊息或無權限存取'), 404);
    }

    const access = await authorizeChatRoomById(db, currentUser, msg.roomId);
    if (!access.allowed) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該訊息或無權限存取'), 404);
    }

    if (
      access.room.kind === 'family' &&
      msg.senderUserId !== currentUser.id &&
      access.familyRole !== 'admin'
    ) {
      return c.json(
        {
          error: 'FORBIDDEN',
          simulationMode: true,
          isAuthenticatedSecurity: false,
          securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
          message: '僅訊息發送者本人或家庭管理員可刪除群組訊息',
        },
        403,
      );
    }

    if (msg.deletedAt !== null) {
      return c.json(resourceNotFoundOrInaccessibleResponse('該訊息已移除'), 404);
    }

    const nowIso = new Date().toISOString();
    const updatedRows = await db
      .update(messages)
      .set({
        deletedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(messages.id, messageId),
          isNull(messages.deletedAt),
          sql`EXISTS (
            SELECT 1 FROM chat_rooms cr
            WHERE cr.id = ${messages.roomId}
              AND (
                (cr.kind = 'personal' AND cr.user_id = ${currentUser.id})
                OR (
                  cr.kind = 'family'
                  AND EXISTS (
                    SELECT 1 FROM family_members fm
                    WHERE fm.family_id = cr.family_id
                      AND fm.user_id = ${currentUser.id}
                      AND (${messages.senderUserId} = ${currentUser.id} OR fm.role = 'admin')
                  )
                )
              )
          )`,
        ),
      )
      .returning({ id: messages.id });

    if (updatedRows.length === 0) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該訊息或無權限刪除'), 404);
    }

    return c.json({ success: true, id: messageId, deletedAt: nowIso }, 200);
  });

  return router;
}

export function createTasksRouter() {
  const router = new Hono<AuthAppEnv>();

  router.use('*', testIdentitySecurityHeadersMiddleware);
  router.use('*', requireAuthMiddleware);

  // GET /api/tasks - List personal or family tasks with independent source message resolution
  router.get('/', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');

    if (
      hasCrossUserOverrideAttempt(
        currentUser,
        c.req.query('userId'),
        c.req.query('ownerUserId'),
      )
    ) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    const rawScope = c.req.query('scope');
    if (rawScope && rawScope !== 'personal' && rawScope !== 'family') {
      return c.json({ error: 'VALIDATION_ERROR', message: '無效的空間範圍 (scope)' }, 400);
    }
    const scopeQuery = rawScope ?? (c.req.query('familyId') ? 'family' : 'personal');
    const familyId = c.req.query('familyId')?.trim();
    if (rawScope === 'personal' && familyId) {
      return c.json(
        { error: 'VALIDATION_ERROR', message: '個人空間待辦查詢不可指定 familyId' },
        400,
      );
    }

    if (scopeQuery === 'family') {
      if (!familyId) {
        return c.json({ error: 'VALIDATION_ERROR', message: '查詢家庭待辦必須提供 familyId' }, 400);
      }
      const membership = await getFamilyMembership(db, currentUser.id, familyId);
      if (!membership) {
        return c.json(familyAccessForbiddenResponse(), 403);
      }

      const [fam] = await db.select().from(families).where(eq(families.id, familyId)).limit(1);
      const containers = await ensureFamilyContainers(
        db,
        familyId,
        fam?.name ?? '家庭空間',
        currentUser.defaultTimezone || DEFAULT_TIMEZONE,
      );

      const taskRows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.listId, containers.taskList.id))
        .orderBy(asc(tasks.createdAt), asc(tasks.id));

      const result: TaskDetail[] = [];
      for (const t of taskRows) {
        const resolvedSource = await resolveSourceMessageForTarget(
          db,
          currentUser,
          t.sourceMessageId,
        );
        result.push({
          id: t.id,
          listId: t.listId,
          scope: 'family',
          ownerUserId: null,
          familyId,
          title: t.title,
          dueDate: t.dueDate,
          completedAt: t.completedAt,
          sourceMessageId: t.sourceMessageId,
          sourceStatus: resolvedSource.sourceStatus,
          sourceMessage: resolvedSource.sourceMessage,
          createdBy: t.createdBy,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        });
      }

      return c.json(result, 200);
    }

    const personal = await ensurePersonalContainers(
      db,
      currentUser.id,
      currentUser.defaultTimezone || DEFAULT_TIMEZONE,
    );

    const taskRows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.listId, personal.taskList.id))
      .orderBy(asc(tasks.createdAt), asc(tasks.id));

    const result: TaskDetail[] = [];
    for (const t of taskRows) {
      const resolvedSource = await resolveSourceMessageForTarget(
        db,
        currentUser,
        t.sourceMessageId,
      );
      result.push({
        id: t.id,
        listId: t.listId,
        scope: 'personal',
        ownerUserId: currentUser.id,
        familyId: null,
        title: t.title,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        sourceMessageId: t.sourceMessageId,
        sourceStatus: resolvedSource.sourceStatus,
        sourceMessage: resolvedSource.sourceMessage,
        createdBy: t.createdBy,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      });
    }

    return c.json(result, 200);
  });

  // POST /api/tasks - Create personal or family task with dual-endpoint source message check
  router.post('/', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    if (hasCrossUserOverrideAttempt(currentUser, null, null, rawBody)) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    const parsed = CreateTaskRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的待辦資料';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    let listId: string;
    let ownerUserId: string | null = null;
    let familyId: string | null = null;

    if (parsed.data.scope === 'family') {
      familyId = parsed.data.familyId!;
      const membership = await getFamilyMembership(db, currentUser.id, familyId);
      if (!membership) {
        return c.json(familyAccessForbiddenResponse(), 403);
      }
      const [fam] = await db.select().from(families).where(eq(families.id, familyId)).limit(1);
      const containers = await ensureFamilyContainers(
        db,
        familyId,
        fam?.name ?? '家庭空間',
        currentUser.defaultTimezone || DEFAULT_TIMEZONE,
      );
      listId = containers.taskList.id;
    } else {
      ownerUserId = currentUser.id;
      const personal = await ensurePersonalContainers(
        db,
        currentUser.id,
        currentUser.defaultTimezone || DEFAULT_TIMEZONE,
      );
      listId = personal.taskList.id;
    }

    const sourceMessageId = parsed.data.sourceMessageId ?? null;
    if (sourceMessageId) {
      const sourceAuth = await authorizeSourceMessageForCreation(db, currentUser, sourceMessageId);
      if (!sourceAuth.allowed) {
        return c.json(
          {
            error: sourceAuth.error,
            simulationMode: true,
            isAuthenticatedSecurity: false,
            securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
            message: sourceAuth.message,
          },
          sourceAuth.status,
        );
      }
    }

    const nowIso = new Date().toISOString();
    const taskId = crypto.randomUUID();
    const dueDate = parsed.data.dueDate ?? null;

    // Statement-level SQL guard verifying both target list ownership/membership AND source message active/readability at insert time
    const insertResult = await c.env.DB!.prepare(`
      INSERT INTO tasks (id, list_id, title, due_date, completed_at, source_message_id, created_by, created_at, updated_at)
      SELECT ?, ?, ?, ?, NULL, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM task_lists tl
        WHERE tl.id = ?
          AND (
            tl.owner_user_id = ?
            OR (
              tl.family_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM family_members fm
                WHERE fm.family_id = tl.family_id AND fm.user_id = ?
              )
            )
          )
      )
      AND (
        ? IS NULL
        OR EXISTS (
          SELECT 1 FROM messages m
          INNER JOIN chat_rooms cr ON m.room_id = cr.id
          WHERE m.id = ?
            AND m.deleted_at IS NULL
            AND (
              (cr.kind = 'personal' AND cr.user_id = ?)
              OR (
                cr.kind = 'family'
                AND EXISTS (
                  SELECT 1 FROM family_members fm
                  WHERE fm.family_id = cr.family_id AND fm.user_id = ?
                )
              )
            )
        )
      )
    `)
      .bind(
        taskId,
        listId,
        parsed.data.title,
        dueDate,
        sourceMessageId,
        currentUser.id,
        nowIso,
        nowIso,
        listId,
        currentUser.id,
        currentUser.id,
        sourceMessageId,
        sourceMessageId,
        currentUser.id,
        currentUser.id,
      )
      .run();

    if ((insertResult.meta?.changes ?? 0) === 0) {
      return c.json(
        {
          error: 'FORBIDDEN',
          simulationMode: true,
          isAuthenticatedSecurity: false,
          securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
          message: '目標空間或來源訊息權限已變更，無法建立待辦',
        },
        403,
      );
    }

    const resolvedSource = await resolveSourceMessageForTarget(db, currentUser, sourceMessageId);
    const payload: TaskDetail = {
      id: taskId,
      listId,
      scope: parsed.data.scope,
      ownerUserId,
      familyId,
      title: parsed.data.title,
      dueDate,
      completedAt: null,
      sourceMessageId,
      sourceStatus: resolvedSource.sourceStatus,
      sourceMessage: resolvedSource.sourceMessage,
      createdBy: currentUser.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    return c.json(payload, 201);
  });

  // GET /api/tasks/:id - Get task detail with dual-endpoint source resolution
  router.get('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const taskId = c.req.param('id');

    const rows = await db
      .select({
        task: tasks,
        taskList: taskLists,
      })
      .from(tasks)
      .innerJoin(taskLists, eq(tasks.listId, taskLists.id))
      .where(eq(tasks.id, taskId))
      .limit(1);

    const match = rows[0];
    if (!match) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該待辦事項或無權限存取'), 404);
    }

    if (match.taskList.ownerUserId) {
      if (match.taskList.ownerUserId !== currentUser.id) {
        return c.json(resourceNotFoundOrInaccessibleResponse('找不到該待辦事項或無權限存取'), 404);
      }
    } else if (match.taskList.familyId) {
      const membership = await getFamilyMembership(db, currentUser.id, match.taskList.familyId);
      if (!membership) {
        return c.json(resourceNotFoundOrInaccessibleResponse('找不到該待辦事項或無權限存取'), 404);
      }
    } else {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該待辦事項或無權限存取'), 404);
    }

    const resolvedSource = await resolveSourceMessageForTarget(
      db,
      currentUser,
      match.task.sourceMessageId,
    );

    const payload: TaskDetail = {
      id: match.task.id,
      listId: match.task.listId,
      scope: match.taskList.ownerUserId ? 'personal' : 'family',
      ownerUserId: match.taskList.ownerUserId,
      familyId: match.taskList.familyId,
      title: match.task.title,
      dueDate: match.task.dueDate,
      completedAt: match.task.completedAt,
      sourceMessageId: match.task.sourceMessageId,
      sourceStatus: resolvedSource.sourceStatus,
      sourceMessage: resolvedSource.sourceMessage,
      createdBy: match.task.createdBy,
      createdAt: match.task.createdAt,
      updatedAt: match.task.updatedAt,
    };

    return c.json(payload, 200);
  });

  // PATCH /api/tasks/:id - Update task (never modifies source message)
  router.patch('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const taskId = c.req.param('id');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    if (hasCrossUserOverrideAttempt(currentUser, null, null, rawBody)) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    if (typeof rawBody === 'object' && rawBody !== null) {
      const record = rawBody as Record<string, unknown>;
      if (record.sourceMessageId !== undefined || record.listId !== undefined) {
        return c.json(
          {
            error: 'FORBIDDEN',
            simulationMode: true,
            isAuthenticatedSecurity: false,
            securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
            message: '建立後禁止竄改待辦之來源訊息關聯或所屬空間清單',
          },
          403,
        );
      }
    }

    const rows = await db
      .select({
        task: tasks,
        taskList: taskLists,
      })
      .from(tasks)
      .innerJoin(taskLists, eq(tasks.listId, taskLists.id))
      .where(eq(tasks.id, taskId))
      .limit(1);

    const match = rows[0];
    if (!match) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該待辦事項或無權限存取'), 404);
    }

    if (match.taskList.ownerUserId) {
      if (match.taskList.ownerUserId !== currentUser.id) {
        return c.json(resourceNotFoundOrInaccessibleResponse('找不到該待辦事項或無權限存取'), 404);
      }
    } else if (match.taskList.familyId) {
      const membership = await getFamilyMembership(db, currentUser.id, match.taskList.familyId);
      if (!membership) {
        return c.json(resourceNotFoundOrInaccessibleResponse('找不到該待辦事項或無權限存取'), 404);
      }
    } else {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該待辦事項或無權限存取'), 404);
    }

    const parsed = UpdateTaskRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的待辦更新資料';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    const nowIso = new Date().toISOString();
    const completedAt =
      parsed.data.completed === undefined
        ? match.task.completedAt
        : parsed.data.completed
          ? (match.task.completedAt ?? nowIso)
          : null;

    const updatedRows = await db
      .update(tasks)
      .set({
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.dueDate !== undefined ? { dueDate: parsed.data.dueDate } : {}),
        completedAt,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(tasks.id, taskId),
          sql`EXISTS (
            SELECT 1 FROM task_lists tl
            WHERE tl.id = ${tasks.listId}
              AND (
                tl.owner_user_id = ${currentUser.id}
                OR (
                  tl.family_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM family_members fm
                    WHERE fm.family_id = tl.family_id AND fm.user_id = ${currentUser.id}
                  )
                )
              )
          )`,
        ),
      )
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該待辦事項或無權限存取'), 404);
    }

    const resolvedSource = await resolveSourceMessageForTarget(
      db,
      currentUser,
      updated.sourceMessageId,
    );

    const payload: TaskDetail = {
      id: updated.id,
      listId: updated.listId,
      scope: match.taskList.ownerUserId ? 'personal' : 'family',
      ownerUserId: match.taskList.ownerUserId,
      familyId: match.taskList.familyId,
      title: updated.title,
      dueDate: updated.dueDate,
      completedAt: updated.completedAt,
      sourceMessageId: updated.sourceMessageId,
      sourceStatus: resolvedSource.sourceStatus,
      sourceMessage: resolvedSource.sourceMessage,
      createdBy: updated.createdBy,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    return c.json(payload, 200);
  });

  // DELETE /api/tasks/:id - Delete task
  router.delete('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const taskId = c.req.param('id');

    const deletedRows = await db
      .delete(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          sql`EXISTS (
            SELECT 1 FROM task_lists tl
            WHERE tl.id = ${tasks.listId}
              AND (
                tl.owner_user_id = ${currentUser.id}
                OR (
                  tl.family_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM family_members fm
                    WHERE fm.family_id = tl.family_id AND fm.user_id = ${currentUser.id}
                  )
                )
              )
          )`,
        ),
      )
      .returning({ id: tasks.id });

    if (deletedRows.length === 0) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該待辦事項或無權限存取'), 404);
    }

    return c.json({ success: true, id: taskId }, 200);
  });

  return router;
}

export function createEventsRouter() {
  const router = new Hono<AuthAppEnv>();

  router.use('*', testIdentitySecurityHeadersMiddleware);
  router.use('*', requireAuthMiddleware);

  // GET /api/events - List personal or family events with independent source message resolution
  router.get('/', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');

    if (
      hasCrossUserOverrideAttempt(
        currentUser,
        c.req.query('userId'),
        c.req.query('ownerUserId'),
      )
    ) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    const rawScope = c.req.query('scope');
    if (rawScope && rawScope !== 'personal' && rawScope !== 'family') {
      return c.json({ error: 'VALIDATION_ERROR', message: '無效的空間範圍 (scope)' }, 400);
    }
    const familyId = c.req.query('familyId')?.trim();
    if (rawScope === 'personal' && familyId) {
      return c.json(
        { error: 'VALIDATION_ERROR', message: '個人空間事件查詢不可指定 familyId' },
        400,
      );
    }
    const scopeQuery = rawScope ?? (familyId ? 'family' : 'personal');

    const dateFilter = c.req.query('date')?.trim();
    if (dateFilter && !isValidLocalDateString(dateFilter)) {
      return c.json(
        { error: 'VALIDATION_ERROR', message: '查詢日期格式必須為有效的 YYYY-MM-DD' },
        400,
      );
    }

    const yearQuery = c.req.query('year')?.trim();
    const monthQuery = c.req.query('month')?.trim();
    let monthGridDateSet: Set<string> | null = null;
    let coarseMinDate: string | null = dateFilter ? addDaysToLocalDate(dateFilter, -1) : null;
    let coarseMaxDate: string | null = dateFilter ? addDaysToLocalDate(dateFilter, 1) : null;
    if (yearQuery !== undefined || monthQuery !== undefined) {
      const parsedYear = Number(yearQuery);
      const parsedMonth = Number(monthQuery);
      if (
        !yearQuery ||
        !monthQuery ||
        !Number.isInteger(parsedYear) ||
        parsedYear < 1900 ||
        parsedYear > 2100 ||
        !Number.isInteger(parsedMonth) ||
        parsedMonth < 1 ||
        parsedMonth > 12
      ) {
        return c.json(
          {
            error: 'VALIDATION_ERROR',
            message: '月份查詢必須同時提供有效的 year (1900–2100) 與 month (1–12)',
          },
          400,
        );
      }
      const dummySelected = `${String(parsedYear).padStart(4, '0')}-${String(parsedMonth).padStart(2, '0')}-01`;
      const gridCells = buildMonthCalendarGrid(
        { year: parsedYear, month: parsedMonth },
        dummySelected,
        dummySelected,
      );
      monthGridDateSet = new Set(gridCells.map((cell) => cell.dateStr));
      const firstGridDate = gridCells[0]?.dateStr;
      const lastGridDate = gridCells[gridCells.length - 1]?.dateStr;
      if (firstGridDate && lastGridDate) {
        const monthMin = addDaysToLocalDate(firstGridDate, -1);
        const monthMax = addDaysToLocalDate(lastGridDate, 1);
        coarseMinDate =
          coarseMinDate && coarseMinDate > monthMin ? coarseMinDate : monthMin;
        coarseMaxDate =
          coarseMaxDate && coarseMaxDate < monthMax ? coarseMaxDate : monthMax;
      }
    }

    const filterEventByDateOrMonth = (ev: {
      startsAt: string;
      endsAt: string;
      allDay: boolean;
      timezone: string;
    }): boolean => {
      if (!dateFilter && !monthGridDateSet) return true;
      try {
        const occupiedDates = resolveEventCalendarDates(ev, ev.timezone || DEFAULT_TIMEZONE);
        if (dateFilter && !occupiedDates.includes(dateFilter)) {
          return false;
        }
        if (monthGridDateSet && !occupiedDates.some((d) => monthGridDateSet.has(d))) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    };

    const buildCalendarEventsWhereClause = (calendarId: string) => {
      if (coarseMinDate && coarseMaxDate) {
        return and(
          eq(events.calendarId, calendarId),
          sql`substr(${events.startsAt}, 1, 10) <= ${coarseMaxDate}`,
          sql`substr(${events.endsAt}, 1, 10) >= ${coarseMinDate}`,
        );
      }
      return eq(events.calendarId, calendarId);
    };

    if (scopeQuery === 'family') {
      if (!familyId) {
        return c.json({ error: 'VALIDATION_ERROR', message: '查詢家庭事件必須提供 familyId' }, 400);
      }
      const membership = await getFamilyMembership(db, currentUser.id, familyId);
      if (!membership) {
        return c.json(familyAccessForbiddenResponse(), 403);
      }

      const [fam] = await db.select().from(families).where(eq(families.id, familyId)).limit(1);
      const containers = await ensureFamilyContainers(
        db,
        familyId,
        fam?.name ?? '家庭空間',
        currentUser.defaultTimezone || DEFAULT_TIMEZONE,
      );

      const eventRows = await db
        .select()
        .from(events)
        .where(buildCalendarEventsWhereClause(containers.calendar.id))
        .orderBy(asc(events.startsAt), asc(events.id));

      const result: EventDetail[] = [];
      for (const ev of eventRows) {
        if (!filterEventByDateOrMonth(ev)) {
          continue;
        }
        const resolvedSource = await resolveSourceMessageForTarget(
          db,
          currentUser,
          ev.sourceMessageId,
        );
        result.push({
          id: ev.id,
          calendarId: ev.calendarId,
          scope: 'family',
          ownerUserId: null,
          familyId,
          title: ev.title,
          description: ev.description,
          startsAt: ev.startsAt,
          endsAt: ev.endsAt,
          allDay: ev.allDay,
          timezone: ev.timezone,
          sourceMessageId: ev.sourceMessageId,
          sourceStatus: resolvedSource.sourceStatus,
          sourceMessage: resolvedSource.sourceMessage,
          createdBy: ev.createdBy,
          createdAt: ev.createdAt,
          updatedAt: ev.updatedAt,
        });
      }

      return c.json(result, 200);
    }

    const personal = await ensurePersonalContainers(
      db,
      currentUser.id,
      currentUser.defaultTimezone || DEFAULT_TIMEZONE,
    );

    const eventRows = await db
      .select()
      .from(events)
      .where(buildCalendarEventsWhereClause(personal.calendar.id))
      .orderBy(asc(events.startsAt), asc(events.id));

    const result: EventDetail[] = [];
    for (const ev of eventRows) {
      if (!filterEventByDateOrMonth(ev)) {
        continue;
      }
      const resolvedSource = await resolveSourceMessageForTarget(
        db,
        currentUser,
        ev.sourceMessageId,
      );
      result.push({
        id: ev.id,
        calendarId: ev.calendarId,
        scope: 'personal',
        ownerUserId: currentUser.id,
        familyId: null,
        title: ev.title,
        description: ev.description,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        allDay: ev.allDay,
        timezone: ev.timezone,
        sourceMessageId: ev.sourceMessageId,
        sourceStatus: resolvedSource.sourceStatus,
        sourceMessage: resolvedSource.sourceMessage,
        createdBy: ev.createdBy,
        createdAt: ev.createdAt,
        updatedAt: ev.updatedAt,
      });
    }

    return c.json(result, 200);
  });

  // POST /api/events - Create personal or family event with dual-endpoint source message check
  router.post('/', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    if (hasCrossUserOverrideAttempt(currentUser, null, null, rawBody)) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    const parsed = CreateEventRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的事件資料';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    let calendarId: string;
    let ownerUserId: string | null = null;
    let familyId: string | null = null;

    if (parsed.data.scope === 'family') {
      familyId = parsed.data.familyId!;
      const membership = await getFamilyMembership(db, currentUser.id, familyId);
      if (!membership) {
        return c.json(familyAccessForbiddenResponse(), 403);
      }
      const [fam] = await db.select().from(families).where(eq(families.id, familyId)).limit(1);
      const containers = await ensureFamilyContainers(
        db,
        familyId,
        fam?.name ?? '家庭空間',
        currentUser.defaultTimezone || DEFAULT_TIMEZONE,
      );
      calendarId = containers.calendar.id;
    } else {
      ownerUserId = currentUser.id;
      const personal = await ensurePersonalContainers(
        db,
        currentUser.id,
        currentUser.defaultTimezone || DEFAULT_TIMEZONE,
      );
      calendarId = personal.calendar.id;
    }

    const sourceMessageId = parsed.data.sourceMessageId ?? null;
    if (sourceMessageId) {
      const sourceAuth = await authorizeSourceMessageForCreation(db, currentUser, sourceMessageId);
      if (!sourceAuth.allowed) {
        return c.json(
          {
            error: sourceAuth.error,
            simulationMode: true,
            isAuthenticatedSecurity: false,
            securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
            message: sourceAuth.message,
          },
          sourceAuth.status,
        );
      }
    }

    const nowIso = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const description = parsed.data.description ?? null;
    const normalizedStartsAt = parsed.data.allDay
      ? parsed.data.startsAt.trim()
      : normalizeToUtcIsoTimestamp(parsed.data.startsAt);
    const normalizedEndsAt = parsed.data.allDay
      ? parsed.data.endsAt.trim()
      : normalizeToUtcIsoTimestamp(parsed.data.endsAt);

    // Statement-level SQL guard verifying both target calendar ownership/membership AND source message active/readability at insert time
    const insertResult = await c.env.DB!.prepare(`
      INSERT INTO events (id, calendar_id, title, description, starts_at, ends_at, all_day, timezone, source_message_id, created_by, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM calendars cal
        WHERE cal.id = ?
          AND (
            cal.owner_user_id = ?
            OR (
              cal.family_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM family_members fm
                WHERE fm.family_id = cal.family_id AND fm.user_id = ?
              )
            )
          )
      )
      AND (
        ? IS NULL
        OR EXISTS (
          SELECT 1 FROM messages m
          INNER JOIN chat_rooms cr ON m.room_id = cr.id
          WHERE m.id = ?
            AND m.deleted_at IS NULL
            AND (
              (cr.kind = 'personal' AND cr.user_id = ?)
              OR (
                cr.kind = 'family'
                AND EXISTS (
                  SELECT 1 FROM family_members fm
                  WHERE fm.family_id = cr.family_id AND fm.user_id = ?
                )
              )
            )
        )
      )
    `)
      .bind(
        eventId,
        calendarId,
        parsed.data.title,
        description,
        normalizedStartsAt,
        normalizedEndsAt,
        parsed.data.allDay ? 1 : 0,
        parsed.data.timezone,
        sourceMessageId,
        currentUser.id,
        nowIso,
        nowIso,
        calendarId,
        currentUser.id,
        currentUser.id,
        sourceMessageId,
        sourceMessageId,
        currentUser.id,
        currentUser.id,
      )
      .run();

    if ((insertResult.meta?.changes ?? 0) === 0) {
      return c.json(
        {
          error: 'FORBIDDEN',
          simulationMode: true,
          isAuthenticatedSecurity: false,
          securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
          message: '目標空間或來源訊息權限已變更，無法建立事件',
        },
        403,
      );
    }

    const resolvedSource = await resolveSourceMessageForTarget(db, currentUser, sourceMessageId);
    const payload: EventDetail = {
      id: eventId,
      calendarId,
      scope: parsed.data.scope,
      ownerUserId,
      familyId,
      title: parsed.data.title,
      description,
      startsAt: normalizedStartsAt,
      endsAt: normalizedEndsAt,
      allDay: parsed.data.allDay,
      timezone: parsed.data.timezone,
      sourceMessageId,
      sourceStatus: resolvedSource.sourceStatus,
      sourceMessage: resolvedSource.sourceMessage,
      createdBy: currentUser.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    return c.json(payload, 201);
  });

  // GET /api/events/:id - Get event detail with dual-endpoint source resolution
  router.get('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const eventId = c.req.param('id');

    const rows = await db
      .select({
        event: events,
        calendar: calendars,
      })
      .from(events)
      .innerJoin(calendars, eq(events.calendarId, calendars.id))
      .where(eq(events.id, eventId))
      .limit(1);

    const match = rows[0];
    if (!match) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該行程事件或無權限存取'), 404);
    }

    if (match.calendar.ownerUserId) {
      if (match.calendar.ownerUserId !== currentUser.id) {
        return c.json(resourceNotFoundOrInaccessibleResponse('找不到該行程事件或無權限存取'), 404);
      }
    } else if (match.calendar.familyId) {
      const membership = await getFamilyMembership(db, currentUser.id, match.calendar.familyId);
      if (!membership) {
        return c.json(resourceNotFoundOrInaccessibleResponse('找不到該行程事件或無權限存取'), 404);
      }
    } else {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該行程事件或無權限存取'), 404);
    }

    const resolvedSource = await resolveSourceMessageForTarget(
      db,
      currentUser,
      match.event.sourceMessageId,
    );

    const payload: EventDetail = {
      id: match.event.id,
      calendarId: match.event.calendarId,
      scope: match.calendar.ownerUserId ? 'personal' : 'family',
      ownerUserId: match.calendar.ownerUserId,
      familyId: match.calendar.familyId,
      title: match.event.title,
      description: match.event.description,
      startsAt: match.event.startsAt,
      endsAt: match.event.endsAt,
      allDay: match.event.allDay,
      timezone: match.event.timezone,
      sourceMessageId: match.event.sourceMessageId,
      sourceStatus: resolvedSource.sourceStatus,
      sourceMessage: resolvedSource.sourceMessage,
      createdBy: match.event.createdBy,
      createdAt: match.event.createdAt,
      updatedAt: match.event.updatedAt,
    };

    return c.json(payload, 200);
  });

  // PATCH /api/events/:id - Update event (never modifies source message)
  router.patch('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const eventId = c.req.param('id');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    if (hasCrossUserOverrideAttempt(currentUser, null, null, rawBody)) {
      return c.json(crossUserForbiddenResponse(), 403);
    }

    if (typeof rawBody === 'object' && rawBody !== null) {
      const record = rawBody as Record<string, unknown>;
      if (
        record.sourceMessageId !== undefined ||
        record.calendarId !== undefined ||
        record.scope !== undefined ||
        record.familyId !== undefined
      ) {
        return c.json(
          {
            error: 'FORBIDDEN',
            simulationMode: true,
            isAuthenticatedSecurity: false,
            securityNotice: DATA_OWNERSHIP_SECURITY_NOTICE,
            message: '建立後禁止竄改事件之來源訊息關聯或所屬空間行事曆',
          },
          403,
        );
      }
    }

    const rows = await db
      .select({
        event: events,
        calendar: calendars,
      })
      .from(events)
      .innerJoin(calendars, eq(events.calendarId, calendars.id))
      .where(eq(events.id, eventId))
      .limit(1);

    const match = rows[0];
    if (!match) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該行程事件或無權限存取'), 404);
    }

    if (match.calendar.ownerUserId) {
      if (match.calendar.ownerUserId !== currentUser.id) {
        return c.json(resourceNotFoundOrInaccessibleResponse('找不到該行程事件或無權限存取'), 404);
      }
    } else if (match.calendar.familyId) {
      const membership = await getFamilyMembership(db, currentUser.id, match.calendar.familyId);
      if (!membership) {
        return c.json(resourceNotFoundOrInaccessibleResponse('找不到該行程事件或無權限存取'), 404);
      }
    } else {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該行程事件或無權限存取'), 404);
    }

    const parsed = UpdateEventRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的事件更新資料';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    const nextAllDay = parsed.data.allDay ?? match.event.allDay;
    const rawStartsAt = parsed.data.startsAt ?? match.event.startsAt;
    const rawEndsAt = parsed.data.endsAt ?? match.event.endsAt;

    if (nextAllDay) {
      if (!isValidLocalDateString(rawStartsAt) || !isValidLocalDateString(rawEndsAt)) {
        return c.json(
          {
            error: 'VALIDATION_ERROR',
            message: '全天事件開始與結束日期必須為有效的 YYYY-MM-DD 純日期字串（不做 UTC 換日）',
          },
          400,
        );
      }
      if (rawEndsAt < rawStartsAt) {
        return c.json(
          {
            error: 'VALIDATION_ERROR',
            message: '全天事件結束日期不可早於開始日期',
          },
          400,
        );
      }
    } else {
      if (!isValidUtcIsoTimestamp(rawStartsAt) || !isValidUtcIsoTimestamp(rawEndsAt)) {
        return c.json(
          {
            error: 'VALIDATION_ERROR',
            message: '具時間事件開始與結束時間必須為有效的 ISO 8601 UTC/時區時間戳',
          },
          400,
        );
      }
      if (Date.parse(rawEndsAt) < Date.parse(rawStartsAt)) {
        return c.json(
          {
            error: 'VALIDATION_ERROR',
            message: '具時間事件結束時間不可早於開始時間',
          },
          400,
        );
      }
    }

    const finalStartsAt = nextAllDay
      ? rawStartsAt.trim()
      : normalizeToUtcIsoTimestamp(rawStartsAt);
    const finalEndsAt = nextAllDay ? rawEndsAt.trim() : normalizeToUtcIsoTimestamp(rawEndsAt);

    const nowIso = new Date().toISOString();
    const updatedRows = await db
      .update(events)
      .set({
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        startsAt: finalStartsAt,
        endsAt: finalEndsAt,
        allDay: nextAllDay,
        ...(parsed.data.timezone !== undefined ? { timezone: parsed.data.timezone } : {}),
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(events.id, eventId),
          sql`EXISTS (
            SELECT 1 FROM calendars cal
            WHERE cal.id = ${events.calendarId}
              AND (
                cal.owner_user_id = ${currentUser.id}
                OR (
                  cal.family_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM family_members fm
                    WHERE fm.family_id = cal.family_id AND fm.user_id = ${currentUser.id}
                  )
                )
              )
          )`,
        ),
      )
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該行程事件或無權限存取'), 404);
    }

    const resolvedSource = await resolveSourceMessageForTarget(
      db,
      currentUser,
      updated.sourceMessageId,
    );

    const payload: EventDetail = {
      id: updated.id,
      calendarId: updated.calendarId,
      scope: match.calendar.ownerUserId ? 'personal' : 'family',
      ownerUserId: match.calendar.ownerUserId,
      familyId: match.calendar.familyId,
      title: updated.title,
      description: updated.description,
      startsAt: updated.startsAt,
      endsAt: updated.endsAt,
      allDay: updated.allDay,
      timezone: updated.timezone,
      sourceMessageId: updated.sourceMessageId,
      sourceStatus: resolvedSource.sourceStatus,
      sourceMessage: resolvedSource.sourceMessage,
      createdBy: updated.createdBy,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    return c.json(payload, 200);
  });

  // DELETE /api/events/:id - Delete event
  router.delete('/:id', async (c) => {
    const currentUser = c.get('currentUser');
    const db = c.get('db');
    const eventId = c.req.param('id');

    const deletedRows = await db
      .delete(events)
      .where(
        and(
          eq(events.id, eventId),
          sql`EXISTS (
            SELECT 1 FROM calendars cal
            WHERE cal.id = ${events.calendarId}
              AND (
                cal.owner_user_id = ${currentUser.id}
                OR (
                  cal.family_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM family_members fm
                    WHERE fm.family_id = cal.family_id AND fm.user_id = ${currentUser.id}
                  )
                )
              )
          )`,
        ),
      )
      .returning({ id: events.id });

    if (deletedRows.length === 0) {
      return c.json(resourceNotFoundOrInaccessibleResponse('找不到該行程事件或無權限存取'), 404);
    }

    return c.json({ success: true, id: eventId }, 200);
  });

  return router;
}
