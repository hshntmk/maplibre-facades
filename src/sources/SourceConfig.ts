import type { FootprintGeometry } from '../model/BuildingRecord';

/** ソースが返す 1 件分（属性はソース固有のまま。正規化はアダプタの責務） */
export interface SourceFeature {
  properties: Record<string, unknown>;
  geometry: FootprintGeometry;
}

/** 事前に変換した GeoJSON（Polygon / MultiPolygon のフットプリント）を一括で読み込む */
export interface GeoJsonSourceConfig {
  type: 'geojson';
  url: string;
}

/**
 * 3D Tiles（LOD1 の建物。b3dm）を表示範囲に応じて読み込む。
 * 各建物のメッシュからフットプリントと高さを復元して使う。
 */
export interface Tiles3DSourceConfig {
  type: '3dtiles';
  /** tileset.json の URL。区ごとに分かれたデータなど、複数のタイルセットを 1 つのレイヤーで扱うときは配列で渡す */
  url: string | string[];
  /** 詳細なタイルに切り替える画面上の誤差 (px)。小さいほど細かいタイルを読む。既定 16 */
  maximumScreenSpaceError?: number;
  /** 表示していないタイルを保持しておく最大数。既定 48 */
  maxCachedTiles?: number;
  /** Draco 圧縮の展開に使う draco_decoder.wasm の URL。既定は jsDelivr の draco3d@1.5.7 */
  dracoWasmUrl?: string;
  /**
   * 展開したタイル（フットプリントと属性）をブラウザの IndexedDB に保存し、次からはダウンロードと展開を省く（既定 ON）。
   * true / false か、上限を指定するオブジェクト
   */
  cache?: boolean | TileCacheOptions;
}

export interface TileCacheOptions {
  /** 既定 true */
  enabled?: boolean;
  /** 保存する合計の大きさの上限 (MB)。超えたら最後に使った時刻が古いものから捨てる。既定 200 */
  maxSizeMB?: number;
  /** 保存してから使う日数。過ぎたらダウンロードし直す。既定 2 */
  maxAgeDays?: number;
}

export type SourceConfig = GeoJsonSourceConfig | Tiles3DSourceConfig;

export const DEFAULT_DRACO_WASM_URL = 'https://cdn.jsdelivr.net/npm/draco3d@1.5.7/draco_decoder.wasm';
export const DEFAULT_MAX_SSE = 16;
export const DEFAULT_MAX_CACHED_TILES = 48;
export const DEFAULT_TILE_CACHE_OPTIONS: Readonly<Required<TileCacheOptions>> = Object.freeze({ enabled: true, maxSizeMB: 200, maxAgeDays: 2 });

/** cache オプションを既定値で補う。無効なら undefined */
export function resolveTileCacheOptions(cache: boolean | TileCacheOptions | undefined): Required<TileCacheOptions> | undefined {
  const o = cache === undefined || cache === true ? {} : cache === false ? { enabled: false } : cache;
  const resolved = { ...DEFAULT_TILE_CACHE_OPTIONS, ...o };
  return resolved.enabled ? resolved : undefined;
}
