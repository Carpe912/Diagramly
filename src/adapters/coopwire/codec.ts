import {
  documentSchema,
  emptyDocument,
  newEntity,
  type DiagramDocument,
  type DiagramNode,
} from '../../domain/model';
import {
  isPoolType,
  layoutPool,
  nodeDepth,
  poolLanes,
  poolOf,
  upgradeStandaloneLanes,
} from '../../domain/pools';
import { nodePresentation } from '../../shapes/presentation';
import { validateDocument } from '../../domain/validation';
import type { ShapeRegistry } from '../../shapes/registry';
import type { ActivityDetail, FlowDetail } from './api';

export const activityType = (node: DiagramNode, entity: DiagramDocument['entities'][string]) =>
  node.type === 'decision'
    ? 'decide'
    : node.type === 'subprocess'
      ? 'subAct'
      : {
          manual: 'manualOnline',
          system: 'systemOperate',
          interface: 'interfaceDocking',
          linked: 'linkAct',
        }[entity.activityType];
export const isBusinessNode = (node: DiagramNode) =>
  ['activity', 'decision', 'subprocess'].includes(node.type);
export function hydrateEntity(doc: DiagramDocument, node: DiagramNode, detail: ActivityDetail) {
  const entity = doc.entities[node.entityId],
    activity = detail.activity;
  entity.externalRef = { provider: 'coopwire', id: activity.id, version: activity.version };
  entity.name = detail.data?.actName || activity.actName || entity.name;
  entity.description = plainText(String(activity.actDetailDesc ?? ''));
  entity.code = String(activity.code ?? '');
  entity.critical = activity.isKeyStep === true;
  if (!node.parentId && Array.isArray(activity.orgId)) entity.roleIds = activity.orgId;
  entity.activityType =
    activity.actType === 'systemOperate'
      ? 'system'
      : activity.actType === 'interfaceDocking'
        ? 'interface'
        : activity.actType === 'linkAct'
          ? 'linked'
          : 'manual';
  const io = activity.ioputs ?? [];
  entity.inputs = io.filter((item) => item.type === 'input').map((item) => String(item.desc ?? ''));
  entity.outputs = io
    .filter((item) => item.type === 'output')
    .map((item) => String(item.desc ?? ''));
}
function plainText(text: string) {
  return text
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .trim();
}
export function readFlow(
  flow: FlowDetail,
  registry: ShapeRegistry,
): { document: DiagramDocument; warnings: string[]; legacySource?: string } {
  const warnings: string[] = [];
  if (!flow.drawioXml.trim()) {
    const doc = emptyDocument();
    doc.title = flow.name || '未命名画布';
    return { document: doc, warnings };
  }
  if (flow.drawioXml.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(flow.drawioXml))
    throw new Error('流程 XML 过大或包含不支持的声明');
  const xml = new DOMParser().parseFromString(flow.drawioXml, 'application/xml');
  if (xml.querySelector('parsererror') || xml.documentElement.tagName !== 'mxGraphModel')
    throw new Error('当前接口须返回未压缩 mxGraphModel XML');
  const embedded = xml.documentElement.getAttribute('diagramlyDocument');
  if (embedded)
    return {
      document: validateDocument(
        upgradeStandaloneLanes(documentSchema.parse(JSON.parse(embedded))),
        registry,
      ),
      warnings,
      legacySource: xml.documentElement.getAttribute('diagramlyLegacySource') ?? undefined,
    };
  const doc = emptyDocument();
  doc.title = flow.name || 'Coopwire 流程';
  const cells = [...xml.getElementsByTagName('mxCell')];
  const cellId = (cell: Element) =>
    cell.getAttribute('id') || cell.parentElement?.getAttribute('id') || '';
  const byId = new Map(cells.map((c) => [cellId(c), c]));
  const attrs = (cell: Element, key: string) =>
    cell.getAttribute(key) ?? cell.parentElement?.getAttribute(key) ?? '';
  const geometry = (cell: Element) => {
    const g = cell.querySelector(':scope > mxGeometry');
    return {
      x: Number(g?.getAttribute('x') || 0),
      y: Number(g?.getAttribute('y') || 0),
      width: Number(g?.getAttribute('width') || 100),
      height: Number(g?.getAttribute('height') || 60),
    };
  };
  const absolute = (cell: Element) => {
    let current: Element | undefined = cell,
      x = 0,
      y = 0;
    const visited = new Set<Element>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const g = geometry(current);
      x += g.x;
      y += g.y;
      current = byId.get(current.getAttribute('parent') || '');
    }
    return { x, y };
  };
  const mapping = new Map<string, string>();
  function insert(cell: Element | undefined, type: string, label: string) {
    const id = `legacy_node_${Object.keys(doc.nodes).length}`,
      entityId = `entity_${id}`,
      shape = registry.get(type);
    const g = cell
      ? geometry(cell)
      : { x: 0, y: 0, width: shape.defaultSize[0], height: shape.defaultSize[1] };
    doc.nodes[id] = {
      id,
      entityId,
      type,
      shapeVersion: 1,
      appearance: { accent: '#6b7db9' },
      bounds: {
        ...g,
        width: Math.max(g.width, shape.minSize[0]),
        height: Math.max(g.height, shape.minSize[1]),
      },
    };
    doc.entities[entityId] = newEntity(entityId, plainText(label) || shape.label);
    if (cell) mapping.set(cellId(cell), id);
    return doc.nodes[id];
  }
  const color = (value: string | undefined) => {
    if (/^#[0-9a-fA-F]{6}$/.test(value ?? '')) return value;
    if (/^#[0-9a-fA-F]{3}$/.test(value ?? ''))
      return (
        '#' +
        value!
          .slice(1)
          .split('')
          .map((c) => c + c)
          .join('')
      );
    return undefined;
  };
  const styleValues = (cell: Element) =>
    Object.fromEntries(
      (cell.getAttribute('style') ?? '').split(';').map((part) => part.split('=')),
    );
  const importContainerColors = (cell: Element, node: DiagramNode) => {
    const style = styleValues(cell);
    for (const [field, key] of [
      ['accent', 'strokeColor'],
      ['headerFill', 'fillColor'],
      ['fill', 'swimlaneFillColor'],
      ['fontColor', 'fontColor'],
    ] as const) {
      const value = color(style[key]);
      if (value) node.appearance[field] = value;
    }
  };
  const poolCells = cells.filter(
    (c) =>
      c.getAttribute('vertex') === '1' && /swimlaneContainer/.test(c.getAttribute('style') ?? ''),
  );
  for (const cell of poolCells) {
    const vertical = /verticalSwimlane/.test(cell.getAttribute('style') || '');
    const node = insert(
      cell,
      vertical ? 'pool-vertical' : 'pool-horizontal',
      attrs(cell, 'value') || attrs(cell, 'label') || flow.name || '业务泳池',
    );
    Object.assign(node.bounds, absolute(cell));
    importContainerColors(cell, node);
  }
  const laneCells = cells.filter((c) =>
    /swimlaneLane|coopwireSwimlane/.test(c.getAttribute('style') ?? ''),
  );
  for (const cell of laneCells) {
    const node = insert(cell, 'swimlane', attrs(cell, 'value') || attrs(cell, 'label'));
    let parent = byId.get(cell.getAttribute('parent') || '');
    const visited = new Set<Element>();
    while (
      parent &&
      !isPoolType(doc.nodes[mapping.get(cellId(parent)) ?? '']?.type ?? '') &&
      !visited.has(parent)
    ) {
      visited.add(parent);
      parent = byId.get(parent.getAttribute('parent') || '');
    }
    if (parent) node.parentId = mapping.get(cellId(parent));
    else Object.assign(node.bounds, absolute(cell));
    importContainerColors(cell, node);
    const roleIds =
      /(?:^|;)roleId=([^;]*)/
        .exec(cell.getAttribute('style') || '')?.[1]
        .split(',')
        .filter(Boolean) ?? [];
    doc.entities[node.entityId].roleIds = roleIds;
  }
  for (const pool of Object.values(doc.nodes).filter((n) => isPoolType(n.type))) {
    Object.values(doc.nodes)
      .filter((n) => n.parentId === pool.id)
      .sort((a, b) =>
        pool.type === 'pool-vertical' ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y,
      )
      .forEach((lane, index) => (lane.laneOrder = index));
  }
  const semantic = cells.filter(
    (c) =>
      !!attrs(c, 'data-act-type') ||
      /shape=mxgraph\.flowchart\.terminator/.test(c.getAttribute('style') || '') ||
      /\[active-detail\]/.test(c.getAttribute('style') || ''),
  );
  for (const cell of semantic) {
    const legacyType = attrs(cell, 'data-act-type');
    const type =
      legacyType === 'subAct'
        ? 'subprocess'
        : legacyType === 'decide'
          ? 'decision'
          : legacyType
            ? 'activity'
            : /terminator/.test(cell.getAttribute('style') || '')
              ? /结束|end/i.test(attrs(cell, 'value'))
                ? 'end'
                : 'start'
              : 'rectangle';
    if (
      legacyType &&
      ![
        'manualOnline',
        'manualOffline',
        'systemOperate',
        'interfaceDocking',
        'linkAct',
        'subAct',
        'decide',
      ].includes(legacyType)
    )
      throw new Error(`尚不能迁移旧业务图形类型：${legacyType}`);
    const node = insert(
      cell,
      type,
      attrs(cell, 'data-act-name') || attrs(cell, 'value') || attrs(cell, 'label'),
    );
    let parent = byId.get(cell.getAttribute('parent') || '');
    const visited = new Set<Element>();
    while (parent && !mapping.has(cellId(parent)) && !visited.has(parent)) {
      visited.add(parent);
      parent = byId.get(parent.getAttribute('parent') || '');
    }
    if (parent && mapping.has(cellId(parent))) {
      const lane = doc.nodes[mapping.get(cellId(parent))!];
      if (lane.type !== 'swimlane') throw new Error('发现不支持的嵌套业务图形');
      node.parentId = lane.id;
      const vertical = poolOf(doc, lane)?.type === 'pool-vertical';
      node.bounds.x = vertical ? Math.max(12, node.bounds.x) : Math.max(80, node.bounds.x + 56);
      node.bounds.y = vertical ? Math.max(52, node.bounds.y + 16) : Math.max(12, node.bounds.y);
      lane.bounds.width = Math.max(lane.bounds.width, node.bounds.x + node.bounds.width + 12);
      lane.bounds.height = Math.max(lane.bounds.height, node.bounds.y + node.bounds.height + 12);
    } else {
      const pos = absolute(cell);
      node.bounds.x = pos.x;
      node.bounds.y = pos.y;
    }
    const businessId = attrs(cell, 'data-id');
    if (businessId && isBusinessNode(node))
      doc.entities[node.entityId].externalRef = { provider: 'coopwire', id: businessId };
  }
  // Preserve relation-only activities rather than deleting business links absent from XML.
  for (const relation of flow.flowObj?.acts ?? []) {
    const businessId = String(relation.actId || '');
    if (businessId && !Object.values(doc.entities).some((e) => e.externalRef?.id === businessId)) {
      const node = insert(undefined, 'activity', '待核对活动');
      node.bounds.x = 40;
      node.bounds.y = Math.max(
        80,
        ...Object.values(doc.nodes)
          .filter((n) => n.id !== node.id && !n.parentId)
          .map((n) => n.bounds.y + n.bounds.height + 40),
      );
      doc.entities[node.entityId].externalRef = { provider: 'coopwire', id: businessId };
      doc.entities[node.entityId].roleIds = Array.isArray(relation.orgId)
        ? relation.orgId.map(String)
        : [];
      mapping.set(String(relation.xmlId), node.id);
      warnings.push('发现仅存在于流程关系中的活动，已保留为独立节点，避免误删关联。');
    }
  }
  const owner = (id: string) => {
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      if (mapping.has(id)) return mapping.get(id);
      id = byId.get(id)?.getAttribute('parent') || '';
    }
  };
  for (const cell of cells.filter((c) => c.getAttribute('edge') === '1')) {
    if (
      (cell.getAttribute('style') || '').startsWith('#active-edge#') &&
      !cell.getAttribute('target')
    ) {
      warnings.push(
        '旧图中有一条无终点的装饰标记线，未转换为业务连线；原始 XML 将作为兼容备份保留。',
      );
      continue;
    }
    const a = owner(cell.getAttribute('source') || ''),
      b = owner(cell.getAttribute('target') || '');
    if (
      !a ||
      !b ||
      !registry.get(doc.nodes[a].type).ports.length ||
      !registry.get(doc.nodes[b].type).ports.length
    ) {
      throw new Error('旧流程包含无法映射的连线端点，已停止加载，原流程保持不变');
    }
    const id = `legacy_edge_${Object.keys(doc.edges).length}`;
    const port = (nodeId: string, source: boolean) => {
      const ports = registry
        .get(doc.nodes[nodeId].type)
        .ports.filter((p) => (source ? p.direction !== 'input' : p.direction !== 'output'));
      return ports.find((p) => p.id === (source ? 'right' : 'left'))?.id ?? ports[0]?.id;
    };
    const source = port(a, true),
      target = port(b, false);
    if (!source || !target) throw new Error('旧连线方向无效');
    const labelCell = cells.find(
      (c) =>
        c.getAttribute('parent') === cellId(cell) &&
        (c.getAttribute('style') || '').startsWith('edgeLabel'),
    );
    doc.edges[id] = {
      id,
      source: { nodeId: a, portId: source },
      target: { nodeId: b, portId: target },
      label: plainText(attrs(labelCell ?? cell, 'value') || attrs(cell, 'label')),
    };
  }
  const ignoredVertices = cells.filter(
    (c) =>
      c.getAttribute('vertex') === '1' &&
      !mapping.has(cellId(c)) &&
      !/act-|swimlane|edgeLabel/.test(c.getAttribute('style') || ''),
  );
  if (ignoredVertices.length)
    throw new Error(`旧流程包含 ${ignoredVertices.length} 个尚未支持的图形，已停止迁移以防丢失`);
  for (const pool of Object.values(doc.nodes).filter((n) => isPoolType(n.type)))
    layoutPool(doc, pool.id);
  warnings.unshift(
    '旧 XML 已转换为规范化文档，保留泳池方向与泳道归属；写入时会保存为 Diagramly 兼容 XML。',
  );
  return {
    document: validateDocument(upgradeStandaloneLanes(doc), registry),
    warnings,
    legacySource: flow.drawioXml,
  };
}

export function flowRelations(doc: DiagramDocument) {
  const entity = (id: string) => doc.entities[doc.nodes[id].entityId];
  const orgs = (node: DiagramNode) =>
    doc.entities[doc.nodes[node.parentId ?? node.id]?.entityId]?.roleIds ?? [];
  return {
    swimlanes: [
      ...Object.values(doc.nodes)
        .filter((n) => isPoolType(n.type))
        .flatMap((pool) => poolLanes(doc, pool.id)),
      ...Object.values(doc.nodes).filter((n) => n.type === 'swimlane' && !n.parentId),
    ].map((n) => ({ xmlId: n.id, name: entity(n.id).name, orgId: entity(n.id).roleIds })),
    acts: Object.values(doc.nodes)
      .filter(isBusinessNode)
      .map((n) => ({
        xmlId: n.id,
        actId: entity(n.id).externalRef?.id,
        orgId: orgs(n),
        code: entity(n.id).code,
        nextActs: Object.values(doc.edges)
          .filter((e) => e.source.nodeId === n.id)
          .map((e) => ({
            act: entity(e.target.nodeId).externalRef?.id,
            xmlId: e.target.nodeId,
            condition: e.label,
            isAct: !!entity(e.target.nodeId).externalRef?.id,
          })),
      })),
    otherCells: Object.values(doc.nodes)
      .filter((n) => !isBusinessNode(n) && n.type !== 'swimlane' && !isPoolType(n.type))
      .map((n) => ({ xmlId: n.id, name: entity(n.id).name, orgId: orgs(n) })),
    outgoingEdges: Object.values(doc.edges).map((e) => ({
      xmlId: e.id,
      from: entity(e.source.nodeId).name,
      to: entity(e.target.nodeId).name,
      labels: [],
      texts: [{ xmlId: `${e.id}::label`, value: e.label }],
    })),
  };
}

export function writeFlow(
  doc: DiagramDocument,
  registry: ShapeRegistry,
  commandId: string,
  legacySource?: string,
) {
  const xml = new DOMParser().parseFromString(
      '<mxGraphModel><root/></mxGraphModel>',
      'application/xml',
    ),
    root = xml.documentElement.firstElementChild!;
  if (legacySource) xml.documentElement.setAttribute('diagramlyLegacySource', legacySource);
  xml.documentElement.setAttribute('diagramlyDocument', JSON.stringify(doc));
  xml.documentElement.setAttribute('diagramlyCommandId', commandId);
  const element = (tag: string, attrs: Record<string, string | number>) => {
    const el = xml.createElementNS(null, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  root.append(element('mxCell', { id: '0' }), element('mxCell', { id: '1', parent: '0' }));
  for (const node of Object.values(doc.nodes).sort(
    (a, b) =>
      nodeDepth(doc, a) - nodeDepth(doc, b) ||
      (a.parentId === b.parentId && a.type === 'swimlane' && b.type === 'swimlane'
        ? (a.laneOrder ?? 0) - (b.laneOrder ?? 0)
        : 0),
  )) {
    const shape = registry.get(node.type),
      entity = doc.entities[node.entityId],
      b = node.bounds,
      presentation = nodePresentation(doc, node, registry);
    const wrapper = element('object', {
      id: node.id,
      label: presentation.parts.length ? '' : entity.name,
      'data-act-name': entity.name,
    });
    if (isBusinessNode(node)) {
      wrapper.setAttribute('data-id', entity.externalRef?.id ?? '');
      wrapper.setAttribute('data-active', '1');
      wrapper.setAttribute('data-act-type', activityType(node, entity));
    }
    const cell = element('mxCell', {
      vertex: 1,
      parent: node.parentId ?? '1',
      style: `${isBusinessNode(node) ? (node.type === 'activity' ? 'active;' : node.type === 'decision' ? 'rhombus;' : 'process;') : ''}shape=${shape.primitive};whiteSpace=wrap;html=0;fillColor=${presentation.fill};strokeColor=${presentation.stroke};fontColor=${presentation.fontColor};${isBusinessNode(node) ? 'cflowchart=1;' : ''}${node.type === 'swimlane' ? `swimlaneLane;coopwireSwimlane=1;horizontal=${poolOf(doc, node)?.type === 'pool-vertical' ? 1 : 0};roleId=${entity.roleIds.join(',')};` : ''}${isPoolType(node.type) ? `swimlaneContainer;${node.type === 'pool-vertical' ? 'verticalSwimlane' : 'horizontalSwimlane'};horizontal=${node.type === 'pool-vertical' ? 1 : 0};startSize=36;` : ''}`,
    });
    cell.append(element('mxGeometry', { ...b, as: 'geometry' }));
    wrapper.append(cell);
    root.append(wrapper);
    const parts = presentation.parts;
    for (const part of parts) {
      const child = element('mxCell', {
        id: `${node.id}::${part.key}`,
        value: part.text,
        vertex: 1,
        parent: node.id,
        style: `${part.key === 'title' ? 'act-content;' : `act-${part.key};`}shape=${part.primitive};html=0;fillColor=${part.fill};strokeColor=${part.stroke ?? 'none'};fontColor=${part.color ?? '#334155'};fontSize=${part.fontSize ?? 12};horizontal=${part.vertical ? 0 : 1};movable=0;deletable=0;connectable=0;`,
      });
      child.append(element('mxGeometry', { ...part.bounds, as: 'geometry' }));
      root.append(child);
    }
  }
  for (const edge of Object.values(doc.edges)) {
    const source = registry
      .get(doc.nodes[edge.source.nodeId].type)
      .ports.find((p) => p.id === edge.source.portId)!;
    const target = registry
      .get(doc.nodes[edge.target.nodeId].type)
      .ports.find((p) => p.id === edge.target.portId)!;
    const cell = element('mxCell', {
      id: edge.id,
      value: edge.label,
      edge: 1,
      parent: '1',
      source: edge.source.nodeId,
      target: edge.target.nodeId,
      style: `edgeStyle=orthogonalEdgeStyle;rounded=1;endArrow=block;exitX=${source.x};exitY=${source.y};entryX=${target.x};entryY=${target.y};`,
    });
    cell.append(element('mxGeometry', { relative: 1, as: 'geometry' }));
    root.append(cell);
  }
  return new XMLSerializer().serializeToString(xml);
}
