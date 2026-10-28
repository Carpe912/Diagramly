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
export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** 保留文档原点，负坐标也纳入可滚动范围。 */
export function documentExtent(bounds: ContentBounds): ContentBounds {
  const x = Math.min(0, bounds.x),
    y = Math.min(0, bounds.y);
  return {
    x,
    y,
    width: Math.max(0, bounds.x + bounds.width) - x,
    height: Math.max(0, bounds.y + bounds.height) - y,
  };
}
/** 将虚拟相机转换为非负滚动位置；内容未溢出时只占可见区域。 */
export function scrollViewport(
  camera: Viewport,
  bounds: ContentBounds,
  screen: { width: number; height: number },
  padding = 32,
) {
  const extent = documentExtent(bounds);
  const axis = (start: number, length: number, size: number, position: number) => {
    const minimum = -start + padding / camera.scale;
    const fits = length * camera.scale + padding * 2 <= size;
    const translate = fits
      ? Math.max(minimum, Math.min((size - padding) / camera.scale - start - length, position))
      : Math.max(minimum, position);
    const contentSize = Math.max(
      size,
      Math.ceil((start + length + translate) * camera.scale + padding),
    );
    const scroll = Math.max(0, Math.min(contentSize - size, (translate - position) * camera.scale));
    return { translate, size: contentSize, scroll };
  };
  const horizontal = axis(extent.x, extent.width, screen.width, camera.x),
    vertical = axis(extent.y, extent.height, screen.height, camera.y);
  return {
    scale: camera.scale,
    x: horizontal.translate,
    y: vertical.translate,
    width: horizontal.size,
    height: vertical.size,
    scrollLeft: horizontal.scroll,
    scrollTop: vertical.scroll,
  };
}
