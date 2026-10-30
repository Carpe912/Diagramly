import type { DiagramDocument } from '../../domain/model';
import type { ShapeRegistry } from '../../shapes/registry';
import { readFlow, writeFlow } from '../formats/xml';
import { exportDiagramPng } from '../maxgraph/export';
import { downloadBlob, parseDocument } from './local';
const MAX_BYTES = 8 * 1024 * 1024;
export type ExportFormat = 'json' | 'xml' | 'png';
async function decompressDiagram(text: string) {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('XML 中的压缩画布编码无效');
  }
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new Error('解压后的 XML 超过 8MB 上限');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return decodeURIComponent(new TextDecoder().decode(output));
  } catch {
    throw new Error('XML 中的压缩画布内容无效');
  }
}
/** 文件入口支持原始模型及单画布 draw.io 文件，不会静默丢弃多画布文档。 */
export async function importGraphFile(
  text: string,
  filename: string,
  registry: ShapeRegistry,
): Promise<DiagramDocument> {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('文件超过 8MB 上限');
  const source = text.trim();
  if (source.startsWith('{')) return parseDocument(source, registry);
  if (!source.startsWith('<') || /<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error('请选择有效的 JSON 或 XML 图形文档');
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('XML 格式不正确');
  let model = source,
    title = filename.replace(/\.(xml|drawio)$/i, '');
  if (xml.documentElement.tagName === 'mxfile') {
    const diagrams = [...xml.documentElement.children].filter((el) => el.tagName === 'diagram');
    if (diagrams.length !== 1) throw new Error('当前支持单画布 XML，请将多个画布分别导出后导入');
    const diagram = diagrams[0];
    title = diagram.getAttribute('name') || title;
    const child = diagram.firstElementChild;
    model = child
      ? new XMLSerializer().serializeToString(child)
      : (diagram.textContent?.trim() ?? '');
    if (!model.startsWith('<')) model = await decompressDiagram(model);
  }
  return readFlow(
    { id: 'imported', name: title || '导入的画布', version: 0, drawioXml: model },
    registry,
  ).document;
}
export async function downloadGraphFile(
  doc: DiagramDocument,
  registry: ShapeRegistry,
  format: ExportFormat,
) {
  const filename = `${doc.title}.diagramly.${format}`;
  const blob =
    format === 'png'
      ? await exportDiagramPng(doc, registry)
      : format === 'xml'
        ? new Blob([writeFlow(doc, registry, 'file_export')], { type: 'application/xml' })
        : new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}
