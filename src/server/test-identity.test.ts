import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './index';
import {
  SYNTHETIC_IDENTITY_PRESETS,
  TestIdentityStateResponseSchema,
  isSyntheticTestEmail,
  normalizeEmail,
} from '../shared';
import { createMigratedSqliteD1 } from './test-utils/sqlite-d1';

describe('Issue #2 Test Email Identity Simulation & Security Boundaries', () => {
  it('enforces normalized Email uniqueness at both API and database levels', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    expect(normalizeEmail('  Alice.Demo@BillCalendar.TEST  ')).toBe(
      'alice.demo@billcalendar.test',
    );

    const res1 = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: '  Alice.Demo@BillCalendar.TEST  ',
          displayName: 'Alice',
        }),
      },
      devEnv,
    );
    expect(res1.status).toBe(200);
    const state1 = TestIdentityStateResponseSchema.parse(await res1.json());
    expect(state1.currentUser?.emailNormalized).toBe('alice.demo@billcalendar.test');
    const firstUserId = state1.currentUser?.id;
    expect(firstUserId).toBeTruthy();

    // Selecting again with different casing/spaces resolves to the exact same internal user_id
    const res2 = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice.demo@billcalendar.test',
        }),
      },
      devEnv,
    );
    expect(res2.status).toBe(200);
    const state2 = TestIdentityStateResponseSchema.parse(await res2.json());
    expect(state2.currentUser?.id).toBe(firstUserId);
    expect(state2.availableUsers).toHaveLength(1);

    // Verify SQLite UNIQUE index rejects duplicate normalized email insertion directly
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO users (id, email_normalized, display_name, default_timezone, created_at, updated_at)
           VALUES ('dup-id', 'alice.demo@billcalendar.test', 'Dup', 'Asia/Taipei', '2026-10-28T00:00:00Z', '2026-10-28T00:00:00Z')`,
        )
        .run();
    }).toThrow(/UNIQUE constraint failed: users\.email_normalized/i);

    sqlite.close();
  });

  it('accepts reserved .test synthetic addresses and rejects real domains or invalid addresses without writing to users', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    expect(isSyntheticTestEmail('alice.demo@billcalendar.test')).toBe(true);
    expect(isSyntheticTestEmail('real.user@gmail.com')).toBe(false);

    const rejectedAddresses = [
      'real.user@gmail.com',
      'someone@outlook.com',
      'user@company.com.tw',
      'trick@test.com',
      'not-an-email',
      'user@.test',
      'user@test',
    ];

    for (const invalidEmail of rejectedAddresses) {
      const res = await app.request(
        '/api/test-identity/select',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: invalidEmail }),
        },
        devEnv,
      );
      expect(res.status).toBe(400);
      const errBody = (await res.json()) as { error: string; message: string };
      expect(errBody.error).toBe('VALIDATION_ERROR');
    }

    // Confirm none of the rejected emails were persisted in D1 `users` table
    const countRow = sqlite.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    expect(countRow.cnt).toBe(0);

    // Confirm valid .test synthetic address succeeds and writes exactly 1 user
    const validRes = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '  Charlie@Sub.BillCalendar.TEST  ' }),
      },
      devEnv,
    );
    expect(validRes.status).toBe(200);
    const validState = TestIdentityStateResponseSchema.parse(await validRes.json());
    expect(validState.currentUser?.emailNormalized).toBe('charlie@sub.billcalendar.test');

    const afterCountRow = sqlite.prepare('SELECT COUNT(*) as cnt FROM users').get() as {
      cnt: number;
    };
    expect(afterCountRow.cnt).toBe(1);

    sqlite.close();
  });

  it('supports switching between two synthetic accounts and logging out while preserving stable user_ids', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const [presetA, presetB] = SYNTHETIC_IDENTITY_PRESETS;

    // 1. Select Synthetic Account A
    const resA = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(presetA),
      },
      devEnv,
    );
    expect(resA.status).toBe(200);
    expect(resA.headers.get('X-Identity-Mode')).toBe('unverified-test-simulation');
    const stateA = TestIdentityStateResponseSchema.parse(await resA.json());
    expect(stateA.simulationMode).toBe(true);
    expect(stateA.isAuthenticatedSecurity).toBe(false);
    expect(stateA.securityNotice).toMatch(/請勿輸入真實姓名、個資/);
    const userAId = stateA.currentUser?.id;
    const sessionA = stateA.sessionId;
    expect(userAId).toBeTruthy();
    expect(sessionA).toBeTruthy();

    // 2. Switch to Synthetic Account B (passing previous session header)
    const resB = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': sessionA!,
        },
        body: JSON.stringify(presetB),
      },
      devEnv,
    );
    expect(resB.status).toBe(200);
    const stateB = TestIdentityStateResponseSchema.parse(await resB.json());
    const userBId = stateB.currentUser?.id;
    const sessionB = stateB.sessionId;
    expect(userBId).toBeTruthy();
    expect(userBId).not.toBe(userAId);
    expect(sessionB).not.toBe(sessionA);
    expect(stateB.availableUsers).toHaveLength(2);

    // Previous sessionA was invalidated during switch
    const checkOldSession = await app.request(
      '/api/test-identity/state',
      { headers: { 'X-Test-Session-Id': sessionA! } },
      devEnv,
    );
    const oldSessionState = TestIdentityStateResponseSchema.parse(await checkOldSession.json());
    expect(oldSessionState.currentUser).toBeNull();

    // Current sessionB resolves to Account B
    const checkActiveSession = await app.request(
      '/api/test-identity/state',
      { headers: { 'X-Test-Session-Id': sessionB! } },
      devEnv,
    );
    const activeState = TestIdentityStateResponseSchema.parse(await checkActiveSession.json());
    expect(activeState.currentUser?.id).toBe(userBId);
    expect(activeState.currentUser?.emailNormalized).toBe(presetB.email);

    // 3. Switch back to Account A and confirm internal user_id is unchanged
    const resBackToA = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': sessionB!,
        },
        body: JSON.stringify({ email: presetA.email }),
      },
      devEnv,
    );
    const stateBackToA = TestIdentityStateResponseSchema.parse(await resBackToA.json());
    expect(stateBackToA.currentUser?.id).toBe(userAId);

    // 4. Logout clears the active session
    const logoutRes = await app.request(
      '/api/test-identity/logout',
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': stateBackToA.sessionId! },
      },
      devEnv,
    );
    expect(logoutRes.status).toBe(200);
    const loggedOutState = TestIdentityStateResponseSchema.parse(await logoutRes.json());
    expect(loggedOutState.currentUser).toBeNull();
    expect(loggedOutState.sessionId).toBeNull();

    sqlite.close();
  });

  it('disables test identity endpoints unless APP_ENV === development and ALLOW_TEST_IDENTITY === true', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();

    const blockedEnvs = [
      { DB: db }, // Unset env vars -> fail-closed
      { DB: db, APP_ENV: 'production', ALLOW_TEST_IDENTITY: 'false' },
      { DB: db, APP_ENV: 'production', ALLOW_TEST_IDENTITY: 'true' },
      { DB: db, APP_ENV: 'staging', ALLOW_TEST_IDENTITY: 'false' },
      { DB: db, APP_ENV: 'staging', ALLOW_TEST_IDENTITY: 'true' }, // Non-development blocked even if flag is true
      { DB: db, APP_ENV: 'preview', ALLOW_TEST_IDENTITY: 'true' },
      { DB: db, APP_ENV: 'development', ALLOW_TEST_IDENTITY: 'false' },
      { DB: db, APP_ENV: 'development' },
    ];

    for (const env of blockedEnvs) {
      const stateRes = await app.request('/api/test-identity/state', undefined, env);
      expect(stateRes.status).toBe(403);
      const stateJson = TestIdentityStateResponseSchema.parse(await stateRes.json());
      expect(stateJson.enabled).toBe(false);
      expect(stateJson.isAuthenticatedSecurity).toBe(false);

      const selectRes = await app.request(
        '/api/test-identity/select',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'alice.demo@billcalendar.test' }),
        },
        env,
      );
      expect(selectRes.status).toBe(403);
    }

    sqlite.close();
  });

  it('verifies wrangler.toml separates dev/staging/prod configs and disables test identity on default public entrypoint', () => {
    const wranglerContent = fs.readFileSync(path.resolve(process.cwd(), 'wrangler.toml'), 'utf-8');

    // Default top-level config must be production with ALLOW_TEST_IDENTITY = "false"
    expect(wranglerContent).toMatch(/\[vars\][\s\S]*?APP_ENV\s*=\s*"production"/);
    expect(wranglerContent).toMatch(/\[vars\][\s\S]*?ALLOW_TEST_IDENTITY\s*=\s*"false"/);
    expect(wranglerContent).toMatch(/database_name\s*=\s*"billcalendar-db-prod"/);

    // Staging config must have isolated DB and ALLOW_TEST_IDENTITY = "false"
    expect(wranglerContent).toMatch(/\[env\.staging\.vars\][\s\S]*?ALLOW_TEST_IDENTITY\s*=\s*"false"/);
    expect(wranglerContent).toMatch(/database_name\s*=\s*"billcalendar-db-staging"/);

    // Development config enables test identity on local DB
    expect(wranglerContent).toMatch(
      /\[env\.development\.vars\][\s\S]*?ALLOW_TEST_IDENTITY\s*=\s*"true"/,
    );
    expect(wranglerContent).toMatch(/database_name\s*=\s*"billcalendar-db"/);
  });
});
