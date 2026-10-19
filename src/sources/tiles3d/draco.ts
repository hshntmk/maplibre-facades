import type { DecoderModule } from 'draco3d';
import createDecoderModule from 'draco3d/draco_decoder_nodejs.js';
import { BuildingFacadeLayerError } from '../../errors';

// Draco 圧縮された glTF プリミティブの展開。JS の部分は Worker に同梱し、wasm は URL から読む（初回のみ）。

const modules = new Map<string, Promise<DecoderModule>>();

export function getDracoModule(wasmUrl: string): Promise<DecoderModule> {
  let p = modules.get(wasmUrl);
  if (!p) {
    p = (async () => {
      const fail = (e: unknown): never => {
        throw new BuildingFacadeLayerError('source', `Failed to load Draco decoder (${wasmUrl}): ${e instanceof Error ? e.message : e}`, { cause: e });
      };
      let wasmBinary: ArrayBuffer;
      try {
        const res = await fetch(wasmUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        wasmBinary = await res.arrayBuffer();
      } catch (e) {
        return fail(e);
      }
      // 開発サーバーなどは存在しないパスに HTML を返すので、wasm でなければ展開する前に知らせる
      const magic = new Uint8Array(wasmBinary, 0, Math.min(4, wasmBinary.byteLength));
      if (magic.length < 4 || magic[0] !== 0x00 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
        return fail('not a WebAssembly file');
      }
      try {
        return await createDecoderModule({ wasmBinary });
      } catch (e) {
        return fail(e);
      }
    })();
    modules.set(wasmUrl, p);
    p.catch(() => modules.delete(wasmUrl));
  }
  return p;
}

export interface DecodedPrimitive {
  indices: Uint32Array;
  /** 属性名 → 値（float32 に展開済み）と成分数 */
  attributes: Record<string, { data: Float32Array; components: number }>;
}

/** KHR_draco_mesh_compression のバッファを展開する。attributeIds は glTF 属性名 → Draco の unique id */
export function decodeDraco(m: DecoderModule, bytes: Uint8Array, attributeIds: Record<string, number>): DecodedPrimitive {
  const decoder = new m.Decoder();
  const buffer = new m.DecoderBuffer();
  const mesh = new m.Mesh();
  try {
    buffer.Init(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.byteLength);
    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    if (!status.ok()) throw new BuildingFacadeLayerError('source', `Draco decode failed: ${status.error_msg()}`);

    const attributes: DecodedPrimitive['attributes'] = {};
    for (const [name, id] of Object.entries(attributeIds)) {
      const attr = decoder.GetAttributeByUniqueId(mesh, id);
      const components = attr.num_components();
      const n = mesh.num_points() * components;
      const ptr = m._malloc(n * 4);
      decoder.GetAttributeDataArrayForAllPoints(mesh, attr, m.DT_FLOAT32, n * 4, ptr);
      attributes[name] = { data: new Float32Array(m.HEAPF32.buffer, ptr, n).slice(), components };
      m._free(ptr);
    }
    const numIdx = mesh.num_faces() * 3;
    const ptr = m._malloc(numIdx * 4);
    decoder.GetTrianglesUInt32Array(mesh, numIdx * 4, ptr);
    const indices = new Uint32Array(m.HEAPU32.buffer, ptr, numIdx).slice();
    m._free(ptr);
    return { indices, attributes };
  } finally {
    m.destroy(mesh);
    m.destroy(buffer);
    m.destroy(decoder);
  }
}
