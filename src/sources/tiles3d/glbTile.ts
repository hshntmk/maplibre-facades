import type { DecoderModule } from 'draco3d';
import type { TileContent } from './content';
import { bufferViewBytes, collectMeshes, fail, parseGlb, type FeatureIdJson, type Gltf } from './gltf';

// 3D Tiles 1.1 の glb タイルを読む。建物の番号は EXT_mesh_features、属性は EXT_structural_metadata のプロパティテーブルにある。
// b3dm と同じ形（バッチテーブル + 頂点ごとの番号）にそろえて返すので、後段（フットプリントの復元・アダプタ）はそのまま使える。

interface ClassProperty {
  type: string;
  componentType?: string;
  enumType?: string;
  array?: boolean;
  count?: number;
  normalized?: boolean;
  offset?: number | number[];
  scale?: number | number[];
  noData?: unknown;
}

interface TableProperty {
  values: number;
  arrayOffsets?: number;
  stringOffsets?: number;
  arrayOffsetType?: string;
  stringOffsetType?: string;
  offset?: number | number[];
  scale?: number | number[];
}

interface StructuralMetadata {
  schema?: {
    classes?: Record<string, { properties?: Record<string, ClassProperty> }>;
    enums?: Record<string, { valueType?: string; values: { name: string; value: number }[] }>;
  };
  schemaUri?: string;
  propertyTables?: { class: string; count: number; properties?: Record<string, TableProperty> }[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16, STRING: 1, BOOLEAN: 1, ENUM: 1 };

type NumberReader = (i: number) => number;

/** バイト列を指定の型の数値の列として読む（アラインメントを気にせず DataView で読む） */
function numbers(bytes: Uint8Array, componentType: string): NumberReader {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (componentType) {
    case 'INT8': return (i) => dv.getInt8(i);
    case 'UINT8': return (i) => dv.getUint8(i);
    case 'INT16': return (i) => dv.getInt16(i * 2, true);
    case 'UINT16': return (i) => dv.getUint16(i * 2, true);
    case 'INT32': return (i) => dv.getInt32(i * 4, true);
    case 'UINT32': return (i) => dv.getUint32(i * 4, true);
    case 'INT64': return (i) => Number(dv.getBigInt64(i * 8, true));
    case 'UINT64': return (i) => Number(dv.getBigUint64(i * 8, true));
    case 'FLOAT32': return (i) => dv.getFloat32(i * 4, true);
    case 'FLOAT64': return (i) => dv.getFloat64(i * 8, true);
    default: return fail(`EXT_structural_metadata: unsupported componentType ${componentType}`);
  }
}

const NORMALIZE_MAX: Record<string, number> = { INT8: 127, UINT8: 255, INT16: 32767, UINT16: 65535, INT32: 2147483647, UINT32: 4294967295 };

const utf8 = new TextDecoder();

/** プロパティテーブルを「属性名 → 各行の値」の形にする。noData は null */
function readPropertyTable(g: Gltf, meta: StructuralMetadata, tableIndex: number): { count: number; columns: Record<string, unknown[]> } {
  const table = meta.propertyTables?.[tableIndex] ?? fail(`EXT_structural_metadata: property table ${tableIndex} not found`);
  const cls = meta.schema?.classes?.[table.class];
  if (!cls) fail(meta.schemaUri ? 'EXT_structural_metadata: external schemas (schemaUri) are not supported' : `EXT_structural_metadata: class ${table.class} not found`);
  const count = table.count;
  const columns: Record<string, unknown[]> = {};

  for (const [name, tp] of Object.entries(table.properties ?? {})) {
    const def = cls!.properties?.[name];
    if (!def) continue;
    const comps = COMPONENTS[def.type] ?? 1;
    const values = bufferViewBytes(g, tp.values);
    const offsets = (view: number | undefined, type = 'UINT32') => (view === undefined ? undefined : numbers(bufferViewBytes(g, view), type));
    const arrayOffsets = offsets(tp.arrayOffsets, tp.arrayOffsetType);
    const stringOffsets = offsets(tp.stringOffsets, tp.stringOffsetType);

    // 1 要素（配列なら配列の 1 つ分）を読む関数
    let element: (e: number) => unknown;
    if (def.type === 'STRING') {
      if (!stringOffsets) continue;
      element = (e) => utf8.decode(values.subarray(stringOffsets(e), stringOffsets(e + 1)));
    } else if (def.type === 'BOOLEAN') {
      element = (e) => ((values[e >> 3] >> (e & 7)) & 1) === 1;
    } else if (def.type === 'ENUM') {
      const en = meta.schema?.enums?.[def.enumType ?? ''];
      if (!en) continue;
      const read = numbers(values, en.valueType ?? 'UINT16');
      const names = new Map(en.values.map((v) => [v.value, v.name]));
      element = (e) => names.get(read(e)) ?? null;
    } else {
      const read = numbers(values, def.componentType ?? fail(`EXT_structural_metadata: ${name} has no componentType`));
      const norm = def.normalized ? NORMALIZE_MAX[def.componentType!] : undefined;
      const off = tp.offset ?? def.offset, sc = tp.scale ?? def.scale;
      const at = (v: number | number[] | undefined, c: number, d: number) => (v === undefined ? d : Array.isArray(v) ? (v[c] ?? d) : v);
      const component = (e: number, c: number) => {
        let v = read(e * comps + c);
        if (norm) v = Math.max(v / norm, -1);
        return v * at(sc, c, 1) + at(off, c, 0);
      };
      element = comps === 1 ? (e) => component(e, 0) : (e) => Array.from({ length: comps }, (_, c) => component(e, c));
    }

    const isNoData = (v: unknown) => {
      if (def.noData === undefined) return false;
      if (Array.isArray(def.noData) && Array.isArray(v)) return def.noData.length === v.length && def.noData.every((x, i) => x === v[i]);
      return v === def.noData;
    };
    const column: unknown[] = new Array(count);
    for (let i = 0; i < count; i++) {
      let v: unknown;
      if (def.array) {
        const start = arrayOffsets ? arrayOffsets(i) : i * (def.count ?? 0);
        const end = arrayOffsets ? arrayOffsets(i + 1) : start + (def.count ?? 0);
        v = Array.from({ length: Math.max(0, end - start) }, (_, k) => element(start + k));
      } else {
        v = element(i);
      }
      column[i] = isNoData(v) ? null : v;
    }
    columns[name] = column;
  }
  return { count, columns };
}

/**
 * 3D Tiles 1.1 の glb タイルを読む。
 * 建物の番号は、プロパティテーブルを参照する最初の featureIds を使う。テーブルが複数あれば行を連結して通し番号にする
 * @param transform タイルの transform（ルートからの累積、列優先 4x4）
 */
export function parseGlbTile(buf: Uint8Array, draco: DecoderModule | undefined, transform?: ArrayLike<number>): TileContent {
  const g = parseGlb(buf);
  const meta = g.json.extensions?.EXT_structural_metadata as StructuralMetadata | undefined;

  // 使われているプロパティテーブルを連結したバッチテーブル
  const batchTable: Record<string, unknown[]> = {};
  const tableOffset = new Map<number, number>();
  let batchLength = 0;
  const useTable = (index: number): number => {
    const known = tableOffset.get(index);
    if (known !== undefined) return known;
    const { count, columns } = meta ? readPropertyTable(g, meta, index) : { count: 0, columns: {} };
    const offset = batchLength;
    for (const [name, col] of Object.entries(columns)) {
      const target = (batchTable[name] ??= new Array(offset).fill(null));
      for (const v of col) target.push(v);
    }
    batchLength += count;
    // この表にない属性は null で埋めて長さをそろえる
    for (const col of Object.values(batchTable)) while (col.length < batchLength) col.push(null);
    tableOffset.set(index, offset);
    return offset;
  };

  const meshes = collectMeshes(g, draco, {
    rtc: g.json.extensions?.CESIUM_RTC?.center,
    transform,
    featureIdsOf: (prim, p) => {
      const fids: FeatureIdJson[] = prim.extensions?.EXT_mesh_features?.featureIds ?? [];
      const fid = fids.find((f) => f.propertyTable !== undefined && f.texture === undefined) ?? fids.find((f) => f.texture === undefined);
      if (!fid) return undefined;
      const offset = fid.propertyTable !== undefined ? useTable(fid.propertyTable) : 0;
      const vertexCount = (p.attributes.POSITION?.data.length ?? 0) / 3;
      const raw = fid.attribute !== undefined ? p.attributes[`_FEATURE_ID_${fid.attribute}`]?.data : Float32Array.from({ length: vertexCount }, (_, i) => i);
      if (!raw) return undefined;
      // 建物に属さない頂点（nullFeatureId）を含む三角形は捨てる
      const isNull = (id: number) => (fid.nullFeatureId !== undefined && id === fid.nullFeatureId) || id >= fid.featureCount;
      const ids = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i++) ids[i] = raw[i] + offset;
      let indices = p.indices;
      if (fid.nullFeatureId !== undefined || raw.some((id) => id >= fid.featureCount)) {
        const kept: number[] = [];
        for (let t = 0; t < indices.length; t += 3) {
          if (isNull(raw[indices[t]]) || isNull(raw[indices[t + 1]]) || isNull(raw[indices[t + 2]])) continue;
          kept.push(indices[t], indices[t + 1], indices[t + 2]);
        }
        indices = Uint32Array.from(kept);
      }
      return { ids, indices };
    },
  });
  return { batchLength, batchTable, meshes };
}
