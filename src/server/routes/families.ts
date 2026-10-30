import { type Context, Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  CreateFamilyRequestSchema,
  InviteMemberRequestSchema,
  UpdateFamilyRequestSchema,
  UpdateMemberRoleRequestSchema,
  type FamilyDetail,
  type FamilyInvitationSummary,
  type FamilyMemberSummary,
  type FamilyRole,
  type FamilySummary,
} from '../../shared';
import { authenticateTestRequest } from '../auth';
import { createDb } from '../db/client';
import { families, familyInvitations, familyMembers, users } from '../db/schema';
import type { Env } from '../index';

async function requireAuth(c: Context<{ Bindings: Env }>) {
  const authRes = await authenticateTestRequest(c);
  if (authRes.status === 'disabled') {
    return {
      user: null,
      errorResponse: c.json(
        {
          error: 'TEST_IDENTITY_DISABLED',
          simulationMode: true,
          isAuthenticatedSecurity: false,
          message: '公開／正式部署已禁用測試 Email 身份模擬；此機制非正式安全驗證。',
        },
        403,
      ),
    };
  }
  if (authRes.status === 'unauthorized' || !authRes.user) {
    return {
      user: null,
      errorResponse: c.json({ error: 'UNAUTHORIZED', message: '請先選擇或切換測試身份' }, 401),
    };
  }
  return { user: authRes.user, errorResponse: null };
}

export function createFamiliesRouter() {
  const router = new Hono<{ Bindings: Env }>();

  router.use('*', async (c, next) => {
    await next();
    c.header('X-Identity-Mode', 'unverified-test-simulation');
    c.header('Cache-Control', 'no-store');
  });

  // GET /api/families - List all families for current user
  router.get('/', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const db = createDb(c.env.DB);
    const rows = await db
      .select({
        family: families,
        memberRole: familyMembers.role,
        memberJoinedAt: familyMembers.joinedAt,
      })
      .from(familyMembers)
      .innerJoin(families, eq(familyMembers.familyId, families.id))
      .where(eq(familyMembers.userId, currentUser.id))
      .orderBy(desc(familyMembers.joinedAt));

    const result: FamilySummary[] = [];
    for (const r of rows) {
      const countRes = await db
        .select({ count: sql<number>`count(*)` })
        .from(familyMembers)
        .where(eq(familyMembers.familyId, r.family.id));
      const memberCount = Number(countRes[0]?.count ?? 1);

      result.push({
        id: r.family.id,
        name: r.family.name,
        myRole: r.memberRole as FamilyRole,
        memberCount,
        createdBy: r.family.createdBy,
        createdAt: r.family.createdAt,
        updatedAt: r.family.updatedAt,
      });
    }

    return c.json(result, 200);
  });

  // POST /api/families - Create a new family atomically
  router.post('/', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    const parsed = CreateFamilyRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的家庭名稱';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    const nowIso = new Date().toISOString();
    const familyId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    const db = createDb(c.env.DB);

    // Atomic creation of family + admin member via db.batch
    await db.batch([
      db.insert(families).values({
        id: familyId,
        name: parsed.data.name,
        createdBy: currentUser.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
      db.insert(familyMembers).values({
        id: memberId,
        familyId,
        userId: currentUser.id,
        role: 'admin',
        joinedAt: nowIso,
        updatedAt: nowIso,
      }),
    ]);

    const responsePayload: FamilyDetail = {
      id: familyId,
      name: parsed.data.name,
      myRole: 'admin',
      createdBy: currentUser.id,
      createdAt: nowIso,
      updatedAt: nowIso,
      members: [
        {
          id: memberId,
          userId: currentUser.id,
          role: 'admin',
          displayName: currentUser.displayName,
          emailNormalized: currentUser.emailNormalized,
          joinedAt: nowIso,
        },
      ],
      pendingInvitations: [],
    };

    return c.json(responsePayload, 201);
  });

  // GET /api/families/:id - Get family detail (requires membership)
  router.get('/:id', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const familyId = c.req.param('id');
    const db = createDb(c.env.DB);

    const membership = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, currentUser.id)))
      .limit(1);

    if (membership.length === 0) {
      return c.json({ error: 'FORBIDDEN', message: '您不是該家庭空間的成員或已退出' }, 403);
    }

    const familyRows = await db.select().from(families).where(eq(families.id, familyId)).limit(1);
    const family = familyRows[0];
    if (!family) {
      return c.json({ error: 'NOT_FOUND', message: '找不到該家庭空間' }, 404);
    }

    const myRole = membership[0].role as FamilyRole;

    const memberRows = await db
      .select({
        member: familyMembers,
        user: users,
      })
      .from(familyMembers)
      .innerJoin(users, eq(familyMembers.userId, users.id))
      .where(eq(familyMembers.familyId, familyId))
      .orderBy(familyMembers.joinedAt);

    const membersList: FamilyMemberSummary[] = memberRows.map((m) => ({
      id: m.member.id,
      userId: m.user.id,
      role: m.member.role as FamilyRole,
      displayName: m.user.displayName,
      emailNormalized: m.user.emailNormalized,
      joinedAt: m.member.joinedAt,
    }));

    let pendingInvites: FamilyInvitationSummary[] | undefined;
    if (myRole === 'admin') {
      const inviteRows = await db
        .select({
          invite: familyInvitations,
          inviter: users,
        })
        .from(familyInvitations)
        .innerJoin(users, eq(familyInvitations.invitedBy, users.id))
        .where(
          and(
            eq(familyInvitations.familyId, familyId),
            eq(familyInvitations.status, 'pending'),
          ),
        )
        .orderBy(desc(familyInvitations.createdAt));

      pendingInvites = inviteRows.map((inv) => ({
        id: inv.invite.id,
        familyId: inv.invite.familyId,
        familyName: family.name,
        invitedEmail: inv.invite.invitedEmail,
        invitedBy: inv.invite.invitedBy,
        invitedByDisplayName: inv.inviter.displayName,
        role: inv.invite.role as FamilyRole,
        status: inv.invite.status as 'pending',
        createdAt: inv.invite.createdAt,
      }));
    }

    const payload: FamilyDetail = {
      id: family.id,
      name: family.name,
      myRole,
      createdBy: family.createdBy,
      createdAt: family.createdAt,
      updatedAt: family.updatedAt,
      members: membersList,
      ...(pendingInvites !== undefined ? { pendingInvitations: pendingInvites } : {}),
    };

    return c.json(payload, 200);
  });

  // PATCH /api/families/:id - Update family name (admin only)
  router.patch('/:id', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const familyId = c.req.param('id');
    const db = createDb(c.env.DB);

    const membership = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, currentUser.id)))
      .limit(1);

    if (membership.length === 0) {
      return c.json({ error: 'FORBIDDEN', message: '您不是該家庭空間的成員或已退出' }, 403);
    }
    if (membership[0].role !== 'admin') {
      return c.json({ error: 'FORBIDDEN', message: '僅管理員有權修改家庭名稱' }, 403);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    const parsed = UpdateFamilyRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的家庭名稱';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    const nowIso = new Date().toISOString();
    await db
      .update(families)
      .set({
        name: parsed.data.name,
        updatedAt: nowIso,
      })
      .where(eq(families.id, familyId));

    return c.json({ success: true, name: parsed.data.name }, 200);
  });

  // PATCH /api/families/:id/members/:userId - Update member role with atomic last-admin enforcement
  router.patch('/:id/members/:userId', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const familyId = c.req.param('id');
    const targetUserId = c.req.param('userId');
    const db = createDb(c.env.DB);

    const membership = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, currentUser.id)))
      .limit(1);

    if (membership.length === 0) {
      return c.json({ error: 'FORBIDDEN', message: '您不是該家庭空間的成員或已退出' }, 403);
    }
    if (membership[0].role !== 'admin') {
      return c.json({ error: 'FORBIDDEN', message: '僅管理員有權變更成員角色' }, 403);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    const parsed = UpdateMemberRoleRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的角色';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    const targetMembers = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, targetUserId)))
      .limit(1);

    if (targetMembers.length === 0) {
      return c.json({ error: 'NOT_FOUND', message: '找不到該成員' }, 404);
    }

    const currentRole = targetMembers[0].role;
    const newRole = parsed.data.role;

    if (currentRole === newRole) {
      return c.json({ success: true, role: newRole }, 200);
    }

    const nowIso = new Date().toISOString();

    // Atomic demotion protection: SQL subquery ensures remaining admin count > 1
    if (currentRole === 'admin' && newRole === 'member') {
      const updateResult = await db
        .update(familyMembers)
        .set({
          role: 'member',
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(familyMembers.familyId, familyId),
            eq(familyMembers.userId, targetUserId),
            sql`(
              SELECT COUNT(*) FROM family_members
              WHERE family_id = ${familyId} AND role = 'admin'
            ) > 1`,
          ),
        )
        .returning({ id: familyMembers.id });

      if (updateResult.length === 0) {
        return c.json(
          {
            error: 'LAST_ADMIN_CANNOT_LEAVE',
            message: '家庭必須至少保留一位管理員，不可降級最後一位管理員',
          },
          400,
        );
      }

      return c.json({ success: true, role: 'member' }, 200);
    }

    // Promotion to admin
    await db
      .update(familyMembers)
      .set({
        role: 'admin',
        updatedAt: nowIso,
      })
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, targetUserId)));

    return c.json({ success: true, role: 'admin' }, 200);
  });

  // POST /api/families/:id/invitations - Send invitation (admin only)
  router.post('/:id/invitations', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const familyId = c.req.param('id');
    const db = createDb(c.env.DB);

    const membership = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, currentUser.id)))
      .limit(1);

    if (membership.length === 0) {
      return c.json({ error: 'FORBIDDEN', message: '您不是該家庭空間的成員或已退出' }, 403);
    }
    if (membership[0].role !== 'admin') {
      return c.json({ error: 'FORBIDDEN', message: '僅管理員有權發送邀請' }, 403);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: '請提供有效的 JSON 請求內容' }, 400);
    }

    const parsed = InviteMemberRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '無效的邀請資料';
      return c.json({ error: 'VALIDATION_ERROR', message: msg }, 400);
    }

    const { email: invitedEmail, role: invitedRole } = parsed.data;

    // Check if target user already exists and is an active member of this family
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, invitedEmail))
      .limit(1);

    if (existingUser[0]) {
      const isAlreadyMember = await db
        .select()
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.familyId, familyId),
            eq(familyMembers.userId, existingUser[0].id),
          ),
        )
        .limit(1);

      if (isAlreadyMember.length > 0) {
        return c.json({ error: 'ALREADY_MEMBER', message: '該使用者已經是此家庭的成員' }, 409);
      }
    }

    // Check if there is already a pending invitation for this email in this family
    const pendingInvites = await db
      .select()
      .from(familyInvitations)
      .where(
        and(
          eq(familyInvitations.familyId, familyId),
          eq(familyInvitations.invitedEmail, invitedEmail),
          eq(familyInvitations.status, 'pending'),
        ),
      )
      .limit(1);

    if (pendingInvites.length > 0) {
      return c.json(
        { error: 'INVITATION_ALREADY_PENDING', message: '該 Email 已有待處理的家庭邀請' },
        409,
      );
    }

    const nowIso = new Date().toISOString();
    const invitationId = crypto.randomUUID();

    await db.insert(familyInvitations).values({
      id: invitationId,
      familyId,
      invitedEmail,
      invitedBy: currentUser.id,
      role: invitedRole,
      status: 'pending',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const familyRow = await db.select().from(families).where(eq(families.id, familyId)).limit(1);

    const payload: FamilyInvitationSummary = {
      id: invitationId,
      familyId,
      familyName: familyRow[0]?.name ?? '',
      invitedEmail,
      invitedBy: currentUser.id,
      invitedByDisplayName: currentUser.displayName,
      role: invitedRole,
      status: 'pending',
      createdAt: nowIso,
    };

    return c.json(payload, 201);
  });

  // POST /api/families/:id/invitations/:invId/revoke - Revoke invitation (admin only, verified conditional update)
  router.post('/:id/invitations/:invId/revoke', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const familyId = c.req.param('id');
    const invId = c.req.param('invId');
    const db = createDb(c.env.DB);

    const membership = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, currentUser.id)))
      .limit(1);

    if (membership.length === 0) {
      return c.json({ error: 'FORBIDDEN', message: '您不是該家庭空間的成員或已退出' }, 403);
    }
    if (membership[0].role !== 'admin') {
      return c.json({ error: 'FORBIDDEN', message: '僅管理員有權撤銷邀請' }, 403);
    }

    const invites = await db
      .select()
      .from(familyInvitations)
      .where(and(eq(familyInvitations.id, invId), eq(familyInvitations.familyId, familyId)))
      .limit(1);

    if (invites.length === 0) {
      return c.json({ error: 'NOT_FOUND', message: '找不到該邀請' }, 404);
    }
    if (invites[0].status !== 'pending') {
      return c.json({ error: 'CANNOT_REVOKE', message: '僅能撤銷待處理 (pending) 的邀請' }, 400);
    }

    const nowIso = new Date().toISOString();
    // Conditional update ensuring status is strictly 'pending' at update time, with explicit affected row checking
    const updateResult = await db
      .update(familyInvitations)
      .set({
        status: 'revoked',
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(familyInvitations.id, invId),
          eq(familyInvitations.familyId, familyId),
          eq(familyInvitations.status, 'pending'),
        ),
      )
      .returning({ id: familyInvitations.id });

    if (updateResult.length === 0) {
      return c.json(
        { error: 'CANNOT_REVOKE', message: '邀請已被接受、撤銷或狀態已改變，無法撤銷' },
        400,
      );
    }

    return c.json({ success: true, message: '邀請已撤銷' }, 200);
  });

  // DELETE /api/families/:id/members/:userId - Remove a member (admin only, atomic last-admin guard)
  router.delete('/:id/members/:userId', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const familyId = c.req.param('id');
    const targetUserId = c.req.param('userId');
    const db = createDb(c.env.DB);

    const membership = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, currentUser.id)))
      .limit(1);

    if (membership.length === 0) {
      return c.json({ error: 'FORBIDDEN', message: '您不是該家庭空間的成員或已退出' }, 403);
    }
    if (membership[0].role !== 'admin') {
      return c.json({ error: 'FORBIDDEN', message: '僅管理員有權移除家庭成員' }, 403);
    }

    if (targetUserId === currentUser.id) {
      return c.json({ error: 'CANNOT_REMOVE_SELF', message: '管理員請使用退出家庭功能' }, 400);
    }

    const targetMember = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, targetUserId)))
      .limit(1);

    if (targetMember.length === 0) {
      return c.json({ error: 'NOT_FOUND', message: '目標使用者不是此家庭的成員' }, 404);
    }

    // Atomic SQL removal ensuring last admin is never removed even under concurrent deletes
    const deletedRows = await db
      .delete(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, targetUserId),
          sql`(
            ${familyMembers.role} != 'admin'
            OR (
              SELECT COUNT(*) FROM family_members
              WHERE family_id = ${familyId} AND role = 'admin'
            ) > 1
          )`,
        ),
      )
      .returning({ id: familyMembers.id });

    if (deletedRows.length === 0) {
      if (targetMember[0].role === 'admin') {
        return c.json(
          { error: 'LAST_ADMIN_CANNOT_LEAVE', message: '最後一位管理員不可被移除' },
          400,
        );
      }
      return c.json({ error: 'NOT_FOUND', message: '目標成員不存在或已被移除' }, 404);
    }

    return c.json({ success: true, message: '成員已移除' }, 200);
  });

  // POST /api/families/:id/leave - Leave family with atomic last-admin guard
  router.post('/:id/leave', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const familyId = c.req.param('id');
    const db = createDb(c.env.DB);

    const membership = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, currentUser.id)))
      .limit(1);

    if (membership.length === 0) {
      return c.json({ error: 'FORBIDDEN', message: '您不是該家庭空間的成員或已退出' }, 403);
    }

    // Atomic SQL removal ensuring last admin cannot leave without handover even under concurrency
    const leftRows = await db
      .delete(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, familyId),
          eq(familyMembers.userId, currentUser.id),
          sql`(
            ${familyMembers.role} != 'admin'
            OR (
              SELECT COUNT(*) FROM family_members
              WHERE family_id = ${familyId} AND role = 'admin'
            ) > 1
          )`,
        ),
      )
      .returning({ id: familyMembers.id });

    if (leftRows.length === 0) {
      if (membership[0].role === 'admin') {
        return c.json(
          {
            error: 'LAST_ADMIN_CANNOT_LEAVE',
            message: '最後一位管理員不可在未交接前退出家庭，請先指定其他管理員',
          },
          400,
        );
      }
      return c.json({ error: 'FORBIDDEN', message: '退出家庭失敗' }, 403);
    }

    return c.json({ success: true, message: '已成功退出家庭' }, 200);
  });

  return router;
}

export function createInvitationsRouter() {
  const router = new Hono<{ Bindings: Env }>();

  router.use('*', async (c, next) => {
    await next();
    c.header('X-Identity-Mode', 'unverified-test-simulation');
    c.header('Cache-Control', 'no-store');
  });

  // GET /api/invitations - List pending invitations for current user
  router.get('/', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const db = createDb(c.env.DB);
    const rows = await db
      .select({
        invite: familyInvitations,
        family: families,
        inviter: users,
      })
      .from(familyInvitations)
      .innerJoin(families, eq(familyInvitations.familyId, families.id))
      .innerJoin(users, eq(familyInvitations.invitedBy, users.id))
      .where(
        and(
          eq(familyInvitations.invitedEmail, currentUser.emailNormalized),
          eq(familyInvitations.status, 'pending'),
        ),
      )
      .orderBy(desc(familyInvitations.createdAt));

    const result: FamilyInvitationSummary[] = rows.map((r) => ({
      id: r.invite.id,
      familyId: r.invite.familyId,
      familyName: r.family.name,
      invitedEmail: r.invite.invitedEmail,
      invitedBy: r.invite.invitedBy,
      invitedByDisplayName: r.inviter.displayName,
      role: r.invite.role as FamilyRole,
      status: r.invite.status as 'pending',
      createdAt: r.invite.createdAt,
    }));

    return c.json(result, 200);
  });

  // POST /api/invitations/:id/accept - Accept invitation (Atomic, Contingent & True Idempotent)
  router.post('/:id/accept', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const inviteId = c.req.param('id');
    const db = createDb(c.env.DB);

    const rows = await db
      .select()
      .from(familyInvitations)
      .where(eq(familyInvitations.id, inviteId))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: 'NOT_FOUND', message: '找不到該邀請' }, 404);
    }

    const invite = rows[0];
    if (invite.invitedEmail !== currentUser.emailNormalized) {
      return c.json({ error: 'FORBIDDEN', message: '您不是此邀請的收件人' }, 403);
    }

    // If invitation is already in a non-pending state:
    if (invite.status !== 'pending') {
      if (invite.status === 'accepted') {
        // True idempotency verification: only return success if still actively in family
        const activeMembership = await db
          .select()
          .from(familyMembers)
          .where(
            and(
              eq(familyMembers.familyId, invite.familyId),
              eq(familyMembers.userId, currentUser.id),
            ),
          )
          .limit(1);

        if (activeMembership.length > 0) {
          return c.json(
            { success: true, message: '您已經是該家庭的成員', familyId: invite.familyId },
            200,
          );
        }

        // Left or removed: cannot reuse already accepted invitation
        return c.json(
          {
            error: 'INVITATION_ALREADY_USED',
            message:
              '此邀請已被使用且您目前非家庭成員；不可透過已使用之舊邀請重新加入，請聯繫管理員重新發送邀請',
          },
          400,
        );
      }

      return c.json(
        { error: 'INVITATION_INVALID', message: `該邀請目前狀態為 ${invite.status}，無法接受` },
        400,
      );
    }

    // Atomic cross-table transaction:
    // Statement 1: Conditional UPDATE on family_invitations (only succeeds if status is still 'pending')
    // Statement 2: INSERT into family_members with family_id contingent on changes() = 1.
    // If update affects 0 rows (concurrent revoke/accept/reject), changes() = 0, causing NOT NULL violation on family_id,
    // which fails and rolls back the entire batch transaction.
    // If member insert fails (e.g. database error/interrupted worker), the batch transaction rolls back, restoring
    // family_invitations status to 'pending' without leaving an orphaned accepted status.
    const nowIso = new Date().toISOString();
    const newMemberId = crypto.randomUUID();

    const updateStmt = c.env.DB.prepare(`
      UPDATE family_invitations
      SET status = 'accepted', updated_at = ?
      WHERE id = ? AND invited_email = ? AND status = 'pending'
    `).bind(nowIso, inviteId, currentUser.emailNormalized);

    const insertStmt = c.env.DB.prepare(`
      INSERT INTO family_members (id, family_id, user_id, role, joined_at, updated_at)
      SELECT
        ?,
        (CASE WHEN changes() = 1 THEN ? ELSE NULL END),
        ?,
        ?,
        ?,
        ?
      WHERE NOT EXISTS (
        SELECT 1 FROM family_members WHERE family_id = ? AND user_id = ?
      )
    `).bind(
      newMemberId,
      invite.familyId,
      currentUser.id,
      invite.role,
      nowIso,
      nowIso,
      invite.familyId,
      currentUser.id,
    );

    try {
      await c.env.DB.batch([updateStmt, insertStmt]);
    } catch {
      // Transaction aborted / rolled back:
      // Inspect current database state to return the precise semantic error response
      const latestInvite = await db
        .select()
        .from(familyInvitations)
        .where(eq(familyInvitations.id, inviteId))
        .limit(1);

      const latestStatus = latestInvite[0]?.status ?? 'invalid';
      if (latestStatus === 'accepted') {
        const activeMembership = await db
          .select()
          .from(familyMembers)
          .where(
            and(
              eq(familyMembers.familyId, invite.familyId),
              eq(familyMembers.userId, currentUser.id),
            ),
          )
          .limit(1);

        if (activeMembership.length > 0) {
          return c.json(
            { success: true, message: '您已經是該家庭的成員', familyId: invite.familyId },
            200,
          );
        }
        return c.json(
          {
            error: 'INVITATION_ALREADY_USED',
            message:
              '此邀請已被使用且您目前非家庭成員；不可透過已使用之舊邀請重新加入，請聯繫管理員重新發送邀請',
          },
          400,
        );
      }

      if (latestStatus === 'revoked' || latestStatus === 'rejected') {
        return c.json(
          {
            error: 'INVITATION_INVALID',
            message: `該邀請狀態已非待處理 (目前為 ${latestStatus})，無法接受`,
          },
          400,
        );
      }

      // If status is still pending, but the transaction failed (e.g. database error during insert):
      // The transaction was fully rolled back, preserving pending status for future retries.
      return c.json(
        {
          error: 'TRANSACTION_FAILED',
          message: '接受邀請交易失敗，已完整復原，請稍後重試',
        },
        500,
      );
    }

    return c.json({ success: true, message: '成功加入家庭', familyId: invite.familyId }, 200);
  });

  // POST /api/invitations/:id/reject - Reject invitation (verified conditional update)
  router.post('/:id/reject', async (c) => {
    const { user: currentUser, errorResponse } = await requireAuth(c);
    if (errorResponse) return errorResponse;
    if (!currentUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

    if (!c.env?.DB) {
      return c.json({ error: 'DB_NOT_CONFIGURED', message: 'D1 database binding is missing' }, 503);
    }

    const inviteId = c.req.param('id');
    const db = createDb(c.env.DB);

    const rows = await db
      .select()
      .from(familyInvitations)
      .where(eq(familyInvitations.id, inviteId))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: 'NOT_FOUND', message: '找不到該邀請' }, 404);
    }

    const invite = rows[0];
    if (invite.invitedEmail !== currentUser.emailNormalized) {
      return c.json({ error: 'FORBIDDEN', message: '您不是此邀請的收件人' }, 403);
    }

    if (invite.status !== 'pending') {
      return c.json(
        { error: 'INVITATION_INVALID', message: `該邀請目前狀態為 ${invite.status}，無法拒絕` },
        400,
      );
    }

    const nowIso = new Date().toISOString();
    // Conditional update with explicit affected row checking
    const updateResult = await db
      .update(familyInvitations)
      .set({
        status: 'rejected',
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(familyInvitations.id, inviteId),
          eq(familyInvitations.invitedEmail, currentUser.emailNormalized),
          eq(familyInvitations.status, 'pending'),
        ),
      )
      .returning({ id: familyInvitations.id });

    if (updateResult.length === 0) {
      return c.json(
        { error: 'INVITATION_INVALID', message: '該邀請狀態已改變或已被處理，無法拒絕' },
        400,
      );
    }

    return c.json({ success: true, message: '已拒絕該家庭邀請' }, 200);
  });

  return router;
}
