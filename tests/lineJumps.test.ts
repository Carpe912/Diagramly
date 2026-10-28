import { describe, expect, it } from 'vitest';
import { lineJumps, type RoutedLine } from '../src/domain/lineJumps';
const a: RoutedLine = {
  id: 'a',
  points: [
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ],
  jump: true,
  visible: true,
};
const b: RoutedLine = {
  id: 'b',
  points: [
    { x: 50, y: 0 },
    { x: 50, y: 100 },
  ],
  jump: true,
  visible: true,
};
describe('跨线交点', () => {
  it('同一交点仅由后绘制的连线跨越，关闭一条跨线后由另一条承担', () => {
    expect([...lineJumps([a, b])]).toEqual([['b', [{ x: 50, y: 50 }]]]);
    expect([...lineJumps([a, { ...b, jump: false }])]).toEqual([['a', [{ x: 50, y: 50 }]]]);
  });
  it('忽略端点、平行重叠、零长线段和不可见线', () => {
    for (const line of [
      { ...b, visible: false },
      {
        ...b,
        points: [
          { x: 100, y: 50 },
          { x: 100, y: 100 },
        ],
      },
      { ...b, points: a.points },
      {
        ...b,
        points: [
          { x: 50, y: 50 },
          { x: 50, y: 50 },
        ],
      },
    ])
      expect(lineJumps([a, line]).size).toBe(0);
    expect(
      lineJumps([
        { ...a, jump: false },
        { ...b, jump: false },
      ]).size,
    ).toBe(0);
  });
  it('斜线和多段折线按实际交点计算并去重', () => {
    const folded = {
      ...b,
      points: [
        { x: 20, y: 0 },
        { x: 20, y: 100 },
        { x: 80, y: 100 },
        { x: 80, y: 0 },
      ],
    };
    expect(lineJumps([a, folded]).get('b')).toEqual([
      { x: 20, y: 50 },
      { x: 80, y: 50 },
    ]);
    expect(
      lineJumps([
        a,
        {
          ...b,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        },
      ]).get('b'),
    ).toEqual([{ x: 50, y: 50 }]);
  });
});
