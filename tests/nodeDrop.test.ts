import { describe, expect, it } from 'vitest';
import { nodeDropOperation } from '../src/application/nodeDrop';
import { demoDocument } from '../src/application/demo';
import { Editor } from '../src/application/editor';
import { absoluteBounds, laneInsets } from '../src/domain/pools';
import { createShapeRegistry } from '../src/shapes/registry';

const registry = createShapeRegistry();
describe('节点跨泳道拖放', () => {
  it.each(['horizontal', 'vertical'] as const)(
    '%s 泳池使用目标泳道相对坐标，并整体撤销归属与位置',
    (orientation) => {
      const editor = new Editor(demoDocument(), registry);
      if (orientation === 'vertical')
        editor.dispatch('垂直', [{ type: 'pool.orientation', id: 'pool_order', orientation }]);
      const before = editor.snapshot,
        lane = before.nodes.lane_ops;
      const origin = absoluteBounds(before, lane),
        inset = laneInsets(before, lane);
      const moved = {
        ...before.nodes.receive.bounds,
        x: origin.x + inset.left + 12,
        y: origin.y + inset.top + 12,
      };
      const operation = nodeDropOperation(before, 'receive', moved);
      expect(operation).toEqual({
        type: 'node.move',
        id: 'receive',
        x: inset.left + 12,
        y: inset.top + 12,
        parentId: lane.id,
      });
      editor.dispatch('跨泳道', [operation]);
      expect(editor.snapshot.nodes.receive.parentId).toBe(lane.id);
      expect(editor.snapshot.entities).toEqual(before.entities);
      expect(editor.snapshot.edges).toEqual(before.edges);
      editor.undo();
      expect(editor.snapshot.nodes).toEqual(before.nodes);
      editor.redo();
      expect(editor.snapshot.nodes.receive.parentId).toBe(lane.id);
    },
  );

  it('落在标题附近时吸附到内容区，不能越过标题或右下边界', () => {
    const doc = demoDocument(),
      lane = doc.nodes.lane_ops;
    const b = absoluteBounds(doc, lane),
      node = doc.nodes.receive;
    const operation = nodeDropOperation(doc, node.id, { ...node.bounds, x: b.x - 60, y: b.y - 40 });
    expect(operation).toMatchObject({ x: 80, y: 12, parentId: lane.id });
    const nearBottom = nodeDropOperation(doc, node.id, {
      ...node.bounds,
      x: b.x + lane.bounds.width - 110,
      y: b.y + lane.bounds.height - 70,
    });
    expect(nearBottom).toMatchObject({
      x: lane.bounds.width - 12 - node.bounds.width,
      y: lane.bounds.height - 12 - node.bounds.height,
    });
  });

  it('目标泳道过窄时随跨泳道命令扩展泳池，保留节点大小', () => {
    const document = demoDocument();
    document.nodes.receive.bounds.width = 350;
    const editor = new Editor(document, registry);
    editor.dispatch('垂直', [
      { type: 'pool.orientation', id: 'pool_order', orientation: 'vertical' },
    ]);
    const before = editor.snapshot,
      target = absoluteBounds(before, before.nodes.lane_ops);
    editor.dispatch('拖入窄泳道', [
      nodeDropOperation(before, 'receive', {
        ...before.nodes.receive.bounds,
        x: target.x + 12,
        y: target.y + 64,
      }),
    ]);
    expect(editor.snapshot.nodes.receive.parentId).toBe('lane_ops');
    expect(editor.snapshot.nodes.receive.bounds.width).toBe(350);
    expect(editor.snapshot.nodes.pool_order.bounds.width).toBeGreaterThan(
      before.nodes.pool_order.bounds.width,
    );
    editor.undo();
    expect(editor.snapshot.nodes).toEqual(before.nodes);
  });

  it('移出泳池时解除父容器并保留绝对位置，可以撤销', () => {
    const editor = new Editor(demoDocument(), registry),
      before = editor.snapshot;
    const operation = nodeDropOperation(before, 'receive', {
      ...before.nodes.receive.bounds,
      x: -1000,
      y: -1000,
    });
    expect(operation).toMatchObject({ x: -1000, y: -1000, parentId: null });
    editor.dispatch('移出泳池', [operation]);
    expect(editor.snapshot.nodes.receive.parentId).toBeUndefined();
    expect(editor.snapshot.nodes.receive.bounds).toMatchObject({ x: -1000, y: -1000 });
    expect(editor.snapshot.entities).toEqual(before.entities);
    expect(editor.snapshot.edges).toEqual(before.edges);
    editor.undo();
    expect(editor.snapshot.nodes).toEqual(before.nodes);
  });
  it('要求泳道的文档拒绝拖出时明确提示原因，不再误报标题区', () => {
    const document = demoDocument();
    document.policies.activityRequiresLane = true;
    const editor = new Editor(document, registry),
      before = editor.snapshot;
    const operation = nodeDropOperation(before, 'receive', {
      ...before.nodes.receive.bounds,
      x: -1000,
      y: -1000,
    });
    expect(() => editor.dispatch('越界', [operation])).toThrow('当前文档不允许放在泳池外');
    expect(editor.snapshot).toEqual(before);
  });
  it('命中泳池标题时吸附最近的泳道，不错误解除归属', () => {
    const document = demoDocument();
    const editor = new Editor(document, registry);
    const b = absoluteBounds(document, document.nodes.pool_order);
    const operation = nodeDropOperation(document, 'receive', {
      ...document.nodes.receive.bounds,
      x: b.x + 18 - document.nodes.receive.bounds.width / 2,
      y: b.y + 80,
    });
    editor.dispatch('拖到泳池标题', [operation]);
    expect(editor.snapshot.nodes.receive.parentId).toBe('lane_sales');
    expect(editor.snapshot.nodes.receive.bounds.x).toBe(80);
  });
});
