// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Editor } from '../src/application/editor';
import { emptyDocument } from '../src/domain/model';
import { createShapeRegistry } from '../src/shapes/registry';
import { nodePresentation } from '../src/shapes/presentation';
import { readFlow, writeFlow } from '../src/adapters/formats/xml';
describe('阶段图形', () => {
  it('阶段为一个有独立 ID 的组合节点，水平和垂直方向保留标题和虚线', () => {
    const registry = createShapeRegistry();
    const editor = new Editor(emptyDocument(), registry);
    for (const type of ['stage-horizontal', 'stage-vertical']) {
      const operation = editor.createNode(type, 0, 0);
      editor.dispatch('添加阶段', [operation]);
      if (operation.type !== 'node.create') throw new Error('创建操作无效');
      const parts = nodePresentation(editor.snapshot, operation.node, registry).parts;
      expect(parts[0].text).toContain('阶段');
      expect(parts[0]).toMatchObject({ fill: '#1ba1e2', stroke: operation.node.appearance.accent });
      const line = parts.find((part) => part.key === 'line-0')!;
      if (type === 'stage-horizontal') {
        expect(line.bounds.x).toBe(parts[0].bounds.x + parts[0].bounds.width);
        expect(line.bounds.y + line.bounds.height / 2).toBe(operation.node.bounds.height / 2);
      } else {
        expect(line.bounds.y).toBe(parts[0].bounds.y + parts[0].bounds.height);
        expect(line.bounds.x + line.bounds.width / 2).toBe(operation.node.bounds.width / 2);
      }
    }
    expect(Object.keys(editor.snapshot.nodes)).toHaveLength(2);
  });

  it('阶段标题保留背景与边框，文字样式可撤销并随 XML 保存', () => {
    const registry = createShapeRegistry();
    const editor = new Editor(emptyDocument(), registry);
    const create = editor.createNode('stage-horizontal', 20, 30);
    editor.dispatch('添加阶段', [create]);
    if (create.type !== 'node.create') throw new Error('创建操作无效');
    const id = create.node.id;
    editor.dispatch('修改阶段文字', [
      {
        type: 'node.appearance',
        id,
        fontColor: '#aabbcc',
        fontSize: 18,
        fontBold: false,
        textDirection: 'vertical',
      },
    ]);
    const stage = editor.snapshot.nodes[id];
    const projection = nodePresentation(editor.snapshot, stage, registry);
    expect(projection).toMatchObject({ fill: 'none', stroke: 'none' });
    expect(projection.parts[0]).toMatchObject({
      fill: '#1ba1e2',
      stroke: stage.appearance.accent,
      color: '#aabbcc',
      fontSize: 18,
      bold: false,
      vertical: true,
    });
    expect(projection.parts.slice(1).every((part) => part.key.startsWith('line-'))).toBe(true);
    const xml = writeFlow(editor.snapshot, registry, 'flow_test');
    expect(xml).toContain('strokeColor=none;');
    expect(xml).toContain('fontColor=#aabbcc;fontSize=18;fontStyle=0;');
    const restored = readFlow(
      { id: 'flow_test', name: '阶段', version: 1, drawioXml: xml },
      registry,
    ).document;
    expect(restored.nodes[id].appearance).toMatchObject({
      fontColor: '#aabbcc',
      fontSize: 18,
      fontBold: false,
      textDirection: 'vertical',
    });
    editor.undo();
    expect(editor.snapshot.nodes[id].appearance.fontSize).toBeUndefined();
  });
});
