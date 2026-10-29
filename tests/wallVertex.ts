import { WALL_SEGMENT, WALL_SEGMENT_FLOATS, WALL_STRIDE, type FacadeMesh } from '../src/mesh/layout';

export type WallVertex = { x: number; y: number; z: number; u: number; v: number } & Record<keyof typeof WALL_SEGMENT, number>;

/** 壁の i 番目の頂点を、頂点の値と壁ごとの値（wallSegments）を合わせて読む */
export function wallVertex(mesh: Pick<FacadeMesh, 'walls' | 'wallSegments'>, i: number): WallVertex {
  const o = i * WALL_STRIDE;
  const s = mesh.walls[o + 4] * WALL_SEGMENT_FLOATS;
  const out = { x: mesh.walls[o], y: mesh.walls[o + 1], z: mesh.walls[o + 2], u: mesh.walls[o + 3] } as WallVertex;
  for (const [name, k] of Object.entries(WALL_SEGMENT)) out[name as keyof typeof WALL_SEGMENT] = mesh.wallSegments[s + k];
  out.v = out.z - out.bottom;
  return out;
}

export const wallVertexCount = (mesh: Pick<FacadeMesh, 'walls'>) => mesh.walls.length / WALL_STRIDE;
