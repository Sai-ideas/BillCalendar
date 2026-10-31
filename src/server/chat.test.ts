import { describe, expect, it } from 'vitest';
import { createApp } from './index';
import { createMigratedSqliteD1 } from './test-utils/sqlite-d1';
import {
  MessageWithAuthorizedDerivedSchema,
  PaginatedMessagesResponseSchema,
  TestIdentityStateResponseSchema,
  sortMessagesStably,
  type FamilyDetail,
  type MessageWithAuthorizedDerived,
} from '../shared';

describe('Issue #9 Personal Mood Chat & Family Chat Room API', () => {
  it('Issue #9 acceptance: personal mood room is isolated to owner, preserves emoji, separates record_date from local_date, and supports soft-delete', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    // 1. Create identities: Alice and Bob
    const aliceIdRes = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice.demo@billcalendar.test', displayName: '愛麗絲' }),
      },
      devEnv,
    );
    const aliceState = TestIdentityStateResponseSchema.parse(await aliceIdRes.json());
    const aliceSession = aliceState.sessionId!;
    const aliceId = aliceState.currentUser!.id;

    const bobIdRes = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bob.demo@billcalendar.test', displayName: '鮑伯' }),
      },
      devEnv,
    );
    const bobState = TestIdentityStateResponseSchema.parse(await bobIdRes.json());
    const bobSession = bobState.sessionId!;

    // 2. Query Alice's spaces to find her personal mood chat room ID
    const spacesRes = await app.request(
      '/api/spaces',
      {
        headers: { 'X-Test-Session-Id': aliceSession },
      },
      devEnv,
    );
    const spaces = (await spacesRes.json()) as { personalSpace: { chatRoomId: string } };
    const alicePersonalRoomId = spaces.personalSpace.chatRoomId;
    expect(alicePersonalRoomId).toBeTruthy();

    // 3. Alice posts a mood message with emoji and optional backdate recordDate ('2026-10-25')
    const emojiBody = '✨ 今天心情超級棒！🎉 慶祝專案順利上線 🚀 吃了大餐 🎂';
    const postMsgRes = await app.request(
      `/api/chat-rooms/${alicePersonalRoomId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': aliceSession,
        },
        body: JSON.stringify({
          body: emojiBody,
          recordDate: '2026-10-25',
        }),
      },
      devEnv,
    );

    expect(postMsgRes.status).toBe(201);
    const createdMsg = MessageWithAuthorizedDerivedSchema.parse(await postMsgRes.json());
    expect(createdMsg.body).toBe(emojiBody);
    expect(createdMsg.recordDate).toBe('2026-10-25');
    // Acceptance: record_date must NOT overwrite local_date
    expect(createdMsg.localDate).not.toBe('2026-10-25');
    expect(createdMsg.senderUserId).toBe(aliceId);
    expect(createdMsg.senderDisplayName).toBe('愛麗絲');

    // 4. Alice reads messages in her room
    const listMsgRes = await app.request(
      `/api/chat-rooms/${alicePersonalRoomId}/messages`,
      {
        headers: { 'X-Test-Session-Id': aliceSession },
      },
      devEnv,
    );
    expect(listMsgRes.status).toBe(200);
    const listJson = (await listMsgRes.json()) as any;
    const aliceRoomMsgs = (Array.isArray(listJson) ? listJson : listJson.messages) as MessageWithAuthorizedDerived[];
    expect(aliceRoomMsgs).toHaveLength(1);
    expect(aliceRoomMsgs[0]!.id).toBe(createdMsg.id);
    expect(aliceRoomMsgs[0]!.body).toBe(emojiBody);
    expect(aliceRoomMsgs[0]!.senderDisplayName).toBe('愛麗絲');

    // 5. Bob (other user) tries to list Alice's personal mood room messages -> 404 / 403 (inaccessible)
    const bobListAliceMood = await app.request(
      `/api/chat-rooms/${alicePersonalRoomId}/messages`,
      {
        headers: { 'X-Test-Session-Id': bobSession },
      },
      devEnv,
    );
    expect(bobListAliceMood.status).toBe(404);

    // 6. Bob tries to read Alice's message by ID -> 404
    const bobReadAliceMsg = await app.request(
      `/api/messages/${createdMsg.id}`,
      {
        headers: { 'X-Test-Session-Id': bobSession },
      },
      devEnv,
    );
    expect(bobReadAliceMsg.status).toBe(404);

    // 7. Bob tries to delete Alice's message -> 404
    const bobDeleteAliceMsg = await app.request(
      `/api/messages/${createdMsg.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': bobSession },
      },
      devEnv,
    );
    expect(bobDeleteAliceMsg.status).toBe(404);

    // 8. Alice soft-deletes her own message
    const aliceDeleteRes = await app.request(
      `/api/messages/${createdMsg.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': aliceSession },
      },
      devEnv,
    );
    expect(aliceDeleteRes.status).toBe(200);
    const deleteJson = (await aliceDeleteRes.json()) as { success: boolean; id: string; deletedAt: string };
    expect(deleteJson.success).toBe(true);
    expect(deleteJson.id).toBe(createdMsg.id);
    expect(deleteJson.deletedAt).toBeTruthy();

    // 9. After soft deletion: general message list and single read API do NOT return the soft-deleted content
    const listAfterDelete = await app.request(
      `/api/chat-rooms/${alicePersonalRoomId}/messages`,
      {
        headers: { 'X-Test-Session-Id': aliceSession },
      },
      devEnv,
    );
    expect(listAfterDelete.status).toBe(200);
    const emptyJson = (await listAfterDelete.json()) as any;
    const emptyList = (Array.isArray(emptyJson) ? emptyJson : emptyJson.messages) as MessageWithAuthorizedDerived[];
    expect(emptyList).toHaveLength(0);

    const readDeletedRes = await app.request(
      `/api/messages/${createdMsg.id}`,
      {
        headers: { 'X-Test-Session-Id': aliceSession },
      },
      devEnv,
    );
    expect(readDeletedRes.status).toBe(404);
    const readDeletedJson = (await readDeletedRes.json()) as { message: string };
    expect(readDeletedJson.message).toContain('已移除');

    // But the row remains in the DB with deleted_at NOT NULL (retaining ID for foreign keys)
    const rawDbRow = sqlite.prepare('SELECT * FROM messages WHERE id = ?').get(createdMsg.id) as
      | { id: string; deleted_at: string | null }
      | undefined;
    expect(rawDbRow).toBeTruthy();
    expect(rawDbRow?.deleted_at).toBeTruthy();

    sqlite.close();
  });

  it('Issue #9 acceptance: family chat room is shared by members, enforces admin vs member delete permissions, and isolates from non-members', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    // 1. Identities: Alice (admin), Bob (member), Dave (member), Charlie (non-member)
    const selectIdentity = async (email: string, displayName: string) => {
      const res = await app.request(
        '/api/test-identity/select',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, displayName }),
        },
        devEnv,
      );
      const state = TestIdentityStateResponseSchema.parse(await res.json());
      return { sessionToken: state.sessionId!, user: state.currentUser! };
    };

    const alice = await selectIdentity('alice.demo@billcalendar.test', '愛麗絲');
    const bob = await selectIdentity('bob.demo@billcalendar.test', '鮑伯');
    const dave = await selectIdentity('dave.demo@billcalendar.test', '戴夫');
    const charlie = await selectIdentity('charlie.demo@billcalendar.test', '查理');

    // 2. Alice creates family '陳家'
    const createFamRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': alice.sessionToken,
        },
        body: JSON.stringify({ name: '陳家生活空間' }),
      },
      devEnv,
    );
    expect(createFamRes.status).toBe(201);
    const createdFamily = (await createFamRes.json()) as FamilyDetail;
    const familyId = createdFamily.id;

    // Alice invites Bob and Dave
    const invBobRes = await app.request(
      `/api/families/${familyId}/invitations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Test-Session-Id': alice.sessionToken },
        body: JSON.stringify({ email: 'bob.demo@billcalendar.test', role: 'member' }),
      },
      devEnv,
    );
    expect(invBobRes.status).toBe(201);

    const invDaveRes = await app.request(
      `/api/families/${familyId}/invitations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Test-Session-Id': alice.sessionToken },
        body: JSON.stringify({ email: 'dave.demo@billcalendar.test', role: 'member' }),
      },
      devEnv,
    );
    expect(invDaveRes.status).toBe(201);

    // Bob & Dave accept invitations
    const bobInvRes = await app.request(
      '/api/invitations',
      {
        headers: { 'X-Test-Session-Id': bob.sessionToken },
      },
      devEnv,
    );
    expect(bobInvRes.status).toBe(200);
    const bobInvs = (await bobInvRes.json()) as Array<{ id: string }>;
    const acceptBobRes = await app.request(
      `/api/invitations/${bobInvs[0]!.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': bob.sessionToken },
      },
      devEnv,
    );
    expect(acceptBobRes.status).toBe(200);

    const daveInvRes = await app.request(
      '/api/invitations',
      {
        headers: { 'X-Test-Session-Id': dave.sessionToken },
      },
      devEnv,
    );
    expect(daveInvRes.status).toBe(200);
    const daveInvs = (await daveInvRes.json()) as Array<{ id: string }>;
    const acceptDaveRes = await app.request(
      `/api/invitations/${daveInvs[0]!.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': dave.sessionToken },
      },
      devEnv,
    );
    expect(acceptDaveRes.status).toBe(200);

    // 3. Get family chat room ID
    const famSpaceRes = await app.request(
      `/api/spaces/families/${familyId}`,
      {
        headers: { 'X-Test-Session-Id': alice.sessionToken },
      },
      devEnv,
    );
    expect(famSpaceRes.status).toBe(200);
    const { chatRoomId: familyRoomId } = (await famSpaceRes.json()) as { chatRoomId: string };
    expect(familyRoomId).toBeTruthy();

    // 4. Bob posts a family message with emoji
    const bobMsgRes = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': bob.sessionToken,
        },
        body: JSON.stringify({
          body: '大家週末想去吃拉麵嗎？🍜 推薦中山站那家 😋',
        }),
      },
      devEnv,
    );
    expect(bobMsgRes.status).toBe(201);
    const bobMsg = MessageWithAuthorizedDerivedSchema.parse(await bobMsgRes.json());
    expect(bobMsg.senderDisplayName).toBe('鮑伯');

    // 5. Alice (admin), Bob (sender), Dave (member) can read the message
    const aliceListRes = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      {
        headers: { 'X-Test-Session-Id': alice.sessionToken },
      },
      devEnv,
    );
    expect(aliceListRes.status).toBe(200);
    const aliceJson = (await aliceListRes.json()) as any;
    const msgsForAlice = (Array.isArray(aliceJson) ? aliceJson : aliceJson.messages) as MessageWithAuthorizedDerived[];
    expect(msgsForAlice).toHaveLength(1);
    expect(msgsForAlice[0]!.id).toBe(bobMsg.id);
    expect(msgsForAlice[0]!.body).toContain('拉麵嗎？🍜');
    expect(msgsForAlice[0]!.senderDisplayName).toBe('鮑伯');

    // 6. Charlie (non-member) cannot access the family chat room or messages
    const charlieListRes = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      {
        headers: { 'X-Test-Session-Id': charlie.sessionToken },
      },
      devEnv,
    );
    expect(charlieListRes.status).toBe(404);

    const charliePostRes = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Test-Session-Id': charlie.sessionToken },
        body: JSON.stringify({ body: '駭客入侵' }),
      },
      devEnv,
    );
    expect(charliePostRes.status).toBe(404);

    // 7. Delete permission checks:
    // 7a. Non-member Charlie tries to delete Bob's message -> 404
    const charlieDelRes = await app.request(
      `/api/messages/${bobMsg.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': charlie.sessionToken },
      },
      devEnv,
    );
    expect(charlieDelRes.status).toBe(404);

    // 7b. Another family member Dave tries to delete Bob's message -> 403 Forbidden!
    const daveDelRes = await app.request(
      `/api/messages/${bobMsg.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': dave.sessionToken },
      },
      devEnv,
    );
    expect(daveDelRes.status).toBe(403);
    const daveDelErr = (await daveDelRes.json()) as { message: string };
    expect(daveDelErr.message).toContain('僅訊息發送者本人或家庭管理員可刪除群組訊息');

    // 7c. Family Admin Alice deletes Bob's message -> 200 Success!
    const aliceDelRes = await app.request(
      `/api/messages/${bobMsg.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': alice.sessionToken },
      },
      devEnv,
    );
    expect(aliceDelRes.status).toBe(200);

    // Verify it is now soft deleted
    const aliceListAfter = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      {
        headers: { 'X-Test-Session-Id': alice.sessionToken },
      },
      devEnv,
    );
    expect(aliceListAfter.status).toBe(200);
    const aliceAfterJson = (await aliceListAfter.json()) as any;
    const afterMsgs = Array.isArray(aliceAfterJson) ? aliceAfterJson : aliceAfterJson.messages;
    expect(afterMsgs).toHaveLength(0);

    // 8. Bob posts another message and deletes his own message -> 200 Success!
    const bobMsg2Res = await app.request(
      `/api/chat-rooms/${familyRoomId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Test-Session-Id': bob.sessionToken },
        body: JSON.stringify({ body: '我自刪這則訊息 🗑️' }),
      },
      devEnv,
    );
    expect(bobMsg2Res.status).toBe(201);
    const bobMsg2 = MessageWithAuthorizedDerivedSchema.parse(await bobMsg2Res.json());

    const bobDelSelfRes = await app.request(
      `/api/messages/${bobMsg2.id}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': bob.sessionToken },
      },
      devEnv,
    );
    expect(bobDelSelfRes.status).toBe(200);

    sqlite.close();
  });

  it('Issue #9 acceptance: stable sorting by (created_at, id) and utility functions', () => {
    const list: Array<{ id: string; createdAt: string }> = [
      { id: 'm_c', createdAt: '2026-10-31T10:00:00.000Z' },
      { id: 'm_a', createdAt: '2026-10-31T09:00:00.000Z' },
      { id: 'm_b2', createdAt: '2026-10-31T09:30:00.000Z' },
      { id: 'm_b1', createdAt: '2026-10-31T09:30:00.000Z' },
    ];

    const sorted = sortMessagesStably(list);
    expect(sorted.map((m) => m.id)).toEqual(['m_a', 'm_b1', 'm_b2', 'm_c']);
  });

  it('Issue #10 acceptance: anchorDate locating, cursor pagination (before/after/limit), EXPLAIN QUERY PLAN index verification, and timezone edge cases', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    // 1. Create Alice identity
    const aliceIdRes = await app.request(
      '/api/test-identity/select',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice.chat@billcalendar.test', displayName: '愛麗絲' }),
      },
      devEnv,
    );
    const aliceState = TestIdentityStateResponseSchema.parse(await aliceIdRes.json());
    const aliceSession = aliceState.sessionId!;

    const spacesRes = await app.request('/api/spaces', { headers: { 'X-Test-Session-Id': aliceSession } }, devEnv);
    const spaces = (await spacesRes.json()) as { personalSpace: { chatRoomId: string } };
    const roomId = spaces.personalSpace.chatRoomId;

    // 2. Insert 6 messages across different dates and times
    // Note: m2 & m3 have same local_date but different created_at; m4 has different local_date
    const messagesToInsert = [
      { id: 'msg_10_01', body: '第 1 則訊息 (10-28)', localDate: '2026-10-28', createdAt: '2026-10-28T08:00:00.000Z' },
      { id: 'msg_10_02', body: '第 2 則訊息 (10-29)', localDate: '2026-10-29', createdAt: '2026-10-29T09:00:00.000Z' },
      { id: 'msg_10_03', body: '第 3 則訊息 早 (10-30)', localDate: '2026-10-30', createdAt: '2026-10-30T08:30:00.000Z' },
      { id: 'msg_10_04', body: '第 4 則訊息 晚 (10-30)', localDate: '2026-10-30', createdAt: '2026-10-30T14:30:00.000Z' },
      { id: 'msg_10_05', body: '第 5 則訊息 (10-31)', localDate: '2026-10-31', createdAt: '2026-10-31T10:00:00.000Z' },
      { id: 'msg_10_06', body: '第 6 則訊息 (11-01)', localDate: '2026-11-01', createdAt: '2026-11-01T11:00:00.000Z' },
    ];

    for (const m of messagesToInsert) {
      sqlite.prepare(
        'INSERT INTO messages (id, room_id, sender_user_id, body, created_at, local_date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(m.id, roomId, aliceState.currentUser!.id, m.body, m.createdAt, m.localDate, m.createdAt);
    }

    // 3. EXPLAIN QUERY PLAN verification as required by PR #18 decision and Review V0.3 A2:
    // Verify that index idx_messages_room_date_created is leveraged for anchorDate lookup
    const explainDatePlan = sqlite.prepare(
      'EXPLAIN QUERY PLAN SELECT id, created_at FROM messages WHERE room_id = ? AND local_date = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC LIMIT 1'
    ).all(roomId, '2026-10-30') as Array<{ detail: string }>;

    expect(explainDatePlan.some((row) => row.detail.includes('idx_messages_room_date_created'))).toBe(true);

    // Verify index idx_messages_room_created or idx_messages_room_date_created is leveraged for timeline cursor paging
    const explainCursorPlan = sqlite.prepare(
      'EXPLAIN QUERY PLAN SELECT id, created_at FROM messages WHERE room_id = ? AND deleted_at IS NULL AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 10'
    ).all(roomId, '2026-10-30T14:30:00.000Z', '2026-10-30T14:30:00.000Z', 'msg_10_04') as Array<{ detail: string }>;

    expect(explainCursorPlan.some((row) => row.detail.includes('idx_messages_room_created') || row.detail.includes('idx_messages_room_date_created'))).toBe(true);

    // 4. Test anchorDate locating: anchorDate='2026-10-30', limit=3
    const anchorRes = await app.request(
      `/api/chat-rooms/${roomId}/messages?anchorDate=2026-10-30&limit=3`,
      { headers: { 'X-Test-Session-Id': aliceSession } },
      devEnv,
    );
    expect(anchorRes.status).toBe(200);
    const anchorData = PaginatedMessagesResponseSchema.parse(await anchorRes.json());
    // Should locate around 2026-10-30 first message (msg_10_03) and provide context
    expect(anchorData.messages.map((m) => m.id)).toEqual(['msg_10_02', 'msg_10_03', 'msg_10_04']);
    expect(anchorData.hasMoreBefore).toBe(true); // msg_10_01 exists before
    expect(anchorData.hasMoreAfter).toBe(true);  // msg_10_05, msg_10_06 exist after
    expect(anchorData.startCursor).toBe('msg_10_02');
    expect(anchorData.endCursor).toBe('msg_10_04');

    // 5. Test empty date anchor: anchorDate='2026-10-25' (before any messages)
    const emptyDateRes = await app.request(
      `/api/chat-rooms/${roomId}/messages?anchorDate=2026-10-25&limit=2`,
      { headers: { 'X-Test-Session-Id': aliceSession } },
      devEnv,
    );
    expect(emptyDateRes.status).toBe(200);
    const emptyDateData = PaginatedMessagesResponseSchema.parse(await emptyDateRes.json());
    // Locates the earliest closest message msg_10_01
    expect(emptyDateData.messages[0]?.id).toBe('msg_10_01');
    expect(emptyDateData.hasMoreBefore).toBe(false);

    // 6. Test cursor pagination: before
    const beforeRes = await app.request(
      `/api/chat-rooms/${roomId}/messages?before=msg_10_03&limit=2`,
      { headers: { 'X-Test-Session-Id': aliceSession } },
      devEnv,
    );
    expect(beforeRes.status).toBe(200);
    const beforeData = PaginatedMessagesResponseSchema.parse(await beforeRes.json());
    expect(beforeData.messages.map((m) => m.id)).toEqual(['msg_10_01', 'msg_10_02']);
    expect(beforeData.hasMoreBefore).toBe(false);

    // 7. Test cursor pagination: after
    const afterRes = await app.request(
      `/api/chat-rooms/${roomId}/messages?after=msg_10_04&limit=2`,
      { headers: { 'X-Test-Session-Id': aliceSession } },
      devEnv,
    );
    expect(afterRes.status).toBe(200);
    const afterData = PaginatedMessagesResponseSchema.parse(await afterRes.json());
    expect(afterData.messages.map((m) => m.id)).toEqual(['msg_10_05', 'msg_10_06']);
    expect(afterData.hasMoreAfter).toBe(false);

    // 8. Timezone edge case: space timezone changed or cross-timezone sending
    // Suppose room timezone shifts or messages arrive with different localDate order vs created_at
    sqlite.prepare(
      'INSERT INTO messages (id, room_id, sender_user_id, body, created_at, local_date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('msg_tz_skew', roomId, aliceState.currentUser!.id, '時區差異訊息', '2026-10-30T16:00:00.000Z', '2026-10-31', '2026-10-30T16:00:00.000Z');

    const tzCheckRes = await app.request(
      `/api/chat-rooms/${roomId}/messages?limit=10`,
      { headers: { 'X-Test-Session-Id': aliceSession } },
      devEnv,
    );
    const tzData = PaginatedMessagesResponseSchema.parse(await tzCheckRes.json());
    // Verification: Timeline must strictly order by (created_at, id) ascending
    for (let i = 1; i < tzData.messages.length; i++) {
      const prev = tzData.messages[i - 1]!;
      const curr = tzData.messages[i]!;
      expect(prev.createdAt.localeCompare(curr.createdAt) <= 0).toBe(true);
    }

    sqlite.close();
  });

  it('Issue #28 acceptance: targetMessageId locating, scroll context, and soft-delete/inaccessible graceful degradation', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const aliceRes = await app.request(
      '/api/test-identity/select',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice.issue28@billcalendar.test', displayName: '愛麗絲' }) },
      devEnv,
    );
    const aliceSession = (await aliceRes.json() as any).sessionId;
    const spacesRes = await app.request('/api/spaces', { headers: { 'X-Test-Session-Id': aliceSession } }, devEnv);
    const roomId = (await spacesRes.json() as any).personalSpace.chatRoomId;

    // Post 3 messages
    const postRes1 = await app.request(`/api/chat-rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Session-Id': aliceSession },
      body: JSON.stringify({ body: '第一則筆記' }),
    }, devEnv);
    const msg1 = await postRes1.json() as any;

    const postRes2 = await app.request(`/api/chat-rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Session-Id': aliceSession },
      body: JSON.stringify({ body: '第二則目標來源訊息 🎯' }),
    }, devEnv);
    const msg2 = await postRes2.json() as any;

    const postRes3 = await app.request(`/api/chat-rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Session-Id': aliceSession },
      body: JSON.stringify({ body: '第三則後續筆記' }),
    }, devEnv);
    const msg3 = await postRes3.json() as any;

    // 1. Locate by targetMessageId=msg2.id
    const targetRes = await app.request(
      `/api/chat-rooms/${roomId}/messages?targetMessageId=${msg2.id}&limit=10`,
      { headers: { 'X-Test-Session-Id': aliceSession } },
      devEnv,
    );
    expect(targetRes.status).toBe(200);
    const targetData = PaginatedMessagesResponseSchema.parse(await targetRes.json());
    expect(targetData.targetMessageFound).toBe(true);
    expect(targetData.messages.some((m) => m.id === msg2.id)).toBe(true);

    // 2. Soft-delete msg2
    const delRes = await app.request(
      `/api/messages/${msg2.id}`,
      { method: 'DELETE', headers: { 'X-Test-Session-Id': aliceSession } },
      devEnv,
    );
    expect(delRes.status).toBe(200);

    // 3. Graceful degradation: Request with soft-deleted targetMessageId
    const degradedRes = await app.request(
      `/api/chat-rooms/${roomId}/messages?targetMessageId=${msg2.id}&anchorDate=2026-10-31&limit=10`,
      { headers: { 'X-Test-Session-Id': aliceSession } },
      devEnv,
    );
    expect(degradedRes.status).toBe(200);
    const degradedData = PaginatedMessagesResponseSchema.parse(await degradedRes.json());
    // targetMessageFound must be false
    expect(degradedData.targetMessageFound).toBe(false);
    // Soft-deleted message must NOT be in returned messages
    expect(degradedData.messages.some((m) => m.id === msg2.id)).toBe(false);
    // Non-deleted messages remain accessible
    expect(degradedData.messages.map((m) => m.id)).toEqual([msg1.id, msg3.id]);

    sqlite.close();
  });

});
