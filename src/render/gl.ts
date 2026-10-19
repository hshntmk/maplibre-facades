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

/** 底面のない単位立方体（x, y: -0.5..0.5, z: 0..1）。頂点は位置 + 法線 */
export function unitBox(): { vertices: Float32Array; indices: Uint16Array; stride: number; attributes: Attribute[] } {
  const faces: { n: [number, number, number]; c: [number, number, number][] }[] = [
    { n: [0, 0, 1], c: [[-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1]] },
    { n: [1, 0, 0], c: [[0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, -0.5, 1]] },
    { n: [-1, 0, 0], c: [[-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, -0.5, 1], [-0.5, 0.5, 1]] },
    { n: [0, 1, 0], c: [[0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, 0.5, 1]] },
    { n: [0, -1, 0], c: [[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, 1], [-0.5, -0.5, 1]] },
  ];
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
