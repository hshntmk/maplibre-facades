import { BuildingFacadeLayerError } from '../errors';

// 表面の細部（外壁の素材の凹凸とつや、ガラスの歪み）のレイヤー全体の設定。描画時のパラメータなので、変更してもデータの再読み込みは起きない。
// どの建物にどの素材を使うかはスタイルの wallMaterials で決まる。

export interface SurfaceDetailOptions {
  enabled?: boolean;
  /** 外壁の素材（タイルなど）の凹凸・つや・目地の強さ (0–2)。既定 1 */
  materials?: number;
  /** ガラスの歪み: 1 枚ごとの取り付けの傾きと、複層ガラスのふくらみ・へこみ (0–3)。既定 1 */
  glassDistortion?: number;
}

export type ResolvedSurfaceDetailOptions = Required<SurfaceDetailOptions>;

export const DEFAULT_SURFACE_DETAIL_OPTIONS: Readonly<ResolvedSurfaceDetailOptions> = Object.freeze({
  enabled: true,
  materials: 1,
  glassDistortion: 1,
});

const fail = (message: string): never => {
  throw new BuildingFacadeLayerError('options', message);
};
const checkRange = (path: string, v: unknown, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${path} must be a number between ${min} and ${max} (got ${JSON.stringify(v)})`);
};

/** true / false（ON/OFF）か、パラメータのオブジェクト（指定すると ON）を、現在の設定に重ねる */
export function resolveSurfaceDetailOptions(
  value: boolean | SurfaceDetailOptions | undefined,
  base: ResolvedSurfaceDetailOptions = DEFAULT_SURFACE_DETAIL_OPTIONS,
): ResolvedSurfaceDetailOptions {
  const r: ResolvedSurfaceDetailOptions =
    value === undefined ? { ...base } : typeof value === 'boolean' ? { ...base, enabled: value } : { ...base, ...value, enabled: value.enabled ?? true };
  if (typeof r.enabled !== 'boolean') fail('surfaceDetail.enabled must be a boolean');
  checkRange('surfaceDetail.materials', r.materials, 0, 2);
  checkRange('surfaceDetail.glassDistortion', r.glassDistortion, 0, 3);
  return r;
}
