import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { DEFAULT_TIMEZONE, type HealthResponse } from '../shared';
import { createDb } from './db/client';
import {
  appMeta,
  calendars,
  chatRooms,
  diaries,
  events,
  families,
  familyInvitations,
  familyMembers,
  ledgers,
  messages,
  taskLists,
  tasks,
  testSessions,
  users,
} from './db/schema';
import { createFamiliesRouter, createInvitationsRouter } from './routes/families';
import {
  createChatRoomsRouter,
  createDiariesRouter,
  createEventsRouter,
  createMessagesRouter,
  createSpacesRouter,
  createTasksRouter,
} from './routes/ownership';
import { createTestIdentityRouter } from './routes/test-identity';

export interface Env {
  DB?: D1Database;
  ASSETS?: Fetcher;
  APP_ENV?: string;
  DEFAULT_TIMEZONE?: string;
  ALLOW_TEST_IDENTITY?: string;
}

function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const causeMessage =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
  return /no such table:\s*(app_meta|users|test_sessions|families|family_members|family_invitations|calendars|chat_rooms|messages|events|task_lists|tasks|ledgers|diaries)/i.test(
    `${message} ${causeMessage}`,
  );
}

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/api/health', async (c) => {
    const environment = c.env?.APP_ENV ?? 'development';
    const timezone = c.env?.DEFAULT_TIMEZONE ?? DEFAULT_TIMEZONE;
    let connected = false;
    let migrated = false;
    let dbError: string | undefined;

    if (!c.env?.DB) {
      dbError = 'D1 database binding (DB) is not configured';
    } else {
      const db = createDb(c.env.DB);
      try {
        await db.run(sql`SELECT 1`);
        connected = true;
      } catch {
        connected = false;
        dbError = 'Failed to connect to D1 database';
      }

      if (connected) {
        try {
          await db.select().from(appMeta).limit(1);
          await db.select().from(users).limit(1);
          await db.select().from(testSessions).limit(1);
          await db.select().from(families).limit(1);
          await db.select().from(familyMembers).limit(1);
          await db.select().from(familyInvitations).limit(1);
          await db.select().from(calendars).limit(1);
          await db.select().from(chatRooms).limit(1);
          await db.select().from(messages).limit(1);
          await db.select().from(events).limit(1);
          await db.select().from(taskLists).limit(1);
          await db.select().from(tasks).limit(1);
          await db.select().from(ledgers).limit(1);
          await db.select().from(diaries).limit(1);
          migrated = true;
        } catch (err: unknown) {
          if (isMissingTableError(err)) {
            migrated = false;
            dbError = 'Database migrations have not been applied (missing required schema tables)';
          } else {
            connected = false;
            migrated = false;
            dbError = 'Unexpected SQL error while verifying schema state';
          }
        }
      }
    }

    const status = connected && migrated ? 'ok' : 'degraded';
    const payload: HealthResponse = {
      status,
      service: 'billcalendar-api',
      environment,
      timezone,
      timestamp: new Date().toISOString(),
      database: {
        connected,
        migrated,
        ...(dbError ? { error: dbError } : {}),
      },
    };

    return c.json(payload, status === 'ok' ? 200 : 503);
  });

  app.route('/api/test-identity', createTestIdentityRouter());
  app.route('/api/families', createFamiliesRouter());
  app.route('/api/invitations', createInvitationsRouter());
  app.route('/api/spaces', createSpacesRouter());
  app.route('/api/diaries', createDiariesRouter());
  app.route('/api/chat-rooms', createChatRoomsRouter());
  app.route('/api/messages', createMessagesRouter());
  app.route('/api/tasks', createTasksRouter());
  app.route('/api/events', createEventsRouter());

  return app;
}

const app = createApp();

export default app;
