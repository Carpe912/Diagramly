import { emptyDocument, newEntity, type DiagramDocument } from '../domain/model';
export function demoDocument(): DiagramDocument {
  const doc = emptyDocument(); doc.id = 'doc_order_flow'; doc.title = '订单履约流程';
  const node = (id: string, type: string, name: string, x: number, y: number, width: number, height: number, parentId?: string) => {
    const entityId = `entity_${id}`;
    doc.nodes[id] = { id, entityId, type, shapeVersion: 1, bounds: { x, y, width, height },
      appearance: { accent: '#6b7db9' }, ...(parentId ? { parentId } : {}) };
    doc.entities[entityId] = newEntity(entityId, name);
    return doc.entities[entityId];
  };
  node('pool_order', 'pool-horizontal', '订单履约泳池', 24, 70, 1136, 440);
  node('lane_sales', 'swimlane', '销售团队', 36, 0, 1100, 210, 'pool_order').role = '业务角色';
  doc.nodes.lane_sales.laneOrder = 0;
  node('lane_ops', 'swimlane', '交付团队', 36, 210, 1100, 230, 'pool_order').role = '业务角色';
  doc.nodes.lane_ops.laneOrder = 1;
  node('start', 'start', '开始', 110, 82, 48, 48, 'lane_sales');
  const receive = node('receive', 'activity', '接收客户订单', 215, 45, 200, 120, 'lane_sales');
  Object.assign(receive, { code: '01', inputs: ['客户订单'], outputs: ['订单记录'], description: '接收并核对客户订单的基础信息，建立订单记录。' });
  node('check', 'decision', '信息完整？', 485, 55, 140, 100, 'lane_sales');
  const confirm = node('confirm', 'activity', '确认订单信息', 705, 45, 200, 120, 'lane_sales');
  Object.assign(confirm, { code: '02', critical: true, outputs: ['已确认订单'], description: '确认产品、数量与交付时间，提交交付团队。' });
  const deliver = node('deliver', 'activity', '安排订单交付', 705, 55, 200, 120, 'lane_ops');
  Object.assign(deliver, { code: '03', activityType: 'system', inputs: ['已确认订单'], outputs: ['交付单'], description: '系统匹配库存并安排交付任务。' });
  node('end', 'end', '结束', 985, 92, 48, 48, 'lane_ops');
  const edge = (id: string, a: string, aPort: string, b: string, bPort: string, label = '') => {
    doc.edges[id] = { id, source: { nodeId: a, portId: aPort }, target: { nodeId: b, portId: bPort }, label };
  };
  edge('edge_start', 'start', 'out', 'receive', 'left');
  edge('edge_check', 'receive', 'right', 'check', 'left');
  edge('edge_yes', 'check', 'right', 'confirm', 'left', '是');
  edge('edge_no', 'check', 'top', 'receive', 'top', '否 · 补充信息');
  edge('edge_deliver', 'confirm', 'bottom', 'deliver', 'top');
  edge('edge_end', 'deliver', 'right', 'end', 'in');
  return doc;
}
