import { defaultCanvasSettings, type DiagramDocument } from './model';
import { absoluteBounds, isManagedLane, laneInsets } from './pools';
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'grid';
/** 按文档绝对坐标对齐，保存时还原为父容器内的相对坐标。 */
export function alignNodes(doc: DiagramDocument, ids: string[], mode: Alignment) {
  const selected = new Set(ids);
  const nodes = [...selected].map((id) => {
    const node = doc.nodes[id];
    if (!node) throw new Error(`节点不存在：${id}`);
    return node;
  });
  if (nodes.some((n) => isManagedLane(doc, n)))
    throw new Error('泳道位置由泳池布局管理，不能独立对齐');
  const roots = nodes.filter((n) => {
    let parent = n.parentId;
    const seen = new Set<string>();
    while (parent) {
      if (seen.has(parent)) throw new Error('容器层级存在循环');
      seen.add(parent);
      if (selected.has(parent)) return false;
      parent = doc.nodes[parent]?.parentId;
    }
    return true;
  });
  if (mode !== 'grid' && roots.length < 2) throw new Error('请至少选择两个独立节点进行对齐');
  const bounds = roots.map((n) => absoluteBounds(doc, n)),
    left = Math.min(...bounds.map((b) => b.x)),
    top = Math.min(...bounds.map((b) => b.y));
  const right = Math.max(...bounds.map((b) => b.x + b.width)),
    bottom = Math.max(...bounds.map((b) => b.y + b.height));
  const step = (doc.canvas ?? defaultCanvasSettings).gridSize;
  for (const [index, node] of roots.entries()) {
    const b = bounds[index];
    let x = b.x,
      y = b.y;
    if (mode === 'left') x = left;
    if (mode === 'center') x = (left + right - b.width) / 2;
    if (mode === 'right') x = right - b.width;
    if (mode === 'top') y = top;
    if (mode === 'middle') y = (top + bottom - b.height) / 2;
    if (mode === 'bottom') y = bottom - b.height;
    if (mode === 'grid') {
      x = Math.round(x / step) * step;
      y = Math.round(y / step) * step;
      const lane = doc.nodes[node.parentId ?? ''];
      if (lane?.type === 'swimlane') {
        const p = absoluteBounds(doc, lane),
          inset = laneInsets(doc, lane);
        const minX = Math.ceil((p.x + inset.left) / step) * step,
          maxX = Math.floor((p.x + p.width - inset.right - b.width) / step) * step;
        const minY = Math.ceil((p.y + inset.top) / step) * step,
          maxY = Math.floor((p.y + p.height - inset.bottom - b.height) / step) * step;
        if (minX > maxX || minY > maxY) throw new Error('泳道内容区不足，无法将图形对齐到网格');
        x = Math.max(minX, Math.min(maxX, x));
        y = Math.max(minY, Math.min(maxY, y));
      }
    }
    node.bounds.x += x - b.x;
    node.bounds.y += y - b.y;
  }
}
