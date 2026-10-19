import { BuildingWindowLayerError } from '../../errors';
import { toBounds, type BoundingVolumeJson } from './bounds';
import { createImplicitTile, type ImplicitTilingJson } from './implicit';

// tileset.json を読み、タイルの木構造と、それぞれの範囲（経緯度・高さ）を用意する（メインスレッド）。

export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
  minHeight: number;
  maxHeight: number;
}

export interface TileNode {
  id: string;
  /** タイルの中身の URL（中身のない中間ノードは undefined） */
  contentUrl?: string;
  geometricError: number;
  refine: 'ADD' | 'REPLACE';
  /** ルートからの深さ（0 = ルート）。粗いタイルから先に読むために使う */
  depth: number;
  children: TileNode[];
  /** ルートから累積した transform（列優先 4x4）。なければ undefined */
  transform?: number[];
  bounds: TileBounds;
  /**
   * 暗黙的タイリングで、まだサブツリーを読んでいないタイル。呼ぶとサブツリーを読み、contentUrl と children が決まる
   * （何度呼んでも読み込みは 1 回。終わると undefined になる）
   */
  pending?: () => Promise<void>;
}

interface TileJson {
  boundingVolume: BoundingVolumeJson;
  geometricError: number;
  refine?: string;
  content?: { uri?: string; url?: string };
  /** 3D Tiles 1.1: 複数の中身。最初の 1 つだけ使う */
  contents?: { uri?: string }[];
  /** 3D Tiles 1.1 の暗黙的タイリング */
  implicitTiling?: ImplicitTilingJson;
  children?: TileJson[];
  transform?: number[];
}

const fail = (message: string, cause?: unknown): never => {
  throw new BuildingWindowLayerError('source', message, { cause });
};

function multiply(a: number[] | undefined, b: number[] | undefined): number[] | undefined {
  if (!a) return b;
  if (!b) return a;
  const r = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
  return r;
}

async function fetchJson(url: string): Promise<{ root: TileJson; geometricError?: number }> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { root: TileJson };
  } catch (e) {
    return fail(`Failed to load tileset ${url}: ${e instanceof Error ? e.message : e}`, e);
  }
}

export interface Tileset {
  url: string;
  root: TileNode;
}

/**
 * tileset.json を読む。中身が別の tileset.json（外部タイルセット）の場合はたどって 1 本の木にする。
 * 暗黙的タイリングのタイルは、サブツリーを読む前のノード（pending）として置き、表示に必要になったときに展開する。
 * @param idPrefix タイル ID の先頭（複数のタイルセットを束ねるときに区別するため）
 */
export async function loadTileset(url: string, idPrefix = 'r'): Promise<Tileset> {
  const build = async (json: TileJson, baseUrl: string, id: string, parentTransform: number[] | undefined, parentRefine: 'ADD' | 'REPLACE', depth = 0): Promise<TileNode> => {
    const transform = multiply(parentTransform, json.transform);
    const refine = json.refine ? (json.refine.toUpperCase() === 'ADD' ? 'ADD' : 'REPLACE') : parentRefine;
    if (json.implicitTiling) {
      return createImplicitTile({ ...json, implicitTiling: json.implicitTiling }, { baseUrl, id, transform, refine, depth });
    }
    const uri = json.content?.uri ?? json.content?.url ?? json.contents?.[0]?.uri;
    const node: TileNode = {
      id,
      geometricError: json.geometricError,
      refine,
      depth,
      children: [],
      transform,
      bounds: toBounds(json.boundingVolume, transform),
    };
    if (uri) {
      const contentUrl = new URL(uri, baseUrl).href;
      if (/\.json(\?|$)/i.test(uri)) {
        // 外部タイルセット: その root を子として取り込む
        const ext = await fetchJson(contentUrl);
        node.children.push(await build(ext.root, contentUrl, `${id}/ext`, transform, refine, depth + 1));
      } else {
        node.contentUrl = contentUrl;
      }
    }
    for (const [i, child] of (json.children ?? []).entries()) node.children.push(await build(child, baseUrl, `${id}/${i}`, transform, refine, depth + 1));
    return node;
  };

  const json = await fetchJson(url);
  if (!json.root) fail(`${url} is not a 3D Tiles tileset`);
  const root = await build(json.root, url, idPrefix, undefined, 'REPLACE');
  return { url, root };
}

/**
 * 複数のタイルセット（区ごとに分かれた PLATEAU のデータなど）を、中身のない親の下に束ねて 1 本の木にする。
 * 読み込めなかったタイルセットは除いて続け、失敗は failures で返す。
 */
export async function loadTilesets(urls: string[]): Promise<{ tileset: Tileset; failures: { url: string; error: unknown }[] }> {
  if (urls.length === 1) return { tileset: await loadTileset(urls[0]), failures: [] };
  const results = await Promise.allSettled(urls.map((u, i) => loadTileset(u, `t${i}`)));
  const loaded: Tileset[] = [];
  const failures: { url: string; error: unknown }[] = [];
  results.forEach((r, i) => (r.status === 'fulfilled' ? loaded.push(r.value) : failures.push({ url: urls[i], error: r.reason })));
  if (!loaded.length) throw failures[0]?.error ?? new BuildingWindowLayerError('source', 'no tileset could be loaded');

  const b = loaded.map((t) => t.root.bounds);
  const root: TileNode = {
    id: 'all',
    geometricError: Number.POSITIVE_INFINITY, // 中身がないので、常に子（各タイルセット）に分割する
    refine: 'ADD', // 各タイルセットは独立しているので、見えているものをすべて描く
    depth: -1,
    children: loaded.map((t) => t.root),
    bounds: {
      west: Math.min(...b.map((x) => x.west)),
      south: Math.min(...b.map((x) => x.south)),
      east: Math.max(...b.map((x) => x.east)),
      north: Math.max(...b.map((x) => x.north)),
      minHeight: Math.min(...b.map((x) => x.minHeight)),
      maxHeight: Math.max(...b.map((x) => x.maxHeight)),
    },
  };
  return { tileset: { url: urls.join(','), root }, failures };
}
