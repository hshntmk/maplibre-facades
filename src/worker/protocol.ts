import type { AdapterConfig } from '../adapters/BuildingAdapter';
import type { BuildingFacadeLayerErrorCode } from '../errors';
import type { BalconyLayout } from '../mesh/Balconies';
import type { FrontageLayout } from '../mesh/Frontage';
import type { PitchedRoofLayout } from '../mesh/PitchedRoof';
import type { ExposureThresholds } from '../mesh/FacadeAnalyzer';
import type { MaterialTexture } from '../material/WallMaterials';
import type { FacadeLengths, FacadeMesh } from '../mesh/layout';
import type { GeoJsonSourceConfig } from '../sources/SourceConfig';
import type { StyleRule } from '../style/StyleResolver';

// メインスレッド ⇔ Worker のメッセージ。関数は渡せないので、すべて JSON で表せる設定にする。

/** 壁面の解析で隣のタイルの建物を見る範囲（度）。光線の最大距離 40m より少し広く */
export const NEIGHBOR_MARGIN_DEG = 0.0005;

/** 2 つの範囲 [west, south, east, north] が margin（度）以内で重なるか。空の範囲（Infinity）は重ならない */
export const boundsOverlap = (a: readonly number[], b: readonly number[], margin: number): boolean =>
  Number.isFinite(a[0]) && Number.isFinite(b[0]) && a[0] - margin <= b[2] && a[2] + margin >= b[0] && a[1] - margin <= b[3] && a[3] + margin >= b[1];

/** 変換の設定。Worker は最初に 1 回受け取り、以降のタイルに使う */
export interface PipelineConfig {
  adapter: AdapterConfig;
  styleRules: StyleRule[];
  styleNames: string[];
  /** スタイル番号ごとの壁面分類のしきい値（省略時は既定値） */
  exposureThresholds?: ExposureThresholds[];
  /** スタイル番号ごとのバルコニーの設定（省略時はバルコニーの形を作らない） */
  balconies?: BalconyLayout[];
  /** スタイル番号ごとの 1 階の設定（省略時は庇・テント・突き出し看板を作らない） */
  frontages?: FrontageLayout[];
  /** スタイル番号ごとの勾配屋根の割合（勾配屋根のないスタイルは null） */
  pitchedRoofs?: (PitchedRoofLayout | null)[];
}

export interface InitRequest {
  type: 'init';
  config: PipelineConfig;
  /** 3D Tiles の Draco 展開に使う wasm の URL */
  dracoWasmUrl?: string;
  /** 展開したタイルを IndexedDB に保存するときの上限（undefined = 保存しない） */
  tileCache?: { maxBytes: number; maxAgeMs: number };
  /** プール内の番号（0 が起動時の片づけなどを受け持つ） */
  index?: number;
  /** 他の Worker への直通の口。展開したタイルの建物（壁面の解析用）を送り合う */
  peers?: MessagePort[];
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
  /** b3dm の解析・Draco 展開・フットプリントの復元（保存したタイルを使ったときはその読み出し）・共通モデルへの変換 */
  decode: number;
  /** 壁面の解析とメッシュ生成 */
  mesh: number;
  /** ダウンロードしたバイト数（保存したタイルを使ったときは 0） */
  bytes: number;
  /** IndexedDB に保存したタイルを使ったか（ダウンロードと展開を省いた） */
  cached: boolean;
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
  /**
   * メッシュを作ったときに Worker が持っていたタイル（自分で展開したものと、他の Worker から届いたもの）。
   * 隣のタイルがこの中になければ、壁面の判定が古いのでメインスレッドが作り直しを依頼する
   */
  knownTiles: string[];
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
