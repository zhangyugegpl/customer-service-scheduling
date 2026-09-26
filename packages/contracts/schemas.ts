import { z } from 'zod';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const yearMonth = z.string().regex(/^\d{4}-\d{2}$/);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const employeeSchema = z.object({
  id: uuid,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  active: z.boolean(),
  skillPositionIds: z.array(uuid),
  monthlyRestDays: z.number().int().min(0).max(31),
});

export const positionSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(80),
  color,
  defaultMinQuota: z.number().int().min(0).max(999),
  dateQuotaOverrides: z.record(isoDate, z.number().int().min(0).max(999)),
});

export const rulesSchema = z.object({
  groups: z.array(z.object({ id: uuid, name: z.string().min(1), employeeIds: z.array(uuid).min(2) })),
  exclusionPairs: z.array(z.object({ id: uuid, name: z.string().min(1), employeeIds: z.tuple([uuid, uuid]) })),
  weeklyWorkMin: z.number().int().min(0).max(7),
  weeklyWorkMax: z.number().int().min(0).max(7),
  preferredWeeklyWorkDays: z.number().int().min(0).max(7),
  consecutiveRestSegmentsMin: z.number().int().min(0).max(31),
  consecutiveRestSegmentsMax: z.number().int().min(0).max(31),
  workBetweenRestMin: z.number().int().min(0).max(31),
  workBetweenRestMax: z.number().int().min(0).max(31),
  middleShiftMaxRange: z.number().int().min(0).max(31).default(3),
});

export const softKeySchema = z.enum(['S1', 'S2', 'S3', 'S4', 'S5']);
export const constraintModeSchema = z.enum(['SOFT', 'HARD']);

export const scheduleConfigSchema = z.object({
  schemaVersion: z.literal(1),
  templateVersion: z.string().min(1),
  id: uuid,
  name: z.string().min(1).max(100),
  updatedAt: z.string().datetime(),
  employees: z.array(employeeSchema).min(1),
  positions: z.array(positionSchema).min(1),
  rules: rulesSchema,
  softConstraints: z.object({
    highestPriority: z.array(softKeySchema),
    weights: z.object({
      S1: z.number().int().min(1).max(100),
      S2: z.number().int().min(1).max(100),
      S3: z.number().int().min(1).max(100),
      S4: z.number().int().min(1).max(100),
      S5: z.number().int().min(1).max(100),
    }),
    modes: z.object({
      S1: constraintModeSchema,
      S2: constraintModeSchema,
      S3: constraintModeSchema,
      S4: constraintModeSchema,
      S5: constraintModeSchema,
    }).default({ S1: 'SOFT', S2: 'SOFT', S3: 'SOFT', S4: 'SOFT', S5: 'SOFT' }),
  }),
  specifiedAssignments: z.array(z.object({
    id: uuid,
    employeeId: uuid,
    date: isoDate,
    endDate: isoDate.optional(),
    state: z.string().min(1),
    locked: z.literal(true),
  })),
  specifiedRestCounts: z.array(z.object({ id: uuid, date: isoDate, endDate: isoDate.optional(), count: z.number().int().min(0).max(999) })),
});

export const boundaryStateSchema = z.object({
  schemaVersion: z.literal(1),
  sourceMonth: yearMonth,
  sourceScheduleId: uuid.optional(),
  complete: z.boolean(),
  employees: z.array(z.object({
    employeeId: uuid,
    trailingWorkDays: z.number().int().min(0),
    trailingRestDays: z.number().int().min(0),
    recentStates: z.array(z.object({ date: isoDate, state: z.string().min(1) })),
  })),
});

export const assignmentSchema = z.object({
  employeeId: uuid,
  date: isoDate,
  state: z.string().min(1),
});

export const generateScheduleRequestSchema = z.object({
  config: scheduleConfigSchema,
  targetMonth: yearMonth,
  boundaryState: boundaryStateSchema.optional(),
  timeLimitSeconds: z.number().min(0.1).max(60).optional(),
  randomSeed: z.number().int().min(0).max(2_147_483_647).optional(),
  currentAssignments: z.array(assignmentSchema).optional(),
  requestedChange: z.object({ employeeId: uuid, date: isoDate, state: z.string().min(1) }).optional(),
});

export type ScheduleConfigInput = z.input<typeof scheduleConfigSchema>;
