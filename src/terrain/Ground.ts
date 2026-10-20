import type { Map as MapLibreMap } from 'maplibre-gl';
import { GROUND_STRIDE, GROUND_TEXTURE_WIDTH, type MeshReference } from '../mesh/layout';

// 建物を MapLibre の地形に載せる。標高は建物ごとに 1 つで、タイルごとの R32F テクスチャ（番号 → 標高 m）に入れ、
// 頂点シェーダで持ち上げる。地形のデータが増えたり視点が変わって描かれる地形が変わったら、引き直してテクスチャだけ更新する
// （メッシュは作り直さない）。

/** 建物 1 つあたりの標高を引く点の数（中心と、外接矩形を内側に寄せた四隅） */
const POINTS_PER_BUILDING = 5;
/** これより小さい建物（外接矩形の対角線 m）は中心だけで引く */
const SMALL_BUILDING = 15;
/** 四隅を中心へ寄せる割合（L 字形などで外の地面を拾いにくくする） */
const CORNER_INSET = 0.25;

export interface TileGround {
  texture: WebGLTexture;
  /** 建物の数 */
  count: number;
  /** 引く点の経緯度（建物ごとに POINTS_PER_BUILDING 点、使わない点は NaN） */
  points: Float64Array;
  values: Float32Array;
  /** 今のテクスチャの中身が対応する地形の版（-1 = まだ引いていない） */
  version: number;
  /** 引いている途中の版と、次に引く建物の番号（時間を区切って少しずつ引く） */
  pendingVersion: number;
  cursor: number;
}

const lngOf = (mercX: number) => mercX * 360 - 180;
const latOfMercY = (mercY: number) => (360 / Math.PI) * Math.atan(Math.exp(Math.PI * (1 - 2 * mercY))) - 90;

export function createTileGround(gl: WebGL2RenderingContext, grounds: Float32Array, reference: MeshReference): TileGround {
  const count = grounds.length / GROUND_STRIDE;
  const rows = Math.max(1, Math.ceil(count / GROUND_TEXTURE_WIDTH));
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create ground texture');
  const values = new Float32Array(rows * GROUND_TEXTURE_WIDTH);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  withPlainUnpack(gl, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, GROUND_TEXTURE_WIDTH, rows, 0, gl.RED, gl.FLOAT, values));

  const { mercX, mercY, meterInMercator: s } = reference;
  const points = new Float64Array(count * POINTS_PER_BUILDING * 2).fill(NaN);
  const set = (i: number, k: number, x: number, y: number) => {
    const o = (i * POINTS_PER_BUILDING + k) * 2;
    points[o] = lngOf(mercX + x * s);
    points[o + 1] = latOfMercY(mercY - y * s);
  };
  for (let i = 0; i < count; i++) {
    const [minX, minY, maxX, maxY] = grounds.subarray(i * GROUND_STRIDE, i * GROUND_STRIDE + 4);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    set(i, 0, cx, cy);
    if (Math.hypot(maxX - minX, maxY - minY) < SMALL_BUILDING) continue;
    const hx = ((maxX - minX) / 2) * (1 - CORNER_INSET);
    const hy = ((maxY - minY) / 2) * (1 - CORNER_INSET);
    set(i, 1, cx - hx, cy - hy);
    set(i, 2, cx + hx, cy - hy);
    set(i, 3, cx + hx, cy + hy);
    set(i, 4, cx - hx, cy + hy);
  }
  return { texture, count, points, values, version: -1, pendingVersion: -1, cursor: 0 };
}

/**
 * 地形の標高を引いてテクスチャを更新する。期限までに終わらなければ途中で止め、次に呼ばれたときに続きから引く。
 * @param elevation 地形がないときは undefined（標高 0 にする）
 * @returns 引き終わった（テクスチャを更新した）か
 */
export function sampleTileGround(
  gl: WebGL2RenderingContext,
  ground: TileGround,
  version: number,
  elevation: ((lng: number, lat: number) => number | null) | undefined,
  deadline: number,
): boolean {
  if (ground.pendingVersion !== version) {
    ground.pendingVersion = version;
    ground.cursor = 0;
  }
  const { points, values, count } = ground;
  let i = ground.cursor;
  if (elevation) {
    for (; i < count; i++) {
      if ((i & 63) === 0 && i > ground.cursor && performance.now() > deadline) {
        ground.cursor = i;
        return false;
      }
      // 建物は一番低い所に合わせる（浮いて見えるより、坂の上側が地面に埋まるほうが自然）
      let min = Infinity;
      for (let k = 0; k < POINTS_PER_BUILDING; k++) {
        const o = (i * POINTS_PER_BUILDING + k) * 2;
        const lng = points[o];
        if (Number.isNaN(lng)) continue;
        const e = elevation(lng, points[o + 1]);
        if (e !== null && Number.isFinite(e)) min = Math.min(min, e);
      }
      values[i] = Number.isFinite(min) ? min : 0;
    }
  } else {
    values.fill(0, 0, count);
  }
  ground.cursor = count;
  ground.version = version;
  const rows = values.length / GROUND_TEXTURE_WIDTH;
  gl.bindTexture(gl.TEXTURE_2D, ground.texture);
  withPlainUnpack(gl, () => gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GROUND_TEXTURE_WIDTH, rows, gl.RED, gl.FLOAT, values));
  return true;
}

/** 地形の標高を引く関数。地形がない・使わないときは undefined */
export function terrainElevation(map: MapLibreMap): ((lng: number, lat: number) => number | null) | undefined {
  if (!map.getTerrain()) return undefined;
  const point: [number, number] = [0, 0];
  return (lng, lat) => {
    point[0] = lng;
    point[1] = lat;
    return map.queryTerrainElevation(point);
  };
}

export function deleteTileGround(gl: WebGL2RenderingContext, ground: TileGround): void {
  gl.deleteTexture(ground.texture);
}

/** MapLibre が設定した転送の状態を一時的に既定に戻して実行する（FLIP_Y などが有効だと配列からの転送がずれる・失敗する） */
export function withPlainUnpack(gl: WebGL2RenderingContext, upload: () => void): void {
  const saved = [gl.UNPACK_ALIGNMENT, gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL].map((p) => [p, gl.getParameter(p) as number | boolean] as const);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  try {
    upload();
  } finally {
    for (const [p, v] of saved) gl.pixelStorei(p, v as number);
  }
}
