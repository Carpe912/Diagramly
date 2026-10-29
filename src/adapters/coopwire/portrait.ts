import { z } from 'zod';
import { coopwireConfigSchema, type CoopwireConfig } from './api';
export const PORTRAIT_CHANNEL = 'diagramly.portrait';
export const businessSelectionSchema = z
  .object({
    projectId: z.string().min(1).max(100),
    flowId: z.string().min(1).max(100),
    flowchartType: z.string().min(1).max(40),
    sceneId: z.string().max(160),
    nodeId: z.string().min(1).max(100),
    actId: z.string().min(1).max(160),
    actType: z.enum([
      'manualOnline',
      'manualOffline',
      'systemOperate',
      'interfaceDocking',
      'decide',
      'subAct',
      'parallel',
      'linkAct',
    ]),
  })
  .strict();
export type BusinessSelection = z.infer<typeof businessSelectionSchema>;
export const linkedChoiceSchema = z
  .object({
    linkFlow: z.string().min(1).max(160),
    linkAct: z.string().min(1).max(160),
    showOrgName: z.boolean(),
  })
  .strict();
export type LinkedChoice = z.infer<typeof linkedChoiceSchema>;
const envelope = {
  channel: z.literal(PORTRAIT_CHANNEL),
  version: z.literal(1),
  sessionId: z.string().min(1).max(100),
};
const requestId = z.number().int().positive();
export const portraitEventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('ready') }),
  z.object({ ...envelope, type: z.literal('loaded'), requestId, actId: z.string() }),
  z.object({ ...envelope, type: z.literal('changed'), requestId, actId: z.string() }),
  z.object({ ...envelope, type: z.literal('close'), requestId, actId: z.string() }),
  z.object({ ...envelope, type: z.literal('linkedChosen'), requestId, form: linkedChoiceSchema }),
  z.object({ ...envelope, type: z.literal('linkedCancelled'), requestId }),
  z.object({
    ...envelope,
    type: z.literal('error'),
    requestId,
    actId: z.string(),
    message: z.string().max(2000),
  }),
]);
export function portraitUrl(
  origin: string,
  selection: BusinessSelection,
  sessionId: string,
  parentOrigin: string,
) {
  const target = new URL(origin || parentOrigin);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
    throw new Error('业务面板地址必须是无凭证的 HTTP(S) 地址');
  const url = new URL(
    `/enterprise/diagramly/portrait/${encodeURIComponent(selection.projectId)}`,
    target.origin,
  );
  url.search = new URLSearchParams({
    flowchart: '1',
    sessionId,
    parentOrigin,
    flowchartId: selection.flowId,
    flowchartType: selection.flowchartType,
    senceId: selection.sceneId,
  }).toString();
  return url;
}
/** 只接收流程图模式参数，草图、CSV 与锁消息不进入新编辑器。 */
export function flowchartContext(location: string) {
  const query = new URL(location).searchParams;
  if (query.get('flowchart') !== '1') return undefined;
  return {
    config: coopwireConfigSchema.parse({
      baseUrl: '',
      projectId: query.get('projectId'),
      flowchartId: query.get('flowchartId'),
      flowchartType: query.get('flowchartType') ?? 'tobe',
    }),
    sceneId: query.get('senceId') ?? query.get('sceneId') ?? '',
    source: query.get('source') ?? '',
  };
}
export function selectionFor(
  config: CoopwireConfig,
  nodeId: string,
  actId: string,
  actType: string,
  sceneId = '',
): BusinessSelection {
  return businessSelectionSchema.parse({
    projectId: config.projectId,
    flowId: config.flowchartId,
    flowchartType: config.flowchartType,
    nodeId,
    actId,
    actType,
    sceneId,
  });
}
