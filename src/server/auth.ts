import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { SimulatedUser } from '../shared';
import { createDb, type AppDatabase } from './db/client';
import { testSessions, users } from './db/schema';
import type { Env } from './index';

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

export async function getAuthenticatedUser(
  c: Context<{ Bindings: Env }>,
): Promise<SimulatedUser | null> {
  if (!c.env?.DB) return null;
  const db = createDb(c.env.DB);
  const sessionHeader = c.req.header('X-Test-Session-Id');
  const { currentUser } = await resolveSession(db, sessionHeader);
  return currentUser;
}
