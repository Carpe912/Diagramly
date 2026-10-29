import { documentSchema, type DiagramDocument } from './model';
import { childrenOf, isPoolType, laneInsets, layoutPool, nodeDepth, poolLanes } from './pools';
import type { ShapeRegistry } from '../shapes/registry';

export function validateDocument(input: unknown, registry: ShapeRegistry): DiagramDocument {
  const doc = documentSchema.parse(input),
    ids = new Set<string>();
  for (const group of [doc.nodes, doc.edges, doc.entities]) {
    for (const [key, item] of Object.entries(group)) {
      if (key !== item.id) throw new Error(`索引与 ID 不一致：${key}`);
      if (ids.has(key)) throw new Error(`ID 冲突：${key}`);
      ids.add(key);
    }
  }
  const owners = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    const shape = registry.get(node.type);
    nodeDepth(doc, node);
    if (shape.version !== node.shapeVersion) throw new Error('图形版本不匹配');
    if (!doc.entities[node.entityId]) throw new Error(`业务实体不存在：${node.entityId}`);
    if (owners.has(node.entityId))
      throw new Error('每个节点必须拥有独立实体；引用外部业务请使用 externalRef');
    owners.add(node.entityId);
    if (node.bounds.width < shape.minSize[0] || node.bounds.height < shape.minSize[1])
      throw new Error(`${shape.label}小于最小尺寸`);
    if (isPoolType(node.type) && node.parentId) throw new Error('泳池必须位于画布顶层');
    if (
      node.laneOrder !== undefined &&
      (node.type !== 'swimlane' ||
        !node.parentId ||
        !isPoolType(doc.nodes[node.parentId]?.type ?? ''))
    )
      throw new Error('泳道排序只能用于泳池中的泳道');
    if (node.parentId) {
      const parent = doc.nodes[node.parentId];
      if (!parent || !registry.get(parent.type).container) throw new Error('父节点必须是有效容器');
      if (isPoolType(parent.type)) {
        if (node.type !== 'swimlane')
          throw new Error('泳池内只允许直接放置泳道；业务图形应位于泳道中');
        if (node.laneOrder === undefined) throw new Error('泳池中的泳道必须具有排序');
      } else if (parent.type === 'swimlane') {
        if (shape.container) throw new Error('泳道中不能嵌套容器');
        const b = node.bounds,
          p = parent.bounds,
          inset = laneInsets(doc, parent);
        if (
          b.x < inset.left - 0.001 ||
          b.y < inset.top - 0.001 ||
          b.x + b.width > p.width - inset.right + 0.001 ||
          b.y + b.height > p.height - inset.bottom + 0.001
        ) {
          throw new Error('图形超出泳道内容区域，请调整位置或扩大泳道');
        }
      } else throw new Error('不支持此容器层级');
    } else if (node.type === 'activity' && doc.policies.activityRequiresLane)
      throw new Error('业务活动必须属于泳道，当前文档不允许放在泳池外');
  }
  for (const pool of Object.values(doc.nodes).filter((node) => isPoolType(node.type))) {
    const lanes = poolLanes(doc, pool.id);
    if (childrenOf(doc, pool.id).length !== lanes.length || !lanes.length)
      throw new Error('泳池必须包含至少一条泳道');
    if (lanes.some((lane, index) => lane.laneOrder !== index))
      throw new Error('泳道排序必须连续且唯一');
    const expected = structuredClone(doc);
    layoutPool(expected, pool.id, false);
    for (const lane of lanes)
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (Math.abs(lane.bounds[key] - expected.nodes[lane.id].bounds[key]) > 0.01)
          throw new Error('泳道布局必须与泳池方向和尺寸保持一致');
      }
  }
  if (owners.size !== Object.keys(doc.entities).length)
    throw new Error('存在没有所属节点的业务实体');
  for (const edge of Object.values(doc.edges)) {
    for (const [end, direction] of [
      [edge.source, 'source'],
      [edge.target, 'target'],
    ] as const) {
      const node = doc.nodes[end.nodeId];
      if (!node) throw new Error(`连线端点不存在：${end.nodeId}`);
      const port = registry.get(node.type).ports.find((p) => p.id === end.portId);
      if (
        !port ||
        (direction === 'source' ? port.direction === 'input' : port.direction === 'output')
      )
        throw new Error('端口不存在或方向不允许');
    }
  }
  return doc;
}
