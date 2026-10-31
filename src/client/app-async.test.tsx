// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTodayLocalDate } from '../shared';
import { App } from './App';

/**
 * Issue #29 (PR #27 Follow-up #2) + Issue #8:
 * `<App />`-level integration tests for async identity switching, space switching, logout,
 * leaving a family and out-of-order network responses for BOTH events and tasks.
 *
 * `fetch` is replaced by a controllable in-memory API. Individual `/api/events` and `/api/tasks`
 * requests can be parked behind deferred promises so tests decide the resolution order.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const TODAY = getTodayLocalDate();
const NOW = '2026-10-01T00:00:00.000Z';

const USERS = {
  sess_alice: {
    id: 'usr_alice',
    emailNormalized: 'alice.demo@billcalendar.test',
    displayName: 'Alice (合成帳號 A)',
    defaultTimezone: 'Asia/Taipei',
    createdAt: NOW,
  },
  sess_bob: {
    id: 'usr_bob',
    emailNormalized: 'bob.demo@billcalendar.test',
    displayName: 'Bob (合成帳號 B)',
    defaultTimezone: 'Asia/Taipei',
    createdAt: NOW,
  },
} as const;
type SessionId = keyof typeof USERS;

const FAMILY = {
  id: 'fam_01',
  name: '陳家生活空間',
  myRole: 'admin',
  memberCount: 1,
  createdBy: 'usr_alice',
  createdAt: NOW,
  updatedAt: NOW,
};
const FAMILY_DETAIL = {
  ...FAMILY,
  members: [
    {
      id: 'mem_1',
      userId: 'usr_alice',
      role: 'admin',
      displayName: 'Alice (合成帳號 A)',
      emailNormalized: 'alice.demo@billcalendar.test',
      joinedAt: NOW,
    },
  ],
  pendingInvitations: [],
};

function eventFixture(
  title: string,
  scope: 'personal' | 'family',
  opts: { ownerUserId?: string | null; familyId?: string | null } = {},
) {
  return {
    id: `evt_${title}`,
    calendarId: 'cal_x',
    scope,
    ownerUserId: scope === 'personal' ? (opts.ownerUserId ?? null) : null,
    familyId: scope === 'family' ? (opts.familyId ?? 'fam_01') : null,
    title,
    description: null,
    startsAt: TODAY,
    endsAt: TODAY,
    allDay: true,
    timezone: 'Asia/Taipei',
    sourceMessageId: null,
    sourceStatus: 'none',
    sourceMessage: null,
    createdBy: 'usr_alice',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function taskFixture(
  title: string,
  scope: 'personal' | 'family',
  opts: {
    ownerUserId?: string | null;
    familyId?: string | null;
    dueDate?: string | null;
    sourceMessageId?: string | null;
    sourceStatus?: 'none' | 'accessible' | 'deleted' | 'inaccessible';
    sourceMessage?: any;
  } = {},
) {
  return {
    id: `task_${title}`,
    listId: 'list_x',
    scope,
    ownerUserId: scope === 'personal' ? (opts.ownerUserId ?? null) : null,
    familyId: scope === 'family' ? (opts.familyId ?? 'fam_01') : null,
    title,
    dueDate: opts.dueDate === undefined ? TODAY : opts.dueDate,
    completedAt: null,
    sourceMessageId: opts.sourceMessageId ?? null,
    sourceStatus: opts.sourceStatus ?? (opts.sourceMessageId ? 'accessible' : 'none'),
    sourceMessage: opts.sourceMessage ?? null,
    createdBy: 'usr_alice',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface RecordedCall {
  method: string;
  path: string;
  search: string;
  session: string | null;
  signal: AbortSignal | null;
  body: unknown;
}

type DataKey = `${'events' | 'tasks'}:${string}:${string}`;

interface FakeApi {
  calls: RecordedCall[];
  /** Default payloads, keyed `events|tasks:<session>:<scope>`. */
  data: Map<DataKey, unknown[]>;
  /** One-shot parked responses for the next matching request. `honorAbort` mimics real fetch. */
  parked: Map<DataKey, { gate: Deferred<unknown[]>; honorAbort: boolean }>;
  selectGate: Deferred<void> | null;
  logoutGate: Deferred<void> | null;
  families: Record<string, unknown[]>;
  taskMutations: { method: string; path: string; body: unknown }[];
  tasksStore: unknown[] | null;
  chatMutations: { method: string; path: string; body: unknown }[];
  chatStore: any[];
  chatData: Map<string, unknown>;
  parkedChat: Map<string, { gate: Deferred<unknown[]>; honorAbort: boolean }>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stateFor(session: SessionId | null) {
  return {
    enabled: true,
    simulationMode: true,
    isAuthenticatedSecurity: false,
    securityNotice: 'test',
    sessionId: session,
    expiresAt: session ? '2030-01-01T00:00:00.000Z' : null,
    currentUser: session ? USERS[session] : null,
    availableUsers: [],
  };
}

function installFakeApi(initialSession: SessionId | null): FakeApi {
  const api: FakeApi = {
    calls: [],
    data: new Map(),
    parked: new Map(),
    selectGate: null,
    logoutGate: null,
    families: { sess_alice: [FAMILY], sess_bob: [] },
    taskMutations: [],
    tasksStore: null,
    chatMutations: [],
    chatStore: [],
    chatData: new Map(),
    parkedChat: new Map(),
  };
  if (initialSession) window.localStorage.setItem('bc_test_session_id', initialSession);

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
      const headers = new Headers(init?.headers);
      const session = headers.get('X-Test-Session-Id');
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      const signal = init?.signal ?? null;
      api.calls.push({ method, path: url.pathname, search: url.search, session, signal, body });
      const path = url.pathname;

      if (path === '/api/health') {
        return json({
          status: 'ok',
          service: 'billcalendar-api',
          environment: 'test',
          timezone: 'Asia/Taipei',
          timestamp: NOW,
          database: { connected: true, migrated: true },
        });
      }
      if (path === '/api/test-identity/state') {
        return json(stateFor(session && session in USERS ? (session as SessionId) : null));
      }
      if (path === '/api/test-identity/select') {
        if (api.selectGate) await api.selectGate.promise;
        const next: SessionId = String(body?.email).startsWith('bob') ? 'sess_bob' : 'sess_alice';
        return json(stateFor(next));
      }
      if (path === '/api/test-identity/logout') {
        if (api.logoutGate) await api.logoutGate.promise;
        return json(stateFor(null));
      }
      if (path === '/api/families') {
        return json(api.families[session ?? ''] ?? []);
      }
      if (path === `/api/families/${FAMILY.id}`) return json(FAMILY_DETAIL);
      if (path === `/api/families/${FAMILY.id}/leave`) {
        api.families.sess_alice = [];
        return json({ success: true });
      }
      if (path === '/api/invitations') return json([]);
      if (path === '/api/spaces') return json({ message: 'n/a' }, 404);
      if (path === '/api/chat-rooms') {
        const scope = url.searchParams.get('scope') ?? 'personal';
        return json([
          {
            id: scope === 'family' ? 'room_fam_01' : 'room_personal',
            kind: scope,
            userId: scope === 'personal' ? (USERS[session as SessionId]?.id ?? 'usr_alice') : null,
            familyId: scope === 'family' ? 'fam_01' : null,
            timezone: 'Asia/Taipei',
            createdAt: NOW,
            updatedAt: NOW,
          },
        ]);
      }
      if (path.startsWith('/api/chat-rooms/') && path.endsWith('/messages')) {
        const roomId = url.pathname.split('/')[3];
        if (method === 'POST') {
          api.chatMutations.push({ method, path, body });
          const isFam = roomId.startsWith('room_fam') || roomId === 'fam_01';
          const created = {
            id: `msg_${Date.now()}`,
            roomId,
            roomKind: isFam ? 'family' : 'personal',
            familyId: isFam ? 'fam_01' : null,
            senderUserId: USERS[session as SessionId]?.id ?? 'usr_alice',
            senderDisplayName: USERS[session as SessionId]?.displayName ?? '愛麗絲',
            body: body.body,
            localDate: TODAY,
            recordDate: body.recordDate ?? null,
            createdAt: NOW,
            updatedAt: NOW,
            derivedTasks: [],
            derivedEvents: [],
            derivedCount: 0,
          };
          api.chatStore.push(created);
          return json(created, 201);
        }

        const chatKey = `${session}:${roomId}`;
        const park = api.parkedChat.get(chatKey) ?? api.parkedChat.get(roomId);
        if (park) {
          api.parkedChat.delete(chatKey);
          api.parkedChat.delete(roomId);
          const payload = await new Promise<unknown[]>((resolve, reject) => {
            park.gate.promise.then(resolve);
            if (park.honorAbort && signal) {
              signal.addEventListener('abort', () =>
                reject(new DOMException('The operation was aborted.', 'AbortError')),
              );
            }
          });
          return json(payload);
        }

        const before = url.searchParams.get('before');
        const after = url.searchParams.get('after');
        if (before) {
          const key = `before:${before}`;
          if (api.chatData.has(key)) return json(api.chatData.get(key)!);
        }
        if (after) {
          const key = `after:${after}`;
          if (api.chatData.has(key)) return json(api.chatData.get(key)!);
        }

        if (api.chatData.has(chatKey)) {
          return json(api.chatData.get(chatKey)!);
        }
        if (api.chatData.has(roomId)) {
          return json(api.chatData.get(roomId)!);
        }

        return json(api.chatStore);
      }
      if (path.startsWith('/api/messages/') && method === 'DELETE') {
        const id = path.split('/')[3];
        api.chatMutations.push({ method, path, body: null });
        api.chatStore = api.chatStore.filter((m: any) => m.id !== id);
        return json({ success: true, id, deletedAt: NOW });
      }

      if (path === '/api/events' || path === '/api/tasks') {
        const kind = path === '/api/events' ? 'events' : 'tasks';
        if (kind === 'tasks' && method !== 'GET') {
          api.taskMutations.push({ method, path, body });
          if (method === 'POST') {
            const created = taskFixture(String(body.title), body.scope, {
              ownerUserId: USERS[session as SessionId].id,
              familyId: body.familyId ?? null,
              dueDate: body.dueDate ?? null,
              sourceMessageId: body.sourceMessageId ?? null,
            });
            return json(created, 201);
          }
        }
        const scope = url.searchParams.get('scope') ?? 'personal';
        const key: DataKey = `${kind}:${session}:${scope}`;
        const park = api.parked.get(key);
        let payload: unknown[];
        if (park) {
          api.parked.delete(key);
          payload = await new Promise<unknown[]>((resolve, reject) => {
            park.gate.promise.then(resolve);
            if (park.honorAbort && signal) {
              signal.addEventListener('abort', () =>
                reject(new DOMException('The operation was aborted.', 'AbortError')),
              );
            }
          });
        } else {
          payload = api.data.get(key) ?? [];
        }
        return json(payload);
      }
      if (kind_isTaskItemPath(path)) {
        api.taskMutations.push({ method, path, body });
        const id = decodeURIComponent(path.split('/').pop()!);
        if (method === 'DELETE') return json({ success: true, id });
        const base = taskFixture(id.replace(/^task_/, ''), 'personal', {
          ownerUserId: USERS[session as SessionId].id,
          dueDate: body?.dueDate ?? TODAY,
        });
        return json({
          ...base,
          id,
          title: body?.title ?? base.title,
          completedAt: body?.completed ? NOW : null,
        });
      }
      return json({ message: `unhandled ${method} ${path}` }, 404);
    }),
  );
  return api;
}

function kind_isTaskItemPath(path: string): boolean {
  return /^\/api\/tasks\/[^/]+$/.test(path);
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const titleCount = (title: string) => screen.queryAllByText(title).length;

function clickPreset(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

const hasCall = (api: FakeApi, path: string, session: string, search = '') =>
  api.calls.some((c) => c.path === path && c.session === session && c.search.includes(search));

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
}

beforeEach(() => {
  // Newer Node versions expose an experimental global `localStorage` that shadows jsdom's; use a deterministic in-memory one.
  Object.defineProperty(window, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Issue #29 <App /> async identity / space switching & out-of-order responses', () => {
  it('loads personal events and tasks for the current identity', async () => {
    const api = installFakeApi('sess_alice');
    api.data.set('events:sess_alice:personal', [
      eventFixture('Alice 行程', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    api.data.set('tasks:sess_alice:personal', [
      taskFixture('Alice 待辦', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    render(<App />);
    await waitFor(() => expect(titleCount('Alice 行程')).toBeGreaterThan(0));
    await waitFor(() => expect(titleCount('Alice 待辦')).toBeGreaterThan(0));
    expect(hasCall(api, '/api/tasks', 'sess_alice', 'scope=personal')).toBe(true);
  });

  it('immediately clears the previous user events AND tasks when switching identity (before the select response)', async () => {
    const api = installFakeApi('sess_alice');
    api.data.set('events:sess_alice:personal', [
      eventFixture('Alice 私人行程', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    api.data.set('tasks:sess_alice:personal', [
      taskFixture('Alice 私人待辦', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    api.data.set('events:sess_bob:personal', [
      eventFixture('Bob 行程', 'personal', { ownerUserId: 'usr_bob' }),
    ]);
    api.data.set('tasks:sess_bob:personal', [
      taskFixture('Bob 待辦', 'personal', { ownerUserId: 'usr_bob' }),
    ]);
    render(<App />);
    await waitFor(() => expect(titleCount('Alice 私人待辦')).toBeGreaterThan(0));
    expect(titleCount('Alice 私人行程')).toBeGreaterThan(0);

    api.selectGate = deferred<void>();
    clickPreset(/Bob \(合成帳號 B\)/);
    await flush();
    // select request still pending, Alice's private data must already be gone
    expect(titleCount('Alice 私人行程')).toBe(0);
    expect(titleCount('Alice 私人待辦')).toBe(0);

    await act(async () => {
      api.selectGate!.resolve();
    });
    await waitFor(() => expect(titleCount('Bob 待辦')).toBeGreaterThan(0));
    expect(titleCount('Bob 行程')).toBeGreaterThan(0);
    expect(titleCount('Alice 私人行程')).toBe(0);
    expect(titleCount('Alice 私人待辦')).toBe(0);
  });

  it.each([
    ['ignores the AbortSignal (late stale arrival)', false],
    ['honours the AbortSignal like real fetch (AbortError)', true],
  ])(
    'A slow personal load resolving AFTER switching to B never overwrites B and never surfaces an error — fetch %s',
    async (_label, honorAbort) => {
      const api = installFakeApi('sess_alice');
      // Payloads deliberately carry NO ownerUserId so only the App request guard can keep them out.
      const slowEvents = deferred<unknown[]>();
      const slowTasks = deferred<unknown[]>();
      api.parked.set('events:sess_alice:personal', { gate: slowEvents, honorAbort });
      api.parked.set('tasks:sess_alice:personal', { gate: slowTasks, honorAbort });
      api.data.set('events:sess_bob:personal', [eventFixture('Bob 行程', 'personal')]);
      api.data.set('tasks:sess_bob:personal', [taskFixture('Bob 待辦', 'personal')]);

      render(<App />);
      await waitFor(() => {
        expect(hasCall(api, '/api/events', 'sess_alice')).toBe(true);
        expect(hasCall(api, '/api/tasks', 'sess_alice')).toBe(true);
      });

      clickPreset(/Bob \(合成帳號 B\)/);
      await waitFor(() => expect(titleCount('Bob 待辦')).toBeGreaterThan(0));
      expect(titleCount('Bob 行程')).toBeGreaterThan(0);

      // Alice's in-flight requests were aborted on switch
      const aliceListCalls = api.calls.filter(
        (c) => c.session === 'sess_alice' && (c.path === '/api/events' || c.path === '/api/tasks'),
      );
      expect(aliceListCalls.length).toBeGreaterThanOrEqual(2);
      expect(aliceListCalls.every((c) => c.signal?.aborted === true)).toBe(true);

      // The slow Alice responses finally arrive (out of order)
      await act(async () => {
        slowEvents.resolve([eventFixture('Alice 洩漏行程', 'personal')]);
        slowTasks.resolve([taskFixture('Alice 洩漏待辦', 'personal')]);
      });
      await flush();

      expect(titleCount('Alice 洩漏行程')).toBe(0);
      expect(titleCount('Alice 洩漏待辦')).toBe(0);
      expect(titleCount('Bob 行程')).toBeGreaterThan(0);
      expect(titleCount('Bob 待辦')).toBeGreaterThan(0);
      expect(screen.queryByTestId('events-api-error')).toBeNull();
      expect(screen.queryByTestId('summary-tasks-api-error')).toBeNull();
    },
  );

  it('space switch personal → family → personal: an older personal response resolving last is discarded', async () => {
    const api = installFakeApi('sess_alice');
    const slowEvents = deferred<unknown[]>();
    const slowTasks = deferred<unknown[]>();
    api.parked.set('events:sess_alice:personal', { gate: slowEvents, honorAbort: false });
    api.parked.set('tasks:sess_alice:personal', { gate: slowTasks, honorAbort: false });
    api.data.set('events:sess_alice:personal', [
      eventFixture('新版個人行程', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    api.data.set('tasks:sess_alice:personal', [
      taskFixture('新版個人待辦', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    api.data.set('events:sess_alice:family', [eventFixture('家庭行程', 'family')]);
    api.data.set('tasks:sess_alice:family', [taskFixture('家庭待辦', 'family')]);

    render(<App />);
    // first (slow) personal requests are in flight
    await waitFor(() => expect(hasCall(api, '/api/tasks', 'sess_alice', 'scope=personal')).toBe(true));
    await screen.findByTestId('space-switch-family-fam_01');

    fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));
    await waitFor(() => expect(titleCount('家庭待辦')).toBeGreaterThan(0));
    expect(titleCount('家庭行程')).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('space-switch-personal'));
    await waitFor(() => expect(titleCount('新版個人待辦')).toBeGreaterThan(0));
    expect(titleCount('新版個人行程')).toBeGreaterThan(0);
    expect(titleCount('家庭待辦')).toBe(0);

    // the very first personal requests were aborted by the space switch
    const firstPersonal = api.calls.filter(
      (c) => c.session === 'sess_alice' && c.search.includes('scope=personal'),
    )[0];
    expect(firstPersonal?.signal?.aborted).toBe(true);

    await act(async () => {
      slowEvents.resolve([eventFixture('過期個人行程', 'personal', { ownerUserId: 'usr_alice' })]);
      slowTasks.resolve([taskFixture('過期個人待辦', 'personal', { ownerUserId: 'usr_alice' })]);
    });
    await flush();

    expect(titleCount('過期個人行程')).toBe(0);
    expect(titleCount('過期個人待辦')).toBe(0);
    expect(titleCount('新版個人行程')).toBeGreaterThan(0);
    expect(titleCount('新版個人待辦')).toBeGreaterThan(0);
  });

  it('space switch personal → family: a slow personal response arriving while family is shown does not leak into family', async () => {
    const api = installFakeApi('sess_alice');
    api.data.set('events:sess_alice:personal', [
      eventFixture('個人行程', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    api.data.set('tasks:sess_alice:personal', [
      taskFixture('個人待辦', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    api.data.set('events:sess_alice:family', [eventFixture('家庭行程', 'family')]);
    api.data.set('tasks:sess_alice:family', [taskFixture('家庭待辦', 'family')]);

    render(<App />);
    await waitFor(() => expect(titleCount('個人待辦')).toBeGreaterThan(0));
    await screen.findByTestId('space-switch-family-fam_01');

    // park the NEXT personal reload, go to family (fast), then back to personal (parked), then family again
    const slowTasks = deferred<unknown[]>();
    api.parked.set('tasks:sess_alice:personal', { gate: slowTasks, honorAbort: false });
    fireEvent.click(screen.getByTestId('space-switch-personal'));
    await waitFor(() => expect(hasCall(api, '/api/tasks', 'sess_alice', 'scope=personal')).toBe(true));
    fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));
    await waitFor(() => expect(titleCount('家庭待辦')).toBeGreaterThan(0));

    await act(async () => {
      slowTasks.resolve([taskFixture('遲到的個人待辦', 'personal', { ownerUserId: 'usr_alice' })]);
    });
    await flush();
    expect(titleCount('遲到的個人待辦')).toBe(0);
    expect(titleCount('家庭待辦')).toBeGreaterThan(0);

    // switching back to personal must show fresh personal data, not the stale late response
    fireEvent.click(screen.getByTestId('space-switch-personal'));
    await waitFor(() => expect(titleCount('個人待辦')).toBeGreaterThan(0));
    expect(titleCount('遲到的個人待辦')).toBe(0);
  });

  it('logout while loads are in flight aborts them and a late response never renders', async () => {
    const api = installFakeApi('sess_alice');
    const slowEvents = deferred<unknown[]>();
    const slowTasks = deferred<unknown[]>();
    api.parked.set('events:sess_alice:personal', { gate: slowEvents, honorAbort: false });
    api.parked.set('tasks:sess_alice:personal', { gate: slowTasks, honorAbort: false });

    render(<App />);
    await waitFor(() => expect(hasCall(api, '/api/tasks', 'sess_alice', 'scope=personal')).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: '結束目前模擬身份' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '結束目前模擬身份' })).toBeNull());

    const aliceListCalls = api.calls.filter(
      (c) => c.session === 'sess_alice' && (c.path === '/api/events' || c.path === '/api/tasks'),
    );
    expect(aliceListCalls.every((c) => c.signal?.aborted === true)).toBe(true);

    await act(async () => {
      slowEvents.resolve([eventFixture('登出後行程', 'personal')]);
      slowTasks.resolve([taskFixture('登出後待辦', 'personal')]);
    });
    await flush();
    expect(titleCount('登出後行程')).toBe(0);
    expect(titleCount('登出後待辦')).toBe(0);

    // signing in as Bob afterwards still starts from a clean slate
    api.data.set('tasks:sess_bob:personal', [taskFixture('Bob 待辦', 'personal')]);
    clickPreset(/Bob \(合成帳號 B\)/);
    await waitFor(() => expect(titleCount('Bob 待辦')).toBeGreaterThan(0));
    expect(titleCount('登出後待辦')).toBe(0);
  });

  it('leaving the selected family aborts its in-flight loads and falls back to personal data', async () => {
    const api = installFakeApi('sess_alice');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.data.set('events:sess_alice:personal', [
      eventFixture('個人行程', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    api.data.set('tasks:sess_alice:personal', [
      taskFixture('個人待辦', 'personal', { ownerUserId: 'usr_alice' }),
    ]);

    render(<App />);
    await waitFor(() => expect(titleCount('個人待辦')).toBeGreaterThan(0));
    await screen.findByTestId('space-switch-family-fam_01');

    const slowEvents = deferred<unknown[]>();
    const slowTasks = deferred<unknown[]>();
    api.parked.set('events:sess_alice:family', { gate: slowEvents, honorAbort: false });
    api.parked.set('tasks:sess_alice:family', { gate: slowTasks, honorAbort: false });
    fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));
    await waitFor(() => expect(hasCall(api, '/api/tasks', 'sess_alice', 'scope=family')).toBe(true));

    fireEvent.click(await screen.findByRole('button', { name: '退出該家庭' }));
    await waitFor(() => expect(screen.queryByTestId('space-switch-family-fam_01')).toBeNull());
    await waitFor(() => expect(titleCount('個人待辦')).toBeGreaterThan(0));
    expect(screen.getByTestId('status-selected-space').textContent).toBe('個人空間');

    const familyCalls = api.calls.filter((c) => c.search.includes('scope=family'));
    expect(familyCalls.length).toBeGreaterThanOrEqual(2);
    expect(familyCalls.every((c) => c.signal?.aborted === true)).toBe(true);

    await act(async () => {
      slowEvents.resolve([eventFixture('退出後的家庭行程', 'family')]);
      slowTasks.resolve([taskFixture('退出後的家庭待辦', 'family')]);
    });
    await flush();
    expect(titleCount('退出後的家庭行程')).toBe(0);
    expect(titleCount('退出後的家庭待辦')).toBe(0);
    expect(titleCount('個人待辦')).toBeGreaterThan(0);
  });
});

describe('Issue #8 <App /> task CRUD against the API', () => {
  it('creates (undated + dated), toggles completion and deletes tasks through /api/tasks', async () => {
    const api = installFakeApi('sess_alice');
    api.data.set('tasks:sess_alice:personal', [
      taskFixture('既有待辦', 'personal', { ownerUserId: 'usr_alice', dueDate: null }),
    ]);
    render(<App />);
    fireEvent.click(await screen.findByTestId('right-tab-tasks'));
    await waitFor(() => expect(titleCount('既有待辦')).toBeGreaterThan(0));

    // create undated task
    fireEvent.click(screen.getByTestId('task-open-create-btn'));
    fireEvent.change(screen.getByTestId('task-form-title-input'), { target: { value: '無日期新待辦' } });
    fireEvent.click(screen.getByTestId('task-form-submit-btn'));
    await waitFor(() => expect(titleCount('無日期新待辦')).toBeGreaterThan(0));
    const post1 = api.taskMutations.find((m) => m.method === 'POST')!;
    expect(post1.body).toMatchObject({ scope: 'personal', title: '無日期新待辦', dueDate: null });

    // create dated task
    fireEvent.click(screen.getByTestId('task-open-create-btn'));
    fireEvent.change(screen.getByTestId('task-form-title-input'), { target: { value: '有日期新待辦' } });
    fireEvent.change(screen.getByTestId('task-form-due-date-input'), { target: { value: TODAY } });
    fireEvent.click(screen.getByTestId('task-form-submit-btn'));
    await waitFor(() => expect(titleCount('有日期新待辦')).toBeGreaterThan(0));
    const posts = api.taskMutations.filter((m) => m.method === 'POST');
    expect(posts[1]!.body).toMatchObject({ title: '有日期新待辦', dueDate: TODAY });

    // illegal date never reaches the API
    fireEvent.click(screen.getByTestId('task-open-create-btn'));
    fireEvent.change(screen.getByTestId('task-form-title-input'), { target: { value: '壞日期待辦' } });
    fireEvent.change(screen.getByTestId('task-form-due-date-input'), { target: { value: '2026-02-30' } });
    fireEvent.click(screen.getByTestId('task-form-submit-btn'));
    await screen.findByTestId('task-form-error');
    expect(api.taskMutations.filter((m) => m.method === 'POST')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('task-form-cancel-btn'));

    // toggle completion -> PATCH { completed: true }
    fireEvent.click(screen.getByTestId('task-toggle-task_既有待辦'));
    await waitFor(() =>
      expect(screen.getByTestId('task-item-task_既有待辦').getAttribute('data-completed')).toBe('true'),
    );
    const patch = api.taskMutations.find((m) => m.method === 'PATCH')!;
    expect(decodeURIComponent(patch.path)).toBe('/api/tasks/task_既有待辦');
    expect(patch.body).toEqual({ completed: true });

    // delete
    fireEvent.click(screen.getByTestId('task-delete-task_既有待辦'));
    await waitFor(() => expect(screen.queryByTestId('task-item-task_既有待辦')).toBeNull());
    expect(api.taskMutations.some((m) => m.method === 'DELETE')).toBe(true);
  });

  it('shows a task API load error without crashing and keeps events working', async () => {
    const api = installFakeApi('sess_alice');
    api.data.set('events:sess_alice:personal', [
      eventFixture('正常行程', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    const original = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input.toString();
        if (u.includes('/api/tasks')) {
          return json({ message: '待辦服務暫時不可用' }, 500);
        }
        return original(input, init);
      }),
    );
    render(<App />);
    await waitFor(() => expect(titleCount('正常行程')).toBeGreaterThan(0));
    expect((await screen.findByTestId('summary-tasks-api-error')).textContent).toContain('待辦服務暫時不可用');
  });

  it('Issue #31 & #9: space switch immediately aborts in-flight requests and clears data synchronously outside state updater', async () => {
    const api = installFakeApi('sess_alice');
    api.data.set('events:sess_alice:personal', [
      eventFixture('Alice 個人事件', 'personal', { ownerUserId: 'usr_alice' }),
    ]);
    api.data.set('tasks:sess_alice:personal', [
      taskFixture('Alice 個人待辦', 'personal', { ownerUserId: 'usr_alice' }),
    ]);

    render(<App />);
    await waitFor(() => expect(titleCount('Alice 個人事件')).toBeGreaterThan(0));
    expect(titleCount('Alice 個人待辦')).toBeGreaterThan(0);

    // Park family events so family space load stays in-flight
    const familyGate = deferred<unknown[]>();
    api.parked.set('events:sess_alice:family', { gate: familyGate, honorAbort: true });

    // Switch to family space
    fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));

    // Synchronously, personal events and tasks are cleared immediately upon space switch
    expect(titleCount('Alice 個人事件')).toBe(0);
    expect(titleCount('Alice 個人待辦')).toBe(0);

    // Release gate
    familyGate.resolve([]);
  });

  it('Issue #9 <App /> chat CRUD: loads mood messages, posts message with emoji and deletes through API', async () => {
    const api = installFakeApi('sess_alice');
    api.chatStore = [
      {
        id: 'msg_existing',
        roomId: 'room_personal',
        roomKind: 'personal',
        familyId: null,
        senderUserId: 'usr_alice',
        senderDisplayName: '愛麗絲',
        body: '既有心情筆記 ✨',
        localDate: TODAY,
        recordDate: null,
        createdAt: NOW,
        updatedAt: NOW,
        derivedTasks: [],
        derivedEvents: [],
        derivedCount: 0,
      },
    ];

    api.data.set('events:sess_alice:personal', [
      eventFixture('Alice 既有行程', 'personal', { ownerUserId: 'usr_alice' }),
    ]);

    render(<App />);
    await waitFor(() => expect(titleCount('Alice 既有行程')).toBeGreaterThan(0));

    // Switch to mood tab
    fireEvent.click(screen.getByTestId('right-tab-mood'));
    await waitFor(() => expect(screen.getByText('既有心情筆記 ✨')).toBeTruthy());

    // Post a new message
    fireEvent.change(screen.getByTestId('chat-message-input'), {
      target: { value: '今日進度大超前 🚀' },
    });
    fireEvent.click(screen.getByTestId('emoji-btn-🎉'));
    fireEvent.click(screen.getByTestId('chat-send-button'));

    await waitFor(() => expect(screen.getByText('今日進度大超前 🚀🎉')).toBeTruthy());
    expect(api.chatMutations.some((m) => m.method === 'POST')).toBe(true);

    // Delete existing message
    fireEvent.click(screen.getByTestId('delete-message-msg_existing'));
    await waitFor(() => expect(screen.queryByText('既有心情筆記 ✨')).toBeNull());
    expect(api.chatMutations.some((m) => m.method === 'DELETE')).toBe(true);
  });
  it('PR #32 Review Blocking 1: mood ↔ family chat tab switch within family space immediately clears previous room messages before next fetch resolves', async () => {
    const api = installFakeApi('sess_alice');

    const personalMsg = {
      id: 'msg_personal_secret',
      roomId: 'room_personal',
      roomKind: 'personal',
      familyId: null,
      senderUserId: 'usr_alice',
      senderDisplayName: '愛麗絲',
      body: 'Alice 私人心情小祕密 🤫',
      localDate: TODAY,
      recordDate: null,
      createdAt: NOW,
      updatedAt: NOW,
      derivedTasks: [],
      derivedEvents: [],
      derivedCount: 0,
    };

    const familyMsg = {
      id: 'msg_family_announcement',
      roomId: 'room_fam_01',
      roomKind: 'family',
      familyId: 'fam_01',
      senderUserId: 'usr_alice',
      senderDisplayName: '愛麗絲',
      body: '陳家全體家庭公告 📢',
      localDate: TODAY,
      recordDate: null,
      createdAt: NOW,
      updatedAt: NOW,
      derivedTasks: [],
      derivedEvents: [],
      derivedCount: 0,
    };

    api.chatData.set('room_personal', [personalMsg]);

    // Park the family chat message response on a deferred gate
    const familyChatGate = deferred<unknown[]>();
    api.parkedChat.set('room_fam_01', { gate: familyChatGate, honorAbort: true });

    render(<App />);
    const famBtn = await screen.findByTestId('space-switch-family-fam_01');
    fireEvent.click(famBtn);

    // Switch to mood tab in family space
    fireEvent.click(screen.getByTestId('right-tab-mood'));
    await waitFor(() => expect(screen.getByText('Alice 私人心情小祕密 🤫')).toBeTruthy());

    // Switch from mood tab to family chat tab within the SAME family space
    fireEvent.click(screen.getByTestId('right-tab-chat'));

    // SYNCHRONOUS ASSERTION: Personal mood message must vanish IMMEDIATELY before family fetch resolves
    expect(screen.queryByText('Alice 私人心情小祕密 🤫')).toBeNull();
    // Family message is not visible yet because familyChatGate is still pending
    expect(screen.queryByText('陳家全體家庭公告 📢')).toBeNull();

    // Now resolve family chat gate
    familyChatGate.resolve([familyMsg]);
    await waitFor(() => expect(screen.getByText('陳家全體家庭公告 📢')).toBeTruthy());

    // Personal message remains absent in family chat
    expect(screen.queryByText('Alice 私人心情小祕密 🤫')).toBeNull();
  });

  it('PR #32 Review Blocking 1: delayed / out-of-order room responses (including ignored abort) never leak across mood and family chat', async () => {
    const api = installFakeApi('sess_alice');

    const personalMsg = {
      id: 'msg_personal_1',
      roomId: 'room_personal',
      roomKind: 'personal',
      familyId: null,
      senderUserId: 'usr_alice',
      senderDisplayName: '愛麗絲',
      body: '慢速心情回應 🐢',
      localDate: TODAY,
      recordDate: null,
      createdAt: NOW,
      updatedAt: NOW,
      derivedTasks: [],
      derivedEvents: [],
      derivedCount: 0,
    };

    const familyMsg = {
      id: 'msg_family_1',
      roomId: 'room_fam_01',
      roomKind: 'family',
      familyId: 'fam_01',
      senderUserId: 'usr_alice',
      senderDisplayName: '愛麗絲',
      body: '快速家庭公告 🚀',
      localDate: TODAY,
      recordDate: null,
      createdAt: NOW,
      updatedAt: NOW,
      derivedTasks: [],
      derivedEvents: [],
      derivedCount: 0,
    };

    // Park personal room response with honorAbort: false (ignores AbortSignal, mimics delayed stale fetch)
    const slowMoodGate = deferred<unknown[]>();
    api.parkedChat.set('room_personal', { gate: slowMoodGate, honorAbort: false });
    api.chatData.set('room_fam_01', [familyMsg]);

    render(<App />);
    const famBtn = await screen.findByTestId('space-switch-family-fam_01');
    fireEvent.click(famBtn);

    // Click mood (fires slowMoodGate)
    fireEvent.click(screen.getByTestId('right-tab-mood'));

    // Quickly switch to family chat before mood resolves
    fireEvent.click(screen.getByTestId('right-tab-chat'));
    await waitFor(() => expect(screen.getByText('快速家庭公告 🚀')).toBeTruthy());

    // Now release the slow mood response which was aborted but ignored signal
    slowMoodGate.resolve([personalMsg]);
    await new Promise((r) => setTimeout(r, 60));

    // Stale mood message must NEVER overwrite or leak into family chat!
    expect(screen.queryByText('慢速心情回應 🐢')).toBeNull();
    expect(screen.getByText('快速家庭公告 🚀')).toBeTruthy();
  });

  it('PR #32 Non-blocking 1: switching chat rooms resets unsent draft text and recordDate', async () => {
    const api = installFakeApi('sess_alice');
    api.chatStore = [];

    render(<App />);
    const famBtn = await screen.findByTestId('space-switch-family-fam_01');
    fireEvent.click(famBtn);

    // Open family chat tab
    fireEvent.click(screen.getByTestId('right-tab-chat'));

    // Type a draft in family chat
    const input = screen.getByTestId('chat-message-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '這是一則未發送的家庭草稿' } });
    const recordDateInput = screen.getByTestId('chat-record-date-input') as HTMLInputElement;
    fireEvent.change(recordDateInput, { target: { value: '2026-10-25' } });

    expect(input.value).toBe('這是一則未發送的家庭草稿');
    expect(recordDateInput.value).toBe('2026-10-25');

    // Switch to mood tab
    fireEvent.click(screen.getByTestId('right-tab-mood'));

    // Draft and recordDate must be cleared/isolated
    const moodInput = screen.getByTestId('chat-message-input') as HTMLInputElement;
    const moodRecordDateInput = screen.getByTestId('chat-record-date-input') as HTMLInputElement;
    expect(moodInput.value).toBe('');
    expect(moodRecordDateInput.value).toBe('');
  });

  it('Issue #10 & #28 <App />: clicking "查看來源聊天" jumps to source message, synchronizes space and highlightedSourceMessageId, and renders focused chat timeline', async () => {
    const api = installFakeApi('sess_alice');
    const scrollMock = vi.fn();
    Element.prototype.scrollIntoView = scrollMock;

    const sourceMsgId = 'msg_source_e2e';
    const sourceMsg = {
      id: sourceMsgId,
      roomId: 'room_personal',
      roomKind: 'personal',
      familyId: null,
      senderUserId: 'usr_alice',
      senderDisplayName: '愛麗絲',
      body: '來源生活筆記：預約牙醫門診 🦷',
      localDate: '2026-10-25',
      recordDate: null,
      createdAt: '2026-10-25T09:00:00.000Z',
      updatedAt: '2026-10-25T09:00:00.000Z',
      derivedTasks: [],
      derivedEvents: [],
      derivedCount: 1,
    };

    api.chatStore = [sourceMsg];

    // Seed personal event derived from sourceMsg
    const dentistEvent = {
      id: 'ev_dentist',
      calendarId: 'cal_personal',
      scope: 'personal' as const,
      ownerUserId: 'usr_alice',
      familyId: null,
      title: '看牙醫 🦷',
      description: null,
      startsAt: TODAY,
      endsAt: TODAY,
      allDay: true,
      timezone: 'Asia/Taipei',
      sourceMessageId: sourceMsgId,
      sourceStatus: 'accessible' as const,
      sourceMessage: {
        id: sourceMsgId,
        roomId: 'room_personal',
        roomKind: 'personal' as const,
        familyId: null,
        senderUserId: 'usr_alice',
        senderDisplayName: '愛麗絲',
        body: '來源生活筆記：預約牙醫門診 🦷',
        localDate: TODAY,
        recordDate: null,
        createdAt: NOW,
      },
      createdBy: 'usr_alice',
      createdAt: NOW,
      updatedAt: NOW,
    };
    api.data.set('events:sess_alice:personal', [dentistEvent]);

    render(<App />);

    // Wait for event bar to appear on calendar
    const eventBar = await screen.findByTestId(`calendar-cell-event-${TODAY}-ev_dentist`);
    fireEvent.click(eventBar);

    // Event Detail inspector is opened
    expect(await screen.findByTestId('event-detail-panel')).toBeTruthy();

    // Click "查看來源聊天" button
    const jumpBtn = screen.getByTestId('event-detail-jump-source-btn');
    expect(jumpBtn).toBeTruthy();
    fireEvent.click(jumpBtn);

    // Should switch to mood tab and locate source message
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel-source-message-locator')).toBeTruthy();
      expect(screen.getByTestId(`chat-message-${sourceMsgId}`)).toBeTruthy();
    });

    const msgEl = screen.getByTestId(`chat-message-${sourceMsgId}`);
    expect(msgEl.getAttribute('data-highlighted')).toBe('true');
    await waitFor(() => {
      expect(scrollMock).toHaveBeenCalled();
    });
  });


  it('PR #33 Review Blocking 1: stable chat tab does NOT repeatedly fetch on rerenders and polling triggers only on timer', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const api = installFakeApi('sess_alice');
      api.chatStore = [
        {
          id: 'msg_stable_1',
          roomId: 'room_personal',
          roomKind: 'personal',
          familyId: null,
          senderUserId: 'usr_alice',
          senderDisplayName: '愛麗絲',
          body: '穩定測試訊息',
          localDate: TODAY,
          recordDate: null,
          createdAt: NOW,
          updatedAt: NOW,
          derivedTasks: [],
          derivedEvents: [],
          derivedCount: 0,
        },
      ];

      render(<App />);

      // Switch to mood tab
      fireEvent.click(screen.getByTestId('right-tab-mood'));
      expect(await screen.findByText('穩定測試訊息')).toBeTruthy();

      const initialFetchCalls = api.calls.filter(
        (c) => c.method === 'GET' && c.path === '/api/chat-rooms/room_personal/messages',
      );
      expect(initialFetchCalls.length).toBe(1);

      // Type in input multiple times (causing multiple App/ChatPanel rerenders)
      const input = screen.getByTestId('chat-message-input');
      fireEvent.change(input, { target: { value: '哈' } });
      fireEvent.change(input, { target: { value: '哈哈' } });
      fireEvent.change(input, { target: { value: '哈哈哈' } });

      // Ensure no repeated chat fetch was triggered by typing / rerenders!
      const afterTypingCalls = api.calls.filter(
        (c) => c.method === 'GET' && c.path === '/api/chat-rooms/room_personal/messages',
      );
      expect(afterTypingCalls.length).toBe(1);

      // Now advance timer by 10s -> Polling triggers
      await vi.advanceTimersByTimeAsync(10000);

      const afterPollCalls = api.calls.filter(
        (c) => c.method === 'GET' && c.path === '/api/chat-rooms/room_personal/messages',
      );
      expect(afterPollCalls.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('PR #33 Review Blocking 2: background polling preserves expanded paginated timeline and merges new messages without resetting', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const api = installFakeApi('sess_alice');

      const msgNewest = {
        id: 'msg_p_newest',
        roomId: 'room_personal',
        roomKind: 'personal',
        familyId: null,
        senderUserId: 'usr_alice',
        senderDisplayName: '愛麗絲',
        body: '最新訊息（首頁）',
        localDate: TODAY,
        recordDate: null,
        createdAt: '2026-10-30T10:00:00.000Z',
        updatedAt: '2026-10-30T10:00:00.000Z',
        derivedTasks: [],
        derivedEvents: [],
        derivedCount: 0,
      };

      const msgOlder = {
        id: 'msg_p_older',
        roomId: 'room_personal',
        roomKind: 'personal',
        familyId: null,
        senderUserId: 'usr_alice',
        senderDisplayName: '愛麗絲',
        body: '更早的歷史訊息 📜',
        localDate: TODAY,
        recordDate: null,
        createdAt: '2026-10-30T08:00:00.000Z',
        updatedAt: '2026-10-30T08:00:00.000Z',
        derivedTasks: [],
        derivedEvents: [],
        derivedCount: 0,
      };

      // Initial page has hasMoreBefore: true
      api.chatData.set('room_personal', {
        messages: [msgNewest],
        hasMoreBefore: true,
        hasMoreAfter: false,
        startCursor: msgNewest.id,
        endCursor: msgNewest.id,
      });

      // Older page when "before=msg_p_newest"
      api.chatData.set('before:msg_p_newest', {
        messages: [msgOlder],
        hasMoreBefore: false,
        hasMoreAfter: true,
        startCursor: msgOlder.id,
        endCursor: msgOlder.id,
      });

      render(<App />);

      // Switch to mood tab
      fireEvent.click(screen.getByTestId('right-tab-mood'));
      expect(await screen.findByText('最新訊息（首頁）')).toBeTruthy();

      // Click "載入更早訊息"
      const earlierBtn = await screen.findByTestId('chat-load-earlier-button');
      fireEvent.click(earlierBtn);

      // Now both messages are present in expanded timeline
      expect(await screen.findByText('更早的歷史訊息 📜')).toBeTruthy();
      expect(screen.getByText('最新訊息（首頁）')).toBeTruthy();

      // Configure newly incoming message for polling after endCursor
      const msgPolled = {
        id: 'msg_p_polled',
        roomId: 'room_personal',
        roomKind: 'personal',
        familyId: null,
        senderUserId: 'usr_alice',
        senderDisplayName: '愛麗絲',
        body: '後台輪詢抓到的最新推播 🔔',
        localDate: TODAY,
        recordDate: null,
        createdAt: '2026-10-30T11:00:00.000Z',
        updatedAt: '2026-10-30T11:00:00.000Z',
        derivedTasks: [],
        derivedEvents: [],
        derivedCount: 0,
      };
      api.chatData.set(`after:${msgNewest.id}`, {
        messages: [msgPolled],
        hasMoreBefore: false,
        hasMoreAfter: false,
        startCursor: msgPolled.id,
        endCursor: msgPolled.id,
      });

      // Advance timer by 10s to trigger background polling
      await vi.advanceTimersByTimeAsync(10000);

      // Crucial verification: The expanded older history must NOT be collapsed or wiped!
      expect(await screen.findByText('後台輪詢抓到的最新推播 🔔')).toBeTruthy();
      expect(screen.getByText('更早的歷史訊息 📜')).toBeTruthy();
      expect(screen.getByText('最新訊息（首頁）')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('PR #33 Review Non-blocking 1: missing/deleted source message displays fallback alert and clears stale highlightedSourceMessageId', async () => {
    const api = installFakeApi('sess_alice');
    api.chatData.set('room_personal', {
      messages: [],
      hasMoreBefore: false,
      hasMoreAfter: false,
      startCursor: null,
      endCursor: null,
      targetMessageFound: false,
    });

    const deletedSourceEv = {
      id: 'ev_deleted_src',
      calendarId: 'cal_personal',
      scope: 'personal' as const,
      ownerUserId: 'usr_alice',
      familyId: null,
      title: '已刪來源行程',
      description: null,
      startsAt: TODAY,
      endsAt: TODAY,
      allDay: true,
      timezone: 'Asia/Taipei',
      sourceMessageId: 'msg_nonexistent_999',
      sourceStatus: 'accessible' as const,
      sourceMessage: {
        id: 'msg_nonexistent_999',
        roomId: 'room_personal',
        roomKind: 'personal' as const,
        familyId: null,
        senderUserId: 'usr_alice',
        senderDisplayName: '愛麗絲',
        body: '假裝可存取的來源訊息',
        localDate: TODAY,
        recordDate: null,
        createdAt: NOW,
      },
      createdBy: 'usr_alice',
      createdAt: NOW,
      updatedAt: NOW,
    };
    api.data.set('events:sess_alice:personal', [deletedSourceEv]);

    render(<App />);

    const evBar = await screen.findByTestId(`calendar-cell-event-${TODAY}-ev_deleted_src`);
    fireEvent.click(evBar);

    expect(await screen.findByTestId('event-detail-panel')).toBeTruthy();
    const jumpBtn = screen.getByTestId('event-detail-jump-source-btn');
    fireEvent.click(jumpBtn);

    // Shows fallback alert banner gracefully without crash
    expect(await screen.findByTestId('chat-source-missing-alert')).toBeTruthy();
    expect(screen.getByTestId('chat-source-missing-alert').textContent).toContain('來源訊息已遭移除、不存在或無存取權限');
  });


  it('Issue #11 <App />: clicking "查看來源聊天" on a task jumps to source message, switches to mood room, and focuses locator', async () => {
    const api = installFakeApi('sess_alice');
    const scrollMock = vi.fn();
    Element.prototype.scrollIntoView = scrollMock;

    const sourceMsgId = 'msg_src_task_e2e';
    const sourceMsg = {
      id: sourceMsgId,
      roomId: 'room_personal',
      roomKind: 'personal' as const,
      familyId: null,
      senderUserId: 'usr_alice',
      senderDisplayName: '愛麗絲',
      body: '生活筆記：記得繳電費 ⚡',
      localDate: '2026-10-26',
      recordDate: null,
      createdAt: '2026-10-26T08:00:00.000Z',
      updatedAt: '2026-10-26T08:00:00.000Z',
      derivedTasks: [],
      derivedEvents: [],
      derivedCount: 1,
    };
    api.chatStore = [sourceMsg];

    const electricTask = {
      id: 'task_electric',
      listId: 'list_personal',
      scope: 'personal' as const,
      ownerUserId: 'usr_alice',
      familyId: null,
      title: '繳電費 ⚡',
      dueDate: TODAY,
      completedAt: null,
      sourceMessageId: sourceMsgId,
      sourceStatus: 'accessible' as const,
      sourceMessage: {
        id: sourceMsgId,
        roomId: 'room_personal',
        roomKind: 'personal' as const,
        familyId: null,
        localDate: '2026-10-26',
        body: '生活筆記：記得繳電費 ⚡',
      },
      createdBy: 'usr_alice',
      createdAt: NOW,
      updatedAt: NOW,
    };
    api.data.set('tasks:sess_alice:personal', [electricTask]);

    render(<App />);

    // Go to tasks tab
    fireEvent.click(await screen.findByTestId('right-tab-tasks'));
    expect(await screen.findByTestId('task-source-task_electric')).toBeTruthy();

    // Click "查看來源聊天 ➔"
    const jumpBtn = screen.getByTestId('task-jump-source-task_electric');
    fireEvent.click(jumpBtn);

    // Navigates to mood tab, sets date to 2026-10-26 and locates source message
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel-source-message-locator')).toBeTruthy();
      expect(screen.getByTestId(`chat-message-${sourceMsgId}`)).toBeTruthy();
    });

    const msgEl = screen.getByTestId(`chat-message-${sourceMsgId}`);
    expect(msgEl.getAttribute('data-highlighted')).toBe('true');
  });

  it('Issue #11 <App />: converts a message to a task via modal, updates derived badge immediately, and badge click navigates to task', async () => {
    const api = installFakeApi('sess_alice');

    const sourceMsgId = 'msg_convert_app_test';
    const sourceMsg = {
      id: sourceMsgId,
      roomId: 'room_personal',
      roomKind: 'personal' as const,
      familyId: null,
      senderUserId: 'usr_alice',
      senderDisplayName: '愛麗絲',
      body: '待辦提醒：寄送週報與請款單',
      localDate: TODAY,
      recordDate: null,
      createdAt: NOW,
      updatedAt: NOW,
      derivedTasks: [],
      derivedEvents: [],
      derivedCount: 0,
    };
    api.chatStore = [sourceMsg];

    render(<App />);

    // Go to mood tab
    fireEvent.click(await screen.findByTestId('right-tab-mood'));
    expect(await screen.findByTestId(`chat-message-${sourceMsgId}`)).toBeTruthy();

    // Click "+ 待辦"
    fireEvent.click(screen.getByTestId(`chat-convert-task-button-${sourceMsgId}`));

    // Verify modal is open and prefilled
    expect(screen.getByTestId('chat-convert-modal')).toBeTruthy();
    expect((screen.getByTestId('convert-title-input') as HTMLInputElement).value).toBe('待辦提醒：寄送週報與請款單');

    // Submit convert form
    fireEvent.click(screen.getByTestId('convert-submit-button'));

    // Modal closes
    await waitFor(() => {
      expect(screen.queryByTestId('chat-convert-modal')).toBeNull();
    });

    // Badge appears on message card!
    await waitFor(() => {
      expect(screen.getByText(/✓ 待辦：待辦提醒：寄送週報與請款單/)).toBeTruthy();
    });

    // Click derived task badge to navigate to tasks tab
    const badge = screen.getByText(/✓ 待辦：待辦提醒：寄送週報與請款單/);
    fireEvent.click(badge);

    // Navigates to tasks tab
    await waitFor(() => {
      expect(screen.getByTestId('right-tab-tasks').getAttribute('aria-selected')).toBe('true');
    });
  });
});
