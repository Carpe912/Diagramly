import type { DiagramDocument } from './model';
export interface DiagramIssue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
}
/** 允许返工和回退环路，体检只报告可定位的问题，不自动修改业务判断。 */
export function inspectDocument(document: DiagramDocument): DiagramIssue[] {
  const result: DiagramIssue[] = [],
    nodes = Object.values(document.nodes),
    edges = Object.values(document.edges);
  const flow = nodes.filter((node) =>
    ['activity', 'start', 'end', 'decision', 'parallel', 'subprocess'].includes(node.type),
  );
  if (!flow.length) return [];
  const starts = flow.filter((node) => node.type === 'start');
  if (!starts.length)
    result.push({ id: flow[0].id, severity: 'warning', message: '流程缺少开始节点' });
  if (starts.length > 1)
    starts.forEach((node) =>
      result.push({
        id: node.id,
        severity: 'warning',
        message: '存在多个开始节点，请确认是否为独立流程',
      }),
    );
  const reached = new Set<string>(starts.map((node) => node.id)),
    queue = [...reached];
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of edges.filter((edge) => edge.source.nodeId === id)) {
      if (!reached.has(edge.target.nodeId)) {
        reached.add(edge.target.nodeId);
        queue.push(edge.target.nodeId);
      }
    }
  }
  for (const node of flow) {
    if (starts.length && !reached.has(node.id))
      result.push({ id: node.id, severity: 'warning', message: '从开始节点无法到达该图形' });
    const incoming = edges.filter((edge) => edge.target.nodeId === node.id),
      outgoing = edges.filter((edge) => edge.source.nodeId === node.id);
    if (node.type === 'start' && incoming.length)
      result.push({ id: node.id, severity: 'warning', message: '开始节点存在入线' });
    if (node.type === 'end' && outgoing.length)
      result.push({ id: node.id, severity: 'warning', message: '结束节点存在出线' });
    if (
      node.type === 'decision' &&
      (outgoing.length < 2 || outgoing.some((edge) => !edge.label.trim()))
    )
      result.push({
        id: node.id,
        severity: 'warning',
        message: '判断节点需要明确的分支与条件文字',
      });
    if (node.type === 'activity' && !incoming.length && !outgoing.length)
      result.push({ id: node.id, severity: 'warning', message: '活动尚未连接到流程' });
  }
  for (const edge of edges)
    if (!document.nodes[edge.source.nodeId] || !document.nodes[edge.target.nodeId])
      result.push({ id: edge.id, severity: 'error', message: '连线端点不存在' });
  return result;
}
