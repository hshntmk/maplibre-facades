import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import type { LightingState } from 'maplibre-facades';

// デモ用の雲。ライブラリとは独立したカスタムレイヤーで、建物のレイヤーの下に置く（霞は MapLibre の sky の霞を使う）。
// 画面全体に 1 枚の三角形を描き、画素ごとに視線を復元する:
// - 空に向かう視線: 高さ CLOUD_HEIGHT の雲の層を、MapLibre が描いた空の上に重ねる
// - 地面に向かう視線: 太陽の方向に雲の層まで上った所の雲の濃さで、地面に雲の影を落とす
// 建物はこのレイヤーのあとに描かれるので、建物には雲の影がかからない。

export interface CloudOptions {
  /** 雲（空の雲と、地面に落ちる影）を描くか */
  enabled: boolean;
  /** 雲量 (0–1) */
  coverage: number;
  /** 雲を風で流すか（流している間は毎フレーム描き直す） */
  animate: boolean;
}

/** 雲の層の高さ (m、地面から) */
const CLOUD_HEIGHT = 1500;
/** 座標の原点（東京駅付近）。カメラ位置をここからのメートルで持ち、float32 の精度を保つ */
const ORIGIN_LNG = 139.7671, ORIGIN_LAT = 35.6812;
/** 風（m/s、東・北） */
const WIND: [number, number] = [9, 3];

const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const latOfMercY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
/** その緯度で 1m がメルカトル座標でいくつか */
const meterInMercator = (lat: number) => 1 / (40075016.686 * Math.cos((lat * Math.PI) / 180));

const VS = /* glsl */ `#version 300 es
in vec2 a_pos;
uniform vec3 u_rays[4]; // 画面の 4 隅（左下・右下・左上・右上）への視線（東・北・上、m）
out vec3 v_ray;
void main() {
  vec2 t = a_pos * 0.5 + 0.5;
  v_ray = mix(mix(u_rays[0], u_rays[1], t.x), mix(u_rays[2], u_rays[3], t.x), t.y);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_ray;
uniform vec3 u_camera;      // カメラ位置（原点からの東・北 m、地面からの高さ m）
uniform vec3 u_sunDir;      // 太陽の方向（東・北・上）
uniform vec3 u_sunColor;
uniform vec3 u_skyZenith;
uniform vec3 u_skyHorizon;
uniform float u_night;      // 0 = 昼、1 = 夜
uniform float u_coverage;   // 雲量
uniform vec2 u_wind;        // 雲の移動量 (m)
out vec4 fragColor;

const float CLOUD_HEIGHT = ${CLOUD_HEIGHT.toFixed(1)};

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
/** fbm。footprint は 1 画素が覆う幅（ノイズの単位）。画素より細かい階層は平均値 0.5 にして、遠くのちらつき・筋を防ぐ */
float fbm(vec2 p, float footprint) {
  float v = 0.0, a = 0.5, cell = 1.0;
  for (int i = 0; i < 5; i++) {
    float keep = 1.0 - smoothstep(0.25, 1.0, footprint / cell);
    v += a * mix(0.5, noise(p), keep);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1;
    a *= 0.5;
    cell *= 0.5;
  }
  return v;
}
/** 雲の濃さ (0–1)。p は雲の層の上の位置（m） */
float cloudDensity(vec2 p) {
  vec2 q = (p + u_wind) / 1800.0;
  float footprint = max(length(dFdx(q)), length(dFdy(q)));
  float n = fbm(q, footprint);
  float c = clamp(u_coverage, 0.0, 1.0);
  // 細部を平均にした分、ぼけた雲が濃く広がらないよう、遠いほどしきい値の幅を広げる
  float soft = clamp(footprint, 0.0, 1.0) * 0.2;
  return smoothstep(0.78 - c * 0.55 - soft, 0.98 - c * 0.5 + soft, n);
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toDisplay(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }

/** 雲の色（線形）。昼は日なた側が明るく、厚いほど下面が暗い。夜は街明かりで下面がほのかに橙に照らされる */
vec3 cloudColor(float density) {
  float sunUp = smoothstep(-0.05, 0.15, u_sunDir.z);
  vec3 lit = toLinear(u_sunColor) * 1.1 + toLinear(u_skyZenith) * 0.4;
  vec3 day = mix(lit, lit * 0.55 + toLinear(u_skyHorizon) * 0.2, density);
  vec3 night = vec3(0.086, 0.062, 0.051);
  return mix(night, day, sunUp * (1.0 - u_night));
}

void main() {
  vec3 dir = normalize(v_ray);

  if (dir.z < -1e-4) {
    // ---- 地面: 雲の影。背景（地図）を (1 - s) 倍にする
    float dist = u_camera.z / -dir.z;
    vec2 ground = u_camera.xy + dir.xy * dist;
    // 太陽の方向に雲の層まで上った位置の雲。日が低いほど影は遠くに落ちる
    vec2 toSun = u_sunDir.xy / max(u_sunDir.z, 0.25) * CLOUD_HEIGHT;
    float sunUp = smoothstep(0.0, 0.2, u_sunDir.z) * (1.0 - u_night);
    // 遠くの影は霞に隠れるので弱める（MapLibre の霞は地面に先にかかっていて、この影はその上に重なる）
    float s = cloudDensity(ground + toSun) * 0.55 * sunUp * exp(-dist / 12000.0);
    // カメラが雲より上にあるときは、視線が雲の層を横切る所に薄い雲を重ねる
    float a = 0.0;
    vec3 c = vec3(0.0);
    if (u_camera.z > CLOUD_HEIGHT) {
      float d = cloudDensity(u_camera.xy + dir.xy * ((u_camera.z - CLOUD_HEIGHT) / -dir.z));
      a = d * 0.55 * smoothstep(CLOUD_HEIGHT, CLOUD_HEIGHT * 1.6, u_camera.z);
      c = toDisplay(cloudColor(d));
    }
    float keep = (1.0 - s) * (1.0 - a);
    fragColor = vec4(c * a, 1.0 - keep);
    return;
  }

  // ---- 空: MapLibre が描いた空の上に雲を重ねる
  if (u_camera.z >= CLOUD_HEIGHT || dir.z < 0.01) discard;
  float t = (CLOUD_HEIGHT - u_camera.z) / dir.z;
  float d = cloudDensity(u_camera.xy + dir.xy * t);
  // 遠くの雲ほど薄く（地平線付近は MapLibre の空の霞に溶け込ませる）
  // 地平線に近いほど遠くの雲を細かく拾ってちらつく・筋になるので、低い角度では消す
  float far = exp(-t / 15000.0);
  float a = d * smoothstep(0.04, 0.2, dir.z) * (0.3 + 0.7 * far);
  vec3 c = mix(toLinear(u_skyHorizon), cloudColor(d), 0.3 + 0.7 * far);
  fragColor = vec4(toDisplay(c) * a, a);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile error');
  return s;
}

/** 4x4 行列（列優先）の逆行列。倍精度で計算する */
function invert(m: ArrayLike<number>): Float64Array | null {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = Array.from(m);
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const d = 1 / det;
  return Float64Array.from([
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ]);
}

const transform = (m: Float64Array, x: number, y: number, z: number): [number, number, number] => {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
};

export class CloudLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  options: CloudOptions;

  private map?: MapLibreMap;
  private program?: WebGLProgram;
  private vao?: WebGLVertexArrayObject;
  private buffer?: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private lighting: () => LightingState;
  private startTime = performance.now();

  /** @param lighting 建物のレイヤーの照明（雲の色と影の向きを時刻に合わせる） */
  constructor(id: string, lighting: () => LightingState, options: CloudOptions) {
    this.id = id;
    this.lighting = lighting;
    this.options = { ...options };
  }

  setOptions(patch: Partial<CloudOptions>): void {
    this.options = { ...this.options, ...patch };
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error');
    this.program = program;
    for (const name of ['u_rays', 'u_camera', 'u_sunDir', 'u_sunColor', 'u_skyZenith', 'u_skyHorizon', 'u_night', 'u_coverage', 'u_wind']) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    // 画面全体を覆う 1 枚の三角形
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    this.map = undefined;
  }

  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput): void {
    const o = this.options;
    if (!this.program || !this.vao || !this.map || !o.enabled) return;
    const inv = invert(input.defaultProjectionData.mainMatrix);
    if (!inv) return;

    // カメラ位置（メルカトル）: 視点は射影後に (0, 0, c, 0) へ写るので、逆行列で戻す
    const eye: [number, number, number] = [inv[8] / inv[11], inv[9] / inv[11], inv[10] / inv[11]];
    const meter = meterInMercator(latOfMercY(eye[1]));
    const toMeters = (dx: number, dy: number, dz: number): [number, number, number] => [dx / meter, -dy / meter, dz / meter];
    const camera = toMeters(eye[0] - mercX(ORIGIN_LNG), eye[1] - mercY(ORIGIN_LAT), eye[2]);
    // 地形があるときは、地図の中心の地面からの高さにする（東京は平らなので、地面は 1 枚の平面とみなす）
    camera[2] -= this.map.getTerrain() ? this.map.getCenterElevation() : 0;
    // 画面の 4 隅を遠い面に戻した点への視線（左下・右下・左上・右上）
    const rays: number[] = [];
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = transform(inv, x, y, 1);
      rays.push(...toMeters(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]));
    }

    const L = this.lighting();
    const seconds = o.animate ? (performance.now() - this.startTime) / 1000 : 0;
    const u = this.uniforms;
    gl.useProgram(this.program);
    gl.uniform3fv(u.u_rays, rays);
    gl.uniform3fv(u.u_camera, camera);
    gl.uniform3fv(u.u_sunDir, L.sunDir);
    gl.uniform3fv(u.u_sunColor, L.sunColor);
    gl.uniform3fv(u.u_skyZenith, L.skyZenith);
    gl.uniform3fv(u.u_skyHorizon, L.skyHorizon);
    gl.uniform1f(u.u_night, L.night);
    gl.uniform1f(u.u_coverage, o.coverage);
    gl.uniform2f(u.u_wind, -WIND[0] * seconds, -WIND[1] * seconds);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    // 前景は乗算済みアルファ（色 × a）。背景は (1 - a) 倍にして重ねる
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    if (o.animate) this.map.triggerRepaint();
  }
}
