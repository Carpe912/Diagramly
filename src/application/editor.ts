import { commandSchema, type Command, type Operation } from './commands';
import {
  defaultCanvasSettings,
  newEntity,
  newId,
  type DiagramDocument,
  type DiagramNode,
} from '../domain/model';
import { validateDocument } from '../domain/validation';
import {
  addPoolLane,
  isManagedLane,
  isPoolType,
  layoutPool,
  movePoolLane,
  poolLanes,
  poolOf,
  resizePoolLane,
  switchPoolOrientation,
  type PoolOrientation,
} from '../domain/pools';
import type { EditorTransport } from './transport';
import type { ShapeRegistry } from '../shapes/registry';

export interface ChangeSet {
  added: string[];
  updated: string[];
  deleted: string[];
}
export interface Receipt {
  commandId: string;
  revision: number;
  changes: ChangeSet;
}
export interface HistoryEntry {
  label: string;
  origin: Command['origin'];
  revision: number;
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    Object.values(value).forEach((child) => freeze(child));
    Object.freeze(value);
  }
  return value;
}
function diff(before: DiagramDocument, after: DiagramDocument): ChangeSet {
  const a = { ...before.nodes, ...before.edges },
    b = { ...after.nodes, ...after.edges };
  return {
    added: Object.keys(b).filter((id) => !a[id]),
    deleted: Object.keys(a).filter((id) => !b[id]),
    updated: Object.keys(b).filter(
      (id) =>
        a[id] &&
        (JSON.stringify(a[id]) !== JSON.stringify(b[id]) ||
          (id in after.nodes &&
            JSON.stringify(before.entities[before.nodes[id].entityId]) !==
              JSON.stringify(after.entities[after.nodes[id].entityId]))),
    ),
  };
}
function apply(doc: DiagramDocument, operation: Operation, registry: ShapeRegistry) {
  const getNode = (id: string) => {
    const node = doc.nodes[id];
    if (!node) throw new Error(`节点不存在：${id}`);
    return node;
  };
  const ensureFresh = (id: string) => {
    if (doc.nodes[id] || doc.edges[id] || doc.entities[id]) throw new Error(`ID 已存在：${id}`);
  };
  switch (operation.type) {
    case 'document.canvas.update':
      doc.canvas = { ...defaultCanvasSettings, ...doc.canvas, ...operation.patch };
      break;
    case 'node.create': {
      ensureFresh(operation.node.id);
      ensureFresh(operation.entity.id);
      if (operation.node.entityId !== operation.entity.id) throw new Error('节点和实体引用不一致');
      doc.nodes[operation.node.id] = structuredClone(operation.node);
      doc.entities[operation.entity.id] = structuredClone(operation.entity);
      const pool = poolOf(doc, doc.nodes[operation.node.id]);
      if (pool && !isPoolType(operation.node.type)) {
        if (
          operation.node.type === 'swimlane' &&
          doc.nodes[operation.node.id].laneOrder === undefined
        )
          doc.nodes[operation.node.id].laneOrder = poolLanes(doc, pool.id).length - 1;
        layoutPool(doc, pool.id);
      }
      break;
    }
    case 'node.update': {
      const node = getNode(operation.id);
      if (
        node.type === 'swimlane' &&
        (operation.patch.name !== undefined || operation.patch.roleIds !== undefined)
      ) {
        throw new Error('泳道名称由所选角色生成，请通过角色泳道选择角色');
      }
      const entity = doc.entities[node.entityId],
        { details, ...patch } = operation.patch;
      Object.assign(entity, patch);
      if (details)
        entity.details = {
          ...entity.details,
          ...details,
          ...(details.displaySetting
            ? { displaySetting: { ...entity.details?.displaySetting, ...details.displaySetting } }
            : {}),
        };
      break;
    }
    case 'lane.roles.set': {
      const lane = getNode(operation.laneId);
      if (lane.type !== 'swimlane') throw new Error('只能为泳道选择角色');
      const entity = doc.entities[lane.entityId];
      entity.roleIds = operation.roles.map((role) => role.id);
      entity.name = operation.roles.map((role) => role.name).join('、') || '角色泳道';
      break;
    }
    case 'node.move': {
      const node = getNode(operation.id);
      if (isManagedLane(doc, node)) throw new Error('泳道位置由泳池布局控制，请使用移动泳道命令');
      node.bounds.x = operation.x;
      node.bounds.y = operation.y;
      if (operation.parentId !== undefined) {
        if (operation.parentId === null) delete node.parentId;
        else node.parentId = operation.parentId;
      }
      break;
    }
    case 'node.resize': {
      const node = getNode(operation.id);
      if (isManagedLane(doc, node)) throw new Error('请使用泳道尺寸命令调整泳道');
      node.bounds = structuredClone(operation.bounds);
      if (isPoolType(node.type)) layoutPool(doc, node.id, false);
      break;
    }
    case 'node.appearance': {
      const { type: _type, id: _id, ...patch } = operation;
      const node = getNode(operation.id);
      Object.assign(
        node.appearance,
        Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      );
      break;
    }
    case 'pool.orientation':
      switchPoolOrientation(doc, operation.id, operation.orientation);
      break;
    case 'pool.lane.add':
      ensureFresh(operation.laneId);
      ensureFresh(operation.entityId);
      addPoolLane(
        doc,
        operation.poolId,
        operation.laneId,
        operation.entityId,
        operation.name,
        operation.index,
      );
      break;
    case 'pool.lane.remove': {
      const lane = getNode(operation.laneId);
      if (
        lane.type !== 'swimlane' ||
        lane.parentId !== operation.poolId ||
        !isPoolType(getNode(operation.poolId).type)
      )
        throw new Error('泳道不属于指定泳池');
      apply(doc, { type: 'node.delete', id: lane.id }, registry);
      break;
    }
    case 'pool.lane.move':
      movePoolLane(doc, operation.laneId, operation.poolId);
      break;
    case 'pool.lane.resize':
      resizePoolLane(doc, operation.laneId, operation.extent, operation.crossExtent);
      break;
    case 'node.delete': {
      const node = getNode(operation.id),
        parentPool = node.type === 'swimlane' ? poolOf(doc, node) : undefined;
      if (parentPool && poolLanes(doc, parentPool.id).length <= 1)
        throw new Error('泳池至少保留一条泳道');
      const extent = parentPool?.type === 'pool-vertical' ? node.bounds.width : node.bounds.height;
      const removed = new Set([operation.id]);
      // 迭代遍历明确级联删除范围，便于后续扩展嵌套容器。
      let size = 0;
      while (size !== removed.size) {
        size = removed.size;
        Object.values(doc.nodes).forEach((n) => {
          if (n.parentId && removed.has(n.parentId)) removed.add(n.id);
        });
      }
      for (const id of removed) {
        delete doc.entities[doc.nodes[id].entityId];
        delete doc.nodes[id];
      }
      for (const edge of Object.values(doc.edges))
        if (removed.has(edge.source.nodeId) || removed.has(edge.target.nodeId))
          delete doc.edges[edge.id];
      if (parentPool) {
        if (parentPool.type === 'pool-vertical') parentPool.bounds.width -= extent;
        else parentPool.bounds.height -= extent;
        layoutPool(doc, parentPool.id);
      }
      break;
    }
    case 'node.duplicate': {
      const source = getNode(operation.id);
      if (registry.get(source.type).container) throw new Error('容器复制尚未实现；请新建泳道');
      ensureFresh(operation.newId);
      ensureFresh(operation.newEntityId);
      const node = structuredClone(source),
        entity = structuredClone(doc.entities[source.entityId]);
      node.id = operation.newId;
      node.entityId = operation.newEntityId;
      node.bounds.x += operation.offset.x;
      node.bounds.y += operation.offset.y;
      entity.id = operation.newEntityId;
      entity.name += ' 副本';
      entity.code = '';
      delete entity.externalRef;
      doc.nodes[node.id] = node;
      doc.entities[entity.id] = entity;
      const pool = poolOf(doc, node);
      if (pool) layoutPool(doc, pool.id);
      break;
    }
    case 'edge.create':
      ensureFresh(operation.edge.id);
      doc.edges[operation.edge.id] = structuredClone(operation.edge);
      break;
    case 'edge.update': {
      const edge = doc.edges[operation.id];
      if (!edge) throw new Error(`连线不存在：${operation.id}`);
      Object.assign(edge, structuredClone(operation.patch));
      break;
    }
    case 'edge.delete':
      if (!doc.edges[operation.id]) throw new Error(`连线不存在：${operation.id}`);
      delete doc.edges[operation.id];
      break;
    case 'document.rename':
      doc.title = operation.title;
      break;
  }
}
export class Editor {
  private document: DiagramDocument;
  private listeners = new Set<() => void>();
  private undoStack: { before: DiagramDocument; after: DiagramDocument; entry: HistoryEntry }[] =
    [];
  private redoStack: typeof this.undoStack = [];
  // 当前会话内保证幂等；生产接口应在服务端持久化回执。
  private receipts = new Map<string, { fingerprint: string; receipt: Receipt }>();
  private transport?: EditorTransport;
  private inFlight = new Map<string, { fingerprint: string; promise: Promise<Receipt> }>();
  private working = false;
  private retryAction?: () => Receipt | void | Promise<Receipt | void>;
  get canRetryRemote() {
    return !!this.retryAction && !this.working;
  }
  retryRemote() {
    return this.retryAction?.();
  }
  get busy() {
    return this.working;
  }
  get remote() {
    return !!this.transport;
  }
  attachTransport(transport?: EditorTransport) {
    if (this.working) throw new Error('远程操作进行中');
    this.transport = transport;
    this.retryAction = undefined;
    // 绑定远程适配器前的历史记录没有对应的远程事务。
    this.undoStack = [];
    this.redoStack = [];
    this.receipts.clear();
    this.notify();
  }
  readonly activity: HistoryEntry[] = [];
  constructor(
    input: unknown,
    readonly registry: ShapeRegistry,
  ) {
    this.document = freeze(validateDocument(input, registry));
  }
  get snapshot() {
    return this.document;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
  preview(input: unknown) {
    const command = commandSchema.parse(input);
    if (command.expectedRevision !== this.document.revision)
      throw new Error(`版本冲突：预期 ${command.expectedRevision}，当前 ${this.document.revision}`);
    const draft = structuredClone(this.document);
    for (const operation of command.operations) apply(draft, operation, this.registry);
    draft.revision++;
    const document = validateDocument(draft, this.registry);
    return { document, changes: diff(this.document, document) };
  }
  execute(input: unknown): Receipt {
    if (this.transport) throw new Error('远程模式请使用 submit，不能绕过业务接口');
    const command = commandSchema.parse(input),
      fingerprint = JSON.stringify(command);
    const previous = this.receipts.get(command.commandId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('同一 commandId 不能用于不同命令');
      return structuredClone(previous.receipt);
    }
    const { document, changes } = this.preview(command);
    return this.accept(command, document, changes);
  }
  private accept(command: Command, document: DiagramDocument, changes: ChangeSet): Receipt {
    const entry = { label: command.label, origin: command.origin, revision: document.revision };
    this.undoStack.push({ before: this.document, after: document, entry });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.document = freeze(document);
    const receipt = { commandId: command.commandId, revision: document.revision, changes };
    this.receipts.set(command.commandId, {
      fingerprint: JSON.stringify(command),
      receipt: structuredClone(receipt),
    });
    this.activity.unshift(entry);
    this.activity.splice(50);
    this.notify();
    return receipt;
  }
  submit(input: unknown): Receipt | Promise<Receipt> {
    if (!this.transport) return this.execute(input);
    const command = commandSchema.parse(input),
      fingerprint = JSON.stringify(command);
    const previous = this.receipts.get(command.commandId),
      running = this.inFlight.get(command.commandId);
    if (previous || running) {
      if ((previous ?? running)!.fingerprint !== fingerprint)
        throw new Error('同一 commandId 不能用于不同命令');
      return previous ? structuredClone(previous.receipt) : running!.promise;
    }
    if (this.working) throw new Error('远程操作进行中，请等待完成');
    const preview = this.preview(command),
      before = this.document;
    this.working = true;
    this.notify();
    const promise = this.transport
      .commit({ kind: 'command', command, before, document: preview.document })
      .then((result) => {
        const document = validateDocument(result, this.registry);
        if (document.id !== before.id || document.revision !== before.revision + 1)
          throw new Error('远程响应的文档或版本不匹配');
        this.retryAction = undefined;
        return this.accept(command, document, diff(before, document));
      })
      .catch((error) => {
        this.retryAction = () => this.submit(command);
        throw error;
      })
      .finally(() => {
        this.working = false;
        this.inFlight.delete(command.commandId);
        this.notify();
      });
    this.inFlight.set(command.commandId, { fingerprint, promise });
    return promise;
  }
  dispatchAsync(label: string, operations: Operation[], origin: Command['origin'] = 'user') {
    return this.submit({
      commandId: newId('cmd'),
      expectedRevision: this.document.revision,
      origin,
      label,
      operations,
    });
  }
  async undoAsync() {
    if (!this.transport) {
      this.undo();
      return;
    }
    await this.remoteHistory('undo');
  }
  async redoAsync() {
    if (!this.transport) {
      this.redo();
      return;
    }
    await this.remoteHistory('redo');
  }
  private async remoteHistory(kind: 'undo' | 'redo', retryCommand?: Command) {
    if (this.working) throw new Error('远程操作进行中');
    const stack = kind === 'undo' ? this.undoStack : this.redoStack,
      step = stack.at(-1);
    if (!step || !this.transport) return;
    const before = this.document,
      target = structuredClone(kind === 'undo' ? step.before : step.after);
    target.revision = before.revision + 1;
    const label = `${kind === 'undo' ? '撤销' : '重做'} · ${step.entry.label}`;
    const command: Command = retryCommand ?? {
      commandId: newId('cmd'),
      expectedRevision: before.revision,
      origin: 'user',
      label,
      operations: [{ type: 'document.rename', title: target.title }],
    };
    this.working = true;
    this.notify();
    try {
      const result = validateDocument(
        await this.transport.commit({ kind, command, before, document: target }),
        this.registry,
      );
      if (result.id !== before.id || result.revision !== target.revision)
        throw new Error('远程响应的文档或版本不匹配');
      stack.pop();
      (kind === 'undo' ? this.redoStack : this.undoStack).push(step);
      this.document = freeze(result);
      // 后续撤销与重做的目标保留服务端确认的业务引用和版本。
      for (const history of [...this.undoStack, ...this.redoStack]) {
        for (const snapshot of [history.before, history.after]) {
          const mutable = structuredClone(snapshot);
          for (const [id, entity] of Object.entries(result.entities)) {
            if (mutable.entities[id] && entity.externalRef)
              mutable.entities[id].externalRef = structuredClone(entity.externalRef);
          }
          if (snapshot === history.before) history.before = mutable;
          else history.after = mutable;
        }
      }
      this.activity.unshift({ label, origin: 'user', revision: result.revision });
      this.activity.splice(50);
      this.retryAction = undefined;
    } catch (error) {
      this.retryAction = () => this.remoteHistory(kind, command);
      throw error;
    } finally {
      this.working = false;
      this.notify();
    }
  }
  dispatch(label: string, operations: Operation[], origin: Command['origin'] = 'user') {
    return this.execute({
      commandId: newId('cmd'),
      expectedRevision: this.document.revision,
      origin,
      label,
      operations,
    });
  }
  undo() {
    if (this.transport) throw new Error('远程模式请使用 undoAsync');
    const step = this.undoStack.pop();
    if (!step) return;
    this.redoStack.push(step);
    this.restoreHistory(step.before, `撤销 · ${step.entry.label}`);
  }
  redo() {
    if (this.transport) throw new Error('远程模式请使用 redoAsync');
    const step = this.redoStack.pop();
    if (!step) return;
    this.undoStack.push(step);
    this.restoreHistory(step.after, `重做 · ${step.entry.label}`);
  }
  private restoreHistory(snapshot: DiagramDocument, label: string) {
    const document = structuredClone(snapshot);
    document.revision = this.document.revision + 1;
    this.document = freeze(document);
    this.activity.unshift({ label, origin: 'user', revision: document.revision });
    this.activity.splice(50);
    this.notify();
  }
  createPool(orientation: PoolOrientation, x: number, y: number): Operation[] {
    const create = this.createNode(`pool-${orientation}`, x, y);
    if (create.type !== 'node.create') throw new Error('无效泳池定义');
    if (orientation === 'horizontal') create.node.bounds.height /= 2;
    else create.node.bounds.width /= 2;
    return [
      create,
      ...[1, 2].map((index): Operation => ({
        type: 'pool.lane.add',
        poolId: create.node.id,
        laneId: newId('lane'),
        entityId: newId('entity'),
        name: `泳道 ${index}`,
      })),
    ];
  }
  createNode(type: string, x: number, y: number, parentId?: string): Operation {
    const shape = this.registry.get(type),
      id = newId('node'),
      entityId = newId('entity');
    const node: DiagramNode = {
      id,
      entityId,
      type,
      shapeVersion: shape.version,
      bounds: { x, y, width: shape.defaultSize[0], height: shape.defaultSize[1] },
      appearance: { accent: '#5d72bd' },
      ...(parentId ? { parentId } : {}),
    };
    return { type: 'node.create', node, entity: newEntity(entityId, shape.label) };
  }
}
