import type { Bounds, BusinessEntity, DiagramNode } from '../domain/model';

export interface PortDefinition {
  id: string;
  x: number;
  y: number;
  direction: 'input' | 'output' | 'both';
}
// 与渲染引擎无关的描述，图形定义不依赖 Cell、Graph 或 DOM。
export interface ShapePart {
  key: string;
  bounds: Bounds;
  text: string;
  primitive: 'rectangle' | 'ellipse' | 'rhombus';
  fill: string;
  stroke?: string;
  color?: string;
  fontSize?: number;
  bold?: boolean;
  align?: 'left' | 'center';
  rounded?: boolean;
  vertical?: boolean;
}
export interface ShapeDefinition {
  type: string;
  version: 1;
  label: string;
  category: '基础图形' | '业务图形' | '容器';
  icon: string;
  defaultSize: [number, number];
  minSize: [number, number];
  container?: boolean;
  primitive: 'rectangle' | 'ellipse' | 'rhombus';
  ports: readonly PortDefinition[];
  composite?: (node: DiagramNode, entity: BusinessEntity) => ShapePart[];
}
const allPorts: PortDefinition[] = [
  { id: 'top', x: 0.5, y: 0, direction: 'both' },
  { id: 'right', x: 1, y: 0.5, direction: 'both' },
  { id: 'bottom', x: 0.5, y: 1, direction: 'both' },
  { id: 'left', x: 0, y: 0.5, direction: 'both' },
];
const activityLabels = {
  manual: '人工线上',
  offline: '人工线下',
  system: '系统操作',
  interface: '接口对接',
  linked: '引用活动',
};
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
  list() {
    return [...this.definitions.values()];
  }
  describe() {
    return this.list().map(({ composite, ...definition }) => ({
      ...definition,
      composite: !!composite,
    }));
  }
}
export function createShapeRegistry() {
  return new ShapeRegistry()
    .register({
      type: 'ellipse',
      version: 1,
      label: '椭圆',
      category: '基础图形',
      icon: 'circle',
      defaultSize: [140, 80],
      minSize: [64, 40],
      primitive: 'ellipse',
      ports: allPorts,
    })
    .register({
      type: 'rectangle',
      version: 1,
      label: '矩形',
      category: '基础图形',
      icon: 'square',
      defaultSize: [160, 80],
      minSize: [80, 40],
      primitive: 'rectangle',
      ports: allPorts,
    })
    .register({
      type: 'subprocess',
      version: 1,
      label: '子流程',
      category: '业务图形',
      icon: 'square',
      defaultSize: [180, 80],
      minSize: [130, 72],
      primitive: 'rectangle',
      ports: allPorts,
    })
    .register({
      type: 'decision',
      version: 1,
      label: '条件判断',
      category: '业务图形',
      icon: 'diamond',
      defaultSize: [140, 100],
      minSize: [100, 72],
      primitive: 'rhombus',
      ports: allPorts,
    })
    .register({
      type: 'start',
      version: 1,
      label: '开始',
      category: '基础图形',
      icon: 'circle',
      defaultSize: [68, 32],
      minSize: [32, 32],
      primitive: 'ellipse',
      ports: [
        { id: 'out', x: 1, y: 0.5, direction: 'output' },
        ...allPorts
          .filter((port) => port.id !== 'right')
          .map((port) => ({ ...port, direction: 'output' as const })),
      ],
    })
    .register({
      type: 'end',
      version: 1,
      label: '结束',
      category: '基础图形',
      icon: 'circle-dot',
      defaultSize: [68, 32],
      minSize: [32, 32],
      primitive: 'ellipse',
      ports: [
        { id: 'in', x: 0, y: 0.5, direction: 'input' },
        ...allPorts
          .filter((port) => port.id !== 'left')
          .map((port) => ({ ...port, direction: 'input' as const })),
      ],
    })
    .register({
      type: 'parallel',
      version: 1,
      label: '并行',
      category: '业务图形',
      icon: 'square',
      defaultSize: [110, 55],
      minSize: [80, 48],
      primitive: 'rectangle',
      ports: allPorts,
    })
    .register({
      type: 'stage-horizontal',
      version: 1,
      label: '水平阶段',
      category: '业务图形',
      icon: 'panel-top',
      defaultSize: [300, 42],
      minSize: [180, 42],
      primitive: 'rectangle',
      ports: [],
      composite: (node, entity) => [
        {
          key: 'bar',
          bounds: { x: 0, y: 0, width: 150, height: node.bounds.height },
          text: entity.name,
          primitive: 'rectangle',
          fill: node.appearance.headerFill ?? '#1ba1e2',
          stroke: node.appearance.accent,
          color: node.appearance.fontColor ?? '#ffffff',
          fontSize: node.appearance.fontSize ?? 12,
          bold: node.appearance.fontBold ?? true,
          vertical: node.appearance.textDirection === 'vertical',
        },
        ...Array.from({ length: Math.floor((node.bounds.width - 150) / 12) }, (_, index) => ({
          key: `line-${index}`,
          bounds: { x: 150 + index * 12, y: node.bounds.height / 2 - 1, width: 7, height: 2 },
          text: '',
          primitive: 'rectangle' as const,
          fill: node.appearance.accent,
        })),
      ],
    })
    .register({
      type: 'stage-vertical',
      version: 1,
      label: '垂直阶段',
      category: '业务图形',
      icon: 'panel-top',
      defaultSize: [50, 300],
      minSize: [50, 180],
      primitive: 'rectangle',
      ports: [],
      composite: (node, entity) => [
        {
          key: 'bar',
          bounds: { x: 0, y: 0, width: node.bounds.width, height: 150 },
          text: entity.name,
          primitive: 'rectangle',
          fill: node.appearance.headerFill ?? '#1ba1e2',
          stroke: node.appearance.accent,
          color: node.appearance.fontColor ?? '#ffffff',
          fontSize: node.appearance.fontSize ?? 12,
          bold: node.appearance.fontBold ?? true,
          vertical: (node.appearance.textDirection ?? 'vertical') === 'vertical',
        },
        ...Array.from({ length: Math.floor((node.bounds.height - 150) / 12) }, (_, index) => ({
          key: `line-${index}`,
          bounds: { x: node.bounds.width / 2 - 1, y: 150 + index * 12, width: 2, height: 7 },
          text: '',
          primitive: 'rectangle' as const,
          fill: node.appearance.accent,
        })),
      ],
    })
    .register({
      type: 'activity',
      version: 1,
      label: '业务活动',
      category: '业务图形',
      icon: 'activity',
      defaultSize: [200, 120],
      minSize: [180, 120],
      primitive: 'rectangle',
      ports: allPorts,
      composite: (node, entity) => {
        const w = node.bounds.width,
          h = node.bounds.height,
          accent = node.appearance.accent;
        return [
          {
            key: 'header',
            bounds: { x: 8, y: 1, width: w - 16, height: 29 },
            text: `${entity.code || 'ACT'}   ${activityLabels[entity.activityType]}`,
            primitive: 'rectangle',
            fill: '#f7f8fa',
            color: '#7a8292',
            fontSize: 10,
            align: 'left',
          },
          {
            key: 'title',
            bounds: { x: 8, y: 30, width: w - 16, height: h - 60 },
            text:
              entity.name +
              (entity.details?.showInFlow && entity.description ? `\n${entity.description}` : ''),
            primitive: 'rectangle',
            fill: 'none',
            color: '#263547',
            fontSize: 13,
            bold: true,
          },
          {
            key: 'footer',
            bounds: { x: 8, y: h - 30, width: w - 16, height: 29 },
            text: `${entity.critical ? '★ 关键活动' : '○ 常规活动'}   ·   输入 ${entity.inputs.length} / 输出 ${entity.outputs.length}`,
            primitive: 'rectangle',
            fill: '#f3f6fb',
            color: accent,
            fontSize: 10,
          },
        ];
      },
    })
    .register({
      type: 'pool-horizontal',
      version: 1,
      label: '水平泳池',
      category: '容器',
      icon: 'pool-horizontal',
      defaultSize: [1136, 440],
      minSize: [356, 180],
      primitive: 'rectangle',
      ports: [],
      container: true,
    })
    .register({
      type: 'pool-vertical',
      version: 1,
      label: '垂直泳池',
      category: '容器',
      icon: 'pool-vertical',
      defaultSize: [720, 600],
      minSize: [240, 236],
      primitive: 'rectangle',
      ports: [],
      container: true,
    })
    .register({
      type: 'swimlane',
      version: 1,
      label: '角色泳道',
      category: '容器',
      icon: 'panel-top',
      defaultSize: [1000, 200],
      minSize: [160, 140],
      primitive: 'rectangle',
      ports: [],
      container: true,
    });
}
