// MapLibre に依存しない部品（`maplibre-facades/core`）。
// 別の描画系（cesium-facades など）から、Worker・メッシュ生成・3D Tiles の読み込み・スタイル・照明・シェーダを使うための入口。
// 中身は内部実装に近く、0.x の間は予告なく変わる。ここから MapLibre 用のコード（layer/BuildingFacadeLayer・terrain/Fog・terrain/terrainElevation）を import しないこと。

// エラー
export { BuildingFacadeLayerError, type BuildingFacadeLayerErrorCode } from './errors';

// Worker とメッセージ
export { createBuildingWorker, setWorkerUrl, getWorkerUrl } from './worker/createWorker';
export * from './worker/protocol';
export { clearTileCache, tileCacheUsage } from './worker/TileCache';
export { markStaleNeighbors, type NeighborTile } from './layer/staleNeighbors';

// 3D Tiles
export { loadTileset, loadTilesets, isVegetationTile, VEGETATION_PREFIX, isFurnitureTile, FURNITURE_PREFIX, type Tileset, type TileNode, type TileBounds } from './sources/tiles3d/Tileset';
export { ecefToGeodetic } from './sources/tiles3d/footprints';
export * from './sources/SourceConfig';
export { selectTilesInView, type TileView, type Selection } from './sources/tiles3d/TileSelector';

// メッシュの頂点レイアウトと、インスタンス描画の元の形
export * from './mesh/layout';
export { treeMesh, unitBox } from './render/gl';

// 建物ごとの地形の標高（R32F のテクスチャ。標高を引く関数は描画系が用意する）
export { createTileGround, sampleTileGround, deleteTileGround, withPlainUnpack, type TileGround } from './terrain/Ground';

// シェーダ（GLSL ES 3.00。u_matrix は局所座標 m → クリップ）
export * from './render/shaders';

// スタイル
export { PRESET_STYLES, DEFAULT_STYLE_RULES } from './style/presets';
export * from './style/FacadeStyle';
export type { StyleRule } from './style/StyleResolver';

// オプション
export { validateLayerOptions, validateStyle, MAX_STYLES } from './layer/validateOptions';
export * from './roof/RoofOptions';
export * from './weathering/WeatheringOptions';
export * from './surface/SurfaceDetailOptions';
export { WALL_MATERIALS, MATERIAL_TEXTURE_SIZE, MAX_WALL_MATERIALS, type WallMaterialName, type MaterialTexture } from './material/WallMaterials';

// 照明
export { computeLighting, type LightingState } from './lighting/TimeOfDay';

// レイヤーの定数と小さな関数
export * from './layer/shared';
export { Evented } from './layer/Evented';

// データモデル
export type { AdapterConfig } from './adapters/BuildingAdapter';
export type { DeclarativeAdapterSpec } from './adapters/DeclarativeAdapter';
export { BUILDING_CATEGORIES } from './model/BuildingRecord';
export type { BuildingRecord, BuildingCategory, StructureType, FireResistance } from './model/BuildingRecord';

// 行列
export * from './math/mat4';
