// 壁面の形状と周囲の状況を解析して、窓の自動配置に必要な情報を壁セグメントごとに求める。
//
// - 連続面（run）: ほぼ一直線に続くセグメントをまとめ、窓をまたいで並べられるようにする。
//   曲面の外壁が細かい辺に分かれていても、窓が途切れない。角の余白は run の両端（本当の角）だけに取る。
// - 前面のあき（clearance）: 壁から外向きに光線を飛ばし、他の建物（または自分の中庭の対面）までの距離を測る。
//   隣と接している壁（界壁）には窓を付けず、狭い隙間に面した側壁は窓を減らす、などの判断に使う。
//   ふさいでいる建物の高さ（coverHeight）も記録し、それより上は開けた面として扱えるようにする。
// - 日当たり面（sunSide）: 建物の開けた面のうち、最も南を向いている面。共同住宅のバルコニー配置に使う。

export type Point = [number, number];
/** 建物 → ポリゴン → リング → 点。外周は反時計回り、穴は時計回り（外向き法線 = (ty, -tx)） */
export type BuildingRings = Point[][][];

export interface SegmentFacade {
  /** 連続面の始点からこのセグメントの始点までの距離 (m) */
  runOffset: number;
  /** 連続面の長さ (m)。リング全体が角のない閉じた面なら負の値（端の余白を取らない） */
  runLength: number;
  /** 連続面ごとの番号（乱数シード用。同じ連続面の窓は同じシードを使う） */
  runId: number;
  /** 前面のあき (m)。MAX_CLEARANCE で打ち切り */
  clearance: number;
  /** 前面をふさいでいる建物の高さ (m)。これより上の壁は開けている。MAX_CLEARANCE 以内に何もなければ 0 */
  coverHeight: number;
  sunSide: boolean;
}

/** これより大きく曲がる頂点を角とみなす（ラジアン） */
export const CORNER_ANGLE = (25 * Math.PI) / 180;
export const MAX_CLEARANCE = 40;

/** 壁面を分類する距離のしきい値 (m)。スタイルごとに設定できる */
export interface ExposureThresholds {
  /** 前面のあきがこれ未満なら界壁（隣と接している） */
  partyWallMax: number;
  /** 前面のあきがこれ未満なら側壁（狭い隙間に面している） */
  sideWallMax: number;
}
export const DEFAULT_EXPOSURE_THRESHOLDS: Readonly<ExposureThresholds> = { partyWallMax: 0.6, sideWallMax: 4.0 };

export type FacadeExposure = 'front' | 'side' | 'party';
export const exposureOf = (clearance: number, t: ExposureThresholds = DEFAULT_EXPOSURE_THRESHOLDS): FacadeExposure =>
  clearance < t.partyWallMax ? 'party' : clearance < t.sideWallMax ? 'side' : 'front';

/** 光線の始点を壁の内側にずらす量。隣の建物とフットプリントが少し重なっていても界壁を検出するため */
const RAY_BACKOFF = 0.5;
const CELL = 20;

interface Seg {
  b: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

class SegmentGrid {
  private cells = new Map<number, number[]>();
  private stamp: Int32Array;
  private query = 0;

  constructor(readonly segs: Seg[]) {
    this.stamp = new Int32Array(segs.length);
    segs.forEach((s, i) => {
      this.forCells(Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by), (key) => {
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(i);
      });
    });
  }

  private forCells(x0: number, y0: number, x1: number, y1: number, fn: (key: number) => void): void {
    const cx0 = Math.floor(x0 / CELL), cy0 = Math.floor(y0 / CELL);
    const cx1 = Math.floor(x1 / CELL), cy1 = Math.floor(y1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) fn(cx * 73856093 + cy);
  }

  /** 線分 (x0,y0)-(x1,y1) と bbox が重なるセグメントを重複なく列挙する */
  each(x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void): void {
    const q = ++this.query;
    this.forCells(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), (key) => {
      for (const i of this.cells.get(key) ?? []) {
        if (this.stamp[i] === q) continue;
        this.stamp[i] = q;
        fn(i);
      }
    });
  }
}

/** 光線 o + t·d と線分 a-b の交点の t（交わらなければ Infinity） */
function rayHit(ox: number, oy: number, dx: number, dy: number, s: Seg): number {
  const ex = s.bx - s.ax, ey = s.by - s.ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const wx = s.ax - ox, wy = s.ay - oy;
  const t = (wx * ey - wy * ex) / den;
  const u = (wx * dy - wy * dx) / den;
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * @param heights 各建物の地上からの高さ (m)
 * @param thresholds 各建物の壁面分類のしきい値（日当たり面の判定に使う）
 */
export function analyzeFacades(
  buildings: BuildingRings[],
  heights: number[] = [],
  thresholds: ExposureThresholds[] = [],
): SegmentFacade[][][][] {
  // ---- 全セグメントを空間インデックスに
  const segs: Seg[] = [];
  buildings.forEach((polys, b) =>
    polys.forEach((rings) =>
      rings.forEach((ring) =>
        ring.forEach(([ax, ay], i) => {
          const [bx, by] = ring[(i + 1) % ring.length];
          segs.push({ b, ax, ay, bx, by });
        }),
      ),
    ),
  );
  const grid = new SegmentGrid(segs);

  let runCounter = 0;
  let segIndex = 0;
  return buildings.map((polys, b) => {
    const result = polys.map((rings) =>
      rings.map((ring) => {
        const n = ring.length;
        const out: SegmentFacade[] = [];
        const dirs = ring.map(([x0, y0], i) => {
          const [x1, y1] = ring[(i + 1) % n];
          const len = Math.hypot(x1 - x0, y1 - y0);
          return { len, tx: len > 0 ? (x1 - x0) / len : 1, ty: len > 0 ? (y1 - y0) / len : 0 };
        });

        // ---- 前面のあき
        for (let i = 0; i < n; i++) {
          const self = segIndex + i;
          const { len, tx, ty } = dirs[i];
          const nx = ty, ny = -tx;
          let clearance = MAX_CLEARANCE;
          let coverHeight = 0;
          if (len >= 0.05) {
            const samples = Math.min(7, Math.max(2, Math.ceil(len / 3)));
            const hits: number[] = [];
            const covers: number[] = [];
            for (let k = 0; k < samples; k++) {
              const t = (k + 0.5) / samples;
              const px = ring[i][0] + tx * len * t - nx * RAY_BACKOFF;
              const py = ring[i][1] + ty * len * t - ny * RAY_BACKOFF;
              const reach = MAX_CLEARANCE + RAY_BACKOFF;
              let best = Infinity;
              let bestBuilding = -1;
              grid.each(px, py, px + nx * reach, py + ny * reach, (j) => {
                if (j === self) return;
                const s = segs[j];
                const hit = rayHit(px, py, nx, ny, s);
                // 自分の建物の壁は、壁面より外側（中庭の対面など）にあるときだけ数える
                if (s.b === b && hit < RAY_BACKOFF + 0.05) return;
                if (hit < best) {
                  best = hit;
                  bestBuilding = s.b;
                }
              });
              const d = Math.min(MAX_CLEARANCE, Math.max(0, best - RAY_BACKOFF));
              hits.push(d);
              covers.push(bestBuilding >= 0 && d < MAX_CLEARANCE ? (heights[bestBuilding] ?? Infinity) : 0);
            }
            clearance = median(hits);
            coverHeight = median(covers);
          }
          out.push({ runOffset: 0, runLength: 0, runId: 0, clearance, coverHeight, sunSide: false });
        }

        // ---- 連続面: 曲がりの小さい頂点ではつなげる
        const isCorner = (i: number) => {
          const a = dirs[(i - 1 + n) % n], c = dirs[i];
          if (a.len < 1e-6 || c.len < 1e-6) return false;
          const angle = Math.atan2(a.tx * c.ty - a.ty * c.tx, a.tx * c.tx + a.ty * c.ty);
          return Math.abs(angle) > CORNER_ANGLE;
        };
        const corners = dirs.map((_, i) => isCorner(i));
        const start = corners.indexOf(true);
        if (start < 0) {
          // 角のない閉じた面（円筒形など）: 継ぎ目なく一周させる
          const id = runCounter++;
          let offset = 0;
          const total = dirs.reduce((s, d) => s + d.len, 0);
          for (let i = 0; i < n; i++) {
            Object.assign(out[i], { runOffset: offset, runLength: -total, runId: id });
            offset += dirs[i].len;
          }
        } else {
          let members: number[] = [];
          let offset = 0;
          const flush = () => {
            const id = runCounter++;
            for (const i of members) Object.assign(out[i], { runLength: offset, runId: id });
            members = [];
            offset = 0;
          };
          for (let k = 0; k < n; k++) {
            const i = (start + k) % n;
            if (k > 0 && corners[i]) flush();
            out[i].runOffset = offset;
            offset += dirs[i].len;
            members.push(i);
          }
          flush();
        }

        segIndex += n;
        return out;
      }),
    );

    // ---- 日当たり面: 開けた面のうち、最も南を向いている面とそれに近い向きの面
    const facades = result.flatMap((rings, p) =>
      rings.flatMap((segsOfRing, r) =>
        segsOfRing.map((f, i) => {
          const ring = polys[p][r];
          const [x0, y0] = ring[i];
          const [x1, y1] = ring[(i + 1) % ring.length];
          const len = Math.hypot(x1 - x0, y1 - y0) || 1;
          return { f, south: (x1 - x0) / len }; // 外向き法線の南向き成分 = -ny = tx
        }),
      ),
    );
    const t = thresholds[b] ?? DEFAULT_EXPOSURE_THRESHOLDS;
    const open = facades.filter(({ f }) => exposureOf(f.clearance, t) === 'front');
    if (open.length) {
      const best = Math.max(...open.map((o) => o.south));
      const threshold = Math.max(best - 0.35, -0.2);
      for (const o of open) o.f.sunSide = o.south >= threshold;
    }
    return result;
  });
}
