import type { Bounds, DiagramDocument } from '../domain/model';
import { absoluteBounds, laneInsets } from '../domain/pools';
import type { Operation } from './commands';

/** 拖放采用文档绝对坐标命中泳道，提交时再转为目标容器的相对坐标。 */
export function nodeDropOperation(doc: DiagramDocument, id: string, moved: Bounds): Operation {
  const node = doc.nodes[id];
  const cx = moved.x + moved.width / 2,
    cy = moved.y + moved.height / 2;
  const lane = Object.values(doc.nodes)
    .filter((item) => item.type === 'swimlane')
    .reverse()
    .find((item) => {
      const b = absoluteBounds(doc, item);
      return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height;
    });
  const parent = lane ?? doc.nodes[node.parentId ?? ''];
  const origin = parent ? absoluteBounds(doc, parent) : { x: 0, y: 0 };
  let x = moved.x - origin.x,
    y = moved.y - origin.y;
  if (lane) {
    const inset = laneInsets(doc, lane);
    x = Math.max(inset.left, Math.min(x, lane.bounds.width - inset.right - moved.width));
    y = Math.max(inset.top, Math.min(y, lane.bounds.height - inset.bottom - moved.height));
  }
  return {
    type: 'node.move',
    id,
    x,
    y,
    ...(lane && lane.id !== node.parentId ? { parentId: lane.id } : {}),
  };
}
