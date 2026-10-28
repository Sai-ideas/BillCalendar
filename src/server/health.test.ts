import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './index';
import { HealthResponseSchema } from '../shared';
import { createMigratedSqliteD1, createSqliteD1Adapter } from './test-utils/sqlite-d1';

describe('Issue #1 Scaffold & Health API Verification', () => {
  it('returns 503 degraded when DB binding is present but migration has not been applied', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const db = createSqliteD1Adapter(sqlite);
    const app = createApp();

    const res = await app.request('/api/health', undefined, {
      DB: db,
      APP_ENV: 'test',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    });

    expect(res.status).toBe(503);
    const json: unknown = await res.json();
    const parsed = HealthResponseSchema.parse(json);
    expect(parsed.status).toBe('degraded');
    expect(parsed.database.connected).toBe(true);
    expect(parsed.database.migrated).toBe(false);
    expect(parsed.database.error).toMatch(/missing required schema tables/i);
    sqlite.close();
  });

  it('distinguishes unexpected SQL errors from unapplied migrations', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const baseDb = createSqliteD1Adapter(sqlite);
    const faultyDb: D1Database = {
      batch: (statements) => baseDb.batch(statements),
      exec: (query) => baseDb.exec(query),
      dump: () => baseDb.dump(),
      withSession: () => baseDb.withSession(),
      prepare(query: string) {
        if (query.includes('app_meta')) {
          throw new Error('SQLITE_IOERR: disk I/O error');
        }
        return baseDb.prepare(query);
      },
    };
    const app = createApp();

    const res = await app.request('/api/health', undefined, {
      DB: faultyDb,
      APP_ENV: 'test',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    });

    expect(res.status).toBe(503);
    const json: unknown = await res.json();
    const parsed = HealthResponseSchema.parse(json);
    expect(parsed.status).toBe('degraded');
    expect(parsed.database.connected).toBe(false);
    expect(parsed.database.migrated).toBe(false);
    expect(parsed.database.error).toMatch(/Unexpected SQL error/i);
    sqlite.close();
  });

  it('applies D1 SQL migrations from an empty database and returns 200 ok from /api/health', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();

    const res = await app.request('/api/health', undefined, {
      DB: db,
      APP_ENV: 'test',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    });

    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    const parsed = HealthResponseSchema.parse(json);
    expect(parsed.status).toBe('ok');
    expect(parsed.service).toBe('billcalendar-api');
    expect(parsed.timezone).toBe('Asia/Taipei');
    expect(parsed.database.connected).toBe(true);
    expect(parsed.database.migrated).toBe(true);
    expect(parsed.database.error).toBeUndefined();
    sqlite.close();
  });

  it('ensures src/shared has no server-only, DB, or secret dependencies', () => {
    const sharedDir = path.resolve(process.cwd(), 'src/shared');
    const files = fs.readdirSync(sharedDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(path.join(sharedDir, file), 'utf-8');
      expect(content).not.toMatch(/from\s+['"]\.\.\/server/);
      expect(content).not.toMatch(/from\s+['"]drizzle-orm/);
      expect(content).not.toMatch(/from\s+['"]hono/);
      expect(content).not.toMatch(/D1Database/);
    }
  });

  it('ensures neither wrangler.toml nor package.json introduces R2 storage', () => {
    const wranglerContent = fs.readFileSync(path.resolve(process.cwd(), 'wrangler.toml'), 'utf-8');
    const pkgContent = fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8');

    expect(wranglerContent).not.toMatch(/r2_buckets/i);
    expect(pkgContent).not.toMatch(/@aws-sdk\/client-s3|r2/i);
  });
});
