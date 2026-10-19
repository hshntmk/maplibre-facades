import type { DecoderModule } from 'draco3d';
import { b3dmUsesDraco, parseB3dm } from './b3dm';
import { parseGlbTile } from './glbTile';
import { fail, jsonUsesDraco, readJson, type TileMesh } from './gltf';

// タイルの中身を形式に応じて読み分ける。3D Tiles 1.0 の b3dm と、1.1 の glb に対応する。

export interface TileContent {
  /** 建物（フィーチャ）の数 */
  batchLength: number;
  /** 属性名 → 各建物の値 */
  batchTable: Record<string, unknown[]>;
  meshes: TileMesh[];
}

export type TileFormat = 'b3dm' | 'glb';

export function tileFormat(buf: Uint8Array): TileFormat {
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic === 'b3dm') return 'b3dm';
  if (magic === 'glTF') return 'glb';
  return fail(`unsupported tile content: ${JSON.stringify(magic)} (b3dm and glb are supported)`);
}

/** タイルが Draco 圧縮を使っているか（wasm を読む前に判定するため） */
export function usesDraco(buf: Uint8Array): boolean {
  if (tileFormat(buf) === 'b3dm') return b3dmUsesDraco(buf);
  if (buf.byteLength < 20) return false;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return jsonUsesDraco(readJson(buf.subarray(20, 20 + dv.getUint32(12, true))));
}

/**
 * @param transform タイルの transform（ルートからの累積、列優先 4x4）。省略時は単位行列
 */
export function parseTileContent(buf: Uint8Array, draco: DecoderModule | undefined, transform?: ArrayLike<number>): TileContent {
  return tileFormat(buf) === 'b3dm' ? parseB3dm(buf, draco, transform) : parseGlbTile(buf, draco, transform);
}
