import type { FacadeStyle } from './FacadeStyle';
import type { StyleRule } from './StyleResolver';

const base: FacadeStyle = {
  weathering: 0.6,
  wallMaterials: { tile: 0.3 },
  wallColors: [
    { color: [0.74, 0.72, 0.7], weight: 3 },   // ライトグレー
    { color: [0.8, 0.75, 0.66], weight: 2 },   // ベージュ
    { color: [0.86, 0.85, 0.82], weight: 2 },  // 白
    { color: [0.6, 0.62, 0.64], weight: 1 },   // グレー
    { color: [0.56, 0.44, 0.36], weight: 1 },  // 茶系タイル
  ],
  wallVariation: 0.3,
  windowSpacing: 3.2,
  windowWidth: 0.5,
  windowHeight: 0.5,
  sill: 0.3,
  mullions: 2,
  wallColor: [0.74, 0.72, 0.7],
  frameColor: [0.42, 0.43, 0.45],
  glassTint: [0.5, 0.56, 0.6],
  reflectivity: 0.25,
  roofColor: [0.45, 0.45, 0.46],
  parapet: true,
  roofFinish: 'membrane',
  greenRoofRatio: 0,
  solarRatio: 0.03,
  rooftopEquipment: 1,
  groundFloor: 'same',
  sideWindows: 'small',
  sunSideBalconies: false,
  partyWallMax: 0.6,
  sideWallMax: 4,
  openAboveRatio: 0.25,
  slabLine: 0,
  balcony: 0,
  curtainWall: false,
  interior: 'office',
  roomDepth: 5,
  curtainRatio: 0.2,
  blindsRatio: 0.3,
  floorCoherence: 0.3,
  windowsPerRoom: 2,
  openPlanRatio: 0.1,
  warmRatio: 0.4,
  litScale: 1,
};

export const PRESET_STYLES: Record<string, FacadeStyle> = {
  generic: base,

  /** 壁のない建物・窓を描かない建物 */
  plain: {
    ...base,
    weathering: 0.7,
    wallMaterials: {},
    windowWidth: 0,
    sideWindows: 'none',
    wallColor: [0.58, 0.58, 0.58],
    wallColors: [[0.58, 0.58, 0.58], [0.5, 0.52, 0.55], [0.66, 0.64, 0.6]],
    parapet: false,
    roofFinish: 'concrete',
    greenRoofRatio: 0,
    solarRatio: 0,
    rooftopEquipment: 0,
  },

  /** 超高層オフィス（全面ガラス） */
  curtainWall: {
    ...base,
    weathering: 0.25,
    wallMaterials: {},
    wallColors: [
      { color: [0.2, 0.24, 0.29], weight: 3 },   // 濃紺
      { color: [0.16, 0.17, 0.19], weight: 2 },  // 黒
      { color: [0.32, 0.34, 0.36], weight: 2 },  // グレー
      { color: [0.36, 0.33, 0.29], weight: 1 },  // ブロンズ
    ],
    glassTints: [
      { color: [0.32, 0.5, 0.7], weight: 3 },    // 青
      { color: [0.36, 0.6, 0.5], weight: 2 },    // 緑
      { color: [0.6, 0.62, 0.64], weight: 2 },   // シルバー
      { color: [0.64, 0.5, 0.34], weight: 1 },   // ブロンズ
    ],
    // 屋上
    greenRoofRatio: 0, solarRatio: 0, rooftopEquipment: 1.4,
    windowSpacing: 1.8,
    windowWidth: 0.96,
    windowHeight: 0.84,
    sill: 0.08,
    mullions: 1,
    wallColor: [0.2, 0.24, 0.29],
    wallVariation: 0.15,
    frameColor: [0.62, 0.65, 0.68],
    glassTint: [0.42, 0.55, 0.64],
    reflectivity: 0.8,
    roofColor: [0.38, 0.4, 0.42],
    groundFloor: 'lobby',
    sideWindows: 'same',
    openAboveRatio: 0.6,
    slabLine: 1,
    curtainWall: true,
    roomDepth: 9,
    curtainRatio: 0,
    blindsRatio: 0.35,
    floorCoherence: 0.85,
    windowsPerRoom: 6,
    openPlanRatio: 0.5,
    warmRatio: 0.08,
  },

  office: {
    ...base,
    weathering: 0.6,
    wallMaterials: { tile: 0.35 },
    wallColors: [
      { color: [0.72, 0.71, 0.68], weight: 3 },  // ライトグレー
      { color: [0.84, 0.84, 0.81], weight: 2 },  // 白
      { color: [0.78, 0.72, 0.62], weight: 2 },  // ベージュ
      { color: [0.58, 0.61, 0.64], weight: 2 },  // 青みのグレー
      { color: [0.42, 0.37, 0.33], weight: 1 },  // 濃い石張り
      { color: [0.6, 0.44, 0.35], weight: 1 },   // れんが色のタイル
    ],
    glassTints: [
      { color: [0.46, 0.55, 0.6], weight: 3 },
      { color: [0.5, 0.56, 0.52], weight: 1 },
      { color: [0.52, 0.52, 0.52], weight: 2 },
    ],
    wallVariation: 0.3,
    // 屋上
    greenRoofRatio: 0, rooftopEquipment: 1.2,
    windowSpacing: 3.2,
    windowWidth: 0.66,
    windowHeight: 0.52,
    sill: 0.3,
    mullions: 2,
    wallColor: [0.72, 0.71, 0.68],
    frameColor: [0.32, 0.34, 0.37],
    glassTint: [0.46, 0.55, 0.6],
    reflectivity: 0.45,
    groundFloor: 'lobby',
    slabLine: 0.5,
    roomDepth: 7,
    curtainRatio: 0,
    blindsRatio: 0.55,
    floorCoherence: 0.75,
    windowsPerRoom: 4,
    openPlanRatio: 0.35,
    warmRatio: 0.12,
  },

  apartment: {
    ...base,
    weathering: 0.7,
    wallMaterials: { tile: 0.6 },
    wallColors: [
      { color: [0.88, 0.84, 0.74], weight: 3 },  // クリーム
      { color: [0.9, 0.9, 0.88], weight: 2 },    // 白
      { color: [0.55, 0.41, 0.31], weight: 2 },  // 茶系タイル
      { color: [0.8, 0.72, 0.6], weight: 2 },    // ベージュ
      { color: [0.74, 0.74, 0.73], weight: 1 },  // ライトグレー
      { color: [0.76, 0.58, 0.46], weight: 1 },  // テラコッタ
    ],
    wallVariation: 0.3,
    // 屋上
    roofFinish: 'concrete', greenRoofRatio: 0, solarRatio: 0.05, rooftopEquipment: 0.8,
    windowSpacing: 3.6,
    windowWidth: 0.52,
    windowHeight: 0.66,
    sill: 0.06,
    mullions: 2,
    wallColor: [0.86, 0.83, 0.77],
    frameColor: [0.62, 0.62, 0.6],
    glassTint: [0.5, 0.55, 0.58],
    reflectivity: 0.12,
    roofColor: [0.5, 0.49, 0.47],
    balcony: 1,
    sunSideBalconies: true,
    interior: 'residential',
    roomDepth: 5,
    curtainRatio: 0.75,
    blindsRatio: 0.1,
    floorCoherence: 0,
    windowsPerRoom: 1,
    openPlanRatio: 0,
    warmRatio: 0.7,
  },

  /** 低層の戸建て（主に防火造・木造） */
  house: {
    ...base,
    weathering: 0.5,
    wallMaterials: {},
    wallColors: [
      { color: [0.8, 0.74, 0.64], weight: 3 },   // ベージュ
      { color: [0.88, 0.87, 0.84], weight: 2 },  // 白
      { color: [0.62, 0.63, 0.62], weight: 2 },  // グレーのサイディング
      { color: [0.5, 0.4, 0.32], weight: 2 },    // 茶
      { color: [0.86, 0.8, 0.62], weight: 1 },   // 淡い黄
      { color: [0.4, 0.44, 0.5], weight: 1 },    // 紺グレー
    ],
    // 屋上
    parapet: false, roofFinish: 'concrete', greenRoofRatio: 0, solarRatio: 0.25, rooftopEquipment: 0.15,
    windowSpacing: 3.0,
    windowWidth: 0.38,
    windowHeight: 0.42,
    sill: 0.36,
    mullions: 2,
    wallColor: [0.8, 0.74, 0.64],
    wallVariation: 0.4,
    frameColor: [0.48, 0.4, 0.32],
    glassTint: [0.48, 0.5, 0.5],
    reflectivity: 0.08,
    roofColor: [0.36, 0.34, 0.33],
    interior: 'residential',
    roomDepth: 3.6,
    curtainRatio: 0.85,
    blindsRatio: 0,
    floorCoherence: 0,
    windowsPerRoom: 1,
    openPlanRatio: 0,
    warmRatio: 0.85,
  },

  /** 店舗併用住宅：1 階が店舗、上階が住居 */
  mixed: {
    ...base,
    weathering: 0.85,
    wallMaterials: { tile: 0.5 },
    wallColors: [
      { color: [0.78, 0.74, 0.7], weight: 3 },   // ベージュグレー
      { color: [0.86, 0.85, 0.82], weight: 2 },  // 白
      { color: [0.56, 0.43, 0.34], weight: 2 },  // 茶系タイル
      { color: [0.66, 0.7, 0.73], weight: 1 },   // 青みのグレー
      { color: [0.42, 0.4, 0.39], weight: 1 },   // 濃いグレー
      { color: [0.82, 0.76, 0.6], weight: 1 },   // 淡い黄土
    ],
    // 屋上
    roofFinish: 'concrete', greenRoofRatio: 0, solarRatio: 0.05, rooftopEquipment: 0.7,
    windowSpacing: 3.2,
    windowWidth: 0.46,
    windowHeight: 0.52,
    sill: 0.3,
    wallColor: [0.78, 0.74, 0.7],
    wallVariation: 0.4,
    groundFloor: 'storefront',
    sideWindows: 'none',
    openAboveRatio: 0.15,
    interior: 'residential',
    roomDepth: 4.5,
    curtainRatio: 0.6,
    blindsRatio: 0.2,
    floorCoherence: 0.1,
    windowsPerRoom: 1,
    openPlanRatio: 0,
    warmRatio: 0.6,
  },

  commercial: {
    ...base,
    weathering: 0.5,
    wallMaterials: { tile: 0.2 },
    wallColors: [
      { color: [0.62, 0.62, 0.64], weight: 3 },  // グレー
      { color: [0.85, 0.85, 0.85], weight: 2 },  // 白
      { color: [0.32, 0.33, 0.35], weight: 2 },  // 濃いグレー
      { color: [0.75, 0.7, 0.62], weight: 1 },   // ベージュ
    ],
    glassTints: [
      { color: [0.4, 0.46, 0.5], weight: 3 },
      { color: [0.48, 0.48, 0.48], weight: 2 },
      { color: [0.5, 0.45, 0.38], weight: 1 },
    ],
    wallVariation: 0.3,
    // 屋上
    greenRoofRatio: 0, solarRatio: 0.02, rooftopEquipment: 1.2,
    windowSpacing: 4.5,
    windowWidth: 0.8,
    windowHeight: 0.5,
    sill: 0.28,
    mullions: 3,
    wallColor: [0.62, 0.62, 0.64],
    frameColor: [0.22, 0.22, 0.24],
    glassTint: [0.4, 0.46, 0.5],
    reflectivity: 0.5,
    groundFloor: 'storefront',
    sideWindows: 'none',
    openAboveRatio: 0.15,
    interior: 'shop',
    roomDepth: 9,
    curtainRatio: 0,
    blindsRatio: 0.1,
    floorCoherence: 0.9,
    windowsPerRoom: 6,
    openPlanRatio: 0.7,
    warmRatio: 0.35,
  },

  hotel: {
    ...base,
    weathering: 0.45,
    wallMaterials: { tile: 0.4 },
    wallColors: [
      { color: [0.86, 0.82, 0.74], weight: 3 },  // クリーム
      { color: [0.78, 0.78, 0.76], weight: 2 },  // ライトグレー
      { color: [0.58, 0.45, 0.36], weight: 2 },  // 茶
      { color: [0.9, 0.9, 0.88], weight: 1 },    // 白
    ],
    // 屋上
    greenRoofRatio: 0, solarRatio: 0.02,
    windowSpacing: 2.6,
    windowWidth: 0.46,
    windowHeight: 0.52,
    sill: 0.3,
    wallColor: [0.82, 0.8, 0.76],
    groundFloor: 'lobby',
    interior: 'residential',
    roomDepth: 5,
    curtainRatio: 0.9,
    blindsRatio: 0,
    floorCoherence: 0,
    windowsPerRoom: 1,
    openPlanRatio: 0,
    warmRatio: 0.9,
  },

  /** 官公庁・学校・病院など */
  institutional: {
    ...base,
    weathering: 0.65,
    wallMaterials: { tile: 0.3 },
    wallColors: [
      { color: [0.72, 0.71, 0.68], weight: 3 },  // コンクリート
      { color: [0.62, 0.42, 0.33], weight: 2 },  // れんが
      { color: [0.8, 0.76, 0.68], weight: 2 },   // ベージュ
      { color: [0.86, 0.86, 0.84], weight: 1 },  // 白
    ],
    // 屋上
    greenRoofRatio: 0, solarRatio: 0.25,
    windowSpacing: 3.4,
    windowWidth: 0.72,
    windowHeight: 0.5,
    sill: 0.3,
    wallColor: [0.78, 0.76, 0.72],
    frameColor: [0.55, 0.56, 0.56],
    groundFloor: 'lobby',
    sideWindows: 'same',
    slabLine: 0.6,
    roomDepth: 7,
    curtainRatio: 0.1,
    blindsRatio: 0.3,
    floorCoherence: 0.8,
    windowsPerRoom: 3,
    openPlanRatio: 0.1,
    warmRatio: 0.1,
  },

  industrial: {
    ...base,
    weathering: 0.85,
    wallMaterials: {},
    wallColors: [
      { color: [0.62, 0.63, 0.62], weight: 3 },  // グレー
      { color: [0.6, 0.66, 0.7], weight: 2 },    // 青みのグレー
      { color: [0.8, 0.77, 0.68], weight: 1 },   // クリーム
    ],
    // 屋上
    roofFinish: 'skylights', greenRoofRatio: 0, solarRatio: 0.3, rooftopEquipment: 0.6,
    windowSpacing: 6,
    windowWidth: 0.26,
    windowHeight: 0.16,
    sill: 0.7,
    mullions: 1,
    wallColor: [0.62, 0.63, 0.62],
    roofColor: [0.5, 0.52, 0.52],
    sideWindows: 'none',
    interior: 'warehouse',
    roomDepth: 12,
    curtainRatio: 0,
    blindsRatio: 0,
    floorCoherence: 0.9,
    windowsPerRoom: 8,
    openPlanRatio: 0.8,
    warmRatio: 0.2,
    litScale: 0.6,
  },
};

/**
 * 共通モデルの属性だけを参照するルール（先にマッチしたものが採用される）。
 * データソースが変わってもこのルールはそのまま使える。
 */
export const DEFAULT_STYLE_RULES: StyleRule[] = [
  { when: ['==', ['get', 'openSided'], true], style: 'plain' },
  {
    when: ['all', ['in', ['get', 'category'], ['literal', ['office', 'hotel', 'mixed_commercial']]], ['>=', ['get', 'height'], 60]],
    style: 'curtainWall',
  },
  { when: ['==', ['get', 'category'], 'office'], style: 'office' },
  { when: ['in', ['get', 'category'], ['literal', ['apartment', 'mixed_apartment']]], style: 'apartment' },
  { when: ['all', ['==', ['get', 'category'], 'house'], ['<=', ['get', 'storeys'], 3]], style: 'house' },
  { when: ['==', ['get', 'category'], 'house'], style: 'apartment' },
  { when: ['==', ['get', 'category'], 'mixed_house'], style: 'mixed' },
  { when: ['==', ['get', 'category'], 'hotel'], style: 'hotel' },
  { when: ['in', ['get', 'category'], ['literal', ['commercial', 'mixed_commercial']]], style: 'commercial' },
  { when: ['in', ['get', 'category'], ['literal', ['public', 'education_welfare']]], style: 'institutional' },
  { when: ['in', ['get', 'category'], ['literal', ['warehouse', 'factory', 'utility']]], style: 'industrial' },
  { when: true, style: 'generic' },
];
