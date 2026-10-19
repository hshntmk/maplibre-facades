import type { AdapterConfig } from '../adapters/BuildingAdapter';
import type { BuildingFacadeLayerErrorCode } from '../errors';
import type { ExposureThresholds } from '../mesh/FacadeAnalyzer';
import type { MaterialTexture } from '../material/WallMaterials';
import type { FacadeLengths, FacadeMesh } from '../mesh/layout';
import type { GeoJsonSourceConfig } from '../sources/SourceConfig';
import type { StyleRule } from '../style/StyleResolver';

// メインスレッド ⇔ Worker のメッセージ。関数は渡せないので、すべて JSON で表せる設定にする。

/** 変換の設定。Worker は最初に 1 回受け取り、以降のタイルに使う */
export interface PipelineConfig {
  adapter: AdapterConfig;
  styleRules: StyleRule[];
  styleNames: string[];
  /** スタイル番号ごとの壁面分類のしきい値（省略時は既定値） */
  exposureThresholds?: ExposureThresholds[];
}

export interface InitRequest {
  type: 'init';
  config: PipelineConfig;
  /** 3D Tiles の Draco 展開に使う wasm の URL */
  dracoWasmUrl?: string;
}

/** GeoJSON を一括で読み、1 つのメッシュにする */
export interface BuildRequest {
  type: 'build';
  requestId: number;
  tileId: string;
  source: GeoJsonSourceConfig;
}

/** 3D Tiles のタイルを 1 つ読み、メッシュにする。remesh なら読み込み済みの建物で作り直す（隣のタイルが届いたとき） */
export interface TileRequest {
  type: 'tile';
  requestId: number;
  tileId: string;
  url: string;
  transform?: number[];
  remesh?: boolean;
}

/** タイルを捨てたので、Worker 側の建物データも捨てる */
export interface ReleaseRequest {
  type: 'release';
  tileId: string;
}

/** 外壁の素材のテクスチャを作る（メインスレッドを止めないよう Worker で作る） */
export interface MaterialsRequest {
  type: 'materials';
  size: number;
}

export type WorkerRequest = InitRequest | BuildRequest | TileRequest | ReleaseRequest | MaterialsRequest;

export interface BuildingStats {
  total: number;
  skipped: number;
  byCategory: Record<string, number>;
  byStyle: Record<string, number>;
  estimated: { height: number; storeys: number; category: number };
  /** 壁面の分類ごとの延長 (m)。正面・側壁（狭い隙間に面する）・界壁（隣と接する）。各建物のスタイルのしきい値で地上部を分類 */
  facades: FacadeLengths;
  bounds: [number, number, number, number];
}

/** タイル 1 つの処理時間 (ms) */
export interface TileTiming {
  /** ダウンロード（作り直しのときは 0） */
  fetch: number;
  /** b3dm の解析・Draco 展開・フットプリントの復元・共通モデルへの変換 */
  decode: number;
  /** 壁面の解析とメッシュ生成 */
  mesh: number;
  /** ダウンロードしたバイト数 */
  bytes: number;
  /** 隣のタイルが届いたための作り直しか */
  remesh: boolean;
  /** 壁面の解析に使った隣のタイルの建物の数 */
  neighbors: number;
}

export interface BuildResponse {
  type: 'built';
  requestId: number;
  tileId: string;
  mesh: FacadeMesh;
  stats: BuildingStats;
  timing: TileTiming;
  /** このタイルの建物が届いたことで、壁面の判定が変わりうる読み込み済みのタイル */
  affected: string[];
}

export interface ErrorResponse {
  type: 'error';
  requestId: number;
  tileId?: string;
  code: BuildingFacadeLayerErrorCode;
  message: string;
}

/** 変換の設定（アダプタ・スタイル選択ルール）が不正。Worker は以降の build / tile を処理しない */
export interface InitErrorResponse {
  type: 'initError';
  code: BuildingFacadeLayerErrorCode;
  message: string;
}

/** WALL_MATERIALS の順のテクスチャ */
export interface MaterialsResponse {
  type: 'materials';
  textures: MaterialTexture[];
}

export type WorkerResponse = BuildResponse | ErrorResponse | InitErrorResponse | MaterialsResponse;
