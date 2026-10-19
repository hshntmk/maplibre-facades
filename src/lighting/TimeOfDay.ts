import { BUILDING_CATEGORIES, type BuildingCategory } from '../model/BuildingRecord';
import type { RGB } from '../style/FacadeStyle';

// 時刻（0–24h）から、昼夜の度合い・太陽方向・空の色・カテゴリ別の点灯率を求める。

/** カテゴリごとの 0 時〜23 時の点灯率 */
type Profile = number[];

const OFFICE: Profile = [0.08, 0.06, 0.05, 0.04, 0.04, 0.05, 0.12, 0.35, 0.75, 0.9, 0.92, 0.92, 0.85, 0.92, 0.92, 0.92, 0.9, 0.88, 0.82, 0.68, 0.5, 0.34, 0.2, 0.12];
const RESIDENTIAL: Profile = [0.22, 0.12, 0.07, 0.05, 0.05, 0.1, 0.28, 0.38, 0.22, 0.12, 0.1, 0.1, 0.12, 0.12, 0.12, 0.14, 0.2, 0.42, 0.62, 0.72, 0.74, 0.7, 0.55, 0.38];
const SHOP: Profile = [0.08, 0.05, 0.04, 0.03, 0.03, 0.04, 0.08, 0.2, 0.45, 0.8, 0.92, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.92, 0.85, 0.7, 0.42, 0.2, 0.12];
const HOTEL: Profile = [0.3, 0.2, 0.12, 0.08, 0.08, 0.12, 0.3, 0.4, 0.3, 0.2, 0.15, 0.15, 0.15, 0.15, 0.2, 0.25, 0.3, 0.42, 0.55, 0.65, 0.7, 0.65, 0.55, 0.42];
const INSTITUTIONAL: Profile = [0.04, 0.03, 0.03, 0.03, 0.03, 0.04, 0.08, 0.3, 0.7, 0.85, 0.85, 0.85, 0.8, 0.85, 0.85, 0.85, 0.8, 0.65, 0.45, 0.3, 0.2, 0.12, 0.07, 0.05];
const INDUSTRIAL: Profile = [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.2, 0.4, 0.7, 0.75, 0.75, 0.75, 0.7, 0.75, 0.75, 0.75, 0.7, 0.55, 0.35, 0.25, 0.2, 0.18, 0.16, 0.15];

const PROFILES: Record<BuildingCategory, Profile> = {
  unknown: RESIDENTIAL.map((v, i) => (v + OFFICE[i]) * 0.4),
  office: OFFICE,
  commercial: SHOP,
  mixed_commercial: SHOP,
  hotel: HOTEL,
  house: RESIDENTIAL,
  apartment: RESIDENTIAL,
  mixed_house: RESIDENTIAL,
  mixed_apartment: RESIDENTIAL,
  public: INSTITUTIONAL,
  education_welfare: INSTITUTIONAL,
  warehouse: INDUSTRIAL,
  factory: INDUSTRIAL,
  utility: INDUSTRIAL,
  other: INSTITUTIONAL.map((v) => v * 0.6),
};

const sample = (p: Profile, hour: number): number => {
  const h = ((hour % 24) + 24) % 24;
  const i = Math.floor(h);
  const t = h - i;
  return p[i] * (1 - t) + p[(i + 1) % 24] * t;
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface LightingState {
  hour: number;
  /** 0 = 昼、1 = 深夜 */
  night: number;
  /** 0 = 日中、1 = 夕焼け・朝焼け */
  twilight: number;
  /** 東・北・上の座標系での太陽方向 */
  sunDir: [number, number, number];
  sunColor: RGB;
  skyZenith: RGB;
  skyHorizon: RGB;
  /** カテゴリ番号ごとの点灯率 */
  litRatio: Float32Array;
  /** 店舗の 1 階が開いている度合い */
  shopOpen: number;
}

export function computeLighting(hour: number): LightingState {
  const h = ((hour % 24) + 24) % 24;
  // 簡易的な太陽の動き（6 時に東、12 時に南、18 時に西）
  const dayPhase = ((h - 6) / 12) * Math.PI; // 0..π が昼
  const elevation = Math.sin(dayPhase) * (Math.PI / 180) * 62;
  const azimuth = Math.PI / 2 + ((h - 6) / 12) * Math.PI; // 北から時計回り。東 → 南 → 西
  const sunDir: [number, number, number] = [
    Math.sin(azimuth) * Math.cos(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
  ];
  const sunHeight = Math.sin(dayPhase); // -1..1
  const night = 1 - smoothstep(-0.18, 0.12, sunHeight);
  const twilight = Math.max(0, 1 - Math.abs(sunHeight - 0.02) / 0.22) * (1 - night * 0.6);

  const daySky: RGB = [0.45, 0.66, 0.92];
  const dayHorizon: RGB = [0.82, 0.88, 0.95];
  const duskSky: RGB = [0.28, 0.32, 0.55];
  const duskHorizon: RGB = [0.98, 0.58, 0.36];
  const nightSky: RGB = [0.015, 0.02, 0.05];
  const nightHorizon: RGB = [0.09, 0.08, 0.14];

  let skyZenith = mix(daySky, duskSky, twilight);
  let skyHorizon = mix(dayHorizon, duskHorizon, twilight);
  skyZenith = mix(skyZenith, nightSky, night);
  skyHorizon = mix(skyHorizon, nightHorizon, night);
  const sunColor = mix([1, 0.97, 0.9], [1, 0.62, 0.38], twilight);

  const litRatio = new Float32Array(16);
  BUILDING_CATEGORIES.forEach((c, i) => {
    litRatio[i] = sample(PROFILES[c], h);
  });

  return {
    hour: h,
    night,
    twilight,
    sunDir,
    sunColor,
    skyZenith,
    skyHorizon,
    litRatio,
    shopOpen: sample(SHOP, h),
  };
}
