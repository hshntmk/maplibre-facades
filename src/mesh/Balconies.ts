import { exposureOf, type ExposureThresholds, type Point, type SegmentFacade } from './FacadeAnalyzer';
import { BALCONY_CEILING_DROP, BALCONY_FLOOR, BALCONY_PARTS, type BalconyPart } from './layout';

// バルコニーの形。PLATEAU の外形（屋根伏）はバルコニーの先端までを含むので、外壁の面を手すりの面とし、
// その内側に奥行きの分だけ引っ込んだ壁（窓のある面）と、床・天井・袖壁・隔て板を作る。
// 外壁のシェーダは、手すりより上・天井より下を抜いて（discard）、奥の形を見せる。
// どの階・どの範囲に付けるかは、外壁のシェーダの窓の配置（階の構成・連続面の窓の列・壁面の分類）と同じ計算で決める。
// ずれると、抜いた所の奥に何もない・窓と隔て板が重なる、といった見た目になるので、shaders.ts の FACADE_FS と合わせること。

/** スタイルごとのバルコニーの設定（FacadeStyle から作る） */
export interface BalconyLayout {
  /** 奥行き (m)。0 = バルコニーなし */
  depth: number;
  windowSpacing: number;
  curtainWall: boolean;
  /** 1 階の階高を上げる（groundFloor が storefront / lobby） */
  raisedGroundFloor: boolean;
  /** 日当たり面だけに付ける */
  sunSideOnly: boolean;
  openAboveRatio: number;
}

/** 隔て板の間隔の目安 (m)。共同住宅の 1 住戸の間口 */
const UNIT_WIDTH = 6.5;
/** 隔て板を外壁の面から下げる量 (m)。手すりと重ならないように */
const PARTITION_INSET = 0.05;

export interface FloorLayout {
  floors: number;
  /** 1 階の階高 */
  groundHeight: number;
  /** 2 階以上の階高 */
  upperHeight: number;
}

/** 階の構成（FACADE_FS の「階の構成」と同じ） */
export function floorLayout(height: number, floorHeight: number, raisedGroundFloor: boolean): FloorLayout {
  const fh = floorHeight;
  const topLimit = height - Math.min(2.5, Math.max(0.4, height * 0.03));
  const floors = Math.max(1, Math.floor(topLimit / fh + 0.01));
  const groundHeight =
    raisedGroundFloor && floors >= 2 ? Math.min(Math.max(Math.min(fh * 1.35, fh + 1.6), fh), Math.max(fh, floors * fh - (floors - 1) * 2.6)) : fh;
  const upperHeight = floors >= 2 ? (floors * fh - groundHeight) / (floors - 1) : fh;
  return { floors, groundHeight, upperHeight };
}

/** k 階（0 = 1 階）の床の高さ（建物の下端から） */
export const floorBase = (l: FloorLayout, k: number): number => (k < 1 ? 0 : l.groundHeight + (k - 1) * l.upperHeight);

export interface RunColumns {
  /** 連続面の両端の余白 (m) */
  margin: number;
  /** 窓を並べる長さ (m) */
  usable: number;
  count: number;
  width: number;
}

/** 連続面に沿った窓の列（FACADE_FS の「連続面に沿った窓の列」と同じ）。窓が 1 つも並ばなければ undefined */
export function runColumns(runLength: number, spacing: number, curtainWall: boolean): RunColumns | undefined {
  const closed = runLength < 0;
  const margin = closed ? 0 : curtainWall ? 0.2 : 0.45;
  const usable = Math.abs(runLength) - 2 * margin;
  let count = Math.floor(usable / spacing + 0.15);
  if (count < 1 && usable >= 1.2) count = 1;
  if (count < 1) return undefined;
  return { margin, usable, count, width: usable / count };
}

/**
 * この壁でバルコニーを付ける最初の階（1 以上）。付けないなら 0。
 * 正面（開けた面）の 2 階以上で、日当たり面だけのスタイルなら日当たり面だけ。
 * 隣の建物にふさがれている壁は、隣より上で正面になる階から（階の途中で変わる階には付けない）
 */
export function firstBalconyFloor(
  layout: BalconyLayout,
  facade: SegmentFacade,
  height: number,
  bottom: number,
  floors: FloorLayout,
  thresholds: ExposureThresholds,
): number {
  if (layout.depth <= 0 || floors.floors < 2) return 0;
  if (layout.sunSideOnly && !facade.sunSide) return 0;
  if (!runColumns(facade.runLength, layout.windowSpacing, layout.curtainWall)) return 0;
  const exposure = exposureOf(facade.clearance, thresholds);
  if (exposure === 'front') return 1;
  // ふさいでいる建物より上は、隣が低ければ正面、そうでなければ 1 段階だけ開放（側壁 → 正面）
  const coverHeight = facade.coverHeight - bottom;
  const opens = coverHeight < height * layout.openAboveRatio || exposure === 'side';
  if (!opens) return 0;
  for (let k = 1; k < floors.floors; k++) {
    if (floorBase(floors, k) >= coverHeight + 0.3) return k;
  }
  return 0;
}

type Vec3 = [number, number, number];

export interface BalconyEmitter {
  /** 引っ込んだ壁（窓のある面）。外壁と同じ頂点の形式で、u は外壁と同じ連続面に沿った距離 */
  innerWall(segment: number, a: Point, b: Point, uA: number, uB: number, from: number, zBottom: number, zTop: number): void;
  /**
   * 床・天井・袖壁・隔て板の四角形。depth は外壁の面からの奥行き、rel は階の床からの高さ（いずれも頂点ごと）、
   * ceiling は天井の高さ（階の床から）、outward は外壁の外向き法線
   */
  quad(part: BalconyPart, corners: Vec3[], normal: Vec3, outward: Point, depth: number[], rel: number[], ceiling: number): void;
}

export interface RingBalconyInput {
  ring: Point[];
  facades: SegmentFacade[];
  /** 各辺の最初のバルコニーの階（firstBalconyFloor）。0 = なし */
  from: number[];
  layout: BalconyLayout;
  floors: FloorLayout;
  bottom: number;
}

/** 1 つのリングのバルコニーを作る。外壁の頂点の balconyFrom / balconyDepth は呼び出し側で from[] から付ける */
export function buildRingBalconies(input: RingBalconyInput, emit: BalconyEmitter): void {
  const { ring, facades, from, layout, floors, bottom } = input;
  const n = ring.length;
  const depth = layout.depth;
  const ceilingRel = floors.upperHeight - BALCONY_CEILING_DROP;
  // 最上階の天井（窓を並べる範囲の上端）
  const topZ = bottom + floorBase(floors, floors.floors - 1) + floors.upperHeight;

  const tangent = (i: number): Point => {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0);
    return [(x1 - x0) / len, (y1 - y0) / len];
  };
  // 内向きの法線（外周は反時計回りなので、外向き = (ty, -tx)）
  const inward = ([tx, ty]: Point): Point => [-ty, tx];
  // 同じ連続面で、角でなくつながっている隣の辺か
  const joined = (i: number, j: number) => from[j] > 0 && facades[j].runId === facades[i].runId;

  for (let i = 0; i < n; i++) {
    const first = from[i];
    if (first <= 0) continue;
    const f = facades[i];
    const cols = runColumns(f.runLength, layout.windowSpacing, layout.curtainWall);
    if (!cols) continue;
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const t = tangent(i);
    const inN = inward(t);
    const outward: Point = [-inN[0], -inN[1]];
    const u0 = f.runOffset;
    const u1 = f.runOffset + len;
    // 窓を並べる範囲（連続面の両端の余白の内側）に切り詰める
    const uA = Math.max(u0, cols.margin);
    const uB = Math.min(u1, cols.margin + cols.usable);
    if (uB - uA < 0.05) continue;
    const at = (u: number): Point => [x0 + t[0] * (u - u0), y0 + t[1] * (u - u0)];
    const pA = at(uA);
    const pB = at(uB);

    // 引っ込んだ壁の端: 同じ連続面の隣の辺とつながっていれば、角の二等分線の向きにずらして隙間なくつなぐ
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const startJoined = uA === u0 && joined(i, prev);
    const endJoined = uB === u1 && joined(i, next);
    const miter = (other: number): Point => {
      const m = inward(tangent(other));
      const s = 1 + inN[0] * m[0] + inN[1] * m[1];
      return [((inN[0] + m[0]) / s) * depth, ((inN[1] + m[1]) / s) * depth];
    };
    const offA = startJoined ? miter(prev) : ([inN[0] * depth, inN[1] * depth] as Point);
    const offB = endJoined ? miter(next) : ([inN[0] * depth, inN[1] * depth] as Point);
    const qA: Point = [pA[0] + offA[0], pA[1] + offA[1]];
    const qB: Point = [pB[0] + offB[0], pB[1] + offB[1]];

    emit.innerWall(i, qA, qB, uA, uB, first, bottom + floorBase(floors, first), topZ);

    // 隔て板: 窓の列の境目に、住戸の間口ごと
    const every = Math.max(1, Math.round(UNIT_WIDTH / cols.width));
    const partitions: number[] = [];
    const closed = f.runLength < 0;
    for (let j = closed ? 0 : every; j < cols.count; j += every) {
      const u = cols.margin + j * cols.width;
      if (u >= uA && u < uB) partitions.push(u);
    }

    for (let k = first; k < floors.floors; k++) {
      const base = bottom + floorBase(floors, k);
      const zf = base + BALCONY_FLOOR;
      const zc = base + ceilingRel;
      const corners = (z: number): Vec3[] => [
        [pA[0], pA[1], z],
        [pB[0], pB[1], z],
        [qB[0], qB[1], z],
        [qA[0], qA[1], z],
      ];
      emit.quad(BALCONY_PARTS.floor, corners(zf), [0, 0, 1], outward, [0, 0, depth, depth], [BALCONY_FLOOR, BALCONY_FLOOR, BALCONY_FLOOR, BALCONY_FLOOR], ceilingRel);
      emit.quad(BALCONY_PARTS.ceiling, corners(zc), [0, 0, -1], outward, [0, 0, depth, depth], [ceilingRel, ceilingRel, ceilingRel, ceilingRel], ceilingRel);

      const vertical = (part: BalconyPart, p: Point, q: Point, normal: Point, d0: number) =>
        emit.quad(
          part,
          [
            [p[0], p[1], zf],
            [q[0], q[1], zf],
            [q[0], q[1], zc],
            [p[0], p[1], zc],
          ],
          [normal[0], normal[1], 0],
          outward,
          [d0, depth, depth, d0],
          [BALCONY_FLOOR, BALCONY_FLOOR, ceilingRel, ceilingRel],
          ceilingRel,
        );
      // 袖壁: 連続面の端、または隣の辺にこの階のバルコニーがない所
      if (!startJoined || k < from[prev]) vertical(BALCONY_PARTS.sideWall, pA, qA, t, 0);
      if (!endJoined || k < from[next]) vertical(BALCONY_PARTS.sideWall, pB, qB, [-t[0], -t[1]], 0);
      for (const u of partitions) {
        const p = at(u);
        const o: Point = [p[0] + inN[0] * PARTITION_INSET, p[1] + inN[1] * PARTITION_INSET];
        const q: Point = [p[0] + inN[0] * depth, p[1] + inN[1] * depth];
        vertical(BALCONY_PARTS.partition, o, q, t, PARTITION_INSET);
      }
    }
  }
}
