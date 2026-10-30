import { describe, expect, it } from 'vitest';
import { createApp } from './index';
import { TestIdentityStateResponseSchema } from '../shared';
import { createMigratedSqliteD1 } from './test-utils/sqlite-d1';

describe('Issue #3 Family Model, Members and In-App Invitations', () => {
  async function setupTestUsers(app: ReturnType<typeof createApp>, devEnv: Record<string, unknown>) {
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
    const aliceSession = aliceState.sessionId!;
    const aliceUserId = aliceState.currentUser!.id;

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
    const bobSession = bobState.sessionId!;
    const bobUserId = bobState.currentUser!.id;

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
    const charlieSession = charlieState.sessionId!;
    const charlieUserId = charlieState.currentUser!.id;

    return {
      alice: { session: aliceSession, userId: aliceUserId, email: 'alice.demo@billcalendar.test' },
      bob: { session: bobSession, userId: bobUserId, email: 'bob.demo@billcalendar.test' },
      charlie: {
        session: charlieSession,
        userId: charlieUserId,
        email: 'charlie.demo@billcalendar.test',
      },
    };
  }

  it('acceptance: A creates family, invites B, B accepts -> shared family space', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // 1. Alice creates family
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '愛麗絲與鮑伯的溫馨小窩' }),
      },
      devEnv,
    );
    expect(createRes.status).toBe(201);
    const familyData = (await createRes.json()) as { id: string; name: string; myRole: string };
    const familyId = familyData.id;
    expect(familyId).toBeTruthy();
    expect(familyData.name).toBe('愛麗絲與鮑伯的溫馨小窩');
    expect(familyData.myRole).toBe('admin');

    // 2. Alice invites Bob
    const inviteRes = await app.request(
      `/api/families/${familyId}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({
          email: '  BOB.DEMO@billcalendar.test  ',
          role: 'member',
        }),
      },
      devEnv,
    );
    expect(inviteRes.status).toBe(201);
    const inviteData = (await inviteRes.json()) as { id: string; invitedEmail: string; status: string };
    expect(inviteData.invitedEmail).toBe('bob.demo@billcalendar.test');
    expect(inviteData.status).toBe('pending');
    const invitationId = inviteData.id;

    // 3. Bob checks pending invitations list
    const bobInvitesRes = await app.request(
      '/api/invitations',
      {
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(bobInvitesRes.status).toBe(200);
    const bobInvites = (await bobInvitesRes.json()) as Array<{ id: string; familyName: string }>;
    expect(bobInvites.length).toBe(1);
    expect(bobInvites[0].id).toBe(invitationId);
    expect(bobInvites[0].familyName).toBe('愛麗絲與鮑伯的溫馨小窩');

    // 4. Bob accepts invitation
    const acceptRes = await app.request(
      `/api/invitations/${invitationId}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(acceptRes.status).toBe(200);

    // 5. Shared family space verification:
    // Both Alice and Bob can view /api/families/:id with 2 members
    const aliceViewRes = await app.request(
      `/api/families/${familyId}`,
      {
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    expect(aliceViewRes.status).toBe(200);
    const aliceFamilyDetail = (await aliceViewRes.json()) as {
      members: Array<{ userId: string; role: string; emailNormalized: string }>;
    };
    expect(aliceFamilyDetail.members.length).toBe(2);
    expect(aliceFamilyDetail.members.map((m) => m.emailNormalized)).toContain(
      'alice.demo@billcalendar.test',
    );
    expect(aliceFamilyDetail.members.map((m) => m.emailNormalized)).toContain(
      'bob.demo@billcalendar.test',
    );

    const bobViewRes = await app.request(
      `/api/families/${familyId}`,
      {
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(bobViewRes.status).toBe(200);
    const bobFamilyDetail = (await bobViewRes.json()) as {
      myRole: string;
      members: Array<{ userId: string; role: string }>;
    };
    expect(bobFamilyDetail.myRole).toBe('member');
    expect(bobFamilyDetail.members.length).toBe(2);
  });

  it('acceptance: same user can join multiple families and list all of them', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // Alice creates Family A
    const resA = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '家庭 A (Alice)' }),
      },
      devEnv,
    );
    const famA = (await resA.json()) as { id: string };

    // Charlie creates Family B
    const resB = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.charlie.session,
        },
        body: JSON.stringify({ name: '家庭 B (Charlie)' }),
      },
      devEnv,
    );
    const famB = (await resB.json()) as { id: string };

    // Alice invites Bob to Family A
    const invARes = await app.request(
      `/api/families/${famA.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    const invA = (await invARes.json()) as { id: string };

    // Charlie invites Bob to Family B
    const invBRes = await app.request(
      `/api/families/${famB.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.charlie.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    const invB = (await invBRes.json()) as { id: string };

    // Bob accepts both
    await app.request(
      `/api/invitations/${invA.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    await app.request(
      `/api/invitations/${invB.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );

    // Bob calls GET /api/families -> returns 2 families
    const bobFamRes = await app.request(
      '/api/families',
      {
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(bobFamRes.status).toBe(200);
    const bobFamilies = (await bobFamRes.json()) as Array<{ id: string; name: string }>;
    expect(bobFamilies.length).toBe(2);
    expect(bobFamilies.map((f) => f.id)).toContain(famA.id);
    expect(bobFamilies.map((f) => f.id)).toContain(famB.id);
  });

  it('acceptance: duplicate join does not duplicate write and duplicate invitations are rejected', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // Alice creates Family
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '防止重複加入測試家庭' }),
      },
      devEnv,
    );
    const fam = (await createRes.json()) as { id: string };

    // Alice invites Bob
    const invRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    const inv = (await invRes.json()) as { id: string };

    // Alice tries to send duplicate pending invite to Bob while one is pending -> 409
    const dupInvRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    expect(dupInvRes.status).toBe(409);
    const dupInvErr = (await dupInvRes.json()) as { error: string };
    expect(dupInvErr.error).toBe('INVITATION_ALREADY_PENDING');

    // Bob accepts invitation
    const accept1 = await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(accept1.status).toBe(200);

    // Bob accepts again while being a member -> idempotent 200 without creating a duplicate record
    const accept2 = await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(accept2.status).toBe(200);

    // Verify member count is strictly 2 (Alice + Bob)
    const famView = await app.request(
      `/api/families/${fam.id}`,
      {
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    const famDetail = (await famView.json()) as { members: unknown[] };
    expect(famDetail.members.length).toBe(2);

    // Alice tries to invite Bob again when Bob is already an active member -> 409 ALREADY_MEMBER
    const invAgainRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    expect(invAgainRes.status).toBe(409);
    const invAgainErr = (await invAgainRes.json()) as { error: string };
    expect(invAgainErr.error).toBe('ALREADY_MEMBER');
  });

  it('acceptance: leaving family revokes access completely', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // Alice creates Family & invites Bob
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '退出測試家庭' }),
      },
      devEnv,
    );
    const fam = (await createRes.json()) as { id: string };

    const invRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    const inv = (await invRes.json()) as { id: string };

    await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );

    // Bob leaves family
    const leaveRes = await app.request(
      `/api/families/${fam.id}/leave`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(leaveRes.status).toBe(200);

    // Bob tries to access family space -> 403 Forbidden
    const bobAccessRes = await app.request(
      `/api/families/${fam.id}`,
      {
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(bobAccessRes.status).toBe(403);
    const err = (await bobAccessRes.json()) as { error: string };
    expect(err.error).toBe('FORBIDDEN');

    // Bob's list of families no longer includes this family
    const bobFamiliesRes = await app.request(
      '/api/families',
      {
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    const bobFamilies = (await bobFamiliesRes.json()) as Array<{ id: string }>;
    expect(bobFamilies.find((f) => f.id === fam.id)).toBeUndefined();
  });

  it('acceptance: reject invitation and revoke invitation workflows', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // Alice creates Family
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '邀請管理流程測試家庭' }),
      },
      devEnv,
    );
    const fam = (await createRes.json()) as { id: string };

    // 1. Rejection workflow: Alice invites Charlie, Charlie rejects
    const invCharlieRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.charlie.email }),
      },
      devEnv,
    );
    const invCharlie = (await invCharlieRes.json()) as { id: string };

    const rejectRes = await app.request(
      `/api/invitations/${invCharlie.id}/reject`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.charlie.session },
      },
      devEnv,
    );
    expect(rejectRes.status).toBe(200);

    // Charlie has no access
    const charlieAccess = await app.request(
      `/api/families/${fam.id}`,
      {
        headers: { 'X-Test-Session-Id': users.charlie.session },
      },
      devEnv,
    );
    expect(charlieAccess.status).toBe(403);

    // Charlie cannot accept an already rejected invitation
    const reAcceptRes = await app.request(
      `/api/invitations/${invCharlie.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.charlie.session },
      },
      devEnv,
    );
    expect(reAcceptRes.status).toBe(400);

    // 2. Revocation workflow: Alice invites Bob, then revokes it before Bob accepts
    const invBobRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    const invBob = (await invBobRes.json()) as { id: string };

    const revokeRes = await app.request(
      `/api/families/${fam.id}/invitations/${invBob.id}/revoke`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    expect(revokeRes.status).toBe(200);

    // Bob views pending invitations -> empty
    const bobInvitesRes = await app.request(
      '/api/invitations',
      {
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    const bobInvites = (await bobInvitesRes.json()) as unknown[];
    expect(bobInvites.length).toBe(0);

    // Bob tries to accept revoked invitation -> 400
    const acceptRevoked = await app.request(
      `/api/invitations/${invBob.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(acceptRevoked.status).toBe(400);
  });

  it('acceptance: member role cannot manage members, invite, or rename family', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // Alice creates Family & invites Bob as member
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '權限邊界測試家庭' }),
      },
      devEnv,
    );
    const fam = (await createRes.json()) as { id: string };

    const invRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    const inv = (await invRes.json()) as { id: string };

    await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );

    // 1. Bob (member) tries to invite Charlie -> 403 Forbidden
    const bobInviteCharlie = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({ email: users.charlie.email }),
      },
      devEnv,
    );
    expect(bobInviteCharlie.status).toBe(403);

    // 2. Bob (member) tries to remove Alice (admin) -> 403 Forbidden
    const bobRemoveAlice = await app.request(
      `/api/families/${fam.id}/members/${users.alice.userId}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(bobRemoveAlice.status).toBe(403);

    // 3. Bob (member) tries to rename family -> 403 Forbidden
    const bobRenameFam = await app.request(
      `/api/families/${fam.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.bob.session,
        },
        body: JSON.stringify({ name: '鮑伯擅自改名' }),
      },
      devEnv,
    );
    expect(bobRenameFam.status).toBe(403);

    // Alice (admin) can rename family
    const aliceRenameFam = await app.request(
      `/api/families/${fam.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '愛麗絲管理員合法改名' }),
      },
      devEnv,
    );
    expect(aliceRenameFam.status).toBe(200);
  });

  it('acceptance: last admin cannot leave or be removed without handover', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // Alice creates Family (Alice is sole admin)
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '最後管理員防護家庭' }),
      },
      devEnv,
    );
    const fam = (await createRes.json()) as { id: string };

    // Alice tries to leave -> 400 LAST_ADMIN_CANNOT_LEAVE
    const aliceLeaveRes = await app.request(
      `/api/families/${fam.id}/leave`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    expect(aliceLeaveRes.status).toBe(400);
    const leaveErr = (await aliceLeaveRes.json()) as { error: string };
    expect(leaveErr.error).toBe('LAST_ADMIN_CANNOT_LEAVE');

    // Alice cannot remove self via remove member endpoint
    const aliceRemoveSelfRes = await app.request(
      `/api/families/${fam.id}/members/${users.alice.userId}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    expect(aliceRemoveSelfRes.status).toBe(400);
  });

  it('Blocking 1: strictly enforces test identity environment gate on family and invitation routes in non-dev envs', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    // First obtain a valid test session token in development
    const users = await setupTestUsers(app, devEnv);

    // Define production and staging environments (fail-closed)
    const prodEnv = {
      DB: db,
      APP_ENV: 'production',
      ALLOW_TEST_IDENTITY: 'false',
    };

    const stagingEnv = {
      DB: db,
      APP_ENV: 'staging',
      ALLOW_TEST_IDENTITY: 'false',
    };

    // Even with a valid session header, all family and invitation routes must reject with 403 in production
    const prodGetFam = await app.request(
      '/api/families',
      {
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      prodEnv,
    );
    expect(prodGetFam.status).toBe(403);
    const prodFamErr = (await prodGetFam.json()) as { error: string };
    expect(prodFamErr.error).toBe('TEST_IDENTITY_DISABLED');

    const prodPostFam = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '禁用的正式環境家庭' }),
      },
      prodEnv,
    );
    expect(prodPostFam.status).toBe(403);

    const stagingGetInv = await app.request(
      '/api/invitations',
      {
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      stagingEnv,
    );
    expect(stagingGetInv.status).toBe(403);
  });

  it('Blocking 2 & 3: enforces true idempotency and prevents reusing accepted invitation after leaving', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // Alice creates Family & invites Bob
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '真冪等性與重新授權防護家庭' }),
      },
      devEnv,
    );
    const fam = (await createRes.json()) as { id: string };

    const invRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    const inv = (await invRes.json()) as { id: string };

    // 1. Bob accepts invitation
    const accept1 = await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(accept1.status).toBe(200);

    // 2. Bob accepts again while currently a member -> 200 (true idempotent)
    const accept2 = await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(accept2.status).toBe(200);
    const accept2Json = (await accept2.json()) as { message: string };
    expect(accept2Json.message).toBe('您已經是該家庭的成員');

    // 3. Trying to revoke an already accepted invite fails with 400
    const revokeAccepted = await app.request(
      `/api/families/${fam.id}/invitations/${inv.id}/revoke`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    expect(revokeAccepted.status).toBe(400);

    // 4. Bob leaves the family
    const leaveRes = await app.request(
      `/api/families/${fam.id}/leave`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(leaveRes.status).toBe(200);

    // 5. Bob tries to accept the old accepted invitation after leaving -> returns 400 INVITATION_ALREADY_USED
    const reuseAttempt = await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(reuseAttempt.status).toBe(400);
    const reuseErr = (await reuseAttempt.json()) as { error: string };
    expect(reuseErr.error).toBe('INVITATION_ALREADY_USED');

    // Verify Bob is not re-added as a member
    const famView = await app.request(
      `/api/families/${fam.id}`,
      {
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    const famDetail = (await famView.json()) as { members: Array<{ userId: string }> };
    expect(famDetail.members.length).toBe(1);
    expect(famDetail.members[0].userId).toBe(users.alice.userId);
  });

  it('Blocking: verifies that an invitation cannot yield membership if revoked before or during accept', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // Alice creates Family & invites Bob
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '撤銷與競態防護家庭' }),
      },
      devEnv,
    );
    const fam = (await createRes.json()) as { id: string };

    const invRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    const inv = (await invRes.json()) as { id: string };

    // 1. Admin revokes the invitation
    const revokeRes = await app.request(
      `/api/families/${fam.id}/invitations/${inv.id}/revoke`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    expect(revokeRes.status).toBe(200);

    // 2. Calling revoke again fails with 400 because 0 rows were updated (already revoked)
    const revokeAgainRes = await app.request(
      `/api/families/${fam.id}/invitations/${inv.id}/revoke`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    expect(revokeAgainRes.status).toBe(400);

    // 3. Bob attempts to accept the revoked invitation
    // Must return 400 and CANNOT insert membership into family_members
    const acceptRevoked = await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(acceptRevoked.status).toBe(400);
    const acceptRevokedJson = (await acceptRevoked.json()) as { error: string };
    expect(acceptRevokedJson.error).toBe('INVITATION_INVALID');

    // 4. Verify family_members table strictly contains ONLY Alice
    const famDetailRes = await app.request(
      `/api/families/${fam.id}`,
      {
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    const famDetail = (await famDetailRes.json()) as { members: Array<{ userId: string }> };
    expect(famDetail.members.length).toBe(1);
    expect(famDetail.members[0].userId).toBe(users.alice.userId);

    // 5. Test rejection: Alice invites Charlie, Charlie rejects
    const invCharlieRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.charlie.email }),
      },
      devEnv,
    );
    const invCharlie = (await invCharlieRes.json()) as { id: string };

    const rejectRes = await app.request(
      `/api/invitations/${invCharlie.id}/reject`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.charlie.session },
      },
      devEnv,
    );
    expect(rejectRes.status).toBe(200);

    // Calling reject a second time fails because 0 rows were updated
    const rejectAgainRes = await app.request(
      `/api/invitations/${invCharlie.id}/reject`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.charlie.session },
      },
      devEnv,
    );
    expect(rejectAgainRes.status).toBe(400);

    // Trying to accept a rejected invitation fails and does NOT grant membership
    const acceptRejected = await app.request(
      `/api/invitations/${invCharlie.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.charlie.session },
      },
      devEnv,
    );
    expect(acceptRejected.status).toBe(400);
    const acceptRejectedJson = (await acceptRejected.json()) as { error: string };
    expect(acceptRejectedJson.error).toBe('INVITATION_INVALID');
  });

  it('Blocking: cross-table transaction rollback on partial failure (INSERT failure rolls back accepted status to pending, and retry succeeds)', async () => {
    const { sqlite, db } = createMigratedSqliteD1();
    const app = createApp();

    let failInsertOnce = false;
    const testDb: D1Database = {
      prepare: (query: string) => db.prepare(query),
      exec: (query: string) => db.exec(query),
      dump: () => db.dump(),
      withSession: (token?: string) => db.withSession(token as never),
      batch: async <T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
        if (failInsertOnce) {
          failInsertOnce = false;
          // Run statement 1 within transaction, then simulate failure on statement 2:
          sqlite.exec('BEGIN TRANSACTION;');
          await statements[0].all();
          // Simulate failure before statement 2 commits:
          sqlite.exec('ROLLBACK;');
          throw new Error('Simulated D1 INSERT failure or interrupted Worker during member insert');
        }
        return db.batch<T>(statements);
      },
    };

    const devEnv = {
      DB: testDb,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // 1. Alice creates family & invites Bob
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '交易一致性測試家庭' }),
      },
      devEnv,
    );
    const fam = (await createRes.json()) as { id: string };

    const invRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email }),
      },
      devEnv,
    );
    const inv = (await invRes.json()) as { id: string };

    // 2. Bob attempts to accept invitation, but member INSERT encounters failure
    failInsertOnce = true;
    const acceptFailRes = await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(acceptFailRes.status).toBe(500);

    // 3. Verify cross-table consistency after rollback:
    // - family_invitations.status MUST remain 'pending' (NOT left as 'accepted')
    const inviteRow = sqlite
      .prepare('SELECT status FROM family_invitations WHERE id = ?')
      .get(inv.id) as { status: string };
    expect(inviteRow.status).toBe('pending');

    // - family_members table MUST NOT have Bob
    const bobMember = sqlite
      .prepare('SELECT COUNT(*) as count FROM family_members WHERE family_id = ? AND user_id = ?')
      .get(fam.id, users.bob.userId) as { count: number };
    expect(bobMember.count).toBe(0);

    // 4. Retry accepting without failure -> must succeed, transition status to 'accepted', and create membership
    const acceptRetryRes = await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(acceptRetryRes.status).toBe(200);

    // 5. Verify both tables are now consistently updated
    const inviteRowAfter = sqlite
      .prepare('SELECT status FROM family_invitations WHERE id = ?')
      .get(inv.id) as { status: string };
    expect(inviteRowAfter.status).toBe('accepted');

    const bobMemberAfter = sqlite
      .prepare('SELECT COUNT(*) as count FROM family_members WHERE family_id = ? AND user_id = ?')
      .get(fam.id, users.bob.userId) as { count: number };
    expect(bobMemberAfter.count).toBe(1);
  });

  it('Blocking 4 & Follow-up: supports admin handover and enforces atomic last-admin protection on demote, remove, and leave', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    // Alice creates Family (Alice is sole admin)
    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '原子最後管理員防護家庭' }),
      },
      devEnv,
    );
    const fam = (await createRes.json()) as { id: string };

    // Alice invites Bob as admin, Bob accepts
    const invRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.bob.email, role: 'admin' }),
      },
      devEnv,
    );
    const inv = (await invRes.json()) as { id: string };
    await app.request(
      `/api/invitations/${inv.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );

    // Alice invites Charlie as member, Charlie accepts
    const invCRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: users.charlie.email, role: 'member' }),
      },
      devEnv,
    );
    const invC = (await invCRes.json()) as { id: string };
    await app.request(
      `/api/invitations/${invC.id}/accept`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.charlie.session },
      },
      devEnv,
    );

    // 1. Charlie (member) cannot change anyone's role -> 403 Forbidden
    const charliePromoteAttempt = await app.request(
      `/api/families/${fam.id}/members/${users.charlie.userId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.charlie.session,
        },
        body: JSON.stringify({ role: 'admin' }),
      },
      devEnv,
    );
    expect(charliePromoteAttempt.status).toBe(403);

    // 2. Two admins exist (Alice and Bob). Alice demotes Bob to member -> 200 (succeeds because Alice remains admin)
    const demoteBobRes = await app.request(
      `/api/families/${fam.id}/members/${users.bob.userId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ role: 'member' }),
      },
      devEnv,
    );
    expect(demoteBobRes.status).toBe(200);

    // 3. Now Alice is the sole admin.
    // Attempting to demote Alice to member is atomically blocked by SQL subquery -> 400 LAST_ADMIN_CANNOT_LEAVE
    const demoteSoleAdminRes = await app.request(
      `/api/families/${fam.id}/members/${users.alice.userId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ role: 'member' }),
      },
      devEnv,
    );
    expect(demoteSoleAdminRes.status).toBe(400);
    const demoteErr = (await demoteSoleAdminRes.json()) as { error: string };
    expect(demoteErr.error).toBe('LAST_ADMIN_CANNOT_LEAVE');

    // 4. Sole admin attempting to leave is atomically blocked -> 400 LAST_ADMIN_CANNOT_LEAVE
    const soleAdminLeaveRes = await app.request(
      `/api/families/${fam.id}/leave`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    expect(soleAdminLeaveRes.status).toBe(400);
    const leaveErr = (await soleAdminLeaveRes.json()) as { error: string };
    expect(leaveErr.error).toBe('LAST_ADMIN_CANNOT_LEAVE');

    // 5. Alice promotes Bob back to admin -> 200
    const promoteBobBackRes = await app.request(
      `/api/families/${fam.id}/members/${users.bob.userId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ role: 'admin' }),
      },
      devEnv,
    );
    expect(promoteBobBackRes.status).toBe(200);

    // 6. Now that Bob is admin, Alice can safely leave -> 200
    const aliceLeaveRes = await app.request(
      `/api/families/${fam.id}/leave`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.alice.session },
      },
      devEnv,
    );
    expect(aliceLeaveRes.status).toBe(200);

    // 7. Bob is now the sole admin. Bob removes Charlie (member) -> 200 (succeeds because Charlie is not admin)
    const removeCharlieRes = await app.request(
      `/api/families/${fam.id}/members/${users.charlie.userId}`,
      {
        method: 'DELETE',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(removeCharlieRes.status).toBe(200);

    // 8. Bob (sole admin) cannot leave -> 400
    const bobLeaveRes = await app.request(
      `/api/families/${fam.id}/leave`,
      {
        method: 'POST',
        headers: { 'X-Test-Session-Id': users.bob.session },
      },
      devEnv,
    );
    expect(bobLeaveRes.status).toBe(400);
  });

  it('enforces synthetic email format (.test domain check) on invitation and unauthenticated checks', async () => {
    const { db } = createMigratedSqliteD1();
    const app = createApp();
    const devEnv = {
      DB: db,
      APP_ENV: 'development',
      ALLOW_TEST_IDENTITY: 'true',
      DEFAULT_TIMEZONE: 'Asia/Taipei',
    };

    const users = await setupTestUsers(app, devEnv);

    const createRes = await app.request(
      '/api/families',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ name: '安全網域驗證家庭' }),
      },
      devEnv,
    );
    const fam = (await createRes.json()) as { id: string };

    // Trying to invite a non-.test email fails validation with 400
    const invalidEmailRes = await app.request(
      `/api/families/${fam.id}/invitations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Session-Id': users.alice.session,
        },
        body: JSON.stringify({ email: 'realuser@gmail.com' }),
      },
      devEnv,
    );
    expect(invalidEmailRes.status).toBe(400);

    // Unauthenticated requests return 401
    const unauthGet = await app.request('/api/families', {}, devEnv);
    expect(unauthGet.status).toBe(401);

    const unauthInv = await app.request('/api/invitations', {}, devEnv);
    expect(unauthInv.status).toBe(401);
  });
});
