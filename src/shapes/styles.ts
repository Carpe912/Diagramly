import {
  edgeAppearanceSchema,
  type DiagramEdge,
  type DiagramNode,
  type EdgeAppearance,
  type NodeAppearance,
} from '../domain/model';
import { isPoolType } from '../domain/pools';
export const dashPatterns = {
  solid: '',
  dashed: '8 4',
  dotted: '1 1',
  'dotted-spaced': '1 2',
  'dotted-wide': '1 4',
};
export function nodeLineAppearance(node: DiagramNode) {
  return {
    strokeEnabled: true,
    strokeWidth: node.type === 'swimlane' || isPoolType(node.type) ? 1 : 1.5,
    pattern: 'solid' as const,
    corner:
      node.type === 'rectangle' || node.type === 'activity'
        ? ('rounded' as const)
        : ('sharp' as const),
    opacity: 100,
    ...node.appearance,
    strokeColor: node.appearance.accent,
  };
}
export function edgeLineAppearance(edge: DiagramEdge): Required<EdgeAppearance> {
  const resolved: Required<EdgeAppearance> = {
    strokeEnabled: true,
    strokeColor: '#8e99ad',
    strokeWidth: 1.5,
    pattern: 'solid',
    corner: 'rounded',
    shape: 'line',
    routing: 'orthogonal',
    startArrow: 'none',
    endArrow: 'block',
    startFill: true,
    endFill: true,
    startSize: 6,
    endSize: 7,
    startSpacing: 0,
    endSpacing: 0,
    jumpStyle: 'none',
    jumpSize: 6,
    opacity: 100,
    ...edge.appearance,
  };
  if (resolved.shape !== 'line' && resolved.corner === 'curved') resolved.corner = 'rounded';
  if (resolved.shape === 'block-arrow') {
    resolved.startArrow = resolved.startArrow === 'none' ? 'none' : 'block';
    resolved.endArrow = resolved.endArrow === 'none' ? 'none' : 'block';
    resolved.startFill = resolved.endFill = true;
  }
  if (resolved.shape === 'link') resolved.startArrow = resolved.endArrow = 'none';
  if (resolved.shape === 'simple-arrow') {
    resolved.startArrow = 'none';
    resolved.endArrow = 'block';
    resolved.routing = 'straight';
    resolved.corner = 'sharp';
  }
  return resolved;
}
export function strokeStyle(appearance: {
  strokeEnabled?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  pattern?: keyof typeof dashPatterns;
  opacity?: number;
  corner?: string;
}) {
  return {
    strokeColor: appearance.strokeEnabled === false ? 'none' : appearance.strokeColor,
    strokeWidth: appearance.strokeWidth,
    dashed: appearance.pattern !== 'solid',
    dashPattern: dashPatterns[appearance.pattern ?? 'solid'],
    fixDash: false,
    rounded: appearance.corner === 'rounded',
    curved: appearance.corner === 'curved',
    opacity: appearance.opacity,
    textOpacity: appearance.opacity,
  };
}
export function edgeRenderStyle(edge: DiagramEdge) {
  const a = edgeLineAppearance(edge);
  const routing = {
    straight: undefined,
    orthogonal: 'orthogonalEdgeStyle',
    'elbow-horizontal': 'elbowEdgeStyle',
    'elbow-vertical': 'elbowEdgeStyle',
    entity: 'entityRelationEdgeStyle',
  }[a.routing];
  const shape = {
    line: 'diagramlyConnector',
    link: 'diagramlyLink',
    'block-arrow': 'arrowConnector',
    'simple-arrow': 'diagramlyArrow',
  }[a.shape];
  return {
    ...strokeStyle(a),
    shape,
    edgeStyle: a.shape === 'simple-arrow' ? undefined : routing,
    noEdgeStyle: a.routing === 'straight' || a.shape === 'simple-arrow',
    elbow: a.routing === 'elbow-vertical' ? ('vertical' as const) : ('horizontal' as const),
    fillColor: a.strokeEnabled ? a.strokeColor : 'none',
    startArrow: a.startArrow,
    endArrow: a.endArrow,
    startFill: a.startFill,
    endFill: a.endFill,
    startSize: a.startSize,
    endSize: a.endSize,
    sourcePerimeterSpacing: a.startSpacing,
    targetPerimeterSpacing: a.endSpacing,
    jumpStyle: a.jumpStyle,
    jumpSize: a.jumpSize,
  };
}
/** 固定端口不会读取外围间距，需沿端口外法线写入锚点偏移。 */
export function edgePortOffsets(
  edge: DiagramEdge,
  source: { x: number; y: number },
  target: { x: number; y: number },
) {
  const a = edgeLineAppearance(edge);
  return {
    exitDx: (source.x - 0.5) * 2 * a.startSpacing,
    exitDy: (source.y - 0.5) * 2 * a.startSpacing,
    entryDx: (target.x - 0.5) * 2 * a.endSpacing,
    entryDy: (target.y - 0.5) * 2 * a.endSpacing,
  };
}
export function nodeStrokePatch(patch: EdgeAppearance): Partial<NodeAppearance> {
  return {
    ...(patch.strokeColor !== undefined ? { accent: patch.strokeColor } : {}),
    ...(patch.strokeEnabled !== undefined ? { strokeEnabled: patch.strokeEnabled } : {}),
    ...(patch.strokeWidth !== undefined ? { strokeWidth: patch.strokeWidth } : {}),
    ...(patch.pattern !== undefined ? { pattern: patch.pattern } : {}),
    ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}),
    ...(patch.corner && patch.corner !== 'curved' ? { corner: patch.corner } : {}),
  };
}
/** 导出使用标准 mxGraph 样式名，内部专用形状只用于交互渲染。 */
export function styleToXml(style: Record<string, string | number | boolean | undefined>) {
  return (
    Object.entries(style)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${typeof value === 'boolean' ? (value ? 1 : 0) : value}`)
      .join(';') + ';'
  );
}
export const stylePresets = [
  { name: '白色', fill: '#ffffff', stroke: '#374151', font: '#263547' },
  { name: '灰色', fill: '#f5f5f5', stroke: '#666666', font: '#333333' },
  { name: '蓝色', fill: '#dae8fc', stroke: '#6c8ebf', font: '#29466b' },
  { name: '绿色', fill: '#d5e8d4', stroke: '#82b366', font: '#365d35' },
  { name: '橙色', fill: '#ffe6cc', stroke: '#d79b00', font: '#735319' },
  { name: '黄色', fill: '#fff2cc', stroke: '#d6b656', font: '#695719' },
  { name: '红色', fill: '#f8cecc', stroke: '#b85450', font: '#772f2b' },
  { name: '紫色', fill: '#e1d5e7', stroke: '#9673a6', font: '#60436e' },
];
export function lineStyleFromXml(
  values: Record<string, string | undefined>,
  edge: boolean,
): EdgeAppearance {
  const candidate: Record<string, unknown> = {};
  if (values.strokeColor === 'none') candidate.strokeEnabled = false;
  else if (values.strokeColor) candidate.strokeColor = values.strokeColor;
  for (const key of ['strokeWidth', 'opacity', 'startSize', 'endSize', 'jumpSize'] as const)
    if (values[key] !== undefined) candidate[key] = Number(values[key]);
  if (values.sourcePerimeterSpacing !== undefined)
    candidate.startSpacing = Number(values.sourcePerimeterSpacing);
  if (values.targetPerimeterSpacing !== undefined)
    candidate.endSpacing = Number(values.targetPerimeterSpacing);
  if (values.dashed !== undefined)
    candidate.pattern =
      values.dashed === '1'
        ? (Object.entries(dashPatterns).find(
            ([, pattern]) => pattern === (values.dashPattern ?? '').trim(),
          )?.[0] ?? 'dashed')
        : 'solid';
  if (values.rounded !== undefined || values.curved !== undefined)
    candidate.corner =
      values.curved === '1' && edge ? 'curved' : values.rounded === '1' ? 'rounded' : 'sharp';
  if (edge) {
    for (const key of ['startArrow', 'endArrow', 'jumpStyle'] as const)
      if (values[key] !== undefined) candidate[key] = values[key];
    for (const key of ['startFill', 'endFill'] as const)
      if (values[key] !== undefined) candidate[key] = values[key] !== '0';
    if (values.shape)
      candidate.shape = (
        {
          connector: 'line',
          link: 'link',
          flexArrow: 'block-arrow',
          arrowConnector: 'block-arrow',
          arrow: 'simple-arrow',
        } as Record<string, string>
      )[values.shape];
    if (values.edgeStyle !== undefined || values.noEdgeStyle !== undefined)
      candidate.routing =
        values.noEdgeStyle === '1' || !values.edgeStyle
          ? 'straight'
          : values.edgeStyle === 'elbowEdgeStyle'
            ? values.elbow === 'vertical'
              ? 'elbow-vertical'
              : 'elbow-horizontal'
            : values.edgeStyle === 'entityRelationEdgeStyle'
              ? 'entity'
              : 'orthogonal';
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(candidate) as (keyof EdgeAppearance)[]) {
    const parsed = edgeAppearanceSchema.shape[key].safeParse(candidate[key]);
    if (parsed.success && parsed.data !== undefined) result[key] = parsed.data;
  }
  return result as EdgeAppearance;
}
