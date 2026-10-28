// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Editor } from '../src/application/editor';
import { demoDocument } from '../src/application/demo';
import { defaultCanvasSettings } from '../src/domain/model';
import { createShapeRegistry } from '../src/shapes/registry';
import { readFlow, writeFlow } from '../src/adapters/coopwire/codec';
const registry = createShapeRegistry();
describe('画布设置', () => {
  it('旧文档默认透明且不显示网格，修改设置可完整撤销', () => {
    const editor = new Editor(demoDocument(), registry),
      before = structuredClone(editor.snapshot);
    expect(editor.snapshot.canvas ?? defaultCanvasSettings).toEqual({
      grid: false,
      gridSize: 20,
      background: null,
    });
    editor.dispatch('设置背景和网格', [
      {
        type: 'document.canvas.update',
        patch: { grid: true, gridSize: 25, background: '#123456' },
      },
    ]);
    expect(editor.snapshot.canvas).toEqual({ grid: true, gridSize: 25, background: '#123456' });
    expect(editor.snapshot.nodes).toEqual(before.nodes);
    editor.undo();
    expect(editor.snapshot.canvas).toBeUndefined();
    editor.redo();
    expect(editor.snapshot.canvas?.background).toBe('#123456');
  });
  it('网格间距超出范围时拒绝整笔修改', () => {
    const editor = new Editor(demoDocument(), registry),
      before = structuredClone(editor.snapshot);
    expect(() =>
      editor.dispatch('非法间距', [{ type: 'document.canvas.update', patch: { gridSize: 101 } }]),
    ).toThrow();
    expect(editor.snapshot).toEqual(before);
  });
  it('XML 往返保留背景和网格，同时写入兼容属性', () => {
    const doc = demoDocument();
    doc.canvas = { grid: true, gridSize: 30, background: '#f0f5fa' };
    const xml = writeFlow(doc, registry, 'cmd_canvas');
    expect(xml).toContain('background="#f0f5fa"');
    expect(xml).toContain('gridSize="30"');
    expect(
      readFlow({ id: 'flow', name: doc.title, version: 1, drawioXml: xml }, registry).document,
    ).toEqual(doc);
  });
});
