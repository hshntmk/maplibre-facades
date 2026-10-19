import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mercatorX, mercatorY, meterInMercator } from '../src/math/mercator';
import { loadSubtree, morton } from '../src/sources/tiles3d/implicit';
import { selectTiles, type CameraState } from '../src/sources/tiles3d/TileSelector';
import { loadTileset, type TileNode } from '../src/sources/tiles3d/Tileset';

// 3D Tiles 1.1 の暗黙的タイリング

/** ビット列（指定した番号のビットを立てる） */
function bits(indices: number[], count: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(count / 8));
  for (const i of indices) out[i >> 3] |= 1 << (i & 7);
  return out;
}

/** バイナリのサブツリーファイル。availability は bitstream（ビット列）か constant */
function subtreeFile(av: { tile: Uint8Array | number; content: Uint8Array | number; child: Uint8Array | number }): Uint8Array {
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const entry = (v: Uint8Array | number) => {
    if (typeof v === 'number') return { constant: v };
    views.push({ buffer: 0, byteOffset: offset, byteLength: v.byteLength });
    chunks.push(v);
    const pad = (8 - (v.byteLength % 8)) % 8;
    if (pad) chunks.push(new Uint8Array(pad));
    offset += v.byteLength + pad;
    return { bitstream: views.length - 1 };
  };
  const json: Record<string, unknown> = {
    tileAvailability: entry(av.tile),
    contentAvailability: [entry(av.content)],
    childSubtreeAvailability: entry(av.child),
  };
  if (views.length) Object.assign(json, { buffers: [{ byteLength: offset }], bufferViews: views });
  let text = JSON.stringify(json);
  while (text.length % 8) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const out = new Uint8Array(24 + jsonBytes.byteLength + offset);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x74627573, true); // "subt"
  dv.setUint32(4, 1, true);
  dv.setBigUint64(8, BigInt(jsonBytes.byteLength), true);
  dv.setBigUint64(16, BigInt(offset), true);
  out.set(jsonBytes, 24);
  let o = 24 + jsonBytes.byteLength;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** URL → 中身。tileset.json は JSON、それ以外はバイト列で返す */
function serve(files: Record<string, unknown>) {
  const requested: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    requested.push(url);
    const body = files[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(body instanceof Uint8Array ? body.slice() : JSON.stringify(body));
  });
  return requested;
}

afterEach(() => vi.unstubAllGlobals());

const BASE = 'https://example.test/implicit/';
const W = 139.76, S = 35.68, SIZE = 0.004; // 約 360m 四方
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * QUADTREE、サブツリー 2 段、4 レベル。
 * 0.0.0: 根と (1,0,0)・(1,1,1) がある。中身はレベル 1 だけ。(1,1,1) の下の (2,3,3) から下のサブツリーがある
 * 2.3.3: 根だけで中身あり（レベル 3 のタイルはない）
 */
function implicitTileset(boundingVolume: Record<string, number[]>) {
  // サブツリー内の番号: レベル 0 = 0、レベル 1 = 1 + morton(x, y)
  const tile = bits([0, 1 + morton(0, 0, 0, false), 1 + morton(1, 1, 0, false)], 5);
  const content = bits([1 + morton(0, 0, 0, false), 1 + morton(1, 1, 0, false)], 5);
  // 子サブツリー: レベル 2 のサブツリー内の座標 (3, 3)
  const child = bits([morton(3, 3, 0, false)], 16);
  return {
    [`${BASE}tileset.json`]: {
      asset: { version: '1.1' },
      geometricError: 500,
      root: {
        boundingVolume,
        geometricError: 200,
        refine: 'REPLACE',
        content: { uri: 'content/{level}/{x}/{y}.glb' },
        implicitTiling: { subdivisionScheme: 'QUADTREE', subtreeLevels: 2, availableLevels: 4, subtrees: { uri: 'subtrees/{level}.{x}.{y}.subtree' } },
      },
    },
    [`${BASE}subtrees/0.0.0.subtree`]: subtreeFile({ tile, content, child }),
    [`${BASE}subtrees/2.3.3.subtree`]: subtreeFile({ tile: bits([0], 5), content: bits([0], 5), child: 0 }),
  };
}

const REGION = { region: [rad(W), rad(S), rad(W + SIZE), rad(S + SIZE), 0, 50] };

describe('morton', () => {
  it('interleaves x, y (and z) bits', () => {
    expect([[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [3, 3]].map(([x, y]) => morton(x, y, 0, false))).toEqual([0, 1, 2, 3, 4, 15]);
    expect(morton(1, 1, 1, true)).toBe(7);
    expect(morton(2, 0, 0, true)).toBe(8);
  });
});

describe('loadSubtree', () => {
  it('reads bitstreams and constants from a binary subtree', async () => {
    serve({ 'https://example.test/a.subtree': subtreeFile({ tile: bits([0, 3], 5), content: 0, child: 1 }) });
    const st = await loadSubtree('https://example.test/a.subtree');
    expect([0, 1, 2, 3, 4].map(st.tile)).toEqual([true, false, false, true, false]);
    expect(st.content(0)).toBe(false);
    expect(st.childSubtree(7)).toBe(true);
  });

  it('reads JSON subtrees with external buffers', async () => {
    serve({
      'https://example.test/s/a.json': { buffers: [{ byteLength: 1, uri: 'a.bin' }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 1 }], tileAvailability: { bitstream: 0 }, contentAvailability: [{ constant: 1 }], childSubtreeAvailability: { constant: 0 } },
      'https://example.test/s/a.bin': new Uint8Array([0b101]),
    });
    const st = await loadSubtree('https://example.test/s/a.json');
    expect([0, 1, 2].map(st.tile)).toEqual([true, false, true]);
    expect(st.content(5)).toBe(true);
    expect(st.childSubtree(0)).toBe(false);
  });
});

describe('implicit tilesets', () => {
  it('expands subtrees lazily into tiles with subdivided bounds and content URLs', async () => {
    const requested = serve(implicitTileset(REGION));
    const { root } = await loadTileset(`${BASE}tileset.json`);
    // tileset.json の時点ではサブツリーを読まない
    expect(root.pending).toBeTypeOf('function');
    expect(requested).toEqual([`${BASE}tileset.json`]);

    await root.pending!();
    expect(root.pending).toBeUndefined();
    expect(root.contentUrl).toBeUndefined(); // レベル 0 は中身なし
    expect(root.children.map((c) => c.id)).toEqual(['r/1/0/0', 'r/1/1/1']);
    const [sw, ne] = root.children;
    expect(sw.contentUrl).toBe(`${BASE}content/1/0/0.glb`);
    expect(sw.geometricError).toBe(100);
    expect(sw.bounds.west).toBeCloseTo(W, 9);
    expect(sw.bounds.east).toBeCloseTo(W + SIZE / 2, 9);
    expect(ne.bounds.south).toBeCloseTo(S + SIZE / 2, 9);
    expect(ne.bounds.north).toBeCloseTo(S + SIZE, 9);

    // (1,1,1) の下は別のサブツリー: 読むまでは pending
    expect(ne.children.map((c) => c.id)).toEqual(['r/2/3/3']);
    const deep = ne.children[0];
    expect(deep.pending).toBeTypeOf('function');
    expect(deep.contentUrl).toBeUndefined();
    await Promise.all([deep.pending!(), deep.pending!()]); // 2 回呼んでも読むのは 1 回
    expect(requested.filter((u) => u.endsWith('2.3.3.subtree'))).toHaveLength(1);
    expect(deep.contentUrl).toBe(`${BASE}content/2/3/3.glb`);
    expect(deep.depth).toBe(2);
    expect(deep.bounds.west).toBeCloseTo(W + SIZE * 0.75, 9);
    // レベル 3 のタイルはビットが立っていないので子はない
    expect(deep.children).toHaveLength(0);
  });

  it('treats constant availability as every tile being present', async () => {
    const files = implicitTileset(REGION);
    files[`${BASE}subtrees/0.0.0.subtree`] = subtreeFile({ tile: 1, content: 1, child: 0 });
    serve(files);
    const { root } = await loadTileset(`${BASE}tileset.json`);
    await root.pending!();
    expect(root.contentUrl).toBe(`${BASE}content/0/0/0.glb`);
    expect(root.children).toHaveLength(4);
    expect(root.children.every((c) => c.children.length === 0 && !c.pending)).toBe(true);
  });

  it('subdivides box bounding volumes', async () => {
    // 東京駅付近の ECEF を中心にした 200m 四方の箱（軸は ECEF に平行）
    const c = [-3959000, 3352000, 3697000];
    serve(implicitTileset({ box: [...c, 100, 0, 0, 0, 100, 0, 0, 0, 25] }));
    const { root } = await loadTileset(`${BASE}tileset.json`);
    await root.pending!();
    const [a, b] = root.children;
    const mid = (t: TileNode) => [(t.bounds.west + t.bounds.east) / 2, (t.bounds.south + t.bounds.north) / 2];
    const ra = mid(root), ma = mid(a), mb = mid(b);
    // (0,0) と (1,1) の中心は、根の中心をはさんで反対側にある
    expect(Math.sign(ma[0] - ra[0])).toBe(-Math.sign(mb[0] - ra[0]));
    expect(Math.sign(ma[1] - ra[1])).toBe(-Math.sign(mb[1] - ra[1]));
    expect(a.bounds.east - a.bounds.west).toBeLessThan(root.bounds.east - root.bounds.west);
  });

  it('asks the selector to expand subtrees only where it needs to refine', async () => {
    serve(implicitTileset(REGION));
    const { root } = await loadTileset(`${BASE}tileset.json`);
    const camera = (heightM: number): CameraState => {
      const lng = W + SIZE / 2, lat = S + SIZE / 2;
      const cx = mercatorX(lng), cy = mercatorY(lat), meter = meterInMercator(lat);
      const k = 1 / (2000 * meter);
      return { matrix: [k, 0, 0, 0, 0, -k, 0, 0, 0, 0, k * 0.001, 0, -cx * k, cy * k, 0, 1], position: [cx, cy, heightM * meter], viewportHeight: 1000, fov: Math.PI / 4 };
    };
    // 最初は根のサブツリーを読む必要がある
    let sel = selectTiles(root, camera(300), 16, () => true);
    expect(sel.expand.map((e) => e.node.id)).toEqual(['r']);
    expect(sel.render).toHaveLength(0);
    await root.pending!();

    // 遠くからは下のサブツリーを読まない（レベル 1 で十分）
    sel = selectTiles(root, camera(1e6), 16, () => true);
    expect(sel.expand).toHaveLength(0);
    // 近づくと (1,1,1) の下のサブツリーを読む。読み終わるまで (1,1,1) で代用する
    sel = selectTiles(root, camera(100), 16, () => true);
    expect(sel.expand.map((e) => e.node.id)).toEqual(['r/2/3/3']);
    expect(sel.render.map((n) => n.id).sort()).toEqual(['r/1/0/0', 'r/1/1/1']);
    await root.children[1].children[0].pending!();
    sel = selectTiles(root, camera(100), 16, () => true);
    expect(sel.expand).toHaveLength(0);
    expect(sel.render.map((n) => n.id).sort()).toEqual(['r/1/0/0', 'r/2/3/3']);
  });

  it('reports a missing subtree as a source error', async () => {
    const files: Record<string, unknown> = implicitTileset(REGION);
    delete files[`${BASE}subtrees/0.0.0.subtree`];
    serve(files);
    const { root } = await loadTileset(`${BASE}tileset.json`);
    await expect(root.pending!()).rejects.toMatchObject({ code: 'source' });
    expect(root.pending).toBeUndefined();
    expect(root.children).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- 実データ（台東区のタイルを暗黙的タイリングに並べ直したもの）

const SAMPLE = 'data/implicit-taito';

describe.runIf(existsSync(`${SAMPLE}/tileset.json`) && existsSync('data/raw/13106/tileset.json'))('implicit tiling sample (台東区 → scripts/make-implicit-sample.mjs)', () => {
  it('expands every subtree and places each tile where the original tile was', async () => {
    const base = 'https://sample.test/';
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const path = `${SAMPLE}/${String(input).slice(base.length)}`;
      return existsSync(path) ? new Response(readFileSync(path)) : new Response('not found', { status: 404 });
    });
    const { root } = await loadTileset(`${base}tileset.json`);
    const all: TileNode[] = [];
    const expand = async (node: TileNode) => {
      if (node.pending) await node.pending();
      all.push(node);
      for (const c of node.children) await expand(c);
    };
    await expand(root);
    const withContent = all.filter((n) => n.contentUrl);
    expect(withContent).toHaveLength(82);

    // 元のタイルセット: z/x/y（y は北から）→ 範囲
    const source = JSON.parse(readFileSync('data/raw/13106/tileset.json', 'utf8'));
    const regions = new Map<string, number[]>();
    (function walk(n: { content?: { uri: string }; boundingVolume: { region: number[] }; children?: unknown[] }) {
      if (n.content) regions.set(n.content.uri.split('_')[0], n.boundingVolume.region);
      for (const c of n.children ?? []) walk(c as never);
    })(source.root);
    const deg = 180 / Math.PI;
    for (const node of withContent) {
      const [level, x, y] = node.contentUrl!.slice(base.length).match(/content\/(\d+)\/(\d+)\/(\d+)\.glb/)!.slice(1).map(Number);
      const size = 2 ** level;
      const rootX = 29106, rootY = 4941;
      const original = regions.get(`${15 + level}/${rootX * size + x}/${rootY * size + (size - 1 - y)}`)!;
      expect(original, node.contentUrl).toBeDefined();
      // 元のタイルの範囲（中身に合わせた範囲）の中心が、暗黙的タイリングで計算した範囲の中にある
      const cx = ((original[0] + original[2]) / 2) * deg, cy = ((original[1] + original[3]) / 2) * deg;
      expect(cx).toBeGreaterThan(node.bounds.west);
      expect(cx).toBeLessThan(node.bounds.east);
      expect(cy).toBeGreaterThan(node.bounds.south);
      expect(cy).toBeLessThan(node.bounds.north);
      expect(node.depth).toBe(level);
    }
  });
});
