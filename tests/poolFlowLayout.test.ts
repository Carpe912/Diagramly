import { describe, expect, it } from 'vitest';
import { Editor } from '../src/application/editor';
import { demoDocument } from '../src/application/demo';
import { emptyDocument, type DiagramDocument } from '../src/domain/model';
import { absoluteBounds, childrenOf, poolLanes } from '../src/domain/pools';
import { validateDocument } from '../src/domain/validation';
import { createShapeRegistry } from '../src/shapes/registry';
import { edgeRouteStyle } from '../src/shapes/styles';

const registry = createShapeRegistry();
function noOverlap(doc: DiagramDocument) {
  expect(() => validateDocument(doc, registry)).not.toThrow();
  for (const lane of poolLanes(doc, 'pool_order')) {
    const nodes = childrenOf(doc, lane.id);
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].bounds,
          b = nodes[j].bounds;
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        ).toBe(true);
      }
  }
}

describe('泳池流程布局', () => {
  it('交接步骤对齐，端点随方向重选，布局和连线可一起撤销重做', () => {
    const editor = new Editor(demoDocument(), registry),
      before = editor.snapshot;
    editor.dispatch('垂直', [
      { type: 'pool.orientation', id: 'pool_order', orientation: 'vertical' },
    ]);
    const vertical = editor.snapshot;
    noOverlap(vertical);
    for (const id of ['start', 'receive', 'check', 'confirm', 'deliver', 'end']) {
      expect(vertical.nodes[id].bounds.width).toBe(before.nodes[id].bounds.width);
      expect(vertical.nodes[id].bounds.height).toBe(before.nodes[id].bounds.height);
      expect(vertical.nodes[id].parentId).toBe(before.nodes[id].parentId);
    }
    const confirm = absoluteBounds(vertical, vertical.nodes.confirm),
      deliver = absoluteBounds(vertical, vertical.nodes.deliver);
    expect(confirm.y + confirm.height / 2).toBe(deliver.y + deliver.height / 2);
    expect(vertical.edges.edge_deliver.source.portId).toBe('right');
    expect(vertical.edges.edge_deliver.target.portId).toBe('left');
    expect(vertical.edges.edge_start.source.portId).toBe('bottom');
    expect(vertical.edges.edge_end.target.portId).toBe('top');
    expect(vertical.nodes.receive.bounds.y + vertical.nodes.receive.bounds.height).toBeLessThan(
      vertical.nodes.check.bounds.y,
    );
    const back = vertical.edges.edge_no;
    const sourcePort = registry
      .get('decision')
      .ports.find((port) => port.id === back.source.portId)!;
    const targetPort = registry
      .get('activity')
      .ports.find((port) => port.id === back.target.portId)!;
    const route = edgeRouteStyle(vertical, back, sourcePort, targetPort);
    const channel = vertical.nodes.check.bounds.x - route.sourceJettySize!;
    expect(channel).toBe(vertical.nodes.receive.bounds.x - route.targetJettySize!);
    expect(channel).toBeLessThan(
      Math.min(...childrenOf(vertical, 'lane_sales').map((node) => node.bounds.x)),
    );
    editor.dispatch('水平', [
      { type: 'pool.orientation', id: 'pool_order', orientation: 'horizontal' },
    ]);
    const horizontal = editor.snapshot;
    noOverlap(horizontal);
    const a = absoluteBounds(horizontal, horizontal.nodes.confirm),
      b = absoluteBounds(horizontal, horizontal.nodes.deliver);
    expect(a.x + a.width / 2).toBe(b.x + b.width / 2);
    expect(horizontal.edges.edge_deliver.source.portId).toBe('bottom');
    expect(horizontal.edges.edge_deliver.target.portId).toBe('top');
    editor.undo();
    expect(editor.snapshot.nodes).toEqual(vertical.nodes);
    expect(editor.snapshot.edges).toEqual(vertical.edges);
    editor.redo();
    expect(editor.snapshot.nodes).toEqual(horizontal.nodes);
    editor.undo();
    editor.undo();
    expect(editor.snapshot.nodes).toEqual(before.nodes);
    expect(editor.snapshot.edges).toEqual(before.edges);
  });

  it.each(['horizontal', 'vertical'] as const)(
    '%s 分支、回路和孤立节点不重叠，池外节点不受影响',
    (orientation) => {
      const doc = demoDocument();
      for (const [id, width, height] of [
        ['branch_a', 280, 180],
        ['branch_b', 200, 120],
        ['isolated', 200, 120],
      ] as const) {
        doc.nodes[id] = {
          ...structuredClone(doc.nodes.receive),
          id,
          entityId: `entity_${id}`,
          bounds: { x: 220, y: 45, width, height },
        };
        doc.entities[`entity_${id}`] = {
          ...structuredClone(doc.entities.entity_receive),
          id: `entity_${id}`,
          name: id,
        };
        if (id !== 'isolated') {
          doc.edges[`${id}_in`] = {
            id: `${id}_in`,
            source: { nodeId: 'check', portId: 'right' },
            target: { nodeId: id, portId: 'left' },
            label: id,
          };
          doc.edges[`${id}_out`] = {
            id: `${id}_out`,
            source: { nodeId: id, portId: 'right' },
            target: { nodeId: 'confirm', portId: 'left' },
            label: '',
          };
        }
      }
      // 让初始重叠节点完整落在容器内；切换方向应主动消除重叠。
      doc.nodes.lane_sales.bounds.height = 260;
      doc.nodes.lane_ops.bounds.y = 260;
      doc.nodes.pool_order.bounds.height = 490;
      doc.nodes.outside = {
        ...structuredClone(doc.nodes.check),
        id: 'outside',
        entityId: 'entity_outside',
        parentId: undefined,
        bounds: { x: 1800, y: 70, width: 140, height: 100 },
      };
      doc.entities.entity_outside = {
        ...structuredClone(doc.entities.entity_check),
        id: 'entity_outside',
      };
      doc.edges.edge_no.appearance = {
        strokeColor: '#112233',
        pattern: 'dashed',
        endArrow: 'open',
        strokeWidth: 3,
      };
      const editor = new Editor(doc, registry),
        before = editor.snapshot;
      editor.dispatch('垂直', [
        { type: 'pool.orientation', id: 'pool_order', orientation: 'vertical' },
      ]);
      if (orientation === 'horizontal')
        editor.dispatch('水平', [{ type: 'pool.orientation', id: 'pool_order', orientation }]);
      const result = editor.snapshot;
      noOverlap(result);
      expect(result.nodes.outside).toEqual(before.nodes.outside);
      expect(result.entities).toEqual(before.entities);
      expect(result.edges.edge_no.appearance).toMatchObject({
        strokeColor: '#112233',
        pattern: 'dashed',
        endArrow: 'open',
        strokeWidth: 3,
        routing: 'orthogonal',
      });
      for (const edge of Object.values(result.edges)) {
        expect(edge.source.nodeId).toBe(before.edges[edge.id].source.nodeId);
        expect(edge.target.nodeId).toBe(before.edges[edge.id].target.nodeId);
        expect(edge.label).toBe(before.edges[edge.id].label);
      }
    },
  );

  it('空泳池也可切换方向，重复切换的布局保持确定', () => {
    const empty = new Editor(emptyDocument(), registry);
    const operations = empty.createPool('horizontal', 20, 30);
    const create = operations[0];
    if (create.type !== 'node.create') throw new Error('创建操作无效');
    empty.dispatch('泳池', operations);
    empty.dispatch('垂直', [
      { type: 'pool.orientation', id: create.node.id, orientation: 'vertical' },
    ]);
    expect(() => validateDocument(empty.snapshot, registry)).not.toThrow();
    const editor = new Editor(demoDocument(), registry);
    editor.dispatch('垂直', [
      { type: 'pool.orientation', id: 'pool_order', orientation: 'vertical' },
    ]);
    const before = editor.snapshot;
    editor.dispatch('水平', [
      { type: 'pool.orientation', id: 'pool_order', orientation: 'horizontal' },
    ]);
    editor.dispatch('垂直', [
      { type: 'pool.orientation', id: 'pool_order', orientation: 'vertical' },
    ]);
    expect(editor.snapshot.nodes).toEqual(before.nodes);
    expect(editor.snapshot.edges).toEqual(before.edges);
  });
});
