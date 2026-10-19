// 外壁の素材（法線とつや）のテクスチャ。画像を配布せず、レイヤーの初期化時に手続き的に作る。
// RGBA8 の 1 テクセル = 法線の xy（-1..1 を 0..255）、ラフネス (0..1)、凹み（目地などの暗さ。1 = そのまま）。
// ミップマップは自前で作り、細かい凹凸が平均されて消える分をラフネスに足す（遠くから見ても質感の平均が保たれる）。
// シェーダ側（FACADE_FS の u_materials）とチャンネルの意味を合わせること。

export const WALL_MATERIALS = ['tile'] as const;
export type WallMaterialName = (typeof WALL_MATERIALS)[number];

/** テクスチャの 1 辺のテクセル数。0.98m 四方に 256 = 約 3.8mm / テクセル（目地 10mm が 2〜3 テクセル） */
export const MATERIAL_TEXTURE_SIZE = 256;

/** スタイルに指定できる素材の数（スタイルのテクセル 20 の yzw に割合を詰める） */
export const MAX_WALL_MATERIALS = 3;

export interface MaterialTexture {
  /** 1 辺のテクセル数（2 のべき乗） */
  size: number;
  /** テクスチャ 1 枚が覆う壁の大きさ (m)。[壁に沿った方向, 高さ方向] */
  period: [number, number];
  /** levels[0] が最も細かい。最後は 1×1 */
  levels: Uint8Array[];
  /** 1×1 のミップと同じ値（遠景ではテクスチャを読まずにこれを使う）。[ラフネス, 凹み] */
  average: [number, number];
}

const hash = (a: number, b: number, c = 0): number => {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 繰り返しても継ぎ目の出ない値ノイズ（period セルで一周する）。格子点の乱数は先に表にしておく */
function tiledNoise(period: number, seed: number): (x: number, y: number) => number {
  const lattice = new Float32Array(period * period);
  for (let j = 0; j < period; j++) for (let i = 0; i < period; i++) lattice[j * period + i] = hash(i, j, seed);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = xi % period, y0 = yi % period;
    const x1 = x0 + 1 === period ? 0 : x0 + 1, y1 = y0 + 1 === period ? 0 : y0 + 1;
    const a = lattice[y0 * period + x0], b = lattice[y0 * period + x1], c = lattice[y1 * period + x0], d = lattice[y1 * period + x1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

/** 高さ・ラフネス・凹みの元データ（最も細かいレベル） */
interface Surface {
  height: Float32Array; // m
  roughness: Float32Array;
  cavity: Float32Array;
}

/**
 * 二丁掛けタイル（227 × 60 mm）の破れ目地張り。目地幅 10 mm、深さ 4 mm。
 * タイルごとにわずかな傾き・つや・色むらを付ける（焼き物の個体差）。
 * 1 枚 = 4 列 × 14 段 = 0.98 m 四方で、上下左右に継ぎ目なく繰り返す
 */
function tileSurface(size: number, period: number): Surface {
  const cols = 4, rows = 14;
  const pitchX = period / cols, pitchY = period / rows;
  const joint = 0.01, depth = 0.004, bevel = 0.0015;
  const height = new Float32Array(size * size);
  const roughness = new Float32Array(size * size);
  const cavity = new Float32Array(size * size);
  const glazeNoise = tiledNoise(48, 11), grainNoise = tiledNoise(160, 23);
  // タイルごとの乱数（傾き x, 傾き y, つや, 色むら）
  const rand = new Float32Array(cols * rows * 4).map((_, i) => hash(Math.floor(i / 4) % cols, Math.floor(i / 4 / cols), (i % 4) + 1));
  for (let py = 0; py < size; py++) {
    const y = ((py + 0.5) / size) * period;
    const row = Math.floor(y / pitchY);
    const ly = y - row * pitchY;
    // 1 段おきに半枚ずらす
    const shift = row % 2 ? pitchX / 2 : 0;
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * period;
      const xs = x + shift;
      const col = Math.floor(xs / pitchX);
      const lx = xs - col * pitchX;
      const tileId = ((col % cols) + cols) % cols;
      // 目地の中心からの距離（タイルの縁までの距離 - 目地幅の半分）
      const edge = Math.min(lx, pitchX - lx, ly, pitchY - ly) - joint / 2;
      const face = smoothstep(0, bevel, edge);
      const r = (row * cols + tileId) * 4;
      const r1 = rand[r], r2 = rand[r + 1], r3 = rand[r + 2], r4 = rand[r + 3];
      // タイルの面: わずかな傾き（±0.4°）と、釉薬の細かいうねり
      const tilt = ((r1 - 0.5) * (lx - pitchX / 2) + (r2 - 0.5) * (ly - pitchY / 2)) * 0.014;
      const glaze = (glazeNoise((x / period) * 48, (y / period) * 48) - 0.5) * 0.00012;
      // 目地のモルタル: ざらつき
      const grain = (grainNoise((x / period) * 160, (y / period) * 160) - 0.5) * 0.0004;
      const i = py * size + px;
      height[i] = face * (depth + tilt + glaze) + (1 - face) * grain;
      roughness[i] = face * (0.28 + r3 * 0.2) + (1 - face) * 0.92;
      cavity[i] = face * (0.92 + r4 * 0.14) + (1 - face) * 0.62;
    }
  }
  return { height, roughness, cavity };
}

const GENERATORS: Record<WallMaterialName, (size: number, period: number) => Surface> = {
  tile: tileSurface,
};

const PERIODS: Record<WallMaterialName, number> = { tile: 0.98 };

const cache = new Map<string, MaterialTexture>();

/** 素材のテクスチャを作る（同じ素材・大きさなら作り直さない） */
export function createMaterialTexture(name: WallMaterialName, size = MATERIAL_TEXTURE_SIZE): MaterialTexture {
  const key = `${name}/${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const period = PERIODS[name];
  const s = GENERATORS[name](size, period);
  const texel = period / size;

  // 法線（高さの中心差分。端は反対側から回り込む）
  let nx = new Float32Array(size * size), ny = new Float32Array(size * size), nz = new Float32Array(size * size);
  const hm = s.height, last = size - 1;
  for (let y = 0; y < size; y++) {
    const row = y * size, up = (y === last ? 0 : y + 1) * size, down = (y === 0 ? last : y - 1) * size;
    for (let x = 0; x < size; x++) {
      const right = x === last ? 0 : x + 1, left = x === 0 ? last : x - 1;
      const dx = (hm[row + right] - hm[row + left]) / (2 * texel);
      const dy = (hm[up + x] - hm[down + x]) / (2 * texel);
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = y * size + x;
      nx[i] = -dx / len;
      ny[i] = -dy / len;
      nz[i] = 1 / len;
    }
  }
  // ラフネスは 2 乗（GGX の α）で平均する
  let alpha2 = new Float32Array(size * size);
  for (let i = 0; i < alpha2.length; i++) alpha2[i] = s.roughness[i] * s.roughness[i] * s.roughness[i] * s.roughness[i];
  let cavity = s.cavity;

  const levels: Uint8Array[] = [];
  let average: [number, number] = [1, 1];
  for (let n = size; n >= 1; n >>= 1) {
    const out = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      // 平均した法線が短くなる分（下の細かい凹凸のばらつき）をラフネスに足す（Toksvig）
      const len = Math.min(1, Math.sqrt(nx[i] * nx[i] + ny[i] * ny[i] + nz[i] * nz[i]));
      const variance = len > 0 ? (1 - len) / len : 1;
      const rough = Math.min(1, Math.sqrt(Math.sqrt(alpha2[i] + variance)));
      const inv = len > 0 ? 1 / len : 0;
      out[i * 4] = Math.round((nx[i] * inv * 0.5 + 0.5) * 255);
      out[i * 4 + 1] = Math.round((ny[i] * inv * 0.5 + 0.5) * 255);
      out[i * 4 + 2] = Math.round(rough * 255);
      out[i * 4 + 3] = Math.round(Math.min(1, cavity[i]) * 255);
      if (n === 1) average = [rough, cavity[i]];
    }
    levels.push(out);
    if (n === 1) break;
    // 次のレベル: 2×2 の平均（法線は正規化せずに平均し、長さの縮みでばらつきを表す）
    const m = n >> 1;
    const down = (src: Float32Array) => {
      const dst = new Float32Array(m * m);
      for (let y = 0; y < m; y++)
        for (let x = 0; x < m; x++) {
          const a = 2 * y * n + 2 * x;
          dst[y * m + x] = (src[a] + src[a + 1] + src[a + n] + src[a + n + 1]) / 4;
        }
      return dst;
    };
    nx = down(nx);
    ny = down(ny);
    nz = down(nz);
    alpha2 = down(alpha2);
    cavity = down(cavity);
  }

  const tex: MaterialTexture = { size, period: [period, period], levels, average };
  cache.set(key, tex);
  return tex;
}
