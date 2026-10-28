export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export interface Viewport {
  scale: number;
  x: number;
  y: number;
}
/** 缩放时保持鼠标下的文档坐标不变，平移量不限制正负。 */
export function zoomViewport(
  viewport: Viewport,
  scale: number,
  anchor: { x: number; y: number },
): Viewport {
  const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
  return {
    scale: nextScale,
    x: viewport.x + anchor.x / nextScale - anchor.x / viewport.scale,
    y: viewport.y + anchor.y / nextScale - anchor.y / viewport.scale,
  };
}
