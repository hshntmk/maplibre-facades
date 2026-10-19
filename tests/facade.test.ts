import { describe, expect, it } from 'vitest';
import { analyzeFacades, exposureOf, type Point } from '../src/mesh/FacadeAnalyzer';

/** 反時計回りの矩形（局所座標 m）。辺の順: 南, 東, 北, 西 */
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const single = (ring: Point[], holes: Point[][] = []) => [[ring, ...holes]];
const SOUTH = 0, EAST = 1, NORTH = 2, WEST = 3;

describe('analyzeFacades: 前面のあき', () => {
  it('隣と接している壁は界壁、それ以外は正面', () => {
    const [a, b] = analyzeFacades([single(rect(0, 0, 10, 10)), single(rect(10, 0, 20, 10))]);
    expect(exposureOf(a[0][0][EAST].clearance)).toBe('party');
    expect(exposureOf(b[0][0][WEST].clearance)).toBe('party');
    expect(exposureOf(a[0][0][SOUTH].clearance)).toBe('front');
    expect(exposureOf(a[0][0][WEST].clearance)).toBe('front');
  });

  it('フットプリントが少し重なっていても界壁として検出する', () => {
    const [a] = analyzeFacades([single(rect(0, 0, 10, 10)), single(rect(9.8, 0, 20, 10))]);
    expect(exposureOf(a[0][0][EAST].clearance)).toBe('party');
  });

  it('狭い隙間に面した壁は側壁で、あきは隙間の幅', () => {
    const [a] = analyzeFacades([single(rect(0, 0, 10, 10)), single(rect(12, 0, 22, 10))]);
    expect(a[0][0][EAST].clearance).toBeCloseTo(2, 1);
    expect(exposureOf(a[0][0][EAST].clearance)).toBe('side');
  });

  it('一部だけ隣と接している壁は多数決（中央値）で決まる', () => {
    // 東側の隣棟は南 3m 分だけ接している → 大部分は開けている
    const [a] = analyzeFacades([single(rect(0, 0, 10, 10)), single(rect(10, 0, 20, 3))]);
    expect(exposureOf(a[0][0][EAST].clearance)).toBe('front');
  });

  it('ふさいでいる隣の建物の高さを記録する（それより上は開けている）', () => {
    const [a] = analyzeFacades([single(rect(0, 0, 10, 10)), single(rect(10, 0, 20, 10))], [57, 8]);
    expect(exposureOf(a[0][0][EAST].clearance)).toBe('party');
    expect(a[0][0][EAST].coverHeight).toBe(8);
    expect(a[0][0][WEST].coverHeight).toBe(0); // 開けた面
  });

  it('中庭に面した壁は対面までの距離', () => {
    const hole = [...rect(13.5, 13.5, 16.5, 16.5)].reverse(); // 3m 角の中庭（時計回り）
    const [a] = analyzeFacades([single(rect(0, 0, 30, 30), [hole])]);
    for (const f of a[0][1]) expect(f.clearance).toBeCloseTo(3, 1);
  });
});

describe('analyzeFacades: スタイルごとのしきい値', () => {
  it('離れた建物でも高さを記録する（しきい値はシェーダ側でスタイルごとに適用）', () => {
    const [a] = analyzeFacades([single(rect(0, 0, 10, 10)), single(rect(16, 0, 26, 10))], [30, 12]);
    expect(a[0][0][EAST].clearance).toBeCloseTo(6, 1);
    expect(a[0][0][EAST].coverHeight).toBe(12);
  });

  it('exposureOf は渡したしきい値で分類する', () => {
    expect(exposureOf(6)).toBe('front');
    expect(exposureOf(6, { partyWallMax: 1, sideWallMax: 8 })).toBe('side');
    expect(exposureOf(0.8, { partyWallMax: 1, sideWallMax: 8 })).toBe('party');
  });

  it('日当たり面は建物ごとのしきい値で開けた面から選ぶ', () => {
    // 南 6m 先に別の建物。既定（4m）なら南面は正面、sideWallMax = 8 なら側壁になり東西が日当たり面になる
    const buildings = [single(rect(0, 10, 20, 18)), single(rect(0, 0, 20, 4))];
    const [byDefault] = analyzeFacades(buildings, [20, 20]);
    expect(byDefault[0][0][SOUTH].sunSide).toBe(true);
    const [wide] = analyzeFacades(buildings, [20, 20], [{ partyWallMax: 0.6, sideWallMax: 8 }]);
    expect(wide[0][0][SOUTH].sunSide).toBe(false);
    expect(wide[0][0][EAST].sunSide).toBe(true);
  });
});

describe('analyzeFacades: 連続面', () => {
  it('矩形は 4 つの連続面に分かれる', () => {
    const [a] = analyzeFacades([single(rect(0, 0, 10, 6))]);
    const ids = a[0][0].map((f) => f.runId);
    expect(new Set(ids).size).toBe(4);
    expect(a[0][0].map((f) => f.runLength)).toEqual([10, 6, 10, 6]);
    expect(a[0][0].every((f) => f.runOffset === 0)).toBe(true);
  });

  it('一直線上で分割された辺は 1 つの連続面にまとめる', () => {
    const ring: Point[] = [[0, 0], [4, 0], [10, 0], [10, 6], [0, 6]];
    const [a] = analyzeFacades([single(ring)]);
    const [s0, s1] = a[0][0];
    expect(s0.runId).toBe(s1.runId);
    expect(s0.runLength).toBeCloseTo(10);
    expect(s0.runOffset).toBe(0);
    expect(s1.runOffset).toBeCloseTo(4);
  });

  it('角のない多角形（円筒形）は閉じた連続面になる', () => {
    const n = 32, r = 15;
    const ring: Point[] = Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
    const [a] = analyzeFacades([single(ring)]);
    const perimeter = 2 * n * r * Math.sin(Math.PI / n);
    expect(new Set(a[0][0].map((f) => f.runId)).size).toBe(1);
    expect(a[0][0][0].runLength).toBeCloseTo(-perimeter, 6); // 負 = 閉じた面
    expect(a[0][0][n - 1].runOffset).toBeCloseTo((perimeter * (n - 1)) / n, 6);
  });

  it('緩い曲面は連続面としてつなぎ、角では切る', () => {
    // 南側が緩やかな円弧（各頂点で 10° ずつ曲がる）、他は直角
    const arc: Point[] = Array.from({ length: 7 }, (_, i) => {
      const t = ((-30 + i * 10) * Math.PI) / 180;
      return [20 * Math.sin(t), -20 * Math.cos(t) + 20];
    });
    const ring: Point[] = [...arc, [arc[6][0], 15], [arc[0][0], 15]];
    const [a] = analyzeFacades([single(ring)]);
    const arcRuns = new Set(a[0][0].slice(0, 6).map((f) => f.runId));
    expect(arcRuns.size).toBe(1);
    // 円弧・東・北・西の 4 面
    expect(new Set(a[0][0].map((f) => f.runId)).size).toBe(4);
  });
});

describe('analyzeFacades: 日当たり面', () => {
  it('開けた面のうち南向きの面', () => {
    const [a] = analyzeFacades([single(rect(0, 0, 20, 8))]);
    expect(a[0][0][SOUTH].sunSide).toBe(true);
    expect(a[0][0][NORTH].sunSide).toBe(false);
    expect(a[0][0][EAST].sunSide).toBe(false);
  });

  it('南側が隣と接していれば、残りの開けた面で最も南向きのものを選ぶ', () => {
    const [a] = analyzeFacades([single(rect(0, 10, 20, 18)), single(rect(0, 0, 20, 10))]);
    expect(a[0][0][SOUTH].sunSide).toBe(false); // 界壁
    expect(a[0][0][EAST].sunSide).toBe(true);
    expect(a[0][0][WEST].sunSide).toBe(true);
  });
});
