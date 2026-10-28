import { Editor } from '../../application/editor';
import type { DiagramDocument } from '../../domain/model';
import type { ShapeRegistry } from '../../shapes/registry';
import { DiagramCanvas } from './canvas';

export async function exportDiagramPng(
  documentData: DiagramDocument,
  registry: ShapeRegistry,
): Promise<Blob> {
  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;left:-20000px;top:0;width:1600px;height:1000px;pointer-events:none;opacity:0';
  document.body.append(container);
  const canvas = new DiagramCanvas(container, new Editor(documentData, registry), {
    select: () => {},
    error: (e) => {
      throw e;
    },
    zoom: () => {},
  });
  let url: string | undefined;
  try {
    const graph = canvas.graph,
      bounds = graph.getGraphBounds();
    const width = Math.max(64, bounds.width + 32),
      height = Math.max(64, bounds.height + 32);
    const scale = Math.min(
      1,
      4096 / Math.max(width, height),
      Math.sqrt(12_000_000 / (width * height)),
    );
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svg.setAttribute('width', String(Math.ceil(width * scale)));
    svg.setAttribute('height', String(Math.ceil(height * scale)));
    svg.setAttribute('viewBox', `${bounds.x - 16} ${bounds.y - 16} ${width} ${height}`);
    svg.append(graph.view.getDrawPane().cloneNode(true));
    const source = new XMLSerializer()
      .serializeToString(svg)
      .replace(/url\([^)]*#([^)]*)\)/g, 'url(#$1)');
    url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    const image = new Image();
    image.src = url;
    await image.decode();
    const output = document.createElement('canvas');
    output.width = Math.ceil(width * scale);
    output.height = Math.ceil(height * scale);
    const context = output.getContext('2d');
    if (!context) throw new Error('浏览器不支持预览图导出');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      output.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG 生成失败'))),
        'image/png',
      ),
    );
  } finally {
    if (url) URL.revokeObjectURL(url);
    canvas.destroy();
    container.remove();
  }
}
