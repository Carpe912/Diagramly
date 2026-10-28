import { describe, expect, it } from 'vitest';
import { Editor } from '../src/application/editor';
import { demoDocument } from '../src/application/demo';
import { emptyDocument } from '../src/domain/model';
import { absoluteBounds } from '../src/domain/pools';
import { createShapeRegistry } from '../src/shapes/registry';
import type { Alignment } from '../src/domain/alignment';
const registry = createShapeRegistry();
function make() {
  const editor = new Editor(emptyDocument(), registry);
  const a = editor.createNode('rectangle', 43, 65),
    b = editor.createNode('rectangle', 287, 253);
  if (a.type !== 'node.create' || b.type !== 'node.create') throw Error();
  b.node.bounds.width = 100;
  b.node.bounds.height = 60;
  editor.dispatch('创建', [a, b]);
  return { editor, ids: [a.node.id, b.node.id] };
}
describe('节点对齐', () => {
  it.each(['left', 'center', 'right', 'top', 'middle', 'bottom'] as Alignment[])(
    '按选择包围框执行 %s 对齐，撤销不影响实体',
    (mode) => {
      const { editor, ids } = make(),
        before = editor.snapshot;
      editor.dispatch('对齐', [{ type: 'nodes.align', ids, mode }]);
      const bounds = ids.map((id) => editor.snapshot.nodes[id].bounds);
      const axis = ['left', 'center', 'right'].includes(mode) ? 'x' : 'y',
        size = axis === 'x' ? 'width' : 'height';
      const factor = ['left', 'top'].includes(mode)
        ? 0
        : ['right', 'bottom'].includes(mode)
          ? 1
          : 0.5;
      expect(bounds[0][axis] + bounds[0][size] * factor).toBe(
        bounds[1][axis] + bounds[1][size] * factor,
      );
      expect(editor.snapshot.entities).toEqual(before.entities);
      editor.undo();
      expect(editor.snapshot.nodes).toEqual(before.nodes);
    },
  );
  it('隐藏网格仍可吸附，多选父子只移动父节点一次', () => {
    const editor = new Editor(demoDocument(), registry),
      before = editor.snapshot;
    editor.dispatch('吸附', [
      { type: 'nodes.align', ids: ['pool_order', 'receive'], mode: 'grid' },
    ]);
    expect(editor.snapshot.nodes.pool_order.bounds).toMatchObject({ x: 20, y: 80 });
    expect(editor.snapshot.nodes.receive).toEqual(before.nodes.receive);
    expect(absoluteBounds(editor.snapshot, editor.snapshot.nodes.receive).x).toBe(271);
  });
  it('跨泳道使用绝对坐标，吸附不会把泳道内图形移出内容区', () => {
    const editor = new Editor(demoDocument(), registry);
    editor.dispatch('对齐', [{ type: 'nodes.align', ids: ['confirm', 'deliver'], mode: 'left' }]);
    const d = editor.snapshot;
    expect(absoluteBounds(d, d.nodes.confirm).x).toBe(absoluteBounds(d, d.nodes.deliver).x);
    editor.dispatch('吸附', [
      { type: 'nodes.align', ids: ['receive', 'confirm', 'deliver'], mode: 'grid' },
    ]);
    for (const id of ['receive', 'confirm', 'deliver']) {
      const b = absoluteBounds(editor.snapshot, editor.snapshot.nodes[id]);
      expect(b.x % 20).toBe(0);
      expect(b.y % 20).toBe(0);
    }
  });
  it('拒绝泳道独立对齐和越出泳道的对齐，整笔操作回滚', () => {
    const editor = new Editor(demoDocument(), registry),
      before = editor.snapshot;
    expect(() =>
      editor.dispatch('非法对齐', [
        { type: 'nodes.align', ids: ['lane_sales', 'lane_ops'], mode: 'top' },
      ]),
    ).toThrow('泳道');
    expect(() =>
      editor.dispatch('越界对齐', [
        { type: 'nodes.align', ids: ['confirm', 'deliver'], mode: 'top' },
      ]),
    ).toThrow();
    expect(editor.snapshot).toBe(before);
  });
});
