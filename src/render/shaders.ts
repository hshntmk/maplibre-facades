// GLSL ES 3.00。頂点レイアウトは mesh/layout.ts、スタイルのテクセル配置は style/FacadeStyle.ts と合わせること。


const COMMON = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_styles;       // width = STYLE_TEXELS, height = スタイル数
uniform vec3 u_eye;               // カメラ位置（局所座標 m）
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform vec3 u_skyZenith;
uniform vec3 u_skyHorizon;
uniform float u_night;            // 0 = 昼, 1 = 夜
uniform int u_debug;              // 0 = 通常, 1 = 用途, 2 = スタイル, 3 = 壁面の分類
uniform vec3 u_debugColors[16];
uniform float u_parapetHeight;    // パラペットの高さ (m)。0 = OFF
uniform float u_effects;          // 0 = 効果なし（窓・室内・反射などを描かず、単色の箱にする）

/** 効果なしのときの建物の色。時刻に関係なく、一般的な 3D 建物表示（fill-extrusion）と同じような固定の陰影で描く */
const vec3 PLAIN_COLOR = vec3(0.8, 0.8, 0.78);
vec3 plainShade(vec3 n) {
  float l = max(dot(n, normalize(vec3(-0.45, 0.35, 0.82))), 0.0);
  return PLAIN_COLOR * (0.55 + 0.45 * l);
}

vec4 styleTexel(int s, int i) { return texelFetch(u_styles, ivec2(i, s), 0); }

/** 屋上面をパラペットの分だけ下げる量。スタイルでパラペットなしなら 0。低い建物では高さの 8% まで */
float parapetDrop(int sid, float h) { return min(u_parapetHeight * styleTexel(sid, 8).w, h * 0.08); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toDisplay(vec3 c) {
  c = vec3(1.0) - exp(-c * 1.35);            // 露出（明るい発光をなめらかに飽和させる）
  return pow(c, vec3(1.0 / 2.2));
}
vec3 skyColor(vec3 dir) {
  float t = clamp(dir.z, 0.0, 1.0);
  vec3 sky = mix(u_skyHorizon, u_skyZenith, sqrt(t));
  // 下向きの反射は地面と街並み（夜は街明かりで少し暖色）
  vec3 ground = mix(vec3(0.16, 0.16, 0.17), vec3(0.05, 0.04, 0.035), u_night);
  return toLinear(mix(ground, sky, smoothstep(-0.05, 0.05, dir.z)));
}
float parapet(float h) { return min(2.5, max(0.4, h * 0.03)); }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

/** 候補色（rgb + 重み）の中から、重みに応じて 1 色を選ぶ */
vec3 pickPalette(int sid, int start, int count, float r) {
  float total = 0.0;
  for (int i = 0; i < count; i++) total += styleTexel(sid, start + i).a;
  float x = r * total;
  for (int i = 0; i < count; i++) {
    vec4 t = styleTexel(sid, start + i);
    if (t.a <= 0.0) continue;
    if (x < t.a) return t.rgb;
    x -= t.a;
  }
  return styleTexel(sid, start).rgb;
}

/** 建物ごとの外壁の色: 候補から 1 色を選び、明るさと色味（暖色・寒色寄り）を少し揺らす */
vec3 buildingWallColor(int sid, float bSeed) {
  vec3 c = pickPalette(sid, 10, 6, hash12(vec2(bSeed * 131.0, 4.7)));
  float v = styleTexel(sid, 1).a;
  float brightness = 1.0 + (hash12(vec2(bSeed * 97.0, 1.3)) - 0.5) * v;
  float tint = (hash12(vec2(bSeed * 59.0, 8.1)) - 0.5) * v * 0.25;
  return clamp(c * brightness * vec3(1.0 + tint, 1.0, 1.0 - tint), 0.0, 1.0);
}

/** 建物ごとのガラスの色 */
vec3 buildingGlassTint(int sid, float bSeed) { return pickPalette(sid, 16, 4, hash12(vec2(bSeed * 211.0, 2.9))); }

/** 屋外の面の照明（空の環境光 + 太陽） */
vec3 surfaceLight(vec3 n) {
  vec3 ambient = mix(toLinear(u_skyHorizon), toLinear(u_skyZenith), 0.5 + 0.3 * n.z) * 0.9 + vec3(0.012, 0.011, 0.01);
  float sun = max(dot(n, u_sunDir), 0.0) * smoothstep(-0.02, 0.08, u_sunDir.z);
  return ambient + toLinear(u_sunColor) * sun * 1.1;
}
`;

export const FACADE_VS = /* glsl */ `#version 300 es
precision highp float;
uniform mat4 u_matrix;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_seg;     // tangent.xy, runLength（負 = 閉じた面）, runSeed
layout(location = 3) in vec4 a_bldg;    // style, bSeed, floorHeight, category
layout(location = 4) in float a_height;
layout(location = 5) in vec4 a_facade;  // clearance, sunSide, coverHeight, age
out vec3 v_world;
out vec2 v_uv;
flat out vec4 v_seg;
flat out vec4 v_bldg;
flat out float v_height;
flat out vec4 v_facade;
void main() {
  v_world = a_pos;
  v_uv = a_uv;
  v_seg = a_seg;
  v_bldg = a_bldg;
  v_height = a_height;
  v_facade = a_facade;
  gl_Position = u_matrix * vec4(a_pos, 1.0);
}
`;

export const FACADE_FS = /* glsl */ `#version 300 es
${COMMON}
uniform float u_litRatio[16];   // カテゴリ別の点灯率
uniform float u_shopOpen;
uniform float u_interior;       // 1 = インテリアマッピング有効
uniform float u_reflection;     // 反射の強さ（レイヤー全体の倍率。1 = 物理的な既定値）
uniform vec4 u_weathering;      // 外壁のくすみ: 強さ (0 = OFF), 雨だれ, くすみ, しみ
uniform vec2 u_surface;         // 表面の細部: 素材の強さ (0 = OFF), ガラスの歪み (0 = OFF)
// 外壁の素材（material/WallMaterials.ts）: 法線 xy, ラフネス, 凹み。層 = 素材の番号
precision highp sampler2DArray;
uniform sampler2DArray u_materials;
uniform vec2 u_materialPeriod[5];   // テクスチャ 1 枚が覆う壁の大きさ (m)
uniform vec2 u_materialAverage[5];  // 1×1 のミップの値（ラフネス, 凹み）
uniform float u_materialMetal[5];   // 金属らしさ（1 = 拡散反射なし、映り込みに素材の色）
uniform vec4 u_materialTint[5];     // 外壁の色を寄せる色と割合（コンクリート打ち放しは灰色）
uniform float u_materialLevels;     // log2(テクスチャの 1 辺)

in vec3 v_world;
in vec2 v_uv;
flat in vec4 v_seg;
flat in vec4 v_bldg;
flat in float v_height;
flat in vec4 v_facade;
out vec4 fragColor;

const vec3 WARM = vec3(1.0, 0.52, 0.20);
const vec3 NEUTRAL = vec3(1.0, 0.76, 0.48);
const vec3 COOL = vec3(0.72, 0.86, 1.0);

// ---------------------------------------------------------------- interior mapping
// 部屋 = 幅 W × 高さ H × 奥行き D の箱。p は窓面上の点（部屋座標）、d は部屋座標での視線。
// x: 壁に沿って右, y: 上, z: 建物の奥へ
vec3 roomInterior(vec3 p, vec3 d, float W, float H, float D, float seed, int palette,
                  float lit, vec3 lightCol, float daylight) {
  d = sign(d) * max(abs(d), vec3(1e-4));
  vec3 tA = (vec3(0.0) - p) / d;
  vec3 tB = (vec3(W, H, D) - p) / d;
  vec3 tFar = max(tA, tB);
  float t = min(min(tFar.x, tFar.y), tFar.z);
  vec3 hit = p + d * t;

  // 部屋ごとの色
  float s1 = hash12(vec2(seed, 1.7));
  float s2 = hash12(vec2(seed, 9.1));
  vec3 wallA, floorC, ceilC = vec3(0.86, 0.86, 0.84);
  if (palette == 1) {        // 住宅
    vec3 tones[4] = vec3[4](vec3(0.88, 0.82, 0.70), vec3(0.80, 0.84, 0.76), vec3(0.78, 0.80, 0.86), vec3(0.90, 0.86, 0.80));
    wallA = tones[int(s1 * 3.99)];
    floorC = mix(vec3(0.42, 0.27, 0.15), vec3(0.62, 0.48, 0.32), s2);
  } else if (palette == 2) { // 店舗
    wallA = vec3(0.92, 0.92, 0.9);
    floorC = vec3(0.7, 0.7, 0.68);
  } else if (palette == 3) { // 倉庫
    wallA = vec3(0.55, 0.55, 0.53);
    floorC = vec3(0.4, 0.4, 0.4);
    ceilC = vec3(0.45);
  } else {                   // オフィス
    wallA = mix(vec3(0.78, 0.78, 0.76), vec3(0.70, 0.72, 0.74), s1);
    floorC = mix(vec3(0.28, 0.30, 0.34), vec3(0.36, 0.33, 0.30), s2);
  }

  vec3 albedo;
  float emissive = 0.0;
  if (t == tFar.z) {
    albedo = wallA;
    if (palette == 2) { // 店舗: 奥の壁に陳列棚
      float shelf = step(0.15, fract(hit.y / H * 4.0)) * step(0.1, hit.y / H) * step(hit.y / H, 0.8);
      vec3 goods = 0.4 + 0.6 * vec3(hash12(floor(hit.xy * vec2(3.0, 4.0 / H)) + seed));
      albedo = mix(albedo, goods, shelf * 0.8);
    }
  } else if (t == tFar.x) {
    albedo = wallA * 0.92;
  } else if (d.y < 0.0) {
    albedo = floorC;
    if (palette == 1) albedo *= 0.85 + 0.15 * step(0.5, fract(hit.x * 2.5)); // フローリング
  } else {
    albedo = ceilC;
    // 天井照明: オフィスは格子状のパネル、住宅は中央の照明、店舗はダウンライト
    if (palette == 0 || palette == 3) {
      vec2 q = fract(hit.xz / 1.8) - 0.5;
      emissive = step(abs(q.x), 0.28) * step(abs(q.y), 0.09);
    } else if (palette == 1) {
      emissive = 1.0 - smoothstep(0.18, 0.24, length(hit.xz - vec2(W * 0.5, D * 0.45)));
    } else {
      emissive = 1.0 - smoothstep(0.08, 0.12, length(fract(hit.xz / 1.2) - 0.5));
    }
  }

  // 家具（奥行きの途中にある板ポリ）
  float zf = D * mix(0.45, 0.7, s2);
  float tf = (zf - p.z) / d.z;
  if (tf > 0.0 && tf < t) {
    vec3 q = p + d * tf;
    float fx = q.x / W, fy = q.y / H;
    float mask = 0.0;
    float furnEmissive = 0.0;
    vec3 fc = vec3(0.25);
    if (palette == 0) {
      mask = step(fy, 0.3) * step(0.08, fract(q.x / 2.4));               // 机とパーティション
      mask = max(mask, step(0.3, fy) * step(fy, 0.42) * step(0.55, fract(q.x / 1.2)) * step(fract(q.x / 1.2), 0.85)); // モニター
      fc = fy > 0.3 ? vec3(0.08, 0.09, 0.1) : vec3(0.42, 0.42, 0.44);
      furnEmissive = fy > 0.3 ? 0.18 : 0.0;
    } else if (palette == 1) {
      float sofaX = mix(0.08, 0.4, s1);
      mask = step(fy, 0.22) * step(sofaX, fx) * step(fx, sofaX + 0.42);    // ソファ
      mask = max(mask, step(fy, 0.62) * step(0.78, fx) * step(fx, 0.96) * step(0.4, s2)); // 棚
      fc = mix(vec3(0.35, 0.28, 0.22), vec3(0.3, 0.35, 0.42), s1);
    } else if (palette == 2) {
      mask = step(fy, 0.45) * step(0.25, fract(q.x / 1.6));
      fc = 0.35 + 0.5 * vec3(hash12(vec2(floor(q.x / 1.6), seed)), hash12(vec2(seed, floor(q.x / 1.6))), 0.5);
    } else {
      mask = step(fy, 0.7) * step(0.4, fract(q.x / 3.0));
      fc = vec3(0.45, 0.38, 0.25);
    }
    if (mask > 0.5) {
      albedo = fc;
      hit = q;
      emissive = furnEmissive;
    }
  }

  // 室内の照明
  // 照明: 広い部屋（複数の窓に面する）は天井に 3.6m おきに並べ、いちばん近いものを使う
  float lampX = W < 5.4 ? W * 0.5 : clamp((floor(hit.x / 3.6) + 0.5) * 3.6, 1.8, W - 1.8);
  vec3 lampPos = vec3(lampX, H - 0.05, D * 0.45);
  vec3 toLamp = lampPos - hit;
  float falloff = 1.0 / (1.0 + dot(toLamp, toLamp) * 0.12);
  vec3 lamp = lightCol * lit * (0.7 + 3.2 * falloff);
  vec3 day = vec3(daylight) * mix(1.0, 0.25, clamp(hit.z / D, 0.0, 1.0));
  vec3 ambientNight = vec3(0.004, 0.005, 0.008);
  return toLinear(albedo) * (lamp + day + ambientNight) + lightCol * emissive * lit * 4.0;
}

// ---------------------------------------------------------------- reflection
// ガラスに映る外の景色。昼の空は室内よりずっと明るいので、反射が強いと中が見えなくなる。
// 前面に建物がある壁（解析済みのあき・高さ）では、その建物の壁と窓が映る。
float glassF0(float reflectivity) { return mix(0.04, 0.5, reflectivity); } // 透明ガラス 4% 〜 ミラーガラス 50%

vec3 skyRadiance(vec3 R) {
  // 屋外の明るさは室内の数倍。トーンマップ前の値として空を持ち上げる
  return skyColor(R) * (1.0 + 2.4 * (1.0 - u_night));
}

// 昼は屋外に露出を合わせるので、照明が点いていても室内は相対的に暗く見える
float interiorExposure() { return mix(1.0, 0.3, 1.0 - u_night); }

vec3 reflectedEnvironment(vec3 R, vec3 N, vec3 T, float along, float y, float clearance, float coverH, vec3 ambient, float seed) {
  float rn = dot(R, N);
  if (coverH > 0.0 && clearance < 39.0 && rn > 0.02) {
    float t = clearance / rn;               // 向かいの壁の面までの距離
    float hy = y + R.z * t;                 // 映る点の高さ
    if (hy > 0.0 && hy < coverH) {
      float hx = along + dot(R, T) * t;     // 向かいの壁に沿った位置
      vec2 cell = vec2(hx / 3.4, hy / 3.5);
      vec2 f = fract(cell);
      // 窓の縁はわずかにぼかす（浅い角度で細かい縞にならないように）
      float win = (1.0 - smoothstep(0.27, 0.33, abs(f.x - 0.5))) * smoothstep(0.27, 0.33, f.y) * (1.0 - smoothstep(0.77, 0.83, f.y));
      // 点灯は 3 枚ずつの部屋単位でそろえる
      float h = hash12(vec2(floor(cell.x / 3.0), floor(cell.y)) + seed * 13.0);
      vec3 light = ambient + toLinear(u_sunColor) * max(dot(-N, u_sunDir), 0.0) * smoothstep(-0.02, 0.08, u_sunDir.z) * 1.1;
      vec3 facade = toLinear(vec3(0.56, 0.56, 0.57)) * light;
      vec3 glass = skyColor(reflect(R, -N)) * 0.35 + vec3(0.01);
      // 明るさは直接見える点灯した窓（遠景の平均）と同程度にする
      vec3 lit = mix(COOL, NEUTRAL, h * 2.5) * 0.45 * step(h, 0.35) * u_night;
      vec3 c = mix(facade, glass + lit, win);
      // 遠い壁は空気遠近でかすませる
      return mix(c, skyRadiance(R) * 0.6, clamp(t / 250.0, 0.0, 0.6));
    }
  }
  vec3 env = skyRadiance(R);
  // 太陽の映り込み（向かいの建物に遮られていないときだけ）
  env += toLinear(u_sunColor) * pow(max(dot(R, u_sunDir), 0.0), 400.0) * 10.0 * (1.0 - u_night) * step(0.0, u_sunDir.z);
  return env;
}

void main() {
  int sid = int(v_bldg.x + 0.5);
  float bSeed = v_bldg.y;
  float fh = v_bldg.z;
  int cat = int(v_bldg.w + 0.5);

  vec4 t0 = styleTexel(sid, 0);  // spacing, windowWidth, windowHeight, sill
  vec4 t1 = styleTexel(sid, 1);  // wall rgb, variation
  vec4 t2 = styleTexel(sid, 2);  // frame rgb, mullions
  vec4 t3 = styleTexel(sid, 3);  // glass rgb, reflectivity
  vec4 t4 = styleTexel(sid, 4);  // roomDepth, floorCoherence, warmRatio, curtainRatio
  vec4 t5 = styleTexel(sid, 5);  // groundFloor, slabLine, balcony, litScale
  vec4 t6 = styleTexel(sid, 6);  // roof rgb, interior palette
  vec4 t7 = styleTexel(sid, 7);  // curtainWall, blindsRatio, sideWindows, sunSideBalconies
  vec4 t8 = styleTexel(sid, 8);  // partyWallMax, sideWallMax, openAboveRatio

  vec3 T = vec3(v_seg.xy, 0.0);
  vec3 N = vec3(v_seg.y, -v_seg.x, 0.0);
  float runLen = abs(v_seg.z);
  bool closedRun = v_seg.z < 0.0;
  float runSeed = v_seg.w;
  float clearance = v_facade.x;
  bool sunSide = v_facade.y > 0.5;
  // 壁面の分類: 0 = 界壁（隣と接する）, 1 = 側壁（狭い隙間に面する）, 2 = 正面（開けている）
  int exposure = clearance < t8.x ? 0 : clearance < t8.y ? 1 : 2;
  // ふさいでいる隣の建物より上は開けている。隣が openAboveRatio より低ければ正面、そうでなければ 1 段階だけ開放する
  float coverHeight = v_facade.z;
  if (exposure < 2 && v_uv.y > coverHeight + 0.3) exposure = coverHeight < v_height * t8.z ? 2 : exposure + 1;
  int sidePolicy = int(t7.z + 0.5);
  bool curtainWall = t7.x > 0.5;
  vec3 V = normalize(v_world - u_eye);
  // 外壁の裏側（建物の内側から見た面）は描かない。屋上を下げるとパラペットの内側と重なるため
  if (dot(V, N) > 0.0) discard;

  // ---------------------------------------------------------------- 外壁
  vec3 wallAlbedo = buildingWallColor(sid, bSeed);
  if (exposure == 0) wallAlbedo *= 0.88; // 界壁は仕上げのない面

  // 外壁の素材: 割合（テクセル 20 の yzw、21 の zw）に応じて建物ごとに選ぶ。界壁は仕上げのない面なので素材なし
  int material = -1;
  if (exposure > 0) {
    vec4 m20 = styleTexel(sid, 20), m21 = styleTexel(sid, 21);
    float ratios[5] = float[5](m20.y, m20.z, m20.w, m21.z, m21.w);
    float matPick = hash12(vec2(bSeed * 83.0, 7.7)), acc = 0.0;
    for (int i = 0; i < 5; i++) {
      acc += ratios[i];
      if (material < 0 && matPick < acc) material = i;
    }
  }
  // 素材の色: コンクリート打ち放しなどは、スタイルの外壁色より素材の色に寄せる（明るさは建物ごとに少し変える）
  if (material >= 0) {
    vec4 tint = u_materialTint[material];
    wallAlbedo = mix(wallAlbedo, tint.rgb * (0.88 + 0.24 * hash12(vec2(bSeed * 29.0, 5.1))), tint.a);
  }
  float sunLambert = max(dot(N, u_sunDir), 0.0) * smoothstep(-0.02, 0.08, u_sunDir.z);
  vec3 ambient = mix(toLinear(u_skyHorizon), toLinear(u_skyZenith), 0.5) * 0.9 + vec3(0.012, 0.011, 0.01);
  // 夜の街灯による足元の照り返し（隙間や界壁には届かない）
  vec3 streetWash = vec3(1.0, 0.7, 0.45) * 0.05 * exp(-v_uv.y / 5.0) * u_night * (exposure == 2 ? 1.0 : 0.2);
  vec3 wallLight = ambient + toLinear(u_sunColor) * sunLambert * 1.1 + streetWash;

  if (u_effects < 0.5 && u_debug == 0) {
    fragColor = vec4(plainShade(N), 1.0);
    return;
  }

  if (u_debug == 1 || u_debug == 2) {
    int idx = u_debug == 1 ? cat : sid;
    vec3 c = toLinear(u_debugColors[idx]) * (0.45 + 0.55 * max(dot(N, normalize(vec3(0.4, -0.6, 0.7))), 0.0));
    fragColor = vec4(toDisplay(c * 1.4), 1.0);
    return;
  }

  // ---------------------------------------------------------------- 階の構成
  // 店舗・ロビーのある建物は 1 階を高くし、残りを上階で均等に割る
  float topLimit = v_height - parapet(v_height);
  float floors = max(1.0, floor(topLimit / fh + 0.01));
  int ground = int(t5.x + 0.5);
  // 上階の階高が 2.6m を下回らない範囲で
  float gfh = (ground != 0 && floors >= 2.0) ? clamp(min(fh * 1.35, fh + 1.6), fh, max(fh, floors * fh - (floors - 1.0) * 2.6)) : fh;
  float upperH = floors >= 2.0 ? (floors * fh - gfh) / (floors - 1.0) : fh;
  float floorIdx, lv, cellH;
  if (v_uv.y < gfh) {
    floorIdx = 0.0;
    cellH = gfh;
    lv = v_uv.y / gfh;
  } else {
    float k = floor((v_uv.y - gfh) / upperH);
    floorIdx = 1.0 + k;
    cellH = upperH;
    lv = (v_uv.y - gfh) / upperH - k;
  }
  bool isGround = floorIdx < 0.5;
  bool storefront = isGround && ground == 1 && exposure == 2;
  bool lobby = isGround && ground == 2 && exposure == 2;

  // ---------------------------------------------------------------- 壁面ごとの窓の種類
  float spacing = t0.x, ww = t0.y, wh = t0.z, sill = t0.w;
  float winWidth = t0.y * t0.x;   // 窓幅 (m)
  float balcony = t5.z;
  bool allowed = t0.y > 0.0 && (exposure == 2 || (exposure == 1 && sidePolicy > 0));
  // 側壁、または日当たり面以外（共同住宅の北側など）は小窓にする。窓の上端はそろえる
  bool smallWin = (exposure == 1 && sidePolicy == 1) || (t7.w > 0.5 && exposure == 2 && !sunSide);
  if (smallWin && !curtainWall) {
    float head = sill + wh;
    spacing *= 1.8;
    winWidth *= 0.5;
    wh *= 0.55;
    sill = head - wh;
  }
  if (exposure != 2 || smallWin) balcony = 0.0;
  if (storefront) { ww = 0.9; wh = 0.74; sill = 0.04; }
  else if (lobby) { ww = max(ww, 0.86); wh = max(wh, 0.7); sill = 0.04; }

  // ---------------------------------------------------------------- 連続面に沿った窓の列
  // 角（連続面の端）にだけ余白を取る。角のない閉じた面は継ぎ目なく一周させる
  float margin = closedRun ? 0.0 : (curtainWall ? 0.2 : 0.45);
  float usable = runLen - 2.0 * margin;
  float nCols = floor(usable / spacing + 0.15);
  if (nCols < 1.0 && usable >= 1.2) nCols = 1.0;  // 短い壁にも 1 つは置く
  bool hasCols = allowed && nCols >= 1.0;
  float colW = hasCols ? usable / nCols : spacing;
  float u = v_uv.x - margin;
  float col = floor(u / colW);
  float lu = u / colW - col;
  bool hasWindow = hasCols && u >= 0.0 && u < usable && v_uv.y < floors * fh;

  // 窓幅は寸法で固定し、余りは窓間の壁で吸収する（カーテンウォール・店舗・ロビーはセル幅に追従）
  float winW = (curtainWall || storefront || lobby) ? ww * colW : min(winWidth, colW * 0.92);

  // セル内の位置（m）と窓の矩形までの符号付き距離
  float cx = lu * colW, cy = lv * cellH;
  float halfW = winW * 0.5;
  float y0 = sill * cellH, y1 = (sill + wh) * cellH;
  float dx = abs(cx - colW * 0.5) - halfW;
  float dy = max(y0 - cy, cy - y1);
  float dist = max(dx, dy);

  // 画面上でセルが何ピクセルか。小さいときは平均色に落としてモアレを防ぐ
  // 浅い角度では横（壁に沿った方向）だけが縮むので、横と縦を別に見る
  float fwx = length(vec2(dFdx(v_uv.x), dFdy(v_uv.x)));
  float fwy = length(vec2(dFdx(v_uv.y), dFdy(v_uv.y)));
  float fw = max(fwx, fwy);
  float cellPx = min(colW, cellH) / max(fw, 1e-4);
  float detail = smoothstep(2.5, 7.0, cellPx);
  float detailY = smoothstep(2.5, 7.0, cellH / max(fwy, 1e-4));  // 縦方向（階と窓の高さ）が見分けられるか

  if (u_debug == 3) {
    // 壁面の分類（界壁 / 側壁 / 正面 / 日当たり面）と、配置された窓・連続面の端
    int idx = exposure == 0 ? 0 : exposure == 1 ? 1 : sunSide ? 3 : 2;
    vec3 c = toLinear(u_debugColors[idx]) * (0.45 + 0.55 * max(dot(N, normalize(vec3(0.4, -0.6, 0.7))), 0.0));
    if (hasWindow && dist < 0.0) c = mix(c, vec3(0.9), 0.6 * detail);
    if (!closedRun && (v_uv.x < 0.12 || v_uv.x > runLen - 0.12)) c *= 0.25;
    fragColor = vec4(toDisplay(c * 1.4), 1.0);
    return;
  }

  // ---------------------------------------------------------------- 部屋（複数の窓が 1 つの部屋に面する）
  // フロアごとに部屋の幅（窓の数）を決め、連続する窓をまとめる。ワンフロアの階と 1 階の店舗・ロビーは連続面全体で 1 部屋
  vec4 t21 = styleTexel(sid, 21);  // windowsPerRoom, openPlanRatio
  float colsTotal = hasCols ? nCols : 1.0;
  float roomFloorSeed = hash12(vec2(bSeed * 457.0 + runSeed, floorIdx + 0.5));
  bool openPlan = storefront || lobby || hash12(vec2(roomFloorSeed, 7.0)) < t21.y;
  float span = openPlan ? colsTotal : clamp(floor(t21.x * mix(0.6, 1.5, roomFloorSeed) + 0.5), 1.0, colsTotal);
  float roomOffset = floor(hash12(vec2(roomFloorSeed, 13.0)) * span);  // 部屋の区切りの位置をフロアごとにずらす
  float roomFirst = floor((col + roomOffset) / span) * span - roomOffset;
  float roomStart = max(roomFirst, 0.0);
  float roomEnd = min(roomFirst + span - 1.0, colsTotal - 1.0);

  // ---------------------------------------------------------------- 点灯
  // 点灯と照明の色は部屋ごと（ワンフロアはフロア全体）。窓 1 枚ずつの違い（カーテンなど）は winSeed で決める
  float winSeed = hash13(vec3(bSeed * 173.0 + runSeed * 7.0, col + 0.5, floorIdx + 0.5));
  float floorSeed = hash12(vec2(bSeed * 311.0, floorIdx + 0.5));
  float roomLitSeed = openPlan ? floorSeed : hash13(vec3(bSeed * 173.0 + runSeed * 7.0, roomStart + 0.5, floorIdx + 0.5));
  float pickSeed = hash13(vec3(runSeed * 59.0, roomStart + 0.5, floorIdx * 1.7 + bSeed));
  float ratio = clamp(u_litRatio[cat] * t5.w, 0.0, 1.0);
  float litSeed = pickSeed < t4.y ? floorSeed : roomLitSeed;
  float lit = step(litSeed, ratio);
  if (storefront) lit = step(hash12(vec2(bSeed * 41.0, floorIdx)), u_shopOpen * 0.95);
  float lightSel = hash13(vec3(roomLitSeed * 13.0, bSeed, 2.0));
  vec3 lightCol = hash12(vec2(roomLitSeed, 5.0)) < t4.z ? mix(WARM, NEUTRAL, lightSel * 0.6) : mix(COOL, NEUTRAL, lightSel * 0.5);
  lightCol *= mix(0.7, 1.25, hash12(vec2(roomLitSeed, 11.0)));
  if (storefront) lightCol = mix(NEUTRAL, COOL, 0.4) * 1.3;

  float daylight = (1.0 - u_night) * 0.55 + 0.01;

  // ---------------------------------------------------------------- 窓の中身
  vec3 color;
  // ---------------------------------------------------------------- 経年変化（くすみ）
  // 汚れの量 = レイヤー全体の強さ × 素材の汚れやすさ × 古さ（建築年が不明なら建物ごとにばらつかせる）
  float age = v_facade.w >= 0.0 ? v_facade.w : mix(0.2, 1.0, hash12(vec2(bSeed * 19.0, 6.3)));
  float dirt = u_weathering.x * styleTexel(sid, 20).x * age;
  float grime = 0.0;  // 汚れの量（素材のつやを落とす）
  if (dirt > 0.0) {
    vec2 wseed = vec2(bSeed * 211.0, runSeed * 97.0);
    // 雨だれ: 窓台の両端と窓台から下へ。細かい筋は遠景で消す
    float streak = 0.0;
    if (hasWindow && cy < y0) {
      float below = y0 - cy;
      float len = mix(0.5, 2.0, hash12(vec2(winSeed, 41.0)));
      float fade = 1.0 - smoothstep(0.0, len, below);
      float edge = min(abs(cx - (colW * 0.5 - halfW)), abs(cx - (colW * 0.5 + halfW)));
      float corner = exp(-edge * edge * 30.0);
      float sill = step(abs(cx - colW * 0.5), halfW) * 0.35;
      streak = max(corner, sill) * fade * (0.55 + 0.45 * vnoise(vec2(cx * 9.0, cy * 1.2) + wseed));
    }
    // 屋上の縁から外壁を伝う縦筋（壁に沿った位置ごとに長さが違う）
    float column = vnoise(vec2(v_uv.x * 1.3, 0.5) + wseed);
    float fromTop = v_height - v_uv.y;
    float topStreak = smoothstep(0.45, 0.85, column) * (1.0 - smoothstep(0.0, mix(1.5, 9.0, column), fromTop));
    topStreak *= 0.6 + 0.4 * vnoise(vec2(v_uv.x * 7.0, v_uv.y * 0.6) + wseed);
    streak = max(streak, topStreak) * mix(0.4, 1.0, detail);

    // くすみ: 地面近くの泥はねと、壁全体のゆるやかな濃淡
    float ground = 1.0 - smoothstep(0.0, mix(0.8, 2.0, hash12(wseed)), v_uv.y);
    float blotch = smoothstep(0.3, 0.85, vnoise(v_uv * vec2(0.07, 0.11) + wseed));
    // しみ: 水が回った跡。縁はぼかし、縦に伸ばし、濃さにもむらを付ける
    float stainShape = vnoise(v_uv * vec2(0.35, 0.12) + wseed.yx) * 0.75 + vnoise(v_uv * vec2(1.4, 0.5) + wseed) * 0.25;
    float stain = smoothstep(0.55, 0.8, stainShape) * (0.5 + 0.5 * vnoise(v_uv * 2.0 + wseed.yx)) * mix(0.5, 1.0, detail);

    float d = dirt * (u_weathering.y * streak * 0.4 + u_weathering.z * (ground * 0.3 + blotch * 0.14) + u_weathering.w * stain * 0.12);
    d = clamp(d, 0.0, 0.65);
    grime = d;
    // 暗くし、少し黄土色寄りのグレーにする
    wallAlbedo = mix(wallAlbedo, wallAlbedo * vec3(0.86, 0.84, 0.78), clamp(d * 1.6, 0.0, 1.0)) * (1.0 - d);
  }

  // ---------------------------------------------------------------- 外壁の素材（凹凸とつや）
  int mi = max(material, 0);
  vec2 muv = v_uv / u_materialPeriod[mi];
  // 微分は分岐の前で求める（分岐の中では未定義）
  vec2 mgx = dFdx(muv), mgy = dFdy(muv);
  vec3 wallColor = toLinear(wallAlbedo) * wallLight;
  // ガラスに完全に隠れる所（窓の内側。手すりの縁と遠景の平均色では壁の色を使うので除く）は素材を描かない
  bool hidden = hasWindow && dist < -fw && detail >= 1.0 && (balcony <= 0.0 || cy >= 0.2);
  if (material >= 0 && u_surface.x > 0.0 && !hidden) {
    float k = u_surface.x;
    // ミップの段（1 ピクセルに入るテクセル数の log2）。目地が 1 ピクセルより細くなる距離からは、
    // テクスチャもつやも計算せず、凹みの平均だけを掛ける（見た目はほぼ同じで、ほとんど負荷がない）
    float lod = log2(max(max(length(mgx), length(mgy)) * exp2(u_materialLevels), 1e-6));
    float near = 1.0 - smoothstep(1.5, 2.5, lod);
    // 金属は拡散反射がなく、映り込みに素材の色が付く（F0 = 素材の色）。ほかは F0 = 0.04
    float metal = u_materialMetal[mi];
    vec3 albedoLin = toLinear(wallAlbedo);
    vec3 F0m = mix(vec3(0.04), albedoLin, metal);
    float glossK = (1.0 - clamp(grime * 1.5, 0.0, 1.0)) * min(k, 1.0);
    // 金属は拡散反射がないが、周りの建物や空のぼやけた映り込みの分として、素材の色による明るさを 3 割残す
    float diffuseKeep = 1.0 - metal * 0.7;
    vec3 far = wallColor * mix(1.0, u_materialAverage[mi].y, min(k, 1.0)) * diffuseKeep;
    if (metal > 0.0) {
      // 遠景の金属も空の映り込みを残す（近景との明るさの差を抑える）
      float roughAvg = u_materialAverage[mi].x;
      vec3 Ff = F0m + (1.0 - F0m) * pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 5.0);
      far += skyRadiance(reflect(V, N)) * Ff * (1.0 - roughAvg) * glossK * metal;
    }
    if (near > 0.0) {
      vec4 m = textureGrad(u_materials, vec3(muv, float(material)), mgx, mgy);
      vec2 n0 = m.xy * 2.0 - 1.0;
      vec3 Nm = normalize(T * n0.x * k + vec3(0.0, 0.0, 1.0) * n0.y * k + N * sqrt(max(1.0 - dot(n0, n0), 0.0)));
      float rough = m.z;
      float cavity = mix(1.0, m.w, min(k, 1.0));
      // 日の当たらない壁は、凹凸の向きによらず日が当たらない
      float sunVis = smoothstep(-0.02, 0.08, u_sunDir.z) * clamp(dot(N, u_sunDir) * 8.0, 0.0, 1.0);
      float NdotL = max(dot(Nm, u_sunDir), 0.0) * sunVis;
      vec3 amb = mix(toLinear(u_skyHorizon), toLinear(u_skyZenith), 0.5 + 0.3 * Nm.z) * 0.9 + vec3(0.012, 0.011, 0.01);
      vec3 diffuse = albedoLin * (amb + toLinear(u_sunColor) * NdotL * 1.1 + streetWash) * cavity * diffuseKeep;
      // つや（GGX）: 釉薬・磨いた石・金属の面に太陽と空が映る。汚れたところはつやが落ちる
      vec3 Vv = -V;
      vec3 H = normalize(u_sunDir + Vv);
      float a2 = pow(rough, 4.0);
      float dd = max(dot(Nm, H), 0.0);
      dd = dd * dd * (a2 - 1.0) + 1.0;
      float D = a2 / (3.14159 * dd * dd);
      float LdotH = max(dot(u_sunDir, H), 0.05);
      vec3 F = F0m + (1.0 - F0m) * pow(1.0 - max(dot(Vv, H), 0.0), 5.0);
      vec3 spec = min(D / (4.0 * LdotH * LdotH), 30.0) * F * NdotL;
      vec3 Fv = F0m + (1.0 - F0m) * pow(1.0 - max(dot(Nm, Vv), 0.0), 5.0);
      // 金属は粗さの影響を弱め（ぼやけた映り込みとして残す）、ほかは粗いほど映り込みを消す
      vec3 envSpec = skyRadiance(reflect(V, Nm)) * Fv * mix((1.0 - rough) * (1.0 - rough), 1.0 - rough, metal);
      float gloss = glossK * cavity;
      vec3 detailed = diffuse + (toLinear(u_sunColor) * spec * 1.1 + envSpec) * gloss;
      wallColor = mix(far, detailed, near);
    } else {
      wallColor = far;
    }
  }
  float slab = (t5.y > 0.0 && cy < 0.22) ? t5.y : 0.0;
  wallColor *= 1.0 - 0.3 * slab;

  // フレネル反射率（見る角度が浅いほど強い）。レイヤー全体の強さ u_reflection を掛ける
  vec3 R = reflect(V, N);
  float cosT = clamp(dot(-V, N), 0.0, 1.0);
  float F0 = glassF0(t3.a);
  float reflAmt = clamp((F0 + (1.0 - F0) * pow(1.0 - cosT, 5.0)) * u_reflection, 0.0, 1.0);
  // ガラスの色は反射の強いガラスほど映り込みに強く出る
  vec3 glassTintLin = toLinear(buildingGlassTint(sid, bSeed));
  vec3 glassReflectTint = mix(vec3(1.0), glassTintLin / max(max(glassTintLin.r, glassTintLin.g), glassTintLin.b), 0.25 + 0.5 * t3.a);

  float aa = fw * 0.75;
  float windowMask = hasWindow ? 1.0 - smoothstep(-aa, aa, dist) : 0.0;

  if (windowMask > 0.0) {
    // 窓内の正規化座標
    float wx = (cx - (colW * 0.5 - halfW)) / (2.0 * halfW);
    float wy = (cy - y0) / (y1 - y0);
    float roomSeed = roomLitSeed * 57.0 + bSeed;  // 部屋（室内の色・奥行き・家具）
    float paneSeed = winSeed * 57.0 + bSeed;      // 窓 1 枚（カーテン・ブラインド）

    vec3 inside;
    if (u_interior > 0.5) {
      vec3 dRoom = vec3(dot(V, T), V.z, dot(V, -N));
      float depth = t4.x * mix(0.75, 1.25, hash12(vec2(roomSeed, 3.0)));
      int palette = storefront ? 2 : int(t6.a + 0.5);
      // 部屋は roomStart〜roomEnd の窓に面した 1 つの箱。仕切り壁は部屋の端にだけ見える
      float roomW = (roomEnd - roomStart + 1.0) * colW;
      float px = (col - roomStart) * colW + cx;
      inside = roomInterior(vec3(px, cy, 0.0), dRoom, roomW, cellH, depth, roomSeed, palette, lit, lightCol, daylight);
    } else {
      inside = lightCol * lit * 2.0 + vec3(daylight * 0.3);
    }

    // カーテン（住宅）とブラインド（オフィス）。光が当たると透けて光る
    float curtainPick = hash12(vec2(paneSeed, 21.0));
    float blindPick = hash12(vec2(paneSeed, 23.0));
    if (!storefront && curtainPick < t4.w) {
      float open = mix(0.15, 0.45, hash12(vec2(paneSeed, 25.0)));
      float folds = 0.85 + 0.15 * sin(wx * 60.0);
      float covered = max(step(wx, open * 0.5), step(1.0 - open * 0.5, wx));
      if (hash12(vec2(paneSeed, 27.0)) < 0.3) covered = 1.0; // 閉め切り
      vec3 cloth = toLinear(mix(vec3(0.85, 0.8, 0.7), vec3(0.75, 0.72, 0.8), hash12(vec2(roomSeed, 29.0))));
      vec3 curtain = cloth * folds * (lightCol * lit * 2.2 + vec3(daylight * 0.8) + 0.004);
      inside = mix(inside, curtain, covered * 0.92);
    } else if (!storefront && blindPick < t7.y) {
      // 下げ具合は同じ部屋でだいたいそろう
      float lowered = mix(0.2, 1.0, mix(hash12(vec2(roomSeed, 31.0)), hash12(vec2(paneSeed, 31.0)), 0.3));
      float slat = step(1.0 - lowered, wy) * step(0.3, fract(wy * (y1 - y0) * 9.0));
      vec3 blind = toLinear(vec3(0.82, 0.83, 0.82)) * (lightCol * lit * 1.8 + vec3(daylight * 0.9) + 0.004);
      inside = mix(inside, blind, slat * 0.95);
    }

    // ガラスの歪み: 1 枚ごとの取り付けの傾き（±1.4° 程度）と、複層ガラスのふくらみ・へこみ。
    // 映り込み（向かいの建物・太陽）がガラスごとに少しずつずれて、1 枚の鏡ではなく板の集まりに見える
    vec3 Rg = R;
    if (u_surface.y > 0.0) {
      float panes = max(t2.a, 1.0);
      float fp = clamp(wx, 0.0, 0.9999) * panes;
      float pane = floor(fp);
      float ps = hash13(vec3(winSeed * 31.0 + pane, bSeed, 4.0));
      vec2 tilt = (vec2(ps, hash12(vec2(ps, 9.0))) - 0.5) * 0.05;
      float bow = (hash12(vec2(ps, 3.3)) - 0.5) * 0.1;
      tilt += vec2(fp - pane - 0.5, clamp(wy, 0.0, 1.0) - 0.5) * bow;
      vec3 Ng = normalize(N + (T * tilt.x + vec3(0.0, 0.0, 1.0) * tilt.y) * u_surface.y);
      Rg = reflect(V, Ng);
    }

    // ガラス: 透過した室内 + 反射した外の景色。どちらが勝つかは内外の明るさの差で決まる
    vec3 env = reflectedEnvironment(Rg, N, T, v_uv.x, v_uv.y, clearance, coverHeight, ambient, bSeed);
    vec3 transmitted = inside * mix(vec3(1.0), toLinear(buildingGlassTint(sid, bSeed)) * 2.0, 0.35) * interiorExposure();
    // コーティングされたガラスは映り込みにも色が付く（青・緑・ブロンズなど）
    vec3 glass = transmitted * (1.0 - reflAmt) + env * reflAmt * glassReflectTint;

    // 窓枠と方立て
    float frameW = t7.x > 0.5 ? 0.04 : 0.06;
    float mull = t2.a;
    float fx = wx * mull;
    float onMullion = mull > 1.0 ? step(abs(fract(fx + 0.5) - 0.5) * (2.0 * halfW) / mull, frameW * 0.5) * step(0.5, fx) * step(fx, mull - 0.5) : 0.0;
    float onFrame = max(step(-frameW, dist), onMullion);
    vec3 frame = toLinear(t2.rgb) * wallLight;
    vec3 win = mix(glass, frame, onFrame);

    color = mix(wallColor, win, windowMask);
  } else {
    color = wallColor;
  }

  // バルコニーの手すり（住宅、2 階以上）
  if (balcony > 0.0 && !isGround && hasWindow && cy < 1.1) {
    vec3 panel = toLinear(vec3(0.7, 0.73, 0.75)) * wallLight;
    float edge = step(cy, 0.18);
    color = mix(color, mix(panel, wallColor, edge), 0.8 * balcony);
  }

  // 窓まわりのにじみ（擬似ブルーム）。カメラのにじみに近づけるため、幅は画面上で 2〜3 ピクセル（実寸 5〜35cm）にし、
  // 窓の角は丸く広げる。セル（窓 1 枚分の区画）の端では 0 にして、隣のセルとの境目で光が途切れて見えないようにする
  if (hasWindow && lit > 0.0 && dist > 0.0) {
    float d = length(max(vec2(dx, dy), 0.0));
    float radius = clamp(fw * 3.0, 0.06, 0.4);
    float edge = min(min(cx, colW - cx), min(cy, cellH - cy));
    // 縁での明るさは窓の中より弱く（白い枠に見えないように）、そこから滑らかに減らす
    float glow = exp(-d / radius) * smoothstep(0.0, radius * 1.5, edge) * 0.12 * u_night;
    color += lightCol * lit * glow;
  }

  // 遠景は平均色に置き換える（窓率 × 点灯率）
  if (detail < 1.0) {
    // 窓が占める割合。縦方向が見分けられる間は、窓の高さの帯だけを平均色にする（窓の上下の壁は残す）
    bool onFloors = hasCols && v_uv.y < floors * fh;
    float rowAa = fwy * 0.75;
    float inWindowRow = 1.0 - smoothstep(-rowAa, rowAa, max(y0 - cy, cy - y1));
    float coverage = onFloors ? (winW / colW) * mix(wh, inWindowRow, detailY) : 0.0;
    // 点灯は近景と同じもの（部屋ごと）を使い、近づいたときに点灯の模様が変わらないようにする。
    // 区画が 1 ピクセルより小さいと模様がちらつくので、そこではフロアごとの期待値（フロア単位で点灯する用途は階ごとの縞）にする
    float floorLit = mix(ratio, step(floorSeed, ratio), t4.y);
    float sharp = smoothstep(0.8, 2.0, colW / max(fwx, 1e-4));
    float cellLit = mix(floorLit, lit, sharp);
    vec3 cellLight = mix(mix(NEUTRAL, mix(COOL, WARM, t4.z), 0.6), lightCol, sharp);
    // 明るさは近景の室内（壁・天井・家具・ブラインド込み）の平均に合わせる（遠近の境目で明るさが変わらない値）
    vec3 avgLight = cellLight * cellLit * 0.4 * u_night;
    vec3 avgInside = (avgLight + vec3(daylight * 0.12)) * interiorExposure();
    vec3 avgGlass = avgInside * (1.0 - reflAmt) + skyRadiance(R) * 0.8 * reflAmt * glassReflectTint;
    vec3 avg = mix(wallColor, avgGlass, coverage);
    color = mix(avg, color, detail);
  }

  fragColor = vec4(toDisplay(color), 1.0);
}
`;

export const ROOF_VS = /* glsl */ `#version 300 es
${COMMON}
uniform mat4 u_matrix;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_attr;   // style, bSeed, category
layout(location = 2) in vec3 a_info;   // axisAngle, roofArea, height
out vec3 v_world;
flat out vec3 v_attr;
flat out vec3 v_info;
void main() {
  int sid = int(a_attr.x + 0.5);
  vec3 p = a_pos;
  p.z -= parapetDrop(sid, a_info.z);
  v_world = p;
  v_attr = a_attr;
  v_info = a_info;
  gl_Position = u_matrix * vec4(p, 1.0);
}
`;

export const ROOF_FS = /* glsl */ `#version 300 es
${COMMON}
uniform float u_roofFinish;      // 1 = 用途別の仕上げを描く
in vec3 v_world;
flat in vec3 v_attr;
flat in vec3 v_info;
out vec4 fragColor;

void main() {
  int sid = int(v_attr.x + 0.5);
  int cat = int(v_attr.z + 0.5);
  float bSeed = v_attr.y;
  if (u_debug > 0) {
    vec3 c = u_debug == 3 ? vec3(0.35) : u_debugColors[u_debug == 1 ? cat : sid];
    fragColor = vec4(toDisplay(toLinear(c) * 1.1), 1.0);
    return;
  }
  vec4 t6 = styleTexel(sid, 6);  // roof rgb
  vec4 t9 = styleTexel(sid, 9);  // roofFinish, greenRoofRatio, solarRatio, rooftopEquipment
  if (u_effects < 0.5) {
    fragColor = vec4(plainShade(vec3(0.0, 0.0, 1.0)), 1.0);
    return;
  }
  vec3 albedo = t6.rgb * (0.9 + 0.2 * hash12(vec2(bSeed * 53.0, 2.0)));
  vec3 emissive = vec3(0.0);

  if (u_roofFinish > 0.5) {
    // 建物の主軸に沿った座標 (m)
    float ca = cos(v_info.x), sa = sin(v_info.x);
    vec2 p = vec2(v_world.x * ca + v_world.y * sa, -v_world.x * sa + v_world.y * ca);
    // 1 ピクセルが何 m か。細かい模様は遠景で消す
    float px = max(length(dFdx(p)), length(dFdy(p)));
    float fine = 1.0 - smoothstep(0.12, 0.45, px);
    vec2 seedOffset = vec2(bSeed * 317.0, bSeed * 911.0);

    int finish = int(t9.x + 0.5);
    float stain = vnoise(p * 0.15 + seedOffset);
    if (finish == 0) {
      // コンクリート押さえ: 3m 目地
      vec2 g = abs(fract(p / 3.0) - 0.5) * 3.0;
      float joint = 1.0 - smoothstep(0.0, 0.05, min(1.5 - g.x, 1.5 - g.y));
      albedo *= (1.0 - 0.18 * joint * fine) * mix(0.9, 1.05, stain);
    } else if (finish == 1) {
      // 防水シート: 1.8m ごとの継ぎ目
      float seam = 1.0 - smoothstep(0.02, 0.05, abs(fract(p.y / 1.8 + 0.5) - 0.5) * 1.8);
      albedo *= (1.0 - 0.12 * seam * fine) * mix(0.92, 1.04, stain);
    } else {
      // 天窓の列（倉庫・工場）
      float band = step(abs(fract(p.y / 7.0) - 0.5) * 7.0, 0.6);
      float dash = step(fract(p.x / 4.0), 0.85);
      float sky = band * dash;
      albedo = mix(albedo, vec3(0.78, 0.82, 0.84), sky);
      emissive += vec3(1.0, 0.86, 0.62) * 0.18 * sky * u_night * step(hash12(vec2(bSeed, 7.0)), 0.5);
    }

    bool green = v_info.y >= 300.0 && hash12(vec2(bSeed * 71.0, 3.1)) < t9.y;
    bool solar = !green && hash12(vec2(bSeed * 73.0, 5.7)) < t9.z;
    if (green) {
      // 屋上緑化: ノイズで島状に植栽し、細かい濃淡を付ける
      float m = vnoise(p * 0.07 + seedOffset) * 0.7 + vnoise(p * 0.25 + seedOffset) * 0.3;
      float grass = smoothstep(0.42, 0.47, m);
      vec3 plant = mix(vec3(0.2, 0.32, 0.12), vec3(0.38, 0.5, 0.2), vnoise(p * 1.3 + seedOffset));
      plant *= mix(0.75, 1.0, vnoise(p * 4.0) * fine + (1.0 - fine) * 0.5);
      albedo = mix(albedo, plant, grass);
    } else if (solar) {
      // 太陽光パネル: 1.7m 間隔の列、1m ごとのモジュール
      float region = smoothstep(0.36, 0.4, vnoise(p * 0.05 + seedOffset));
      float row = step(fract(p.y / 1.7), 0.62);
      float frame = mix(1.0, 0.7, (1.0 - smoothstep(0.02, 0.04, abs(fract(p.x + 0.5) - 0.5))) * fine);
      vec3 panel = mix(vec3(0.05, 0.08, 0.17), vec3(0.12, 0.17, 0.3), fract(p.y / 1.7) / 0.62) * frame;
      albedo = mix(albedo, panel, region * row);
    }
  }

  vec3 c = toLinear(albedo) * surfaceLight(vec3(0.0, 0.0, 1.0)) + emissive;
  fragColor = vec4(toDisplay(c), 1.0);
}
`;

/** パラペットの内側の面。外壁と同じ頂点を使い、上端から parapetDrop の分だけ内向きの面を描く */
export const PARAPET_VS = /* glsl */ `#version 300 es
${COMMON}
uniform mat4 u_matrix;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_seg;     // tangent.xy, runLength, runSeed
layout(location = 3) in vec4 a_bldg;    // style, bSeed, floorHeight, category
layout(location = 4) in float a_height;
out vec3 v_world;
out float v_t;                           // 0 = 屋上面, 1 = パラペットの天端
flat out vec3 v_normal;                  // 内向き
flat out vec3 v_attr;                    // style, bSeed, category
void main() {
  int sid = int(a_bldg.x + 0.5);
  float drop = parapetDrop(sid, a_height);
  float top = a_pos.z - a_uv.y + a_height;
  bool isTop = a_uv.y > a_height * 0.5;
  vec3 p = vec3(a_pos.xy, isTop ? top : top - drop);
  v_world = p;
  v_t = isTop ? 1.0 : 0.0;
  v_normal = vec3(-a_seg.y, a_seg.x, 0.0);
  v_attr = vec3(a_bldg.x, a_bldg.y, a_bldg.w);
  // パラペットがない建物は面積 0 の四角形になり、何も描かれない
  gl_Position = u_matrix * vec4(p, 1.0);
}
`;

export const PARAPET_FS = /* glsl */ `#version 300 es
${COMMON}
in vec3 v_world;
in float v_t;
flat in vec3 v_normal;
flat in vec3 v_attr;
out vec4 fragColor;
void main() {
  vec3 V = normalize(v_world - u_eye);
  if (dot(V, v_normal) > 0.0) discard;  // 外側から見た面は外壁が描く
  int sid = int(v_attr.x + 0.5);
  int cat = int(v_attr.z + 0.5);
  if (u_debug > 0) {
    vec3 c = u_debug == 3 ? vec3(0.3) : u_debugColors[u_debug == 1 ? cat : sid];
    fragColor = vec4(toDisplay(toLinear(c) * 0.9), 1.0);
    return;
  }
  vec3 albedo = buildingWallColor(sid, v_attr.y) * 0.92;
  // 天端の笠木は明るく、屋上面との入隅は暗く
  float cap = smoothstep(0.88, 0.95, v_t);
  albedo = mix(albedo, vec3(0.72, 0.73, 0.72), cap);
  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.6, v_t));
  vec3 c = toLinear(albedo) * surfaceLight(v_normal) * ao;
  fragColor = vec4(toDisplay(c), 1.0);
}
`;

/** 屋上設備。単位立方体をインスタンスごとに拡大・回転して置く */
export const EQUIPMENT_VS = /* glsl */ `#version 300 es
${COMMON}
uniform mat4 u_matrix;
uniform float u_equipmentEnabled;
uniform float u_equipmentDensity;
layout(location = 0) in vec3 a_pos;      // 単位立方体
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_inst0;    // center x, center y, top
layout(location = 3) in vec3 a_inst1;    // w, d, h
layout(location = 4) in vec3 a_inst2;    // angle, type, rank
layout(location = 5) in vec3 a_inst3;    // style, bSeed, height
out vec3 v_world;
out vec3 v_local;                        // 箱の中の位置 (m)。底面中心が原点
flat out vec3 v_normal;
flat out vec3 v_localNormal;
flat out vec4 v_info;                    // type, bSeed, style, category(未使用)
flat out vec3 v_size;
void main() {
  int sid = int(a_inst3.x + 0.5);
  float factor = styleTexel(sid, 9).w;
  if (u_equipmentEnabled < 0.5 || a_inst2.z >= u_equipmentDensity * factor) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // クリップして描かない
    return;
  }
  vec3 local = a_pos * a_inst1;
  float ca = cos(a_inst2.x), sa = sin(a_inst2.x);
  vec2 xy = vec2(local.x * ca - local.y * sa, local.x * sa + local.y * ca);
  float base = a_inst0.z - parapetDrop(sid, a_inst3.z);
  vec3 p = vec3(a_inst0.xy + xy, base + local.z);
  v_world = p;
  v_local = local;
  v_localNormal = a_normal;
  v_normal = vec3(a_normal.x * ca - a_normal.y * sa, a_normal.x * sa + a_normal.y * ca, a_normal.z);
  v_info = vec4(a_inst2.y, a_inst3.y, a_inst3.x, 0.0);
  v_size = a_inst1;
  gl_Position = u_matrix * vec4(p, 1.0);
}
`;

export const EQUIPMENT_FS = /* glsl */ `#version 300 es
${COMMON}
in vec3 v_world;
in vec3 v_local;
flat in vec3 v_normal;
flat in vec3 v_localNormal;
flat in vec4 v_info;
flat in vec3 v_size;
out vec4 fragColor;
void main() {
  int type = int(v_info.x + 0.5);
  int sid = int(v_info.z + 0.5);
  float seed = v_info.y;
  if (u_debug > 0) {
    fragColor = vec4(toDisplay(toLinear(vec3(0.55)) * surfaceLight(v_normal)), 1.0);
    return;
  }
  bool top = v_localNormal.z > 0.5;
  // 面上の座標 (m): 側面は（面に沿った位置, 高さ）、上面は（x, y）
  vec2 f = top ? v_local.xy : vec2(abs(v_localNormal.x) > 0.5 ? v_local.y : v_local.x, v_local.z);
  float px = max(length(dFdx(f)), length(dFdy(f)));
  float fine = 1.0 - smoothstep(0.05, 0.2, px);
  vec3 albedo;
  vec3 emissive = vec3(0.0);

  if (type == 0) {
    // 塔屋: 建物の外壁と同じ色。長辺側の面に扉
    albedo = buildingWallColor(sid, seed) * 0.95;
    if (top) albedo = styleTexel(sid, 6).rgb;
    else if (abs(v_localNormal.y) > 0.5) {
      float door = step(abs(f.x - v_size.x * 0.2), 0.45) * step(f.y, 2.0);
      albedo = mix(albedo, vec3(0.32, 0.34, 0.36), door * fine);
      emissive += vec3(1.0, 0.8, 0.55) * 0.5 * u_night * step(abs(f.x - v_size.x * 0.2), 0.3) * step(abs(f.y - 2.25), 0.12) * fine;
    }
  } else if (type == 1) {
    // 室外機の列: 1 台ずつの区切りと、上面のファン
    albedo = vec3(0.8, 0.81, 0.79);
    bool alongX = v_size.x >= v_size.y;
    float along = (alongX ? v_local.x + v_size.x * 0.5 : v_local.y + v_size.y * 0.5);
    float unitPos = fract(along / 0.95);
    float groove = 1.0 - smoothstep(0.0, 0.04, min(unitPos, 1.0 - unitPos));
    albedo *= 1.0 - 0.35 * groove * fine;
    if (top) {
      float across = alongX ? v_local.y : v_local.x;
      float fan = 1.0 - smoothstep(0.17, 0.2, length(vec2((unitPos - 0.5) * 0.95, across)));
      albedo = mix(albedo, vec3(0.25, 0.26, 0.27), fan * fine);
    } else {
      float grille = step(0.55, fract(v_local.z * 12.0)) * step(0.15, v_local.z) * step(v_local.z, 0.75);
      albedo *= 1.0 - 0.15 * grille * fine;
    }
  } else if (type == 2) {
    // 受水槽（FRP パネル）: 1m 格子
    albedo = vec3(0.83, 0.85, 0.8);
    vec2 g = abs(fract(f) - 0.5);
    float line = 1.0 - smoothstep(0.44, 0.47, max(g.x, g.y));
    albedo *= 1.0 - 0.18 * (1.0 - line) * fine;
  } else if (type == 3) {
    // キュービクル: 側面のガラリ
    albedo = vec3(0.72, 0.72, 0.68);
    if (!top) albedo *= 1.0 - 0.18 * step(0.5, fract(f.y * 8.0)) * step(0.4, f.y) * step(f.y, v_size.z - 0.3) * fine;
  } else {
    // 冷却塔: 上面の大きなファン、側面のルーバー
    albedo = vec3(0.6, 0.62, 0.63);
    if (top) {
      float r = length(v_local.xy);
      float fan = 1.0 - smoothstep(min(v_size.x, v_size.y) * 0.38, min(v_size.x, v_size.y) * 0.4, r);
      albedo = mix(albedo, vec3(0.16, 0.17, 0.18), fan);
    } else {
      albedo *= 1.0 - 0.25 * step(0.5, fract(f.y * 6.0)) * step(0.3, f.y) * fine;
    }
  }

  // 足元の陰り
  float ao = mix(0.6, 1.0, smoothstep(0.0, 0.5, v_local.z));
  vec3 c = toLinear(albedo) * surfaceLight(v_normal) * ao + emissive;
  fragColor = vec4(toDisplay(c), 1.0);
}
`;

/** 航空障害灯（点スプライト）。加算合成で描く */
export const LIGHT_VS = /* glsl */ `#version 300 es
${COMMON}
uniform mat4 u_matrix;
uniform float u_lightsEnabled;
uniform float u_lightMinHeight;
uniform float u_lightIntensity;
uniform float u_lightBlink;
uniform float u_time;
uniform float u_pixelRatio;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_info;    // height, phase
out float v_intensity;
void main() {
  if (u_lightsEnabled < 0.5 || a_info.x < u_lightMinHeight || u_night < 0.02) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec3 p = a_pos + vec3(0.0, 0.0, 0.5);
  float dist = length(p - u_eye);
  // 中光度の赤色灯は毎分 20〜60 回の明滅。ここでは 1.5 秒周期で、建物ごとに位相をずらす
  float f = fract(u_time / 1.5 + a_info.y);
  float pulse = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.5, 0.6, f));
  float on = u_lightBlink > 0.5 ? pulse : 1.0;
  v_intensity = u_lightIntensity * u_night * on;
  gl_PointSize = clamp(4000.0 / dist, 7.0, 24.0) * u_pixelRatio;
  gl_Position = u_matrix * vec4(p, 1.0);
}
`;

export const LIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 u_lightColor;
in float v_intensity;
out vec4 fragColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0 || v_intensity <= 0.0) discard;
  float core = 1.0 - smoothstep(0.15, 0.32, r);
  float halo = exp(-r * r * 4.0) * 0.8;
  vec3 c = u_lightColor * halo + mix(u_lightColor, vec3(1.0), 0.6) * core;
  fragColor = vec4(c * v_intensity, 0.0);
}
`;
