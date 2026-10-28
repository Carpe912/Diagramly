import type { EditorTransport, RemoteCommit } from '../../application/transport';
import { newId, type DiagramDocument, type DiagramNode } from '../../domain/model';
import type { ShapeRegistry } from '../../shapes/registry';
import { validateDocument } from '../../domain/validation';
import { activityType, flowRelations, hydrateEntity, isBusinessNode, readFlow, writeFlow } from './codec';
import { CoopwireApi, CoopwireError, type Organization } from './api';

export interface JournalStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
interface Journal { commandId: string; fingerprint: string; request: RemoteCommit; remoteVersion: number;
  results: Record<string, unknown>; started?: string; uncertain: boolean }
export interface RemoteStatus { state: 'ready' | 'saving' | 'failed' | 'uncertain'; message: string }
export class CoopwireSession implements EditorTransport {
  readonly journalKey: string;
  private pending?: Journal;
  private version = 0;
  private status: RemoteStatus = { state: 'ready', message: '未连接' };
  private listener: (status: RemoteStatus) => void = () => {};
  private knownEntities = new Map<string, NonNullable<DiagramDocument['entities'][string]['externalRef']>>();
  organizations: Organization[] = [];
  warnings: string[] = [];
  legacySource?: string;
  constructor(readonly api: CoopwireApi, private registry: ShapeRegistry,
    private png: (document: DiagramDocument) => Promise<Blob>, private storage: JournalStore = localStorage) {
    this.journalKey = `diagramly.coopwire.journal:${encodeURIComponent(JSON.stringify(api.config))}`;
    const stored = storage.getItem(this.journalKey);
    if (stored) { this.pending = JSON.parse(stored) as Journal; this.status = { state: 'uncertain', message: '存在上次未完成事务，请先重新读取远端核对；待处理文档已保留' }; }
  }
  onStatus(listener: (status: RemoteStatus) => void) { this.listener = listener; listener(this.status); }
  get remoteVersion() { return this.version; }
  get pendingDocument() { return this.pending ? structuredClone(this.pending.request.document) : undefined; }
  private report(state: RemoteStatus['state'], message: string) { this.status = { state, message }; this.listener(this.status); }
  async open(): Promise<DiagramDocument> {
    const [flow, organizations] = await Promise.all([this.api.flow(), this.api.organizations()]);
    if (flow.lockUser) throw new Error('此流程已被锁定，请先在 Coopwire 中解除或取得编辑权');
    const loaded = readFlow(flow, this.registry); this.organizations = organizations; this.warnings = loaded.warnings; this.legacySource = loaded.legacySource; this.version = flow.version;
    const document = loaded.document;
    for (const node of Object.values(document.nodes).filter(isBusinessNode)) {
      const entity = document.entities[node.entityId];
      if (entity.externalRef?.provider === 'coopwire') {
        const detail = await this.api.activity(entity.externalRef.id); hydrateEntity(document, node, detail);
        this.knownEntities.set(entity.id, structuredClone(entity.externalRef));
      }
    }
    if (!this.pending) this.report('ready', `已连接 Coopwire · v${this.version}`);
    return validateDocument(document, this.registry);
  }
  /** Explicit user recovery: retain a backup of the journal before accepting current remote state. */
  async reloadAndReconcile() {
    const document = await this.open();
    if (this.pending) {
      this.storage.setItem(`${this.journalKey}:recovery`, JSON.stringify(this.pending));
      this.storage.removeItem(this.journalKey); this.pending = undefined;
    }
    this.report('ready', `已重新加载远端 · v${this.version}`); return document;
  }
  private persist() { if (this.pending) this.storage.setItem(this.journalKey, JSON.stringify(this.pending)); }
  private async writeStep<T>(key: string, write: () => Promise<T>): Promise<T> {
    const journal = this.pending!;
    if (Object.hasOwn(journal.results, key)) return structuredClone(journal.results[key]) as T;
    journal.started = key; this.persist();
    try {
      const result = await write();
      journal.results[key] = result === undefined ? null : structuredClone(result);
      delete journal.started; this.persist(); return result;
    } catch (error) {
      journal.uncertain = !(error instanceof CoopwireError && ['rejected', 'auth', 'conflict'].includes(error.kind));
      if (!journal.uncertain) delete journal.started;
      try { this.persist(); } catch { journal.uncertain = true; }
      throw error;
    }
  }
  private orgIds(doc: DiagramDocument, node: DiagramNode) { return doc.entities[doc.nodes[node.parentId ?? node.id]?.entityId]?.roleIds ?? []; }
  async commit(request: RemoteCommit): Promise<DiagramDocument> {
    const fingerprint = JSON.stringify(request);
    if (this.pending) {
      if (this.pending.commandId !== request.command.commandId || this.pending.fingerprint !== fingerprint) throw new Error('上次远程事务尚未完成；请重试原命令或重新加载远端核对');
      if (this.pending.uncertain || this.pending.started) throw new Error('上次写入结果未确认，已禁止重发；请重新加载远端并核对待处理文档');
    }
    const desired = validateDocument(request.document, this.registry), before = request.before;
    const business = Object.values(desired.nodes).filter(isBusinessNode);
    const ids = new Set<string>();
    for (const node of business) {
      const entity = desired.entities[node.entityId], old = before.entities[node.entityId];
      if (!old && entity.externalRef && request.kind === 'command') throw new Error('新建节点不能注入远程业务 ID，请使用创建或复制命令');
      if (entity.externalRef && entity.externalRef.provider !== 'coopwire') throw new Error('不能将其他系统的业务引用写入 Coopwire');
      if (old && JSON.stringify(entity.externalRef) !== JSON.stringify(old.externalRef) && request.kind === 'command') throw new Error('业务引用由远程适配器维护，不能通过普通命令修改');
      if (entity.externalRef) { if (ids.has(entity.externalRef.id)) throw new Error('同一远程活动不能重复放置，请使用复制活动'); ids.add(entity.externalRef.id); }
      if (!entity.externalRef && entity.activityType === 'linked') throw new Error('新建引用活动需要关联对象，当前请使用普通活动或复制已有引用活动');
      if ((!node.parentId || !this.orgIds(desired, node).length) && !entity.externalRef) throw new Error('Coopwire 业务节点必须放在已选择组织角色的泳道内');
    }
    // Read versions before any mutation. A journal retry resumes known acknowledged steps.
    const flow = await this.api.flow();
    if (flow.version !== this.version || flow.lockUser) throw new CoopwireError('远端流程版本已变化或被锁定，请重新加载后再编辑', 'conflict');
    if (!this.pending) {
      const expected = new Map<string, NonNullable<DiagramDocument['entities'][string]['externalRef']>>();
      for (const node of Object.values(before.nodes).filter(isBusinessNode)) {
        const entity = before.entities[node.entityId]; if (entity.externalRef) expected.set(entity.externalRef.id, entity.externalRef);
      }
      for (const node of business) { const entity = desired.entities[node.entityId];
        const ref = this.knownEntities.get(entity.id) ?? entity.externalRef; if (ref && !expected.has(ref.id)) expected.set(ref.id, ref);
      }
      for (const ref of expected.values()) {
        if (ref) {
          const detail = await this.api.activity(ref.id);
          if (ref.version !== undefined && detail.activity.version !== ref.version) throw new CoopwireError('远端活动已被其他用户修改，请重新加载', 'conflict');
        }
      }
      this.pending = { commandId: request.command.commandId, fingerprint, request: structuredClone(request), remoteVersion: this.version, results: {}, uncertain: false };
      this.persist();
    }
    this.report('saving', '正在提交 Coopwire 业务与流程…');
    try {
      // Render first: export failures must never leave freshly-created remote activities behind.
      const png = await this.png(desired);
      if (png.type !== 'image/png' || !png.size) throw new Error('流程预览图导出失败');
      for (const node of business) {
        const entity = desired.entities[node.entityId], old = before.entities[node.entityId];
        const duplicate = request.kind === 'command' ? request.command.operations.find((op) => op.type === 'node.duplicate' && op.newId === node.id) : undefined;
        const sourceEntity = duplicate?.type === 'node.duplicate' ? before.entities[before.nodes[duplicate.id]?.entityId ?? ''] : undefined;
        const baseline = old ?? sourceEntity;
        const baselineNode = before.nodes[node.id] ?? (duplicate?.type === 'node.duplicate' ? before.nodes[duplicate.id] : undefined);
        let ref = entity.externalRef ?? this.knownEntities.get(entity.id);
        if (!ref) {
          const source = sourceEntity?.externalRef;
          let remoteId: string;
          if (source) remoteId = await this.writeStep(`copy:${node.id}`, () => this.api.copyActivity(source.id, entity.name));
          else {
            const key = `create-id:${node.id}`;
            if (!this.pending.results[key]) { this.pending.results[key] = newId('act').slice(4, 28); this.persist(); }
            remoteId = await this.writeStep(`create:${node.id}`, () => this.api.createActivity(String(this.pending!.results[key]), {
              actName: entity.name, actType: activityType(node, entity), orgId: this.orgIds(desired, node),
              belongId: this.api.config.flowchartId, belongType: `${this.api.config.flowchartType}Act`,
            }));
          }
          ref = { provider: 'coopwire', id: remoteId };
        }
        let detail = await this.api.activity(ref.id);
        const orgIds = this.orgIds(desired, node);
        const patch: Record<string, unknown> = {};
        if (!baseline || entity.name !== baseline.name) patch.actName = entity.name;
        if (!baseline || entity.critical !== baseline.critical) patch.isKeyStep = entity.critical;
        if ((!baseline && entity.code) || (baseline && entity.code !== baseline.code && !!entity.code)) patch.code = entity.code;
        if (!baseline || entity.activityType !== baseline.activityType) patch.actType = activityType(node, entity);
        const oldOrgIds = baselineNode ? this.orgIds(before, baselineNode) : undefined;
        if ((oldOrgIds && JSON.stringify(oldOrgIds) !== JSON.stringify(orgIds)) || (!baselineNode && !!entity.externalRef && orgIds.length)) patch.orgId = orgIds;
        if (Object.keys(patch).length) {
          await this.writeStep(`update:${node.id}`, () => this.api.updateActivity(ref!.id, detail.activity.version, { ...(orgIds.length ? { orgId: orgIds } : {}), ...patch }));
          detail = await this.api.activity(ref.id);
        }
        if ((!baseline && entity.description) || (baseline && entity.description !== baseline.description)) {
          await this.writeStep(`description:${node.id}`, () => this.api.updateDescription(ref!.id, detail.activity.version, orgIds, entity.description));
          detail = await this.api.activity(ref.id);
        }
        for (const [field, direction] of [['inputs', 'input'], ['outputs', 'output']] as const) {
          if (baseline && JSON.stringify(baseline[field]) === JSON.stringify(entity[field])) continue;
          const remoteIo = detail.activity.ioputs?.filter((item) => item.type === direction) ?? [];
          for (let index = 0; index < entity[field].length; index++) {
            const prior = remoteIo[index];
            if (prior && prior.desc === entity[field][index]) continue;
            await this.writeStep(`io:${node.id}:${direction}:${index}`, () => this.api.saveIo(ref!.id, detail.activity.version,
              { ...(prior ?? { formatType: 'text', dataObjectType: 'text' }), type: direction, desc: entity[field][index] }));
            detail = await this.api.activity(ref.id);
          }
          for (let index = entity[field].length; index < remoteIo.length; index++) {
            const ioId = remoteIo[index].id; if (typeof ioId !== 'string') throw new Error('旧输入输出缺少 ID，不能安全删除');
            await this.writeStep(`io-delete:${node.id}:${direction}:${ioId}`, () => this.api.deleteIo(ref!.id, detail.activity.version, ioId));
            detail = await this.api.activity(ref.id);
          }
        }
        // Only server-owned metadata is merged; plain-text fields already reflect the user's intent.
        entity.externalRef = { provider: 'coopwire', id: ref.id, version: detail.activity.version };
        if (!entity.code) entity.code = String(detail.activity.code ?? '');
        this.knownEntities.set(entity.id, structuredClone(entity.externalRef));
      }
      const validated = validateDocument(desired, this.registry);
      // Full relation set is the existing backend's graph save/delete contract. Never call portrait/delAct.
      const finalPng = await this.png(validated);
      this.version = await this.writeStep('save-flow', () => this.api.saveFlow(this.version,
        writeFlow(validated, this.registry, request.command.commandId, this.legacySource), flowRelations(validated), finalPng));
      this.storage.removeItem(this.journalKey); this.pending = undefined;
      this.report('ready', `已保存到 Coopwire · v${this.version}`); return validated;
    } catch (error) {
      this.report(this.pending?.uncertain ? 'uncertain' : 'failed', this.pending?.uncertain ? '远程写入结果待核对，已停止重发' : '远程提交未完成，可重试原命令或重新加载核对');
      throw error;
    }
  }
}
