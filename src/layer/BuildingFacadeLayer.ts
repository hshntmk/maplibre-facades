import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import type { AdapterConfig } from '../adapters/BuildingAdapter';
import { BuildingFacadeLayerError } from '../errors';
import { computeLighting, type LightingState } from '../lighting/TimeOfDay';
import { createMat4, invert, multiply, translateScale } from '../math/mat4';
import {
  BALCONY_ATTRIBUTES,
  BALCONY_STRIDE,
  EQUIPMENT_ATTRIBUTES,
  EQUIPMENT_STRIDE,
  LIGHT_ATTRIBUTES,
  LIGHT_STRIDE,
  ROOF_ATTRIBUTES,
  ROOF_STRIDE,
  WALL_ATTRIBUTES,
  WALL_STRIDE,
  type MeshReference,
} from '../mesh/layout';
import { BUILDING_CATEGORIES } from '../model/BuildingRecord';
import { createInstancedMesh, createMesh, createPointMesh, createProgram, deleteMesh, unitBox, type MeshBuffers, type Program } from '../render/gl';
import {
  BALCONY_FS,
  BALCONY_VS,
  EQUIPMENT_FS,
  EQUIPMENT_VS,
  FACADE_FS,
  FACADE_VS,
  LIGHT_FS,
  LIGHT_VS,
  PARAPET_FS,
  PARAPET_VS,
  ROOF_FS,
  ROOF_VS,
} from '../render/shaders';
import { resolveRoofOptions, type ResolvedRoofOptions, type RoofOptions } from '../roof/RoofOptions';
import { resolveWeatheringOptions, type ResolvedWeatheringOptions, type WeatheringOptions } from '../weathering/WeatheringOptions';
import { resolveSurfaceDetailOptions, type ResolvedSurfaceDetailOptions, type SurfaceDetailOptions } from '../surface/SurfaceDetailOptions';
import { MATERIAL_TEXTURE_SIZE, MAX_WALL_MATERIALS, WALL_MATERIALS, type MaterialTexture } from '../material/WallMaterials';
import { DEFAULT_MAX_CACHED_TILES, DEFAULT_MAX_SSE, resolveTileCacheOptions, type SourceConfig } from '../sources/SourceConfig';
import { selectTiles } from '../sources/tiles3d/TileSelector';
import { loadTilesets, type TileNode, type Tileset } from '../sources/tiles3d/Tileset';
import { STYLE_TEXELS, balconyLayout, packStyle, type FacadeStyle, type RGB } from '../style/FacadeStyle';
import { DEFAULT_STYLE_RULES, PRESET_STYLES } from '../style/presets';
import type { StyleRule } from '../style/StyleResolver';
import { computeFog, NO_FOG, type FogUniforms } from '../terrain/Fog';
import { createTileGround, deleteTileGround, sampleTileGround, terrainElevation, type TileGround } from '../terrain/Ground';
import { createBuildingWorker } from '../worker/createWorker';
import { markStaleNeighbors } from './staleNeighbors';
import { type BuildingStats, type InitRequest, type TileTiming, type WorkerRequest, type WorkerResponse } from '../worker/protocol';
import { Evented } from './Evented';
import { validateLayerOptions } from './validateOptions';

/** category: 用途 / style: ファサードスタイル / facade: 壁面の分類（界壁・側壁・正面・日当たり面）と配置された窓 */
export type DebugMode = 'none' | 'category' | 'style' | 'facade';

export interface BuildingFacadeLayerOptions {
  /** MapLibre のレイヤー ID */
  id: string;
  source: SourceConfig;
  /** 既定は `{ name: 'plateau' }` */
  adapter?: AdapterConfig;
  /** ファサードスタイルの定義（既定は PRESET_STYLES）。最大 16 種類 */
  styles?: Record<string, FacadeStyle>;
  /** スタイル選択ルール。先にマッチしたものが採用される（既定は DEFAULT_STYLE_RULES） */
  styleRules?: StyleRule[];
  /** 0–24（既定 20） */
  timeOfDay?: number;
  /**
   * 窓・室内・反射・パラペット・屋上設備・航空障害灯などの効果（既定 true）。
   * false にすると単色の箱として、時刻に関係ない固定の陰影で描く（一般的な 3D 建物表示と同じ。比較や軽量表示に）
   */
  effects?: boolean;
  /** インテリアマッピング（既定 true） */
  interior?: boolean;
  /**
   * ガラスの反射の強さ（既定 1）。各スタイルの reflectivity から求めた反射率に掛ける倍率。
   * 0 で反射なし（常に室内が見える）、大きくするほど外の景色が映り込んで中が見えにくくなる。0–3
   */
  reflection?: number;
  /** 屋上の表現（パラペット・仕上げ・設備・航空障害灯）。各項目は true / false かパラメータのオブジェクト */
  roof?: RoofOptions;
  /** 外壁の経年変化（雨だれ・くすみ・しみ）。true / false かパラメータのオブジェクト（既定 ON） */
  weathering?: boolean | WeatheringOptions;
  /**
   * 表面の細部（外壁の素材の凹凸とつや、ガラスの歪み）。true / false かパラメータのオブジェクト（既定 ON）。
   * 素材のテクスチャは初期化時に手続き的に作るので、追加のダウンロードはない
   */
  surfaceDetail?: boolean | SurfaceDetailOptions;
  /**
   * MapLibre の地形（`map.setTerrain()`）があるとき、建物を地面の標高に載せる（既定 true）。
   * 標高は建物ごとに 1 つ（フットプリントの中心と四隅のうち一番低い所）で、斜面でも建物は傾けない。
   * 地形の読み込みや視点の変化で描かれる地形が変わったら、標高を引き直す
   */
  terrain?: boolean;
  /**
   * MapLibre の sky の霞（`fog-color`・`horizon-color`・`fog-ground-blend`・`horizon-fog-blend`）を建物にもかける（既定 true）。
   * MapLibre が地面に霞をかけるとき（地形あり・sky あり・メルカトル・ピッチ 60° 以上）だけ、地面と同じ式でかける
   */
  fog?: boolean;
  /**
   * バルコニーを立体で描く（既定 true）。スタイルの balcony が 0 より大きい建物の、バルコニーのある階で、
   * 外壁の手すりより上を抜き、奥に引っ込んだ窓の面・床・天井・袖壁・隔て板を描く。
   * 窓 1 枚分の区画が画面上で小さい（約 10 ピクセル未満）所では、従来どおり外壁の面に手すりを描く
   */
  balconies?: boolean;
  debug?: DebugMode;
  /** ワーカーの URL。省略時はバンドル内に埋め込んだワーカーを使う（setWorkerUrl() で全体の既定も変えられる） */
  workerUrl?: string | URL;
  /**
   * 3D Tiles の展開とメッシュ生成に使う Worker の数（1–16）。既定は CPU のコア数の半分（1〜4）。
   * GeoJSON は一括で 1 つのメッシュにするので、常に 1
   */
  workers?: number;
}

export interface BuildingFacadeLayerEvents extends Record<string, unknown> {
  /** 最初の表示範囲の読み込みとメッシュ生成が終わった（GeoJSON は全体の読み込み） */
  load: { target: BuildingFacadeLayer; stats: BuildingStats };
  /** タイルを 1 つ読み込んだ（隣のタイルが届いて作り直した場合も含む）。timing は処理時間の内訳（待ち時間は queued） */
  tileload: { target: BuildingFacadeLayer; tileId: string; stats: BuildingStats; timing: TileTiming & { total: number } };
  /** 表示範囲から外れたタイルをキャッシュから捨てた */
  tileunload: { target: BuildingFacadeLayer; tileId: string };
  error: { target: BuildingFacadeLayer; error: BuildingFacadeLayerError };
}

/** タイルの読み込み状況 */
export interface TileStatus {
  /** 今描いているタイル */
  rendered: number;
  /** 読み込み中 */
  loading: number;
  /** 読み込み済み（キャッシュを含む） */
  cached: number;
}

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

const STYLE_DEBUG_COLORS: RGB[] = [
  [0.55, 0.55, 0.55], [0.35, 0.35, 0.35], [0.2, 0.75, 0.95], [0.26, 0.45, 0.96], [0.2, 0.68, 0.62], [0.35, 0.78, 0.38],
  [0.75, 0.82, 0.25], [0.96, 0.45, 0.2], [0.82, 0.32, 0.75], [0.55, 0.42, 0.9], [0.55, 0.4, 0.3], [0.9, 0.9, 0.5],
  [0.9, 0.5, 0.5], [0.5, 0.9, 0.9], [0.9, 0.7, 0.9], [0.7, 0.9, 0.6],
];

const DEBUG_INDEX: Record<DebugMode, number> = { none: 0, category: 1, style: 2, facade: 3 };

/** facade 表示の色（シェーダ側の並び: party, side, front, sunSide） */
export const FACADE_COLORS: Readonly<Record<'party' | 'side' | 'front' | 'sunSide', RGB>> = {
  party: [0.86, 0.3, 0.3],
  side: [0.35, 0.55, 0.95],
  front: [0.3, 0.72, 0.42],
  sunSide: [0.98, 0.7, 0.22],
};

interface Programs {
  facade: Program;
  balconies: Program;
  parapet: Program;
  roof: Program;
  equipment: Program;
  lights: Program;
  styleTexture: WebGLTexture;
  materials: MaterialGpu;
}

/** 外壁の素材のテクスチャ配列と、シェーダに渡す値。中身は Worker で作って後から届く（届くまでは素材なしで描く） */
interface MaterialGpu {
  texture: WebGLTexture;
  ready: boolean;
  periods: Float32Array;
  averages: Float32Array;
  metals: Float32Array;
  tints: Float32Array;
  levels: number;
}

/** 1 タイル分（GeoJSON の場合は全体で 1 つ）の GPU 上のメッシュ */
interface TileGpu {
  reference: MeshReference;
  walls: MeshBuffers;
  roofs: MeshBuffers;
  equipment: MeshBuffers & { instanceCount: number };
  lights: MeshBuffers;
  balconies: MeshBuffers;
  /** 建物ごとの地形の標高 */
  ground: TileGround;
  /** 描画のたびに計算する、局所座標 → クリップの行列とカメラ位置 */
  matrix32: Float32Array;
  eye: [number, number, number];
}

interface TileEntry {
  id: string;
  state: 'loading' | 'ready' | 'failed';
  node?: TileNode;
  gpu?: TileGpu;
  stats?: BuildingStats;
  /** 最新のリクエスト（古い応答を捨てるため） */
  requestId: number;
  /** リクエストを送った時刻（処理時間の計測用） */
  requestedAt: number;
  /** 隣のタイルが届いたので作り直しが必要（表示されたときに作り直す） */
  stale?: boolean;
  /** 作り直しを依頼中 */
  remeshing?: boolean;
  lastUsed: number;
  /** 展開した Worker の番号。建物のデータはこの Worker にあるので、作り直しもここに頼む */
  owner?: number;
  /** 建物の範囲 [west, south, east, north] */
  bounds?: readonly number[];
  /** メッシュを作ったときに Worker が持っていたタイル（隣のタイルが足りているかの判定に使う） */
  known?: Set<string>;
}

/** 同時に読み込むタイルの最大数（Worker 1 つあたり。最低 3） */
const IN_FLIGHT_PER_WORKER = 2;
const MIN_IN_FLIGHT = 3;
/** Worker の数の既定の上限 */
const MAX_DEFAULT_WORKERS = 4;

/** 既定の Worker の数: CPU のコア数の半分（MapLibre 自身の Worker や描画の分を残す）を 1〜4 に収める */
export function defaultWorkerCount(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(MAX_DEFAULT_WORKERS, Math.floor(cores / 2)));
}
/** 同時に読むサブツリー（暗黙的タイリング）の数。小さなファイルなので多めにする */
const MAX_SUBTREES_IN_FLIGHT = 4;
const GEOJSON_TILE = 'geojson';
/** 地形の標高を引く時間の上限（1 フレームあたり ms）。超えたら続きは次のフレームで引く */
const GROUND_BUDGET_MS = 4;
/** 地形のタイルが届いたとき、まとめて引き直すまでの待ち時間 (ms) */
const TERRAIN_SETTLE_MS = 150;

/**
 * 建物の窓を手続き的に描画する MapLibre GL JS のカスタムレイヤー。
 *
 * ```ts
 * const layer = new BuildingFacadeLayer({ id: 'facades', source: { type: 'geojson', url: '/chiyoda.geojson' } });
 * layer.on('load', ({ stats }) => console.log(stats.total));
 * map.addLayer(layer);
 * ```
 */
export class BuildingFacadeLayer extends Evented<BuildingFacadeLayerEvents> implements CustomLayerInterface {
  readonly id: string;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private readonly options: Readonly<BuildingFacadeLayerOptions>;
  private readonly styles: Record<string, FacadeStyle>;
  private readonly styleRules: StyleRule[];
  private readonly _styleNames: readonly string[];
  private lighting: LightingState;
  private interior: boolean;
  private _effects: boolean;
  private _reflection: number;
  private _roof: ResolvedRoofOptions;
  private _weathering: ResolvedWeatheringOptions;
  private _surfaceDetail: ResolvedSurfaceDetailOptions;
  private debug: DebugMode;
  private readonly followTerrain: boolean;
  private _fog: boolean;
  private _balconies: boolean;
  /** 地形の版。地形が変わるたびに増やし、タイルの標高が古ければ引き直す */
  private terrainVersion = 0;
  private terrainTimer?: ReturnType<typeof setTimeout>;
  private readonly fogScratch = createMat4();
  private readonly mapListeners: [string, (e: unknown) => void][] = [];

  private map?: MapLibreMap;
  private gl?: WebGL2RenderingContext;
  private programs?: Programs;
  /** Worker のプール（止まったら空） */
  private workers: Worker[] = [];
  /** Worker ごとの処理中のリクエストの数（新しいタイルは一番空いている Worker に頼む） */
  private workerLoad: number[] = [];
  /** 初期化エラーを知らせたか（どの Worker も同じエラーを返すので 1 回だけ知らせる） */
  private initErrorReported = false;
  private requestId = 0;
  private generation = 0;
  private readonly tiles = new Map<string, TileEntry>();
  private tileset?: Tileset;
  private renderSet: TileEntry[] = [];
  private inFlight = 0;
  /** 読み込み中のサブツリー */
  private readonly expanding = new Set<TileNode>();
  private _loaded = false;

  private readonly model = createMat4();
  private readonly matrix = createMat4();
  private readonly inverse = createMat4();
  private readonly debugColorBuffer = new Float32Array(16 * 3);

  /** @throws {BuildingFacadeLayerError} code = 'options'（設定が不正な場合） */
  constructor(options: BuildingFacadeLayerOptions) {
    super();
    const styles = options.styles ?? PRESET_STYLES;
    const styleRules = options.styleRules ?? DEFAULT_STYLE_RULES;
    validateLayerOptions({ ...options, styles, styleRules });

    this.options = { ...options };
    this.id = options.id;
    this.styles = styles;
    this.styleRules = styleRules;
    this._styleNames = Object.freeze(Object.keys(styles));
    this.lighting = computeLighting(options.timeOfDay ?? 20);
    this.interior = options.interior ?? true;
    this._effects = options.effects ?? true;
    this._reflection = options.reflection ?? 1;
    this._roof = resolveRoofOptions(options.roof);
    this._weathering = resolveWeatheringOptions(options.weathering);
    this._surfaceDetail = resolveSurfaceDetailOptions(options.surfaceDetail);
    this.debug = options.debug ?? 'none';
    this.followTerrain = options.terrain ?? true;
    this._fog = options.fog ?? true;
    this._balconies = options.balconies ?? true;
  }

  // ---------------------------------------------------------------- state

  /** 最初の読み込みが終わっているか */
  get loaded(): boolean {
    return this._loaded;
  }

  /** 今描いている建物の統計（3D Tiles では表示中のタイルの合計。読み込み前は null） */
  get stats(): BuildingStats | null {
    return aggregateStats(this.visibleEntries().map((e) => e.stats!));
  }

  /** タイルの読み込み状況 */
  get tileStatus(): TileStatus {
    let loading = 0, cached = 0;
    for (const e of this.tiles.values()) {
      if (e.state === 'loading') loading++;
      else if (e.state === 'ready') cached++;
    }
    return { rendered: this.visibleEntries().length, loading, cached };
  }

  /** スタイル名の一覧。GPU 上のスタイル番号はこの順番 */
  get styleNames(): readonly string[] {
    return this._styleNames;
  }

  get timeOfDay(): number {
    return this.lighting.hour;
  }

  /** 窓などの効果を描いているか */
  get effects(): boolean {
    return this._effects;
  }

  /** 外壁の経年変化の現在の設定（既定値を補った値） */
  get weathering(): Readonly<ResolvedWeatheringOptions> {
    return this._weathering;
  }

  /** 表面の細部の現在の設定（既定値を補った値） */
  get surfaceDetail(): Readonly<ResolvedSurfaceDetailOptions> {
    return this._surfaceDetail;
  }

  /** 屋上の表現の現在の設定（既定値を補った値） */
  get roof(): Readonly<ResolvedRoofOptions> {
    return this._roof;
  }

  /** ガラスの反射の強さ（レイヤー全体の倍率） */
  get reflection(): number {
    return this._reflection;
  }

  /** 現在の時刻から計算した照明（背景地図や空の色を合わせるのに使う） */
  /** MapLibre の sky の霞を建物にもかけるか */
  get fog(): boolean {
    return this._fog;
  }

  /** バルコニーを立体で描くか */
  get balconies(): boolean {
    return this._balconies;
  }

  get lightingState(): Readonly<LightingState> {
    return this.lighting;
  }

  // ---------------------------------------------------------------- controls

  setTimeOfDay(hour: number): this {
    if (!Number.isFinite(hour)) throw new BuildingFacadeLayerError('options', `timeOfDay must be a finite number (got ${hour})`);
    this.lighting = computeLighting(hour);
    this.map?.triggerRepaint();
    return this;
  }

  /** 窓・室内・反射・屋上などの効果の ON/OFF。OFF では単色の箱として、時刻に関係ない固定の陰影で描く */
  setEffects(enabled: boolean): this {
    if (typeof enabled !== 'boolean') throw new BuildingFacadeLayerError('options', `effects must be a boolean (got ${enabled})`);
    this._effects = enabled;
    this.map?.triggerRepaint();
    return this;
  }

  /** インテリアマッピングの ON/OFF。OFF では窓の中を照明の色の平坦な面で描く */
  setInterior(enabled: boolean): this {
    if (typeof enabled !== 'boolean') throw new BuildingFacadeLayerError('options', `interior must be a boolean (got ${enabled})`);
    this.interior = enabled;
    this.map?.triggerRepaint();
    return this;
  }

  /**
   * 屋上の表現を変える。指定した項目だけが今の設定に重ねられる。
   * ```ts
   * layer.setRoof({ equipment: { density: 0.3 }, aviationLights: false });
   * ```
   */
  setRoof(options: RoofOptions): this {
    this._roof = resolveRoofOptions(options, this._roof);
    this.map?.triggerRepaint();
    return this;
  }

  /**
   * 外壁の経年変化（雨だれ・くすみ・しみ）を変える。指定した項目だけが今の設定に重ねられる。
   * ```ts
   * layer.setWeathering({ strength: 1.5, stains: 0 });
   * layer.setWeathering(false);
   * ```
   */
  setWeathering(options: boolean | WeatheringOptions): this {
    this._weathering = resolveWeatheringOptions(options, this._weathering);
    this.map?.triggerRepaint();
    return this;
  }

  /**
   * 表面の細部（外壁の素材の凹凸とつや、ガラスの歪み）を変える。指定した項目だけが今の設定に重ねられる。
   * ```ts
   * layer.setSurfaceDetail({ materials: 1.5, glassDistortion: 0 });
   * layer.setSurfaceDetail(false);
   * ```
   */
  setSurfaceDetail(options: boolean | SurfaceDetailOptions): this {
    this._surfaceDetail = resolveSurfaceDetailOptions(options, this._surfaceDetail);
    this.map?.triggerRepaint();
    return this;
  }

  /** ガラスの反射の強さ（0–3）。各スタイルの reflectivity に掛ける倍率 */
  /** MapLibre の sky の霞を建物にもかけるか（地形・sky・ピッチの条件は options.fog を参照） */
  setFog(enabled: boolean): this {
    if (typeof enabled !== 'boolean') throw new BuildingFacadeLayerError('options', `fog must be a boolean (got ${enabled})`);
    this._fog = enabled;
    this.map?.triggerRepaint();
    return this;
  }

  /** バルコニーを立体で描くか（形は常に作ってあるので、切り替えてもデータの再読み込みは起きない） */
  setBalconies(enabled: boolean): this {
    if (typeof enabled !== 'boolean') throw new BuildingFacadeLayerError('options', `balconies must be a boolean (got ${enabled})`);
    this._balconies = enabled;
    this.map?.triggerRepaint();
    return this;
  }

  setReflection(strength: number): this {
    if (!Number.isFinite(strength) || strength < 0 || strength > 3) {
      throw new BuildingFacadeLayerError('options', `reflection must be a number between 0 and 3 (got ${strength})`);
    }
    this._reflection = strength;
    this.map?.triggerRepaint();
    return this;
  }

  setDebugMode(mode: DebugMode): this {
    if (!(mode in DEBUG_INDEX)) throw new BuildingFacadeLayerError('options', `unknown debug mode: ${mode}`);
    this.debug = mode;
    this.map?.triggerRepaint();
    return this;
  }

  /** デバッグ表示で使っている色 */
  debugColor(mode: Exclude<DebugMode, 'none'>, key: string): RGB {
    if (mode === 'category') return CATEGORY_COLORS[key as keyof typeof CATEGORY_COLORS] ?? [0.5, 0.5, 0.5];
    if (mode === 'facade') return FACADE_COLORS[key as keyof typeof FACADE_COLORS] ?? [0.5, 0.5, 0.5];
    return STYLE_DEBUG_COLORS[this._styleNames.indexOf(key)] ?? [0.5, 0.5, 0.5];
  }

  // ---------------------------------------------------------------- CustomLayerInterface

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.gl = gl;
    const generation = ++this.generation;
    try {
      this.programs = {
        facade: createProgram(gl, FACADE_VS, FACADE_FS),
        balconies: createProgram(gl, BALCONY_VS, BALCONY_FS),
        parapet: createProgram(gl, PARAPET_VS, PARAPET_FS),
        roof: createProgram(gl, ROOF_VS, ROOF_FS),
        equipment: createProgram(gl, EQUIPMENT_VS, EQUIPMENT_FS),
        lights: createProgram(gl, LIGHT_VS, LIGHT_FS),
        styleTexture: this.createStyleTexture(gl),
        materials: createMaterialGpu(gl),
      };
    } catch (e) {
      this.emitError(new BuildingFacadeLayerError('webgl', e instanceof Error ? e.message : String(e), { cause: e }));
      return;
    }
    if (!this.startWorker()) return;

    // 地形が変わったら建物の標高を引き直す: 地形の設定・誇張の変更、DEM タイルの到着、視点の移動（描かれる地形の詳細度が変わる）
    if (this.followTerrain) {
      const on = (type: string, fn: (e: unknown) => void) => {
        map.on(type as 'terrain', fn);
        this.mapListeners.push([type, fn]);
      };
      on('terrain', () => this.invalidateTerrain(0));
      on('sourcedata', (e) => {
        const ev = e as { sourceId?: string; tile?: unknown };
        if (ev.tile && ev.sourceId === map.getTerrain()?.source) this.invalidateTerrain(TERRAIN_SETTLE_MS);
      });
      on('moveend', () => {
        if (map.getTerrain()) this.invalidateTerrain(TERRAIN_SETTLE_MS);
      });
    }

    const source = this.options.source;
    const resolve = (u: string) => new URL(u, document.baseURI).href;
    const toError = (e: unknown) => (e instanceof BuildingFacadeLayerError ? e : new BuildingFacadeLayerError('source', String(e), { cause: e }));
    if (source.type === 'geojson') {
      const requestId = ++this.requestId;
      this.tiles.set(GEOJSON_TILE, { id: GEOJSON_TILE, state: 'loading', requestId, requestedAt: performance.now(), lastUsed: 0 });
      this.post(0, { type: 'build', requestId, tileId: GEOJSON_TILE, source: { ...source, url: resolve(source.url) } });
    } else {
      const urls = (Array.isArray(source.url) ? source.url : [source.url]).map(resolve);
      loadTilesets(urls).then(
        ({ tileset, failures }) => {
          if (generation !== this.generation) return;
          this.tileset = tileset;
          // 一部のタイルセットが読めなくても、他は表示する
          for (const f of failures) this.emitError(toError(f.error));
          this.map?.triggerRepaint();
        },
        (e) => this.emitError(toError(e)),
      );
    }
  }

  onRemove(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.generation++;
    for (const [type, fn] of this.mapListeners) map.off(type as 'terrain', fn);
    this.mapListeners.length = 0;
    clearTimeout(this.terrainTimer);
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.workerLoad = [];
    for (const e of this.tiles.values()) if (e.gpu) deleteTileGpu(gl, e.gpu);
    this.tiles.clear();
    this.renderSet = [];
    this.tileset = undefined;
    this.inFlight = 0;
    this.expanding.clear();
    this._loaded = false;
    if (this.programs) {
      const p = this.programs;
      for (const prog of [p.facade, p.balconies, p.parapet, p.roof, p.equipment, p.lights]) gl.deleteProgram(prog.program);
      gl.deleteTexture(p.styleTexture);
      gl.deleteTexture(p.materials.texture);
    }
    this.programs = undefined;
    this.gl = undefined;
    this.map = undefined;
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    const programs = this.programs;
    if (!programs) return;
    const main = options.defaultProjectionData.mainMatrix;
    if (this.tileset) this.updateTiles(gl, main, options.fov);

    const tiles = this.visibleEntries().map((e) => e.gpu!);
    if (!tiles.length) return;
    this.updateGround(gl, tiles);
    const fog = this._fog && this.map ? computeFog(this.map, options, this.fogScratch) : NO_FOG;

    // タイルごとに: 局所座標 (m) → メルカトル → クリップ。倍精度で合成してから float32 に落とす（RTC）
    for (const t of tiles) {
      const ref = t.reference;
      const s = ref.meterInMercator;
      translateScale(this.model, [ref.mercX, ref.mercY, 0], [s, -s, s]);
      multiply(this.matrix, main, this.model);
      t.matrix32.set(this.matrix);
      // カメラ位置: 視点は射影後に (0, 0, c, 0) へ写るので、逆行列で戻す
      if (invert(this.inverse, this.matrix)) {
        const m = this.inverse;
        t.eye = [m[8] / m[11], m[9] / m[11], m[10] / m[11]];
      }
    }

    const L = this.lighting;
    const roof = this._roof;
    const debugColors = this.updateDebugColors();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, programs.materials.texture);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, programs.styleTexture);

    const use = (p: Program) => {
      const u = p.uniforms;
      gl.useProgram(p.program);
      gl.uniform1i(u.u_styles, 0);
      gl.uniform3fv(u.u_sunDir, L.sunDir);
      gl.uniform3fv(u.u_sunColor, L.sunColor);
      gl.uniform3fv(u.u_skyZenith, L.skyZenith);
      gl.uniform3fv(u.u_skyHorizon, L.skyHorizon);
      gl.uniform1f(u.u_night, L.night);
      gl.uniform1i(u.u_debug, DEBUG_INDEX[this.debug]);
      gl.uniform3fv(u.u_debugColors, debugColors);
      gl.uniform1f(u.u_parapetHeight, effects && roof.parapet.enabled ? roof.parapet.height : 0);
      gl.uniform1f(u.u_effects, effects ? 1 : 0);
      gl.uniform1i(u.u_ground, 2);
      gl.uniform2fv(u.u_fogRange, fog.range);
      gl.uniform4fv(u.u_fogColor, fog.color);
      gl.uniform4fv(u.u_fogHorizon, fog.horizon);
      gl.uniform1f(u.u_fogOpacity, fog.opacity);
    };
    const effects = this._effects;
    const forEachTile = (p: Program, draw: (t: TileGpu) => void) => {
      for (const t of tiles) {
        gl.uniformMatrix4fv(p.uniforms.u_matrix, false, t.matrix32);
        gl.uniform3fv(p.uniforms.u_eye, t.eye);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, t.ground.texture);
        gl.activeTexture(gl.TEXTURE0);
        draw(t);
      }
    };

    // バルコニーの床・天井・袖壁・隔て板。外壁より先に描く（遠くで外壁の面と深度が並んだときに外壁が勝つように）
    const balconies = effects && this._balconies && this.debug === 'none';
    if (balconies) {
      use(programs.balconies);
      forEachTile(programs.balconies, (t) => {
        if (t.balconies.count === 0) return;
        gl.bindVertexArray(t.balconies.vao);
        gl.drawElements(gl.TRIANGLES, t.balconies.count, gl.UNSIGNED_INT, 0);
      });
    }

    // 壁
    const f = programs.facade;
    use(f);
    gl.uniform1fv(f.uniforms.u_litRatio, L.litRatio);
    gl.uniform1f(f.uniforms.u_shopOpen, L.shopOpen);
    gl.uniform1f(f.uniforms.u_interior, this.interior ? 1 : 0);
    gl.uniform1f(f.uniforms.u_reflection, this._reflection);
    gl.uniform1f(f.uniforms.u_balconies, balconies ? 1 : 0);
    const w = this._weathering;
    gl.uniform4f(f.uniforms.u_weathering, w.enabled ? w.strength : 0, w.streaks, w.grime, w.stains);
    const sd = this._surfaceDetail;
    const mat = programs.materials;
    gl.uniform2f(f.uniforms.u_surface, sd.enabled && mat.ready ? sd.materials : 0, sd.enabled ? sd.glassDistortion : 0);
    gl.uniform1i(f.uniforms.u_materials, 1);
    gl.uniform2fv(f.uniforms.u_materialPeriod, mat.periods);
    gl.uniform2fv(f.uniforms.u_materialAverage, mat.averages);
    gl.uniform1fv(f.uniforms.u_materialMetal, mat.metals);
    gl.uniform4fv(f.uniforms.u_materialTint, mat.tints);
    gl.uniform1f(f.uniforms.u_materialLevels, mat.levels);
    forEachTile(f, (t) => {
      gl.bindVertexArray(t.walls.vao);
      gl.drawElements(gl.TRIANGLES, t.walls.count, gl.UNSIGNED_INT, 0);
    });

    // パラペットの内側（外壁と同じ頂点を使う）
    if (effects) {
      use(programs.parapet);
      forEachTile(programs.parapet, (t) => {
        gl.bindVertexArray(t.walls.vao);
        gl.drawElements(gl.TRIANGLES, t.walls.count, gl.UNSIGNED_INT, 0);
      });
    }

    // 屋根
    use(programs.roof);
    gl.uniform1f(programs.roof.uniforms.u_roofFinish, roof.finish.enabled ? 1 : 0);
    forEachTile(programs.roof, (t) => {
      gl.bindVertexArray(t.roofs.vao);
      gl.drawElements(gl.TRIANGLES, t.roofs.count, gl.UNSIGNED_INT, 0);
    });

    // 屋上設備
    if (effects && roof.equipment.enabled) {
      const e = programs.equipment;
      use(e);
      gl.uniform1f(e.uniforms.u_equipmentEnabled, 1);
      gl.uniform1f(e.uniforms.u_equipmentDensity, roof.equipment.density);
      forEachTile(e, (t) => {
        if (t.equipment.instanceCount === 0) return;
        gl.bindVertexArray(t.equipment.vao);
        gl.drawElementsInstanced(gl.TRIANGLES, t.equipment.count, gl.UNSIGNED_SHORT, 0, t.equipment.instanceCount);
      });
    }

    // 航空障害灯（加算合成、深度は書かない）
    const lights = roof.aviationLights;
    if (effects && lights.enabled && L.night > 0.02) {
      const p = programs.lights;
      const u = p.uniforms;
      use(p);
      gl.uniform1f(u.u_lightsEnabled, 1);
      gl.uniform1f(u.u_lightMinHeight, lights.minHeight);
      gl.uniform1f(u.u_lightIntensity, lights.intensity);
      gl.uniform1f(u.u_lightBlink, lights.blink ? 1 : 0);
      gl.uniform1f(u.u_time, (performance.now() / 1000) % 3600);
      gl.uniform1f(u.u_pixelRatio, this.map?.getPixelRatio() ?? 1);
      gl.uniform3fv(u.u_lightColor, lights.color);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      forEachTile(p, (t) => {
        if (t.lights.count === 0) return;
        gl.bindVertexArray(t.lights.vao);
        gl.drawArrays(gl.POINTS, 0, t.lights.count);
      });
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      // 点滅中は描き続ける
      if (lights.blink) this.map?.triggerRepaint();
    }
    gl.bindVertexArray(null);
  }

  // ---------------------------------------------------------------- internals

  /** 地形が変わった。delay ms 待ってから（その間の変化はまとめて）標高を引き直す */
  private invalidateTerrain(delay: number): void {
    if (this.terrainTimer !== undefined) {
      if (delay > 0) return; // すでに予約済み
      clearTimeout(this.terrainTimer);
    }
    const bump = () => {
      this.terrainTimer = undefined;
      this.terrainVersion++;
      this.map?.triggerRepaint();
    };
    if (delay > 0) this.terrainTimer = setTimeout(bump, delay);
    else bump();
  }

  /** 描くタイルの標高が古ければ引き直す。時間を区切り、終わらなければ次のフレームで続ける */
  private updateGround(gl: WebGL2RenderingContext, tiles: TileGpu[]): void {
    const version = this.terrainVersion;
    const stale = tiles.filter((t) => t.ground.version !== version);
    if (!stale.length || !this.map) return;
    const elevation = this.followTerrain ? terrainElevation(this.map) : undefined;
    const deadline = performance.now() + GROUND_BUDGET_MS;
    for (const t of stale) {
      if (!sampleTileGround(gl, t.ground, version, elevation, deadline)) {
        this.map.triggerRepaint();
        break;
      }
    }
  }

  /** 描くタイル（GeoJSON は全体の 1 つ） */
  private visibleEntries(): TileEntry[] {
    if (this.options.source.type === 'geojson') {
      const e = this.tiles.get(GEOJSON_TILE);
      return e?.gpu ? [e] : [];
    }
    return this.renderSet.filter((e) => e.gpu);
  }

  /** 3D Tiles: 表示するタイルを選び、足りないタイルを読み、使わないタイルを捨てる */
  private updateTiles(gl: WebGL2RenderingContext, main: ArrayLike<number>, fov: number): void {
    const tileset = this.tileset!;
    if (!invert(this.inverse, main)) return;
    const m = this.inverse;
    const position: [number, number, number] = [m[8] / m[11], m[9] / m[11], m[10] / m[11]];
    const source = this.options.source.type === '3dtiles' ? this.options.source : undefined;
    const maxSSE = source?.maximumScreenSpaceError ?? DEFAULT_MAX_SSE;
    const maxCached = source?.maxCachedTiles ?? DEFAULT_MAX_CACHED_TILES;

    const isReady = (node: TileNode) => {
      const state = this.tiles.get(node.id)?.state;
      return state === 'ready' || state === 'failed'; // 失敗したタイルは中身なしとして扱う
    };
    const selection = selectTiles(tileset.root, { matrix: main, position, viewportHeight: gl.drawingBufferHeight, fov }, maxSSE, isReady);

    const now = performance.now();
    // 表示に関わるタイル（兄弟がそろうのを待っている子や、代わりに描いている親を含む）は捨てない
    const inUse = new Set<string>(selection.used.map((n) => n.id));
    for (const id of inUse) {
      const e = this.tiles.get(id);
      if (e) e.lastUsed = now;
    }
    this.renderSet = [];
    for (const node of selection.render) {
      const e = this.tiles.get(node.id);
      if (!e) continue;
      e.lastUsed = now;
      inUse.add(node.id);
      this.renderSet.push(e);
    }
    // Worker が止まったあとは新しいタイルもサブツリーも読まない（読み込み済みのタイルは描き続ける）
    const canLoad = this.workers.length > 0;
    const maxInFlight = Math.max(MIN_IN_FLIGHT, this.workers.length * IN_FLIGHT_PER_WORKER);
    for (const { node } of selection.load) {
      inUse.add(node.id);
      const e = this.tiles.get(node.id);
      if (e) e.lastUsed = now;
      else if (canLoad && this.inFlight < maxInFlight) this.requestTile(node);
    }

    // 暗黙的タイリング: 必要になったサブツリーを読み、届いたら選び直す
    for (const { node } of canLoad ? selection.expand : []) {
      if (this.expanding.size >= MAX_SUBTREES_IN_FLIGHT) break;
      if (this.expanding.has(node) || !node.pending) continue;
      this.expanding.add(node);
      const generation = this.generation;
      node
        .pending()
        .catch((e) => {
          if (generation === this.generation) this.emitError(e instanceof BuildingFacadeLayerError ? e : new BuildingFacadeLayerError('source', String(e), { cause: e }));
        })
        .finally(() => {
          this.expanding.delete(node);
          if (generation === this.generation) this.map?.triggerRepaint();
        });
    }

    // 隣のタイルが届いて判定が古くなったタイルは、表示中のものだけ、タイルの選択が落ち着いてから（読み込み中も、読むべきタイルも、
    // 展開待ちのサブツリーもない）作り直す。読み込みの波の合間に作り直すと、次の波でまた古くなって何度も作り直すことになる
    if (canLoad && this.inFlight === 0 && selection.load.length === 0 && selection.expand.length === 0) {
      let remeshing = [...this.tiles.values()].filter((e) => e.remeshing).length;
      for (const e of this.renderSet) {
        if (remeshing >= this.workers.length) break;
        if (!e.stale || e.remeshing || !e.node) continue;
        e.stale = false;
        e.remeshing = true;
        remeshing++;
        this.requestTile(e.node, true);
      }
    }

    // 使っていない読み込み済みタイルは、古いものから捨てる
    const idle = [...this.tiles.values()].filter((e) => e.state !== 'loading' && !inUse.has(e.id)).sort((a, b) => a.lastUsed - b.lastUsed);
    for (let i = 0; i < idle.length - maxCached; i++) this.unloadTile(idle[i]);

    if (canLoad && !this._loaded && selection.load.length === 0 && selection.expand.length === 0 && this.renderSet.some((e) => e.gpu)) {
      this._loaded = true;
      this.fire('load', { target: this, stats: this.stats! });
    }
  }

  private requestTile(node: TileNode, remesh = false): void {
    if (!this.workers.length) return; // Worker が止まっている（エラーは通知済み）
    const requestId = ++this.requestId;
    const existing = this.tiles.get(node.id);
    let worker: number;
    if (existing && remesh && existing.owner !== undefined) {
      // 作り直しは建物のデータを持っている Worker に頼む
      worker = existing.owner;
      existing.requestId = requestId;
      existing.requestedAt = performance.now();
    } else {
      worker = this.workerLoad.indexOf(Math.min(...this.workerLoad));
      this.tiles.set(node.id, { id: node.id, node, state: 'loading', requestId, requestedAt: performance.now(), lastUsed: performance.now(), owner: worker });
      this.inFlight++;
    }
    this.post(worker, { type: 'tile', requestId, tileId: node.id, url: node.contentUrl!, transform: node.transform, remesh });
  }

  private unloadTile(e: TileEntry): void {
    if (e.gpu && this.gl) deleteTileGpu(this.gl, e.gpu);
    this.tiles.delete(e.id);
    this.broadcast({ type: 'release', tileId: e.id });
    this.fire('tileunload', { target: this, tileId: e.id });
  }

  /** Worker のプールを起動する。Worker どうしは MessageChannel で直接つなぎ、展開したタイルの建物を送り合う */
  private startWorker(): boolean {
    const source = this.options.source;
    const count = source.type === 'geojson' ? 1 : (this.options.workers ?? defaultWorkerCount());
    const workers: Worker[] = [];
    try {
      for (let i = 0; i < count; i++) workers.push(createBuildingWorker(this.options.workerUrl));
    } catch (e) {
      for (const w of workers) w.terminate();
      this.emitError(new BuildingFacadeLayerError('worker', `Failed to start worker: ${e instanceof Error ? e.message : e}`, { cause: e }));
      return false;
    }
    this.workers = workers;
    this.workerLoad = workers.map(() => 0);
    this.initErrorReported = false;
    const generation = this.generation;
    // 全ての組に 1 本ずつ口をつくる（i の peers[j] が j とつながる）
    const peers: MessagePort[][] = workers.map(() => []);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const channel = new MessageChannel();
        peers[i].push(channel.port1);
        peers[j].push(channel.port2);
      }
    }

    const cache = source.type === '3dtiles' ? resolveTileCacheOptions(source.cache) : undefined;
    const init: InitRequest = {
      type: 'init',
      config: {
        adapter: this.options.adapter ?? { name: 'plateau' },
        styleRules: this.styleRules,
        styleNames: [...this._styleNames],
        exposureThresholds: this._styleNames.map((name) => ({
          partyWallMax: this.styles[name].partyWallMax,
          sideWallMax: this.styles[name].sideWallMax,
        })),
        balconies: this._styleNames.map((name) => balconyLayout(this.styles[name])),
      },
      // Worker（埋め込みは Blob URL）からは相対 URL を解決できないので、ページの URL を基準に絶対 URL にして渡す
      dracoWasmUrl: source.type === '3dtiles' && source.dracoWasmUrl ? new URL(source.dracoWasmUrl, document.baseURI).href : undefined,
      tileCache: cache ? { maxBytes: cache.maxSizeMB * 1024 * 1024, maxAgeMs: cache.maxAgeDays * 86400000 } : undefined,
    };
    workers.forEach((worker, i) => {
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onWorkerMessage(i, ev.data);
      worker.onerror = (ev: ErrorEvent) => {
        ev.preventDefault();
        if (generation !== this.generation || !this.workers.length) return;
        this.stopWorker();
        this.emitError(new BuildingFacadeLayerError('worker', `Worker error: ${ev.message || 'failed to load worker script'}`));
      };
      worker.postMessage({ ...init, index: i, peers: peers[i] } satisfies InitRequest, peers[i]);
    });
    workers[0].postMessage({ type: 'materials', size: MATERIAL_TEXTURE_SIZE } satisfies WorkerRequest);
    return true;
  }

  /**
   * Worker を止める（初期化エラー・Worker のエラーのとき）。応答の来ない読み込み中のタイルは捨て、
   * 以降は新しいタイルを依頼しない。読み込み済みのタイルはそのまま描き続ける
   */
  private stopWorker(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.workerLoad = [];
    for (const [id, e] of this.tiles) {
      if (e.state === 'loading') this.tiles.delete(id);
      else e.remeshing = false;
    }
    this.inFlight = 0;
    this.map?.triggerRepaint();
  }

  private post(worker: number, req: WorkerRequest): void {
    const w = this.workers[worker];
    if (!w) return;
    if (req.type === 'tile' || req.type === 'build') this.workerLoad[worker]++;
    w.postMessage(req);
  }

  private broadcast(req: WorkerRequest): void {
    for (const w of this.workers) w.postMessage(req);
  }

  private onWorkerMessage(worker: number, msg: WorkerResponse): void {
    const gl = this.gl;
    if ((msg.type === 'built' || msg.type === 'error') && this.workerLoad[worker] > 0) this.workerLoad[worker]--;
    if (msg.type === 'materials') {
      if (gl && this.programs) {
        uploadMaterials(gl, this.programs.materials, msg.textures);
        this.map?.triggerRepaint();
      }
      return;
    }
    if (msg.type === 'initError') {
      // 設定が不正なので、どのタイルも変換できない。Worker を止めて 1 回だけ知らせる（どの Worker も同じエラーを返す）
      if (this.initErrorReported) return;
      this.initErrorReported = true;
      this.stopWorker();
      this.emitError(new BuildingFacadeLayerError(msg.code, msg.message));
      return;
    }
    const entry = msg.tileId !== undefined ? this.tiles.get(msg.tileId) : undefined;
    // 削除後・キャッシュから捨てた後・古いリクエストの応答は捨てる
    if (!gl || !entry || entry.requestId !== msg.requestId) {
      if (msg.type === 'built' && gl && !entry && msg.tileId !== GEOJSON_TILE) this.broadcast({ type: 'release', tileId: msg.tileId });
      return;
    }
    if (entry.state === 'loading') this.inFlight = Math.max(0, this.inFlight - 1);
    entry.remeshing = false;

    if (msg.type === 'error') {
      entry.state = 'failed';
      const where = entry.node ? ` (tile ${entry.node.contentUrl})` : '';
      this.emitError(new BuildingFacadeLayerError(msg.code, `${msg.message}${where}`));
      this.map?.triggerRepaint();
      return;
    }

    if (entry.gpu) deleteTileGpu(gl, entry.gpu);
    const { mesh, stats } = msg;
    entry.gpu = {
      reference: mesh.reference,
      walls: createMesh(gl, mesh.walls, mesh.wallIndices, WALL_STRIDE, WALL_ATTRIBUTES),
      roofs: createMesh(gl, mesh.roofs, mesh.roofIndices, ROOF_STRIDE, ROOF_ATTRIBUTES),
      equipment: createInstancedMesh(gl, unitBox(), { data: mesh.equipment, stride: EQUIPMENT_STRIDE, attributes: EQUIPMENT_ATTRIBUTES }),
      lights: createPointMesh(gl, mesh.lights, LIGHT_STRIDE, LIGHT_ATTRIBUTES),
      balconies: createMesh(gl, mesh.balconies, mesh.balconyIndices, BALCONY_STRIDE, BALCONY_ATTRIBUTES),
      ground: createTileGround(gl, mesh.grounds, mesh.reference),
      matrix32: new Float32Array(16),
      eye: [0, 0, 0],
    };
    entry.stats = stats;
    entry.state = 'ready';
    this.fire('tileload', { target: this, tileId: entry.id, stats, timing: { ...msg.timing, total: performance.now() - entry.requestedAt } });

    // 隣り合うタイルのどちらかが、相手の建物を見ずにメッシュを作っていたら、壁面の判定が古い（作り直しは updateTiles で表示中のものだけ行う）。
    // Worker は並行して動き、建物は Worker どうしで送り合うので、届く前に作ったメッシュはここで見つけて作り直す
    if (entry.id !== GEOJSON_TILE) {
      entry.bounds = stats.bounds;
      entry.known = new Set(msg.knownTiles);
      markStaleNeighbors(entry, this.tiles.values());
    }

    if (entry.id === GEOJSON_TILE && !this._loaded) {
      this._loaded = true;
      this.fire('load', { target: this, stats });
    }
    this.map?.triggerRepaint();
  }

  private emitError(error: BuildingFacadeLayerError): void {
    if (this.listens('error')) this.fire('error', { target: this, error });
    else console.error(error);
  }

  private createStyleTexture(gl: WebGL2RenderingContext): WebGLTexture {
    const data = new Float32Array(STYLE_TEXELS * 4 * this._styleNames.length);
    this._styleNames.forEach((name, i) => packStyle(this.styles[name], data, i * STYLE_TEXELS * 4));
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to create style texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, STYLE_TEXELS, this._styleNames.length, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private updateDebugColors(): Float32Array {
    const out = this.debugColorBuffer;
    if (this.debug === 'category') BUILDING_CATEGORIES.forEach((c, i) => out.set(CATEGORY_COLORS[c], i * 3));
    else if (this.debug === 'facade') [FACADE_COLORS.party, FACADE_COLORS.side, FACADE_COLORS.front, FACADE_COLORS.sunSide].forEach((c, i) => out.set(c, i * 3));
    else STYLE_DEBUG_COLORS.forEach((c, i) => out.set(c, i * 3));
    return out;
  }
}

/** 外壁の素材のテクスチャ配列（層 = 素材の番号）の領域を用意する。中身は uploadMaterials で入れる */
function createMaterialGpu(gl: WebGL2RenderingContext): MaterialGpu {
  const size = MATERIAL_TEXTURE_SIZE;
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create material texture');
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(size) + 1, gl.RGBA8, size, size, WALL_MATERIALS.length);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  // 壁は浅い角度で見ることが多いので、使えるなら異方性フィルタで目地のつぶれを防ぐ（読み込み回数が増えるので 4 倍まで）
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number));
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return {
    texture,
    ready: false,
    periods: new Float32Array(MAX_WALL_MATERIALS * 2).fill(1),
    averages: new Float32Array(MAX_WALL_MATERIALS * 2).fill(1),
    metals: new Float32Array(MAX_WALL_MATERIALS),
    tints: new Float32Array(MAX_WALL_MATERIALS * 4),
    levels: Math.log2(size),
  };
}

/** Worker で作った素材のテクスチャ（ミップマップ込み）を GPU に入れる */
function uploadMaterials(gl: WebGL2RenderingContext, mat: MaterialGpu, textures: MaterialTexture[]): void {
  // MapLibre が設定した転送の状態を保存して戻す（FLIP_Y / PREMULTIPLY が有効だと配列からの 3D 転送はエラーになる）
  const saved = [gl.UNPACK_ALIGNMENT, gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL].map((p) => [p, gl.getParameter(p) as number | boolean] as const);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const previous = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY) as WebGLTexture | null;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, mat.texture);
  textures.forEach((m, layer) => {
    m.levels.forEach((data, level) => {
      const n = m.size >> level;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, layer, n, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    });
    mat.periods.set(m.period, layer * 2);
    mat.averages.set(m.average, layer * 2);
    mat.metals[layer] = m.metalness;
    mat.tints.set(m.tint, layer * 4);
  });
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, previous);
  for (const [p, v] of saved) gl.pixelStorei(p, v as number);
  mat.ready = true;
}

function deleteTileGpu(gl: WebGL2RenderingContext, t: TileGpu): void {
  for (const mesh of [t.walls, t.roofs, t.equipment, t.lights, t.balconies]) deleteMesh(gl, mesh);
  deleteTileGround(gl, t.ground);
}

/** タイルごとの統計を合計する */
function aggregateStats(list: BuildingStats[]): BuildingStats | null {
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
    out.bounds = [
      Math.min(out.bounds[0], s.bounds[0]),
      Math.min(out.bounds[1], s.bounds[1]),
      Math.max(out.bounds[2], s.bounds[2]),
      Math.max(out.bounds[3], s.bounds[3]),
    ];
  }
  return out;
}
