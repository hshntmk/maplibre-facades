import type { Point } from './FacadeAnalyzer';
import { hashU32, keyOf, mixKey } from './Frontage';

// 戸建ての勾配屋根（切妻・寄棟・片流れ）。LOD1 の外形は屋根の形を持たないので、外形に外接する最小の長方形を求め、
// その長方形の上に屋根を架ける。外形が長方形に近い建物（面積比 0.85 以上）だけが対象で、ほかは陸屋根のまま。
// 建物の高さ（計測高さ）を棟の高さとし、外壁は軒の高さまで（切妻の妻側は棟まで三角に）立ち上げる。

/** スタイルごとの勾配屋根の割合（FacadeStyle の pitchedRoofs から作る）。残りは陸屋根 */
export interface PitchedRoofLayout {
  gable: number;
  hip: number;
  shed: number;
  /** 太陽光パネルを載せる建物の割合（スタイルの solarRatio） */
  solarRatio: number;
}

export type RoofShape = 'gable' | 'hip' | 'shed';
/** 屋根材の番号（シェーダと合わせること） */
export const ROOF_MATERIALS = { tile: 0, slate: 1, metal: 2 } as const;

/** 屋根材ごとの色の候補（シェーダに埋め込む） */
export const ROOF_COLORS: Record<keyof typeof ROOF_MATERIALS, [number, number, number][]> = {
  // いぶし瓦・黒の釉薬瓦・茶の釉薬瓦・洋瓦
  tile: [[0.42, 0.43, 0.45], [0.18, 0.18, 0.2], [0.38, 0.26, 0.2], [0.55, 0.37, 0.28]],
  // 黒・茶・緑がかった灰・青灰
  slate: [[0.24, 0.25, 0.27], [0.33, 0.26, 0.22], [0.27, 0.3, 0.29], [0.25, 0.27, 0.31]],
  // ガルバリウム鋼板: 黒・銀・茶・紺
  metal: [[0.15, 0.15, 0.16], [0.58, 0.6, 0.61], [0.36, 0.28, 0.23], [0.2, 0.22, 0.27]],
};

/** 外形に外接する長方形との面積比がこれ以上なら勾配屋根を架ける */
export const MIN_RECTANGULARITY = 0.85;
/** 軒の出（外壁から屋根の端まで） (m) */
export const EAVE_OVERHANG = 0.45;
/** 鼻隠し（軒先の板）の高さ (m) */
const FASCIA = 0.15;
/** 外壁の高さ（軒まで）の最小値 (m)。これより低くなる屋根は勾配を緩める */
const MIN_WALL = 2.4;

export interface OrientedRect {
  /** 中心と、長辺方向の単位ベクトル */
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  /** 長辺・短辺の半分 */
  halfLength: number;
  halfWidth: number;
  area: number;
}

/** 最小面積の外接長方形（辺の向きごとに試す。頂点の少ない外形向け） */
export function minAreaRect(ring: Point[]): OrientedRect | undefined {
  let best: OrientedRect | undefined;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of ring) {
      const u = x * ux + y * uy, v = -x * uy + y * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (best && area >= best.area) continue;
    const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
    const lu = (maxU - minU) / 2, lv = (maxV - minV) / 2;
    // u を長辺にそろえる
    const swap = lv > lu;
    best = {
      cx: cu * ux - cv * uy,
      cy: cu * uy + cv * ux,
      ux: swap ? -uy : ux,
      uy: swap ? ux : uy,
      halfLength: swap ? lv : lu,
      halfWidth: swap ? lu : lv,
      area,
    };
  }
  return best;
}

function ringArea(ring: Point[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

export interface RoofPlan {
  shape: RoofShape;
  rect: OrientedRect;
  /** 屋根の勾配 (tan) */
  pitch: number;
  /** 棟（片流れは高い側の軒）の高さと、軒の高さ（外壁の上端。片流れは低い側） */
  ridge: number;
  eave: number;
  /** 片流れ: 低い側が v の負の側なら 1、正の側なら -1 */
  shedSign: number;
  material: number;
  color: number;
  /** 太陽光パネルを載せるか（南向きの面に） */
  solar: boolean;
}

export interface RoofPlanInput {
  id: string;
  rings: Point[][][];
  /** 下端・上端（棟）の高さ */
  bottom: number;
  top: number;
  layout: PitchedRoofLayout;
  /** 鉄筋コンクリートなどの建物は陸屋根が多い */
  concrete: boolean;
  solarRatio: number;
}

/** 勾配屋根の計画。陸屋根にする建物は undefined */
export function planPitchedRoof(input: RoofPlanInput): RoofPlan | undefined {
  const { layout } = input;
  if (input.rings.length !== 1 || input.rings[0].length !== 1) return undefined;
  const ring = input.rings[0][0];
  const rect = minAreaRect(ring);
  if (!rect || rect.halfWidth < 1.5 || rect.halfLength > 20) return undefined;
  if (ringArea(ring) / rect.area < MIN_RECTANGULARITY) return undefined;

  const key = keyOf(`${input.id}:roof`);
  const total = layout.gable + layout.hip + layout.shed;
  // 鉄筋コンクリートの家は陸屋根を多く（勾配屋根の割合を半分に）
  const share = input.concrete ? total * 0.5 : total;
  const roll = (hashU32(key) % 10000) / 10000;
  if (roll >= share) return undefined;
  const pick = (roll / share) * total;
  const shape: RoofShape = pick < layout.gable ? 'gable' : pick < layout.gable + layout.hip ? 'hip' : 'shed';

  // 屋根材と勾配: 瓦は 4.5 寸、スレートは 4 寸、金属は 2.5 寸（片流れは金属が多い）
  const m = mixKey(key, 1) % 100;
  const material = shape === 'shed' ? (m < 70 ? ROOF_MATERIALS.metal : ROOF_MATERIALS.slate) : m < 45 ? ROOF_MATERIALS.tile : m < 88 ? ROOF_MATERIALS.slate : ROOF_MATERIALS.metal;
  let pitch = material === ROOF_MATERIALS.tile ? 0.45 : material === ROOF_MATERIALS.slate ? 0.4 : 0.25;
  const run = shape === 'shed' ? rect.halfWidth * 2 : rect.halfWidth;
  const height = input.top - input.bottom;
  // 外壁が低くなりすぎる場合は勾配を緩める。それでも 1.5 寸を下回るなら陸屋根
  const maxRise = height - MIN_WALL;
  if (run * pitch > maxRise) pitch = maxRise / run;
  if (pitch < 0.15) return undefined;
  const ridge = input.top;
  const eave = ridge - run * pitch;

  // 片流れは南へ下る向きを多く（低い側を南に）。v の負の側の外向きは (uy, -ux) なので、ux > 0 なら南寄り
  const southSign = rect.ux > 0 ? 1 : -1;
  const shedSign = mixKey(key, 2) % 100 < 70 ? southSign : mixKey(key, 3) % 2 === 0 ? 1 : -1;
  const colors = ROOF_COLORS[(Object.keys(ROOF_MATERIALS) as (keyof typeof ROOF_MATERIALS)[])[material]];
  return {
    shape,
    rect,
    pitch,
    ridge,
    eave,
    shedSign,
    material,
    color: mixKey(key, 4) % colors.length,
    solar: mixKey(key, 5) % 10000 < input.solarRatio * 10000,
  };
}

/** 局所座標 → 長方形の座標 (u: 長辺方向, v: 短辺方向) */
function toRect(r: OrientedRect, [x, y]: Point): [number, number] {
  const dx = x - r.cx, dy = y - r.cy;
  return [dx * r.ux + dy * r.uy, -dx * r.uy + dy * r.ux];
}
function fromRect(r: OrientedRect, u: number, v: number): Point {
  return [r.cx + u * r.ux - v * r.uy, r.cy + u * r.uy + v * r.ux];
}

/** 屋根面の高さ（軒の出を含まない外壁の位置で）。外壁の上端に使う */
export function roofSurfaceHeight(plan: RoofPlan, p: Point): number {
  const [u, v] = toRect(plan.rect, p);
  const { halfLength: hl, halfWidth: hw } = plan.rect;
  const du = Math.max(0, hl - Math.abs(u)), dv = Math.max(0, hw - Math.abs(v));
  switch (plan.shape) {
    case 'gable':
      return plan.eave + Math.min(dv, hw) * plan.pitch;
    case 'hip':
      return plan.eave + Math.min(dv, du) * plan.pitch;
    case 'shed':
      return plan.eave + Math.min(Math.max(0, hw + plan.shedSign * v), 2 * hw) * plan.pitch;
  }
}

/**
 * 外壁の上端を屋根に合わせるとき、辺を分ける位置（0–1）。切妻の妻側の壁は棟の位置で折れるので分ける
 */
export function ridgeSplits(plan: RoofPlan, a: Point, b: Point): number[] {
  if (plan.shape !== 'gable') return [];
  const va = toRect(plan.rect, a)[1], vb = toRect(plan.rect, b)[1];
  if (va * vb >= 0) return [];
  const t = va / (va - vb);
  return t > 0.02 && t < 0.98 ? [t] : [];
}

type Vec3 = [number, number, number];

export interface RoofEmitter {
  /**
   * 四角形（三角形は最後の点を重ねる）。uv は面の座標（u: 軒に沿った面の中心からの距離、v: 軒先から棟へ向かう距離 m）、
   * halfEave は軒先での面の長さの半分（寄棟の隅棟の位置。切妻・片流れは大きな値）、slope は軒先から棟までの長さ、part は 0 = 屋根面、1 = 鼻隠し
   */
  quad(corners: Vec3[], normal: Vec3, uv: [number, number][], halfEave: number, slope: number, part: number, solar: boolean): void;
}

/** 屋根の形を作る（z は建物の下端を基準にした値ではなく、そのままの高さ） */
export function buildPitchedRoof(plan: RoofPlan, emit: RoofEmitter): void {
  const r = plan.rect;
  const o = EAVE_OVERHANG;
  const HL = r.halfLength + o, HW = r.halfWidth + o;
  const zEave = plan.eave - o * plan.pitch;
  const P = (u: number, v: number, z: number): Vec3 => [...fromRect(r, u, v), z];
  const norm = (nu: number, nv: number, nz: number): Vec3 => {
    const l = Math.hypot(nu, nv, nz);
    const [x, y] = [(nu * r.ux - nv * r.uy) / l, (nu * r.uy + nv * r.ux) / l];
    return [x, y, nz / l];
  };
  const slopeLen = (run: number) => run * Math.hypot(1, plan.pitch);
  // 南向きの面（法線の y が負）に太陽光パネル
  const southFacing = (n: Vec3) => plan.solar && n[1] < -0.15;
  const BIG = 1e4;
  // 鼻隠し: 軒先の辺 (u0,v)→(u1,v) から下へ
  const fascia = (u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, n: Vec3) =>
    emit.quad([P(u0, v0, z0 - FASCIA), P(u1, v1, z1 - FASCIA), P(u1, v1, z1), P(u0, v0, z0)], n, [[0, 0], [0, 0], [0, 0], [0, 0]], BIG, 1, 1, false);

  if (plan.shape === 'gable' || plan.shape === 'hip') {
    const ridgeZ = zEave + HW * plan.pitch;
    const s = slopeLen(HW);
    const ridgeHalf = plan.shape === 'gable' ? HL : HL - HW;
    const halfEave = plan.shape === 'gable' ? BIG : HL;
    for (const side of [-1, 1]) {
      // 長辺側の面（v = side * HW が軒先、v = 0 が棟）
      const n = norm(0, side, 1 / plan.pitch);
      const corners = [P(-HL, side * HW, zEave), P(HL, side * HW, zEave), P(ridgeHalf, 0, ridgeZ), P(-ridgeHalf, 0, ridgeZ)];
      const uv: [number, number][] = [[-HL, 0], [HL, 0], [ridgeHalf, s], [-ridgeHalf, s]];
      emit.quad(side > 0 ? corners : [corners[1], corners[0], corners[3], corners[2]], n, side > 0 ? uv : [uv[1], uv[0], uv[3], uv[2]], halfEave, s, 0, southFacing(n));
      fascia(-HL, side * HW, HL, side * HW, zEave, zEave, norm(0, side, 0));
    }
    if (plan.shape === 'hip') {
      const sEnd = slopeLen(HW);
      for (const side of [-1, 1]) {
        // 短辺側の三角の面（u = side * HL が軒先）
        const n = norm(side, 0, 1 / plan.pitch);
        const tri = [P(side * HL, -side * HW, zEave), P(side * HL, side * HW, zEave), P(side * ridgeHalf, 0, ridgeZ)];
        emit.quad([...tri, tri[2]], n, [[-HW, 0], [HW, 0], [0, sEnd], [0, sEnd]], HW, sEnd, 0, southFacing(n));
        fascia(side * HL, -side * HW, side * HL, side * HW, zEave, zEave, norm(side, 0, 0));
      }
    } else {
      // 切妻の妻側（けらば）の破風板: 軒先から棟まで斜めに
      for (const side of [-1, 1]) {
        const n = norm(side, 0, 0);
        for (const vs of [-1, 1]) {
          emit.quad([P(side * HL, vs * HW, zEave - FASCIA), P(side * HL, 0, ridgeZ - FASCIA), P(side * HL, 0, ridgeZ), P(side * HL, vs * HW, zEave)], n, [[0, 0], [0, 0], [0, 0], [0, 0]], BIG, 1, 1, false);
        }
      }
    }
  } else {
    // 片流れ: v = -shedSign * HW が低い軒先、v = shedSign * HW が高い軒先
    const sg = plan.shedSign;
    const zHigh = zEave + 2 * HW * plan.pitch;
    const s = slopeLen(2 * HW);
    const n = norm(0, -sg, 1 / plan.pitch);
    const low = -sg * HW, high = sg * HW;
    const corners = [P(-HL, low, zEave), P(HL, low, zEave), P(HL, high, zHigh), P(-HL, high, zHigh)];
    const uv: [number, number][] = [[-HL, 0], [HL, 0], [HL, s], [-HL, s]];
    emit.quad(sg > 0 ? corners : [corners[1], corners[0], corners[3], corners[2]], n, sg > 0 ? uv : [uv[1], uv[0], uv[3], uv[2]], BIG, s, 0, southFacing(n));
    fascia(-HL, low, HL, low, zEave, zEave, norm(0, -sg, 0));
    fascia(-HL, high, HL, high, zHigh, zHigh, norm(0, sg, 0));
    for (const side of [-1, 1]) emit.quad([P(side * HL, low, zEave - FASCIA), P(side * HL, high, zHigh - FASCIA), P(side * HL, high, zHigh), P(side * HL, low, zEave)], norm(side, 0, 0), [[0, 0], [0, 0], [0, 0], [0, 0]], BIG, 1, 1, false);
  }
}
