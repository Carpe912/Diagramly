import {
  BaseGraph,
  ArrowConnectorShape,
  Cell,
  CellEditorHandler,
  ConnectionConstraint,
  ConnectionHandler,
  ConnectorShape,
  EdgeMarker,
  EdgeMarkerRegistry,
  EllipseShape,
  FitPlugin,
  Geometry,
  HandleConfig,
  ImageBox,
  InternalEvent,
  VertexHandler,
  VertexHandlerConfig,
  PanningHandler,
  Perimeter,
  PerimeterRegistry,
  Point,
  RectangleShape,
  RhombusShape,
  RubberBandHandler,
  SelectionCellsHandler,
  SelectionHandler,
  ShapeRegistry as EngineShapes,
  registerOrthogonalEdgeStyle,
  registerElbowEdgeStyle,
  registerEntityRelationEdgeStyle,
  type CellStyle,
  type EventSource,
  type InternalMouseEvent,
} from '@maxgraph/core';
import '@maxgraph/core/css/common.css';
import { isManagedLane, nodeDepth, poolOf } from '../../domain/pools';
import { nodePresentation } from '../../shapes/presentation';
import {
  edgeLineAppearance,
  edgePortOffsets,
  edgeRenderStyle,
  nodeLineAppearance,
  strokeStyle,
} from '../../shapes/styles';
import { lineJumps } from '../../domain/lineJumps';
import { JumpConnectorShape, LinkLineShape, SimpleArrowShape } from './lineShapes';
import type { Editor } from '../../application/editor';
import type { Operation } from '../../application/commands';
import { MAX_ZOOM, MIN_ZOOM, zoomViewport } from './viewport';
import {
  defaultCanvasSettings,
  newId,
  type DiagramDocument,
  type DiagramNode,
  type Endpoint,
} from '../../domain/model';

function registerEngineFeatures() {
  EngineShapes.add('rectangle', RectangleShape);
  EngineShapes.add('ellipse', EllipseShape);
  EngineShapes.add('rhombus', RhombusShape);
  EngineShapes.add('connector', ConnectorShape);
  EngineShapes.add('diagramlyConnector', JumpConnectorShape);
  EngineShapes.add('diagramlyLink', LinkLineShape);
  EngineShapes.add('arrowConnector', ArrowConnectorShape);
  EngineShapes.add('diagramlyArrow', SimpleArrowShape);
  PerimeterRegistry.add('rectanglePerimeter', Perimeter.RectanglePerimeter);
  PerimeterRegistry.add('ellipsePerimeter', Perimeter.EllipsePerimeter);
  PerimeterRegistry.add('rhombusPerimeter', Perimeter.RhombusPerimeter);
  EdgeMarkerRegistry.add('block', EdgeMarker.createArrow(2));
  for (const type of ['classic', 'classicThin', 'blockThin'])
    EdgeMarkerRegistry.add(type, EdgeMarker.createArrow(type.endsWith('Thin') ? 3 : 2));
  EdgeMarkerRegistry.add('open', EdgeMarker.createOpenArrow(2));
  EdgeMarkerRegistry.add('openThin', EdgeMarker.createOpenArrow(3));
  EdgeMarkerRegistry.add('oval', EdgeMarker.oval);
  EdgeMarkerRegistry.add('diamond', EdgeMarker.diamond);
  EdgeMarkerRegistry.add('diamondThin', EdgeMarker.diamond);
  registerOrthogonalEdgeStyle();
  registerElbowEdgeStyle();
  registerEntityRelationEdgeStyle();
  HandleConfig.fillColor = '#ffffff';
  HandleConfig.strokeColor = '#7d91b7';
  VertexHandlerConfig.selectionColor = '#7d91b7';
  VertexHandlerConfig.selectionDashed = false;
}
interface CanvasCallbacks {
  select: (ids: string[]) => void;
  error: (error: unknown) => void;
  zoom: (scale: number) => void;
  viewport?: () => void;
}
/** 当前引擎会忽略单轴平移；在实例插件中补齐提交，保留原有手势和结束事件。 */
class ViewportPanningHandler extends PanningHandler {
  override mouseUp(sender: EventSource, event: InternalMouseEvent) {
    if (this.active && ((this.dx !== 0 && this.dy === 0) || (this.dx === 0 && this.dy !== 0))) {
      const { scale, translate } = this.graph.view;
      this.graph.panGraph(0, 0);
      this.panGraph(translate.x + this.dx / scale, translate.y + this.dy / scale);
      this.dx = 0;
      this.dy = 0;
      event.consume();
    }
    super.mouseUp(sender, event);
  }
}
/** 泳道起点由泳池管理，从右侧和底部缩放时不移动内部节点。 */
class LaneVertexHandler extends VertexHandler {
  override isSizerVisible(index: number) {
    return [4, 6, 7].includes(index);
  }
  override createSizer(cursor: string, index: number, size?: number, fillColor?: string) {
    const shape = super.createSizer(cursor, index, size, fillColor);
    shape.node?.setAttribute('data-lane-resize', `${this.state.cell.id}:${index}`);
    return shape;
  }
}
/** 统一管理 maxGraph；Cell 仅作视图投影，文档只能通过应用命令修改。 */
export class DiagramCanvas {
  readonly graph: BaseGraph;
  private rendering = false;
  private unsubscribe: () => void;
  private cells = new Map<string, Cell>();
  private projectionIds = new Map<string, string>();
  private partSignatures = new Map<string, string>();
  private disposed = false;
  private spacePressed = false;
  private updatingJumps = false;
  constructor(
    private container: HTMLElement,
    private editor: Editor,
    private callbacks: CanvasCallbacks,
    private interactionSurface: HTMLElement = container,
  ) {
    registerEngineFeatures();
    InternalEvent.disableContextMenu(container);
    const graph = (this.graph = new BaseGraph({
      container,
      plugins: [
        CellEditorHandler,
        SelectionCellsHandler,
        ConnectionHandler,
        SelectionHandler,
        ViewportPanningHandler,
        RubberBandHandler,
        FitPlugin,
      ],
    }));
    graph.view.setAllowEval(false);
    graph.setHtmlLabels(false);
    graph.setPanning(true);
    graph.useScrollbarsForPanning = false;
    graph.autoScroll = false;
    graph.ignoreScrollbars = true;
    const panning = graph.getPlugin<PanningHandler>('PanningHandler')!;
    panning.useLeftButtonForPanning = true;
    panning.minScale = MIN_ZOOM;
    panning.maxScale = MAX_ZOOM;
    const forcePanning = panning.isForcePanningEvent.bind(panning);
    panning.isForcePanningEvent = (event) => {
      const native = event.getEvent();
      return (
        native.button === 1 || (this.spacePressed && native.button === 0) || forcePanning(event)
      );
    };
    const panningTrigger = panning.isPanningTrigger.bind(panning);
    panning.isPanningTrigger = (event) => {
      const native = event.getEvent();
      if (
        native.button === 0 &&
        (native.shiftKey || native.altKey) &&
        !native.ctrlKey &&
        !this.spacePressed &&
        !panning.ignoreCell
      )
        return false;
      return panningTrigger(event);
    };
    panning.addListener(InternalEvent.PAN_START, () => container.classList.add('is-panning'));
    panning.addListener(InternalEvent.PAN_END, () => container.classList.remove('is-panning'));
    graph.addListener(InternalEvent.PAN, () => callbacks.viewport?.());
    graph.setConnectable(true);
    graph.setAllowDanglingEdges(false);
    graph.setCellsEditable(true);
    graph.setCellsCloneable(false);
    graph.setCellsDisconnectable(false);
    graph.setDropEnabled(false);
    graph.setExtendParents(false);
    graph.setConstrainChildren(false);
    graph.setAutoSizeCells(false);
    graph.gridSize = 10;
    graph.keepEdgesInForeground = true;
    graph.isFoldingEnabled = () => false;
    graph.isCellFoldable = () => false;
    graph.recursiveResize = false;
    graph.setResizeContainer(false);
    const validateView = graph.view.validate.bind(graph.view);
    graph.view.validate = (...args) => {
      validateView(...args);
      this.updateLineJumps();
    };
    const createShape = graph.cellRenderer.createShape.bind(graph.cellRenderer);
    graph.cellRenderer.createShape = (state) => {
      const shape = createShape(state);
      if (this.projectionIds.has(state.cell.id ?? '')) {
        shape.pointerEvents = false;
        shape.svgPointerEvents = 'none';
      }
      return shape;
    };
    const initializeLabel = graph.cellRenderer.initializeLabel.bind(graph.cellRenderer);
    graph.cellRenderer.initializeLabel = (state, shape) => {
      if (this.projectionIds.has(state.cell.id ?? '')) shape.pointerEvents = false;
      initializeLabel(state, shape);
    };
    const select = graph.getPlugin<SelectionHandler>('SelectionHandler')!;
    select.removeCellsFromParent = false;
    select.getInitialCellForEvent = (event) => this.ownerCell(event.getCell());
    graph.isCellSelectable = (cell) => this.cells.has(cell.id ?? '');
    graph.isCellMovable = (cell) => this.canMove(cell.id ?? '');
    graph.isCellResizable = (cell) =>
      this.cells.has(cell.id ?? '') && !!this.editor.snapshot.nodes[cell.id ?? ''];
    graph
      .getPlugin<SelectionCellsHandler>('SelectionCellsHandler')!
      .setVertexHandlerFactory((state) =>
        isManagedLane(this.editor.snapshot, this.editor.snapshot.nodes[state.cell.id ?? ''])
          ? new LaneVertexHandler(state)
          : new VertexHandler(state),
      );
    graph.isCellBendable = () => false;
    graph.isCellEditable = (cell) => {
      const owner = this.ownerCell(cell);
      return !!owner && this.editor.snapshot.nodes[owner.id ?? '']?.type !== 'swimlane';
    };
    // 使用实例级公开扩展点，不修改引擎原型。
    graph.labelChanged = (cell, value) => {
      const owner = this.ownerCell(cell),
        id = owner?.id;
      if (id && this.editor.snapshot.nodes[id]?.type === 'swimlane') return cell;
      if (id)
        this.commit('编辑名称', [
          this.editor.snapshot.edges[id]
            ? { type: 'edge.update', id, patch: { label: String(value) } }
            : { type: 'node.update', id, patch: { name: String(value) } },
        ]);
      return cell;
    };
    graph.getEditingValue = (cell) => {
      const id = this.ownerCell(cell)?.id ?? '',
        node = this.editor.snapshot.nodes[id];
      return node
        ? this.editor.snapshot.entities[node.entityId].name
        : (this.editor.snapshot.edges[id]?.label ?? '');
    };
    graph.getAllConnectionConstraints = (state, source) => {
      const id = this.ownerCell(state?.cell ?? null)?.id ?? '',
        node = this.editor.snapshot.nodes[id];
      if (!node) return null;
      return editor.registry
        .get(node.type)
        .ports.filter((p) => (source ? p.direction !== 'input' : p.direction !== 'output'))
        .map((p) => new ConnectionConstraint(new Point(p.x, p.y), false, p.id));
    };
    const connection = graph.getPlugin<ConnectionHandler>('ConnectionHandler')!;
    connection.constraintHandler.pointImage = new ImageBox(
      `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"><circle cx="4.5" cy="4.5" r="3.5" fill="white" stroke="#7189b9" stroke-width="1.5"/></svg>')}`,
      9,
      9,
    );
    connection.constraintHandler.highlightColor = '#8a9fc4';
    connection.marker.validColor = '#8a9fc4';
    connection.marker.invalidColor = '#c2857c';
    // 连接处理先于选中处理，仅允许从端口发起连线。
    connection.isStartEvent = () =>
      !!connection.constraintHandler.currentFocus &&
      !!connection.constraintHandler.currentConstraint;
    connection.isConnectableCell = (cell) => {
      const node = this.editor.snapshot.nodes[cell.id ?? ''];
      return !!node && this.editor.registry.get(node.type).ports.length > 0;
    };
    connection.connect = (source, target) => {
      const a = this.ownerCell(source)?.id,
        b = this.ownerCell(target)?.id;
      if (!a || !b) return;
      const port = (id: string, sourceEnd: boolean, requested?: string | null): Endpoint => {
        const definition = this.editor.registry.get(this.editor.snapshot.nodes[id].type);
        const ports = definition.ports.filter((p) =>
          sourceEnd ? p.direction !== 'input' : p.direction !== 'output',
        );
        const fallback = ports.find((p) => p.id === (sourceEnd ? 'right' : 'left')) ?? ports[0];
        const selected = ports.find((p) => p.id === requested) ?? fallback;
        if (!selected) throw new Error('该节点没有可连接的端口');
        return { nodeId: id, portId: selected.id };
      };
      try {
        this.commit('连接节点', [
          {
            type: 'edge.create',
            edge: {
              id: newId('edge'),
              label: '',
              source: port(a, true, connection.sourceConstraint?.name),
              target: port(b, false, connection.constraintHandler.currentConstraint?.name),
            },
          },
        ]);
      } catch (error) {
        callbacks.error(error);
      }
    };
    graph.getSelectionModel().addListener(InternalEvent.CHANGE, () => {
      if (!this.rendering)
        callbacks.select(
          graph
            .getSelectionCells()
            .map((c) => this.ownerCell(c)?.id)
            .filter((id): id is string => !!id),
        );
    });
    const geometryChanged = (_sender: unknown, event: { getProperty: <T>(key: string) => T }) => {
      if (this.rendering) return;
      const cells = event.getProperty<Cell[]>('cells') ?? [],
        operations: Operation[] = [];
      for (const cell of cells) {
        const node = this.editor.snapshot.nodes[cell.id ?? ''],
          g = cell.getGeometry();
        if (node && g) {
          if (isManagedLane(this.editor.snapshot, node)) {
            const vertical = poolOf(this.editor.snapshot, node)?.type === 'pool-vertical';
            operations.push({
              type: 'pool.lane.resize',
              laneId: node.id,
              extent: vertical ? g.width : g.height,
              crossExtent: vertical ? g.height : g.width,
            });
          } else
            operations.push({
              type: 'node.resize',
              id: node.id,
              bounds: { x: g.x, y: g.y, width: g.width, height: g.height },
            });
        }
      }
      if (operations.length) this.commit('调整图形', operations);
    };
    graph.addListener(InternalEvent.CELLS_MOVED, geometryChanged);
    graph.addListener(InternalEvent.CELLS_RESIZED, geometryChanged);
    for (const event of [
      InternalEvent.SCALE,
      InternalEvent.SCALE_AND_TRANSLATE,
      InternalEvent.TRANSLATE,
    ])
      graph.view.addListener(event, () => {
        callbacks.zoom(graph.view.scale);
        callbacks.viewport?.();
      });
    this.unsubscribe = editor.subscribe(() => this.render());
    this.interactionSurface.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseSpace);
    this.render();
  }
  private ownerCell(cell: Cell | null): Cell | null {
    if (!cell) return null;
    const owner = this.projectionIds.get(cell.id ?? '') ?? cell.id;
    return owner ? (this.cells.get(owner) ?? null) : null;
  }
  private async commit(label: string, operations: Operation[]) {
    try {
      await this.editor.dispatchAsync(label, operations);
    } catch (error) {
      this.render();
      this.callbacks.error(error);
    }
  }
  render() {
    if (this.disposed) return;
    const doc = this.editor.snapshot,
      graph = this.graph,
      model = graph.getDataModel();
    const settings = doc.canvas ?? defaultCanvasSettings;
    graph.gridSize = settings.gridSize;
    graph.setGridEnabled(settings.grid);
    graph.setEnabled(!this.editor.busy);
    const selected = graph
      .getSelectionCells()
      .map((c) => this.ownerCell(c)?.id)
      .filter((id): id is string => !!id);
    this.rendering = true;
    try {
      graph.batchUpdate(() => {
        for (const [id, cell] of this.cells) {
          if (!doc.nodes[id] && !doc.edges[id]) {
            model.remove(cell);
            this.cells.delete(id);
            this.partSignatures.delete(id);
            for (const [partId, owner] of this.projectionIds)
              if (owner === id) this.projectionIds.delete(partId);
          }
        }
        const nodes = Object.values(doc.nodes).sort(
          (a, b) => nodeDepth(doc, a) - nodeDepth(doc, b),
        );
        for (const node of nodes) this.renderNode(node, doc);
        for (const edge of Object.values(doc.edges)) {
          let cell = this.cells.get(edge.id);
          if (!cell) {
            cell = graph.insertEdge({
              id: edge.id,
              source: this.cells.get(edge.source.nodeId),
              target: this.cells.get(edge.target.nodeId),
              value: edge.label,
            });
            this.cells.set(edge.id, cell);
          }
          model.setValue(cell, edge.label);
          model.setTerminals(
            cell,
            this.cells.get(edge.source.nodeId)!,
            this.cells.get(edge.target.nodeId)!,
          );
          const sourcePort = this.editor.registry
            .get(doc.nodes[edge.source.nodeId].type)
            .ports.find((p) => p.id === edge.source.portId)!;
          const targetPort = this.editor.registry
            .get(doc.nodes[edge.target.nodeId].type)
            .ports.find((p) => p.id === edge.target.portId)!;
          model.setStyle(cell, {
            ...edgeRenderStyle(edge),
            ...edgePortOffsets(edge, sourcePort, targetPort),
            fontColor: '#7a8292',
            fontSize: 11,
            labelBackgroundColor: '#ffffff',
            exitX: sourcePort.x,
            exitY: sourcePort.y,
            entryX: targetPort.x,
            entryY: targetPort.y,
            exitPerimeter: false,
            entryPerimeter: false,
            editable: true,
            bendable: false,
            movable: false,
            sourcePort: undefined,
            targetPort: undefined,
          });
        }
        graph.setSelectionCells(
          selected.flatMap((id) => (this.cells.has(id) ? [this.cells.get(id)!] : [])),
        );
      });
      // DOM 标记仅用于视图定位，不暴露业务数据。
      for (const [partId, ownerId] of this.projectionIds) {
        const cell = model.getCell(partId),
          state = cell ? graph.view.getState(cell) : undefined;
        for (const element of [state?.shape?.node, state?.text?.node]) {
          element?.setAttribute('data-part-id', partId);
          element?.setAttribute('data-owner-id', ownerId);
        }
      }
      for (const [id, cell] of this.cells) {
        const state = graph.view.getState(cell);
        state?.shape?.node?.setAttribute('data-element-id', id);
        state?.text?.node?.setAttribute('data-element-id', id);
      }
    } finally {
      this.rendering = false;
      this.callbacks.viewport?.();
    }
  }
  private renderNode(node: DiagramNode, doc: DiagramDocument) {
    const graph = this.graph,
      model = graph.getDataModel(),
      definition = this.editor.registry.get(node.type);
    const entity = doc.entities[node.entityId],
      b = node.bounds,
      presentation = nodePresentation(doc, node, this.editor.registry);
    const parent = node.parentId ? this.cells.get(node.parentId)! : graph.getDefaultParent();
    const style: CellStyle = {
      shape: definition.primitive,
      perimeter: `${definition.primitive}Perimeter`,
      fillColor: presentation.fill,
      ...strokeStyle(nodeLineAppearance(node)),
      arcSize: 8,
      fontSize: 12,
      fontColor: presentation.fontColor,
      fontFamily: 'Inter, PingFang SC, sans-serif',
      whiteSpace: 'wrap',
      overflow: 'hidden',
      shadow: false,
      resizable: true,
    };
    let cell = this.cells.get(node.id);
    if (!cell) {
      cell = graph.insertVertex({
        parent,
        id: node.id,
        position: [b.x, b.y],
        size: [b.width, b.height],
        value: '',
        style,
      });
      this.cells.set(node.id, cell);
    } else {
      if (cell.getParent() !== parent) model.add(parent, cell);
      model.setGeometry(cell, new Geometry(b.x, b.y, b.width, b.height));
      model.setStyle(cell, style);
    }
    cell.setConnectable(definition.ports.length > 0);
    const parts = presentation.parts;
    model.setValue(cell, parts.length ? '' : entity.name);
    const signature = JSON.stringify([parts, node.appearance.opacity ?? 100]);
    if (this.partSignatures.get(node.id) !== signature) {
      for (const child of [...cell.getChildren()]) {
        if (this.projectionIds.has(child.id ?? '')) {
          this.projectionIds.delete(child.id!);
          model.remove(child);
        }
      }
      for (const part of parts) {
        const partId = `${node.id}::${part.key}`;
        const child = graph.insertVertex({
          parent: cell,
          id: partId,
          position: [part.bounds.x, part.bounds.y],
          size: [part.bounds.width, part.bounds.height],
          value: part.text,
          style: {
            shape: part.primitive,
            fillColor: part.fill,
            strokeColor: part.stroke ?? 'none',
            fontColor: part.color ?? '#334155',
            fontSize: part.fontSize ?? 12,
            fontStyle: part.bold ? 1 : 0,
            horizontal: !part.vertical,
            align: part.align ?? 'center',
            spacingLeft: part.align === 'left' ? 12 : 0,
            whiteSpace: 'wrap',
            overflow: 'hidden',
            pointerEvents: false,
            movable: false,
            resizable: false,
            editable: false,
            deletable: false,
            opacity: node.appearance.opacity ?? 100,
            textOpacity: node.appearance.opacity ?? 100,
          },
        });
        child.setConnectable(false);
        this.projectionIds.set(partId, node.id);
      }
      this.partSignatures.set(node.id, signature);
    }
  }
  canMove(id: string) {
    const node = this.editor.snapshot.nodes[id];
    return !!node && !isManagedLane(this.editor.snapshot, node);
  }
  private updateLineJumps() {
    if (this.updatingJumps || this.disposed) return;
    this.updatingJumps = true;
    try {
      const routed = Object.values(this.editor.snapshot.edges).map((edge) => {
        const state = this.graph.view.getState(this.cells.get(edge.id)!),
          a = edgeLineAppearance(edge);
        return {
          id: edge.id,
          points: (state?.absolutePoints ?? [])
            .filter((p) => !!p)
            .map((p) => ({ x: p!.x / this.graph.view.scale, y: p!.y / this.graph.view.scale })),
          jump: a.shape === 'line' && a.corner !== 'curved' && a.jumpStyle !== 'none',
          visible: a.strokeEnabled && a.opacity > 0 && a.corner !== 'curved',
        };
      });
      const jumps = lineJumps(routed);
      for (const line of routed) {
        const state = this.graph.view.getState(this.cells.get(line.id)!);
        const shape = state?.shape;
        if (!(shape instanceof JumpConnectorShape)) continue;
        const points = jumps.get(line.id) ?? [],
          signature = JSON.stringify(points);
        if (shape.jumpSignature !== signature) {
          shape.jumpPoints = points;
          shape.jumpSignature = signature;
          this.graph.cellRenderer.redraw(state!, true);
        }
        shape.node?.setAttribute('data-line-jumps', String(points.length));
      }
    } finally {
      this.updatingJumps = false;
    }
  }
  bounds(id: string) {
    const cell = this.cells.get(id),
      state = cell ? this.graph.view.getState(cell) : undefined;
    return state
      ? {
          x: state.x + this.graph.getPanDx(),
          y: state.y + this.graph.getPanDy(),
          width: state.width,
          height: state.height,
        }
      : undefined;
  }
  select(ids: string[]) {
    this.graph.setSelectionCells(
      ids.flatMap((id) => (this.cells.has(id) ? [this.cells.get(id)!] : [])),
    );
  }
  pointForEvent(event: MouseEvent) {
    return this.graph.getPointForEvent(event, false);
  }
  zoom(direction: number) {
    this.zoomAt(
      this.graph.view.scale * Math.pow(1.2, direction),
      this.container.clientWidth / 2,
      this.container.clientHeight / 2,
    );
  }
  private zoomAt(scale: number, x: number, y: number) {
    const view = this.graph.view;
    const next = zoomViewport(
      { scale: view.scale, x: view.translate.x, y: view.translate.y },
      scale,
      { x, y },
    );
    if (next.scale !== view.scale) view.scaleAndTranslate(next.scale, next.x, next.y);
  }
  private panBy(x: number, y: number) {
    const { scale, translate } = this.graph.view;
    this.graph.view.setTranslate(translate.x + x / scale, translate.y + y / scale);
  }
  private onWheel = (event: WheelEvent) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        'button, input, textarea, select, details, [role="toolbar"], [role="tablist"], .mxCellEditor',
      )
    )
      return;
    if (this.graph.isEditing() || this.graph.getPlugin<PanningHandler>('PanningHandler')?.active)
      return;
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.container.clientHeight : 1;
    const dx = event.deltaX * unit,
      dy = event.deltaY * unit;
    if (!dx && !dy) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) this.panBy(-(dx || dy), 0);
    else if (!event.ctrlKey && !event.metaKey && Math.abs(dx) > Math.abs(dy)) this.panBy(-dx, -dy);
    else {
      const rect = this.container.getBoundingClientRect();
      this.zoomAt(
        this.graph.view.scale * Math.exp(Math.max(-4, Math.min(4, -dy * 0.002))),
        Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
        Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      );
    }
  };
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || this.graph.isEditing()) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        'input, textarea, select, button, summary, [contenteditable="true"], [role="separator"]',
      )
    )
      return;
    if (
      !this.interactionSurface.matches(':hover') &&
      !this.container.contains(document.activeElement)
    )
      return;
    event.preventDefault();
    this.spacePressed = true;
    this.container.classList.add('space-panning');
  };
  private releaseSpace = () => {
    this.spacePressed = false;
    this.container.classList.remove('space-panning');
  };
  private onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') this.releaseSpace();
  };
  fit() {
    this.graph.getPlugin<FitPlugin>('fit')?.fitCenter({ margin: 65 });
  }
  destroy() {
    this.disposed = true;
    this.unsubscribe();
    this.releaseSpace();
    this.container.classList.remove('is-panning');
    this.interactionSurface.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseSpace);
    this.graph.destroy();
    this.container.replaceChildren();
  }
}
