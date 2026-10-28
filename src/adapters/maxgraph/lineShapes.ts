import {
  ArrowConnectorShape,
  ArrowShape,
  ConnectorShape,
  Point,
  type AbstractCanvas2D,
  type CellState,
  type Rectangle,
} from '@maxgraph/core';
import type { RoutePoint } from '../../domain/lineJumps';
/** 跨线是视图派生数据，文档只保存跨线样式和尺寸。 */
export class JumpConnectorShape extends ConnectorShape {
  jumpPoints: RoutePoint[] = [];
  jumpSignature = '';
  private get jumps() {
    return this.style as typeof this.style & { jumpStyle?: string; jumpSize?: number };
  }
  override paintLine(canvas: AbstractCanvas2D, points: Point[], rounded: boolean) {
    const mode = this.jumps?.jumpStyle ?? 'none',
      radius = Number(this.jumps?.jumpSize ?? 6) / 2;
    if (mode === 'none' || !this.jumpPoints.length) {
      super.paintLine(canvas, points, rounded);
      return;
    }
    canvas.begin();
    let buffer = [points[0]],
      initial = true;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      const ux = (b.x - a.x) / length,
        uy = (b.y - a.y) / length;
      const hits = this.jumpPoints
        .map((p) => ({
          distance: (p.x - a.x) * ux + (p.y - a.y) * uy,
          offset: Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux),
        }))
        .filter(
          (p) =>
            p.offset < 0.01 &&
            p.distance > radius + this.strokeWidth &&
            p.distance < length - radius - this.strokeWidth,
        )
        .sort((a, b) => a.distance - b.distance);
      let previous = -Infinity;
      for (const hit of hits) {
        if (hit.distance - previous < radius * 2 + 2) continue;
        previous = hit.distance;
        const entry = new Point(
            a.x + ux * (hit.distance - radius),
            a.y + uy * (hit.distance - radius),
          ),
          exit = new Point(a.x + ux * (hit.distance + radius), a.y + uy * (hit.distance + radius));
        buffer.push(entry);
        this.addPoints(canvas, buffer, rounded, this.getBaseArcSize(), false, undefined, initial);
        initial = false;
        let nx = uy,
          ny = -ux;
        if (ny > 0 || (ny === 0 && nx < 0)) {
          nx = -nx;
          ny = -ny;
        }
        if (mode === 'gap') canvas.moveTo(exit.x, exit.y);
        else if (mode === 'sharp') {
          canvas.lineTo(entry.x + nx * radius, entry.y + ny * radius);
          canvas.lineTo(exit.x + nx * radius, exit.y + ny * radius);
          canvas.lineTo(exit.x, exit.y);
        } else
          canvas.curveTo(
            entry.x + nx * radius * 1.33,
            entry.y + ny * radius * 1.33,
            exit.x + nx * radius * 1.33,
            exit.y + ny * radius * 1.33,
            exit.x,
            exit.y,
          );
        buffer = [exit];
      }
      buffer.push(b);
    }
    this.addPoints(canvas, buffer, rounded, this.getBaseArcSize(), false, undefined, initial);
    canvas.stroke();
  }
  override augmentBoundingBox(bounds: Rectangle) {
    super.augmentBoundingBox(bounds);
    if (this.jumps?.jumpStyle && this.jumps.jumpStyle !== 'none')
      bounds.grow((Number(this.jumps.jumpSize ?? 6) / 2) * this.scale);
  }
}
export class LinkLineShape extends ArrowConnectorShape {
  override isOpenEnded() {
    return true;
  }
  override isMarkerStart() {
    return false;
  }
  override isMarkerEnd() {
    return false;
  }
}
export class SimpleArrowShape extends ArrowShape {
  override augmentBoundingBox(bounds: Rectangle) {
    super.augmentBoundingBox(bounds);
    if (!this.points?.length) return;
    const first = this.points[0],
      last = this.points[this.points.length - 1];
    if (!first || !last) return;
    const length = Math.hypot(last.x - first.x, last.y - first.y) / this.scale;
    const head = Math.min(this.endSize * 3, length / 2);
    bounds.grow((Math.max(0, head - Math.max(this.arrowWidth, this.endSize)) / 2) * this.scale);
  }
  override apply(state: CellState) {
    super.apply(state);
    this.endSize = Number(state.style.endSize ?? 20);
  }
  override paintEdgeShape(c: AbstractCanvas2D, points: Point[]) {
    const first = points[0],
      last = points[points.length - 1];
    const length = Math.hypot(last.x - first.x, last.y - first.y);
    if (!length) return;
    const ux = (last.x - first.x) / length,
      uy = (last.y - first.y) / length;
    const head = Math.min(this.endSize * 3, length / 2),
      half = Math.max(2, this.strokeWidth * 1.5);
    const point = (along: number, across: number) =>
      [first.x + ux * along - uy * across, first.y + uy * along + ux * across] as const;
    c.begin();
    c.moveTo(...point(0, -half));
    c.lineTo(...point(length - head, -half));
    c.lineTo(...point(length - head, -Math.max(half, head / 2)));
    c.lineTo(last.x, last.y);
    c.lineTo(...point(length - head, Math.max(half, head / 2)));
    c.lineTo(...point(length - head, half));
    c.lineTo(...point(0, half));
    c.close();
    c.fillAndStroke();
  }
}
