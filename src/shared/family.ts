import { z } from 'zod';
import { NormalizedEmailSchema } from './identity';

export const FamilyRoleSchema = z.enum(['admin', 'member']);
export type FamilyRole = z.infer<typeof FamilyRoleSchema>;

export const InvitationStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'revoked']);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

export const CreateFamilyRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '家庭名稱不可為空')
    .max(64, '家庭名稱不可超過 64 字元'),
});
export type CreateFamilyRequest = z.infer<typeof CreateFamilyRequestSchema>;

export const UpdateFamilyRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '家庭名稱不可為空')
    .max(64, '家庭名稱不可超過 64 字元'),
});
export type UpdateFamilyRequest = z.infer<typeof UpdateFamilyRequestSchema>;

export const InviteMemberRequestSchema = z.object({
  email: NormalizedEmailSchema,
  role: FamilyRoleSchema.default('member'),
});
export type InviteMemberRequest = z.infer<typeof InviteMemberRequestSchema>;

export const FamilyMemberSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: FamilyRoleSchema,
  displayName: z.string(),
  emailNormalized: z.string(),
  joinedAt: z.string(),
});
export type FamilyMemberSummary = z.infer<typeof FamilyMemberSummarySchema>;

export const FamilyInvitationSummarySchema = z.object({
  id: z.string(),
  familyId: z.string(),
  familyName: z.string(),
  invitedEmail: z.string(),
  invitedBy: z.string(),
  invitedByDisplayName: z.string(),
  role: FamilyRoleSchema,
  status: InvitationStatusSchema,
  createdAt: z.string(),
});
export type FamilyInvitationSummary = z.infer<typeof FamilyInvitationSummarySchema>;

export const FamilySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  myRole: FamilyRoleSchema,
  memberCount: z.number(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FamilySummary = z.infer<typeof FamilySummarySchema>;

export const FamilyDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  myRole: FamilyRoleSchema,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  members: z.array(FamilyMemberSummarySchema),
  pendingInvitations: z.array(FamilyInvitationSummarySchema).optional(),
});
export type FamilyDetail = z.infer<typeof FamilyDetailSchema>;
