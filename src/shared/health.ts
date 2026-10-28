import { z } from 'zod';

export const DEFAULT_TIMEZONE = 'Asia/Taipei' as const;

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('billcalendar-api'),
  environment: z.string(),
  timezone: z.string(),
  timestamp: z.string().datetime(),
  database: z.object({
    connected: z.boolean(),
    migrated: z.boolean(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
