import { newEntity, type Bounds, type DiagramDocument, type DiagramNode } from './model';

export type PoolOrientation = 'horizontal' | 'vertical';
export const POOL_HEADER = 36;
export const isPoolType = (type: string) => type === 'pool-horizontal' || type === 'pool-vertical';
export const poolOrientation = (node: DiagramNode): PoolOrientation =>
  node.type === 'pool-vertical' ? 'vertical' : 'horizontal';
export function childrenOf(doc: DiagramDocument, id: string) {
  return Object.values(doc.nodes).filter((node) => node.parentId === id);
}
export function poolOf(
  doc: DiagramDocument,
  node: DiagramNode | undefined,
): DiagramNode | undefined {
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    if (isPoolType(node.type)) return node;
    node = doc.nodes[node.parentId ?? ''];
  }
}
export function isManagedLane(doc: DiagramDocument, node: DiagramNode) {
  return node.type === 'swimlane' && !!poolOf(doc, node);
}
export function poolLanes(doc: DiagramDocument, poolId: string) {
  return childrenOf(doc, poolId)
    .filter((n) => n.type === 'swimlane')
    .sort((a, b) => (a.laneOrder ?? 0) - (b.laneOrder ?? 0) || a.id.localeCompare(b.id));
}
export function laneInsets(doc: DiagramDocument, lane: DiagramNode) {
  return poolOf(doc, lane)?.type === 'pool-vertical'
    ? { left: 12, top: 52, right: 12, bottom: 12 }
    : { left: 80, top: 12, right: 12, bottom: 12 };
}
export function absoluteBounds(doc: DiagramDocument, node: DiagramNode): Bounds {
  let x = node.bounds.x,
    y = node.bounds.y,
    parent = doc.nodes[node.parentId ?? ''];
  const seen = new Set([node.id]);
  while (parent) {
    if (seen.has(parent.id)) throw new Error('容器层级存在循环');
    seen.add(parent.id);
    x += parent.bounds.x;
    y += parent.bounds.y;
    parent = doc.nodes[parent.parentId ?? ''];
  }
  return { ...node.bounds, x, y };
}
export function nodeDepth(doc: DiagramDocument, node: DiagramNode) {
  let depth = 0,
    parent = doc.nodes[node.parentId ?? ''];
  const seen = new Set([node.id]);
  while (parent) {
    if (seen.has(parent.id)) throw new Error('容器层级存在循环');
    seen.add(parent.id);
    depth++;
    parent = doc.nodes[parent.parentId ?? ''];
  }
  return depth;
}
function laneMinimum(doc: DiagramDocument, lane: DiagramNode) {
  const inset = laneInsets(doc, lane),
    vertical = poolOf(doc, lane)?.type === 'pool-vertical';
  const content = childrenOf(doc, lane.id);
  return {
    width: Math.max(
      vertical ? 240 : 320,
      ...content.map((n) => n.bounds.x + n.bounds.width + inset.right),
    ),
    height: Math.max(
      vertical ? 200 : 180,
      ...content.map((n) => n.bounds.y + n.bounds.height + inset.bottom),
    ),
  };
}
/** 命令、文档校验和 XML 转换共用的确定性容器布局。 */
export function layoutPool(doc: DiagramDocument, poolId: string, grow = true) {
  const pool = doc.nodes[poolId];
  if (!pool || !isPoolType(pool.type)) throw new Error('请选择有效泳池');
  const lanes = poolLanes(doc, poolId);
  if (!lanes.length) throw new Error('泳池至少保留一条泳道');
  const horizontal = poolOrientation(pool) === 'horizontal',
    minimums = lanes.map((lane) => laneMinimum(doc, lane));
  const minWidth = horizontal
    ? POOL_HEADER + Math.max(...minimums.map((m) => m.width))
    : minimums.reduce((sum, m) => sum + m.width, 0);
  const minHeight = horizontal
    ? minimums.reduce((sum, m) => sum + m.height, 0)
    : POOL_HEADER + Math.max(...minimums.map((m) => m.height));
  if (grow) {
    pool.bounds.width = Math.max(pool.bounds.width, minWidth);
    pool.bounds.height = Math.max(pool.bounds.height, minHeight);
  }
  if (pool.bounds.width + 0.001 < minWidth || pool.bounds.height + 0.001 < minHeight)
    throw new Error('泳池尺寸不足，无法容纳现有泳道及活动');
  const available = horizontal ? pool.bounds.height : pool.bounds.width;
  const sizes = minimums.map((m) => (horizontal ? m.height : m.width));
  let weights = lanes.map((lane, i) =>
    Math.max(0, (horizontal ? lane.bounds.height : lane.bounds.width) - sizes[i]),
  );
  if (!weights.some((w) => w > 0)) weights = lanes.map(() => 1);
  const weightSum = weights.reduce((sum, n) => sum + n, 0),
    extra = available - sizes.reduce((sum, n) => sum + n, 0);
  let cursor = 0;
  lanes.forEach((lane, index) => {
    const extent =
      index === lanes.length - 1
        ? available - cursor
        : sizes[index] + (extra * weights[index]) / weightSum;
    lane.laneOrder = index;
    lane.bounds = horizontal
      ? { x: POOL_HEADER, y: cursor, width: pool.bounds.width - POOL_HEADER, height: extent }
      : { x: cursor, y: POOL_HEADER, width: extent, height: pool.bounds.height - POOL_HEADER };
    cursor += extent;
  });
}
export function addPoolLane(
  doc: DiagramDocument,
  poolId: string,
  laneId: string,
  entityId: string,
  name: string,
  index?: number,
) {
  const pool = doc.nodes[poolId];
  if (!pool || !isPoolType(pool.type)) throw new Error('泳道必须添加到泳池中');
  const lanes = poolLanes(doc, poolId),
    at = index ?? lanes.length;
  if (at > lanes.length) throw new Error('泳道插入位置不存在');
  const horizontal = poolOrientation(pool) === 'horizontal';
  const last = lanes.at(-1),
    extent = last ? (horizontal ? last.bounds.height : last.bounds.width) : horizontal ? 200 : 320;
  if (lanes.length) {
    if (horizontal) pool.bounds.height += extent;
    else pool.bounds.width += extent;
  }
  for (const lane of lanes)
    if ((lane.laneOrder ?? 0) >= at) lane.laneOrder = (lane.laneOrder ?? 0) + 1;
  doc.nodes[laneId] = {
    id: laneId,
    entityId,
    type: 'swimlane',
    shapeVersion: 1,
    parentId: poolId,
    laneOrder: at,
    appearance: { accent: '#d7deea' },
    bounds: horizontal
      ? { x: POOL_HEADER, y: 0, width: pool.bounds.width - POOL_HEADER, height: extent }
      : { x: 0, y: POOL_HEADER, width: extent, height: pool.bounds.height - POOL_HEADER },
  };
  doc.entities[entityId] = newEntity(entityId, name);
  layoutPool(doc, poolId);
}
export function switchPoolOrientation(
  doc: DiagramDocument,
  poolId: string,
  orientation: PoolOrientation,
) {
  const pool = doc.nodes[poolId];
  if (!pool || !isPoolType(pool.type)) throw new Error('请选择有效泳池');
  if (poolOrientation(pool) === orientation) return;
  const lanes = poolLanes(doc, poolId),
    oldInsets = new Map(lanes.map((lane) => [lane.id, laneInsets(doc, lane)]));
  pool.type = `pool-${orientation}`;
  [pool.bounds.width, pool.bounds.height] = [pool.bounds.height, pool.bounds.width];
  for (const lane of lanes) {
    const old = oldInsets.get(lane.id)!,
      next = laneInsets(doc, lane);
    for (const child of childrenOf(doc, lane.id)) {
      const { x, y } = child.bounds;
      child.bounds.x = Math.max(next.left, y - old.top + next.left);
      child.bounds.y = Math.max(next.top, x - old.left + next.top);
    }
    [lane.bounds.width, lane.bounds.height] = [lane.bounds.height, lane.bounds.width];
  }
  layoutPool(doc, poolId);
}
export function movePoolLane(doc: DiagramDocument, laneId: string, poolId: string) {
  const lane = doc.nodes[laneId],
    source = lane && poolOf(doc, lane),
    target = doc.nodes[poolId];
  if (!lane || lane.type !== 'swimlane' || !target || !isPoolType(target.type))
    throw new Error('请选择泳道及目标泳池');
  if (lane.parentId === poolId) return;
  if (source && poolLanes(doc, source.id).length <= 1) throw new Error('原泳池至少保留一条泳道');
  const oldInset = laneInsets(doc, lane),
    oldOrientation = source ? poolOrientation(source) : 'horizontal';
  const extent = source?.type === 'pool-vertical' ? lane.bounds.width : lane.bounds.height;
  if (source) {
    if (oldOrientation === 'horizontal') source.bounds.height -= extent;
    else source.bounds.width -= extent;
  }
  lane.parentId = poolId;
  lane.laneOrder = poolLanes(doc, poolId).filter((n) => n.id !== lane.id).length;
  if (oldOrientation !== poolOrientation(target)) {
    const nextInset = laneInsets(doc, lane);
    for (const child of childrenOf(doc, lane.id)) {
      const { x, y } = child.bounds;
      child.bounds.x = Math.max(nextInset.left, y - oldInset.top + nextInset.left);
      child.bounds.y = Math.max(nextInset.top, x - oldInset.left + nextInset.top);
    }
    [lane.bounds.width, lane.bounds.height] = [lane.bounds.height, lane.bounds.width];
  }
  if (target.type === 'pool-horizontal') target.bounds.height += lane.bounds.height;
  else target.bounds.width += lane.bounds.width;
  if (source) layoutPool(doc, source.id);
  layoutPool(doc, target.id);
}
export function resizePoolLane(
  doc: DiagramDocument,
  laneId: string,
  extent: number,
  crossExtent?: number,
) {
  const lane = doc.nodes[laneId],
    pool = lane && poolOf(doc, lane);
  if (!lane || lane.type !== 'swimlane' || !pool) throw new Error('请选择泳池中的泳道');
  const minimum = laneMinimum(doc, lane),
    horizontal = poolOrientation(pool) === 'horizontal';
  if (extent < (horizontal ? minimum.height : minimum.width))
    throw new Error('泳道尺寸不足，无法容纳现有活动');
  if (crossExtent !== undefined) {
    const crossMinimum = Math.max(
      ...poolLanes(doc, pool.id).map((n) => {
        const min = laneMinimum(doc, n);
        return horizontal ? min.width : min.height;
      }),
    );
    if (crossExtent < crossMinimum) throw new Error('共享尺寸不足，无法容纳其他泳道中的活动');
    if (horizontal) pool.bounds.width = crossExtent + POOL_HEADER;
    else pool.bounds.height = crossExtent + POOL_HEADER;
  }
  if (horizontal) {
    pool.bounds.height += extent - lane.bounds.height;
    lane.bounds.height = extent;
  } else {
    pool.bounds.width += extent - lane.bounds.width;
    lane.bounds.width = extent;
  }
  layoutPool(doc, pool.id, false);
}
/** 读取时升级早期仅包含泳道的文档，保留所有 ID 和业务关联。 */
export function upgradeStandaloneLanes(input: DiagramDocument): DiagramDocument {
  const doc = structuredClone(input),
    lanes = Object.values(doc.nodes).filter((n) => n.type === 'swimlane' && !n.parentId);
  if (!lanes.length) return doc;
  const spreadX =
    Math.max(...lanes.map((n) => n.bounds.x)) - Math.min(...lanes.map((n) => n.bounds.x));
  const spreadY =
    Math.max(...lanes.map((n) => n.bounds.y)) - Math.min(...lanes.map((n) => n.bounds.y));
  const vertical = lanes.length > 1 && spreadX > spreadY;
  let suffix = 1,
    id = 'pool_migrated_1',
    entityId = 'entity_pool_migrated_1';
  while (
    doc.nodes[id] ||
    doc.entities[id] ||
    doc.edges[id] ||
    doc.nodes[entityId] ||
    doc.entities[entityId] ||
    doc.edges[entityId]
  ) {
    suffix++;
    id = `pool_migrated_${suffix}`;
    entityId = `entity_pool_migrated_${suffix}`;
  }
  lanes.sort((a, b) => (vertical ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
  const minX = Math.min(...lanes.map((n) => n.bounds.x)),
    minY = Math.min(...lanes.map((n) => n.bounds.y));
  doc.nodes[id] = {
    id,
    entityId,
    type: vertical ? 'pool-vertical' : 'pool-horizontal',
    shapeVersion: 1,
    appearance: { accent: '#c8d2e2' },
    bounds: {
      x: minX - (vertical ? 0 : POOL_HEADER),
      y: minY - (vertical ? POOL_HEADER : 0),
      width: vertical
        ? lanes.reduce((sum, n) => sum + n.bounds.width, 0)
        : Math.max(...lanes.map((n) => n.bounds.width)) + POOL_HEADER,
      height: vertical
        ? Math.max(...lanes.map((n) => n.bounds.height)) + POOL_HEADER
        : lanes.reduce((sum, n) => sum + n.bounds.height, 0),
    },
  };
  doc.entities[entityId] = newEntity(entityId, '业务泳池');
  lanes.forEach((lane, index) => {
    lane.parentId = id;
    lane.laneOrder = index;
    if (vertical)
      for (const child of childrenOf(doc, lane.id)) {
        child.bounds.x = Math.max(12, child.bounds.x - 68);
        child.bounds.y += 40;
      }
  });
  layoutPool(doc, id);
  return doc;
}
