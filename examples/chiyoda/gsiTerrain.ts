import * as maplibregl from 'maplibre-gl';

// 地理院の標高タイル（PNG）を MapLibre の地形に使う。
// 地理院の形式は h = (R·2¹⁶ + G·2⁸ + B) × 0.01 m（2²³ 以上は負、ちょうど 2²³ は無効値 = 海など）で、
// MapLibre の custom エンコードでは負の値と無効値を扱えないので、読み込み時に Terrarium 形式へ変換する。
// 陸地のないタイルは 404 になるので、標高 0 の平らなタイルを返す。

export const GSI_DEM_PROTOCOL = 'gsidem';
const TILE_SIZE = 256;

let flatTile: Promise<ArrayBuffer> | undefined;

function encodeTerrarium(pixels: Uint8ClampedArray, heightOf: (i: number) => number): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const v = heightOf(i) + 32768;
    pixels[i] = Math.floor(v / 256);
    pixels[i + 1] = Math.floor(v) % 256;
    pixels[i + 2] = Math.floor((v - Math.floor(v)) * 256);
    pixels[i + 3] = 255;
  }
}

async function toPng(image: ImageData): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

function flat(): Promise<ArrayBuffer> {
  flatTile ??= (() => {
    const image = new ImageData(TILE_SIZE, TILE_SIZE);
    encodeTerrarium(image.data, () => 0);
    return toPng(image);
  })();
  return flatTile;
}

/** `gsidem://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png` の形で使えるようにする */
export function registerGsiDemProtocol(): void {
  maplibregl.addProtocol(GSI_DEM_PROTOCOL, async (params, abort) => {
    const url = params.url.replace(`${GSI_DEM_PROTOCOL}://`, 'https://');
    const res = await fetch(url, { signal: abort.signal });
    if (res.status === 404) return { data: await flat() };
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const src = image.data.slice();
    encodeTerrarium(image.data, (i) => {
      const v = src[i] * 65536 + src[i + 1] * 256 + src[i + 2];
      if (v === 8388608) return 0; // 無効値
      return (v > 8388608 ? v - 16777216 : v) * 0.01;
    });
    return { data: await toPng(image) };
  });
}
