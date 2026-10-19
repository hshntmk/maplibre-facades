import { mercatorX, mercatorY, meterInMercator } from '../../math/mercator';
import type { TileNode } from './Tileset';

// 表示するタイルを選ぶ（3D Tiles の標準的な方法）。
// - 視錐台の外のタイルは選ばない
// - 画面上の誤差 (screen space error) が maximumScreenSpaceError を超えるタイルは子に分割する
// - REPLACE のタイルは、見えている子がすべて読み込まれるまで親を表示し続ける（穴や二重表示を防ぐ）

export interface CameraState {
  /** メルカトル (0..1, z も同じ単位) → クリップ座標 */
  matrix: ArrayLike<number>;
  /** カメラ位置（メルカトル） */
  position: [number, number, number];
  /** 描画領域の高さ (px) */
  viewportHeight: number;
  /** 縦の視野角（ラジアン） */
  fov: number;
}

export interface Selection {
  /** 今描くタイル */
  render: TileNode[];
  /** 読み込みが必要なタイル（粗いタイルから、同じ深さなら近い順。表示範囲全体を先に大まかに埋める） */
  load: { node: TileNode; distance: number }[];
  /**
   * 今の表示に関わるタイル（描くもの、読み込み待ちの兄弟がそろうのを待っている子、代わりに描いている親）。
   * キャッシュから捨ててはいけない
   */
  used: TileNode[];
  /** 読む必要のあるサブツリー（暗黙的タイリング）。読むまでは、その下のタイルを描けない。並びは load と同じ */
  expand: { node: TileNode; distance: number }[];
}

interface NodeGeometry {
  corners: [number, number, number][];
  min: [number, number, number];
  max: [number, number, number];
  meter: number;
}

const geometryCache = new WeakMap<TileNode, NodeGeometry>();

function geometryOf(node: TileNode): NodeGeometry {
  let g = geometryCache.get(node);
  if (g) return g;
  const b = node.bounds;
  const lat = (b.south + b.north) / 2;
  const meter = meterInMercator(lat);
  const x0 = mercatorX(b.west), x1 = mercatorX(b.east);
  const y0 = mercatorY(b.north), y1 = mercatorY(b.south);
  // 建物は地面 (0) から立ち上がるものとして描くので、高さは範囲の幅だけを使う
  const z0 = 0, z1 = Math.max(1, b.maxHeight - b.minHeight) * meter;
  const corners: [number, number, number][] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) corners.push([x, y, z]);
  g = { corners, min: [x0, y0, z0], max: [x1, y1, z1], meter };
  geometryCache.set(node, g);
  return g;
}

/** 8 隅がすべて同じクリップ平面の外側なら見えない */
function isVisible(node: TileNode, m: ArrayLike<number>): boolean {
  const { corners } = geometryOf(node);
  let outL = 0, outR = 0, outB = 0, outT = 0, outN = 0;
  for (const [x, y, z] of corners) {
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cx < -cw) outL++;
    if (cx > cw) outR++;
    if (cy < -cw) outB++;
    if (cy > cw) outT++;
    if (cz < -cw) outN++;
  }
  return !(outL === 8 || outR === 8 || outB === 8 || outT === 8 || outN === 8);
}

/** カメラからタイルの範囲までの距離 (m) */
function distanceTo(node: TileNode, cam: [number, number, number]): number {
  const { min, max, meter } = geometryOf(node);
  let d2 = 0;
  for (let i = 0; i < 3; i++) {
    const v = cam[i] < min[i] ? min[i] - cam[i] : cam[i] > max[i] ? cam[i] - max[i] : 0;
    d2 += v * v;
  }
  return Math.sqrt(d2) / meter;
}

export function selectTiles(root: TileNode, cam: CameraState, maxSSE: number, isReady: (node: TileNode) => boolean): Selection {
  const load = new Map<TileNode, number>();
  const expand = new Map<TileNode, number>();
  const used = new Set<TileNode>();
  const sseFactor = cam.viewportHeight / (2 * Math.tan(cam.fov / 2));

  const want = (node: TileNode, distance: number) => {
    if (node.contentUrl && !isReady(node)) load.set(node, distance);
  };

  /** node 以下で描くタイルを返す。ready は「穴なく描けるか」 */
  const visit = (node: TileNode): { render: TileNode[]; ready: boolean } => {
    if (!isVisible(node, cam.matrix)) return { render: [], ready: true };
    const distance = distanceTo(node, cam.position);
    const sse = distance > 0 ? (node.geometricError * sseFactor) / distance : Infinity;
    // 暗黙的タイリングの、まだ読んでいないサブツリー。読み終わるまでは親で代用する
    if (node.pending) {
      expand.set(node, distance);
      return { render: [], ready: false };
    }
    if (node.contentUrl) used.add(node);
    const own = node.contentUrl ? [node] : [];
    const ownReady = !node.contentUrl || isReady(node);

    if (node.children.length === 0 || sse <= maxSSE) {
      want(node, distance);
      return { render: ownReady ? own : [], ready: ownReady };
    }

    const results = node.children.map(visit);
    const childRender = results.flatMap((r) => r.render);
    const childrenReady = results.every((r) => r.ready);

    if (node.refine === 'ADD') {
      want(node, distance);
      return { render: [...(ownReady ? own : []), ...childRender], ready: ownReady && childrenReady };
    }
    if (childrenReady) return { render: childRender, ready: true };
    // 子がそろうまでは親で代用する
    want(node, distance);
    return ownReady && node.contentUrl ? { render: own, ready: true } : { render: childRender, ready: false };
  };

  const { render } = visit(root);
  const ordered = (m: Map<TileNode, number>) =>
    [...m.entries()].map(([node, distance]) => ({ node, distance })).sort((a, b) => a.node.depth - b.node.depth || a.distance - b.distance);
  return { render, load: ordered(load), used: [...used], expand: ordered(expand) };
}
