// 公開 API。ここから export していないものは内部実装で、予告なく変わる。

export {
  BuildingFacadeLayer,
  CATEGORY_COLORS,
  FACADE_COLORS,
  type BuildingFacadeLayerOptions,
  type BuildingFacadeLayerEvents,
  type TileStatus,
  type DebugMode,
} from './layer/BuildingFacadeLayer';
export { BuildingFacadeLayerError, type BuildingFacadeLayerErrorCode } from './errors';
export { setWorkerUrl, getWorkerUrl } from './worker/createWorker';

// 時刻
export { computeLighting, type LightingState } from './lighting/TimeOfDay';

// スタイル
export { PRESET_STYLES, DEFAULT_STYLE_RULES } from './style/presets';
export type { FacadeStyle, GroundFloor, InteriorPalette, PaletteColor, RGB, RoofFinish, SideWindows } from './style/FacadeStyle';

// 外壁の経年変化
export { DEFAULT_WEATHERING_OPTIONS } from './weathering/WeatheringOptions';
export type { WeatheringOptions, ResolvedWeatheringOptions } from './weathering/WeatheringOptions';

// 表面の細部（外壁の素材・ガラスの歪み）
export { DEFAULT_SURFACE_DETAIL_OPTIONS } from './surface/SurfaceDetailOptions';
export type { SurfaceDetailOptions, ResolvedSurfaceDetailOptions } from './surface/SurfaceDetailOptions';
export { WALL_MATERIALS, type WallMaterialName } from './material/WallMaterials';

// 屋上
export { DEFAULT_ROOF_OPTIONS } from './roof/RoofOptions';
export type {
  RoofOptions,
  ResolvedRoofOptions,
  ParapetOptions,
  RoofFinishOptions,
  RooftopEquipmentOptions,
  AviationLightOptions,
} from './roof/RoofOptions';
export type { StyleRule } from './style/StyleResolver';

// データ（ソース・アダプタ・共通モデル）
export { DEFAULT_DRACO_WASM_URL, DEFAULT_TILE_CACHE_OPTIONS } from './sources/SourceConfig';
export type { SourceConfig, GeoJsonSourceConfig, Tiles3DSourceConfig, TileCacheOptions } from './sources/SourceConfig';
export { clearTileCache, tileCacheUsage } from './worker/TileCache';
export type { AdapterConfig } from './adapters/BuildingAdapter';
export type { DeclarativeAdapterSpec } from './adapters/DeclarativeAdapter';
export { BUILDING_CATEGORIES } from './model/BuildingRecord';
export type { BuildingRecord, BuildingCategory, StructureType, FireResistance } from './model/BuildingRecord';
export type { BuildingStats, TileTiming } from './worker/protocol';
