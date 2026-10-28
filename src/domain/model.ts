import { z } from 'zod';
import { activityDetailsSchema } from './activityDetails';

export const idSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/)
  .refine((id) => !['__proto__', 'prototype', 'constructor'].includes(id), '保留的 ID');
export const boundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().min(24).max(10000),
    height: z.number().finite().min(24).max(10000),
  })
  .strict();
export const entitySchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().max(10000),
    code: z.string().max(60),
    activityType: z.enum(['manual', 'offline', 'system', 'interface', 'linked']),
    critical: z.boolean(),
    inputs: z.array(z.string().max(160)).max(100),
    outputs: z.array(z.string().max(160)).max(100),
    role: z.string().max(160),
    roleIds: z.array(z.string().min(1).max(160)).max(100).default([]),
    details: activityDetailsSchema.optional(),
    // 远程业务标识显式保存，独立于图形节点和本地实体 ID。
    externalRef: z
      .object({
        provider: z.string().min(1).max(80),
        id: z.string().min(1).max(160),
        version: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const appearanceSchema = z
  .object({
    accent: colorSchema,
    fill: colorSchema.optional(),
    headerFill: colorSchema.optional(),
    fontColor: colorSchema.optional(),
  })
  .strict();
export const nodeSchema = z
  .object({
    id: idSchema,
    type: z.string().min(1).max(100),
    shapeVersion: z.literal(1),
    entityId: idSchema,
    parentId: idSchema.optional(),
    laneOrder: z.number().int().nonnegative().optional(),
    bounds: boundsSchema,
    appearance: appearanceSchema,
  })
  .strict();
export const endpointSchema = z
  .object({ nodeId: idSchema, portId: z.string().min(1).max(40) })
  .strict();
export const edgeSchema = z
  .object({
    id: idSchema,
    source: endpointSchema,
    target: endpointSchema,
    label: z.string().max(200),
  })
  .strict();
export const documentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    title: z.string().trim().min(1).max(160),
    revision: z.number().int().nonnegative(),
    policies: z.object({ activityRequiresLane: z.boolean() }).strict(),
    nodes: z.record(idSchema, nodeSchema),
    edges: z.record(idSchema, edgeSchema),
    entities: z.record(idSchema, entitySchema),
  })
  .strict();
export type Bounds = z.infer<typeof boundsSchema>;
export type BusinessEntity = z.infer<typeof entitySchema>;
export type DiagramNode = z.infer<typeof nodeSchema>;
export type DiagramEdge = z.infer<typeof edgeSchema>;
export type DiagramDocument = z.infer<typeof documentSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export function emptyDocument(): DiagramDocument {
  return {
    schemaVersion: 1,
    id: newId('doc'),
    title: '未命名画布',
    revision: 0,
    policies: { activityRequiresLane: false },
    nodes: {},
    edges: {},
    entities: {},
  };
}
export function newEntity(id: string, name: string): BusinessEntity {
  return {
    id,
    name,
    description: '',
    code: '',
    activityType: 'manual',
    critical: false,
    inputs: [],
    outputs: [],
    role: '',
    roleIds: [],
  };
}
