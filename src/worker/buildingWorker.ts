/// <reference lib="webworker" />
import { BuildingFacadeLayerError } from '../errors';
import { WALL_MATERIALS, createMaterialTexture } from '../material/WallMaterials';
import type { FacadeMesh } from '../mesh/layout';
import { readGeoJsonSource } from '../sources/GeoJsonSource';
import { DEFAULT_DRACO_WASM_URL } from '../sources/SourceConfig';
import { parseTileContent, usesDraco } from '../sources/tiles3d/content';
import { getDracoModule } from '../sources/tiles3d/draco';
import { featuresFromTile } from '../sources/tiles3d/footprints';
import type { SourceFeature } from '../sources/SourceConfig';
import { RecordFactory, meshRecords, type StyledRecord } from './buildPipeline';
import { TileCache, createTileCache } from './TileCache';
import { TileStore, toObstacle } from './TileStore';
import type { PipelineConfig, WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let config: PipelineConfig | undefined;
let factory: RecordFactory | undefined;
let dracoWasmUrl = DEFAULT_DRACO_WASM_URL;
/** init で設定が不正だった（initError で 1 回だけ知らせ、以降の build / tile は応答しない） */
let initFailed = false;
const tiles = new TileStore();
let tileCache: TileCache | undefined;
/** 他の Worker への直通の口 */
let peers: MessagePort[] = [];

/** 他の Worker が展開したタイルの建物（壁面の解析に使う） */
function onPeerMessage(ev: MessageEvent<{ type: 'obstacles'; tileId: string; records: StyledRecord[] }>) {
  if (ev.data.type === 'obstacles') tiles.setObstacles(ev.data.tileId, ev.data.records);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    throw new BuildingFacadeLayerError('source', `Failed to load ${url}: ${e instanceof Error ? e.message : e}`, { cause: e });
  }
}

function post(msg: WorkerResponse, mesh?: FacadeMesh) {
  if (mesh) self.postMessage(msg, [mesh.walls.buffer, mesh.wallIndices.buffer, mesh.roofs.buffer, mesh.roofIndices.buffer, mesh.equipment.buffer, mesh.lights.buffer, mesh.balconies.buffer, mesh.balconyIndices.buffer, mesh.fixtures.buffer, mesh.fixtureIndices.buffer, mesh.pitchedRoofs.buffer, mesh.pitchedRoofIndices.buffer, mesh.grounds.buffer]);
  else self.postMessage(msg);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  if (req.type === 'init') {
    if (req.dracoWasmUrl) dracoWasmUrl = req.dracoWasmUrl;
    if (req.tileCache) {
      tileCache = createTileCache(req.tileCache);
      // 古い形式・期限切れ・上限を超えた分を、起動時に 1 回片づける（プールの先頭の Worker だけ）
      if (!req.index) tileCache?.evict().catch(() => {});
    }
    peers = req.peers ?? [];
    for (const port of peers) port.onmessage = onPeerMessage;
    try {
      factory = new RecordFactory(req.config);
      config = req.config;
    } catch (e) {
      initFailed = true;
      post({
        type: 'initError',
        code: e instanceof BuildingFacadeLayerError ? e.code : 'worker',
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
    if (!config || !factory) throw new BuildingFacadeLayerError('worker', 'worker is not initialized');

    if (req.type === 'build') {
      const t0 = performance.now();
      const { records, skipped } = await factory.build(readGeoJsonSource(req.source), req.source.url);
      const t1 = performance.now();
      const { mesh, stats } = meshRecords(records, [], config, skipped);
      const timing = { fetch: 0, decode: t1 - t0, mesh: performance.now() - t1, bytes: 0, cached: false, remesh: false, neighbors: 0 };
      post({ type: 'built', requestId: req.requestId, tileId: req.tileId, mesh, stats, timing, knownTiles: [] }, mesh);
      return;
    }

    // ---- 3D Tiles のタイル
    let entry = tiles.get(req.tileId);
    const fresh = !entry || !req.remesh;
    const timing = { fetch: 0, decode: 0, mesh: 0, bytes: 0, cached: false, remesh: !fresh, neighbors: 0 };
    /** 新しくダウンロードして展開したので、応答のあとで保存するもの */
    let toCache: { key: string; features: SourceFeature[] } | undefined;
    if (fresh) {
      const t0 = performance.now();
      const key = tileCache ? TileCache.key(req.url, req.transform) : undefined;
      let features = key ? await tileCache!.get(key) : undefined;
      let t1 = performance.now();
      if (features) {
        timing.cached = true;
      } else {
        const buf = await fetchBytes(req.url);
        t1 = performance.now();
        timing.fetch = t1 - t0;
        timing.bytes = buf.byteLength;
        const draco = usesDraco(buf) ? await getDracoModule(dracoWasmUrl) : undefined;
        features = featuresFromTile(parseTileContent(buf, draco, req.transform));
        if (key) toCache = { key, features };
      }
      const { records, skipped } = await factory.build(features, req.url);
      entry = tiles.set(req.tileId, records, skipped);
      // 他の Worker が隣のタイルの壁面を解析できるよう、建物を送る（メッシュより先に）
      if (peers.length) {
        const obstacles = records.map(toObstacle);
        for (const port of peers) port.postMessage({ type: 'obstacles', tileId: req.tileId, records: obstacles });
      }
      timing.decode = performance.now() - (timing.cached ? t0 : t1);
    }
    const t2 = performance.now();
    const neighbors = tiles.neighborsOf(req.tileId);
    const { mesh, stats } = meshRecords(entry!.records, neighbors, config, entry!.skipped);
    timing.mesh = performance.now() - t2;
    timing.neighbors = neighbors.length;
    // どの隣のタイルを見て作ったか（足りなければメインスレッドが作り直しを依頼する）
    post({ type: 'built', requestId: req.requestId, tileId: req.tileId, mesh, stats, timing, knownTiles: tiles.ids() }, mesh);
    // 保存（JSON 化と圧縮）は表示を待たせないよう、応答のあとで行う
    if (toCache) void tileCache?.put(toCache.key, toCache.features);
  } catch (e) {
    post({
      type: 'error',
      requestId: req.requestId,
      tileId: req.tileId,
      code: e instanceof BuildingFacadeLayerError ? e.code : 'worker',
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
