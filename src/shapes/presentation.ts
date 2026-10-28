import type { DiagramDocument, DiagramNode } from '../domain/model';
import { isPoolType, poolOf, POOL_HEADER } from '../domain/pools';
import type { ShapePart, ShapeRegistry } from './registry';

/** Shared projection for the interactive canvas and the persisted mxGraph XML. */
export function nodePresentation(doc: DiagramDocument, node: DiagramNode, registry: ShapeRegistry) {
  const shape = registry.get(node.type), entity = doc.entities[node.entityId], b = node.bounds;
  const pool = poolOf(doc, node), container = node.type === 'swimlane' || isPoolType(node.type);
  const fill = node.appearance.fill ?? (container ? pool?.appearance.fill : undefined) ?? '#ffffff';
  const headerFill = node.appearance.headerFill ?? (container ? pool?.appearance.headerFill : undefined) ?? (isPoolType(node.type) ? '#edf1f8' : '#f6f8fb');
  const fontColor = node.appearance.fontColor ?? (container ? pool?.appearance.fontColor : undefined) ?? '#52637d';
  const stroke = container ? node.appearance.accent || '#d5deeb' : node.appearance.accent;
  let parts: ShapePart[];
  if (isPoolType(node.type)) {
    const horizontal = node.type === 'pool-horizontal';
    parts = [{ key: 'pool-title', bounds: horizontal ? { x: 1, y: 1, width: POOL_HEADER - 1, height: b.height - 2 }
      : { x: 1, y: 1, width: b.width - 2, height: POOL_HEADER - 1 },
      text: entity.name, primitive: 'rectangle', fill: headerFill, color: fontColor, fontSize: 13, bold: true, vertical: horizontal }];
  } else if (node.type === 'swimlane') {
    const vertical = pool?.type === 'pool-vertical';
    parts = [{ key: 'lane-title', bounds: vertical ? { x: 1, y: 1, width: b.width - 2, height: 39 }
      : { x: 1, y: 1, width: 78, height: b.height - 2 },
      text: entity.name + (entity.role ? `\n${entity.role}` : ''), primitive: 'rectangle', fill: headerFill, stroke, color: fontColor, fontSize: 12 }];
  } else {
    parts = shape.composite?.(node, entity) ?? [];
    parts = parts.map((part) => ({ ...part,
      ...(node.appearance.fontColor && part.key === 'title' ? { color: node.appearance.fontColor } : {}),
      ...(node.appearance.headerFill && part.key === 'header' ? { fill: node.appearance.headerFill } : {}),
    }));
  }
  return { fill, stroke, fontColor, parts };
}
