import type { Bounds, DiagramDocument } from '../domain/model';
import { absoluteBounds, isPoolType, laneInsets, poolLanes } from '../domain/pools';
import type { Operation } from './commands';

/** 拖放采用文档绝对坐标命中泳道，提交时再转为目标容器的相对坐标。 */
export function nodeDropOperation(doc: DiagramDocument, id: string, moved: Bounds): Operation {
  const node = doc.nodes[id];
  const cx = moved.x + moved.width / 2,
    cy = moved.y + moved.height / 2;
  const contains = (item: DiagramDocument['nodes'][string]) => {
    const b = absoluteBounds(doc, item);
    return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height;
  };
  let lane = Object.values(doc.nodes)
    .filter((item) => item.type === 'swimlane')
    .reverse()
    .find(contains);
  if (!lane) {
    const pool = Object.values(doc.nodes)
      .filter((item) => isPoolType(item.type))
      .reverse()
      .find(contains);
    if (pool) {
      const distance = (item: DiagramDocument['nodes'][string]) => {
        const b = absoluteBounds(doc, item);
        return (
          Math.max(b.x - cx, 0, cx - b.x - b.width) ** 2 +
          Math.max(b.y - cy, 0, cy - b.y - b.height) ** 2
        );
      };
      // 泳池标题不属于可放置区域，命中后吸附到最近泳道的内容区。
      lane = poolLanes(doc, pool.id).sort((a, b) => distance(a) - distance(b))[0];
    }
  }
  if (!lane)
    return {
      type: 'node.move',
      id,
      x: moved.x,
      y: moved.y,
      ...(node.parentId ? { parentId: null } : {}),
    };
  const origin = absoluteBounds(doc, lane),
    inset = laneInsets(doc, lane);
  const x = Math.max(
    inset.left,
    Math.min(moved.x - origin.x, lane.bounds.width - inset.right - moved.width),
  );
  const y = Math.max(
    inset.top,
    Math.min(moved.y - origin.y, lane.bounds.height - inset.bottom - moved.height),
  );
  return {
    type: 'node.move',
    id,
    x,
    y,
    ...(lane.id !== node.parentId ? { parentId: lane.id } : {}),
  };
}
