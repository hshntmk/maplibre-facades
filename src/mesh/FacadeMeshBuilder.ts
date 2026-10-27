import earcut from 'earcut';
import { mercatorX, mercatorY, meterInMercator } from '../math/mercator';
import { categoryIndex, type BuildingRecord, type LngLatRing } from '../model/BuildingRecord';
import { DEFAULT_EXPOSURE_THRESHOLDS, analyzeFacades, exposureOf, type BuildingRings, type ExposureThresholds, type Point, type SegmentFacade } from './FacadeAnalyzer';
import { buildRingBalconies, firstBalconyFloor, floorLayout, type BalconyEmitter, type BalconyLayout } from './Balconies';
import { buildRingFrontage, keyOf, type FixtureEmitter, type FrontageLayout } from './Frontage';
import { BALCONY_STRIDE, FIXTURE_STRIDE, GROUND_STRIDE, ROOF_STRIDE, WALL_STRIDE, type FacadeLengths, type FacadeMesh, type MeshReference } from './layout';
import { EQUIPMENT_TYPES, generateRooftop } from './RooftopGenerator';

// フットプリントから壁（窓はシェーダで描くので 1 セグメント = 1 四角形）と屋根のメッシュを作る。
// 座標は基準点からの局所座標（m, x=東, y=北, z=上）。float32 の精度不足を避けるため（RTC）。
// 窓の配置に必要な形状情報（連続面・前面のあき・日当たり面）は FacadeAnalyzer で全建物をまとめて解析する。

export { ROOF_STRIDE, WALL_STRIDE, type FacadeMesh, type MeshReference } from './layout';
export { mercatorX, mercatorY } from '../math/mercator';

export function createReference(lng: number, lat: number): MeshReference {
  return { mercX: mercatorX(lng), mercY: mercatorY(lat), meterInMercator: meterInMercator(lat) };
}

/** 文字列 ID → [0,1) の安定した乱数シード（FNV-1a） */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

class GrowableF32 {
  data = new Float32Array(1 << 16);
  length = 0;
  reserve(n: number) {
    if (this.length + n <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Float32Array(size);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  push(...v: number[]) {
    this.reserve(v.length);
    this.data.set(v, this.length);
    this.length += v.length;
  }
  result() {
    return this.data.slice(0, this.length);
  }
}
class GrowableU32 {
  data = new Uint32Array(1 << 16);
  length = 0;
  push(...v: number[]) {
    if (this.length + v.length > this.data.length) {
      const next = new Uint32Array(Math.max(this.data.length * 2, this.length + v.length));
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    this.data.set(v, this.length);
    this.length += v.length;
  }
  result() {
    return this.data.slice(0, this.length);
  }
}

interface PendingBuilding {
  record: BuildingRecord;
  styleIndex: number;
  polygons: BuildingRings;
  /** 壁面の解析には使うが、メッシュは作らない（隣のタイルの建物など） */
  obstacle: boolean;
}

export class FacadeMeshBuilder {
  private pending: PendingBuilding[] = [];

  /**
   * @param thresholds スタイル番号ごとの壁面分類のしきい値
   * @param balconies スタイル番号ごとのバルコニーの設定（省略時はバルコニーの形を作らない）
   * @param frontages スタイル番号ごとの 1 階の設定（省略時は庇・テント・突き出し看板を作らない）
   */
  constructor(
    readonly reference: MeshReference,
    private readonly thresholds: ExposureThresholds[] = [],
    private readonly balconies: BalconyLayout[] = [],
    private readonly frontages: FrontageLayout[] = [],
  ) {}

  private thresholdsOf(styleIndex: number): ExposureThresholds {
    return this.thresholds[styleIndex] ?? DEFAULT_EXPOSURE_THRESHOLDS;
  }

  private toLocal([lng, lat]: [number, number]): Point {
    const r = this.reference;
    return [(mercatorX(lng) - r.mercX) / r.meterInMercator, -(mercatorY(lat) - r.mercY) / r.meterInMercator];
  }

  add(record: BuildingRecord, styleIndex: number, options: { obstacle?: boolean } = {}): void {
    const polygons = record.geometry.polygons
      .map((polygon) => polygon.map((ring, i) => orient(ring.map((c) => this.toLocal(c)), i === 0)))
      .filter((rings) => rings[0].length >= 3);
    if (polygons.length) this.pending.push({ record, styleIndex, polygons, obstacle: options.obstacle ?? false });
  }

  build(): FacadeMesh & { facadeLengths: FacadeLengths } {
    const walls = new GrowableF32();
    const wallIdx = new GrowableU32();
    const roofs = new GrowableF32();
    const roofIdx = new GrowableU32();
    const equipment = new GrowableF32();
    const lights = new GrowableF32();
    const grounds = new GrowableF32();
    const balconies = new GrowableF32();
    const balconyIdx = new GrowableU32();
    const fixtures = new GrowableF32();
    const fixtureIdx = new GrowableU32();
    const lengths: FacadeLengths = { front: 0, side: 0, party: 0, sunSide: 0 };

    const facades = analyzeFacades(
      this.pending.map((p) => p.polygons),
      this.pending.map((p) => p.record.height),
      this.pending.map((p) => this.thresholdsOf(p.styleIndex)),
    );

    this.pending.forEach(({ record, styleIndex, polygons, obstacle }, bi) => {
      if (obstacle) return;
      // 地形の標高は建物ごとに 1 つ（斜面でも建物は傾けない）。引く位置として外接矩形を渡す
      const ground = grounds.length / GROUND_STRIDE;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const rings of polygons) {
        for (const [x, y] of rings[0]) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      grounds.push(minX, minY, maxX, maxY);
      const seed = hashId(record.id);
      const cat = categoryIndex(record.category);
      const fh = record.floorHeight ?? 3.2;
      const top = record.height;
      const bottom = record.minHeight;
      const thresholds = this.thresholdsOf(styleIndex);
      const height = top - bottom;
      const age = buildingAge(record.yearBuilt);
      const balconyLayout = this.balconies[styleIndex];
      const frontageLayout = this.frontages[styleIndex];
      // 1 階の構成を決める整数のキー（シェーダと Worker で同じ判定をする）
      const buildingKey = keyOf(record.id);
      const runKeys = new Map<number, number>();
      const runKey = (runId: number) => {
        let k = runKeys.get(runId);
        if (k === undefined) runKeys.set(runId, (k = keyOf(`${record.id}:run${runId}`)));
        return k;
      };
      const entranceRun = chooseEntranceRun(polygons, facades[bi], thresholds);
      const floors = balconyLayout && balconyLayout.depth > 0 ? floorLayout(height, fh, balconyLayout.raisedGroundFloor) : undefined;

      // ---- 屋上設備と航空障害灯
      const rooftop = generateRooftop({
        polygons,
        height,
        storeys: record.storeys ?? Math.max(1, Math.round(height / fh)),
        category: record.category,
        openSided: record.openSided,
        seed: hashId(`${record.id}:roof`),
      });
      for (const e of rooftop.equipment) {
        equipment.push(e.x, e.y, top, e.w, e.d, e.h, e.angle, EQUIPMENT_TYPES.indexOf(e.type), e.rank, styleIndex, seed, height, ground);
      }
      const phase = hashId(`${record.id}:light`);
      for (const [x, y] of rooftop.lights) lights.push(x, y, top, height, phase, ground);

      polygons.forEach((rings, pi) => {
        // ---- 壁: リングの各辺を 1 枚の四角形に。u は連続面に沿った距離
        rings.forEach((ring, ri) => {
          const ringFacades = facades[bi][pi][ri];
          const segmentLength = (i: number) => {
            const [x0, y0] = ring[i];
            const [x1, y1] = ring[(i + 1) % ring.length];
            return Math.hypot(x1 - x0, y1 - y0);
          };
          // バルコニーを付ける最初の階（辺ごと。0 = なし）
          const from = ring.map((_, i) =>
            floors && segmentLength(i) >= 0.05 ? firstBalconyFloor(balconyLayout, ringFacades[i], height, bottom, floors, thresholds) : 0,
          );
          // 外壁と同じ形式の頂点。balconyDepth が負なら引っ込んだ壁
          const wallQuad = (i: number, a: Point, b: Point, uA: number, uB: number, zBottom: number, zTop: number, balconyFrom: number, balconyDepth: number) => {
            const f = ringFacades[i];
            const len = segmentLength(i);
            const [x0, y0] = ring[i];
            const [x1, y1] = ring[(i + 1) % ring.length];
            const tx = (x1 - x0) / len;
            const ty = (y1 - y0) / len;
            const runSeed = hashId(`${record.id}:run${f.runId}`);
            const base = walls.length / WALL_STRIDE;
            const v = (x: number, y: number, z: number, u: number) =>
              walls.push(x, y, z, u, z - bottom, tx, ty, f.runLength, runSeed, styleIndex, seed, fh, cat, top - bottom, f.clearance, f.sunSide ? 1 : 0, f.coverHeight - bottom, age, ground, balconyFrom, balconyDepth, runKey(f.runId), buildingKey, f.runId === entranceRun ? 1 : 0);
            v(a[0], a[1], zBottom, uA);
            v(b[0], b[1], zBottom, uB);
            v(b[0], b[1], zTop, uB);
            v(a[0], a[1], zTop, uA);
            wallIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          };
          for (let i = 0; i < ring.length; i++) {
            const len = segmentLength(i);
            if (len < 0.05) continue;
            const f = ringFacades[i];
            const depth = from[i] > 0 ? balconyLayout.depth : 0;
            wallQuad(i, ring[i], ring[(i + 1) % ring.length], f.runOffset, f.runOffset + len, bottom, top, from[i], depth);

            lengths[exposureOf(f.clearance, thresholds)] += len;
            if (f.sunSide) lengths.sunSide += len;
          }

          if (frontageLayout) {
            const fixtureEmitter: FixtureEmitter = {
              quad: (part, corners, normal, uv, color, shop) => {
                const base = fixtures.length / FIXTURE_STRIDE;
                corners.forEach(([x, y, z], c) => fixtures.push(x, y, z, ...normal, uv[c][0], uv[c][1], part, color, shop, ground));
                fixtureIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
              },
            };
            ringFacades.forEach((f) => runKey(f.runId));
            buildRingFrontage(
              { ring, facades: ringFacades, runKeys, entranceRun, layout: frontageLayout, thresholds, height, floorHeight: fh, bottom, category: cat },
              fixtureEmitter,
            );
          }

          if (!floors || !from.some((k) => k > 0)) return;
          const emitter: BalconyEmitter = {
            innerWall: (i, a, b, uA, uB, balconyFrom, zBottom, zTop) => wallQuad(i, a, b, uA, uB, zBottom, zTop, balconyFrom, -balconyLayout.depth),
            quad: (part, corners, normal, outward, depth, rel, ceiling) => {
              const base = balconies.length / BALCONY_STRIDE;
              corners.forEach(([x, y, z], c) =>
                balconies.push(x, y, z, ...normal, outward[0], outward[1], depth[c], rel[c], ceiling, part, styleIndex, seed, ground),
              );
              balconyIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            },
          };
          buildRingBalconies({ ring, facades: ringFacades, from, layout: balconyLayout, floors, bottom }, emitter);
        });

        // ---- 屋根
        const flat: number[] = [];
        const holes: number[] = [];
        rings.forEach((ring, i) => {
          if (i > 0) holes.push(flat.length / 2);
          for (const [x, y] of ring) flat.push(x, y);
        });
        const tris = earcut(flat, holes, 2);
        const base = roofs.length / ROOF_STRIDE;
        for (let i = 0; i < flat.length; i += 2) {
          roofs.push(flat[i], flat[i + 1], top, styleIndex, seed, cat, rooftop.axisAngle, rooftop.roofArea, height, ground);
        }
        for (const t of tris) roofIdx.push(base + t);
      });
    });

    return {
      reference: this.reference,
      walls: walls.result(),
      wallIndices: wallIdx.result(),
      roofs: roofs.result(),
      roofIndices: roofIdx.result(),
      equipment: equipment.result(),
      lights: lights.result(),
      balconies: balconies.result(),
      balconyIndices: balconyIdx.result(),
      fixtures: fixtures.result(),
      fixtureIndices: fixtureIdx.result(),
      grounds: grounds.result(),
      facadeLengths: lengths,
    };
  }
}

/**
 * 入口のある連続面: 正面（開けた面）のうち、前面のあき（道路側ほど広い）と長さで最も表らしいもの。なければ -1
 */
function chooseEntranceRun(polygons: BuildingRings, facades: SegmentFacade[][][], thresholds: ExposureThresholds): number {
  const scores = new Map<number, number>();
  polygons.forEach((rings, pi) =>
    facades[pi][0].forEach((f, i) => {
      const [x0, y0] = rings[0][i];
      const [x1, y1] = rings[0][(i + 1) % rings[0].length];
      if (Math.hypot(x1 - x0, y1 - y0) < 0.05 || exposureOf(f.clearance, thresholds) !== 'front') return;
      const score = Math.min(f.clearance, 40) + 0.5 * Math.min(Math.abs(f.runLength), 30);
      scores.set(f.runId, Math.max(scores.get(f.runId) ?? -Infinity, score));
    }),
  );
  let best = -1;
  let bestScore = -Infinity;
  for (const [id, score] of scores) {
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/** 築年数を 0（新しい）〜1（50 年以上）に。建築年が不明なら -1（シェーダで建物ごとにばらつかせる） */
export function buildingAge(yearBuilt: number | undefined, now = new Date().getFullYear()): number {
  if (yearBuilt === undefined || !Number.isFinite(yearBuilt) || yearBuilt < 1800 || yearBuilt > now) return -1;
  return Math.min(1, Math.max(0, (now - yearBuilt) / 50));
}

/** 外周は反時計回り、穴は時計回りにそろえる（上から見て）。これで外向き法線 = (ty, -tx) になる */
function orient(ring: Point[], outer: boolean): Point[] {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    area += x0 * y1 - x1 * y0;
  }
  return (area > 0) === outer ? ring : [...ring].reverse();
}

/** GeoJSON の座標配列から終点の重複を除く */
export function openRing(ring: number[][]): LngLatRing {
  const out = ring.map((c) => [c[0], c[1]] as [number, number]);
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return out;
}
