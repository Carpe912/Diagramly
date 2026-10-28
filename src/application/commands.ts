import { z } from 'zod';
import {
  appearanceSchema,
  boundsSchema,
  canvasSettingsSchema,
  edgeSchema,
  entitySchema,
  idSchema,
  nodeSchema,
} from '../domain/model';

export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('node.create'), node: nodeSchema, entity: entitySchema }).strict(),
  z
    .object({
      type: z.literal('node.update'),
      id: idSchema,
      patch: entitySchema.omit({ id: true }).partial(),
    })
    .strict(),
  z
    .object({
      type: z.literal('node.move'),
      id: idSchema,
      x: z.number().finite(),
      y: z.number().finite(),
      parentId: idSchema.nullable().optional(),
    })
    .strict(),
  z.object({ type: z.literal('node.resize'), id: idSchema, bounds: boundsSchema }).strict(),
  z
    .object({
      type: z.literal('node.appearance'),
      id: idSchema,
      ...appearanceSchema.partial().shape,
    })
    .strict()
    .refine(
      (op) => Object.keys(op).some((key) => key !== 'type' && key !== 'id'),
      '至少指定一种外观属性',
    ),
  z.object({ type: z.literal('node.delete'), id: idSchema }).strict(),
  z
    .object({
      type: z.literal('node.duplicate'),
      id: idSchema,
      newId: idSchema,
      newEntityId: idSchema,
      offset: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('pool.orientation'),
      id: idSchema,
      orientation: z.enum(['horizontal', 'vertical']),
    })
    .strict(),
  z
    .object({
      type: z.literal('pool.lane.add'),
      poolId: idSchema,
      laneId: idSchema,
      entityId: idSchema,
      name: z.string().trim().min(1).max(160),
      index: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ type: z.literal('pool.lane.remove'), poolId: idSchema, laneId: idSchema }).strict(),
  z.object({ type: z.literal('pool.lane.move'), laneId: idSchema, poolId: idSchema }).strict(),
  z
    .object({
      type: z.literal('lane.roles.set'),
      laneId: idSchema,
      roles: z
        .array(
          z
            .object({ id: z.string().min(1).max(160), name: z.string().trim().min(1).max(160) })
            .strict(),
        )
        .max(100)
        .refine(
          (roles) => new Set(roles.map((role) => role.id)).size === roles.length,
          '不能重复选择角色',
        ),
    })
    .strict(),
  z
    .object({
      type: z.literal('pool.lane.resize'),
      laneId: idSchema,
      extent: z.number().finite().min(140).max(10000),
      crossExtent: z.number().finite().min(140).max(10000).optional(),
    })
    .strict(),
  z.object({ type: z.literal('edge.create'), edge: edgeSchema }).strict(),
  z
    .object({
      type: z.literal('edge.update'),
      id: idSchema,
      patch: edgeSchema.omit({ id: true }).partial(),
    })
    .strict(),
  z.object({ type: z.literal('edge.delete'), id: idSchema }).strict(),
  z
    .object({ type: z.literal('document.canvas.update'), patch: canvasSettingsSchema.partial() })
    .strict(),
  z
    .object({ type: z.literal('document.rename'), title: z.string().trim().min(1).max(160) })
    .strict(),
]);
export const commandSchema = z
  .object({
    commandId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    origin: z.enum(['user', 'agent', 'system']),
    label: z.string().min(1).max(160),
    operations: z.array(operationSchema).min(1).max(500),
  })
  .strict();
export type Operation = z.infer<typeof operationSchema>;
export type Command = z.infer<typeof commandSchema>;
