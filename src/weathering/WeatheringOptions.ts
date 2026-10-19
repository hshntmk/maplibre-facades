import { BuildingWindowLayerError } from '../errors';

// 外壁の経年変化（くすみ）のレイヤー全体の設定。描画時のパラメータなので、変更してもデータの再読み込みは起きない。
// 素材ごとの汚れやすさはスタイルの weathering、建物ごとの古さは建築年（なければ建物ごとのばらつき）で決まる。

export interface WeatheringOptions {
  enabled?: boolean;
  /** 全体の強さ (0–2)。既定 1 */
  strength?: number;
  /** 雨だれ: 窓の下や屋上の縁から下へ伸びる筋 (0–1)。既定 1 */
  streaks?: number;
  /** くすみ: 地面近くの泥はねと、壁全体のゆるやかな濃淡 (0–1)。既定 1 */
  grime?: number;
  /** しみ: 斑状の水の跡 (0–1)。既定 1 */
  stains?: number;
}

export type ResolvedWeatheringOptions = Required<WeatheringOptions>;

export const DEFAULT_WEATHERING_OPTIONS: Readonly<ResolvedWeatheringOptions> = Object.freeze({
  enabled: true,
  strength: 1,
  streaks: 1,
  grime: 1,
  stains: 1,
});

const fail = (message: string): never => {
  throw new BuildingWindowLayerError('options', message);
};
const checkRange = (path: string, v: unknown, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${path} must be a number between ${min} and ${max} (got ${JSON.stringify(v)})`);
};

/** true / false（ON/OFF）か、パラメータのオブジェクト（指定すると ON）を、現在の設定に重ねる */
export function resolveWeatheringOptions(
  value: boolean | WeatheringOptions | undefined,
  base: ResolvedWeatheringOptions = DEFAULT_WEATHERING_OPTIONS,
): ResolvedWeatheringOptions {
  const r: ResolvedWeatheringOptions =
    value === undefined ? { ...base } : typeof value === 'boolean' ? { ...base, enabled: value } : { ...base, ...value, enabled: value.enabled ?? true };
  if (typeof r.enabled !== 'boolean') fail('weathering.enabled must be a boolean');
  checkRange('weathering.strength', r.strength, 0, 2);
  checkRange('weathering.streaks', r.streaks, 0, 1);
  checkRange('weathering.grime', r.grime, 0, 1);
  checkRange('weathering.stains', r.stains, 0, 1);
  return r;
}
