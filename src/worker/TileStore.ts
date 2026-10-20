import type { BuildingRecord } from '../model/BuildingRecord';
import { boundsOf, type Bounds, type StyledRecord } from './buildPipeline';
import { NEIGHBOR_MARGIN_DEG, boundsOverlap } from './protocol';

export { NEIGHBOR_MARGIN_DEG };

interface TileEntry {
  records: StyledRecord[];
  skipped: number;
  bounds: Bounds;
  /** 自分で展開したタイル（false は他の Worker から届いた、壁面の解析用の建物だけ） */
  own: boolean;
}

/**
 * 壁面の解析（隣の建物として使う）に要る値だけを残した建物。他の Worker に送る量を減らす。
 * 隣の建物として使うのは ID・フットプリント・高さ・スタイル（しきい値）だけ
 */
export function toObstacle({ record, style }: StyledRecord): StyledRecord {
  const { id, geometry, height, minHeight } = record;
  return { record: { id, geometry, height, minHeight } as BuildingRecord, style };
}

const boundsCache = new WeakMap<StyledRecord, Bounds>();
const recordBounds = (r: StyledRecord): Bounds => {
  let b = boundsCache.get(r);
  if (!b) boundsCache.set(r, (b = boundsOf([r])));
  return b;
};

const overlaps = boundsOverlap;

/** Worker が保持する、読み込み済みタイルの建物。隣接タイルの建物を壁面の解析に使う */
export class TileStore {
  private readonly tiles = new Map<string, TileEntry>();

  set(tileId: string, records: StyledRecord[], skipped: number): TileEntry {
    const entry = { records, skipped, bounds: boundsOf(records), own: true };
    this.tiles.set(tileId, entry);
    return entry;
  }

  /** 他の Worker が展開したタイルの建物（toObstacle 済み）。自分で展開したタイルは上書きしない */
  setObstacles(tileId: string, records: StyledRecord[]): void {
    if (this.tiles.get(tileId)?.own) return;
    this.tiles.set(tileId, { records, skipped: 0, bounds: boundsOf(records), own: false });
  }

  /** 持っているタイル（自分で展開したものと、他の Worker から届いたもの） */
  ids(): string[] {
    return [...this.tiles.keys()];
  }

  get(tileId: string): TileEntry | undefined {
    return this.tiles.get(tileId);
  }

  delete(tileId: string): void {
    this.tiles.delete(tileId);
  }

  /**
   * 壁面の解析に使う、隣接する読み込み済みタイルの建物。
   * タイルの範囲の近く（NEIGHBOR_MARGIN_DEG 以内）にある建物だけを返す。自分のタイルにある ID と重複するものは除く
   */
  neighborsOf(tileId: string): StyledRecord[] {
    const entry = this.tiles.get(tileId);
    if (!entry) return [];
    const own = new Set(entry.records.map((r) => r.record.id));
    const out = new Map<string, StyledRecord>();
    for (const [id, other] of this.tiles) {
      if (id === tileId || !overlaps(entry.bounds, other.bounds, NEIGHBOR_MARGIN_DEG)) continue;
      for (const r of other.records) {
        if (own.has(r.record.id) || out.has(r.record.id)) continue;
        if (!overlaps(entry.bounds, recordBounds(r), NEIGHBOR_MARGIN_DEG)) continue;
        out.set(r.record.id, r);
      }
    }
    return [...out.values()];
  }
}
