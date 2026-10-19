import type { DecoderModule } from 'draco3d';
import { BuildingWindowLayerError } from '../../errors';
import { decodeDraco, type DecodedPrimitive } from './draco';

// タイルの中身の glTF (GLB) を読む。3D Tiles 1.0 の b3dm に埋め込まれたものと、1.1 の glb タイルで共通。

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  extensions?: {
    KHR_draco_mesh_compression?: { bufferView: number; attributes: Record<string, number> };
    EXT_mesh_features?: { featureIds: FeatureIdJson[] };
  } & Record<string, unknown>;
}

export interface FeatureIdJson {
  featureCount: number;
  nullFeatureId?: number;
  /** 頂点属性 _FEATURE_ID_n の n。texture も attribute もなければ頂点番号が ID */
  attribute?: number;
  texture?: unknown;
  propertyTable?: number;
}

export interface GltfJson {
  meshes?: { primitives: GltfPrimitive[] }[];
  nodes?: { mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }[];
  scenes?: { nodes: number[] }[];
  scene?: number;
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  extensions?: Record<string, unknown> & { CESIUM_RTC?: { center?: number[] } };
  extensionsUsed?: string[];
}

export interface Gltf {
  json: GltfJson;
  bin: Uint8Array;
}

export const fail = (message: string): never => {
  throw new BuildingWindowLayerError('source', message);
};

const decoder = new TextDecoder();
export const readJson = (bytes: Uint8Array) => JSON.parse(decoder.decode(bytes).replace(/\0+$/, '').trim() || '{}');

export function parseGlb(glb: Uint8Array): Gltf {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.byteLength < 12 || dv.getUint32(0, true) !== 0x46546c67) fail('tile content is not a GLB');
  let o = 12;
  let json: GltfJson | undefined;
  let bin: Uint8Array = new Uint8Array(0);
  while (o + 8 <= glb.byteLength) {
    const len = dv.getUint32(o, true);
    const type = dv.getUint32(o + 4, true);
    const chunk = glb.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = readJson(chunk);
    else if (type === 0x004e4942) bin = chunk;
    o += 8 + len;
  }
  if (!json) fail('glTF JSON chunk is missing');
  return { json: json!, bin };
}

/** bufferView のバイト列（GLB の BIN チャンク内のものだけ扱う） */
export function bufferViewBytes(g: Gltf, index: number): Uint8Array {
  const view = g.json.bufferViews?.[index] ?? fail(`glTF bufferView ${index} not found`);
  const start = view.byteOffset ?? 0;
  return g.bin.subarray(start, start + view.byteLength);
}

const GL_COMPONENT: Record<number, new (b: ArrayBuffer, o: number, n: number) => ArrayLike<number>> = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** 圧縮されていない accessor を float32 に読み出す */
function readAccessor(g: Gltf, index: number): { data: Float32Array; components: number } {
  const acc = g.json.accessors?.[index] ?? fail(`glTF accessor ${index} not found`);
  const components = TYPE_SIZE[acc.type] ?? 1;
  const out = new Float32Array(acc.count * components);
  if (acc.bufferView === undefined) return { data: out, components };
  const view = g.json.bufferViews?.[acc.bufferView] ?? fail(`glTF bufferView ${acc.bufferView} not found`);
  const Ctor = GL_COMPONENT[acc.componentType] ?? fail(`unsupported componentType ${acc.componentType}`);
  const bytesPer = (Ctor as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
  const stride = view.byteStride ?? components * bytesPer;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    const copy = g.bin.slice(base + i * stride, base + i * stride + components * bytesPer);
    const v = new Ctor(copy.buffer, 0, components);
    for (let c = 0; c < components; c++) out[i * components + c] = v[c];
  }
  return { data: out, components };
}

export function readPrimitive(g: Gltf, prim: GltfPrimitive, draco: DecoderModule | undefined): DecodedPrimitive {
  const ext = prim.extensions?.KHR_draco_mesh_compression;
  if (ext) {
    if (!draco) fail('Draco decoder is not available');
    return decodeDraco(draco!, bufferViewBytes(g, ext.bufferView), ext.attributes);
  }
  const attributes: DecodedPrimitive['attributes'] = {};
  for (const [name, index] of Object.entries(prim.attributes)) attributes[name] = readAccessor(g, index);
  const count = attributes.POSITION?.data.length / 3;
  const indices = prim.indices !== undefined ? Uint32Array.from(readAccessor(g, prim.indices).data) : Uint32Array.from({ length: count }, (_, i) => i);
  return { indices, attributes };
}

/** glTF の JSON チャンクに Draco 圧縮が使われているか */
export function jsonUsesDraco(json: GltfJson): boolean {
  return (json.extensionsUsed ?? []).includes('KHR_draco_mesh_compression');
}

export interface TileMesh {
  /** ECEF 座標 (m) */
  positions: Float64Array;
  /** 頂点ごとの建物（フィーチャ）の番号 */
  batchIds: Float32Array;
  indices: Uint32Array;
}

/**
 * シーンのノードをたどり、三角形のプリミティブを ECEF 座標のメッシュにする。
 * @param featureIdsOf プリミティブから頂点ごとの建物の番号を返す。undefined ならそのプリミティブは使わない
 */
export function collectMeshes(
  g: Gltf,
  draco: DecoderModule | undefined,
  options: { rtc?: ArrayLike<number>; transform?: ArrayLike<number>; featureIdsOf: (prim: GltfPrimitive, decoded: DecodedPrimitive) => { ids: Float32Array; indices: Uint32Array } | undefined },
): TileMesh[] {
  const rtc = options.rtc ?? [0, 0, 0];
  const t = options.transform;
  const meshes: TileMesh[] = [];
  const sceneNodes = g.json.scenes?.[g.json.scene ?? 0]?.nodes ?? (g.json.nodes ?? []).map((_, i) => i);
  const visit = (nodeIndex: number, parent: number[] | null) => {
    const node = g.json.nodes?.[nodeIndex];
    if (!node) return;
    const own = node.matrix ?? trsMatrix(node.translation, node.rotation, node.scale);
    const local = own ? (parent ? multiply4(parent, own) : own) : parent;
    if (node.mesh !== undefined) {
      for (const prim of g.json.meshes?.[node.mesh]?.primitives ?? []) {
        if ((prim.mode ?? 4) !== 4) continue; // 三角形のみ
        const p = readPrimitive(g, prim, draco);
        const pos = p.attributes.POSITION?.data;
        const features = pos ? options.featureIdsOf(prim, p) : undefined;
        if (!pos || !features) continue;
        const n = pos.length / 3;
        const positions = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) {
          let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
          if (local) [x, y, z] = apply4(local, x, y, z);
          // glTF は Y-up。3D Tiles の規約で Z-up（ECEF）に戻す: (x, y, z) -> (x, -z, y)
          let ex = rtc[0] + x, ey = rtc[1] - z, ez = rtc[2] + y;
          if (t) [ex, ey, ez] = apply4(t, ex, ey, ez);
          positions[i * 3] = ex;
          positions[i * 3 + 1] = ey;
          positions[i * 3 + 2] = ez;
        }
        meshes.push({ positions, batchIds: features.ids, indices: features.indices });
      }
    }
    for (const c of node.children ?? []) visit(c, local ?? null);
  };
  for (const n of sceneNodes) visit(n, null);
  return meshes;
}

/** 移動・回転（クォータニオン）・拡大から列優先の 4x4 行列を作る。どれもなければ null */
function trsMatrix(tr?: number[], q?: number[], s?: number[]): number[] | null {
  if (!tr && !q && !s) return null;
  const [x, y, z, w] = q ?? [0, 0, 0, 1];
  const [sx, sy, sz] = s ?? [1, 1, 1];
  const [tx, ty, tz] = tr ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function apply4(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

function multiply4(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const r = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
  return r;
}
