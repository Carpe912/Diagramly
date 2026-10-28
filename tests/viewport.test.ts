import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, zoomViewport } from '../src/adapters/maxgraph/viewport';
describe('视口缩放', () => {
  it.each([
    { scale: 1, x: 0, y: 0 },
    { scale: 0.4, x: -1200, y: 800 },
    { scale: 4, x: 50, y: -800 },
  ])('缩放后鼠标下的文档坐标保持不变：%o', (before) => {
    const anchor = { x: 320, y: 240 },
      next = zoomViewport(before, 1.8, anchor);
    expect(anchor.x / next.scale - next.x).toBeCloseTo(anchor.x / before.scale - before.x);
    expect(anchor.y / next.scale - next.y).toBeCloseTo(anchor.y / before.scale - before.y);
  });
  it('上下限内仍保持锚点，支持正负平移而不限制到原始画布边缘', () => {
    const before = { scale: 1, x: -1000, y: 2000 },
      anchor = { x: 320, y: 240 };
    expect(zoomViewport(before, 100, anchor).scale).toBe(MAX_ZOOM);
    expect(zoomViewport(before, 0.001, anchor).scale).toBe(MIN_ZOOM);
    expect(zoomViewport(before, 2, anchor).x).toBeLessThan(0);
  });
  it('缩放往返不会使视口漂移', () => {
    const before = { scale: 0.78, x: -140, y: 90 },
      anchor = { x: 250, y: 300 };
    const after = zoomViewport(zoomViewport(before, 3, anchor), before.scale, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});
