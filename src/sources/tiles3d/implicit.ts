import { BuildingWindowLayerError } from '../../errors';
import { toBounds, type BoundingVolumeJson } from './bounds';
import type { TileNode } from './Tileset';

// 3D Tiles 1.1 の暗黙的タイリング（implicit tiling）。
// タイルは tileset.json に書かれておらず、根の範囲を 4 分割（QUADTREE）/ 8 分割（OCTREE）した位置 (level, x, y[, z]) で表す。
// どのタイルがあるかはサブツリーファイルのビット列（モートン順）で分かる。サブツリーは表示に必要になったときに読む:
// 子サブツリーの根は pending を持つノードとして置いておき、タイルの選択がそこまで降りてきたら読み込んで中身と子を決める。

export interface ImplicitTilingJson {
  subdivisionScheme: 'QUADTREE' | 'OCTREE';
  subtreeLevels: number;
  /** 3D Tiles 1.1。旧拡張（3DTILES_implicit_tiling）は maximumLevel（= availableLevels - 1） */
  availableLevels?: number;
  maximumLevel?: number;
  subtrees: { uri: string };
}

/** 暗黙的タイリングの根のタイル（tileset.json の 1 タイル） */
export interface ImplicitRootJson {
  boundingVolume: BoundingVolumeJson;
  geometricError: number;
  content?: { uri?: string; url?: string };
  contents?: { uri?: string }[];
  implicitTiling: ImplicitTilingJson;
}

interface AvailabilityJson {
  bitstream?: number;
  /** 旧拡張の名前 */
  bufferView?: number;
  constant?: number;
}

interface SubtreeJson {
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  tileAvailability: AvailabilityJson;
  /** 1.1 は配列（中身ごと）、旧拡張は 1 つ */
  contentAvailability?: AvailabilityJson[] | AvailabilityJson;
  childSubtreeAvailability: AvailabilityJson;
}

/** サブツリーの 3 種類の有無。index はモートン順（タイルと中身はレベルごとの通し番号） */
export interface Subtree {
  tile: (index: number) => boolean;
  content: (index: number) => boolean;
  childSubtree: (index: number) => boolean;
}

const fail = (message: string, cause?: unknown): never => {
  throw new BuildingWindowLayerError('source', message, { cause });
};

async function fetchBytes(url: string): Promise<Uint8Array> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return fail(`Failed to load ${url}: ${e instanceof Error ? e.message : e}`, e);
  }
}

/** サブツリーファイル（バイナリの .subtree か JSON）を読む */
export async function loadSubtree(url: string): Promise<Subtree> {
  const bytes = await fetchBytes(url);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let json: SubtreeJson;
  let internal: Uint8Array | undefined;
  if (bytes.byteLength >= 24 && dv.getUint32(0, true) === 0x74627573) {
    // "subt" + version + JSON の長さ (uint64) + バイナリの長さ (uint64)
    const jsonLength = Number(dv.getBigUint64(8, true));
    const binLength = Number(dv.getBigUint64(16, true));
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(24, 24 + jsonLength)).replace(/\0+$/, '').trim());
    internal = bytes.subarray(24 + jsonLength, 24 + jsonLength + binLength);
  } else {
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return fail(`${url} is not a subtree file`, e);
    }
  }

  // バッファ: uri がなければバイナリ部分、あればサブツリーからの相対 URL
  const buffers = await Promise.all((json.buffers ?? []).map((b) => (b.uri ? fetchBytes(new URL(b.uri, url).href) : Promise.resolve(internal ?? fail(`${url}: missing binary chunk`)))));
  const reader = (av: AvailabilityJson | undefined, what: string): ((i: number) => boolean) => {
    if (!av) return () => false;
    if (av.constant !== undefined) return () => av.constant === 1;
    const viewIndex = av.bitstream ?? av.bufferView;
    const view = viewIndex !== undefined ? json.bufferViews?.[viewIndex] : undefined;
    if (!view) return fail(`${url}: ${what} has neither a constant nor a bitstream`);
    const buf = buffers[view.buffer] ?? fail(`${url}: buffer ${view.buffer} not found`);
    const bits = buf.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    return (i) => ((bits[i >> 3] >> (i & 7)) & 1) === 1;
  };
  const content = Array.isArray(json.contentAvailability) ? json.contentAvailability[0] : json.contentAvailability;
  return {
    tile: reader(json.tileAvailability, 'tileAvailability'),
    content: reader(content, 'contentAvailability'),
    childSubtree: reader(json.childSubtreeAvailability, 'childSubtreeAvailability'),
  };
}

/** モートン順の番号（x, y[, z] のビットを交互に並べる） */
export function morton(x: number, y: number, z: number, octree: boolean): number {
  let m = 0, scale = 1;
  const branching = octree ? 8 : 4;
  while (x || y || z) {
    m += ((x & 1) + (y & 1) * 2 + (octree ? (z & 1) * 4 : 0)) * scale;
    x >>= 1;
    y >>= 1;
    z >>= 1;
    scale *= branching;
  }
  return m;
}

/** {level} {x} {y} {z} を置き換える */
const fillTemplate = (template: string, level: number, x: number, y: number, z: number) =>
  template.replace(/\{level\}/g, String(level)).replace(/\{x\}/g, String(x)).replace(/\{y\}/g, String(y)).replace(/\{z\}/g, String(z));

/** 根の範囲を level で分割したときの (x, y, z) の範囲 */
function subdivide(bv: BoundingVolumeJson, level: number, x: number, y: number, z: number, octree: boolean): BoundingVolumeJson {
  const n = 2 ** level;
  if (bv.region) {
    const [w, s, e, nn, minH, maxH] = bv.region;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return {
      region: [
        lerp(w, e, x / n), lerp(s, nn, y / n), lerp(w, e, (x + 1) / n), lerp(s, nn, (y + 1) / n),
        octree ? lerp(minH, maxH, z / n) : minH, octree ? lerp(minH, maxH, (z + 1) / n) : maxH,
      ],
    };
  }
  if (bv.box) {
    const b = bv.box;
    const f = 1 / n;
    // 子の中心 = 中心 + 各軸 × (-1 + (2i + 1) / n)。半軸は 1/n（QUADTREE の z 軸はそのまま）
    const tx = -1 + (2 * x + 1) * f, ty = -1 + (2 * y + 1) * f, tz = octree ? -1 + (2 * z + 1) * f : 0;
    const center = [0, 1, 2].map((i) => b[i] + b[3 + i] * tx + b[6 + i] * ty + b[9 + i] * tz);
    const zf = octree ? f : 1;
    return { box: [...center, b[3] * f, b[4] * f, b[5] * f, b[6] * f, b[7] * f, b[8] * f, b[9] * zf, b[10] * zf, b[11] * zf] };
  }
  return fail('implicit tiling supports only region and box bounding volumes');
}

export interface ImplicitContext {
  baseUrl: string;
  /** 根のタイルの ID（子は `${id}/${level}/${x}/${y}[/${z}]`） */
  id: string;
  transform?: number[];
  refine: 'ADD' | 'REPLACE';
  depth: number;
}

/**
 * 暗黙的タイリングの根を、サブツリーを読む前のノードとして作る。
 * pending を呼ぶと最初のサブツリーを読み、中身と子（さらに下のサブツリーの根は、また pending を持つノード）が決まる
 */
export function createImplicitTile(tile: ImplicitRootJson, ctx: ImplicitContext): TileNode {
  const it = tile.implicitTiling;
  const octree = it.subdivisionScheme === 'OCTREE';
  if (!octree && it.subdivisionScheme !== 'QUADTREE') fail(`implicit tiling: unknown subdivisionScheme ${it.subdivisionScheme}`);
  const availableLevels = it.availableLevels ?? (it.maximumLevel !== undefined ? it.maximumLevel + 1 : fail('implicit tiling: availableLevels is missing'));
  const subtreeLevels = it.subtreeLevels;
  if (!(subtreeLevels >= 1)) fail('implicit tiling: subtreeLevels must be >= 1');
  const contentTemplate = tile.content?.uri ?? tile.content?.url ?? tile.contents?.[0]?.uri;
  const branching = octree ? 8 : 4;
  // サブツリー内のレベル l の先頭の番号 = (branching^l - 1) / (branching - 1)
  const levelOffset = (l: number) => (branching ** l - 1) / (branching - 1);

  const makeNode = (level: number, x: number, y: number, z: number): TileNode => ({
    id: level === 0 ? ctx.id : `${ctx.id}/${level}/${x}/${y}${octree ? `/${z}` : ''}`,
    geometricError: tile.geometricError / 2 ** level,
    refine: ctx.refine,
    depth: ctx.depth + level,
    children: [],
    transform: ctx.transform,
    bounds: toBounds(subdivide(tile.boundingVolume, level, x, y, z, octree), ctx.transform),
  });

  /** サブツリーの根 node に pending を付ける。読み込みは 1 回だけ（失敗したら中身なしの葉にする） */
  const attachSubtree = (node: TileNode, level: number, x: number, y: number, z: number) => {
    let promise: Promise<void> | undefined;
    node.pending = () =>
      (promise ??= (async () => {
        try {
          const url = new URL(fillTemplate(it.subtrees.uri, level, x, y, z), ctx.baseUrl).href;
          fillSubtree(node, await loadSubtree(url), level, x, y, z);
        } finally {
          node.pending = undefined;
        }
      })());
  };

  /** 読み込んだサブツリーから、根 (level0, x0, y0, z0) 以下のタイルを作る */
  const fillSubtree = (root: TileNode, st: Subtree, level0: number, x0: number, y0: number, z0: number) => {
    if (!st.tile(0)) return; // サブツリーにタイルがない
    const visit = (node: TileNode, l: number, lx: number, ly: number, lz: number) => {
      const level = level0 + l;
      const scale = 2 ** l;
      const gx = x0 * scale + lx, gy = y0 * scale + ly, gz = z0 * scale + lz;
      if (contentTemplate && st.content(levelOffset(l) + morton(lx, ly, lz, octree))) {
        node.contentUrl = new URL(fillTemplate(contentTemplate, level, gx, gy, gz), ctx.baseUrl).href;
      }
      if (level + 1 >= availableLevels) return;
      for (let c = 0; c < branching; c++) {
        const cx = 2 * lx + (c & 1), cy = 2 * ly + ((c >> 1) & 1), cz = octree ? 2 * lz + ((c >> 2) & 1) : 0;
        const child = () => makeNode(level + 1, 2 * gx + (c & 1), 2 * gy + ((c >> 1) & 1), octree ? 2 * gz + ((c >> 2) & 1) : 0);
        if (l + 1 < subtreeLevels) {
          if (!st.tile(levelOffset(l + 1) + morton(cx, cy, cz, octree))) continue;
          const n = child();
          node.children.push(n);
          visit(n, l + 1, cx, cy, cz);
        } else if (st.childSubtree(morton(cx, cy, cz, octree))) {
          // 下のサブツリーの根: 中身と子は、そのサブツリーを読んでから決まる
          const n = child();
          node.children.push(n);
          attachSubtree(n, level + 1, 2 * gx + (c & 1), 2 * gy + ((c >> 1) & 1), octree ? 2 * gz + ((c >> 2) & 1) : 0);
        }
      }
    };
    visit(root, 0, 0, 0, 0);
  };

  const root = makeNode(0, 0, 0, 0);
  attachSubtree(root, 0, 0, 0, 0);
  return root;
}
