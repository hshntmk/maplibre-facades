import type { BuildingCategory } from '../model/BuildingRecord';
import type { Point } from './FacadeAnalyzer';

// 屋上設備と航空障害灯の配置を、建物の形・高さ・階数・用途から決める（Worker 内で実行）。
// 設備は建物ごとに「最大数」まで生成し、それぞれに rank (0–1) を付ける。表示する割合はシェーダで
// rank < density × スタイルの倍率 として選ぶので、密度を変えても作り直しは要らない。

export const EQUIPMENT_TYPES = ['penthouse', 'acUnits', 'waterTank', 'cubicle', 'coolingTower'] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export interface EquipmentItem {
  type: EquipmentType;
  x: number;
  y: number;
  /** 建物の主軸方向の長さ・奥行き・高さ (m) */
  w: number;
  d: number;
  h: number;
  /** 主軸の向き（ラジアン） */
  angle: number;
  /** 0–1。小さいものほど低い密度でも表示される */
  rank: number;
}

export interface RooftopInput {
  /** 局所座標 (m) のポリゴン（外周 + 穴）。外周は反時計回り */
  polygons: Point[][][];
  height: number;
  storeys: number;
  category: BuildingCategory;
  openSided: boolean;
  seed: number;
}

export interface RooftopResult {
  /** 主軸の向き（最も長い外周の辺の向き） */
  axisAngle: number;
  /** 屋上面積 (m²) */
  roofArea: number;
  equipment: EquipmentItem[];
  /** 航空障害灯の位置（屋上の角） */
  lights: Point[];
}

/** 航空障害灯を生成する最低の高さ (m)。表示するかどうかは minHeight でシェーダが決める */
export const AVIATION_LIGHT_MIN_GENERATED_HEIGHT = 10;
/** パラペットや縁から設備を離す距離 (m) */
const EDGE_CLEARANCE = 0.8;
const ITEM_GAP = 0.5;

const LARGE_ROOF_CATEGORIES = new Set<BuildingCategory>(['office', 'commercial', 'mixed_commercial', 'hotel', 'public', 'education_welfare']);

/** 決定的な乱数（mulberry32） */
export function createRng(seed: number): () => number {
  let a = Math.floor(seed * 4294967296) >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ringArea = (ring: Point[]): number => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
};

function insideRing([x, y]: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** 点がポリゴン（穴を除く）の内側にあり、すべての辺から clearance 以上離れているか */
function insideWithClearance(p: Point, rings: Point[][], clearance: number): boolean {
  if (!insideRing(p, rings[0])) return false;
  for (let r = 1; r < rings.length; r++) if (insideRing(p, rings[r])) return false;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) if (distanceToSegment(p, ring[i], ring[(i + 1) % ring.length]) < clearance) return false;
  }
  return true;
}

export function generateRooftop(input: RooftopInput): RooftopResult {
  const rng = createRng(input.seed);
  const polygons = input.polygons;
  const roofArea = polygons.reduce((sum, rings) => sum + Math.abs(ringArea(rings[0])) - rings.slice(1).reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);

  // 主軸: 最も大きいポリゴンの外周で、最も長い辺の向き
  const main = polygons.reduce((a, b) => (Math.abs(ringArea(b[0])) > Math.abs(ringArea(a[0])) ? b : a));
  let axisAngle = 0;
  let longest = 0;
  main[0].forEach(([x0, y0], i) => {
    const [x1, y1] = main[0][(i + 1) % main[0].length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len > longest) {
      longest = len;
      axisAngle = Math.atan2(y1 - y0, x1 - x0);
    }
  });
  const ca = Math.cos(axisAngle), sa = Math.sin(axisAngle);
  const toAxis = ([x, y]: Point): Point => [x * ca + y * sa, -x * sa + y * ca];
  const fromAxis = ([u, v]: Point): Point => [u * ca - v * sa, u * sa + v * ca];

  // ---- 航空障害灯: 主軸に対して対角方向の 4 隅
  const lights: Point[] = [];
  if (!input.openSided && input.height >= AVIATION_LIGHT_MIN_GENERATED_HEIGHT) {
    const pts = main[0].map(toAxis);
    const pick = (score: (p: Point) => number) => pts.reduce((best, p, i) => (score(p) > score(pts[best]) ? i : best), 0);
    const idx = new Set([pick(([u, v]) => u + v), pick(([u, v]) => u - v), pick(([u, v]) => -u + v), pick(([u, v]) => -u - v)]);
    const cx = main[0].reduce((s, p) => s + p[0], 0) / main[0].length;
    const cy = main[0].reduce((s, p) => s + p[1], 0) / main[0].length;
    for (const i of idx) {
      const [x, y] = main[0][i];
      const len = Math.hypot(cx - x, cy - y) || 1;
      const inset = Math.min(0.4, len * 0.2);
      lights.push([x + ((cx - x) / len) * inset, y + ((cy - y) / len) * inset]);
    }
  }

  // ---- 屋上設備
  const equipment: EquipmentItem[] = [];
  if (input.openSided || input.height < 4 || roofArea < 12) return { axisAngle, roofArea, equipment, lights };

  // 配置済みの矩形（主軸座標系）
  const placed: { u0: number; v0: number; u1: number; v1: number }[] = [];
  const allPts = polygons.flatMap((rings) => rings[0]).map(toAxis);
  const umin = Math.min(...allPts.map((p) => p[0])), umax = Math.max(...allPts.map((p) => p[0]));
  const vmin = Math.min(...allPts.map((p) => p[1])), vmax = Math.max(...allPts.map((p) => p[1]));

  const tryPlace = (type: EquipmentType, w: number, d: number, h: number, rank: number, tries = 25): boolean => {
    for (let t = 0; t < tries; t++) {
      // 縦横を入れ替えて置くこともある（室外機の列など）
      const swap = type === 'acUnits' && rng() < 0.4;
      const ww = swap ? d : w, dd = swap ? w : d;
      const u = umin + ww / 2 + rng() * Math.max(0, umax - umin - ww);
      const v = vmin + dd / 2 + rng() * Math.max(0, vmax - vmin - dd);
      const box = { u0: u - ww / 2, v0: v - dd / 2, u1: u + ww / 2, v1: v + dd / 2 };
      if (placed.some((b) => box.u0 < b.u1 + ITEM_GAP && box.u1 > b.u0 - ITEM_GAP && box.v0 < b.v1 + ITEM_GAP && box.v1 > b.v0 - ITEM_GAP)) continue;
      const corners: Point[] = [[box.u0, box.v0], [box.u1, box.v0], [box.u1, box.v1], [box.u0, box.v1], [u, v]];
      const ok = corners.every((c) => polygons.some((rings) => insideWithClearance(fromAxis(c), rings, EDGE_CLEARANCE)));
      if (!ok) continue;
      placed.push(box);
      const [x, y] = fromAxis([u, v]);
      equipment.push({ type, x, y, w: ww, d: dd, h, angle: axisAngle, rank });
      return true;
    }
    return false;
  };

  const storeys = input.storeys;
  const range = (a: number, b: number) => a + rng() * (b - a);

  // 塔屋（エレベーター機械室・階段室）: 中高層の建物。低い密度でも残るよう rank を小さく
  if (storeys >= 3 && roofArea >= 50) {
    const count = roofArea > 2500 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const w = Math.min(10, Math.max(3, Math.sqrt(roofArea) * range(0.15, 0.24)));
      tryPlace('penthouse', w, Math.min(7, Math.max(2.5, w * range(0.5, 0.8))), range(2.8, 3.8), rng() * 0.1, 40);
    }
  }
  // 冷却塔: 大きなオフィス・商業など
  if (LARGE_ROOF_CATEGORIES.has(input.category) && roofArea >= 500) {
    const count = roofArea > 1500 ? 2 : 1;
    for (let i = 0; i < count; i++) tryPlace('coolingTower', range(3, 4), range(3, 4), range(2.8, 3.6), rng());
  }
  // 受水槽
  if (storeys >= 3 && roofArea >= 60) tryPlace('waterTank', range(2, 3.4), range(2, 3.4), range(2.0, 2.8), rng());
  // キュービクル（受変電設備）
  if (roofArea >= 150) tryPlace('cubicle', range(2, 3), range(1, 1.4), range(1.8, 2.2), rng());
  // 室外機の列
  const rows = Math.min(10, Math.max(1, Math.round(roofArea / 90)));
  for (let i = 0; i < rows; i++) {
    const units = 2 + Math.floor(rng() * 6);
    tryPlace('acUnits', units * 0.95, 0.45, 0.85, rng(), 12);
  }

  return { axisAngle, roofArea, equipment, lights };
}
