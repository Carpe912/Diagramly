<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  triggerRef,
  watch,
} from 'vue';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Code2,
  Copy,
  Diamond,
  FileJson,
  FolderOpen,
  GitBranch,
  Grip,
  Hand,
  Layers,
  Maximize,
  Minus,
  MousePointer2,
  PanelTop,
  Plus,
  Redo2,
  Search,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from '@lucide/vue';
import PoolToolbar from './PoolToolbar.vue';
import LaneToolbar from './LaneToolbar.vue';
import EmbeddedBusinessDetails from './EmbeddedBusinessDetails.vue';
import EmbeddedLinkedChooser from './EmbeddedLinkedChooser.vue';
import { flowchartContext, selectionFor, type LinkedChoice } from '../adapters/coopwire/portrait';
import CanvasSettingsPanel from './CanvasSettings.vue';
import ResizableSidebar from './ResizableSidebar.vue';
import CanvasScrollbars from './CanvasScrollbars.vue';
import StyleInspector from './StyleInspector.vue';
import AlignmentInspector from './AlignmentInspector.vue';
import type { Alignment } from '../domain/alignment';
import { nodeStrokePatch } from '../shapes/styles';
import {
  absoluteBounds,
  childrenOf,
  isManagedLane,
  isPoolType,
  laneInsets,
  poolLanes,
  poolOf,
  poolOrientation,
} from '../domain/pools';
import { Editor } from '../application/editor';
import { demoDocument } from '../application/demo';
import { createShapeRegistry, type ShapeDefinition } from '../shapes/registry';
import { DiagramCanvas } from '../adapters/maxgraph/canvas';
import { attachAutosave, loadLocal } from '../adapters/storage/local';
import { downloadGraphFile, importGraphFile, type ExportFormat } from '../adapters/storage/files';
import {
  CoopwireApi,
  configureCoopwireAuth,
  refreshCoopwireSession,
} from '../adapters/coopwire/api';
import { activityType, isBusinessNode } from '../adapters/coopwire/codec';
import { CoopwireSession, type RemoteStatus } from '../adapters/coopwire/session';
import { exportDiagramPng } from '../adapters/maxgraph/export';
import { createAgentTools } from '../agent/tools';
import {
  defaultCanvasSettings,
  gridAppearance,
  emptyDocument,
  newId,
  type BusinessEntity,
  type CanvasSettings,
  type DiagramDocument,
  type EdgeAppearance,
} from '../domain/model';
import type { Command, Operation } from '../application/commands';

const registry = createShapeRegistry();
const error = ref(''),
  saveState = ref('已保存到本机');
const showError = (e: unknown) => {
  error.value = e instanceof Error ? e.message : String(e);
};
let initial: DiagramDocument = demoDocument();
try {
  initial = loadLocal(registry) ?? initial;
} catch {
  error.value = '本机文档无法读取，已打开示例；原存储会在下一次保存时替换。';
}
const editor = shallowRef(new Editor(initial, registry));
const doc = shallowRef(editor.value.snapshot);
const selection = ref<string[]>([]),
  zoom = ref(1),
  search = ref(''),
  libraryTab = ref<'shapes' | 'layers'>('shapes');
const panelTab = ref<'properties' | 'details' | 'agent'>('properties'),
  activeTool = ref<'select' | 'hand' | 'connect'>('select');
const graphEl = ref<HTMLElement>(),
  fileInput = ref<HTMLInputElement>();
let canvas: DiagramCanvas | undefined,
  unsubscribe: (() => void) | undefined,
  stopAutosave: (() => void) | undefined;
const selectedNode = computed(() =>
  selection.value.length === 1 ? doc.value.nodes[selection.value[0]] : undefined,
);
const selectedEdge = computed(() =>
  selection.value.length === 1 ? doc.value.edges[selection.value[0]] : undefined,
);
const selectedEntity = computed(() =>
  selectedNode.value ? doc.value.entities[selectedNode.value.entityId] : undefined,
);
const styleNodes = computed(() =>
  selection.value.flatMap((id) => (doc.value.nodes[id] ? [doc.value.nodes[id]] : [])),
);
const styleEdges = computed(() =>
  selection.value.flatMap((id) => (doc.value.edges[id] ? [doc.value.edges[id]] : [])),
);
function changeStyle(patch: EdgeAppearance) {
  const nodePatch = nodeStrokePatch(patch),
    operations: Operation[] = [];
  if (Object.keys(nodePatch).length)
    for (const node of styleNodes.value)
      operations.push({ type: 'node.appearance', id: node.id, ...nodePatch });
  for (const edge of styleEdges.value)
    operations.push({ type: 'edge.appearance', id: edge.id, ...patch });
  if (operations.length) void run('修改线条样式', operations);
}
function changePreset(colors: { fill: string; stroke: string; font: string }) {
  const operations: Operation[] = [
    ...styleNodes.value.map((node) => ({
      type: 'node.appearance' as const,
      id: node.id,
      fill: colors.fill,
      headerFill: colors.fill,
      fontColor: colors.font,
      accent: colors.stroke,
      strokeEnabled: true,
    })),
    ...styleEdges.value.map((edge) => ({
      type: 'edge.appearance' as const,
      id: edge.id,
      strokeColor: colors.stroke,
      strokeEnabled: true,
    })),
  ];
  if (operations.length) void run('应用配色样式', operations);
}
function alignSelection(mode: Alignment) {
  void run(mode === 'grid' ? '对齐到网格' : '对齐所选节点', [
    { type: 'nodes.align', ids: styleNodes.value.map((n) => n.id), mode },
  ]);
}
const remoteSession = shallowRef<CoopwireSession>();
const hasBusinessDetails = computed(() => {
  const node = selectedNode.value;
  if (!node || !isBusinessNode(node)) return false;
  if (!remoteSession.value) return false;
  const id = selectedEntity.value?.externalRef?.id;
  return !!id && remoteSession.value.activityDetails.has(id);
});
const embeddedSelection = computed(() => {
  const session = remoteSession.value,
    node = selectedNode.value,
    entity = selectedEntity.value;
  return session && node && entity?.externalRef && hasBusinessDetails.value
    ? selectionFor(
        session.api.config,
        node.id,
        entity.externalRef.id,
        activityType(node, entity),
        new URLSearchParams(window.location.search).get('senceId') ??
          new URLSearchParams(window.location.search).get('sceneId') ??
          '',
      )
    : undefined;
});
const portraitOrigin = ref(import.meta.env.VITE_COOPWIRE_FRONTEND_ORIGIN || '');
const externalChanges = new Set<string>();
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function refreshFromPortrait(actId: string) {
  externalChanges.add(actId);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void flushPortraitChanges(), 100);
}
async function flushPortraitChanges() {
  const session = remoteSession.value;
  if (!session || !externalChanges.size) return;
  if (editor.value.busy) {
    refreshTimer = setTimeout(() => void flushPortraitChanges(), 100);
    return;
  }
  const ids = [...externalChanges];
  externalChanges.clear();
  try {
    await editor.value.synchronizeExternal((before) => session.refreshActivities(before, ids));
  } catch (error) {
    showError(error);
  }
}
watch(panelTab, async () => {
  await nextTick();
  viewportTick.value++;
});
watch(hasBusinessDetails, (available) => {
  if (!available && panelTab.value === 'details') panelTab.value = 'properties';
});
const form = reactive({
  name: '',
  description: '',
  code: '',
  activityType: 'manual',
  critical: false,
  inputs: '',
  outputs: '',
  role: '',
  roleIds: [] as string[],
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  parentId: '',
});
watch(
  () => [doc.value, selection.value.join(',')],
  () => {
    const entity = selectedEntity.value,
      node = selectedNode.value;
    if (entity && node)
      Object.assign(form, entity, { roleIds: [...entity.roleIds] }, node.bounds, {
        inputs: entity.inputs.join('\n'),
        outputs: entity.outputs.join('\n'),
        parentId: node.parentId ?? '',
      });
    else if (selectedEdge.value) form.name = selectedEdge.value.label;
  },
  { immediate: true },
);
const icons: Record<string, unknown> = {
  square: Square,
  diamond: Diamond,
  circle: Circle,
  'circle-dot': CircleDot,
  activity: Activity,
  'panel-top': PanelTop,
  'pool-horizontal': PanelTop,
  'pool-vertical': PanelTop,
};
const paletteShapes: (ShapeDefinition & {
  id: string;
  activityType?: BusinessEntity['activityType'];
})[] = registry.list().flatMap((shape) =>
  shape.type === 'activity'
    ? ([
        { ...shape, id: 'activity', label: '人工线上', activityType: 'manual' },
        { ...shape, id: 'activity-offline', label: '人工线下', activityType: 'offline' },
        { ...shape, id: 'activity-system', label: '系统操作', activityType: 'system' },
        { ...shape, id: 'activity-interface', label: '接口', activityType: 'interface' },
        { ...shape, id: 'activity-linked', label: '引用活动', activityType: 'linked' },
      ] as const)
    : [{ ...shape, id: shape.type }],
);
const filteredShapes = computed(() =>
  paletteShapes.filter(
    (shape) =>
      shape.label.includes(search.value) || shape.type.includes(search.value.toLowerCase()),
  ),
);
const roots = computed(() => Object.values(doc.value.nodes).filter((node) => !node.parentId));
const lanes = computed(() =>
  Object.values(doc.value.nodes).filter((node) => node.type === 'swimlane'),
);
const pools = computed(() =>
  Object.values(doc.value.nodes).filter((node) => isPoolType(node.type)),
);
const contextPool = computed(() =>
  selectedNode.value && isPoolType(selectedNode.value.type) ? selectedNode.value : undefined,
);
const contextLane = computed(() =>
  selectedNode.value?.type === 'swimlane' ? selectedNode.value : undefined,
);
const viewportTick = ref(0);
const canvasSettings = computed(() => doc.value.canvas ?? defaultCanvasSettings);
const canvasStyle = computed(() => {
  void viewportTick.value;
  const settings = canvasSettings.value,
    scale = zoom.value,
    translate = canvas?.graph.view.translate;
  const grid = gridAppearance(settings),
    hex = grid.color.slice(1);
  const line = `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, ${grid.opacity})`;
  return {
    backgroundColor: settings.background ?? 'transparent',
    backgroundImage: settings.grid
      ? `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`
      : 'none',
    backgroundSize: `${settings.gridSize * scale}px ${settings.gridSize * scale}px`,
    backgroundPosition: `${(translate?.x ?? 0) * scale - (graphEl.value?.scrollLeft ?? 0) + (canvas?.graph.getPanDx() ?? 0)}px ${(translate?.y ?? 0) * scale - (graphEl.value?.scrollTop ?? 0) + (canvas?.graph.getPanDy() ?? 0) + (graphEl.value?.offsetTop ?? 0)}px`,
  };
});
function updateCanvas(patch: Partial<CanvasSettings>) {
  void run('修改画布设置', [{ type: 'document.canvas.update', patch }]);
}
async function resizePanel() {
  await nextTick();
  canvas?.fit();
  viewportTick.value++;
}
const poolToolbarPosition = computed(() => {
  void viewportTick.value;
  void zoom.value;
  void doc.value;
  const target = contextPool.value ?? contextLane.value;
  const bounds = target ? canvas?.bounds(target.id) : undefined;
  const width = graphEl.value?.clientWidth ?? 900,
    toolbarWidth = Math.min(contextLane.value ? 340 : 650, width - 24);
  return {
    left: `${Math.max(12 + toolbarWidth / 2, Math.min(width - toolbarWidth / 2 - 12, (bounds?.x ?? 12) + (bounds?.width ?? toolbarWidth) / 2))}px`,
    top: `${Math.max(136, Math.min((graphEl.value?.offsetTop ?? 180) + (bounds?.y ?? 40) - 52, (graphEl.value?.parentElement?.clientHeight ?? 800) - 130))}px`,
  };
});
const layerRows = computed(() => {
  const rows: { id: string; depth: number }[] = [],
    seen = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ id, depth });
    const node = doc.value.nodes[id],
      children = isPoolType(node.type) ? poolLanes(doc.value, id) : childrenOf(doc.value, id);
    children.forEach((n) => visit(n.id, depth + 1));
  };
  roots.value.forEach((node) => visit(node.id, 0));
  return rows;
});
const nodeCount = computed(() => Object.keys(doc.value.nodes).length);
const title = computed({
  get: () => doc.value.title,
  set: (value: string) => run('重命名画布', [{ type: 'document.rename', title: value }]),
});
const isInput = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input, textarea, select, [contenteditable="true"]');
async function run(label: string, operations: Operation[]) {
  try {
    error.value = '';
    return await editor.value.dispatchAsync(label, operations);
  } catch (e) {
    showError(e);
  }
}
function select(ids: string[]) {
  selection.value = ids;
  canvas?.select(ids);
}
function selectLayer(id: string, event: MouseEvent) {
  select(
    event.shiftKey || event.ctrlKey || event.metaKey
      ? selection.value.includes(id)
        ? selection.value.filter((item) => item !== id)
        : [...selection.value, id]
      : [id],
  );
}
let connectSource: string | undefined;
function onSelection(ids: string[]) {
  selection.value = [...new Set(ids)];
  const selected = ids.length === 1 ? doc.value.nodes[ids[0]] : undefined;
  if (
    activeTool.value === 'select' &&
    selected &&
    remoteSession.value &&
    isBusinessNode(selected) &&
    doc.value.entities[selected.entityId]?.externalRef
  )
    panelTab.value = 'details';
  if (activeTool.value === 'connect' && ids.length === 1 && doc.value.nodes[ids[0]]) {
    const node = doc.value.nodes[ids[0]],
      ports = registry.get(node.type).ports;
    if (!ports.length) return;
    if (!connectSource) {
      connectSource = ids[0];
      return;
    }
    const sourceNode = doc.value.nodes[connectSource];
    const sourcePorts = registry.get(sourceNode.type).ports.filter((p) => p.direction !== 'input');
    const targetPorts = ports.filter((p) => p.direction !== 'output');
    const a = sourcePorts.find((p) => p.id === 'right') ?? sourcePorts[0],
      b = targetPorts.find((p) => p.id === 'left') ?? targetPorts[0];
    if (a && b)
      run('连接节点', [
        {
          type: 'edge.create',
          edge: {
            id: newId('edge'),
            label: '',
            source: { nodeId: connectSource, portId: a.id },
            target: { nodeId: node.id, portId: b.id },
          },
        },
      ]);
    else error.value = '端口方向不允许此连接';
    connectSource = undefined;
    setTool('select');
  }
}
function bindEditor() {
  if (!graphEl.value) return;
  doc.value = editor.value.snapshot;
  canvas = new DiagramCanvas(
    graphEl.value,
    editor.value,
    {
      select: onSelection,
      error: showError,
      zoom: (value) => (zoom.value = value),
      viewport: () => viewportTick.value++,
    },
    graphEl.value.parentElement ?? graphEl.value,
  );
  unsubscribe = editor.value.subscribe(() => {
    doc.value = editor.value.snapshot;
    triggerRef(editor);
    selection.value = selection.value.filter((id) => doc.value.nodes[id] || doc.value.edges[id]);
    agentPreview.value = undefined;
  });
  stopAutosave = attachAutosave(
    editor.value,
    (message, failed) => {
      saveState.value = message;
      if (failed) error.value = message;
    },
    remoteSession.value
      ? `diagramly.remote.cache:${JSON.stringify(remoteSession.value.api.config)}`
      : undefined,
  );
  canvas.fit();
}
function replaceDocument(document: DiagramDocument, session?: CoopwireSession) {
  stopAutosave?.();
  unsubscribe?.();
  canvas?.destroy();
  selection.value = [];
  connectSource = undefined;
  editor.value = new Editor(document, registry);
  remoteSession.value = session;
  externalChanges.clear();
  clearTimeout(refreshTimer);
  if (session) editor.value.attachTransport(session);
  panelTab.value = 'properties';
  bindEditor();
  setTool('select');
}
const linkedChooserOpen = ref(false);
let linkedPoint: { x: number; y: number } | undefined;
function onLinkedChosen(choice: LinkedChoice) {
  linkedChooserOpen.value = false;
  void addShape('activity', linkedPoint, 'linked', choice);
  linkedPoint = undefined;
}
async function addShape(
  type: string,
  point?: { x: number; y: number },
  preset?: string,
  linkedChoice?: LinkedChoice,
) {
  if (type === 'activity' && preset === 'linked' && !linkedChoice) {
    if (!remoteSession.value) {
      error.value = '请先连接 Coopwire，再选择引用活动';
      return;
    }
    linkedPoint = point;
    linkedChooserOpen.value = true;
    return;
  }
  const definition = registry.get(type);
  if (type === 'swimlane') {
    const pool = selectedNode.value ? poolOf(doc.value, selectedNode.value) : undefined;
    if (pool) {
      await addLane(pool.id);
      return;
    }
    await createPool('horizontal', point);
    return;
  }
  if (isPoolType(type)) {
    await createPool(type === 'pool-vertical' ? 'vertical' : 'horizontal', point);
    return;
  }
  let parentId: string | undefined,
    x = point?.x ?? 160,
    y = point?.y ?? 150;
  if (point) {
    const lane = lanes.value.find((lane) => {
      const bounds = absoluteBounds(doc.value, lane),
        inset = laneInsets(doc.value, lane);
      return (
        point.x >= bounds.x + inset.left &&
        point.y >= bounds.y + inset.top &&
        point.x <= bounds.x + bounds.width - inset.right &&
        point.y <= bounds.y + bounds.height - inset.bottom
      );
    });
    if (lane) {
      const bounds = absoluteBounds(doc.value, lane);
      parentId = lane.id;
      x -= bounds.x;
      y -= bounds.y;
    }
  } else {
    const selected = selectedNode.value,
      pool = selected ? poolOf(doc.value, selected) : undefined;
    const lane =
      selected?.type === 'swimlane'
        ? selected
        : selected?.parentId && doc.value.nodes[selected.parentId]?.type === 'swimlane'
          ? doc.value.nodes[selected.parentId]
          : pool
            ? poolLanes(doc.value, pool.id)[0]
            : undefined;
    if (lane) {
      parentId = lane.id;
      const children = childrenOf(doc.value, lane.id),
        vertical = poolOf(doc.value, lane)?.type === 'pool-vertical';
      x = vertical ? 24 : Math.max(110, ...children.map((n) => n.bounds.x + n.bounds.width + 40));
      y = vertical ? Math.max(72, ...children.map((n) => n.bounds.y + n.bounds.height + 30)) : 45;
    } else {
      y = Math.max(70, ...roots.value.map((n) => n.bounds.y + n.bounds.height + 40));
      x = 60;
    }
  }
  const step = point ? (canvasSettings.value.grid ? canvasSettings.value.gridSize : 1) : 10;
  x = Math.round(x / step) * step;
  y = Math.round(y / step) * step;
  if (parentId) {
    const inset = laneInsets(doc.value, doc.value.nodes[parentId]);
    x = Math.max(inset.left, x);
    y = Math.max(inset.top, y);
  }
  const operation = editor.value.createNode(type, x, y, parentId);
  if (operation.type === 'node.create' && preset) {
    operation.entity.activityType = preset as BusinessEntity['activityType'];
    operation.entity.name =
      { manual: '人工线上', offline: '人工线下', system: '系统操作', interface: '接口' }[preset] ??
      operation.entity.name;
    if (linkedChoice) {
      operation.entity.name = '引用活动';
      operation.entity.details = linkedChoice;
    }
  }
  const result = await run(`添加${definition.label}`, [operation]);
  if (result && operation.type === 'node.create') {
    select([operation.node.id]);
    if (!point) canvas?.fit();
  }
}
async function createPool(
  orientation: 'horizontal' | 'vertical',
  point?: { x: number; y: number },
) {
  const x = point?.x ?? 60,
    y = point?.y ?? Math.max(70, ...roots.value.map((n) => n.bounds.y + n.bounds.height + 60));
  const operations = editor.value.createPool(orientation, x, y),
    create = operations[0];
  if (
    (await run(`添加${orientation === 'horizontal' ? '水平' : '垂直'}泳池`, operations)) &&
    create.type === 'node.create'
  ) {
    select([create.node.id]);
    canvas?.fit();
  }
}
async function addLane(poolId: string) {
  const count = poolLanes(doc.value, poolId).length;
  if (
    await run('添加泳道', [
      {
        type: 'pool.lane.add',
        poolId,
        laneId: newId('lane'),
        entityId: newId('entity'),
        name: `泳道 ${count + 1}`,
      },
    ])
  ) {
    select([poolId]);
    canvas?.fit();
  }
}
const laneDeletion = ref<{ poolId: string; laneId: string }>();
function requestLaneRemoval(laneId: string) {
  const lane = doc.value.nodes[laneId],
    pool = lane && poolOf(doc.value, lane);
  if (!pool || editor.value.busy) return;
  if (poolLanes(doc.value, pool.id).length <= 1) {
    error.value = '泳池至少保留一条泳道';
    return;
  }
  laneDeletion.value = { poolId: pool.id, laneId };
  if (!childrenOf(doc.value, laneId).length) void removeLane();
}
async function removeLane() {
  const target = laneDeletion.value;
  if (!target) return;
  if (await run('删除泳道', [{ type: 'pool.lane.remove', ...target }])) {
    laneDeletion.value = undefined;
    select([target.poolId]);
    canvas?.fit();
  }
}
async function changePoolOrientation(orientation: 'horizontal' | 'vertical') {
  if (!contextPool.value || poolOrientation(contextPool.value) === orientation) return;
  if (
    await run('切换泳池方向', [{ type: 'pool.orientation', id: contextPool.value.id, orientation }])
  )
    canvas?.fit();
}
function poolAppearance(patch: { fill?: string; headerFill?: string; fontColor?: string }) {
  if (contextPool.value)
    void run('修改泳池主题', [{ type: 'node.appearance', id: contextPool.value.id, ...patch }]);
}
function laneAppearance(patch: { fill?: string; headerFill?: string; fontColor?: string }) {
  if (contextLane.value)
    void run('修改泳道外观', [{ type: 'node.appearance', id: contextLane.value.id, ...patch }]);
}
function changeLanePool() {
  if (selectedNode.value?.type === 'swimlane' && form.parentId)
    void run('移动泳道到其他泳池', [
      { type: 'pool.lane.move', laneId: selectedNode.value.id, poolId: form.parentId },
    ]).then((result) => {
      if (result) canvas?.fit();
    });
}
function geometryDisabled(key: 'x' | 'y' | 'width' | 'height') {
  const node = selectedNode.value;
  if (!node || !isManagedLane(doc.value, node)) return false;
  return key === 'x' || key === 'y';
}
function dropShape(event: DragEvent) {
  event.preventDefault();
  const payload = event.dataTransfer?.getData('application/x-diagramly-shape');
  if (payload && canvas) {
    const [type, preset] = payload.split(':');
    void addShape(type, canvas.pointForEvent(event), preset);
  }
}
function dragShape(event: DragEvent, type: string, preset?: string) {
  event.dataTransfer?.setData('application/x-diagramly-shape', `${type}:${preset ?? ''}`);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}
function patchEntity(patch: Partial<Omit<BusinessEntity, 'id'>>) {
  if (selectedNode.value)
    run('编辑业务属性', [{ type: 'node.update', id: selectedNode.value.id, patch }]);
}
function assignLaneRoles(roleIds: string[]) {
  const lane = selectedNode.value;
  if (lane?.type !== 'swimlane') return;
  const roles: { id: string; name: string }[] = [];
  for (const id of roleIds) {
    const role = remoteSession.value?.organizations.find((item) => item.orgId === id);
    if (!role) {
      showError(new Error('所选角色不存在，请重新读取项目角色'));
      return;
    }
    roles.push({ id: role.orgId, name: role.orgName });
  }
  void run('选择泳道角色', [{ type: 'lane.roles.set', laneId: lane.id, roles }]);
}
function updateName() {
  if (selectedNode.value?.type === 'swimlane') return;
  if (selectedEdge.value)
    run('编辑连线标签', [
      { type: 'edge.update', id: selectedEdge.value.id, patch: { label: form.name } },
    ]);
  else patchEntity({ name: form.name });
}
function updateBounds() {
  const node = selectedNode.value;
  if (!node) return;
  if (isManagedLane(doc.value, node)) {
    const vertical = poolOf(doc.value, node)?.type === 'pool-vertical';
    void run('调整泳道尺寸', [
      {
        type: 'pool.lane.resize',
        laneId: node.id,
        extent: Number(vertical ? form.width : form.height),
        crossExtent: Number(vertical ? form.height : form.width),
      },
    ]);
  } else
    void run('调整位置与尺寸', [
      {
        type: 'node.resize',
        id: node.id,
        bounds: {
          x: Number(form.x),
          y: Number(form.y),
          width: Number(form.width),
          height: Number(form.height),
        },
      },
    ]);
}
function changeParent() {
  const node = selectedNode.value;
  if (!node) return;
  const newParent = doc.value.nodes[form.parentId],
    bounds = absoluteBounds(doc.value, node),
    inset = newParent ? laneInsets(doc.value, newParent) : undefined;
  void run('移动到泳道', [
    {
      type: 'node.move',
      id: node.id,
      parentId: newParent?.id ?? null,
      x: inset ? inset.left + 20 : bounds.x,
      y: inset ? inset.top + 20 : bounds.y,
    },
  ]);
}
async function removeSelection() {
  const single = selectedNode.value;
  if (single?.type === 'swimlane' && isManagedLane(doc.value, single)) {
    requestLaneRemoval(single.id);
    return;
  }
  const ids = new Set(selection.value);
  const hasSelectedAncestor = (id: string) => {
    let node = doc.value.nodes[id];
    const seen = new Set<string>();
    while (node?.parentId && !seen.has(node.id)) {
      seen.add(node.id);
      if (ids.has(node.parentId)) return true;
      node = doc.value.nodes[node.parentId];
    }
    return false;
  };
  const operations: Operation[] = selection.value
    .filter((id) => {
      const edge = doc.value.edges[id];
      if (hasSelectedAncestor(id)) return false;
      return (
        !edge ||
        ![edge.source.nodeId, edge.target.nodeId].some(
          (nodeId) => ids.has(nodeId) || hasSelectedAncestor(nodeId),
        )
      );
    })
    .map((id) => ({ type: doc.value.nodes[id] ? 'node.delete' : 'edge.delete', id }) as Operation);
  if (operations.length && (await run('删除所选图形', operations))) select([]);
}
async function duplicateSelection() {
  const operations: Operation[] = selection.value
    .filter((id) => doc.value.nodes[id])
    .map((id) => ({
      type: 'node.duplicate',
      id,
      newId: newId('node'),
      newEntityId: newId('entity'),
      offset: { x: 30, y: 30 },
    }));
  if (operations.length && (await run('复制所选图形', operations)))
    select(operations.flatMap((op) => (op.type === 'node.duplicate' ? [op.newId] : [])));
}
function setTool(tool: typeof activeTool.value) {
  activeTool.value = tool;
  connectSource = undefined;
  if (canvas) {
    const panning =
      canvas.graph.getPlugin<import('@maxgraph/core').PanningHandler>('PanningHandler');
    if (panning) {
      panning.useLeftButtonForPanning = tool === 'hand';
      panning.ignoreCell = tool === 'hand';
    }
    canvas.graph
      .getPlugin<import('@maxgraph/core').RubberBandHandler>('RubberBandHandler')
      ?.setEnabled(tool === 'select');
    canvas.graph.setCellsMovable(tool === 'select');
    canvas.graph.isCellMovable = (cell) => tool === 'select' && !!canvas?.canMove(cell.id ?? '');
  }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (remoteSession.value) throw new Error('请先断开远程连接，再导入其他文档');
    if (file.size > 8 * 1024 * 1024) throw new Error('文件超过 8MB 上限');
    const parsed = await importGraphFile(await file.text(), file.name, registry);
    replaceDocument(parsed);
    showData.value = false;
    error.value = '';
  } catch (e) {
    showError(e);
  } finally {
    input.value = '';
  }
}
function keyboard(event: KeyboardEvent) {
  if (isInput(event.target)) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? history('redo') : history('undo');
  } else if (modifier && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    history('redo');
  } else if (modifier && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    duplicateSelection();
  } else if (modifier && event.key.toLowerCase() === 's') {
    event.preventDefault();
    showData.value = true;
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    removeSelection();
  } else if (event.key === 'Escape') {
    select([]);
    setTool('select');
  } else if (event.key.toLowerCase() === 'v') setTool('select');
  else if (event.key.toLowerCase() === 'h') setTool('hand');
  else if (event.key.toLowerCase() === 'c') {
    select([]);
    setTool('connect');
  }
}
const agentJson = ref(''),
  agentPreview = shallowRef<ReturnType<ReturnType<typeof createAgentTools>['preview']>>();
const agentResult = ref('');
function prepareAgentExample() {
  const target =
    selectedNode.value ?? Object.values(doc.value.nodes).find((node) => node.type === 'activity');
  if (!target) {
    error.value = '请先添加或选择一个节点';
    return;
  }
  const command: Command = {
    commandId: newId('cmd'),
    expectedRevision: doc.value.revision,
    origin: 'agent',
    label: 'Agent 更新活动',
    operations: [
      { type: 'node.update', id: target.id, patch: { name: 'Agent 更新的活动', critical: true } },
    ],
  };
  agentJson.value = JSON.stringify(command, null, 2);
  agentPreview.value = undefined;
  agentResult.value = '';
}
watch(agentJson, () => {
  agentPreview.value = undefined;
  agentResult.value = '';
});
function previewAgent() {
  try {
    error.value = '';
    agentPreview.value = createAgentTools(editor.value).preview(JSON.parse(agentJson.value));
    agentResult.value = '';
  } catch (e) {
    agentPreview.value = undefined;
    showError(e);
  }
}
async function applyAgent() {
  if (!agentPreview.value) return;
  try {
    const receipt = await createAgentTools(editor.value).apply(JSON.parse(agentJson.value));
    agentResult.value = `已应用 · revision ${receipt.revision} · 可以撤销`;
  } catch (e) {
    showError(e);
  }
}
async function history(action: 'undo' | 'redo') {
  try {
    error.value = '';
    await (action === 'undo' ? editor.value.undoAsync() : editor.value.redoAsync());
  } catch (e) {
    showError(e);
  }
}
const remoteStatus = shallowRef<RemoteStatus>({ state: 'ready', message: '' });
const connectionOpen = ref(false),
  connecting = ref(false),
  recoveryConfirm = ref(false);
const remoteConfig = reactive({
  baseUrl: import.meta.env.VITE_COOPWIRE_BASE_URL ?? '',
  projectId: import.meta.env.VITE_COOPWIRE_PROJECT_ID ?? '',
  flowchartId: import.meta.env.VITE_COOPWIRE_FLOWCHART_ID ?? '',
  flowchartType: import.meta.env.VITE_COOPWIRE_FLOWCHART_TYPE ?? 'tobe',
});
async function connectRemote() {
  connecting.value = true;
  try {
    const session = new CoopwireSession(
      new CoopwireApi({ ...remoteConfig }),
      registry,
      (document) => exportDiagramPng(document, registry),
    );
    session.onStatus((status) => (remoteStatus.value = status));
    const document = await session.open();
    replaceDocument(document, session);
    connectionOpen.value = false;
    error.value = '';
  } catch (e) {
    showError(e);
  } finally {
    connecting.value = false;
  }
}
async function reloadRemote() {
  const session = remoteSession.value;
  if (!session || editor.value.busy) return;
  connecting.value = true;
  try {
    const document = await session.reloadAndReconcile();
    replaceDocument(document, session);
    error.value = '';
    recoveryConfirm.value = false;
  } catch (e) {
    showError(e);
  } finally {
    connecting.value = false;
  }
}
function downloadLegacyXml() {
  const xml = remoteSession.value?.legacySource;
  if (!xml) return;
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'coopwire-original.xml';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function disconnectRemote() {
  if (editor.value.busy) return;
  let local = demoDocument();
  try {
    local = loadLocal(registry) ?? local;
  } catch {
    /* 读取失败时保留原有缓存。 */
  }
  replaceDocument(local);
  remoteStatus.value = { state: 'ready', message: '' };
  connectionOpen.value = false;
}
async function retryRemote() {
  try {
    await editor.value.retryRemote();
    error.value = '';
  } catch (e) {
    showError(e);
  }
}
const showData = ref(false),
  showReset = ref<'sample' | 'empty' | null>(null);
const exportFormat = ref<ExportFormat>('json'),
  exporting = ref(false);
async function exportFile() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    await downloadGraphFile(editor.value.snapshot, registry, exportFormat.value);
  } catch (e) {
    showError(e);
  } finally {
    exporting.value = false;
  }
}
onMounted(() => {
  bindEditor();
  window.addEventListener('keydown', keyboard);
  configureCoopwireAuth({ refresh: () => refreshCoopwireSession(remoteConfig.baseUrl) });
  try {
    const context = flowchartContext(window.location.href);
    if (context) {
      Object.assign(remoteConfig, context.config);
      void connectRemote();
    }
  } catch (cause) {
    showError(cause);
  }
});
onBeforeUnmount(() => {
  clearTimeout(refreshTimer);
  stopAutosave?.();
  unsubscribe?.();
  canvas?.destroy();
  window.removeEventListener('keydown', keyboard);
});
</script>

<template>
  <div class="workbench">
    <header class="app-header">
      <a class="brand" href="#" aria-label="Diagramly 首页"
        ><span class="brand-mark"><GitBranch :size="20" /></span>diagramly<span class="brand-dot"
          >.</span
        ></a
      >
      <span class="header-divider"></span>
      <div class="document-heading">
        <span class="breadcrumb">工作空间 <ChevronRight :size="12" /> 流程设计</span
        ><input v-model.lazy="title" aria-label="画布名称" /><ChevronDown :size="13" />
      </div>
      <span class="local-status"
        ><span></span>{{ remoteSession ? remoteStatus.message : saveState }}</span
      >
      <div class="header-actions">
        <button class="button secondary" @click="connectionOpen = true">
          <GitBranch :size="14" />{{ remoteSession ? 'Coopwire 已连接' : '连接 Coopwire' }}
        </button>
        <button class="text-button" @click="showData = true"><Code2 :size="15" /> 文档数据</button>
        <span class="avatar">D</span>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept="application/json,application/xml,text/xml,.json,.xml,.drawio"
        hidden
        aria-label="导入文档"
        @change="importFile"
      />
    </header>

    <div class="workspace-body">
      <ResizableSidebar
        class="library-panel"
        side="left"
        label="图形库侧栏"
        :default-width="222"
        :min-width="180"
        :max-width="420"
        @resized="resizePanel"
      >
        <div class="panel-tabs">
          <button :class="{ active: libraryTab === 'shapes' }" @click="libraryTab = 'shapes'">
            图形库</button
          ><button :class="{ active: libraryTab === 'layers' }" @click="libraryTab = 'layers'">
            图层 <span>{{ nodeCount }}</span>
          </button>
        </div>
        <template v-if="libraryTab === 'shapes'">
          <div class="search-field">
            <Search :size="14" /><input
              v-model="search"
              placeholder="搜索图形…"
              aria-label="搜索图形"
            /><kbd>/</kbd>
          </div>
          <div class="library-content">
            <template v-for="category in ['容器', '基础图形', '业务图形']" :key="category">
              <section
                v-if="
                  filteredShapes.some((s) => s.category === category) ||
                  (category === '业务图形' && (!search || '定向连接器'.includes(search)))
                "
                class="shape-category"
                :class="{ 'container-category': category === '容器' }"
              >
                <h3>
                  <ChevronDown :size="12" />{{ category
                  }}<span>{{ filteredShapes.filter((s) => s.category === category).length }}</span>
                </h3>
                <div :class="['shape-grid', { 'business-grid': category === '业务图形' }]">
                  <button
                    v-if="category === '业务图形' && (!search || '定向连接器'.includes(search))"
                    class="shape-item"
                    data-testid="shape-connector"
                    title="点击后依次选择起点和终点"
                    @click="setTool('connect')"
                  >
                    <GitBranch :size="31" :stroke-width="1.1" class="shape-preview" />
                    <span>定向连接器</span>
                  </button>
                  <button
                    v-for="shape in filteredShapes.filter((s) => s.category === category)"
                    :key="shape.id"
                    class="shape-item"
                    draggable="true"
                    :data-testid="`shape-${shape.id}`"
                    :title="`点击或拖入：${shape.label}`"
                    @dragstart="dragShape($event, shape.type, shape.activityType)"
                    @click="addShape(shape.type, undefined, shape.activityType)"
                  >
                    <div v-if="isPoolType(shape.type)" :class="['mini-pool', shape.type]">
                      <span></span><i></i><i></i>
                    </div>
                    <div v-else-if="shape.type === 'activity'" class="mini-activity">
                      <div><span></span>ACT · {{ shape.label }}</div>
                      <strong>{{ shape.label }}</strong>
                      <footer>○ 常规活动</footer>
                    </div>
                    <div v-else-if="shape.type === 'swimlane'" class="mini-lane">
                      <span></span><i></i><i></i>
                    </div>
                    <component
                      :is="icons[shape.icon]"
                      v-else
                      :size="shape.type === 'rectangle' ? 35 : 31"
                      :stroke-width="1.1"
                      class="shape-preview"
                    />
                    <span>{{ shape.label }}</span
                    ><span v-if="shape.type === 'activity'" class="composite-label">组合图形</span>
                  </button>
                </div>
              </section>
            </template>
            <p v-if="!filteredShapes.length" class="empty-search">没有匹配的图形</p>
          </div>
          <p class="library-drag-hint">拖入画布 · 选中泳池管理泳道</p>
        </template>
        <div v-else class="layers-list">
          <p class="panel-hint">业务节点 · 不含内部绘制部件</p>
          <button
            v-for="row in layerRows"
            :key="row.id"
            :class="['layer-row', { selected: selection.includes(row.id) }]"
            :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
            @click="selectLayer(row.id, $event)"
          >
            <component :is="icons[registry.get(doc.nodes[row.id].type).icon]" :size="14" /><span>{{
              doc.entities[doc.nodes[row.id].entityId].name
            }}</span>
          </button>
          <p class="panel-hint">连线</p>
          <button
            v-for="edge in Object.values(doc.edges)"
            :key="edge.id"
            :class="['layer-row', { selected: selection.includes(edge.id) }]"
            @click="selectLayer(edge.id, $event)"
          >
            <GitBranch :size="14" /><span>{{
              edge.label ||
              `${doc.entities[doc.nodes[edge.source.nodeId].entityId].name} → ${doc.entities[doc.nodes[edge.target.nodeId].entityId].name}`
            }}</span>
          </button>
        </div>
        <div class="sidebar-footer"><span class="version-pill">v0.1</span>轻量内核 · 无限可能</div>
      </ResizableSidebar>

      <main class="canvas-area" :style="canvasStyle" data-testid="canvas-area">
        <div v-if="editor.busy" class="remote-saving">正在提交远程操作…</div>
        <div class="canvas-topbar">
          <div>
            <span class="canvas-tag"><GitBranch :size="13" /> 流程图</span
            ><span class="subtle"
              >{{ nodeCount }} 个节点 <span class="middot">·</span>
              {{ Object.keys(doc.edges).length }} 条连线</span
            >
          </div>
          <div class="canvas-file-actions">
            <CanvasSettingsPanel
              :value="canvasSettings"
              :busy="editor.busy"
              @change="updateCanvas"
            />
            <button
              class="quiet-button"
              :disabled="!!remoteSession || editor.busy"
              @click="showReset = 'empty'"
            >
              <Plus :size="14" /> 新建画布</button
            ><button
              class="quiet-button"
              :disabled="!!remoteSession || editor.busy"
              @click="showReset = 'sample'"
            >
              <FolderOpen :size="14" /> 打开示例
            </button>
          </div>
        </div>
        <PoolToolbar
          v-if="contextPool"
          :document="doc"
          :pool="contextPool"
          :selected-lane-id="selectedNode?.type === 'swimlane' ? selectedNode.id : undefined"
          :busy="editor.busy"
          :position="poolToolbarPosition"
          @add="addLane(contextPool.id)"
          @remove="requestLaneRemoval"
          @orientation="changePoolOrientation"
          @appearance="poolAppearance"
        />
        <LaneToolbar
          v-else-if="contextLane"
          :document="doc"
          :lane="contextLane"
          :organizations="remoteSession?.organizations ?? []"
          :busy="editor.busy"
          :position="poolToolbarPosition"
          @appearance="laneAppearance"
          @roles="patchEntity"
          @assign-roles="assignLaneRoles"
        />
        <div class="canvas-heading">
          <div class="eyebrow">DESIGN YOUR PROCESS</div>
          <h1>{{ doc.title }}</h1>
          <p>让复杂的业务，清晰地流动。</p>
        </div>
        <div
          id="diagram-canvas"
          ref="graphEl"
          :class="['graph-container', `tool-${activeTool}`]"
          data-testid="graph"
          @dragover.prevent
          @drop="dropShape"
        ></div>
        <CanvasScrollbars v-if="graphEl" :container="graphEl" :tick="viewportTick" />
        <div class="canvas-tools" role="toolbar" aria-label="画布工具">
          <button
            :class="{ active: activeTool === 'select' }"
            title="选择 (V)"
            aria-label="选择工具"
            @click="setTool('select')"
          >
            <MousePointer2 :size="18" />
          </button>
          <button
            :class="{ active: activeTool === 'hand' }"
            title="平移 (H)"
            aria-label="平移工具"
            @click="setTool('hand')"
          >
            <Hand :size="18" />
          </button>
          <button
            :class="{ active: activeTool === 'connect' }"
            title="连接 (C)，依次选择起点与终点"
            aria-label="连接工具"
            @click="
              select([]);
              setTool('connect');
            "
          >
            <GitBranch :size="18" />
          </button>
          <i></i
          ><button
            :disabled="editor.busy || !editor.canUndo"
            title="撤销 (⌘Z)"
            aria-label="撤销"
            @click="history('undo')"
          >
            <Undo2 :size="17" /></button
          ><button
            :disabled="editor.busy || !editor.canRedo"
            title="重做 (⇧⌘Z)"
            aria-label="重做"
            @click="history('redo')"
          >
            <Redo2 :size="17" />
          </button>
          <template v-if="selection.length"
            ><i></i
            ><button title="复制 (⌘D)" aria-label="复制所选" @click="duplicateSelection">
              <Copy :size="16" /></button
            ><button title="删除 (Delete)" aria-label="删除所选" @click="removeSelection">
              <Trash2 :size="16" /></button
          ></template>
        </div>
        <div v-if="activeTool === 'connect'" class="connection-hint">
          {{ connectSource ? '选择终点节点' : '选择起点节点' }}<span>Esc 退出</span>
        </div>
        <div v-else class="canvas-tip">
          <Grip :size="12" /> 拖拽框选 <span>·</span> 滚轮缩放 <span>·</span> 滚动条 / 空格拖拽平移
        </div>
        <div class="zoom-control">
          <button aria-label="缩小" @click="canvas?.zoom(-1)"><Minus :size="14" /></button
          ><span>{{ Math.round(zoom * 100) }}%</span
          ><button aria-label="放大" @click="canvas?.zoom(1)"><Plus :size="14" /></button><i></i
          ><button aria-label="适应画布" title="适应画布" @click="canvas?.fit()">
            <Maximize :size="14" />
          </button>
        </div>
        <div class="canvas-page"><span class="page-indicator"></span>画布 01</div>
      </main>

      <ResizableSidebar
        class="inspector-panel"
        side="right"
        label="属性侧栏"
        :default-width="panelTab === 'details' ? 400 : 274"
        :min-width="260"
        :max-width="600"
        @resized="resizePanel"
      >
        <div class="panel-tabs" role="tablist" aria-label="图形面板">
          <button
            role="tab"
            :aria-selected="panelTab === 'properties'"
            :class="{ active: panelTab === 'properties' }"
            @click="panelTab = 'properties'"
          >
            属性
          </button>
          <button
            v-if="hasBusinessDetails"
            role="tab"
            :aria-selected="panelTab === 'details'"
            :class="{ active: panelTab === 'details' }"
            @click="panelTab = 'details'"
          >
            业务详情
          </button>
          <button
            role="tab"
            :aria-selected="panelTab === 'agent'"
            :class="{ active: panelTab === 'agent' }"
            @click="panelTab = 'agent'"
          >
            <Sparkles :size="13" /> Agent <span class="beta-label">LAB</span>
          </button>
        </div>
        <div
          v-if="panelTab === 'details' && hasBusinessDetails && selectedNode && selectedEntity"
          class="inspector-scroll"
          role="tabpanel"
          aria-label="业务详情"
        >
          <EmbeddedBusinessDetails
            v-if="embeddedSelection"
            :key="remoteSession!.api.config.projectId + ':' + remoteSession!.api.config.flowchartId"
            :selection="embeddedSelection"
            :origin="portraitOrigin"
            :busy="editor.busy"
            :revision="doc.revision"
            @changed="refreshFromPortrait"
            @close="panelTab = 'properties'"
            @error="showError"
          />
        </div>
        <div
          v-else-if="panelTab === 'properties'"
          class="inspector-scroll"
          role="tabpanel"
          aria-label="属性"
        >
          <template v-if="selectedNode && selectedEntity">
            <div class="inspector-selection">
              <span class="selection-icon"
                ><component :is="icons[registry.get(selectedNode.type).icon]" :size="19"
              /></span>
              <div>
                <strong>{{ registry.get(selectedNode.type).label }}</strong>
                <p>
                  {{ selectedNode.type === 'activity' ? '组合图形 · 统一业务实体' : '图形属性' }}
                </p>
              </div>
              <span class="selected-badge">已选择</span>
            </div>
            <section class="property-section">
              <h3>基本信息</h3>
              <label
                >名称<input
                  v-model="form.name"
                  aria-label="节点名称"
                  :readonly="selectedNode.type === 'swimlane'"
                  @change="updateName" /></label
              ><label v-if="selectedNode.type === 'activity'"
                >活动编号<input
                  v-model="form.code"
                  aria-label="活动编号"
                  placeholder="例如 ACT-001"
                  @change="patchEntity({ code: form.code })" /></label
              ><label
                >描述<textarea
                  v-model="form.description"
                  aria-label="节点描述"
                  rows="3"
                  placeholder="添加说明…"
                  @change="patchEntity({ description: form.description })"
                ></textarea>
              </label>
              <p v-if="selectedNode.type === 'swimlane'" class="field-help">
                名称由所选角色生成，请通过「角色泳道」选择角色。
              </p>
            </section>
            <section class="property-section">
              <h3>位置与尺寸<span>px</span></h3>
              <div class="geometry-grid">
                <label v-for="key in ['x', 'y', 'width', 'height'] as const" :key="key"
                  ><span>{{ { x: 'X', y: 'Y', width: 'W', height: 'H' }[key] }}</span
                  ><input
                    v-model.number="form[key]"
                    type="number"
                    :aria-label="`图形 ${key}`"
                    :disabled="editor.busy || geometryDisabled(key)"
                    @change="updateBounds"
                /></label>
              </div>
              <label v-if="selectedNode.type === 'swimlane'"
                >所属泳池<select
                  v-model="form.parentId"
                  aria-label="所属泳池"
                  :disabled="editor.busy"
                  @change="changeLanePool"
                >
                  <option v-for="pool in pools" :key="pool.id" :value="pool.id">
                    {{ doc.entities[pool.entityId].name }}
                  </option>
                </select></label
              ><label v-if="!registry.get(selectedNode.type).container"
                >所属泳道<select
                  v-model="form.parentId"
                  aria-label="所属泳道"
                  @change="changeParent"
                >
                  <option value="">画布</option>
                  <option v-for="lane in lanes" :key="lane.id" :value="lane.id">
                    {{ doc.entities[lane.entityId].name
                    }}{{
                      lane.parentId
                        ? ` · ${doc.entities[doc.nodes[lane.parentId].entityId].name}`
                        : ''
                    }}
                  </option>
                </select></label
              >
            </section>
            <section v-if="selectedNode.type === 'activity'" class="property-section">
              <h3>业务属性</h3>
              <label
                >活动类型<select
                  v-model="form.activityType"
                  aria-label="活动类型"
                  @change="
                    patchEntity({
                      activityType: form.activityType as BusinessEntity['activityType'],
                    })
                  "
                >
                  <option value="manual">人工线上</option>
                  <option value="offline">人工线下</option>
                  <option value="system">系统操作</option>
                  <option value="interface">接口对接</option>
                  <option value="linked">引用活动</option>
                </select></label
              ><label class="toggle-label"
                ><span>标记为关键活动</span
                ><input
                  v-model="form.critical"
                  type="checkbox"
                  aria-label="关键活动"
                  @change="patchEntity({ critical: form.critical })"
              /></label>
              <div class="io-fields">
                <label
                  >输入<textarea
                    v-model="form.inputs"
                    rows="2"
                    aria-label="活动输入"
                    placeholder="每行一个输入"
                    @change="patchEntity({ inputs: form.inputs.split('\n').filter(Boolean) })"
                  ></textarea></label
                ><label
                  >输出<textarea
                    v-model="form.outputs"
                    rows="2"
                    aria-label="活动输出"
                    placeholder="每行一个输出"
                    @change="patchEntity({ outputs: form.outputs.split('\n').filter(Boolean) })"
                  ></textarea>
                </label>
              </div>
            </section>
            <section v-if="selectedNode.type === 'swimlane'" class="property-section">
              <h3>角色信息</h3>
              <label v-if="remoteSession"
                >组织角色<select
                  v-model="form.roleIds"
                  multiple
                  aria-label="组织角色"
                  @change="assignLaneRoles([...form.roleIds])"
                >
                  <option
                    v-for="org in remoteSession.organizations"
                    :key="org.orgId"
                    :value="org.orgId"
                  >
                    {{ org.orgName }}
                  </option>
                </select></label
              ><label
                >角色说明<input
                  v-model="form.role"
                  aria-label="泳道角色"
                  @change="patchEntity({ role: form.role })"
              /></label>
              <p class="field-help">删除泳道会同时删除其中的节点和相关连线，可完整撤销。</p>
            </section>
            <section v-if="isPoolType(selectedNode.type)" class="property-section">
              <h3>
                泳池布局<span>{{ poolLanes(doc, selectedNode.id).length }} 条泳道</span>
              </h3>
              <div class="inspector-pool-actions">
                <button
                  class="button secondary"
                  :disabled="editor.busy"
                  @click="addLane(selectedNode.id)"
                >
                  <Plus :size="13" />添加泳道</button
                ><select
                  :value="selectedNode.type === 'pool-vertical' ? 'vertical' : 'horizontal'"
                  aria-label="泳池方向"
                  :disabled="editor.busy"
                  @change="
                    changePoolOrientation(
                      ($event.target as HTMLSelectElement).value as 'horizontal' | 'vertical',
                    )
                  "
                >
                  <option value="horizontal">水平 · 按行</option>
                  <option value="vertical">垂直 · 按列</option>
                </select>
              </div>
              <p class="field-help">选中泳道可调整高度或宽度，也可以移动到其他泳池。</p>
            </section>
            <section class="property-section">
              <h3>外观</h3>
              <div class="inspector-colors">
                <label
                  v-for="item in [
                    ['fill', '背景色', '#ffffff'],
                    ['headerFill', '标题背景', '#edf1f8'],
                    ['fontColor', '文字颜色', '#52637d'],
                  ] as const"
                  :key="item[0]"
                  ><input
                    type="color"
                    :aria-label="`图形${item[1]}`"
                    :value="selectedNode.appearance[item[0]] ?? item[2]"
                    :disabled="editor.busy"
                    @change="
                      run('修改外观', [
                        {
                          type: 'node.appearance',
                          id: selectedNode.id,
                          [item[0]]: ($event.target as HTMLInputElement).value,
                        },
                      ])
                    "
                  /><span>{{ item[1] }}</span></label
                >
              </div>
            </section>
            <div class="element-id">
              <span>NODE ID</span><code>{{ selectedNode.id }}</code>
            </div>
          </template>
          <template v-else-if="selectedEdge"
            ><div class="inspector-selection">
              <span class="selection-icon"><GitBranch :size="19" /></span>
              <div>
                <strong>流程连线</strong>
                <p>正交路由 · 固定端口</p>
              </div>
            </div>
            <section class="property-section">
              <h3>连线属性</h3>
              <label
                >标签<input v-model="form.name" aria-label="连线标签" @change="updateName" /></label
              ><label
                >起点<input
                  :value="doc.entities[doc.nodes[selectedEdge.source.nodeId].entityId].name"
                  readonly /></label
              ><label
                >终点<input
                  :value="doc.entities[doc.nodes[selectedEdge.target.nodeId].entityId].name"
                  readonly
              /></label>
            </section>
            <div class="element-id">
              <span>EDGE ID</span><code>{{ selectedEdge.id }}</code>
            </div></template
          >
          <template v-else-if="selection.length > 1"
            ><div class="empty-inspector">
              <Layers :size="28" />
              <h3>已选择 {{ selection.length }} 个元素</h3>
              <p>使用工具栏复制或删除，可通过撤销恢复整批操作。</p>
            </div></template
          >
          <template v-else>
            <div class="empty-inspector">
              <div class="empty-selection-art">
                <MousePointer2 :size="27" :stroke-width="1.2" /><span></span><i></i>
              </div>
              <h3>选择一个图形</h3>
              <p>在画布中选择图形，<br />查看并编辑它的属性。</p>
            </div>
            <section class="document-summary">
              <h3>画布信息</h3>
              <div>
                <span>文档</span><strong>{{ doc.title }}</strong>
              </div>
              <div>
                <span>图形节点</span><strong>{{ nodeCount }}</strong>
              </div>
              <div>
                <span>流程连线</span><strong>{{ Object.keys(doc.edges).length }}</strong>
              </div>
              <div>
                <span>当前版本</span><code>r{{ doc.revision }}</code>
              </div>
            </section>
            <div class="inspector-callout">
              <span class="callout-icon"><Layers :size="16" /></span>
              <h4>为业务而设计</h4>
              <p>活动、数据与视图各司其职。复杂图形，保持简单的编辑体验。</p>
            </div>
          </template>
          <StyleInspector
            v-if="styleNodes.length || styleEdges.length"
            :nodes="styleNodes"
            :edges="styleEdges"
            :busy="editor.busy"
            @change="changeStyle"
            @preset="changePreset"
          />
          <AlignmentInspector
            v-if="styleNodes.length"
            :count="styleNodes.length"
            :busy="editor.busy"
            :managed-lane="styleNodes.some((node) => isManagedLane(doc, node))"
            @align="alignSelection"
          />
          <section v-if="editor.activity.length" class="property-section activity-log">
            <h3>最近操作</h3>
            <div
              v-for="(entry, index) in editor.activity.slice(0, 5)"
              :key="`${entry.revision}-${index}`"
            >
              <span :class="['log-dot', { agent: entry.origin === 'agent' }]"></span
              ><span>{{ entry.label }}</span
              ><code>r{{ entry.revision }}</code>
            </div>
          </section>
        </div>
        <div v-else class="inspector-scroll agent-panel" role="tabpanel" aria-label="Agent">
          <div class="agent-intro">
            <span><Sparkles :size="20" /></span>
            <h3>让 Agent 读懂你的图</h3>
            <p>通过结构化命令编辑业务节点。<br />先查看变更，再应用到画布。</p>
            <span class="local-badge">{{
              remoteSession ? 'Coopwire 远程接口 · 未连接模型' : '本地接口实验台 · 未连接模型'
            }}</span>
          </div>
          <div class="agent-steps">
            <span>1. 读取文档</span><ChevronRight :size="11" /><span>2. 预览</span
            ><ChevronRight :size="11" /><span>3. 应用</span>
          </div>
          <button class="button secondary full-width" @click="prepareAgentExample">
            <FileJson :size="14" /> 生成命令示例
          </button>
          <label class="agent-label"
            >COMMAND JSON
            <button @click="showData = true">查看当前文档 <ArrowUpRight :size="11" /></button
          ></label>
          <textarea
            v-model="agentJson"
            class="code-editor"
            spellcheck="false"
            aria-label="Agent 命令 JSON"
            placeholder="点击生成命令示例，或粘贴结构化命令…"
          ></textarea>
          <button
            class="button secondary full-width"
            :disabled="editor.busy || !agentJson.trim()"
            @click="previewAgent"
          >
            <Search :size="14" /> 校验并预览
          </button>
          <div v-if="agentPreview" class="agent-preview">
            <h4>
              <Check :size="13" /> 校验通过
              <span>r{{ doc.revision }} → r{{ agentPreview.revision }}</span>
            </h4>
            <p>
              新增 {{ agentPreview.changes.added.length }} · 修改
              {{ agentPreview.changes.updated.length }} · 删除
              {{ agentPreview.changes.deleted.length }}
            </p>
            <pre>{{ JSON.stringify(agentPreview.changes, null, 2) }}</pre>
            <button class="button primary full-width" @click="applyAgent">
              应用到画布 <ArrowUpRight :size="14" />
            </button>
          </div>
          <p v-if="agentResult" class="agent-success"><Check :size="14" />{{ agentResult }}</p>
          <div class="agent-guarantees">
            <span><Check :size="12" /> 完整校验与原子提交</span
            ><span><Check :size="12" /> 版本冲突检测与请求去重</span
            ><span><Check :size="12" /> 共用撤销与重做</span>
          </div>
        </div>
        <div class="inspector-footer">
          <span class="engine-dot"></span>Powered by maxGraph<span>JSON v1</span>
        </div>
      </ResizableSidebar>
    </div>
    <footer class="status-bar">
      <span
        ><span class="online-dot"></span
        >{{ remoteSession ? 'Coopwire 远程流程' : '本地工作空间' }}</span
      ><span>{{ remoteSession ? remoteStatus.message : '所有更改保存在当前浏览器' }}</span>
      <div>
        <span>⌘ Z 撤销</span><span>⌘ D 复制</span><span>Delete 删除</span
        ><span class="schema-tag">SCHEMA 1.0</span>
      </div>
    </footer>
    <div
      v-if="
        remoteSession && (remoteStatus.state === 'failed' || remoteStatus.state === 'uncertain')
      "
      class="remote-recovery"
    >
      <span>{{ remoteStatus.message }}</span
      ><button
        v-if="editor.canRetryRemote && remoteStatus.state !== 'uncertain'"
        @click="retryRemote"
      >
        重试上次操作</button
      ><button @click="recoveryConfirm = true">读取远端核对</button>
    </div>
    <div v-if="error" class="error-toast" role="alert">
      <span>{{ error }}</span
      ><button aria-label="关闭错误" @click="error = ''"><X :size="15" /></button>
    </div>
    <div
      v-if="linkedChooserOpen && remoteSession"
      class="modal-backdrop"
      @click.self="linkedChooserOpen = false"
    >
      <EmbeddedLinkedChooser
        :config="remoteSession.api.config"
        :origin="portraitOrigin"
        @chosen="onLinkedChosen"
        @close="linkedChooserOpen = false"
      />
      <button
        class="modal-close"
        aria-label="关闭引用活动选择器"
        @click="linkedChooserOpen = false"
      >
        <X :size="16" />
      </button>
    </div>
    <div v-if="showData" class="modal-backdrop" @click.self="showData = false">
      <section class="data-modal">
        <header>
          <div>
            <h2>结构化文档</h2>
            <p>业务数据是唯一数据源，内部绘制部件不参与存储。</p>
          </div>
          <button aria-label="关闭文档数据" @click="showData = false"><X :size="18" /></button>
        </header>
        <pre data-testid="document-json">{{ JSON.stringify(doc, null, 2) }}</pre>
        <footer>
          <span>{{ nodeCount }} 个业务节点 · revision {{ doc.revision }}</span>
          <div class="document-file-actions">
            <button
              class="button secondary"
              :disabled="!!remoteSession || editor.busy || exporting"
              :title="remoteSession ? '请先断开远程连接，再导入其他文档' : '导入 JSON 或 XML'"
              @click="fileInput?.click()"
            >
              <ArrowUpFromLine :size="14" />导入
            </button>
            <select v-model="exportFormat" aria-label="导出格式" :disabled="exporting">
              <option value="json">JSON</option>
              <option value="xml">XML</option>
              <option value="png">PNG 图片</option>
            </select>
            <button class="button primary" :disabled="exporting || editor.busy" @click="exportFile">
              <ArrowDownToLine :size="14" />{{
                exporting ? '正在导出…' : `导出 ${exportFormat.toUpperCase()}`
              }}
            </button>
          </div>
        </footer>
      </section>
    </div>
    <div v-if="showReset" class="modal-backdrop" @click.self="showReset = null">
      <section class="confirm-modal">
        <FolderOpen :size="26" />
        <h2>{{ showReset === 'sample' ? '打开订单履约示例' : '新建空白画布' }}</h2>
        <p>这会替换当前本机画布。你可以先导出当前文档，保留一份备份。</p>
        <div>
          <button
            class="button secondary"
            @click="
              showReset = null;
              showData = true;
            "
          >
            导出当前文档</button
          ><button
            class="button primary"
            @click="
              replaceDocument(showReset === 'sample' ? demoDocument() : emptyDocument());
              showReset = null;
            "
          >
            {{ showReset === 'sample' ? '打开示例' : '新建画布' }}
          </button>
        </div>
        <button class="modal-close" aria-label="取消替换画布" @click="showReset = null">
          <X :size="16" />
        </button>
      </section>
    </div>
    <div
      v-if="laneDeletion && doc.nodes[laneDeletion.laneId]"
      class="modal-backdrop"
      @click.self="!editor.busy && (laneDeletion = undefined)"
    >
      <section class="confirm-modal">
        <h2>删除泳道</h2>
        <p>
          将删除「{{ doc.entities[doc.nodes[laneDeletion.laneId].entityId].name }}」及其中的
          {{ childrenOf(doc, laneDeletion.laneId).length }}
          个节点和相关连线。可以完整撤销；远程业务活动本身会保留。
        </p>
        <button
          class="button primary full-width"
          :disabled="editor.busy"
          aria-label="确认删除泳道"
          @click="removeLane"
        >
          确认删除泳道</button
        ><button
          class="modal-close"
          aria-label="取消删除泳道"
          :disabled="editor.busy"
          @click="laneDeletion = undefined"
        >
          <X :size="16" />
        </button>
      </section>
    </div>
    <div
      v-if="connectionOpen"
      class="modal-backdrop"
      @click.self="!connecting && (connectionOpen = false)"
    >
      <section class="connection-modal">
        <header>
          <h2>连接 Coopwire 后端</h2>
          <button
            :disabled="connecting || editor.busy"
            aria-label="关闭远程配置"
            @click="connectionOpen = false"
          >
            <X :size="17" />
          </button>
        </header>
        <p>连接时只读取远端流程；后续编辑会提交到该流程。本机画布另行保留。</p>
        <label
          >业务详情前端地址<input
            v-model="portraitOrigin"
            aria-label="业务详情前端地址"
            placeholder="留空使用本页域名"
        /></label>
        <template v-if="!remoteSession"
          ><label
            >接口地址<input
              v-model="remoteConfig.baseUrl"
              aria-label="远程接口地址"
              placeholder="留空使用同域 /rest 或开发代理" /></label
          ><label
            >Project ID<input v-model="remoteConfig.projectId" aria-label="远程项目 ID" /></label
          ><label
            >Flowchart ID<input
              v-model="remoteConfig.flowchartId"
              aria-label="远程流程 ID" /></label
          ><label
            >Flowchart Type<input v-model="remoteConfig.flowchartType" aria-label="远程流程类型"
          /></label>
          <p class="field-help">同域使用 Cookie。跨域开发请使用本机代理，Cookie 仅由服务端持有。</p>
          <button class="button primary full-width" :disabled="connecting" @click="connectRemote">
            {{ connecting ? '正在读取…' : '连接并读取流程' }}
          </button></template
        >
        <template v-else
          ><div class="remote-details">
            <strong>{{ remoteStatus.message }}</strong>
            <p v-for="warning in remoteSession.warnings" :key="warning">{{ warning }}</p>
          </div>
          <div class="connection-actions">
            <button
              v-if="remoteSession.legacySource"
              class="button secondary"
              @click="downloadLegacyXml"
            >
              下载原始 XML</button
            ><button
              class="button secondary"
              :disabled="editor.busy || connecting"
              @click="recoveryConfirm = true"
            >
              重新读取远端</button
            ><button class="button secondary" :disabled="editor.busy" @click="disconnectRemote">
              断开并返回本机
            </button>
          </div></template
        >
      </section>
    </div>
    <div
      v-if="recoveryConfirm"
      class="modal-backdrop"
      @click.self="!connecting && (recoveryConfirm = false)"
    >
      <section class="confirm-modal">
        <h2>读取远端并核对</h2>
        <p>
          将以服务器当前状态重新打开流程，结束本次未完成事务。已确认的业务写入仍保留在服务器；待处理记录会在本机保留恢复备份。
        </p>
        <button class="button primary full-width" :disabled="connecting" @click="reloadRemote">
          {{ connecting ? '正在读取…' : '重新读取远端' }}</button
        ><button
          class="modal-close"
          aria-label="取消远端核对"
          :disabled="connecting"
          @click="recoveryConfirm = false"
        >
          <X :size="16" />
        </button>
      </section>
    </div>
  </div>
</template>
