// メッシュの頂点レイアウトと基準点。メインスレッドと Worker の両方から参照する（依存なし）。

/** 壁の頂点（floats）。シェーダの attribute と合わせること */
export const WALL_STRIDE = 24;
// 0-2 pos | 3-4 uv（u: 連続面に沿った距離 m, v: 高さ m） | 5-6 tangent | 7 runLength（負 = 角のない閉じた面）
// 8 runSeed | 9 style | 10 bSeed | 11 floorHeight | 12 category | 13 height
// 14 clearance（前面のあき m） | 15 sunSide | 16 coverHeight（前面をふさぐ建物の高さ m） | 17 age（築年数 0–1、不明は -1）
// 18 ground（タイル内の建物の番号。地形の標高を引く。FacadeMesh.grounds を参照）
// 19 balconyFrom（バルコニーを付ける最初の階。0 = なし） | 20 balconyDepth（奥行き m。正 = 外壁、負 = 引っ込んだ壁、0 = なし）
// 21 runKey・22 buildingKey（1 階の構成を決める 24 ビットの整数。Frontage.ts） | 23 flags（1 = 入口のある連続面, 2 = 勾配屋根）
// 勾配屋根の建物は 13 height が軒までの高さで、上端は屋根面に合わせる（切妻の妻側は三角）
export const WALL_ATTRIBUTES = [
  { location: 0, size: 3, offset: 0 },
  { location: 1, size: 2, offset: 3 },
  { location: 2, size: 4, offset: 5 },
  { location: 3, size: 4, offset: 9 },
  { location: 4, size: 1, offset: 13 },
  { location: 5, size: 4, offset: 14 },
  { location: 6, size: 3, offset: 18 },
  { location: 7, size: 3, offset: 21 },
];

/** バルコニーの床・天井・袖壁・隔て板の頂点（floats） */
export const BALCONY_STRIDE = 15;
// 0-2 pos | 3-5 normal | 6-7 外壁の外向き法線 xy | 8 外壁の面からの奥行き (m) | 9 階の床からの高さ (m)
// 10 天井の高さ（階の床から m） | 11 part（BalconyPart） | 12 style | 13 bSeed | 14 ground
export const BALCONY_ATTRIBUTES = [
  { location: 0, size: 3, offset: 0 },
  { location: 1, size: 3, offset: 3 },
  { location: 2, size: 4, offset: 6 },
  { location: 3, size: 4, offset: 10 },
  { location: 4, size: 1, offset: 14 },
];
/** バルコニーの部位（シェーダの色分けと合わせること） */
export const BALCONY_PARTS = { floor: 0, ceiling: 1, sideWall: 2, partition: 3 } as const;
export type BalconyPart = (typeof BALCONY_PARTS)[keyof typeof BALCONY_PARTS];
/** 階の床からバルコニーの床（スラブの天端）までの高さ (m) */
export const BALCONY_FLOOR = 0.15;
/** 階の床から手すりの天端までの高さ (m) */
export const BALCONY_RAIL = 1.25;
/** 上の階の床からバルコニーの天井（スラブの下端）までの下がり (m) */
export const BALCONY_CEILING_DROP = 0.2;

/** 1 階の立体の部材（庇・テント・突き出し看板）の頂点（floats） */
export const FIXTURE_STRIDE = 12;
// 0-2 pos | 3-5 normal | 6-7 uv | 8 part（FixturePart） | 9 color（色の番号。テントの縞は +0.5） | 10 shop（店の種類 + openKey） | 11 ground
export const FIXTURE_ATTRIBUTES = [
  { location: 0, size: 3, offset: 0 },
  { location: 1, size: 3, offset: 3 },
  { location: 2, size: 4, offset: 6 },
  { location: 3, size: 2, offset: 10 },
];

/** 勾配屋根の頂点（floats） */
export const PITCHED_ROOF_STRIDE = 17;
// 0-2 pos | 3-5 normal | 6-7 uv（u: 軒に沿った面の中心からの距離, v: 軒先から棟へ m） | 8 halfEave（軒先での面の長さの半分） | 9 slope（軒先から棟までの長さ）
// 10 part（0 = 屋根面, 1 = 鼻隠し・破風） | 11 material（ROOF_MATERIALS） | 12 color | 13 solar | 14 style | 15 category | 16 ground
export const PITCHED_ROOF_ATTRIBUTES = [
  { location: 0, size: 3, offset: 0 },
  { location: 1, size: 3, offset: 3 },
  { location: 2, size: 4, offset: 6 },
  { location: 3, size: 4, offset: 10 },
  { location: 4, size: 3, offset: 14 },
];

/** 屋根の頂点（floats） */
export const ROOF_STRIDE = 10;
// 0-2 pos（z は建物の上端。パラペットの分はシェーダで下げる） | 3 style | 4 bSeed | 5 category
// 6 axisAngle（建物の主軸の向き） | 7 roofArea (m²) | 8 height（建物の高さ） | 9 ground
export const ROOF_ATTRIBUTES = [
  { location: 0, size: 3, offset: 0 },
  { location: 1, size: 3, offset: 3 },
  { location: 2, size: 3, offset: 6 },
  { location: 3, size: 1, offset: 9 },
];

/** 屋上設備のインスタンス（floats）。単位立方体をインスタンス描画する */
export const EQUIPMENT_STRIDE = 13;
// 0-1 center xy | 2 top（建物の上端 z） | 3-5 size (w, d, h) | 6 angle | 7 type | 8 rank | 9 style | 10 bSeed | 11 height（建物の高さ）
// 12 ground
export const EQUIPMENT_ATTRIBUTES = [
  { location: 2, size: 3, offset: 0 },
  { location: 3, size: 3, offset: 3 },
  { location: 4, size: 3, offset: 6 },
  { location: 5, size: 3, offset: 9 },
  { location: 6, size: 1, offset: 12 },
];

/** 航空障害灯（floats）。点として描画する */
export const LIGHT_STRIDE = 6;
// 0-2 pos（z は建物の上端） | 3 height（建物の高さ） | 4 phase（点滅の位相） | 5 ground
export const LIGHT_ATTRIBUTES = [
  { location: 0, size: 3, offset: 0 },
  { location: 1, size: 2, offset: 3 },
  { location: 2, size: 1, offset: 5 },
];

/** 建物ごとの地形の標高を引く位置（floats）。番号 = 頂点の ground */
export const GROUND_STRIDE = 4;
// 0-3 フットプリントの外接矩形（局所座標 m）: minX, minY, maxX, maxY
/** 地形の標高を入れるテクスチャの幅。建物の番号 i は (i % 幅, i / 幅) のテクセル */
export const GROUND_TEXTURE_WIDTH = 1024;

export interface MeshReference {
  /** 基準点のメルカトル座標 (0..1) */
  mercX: number;
  mercY: number;
  /** 基準点における 1m のメルカトル単位 */
  meterInMercator: number;
}

/** 壁面の分類ごとの延長 (m) */
export interface FacadeLengths {
  front: number;
  side: number;
  party: number;
  /** front のうち日当たり面 */
  sunSide: number;
}

export interface FacadeMesh {
  reference: MeshReference;
  walls: Float32Array;
  wallIndices: Uint32Array;
  roofs: Float32Array;
  roofIndices: Uint32Array;
  equipment: Float32Array;
  lights: Float32Array;
  /** バルコニーの床・天井・袖壁・隔て板（引っ込んだ壁は walls に入る） */
  balconies: Float32Array;
  balconyIndices: Uint32Array;
  /** 1 階の立体の部材（庇・テント・突き出し看板） */
  fixtures: Float32Array;
  fixtureIndices: Uint32Array;
  /** 戸建ての勾配屋根（切妻・寄棟・片流れ） */
  pitchedRoofs: Float32Array;
  pitchedRoofIndices: Uint32Array;
  /** 建物ごとの地形の標高を引く位置（GROUND_STRIDE ごと） */
  grounds: Float32Array;
}
