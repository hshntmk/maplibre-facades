import { BuildingFacadeLayerError } from '../../errors';
import { ecefToGeodetic } from './footprints';
import type { TileBounds } from './Tileset';

// タイルの範囲（boundingVolume）を経緯度と高さの範囲にする。

export interface BoundingVolumeJson {
  region?: number[];
  box?: number[];
  sphere?: number[];
}

const apply = (m: ArrayLike<number> | undefined, x: number, y: number, z: number): [number, number, number] =>
  m ? [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]] : [x, y, z];

/** 中心と半径（ECEF）を経緯度の範囲に直す（近似） */
function boundsFromSphere(cx: number, cy: number, cz: number, radius: number): TileBounds {
  const [lon, lat, h] = ecefToGeodetic(cx, cy, cz);
  const dLat = (radius / 6378137) * (180 / Math.PI);
  const dLon = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat, minHeight: h - radius, maxHeight: h + radius };
}

export function toBounds(bv: BoundingVolumeJson, transform: ArrayLike<number> | undefined): TileBounds {
  if (bv.region) {
    const [w, s, e, n, minH, maxH] = bv.region;
    const deg = 180 / Math.PI;
    return { west: w * deg, south: s * deg, east: e * deg, north: n * deg, minHeight: minH, maxHeight: maxH };
  }
  if (bv.box) {
    const b = bv.box;
    const [cx, cy, cz] = apply(transform, b[0], b[1], b[2]);
    const r = Math.hypot(b[3], b[4], b[5]) + Math.hypot(b[6], b[7], b[8]) + Math.hypot(b[9], b[10], b[11]);
    return boundsFromSphere(cx, cy, cz, r);
  }
  if (bv.sphere) {
    const [cx, cy, cz] = apply(transform, bv.sphere[0], bv.sphere[1], bv.sphere[2]);
    return boundsFromSphere(cx, cy, cz, bv.sphere[3]);
  }
  throw new BuildingFacadeLayerError('source', 'tileset: unsupported bounding volume');
}

