// データソースに依存しない共通の建物モデル。
// 描画・スタイル判定より後ろの処理は、この型だけを見る。

export const BUILDING_CATEGORIES = [
  'unknown',
  'office',
  'commercial',
  'hotel',
  'mixed_commercial',
  'house',
  'apartment',
  'mixed_house',
  'mixed_apartment',
  'public',
  'education_welfare',
  'warehouse',
  'factory',
  'utility',
  'other',
] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

export const categoryIndex = (c: BuildingCategory): number => BUILDING_CATEGORIES.indexOf(c);

export type StructureType = 'wood' | 'rc' | 'src' | 'steel' | 'light_steel' | 'masonry' | 'unknown';

/** 耐火性能の区分（構造種別とは別の軸。東京都のデータなどで得られる） */
export type FireResistance = 'fireproof' | 'quasi_fireproof' | 'fire_protected' | 'other' | 'unknown';

/** [lng, lat] のリング。最初が外周、以降は穴。終点は始点と重複させない */
export type LngLatRing = [number, number][];

export interface FootprintGeometry {
  kind: 'footprint';
  polygons: LngLatRing[][];
}

export interface BuildingRecord {
  /** ソース内で安定した ID（PLATEAU なら gml:id）。重複除去と乱数シードに使う */
  id: string;
  /** 将来 LOD2 用の MeshGeometry を union で追加する */
  geometry: FootprintGeometry;
  /** 地上からの高さ (m) */
  height: number;
  minHeight: number;
  storeys?: number;
  storeysBelow?: number;
  /** 1 階あたりの高さ (m)。Enricher が埋める */
  floorHeight?: number;
  category: BuildingCategory;
  structure: StructureType;
  fireResistance: FireResistance;
  /** 壁のない建物（車庫・上屋など）。窓を描かない */
  openSided: boolean;
  name?: string;
  yearBuilt?: number;
  floorArea?: number;
  provenance: {
    source: string;
    heightEstimated: boolean;
    storeysEstimated: boolean;
    categoryEstimated: boolean;
  };
  /** ユーザーがスタイル式から参照できる、元データの属性 */
  extras?: Record<string, string | number | boolean>;
}

/** スタイル式（MapLibre expression）から参照できるフラットな属性 */
export function recordToExpressionProperties(r: BuildingRecord): Record<string, unknown> {
  return {
    ...r.extras,
    id: r.id,
    category: r.category,
    structure: r.structure,
    fireResistance: r.fireResistance,
    openSided: r.openSided,
    height: r.height,
    storeys: r.storeys ?? null,
    floorHeight: r.floorHeight ?? null,
    yearBuilt: r.yearBuilt ?? null,
    floorArea: r.floorArea ?? null,
    source: r.provenance.source,
  };
}
