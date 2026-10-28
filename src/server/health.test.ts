import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './index';
import { HealthResponseSchema } from '../shared';

/**
 * Lightweight D1Database adapter backed by Node's built-in SQLite (node:sqlite)
 * to verify real SQL execution & Drizzle migrations from an empty database.
 */
function createSqliteD1Adapter(sqlite: DatabaseSync): D1Database {
  const createPreparedStatement = (query: string, boundValues: unknown[] = []): D1PreparedStatement => {
    const stmt = sqlite.prepare(query);
    return {
      bind(...values: unknown[]) {
        return createPreparedStatement(query, values);
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const row = stmt.get(...(boundValues as never[])) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName) return (row[colName] as T) ?? null;
        return row as T;
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        stmt.run(...(boundValues as never[]));
        return {
          results: [],
          success: true,
          meta: {} as D1Meta & Record<string, unknown>,
        };
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const rows = stmt.all(...(boundValues as never[])) as T[];
        return {
          results: rows,
          success: true,
          meta: {} as D1Meta & Record<string, unknown>,
        };
      },
      raw: (async <T = unknown[]>(options?: { columnNames?: boolean }) => {
        const rows = stmt.all(...(boundValues as never[])) as Record<string, unknown>[];
        if (rows.length === 0) {
          return options?.columnNames ? ([[]] as unknown as [string[], ...T[]]) : ([] as T[]);
        }
        const cols = Object.keys(rows[0]);
        const values = rows.map((r) => cols.map((c) => r[c])) as unknown as T[];
        if (options?.columnNames) {
          return [cols, ...values] as [string[], ...T[]];
        }
        return values;
      }) as D1PreparedStatement['raw'],
    };
  };

  return {
    prepare(query: string) {
      return createPreparedStatement(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      for (const s of statements) {
        results.push(await s.all<T>());
      }
      return results;
    },
    async exec(query: string): Promise<D1ExecResult> {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
    withSession(): D1DatabaseSession {
      throw new Error('Not implemented in test adapter');
    },
  };
}

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
    sqlite.close();
  });

  it('applies D1 SQL migrations from an empty database and returns 200 ok from /api/health', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const drizzleDir = path.resolve(process.cwd(), 'drizzle');
    const sqlFiles = fs
      .readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    expect(sqlFiles.length).toBeGreaterThan(0);

    for (const file of sqlFiles) {
      const sqlContent = fs.readFileSync(path.join(drizzleDir, file), 'utf-8');
      sqlite.exec(sqlContent);
    }

    const db = createSqliteD1Adapter(sqlite);
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
