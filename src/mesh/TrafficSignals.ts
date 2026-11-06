import { mercatorX, mercatorY } from '../math/mercator';
import type { SourceFeature } from '../sources/SourceConfig';
import type { Point } from './FacadeAnalyzer';
import { hashU32, keyOf } from './Frontage';
import { GROUND_STRIDE, SIGNAL_STRIDE, type MeshReference } from './layout';
import { minAreaRect, type OrientedRect } from './PitchedRoof';

// PLATEAU の都市設備モデル（LOD1）から信号機を作る。
// LOD1 の交通信号機（frn:function 4900）は灯器だけの箱で、柱と腕木は別の地物（柱 4800）になっている。
// - 灯器: 箱の外形と高さから、車両用（横型・縦型）か歩行者用かを決め、向きは交差点の中心と柱の位置から推定する
// - 柱: 近くに灯器がある柱だけを、縦の柱と、灯器の上を通る腕木にする
// 灯色は描画時に時刻から決める（交差点ごとに周期をずらし、直交する 2 方向が交互に青になる）。

/** 部品の種類（シェーダと合わせること） */
export const SIGNAL_PARTS = { pole: 0, vehicle: 1, vehicleVertical: 2, pedestrian: 3 } as const;

const FUNCTION_SIGNAL = '4900';
const FUNCTION_POLE = '4800';
const FUNCTION_LIGHT = '4200';
/** 同じ交差点とみなす灯器の距離 (m) */
const INTERSECTION_RADIUS = 30;
/** 灯器を柱に取り付けたとみなす距離 (m) */
const MOUNT_DISTANCE = 1.2;
/** 地面の高さを探す範囲 (m) */
const FOOTING_RADIUS = 20;
/** 柱の太さ・腕木の太さ (m) */
const POLE_SIZE = 0.26;
const ARM_SIZE = 0.16;
/** 灯器の奥行き（フードを除く） (m) */
const HEAD_DEPTH = 0.3;

export interface TrafficSignalResult {
  signals: Float32Array;
  grounds: Float32Array;
  radius: number;
  /** 灯器の数 */
  count: number;
}

interface Item {
  key: number;
  rect: OrientedRect;
  zmin: number;
  zmax: number;
}

interface Head extends Item {
  part: number;
  /** 灯面の向き（単位ベクトル） */
  face?: Point;
  /** 取り付けた柱の根元 */
  mount?: Point;
  cluster: number;
}

function functionCode(f: SourceFeature): string {
  const a = f.properties.attributes as Record<string, unknown> | undefined;
  const code = a?.['frn:function_code'] ?? f.properties['frn:function_code'];
  if (code !== undefined) return String(code);
  const name = String(a?.['frn:function'] ?? f.properties['frn:function'] ?? '');
  return name === '交通信号機' ? FUNCTION_SIGNAL : name === '柱' ? FUNCTION_POLE : name === '照明施設' ? FUNCTION_LIGHT : '';
}

/** 点の集まりの凸包（反時計回り） */
function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [], upper: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 長方形の中心軸（線分）から点までの距離 */
function distanceToAxis(rect: OrientedRect, [x, y]: Point): number {
  const dx = x - rect.cx, dy = y - rect.cy;
  const u = Math.max(-rect.halfLength, Math.min(rect.halfLength, dx * rect.ux + dy * rect.uy));
  return Math.hypot(dx - u * rect.ux, dy - u * rect.uy);
}

const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const norm = ([x, y]: Point): Point => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

export function buildTrafficSignals(features: SourceFeature[], reference: MeshReference): TrafficSignalResult {
  const toLocal = ([lng, lat]: [number, number]): Point => [
    (mercatorX(lng) - reference.mercX) / reference.meterInMercator,
    -(mercatorY(lat) - reference.mercY) / reference.meterInMercator,
  ];
  const heads: Head[] = [];
  const poles: Item[] = [];
  /** 地面の高さを知るための、地面から立つ地物（柱・照明）の根元 */
  const footings: { at: Point; z: number }[] = [];

  for (const f of features) {
    if (f.geometry.kind !== 'footprint') continue;
    const code = functionCode(f);
    if (code !== FUNCTION_SIGNAL && code !== FUNCTION_POLE && code !== FUNCTION_LIGHT) continue;
    const zmin = Number(f.properties._zmin), zmax = Number(f.properties._zmax);
    if (!Number.isFinite(zmin) || !Number.isFinite(zmax)) continue;
    const points = f.geometry.polygons.flatMap((p) => (p[0] ?? []).map(toLocal));
    const hull = convexHull(points);
    const rect = hull.length >= 3 ? minAreaRect(hull) : undefined;
    if (!rect) continue;
    const key = keyOf(String(f.properties.gml_id ?? f.properties.id ?? `${rect.cx},${rect.cy}`));
    const item: Item = { key, rect, zmin, zmax };
    if (code === FUNCTION_SIGNAL) {
      const h = zmax - zmin;
      const part = rect.halfLength * 2 >= 0.8 ? SIGNAL_PARTS.vehicle : h >= 0.95 ? SIGNAL_PARTS.vehicleVertical : SIGNAL_PARTS.pedestrian;
      heads.push({ ...item, part, cluster: -1 });
    } else {
      // 柱・照明は地面から立っている（腕木や灯具の付いた柱の外形は細長い）。低いものは柱に付けた金具
      if (zmax - zmin < 2) continue;
      footings.push({ at: [rect.cx, rect.cy], z: zmin });
      if (code === FUNCTION_POLE) poles.push(item);
    }
  }

  // 交差点: 近い灯器をまとめる
  const clusters: { center: Point; axis: Point; offset: number }[] = [];
  for (const h of heads) {
    if (h.cluster >= 0) continue;
    const id = clusters.length;
    const stack = [h];
    h.cluster = id;
    const members: Head[] = [];
    while (stack.length) {
      const a = stack.pop()!;
      members.push(a);
      for (const b of heads) {
        if (b.cluster < 0 && Math.hypot(a.rect.cx - b.rect.cx, a.rect.cy - b.rect.cy) < INTERSECTION_RADIUS) {
          b.cluster = id;
          stack.push(b);
        }
      }
    }
    // 中心は車両用の灯器の重心、道の向きは横型の灯器の向き
    const vehicles = members.filter((m) => m.part !== SIGNAL_PARTS.pedestrian);
    const from = vehicles.length ? vehicles : members;
    const center: Point = [from.reduce((s, m) => s + m.rect.cx, 0) / from.length, from.reduce((s, m) => s + m.rect.cy, 0) / from.length];
    const wide = members.find((m) => m.part === SIGNAL_PARTS.vehicle);
    const axis: Point = wide ? [wide.rect.ux, wide.rect.uy] : [1, 0];
    clusters.push({ center, axis, offset: (hashU32(Math.round(center[0]) * 7919 + Math.round(center[1]) * 104729) % 600) / 10 });
  }

  // 灯器を柱に取り付ける
  const poleHeads = new Map<Item, Head[]>();
  for (const h of heads) {
    let best: Item | undefined, bestD = MOUNT_DISTANCE;
    for (const p of poles) {
      if (h.zmin > p.zmax || h.zmax < p.zmin) continue;
      const d = distanceToAxis(p.rect, [h.rect.cx, h.rect.cy]);
      if (d < bestD) [best, bestD] = [p, d];
    }
    if (!best) continue;
    const list = poleHeads.get(best) ?? [];
    list.push(h);
    poleHeads.set(best, list);
  }

  const out: number[] = [];
  const grounds: number[] = [];
  let radius = 0;
  const groundSlot = (x: number, y: number) => {
    const g = grounds.length / GROUND_STRIDE;
    grounds.push(x - 0.5, y - 0.5, x + 0.5, y + 0.5);
    return g;
  };
  const push = (x: number, y: number, z: number, length: number, depth: number, height: number, angle: number, part: number, group: number, offset: number, rows: number, ground: number) => {
    out.push(x, y, z, length, depth, height, angle, part, group, offset, rows, ground);
    radius = Math.max(radius, Math.hypot(x, y) + length);
  };
  /** 地面の高さ（取り付けた柱か、近くの柱・照明の根元のうち低いもの。なければ灯器の種類ごとの標準の高さから） */
  const groundZ = (h: Head, mount?: Item): number => {
    if (mount) return mount.zmin;
    let best = Infinity;
    for (const f of footings) if (Math.hypot(f.at[0] - h.rect.cx, f.at[1] - h.rect.cy) < FOOTING_RADIUS) best = Math.min(best, f.z);
    // 灯器より 1.5m 以上低いときだけ地面とみなす（歩道橋や高架の上の柱を拾わない）
    return best <= h.zmin - 1.5 ? best : h.zmin - (h.part === SIGNAL_PARTS.pedestrian ? 2.6 : 5);
  };

  // 柱と腕木
  const mountOf = new Map<Head, Item>();
  for (const [pole, list] of poleHeads) {
    for (const h of list) mountOf.set(h, pole);
    const r = pole.rect;
    const g = groundSlot(r.cx, r.cy);
    const height = pole.zmax - pole.zmin;
    const offset = clusters[list[0].cluster].offset;
    const vehicles = list.filter((h) => h.part === SIGNAL_PARTS.vehicle);
    if (r.halfLength < 1 || !vehicles.length) {
      push(r.cx, r.cy, 0, POLE_SIZE, POLE_SIZE, height, 0, SIGNAL_PARTS.pole, 0, offset, 0, g);
      for (const h of list) h.mount = [r.cx, r.cy];
      continue;
    }
    // 柱は、車両用の灯器から遠い方の端に立てる
    const mean: Point = [vehicles.reduce((s, h) => s + h.rect.cx, 0) / vehicles.length, vehicles.reduce((s, h) => s + h.rect.cy, 0) / vehicles.length];
    const side = dot([mean[0] - r.cx, mean[1] - r.cy], [r.ux, r.uy]) > 0 ? -1 : 1;
    const base: Point = [r.cx + side * r.ux * (r.halfLength - POLE_SIZE / 2), r.cy + side * r.uy * (r.halfLength - POLE_SIZE / 2)];
    push(base[0], base[1], 0, POLE_SIZE, POLE_SIZE, height, Math.atan2(r.uy, r.ux), SIGNAL_PARTS.pole, 0, offset, 0, g);
    // 腕木は灯器の上端に沿わせ、柱から反対側の端まで
    const armZ = Math.max(...vehicles.map((h) => h.zmax)) - pole.zmin;
    push(r.cx, r.cy, armZ, r.halfLength * 2, ARM_SIZE, ARM_SIZE, Math.atan2(r.uy, r.ux), SIGNAL_PARTS.pole, 0, offset, 0, g);
    for (const h of list) h.mount = base;
  }

  // 灯面の向き
  for (const h of heads) {
    const c = clusters[h.cluster];
    const away = norm([h.rect.cx - c.center[0], h.rect.cy - c.center[1]]);
    const awayLen = Math.hypot(h.rect.cx - c.center[0], h.rect.cy - c.center[1]);
    const axisB: Point = [-c.axis[1], c.axis[0]];
    if (h.part === SIGNAL_PARTS.vehicle) {
      // 横型: 灯の並びに直交する 2 方向のうち、交差点の外側（手前から来る車の方）
      const n: Point = [-h.rect.uy, h.rect.ux];
      const s = awayLen > 1 ? Math.sign(dot(away, n)) || 1 : hashU32(h.key) & 1 ? 1 : -1;
      h.face = [n[0] * s, n[1] * s];
      continue;
    }
    if (h.mount) {
      // 柱に付いた灯器は、柱に背を向ける
      const d: Point = [h.rect.cx - h.mount[0], h.rect.cy - h.mount[1]];
      if (Math.hypot(...d) > 0.12) {
        h.face = snap(norm(d), c.axis, axisB);
        continue;
      }
    }
    if (h.part === SIGNAL_PARTS.vehicleVertical) {
      h.face = snap(awayLen > 1 ? away : c.axis, c.axis, axisB);
    } else {
      // 歩行者用: 横断歩道の向こう側に向ける（交差点の中心へ向かう向きを、道の向きのどちらかにそろえる）
      const toward: Point = [-away[0], -away[1]];
      const a = dot(toward, c.axis), b = dot(toward, axisB);
      const useA = hashU32(h.key) & 1;
      h.face = useA ? [c.axis[0] * Math.sign(a || 1), c.axis[1] * Math.sign(a || 1)] : [axisB[0] * Math.sign(b || 1), axisB[1] * Math.sign(b || 1)];
    }
  }
  // 背中合わせの灯器（同じ高さで、灯面の向きに並んだ 2 つ）は、互いに外を向ける
  for (let i = 0; i < heads.length; i++) {
    for (let j = i + 1; j < heads.length; j++) {
      const a = heads[i], b = heads[j];
      if (a.part !== b.part || Math.abs(a.zmin - b.zmin) > 0.3) continue;
      const d: Point = [a.rect.cx - b.rect.cx, a.rect.cy - b.rect.cy];
      const across = Math.abs(dot(d, a.face!)), along = Math.sqrt(Math.max(dot(d, d) - across * across, 0));
      if (across > 1.3 || along > 0.5) continue;
      if (dot(a.face!, b.face!) > 0.5) {
        const s = Math.sign(dot(d, a.face!)) || 1;
        a.face = [a.face![0] * s, a.face![1] * s];
        b.face = [-a.face[0], -a.face[1]];
      }
    }
  }

  // 灯器
  for (const h of heads) {
    const c = clusters[h.cluster];
    const mount = mountOf.get(h);
    const ground = groundZ(h, mount);
    const face = h.face!;
    // 局所座標の +y を灯面に向ける
    const angle = Math.atan2(-face[0], face[1]);
    const group = Math.abs(dot(face, c.axis)) >= Math.abs(face[0] * -c.axis[1] + face[1] * c.axis[0]) ? 0 : 1;
    const height = h.zmax - h.zmin;
    let length: number, depth: number;
    if (h.part === SIGNAL_PARTS.vehicle) {
      length = h.rect.halfLength * 2;
      depth = Math.min(h.rect.halfWidth * 2, HEAD_DEPTH);
    } else {
      length = Math.min(h.rect.halfLength, h.rect.halfWidth) * 2 + 0.02;
      depth = Math.min(Math.max(h.rect.halfLength, h.rect.halfWidth) * 2, HEAD_DEPTH);
    }
    // 横型で背の高いものは、下に矢印灯の段がある
    const rows = h.part === SIGNAL_PARTS.vehicle && height > 0.6 ? 2 : 1;
    push(h.rect.cx, h.rect.cy, h.zmin - ground, length, depth, height, angle, h.part, group, c.offset, rows, groundSlot(h.rect.cx, h.rect.cy));
    // 柱に付いていない縦型・歩行者用の灯器には、背中に細い柱を立てる
    if (!mount && h.part !== SIGNAL_PARTS.vehicle) {
      const back: Point = [h.rect.cx - face[0] * (depth / 2 + 0.08), h.rect.cy - face[1] * (depth / 2 + 0.08)];
      push(back[0], back[1], 0, 0.14, 0.14, h.zmax - ground + 0.1, angle, SIGNAL_PARTS.pole, 0, c.offset, 0, groundSlot(back[0], back[1]));
    }
  }
  return { signals: new Float32Array(out), grounds: new Float32Array(grounds), radius, count: heads.length };
}

/** 向きを、道の 2 方向（とその逆）のうち近いものにそろえる */
function snap(d: Point, a: Point, b: Point): Point {
  const da = dot(d, a), db = dot(d, b);
  return Math.abs(da) >= Math.abs(db) ? [a[0] * Math.sign(da || 1), a[1] * Math.sign(da || 1)] : [b[0] * Math.sign(db || 1), b[1] * Math.sign(db || 1)];
}
