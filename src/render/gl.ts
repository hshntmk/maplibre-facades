export interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link error:\n${gl.getProgramInfoLog(program)}`);
  }
  const uniforms: Program['uniforms'] = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i)!;
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

export interface MeshBuffers {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
}

/** interleaved な Float32 頂点配列と Uint32 インデックスから VAO を作る */
export function createMesh(
  gl: WebGL2RenderingContext,
  vertices: Float32Array,
  indices: Uint32Array,
  stride: number,
  attributes: { location: number; size: number; offset: number }[],
): MeshBuffers {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  for (const a of attributes) {
    gl.enableVertexAttribArray(a.location);
    gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, stride * 4, a.offset * 4);
  }
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, buffers: [vbo, ibo], count: indices.length };
}

/** 別のメッシュの頂点を共有し、インデックスだけ違う VAO（頂点のバッファは base が持つので、こちらの buffers には入れない） */
export function createIndexView(
  gl: WebGL2RenderingContext,
  base: MeshBuffers,
  indices: Uint32Array,
  stride: number,
  attributes: { location: number; size: number; offset: number }[],
): MeshBuffers {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, base.buffers[0]);
  for (const a of attributes) {
    gl.enableVertexAttribArray(a.location);
    gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, stride * 4, a.offset * 4);
  }
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, buffers: [ibo], count: indices.length };
}

export function deleteMesh(gl: WebGL2RenderingContext, mesh: MeshBuffers): void {
  gl.deleteVertexArray(mesh.vao);
  for (const b of mesh.buffers) gl.deleteBuffer(b);
}

type Attribute = { location: number; size: number; offset: number };

/** 共通の形（単位立方体など）を、インスタンスごとの属性で複製して描く VAO */
export function createInstancedMesh(
  gl: WebGL2RenderingContext,
  base: { vertices: Float32Array; indices: Uint16Array; stride: number; attributes: Attribute[] },
  instances: { data: Float32Array; stride: number; attributes: Attribute[] },
): MeshBuffers & { instanceCount: number } {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, base.vertices, gl.STATIC_DRAW);
  for (const a of base.attributes) {
    gl.enableVertexAttribArray(a.location);
    gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, base.stride * 4, a.offset * 4);
  }
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, base.indices, gl.STATIC_DRAW);
  const inst = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.bufferData(gl.ARRAY_BUFFER, instances.data, gl.STATIC_DRAW);
  for (const a of instances.attributes) {
    gl.enableVertexAttribArray(a.location);
    gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, instances.stride * 4, a.offset * 4);
    gl.vertexAttribDivisor(a.location, 1);
  }
  gl.bindVertexArray(null);
  return { vao, buffers: [vbo, ibo, inst], count: base.indices.length, instanceCount: instances.data.length / instances.stride };
}

/** インデックスなしで点として描く VAO */
export function createPointMesh(gl: WebGL2RenderingContext, data: Float32Array, stride: number, attributes: Attribute[]): MeshBuffers {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (const a of attributes) {
    gl.enableVertexAttribArray(a.location);
    gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, stride * 4, a.offset * 4);
  }
  gl.bindVertexArray(null);
  return { vao, buffers: [vbo], count: data.length / stride };
}

/**
 * 木の形: 幹（六角柱、半径 1・高さ 0–1）と樹冠（半径 1 の球、正二十面体を 1 回分割した 80 面）。頂点は位置 + 法線 + 部位（0 = 幹、1 = 樹冠）。
 * 大きさと樹冠の形（楕円体・円錐）は頂点シェーダでインスタンスごとに決める
 */
export function treeMesh(): { vertices: Float32Array; indices: Uint16Array; stride: number; attributes: Attribute[] } {
  const v: number[] = [];
  const idx: number[] = [];
  // 幹
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2, am = (a0 + a1) / 2;
    const n = [Math.cos(am), Math.sin(am), 0];
    const b = v.length / 7;
    for (const [a, z] of [[a0, 0], [a1, 0], [a1, 1], [a0, 1]] as const) v.push(Math.cos(a), Math.sin(a), z, ...n, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // 樹冠: 正二十面体を 1 回分割
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => {
    const l = Math.hypot(...p);
    return p.map((c) => c / l);
  });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const mid = new Map<string, number>();
  const midpoint = (a: number, b: number) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    let m = mid.get(k);
    if (m === undefined) {
      const p = verts[a].map((c, i) => c + verts[b][i]);
      const l = Math.hypot(...p);
      verts.push(p.map((c) => c / l));
      mid.set(k, (m = verts.length - 1));
    }
    return m;
  };
  faces = faces.flatMap(([a, b, c]) => {
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
  });
  const base = v.length / 7;
  for (const p of verts) v.push(p[0], p[1], p[2], p[0], p[1], p[2], 1);
  for (const f of faces) idx.push(base + f[0], base + f[1], base + f[2]);
  verts = [];
  return {
    vertices: new Float32Array(v),
    indices: new Uint16Array(idx),
    stride: 7,
    attributes: [
      { location: 0, size: 3, offset: 0 },
      { location: 1, size: 3, offset: 3 },
      { location: 5, size: 1, offset: 6 },
    ],
  };
}

/** 単位立方体（x, y: -0.5..0.5, z: 0..1）。既定では底面がない。頂点は位置 + 法線 */
export function unitBox(bottom = false): { vertices: Float32Array; indices: Uint16Array; stride: number; attributes: Attribute[] } {
  const faces: { n: [number, number, number]; c: [number, number, number][] }[] = [
    { n: [0, 0, 1], c: [[-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1]] },
    { n: [1, 0, 0], c: [[0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, -0.5, 1]] },
    { n: [-1, 0, 0], c: [[-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, -0.5, 1], [-0.5, 0.5, 1]] },
    { n: [0, 1, 0], c: [[0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, 0.5, 1]] },
    { n: [0, -1, 0], c: [[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, 1], [-0.5, -0.5, 1]] },
  ];
  if (bottom) faces.push({ n: [0, 0, -1], c: [[-0.5, 0.5, 0], [0.5, 0.5, 0], [0.5, -0.5, 0], [-0.5, -0.5, 0]] });
  const v: number[] = [];
  const idx: number[] = [];
  faces.forEach((f, i) => {
    for (const p of f.c) v.push(...p, ...f.n);
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return {
    vertices: new Float32Array(v),
    indices: new Uint16Array(idx),
    stride: 6,
    attributes: [
      { location: 0, size: 3, offset: 0 },
      { location: 1, size: 3, offset: 3 },
    ],
  };
}
