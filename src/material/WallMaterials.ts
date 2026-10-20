// 外壁の素材（法線とつや）のテクスチャ。画像を配布せず、レイヤーの初期化時に手続き的に作る。
// RGBA8 の 1 テクセル = 法線の xy（-1..1 を 0..255）、ラフネス (0..1)、凹み（目地・穴・斑点などの暗さ。1 = そのまま）。
// ミップマップは自前で作り、細かい凹凸が平均されて消える分をラフネスに足す（遠くから見ても質感の平均が保たれる）。
// シェーダ側（FACADE_FS の u_materials）とチャンネルの意味を合わせること。

/** 素材の番号はこの順（テクスチャ配列の層、スタイルに詰める割合の順） */
export const WALL_MATERIALS = ['tile', 'concrete', 'stone', 'metal'] as const;
export type WallMaterialName = (typeof WALL_MATERIALS)[number];

/** テクスチャの 1 辺のテクセル数。タイル（0.98m 四方）で約 3.8mm、ほかの素材（1.8〜2m 四方）で約 7〜8mm / テクセル */
export const MATERIAL_TEXTURE_SIZE = 256;

/** 素材の数の上限（スタイルのテクセル 20 の yzw と 21 の zw に割合を詰める） */
export const MAX_WALL_MATERIALS = 5;

/** 素材ごとの性質。シェーダに uniform で渡す */
export interface MaterialProps {
  /** テクスチャ 1 枚が覆う壁の大きさ (m)。正方形 */
  period: number;
  /** 金属らしさ (0–1)。1 は拡散反射がなく、映り込みに素材の色が付く */
  metalness: number;
  /** 外壁の色を寄せる色と割合 [r, g, b, 割合]。コンクリート打ち放しは灰色に寄せる */
  tint: [number, number, number, number];
}

export const MATERIAL_PROPS: Readonly<Record<WallMaterialName, MaterialProps>> = {
  tile: { period: 0.98, metalness: 0, tint: [0, 0, 0, 0] },
  concrete: { period: 1.8, metalness: 0, tint: [0.6, 0.6, 0.58, 0.85] },
  stone: { period: 1.8, metalness: 0, tint: [0, 0, 0, 0] },
  metal: { period: 2.0, metalness: 1, tint: [0, 0, 0, 0] },
};

export interface MaterialTexture {
  /** 1 辺のテクセル数（2 のべき乗） */
  size: number;
  /** テクスチャ 1 枚が覆う壁の大きさ (m)。[壁に沿った方向, 高さ方向] */
  period: [number, number];
  /** levels[0] が最も細かい。最後は 1×1 */
  levels: Uint8Array[];
  /** 1×1 のミップと同じ値（遠景ではテクスチャを読まずにこれを使う）。[ラフネス, 凹み] */
  average: [number, number];
  metalness: number;
  tint: [number, number, number, number];
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

/** 目地の溝（幅がテクセルより細いものは、テクセル幅のなだらかな溝にする） */
const groove = (distance: number, halfWidth: number, texel: number) => 1 - smoothstep(halfWidth, halfWidth + texel, distance);

/**
 * コンクリート打ち放し。型枠（900 × 1800 mm）の継ぎ目の細い溝と、450 mm 間隔のセパ穴（Φ25 mm、深さ 8 mm）。
 * 面は細かい気泡とゆるい凹凸があり、型枠ごと・打設ごとに色がむらになる。1 枚 = 型枠 2 枚分（1.8 m 四方）
 */
function concreteSurface(size: number, period: number): Surface {
  const panelW = 0.9, panelH = 1.8, holeR = 0.0125, texel = period / size;
  const height = new Float32Array(size * size);
  const roughness = new Float32Array(size * size);
  const cavity = new Float32Array(size * size);
  const pores = tiledNoise(96, 31), waves = tiledNoise(6, 37), pour = tiledNoise(3, 41);
  const panelTone = [0, 1].map((i) => hash(i, 0, 43));
  for (let py = 0; py < size; py++) {
    const y = ((py + 0.5) / size) * period;
    const ly = y % panelH;
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * period;
      const panel = Math.floor(x / panelW);
      const lx = x - panel * panelW;
      const seam = groove(Math.min(lx, panelW - lx, ly, panelH - ly), 0.0015, texel);
      // セパ穴: 型枠の中で 3 列 × 4 段
      const hx = (Math.floor(lx / 0.3) + 0.5) * 0.3, hy = (Math.floor(ly / 0.45) + 0.5) * 0.45;
      const hole = 1 - smoothstep(holeR - texel * 0.5, holeR + texel * 0.5, Math.hypot(lx - hx, ly - hy));
      const u = x / period, v = y / period;
      const pore = pores(u * 96, v * 96);
      const i = py * size + px;
      height[i] = (waves(u * 6, v * 6) - 0.5) * 0.0012 + (pore - 0.5) * 0.0003 - seam * 0.0015 - hole * 0.008;
      roughness[i] = 0.72 + (pore - 0.5) * 0.12 + hole * 0.2;
      cavity[i] = (0.95 + panelTone[panel] * 0.08) * (0.95 + pour(u * 3, v * 3) * 0.08) * (1 - 0.1 * seam) * (1 - 0.5 * hole) * (pore < 0.12 ? 0.85 : 1);
    }
  }
  return { height, roughness, cavity };
}

/**
 * 石張り（御影石の本磨き）。900 × 600 mm の芋目地、目地幅 8 mm（シーリング）。
 * 磨いた面は強いつやがあり、石ごとに色合いが少し違い、細かい斑点がある。1 枚 = 2 列 × 3 段（1.8 m 四方）
 */
function stoneSurface(size: number, period: number): Surface {
  const stoneW = 0.9, stoneH = 0.6, texel = period / size;
  const height = new Float32Array(size * size);
  const roughness = new Float32Array(size * size);
  const cavity = new Float32Array(size * size);
  const speckle = tiledNoise(128, 51), veins = tiledNoise(12, 53);
  const rand = Array.from({ length: 2 * 3 * 3 }, (_, i) => hash(Math.floor(i / 3), i % 3, 57));
  for (let py = 0; py < size; py++) {
    const y = ((py + 0.5) / size) * period;
    const row = Math.floor(y / stoneH);
    const ly = y - row * stoneH;
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * period;
      const col = Math.floor(x / stoneW);
      const lx = x - col * stoneW;
      const joint = groove(Math.min(lx, stoneW - lx, ly, stoneH - ly), 0.004, texel);
      const r = (row * 2 + col) * 3;
      const u = x / period, v = y / period;
      const sp = speckle(u * 128, v * 128);
      // 斑点: 濃い粒と白い粒
      const grain = sp > 0.72 ? 0.72 : sp < 0.18 ? 1.1 : 1;
      // 石ごとのわずかな傾き（±0.1°）
      const tilt = ((rand[r] - 0.5) * (lx - stoneW / 2) + (rand[r + 1] - 0.5) * (ly - stoneH / 2)) * 0.0035;
      const i = py * size + px;
      height[i] = (1 - joint) * tilt - joint * 0.006;
      roughness[i] = (1 - joint) * (0.16 + rand[r + 2] * 0.08) + joint * 0.6;
      cavity[i] = (1 - joint) * (0.93 + rand[r + 2] * 0.12) * grain * (0.96 + veins(u * 12, v * 12) * 0.06) + joint * 0.55;
    }
  }
  return { height, roughness, cavity };
}

/**
 * 金属パネル（アルミ複合板など）。1000 × 2000 mm、目地は幅 10 mm の開いた目地。
 * 面はつやが強く、パネルごとにわずかにふくらむ・へこむ（オイルキャンニング）ので、映り込みがパネルごとにゆがむ。
 * 1 枚 = 2 列 × 1 段（2 m 四方）
 */
function metalSurface(size: number, period: number): Surface {
  const panelW = 1.0, panelH = 2.0, texel = period / size;
  const height = new Float32Array(size * size);
  const roughness = new Float32Array(size * size);
  const cavity = new Float32Array(size * size);
  const rand = [0, 1].map((i) => [hash(i, 0, 61), hash(i, 0, 67)]);
  for (let py = 0; py < size; py++) {
    const y = ((py + 0.5) / size) * period;
    const ly = y % panelH;
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * period;
      const panel = Math.floor(x / panelW);
      const lx = x - panel * panelW;
      const joint = groove(Math.min(lx, panelW - lx, ly, panelH - ly), 0.005, texel);
      const [bowR, toneR] = rand[panel];
      const su = (2 * lx) / panelW - 1, sv = (2 * ly) / panelH - 1;
      const bow = (bowR - 0.5) * 0.004 * (1 - su * su) * (1 - sv * sv);
      const i = py * size + px;
      height[i] = (1 - joint) * bow - joint * 0.02;
      roughness[i] = (1 - joint) * (0.2 + toneR * 0.08) + joint * 0.9;
      cavity[i] = (1 - joint) * (0.96 + toneR * 0.06) + joint * 0.25;
    }
  }
  return { height, roughness, cavity };
}

const GENERATORS: Record<WallMaterialName, (size: number, period: number) => Surface> = {
  tile: tileSurface,
  concrete: concreteSurface,
  stone: stoneSurface,
  metal: metalSurface,
};

const cache = new Map<string, MaterialTexture>();

/** 素材のテクスチャを作る（同じ素材・大きさなら作り直さない） */
export function createMaterialTexture(name: WallMaterialName, size = MATERIAL_TEXTURE_SIZE): MaterialTexture {
  const key = `${name}/${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { period, metalness, tint } = MATERIAL_PROPS[name];
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

  const tex: MaterialTexture = { size, period: [period, period], levels, average, metalness, tint };
  cache.set(key, tex);
  return tex;
}
