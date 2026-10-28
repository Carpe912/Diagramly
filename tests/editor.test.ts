import { describe, expect, it } from 'vitest';
import { Editor } from '../src/application/editor';
import { demoDocument } from '../src/application/demo';
import { createShapeRegistry } from '../src/shapes/registry';
import { emptyDocument } from '../src/domain/model';
import { createAgentTools } from '../src/agent/tools';
import { parseDocument } from '../src/adapters/storage/local';
import type { Command } from '../src/application/commands';

const make = () => new Editor(demoDocument(), createShapeRegistry());
const command = (editor: Editor, operations: Command['operations'], id = 'cmd_test'): Command => ({
  commandId: id, expectedRevision: editor.snapshot.revision, origin: 'agent', label: '测试操作', operations,
});
describe('single source of truth and transactions', () => {
  it('stores a composite as one node and entity without projected children', () => {
    const editor = new Editor(emptyDocument(), createShapeRegistry());
    const op = editor.createNode('activity', 80, 80);
    editor.dispatch('添加活动', [op]);
    expect(Object.keys(editor.snapshot.nodes)).toHaveLength(1);
    expect(Object.keys(editor.snapshot.entities)).toHaveLength(1);
    expect(JSON.stringify(editor.snapshot)).not.toContain('::header');
    if (op.type === 'node.create') {
      const parts = editor.registry.get('activity').composite!(op.node, op.entity);
      expect(parts.map((p) => p.key)).toEqual(['header', 'title', 'footer']);
    }
  });
  it('rolls back the whole batch when a later operation fails', () => {
    const editor = make(), before = editor.snapshot;
    expect(() => editor.execute(command(editor, [
      { type: 'node.update', id: 'receive', patch: { name: '不应保存' } },
      { type: 'node.delete', id: 'missing' },
    ]))).toThrow('节点不存在');
    expect(editor.snapshot).toBe(before); expect(editor.canUndo).toBe(false);
  });
  it('validates the final batch rather than transient intermediate references', () => {
    const editor = new Editor(emptyDocument(), createShapeRegistry());
    const a = editor.createNode('rectangle', 0, 0), b = editor.createNode('rectangle', 300, 0);
    if (a.type !== 'node.create' || b.type !== 'node.create') throw Error();
    editor.dispatch('整体创建', [{ type: 'edge.create', edge: { id: 'edge_batch', label: '',
      source: { nodeId: a.node.id, portId: 'right' }, target: { nodeId: b.node.id, portId: 'left' } } }, a, b]);
    expect(Object.keys(editor.snapshot.edges)).toHaveLength(1);
    editor.undo(); expect(Object.keys(editor.snapshot.nodes)).toHaveLength(0);
  });
  it('rejects stale writes and leaves the document unchanged', () => {
    const editor = make(), stale = command(editor, [{ type: 'node.delete', id: 'receive' }]);
    editor.dispatch('其他用户修改', [{ type: 'node.update', id: 'confirm', patch: { name: '新名称' } }]);
    expect(() => editor.execute(stale)).toThrow('版本冲突'); expect(editor.snapshot.nodes.receive).toBeDefined();
  });
  it('replays an identical command only once, even with its original revision', () => {
    const editor = make(), input = command(editor, [{ type: 'node.duplicate', id: 'receive', newId: 'copy', newEntityId: 'entity_copy', offset: { x: 30, y: 30 } }]);
    const a = editor.execute(input), b = editor.execute(input);
    expect(a).toEqual(b); expect(editor.snapshot.revision).toBe(1); expect(Object.keys(editor.snapshot.nodes)).toHaveLength(10);
    a.changes.added.push('corrupted'); expect(editor.execute(input).changes.added).toEqual(['copy']);
  });
  it('rejects reuse of a command ID with different payloads', () => {
    const editor = make(); editor.execute(command(editor, [{ type: 'node.delete', id: 'receive' }]));
    expect(() => editor.execute(command(editor, [{ type: 'node.delete', id: 'confirm' }]))).toThrow('commandId');
  });
  it('previews an agent batch without mutation, then applies and undoes it', () => {
    const editor = make(), tools = createAgentTools(editor);
    const input = command(editor, [{ type: 'node.update', id: 'receive', patch: { name: 'Agent 活动', critical: true } }]);
    const before = JSON.stringify(editor.snapshot), preview = tools.preview(input);
    expect(JSON.stringify(editor.snapshot)).toBe(before); expect(preview.changes.updated).toEqual(['receive']);
    tools.apply(input); expect(editor.snapshot.entities.entity_receive.name).toBe('Agent 活动');
    editor.undo(); expect(editor.snapshot.entities.entity_receive.name).toBe('接收客户订单'); expect(editor.snapshot.revision).toBe(2);
    editor.redo(); expect(editor.snapshot.entities.entity_receive.name).toBe('Agent 活动'); expect(editor.snapshot.revision).toBe(3);
  });
  it('keeps IDs unique and clears remote identity when duplicating', () => {
    const editor = make();
    editor.dispatch('绑定业务', [{ type: 'node.update', id: 'receive', patch: { externalRef: { provider: 'coopwire', id: 'remote_123' } } }]);
    editor.dispatch('复制', [{ type: 'node.duplicate', id: 'receive', newId: 'copy', newEntityId: 'entity_copy', offset: { x: 30, y: 30 } }]);
    expect(editor.snapshot.entities.entity_copy.externalRef).toBeUndefined(); expect(editor.snapshot.entities.entity_copy.code).toBe('');
    expect(editor.snapshot.entities.entity_receive.externalRef?.id).toBe('remote_123');
    expect(editor.snapshot.nodes.copy.entityId).not.toBe(editor.snapshot.nodes.receive.entityId);
  });
  it('cascades lane deletion to children and edges in one undo step', () => {
    const editor = make();
    editor.dispatch('删除泳道', [{ type: 'node.delete', id: 'lane_sales' }]);
    expect(Object.keys(editor.snapshot.nodes).sort()).toEqual(['deliver', 'end', 'lane_ops', 'pool_order']);
    expect(Object.keys(editor.snapshot.edges)).toEqual(['edge_end']); expect(Object.keys(editor.snapshot.entities)).toHaveLength(4);
    editor.undo(); expect(Object.keys(editor.snapshot.nodes)).toHaveLength(9); expect(Object.keys(editor.snapshot.edges)).toHaveLength(6);
  });
  it('removes incident edges when a single node is deleted', () => {
    const editor = make(); editor.dispatch('删除节点', [{ type: 'node.delete', id: 'receive' }]);
    expect(Object.values(editor.snapshot.edges).some((e) => e.source.nodeId === 'receive' || e.target.nodeId === 'receive')).toBe(false);
  });
  it('rejects out of bounds moves and keeps lane-local coordinates', () => {
    const editor = make();
    expect(() => editor.dispatch('非法移动', [{ type: 'node.move', id: 'receive', x: -50, y: 0 }])).toThrow('泳道');
    expect(editor.snapshot.nodes.receive.bounds.x).toBe(215);
    editor.dispatch('跨泳道', [{ type: 'node.move', id: 'receive', parentId: 'lane_ops', x: 120, y: 55 }]);
    expect(editor.snapshot.nodes.receive.parentId).toBe('lane_ops');
  });
  it('rejects resizing a lane over its children and undersizing a composite', () => {
    const editor = make();
    expect(() => editor.dispatch('泳道缩小', [{ type: 'node.resize', id: 'lane_sales', bounds: { x: 60, y: 70, width: 400, height: 210 } }])).toThrow('泳道');
    expect(() => editor.dispatch('活动缩小', [{ type: 'node.resize', id: 'receive', bounds: { x: 215, y: 45, width: 60, height: 30 } }])).toThrow('最小尺寸');
  });
  it('enforces configurable activity containment at the command boundary', () => {
    const doc = emptyDocument(); doc.policies.activityRequiresLane = true;
    const editor = new Editor(doc, createShapeRegistry());
    expect(() => editor.dispatch('无泳道活动', [editor.createNode('activity', 100, 100)])).toThrow('必须属于泳道');
  });
  it('allows cyclic flows without recursive graph traversal', () => {
    const editor = make();
    editor.dispatch('循环', [{ type: 'edge.create', edge: { id: 'edge_cycle', label: '回退',
      source: { nodeId: 'deliver', portId: 'left' }, target: { nodeId: 'receive', portId: 'bottom' } } }]);
    expect(editor.snapshot.edges.edge_cycle).toBeDefined();
    editor.dispatch('删除循环节点', [{ type: 'node.delete', id: 'receive' }]);
    expect(editor.snapshot.edges.edge_cycle).toBeUndefined();
  });
  it('protects the immutable document from outside mutation', () => {
    const editor = make(); expect(() => editor.snapshot.nodes.receive.bounds.x = 9000).toThrow();
    const read = createAgentTools(editor).read(); read.nodes.receive.bounds.x = 9000;
    expect(editor.snapshot.nodes.receive.bounds.x).toBe(215);
  });
  it('invalidates redo when a new command creates a different future', () => {
    const editor = make(); editor.dispatch('改名', [{ type: 'node.update', id: 'receive', patch: { name: '新活动' } }]);
    editor.undo(); editor.dispatch('另一个改名', [{ type: 'document.rename', title: '另一文档' }]);
    expect(editor.canRedo).toBe(false);
  });
});
describe('untrusted imports and tool payloads', () => {
  it('round-trips normalized JSON without losing semantic data', () => {
    const editor = make(); expect(parseDocument(JSON.stringify(editor.snapshot), editor.registry)).toEqual(editor.snapshot);
  });
  it.each(['unknown-shape', 'wrong-schema', 'dangling-edge', 'duplicate-entity', 'key-mismatch', 'nested-container', 'orphan-entity'])(
    'rejects malformed document: %s', (scenario) => {
      const editor = make(), doc = structuredClone(editor.snapshot);
      switch (scenario) {
        case 'unknown-shape': doc.nodes.receive.type = 'unknown'; break;
        case 'wrong-schema': (doc as unknown as { schemaVersion: number }).schemaVersion = 2; break;
        case 'dangling-edge': doc.edges.edge_start.target.nodeId = 'missing'; break;
        case 'duplicate-entity': doc.nodes.confirm.entityId = doc.nodes.receive.entityId; break;
        case 'key-mismatch': doc.nodes.receive.id = 'mismatch'; break;
        case 'nested-container': doc.nodes.lane_sales.parentId = 'lane_ops'; break;
        case 'orphan-entity': delete doc.nodes.receive; break;
      }
      expect(() => parseDocument(JSON.stringify(doc), editor.registry)).toThrow();
    });
  it.each(['unknown-port', 'wrong-direction'])('rejects edge %s', (scenario) => {
    const editor = make();
    expect(() => editor.dispatch('非法连线', [{ type: 'edge.create', edge: { id: 'edge_invalid', label: '',
      source: { nodeId: scenario === 'unknown-port' ? 'receive' : 'end', portId: scenario === 'unknown-port' ? 'missing' : 'in' },
      target: { nodeId: 'confirm', portId: 'left' } } }])).toThrow('端口');
  });
  it('rejects unknown operation keys, prototype IDs and non-finite coordinates', () => {
    const editor = make(), input = command(editor, [{ type: 'node.move', id: 'receive', x: 120, y: 45 }]);
    expect(() => editor.execute({ ...input, operations: [{ ...input.operations[0], script: 'alert(1)' }] })).toThrow();
    expect(() => editor.execute({ ...input, commandId: '__proto__' })).toThrow();
    expect(() => editor.execute(command(editor, [{ type: 'node.move', id: 'receive', x: Infinity, y: 45 }]))).toThrow();
  });
  it('describes discoverable shape and command schemas without exposing engine objects', () => {
    const tools = createAgentTools(make()), description = tools.describe();
    expect(description.shapes.find((s) => s.type === 'activity')?.composite).toBe(true);
    expect(description.applyInputSchema.properties).toHaveProperty('expectedRevision');
    expect(JSON.stringify(description)).not.toContain('mxCell');
    expect(() => tools.apply({ ...command(make(), [{ type: 'document.rename', title: '失败' }]), origin: 'user' })).toThrow('origin');
  });
});
