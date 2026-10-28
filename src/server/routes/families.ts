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

  // PATCH /api/families/:id/members/:userId - Update member role (admin handover, admin only)
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

    // If demoting an admin to member, ensure there is at least one OTHER admin remaining
    if (currentRole === 'admin' && newRole === 'member') {
      const adminCountRes = await db
        .select({ count: sql<number>`count(*)` })
        .from(familyMembers)
        .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.role, 'admin')));
      const adminCount = Number(adminCountRes[0]?.count ?? 1);
      if (adminCount <= 1) {
        return c.json(
          {
            error: 'LAST_ADMIN_CANNOT_LEAVE',
            message: '家庭必須至少保留一位管理員，不可降級最後一位管理員',
          },
          400,
        );
      }
    }

    const nowIso = new Date().toISOString();
    await db
      .update(familyMembers)
      .set({
        role: newRole,
        updatedAt: nowIso,
      })
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, targetUserId)));

    return c.json({ success: true, role: newRole }, 200);
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

  // POST /api/families/:id/invitations/:invId/revoke - Revoke invitation (admin only, conditional update)
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
    // Conditional update ensuring status is strictly 'pending' at update time
    await db
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
      );

    return c.json({ success: true, message: '邀請已撤銷' }, 200);
  });

  // DELETE /api/families/:id/members/:userId - Remove a member (admin only)
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

    if (targetMember[0].role === 'admin') {
      const adminCountRes = await db
        .select({ count: sql<number>`count(*)` })
        .from(familyMembers)
        .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.role, 'admin')));
      const adminCount = Number(adminCountRes[0]?.count ?? 1);
      if (adminCount <= 1) {
        return c.json(
          { error: 'LAST_ADMIN_CANNOT_LEAVE', message: '最後一位管理員不可被移除' },
          400,
        );
      }
    }

    await db
      .delete(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, targetUserId)));

    return c.json({ success: true, message: '成員已移除' }, 200);
  });

  // POST /api/families/:id/leave - Leave family
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

    if (membership[0].role === 'admin') {
      const adminCountRes = await db
        .select({ count: sql<number>`count(*)` })
        .from(familyMembers)
        .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.role, 'admin')));
      const adminCount = Number(adminCountRes[0]?.count ?? 1);
      if (adminCount <= 1) {
        return c.json(
          {
            error: 'LAST_ADMIN_CANNOT_LEAVE',
            message: '最後一位管理員不可在未交接前退出家庭，請先指定其他管理員',
          },
          400,
        );
      }
    }

    await db
      .delete(familyMembers)
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, currentUser.id)));

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

  // POST /api/invitations/:id/accept - Accept invitation (Atomic & True Idempotent)
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

    const nowIso = new Date().toISOString();

    // Check if invitation is not in pending status
    if (invite.status !== 'pending') {
      if (invite.status === 'accepted') {
        // True idempotency verification (Blocking 2):
        // Only return success if the user is STILL currently an active member of this family
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

        // User previously accepted but has since left or was removed; cannot reuse old accepted invitation
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

    // Atomic join (Blocking 3):
    // Check if user is somehow already in family_members (e.g. added through another invitation or race)
    const existingMember = await db
      .select()
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, invite.familyId),
          eq(familyMembers.userId, currentUser.id),
        ),
      )
      .limit(1);

    if (existingMember.length === 0) {
      await db.batch([
        db.insert(familyMembers).values({
          id: crypto.randomUUID(),
          familyId: invite.familyId,
          userId: currentUser.id,
          role: invite.role,
          joinedAt: nowIso,
          updatedAt: nowIso,
        }),
        db
          .update(familyInvitations)
          .set({
            status: 'accepted',
            updatedAt: nowIso,
          })
          .where(
            and(
              eq(familyInvitations.id, inviteId),
              eq(familyInvitations.status, 'pending'),
            ),
          ),
      ]);
    } else {
      await db
        .update(familyInvitations)
        .set({
          status: 'accepted',
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(familyInvitations.id, inviteId),
            eq(familyInvitations.status, 'pending'),
          ),
        );
    }

    return c.json({ success: true, message: '成功加入家庭', familyId: invite.familyId }, 200);
  });

  // POST /api/invitations/:id/reject - Reject invitation (conditional update)
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
    await db
      .update(familyInvitations)
      .set({
        status: 'rejected',
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(familyInvitations.id, inviteId),
          eq(familyInvitations.status, 'pending'),
        ),
      );

    return c.json({ success: true, message: '已拒絕該家庭邀請' }, 200);
  });

  return router;
}
