import { z } from 'zod';
import { FamilyRoleSchema } from './family';

export const DATA_OWNERSHIP_SECURITY_NOTICE =
  '受控示範權限警示：測試 Email 身份切換僅用於檢驗應用層 user_id 歸屬、family_members 成員資格與跨空間來源／目標雙端授權邏輯隔離，不提供真實身份驗證或加密安全保證。' as const;

export const ResourceScopeSchema = z.enum(['personal', 'family']);
export type ResourceScope = z.infer<typeof ResourceScopeSchema>;

export const SourceMessageStatusSchema = z.enum([
  'none',
  'accessible',
  'deleted',
  'inaccessible',
]);
export type SourceMessageStatus = z.infer<typeof SourceMessageStatusSchema>;

export const LocalDateStringSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必須為 YYYY-MM-DD');

export const AuthorizedSpaceOverviewSchema = z.object({
  simulationMode: z.literal(true),
  isAuthenticatedSecurity: z.literal(false),
  securityNotice: z.string(),
  personalSpace: z.object({
    ownerUserId: z.string(),
    calendarId: z.string(),
    taskListId: z.string(),
    ledgerId: z.string(),
    chatRoomId: z.string(),
  }),
  familySpaces: z.array(
    z.object({
      familyId: z.string(),
      familyName: z.string(),
      role: FamilyRoleSchema,
      calendarId: z.string(),
      taskListId: z.string(),
      ledgerId: z.string(),
      chatRoomId: z.string(),
    }),
  ),
});
export type AuthorizedSpaceOverview = z.infer<typeof AuthorizedSpaceOverviewSchema>;

// --- Diaries (Strictly Personal: user_id only, never family shared) ---

export const CreateDiaryRequestSchema = z.object({
  entryDate: LocalDateStringSchema,
  title: z
    .string()
    .trim()
    .min(1, '日記標題不可為空')
    .max(120, '日記標題不可超過 120 字元'),
  body: z
    .string()
    .trim()
    .min(1, '日記內容不可為空')
    .max(10000, '日記內容不可超過 10000 字元'),
});
export type CreateDiaryRequest = z.infer<typeof CreateDiaryRequestSchema>;

export const UpdateDiaryRequestSchema = z
  .object({
    entryDate: LocalDateStringSchema.optional(),
    title: z
      .string()
      .trim()
      .min(1, '日記標題不可為空')
      .max(120, '日記標題不可超過 120 字元')
      .optional(),
    body: z
      .string()
      .trim()
      .min(1, '日記內容不可為空')
      .max(10000, '日記內容不可超過 10000 字元')
      .optional(),
  })
  .refine(
    (val) => val.entryDate !== undefined || val.title !== undefined || val.body !== undefined,
    '請至少提供一項要更新的日記欄位',
  );
export type UpdateDiaryRequest = z.infer<typeof UpdateDiaryRequestSchema>;

export const DiaryEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  entryDate: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DiaryEntry = z.infer<typeof DiaryEntrySchema>;

// --- Chat Rooms & Messages ---

export const ChatRoomSummarySchema = z.object({
  id: z.string(),
  kind: ResourceScopeSchema,
  userId: z.string().nullable(),
  familyId: z.string().nullable(),
  timezone: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatRoomSummary = z.infer<typeof ChatRoomSummarySchema>;

export const CreateMessageRequestSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, '訊息內容不可為空')
    .max(4000, '訊息內容不可超過 4000 字元'),
  localDate: LocalDateStringSchema.optional(),
  recordDate: LocalDateStringSchema.nullable().optional(),
});
export type CreateMessageRequest = z.infer<typeof CreateMessageRequestSchema>;

export const DerivedTaskSummarySchema = z.object({
  id: z.string(),
  scope: ResourceScopeSchema,
  ownerUserId: z.string().nullable(),
  familyId: z.string().nullable(),
  title: z.string(),
  dueDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DerivedTaskSummary = z.infer<typeof DerivedTaskSummarySchema>;

export const DerivedEventSummarySchema = z.object({
  id: z.string(),
  scope: ResourceScopeSchema,
  ownerUserId: z.string().nullable(),
  familyId: z.string().nullable(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  allDay: z.boolean(),
  createdAt: z.string(),
});
export type DerivedEventSummary = z.infer<typeof DerivedEventSummarySchema>;

export const MessageWithAuthorizedDerivedSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  roomKind: ResourceScopeSchema,
  familyId: z.string().nullable(),
  senderUserId: z.string(),
  body: z.string(),
  localDate: z.string(),
  recordDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  derivedTasks: z.array(DerivedTaskSummarySchema),
  derivedEvents: z.array(DerivedEventSummarySchema),
  derivedCount: z.number().int().nonnegative(),
});
export type MessageWithAuthorizedDerived = z.infer<typeof MessageWithAuthorizedDerivedSchema>;

export const SourceMessagePreviewSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  roomKind: ResourceScopeSchema,
  familyId: z.string().nullable(),
  senderUserId: z.string(),
  body: z.string(),
  localDate: z.string(),
  recordDate: z.string().nullable(),
  createdAt: z.string(),
});
export type SourceMessagePreview = z.infer<typeof SourceMessagePreviewSchema>;

// --- Tasks (Personal or Family, with optional source_message_id) ---

export const CreateTaskRequestSchema = z
  .object({
    scope: ResourceScopeSchema.default('personal'),
    familyId: z.string().trim().min(1).optional(),
    title: z
      .string()
      .trim()
      .min(1, '待辦標題不可為空')
      .max(200, '待辦標題不可超過 200 字元'),
    dueDate: LocalDateStringSchema.nullable().optional(),
    sourceMessageId: z.string().trim().min(1).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scope === 'family' && !val.familyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['familyId'],
        message: '家庭空間待辦必須指定 familyId',
      });
    }
    if (val.scope === 'personal' && val.familyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['familyId'],
        message: '個人空間待辦不可指定 familyId',
      });
    }
  });
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, '待辦標題不可為空')
      .max(200, '待辦標題不可超過 200 字元')
      .optional(),
    dueDate: LocalDateStringSchema.nullable().optional(),
    completed: z.boolean().optional(),
  })
  .refine(
    (val) => val.title !== undefined || val.dueDate !== undefined || val.completed !== undefined,
    '請至少提供一項要更新的待辦欄位',
  );
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

export const TaskDetailSchema = z.object({
  id: z.string(),
  listId: z.string(),
  scope: ResourceScopeSchema,
  ownerUserId: z.string().nullable(),
  familyId: z.string().nullable(),
  title: z.string(),
  dueDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  sourceMessageId: z.string().nullable(),
  sourceStatus: SourceMessageStatusSchema,
  sourceMessage: SourceMessagePreviewSchema.nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

// --- Events (Personal or Family, with optional source_message_id) ---

export const CreateEventRequestSchema = z
  .object({
    scope: ResourceScopeSchema.default('personal'),
    familyId: z.string().trim().min(1).optional(),
    title: z
      .string()
      .trim()
      .min(1, '事件標題不可為空')
      .max(200, '事件標題不可超過 200 字元'),
    description: z.string().trim().max(4000).nullable().optional(),
    startsAt: z.string().trim().min(1, '必須提供開始時間或日期'),
    endsAt: z.string().trim().min(1, '必須提供結束時間或日期'),
    allDay: z.boolean().default(false),
    timezone: z.string().trim().min(1).default('Asia/Taipei'),
    sourceMessageId: z.string().trim().min(1).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scope === 'family' && !val.familyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['familyId'],
        message: '家庭空間事件必須指定 familyId',
      });
    }
    if (val.scope === 'personal' && val.familyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['familyId'],
        message: '個人空間事件不可指定 familyId',
      });
    }
  });
export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;

export const UpdateEventRequestSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, '事件標題不可為空')
      .max(200, '事件標題不可超過 200 字元')
      .optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    startsAt: z.string().trim().min(1).optional(),
    endsAt: z.string().trim().min(1).optional(),
    allDay: z.boolean().optional(),
    timezone: z.string().trim().min(1).optional(),
  })
  .refine(
    (val) =>
      val.title !== undefined ||
      val.description !== undefined ||
      val.startsAt !== undefined ||
      val.endsAt !== undefined ||
      val.allDay !== undefined ||
      val.timezone !== undefined,
    '請至少提供一項要更新的事件欄位',
  );
export type UpdateEventRequest = z.infer<typeof UpdateEventRequestSchema>;

export const EventDetailSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  scope: ResourceScopeSchema,
  ownerUserId: z.string().nullable(),
  familyId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  allDay: z.boolean(),
  timezone: z.string(),
  sourceMessageId: z.string().nullable(),
  sourceStatus: SourceMessageStatusSchema,
  sourceMessage: SourceMessagePreviewSchema.nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EventDetail = z.infer<typeof EventDetailSchema>;
