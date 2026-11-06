import earcut from 'earcut';
import { mercatorX, mercatorY } from '../math/mercator';
import type { SourceFeature } from '../sources/SourceConfig';
import type { Point } from './FacadeAnalyzer';
import { hashU32, keyOf } from './Frontage';
import { FURNITURE_STRIDE, GROUND_STRIDE, MARKING_STRIDE, type MeshReference } from './layout';
import { minAreaRect, type OrientedRect } from './PitchedRoof';

// PLATEAU の都市設備モデル（LOD1）から、信号機・街灯・標識・路面標示を作る。
// LOD1 の都市設備は外形を押し出した箱なので、外形・高さ・機能コード（frn:function_code）から部品を組み立てる。
// - 交通信号機（4900）: 灯器だけの箱。外形と高さから車両用（横型・縦型）か歩行者用かを決め、向きは交差点の中心と柱の位置から推定する
// - 柱（4800 柱・4810 路側・4820 片持）: 灯器か標識が付いている柱だけを、縦の柱と腕木にする
// - 照明施設（4200）: 柱・腕木・灯具の外形全体を押し出した箱。外形の太い方の端を柱とし、反対の端に灯具を付ける
// - 標識（3000 番台）: 板 1 枚の箱。機能コードと板の形から図柄を決める
// - 路面標示（1000 番台）: 厚さのない多角形（横断歩道は縞 1 本ずつ）。そのまま路面に塗る
// 信号の灯色と街灯の点灯は描画時に時刻から決める。

/** 部品の種類（シェーダと合わせること） */
export const FURNITURE_PARTS = { pole: 0, vehicle: 1, vehicleVertical: 2, pedestrian: 3, luminaire: 4, sign: 5, lightPool: 6 } as const;
/** 部品がどの設備のものか（表示の切り替えに使う。シェーダと合わせること） */
export const FURNITURE_OWNERS = { signal: 0, light: 1, sign: 2 } as const;
/** 標識の図柄（シェーダと合わせること） */
export const SIGN_KINDS = { guide: 0, warning: 1, regulatory: 2, instruction: 3, auxiliary: 4 } as const;

const SIGNAL = '4900';
const POLE_CODES = new Set(['4800', '4810', '4820']);
const LIGHT = '4200';
/** 同じ交差点とみなす灯器の距離 (m) */
const INTERSECTION_RADIUS = 30;
/** 灯器・標識を柱に取り付けたとみなす距離 (m) */
const MOUNT_DISTANCE = 1.2;
/** 地面の高さを探す範囲 (m) */
const FOOTING_RADIUS = 20;
/** 柱の太さ・腕木の太さ (m) */
const POLE_SIZE = 0.26;
const ARM_SIZE = 0.16;
/** 灯器の奥行き（フードを除く） (m) */
const HEAD_DEPTH = 0.3;
/** 標識の板の厚さ (m) */
const SIGN_DEPTH = 0.04;
/** 街灯の光が路面を照らす半径（灯の高さに対する比） */
const LIGHT_POOL_RATIO = 0.9;
/** 路面標示を路面から浮かせる高さ (m) */
const MARKING_LIFT = 0.04;

export interface StreetFurnitureResult {
  /** 部品（FURNITURE_STRIDE ごとのインスタンス） */
  parts: Float32Array;
  /** 路面標示の三角形 */
  markings: Float32Array;
  markingIndices: Uint32Array;
  grounds: Float32Array;
  radius: number;
  counts: { signals: number; lights: number; signs: number; markings: number };
}

interface Item {
  key: number;
  rect: OrientedRect;
  zmin: number;
  zmax: number;
  /** 外形の頂点（局所座標） */
  points: Point[];
}

interface Head extends Item {
  part: number;
  /** 灯面の向き（単位ベクトル） */
  face?: Point;
  /** 取り付けた柱の根元 */
  mount?: Point;
  cluster: number;
}

interface Sign extends Item {
  kind: number;
  mounted: boolean;
}

function functionCode(f: SourceFeature): string {
  const a = f.properties.attributes as Record<string, unknown> | undefined;
  const code = a?.['frn:function_code'] ?? f.properties['frn:function_code'];
  if (code !== undefined) return String(code);
  const name = String(a?.['frn:function'] ?? f.properties['frn:function'] ?? '');
  const byName: Record<string, string> = { 交通信号機: SIGNAL, 柱: '4800', 路側: '4810', 片持: '4820', 照明施設: LIGHT, 横断歩道: '1110', 停止線: '1120' };
  return byName[name] ?? '';
}

function signKind(code: string): number {
  return code === '3110' ? SIGN_KINDS.guide
    : code === '3120' ? SIGN_KINDS.warning
    : code === '3130' ? SIGN_KINDS.regulatory
    : code === '3140' ? SIGN_KINDS.instruction
    : code === '3150' ? SIGN_KINDS.auxiliary
    : -1;
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
const along = (r: OrientedRect, [x, y]: Point) => (x - r.cx) * r.ux + (y - r.cy) * r.uy;

/** 長方形の長辺方向の端の点（side = ±1） */
const endOf = (r: OrientedRect, side: number, inset: number): Point => [r.cx + side * r.ux * (r.halfLength - inset), r.cy + side * r.uy * (r.halfLength - inset)];

/** 外形の両端（長辺方向の 25% ずつ）の太さを比べ、太い方の向き（±1）。柱の根元は灯具や腕木より太い */
function thickerEnd(item: Item): number {
  const r = item.rect;
  const spread = (side: number) => {
    let lo = Infinity, hi = -Infinity;
    for (const p of item.points) {
      if (along(r, p) * side < r.halfLength * 0.5) continue;
      const v = -(p[0] - r.cx) * r.uy + (p[1] - r.cy) * r.ux;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return hi > lo ? hi - lo : 0;
  };
  const a = spread(1), b = spread(-1);
  return a === b ? (hashU32(item.key) & 1 ? 1 : -1) : a > b ? 1 : -1;
}

export function buildStreetFurniture(features: SourceFeature[], reference: MeshReference): StreetFurnitureResult {
  const toLocal = ([lng, lat]: [number, number]): Point => [
    (mercatorX(lng) - reference.mercX) / reference.meterInMercator,
    -(mercatorY(lat) - reference.mercY) / reference.meterInMercator,
  ];
  const heads: Head[] = [];
  const poles: Item[] = [];
  const lights: Item[] = [];
  const signs: Sign[] = [];
  /** 地面の高さを知るための、地面から立つ地物（柱・照明）の根元 */
  const footings: { at: Point; z: number }[] = [];
  const markingPos: number[] = [];
  const markingIdx: number[] = [];
  const grounds: number[] = [];
  let markingCount = 0;
  let radius = 0;
  const groundSlot = (x0: number, y0: number, x1 = x0, y1 = y0) => {
    const g = grounds.length / GROUND_STRIDE;
    grounds.push(Math.min(x0, x1) - 0.5, Math.min(y0, y1) - 0.5, Math.max(x0, x1) + 0.5, Math.max(y0, y1) + 0.5);
    return g;
  };

  for (const f of features) {
    if (f.geometry.kind !== 'footprint') continue;
    const code = functionCode(f);
    const zmin = Number(f.properties._zmin), zmax = Number(f.properties._zmax);
    if (!Number.isFinite(zmin) || !Number.isFinite(zmax)) continue;

    if (code.startsWith('1') && code.length === 4) {
      // 路面標示: 多角形をそのまま三角形に分けて塗る（地面は標示そのものの高さ）
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const rings = f.geometry.polygons.map((p) => p.map((r) => r.map(toLocal)));
      for (const [x, y] of rings.flatMap((p) => p[0] ?? [])) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      if (!Number.isFinite(minX)) continue;
      const g = groundSlot(minX, minY, maxX, maxY);
      const kind = code === '1110' ? 1 : code === '1120' ? 2 : 0;
      for (const polygon of rings) {
        const flat: number[] = [];
        const holes: number[] = [];
        for (const ring of polygon) {
          if (flat.length) holes.push(flat.length / 2);
          for (const [x, y] of ring) flat.push(x, y);
        }
        const base = markingPos.length / MARKING_STRIDE;
        for (let i = 0; i < flat.length; i += 2) markingPos.push(flat[i], flat[i + 1], MARKING_LIFT, kind, g);
        for (const t of earcut(flat, holes, 2)) markingIdx.push(base + t);
      }
      radius = Math.max(radius, Math.hypot(minX, minY), Math.hypot(maxX, maxY));
      markingCount++;
      continue;
    }

    const isSign = signKind(code) >= 0 || code === '3000';
    if (code !== SIGNAL && code !== LIGHT && !POLE_CODES.has(code) && !isSign) continue;
    const points = f.geometry.polygons.flatMap((p) => (p[0] ?? []).map(toLocal));
    const hull = convexHull(points);
    const rect = hull.length >= 3 ? minAreaRect(hull) : undefined;
    if (!rect) continue;
    const key = keyOf(String(f.properties.gml_id ?? f.properties.id ?? `${rect.cx},${rect.cy}`));
    const item: Item = { key, rect, zmin, zmax, points };
    const h = zmax - zmin;
    if (code === SIGNAL) {
      const part = rect.halfLength * 2 >= 0.8 ? FURNITURE_PARTS.vehicle : h >= 0.95 ? FURNITURE_PARTS.vehicleVertical : FURNITURE_PARTS.pedestrian;
      heads.push({ ...item, part, cluster: -1 });
    } else if (isSign) {
      signs.push({ ...item, kind: signKind(code), mounted: false });
    } else {
      // 柱・照明は地面から立っている。低いものは柱に付けた金具
      if (h < 2) continue;
      footings.push({ at: [rect.cx, rect.cy], z: zmin });
      if (code === LIGHT) lights.push(item);
      else poles.push(item);
    }
  }

  const out: number[] = [];
  const push = (x: number, y: number, z: number, length: number, depth: number, height: number, angle: number, part: number, variant: number, phase: number, shape: number, owner: number, ground: number) => {
    out.push(x, y, z, angle, length, depth, height, part, variant, phase, shape, owner, ground);
    radius = Math.max(radius, Math.hypot(x, y) + Math.max(length, depth));
  };
  /** 地面の高さ（近くの柱・照明の根元のうち、灯器や標識より 1.5m 以上低いもので最も低いもの。なければ fallback m 下） */
  const groundBelow = (at: Point, zmin: number, fallback: number): number => {
    let best = Infinity;
    for (const f of footings) if (Math.hypot(f.at[0] - at[0], f.at[1] - at[1]) < FOOTING_RADIUS) best = Math.min(best, f.z);
    return best <= zmin - 1.5 ? best : zmin - fallback;
  };

  // ---- 街灯: 太い方の端に柱、反対の端に灯具
  /** 街灯の柱の根元（標識・歩行者用の灯器の取り付け先） */
  const lightPoles: { at: Point; zmin: number; zmax: number }[] = [];
  for (const l of lights) {
    const r = l.rect;
    const height = l.zmax - l.zmin;
    const g = groundSlot(r.cx - r.halfLength, r.cy - r.halfLength, r.cx + r.halfLength, r.cy + r.halfLength);
    const angle = Math.atan2(r.uy, r.ux);
    const warm = hashU32(l.key) % 100 < 20 ? 1 : 0;
    let base: Point, lamp: Point, lampAngle = angle;
    if (r.halfLength < 0.8) {
      // 柱の上に灯具を載せた形（腕木なし）
      base = [r.cx, r.cy];
      lamp = base;
      push(base[0], base[1], 0, 0.2, 0.2, height - 0.35, angle, FURNITURE_PARTS.pole, 0, 0, 0, FURNITURE_OWNERS.light, g);
      push(lamp[0], lamp[1], height - 0.35, 0.45, 0.45, 0.35, angle, FURNITURE_PARTS.luminaire, warm, 0, 1, FURNITURE_OWNERS.light, g);
    } else {
      const side = thickerEnd(l);
      base = endOf(r, side, 0.15);
      lamp = endOf(r, -side, 0.4);
      const armZ = height - 0.25;
      const reach = r.halfLength * 2 - 0.15;
      const mid: Point = [(base[0] + endOf(r, -side, 0)[0]) / 2, (base[1] + endOf(r, -side, 0)[1]) / 2];
      push(base[0], base[1], 0, 0.22, 0.22, height, angle, FURNITURE_PARTS.pole, 0, 0, 0, FURNITURE_OWNERS.light, g);
      push(mid[0], mid[1], armZ, reach, 0.12, 0.12, angle, FURNITURE_PARTS.pole, 0, 0, 0, FURNITURE_OWNERS.light, g);
      push(lamp[0], lamp[1], armZ - 0.12, 0.75, 0.32, 0.14, lampAngle, FURNITURE_PARTS.luminaire, warm, 0, 0, FURNITURE_OWNERS.light, g);
    }
    // 路面の光だまり（夜だけ加算で描く）
    const pool = Math.max(height * LIGHT_POOL_RATIO, 5) * 2;
    push(lamp[0], lamp[1], 0.06, pool, pool, 0, angle, FURNITURE_PARTS.lightPool, warm, 0, 0, FURNITURE_OWNERS.light, g);
    lightPoles.push({ at: base, zmin: l.zmin, zmax: l.zmax });
  }

  // ---- 交差点: 近い灯器をまとめる
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
    const vehicles = members.filter((m) => m.part !== FURNITURE_PARTS.pedestrian);
    const from = vehicles.length ? vehicles : members;
    const center: Point = [from.reduce((s, m) => s + m.rect.cx, 0) / from.length, from.reduce((s, m) => s + m.rect.cy, 0) / from.length];
    const wide = members.find((m) => m.part === FURNITURE_PARTS.vehicle);
    const axis: Point = wide ? [wide.rect.ux, wide.rect.uy] : [1, 0];
    clusters.push({ center, axis, offset: (hashU32(Math.round(center[0]) * 7919 + Math.round(center[1]) * 104729) % 600) / 10 });
  }

  // ---- 灯器と標識を柱に取り付ける
  const attached = new Map<Item, { heads: Head[]; signs: Sign[] }>();
  const mountPole = (it: Item): Item | undefined => {
    let best: Item | undefined, bestD = MOUNT_DISTANCE;
    for (const p of poles) {
      if (it.zmin > p.zmax || it.zmax < p.zmin) continue;
      const d = distanceToAxis(p.rect, [it.rect.cx, it.rect.cy]);
      if (d < bestD) [best, bestD] = [p, d];
    }
    return best;
  };
  const listOf = (p: Item) => attached.get(p) ?? attached.set(p, { heads: [], signs: [] }).get(p)!;
  for (const h of heads) {
    const p = mountPole(h);
    if (p) listOf(p).heads.push(h);
  }
  for (const s of signs) {
    const p = mountPole(s);
    if (p) {
      listOf(p).signs.push(s);
      s.mounted = true;
    } else if (lightPoles.some((l) => Math.hypot(l.at[0] - s.rect.cx, l.at[1] - s.rect.cy) < MOUNT_DISTANCE && s.zmax <= l.zmax)) {
      s.mounted = true;
    }
  }

  // ---- 柱と腕木
  const mountOf = new Map<Head, Item>();
  for (const [pole, { heads: hs, signs: ss }] of attached) {
    for (const h of hs) mountOf.set(h, pole);
    const r = pole.rect;
    const g = groundSlot(r.cx, r.cy);
    const height = pole.zmax - pole.zmin;
    const owner = hs.length ? FURNITURE_OWNERS.signal : FURNITURE_OWNERS.sign;
    const offset = hs.length ? clusters[hs[0].cluster].offset : 0;
    // 腕木に付くもの: 車両用の灯器と標識
    const overhead: Item[] = [...hs.filter((h) => h.part === FURNITURE_PARTS.vehicle), ...ss];
    const angle = Math.atan2(r.uy, r.ux);
    if (r.halfLength < 1 || !overhead.length) {
      push(r.cx, r.cy, 0, POLE_SIZE, POLE_SIZE, height, 0, FURNITURE_PARTS.pole, 0, offset, 0, owner, g);
      for (const h of hs) h.mount = [r.cx, r.cy];
      continue;
    }
    // 柱は、腕木に付くものから遠い方の端に立てる
    const mean: Point = [overhead.reduce((s, h) => s + h.rect.cx, 0) / overhead.length, overhead.reduce((s, h) => s + h.rect.cy, 0) / overhead.length];
    const side = dot([mean[0] - r.cx, mean[1] - r.cy], [r.ux, r.uy]) > 0 ? -1 : 1;
    const base = endOf(r, side, POLE_SIZE / 2);
    push(base[0], base[1], 0, POLE_SIZE, POLE_SIZE, height, angle, FURNITURE_PARTS.pole, 0, offset, 0, owner, g);
    // 腕木は、根元から 1m 以上離れたものの上端に沿わせ、柱から反対側の端まで
    const far = overhead.filter((it) => Math.hypot(it.rect.cx - base[0], it.rect.cy - base[1]) > 1);
    if (far.length) {
      const armZ = Math.max(...far.map((it) => it.zmax)) - pole.zmin;
      push(r.cx, r.cy, armZ, r.halfLength * 2, ARM_SIZE, ARM_SIZE, angle, FURNITURE_PARTS.pole, 0, offset, 0, owner, g);
    }
    for (const h of hs) h.mount = base;
  }

  // ---- 灯面の向き
  for (const h of heads) {
    const c = clusters[h.cluster];
    const away = norm([h.rect.cx - c.center[0], h.rect.cy - c.center[1]]);
    const awayLen = Math.hypot(h.rect.cx - c.center[0], h.rect.cy - c.center[1]);
    const axisB: Point = [-c.axis[1], c.axis[0]];
    if (h.part === FURNITURE_PARTS.vehicle) {
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
    if (h.part === FURNITURE_PARTS.vehicleVertical) {
      h.face = snap(awayLen > 1 ? away : c.axis, c.axis, axisB);
    } else {
      // 歩行者用: 横断歩道の向こう側に向ける（交差点の中心へ向かう向きを、道の向きのどちらかにそろえる）
      const toward: Point = [-away[0], -away[1]];
      const a = dot(toward, c.axis), b = dot(toward, axisB);
      h.face = hashU32(h.key) & 1 ? [c.axis[0] * Math.sign(a || 1), c.axis[1] * Math.sign(a || 1)] : [axisB[0] * Math.sign(b || 1), axisB[1] * Math.sign(b || 1)];
    }
  }
  // 背中合わせの灯器（同じ高さで、灯面の向きに並んだ 2 つ）は、互いに外を向ける
  for (let i = 0; i < heads.length; i++) {
    for (let j = i + 1; j < heads.length; j++) {
      const a = heads[i], b = heads[j];
      if (a.part !== b.part || Math.abs(a.zmin - b.zmin) > 0.3) continue;
      const d: Point = [a.rect.cx - b.rect.cx, a.rect.cy - b.rect.cy];
      const across = Math.abs(dot(d, a.face!)), sideways = Math.sqrt(Math.max(dot(d, d) - across * across, 0));
      if (across > 1.3 || sideways > 0.5) continue;
      if (dot(a.face!, b.face!) > 0.5) {
        const s = Math.sign(dot(d, a.face!)) || 1;
        a.face = [a.face![0] * s, a.face![1] * s];
        b.face = [-a.face[0], -a.face[1]];
      }
    }
  }

  // ---- 灯器
  for (const h of heads) {
    const c = clusters[h.cluster];
    const mount = mountOf.get(h);
    const ground = mount ? mount.zmin : groundBelow([h.rect.cx, h.rect.cy], h.zmin, h.part === FURNITURE_PARTS.pedestrian ? 2.6 : 5);
    const face = h.face!;
    // 局所座標の +y を灯面に向ける
    const angle = Math.atan2(-face[0], face[1]);
    const group = Math.abs(dot(face, c.axis)) >= Math.abs(face[0] * -c.axis[1] + face[1] * c.axis[0]) ? 0 : 1;
    const height = h.zmax - h.zmin;
    let length: number, depth: number;
    if (h.part === FURNITURE_PARTS.vehicle) {
      length = h.rect.halfLength * 2;
      depth = Math.min(h.rect.halfWidth * 2, HEAD_DEPTH);
    } else {
      length = Math.min(h.rect.halfLength, h.rect.halfWidth) * 2 + 0.02;
      depth = Math.min(Math.max(h.rect.halfLength, h.rect.halfWidth) * 2, HEAD_DEPTH);
    }
    // 横型で背の高いものは、下に矢印灯の段がある
    const rows = h.part === FURNITURE_PARTS.vehicle && height > 0.6 ? 2 : 1;
    push(h.rect.cx, h.rect.cy, h.zmin - ground, length, depth, height, angle, h.part, group, c.offset, rows, FURNITURE_OWNERS.signal, groundSlot(h.rect.cx, h.rect.cy));
    // 柱に付いていない縦型・歩行者用の灯器には、背中に細い柱を立てる
    if (!mount && h.part !== FURNITURE_PARTS.vehicle) {
      const back: Point = [h.rect.cx - face[0] * (depth / 2 + 0.08), h.rect.cy - face[1] * (depth / 2 + 0.08)];
      push(back[0], back[1], 0, 0.14, 0.14, h.zmax - ground + 0.1, angle, FURNITURE_PARTS.pole, 0, c.offset, 0, FURNITURE_OWNERS.signal, groundSlot(back[0], back[1]));
    }
  }

  // ---- 標識: 板の両面に図柄を描く（同じ位置に裏表 2 枚の地物があることが多い）
  for (const s of signs) {
    const r = s.rect;
    const ground = groundBelow([r.cx, r.cy], s.zmin, 2.5);
    const height = s.zmax - s.zmin;
    const width = r.halfLength * 2;
    // 図柄の形: 0 = 長方形, 1 = 円, 2 = 逆三角形, 3 = ひし形
    let kind = s.kind;
    const squarish = Math.abs(width - height) < Math.max(width, height) * 0.25;
    if (kind < 0) kind = squarish ? SIGN_KINDS.regulatory : SIGN_KINDS.guide;
    const pick = hashU32(s.key) % 100;
    const shape = kind === SIGN_KINDS.regulatory && squarish ? (pick < 85 ? 1 : 2) : kind === SIGN_KINDS.warning ? 3 : 0;
    push(r.cx, r.cy, s.zmin - ground, width, SIGN_DEPTH, height, Math.atan2(r.uy, r.ux), FURNITURE_PARTS.sign, kind, pick / 100, shape, FURNITURE_OWNERS.sign, groundSlot(r.cx, r.cy));
    // 柱のない標識には、下に細い柱を立てる
    if (!s.mounted && s.zmin - ground > 0.5) {
      const n: Point = [-r.uy, r.ux];
      const back: Point = [r.cx - n[0] * 0.06, r.cy - n[1] * 0.06];
      push(back[0], back[1], 0, 0.08, 0.08, s.zmax - ground, Math.atan2(r.uy, r.ux), FURNITURE_PARTS.pole, 0, 0, 0, FURNITURE_OWNERS.sign, groundSlot(back[0], back[1]));
    }
  }

  return {
    parts: new Float32Array(out),
    markings: new Float32Array(markingPos),
    markingIndices: new Uint32Array(markingIdx),
    grounds: new Float32Array(grounds),
    radius,
    counts: { signals: heads.length, lights: lights.length, signs: signs.length, markings: markingCount },
  };
}

/** 向きを、道の 2 方向（とその逆）のうち近いものにそろえる */
function snap(d: Point, a: Point, b: Point): Point {
  const da = dot(d, a), db = dot(d, b);
  return Math.abs(da) >= Math.abs(db) ? [a[0] * Math.sign(da || 1), a[1] * Math.sign(da || 1)] : [b[0] * Math.sign(db || 1), b[1] * Math.sign(db || 1)];
}
