import type { CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { invert } from '../math/mat4';

// MapLibre の地形の霞（sky の fog-color / horizon-color / fog-ground-blend / horizon-fog-blend）を建物にも同じようにかける。
// MapLibre は地形のシェーダで、近い面を「画面中央の視線が海面に当たる点」に置いた透視投影の深度を霞の奥行きにしている
// （mercator_transform.ts の fogMatrix）。同じ近い面・遠い面を求めて、シェーダで gl_Position.w から同じ深度を計算する。

export interface FogUniforms {
  /** 近い面・遠い面（カメラからの奥行き、ピクセル） */
  range: [number, number];
  /** fog-color, fog-ground-blend */
  color: [number, number, number, number];
  /** horizon-color, horizon-fog-blend */
  horizon: [number, number, number, number];
  /** 0 = 霞なし */
  opacity: number;
}

export const NO_FOG: FogUniforms = { range: [1, 2], color: [1, 1, 1, 1], horizon: [1, 1, 1, 1], opacity: 0 };

/** MapLibre の calculateFogBlendOpacity と同じ: ピッチ 60° 未満は霞なし、70° までにフェードイン */
export function fogBlendOpacity(pitch: number): number {
  if (pitch < 60) return 0;
  if (pitch < 70) return (pitch - 60) / 10;
  return 1;
}

interface ColorLike {
  r: number;
  g: number;
  b: number;
  a: number;
}
interface SkyLike {
  properties?: { get(name: string): unknown };
}

/** 評価済みの sky の値（式やズームによる変化を反映した値）。MapLibre の内部の Style.sky から読む */
function skyProperty(map: MapLibreMap, name: string): unknown {
  const sky = (map as unknown as { style?: { sky?: SkyLike } }).style?.sky;
  return sky?.properties?.get(name);
}

function color(c: unknown): [number, number, number] | undefined {
  const v = c as ColorLike | undefined;
  if (!v || typeof v.r !== 'number') return undefined;
  // MapLibre の Color は乗算済みアルファ
  const a = v.a > 0 ? v.a : 1;
  return [v.r / a, v.g / a, v.b / a];
}

/**
 * このフレームの霞のパラメータ。MapLibre が地面に霞をかけない状況（地形なし・sky なし・globe・ピッチ 60° 未満）では霞なし
 */
export function computeFog(map: MapLibreMap, input: CustomRenderMethodInput, scratch: Float64Array): FogUniforms {
  if (!map.getTerrain() || !map.getSky()) return NO_FOG;
  if ((map.getProjection?.()?.type as unknown) === 'globe') return NO_FOG;
  const opacity = fogBlendOpacity(map.getPitch());
  if (opacity <= 0) return NO_FOG;
  const fogColor = color(skyProperty(map, 'fog-color'));
  const horizonColor = color(skyProperty(map, 'horizon-color'));
  const groundBlend = skyProperty(map, 'fog-ground-blend');
  const horizonBlend = skyProperty(map, 'horizon-fog-blend');
  if (!fogColor || !horizonColor || typeof groundBlend !== 'number' || typeof horizonBlend !== 'number') return NO_FOG;

  // 近い面: 画面中央の視線が海面（z = 0）に当たる点までの奥行き
  const main = input.defaultProjectionData.mainMatrix;
  if (!invert(scratch, main)) return NO_FOG;
  const unproject = (z: number): [number, number, number] => {
    const m = scratch;
    const w = m[11] * z + m[15];
    return [(m[8] * z + m[12]) / w, (m[9] * z + m[13]) / w, (m[10] * z + m[14]) / w];
  };
  const a = unproject(-1);
  const b = unproject(1);
  const cameraToCenter = (0.5 * map.getCanvas().clientHeight) / Math.tan(input.fov / 2);
  let near = cameraToCenter;
  if (a[2] > 0 && b[2] < a[2]) {
    const t = a[2] / (a[2] - b[2]);
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0];
    const w = main[3] * p[0] + main[7] * p[1] + main[11] * p[2] + main[15];
    if (w > 0) near = w;
  }
  near = Math.max(cameraToCenter / 2, near);
  const far = Math.max(input.farZ, near * 1.001);
  return {
    range: [near, far],
    color: [...fogColor, groundBlend],
    horizon: [...horizonColor, horizonBlend],
    opacity,
  };
}
