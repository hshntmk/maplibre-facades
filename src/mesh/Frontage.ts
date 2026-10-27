import { exposureOf, type ExposureThresholds, type Point, type SegmentFacade } from './FacadeAnalyzer';
import { floorLayout, runColumns, type RunColumns } from './Balconies';

// 1 階の構成（店舗のテナント・入口・駐車場・ガレージなど）の決め方。
// 外壁のシェーダ（shaders.ts の FRONTAGE_GLSL）が壁に描き、Worker が立体の庇・テント・突き出し看板を作るので、
// どちらでも同じ結果になるよう、判定はすべて 32 ビット整数のハッシュで行う（浮動小数点の乱数はシェーダと JavaScript で結果が少し違う）。
// 数値を変えるときは FRONTAGE_GLSL も合わせること（定数はここから埋め込む）。

/** スタイルの groundFloor の番号（シェーダと同じ） */
export const GROUND_MODES = { same: 0, storefront: 1, lobby: 2, apartment: 3, house: 4 } as const;
export type GroundMode = (typeof GROUND_MODES)[keyof typeof GROUND_MODES];

/** 店の種類 */
export const SHOP = { retail: 0, restaurant: 1, convenience: 2, service: 3, vacant: 4 } as const;

type RGB = [number, number, number];
/** 看板の地の色 */
export const SIGN_COLORS: RGB[] = [
  [0.92, 0.92, 0.9],
  [0.78, 0.12, 0.1],
  [0.95, 0.75, 0.1],
  [0.1, 0.42, 0.25],
  [0.1, 0.25, 0.55],
  [0.95, 0.45, 0.1],
  [0.12, 0.12, 0.13],
  [0.55, 0.15, 0.4],
];
/** テントの色 */
export const AWNING_COLORS: RGB[] = [
  [0.6, 0.12, 0.1],
  [0.12, 0.3, 0.2],
  [0.15, 0.2, 0.4],
  [0.75, 0.55, 0.2],
  [0.3, 0.3, 0.32],
  [0.85, 0.85, 0.82],
];

/** 店のガラスの両端（テナントの境目）の柱の幅 (m) */
export const PILLAR = 0.35;
/** テントの出 (m) */
export const AWNING_DEPTH = 1.0;
/** 突き出し看板の出・高さ (m) */
export const PROJECTING_SIGN = { depth: 0.6, height: 1.8, thickness: 0.15 };
/** 店舗の割合（%）: 物販・飲食・コンビニ・事務所や医院・空き店舗の順に累積 */
export const SHOP_SHARES = [38, 62, 72, 86];

export function hashU32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export const mixKey = (a: number, b: number): number => hashU32((a ^ hashU32((b + 0x9e3779b9) >>> 0)) >>> 0);

/** 文字列 → 24 ビットの整数（float32 の頂点属性にそのまま入る） */
export function keyOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0xffffff;
}

export interface Tenant {
  /** テナントの最初と最後の窓の列 */
  start: number;
  end: number;
  key: number;
  shop: number;
  awning: boolean;
  signColor: number;
  awningColor: number;
  stripes: boolean;
  projectingSign: boolean;
  /** 0–1。shopOpenNow() と比べて開店しているかを決める */
  openKey: number;
}

export function shopType(key: number): number {
  const p = (key >>> 4) % 100;
  return p < SHOP_SHARES[0] ? SHOP.retail : p < SHOP_SHARES[1] ? SHOP.restaurant : p < SHOP_SHARES[2] ? SHOP.convenience : p < SHOP_SHARES[3] ? SHOP.service : SHOP.vacant;
}

/** col 列目を含むテナント。間口は窓 1〜3 列分で、連続面ごとに区切りの位置をずらす */
export function tenantOf(runKey: number, col: number, columns: number): Tenant {
  const span = Math.min(1 + (mixKey(runKey, 1) % 3), columns);
  const offset = mixKey(runKey, 2) % span;
  const index = Math.floor((col + offset) / span);
  const first = index * span - offset;
  const key = mixKey(runKey, 100 + index);
  const shop = shopType(key);
  const awningRoll = (key >>> 12) % 100;
  return {
    start: Math.max(first, 0),
    end: Math.min(first + span - 1, columns - 1),
    key,
    shop,
    awning: shop === SHOP.restaurant ? awningRoll < 55 : shop === SHOP.retail ? awningRoll < 30 : false,
    signColor: (key >>> 16) % SIGN_COLORS.length,
    awningColor: (key >>> 20) % AWNING_COLORS.length,
    stripes: ((key >>> 24) & 1) === 1,
    projectingSign: shop !== SHOP.vacant && mixKey(key, 7) % 100 < 35,
    openKey: ((key >>> 8) % 1000) / 1000,
  };
}

/** 店舗の 1 階の高さ（階の床から m） */
export function storefrontHeights(groundHeight: number, awning: boolean) {
  const glassTop = groundHeight * 0.66;
  const awningTop = glassTop + 0.55;
  const signBottom = awning ? awningTop + 0.08 : glassTop + 0.15;
  const signTop = Math.min(signBottom + 0.8, groundHeight - 0.12);
  return { glassTop, awningTop, signBottom, signTop };
}

/** ロビーのガラスの上端（階の床から m） */
export const lobbyGlassTop = (groundHeight: number) => groundHeight * 0.8;

/** 入口の列（中央。列が偶数なら中央の 2 列） */
export const entranceColumns = (columns: number): [number, number] => [Math.floor((columns - 1) / 2), Math.floor(columns / 2)];

/** 共同住宅の入口の列と、駐車場（ピロティ）の列の範囲（なければ -1） */
export function apartmentPlan(runKey: number, columns: number): { entrance: number; parking: [number, number] } {
  const entrance = Math.min(Math.max(Math.floor((columns - 1) / 2) + (mixKey(runKey, 3) % 3) - 1, 0), columns - 1);
  if (columns < 4 || mixKey(runKey, 4) % 100 >= 40) return { entrance, parking: [-1, -1] };
  const count = 1 + (mixKey(runKey, 5) % 2);
  return { entrance, parking: entrance < columns / 2 ? [columns - count, columns - 1] : [0, count - 1] };
}

/** 戸建ての玄関の列と、ガレージの列（なければ -1） */
export function housePlan(runKey: number, columns: number, runLength: number): { door: number; garage: number } {
  const door = Math.min(Math.floor((columns - 1) / 2) + (mixKey(runKey, 3) % 2), columns - 1);
  const garage = columns >= 2 && runLength >= 5.5 && mixKey(runKey, 6) % 100 < 35 ? (door === 0 ? columns - 1 : 0) : -1;
  return { door, garage };
}

// ---------------------------------------------------------------- 立体の庇・テント・突き出し看板

/** スタイルごとの 1 階の設定（FacadeStyle から作る） */
export interface FrontageLayout {
  mode: GroundMode;
  windowSpacing: number;
  windowWidth: number;
  curtainWall: boolean;
  /** 日当たり面以外は小窓（sunSideBalconies） */
  sunSideOnly: boolean;
}

/** 立体の部材の種類（シェーダの色分けと合わせること） */
export const FIXTURE_PARTS = { awning: 0, valance: 1, canopy: 2, sign: 3, signEdge: 4 } as const;
export type FixturePart = (typeof FIXTURE_PARTS)[keyof typeof FIXTURE_PARTS];

type Vec3 = [number, number, number];

export interface FixtureEmitter {
  /** 四角形。color は部材ごとの色の番号（テントは AWNING_COLORS、看板は SIGN_COLORS）、shop は店の種類 + openKey */
  quad(part: FixturePart, corners: Vec3[], normal: Vec3, uv: [number, number][], color: number, shop: number): void;
}

export interface RingFrontageInput {
  ring: Point[];
  facades: SegmentFacade[];
  /** 連続面ごとのキー（runId → keyOf） */
  runKeys: Map<number, number>;
  /** 入口のある連続面（runId）。なければ -1 */
  entranceRun: number;
  layout: FrontageLayout;
  thresholds: ExposureThresholds;
  height: number;
  floorHeight: number;
  bottom: number;
  /** 用途の番号（ホテルは庇を深く） */
  category: number;
  /** 勾配屋根（height は軒までの高さ） */
  pitched?: boolean;
}

/** 連続面の窓の列（シェーダと同じく、日当たり面以外の小窓の間隔も考える） */
function frontageColumns(layout: FrontageLayout, facade: SegmentFacade): RunColumns | undefined {
  if (layout.windowWidth <= 0) return undefined;
  const small = layout.sunSideOnly && !facade.sunSide && !layout.curtainWall;
  return runColumns(facade.runLength, small ? layout.windowSpacing * 1.8 : layout.windowSpacing, layout.curtainWall);
}

const HOTEL_CATEGORY = 3;

/** 1 つのリングの 1 階の立体の部材を作る（正面の壁だけ） */
export function buildRingFrontage(input: RingFrontageInput, emit: FixtureEmitter): void {
  const { ring, facades, layout } = input;
  if (layout.mode === GROUND_MODES.same) return;
  const n = ring.length;
  const raised = layout.mode === GROUND_MODES.storefront || layout.mode === GROUND_MODES.lobby;
  const gfh = floorLayout(input.height, input.floorHeight, raised, input.pitched).groundHeight;
  const z0 = input.bottom;

  for (let i = 0; i < n; i++) {
    const f = facades[i];
    if (exposureOf(f.clearance, input.thresholds) !== 'front') continue;
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.05) continue;
    const cols = frontageColumns(layout, f);
    if (!cols) continue;
    const t: Point = [(x1 - x0) / len, (y1 - y0) / len];
    const out: Point = [t[1], -t[0]];
    const u0 = f.runOffset;
    const u1 = u0 + len;
    const runKey = input.runKeys.get(f.runId) ?? 0;
    const at = (u: number, d: number, z: number): Vec3 => [x0 + t[0] * (u - u0) + out[0] * d, y0 + t[1] * (u - u0) + out[1] * d, z0 + z];
    // 連続面に沿った範囲 [a, b] のうち、この辺にかかる部分
    const clip = (a: number, b: number): [number, number] | undefined => {
      const ca = Math.max(a, u0);
      const cb = Math.min(b, u1);
      return cb - ca > 0.02 ? [ca, cb] : undefined;
    };
    const colU = (c: number) => cols.margin + c * cols.width;

    // 庇の箱: u の範囲 [a, b]、出 d0〜d1、高さ zb〜zt
    const box = (part: FixturePart, edge: FixturePart, a: number, b: number, d0: number, d1: number, zb: number, zt: number, color: number, shop: number) => {
      const r = clip(a, b);
      if (!r) return;
      const [ca, cb] = r;
      const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
      emit.quad(part, [at(ca, d1, zb), at(cb, d1, zb), at(cb, d1, zt), at(ca, d1, zt)], [out[0], out[1], 0], uvs, color, shop);
      emit.quad(edge, [at(ca, d0, zt), at(cb, d0, zt), at(cb, d1, zt), at(ca, d1, zt)], [0, 0, 1], uvs, color, shop);
      emit.quad(edge, [at(ca, d0, zb), at(cb, d0, zb), at(cb, d1, zb), at(ca, d1, zb)], [0, 0, -1], uvs, color, shop);
      if (ca === a) emit.quad(edge, [at(ca, d0, zb), at(ca, d1, zb), at(ca, d1, zt), at(ca, d0, zt)], [-t[0], -t[1], 0], uvs, color, shop);
      if (cb === b) emit.quad(edge, [at(cb, d0, zb), at(cb, d1, zb), at(cb, d1, zt), at(cb, d0, zt)], [t[0], t[1], 0], uvs, color, shop);
    };

    if (layout.mode === GROUND_MODES.storefront) {
      for (let c = 0; c < cols.count; ) {
        const tenant = tenantOf(runKey, c, cols.count);
        c = tenant.end + 1;
        const a = colU(tenant.start) + PILLAR;
        const b = colU(tenant.end + 1) - PILLAR;
        if (b - a < 0.5) continue;
        const h = storefrontHeights(gfh, tenant.awning);
        const shop = tenant.shop + tenant.openKey;
        if (tenant.awning) {
          // テント: 壁の awningTop から、出 AWNING_DEPTH の所でガラスの上端まで下がる斜めの面と、前の垂れ
          const r = clip(a, b);
          if (r) {
            const [ca, cb] = r;
            const lowZ = h.glassTop - 0.05;
            const slope = Math.hypot(AWNING_DEPTH, h.awningTop - lowZ);
            const normal: Vec3 = [out[0] * ((h.awningTop - lowZ) / slope), out[1] * ((h.awningTop - lowZ) / slope), AWNING_DEPTH / slope];
            const uv: [number, number][] = [[ca - a, 0], [cb - a, 0], [cb - a, 1], [ca - a, 1]];
            emit.quad(FIXTURE_PARTS.awning, [at(ca, AWNING_DEPTH, lowZ), at(cb, AWNING_DEPTH, lowZ), at(cb, 0, h.awningTop), at(ca, 0, h.awningTop)], normal, uv, tenant.awningColor + (tenant.stripes ? 0.5 : 0), shop);
            emit.quad(FIXTURE_PARTS.valance, [at(ca, AWNING_DEPTH, lowZ - 0.22), at(cb, AWNING_DEPTH, lowZ - 0.22), at(cb, AWNING_DEPTH, lowZ), at(ca, AWNING_DEPTH, lowZ)], [out[0], out[1], 0], [[ca - a, 0], [cb - a, 0], [cb - a, 1], [ca - a, 1]], tenant.awningColor + (tenant.stripes ? 0.5 : 0), shop);
            // 両端の三角の側面（壁の上端・前の上端・垂れの下端。四角形の最後の点を重ねる）
            for (const [u, sgn] of [[a, -1], [b, 1]] as const) {
              if (u < u0 - 1e-6 || u > u1 + 1e-6) continue;
              const tri = [at(u, 0, h.awningTop), at(u, AWNING_DEPTH, lowZ), at(u, AWNING_DEPTH, lowZ - 0.22)];
              emit.quad(FIXTURE_PARTS.valance, [...tri, tri[2]], [t[0] * sgn, t[1] * sgn, 0], [[0, 1], [0, 0], [0, 0], [0, 0]], tenant.awningColor, shop);
            }
          }
        }
        if (tenant.projectingSign) {
          // 突き出し看板: テナントの端の柱から、ガラスの上の高さに縦長の板。文字は両側の大きな面に描く
          const ps = PROJECTING_SIGN;
          const left = (tenant.key >>> 28) % 2 === 0;
          const ua = left ? a + 0.1 : b - 0.1 - ps.thickness;
          const ub = ua + ps.thickness;
          if (ua >= u0 && ub <= u1) {
            const zb = h.glassTop + 0.2;
            const zt = zb + ps.height;
            const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
            emit.quad(FIXTURE_PARTS.sign, [at(ua, 0.05, zb), at(ua, ps.depth, zb), at(ua, ps.depth, zt), at(ua, 0.05, zt)], [-t[0], -t[1], 0], uvs, tenant.signColor, shop);
            emit.quad(FIXTURE_PARTS.sign, [at(ub, ps.depth, zb), at(ub, 0.05, zb), at(ub, 0.05, zt), at(ub, ps.depth, zt)], [t[0], t[1], 0], uvs, tenant.signColor, shop);
            emit.quad(FIXTURE_PARTS.signEdge, [at(ua, ps.depth, zb), at(ub, ps.depth, zb), at(ub, ps.depth, zt), at(ua, ps.depth, zt)], [out[0], out[1], 0], uvs, tenant.signColor, shop);
            emit.quad(FIXTURE_PARTS.signEdge, [at(ua, 0.05, zt), at(ub, 0.05, zt), at(ub, ps.depth, zt), at(ua, ps.depth, zt)], [0, 0, 1], uvs, tenant.signColor, shop);
            emit.quad(FIXTURE_PARTS.signEdge, [at(ua, 0.05, zb), at(ub, 0.05, zb), at(ub, ps.depth, zb), at(ua, ps.depth, zb)], [0, 0, -1], uvs, tenant.signColor, shop);
          }
        }
      }
      continue;
    }

    if (f.runId !== input.entranceRun) continue;
    if (layout.mode === GROUND_MODES.lobby) {
      const [c0, c1] = entranceColumns(cols.count);
      const top = lobbyGlassTop(gfh);
      const depth = input.category === HOTEL_CATEGORY ? 3.0 : 1.8;
      box(FIXTURE_PARTS.canopy, FIXTURE_PARTS.canopy, colU(c0) - 0.6, colU(c1 + 1) + 0.6, 0, depth, top + 0.12, top + 0.42, 0, 0);
    } else if (layout.mode === GROUND_MODES.apartment) {
      const { entrance } = apartmentPlan(runKey, cols.count);
      const mid = colU(entrance) + cols.width / 2;
      const half = Math.min(cols.width / 2 - 0.3, 1.6) + 0.5;
      box(FIXTURE_PARTS.canopy, FIXTURE_PARTS.canopy, mid - half, mid + half, 0, 1.5, 2.65, 2.85, 0, 0);
    } else if (layout.mode === GROUND_MODES.house) {
      const { door } = housePlan(runKey, cols.count, Math.abs(f.runLength));
      const [da, db] = houseDoor(cols.width);
      box(FIXTURE_PARTS.canopy, FIXTURE_PARTS.canopy, colU(door) + da - 0.25, colU(door) + db + 0.25, 0, 0.7, 2.2, 2.3, 0, 0);
    }
  }
}

/** 戸建ての玄関ドアの左右（セル内 m） */
export function houseDoor(columnWidth: number): [number, number] {
  const a = columnWidth >= 1.6 ? 0.35 : Math.max(0, columnWidth / 2 - 0.45);
  return [a, Math.min(a + 0.9, columnWidth)];
}
