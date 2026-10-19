import type { DecoderModule } from 'draco3d';
import type { TileContent } from './content';
import { collectMeshes, fail, jsonUsesDraco, parseGlb, readJson } from './gltf';

// 3D Tiles 1.0 の Batched 3D Model (b3dm) を読み、建物（バッチ）ごとの三角形と属性を取り出す。

const COMPONENT: Record<string, { ctor: new (b: ArrayBuffer, o: number, n: number) => ArrayLike<number> & { BYTES_PER_ELEMENT: number } }> = {
  DOUBLE: { ctor: Float64Array },
  FLOAT: { ctor: Float32Array },
  INT: { ctor: Int32Array },
  UNSIGNED_INT: { ctor: Uint32Array },
  SHORT: { ctor: Int16Array },
  UNSIGNED_SHORT: { ctor: Uint16Array },
  BYTE: { ctor: Int8Array },
  UNSIGNED_BYTE: { ctor: Uint8Array },
};

function readBatchTable(json: Record<string, unknown>, bin: Uint8Array, length: number): Record<string, unknown[]> {
  const table: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(json)) {
    if (Array.isArray(value)) {
      table[key] = value;
    } else if (value && typeof value === 'object' && 'byteOffset' in value) {
      const v = value as { byteOffset: number; componentType: string; type?: string };
      const Ctor = COMPONENT[v.componentType]?.ctor;
      if (!Ctor) continue;
      const comps = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[v.type ?? 'SCALAR'] ?? 1;
      const bytesPer = (Ctor as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
      // アラインメントをそろえるためコピーしてから型付き配列にする
      const copy = bin.slice(v.byteOffset, v.byteOffset + length * comps * bytesPer);
      const arr = Array.from(new Ctor(copy.buffer, 0, length * comps));
      table[key] = comps === 1 ? arr : Array.from({ length }, (_, i) => arr.slice(i * comps, (i + 1) * comps));
    }
  }
  return table;
}

/** b3dm に埋め込まれた glTF に Draco 圧縮が使われているか（wasm を読む前に判定するため） */
export function b3dmUsesDraco(buf: Uint8Array): boolean {
  if (buf.byteLength < 28) return false;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const o = 28 + dv.getUint32(12, true) + dv.getUint32(16, true) + dv.getUint32(20, true) + dv.getUint32(24, true);
  if (o + 20 > buf.byteLength) return false;
  const jsonLength = dv.getUint32(o + 12, true);
  return jsonUsesDraco(readJson(buf.subarray(o + 20, o + 20 + jsonLength)));
}

/**
 * @param transform タイルの transform（ルートからの累積、列優先 4x4）。省略時は単位行列
 */
export function parseB3dm(buf: Uint8Array, draco: DecoderModule | undefined, transform?: ArrayLike<number>): TileContent {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== 'b3dm') fail(`not a b3dm tile: ${magic}`);
  const ftJson = dv.getUint32(12, true);
  const ftBin = dv.getUint32(16, true);
  const btJson = dv.getUint32(20, true);
  const btBin = dv.getUint32(24, true);
  let o = 28;
  const featureTable = readJson(buf.subarray(o, o + ftJson)) as { BATCH_LENGTH?: number; RTC_CENTER?: number[] };
  o += ftJson + ftBin;
  const batchJson = btJson ? (readJson(buf.subarray(o, o + btJson)) as Record<string, unknown>) : {};
  o += btJson;
  const batchBin = buf.subarray(o, o + btBin);
  o += btBin;
  const batchLength = featureTable.BATCH_LENGTH ?? 0;
  const batchTable = readBatchTable(batchJson, batchBin, batchLength);

  const g = parseGlb(buf.subarray(o));
  const rtc = g.json.extensions?.CESIUM_RTC?.center ?? featureTable.RTC_CENTER;
  const meshes = collectMeshes(g, draco, {
    rtc,
    transform,
    featureIdsOf: (_, p) => {
      const ids = p.attributes._BATCHID?.data ?? p.attributes.BATCHID?.data;
      return ids ? { ids, indices: p.indices } : undefined;
    },
  });
  return { batchLength, batchTable, meshes };
}
