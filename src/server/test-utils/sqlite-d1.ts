import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Lightweight D1Database adapter backed by Node's built-in SQLite (node:sqlite)
 * that uses StatementSync.setReturnArrays(true) for raw() to preserve positional
 * columns across Drizzle JOIN queries, matching Cloudflare D1 runtime behavior.
 */
export function createSqliteD1Adapter(sqlite: DatabaseSync): D1Database {
  const createPreparedStatement = (
    query: string,
    boundValues: unknown[] = [],
  ): D1PreparedStatement => {
    return {
      bind(...values: unknown[]) {
        return createPreparedStatement(query, values);
      },
      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const stmt = sqlite.prepare(query);
        const row = stmt.get(...(boundValues as never[])) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName) return (row[colName] as T) ?? null;
        return row as T;
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const stmt = sqlite.prepare(query);
        let rows: T[] = [];
        let changes = 0;
        let lastInsertRowid = 0;
        if (/returning/i.test(query)) {
          rows = stmt.all(...(boundValues as never[])) as T[];
          changes = rows.length;
        } else {
          const info = stmt.run(...(boundValues as never[]));
          changes = Number(info.changes);
          lastInsertRowid = Number(info.lastInsertRowid);
        }
        return {
          results: rows,
          success: true,
          meta: {
            changes,
            last_row_id: lastInsertRowid,
            duration: 0,
            rows_read: 0,
            rows_written: changes,
          } as D1Meta & Record<string, unknown>,
        };
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const stmt = sqlite.prepare(query);
        const rows = stmt.all(...(boundValues as never[])) as T[];
        return {
          results: rows,
          success: true,
          meta: {
            changes: rows.length,
            last_row_id: 0,
            duration: 0,
            rows_read: rows.length,
            rows_written: rows.length,
          } as D1Meta & Record<string, unknown>,
        };
      },
      raw: (async <T = unknown[]>(options?: { columnNames?: boolean }) => {
        const stmt = sqlite.prepare(query);
        stmt.setReturnArrays(true);
        const rows = stmt.all(...(boundValues as never[])) as unknown as T[];
        if (rows.length === 0) {
          return options?.columnNames ? ([[]] as unknown as [string[], ...T[]]) : ([] as T[]);
        }
        if (options?.columnNames) {
          const objStmt = sqlite.prepare(query);
          const firstObj = objStmt.get(...(boundValues as never[])) as Record<string, unknown> | undefined;
          const cols = firstObj ? Object.keys(firstObj) : [];
          return [cols, ...rows] as [string[], ...T[]];
        }
        return rows;
      }) as D1PreparedStatement['raw'],
    };
  };

  return {
    prepare(query: string) {
      return createPreparedStatement(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      sqlite.exec('BEGIN TRANSACTION;');
      try {
        for (const s of statements) {
          results.push(await s.all<T>());
        }
        sqlite.exec('COMMIT;');
      } catch (err) {
        try {
          sqlite.exec('ROLLBACK;');
        } catch {
          // If transaction was already aborted by SQLite, ignore rollback error
        }
        throw err;
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

export function createMigratedSqliteD1(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  const drizzleDir = path.resolve(process.cwd(), 'drizzle');
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of sqlFiles) {
    const sqlContent = fs.readFileSync(path.join(drizzleDir, file), 'utf-8');
    sqlite.exec(sqlContent);
  }

  return { sqlite, db: createSqliteD1Adapter(sqlite) };
}
