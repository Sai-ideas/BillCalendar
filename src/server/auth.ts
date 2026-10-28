import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { SimulatedUser } from '../shared';
import { createDb, type AppDatabase } from './db/client';
import { testSessions, users } from './db/schema';
import type { Env } from './index';

/**
 * Fail-closed gate for synthetic Email identity simulation.
 * Strictly requires APP_ENV === 'development' AND ALLOW_TEST_IDENTITY === 'true'.
 * All other environments (production, staging, preview, or unset) default to disabled.
 */
export function isTestIdentityEnabled(env?: Env): boolean {
  if (!env) return false;
  return env.APP_ENV === 'development' && env.ALLOW_TEST_IDENTITY === 'true';
}

export function toSimulatedUser(row: typeof users.$inferSelect): SimulatedUser {
  return {
    id: row.id,
    emailNormalized: row.emailNormalized,
    displayName: row.displayName,
    defaultTimezone: row.defaultTimezone,
    createdAt: row.createdAt,
  };
}

export async function resolveSession(
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

export type AuthResolutionResult =
  | { status: 'disabled' }
  | { status: 'unauthorized' }
  | { status: 'authenticated'; user: SimulatedUser };

/**
 * Resolves current simulated test user with strict environment gate checking.
 */
export async function authenticateTestRequest(
  c: Context<{ Bindings: Env }>,
): Promise<AuthResolutionResult> {
  if (!isTestIdentityEnabled(c.env)) {
    return { status: 'disabled' };
  }
  if (!c.env?.DB) {
    return { status: 'unauthorized' };
  }

  const db = createDb(c.env.DB);
  const sessionHeader = c.req.header('X-Test-Session-Id');
  const { currentUser } = await resolveSession(db, sessionHeader);
  if (!currentUser) {
    return { status: 'unauthorized' };
  }

  return { status: 'authenticated', user: currentUser };
}

/**
 * Convenience helper that returns SimulatedUser or null if not authenticated or environment disabled.
 */
export async function getAuthenticatedUser(
  c: Context<{ Bindings: Env }>,
): Promise<SimulatedUser | null> {
  const res = await authenticateTestRequest(c);
  if (res.status === 'authenticated') {
    return res.user;
  }
  return null;
}
