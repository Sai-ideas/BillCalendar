import { describe, expect, it } from 'vitest';
import { createApp } from './index';
import {
  AuthorizedSpaceOverviewSchema,
  DATA_OWNERSHIP_SECURITY_NOTICE,
  DiaryEntrySchema,
  EventDetailSchema,
  MessageWithAuthorizedDerivedSchema,
  TaskDetailSchema,
  TestIdentityStateResponseSchema,
} from '../shared';
import { createMigratedSqliteD1 } from './test-utils/sqlite-d1';

describe('Issue #4 Data Ownership and Authorization Middleware', () => {
  async function setupTestUsers(
    app: ReturnType<typeof createApp>,
    devEnv: Record<string, unknown>,
  ) {
    // Alice
    const resAlice = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice.demo@billcalendar.test',
          displayName: 'Alice (合成帳號 A)',
        }),
      },
      devEnv,
    );
    const aliceState = TestIdentityStateResponseSchema.parse(await resAlice.json());

    // Bob
    const resBob = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'bob.demo@billcalendar.test',
          displayName: 'Bob (合成帳號 B)',
        }),
      },
      devEnv,
    );
    const bobState = TestIdentityStateResponseSchema.parse(await resBob.json());

    // Charlie
    const resCharlie = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'charlie.demo@billcalendar.test',
          displayName: 'Charlie (合成帳號 C)',
        }),
      },
      devEnv,
    );
    const charlieState = TestIdentityStateResponseSchema.parse(await resCharlie.json());

    return {
      alice: {
        session: aliceState.sessionId!,
        userId: aliceState.currentUser!.id,
        email: 'alice.demo@billcalendar.test',
      },
      bob: {
        session: bobState.sessionId!,
        userId: bobState.currentUser!.id,
        email: 'bob.demo@billcalendar.test',
      },
      charlie: {
        session: charlieState.sessionId!,
        userId: charlieState.currentUser!.id,
        email: 'charlie.demo@billcalendar.test',
      },
    };
  }

  async function createSharedFamily(
    app: ReturnType<typeof createApp>,
    devEnv: Record<string, unknown>,
    adminSession: string,
    memberEmail: string,
    memberSession: string,
    name = '協作家庭空間',
  ) {
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': adminSession,
        },
        body: JSON.stringify({ name }),
      },
      devEnv,
    );
    expect(createRes.status).toBe(201);
    const family = (await createRes.json()) as { id: string };

    const inviteRes = await app.request(
      `/api/families/${family.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': adminSession,
        },
        body: JSON.stringify({ email: memberEmail, role: 'member' }),
      },
      devEnv,
    );
    expect(inviteRes.status).toBe(201);
    const invite = (await inviteRes.json()) as { id: string };

    const acceptRes = await app.request(
      `/api/invitations/${invite.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': memberSession },
      },
      devEnv,
    );
    expect(acceptRes.status).toBe(200);

    return family.id;
  }

  it('acceptance 1 & 4: filters personal resources strictly by user_id and blocks direct URL ID tampering or cross-user parameter override', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // 1. Alice creates a personal diary, personal task, personal event, and personal mood message
    const aliceDiaryRes = await app.request(
      '/api/diaries',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          entryDate: '2026-10-30',
          title: 'Alice 的私密日記',
          body: '今天完成了權限中介層設計，僅本人可見。',
        }),
      },
      devEnv,
    );
    expect(aliceDiaryRes.status).toBe(201);
    expect(aliceDiaryRes.headers.get('X-Identity-Mode')).toBe('unverified-test-simulation');
    expect(aliceDiaryRes.headers.get('X-Security-Warning')).toMatch(/logical isolation/i);
    const aliceDiary = DiaryEntrySchema.parse(await aliceDiaryRes.json());
    expect(aliceDiary.userId).toBe(users.alice.userId);

    const aliceTaskRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: 'Alice 私人待辦：整理發票',
          dueDate: '2026-10-31',
        }),
      },
      devEnv,
    );
    expect(aliceTaskRes.status).toBe(201);
    const aliceTask = TaskDetailSchema.parse(await aliceTaskRes.json());
    expect(aliceTask.ownerUserId).toBe(users.alice.userId);

    const aliceEventRes = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: 'Alice 私人牙醫預約',
          startsAt: '2026-10-30T06:00:00.000Z',
          endsAt: '2026-10-30T07:00:00.000Z',
          allDay: false,
          timezone: 'Asia/Taipei',
        }),
      },
      devEnv,
    );
    expect(aliceEventRes.status).toBe(201);
    const aliceEvent = EventDetailSchema.parse(await aliceEventRes.json());
    expect(aliceEvent.ownerUserId).toBe(users.alice.userId);

    // Alice posts a personal mood message
    const aliceSpacesRes = await app.request(
      '/api/spaces',
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    expect(aliceSpacesRes.status).toBe(200);
    const aliceSpaces = AuthorizedSpaceOverviewSchema.parse(await aliceSpacesRes.json());
    expect(aliceSpaces.securityNotice).toBe(DATA_OWNERSHIP_SECURITY_NOTICE);
    const alicePersonalRoomId = aliceSpaces.personalSpace.chatRoomId;

    const aliceMoodRes = await app.request(
      `/api/chat-rooms/${alicePersonalRoomId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          body: 'Alice 的私人心情隨手記 🌿',
          localDate: '2026-10-30',
        }),
      },
      devEnv,
    );
    expect(aliceMoodRes.status).toBe(201);
    const aliceMoodMsg = MessageWithAuthorizedDerivedSchema.parse(await aliceMoodRes.json());

    // 2. Bob lists his own personal diaries, tasks, events, and mood messages -> completely empty (isolated by user_id)
    const bobDiariesRes = await app.request(
      '/api/diaries',
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobDiariesRes.status).toBe(200);
    expect(await bobDiariesRes.json()).toEqual([]);

    const bobTasksRes = await app.request(
      '/api/tasks?scope=personal',
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobTasksRes.status).toBe(200);
    expect(await bobTasksRes.json()).toEqual([]);

    const bobEventsRes = await app.request(
      '/api/events?scope=personal',
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobEventsRes.status).toBe(200);
    expect(await bobEventsRes.json()).toEqual([]);

    // 3. Bob attempts cross-user query/body override (?userId=aliceId / ?ownerUserId=aliceId) -> 403 FORBIDDEN
    for (const path of [
      `/api/spaces?userId=${users.alice.userId}`,
      `/api/diaries?userId=${users.alice.userId}`,
      `/api/tasks?ownerUserId=${users.alice.userId}`,
      `/api/events?userId=${users.alice.userId}`,
      `/api/chat-rooms?userId=${users.alice.userId}`,
    ]) {
      const res = await app.request(
        path,
        { headers: { 'X-Test-Session-Id': users.bob.session } },
        devEnv,
      );
      expect(res.status).toBe(403);
      const errBody = (await res.json()) as { error: string; simulationMode: boolean };
      expect(errBody.error).toBe('FORBIDDEN');
      expect(errBody.simulationMode).toBe(true);
    }

    // Diaries strictly reject any attempt to share with a family (403 DIARY_ALWAYS_PRIVATE)
    const familyDiaryAttempt = await app.request(
      '/api/diaries',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'family',
          familyId: 'some-family-id',
          entryDate: '2026-10-30',
          title: '試圖共享日記',
          body: '禁止共享',
        }),
      },
      devEnv,
    );
    expect(familyDiaryAttempt.status).toBe(403);
    expect(((await familyDiaryAttempt.json()) as { error: string }).error).toBe(
      'DIARY_ALWAYS_PRIVATE',
    );

    // 4. Direct URL ID tampering: Bob swaps URL IDs to Alice's resources -> all return 404 without leaking content
    const bobReadAliceDiary = await app.request(
      `/api/diaries/${aliceDiary.id}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobReadAliceDiary.status).toBe(404);
    expect(JSON.stringify(await bobReadAliceDiary.json())).not.toContain('Alice 的私密日記');

    const bobPatchAliceDiary = await app.request(
      `/api/diaries/${aliceDiary.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({ title: 'Bob 竄改標題' }),
      },
      devEnv,
    );
    expect(bobPatchAliceDiary.status).toBe(404);

    const bobDeleteAliceDiary = await app.request(
      `/api/diaries/${aliceDiary.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(bobDeleteAliceDiary.status).toBe(404);

    const bobReadAliceTask = await app.request(
      `/api/tasks/${aliceTask.id}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobReadAliceTask.status).toBe(404);

    const bobPatchAliceTask = await app.request(
      `/api/tasks/${aliceTask.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({ title: 'Bob 竄改待辦', completed: true }),
      },
      devEnv,
    );
    expect(bobPatchAliceTask.status).toBe(404);

    const bobDeleteAliceTask = await app.request(
      `/api/tasks/${aliceTask.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(bobDeleteAliceTask.status).toBe(404);

    const bobReadAliceEvent = await app.request(
      `/api/events/${aliceEvent.id}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobReadAliceEvent.status).toBe(404);

    const bobReadAliceRoomMsgs = await app.request(
      `/api/chat-rooms/${alicePersonalRoomId}/messages`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobReadAliceRoomMsgs.status).toBe(404);

    const bobPostAliceRoomMsg = await app.request(
      `/api/chat-rooms/${alicePersonalRoomId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({ body: 'Bob 闖入 Alice 個人心情' }),
      },
      devEnv,
    );
    expect(bobPostAliceRoomMsg.status).toBe(404);

    const bobReadAliceMsg = await app.request(
      `/api/messages/${aliceMoodMsg.id}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobReadAliceMsg.status).toBe(404);

    const bobDeleteAliceMsg = await app.request(
      `/api/messages/${aliceMoodMsg.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(bobDeleteAliceMsg.status).toBe(404);

    // 5. Verify Alice's personal records remain completely intact after all of Bob's failed attempts
    const verifyAliceDiary = await app.request(
      `/api/diaries/${aliceDiary.id}`,
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    expect(verifyAliceDiary.status).toBe(200);
    expect(DiaryEntrySchema.parse(await verifyAliceDiary.json()).title).toBe('Alice 的私密日記');

    const verifyAliceTask = await app.request(
      `/api/tasks/${aliceTask.id}`,
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    expect(verifyAliceTask.status).toBe(200);
    expect(TaskDetailSchema.parse(await verifyAliceTask.json()).title).toBe(
      'Alice 私人待辦：整理發票',
    );

    sqlite.close();
  });

  it('acceptance 2 & 3: verifies family membership on family resources and rejects non-members with 403/404', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);
    // Alice & Bob form a family; Charlie is NOT a member
    const familyId = await createSharedFamily(
      app,
      devEnv,
      users.alice.session,
      users.bob.email,
      users.bob.session,
      'Alice & Bob 家庭',
    );

    // 1. Alice & Bob can access family space, create family tasks, events, and chat messages
    const bobSpaceRes = await app.request(
      `/api/spaces/families/${familyId}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobSpaceRes.status).toBe(200);
    const familySpace = (await bobSpaceRes.json()) as { chatRoomId: string; role: string };
    expect(familySpace.role).toBe('member');

    const famTaskRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'family',
          familyId,
          title: '家庭採買：週末買水果',
          dueDate: '2026-11-01',
        }),
      },
      devEnv,
    );
    expect(famTaskRes.status).toBe(201);
    const famTask = TaskDetailSchema.parse(await famTaskRes.json());

    const famEventRes = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({
          scope: 'family',
          familyId,
          title: '家庭聚餐',
          startsAt: '2026-11-01',
          endsAt: '2026-11-01',
          allDay: true,
        }),
      },
      devEnv,
    );
    expect(famEventRes.status).toBe(201);
    const famEvent = EventDetailSchema.parse(await famEventRes.json());

    // Bob (member) can read Alice's family task, and Alice (admin) can read Bob's family event
    const bobReadFamTask = await app.request(
      `/api/tasks/${famTask.id}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobReadFamTask.status).toBe(200);

    const aliceReadFamEvent = await app.request(
      `/api/events/${famEvent.id}`,
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    expect(aliceReadFamEvent.status).toBe(200);

    // 2. Charlie (non-member) tries to access family-scoped endpoints -> 403 FORBIDDEN
    const charlieSpaceRes = await app.request(
      `/api/spaces/families/${familyId}`,
      { headers: { 'X-Test-Session-Id': users.charlie.session } },
      devEnv,
    );
    expect(charlieSpaceRes.status).toBe(403);

    const charlieListFamTasks = await app.request(
      `/api/tasks?scope=family&familyId=${familyId}`,
      { headers: { 'X-Test-Session-Id': users.charlie.session } },
      devEnv,
    );
    expect(charlieListFamTasks.status).toBe(403);

    const charlieCreateFamTask = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.charlie.session,
        },
        body: JSON.stringify({
          scope: 'family',
          familyId,
          title: 'Charlie 越權新增家庭待辦',
        }),
      },
      devEnv,
    );
    expect(charlieCreateFamTask.status).toBe(403);

    const charlieListFamEvents = await app.request(
      `/api/events?scope=family&familyId=${familyId}`,
      { headers: { 'X-Test-Session-Id': users.charlie.session } },
      devEnv,
    );
    expect(charlieListFamEvents.status).toBe(403);

    const charlieCreateFamEvent = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.charlie.session,
        },
        body: JSON.stringify({
          scope: 'family',
          familyId,
          title: 'Charlie 越權新增家庭事件',
          startsAt: '2026-11-01',
          endsAt: '2026-11-01',
          allDay: true,
        }),
      },
      devEnv,
    );
    expect(charlieCreateFamEvent.status).toBe(403);

    const charlieListFamRooms = await app.request(
      `/api/chat-rooms?scope=family&familyId=${familyId}`,
      { headers: { 'X-Test-Session-Id': users.charlie.session } },
      devEnv,
    );
    expect(charlieListFamRooms.status).toBe(403);

    // 3. Charlie directly swaps URL IDs to family task, event, or chat room -> 404 NOT_FOUND
    const charlieDirectTask = await app.request(
      `/api/tasks/${famTask.id}`,
      { headers: { 'X-Test-Session-Id': users.charlie.session } },
      devEnv,
    );
    expect(charlieDirectTask.status).toBe(404);

    const charlieDirectEvent = await app.request(
      `/api/events/${famEvent.id}`,
      { headers: { 'X-Test-Session-Id': users.charlie.session } },
      devEnv,
    );
    expect(charlieDirectEvent.status).toBe(404);

    const charlieDirectRoom = await app.request(
      `/api/chat-rooms/${familySpace.chatRoomId}/messages`,
      { headers: { 'X-Test-Session-Id': users.charlie.session } },
      devEnv,
    );
    expect(charlieDirectRoom.status).toBe(404);

    sqlite.close();
  });

  it('PR #18 acceptance: converting a family message to a personal task/event hides BOTH content and association existence from other family members', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);
    const familyId = await createSharedFamily(
      app,
      devEnv,
      users.alice.session,
      users.bob.email,
      users.bob.session,
      '雙向來源權限測試家庭',
    );

    // Get family chat room ID
    const famSpaceRes = await app.request(
      `/api/spaces/families/${familyId}`,
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    const { chatRoomId: familyRoomId } = (await famSpaceRes.json()) as { chatRoomId: string };

    // 1. Bob posts a message in the shared family chat room
    const msgRes = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({
          body: '下週五前要繳水電費，另外誰有空去領包裹？',
          localDate: '2026-10-30',
        }),
      },
      devEnv,
    );
    expect(msgRes.status).toBe(201);
    const familyMsg = MessageWithAuthorizedDerivedSchema.parse(await msgRes.json());

    // 2. Alice creates a PERSONAL task and a PERSONAL event derived from Bob's family message
    const alicePrivTaskRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: 'Alice 私下給媽媽驚喜禮物（私人待辦）',
          dueDate: '2026-11-05',
          sourceMessageId: familyMsg.id,
        }),
      },
      devEnv,
    );
    expect(alicePrivTaskRes.status).toBe(201);
    const alicePrivTask = TaskDetailSchema.parse(await alicePrivTaskRes.json());
    expect(alicePrivTask.scope).toBe('personal');
    expect(alicePrivTask.sourceMessageId).toBe(familyMsg.id);
    expect(alicePrivTask.sourceStatus).toBe('accessible');
    expect(alicePrivTask.sourceMessage?.body).toBe(familyMsg.body);

    const alicePrivEventRes = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: 'Alice 私人理財規劃時間',
          startsAt: '2026-11-02T10:00:00.000Z',
          endsAt: '2026-11-02T11:00:00.000Z',
          allDay: false,
          sourceMessageId: familyMsg.id,
        }),
      },
      devEnv,
    );
    expect(alicePrivEventRes.status).toBe(201);
    const alicePrivEvent = EventDetailSchema.parse(await alicePrivEventRes.json());

    // 3. When Alice views the family message (single & room list), she sees her 2 derived private records
    const aliceViewMsgRes = await app.request(
      `/api/messages/${familyMsg.id}`,
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    expect(aliceViewMsgRes.status).toBe(200);
    const aliceMsgView = MessageWithAuthorizedDerivedSchema.parse(await aliceViewMsgRes.json());
    expect(aliceMsgView.derivedCount).toBe(2);
    expect(aliceMsgView.derivedTasks.map((t) => t.id)).toEqual([alicePrivTask.id]);
    expect(aliceMsgView.derivedEvents.map((e) => e.id)).toEqual([alicePrivEvent.id]);

    // 4. CRITICAL CHECK: When Bob (other family member) views the EXACT SAME family message:
    // Bob sees 0 derived records — neither title, status, count, nor existence of Alice's private records!
    const bobViewMsgRes = await app.request(
      `/api/messages/${familyMsg.id}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobViewMsgRes.status).toBe(200);
    const bobMsgRaw = await bobViewMsgRes.json();
    const bobMsgView = MessageWithAuthorizedDerivedSchema.parse(bobMsgRaw);
    expect(bobMsgView.derivedCount).toBe(0);
    expect(bobMsgView.derivedTasks).toEqual([]);
    expect(bobMsgView.derivedEvents).toEqual([]);
    expect(JSON.stringify(bobMsgRaw)).not.toContain(alicePrivTask.id);
    expect(JSON.stringify(bobMsgRaw)).not.toContain('驚喜禮物');
    expect(JSON.stringify(bobMsgRaw)).not.toContain(alicePrivEvent.id);

    // Also verify in room message list (`GET /api/chat-rooms/:roomId/messages`) for Bob
    const bobRoomListRes = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobRoomListRes.status).toBe(200);
    const bobRoomMsgs = (await bobRoomListRes.json()) as unknown[];
    expect(bobRoomMsgs).toHaveLength(1);
    const bobRoomFirstMsg = MessageWithAuthorizedDerivedSchema.parse(bobRoomMsgs[0]);
    expect(bobRoomFirstMsg.derivedCount).toBe(0);
    expect(bobRoomFirstMsg.derivedTasks).toEqual([]);
    expect(bobRoomFirstMsg.derivedEvents).toEqual([]);

    // 5. Now Alice also creates a SHARED family task from the same message
    const sharedTaskRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'family',
          familyId,
          title: '家庭共享待辦：繳水電費',
          sourceMessageId: familyMsg.id,
        }),
      },
      devEnv,
    );
    expect(sharedTaskRes.status).toBe(201);
    const sharedTask = TaskDetailSchema.parse(await sharedTaskRes.json());

    // Alice sees 3 derived records (2 personal + 1 family)
    const aliceViewAfterShared = MessageWithAuthorizedDerivedSchema.parse(
      await (
        await app.request(
          `/api/messages/${familyMsg.id}`,
          { headers: { 'X-Test-Session-Id': users.alice.session } },
          devEnv,
        )
      ).json(),
    );
    expect(aliceViewAfterShared.derivedCount).toBe(3);

    // Bob sees ONLY the 1 shared family task (derivedCount === 1), still unaware of Alice's 2 private records
    const bobViewAfterShared = MessageWithAuthorizedDerivedSchema.parse(
      await (
        await app.request(
          `/api/messages/${familyMsg.id}`,
          { headers: { 'X-Test-Session-Id': users.bob.session } },
          devEnv,
        )
      ).json(),
    );
    expect(bobViewAfterShared.derivedCount).toBe(1);
    expect(bobViewAfterShared.derivedTasks.map((t) => t.id)).toEqual([sharedTask.id]);
    expect(bobViewAfterShared.derivedEvents).toEqual([]);

    sqlite.close();
  });

  it('PR #18 acceptance: leaving a family prevents reading the original group message via retained personal records, and handles soft-deleted source messages', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);
    const familyId = await createSharedFamily(
      app,
      devEnv,
      users.alice.session,
      users.bob.email,
      users.bob.session,
      '離群權限回收測試家庭',
    );

    const famSpaceRes = await app.request(
      `/api/spaces/families/${familyId}`,
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    const { chatRoomId: familyRoomId } = (await famSpaceRes.json()) as { chatRoomId: string };

    // 1. Alice posts two messages in the family chat room
    const msg1Res = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          body: '群組機密訊息 1：家庭旅遊預算與行程',
          localDate: '2026-10-30',
        }),
      },
      devEnv,
    );
    const msg1 = MessageWithAuthorizedDerivedSchema.parse(await msg1Res.json());

    const msg2Res = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          body: '群組訊息 2：稍後會被軟刪除的訊息',
          localDate: '2026-10-30',
        }),
      },
      devEnv,
    );
    const msg2 = MessageWithAuthorizedDerivedSchema.parse(await msg2Res.json());

    // 2. Bob (while still a family member) creates personal tasks & events from msg1 and msg2
    const bobTask1Res = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: 'Bob 的私人打包清單（源自群組訊息 1）',
          sourceMessageId: msg1.id,
        }),
      },
      devEnv,
    );
    expect(bobTask1Res.status).toBe(201);
    const bobTask1 = TaskDetailSchema.parse(await bobTask1Res.json());
    expect(bobTask1.sourceStatus).toBe('accessible');
    expect(bobTask1.sourceMessage?.body).toBe('群組機密訊息 1：家庭旅遊預算與行程');

    const bobEvent1Res = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: 'Bob 的私人請假行程（源自群組訊息 1）',
          startsAt: '2026-11-10',
          endsAt: '2026-11-12',
          allDay: true,
          sourceMessageId: msg1.id,
        }),
      },
      devEnv,
    );
    expect(bobEvent1Res.status).toBe(201);
    const bobEvent1 = EventDetailSchema.parse(await bobEvent1Res.json());
    expect(bobEvent1.sourceStatus).toBe('accessible');

    const bobTask2Res = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: 'Bob 的私人待辦（源自群組訊息 2）',
          sourceMessageId: msg2.id,
        }),
      },
      devEnv,
    );
    expect(bobTask2Res.status).toBe(201);
    const bobTask2 = TaskDetailSchema.parse(await bobTask2Res.json());

    // 3. Updating Bob's derived task does NOT modify the original message
    const patchTaskRes = await app.request(
      `/api/tasks/${bobTask1.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({
          title: 'Bob 修改後的私人打包清單',
          completed: true,
        }),
      },
      devEnv,
    );
    expect(patchTaskRes.status).toBe(200);
    const msg1AfterTaskPatch = MessageWithAuthorizedDerivedSchema.parse(
      await (
        await app.request(
          `/api/messages/${msg1.id}`,
          { headers: { 'X-Test-Session-Id': users.alice.session } },
          devEnv,
        )
      ).json(),
    );
    expect(msg1AfterTaskPatch.body).toBe('群組機密訊息 1：家庭旅遊預算與行程');

    // 4. Alice soft-deletes msg2 -> while Bob is still in the family, bobTask2 shows sourceStatus === 'deleted' and sourceMessage === null
    const deleteMsg2Res = await app.request(
      `/api/messages/${msg2.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    expect(deleteMsg2Res.status).toBe(200);

    const bobTask2WhileMember = TaskDetailSchema.parse(
      await (
        await app.request(
          `/api/tasks/${bobTask2.id}`,
          { headers: { 'X-Test-Session-Id': users.bob.session } },
          devEnv,
        )
      ).json(),
    );
    expect(bobTask2WhileMember.sourceMessageId).toBe(msg2.id);
    expect(bobTask2WhileMember.sourceStatus).toBe('deleted');
    expect(bobTask2WhileMember.sourceMessage).toBeNull();

    // 5. Bob leaves the family
    const leaveRes = await app.request(
      `/api/families/${familyId}/leave`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(leaveRes.status).toBe(200);

    // 6. CRITICAL CHECK: After leaving the family, Bob still owns his personal tasks/events,
    //    but CANNOT read back the original group messages through them!
    //    Both bobTask1 (active message) and bobTask2 (soft-deleted message) return `sourceStatus: 'inaccessible'` and `sourceMessage: null`!
    const bobTask1AfterLeaveRes = await app.request(
      `/api/tasks/${bobTask1.id}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobTask1AfterLeaveRes.status).toBe(200);
    const bobTask1AfterLeaveRaw = await bobTask1AfterLeaveRes.json();
    const bobTask1AfterLeave = TaskDetailSchema.parse(bobTask1AfterLeaveRaw);
    expect(bobTask1AfterLeave.title).toBe('Bob 修改後的私人打包清單');
    expect(bobTask1AfterLeave.sourceMessageId).toBe(msg1.id);
    expect(bobTask1AfterLeave.sourceStatus).toBe('inaccessible');
    expect(bobTask1AfterLeave.sourceMessage).toBeNull();
    expect(JSON.stringify(bobTask1AfterLeaveRaw)).not.toContain('家庭旅遊預算與行程');

    const bobEvent1AfterLeaveRes = await app.request(
      `/api/events/${bobEvent1.id}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobEvent1AfterLeaveRes.status).toBe(200);
    const bobEvent1AfterLeave = EventDetailSchema.parse(await bobEvent1AfterLeaveRes.json());
    expect(bobEvent1AfterLeave.sourceStatus).toBe('inaccessible');
    expect(bobEvent1AfterLeave.sourceMessage).toBeNull();

    // Even for msg2 (which was soft-deleted), Bob after leaving gets 'inaccessible' (not leaking room message state)
    const bobTask2AfterLeave = TaskDetailSchema.parse(
      await (
        await app.request(
          `/api/tasks/${bobTask2.id}`,
          { headers: { 'X-Test-Session-Id': users.bob.session } },
          devEnv,
        )
      ).json(),
    );
    expect(bobTask2AfterLeave.sourceStatus).toBe('inaccessible');
    expect(bobTask2AfterLeave.sourceMessage).toBeNull();

    // List endpoint `/api/tasks?scope=personal` also enforces `sourceStatus: 'inaccessible'`
    const bobPersonalListRes = await app.request(
      '/api/tasks?scope=personal',
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    const bobPersonalList = (await bobPersonalListRes.json()) as Array<{
      id: string;
      sourceStatus: string;
      sourceMessage: unknown;
    }>;
    expect(bobPersonalList).toHaveLength(2);
    for (const item of bobPersonalList) {
      expect(item.sourceStatus).toBe('inaccessible');
      expect(item.sourceMessage).toBeNull();
    }

    // Bob also cannot read msg1 directly via `/api/messages/:id` or create new tasks referencing msg1
    const bobDirectMsg1 = await app.request(
      `/api/messages/${msg1.id}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobDirectMsg1.status).toBe(404);

    const bobReuseMsg1AfterLeave = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: '退群後試圖再引用舊群組訊息',
          sourceMessageId: msg1.id,
        }),
      },
      devEnv,
    );
    expect(bobReuseMsg1AfterLeave.status).toBe(403);
    expect(((await bobReuseMsg1AfterLeave.json()) as { error: string }).error).toBe(
      'SOURCE_MESSAGE_INACCESSIBLE',
    );

    sqlite.close();
  });

  it('reverse cross-space protection: family task derived from Alice personal mood message does not expose Alice personal message to Bob', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);
    const familyId = await createSharedFamily(
      app,
      devEnv,
      users.alice.session,
      users.bob.email,
      users.bob.session,
    );

    // Alice posts in her personal mood chat room
    const aliceSpaces = AuthorizedSpaceOverviewSchema.parse(
      await (
        await app.request(
          '/api/spaces',
          { headers: { 'X-Test-Session-Id': users.alice.session } },
          devEnv,
        )
      ).json(),
    );
    const aliceMoodRes = await app.request(
      `/api/chat-rooms/${aliceSpaces.personalSpace.chatRoomId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          body: 'Alice 私密心情：想週末大家一起大掃除，但不想公開這段抱怨文字',
          localDate: '2026-10-30',
        }),
      },
      devEnv,
    );
    const aliceMoodMsg = MessageWithAuthorizedDerivedSchema.parse(await aliceMoodRes.json());

    // Alice creates a shared family task referencing her personal mood message
    const sharedTaskRes = await app.request(
      '/api/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'family',
          familyId,
          title: '週末大掃除',
          sourceMessageId: aliceMoodMsg.id,
        }),
      },
      devEnv,
    );
    expect(sharedTaskRes.status).toBe(201);
    const sharedTaskForAlice = TaskDetailSchema.parse(await sharedTaskRes.json());
    expect(sharedTaskForAlice.sourceStatus).toBe('accessible');
    expect(sharedTaskForAlice.sourceMessage?.body).toContain('Alice 私密心情');

    // When Bob (family member) views the shared family task:
    // Bob can view the task itself, but `sourceStatus` is `'inaccessible'` and `sourceMessage` is `null`!
    const bobViewSharedTaskRes = await app.request(
      `/api/tasks/${sharedTaskForAlice.id}`,
      { headers: { 'X-Test-Session-Id': users.bob.session } },
      devEnv,
    );
    expect(bobViewSharedTaskRes.status).toBe(200);
    const bobSharedTaskRaw = await bobViewSharedTaskRes.json();
    const bobSharedTask = TaskDetailSchema.parse(bobSharedTaskRaw);
    expect(bobSharedTask.title).toBe('週末大掃除');
    expect(bobSharedTask.sourceStatus).toBe('inaccessible');
    expect(bobSharedTask.sourceMessage).toBeNull();
    expect(JSON.stringify(bobSharedTaskRaw)).not.toContain('Alice 私密心情');

    sqlite.close();
  });

  it('enforces database-level CHECK constraints for single-owner invariants and fails closed in non-development environments', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // 1. Verify SQLite CHECK constraints reject invalid dual-owner or zero-owner rows
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO calendars (id, owner_user_id, family_id, name, timezone, created_at, updated_at)
           VALUES ('bad-cal-1', NULL, NULL, '無擁有者', 'Asia/Taipei', '2026-10-30T00:00:00Z', '2026-10-30T00:00:00Z')`,
        )
        .run();
    }).toThrow(/CHECK constraint failed/i);

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO chat_rooms (id, kind, user_id, family_id, timezone, created_at, updated_at)
           VALUES ('bad-room-1', 'personal', NULL, NULL, 'Asia/Taipei', '2026-10-30T00:00:00Z', '2026-10-30T00:00:00Z')`,
        )
        .run();
    }).toThrow(/CHECK constraint failed/i);

    // 2. Verify all ownership routes fail closed (403 TEST_IDENTITY_DISABLED) in production/staging even with a valid session
    const prodEnv = {
      DB: db,
      APP_ENV: 'production',
      ALLOW_TEST_IDENTITY: 'false',
    };

    for (const route of [
      '/api/spaces',
      '/api/diaries',
      '/api/chat-rooms',
      '/api/tasks',
      '/api/events',
    ]) {
      const res = await app.request(
        route,
        { headers: { 'X-Test-Session-Id': users.alice.session } },
        prodEnv,
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        error: string;
        simulationMode: boolean;
        isAuthenticatedSecurity: boolean;
      };
      expect(body.error).toBe('TEST_IDENTITY_DISABLED');
      expect(body.simulationMode).toBe(true);
      expect(body.isAuthenticatedSecurity).toBe(false);
    }

    sqlite.close();
  });

  it('Issue #7 acceptance: supports full personal & family Event CRUD, date/month query filters, time/timezone validation, and source_message_id survival on soft-delete', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);
    const familyId = await createSharedFamily(
      app,
      devEnv,
      users.alice.session,
      users.bob.email,
      users.bob.session,
      '行事曆事件測試家庭',
    );

    // 1. Create a personal all-day multi-day event without source_message_id
    const createAllDayRes = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: '個人花東三日遊',
          description: '純日期全天跨日事件',
          startsAt: '2026-10-20',
          endsAt: '2026-10-22',
          allDay: true,
        }),
      },
      devEnv,
    );
    expect(createAllDayRes.status).toBe(201);
    const personalAllDay = EventDetailSchema.parse(await createAllDayRes.json());
    expect(personalAllDay.allDay).toBe(true);
    expect(personalAllDay.startsAt).toBe('2026-10-20');
    expect(personalAllDay.endsAt).toBe('2026-10-22');
    expect(personalAllDay.sourceMessageId).toBeNull();
    expect(personalAllDay.sourceStatus).toBe('none');

    // 2. Event time validation: reject endsAt < startsAt, invalid allDay timestamp, invalid timed format, invalid timezone
    const invalidOrderRes = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: '時間順序錯誤事件',
          startsAt: '2026-10-25',
          endsAt: '2026-10-24',
          allDay: true,
        }),
      },
      devEnv,
    );
    expect(invalidOrderRes.status).toBe(400);

    const invalidTimedOrderRes = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: '具時間順序錯誤事件',
          startsAt: '2026-10-25T12:00:00.000Z',
          endsAt: '2026-10-25T10:00:00.000Z',
          allDay: false,
          timezone: 'Asia/Taipei',
        }),
      },
      devEnv,
    );
    expect(invalidTimedOrderRes.status).toBe(400);

    const invalidTzRes = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'personal',
          title: '無效時區事件',
          startsAt: '2026-10-25T10:00:00.000Z',
          endsAt: '2026-10-25T11:00:00.000Z',
          allDay: false,
          timezone: 'Invalid/Timezone_Name',
        }),
      },
      devEnv,
    );
    expect(invalidTzRes.status).toBe(400);

    // 3. Query personal events by ?date=2026-10-21 (middle day of 3-day event) and ?year=2026&month=10
    const byDateRes = await app.request(
      '/api/events?scope=personal&date=2026-10-21',
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    expect(byDateRes.status).toBe(200);
    const byDateEvents = (await byDateRes.json()) as Array<{ id: string }>;
    expect(byDateEvents.map((e) => e.id)).toEqual([personalAllDay.id]);

    const byOtherDateRes = await app.request(
      '/api/events?scope=personal&date=2026-10-25',
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    expect(byOtherDateRes.status).toBe(200);
    expect(await byOtherDateRes.json()).toEqual([]);

    const byMonthRes = await app.request(
      '/api/events?scope=personal&year=2026&month=10',
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    expect(byMonthRes.status).toBe(200);
    expect(((await byMonthRes.json()) as Array<{ id: string }>).map((e) => e.id)).toEqual([
      personalAllDay.id,
    ]);

    // 4. PATCH /api/events/:id updates personal event and rejects space/source tampering
    const patchEventRes = await app.request(
      `/api/events/${personalAllDay.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          title: '個人花東四日遊（延長一天）',
          endsAt: '2026-10-23',
        }),
      },
      devEnv,
    );
    expect(patchEventRes.status).toBe(200);
    const patchedEvent = EventDetailSchema.parse(await patchEventRes.json());
    expect(patchedEvent.title).toBe('個人花東四日遊（延長一天）');
    expect(patchedEvent.endsAt).toBe('2026-10-23');

    const tamperScopeRes = await app.request(
      `/api/events/${personalAllDay.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'family',
          familyId,
        }),
      },
      devEnv,
    );
    expect(tamperScopeRes.status).toBe(403);

    // 5. Family Event CRUD with source_message_id and soft-delete survival
    const famSpaceRes = await app.request(
      `/api/spaces/families/${familyId}`,
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    const { chatRoomId: familyRoomId } = (await famSpaceRes.json()) as { chatRoomId: string };

    const postMsgRes = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({
          body: '下週六晚上六點全家人去吃牛排慶生！',
          localDate: '2026-10-30',
        }),
      },
      devEnv,
    );
    expect(postMsgRes.status).toBe(201);
    const sourceMsg = MessageWithAuthorizedDerivedSchema.parse(await postMsgRes.json());

    const createFamEventRes = await app.request(
      '/api/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          scope: 'family',
          familyId,
          title: '家庭牛排慶生聚餐',
          description: '已訂位 6 人桌',
          startsAt: '2026-11-07T10:00:00.000Z', // 18:00 Asia/Taipei
          endsAt: '2026-11-07T12:00:00.000Z', // 20:00 Asia/Taipei
          allDay: false,
          timezone: 'Asia/Taipei',
          sourceMessageId: sourceMsg.id,
        }),
      },
      devEnv,
    );
    expect(createFamEventRes.status).toBe(201);
    const famEvent = EventDetailSchema.parse(await createFamEventRes.json());
    expect(famEvent.sourceMessageId).toBe(sourceMsg.id);
    expect(famEvent.sourceStatus).toBe('accessible');
    expect(famEvent.sourceMessage?.body).toBe('下週六晚上六點全家人去吃牛排慶生！');

    // Bob soft-deletes the source message -> famEvent survives with sourceStatus: 'deleted'
    const deleteMsgRes = await app.request(
      `/api/messages/${sourceMsg.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(deleteMsgRes.status).toBe(200);

    const getFamEventAfterMsgDelete = await app.request(
      `/api/events/${famEvent.id}`,
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    expect(getFamEventAfterMsgDelete.status).toBe(200);
    const survivedFamEvent = EventDetailSchema.parse(await getFamEventAfterMsgDelete.json());
    expect(survivedFamEvent.title).toBe('家庭牛排慶生聚餐');
    expect(survivedFamEvent.sourceMessageId).toBe(sourceMsg.id);
    expect(survivedFamEvent.sourceStatus).toBe('deleted');
    expect(survivedFamEvent.sourceMessage).toBeNull();

    // Bob (family member) can update and delete the family event, while Charlie (non-member) gets 404
    const charliePatchFamEvent = await app.request(
      `/api/events/${famEvent.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.charlie.session,
        },
        body: JSON.stringify({ title: 'Charlie 越權修改' }),
      },
      devEnv,
    );
    expect(charliePatchFamEvent.status).toBe(404);

    const charlieDeleteFamEvent = await app.request(
      `/api/events/${famEvent.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': users.charlie.session },
      },
      devEnv,
    );
    expect(charlieDeleteFamEvent.status).toBe(404);

    const bobDeleteFamEvent = await app.request(
      `/api/events/${famEvent.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(bobDeleteFamEvent.status).toBe(200);

    const verifyDeletedRes = await app.request(
      `/api/events/${famEvent.id}`,
      { headers: { 'X-Test-Session-Id': users.alice.session } },
      devEnv,
    );
    expect(verifyDeletedRes.status).toBe(404);

    sqlite.close();
  });
});
