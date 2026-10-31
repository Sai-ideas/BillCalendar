import { describe, expect, it } from 'vitest';
import { createApp } from './index';
import {
  MessageWithAuthorizedDerivedSchema,
  TaskDetailSchema,
  TestIdentityStateResponseSchema,
} from '../shared';
import { createMigratedSqliteD1 } from './test-utils/sqlite-d1';

/**
 * Issue #8 — personal / family tasks: CRUD, pure due_date rules (Review D4),
 * completed_at persistence, space isolation and source_message_id behaviour (Review A1).
 */
describe('Issue #8 Tasks API', () => {
  function setup() {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const env = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    async function login(name: string) {
      const res = await app.request(
        '/api/test-identity/select',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: `${name}.tasks@billcalendar.test`, displayName: name }),
        },
        env,
      );
      const state = TestIdentityStateResponseSchema.parse(await res.json());
      return { session: state.sessionId!, userId: state.currentUser!.id, email: `${name}.tasks@billcalendar.test` };
    }

    async function call(session: string, path: string, init: { method?: string; body?: unknown } = {}) {
      return app.request(
        path,
        {
          method: init.method ?? 'GET',
          headers: {
            'X-Test-Session-Id': session,
            ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        },
        env,
      );
    }

    async function createFamily(admin: { session: string }, member: { session: string; email: string }) {
      const fam = (await (await call(admin.session, '/api/families', { method: 'POST', body: { name: '任務家庭' } })).json()) as {
        id: string;
      };
      const invite = (await (
        await call(admin.session, `/api/families/${fam.id}/invitations`, {
          method: 'POST',
          body: { email: member.email, role: 'member' },
        })
      ).json()) as { id: string };
      const accepted = await call(member.session, `/api/invitations/${invite.id}/accept`, { method: 'POST' });
      expect(accepted.status).toBe(200);
      return fam.id;
    }

    return { app, env, login, call, createFamily };
  }

  it('creates tasks without a due date (null) and with a due date, and lists them', async () => {
    const { login, call } = setup();
    const alice = await login('alice');

    const undatedRes = await call(alice.session, '/api/tasks', { method: 'POST', body: { title: '無日期待辦' } });
    expect(undatedRes.status).toBe(201);
    const undated = TaskDetailSchema.parse(await undatedRes.json());
    expect(undated.dueDate).toBeNull();
    expect(undated.completedAt).toBeNull();
    expect(undated.sourceStatus).toBe('none');

    const explicitNull = await call(alice.session, '/api/tasks', {
      method: 'POST',
      body: { title: '明確 null', dueDate: null },
    });
    expect(explicitNull.status).toBe(201);
    expect(TaskDetailSchema.parse(await explicitNull.json()).dueDate).toBeNull();

    const datedRes = await call(alice.session, '/api/tasks', {
      method: 'POST',
      body: { title: '有日期待辦', dueDate: '2028-02-29' },
    });
    expect(datedRes.status).toBe(201);
    expect(TaskDetailSchema.parse(await datedRes.json()).dueDate).toBe('2028-02-29');

    const list = (await (await call(alice.session, '/api/tasks?scope=personal')).json()) as Array<{ title: string; dueDate: string | null }>;
    expect(list.map((t) => [t.title, t.dueDate])).toEqual([
      ['無日期待辦', null],
      ['明確 null', null],
      ['有日期待辦', '2028-02-29'],
    ]);
  });

  it('rejects illegal due dates on create and update, and never stores them', async () => {
    const { login, call } = setup();
    const alice = await login('alice');

    for (const bad of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026/10/01', '2026-10-1', '20261001', '2026-10-01T00:00:00Z', '', 20261001]) {
      const res = await call(alice.session, '/api/tasks', { method: 'POST', body: { title: 'x', dueDate: bad } });
      expect(res.status, `create dueDate=${JSON.stringify(bad)}`).toBe(400);
    }
    expect(((await (await call(alice.session, '/api/tasks')).json()) as unknown[]).length).toBe(0);

    const ok = TaskDetailSchema.parse(
      await (await call(alice.session, '/api/tasks', { method: 'POST', body: { title: '好', dueDate: '2026-10-31' } })).json(),
    );
    for (const bad of ['2026-02-30', '2026-10-32', 'tomorrow']) {
      const res = await call(alice.session, `/api/tasks/${ok.id}`, { method: 'PATCH', body: { dueDate: bad } });
      expect(res.status, `patch dueDate=${bad}`).toBe(400);
    }
    const after = TaskDetailSchema.parse(await (await call(alice.session, `/api/tasks/${ok.id}`)).json());
    expect(after.dueDate).toBe('2026-10-31');
    expect((await call(alice.session, `/api/tasks/${ok.id}`, { method: 'PATCH', body: {} })).status).toBe(400);
    expect((await call(alice.session, `/api/tasks/${ok.id}`, { method: 'PATCH', body: { title: '   ' } })).status).toBe(400);
  });

  it('stores the due_date as a pure date (no timezone shifting) and allows setting / clearing it via PATCH', async () => {
    const { login, call } = setup();
    const alice = await login('alice');
    const created = TaskDetailSchema.parse(
      await (await call(alice.session, '/api/tasks', { method: 'POST', body: { title: '跨年待辦', dueDate: '2026-12-31' } })).json(),
    );
    expect(created.dueDate).toBe('2026-12-31');

    const moved = TaskDetailSchema.parse(
      await (await call(alice.session, `/api/tasks/${created.id}`, { method: 'PATCH', body: { dueDate: '2027-01-01', title: '改期' } })).json(),
    );
    expect(moved.dueDate).toBe('2027-01-01');
    expect(moved.title).toBe('改期');

    const cleared = TaskDetailSchema.parse(
      await (await call(alice.session, `/api/tasks/${created.id}`, { method: 'PATCH', body: { dueDate: null } })).json(),
    );
    expect(cleared.dueDate).toBeNull();
    expect(cleared.title).toBe('改期');
  });

  it('persists completed_at: complete is idempotent, uncomplete clears it, and unrelated edits keep it', async () => {
    const { login, call } = setup();
    const alice = await login('alice');
    const created = TaskDetailSchema.parse(
      await (await call(alice.session, '/api/tasks', { method: 'POST', body: { title: '完成狀態' } })).json(),
    );

    const done = TaskDetailSchema.parse(
      await (await call(alice.session, `/api/tasks/${created.id}`, { method: 'PATCH', body: { completed: true } })).json(),
    );
    expect(done.completedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(done.completedAt!))).toBe(false);

    const reloaded = TaskDetailSchema.parse(await (await call(alice.session, `/api/tasks/${created.id}`)).json());
    expect(reloaded.completedAt).toBe(done.completedAt);

    const again = TaskDetailSchema.parse(
      await (await call(alice.session, `/api/tasks/${created.id}`, { method: 'PATCH', body: { completed: true } })).json(),
    );
    expect(again.completedAt).toBe(done.completedAt);

    const renamed = TaskDetailSchema.parse(
      await (await call(alice.session, `/api/tasks/${created.id}`, { method: 'PATCH', body: { title: '改名' } })).json(),
    );
    expect(renamed.completedAt).toBe(done.completedAt);

    const undone = TaskDetailSchema.parse(
      await (await call(alice.session, `/api/tasks/${created.id}`, { method: 'PATCH', body: { completed: false } })).json(),
    );
    expect(undone.completedAt).toBeNull();
    const list = (await (await call(alice.session, '/api/tasks')).json()) as Array<{ completedAt: string | null }>;
    expect(list[0]!.completedAt).toBeNull();
  });

  it('deletes tasks and returns 404 afterwards', async () => {
    const { login, call } = setup();
    const alice = await login('alice');
    const t = TaskDetailSchema.parse(
      await (await call(alice.session, '/api/tasks', { method: 'POST', body: { title: '待刪' } })).json(),
    );
    expect((await call(alice.session, `/api/tasks/${t.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(alice.session, `/api/tasks/${t.id}`)).status).toBe(404);
    expect((await call(alice.session, `/api/tasks/${t.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('isolates personal tasks per user and family tasks per membership', async () => {
    const { login, call, createFamily } = setup();
    const alice = await login('alice');
    const bob = await login('bob');
    const charlie = await login('charlie');
    const familyId = await createFamily(alice, bob);

    const alicePersonal = TaskDetailSchema.parse(
      await (await call(alice.session, '/api/tasks', { method: 'POST', body: { title: 'Alice 私人' } })).json(),
    );
    const familyTask = TaskDetailSchema.parse(
      await (
        await call(alice.session, '/api/tasks', {
          method: 'POST',
          body: { scope: 'family', familyId, title: '家庭共享', dueDate: '2026-11-01' },
        })
      ).json(),
    );
    expect(familyTask.scope).toBe('family');
    expect(familyTask.familyId).toBe(familyId);
    expect(familyTask.ownerUserId).toBeNull();

    // Bob (member) sees the family task, can complete & edit it, but not Alice's personal one
    const bobFamily = (await (await call(bob.session, `/api/tasks?scope=family&familyId=${familyId}`)).json()) as Array<{ id: string }>;
    expect(bobFamily.map((t) => t.id)).toEqual([familyTask.id]);
    expect(((await (await call(bob.session, '/api/tasks?scope=personal')).json()) as unknown[]).length).toBe(0);
    expect((await call(bob.session, `/api/tasks/${alicePersonal.id}`)).status).toBe(404);
    expect((await call(bob.session, `/api/tasks/${alicePersonal.id}`, { method: 'PATCH', body: { completed: true } })).status).toBe(404);
    expect((await call(bob.session, `/api/tasks/${alicePersonal.id}`, { method: 'DELETE' })).status).toBe(404);
    const bobToggle = await call(bob.session, `/api/tasks/${familyTask.id}`, { method: 'PATCH', body: { completed: true } });
    expect(bobToggle.status).toBe(200);
    expect(TaskDetailSchema.parse(await bobToggle.json()).completedAt).not.toBeNull();

    // Charlie (non-member) gets nothing
    expect((await call(charlie.session, `/api/tasks?scope=family&familyId=${familyId}`)).status).toBe(403);
    expect(
      (await call(charlie.session, '/api/tasks', { method: 'POST', body: { scope: 'family', familyId, title: '入侵' } })).status,
    ).toBe(403);
    expect((await call(charlie.session, `/api/tasks/${familyTask.id}`)).status).toBe(404);
    expect((await call(charlie.session, `/api/tasks/${familyTask.id}`, { method: 'PATCH', body: { title: 'x' } })).status).toBe(404);
    expect((await call(charlie.session, `/api/tasks/${familyTask.id}`, { method: 'DELETE' })).status).toBe(404);

    // cross-user query / body override attempts are rejected
    expect((await call(bob.session, `/api/tasks?ownerUserId=${alice.userId}`)).status).toBe(403);
    expect((await call(bob.session, `/api/tasks?userId=${alice.userId}`)).status).toBe(403);
    expect(
      (await call(bob.session, '/api/tasks', { method: 'POST', body: { title: 'x', ownerUserId: alice.userId } })).status,
    ).toBe(403);

    // after Bob leaves, family access is revoked immediately
    expect((await call(bob.session, `/api/families/${familyId}/leave`, { method: 'POST' })).status).toBe(200);
    expect((await call(bob.session, `/api/tasks?scope=family&familyId=${familyId}`)).status).toBe(403);
    expect((await call(bob.session, `/api/tasks/${familyTask.id}`)).status).toBe(404);
  });

  it('validates list query scope parameters', async () => {
    const { login, call } = setup();
    const alice = await login('alice');
    expect((await call(alice.session, '/api/tasks?scope=bogus')).status).toBe(400);
    expect((await call(alice.session, '/api/tasks?scope=family')).status).toBe(400);
    expect((await call(alice.session, '/api/tasks?scope=personal&familyId=fam_x')).status).toBe(400);
    expect((await call(alice.session, '/api/tasks?scope=personal')).status).toBe(200);
  });

  it('supports tasks with a source message: dual-endpoint auth, source immutability and survival after soft-deletion', async () => {
    const { login, call, createFamily } = setup();
    const alice = await login('alice');
    const bob = await login('bob');
    const familyId = await createFamily(alice, bob);

    const aliceRooms = (await (await call(alice.session, '/api/chat-rooms?scope=personal')).json()) as Array<{ id: string }>;
    const personalMsg = MessageWithAuthorizedDerivedSchema.parse(
      await (
        await call(alice.session, `/api/chat-rooms/${aliceRooms[0]!.id}/messages`, {
          method: 'POST',
          body: { body: '記得繳電話費', localDate: '2026-10-30' },
        })
      ).json(),
    );
    const famRooms = (await (await call(alice.session, `/api/chat-rooms?familyId=${familyId}`)).json()) as Array<{ id: string }>;
    const familyMsg = MessageWithAuthorizedDerivedSchema.parse(
      await (
        await call(alice.session, `/api/chat-rooms/${famRooms[0]!.id}/messages`, {
          method: 'POST',
          body: { body: '週末大掃除', localDate: '2026-10-30' },
        })
      ).json(),
    );

    // A message may spawn several tasks; each task has at most one direct source
    const t1 = TaskDetailSchema.parse(
      await (await call(alice.session, '/api/tasks', { method: 'POST', body: { title: '繳費', sourceMessageId: personalMsg.id, dueDate: '2026-11-05' } })).json(),
    );
    const t2 = TaskDetailSchema.parse(
      await (await call(alice.session, '/api/tasks', { method: 'POST', body: { title: '再提醒一次', sourceMessageId: personalMsg.id } })).json(),
    );
    expect(t1.sourceStatus).toBe('accessible');
    expect(t1.sourceMessage?.id).toBe(personalMsg.id);
    expect(t1.sourceMessage?.roomKind).toBe('personal');
    expect(t2.sourceMessageId).toBe(personalMsg.id);

    // a personal task derived from a family message exposes the family room for cross-space jumping
    const cross = TaskDetailSchema.parse(
      await (await call(alice.session, '/api/tasks', { method: 'POST', body: { title: '個人打掃', sourceMessageId: familyMsg.id } })).json(),
    );
    expect(cross.scope).toBe('personal');
    expect(cross.sourceMessage?.roomKind).toBe('family');
    expect(cross.sourceMessage?.familyId).toBe(familyId);

    // Bob can never reference Alice's personal message, nor a nonexistent one
    const bobSteal = await call(bob.session, '/api/tasks', { method: 'POST', body: { title: '偷看', sourceMessageId: personalMsg.id } });
    expect(bobSteal.status).toBe(403);
    expect(JSON.stringify(await bobSteal.json())).not.toContain('記得繳電話費');
    expect((await call(bob.session, '/api/tasks', { method: 'POST', body: { title: '假', sourceMessageId: 'msg_nope' } })).status).toBe(403);

    // The source relation cannot be rewritten after creation
    expect((await call(alice.session, `/api/tasks/${t1.id}`, { method: 'PATCH', body: { sourceMessageId: null } })).status).toBe(403);
    expect((await call(alice.session, `/api/tasks/${t2.id}`, { method: 'PATCH', body: { sourceMessageId: familyMsg.id } })).status).toBe(403);

    // Editing / completing / deleting a task never touches the source message
    await call(alice.session, `/api/tasks/${t1.id}`, { method: 'PATCH', body: { completed: true, title: '已繳費' } });
    const msgAfterEdit = MessageWithAuthorizedDerivedSchema.parse(await (await call(alice.session, `/api/messages/${personalMsg.id}`)).json());
    expect(msgAfterEdit.body).toBe('記得繳電話費');
    expect(msgAfterEdit.derivedTasks.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());

    // Soft-deleting the source keeps the tasks and flips their status to 'deleted'
    expect((await call(alice.session, `/api/messages/${personalMsg.id}`, { method: 'DELETE' })).status).toBe(200);
    const afterDelete = TaskDetailSchema.parse(await (await call(alice.session, `/api/tasks/${t1.id}`)).json());
    expect(afterDelete.title).toBe('已繳費');
    expect(afterDelete.completedAt).not.toBeNull();
    expect(afterDelete.dueDate).toBe('2026-11-05');
    expect(afterDelete.sourceMessageId).toBe(personalMsg.id);
    expect(afterDelete.sourceStatus).toBe('deleted');
    expect(afterDelete.sourceMessage).toBeNull();

    // tasks whose source was deleted stay fully editable and listable
    const edited = await call(alice.session, `/api/tasks/${t2.id}`, { method: 'PATCH', body: { title: '仍可編輯', dueDate: '2026-11-06' } });
    expect(edited.status).toBe(200);
    const list = (await (await call(alice.session, '/api/tasks?scope=personal')).json()) as Array<{ id: string; sourceStatus: string }>;
    expect(list.find((t) => t.id === t2.id)?.sourceStatus).toBe('deleted');
    expect(list.find((t) => t.id === cross.id)?.sourceStatus).toBe('accessible');

    // a deleted source cannot be used for NEW tasks
    expect(
      (await call(alice.session, '/api/tasks', { method: 'POST', body: { title: '新來源已刪', sourceMessageId: personalMsg.id } })).status,
    ).toBe(403);
  });
});
