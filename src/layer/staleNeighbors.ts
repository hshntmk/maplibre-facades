import { NEIGHBOR_MARGIN_DEG, boundsOverlap } from '../worker/protocol';

/** 壁面の判定が古いかを調べるためのタイルの情報 */
export interface NeighborTile {
  id: string;
  state: 'loading' | 'ready' | 'failed';
  /** 建物の範囲 [west, south, east, north] */
  bounds?: readonly number[];
  /** メッシュを作ったときに Worker が持っていたタイル */
  known?: Set<string>;
  stale?: boolean;
  /** 作り直しを依頼中（届いたときに改めて調べるので、ここでは印を付けない） */
  remeshing?: boolean;
}

/**
 * タイルのメッシュが届いたときに、隣り合うタイルの壁面の判定が古くなっていないかを調べる。
 * どちらかが相手の建物を見ずにメッシュを作っていたら、そのタイルを stale にする（作り直しの対象）。
 * Worker は並行して動き、建物は Worker どうしで送り合うので、相手の建物が届く前に作ったメッシュがありうる
 */
export function markStaleNeighbors(entry: NeighborTile, tiles: Iterable<NeighborTile>): void {
  if (!entry.bounds) return;
  for (const other of tiles) {
    if (other === entry || other.state !== 'ready' || !other.bounds || !boundsOverlap(entry.bounds, other.bounds, NEIGHBOR_MARGIN_DEG)) continue;
    // 作り直し中のタイルの known は依頼前のもの。作り直しの結果が届いたときに、その known で調べ直す
    if (!other.remeshing && !other.known?.has(entry.id)) other.stale = true;
    if (!entry.known?.has(other.id)) entry.stale = true;
  }
}
