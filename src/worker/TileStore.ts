import { boundsOf, type Bounds, type StyledRecord } from './buildPipeline';

/** 壁面の解析で隣のタイルの建物を見る範囲（度）。光線の最大距離 40m より少し広く */
export const NEIGHBOR_MARGIN_DEG = 0.0005;

interface TileEntry {
  records: StyledRecord[];
  skipped: number;
  bounds: Bounds;
}

const boundsCache = new WeakMap<StyledRecord, Bounds>();
const recordBounds = (r: StyledRecord): Bounds => {
  let b = boundsCache.get(r);
  if (!b) boundsCache.set(r, (b = boundsOf([r])));
  return b;
};

const overlaps = (a: Bounds, b: Bounds, margin: number) =>
  Number.isFinite(a[0]) && Number.isFinite(b[0]) && a[0] - margin <= b[2] && a[2] + margin >= b[0] && a[1] - margin <= b[3] && a[3] + margin >= b[1];

/** Worker が保持する、読み込み済みタイルの建物。隣接タイルの建物を壁面の解析に使う */
export class TileStore {
  private readonly tiles = new Map<string, TileEntry>();

  set(tileId: string, records: StyledRecord[], skipped: number): TileEntry {
    const entry = { records, skipped, bounds: boundsOf(records) };
    this.tiles.set(tileId, entry);
    return entry;
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

  /** tileId の建物が届いたことで、壁面の判定が変わりうる他のタイル */
  affectedBy(tileId: string): string[] {
    const entry = this.tiles.get(tileId);
    if (!entry) return [];
    return [...this.tiles.entries()].filter(([id, o]) => id !== tileId && overlaps(entry.bounds, o.bounds, NEIGHBOR_MARGIN_DEG)).map(([id]) => id);
  }
}
