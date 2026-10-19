import { BuildingFacadeLayerError } from '../errors';
import type { RGB } from '../style/FacadeStyle';

// 屋上表現のレイヤー全体の設定。いずれも描画時のパラメータなので、変更してもデータの再読み込みは起きない。
// 建物の種類ごとの違い（パラペットの有無、仕上げ、緑化・太陽光の割合、設備の多さ）は FacadeStyle 側で指定する。

export interface ParapetOptions {
  enabled?: boolean;
  /** 屋上の縁の立ち上がりの高さ (m)。既定 0.9。建物の高さの 8% を上限とする */
  height?: number;
}

export interface RoofFinishOptions {
  /** 用途別の仕上げ（防水シートの継ぎ目、天窓、屋上緑化、太陽光パネル） */
  enabled?: boolean;
}

export interface RooftopEquipmentOptions {
  enabled?: boolean;
  /**
   * 表示する設備の割合 (0–1)。既定 0.7。建物ごとに最大数まで生成した設備のうち、この割合を表示する
   * （スタイルの rooftopEquipment を掛ける）。塔屋は小さい値でも残りやすい
   */
  density?: number;
}

export interface AviationLightOptions {
  enabled?: boolean;
  /** この高さ (m) 以上の建物の屋上の角に灯す。既定 60（航空法で設置が必要になる高さ） */
  minHeight?: number;
  /** 点滅させるか。既定 true。点滅中は夜間に毎フレーム再描画する */
  blink?: boolean;
  /** 明るさの倍率。既定 1 */
  intensity?: number;
  /** 既定は赤 [1, 0.1, 0.05] */
  color?: RGB;
}

/** 各項目は true / false（ON/OFF）か、パラメータのオブジェクト（指定すると ON） */
export interface RoofOptions {
  parapet?: boolean | ParapetOptions;
  finish?: boolean | RoofFinishOptions;
  equipment?: boolean | RooftopEquipmentOptions;
  aviationLights?: boolean | AviationLightOptions;
}

export interface ResolvedRoofOptions {
  parapet: Required<ParapetOptions>;
  finish: Required<RoofFinishOptions>;
  equipment: Required<RooftopEquipmentOptions>;
  aviationLights: Required<AviationLightOptions>;
}

export const DEFAULT_ROOF_OPTIONS: Readonly<ResolvedRoofOptions> = Object.freeze({
  parapet: { enabled: true, height: 0.9 },
  finish: { enabled: true },
  equipment: { enabled: true, density: 0.7 },
  aviationLights: { enabled: true, minHeight: 60, blink: true, intensity: 1, color: [1, 0.1, 0.05] as RGB },
});

function mergeSection<T extends { enabled?: boolean }>(base: Required<T>, value: boolean | T | undefined): Required<T> {
  if (value === undefined) return { ...base };
  if (typeof value === 'boolean') return { ...base, enabled: value };
  return { ...base, ...value, enabled: value.enabled ?? true } as Required<T>;
}

/** 部分的な指定を、現在の設定（省略時は既定値）に重ねる */
export function resolveRoofOptions(options: RoofOptions | undefined, base: ResolvedRoofOptions = DEFAULT_ROOF_OPTIONS): ResolvedRoofOptions {
  const resolved: ResolvedRoofOptions = {
    parapet: mergeSection(base.parapet, options?.parapet),
    finish: mergeSection(base.finish, options?.finish),
    equipment: mergeSection(base.equipment, options?.equipment),
    aviationLights: mergeSection(base.aviationLights, options?.aviationLights),
  };
  validateRoofOptions(resolved);
  return resolved;
}

const fail = (message: string): never => {
  throw new BuildingFacadeLayerError('options', message);
};
const checkRange = (path: string, v: unknown, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${path} must be a number between ${min} and ${max} (got ${JSON.stringify(v)})`);
};
const checkBool = (path: string, v: unknown) => {
  if (typeof v !== 'boolean') fail(`${path} must be a boolean`);
};

function validateRoofOptions(r: ResolvedRoofOptions): void {
  checkBool('roof.parapet.enabled', r.parapet.enabled);
  checkRange('roof.parapet.height', r.parapet.height, 0, 3);
  checkBool('roof.finish.enabled', r.finish.enabled);
  checkBool('roof.equipment.enabled', r.equipment.enabled);
  checkRange('roof.equipment.density', r.equipment.density, 0, 1);
  checkBool('roof.aviationLights.enabled', r.aviationLights.enabled);
  checkRange('roof.aviationLights.minHeight', r.aviationLights.minHeight, 0, 1000);
  checkBool('roof.aviationLights.blink', r.aviationLights.blink);
  checkRange('roof.aviationLights.intensity', r.aviationLights.intensity, 0, 5);
  const c = r.aviationLights.color;
  if (!Array.isArray(c) || c.length !== 3 || !c.every((x) => typeof x === 'number' && x >= 0 && x <= 1)) {
    fail('roof.aviationLights.color must be an [r, g, b] array with components in 0–1');
  }
}
