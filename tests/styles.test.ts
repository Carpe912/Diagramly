// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Editor } from '../src/application/editor';
import { demoDocument } from '../src/application/demo';
import { createShapeRegistry } from '../src/shapes/registry';
import { edgeLineAppearance, lineStyleFromXml, nodeLineAppearance } from '../src/shapes/styles';
import { writeFlow } from '../src/adapters/coopwire/codec';
import { importGraphFile } from '../src/adapters/storage/files';
import { createAgentTools } from '../src/agent/tools';
const registry = createShapeRegistry();
describe('图形与线条样式', () => {
  it('旧文档保持原来的外观，补丁保留未编辑的属性并可完整撤销', () => {
    const editor = new Editor(demoDocument(), registry),
      before = editor.snapshot;
    expect(edgeLineAppearance(before.edges.edge_check)).toMatchObject({
      routing: 'orthogonal',
      strokeWidth: 1.5,
      endArrow: 'block',
      opacity: 100,
    });
    expect(nodeLineAppearance(before.nodes.receive).corner).toBe('rounded');
    editor.dispatch('批量设置', [
      {
        type: 'edge.appearance',
        id: 'edge_check',
        strokeColor: '#123456',
        startArrow: 'diamond',
        endFill: false,
        jumpStyle: 'arc',
        jumpSize: 12,
      },
      {
        type: 'node.appearance',
        id: 'receive',
        strokeEnabled: false,
        opacity: 45,
        pattern: 'dotted',
        corner: 'sharp',
      },
    ]);
    editor.dispatch('增量更新', [
      {
        type: 'edge.update',
        id: 'edge_check',
        patch: { appearance: { strokeWidth: 4 }, label: '新标签' },
      },
    ]);
    expect(editor.snapshot.edges.edge_check.appearance).toMatchObject({
      strokeColor: '#123456',
      strokeWidth: 4,
      startArrow: 'diamond',
      endFill: false,
      jumpSize: 12,
    });
    expect(editor.snapshot.entities).toEqual(before.entities);
    editor.undo();
    editor.undo();
    expect(editor.snapshot.nodes).toEqual(before.nodes);
    expect(editor.snapshot.edges).toEqual(before.edges);
    editor.redo();
    expect(editor.snapshot.nodes.receive.appearance.opacity).toBe(45);
  });
  it('Agent 预览和应用走同一套样式校验，非法值不产生部分修改', async () => {
    const editor = new Editor(demoDocument(), registry),
      tools = createAgentTools(editor);
    const command = {
      commandId: 'style_agent',
      expectedRevision: 0,
      origin: 'agent',
      label: '设置线条',
      operations: [
        {
          type: 'edge.appearance',
          id: 'edge_yes',
          endArrow: 'oval',
          pattern: 'dotted-wide',
          startSpacing: 8,
        },
      ],
    };
    expect(tools.preview(command).document.edges.edge_yes.appearance?.endArrow).toBe('oval');
    expect(editor.snapshot.revision).toBe(0);
    await tools.apply(command);
    const before = editor.snapshot;
    for (const patch of [
      { opacity: 101 },
      { strokeWidth: 0 },
      { jumpSize: 0 },
      { startSpacing: -1 },
      { strokeColor: 'url(abc)' },
      { routing: 'invalid' },
    ]) {
      expect(() =>
        editor.dispatch('非法样式', [
          { type: 'edge.appearance', id: 'edge_yes', ...patch } as never,
        ]),
      ).toThrow();
      expect(editor.snapshot).toBe(before);
    }
  });
  it('JSON 和 XML 往返保留完整样式，标准 XML 使用兼容字段', async () => {
    const doc = demoDocument();
    doc.nodes.receive.appearance = {
      accent: '#336699',
      fill: '#eeeeee',
      fontColor: '#112233',
      strokeWidth: 3,
      strokeEnabled: false,
      opacity: 40,
      pattern: 'dotted-spaced',
      corner: 'sharp',
    };
    doc.edges.edge_yes.appearance = {
      strokeColor: '#225588',
      strokeWidth: 4,
      pattern: 'dotted-wide',
      opacity: 55,
      corner: 'rounded',
      shape: 'line',
      routing: 'elbow-vertical',
      startArrow: 'oval',
      endArrow: 'diamondThin',
      startFill: false,
      endFill: true,
      startSize: 12,
      endSize: 16,
      startSpacing: 5,
      endSpacing: 8,
      jumpStyle: 'arc',
      jumpSize: 14,
    };
    const xml = writeFlow(doc, registry, 'style_export');
    expect(xml).toContain('strokeColor=none;');
    expect(xml).toContain('dashPattern=1 4;');
    expect(xml).toContain('jumpStyle=arc;');
    expect(xml).toContain('targetPerimeterSpacing=8;');
    for (const source of [JSON.stringify(doc), xml])
      expect(await importGraphFile(source, '样式.xml', registry)).toEqual(doc);
    const model = new DOMParser().parseFromString(xml, 'application/xml');
    model.documentElement.removeAttribute('diagramlyDocument');
    const legacy = await importGraphFile(
      new XMLSerializer().serializeToString(model),
      '标准.xml',
      registry,
    );
    expect(
      Object.values(legacy.nodes).find((n) => legacy.entities[n.entityId].name === '接收客户订单')!
        .appearance,
    ).toMatchObject({
      strokeEnabled: false,
      strokeWidth: 3,
      opacity: 40,
      pattern: 'dotted-spaced',
    });
    expect(Object.values(legacy.edges).find((e) => e.label === '是')!.appearance).toMatchObject(
      doc.edges.edge_yes.appearance,
    );
  });
  it('导入时忽略不合法的外部样式值而保留有效字段', () => {
    expect(
      lineStyleFromXml(
        {
          strokeWidth: 'NaN',
          opacity: '200',
          endArrow: 'unknown',
          startSize: '12',
          dashed: '1',
          dashPattern: '1 2',
          strokeColor: 'none',
        },
        true,
      ),
    ).toEqual({ strokeEnabled: false, startSize: 12, pattern: 'dotted-spaced' });
  });
});
