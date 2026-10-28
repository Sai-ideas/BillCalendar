import { z } from 'zod';

export const TEST_IDENTITY_SECURITY_NOTICE =
  '受控示範測試模式：Email 輸入僅用於模擬內部 user_id 身份，不具備真實身份驗證或安全隔離保證，嚴禁輸入真實個資、密碼或財務資料。' as const;

export const SYNTHETIC_IDENTITY_PRESETS = [
  {
    email: 'alice.demo@billcalendar.test',
    displayName: 'Alice (合成帳號 A)',
  },
  {
    email: 'bob.demo@billcalendar.test',
    displayName: 'Bob (合成帳號 B)',
  },
] as const;

/**
 * Normalizes an email address by trimming leading/trailing whitespace and lowercasing.
 */
export function normalizeEmail(rawEmail: string): string {
  return rawEmail.trim().toLowerCase();
}

/**
 * Derives a display name from custom input or the local part of a normalized email.
 */
export function deriveDisplayName(emailNormalized: string, customDisplayName?: string): string {
  const trimmed = customDisplayName?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }
  const localPart = emailNormalized.split('@')[0] ?? 'demo-user';
  return localPart;
}

export const NormalizedEmailSchema = z
  .string()
  .transform((val) => normalizeEmail(val))
  .pipe(
    z
      .string()
      .min(3, 'Email 長度過短')
      .max(254, 'Email 長度不可超過 254 字元')
      .email('請輸入有效的合成 Email 格式（例如 alice.demo@billcalendar.test）'),
  );

export const SelectTestIdentityRequestSchema = z.object({
  email: NormalizedEmailSchema,
  displayName: z
    .string()
    .trim()
    .max(64, '顯示名稱不可超過 64 字元')
    .optional(),
});

export type SelectTestIdentityRequest = z.infer<typeof SelectTestIdentityRequestSchema>;

export const SimulatedUserSchema = z.object({
  id: z.string().min(1),
  emailNormalized: z.string().email(),
  displayName: z.string().min(1),
  defaultTimezone: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type SimulatedUser = z.infer<typeof SimulatedUserSchema>;

export const TestIdentityStateResponseSchema = z.object({
  enabled: z.boolean(),
  simulationMode: z.literal(true),
  isAuthenticatedSecurity: z.literal(false),
  securityNotice: z.string(),
  sessionId: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  currentUser: SimulatedUserSchema.nullable(),
  availableUsers: z.array(SimulatedUserSchema),
});

export type TestIdentityStateResponse = z.infer<typeof TestIdentityStateResponseSchema>;
