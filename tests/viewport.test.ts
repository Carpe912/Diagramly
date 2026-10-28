import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  zoomViewport,
  scrollViewport,
} from '../src/adapters/maxgraph/viewport';
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
describe('滚动范围', () => {
  it('空画布和未溢出的内容只占可见区域，不产生额外滚动范围', () => {
    for (const bounds of [
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 50, y: 80, width: 200, height: 160 },
    ]) {
      const view = scrollViewport({ scale: 1, x: 100, y: 100 }, bounds, {
        width: 900,
        height: 600,
      });
      expect(view).toMatchObject({ width: 900, height: 600, scrollLeft: 0, scrollTop: 0 });
    }
  });
  it('溢出时生成滚动区域并保持相机锚点，支持负坐标和单轴溢出', () => {
    const before = { scale: 2, x: -150, y: -80 };
    const view = scrollViewport(
      before,
      { x: -200, y: -300, width: 1000, height: 800 },
      { width: 900, height: 600 },
    );
    expect(view.width).toBe(2064);
    expect(view.height).toBe(1664);
    expect(view.x - view.scrollLeft / view.scale).toBe(before.x);
    expect(view.y - view.scrollTop / view.scale).toBe(before.y);
    expect(view.x * view.scale - 200 * view.scale).toBe(32);
    const horizontal = scrollViewport(
      { scale: 1, x: 0, y: 0 },
      { x: 0, y: 0, width: 2000, height: 100 },
      { width: 900, height: 600 },
    );
    expect(horizontal.width).toBe(2064);
    expect(horizontal.height).toBe(600);
  });
  it('缩小或删除溢出图形后收缩滚动范围，不保留越界空白', () => {
    const view = scrollViewport(
      { scale: 0.1, x: -10000, y: -10000 },
      { x: 0, y: 0, width: 2000, height: 1000 },
      { width: 900, height: 600 },
    );
    expect(view).toMatchObject({ width: 900, height: 600, scrollLeft: 0, scrollTop: 0 });
    expect(view.x * 0.1).toBeGreaterThanOrEqual(32);
  });
});
