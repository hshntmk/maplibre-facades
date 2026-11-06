// 描画の方式（MapLibre・Cesium）によらない、レイヤーの定数と小さな関数
import { BUILDING_CATEGORIES } from '../model/BuildingRecord';
import type { RGB } from '../style/FacadeStyle';
import type { BuildingStats } from '../worker/protocol';

/** category: 用途 / style: ファサードスタイル / facade: 壁面の分類（界壁・側壁・正面・日当たり面）と配置された窓 */
export type DebugMode = 'none' | 'category' | 'style' | 'facade';

export const CATEGORY_COLORS: Readonly<Record<(typeof BUILDING_CATEGORIES)[number], RGB>> = {
  unknown: [0.6, 0.6, 0.6],
  office: [0.26, 0.52, 0.96],
  commercial: [0.96, 0.45, 0.2],
  hotel: [0.82, 0.32, 0.75],
  mixed_commercial: [0.95, 0.65, 0.25],
  house: [0.35, 0.78, 0.38],
  apartment: [0.2, 0.68, 0.62],
  mixed_house: [0.75, 0.82, 0.25],
  mixed_apartment: [0.45, 0.85, 0.75],
  public: [0.55, 0.42, 0.9],
  education_welfare: [0.98, 0.82, 0.3],
  warehouse: [0.55, 0.4, 0.3],
  factory: [0.45, 0.3, 0.25],
  utility: [0.4, 0.45, 0.5],
  other: [0.78, 0.78, 0.72],
};

export const STYLE_DEBUG_COLORS: RGB[] = [
  [0.55, 0.55, 0.55], [0.35, 0.35, 0.35], [0.2, 0.75, 0.95], [0.26, 0.45, 0.96], [0.2, 0.68, 0.62], [0.35, 0.78, 0.38],
  [0.75, 0.82, 0.25], [0.96, 0.45, 0.2], [0.82, 0.32, 0.75], [0.55, 0.42, 0.9], [0.55, 0.4, 0.3], [0.9, 0.9, 0.5],
  [0.9, 0.5, 0.5], [0.5, 0.9, 0.9], [0.9, 0.7, 0.9], [0.7, 0.9, 0.6],
];

export const DEBUG_INDEX: Record<DebugMode, number> = { none: 0, category: 1, style: 2, facade: 3 };

/**
 * 細部の部材を描くタイルの条件: タイルのいちばん近い所で 1m が画面上でこのピクセル数以上に見えること。
 * バルコニーは外壁が窓 1 枚分（約 3m）を 10 ピクセル以上で描く所でしか見えない（それより遠くは外壁に手すりを描く）。
 * パラペットの内側（高さ 0.9m 前後）・1 階の部材は 1 ピクセル前後、屋上設備は 2.5m の受水槽が 2 ピクセル前後より小さくなる距離から省く
 */
export const DETAIL_MIN_PX_PER_METER = { balconies: 3, fixtures: 1.5, parapet: 1, equipment: 0.8, trees: 0.3 } as const;

/** 木の季節（シェーダの u_season はこの順の番号） */
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

/** facade 表示の色（シェーダ側の並び: party, side, front, sunSide） */
export const FACADE_COLORS: Readonly<Record<'party' | 'side' | 'front' | 'sunSide', RGB>> = {
  party: [0.86, 0.3, 0.3],
  side: [0.35, 0.55, 0.95],
  front: [0.3, 0.72, 0.42],
  sunSide: [0.98, 0.7, 0.22],
};

/** Worker の数の既定の上限 */
export const MAX_DEFAULT_WORKERS = 4;

/** 既定の Worker の数: CPU のコア数の半分（MapLibre 自身の Worker や描画の分を残す）を 1〜4 に収める */
export function defaultWorkerCount(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(MAX_DEFAULT_WORKERS, Math.floor(cores / 2)));
}

/** タイルごとの統計を合計する */
export function aggregateStats(list: BuildingStats[]): BuildingStats | null {
  if (!list.length) return null;
  const out: BuildingStats = {
    total: 0,
    skipped: 0,
    byCategory: {},
    byStyle: {},
    estimated: { height: 0, storeys: 0, category: 0 },
    facades: { front: 0, side: 0, party: 0, sunSide: 0 },
    bounds: [Infinity, Infinity, -Infinity, -Infinity],
  };
  for (const s of list) {
    out.total += s.total;
    out.skipped += s.skipped;
    for (const [k, v] of Object.entries(s.byCategory)) out.byCategory[k] = (out.byCategory[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.byStyle)) out.byStyle[k] = (out.byStyle[k] ?? 0) + v;
    out.estimated.height += s.estimated.height;
    out.estimated.storeys += s.estimated.storeys;
    out.estimated.category += s.estimated.category;
    out.facades.front += s.facades.front;
    out.facades.side += s.facades.side;
    out.facades.party += s.facades.party;
    out.facades.sunSide += s.facades.sunSide;
    if (s.trees) out.trees = (out.trees ?? 0) + s.trees;
    out.bounds = [
      Math.min(out.bounds[0], s.bounds[0]),
      Math.min(out.bounds[1], s.bounds[1]),
      Math.max(out.bounds[2], s.bounds[2]),
      Math.max(out.bounds[3], s.bounds[3]),
    ];
  }
  return out;
}

/** デバッグ表示の色をシェーダに渡す並び（16 色 × RGB）で out に入れる */
export function fillDebugColors(mode: DebugMode, out: Float32Array): Float32Array {
  if (mode === 'category') BUILDING_CATEGORIES.forEach((c, i) => out.set(CATEGORY_COLORS[c], i * 3));
  else if (mode === 'facade') [FACADE_COLORS.party, FACADE_COLORS.side, FACADE_COLORS.front, FACADE_COLORS.sunSide].forEach((c, i) => out.set(c, i * 3));
  else STYLE_DEBUG_COLORS.forEach((c, i) => out.set(c, i * 3));
  return out;
}
