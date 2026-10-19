/// <reference lib="webworker" />
import { BuildingWindowLayerError } from '../errors';
import { WALL_MATERIALS, createMaterialTexture } from '../material/WallMaterials';
import type { FacadeMesh } from '../mesh/layout';
import { readGeoJsonSource } from '../sources/GeoJsonSource';
import { DEFAULT_DRACO_WASM_URL } from '../sources/SourceConfig';
import { parseTileContent, usesDraco } from '../sources/tiles3d/content';
import { getDracoModule } from '../sources/tiles3d/draco';
import { featuresFromTile } from '../sources/tiles3d/footprints';
import { RecordFactory, meshRecords } from './buildPipeline';
import { TileStore } from './TileStore';
import type { PipelineConfig, WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let config: PipelineConfig | undefined;
let factory: RecordFactory | undefined;
let dracoWasmUrl = DEFAULT_DRACO_WASM_URL;
/** init で設定が不正だった（initError で 1 回だけ知らせ、以降の build / tile は応答しない） */
let initFailed = false;
const tiles = new TileStore();

async function fetchBytes(url: string): Promise<Uint8Array> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    throw new BuildingWindowLayerError('source', `Failed to load ${url}: ${e instanceof Error ? e.message : e}`, { cause: e });
  }
}

function post(msg: WorkerResponse, mesh?: FacadeMesh) {
  if (mesh) self.postMessage(msg, [mesh.walls.buffer, mesh.wallIndices.buffer, mesh.roofs.buffer, mesh.roofIndices.buffer, mesh.equipment.buffer, mesh.lights.buffer]);
  else self.postMessage(msg);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  if (req.type === 'init') {
    if (req.dracoWasmUrl) dracoWasmUrl = req.dracoWasmUrl;
    try {
      factory = new RecordFactory(req.config);
      config = req.config;
    } catch (e) {
      initFailed = true;
      post({
        type: 'initError',
        code: e instanceof BuildingWindowLayerError ? e.code : 'worker',
        message: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }
  if (req.type === 'release') {
    tiles.delete(req.tileId);
    return;
  }
  if (req.type === 'materials') {
    post({ type: 'materials', textures: WALL_MATERIALS.map((name) => createMaterialTexture(name, req.size)) });
    return;
  }
  if (initFailed) return;
  try {
    if (!config || !factory) throw new BuildingWindowLayerError('worker', 'worker is not initialized');

    if (req.type === 'build') {
      const t0 = performance.now();
      const { records, skipped } = await factory.build(readGeoJsonSource(req.source), req.source.url);
      const t1 = performance.now();
      const { mesh, stats } = meshRecords(records, [], config, skipped);
      const timing = { fetch: 0, decode: t1 - t0, mesh: performance.now() - t1, bytes: 0, remesh: false, neighbors: 0 };
      post({ type: 'built', requestId: req.requestId, tileId: req.tileId, mesh, stats, timing, affected: [] }, mesh);
      return;
    }

    // ---- 3D Tiles のタイル
    let entry = tiles.get(req.tileId);
    const fresh = !entry || !req.remesh;
    const timing = { fetch: 0, decode: 0, mesh: 0, bytes: 0, remesh: !fresh, neighbors: 0 };
    if (fresh) {
      const t0 = performance.now();
      const buf = await fetchBytes(req.url);
      const t1 = performance.now();
      timing.fetch = t1 - t0;
      timing.bytes = buf.byteLength;
      const draco = usesDraco(buf) ? await getDracoModule(dracoWasmUrl) : undefined;
      const features = featuresFromTile(parseTileContent(buf, draco, req.transform));
      const { records, skipped } = await factory.build(features, req.url);
      entry = tiles.set(req.tileId, records, skipped);
      timing.decode = performance.now() - t1;
    }
    const t2 = performance.now();
    const neighbors = tiles.neighborsOf(req.tileId);
    const { mesh, stats } = meshRecords(entry!.records, neighbors, config, entry!.skipped);
    timing.mesh = performance.now() - t2;
    timing.neighbors = neighbors.length;
    // 新しく届いたタイルは、隣接する読み込み済みタイルの壁面の判定を変えうる
    const affected = fresh ? tiles.affectedBy(req.tileId) : [];
    post({ type: 'built', requestId: req.requestId, tileId: req.tileId, mesh, stats, timing, affected }, mesh);
  } catch (e) {
    post({
      type: 'error',
      requestId: req.requestId,
      tileId: req.tileId,
      code: e instanceof BuildingWindowLayerError ? e.code : 'worker',
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
