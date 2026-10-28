import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import {
  DEFAULT_TIMEZONE,
  SelectTestIdentityRequestSchema,
  TEST_IDENTITY_SECURITY_NOTICE,
  deriveDisplayName,
  type SimulatedUser,
  type TestIdentityStateResponse,
} from '../../shared';
import { createDb, type AppDatabase } from '../db/client';
import { testSessions, users } from '../db/schema';
import type { Env } from '../index';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Fail-closed gate for synthetic Email identity simulation.
 * Strictly requires APP_ENV === 'development' AND ALLOW_TEST_IDENTITY === 'true'.
 * All other environments (production, staging, preview, or unset) default to disabled.
 */
export function isTestIdentityEnabled(env?: Env): boolean {
  if (!env) return false;
  return env.APP_ENV === 'development' && env.ALLOW_TEST_IDENTITY === 'true';
}

function toSimulatedUser(row: typeof users.$inferSelect): SimulatedUser {
  return {
    id: row.id,
    emailNormalized: row.emailNormalized,
    displayName: row.displayName,
    defaultTimezone: row.defaultTimezone,
    createdAt: row.createdAt,
  };
}

async function listAvailableUsers(db: AppDatabase): Promise<SimulatedUser[]> {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt)).limit(20);
  return rows.map(toSimulatedUser);
}

async function resolveSession(
  db: AppDatabase,
  sessionId: string | null | undefined,
): Promise<{ sessionId: string | null; expiresAt: string | null; currentUser: SimulatedUser | null }> {
  const trimmed = sessionId?.trim();
  if (!trimmed) {
    return { sessionId: null, expiresAt: null, currentUser: null };
  }

  const rows = await db
    .select({
      session: testSessions,
      user: users,
    })
    .from(testSessions)
    .innerJoin(users, eq(testSessions.userId, users.id))
    .where(eq(testSessions.id, trimmed))
    .limit(1);

  const match = rows[0];
  if (!match) {
    return { sessionId: null, expiresAt: null, currentUser: null };
  }

  if (new Date(match.session.expiresAt).getTime() <= Date.now()) {
    await db.delete(testSessions).where(eq(testSessions.id, trimmed));
    return { sessionId: null, expiresAt: null, currentUser: null };
  }

  return {
    sessionId: match.session.id,
    expiresAt: match.session.expiresAt,
    currentUser: toSimulatedUser(match.user),
  };
}

export function createTestIdentityRouter() {
  const router = new Hono<{ Bindings: Env }>();

  router.use('*', async (c, next) => {
    await next();
    c.header('X-Identity-Mode', 'unverified-test-simulation');
    c.header('Cache-Control', 'no-store');
  });

  router.get('/state', async (c) => {
    const enabled = isTestIdentityEnabled(c.env);
    if (!enabled) {
      const disabledPayload: TestIdentityStateResponse = {
        enabled: false,
        simulationMode: true,
        isAuthenticatedSecurity: false,
        securityNotice:
          '公開／正式部署預設禁用測試 Email 身份模擬；此機制非安全驗證，正式環境須配置受驗證身份提供者。',
        sessionId: null,
        expiresAt: null,
        currentUser: null,
        availableUsers: [],
      };
      return c.json(disabledPayload, 403);
    }

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const db = createDb(c.env.DB);
    const sessionHeader = c.req.header('X-Test-Session-Id');
    const resolved = await resolveSession(db, sessionHeader);
    const availableUsers = await listAvailableUsers(db);

    const payload: TestIdentityStateResponse = {
      enabled: true,
      simulationMode: true,
      isAuthenticatedSecurity: false,
      securityNotice: TEST_IDENTITY_SECURITY_NOTICE,
      sessionId: resolved.sessionId,
      expiresAt: resolved.expiresAt,
      currentUser: resolved.currentUser,
      availableUsers,
    };

    return c.json(payload, 200);
  });

  router.post('/select', async (c) => {
    if (!isTestIdentityEnabled(c.env)) {
      return c.json(
        {
          error: 'TEST_IDENTITY_DISABLED',
          simulationMode: true,
          isAuthenticatedSecurity: false,
          message: '公開／正式部署已禁用測試 Email 身份模擬。',
        },
        403,
      );
    }

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    const parsed = SelectTestIdentityRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? '無效的合成 Email 輸入';
      return c.json({ error: 'VALIDATION_ERROR', message: firstIssue }, 400);
    }

    const { email: emailNormalized, displayName: requestedDisplayName } = parsed.data;
    const timezone = c.env?.DEFAULT_TIMEZONE ?? DEFAULT_TIMEZONE;
    const nowIso = new Date().toISOString();
    const db = createDb(c.env.DB);

    const initialDisplayName = deriveDisplayName(emailNormalized, requestedDisplayName);

    await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        emailNormalized,
        displayName: initialDisplayName,
        defaultTimezone: timezone,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing({ target: users.emailNormalized });

    if (requestedDisplayName && requestedDisplayName.trim().length > 0) {
      await db
        .update(users)
        .set({
          displayName: requestedDisplayName.trim(),
          updatedAt: nowIso,
        })
        .where(eq(users.emailNormalized, emailNormalized));
    }

    const existingRows = await db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, emailNormalized))
      .limit(1);

    const userRow = existingRows[0];
    if (!userRow) {
      return c.json({ error: 'USER_RESOLUTION_FAILED', message: '無法建立或讀取測試身份' }, 500);
    }

    const previousSessionId = c.req.header('X-Test-Session-Id')?.trim();
    if (previousSessionId) {
      await db.delete(testSessions).where(eq(testSessions.id, previousSessionId));
    }

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

    await db.insert(testSessions).values({
      id: sessionId,
      userId: userRow.id,
      expiresAt,
      createdAt: nowIso,
    });

    const availableUsers = await listAvailableUsers(db);
    const payload: TestIdentityStateResponse = {
      enabled: true,
      simulationMode: true,
      isAuthenticatedSecurity: false,
      securityNotice: TEST_IDENTITY_SECURITY_NOTICE,
      sessionId,
      expiresAt,
      currentUser: toSimulatedUser(userRow),
      availableUsers,
    };

    return c.json(payload, 200);
  });

  router.post('/logout', async (c) => {
    if (!isTestIdentityEnabled(c.env)) {
      return c.json(
        {
          error: 'TEST_IDENTITY_DISABLED',
          simulationMode: true,
          isAuthenticatedSecurity: false,
          message: '公開／正式部署已禁用測試 Email 身份模擬。',
        },
        403,
      );
    }

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const db = createDb(c.env.DB);
    const sessionHeader = c.req.header('X-Test-Session-Id')?.trim();
    if (sessionHeader) {
      await db.delete(testSessions).where(eq(testSessions.id, sessionHeader));
    }

    const availableUsers = await listAvailableUsers(db);
    const payload: TestIdentityStateResponse = {
      enabled: true,
      simulationMode: true,
      isAuthenticatedSecurity: false,
      securityNotice: TEST_IDENTITY_SECURITY_NOTICE,
      sessionId: null,
      expiresAt: null,
      currentUser: null,
      availableUsers,
    };

    return c.json(payload, 200);
  });

  return router;
}
