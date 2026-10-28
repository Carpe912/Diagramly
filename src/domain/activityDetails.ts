import { z } from 'zod';
const ids = z.array(z.string().min(1).max(160)).max(100);
export const displaySettingsSchema = z
  .object({
    activityVisible: z.boolean(),
    keyStepVisible: z.boolean(),
    markVisible: z.boolean(),
    deviceVisible: z.boolean(),
    timeVisible: z.boolean(),
    cycleVisible: z.boolean(),
    exceptionsVisible: z.boolean(),
  })
  .partial()
  .strict();
/** 可选字段兼容旧文档，避免用默认值覆盖后端未返回的数据。 */
export const activityDetailsSchema = z
  .object({
    keyStep: z.string().max(100000),
    showInFlow: z.boolean(),
    markDiffWithCurrent: z.enum(['', '无', '新增', '优化', '删除']),
    actSystemUsed: z.string().max(160),
    terminals: ids,
    actDevicesUsed: ids,
    operateTypes: ids,
    needActTimeSchedule: z.boolean(),
    hoursOnceAct: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .refine((s) => Number(s) <= 100000),
    timeRanges: z
      .object({
        actTimeStart: z.number().int().min(0).max(23),
        actTimeEnd: z.number().int().min(0).max(23),
      })
      .strict()
      .nullable(),
    needActCycleSchedule: z.boolean(),
    isFixedCycle: z.boolean(),
    fixedCycleKey: z.enum(['', 'day', 'week', 'month']),
    fixedCycleWeekValues: z.array(z.string().regex(/^[1-7]$/)).max(7),
    fixedCycleMonthValues: z.array(z.string().regex(/^(?:[1-9]|[12]\d|3[01])$/)).max(31),
    nonFixedCycleDesc: z.string().max(10000),
    progressRate: z.number().min(0).max(100),
    linkFlow: z.string().max(160),
    interviewers: ids,
    interviewees: z
      .array(
        z.union([
          z.object({ accountId: z.string().min(1).max(160), from: z.literal('project') }).strict(),
          z.object({ clientId: z.string().min(1).max(160), from: z.literal('client') }).strict(),
        ]),
      )
      .max(100),
    displaySetting: displaySettingsSchema,
  })
  .partial()
  .strict();
export type ActivityDetails = z.infer<typeof activityDetailsSchema>;
export const defaultDisplaySettings = {
  activityVisible: true,
  keyStepVisible: true,
  markVisible: true,
  deviceVisible: false,
  timeVisible: false,
  cycleVisible: false,
  exceptionsVisible: false,
};
export const activityDetailFields = Object.keys(
  activityDetailsSchema.shape,
) as (keyof ActivityDetails)[];
