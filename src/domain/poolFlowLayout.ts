import type { DiagramDocument, DiagramEdge, DiagramNode } from './model';
import type { ShapeRegistry } from '../shapes/registry';

const FLOW_GAP = 72;
const BRANCH_GAP = 32;
type Side = 'top' | 'right' | 'bottom' | 'left';
const points = { top: [0.5, 0], right: [1, 0.5], bottom: [0.5, 1], left: [0, 0.5] } as const;

/** 按流程分层，泳道间的交接共用层级，同泳道的步骤推进一层。 */
export function layoutPoolFlow(
  doc: DiagramDocument,
  pool: DiagramNode,
  lanes: DiagramNode[],
  registry: ShapeRegistry,
  headerSize: number,
  previousVertical: boolean,
) {
  const vertical = pool.type === 'pool-vertical';
  const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
  const nodes = Object.values(doc.nodes).filter((node) => laneIndex.has(node.parentId ?? ''));
  const compare = (a: DiagramNode, b: DiagramNode) =>
    Number(b.type === 'start') - Number(a.type === 'start') ||
    (previousVertical ? a.bounds.y - b.bounds.y : a.bounds.x - b.bounds.x) ||
    laneIndex.get(a.parentId!)! - laneIndex.get(b.parentId!)! ||
    a.id.localeCompare(b.id);
  nodes.sort(compare);
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const edges = Object.values(doc.edges).filter(
    (edge) => order.has(edge.source.nodeId) && order.has(edge.target.nodeId),
  );
  const outgoing = new Map(nodes.map((node) => [node.id, [] as DiagramEdge[]]));
  const incoming = new Map(nodes.map((node) => [node.id, [] as DiagramEdge[]]));
  for (const edge of edges) {
    outgoing.get(edge.source.nodeId)!.push(edge);
    incoming.get(edge.target.nodeId)!.push(edge);
  }
  for (const list of outgoing.values())
    list.sort(
      (a, b) =>
        order.get(a.target.nodeId)! - order.get(b.target.nodeId)! || a.id.localeCompare(b.id),
    );

  // 迭代遍历识别回退边，避免闭环使层级无限增长，也避免大图递归溢出。
  const state = new Map<string, number>(),
    feedback = new Set<string>(),
    finished: string[] = [];
  const seeds = [...nodes.filter((node) => !incoming.get(node.id)!.length), ...nodes];
  for (const seed of seeds) {
    if (state.has(seed.id)) continue;
    const stack = [{ id: seed.id, index: 0 }];
    state.set(seed.id, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1],
        edge = outgoing.get(frame.id)![frame.index++];
      if (!edge) {
        state.set(frame.id, 2);
        finished.push(frame.id);
        stack.pop();
      } else if (state.get(edge.target.nodeId) === 1) feedback.add(edge.id);
      else if (!state.has(edge.target.nodeId)) {
        state.set(edge.target.nodeId, 1);
        stack.push({ id: edge.target.nodeId, index: 0 });
      }
    }
  }
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  for (const id of finished.reverse())
    for (const edge of outgoing.get(id)!) {
      if (feedback.has(edge.id)) continue;
      const sameLane = doc.nodes[id].parentId === doc.nodes[edge.target.nodeId].parentId;
      rank.set(
        edge.target.nodeId,
        Math.max(rank.get(edge.target.nodeId)!, rank.get(id)! + Number(sameLane)),
      );
    }
  const linked = nodes.filter(
    (node) => incoming.get(node.id)!.length || outgoing.get(node.id)!.length,
  );
  const isolatedStart = linked.length
    ? Math.max(...linked.map((node) => rank.get(node.id)!)) + 1
    : 0;
  for (const lane of lanes)
    nodes
      .filter(
        (node) =>
          node.parentId === lane.id &&
          !incoming.get(node.id)!.length &&
          !outgoing.get(node.id)!.length,
      )
      .forEach((node, index) => rank.set(node.id, isolatedStart + index));

  const levels = [...new Set(rank.values())].sort((a, b) => a - b);
  const primarySize = (node: DiagramNode) => (vertical ? node.bounds.height : node.bounds.width);
  const crossSize = (node: DiagramNode) => (vertical ? node.bounds.width : node.bounds.height);
  const levelSizes = new Map(
    levels.map((level) => [
      level,
      Math.max(...nodes.filter((node) => rank.get(node.id) === level).map(primarySize)),
    ]),
  );
  const starts = new Map<number, number>();
  let cursor = vertical ? 64 : 96;
  for (const level of levels) {
    starts.set(level, cursor);
    cursor += levelSizes.get(level)! + FLOW_GAP;
  }
  const flowSize = Math.max(vertical ? 200 : 320, cursor - (levels.length ? FLOW_GAP : 0) + 32);
  const groups = new Map<string, DiagramNode[]>();
  const key = (laneId: string, level: number) => `${laneId}:${level}`;
  const neighborLane = (node: DiagramNode) => {
    const neighbors = [
      ...incoming.get(node.id)!.map((edge) => edge.source.nodeId),
      ...outgoing.get(node.id)!.map((edge) => edge.target.nodeId),
    ];
    return neighbors.length
      ? neighbors.reduce((sum, id) => sum + laneIndex.get(doc.nodes[id].parentId!)!, 0) /
          neighbors.length
      : laneIndex.get(node.parentId!)!;
  };
  for (const node of nodes) {
    const groupKey = key(node.parentId!, rank.get(node.id)!);
    const group = groups.get(groupKey) ?? [];
    group.push(node);
    groups.set(groupKey, group);
  }
  const groupSize = (group: DiagramNode[]) =>
    group.reduce((sum, node) => sum + crossSize(node), 0) +
    Math.max(0, group.length - 1) * BRANCH_GAP;
  let laneCursor = 0;
  for (const lane of lanes) {
    const laneGroups = levels.map((level) => groups.get(key(lane.id, level)) ?? []);
    const feedbackCount = edges.filter(
      (edge) => feedback.has(edge.id) && doc.nodes[edge.source.nodeId].parentId === lane.id,
    ).length;
    const margin = 24 + feedbackCount * 16;
    const size = Math.max(
      vertical ? 240 : 180,
      Math.max(0, ...laneGroups.map(groupSize)) + margin + 24,
    );
    lane.bounds = vertical
      ? { x: laneCursor, y: headerSize, width: size, height: flowSize }
      : { x: headerSize, y: laneCursor, width: flowSize, height: size };
    laneCursor += size;
    for (const group of laneGroups) {
      group.sort(
        (a, b) => neighborLane(a) - neighborLane(b) || order.get(a.id)! - order.get(b.id)!,
      );
      let cross = margin + (size - margin - 24 - groupSize(group)) / 2;
      for (const node of group) {
        const level = rank.get(node.id)!;
        const primary = starts.get(level)! + (levelSizes.get(level)! - primarySize(node)) / 2;
        node.bounds.x = vertical ? cross : primary;
        node.bounds.y = vertical ? primary : cross;
        cross += crossSize(node) + BRANCH_GAP;
      }
    }
  }
  pool.bounds.width = vertical ? laneCursor : headerSize + flowSize;
  pool.bounds.height = vertical ? headerSize + flowSize : laneCursor;

  const assign = (edge: DiagramEdge, end: 'source' | 'target', side: Side) => {
    const endpoint = edge[end],
      node = doc.nodes[endpoint.nodeId];
    const [x, y] = points[side];
    const ports = registry
      .get(node.type)
      .ports.filter((port) =>
        end === 'source' ? port.direction !== 'input' : port.direction !== 'output',
      );
    const port = [...ports].sort(
      (a, b) =>
        (a.x - x) ** 2 + (a.y - y) ** 2 - ((b.x - x) ** 2 + (b.y - y) ** 2) ||
        a.id.localeCompare(b.id),
    )[0];
    if (port) endpoint.portId = port.id;
  };
  const center = (node: DiagramNode) => {
    let x = node.bounds.x + node.bounds.width / 2,
      y = node.bounds.y + node.bounds.height / 2;
    let parent = doc.nodes[node.parentId ?? ''];
    while (parent) {
      x += parent.bounds.x;
      y += parent.bounds.y;
      parent = doc.nodes[parent.parentId ?? ''];
    }
    return { x, y };
  };
  for (const edge of Object.values(doc.edges)) {
    const source = doc.nodes[edge.source.nodeId],
      target = doc.nodes[edge.target.nodeId];
    const sourceInside = order.has(source.id),
      targetInside = order.has(target.id);
    if (!sourceInside && !targetInside) continue;
    if (sourceInside && targetInside) {
      if (source.id === target.id) {
        assign(edge, 'source', vertical ? 'right' : 'bottom');
        assign(edge, 'target', vertical ? 'top' : 'left');
      } else if (source.parentId !== target.parentId) {
        const forward = laneIndex.get(target.parentId!)! > laneIndex.get(source.parentId!)!;
        assign(
          edge,
          'source',
          vertical ? (forward ? 'right' : 'left') : forward ? 'bottom' : 'top',
        );
        assign(
          edge,
          'target',
          vertical ? (forward ? 'left' : 'right') : forward ? 'top' : 'bottom',
        );
      } else if (feedback.has(edge.id)) {
        assign(edge, 'source', vertical ? 'left' : 'top');
        assign(edge, 'target', vertical ? 'left' : 'top');
      } else {
        assign(edge, 'source', vertical ? 'bottom' : 'right');
        assign(edge, 'target', vertical ? 'top' : 'left');
      }
    } else {
      const a = center(source),
        b = center(target),
        dx = b.x - a.x,
        dy = b.y - a.y;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      if (sourceInside)
        assign(
          edge,
          'source',
          horizontal ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top',
        );
      if (targetInside)
        assign(
          edge,
          'target',
          horizontal ? (dx >= 0 ? 'left' : 'right') : dy >= 0 ? 'top' : 'bottom',
        );
    }
    edge.appearance = { ...edge.appearance, routing: 'orthogonal' };
  }
}
