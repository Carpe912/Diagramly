// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { demoDocument } from '../src/application/demo';
import { createShapeRegistry } from '../src/shapes/registry';
import { writeFlow } from '../src/adapters/formats/xml';
import { importGraphFile } from '../src/adapters/storage/files';
const registry = createShapeRegistry();
describe('文档文件导入', () => {
  it('JSON 和 XML 往返保留业务实体、层级、连线及画布设置', async () => {
    const doc = demoDocument();
    doc.canvas = { background: '#eef5fa', grid: true, gridSize: 25 };
    for (const text of [JSON.stringify(doc), writeFlow(doc, registry, 'file_export')])
      expect(await importGraphFile(text, '流程.xml', registry)).toEqual(doc);
  });
  it('读取单画布 mxfile 中的标准基础图形和连线', async () => {
    const model =
      '<mxGraphModel background="#eef5fa" grid="1" gridSize="30"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" parent="1" vertex="1" value="起点" style="rounded=1;fillColor=#ddeecc"><mxGeometry x="10" y="20" width="160" height="80" as="geometry"/></mxCell><mxCell id="b" parent="1" vertex="1" value="椭圆" style="ellipse;"><mxGeometry x="260" y="20" width="140" height="80" as="geometry"/></mxCell><mxCell id="e" edge="1" source="a" target="b" parent="1"/></root></mxGraphModel>';
    const doc = await importGraphFile(
      `<mxfile><diagram name="导入流程">${model}</diagram></mxfile>`,
      'file.xml',
      registry,
    );
    expect(doc.title).toBe('导入流程');
    expect(Object.values(doc.nodes).map((n) => n.type)).toEqual(['rectangle', 'ellipse']);
    expect(Object.keys(doc.edges)).toHaveLength(1);
    expect(doc.canvas).toEqual({ background: '#eef5fa', grid: true, gridSize: 30 });
  });
  it('读取 draw.io 压缩画布', async () => {
    const doc = demoDocument(),
      model = writeFlow(doc, registry, 'compressed_export');
    const encoded = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64');
    expect(
      await importGraphFile(
        `<mxfile><diagram>${encoded}</diagram></mxfile>`,
        'test.drawio',
        registry,
      ),
    ).toEqual(doc);
  });
  it('拒绝多画布和外部实体声明，避免静默丢数据', async () => {
    await expect(
      importGraphFile('<mxfile><diagram/><diagram/></mxfile>', 'file.xml', registry),
    ).rejects.toThrow('多个画布');
    await expect(
      importGraphFile('<!DOCTYPE mxGraphModel><mxGraphModel/>', 'file.xml', registry),
    ).rejects.toThrow('有效的 JSON 或 XML');
  });
});
