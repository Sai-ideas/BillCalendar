import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { DEFAULT_TIMEZONE, type HealthResponse } from '../shared';
import { createDb } from './db/client';
import { appMeta } from './db/schema';

export interface Env {
  DB?: D1Database;
  ASSETS?: Fetcher;
  APP_ENV?: string;
  DEFAULT_TIMEZONE?: string;
}

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/api/health', async (c) => {
    const environment = c.env?.APP_ENV ?? 'development';
    const timezone = c.env?.DEFAULT_TIMEZONE ?? DEFAULT_TIMEZONE;
    let connected = false;
    let migrated = false;

    if (c.env?.DB) {
      try {
        const db = createDb(c.env.DB);
        await db.run(sql`SELECT 1`);
        connected = true;

        await db.select().from(appMeta).limit(1);
        migrated = true;
      } catch {
        // If SELECT 1 succeeded, connected remains true while migrated stays false
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
      },
    };

    return c.json(payload, status === 'ok' ? 200 : 503);
  });

  return app;
}

const app = createApp();

export default app;
