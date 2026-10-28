export interface RoutePoint {
  x: number;
  y: number;
}
export interface RoutedLine {
  id: string;
  points: RoutePoint[];
  jump: boolean;
  visible: boolean;
}
/** 只计算线段内部交点；端点相接和共线不产生跨线，同一交点只由一条线跨越。 */
export function lineJumps(lines: RoutedLine[]) {
  const result = new Map<string, RoutePoint[]>();
  if (!lines.some((line) => line.jump && line.visible)) return result;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i],
        b = lines[j];
      if (!a.visible || !b.visible || (!a.jump && !b.jump)) continue;
      const target = b.jump ? b : a,
        hits = result.get(target.id) ?? [];
      for (let ai = 1; ai < a.points.length; ai++)
        for (let bi = 1; bi < b.points.length; bi++) {
          const p = a.points[ai - 1],
            p2 = a.points[ai],
            q = b.points[bi - 1],
            q2 = b.points[bi];
          const rx = p2.x - p.x,
            ry = p2.y - p.y,
            sx = q2.x - q.x,
            sy = q2.y - q.y,
            den = rx * sy - ry * sx;
          if (Math.abs(den) < 0.000001) continue;
          const t = ((q.x - p.x) * sy - (q.y - p.y) * sx) / den,
            u = ((q.x - p.x) * ry - (q.y - p.y) * rx) / den;
          if (t <= 0.00001 || t >= 0.99999 || u <= 0.00001 || u >= 0.99999) continue;
          const point = { x: p.x + t * rx, y: p.y + t * ry };
          if (!hits.some((h) => Math.hypot(h.x - point.x, h.y - point.y) < 0.01)) hits.push(point);
        }
      if (hits.length) result.set(target.id, hits);
    }
  return result;
}
