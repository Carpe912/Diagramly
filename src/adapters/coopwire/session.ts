import type { EditorTransport, RemoteCommit } from '../../application/transport';
import { newId, type DiagramDocument, type DiagramNode } from '../../domain/model';
import {
  activityDetailFields,
  defaultDisplaySettings,
  type ActivityDetails,
} from '../../domain/activityDetails';
import type { ShapeRegistry } from '../../shapes/registry';
import { validateDocument } from '../../domain/validation';
import { layoutPool, poolOf } from '../../domain/pools';
import {
  activityType,
  flowRelations,
  hydrateEntity,
  isBusinessNode,
  readFlow,
  writeFlow,
} from './codec';
import {
  CoopwireApi,
  CoopwireError,
  type ActivityDetail,
  type Organization,
  type BusinessMutation,
} from './api';

export interface JournalStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface Journal {
  commandId: string;
  fingerprint: string;
  request: RemoteCommit;
  remoteVersion: number;
  results: Record<string, unknown>;
  started?: string;
  uncertain: boolean;
}
export interface RemoteStatus {
  state: 'ready' | 'saving' | 'failed' | 'uncertain';
  message: string;
}
const emptyDetails: Required<ActivityDetails> = {
  keyStep: '',
  showInFlow: false,
  markDiffWithCurrent: '',
  actSystemUsed: '',
  inputSystemOrDeviceId: '',
  outputSystemOrDeviceId: '',
  inputSystemOrDeviceType: '',
  outputSystemOrDeviceType: '',
  providerApi: false,
  interfaceDesigns: [],
  terminals: [],
  actDevicesUsed: [],
  operateTypes: [],
  needActTimeSchedule: false,
  hoursOnceAct: '0',
  timeRanges: null,
  needActCycleSchedule: false,
  isFixedCycle: true,
  fixedCycleKey: '',
  fixedCycleWeekValues: [],
  fixedCycleMonthValues: [],
  nonFixedCycleDesc: '',
  progressRate: 0,
  linkFlow: '',
  linkAct: '',
  showOrgName: false,
  interviewers: [],
  interviewees: [],
  displaySetting: defaultDisplaySettings,
};
export class CoopwireSession implements EditorTransport {
  readonly journalKey: string;
  private pending?: Journal;
  private resourcePending = false;
  private synchronizingResource = false;
  private version = 0;
  private status: RemoteStatus = { state: 'ready', message: '未连接' };
  private listener: (status: RemoteStatus) => void = () => {};
  private knownEntities = new Map<
    string,
    NonNullable<DiagramDocument['entities'][string]['externalRef']>
  >();
  organizations: Organization[] = [];
  activityDetails = new Map<string, ActivityDetail>();
  warnings: string[] = [];
  legacySource?: string;
  constructor(
    readonly api: CoopwireApi,
    private registry: ShapeRegistry,
    private png: (document: DiagramDocument) => Promise<Blob>,
    private storage: JournalStore = localStorage,
  ) {
    this.journalKey = `diagramly.coopwire.journal:${encodeURIComponent(JSON.stringify(api.config))}`;
    this.resourcePending = !!storage.getItem(`${this.journalKey}:business`);
    const stored = storage.getItem(this.journalKey);
    if (stored) {
      this.pending = JSON.parse(stored) as Journal;
      this.status = {
        state: 'uncertain',
        message: '存在上次未完成事务，请先重新读取远端核对；待处理文档已保留',
      };
    }
    if (this.resourcePending)
      this.status = {
        state: 'uncertain',
        message: '业务记录保存结果待核对，请先读取远端，避免重复新增',
      };
  }
  onStatus(listener: (status: RemoteStatus) => void) {
    this.listener = listener;
    listener(this.status);
  }
  get remoteVersion() {
    return this.version;
  }
  get pendingDocument() {
    return this.pending ? structuredClone(this.pending.request.document) : undefined;
  }
  private report(state: RemoteStatus['state'], message: string) {
    this.status = { state, message };
    this.listener(this.status);
  }
  async open(): Promise<DiagramDocument> {
    const [flow, organizations] = await Promise.all([this.api.flow(), this.api.organizations()]);
    const loaded = readFlow(flow, this.registry);
    this.organizations = organizations;
    this.warnings = loaded.warnings;
    this.legacySource = loaded.legacySource;
    this.version = flow.version;
    const document = loaded.document;
    for (const node of Object.values(document.nodes).filter(isBusinessNode)) {
      const entity = document.entities[node.entityId];
      if (entity.externalRef?.provider === 'coopwire') {
        const detail = await this.api.activity(entity.externalRef.id);
        hydrateEntity(document, node, detail);
        this.activityDetails.set(entity.externalRef.id, detail);
        this.knownEntities.set(entity.id, structuredClone(entity.externalRef));
      }
    }
    if (!this.pending && !this.resourcePending)
      this.report('ready', `已连接 Coopwire · v${this.version}`);
    return validateDocument(document, this.registry);
  }
  /** 用户主动恢复时，先备份事务日志，再接受当前远程状态。 */
  async reloadAndReconcile() {
    const document = await this.open();
    if (this.pending) {
      this.storage.setItem(`${this.journalKey}:recovery`, JSON.stringify(this.pending));
      this.storage.removeItem(this.journalKey);
      this.pending = undefined;
    }
    this.storage.removeItem(`${this.journalKey}:business`);
    this.resourcePending = false;
    this.report('ready', `已重新加载远端 · v${this.version}`);
    return document;
  }
  async editBusiness(before: DiagramDocument, actId: string, mutation: BusinessMutation) {
    if (this.pending || this.resourcePending) throw new Error('存在未确认的保存，请先读取远端核对');
    if (
      !Object.values(before.nodes).some(
        (node) => isBusinessNode(node) && before.entities[node.entityId].externalRef?.id === actId,
      )
    )
      throw new Error('业务活动不属于当前画布');
    const latest = await this.api.activity(actId);
    this.storage.setItem(
      `${this.journalKey}:business`,
      JSON.stringify({ actId, kind: mutation.kind, action: mutation.action }),
    );
    this.resourcePending = true;
    this.report('saving', '正在保存业务记录…');
    let saved = false;
    try {
      await this.api.mutateBusiness(actId, latest.activity.version, mutation);
      saved = true;
      this.synchronizingResource = true;
      const document = await this.refreshActivities(before, [actId]);
      this.storage.removeItem(`${this.journalKey}:business`);
      this.resourcePending = false;
      return document;
    } catch (e) {
      if (
        !saved &&
        e instanceof CoopwireError &&
        ['auth', 'conflict', 'rejected'].includes(e.kind)
      ) {
        this.storage.removeItem(`${this.journalKey}:business`);
        this.resourcePending = false;
        this.report('ready', e.message);
      } else {
        this.report('uncertain', '业务记录或流程保存结果待核对，请读取远端；不会重复新增');
      }
      throw e;
    } finally {
      this.synchronizingResource = false;
    }
  }
  /** 表单负责业务写入，这里只读取最新实体并保存派生的流程 XML／PNG。 */
  async refreshActivities(before: DiagramDocument, actIds: string[]) {
    if (this.pending) throw new Error('存在未完成保存，请先重新读取远端核对');
    const baseline = structuredClone(before),
      nodes = Object.values(baseline.nodes).filter((node) =>
        actIds.includes(baseline.entities[node.entityId].externalRef?.id ?? ''),
      );
    if (
      !actIds.length ||
      actIds.some(
        (id) => !nodes.some((node) => baseline.entities[node.entityId].externalRef?.id === id),
      )
    )
      throw new Error('业务活动不属于当前画布');
    const pools = new Set<string>();
    for (const node of nodes) {
      const id = baseline.entities[node.entityId].externalRef!.id,
        detail = await this.api.activity(id);
      if (detail.activity.id !== id) throw new Error('业务详情返回了不匹配的活动 ID');
      hydrateEntity(baseline, node, detail);
      this.activityDetails.set(id, detail);
      node.type =
        detail.activity.actType === 'decide'
          ? 'decision'
          : detail.activity.actType === 'subAct'
            ? 'subprocess'
            : detail.activity.actType === 'parallel'
              ? 'parallel'
              : 'activity';
      const definition = this.registry.get(node.type);
      node.bounds.width = Math.max(node.bounds.width, definition.minSize[0]);
      node.bounds.height = Math.max(node.bounds.height, definition.minSize[1]);
      const pool = poolOf(baseline, node);
      if (pool) pools.add(pool.id);
    }
    for (const id of pools) layoutPool(baseline, id);
    const document = validateDocument(
      { ...baseline, revision: before.revision + 1 },
      this.registry,
    );
    return this.commit({
      kind: 'command',
      before: baseline,
      document,
      command: {
        commandId: newId('external'),
        expectedRevision: before.revision,
        origin: 'system',
        label: '同步业务详情',
        operations: [{ type: 'document.rename', title: document.title }],
      },
    });
  }
  private persist() {
    if (this.pending) this.storage.setItem(this.journalKey, JSON.stringify(this.pending));
  }
  private async writeStep<T>(key: string, write: () => Promise<T>): Promise<T> {
    const journal = this.pending!;
    if (Object.hasOwn(journal.results, key)) return structuredClone(journal.results[key]) as T;
    journal.started = key;
    this.persist();
    try {
      const result = await write();
      journal.results[key] = result === undefined ? null : structuredClone(result);
      delete journal.started;
      this.persist();
      return result;
    } catch (error) {
      journal.uncertain = !(
        error instanceof CoopwireError && ['rejected', 'auth', 'conflict'].includes(error.kind)
      );
      if (!journal.uncertain) delete journal.started;
      try {
        this.persist();
      } catch {
        journal.uncertain = true;
      }
      throw error;
    }
  }
  private orgIds(doc: DiagramDocument, node: DiagramNode) {
    return doc.entities[doc.nodes[node.parentId ?? node.id]?.entityId]?.roleIds ?? [];
  }
  async commit(request: RemoteCommit): Promise<DiagramDocument> {
    if (this.resourcePending && !this.synchronizingResource)
      throw new Error('业务保存结果待核对，请先读取远端');
    const fingerprint = JSON.stringify(request);
    if (this.pending) {
      if (
        this.pending.commandId !== request.command.commandId ||
        this.pending.fingerprint !== fingerprint
      )
        throw new Error('上次远程事务尚未完成；请重试原命令或重新加载远端核对');
      if (this.pending.uncertain || this.pending.started)
        throw new Error('上次写入结果未确认，已禁止重发；请重新加载远端并核对待处理文档');
    }
    const desired = validateDocument(request.document, this.registry),
      before = request.before;
    if (request.kind === 'command')
      for (const operation of request.command.operations) {
        if (operation.type !== 'lane.roles.set') continue;
        for (const role of operation.roles) {
          if (
            !this.organizations.some((org) => org.orgId === role.id && org.orgName === role.name)
          ) {
            throw new Error('泳道角色必须来自当前项目的角色选项');
          }
        }
      }
    const business = Object.values(desired.nodes).filter(isBusinessNode);
    const ids = new Set<string>();
    for (const node of business) {
      const entity = desired.entities[node.entityId],
        old = before.entities[node.entityId];
      if (!old && entity.externalRef && request.kind === 'command')
        throw new Error('新建节点不能注入远程业务 ID，请使用创建或复制命令');
      if (entity.externalRef && entity.externalRef.provider !== 'coopwire')
        throw new Error('不能将其他系统的业务引用写入 Coopwire');
      if (
        old &&
        JSON.stringify(entity.externalRef) !== JSON.stringify(old.externalRef) &&
        request.kind === 'command'
      )
        throw new Error('业务引用由远程适配器维护，不能通过普通命令修改');
      if (entity.externalRef) {
        if (ids.has(entity.externalRef.id))
          throw new Error('同一远程活动不能重复放置，请使用复制活动');
        ids.add(entity.externalRef.id);
      }
      if (
        !entity.externalRef &&
        entity.activityType === 'linked' &&
        (!entity.details?.linkFlow || !entity.details?.linkAct)
      )
        throw new Error('引用活动必须先选择关联流程和活动');
      if ((!node.parentId || !this.orgIds(desired, node).length) && !entity.externalRef)
        throw new Error('Coopwire 业务节点必须放在已选择组织角色的泳道内');
    }
    // 任何写入前先核对版本；重试时跳过日志中已确认的步骤。
    const flow = await this.api.flow();
    if (flow.version !== this.version)
      throw new CoopwireError('远端流程版本已变化，请重新加载后再编辑', 'conflict');
    if (!this.pending) {
      const expected = new Map<
        string,
        NonNullable<DiagramDocument['entities'][string]['externalRef']>
      >();
      for (const node of Object.values(before.nodes).filter(isBusinessNode)) {
        const entity = before.entities[node.entityId];
        if (entity.externalRef) expected.set(entity.externalRef.id, entity.externalRef);
      }
      for (const node of business) {
        const entity = desired.entities[node.entityId];
        const ref = this.knownEntities.get(entity.id) ?? entity.externalRef;
        if (ref && !expected.has(ref.id)) expected.set(ref.id, ref);
      }
      for (const ref of expected.values()) {
        if (ref) {
          const detail = await this.api.activity(ref.id);
          if (ref.version !== undefined && detail.activity.version !== ref.version)
            throw new CoopwireError('远端活动已被其他用户修改，请重新加载', 'conflict');
        }
      }
      this.pending = {
        commandId: request.command.commandId,
        fingerprint,
        request: structuredClone(request),
        remoteVersion: this.version,
        results: {},
        uncertain: false,
      };
      this.persist();
    }
    this.report('saving', '正在提交 Coopwire 业务与流程…');
    try {
      // 先验证图形导出，避免导出失败后遗留新建的远程活动。
      const png = await this.png(desired);
      if (png.type !== 'image/png' || !png.size) throw new Error('流程预览图导出失败');
      for (const node of business) {
        const entity = desired.entities[node.entityId],
          old = before.entities[node.entityId];
        const duplicate =
          request.kind === 'command'
            ? request.command.operations.find(
                (op) => op.type === 'node.duplicate' && op.newId === node.id,
              )
            : undefined;
        const sourceEntity =
          duplicate?.type === 'node.duplicate'
            ? before.entities[before.nodes[duplicate.id]?.entityId ?? '']
            : undefined;
        const baseline = old ?? sourceEntity;
        const baselineNode =
          before.nodes[node.id] ??
          (duplicate?.type === 'node.duplicate' ? before.nodes[duplicate.id] : undefined);
        let ref = entity.externalRef ?? this.knownEntities.get(entity.id);
        if (!ref) {
          const source = sourceEntity?.externalRef;
          let remoteId: string;
          if (source)
            remoteId = await this.writeStep(`copy:${node.id}`, () =>
              this.api.copyActivity(source.id, entity.name),
            );
          else {
            const key = `create-id:${node.id}`;
            if (!this.pending.results[key]) {
              this.pending.results[key] = newId('act').slice(4, 28);
              this.persist();
            }
            remoteId = await this.writeStep(`create:${node.id}`, () =>
              this.api.createActivity(String(this.pending!.results[key]), {
                actName: entity.name,
                actType: activityType(node, entity),
                orgId: this.orgIds(desired, node),
                belongId: this.api.config.flowchartId,
                belongType: `${this.api.config.flowchartType}Act`,
                ...(entity.activityType === 'linked'
                  ? {
                      linkFlow: entity.details!.linkFlow,
                      linkAct: entity.details!.linkAct,
                      showOrgName: entity.details!.showOrgName ?? false,
                    }
                  : {}),
              }),
            );
          }
          ref = { provider: 'coopwire', id: remoteId };
        }
        let detail = await this.api.activity(ref.id);
        const orgIds = this.orgIds(desired, node);
        const patch: Record<string, unknown> = {};
        if (!baseline || entity.name !== baseline.name) patch.actName = entity.name;
        if (!baseline || entity.critical !== baseline.critical) patch.isKeyStep = entity.critical;
        if (
          (!baseline && entity.code) ||
          (baseline && entity.code !== baseline.code && !!entity.code)
        )
          patch.code = entity.code;
        if (!baseline || entity.activityType !== baseline.activityType)
          patch.actType = activityType(node, entity);
        for (const key of activityDetailFields) {
          if (key === 'keyStep' || key === 'timeRanges') continue;
          if (
            !baseline &&
            entity.activityType === 'linked' &&
            ['linkFlow', 'linkAct', 'showOrgName'].includes(key)
          )
            continue;
          if (JSON.stringify(entity.details?.[key]) !== JSON.stringify(baseline?.details?.[key])) {
            patch[key] = entity.details?.[key] ?? emptyDetails[key];
            if (key === 'displaySetting')
              patch[key] = {
                ...((detail.activity.displaySetting as Record<string, unknown>) ?? {}),
                ...(patch[key] as Record<string, unknown>),
              };
          }
        }
        const oldOrgIds = baselineNode ? this.orgIds(before, baselineNode) : undefined;
        if (
          (oldOrgIds && JSON.stringify(oldOrgIds) !== JSON.stringify(orgIds)) ||
          (!baselineNode && !!entity.externalRef && orgIds.length)
        )
          patch.orgId = orgIds;
        if (Object.keys(patch).length) {
          await this.writeStep(`update:${node.id}`, () =>
            this.api.updateActivity(ref!.id, detail.activity.version, {
              ...(orgIds.length ? { orgId: orgIds } : {}),
              ...patch,
            }),
          );
          detail = await this.api.activity(ref.id);
        }
        if (
          (!baseline && entity.description) ||
          (baseline && entity.description !== baseline.description)
        ) {
          await this.writeStep(`description:${node.id}`, () =>
            this.api.updateDescription(
              ref!.id,
              detail.activity.version,
              orgIds,
              entity.description,
            ),
          );
          detail = await this.api.activity(ref.id);
        }
        if (entity.details?.keyStep !== baseline?.details?.keyStep) {
          await this.writeStep(`key-step:${node.id}`, () =>
            this.api.updateDescription(
              ref!.id,
              detail.activity.version,
              orgIds,
              entity.details?.keyStep ?? '',
              'keyStep',
            ),
          );
          detail = await this.api.activity(ref.id);
        }
        if (
          JSON.stringify(entity.details?.timeRanges) !==
          JSON.stringify(baseline?.details?.timeRanges)
        ) {
          const range = detail.activity.timeRanges as { id?: string } | undefined;
          await this.writeStep(`time-range:${node.id}`, () =>
            this.api.saveTimeRange(
              ref!.id,
              detail.activity.version,
              entity.details?.timeRanges ?? null,
              range?.id,
            ),
          );
          detail = await this.api.activity(ref.id);
        }
        for (const [field, direction] of [
          ['inputs', 'input'],
          ['outputs', 'output'],
        ] as const) {
          if (baseline && JSON.stringify(baseline[field]) === JSON.stringify(entity[field]))
            continue;
          const remoteIo = detail.activity.ioputs?.filter((item) => item.type === direction) ?? [];
          for (let index = 0; index < entity[field].length; index++) {
            const prior = remoteIo[index];
            if (prior && prior.desc === entity[field][index]) continue;
            await this.writeStep(`io:${node.id}:${direction}:${index}`, () =>
              this.api.saveIo(ref!.id, detail.activity.version, {
                ...(prior ?? { formatType: 'text', dataObjectType: 'text' }),
                type: direction,
                desc: entity[field][index],
              }),
            );
            detail = await this.api.activity(ref.id);
          }
          for (let index = entity[field].length; index < remoteIo.length; index++) {
            const ioId = remoteIo[index].id;
            if (typeof ioId !== 'string') throw new Error('旧输入输出缺少 ID，不能安全删除');
            await this.writeStep(`io-delete:${node.id}:${direction}:${ioId}`, () =>
              this.api.deleteIo(ref!.id, detail.activity.version, ioId),
            );
            detail = await this.api.activity(ref.id);
          }
        }
        // 仅合并服务端维护的元数据，文本字段保留用户提交的内容。
        entity.externalRef = { provider: 'coopwire', id: ref.id, version: detail.activity.version };
        this.activityDetails.set(ref.id, detail);
        if (!entity.code) entity.code = String(detail.activity.code ?? '');
        this.knownEntities.set(entity.id, structuredClone(entity.externalRef));
      }
      const validated = validateDocument(desired, this.registry);
      // 完整关系集沿用现有后端的图形保存与移除约定，不调用永久删除活动接口。
      const finalPng = await this.png(validated);
      this.version = await this.writeStep('save-flow', () =>
        this.api.saveFlow(
          this.version,
          writeFlow(validated, this.registry, request.command.commandId, this.legacySource),
          flowRelations(validated),
          finalPng,
        ),
      );
      this.storage.removeItem(this.journalKey);
      this.pending = undefined;
      this.report('ready', `已保存到 Coopwire · v${this.version}`);
      return validated;
    } catch (error) {
      this.report(
        this.pending?.uncertain ? 'uncertain' : 'failed',
        this.pending?.uncertain
          ? '远程写入结果待核对，已停止重发'
          : '远程提交未完成，可重试原命令或重新加载核对',
      );
      throw error;
    }
  }
}
