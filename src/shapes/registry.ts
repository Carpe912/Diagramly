import type { Bounds, BusinessEntity, DiagramNode } from '../domain/model';

export interface PortDefinition { id: string; x: number; y: number; direction: 'input' | 'output' | 'both' }
// Engine-independent render descriptors. No Cell, Graph or DOM in shape definitions.
export interface ShapePart {
  key: string; bounds: Bounds; text: string; primitive: 'rectangle' | 'ellipse' | 'rhombus';
  fill: string; stroke?: string; color?: string; fontSize?: number; bold?: boolean;
  align?: 'left' | 'center'; rounded?: boolean; vertical?: boolean;
}
export interface ShapeDefinition {
  type: string; version: 1; label: string; category: '基础图形' | '业务图形' | '容器';
  icon: string; defaultSize: [number, number]; minSize: [number, number]; container?: boolean;
  primitive: 'rectangle' | 'ellipse' | 'rhombus'; ports: readonly PortDefinition[];
  composite?: (node: DiagramNode, entity: BusinessEntity) => ShapePart[];
}
const allPorts: PortDefinition[] = [
  { id: 'top', x: .5, y: 0, direction: 'both' }, { id: 'right', x: 1, y: .5, direction: 'both' },
  { id: 'bottom', x: .5, y: 1, direction: 'both' }, { id: 'left', x: 0, y: .5, direction: 'both' },
];
const activityLabels = { manual: '人工活动', system: '系统活动', interface: '接口活动', linked: '引用活动' };
export class ShapeRegistry {
  private definitions = new Map<string, ShapeDefinition>();
  register(definition: ShapeDefinition) {
    if (this.definitions.has(definition.type)) throw new Error(`重复图形类型：${definition.type}`);
    const ports = new Set(definition.ports.map((p) => p.id));
    if (ports.size !== definition.ports.length) throw new Error('端口 ID 重复');
    this.definitions.set(definition.type, definition);
    return this;
  }
  get(type: string) {
    const definition = this.definitions.get(type);
    if (!definition) throw new Error(`未知图形类型：${type}`);
    return definition;
  }
  list() { return [...this.definitions.values()]; }
  describe() {
    return this.list().map(({ composite, ...definition }) => ({ ...definition, composite: !!composite }));
  }
}
export function createShapeRegistry() {
  return new ShapeRegistry()
    .register({ type: 'rectangle', version: 1, label: '矩形', category: '基础图形', icon: 'square',
      defaultSize: [160, 80], minSize: [80, 40], primitive: 'rectangle', ports: allPorts })
    .register({ type: 'subprocess', version: 1, label: '子流程', category: '业务图形', icon: 'square',
      defaultSize: [180, 80], minSize: [130, 72], primitive: 'rectangle', ports: allPorts })
    .register({ type: 'decision', version: 1, label: '条件判断', category: '基础图形', icon: 'diamond',
      defaultSize: [140, 100], minSize: [100, 72], primitive: 'rhombus', ports: allPorts })
    .register({ type: 'start', version: 1, label: '开始', category: '基础图形', icon: 'circle',
      defaultSize: [48, 48], minSize: [32, 32], primitive: 'ellipse',
      ports: [{ id: 'out', x: 1, y: .5, direction: 'output' }] })
    .register({ type: 'end', version: 1, label: '结束', category: '基础图形', icon: 'circle-dot',
      defaultSize: [48, 48], minSize: [32, 32], primitive: 'ellipse',
      ports: [{ id: 'in', x: 0, y: .5, direction: 'input' }] })
    .register({ type: 'activity', version: 1, label: '业务活动', category: '业务图形', icon: 'activity',
      defaultSize: [200, 120], minSize: [180, 120], primitive: 'rectangle', ports: allPorts,
      composite: (node, entity) => {
        const w = node.bounds.width, h = node.bounds.height, accent = node.appearance.accent;
        return [
          { key: 'header', bounds: { x: 1, y: 1, width: w - 2, height: 29 }, text: `${entity.code || 'ACT'}   ${activityLabels[entity.activityType]}`,
            primitive: 'rectangle', fill: '#f7f8fa', color: '#7a8292', fontSize: 10, align: 'left' },
          { key: 'title', bounds: { x: 8, y: 30, width: w - 16, height: h - 60 }, text: entity.name,
            primitive: 'rectangle', fill: 'none', color: '#263547', fontSize: 13, bold: true },
          { key: 'footer', bounds: { x: 1, y: h - 30, width: w - 2, height: 29 },
            text: `${entity.critical ? '★ 关键活动' : '○ 常规活动'}   ·   输入 ${entity.inputs.length} / 输出 ${entity.outputs.length}`,
            primitive: 'rectangle', fill: '#f3f6fb', color: accent, fontSize: 10 },
        ];
      } })
    .register({ type: 'pool-horizontal', version: 1, label: '水平泳池', category: '容器', icon: 'pool-horizontal',
      defaultSize: [1136, 440], minSize: [356, 180], primitive: 'rectangle', ports: [], container: true })
    .register({ type: 'pool-vertical', version: 1, label: '垂直泳池', category: '容器', icon: 'pool-vertical',
      defaultSize: [720, 600], minSize: [240, 236], primitive: 'rectangle', ports: [], container: true })
    .register({ type: 'swimlane', version: 1, label: '角色泳道', category: '容器', icon: 'panel-top',
      defaultSize: [1000, 200], minSize: [160, 140], primitive: 'rectangle', ports: [], container: true });
}
