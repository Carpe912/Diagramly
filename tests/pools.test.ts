import { describe, expect, it } from 'vitest';
import { Editor } from '../src/application/editor';
import { demoDocument } from '../src/application/demo';
import { emptyDocument } from '../src/domain/model';
import {
  absoluteBounds,
  childrenOf,
  isPoolType,
  laneInsets,
  poolLanes,
  upgradeStandaloneLanes,
} from '../src/domain/pools';
import { createShapeRegistry } from '../src/shapes/registry';
import { nodePresentation } from '../src/shapes/presentation';
import { validateDocument } from '../src/domain/validation';
const registry = createShapeRegistry();
const make = () => new Editor(demoDocument(), registry);
function addPool(editor: Editor, orientation: 'horizontal' | 'vertical') {
  const operations = editor.createPool(orientation, 1400, 70),
    create = operations[0];
  if (create.type !== 'node.create') throw Error();
  editor.dispatch('新建泳池', operations);
  return create.node.id;
}
describe('pool hierarchy and deterministic layout', () => {
  it.each(['horizontal', 'vertical'] as const)(
    'creates an entire %s pool in one reversible transaction',
    (orientation) => {
      const editor = new Editor(emptyDocument(), registry),
        id = addPool(editor, orientation),
        doc = editor.snapshot;
      expect(Object.keys(doc.nodes)).toHaveLength(3);
      expect(poolLanes(doc, id)).toHaveLength(2);
      const [a, b] = poolLanes(doc, id);
      if (orientation === 'horizontal') {
        expect(a.bounds.x).toBe(36);
        expect(b.bounds.y).toBe(a.bounds.height);
        expect(a.bounds.width).toBe(b.bounds.width);
      } else {
        expect(a.bounds.y).toBe(36);
        expect(b.bounds.x).toBe(a.bounds.width);
        expect(a.bounds.height).toBe(b.bounds.height);
      }
      editor.undo();
      expect(Object.keys(editor.snapshot.nodes)).toHaveLength(0);
      editor.redo();
      expect(poolLanes(editor.snapshot, id).map((n) => n.id)).toEqual([a.id, b.id]);
    },
  );
  it('adds an ordered lane without moving local activity coordinates, and rolls back a failed batch', () => {
    const editor = make(),
      before = structuredClone(editor.snapshot),
      bounds = editor.snapshot.nodes.receive.bounds;
    editor.dispatch('加泳道', [
      {
        type: 'pool.lane.add',
        poolId: 'pool_order',
        laneId: 'lane_added',
        entityId: 'entity_added',
        name: '新增角色',
        index: 1,
      },
    ]);
    expect(poolLanes(editor.snapshot, 'pool_order').map((n) => n.id)).toEqual([
      'lane_sales',
      'lane_added',
      'lane_ops',
    ]);
    expect(editor.snapshot.nodes.receive.bounds).toEqual(bounds);
    editor.undo();
    expect(editor.snapshot.nodes.pool_order.bounds).toEqual(before.nodes.pool_order.bounds);
    expect(() =>
      editor.dispatch('失败批次', [
        {
          type: 'pool.lane.add',
          poolId: 'pool_order',
          laneId: 'lane_bad',
          entityId: 'entity_bad',
          name: '不会提交',
        },
        { type: 'node.delete', id: 'missing' },
      ]),
    ).toThrow();
    expect(editor.snapshot.nodes.lane_bad).toBeUndefined();
    expect(editor.snapshot.nodes.pool_order.bounds).toEqual(before.nodes.pool_order.bounds);
  });
  it('removes a populated lane and its incident edges atomically while preserving the other lane', () => {
    const editor = make(),
      other = structuredClone(editor.snapshot.entities.entity_deliver);
    editor.dispatch('删泳道', [
      { type: 'pool.lane.remove', poolId: 'pool_order', laneId: 'lane_sales' },
    ]);
    expect(editor.snapshot.nodes.receive).toBeUndefined();
    expect(editor.snapshot.entities.entity_receive).toBeUndefined();
    expect(Object.keys(editor.snapshot.edges)).toEqual(['edge_end']);
    expect(editor.snapshot.entities.entity_deliver).toEqual(other);
    expect(editor.snapshot.nodes.lane_ops.bounds.y).toBe(0);
    expect(() => editor.dispatch('删最后一条', [{ type: 'node.delete', id: 'lane_ops' }])).toThrow(
      '至少保留',
    );
    editor.undo();
    expect(editor.snapshot.nodes.receive).toBeDefined();
    expect(Object.keys(editor.snapshot.edges)).toHaveLength(6);
  });
  it('deletes the whole pool with descendants and restores all IDs and edges on undo', () => {
    const editor = make(),
      before = structuredClone(editor.snapshot);
    editor.dispatch('删除泳池', [{ type: 'node.delete', id: 'pool_order' }]);
    expect(Object.keys(editor.snapshot.nodes)).toHaveLength(0);
    expect(Object.keys(editor.snapshot.entities)).toHaveLength(0);
    expect(Object.keys(editor.snapshot.edges)).toHaveLength(0);
    editor.undo();
    expect(editor.snapshot.nodes).toEqual(before.nodes);
    expect(editor.snapshot.edges).toEqual(before.edges);
  });
  it('changes header placement and content constraints without replacing any business IDs or edges', () => {
    const editor = make(),
      before = structuredClone(editor.snapshot);
    editor.dispatch('改方向', [
      { type: 'pool.orientation', id: 'pool_order', orientation: 'vertical' },
    ]);
    const doc = editor.snapshot;
    expect(doc.nodes.pool_order.type).toBe('pool-vertical');
    expect(doc.edges).toEqual(before.edges);
    expect(doc.entities).toEqual(before.entities);
    expect(doc.nodes.lane_sales.bounds.y).toBe(36);
    expect(doc.nodes.lane_ops.bounds.x).toBe(doc.nodes.lane_sales.bounds.width);
    expect(nodePresentation(doc, doc.nodes.lane_sales, registry).parts[0].bounds.height).toBe(39);
    expect(laneInsets(doc, doc.nodes.lane_sales)).toEqual({
      left: 12,
      top: 52,
      right: 12,
      bottom: 12,
    });
    for (const node of childrenOf(doc, 'lane_sales'))
      expect(node.bounds.y).toBeGreaterThanOrEqual(52);
    editor.undo();
    expect(editor.snapshot.nodes).toEqual(before.nodes);
  });
  it('moves a lane between differently oriented pools with its activities and role bindings intact', () => {
    const editor = make(),
      target = addPool(editor, 'vertical'),
      before = structuredClone(editor.snapshot.entities.entity_receive),
      edges = structuredClone(editor.snapshot.edges);
    editor.dispatch('跨泳池', [{ type: 'pool.lane.move', laneId: 'lane_sales', poolId: target }]);
    const doc = editor.snapshot;
    expect(doc.nodes.lane_sales.parentId).toBe(target);
    expect(poolLanes(doc, 'pool_order')).toHaveLength(1);
    expect(poolLanes(doc, target)).toHaveLength(3);
    expect(doc.nodes.receive.parentId).toBe('lane_sales');
    expect(doc.entities.entity_receive).toEqual(before);
    expect(doc.edges).toEqual(edges);
    const title = nodePresentation(doc, doc.nodes.lane_sales, registry).parts[0];
    expect(title.bounds.width).toBe(doc.nodes.lane_sales.bounds.width - 2);
    expect(title.bounds.height).toBe(39);
  });
  it('moves a pool as a whole and keeps all child coordinates relative', () => {
    const editor = make(),
      local = structuredClone(editor.snapshot.nodes.receive.bounds),
      absolute = absoluteBounds(editor.snapshot, editor.snapshot.nodes.receive);
    editor.dispatch('移动泳池', [{ type: 'node.move', id: 'pool_order', x: 124, y: 270 }]);
    expect(editor.snapshot.nodes.receive.bounds).toEqual(local);
    expect(absoluteBounds(editor.snapshot, editor.snapshot.nodes.receive)).toMatchObject({
      x: absolute.x + 100,
      y: absolute.y + 200,
    });
  });
  it('resizes pools and lane dividers without shrinking over existing activity content', () => {
    const editor = make(),
      bounds = structuredClone(editor.snapshot.nodes.pool_order.bounds),
      activity = structuredClone(editor.snapshot.nodes.deliver.bounds);
    expect(() =>
      editor.dispatch('非法缩小', [
        { type: 'node.resize', id: 'pool_order', bounds: { ...bounds, width: 400, height: 250 } },
      ]),
    ).toThrow('尺寸不足');
    editor.dispatch('调整泳道', [{ type: 'pool.lane.resize', laneId: 'lane_sales', extent: 300 }]);
    expect(editor.snapshot.nodes.pool_order.bounds.height).toBe(bounds.height + 90);
    expect(editor.snapshot.nodes.lane_ops.bounds.y).toBe(300);
    expect(editor.snapshot.nodes.deliver.bounds).toEqual(activity);
    expect(() =>
      editor.dispatch('过小泳道', [
        { type: 'pool.lane.resize', laneId: 'lane_sales', extent: 150 },
      ]),
    ).toThrow('无法容纳');
  });
  it('泳道独立外观不被泳池修改覆盖，未覆盖的泳道继承泳池主题', () => {
    const editor = make();
    editor.dispatch('单独泳道', [
      { type: 'node.appearance', id: 'lane_sales', fill: '#ffeedd', fontColor: '#aa4400' },
    ]);
    editor.dispatch('统一泳池主题', [
      {
        type: 'node.appearance',
        id: 'pool_order',
        fill: '#e9f5ed',
        headerFill: '#bedccc',
        fontColor: '#315342',
      },
    ]);
    const doc = editor.snapshot;
    expect(nodePresentation(doc, doc.nodes.lane_sales, registry)).toMatchObject({
      fill: '#ffeedd',
      fontColor: '#aa4400',
    });
    for (const id of ['pool_order', 'lane_ops'])
      expect(nodePresentation(doc, doc.nodes[id], registry)).toMatchObject({
        fill: '#e9f5ed',
        fontColor: '#315342',
      });
    expect(nodePresentation(doc, doc.nodes.receive, registry).fill).toBe('#ffffff');
    editor.undo();
    expect(editor.snapshot.nodes.lane_sales.appearance.fill).toBe('#ffeedd');
  });
  it('upgrades old standalone lanes once while preserving activity positions, identities and edges', () => {
    const old = demoDocument(),
      before = absoluteBounds(old, old.nodes.receive);
    delete old.nodes.pool_order;
    delete old.entities.entity_pool_order;
    old.nodes.lane_sales.bounds = { x: 60, y: 70, width: 1100, height: 210 };
    old.nodes.lane_ops.bounds = { x: 60, y: 280, width: 1100, height: 230 };
    for (const id of ['lane_sales', 'lane_ops']) {
      delete old.nodes[id].parentId;
      delete old.nodes[id].laneOrder;
    }
    const upgraded = validateDocument(upgradeStandaloneLanes(old), registry);
    expect(Object.values(upgraded.nodes).filter((n) => isPoolType(n.type))).toHaveLength(1);
    expect(absoluteBounds(upgraded, upgraded.nodes.receive)).toEqual(before);
    expect(upgraded.edges).toEqual(old.edges);
    expect(upgradeStandaloneLanes(upgraded)).toEqual(upgraded);
  });
  it.each(['pool-in-pool', 'activity-in-pool', 'duplicate-order', 'overlap', 'cycle'])(
    'rejects illegal container structure: %s',
    (kind) => {
      const doc = demoDocument();
      if (kind === 'pool-in-pool') doc.nodes.pool_order.parentId = 'lane_sales';
      if (kind === 'activity-in-pool') doc.nodes.receive.parentId = 'pool_order';
      if (kind === 'duplicate-order') doc.nodes.lane_ops.laneOrder = 0;
      if (kind === 'overlap') doc.nodes.lane_ops.bounds.y = 0;
      if (kind === 'cycle') doc.nodes.lane_sales.parentId = 'receive';
      expect(() => validateDocument(doc, registry)).toThrow();
    },
  );
});
describe('pool content expansion', () => {
  it('copies a business node in a vertical lane by expanding the pool rather than clipping it', () => {
    const editor = make();
    editor.dispatch('垂直', [
      { type: 'pool.orientation', id: 'pool_order', orientation: 'vertical' },
    ]);
    const before = editor.snapshot.nodes.pool_order.bounds.width;
    editor.dispatch('复制活动', [
      {
        type: 'node.duplicate',
        id: 'receive',
        newId: 'vertical_copy',
        newEntityId: 'entity_vertical_copy',
        offset: { x: 30, y: 30 },
      },
    ]);
    expect(editor.snapshot.nodes.vertical_copy.parentId).toBe('lane_sales');
    expect(editor.snapshot.nodes.pool_order.bounds.width).toBeGreaterThan(before);
    expect(() => validateDocument(editor.snapshot, registry)).not.toThrow();
  });
});
describe('lane drag sizing contract', () => {
  it.each(['horizontal', 'vertical'] as const)(
    'resizes both dimensions of a %s lane and its pool atomically',
    (orientation) => {
      const editor = make();
      if (orientation === 'vertical')
        editor.dispatch('转为垂直', [{ type: 'pool.orientation', id: 'pool_order', orientation }]);
      const before = structuredClone(editor.snapshot),
        lane = before.nodes.lane_sales,
        pool = before.nodes.pool_order;
      const vertical = orientation === 'vertical',
        extent = (vertical ? lane.bounds.width : lane.bounds.height) + 80;
      const crossExtent = (vertical ? lane.bounds.height : lane.bounds.width) + 100;
      editor.dispatch('拖拽泳道', [
        { type: 'pool.lane.resize', laneId: lane.id, extent, crossExtent },
      ]);
      const next = editor.snapshot;
      expect(
        vertical ? next.nodes.pool_order.bounds.width : next.nodes.pool_order.bounds.height,
      ).toBe((vertical ? pool.bounds.width : pool.bounds.height) + 80);
      expect(
        vertical ? next.nodes.pool_order.bounds.height : next.nodes.pool_order.bounds.width,
      ).toBe(crossExtent + 36);
      for (const item of poolLanes(next, pool.id))
        expect(vertical ? item.bounds.height : item.bounds.width).toBe(crossExtent);
      expect(next.nodes.receive.bounds).toEqual(before.nodes.receive.bounds);
      expect(next.edges).toEqual(before.edges);
      editor.undo();
      expect(editor.snapshot.nodes).toEqual(before.nodes);
    },
  );
  it('rejects shrinking shared space over a sibling activity with no partial changes', () => {
    const editor = make(),
      before = structuredClone(editor.snapshot);
    expect(() =>
      editor.dispatch('遮挡其他泳道', [
        { type: 'pool.lane.resize', laneId: 'lane_sales', extent: 300, crossExtent: 400 },
      ]),
    ).toThrow('其他泳道');
    expect(editor.snapshot).toEqual(before);
  });
});

describe('泳道名称由角色选择维护', () => {
  it('拒绝直接改名及绕过选择入口修改角色', () => {
    const editor = make(),
      before = structuredClone(editor.snapshot);
    for (const patch of [{ name: '手动改名' }, { roleIds: ['role_sales'] }]) {
      expect(() =>
        editor.dispatch('手动修改泳道', [{ type: 'node.update', id: 'lane_sales', patch }]),
      ).toThrow('通过角色泳道选择角色');
    }
    expect(editor.snapshot).toEqual(before);
  });
  it('多角色名称和角色引用一起更新，撤销与重做保持一致', () => {
    const editor = make(),
      before = structuredClone(editor.snapshot);
    editor.dispatch('选择角色', [
      {
        type: 'lane.roles.set',
        laneId: 'lane_sales',
        roles: [
          { id: 'role_sales', name: '销售' },
          { id: 'role_audit', name: '审核' },
        ],
      },
    ]);
    expect(editor.snapshot.entities.entity_lane_sales).toMatchObject({
      name: '销售、审核',
      roleIds: ['role_sales', 'role_audit'],
    });
    expect(editor.snapshot.nodes).toEqual(before.nodes);
    expect(editor.snapshot.edges).toEqual(before.edges);
    editor.undo();
    expect(editor.snapshot.entities.entity_lane_sales).toEqual(before.entities.entity_lane_sales);
    editor.redo();
    expect(editor.snapshot.entities.entity_lane_sales.name).toBe('销售、审核');
  });
  it('清空角色后显示默认名称，不能将角色绑定到其他图形', () => {
    const editor = make();
    editor.dispatch('清空角色', [{ type: 'lane.roles.set', laneId: 'lane_sales', roles: [] }]);
    expect(editor.snapshot.entities.entity_lane_sales).toMatchObject({
      name: '角色泳道',
      roleIds: [],
    });
    expect(() =>
      editor.dispatch('错误绑定', [{ type: 'lane.roles.set', laneId: 'receive', roles: [] }]),
    ).toThrow('只能为泳道');
  });
});
it('编辑角色说明不触发改名限制，普通补丁保留未提交的角色引用', () => {
  const doc = demoDocument();
  doc.entities.entity_receive.roleIds = ['role_original'];
  const editor = new Editor(doc, registry);
  editor.dispatch('修改角色说明', [
    { type: 'node.update', id: 'lane_sales', patch: { role: '销售负责人' } },
  ]);
  expect(editor.snapshot.entities.entity_lane_sales).toMatchObject({
    name: '销售团队',
    role: '销售负责人',
  });
  editor.dispatch('改活动名称', [
    { type: 'node.update', id: 'receive', patch: { name: '新的活动名称' } },
  ]);
  expect(editor.snapshot.entities.entity_receive.roleIds).toEqual(['role_original']);
});
