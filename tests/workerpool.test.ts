import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildingFacadeLayer, defaultWorkerCount } from '../src/layer/BuildingFacadeLayer';
import { markStaleNeighbors, type NeighborTile } from '../src/layer/staleNeighbors';
import { TileStore, toObstacle } from '../src/worker/TileStore';
import type { StyledRecord } from '../src/worker/buildPipeline';

interface FakeWorker {
  posted: { msg: { type: string; [k: string]: unknown }; transfer?: unknown[] }[];
  terminated: boolean;
}

/** Worker を差し替えて、プールへの振り分けを確かめる */
function withPool(count: number, run: (ctx: { layer: BuildingFacadeLayer; workers: FakeWorker[] }) => void) {
  const workers: FakeWorker[] = [];
  vi.stubGlobal('document', { baseURI: 'https://example.com/' });
  vi.stubGlobal(
    'Worker',
    class {
      posted: FakeWorker['posted'] = [];
      terminated = false;
      constructor() {
        workers.push(this);
      }
      postMessage(msg: FakeWorker['posted'][number]['msg'], transfer?: unknown[]) {
        this.posted.push({ msg, transfer });
      }
      terminate() {
        this.terminated = true;
      }
    },
  );
  const layer = new BuildingFacadeLayer({ id: 'p', source: { type: '3dtiles', url: '/tileset.json' }, workerUrl: '/worker.js', workers: count });
  layer.on('error', () => {});
  (layer as unknown as { startWorker(): boolean }).startWorker();
  run({ layer, workers });
}

afterEach(() => vi.unstubAllGlobals());

const node = (id: string) => ({ id, contentUrl: `https://example.com/${id}.b3dm`, geometricError: 0, refine: 'REPLACE', depth: 0, children: [], bounds: {} });
const internal = (layer: BuildingFacadeLayer) =>
  layer as unknown as {
    requestTile(n: unknown, remesh?: boolean): void;
    onWorkerMessage(worker: number, msg: unknown): void;
    unloadTile(e: unknown): void;
    tiles: Map<string, { id: string; state: string; owner?: number }>;
  };
const tileRequests = (w: FakeWorker) => w.posted.filter((p) => p.msg.type === 'tile').map((p) => `${p.msg.tileId}${p.msg.remesh ? ':remesh' : ''}`);

describe('worker pool', () => {
  it('connects every pair of workers and gives the materials job to the first one', () => {
    withPool(3, ({ workers }) => {
      expect(workers).toHaveLength(3);
      workers.forEach((w, i) => {
        const init = w.posted.find((p) => p.msg.type === 'init')!;
        expect(init.msg.index).toBe(i);
        expect((init.msg.peers as unknown[]).length).toBe(2);
        expect(init.transfer).toEqual(init.msg.peers); // 口は転送する
      });
      expect(workers.map((w) => w.posted.some((p) => p.msg.type === 'materials'))).toEqual([true, false, false]);
    });
  });

  it('sends new tiles to the least busy worker and remeshes on the owner', () => {
    withPool(3, ({ layer, workers }) => {
      const l = internal(layer);
      for (const id of ['a', 'b', 'c']) l.requestTile(node(id));
      expect(workers.map(tileRequests)).toEqual([['a'], ['b'], ['c']]);
      // b の Worker が空いたので、次は b の Worker に頼む
      const bRequest = workers[1].posted.find((p) => p.msg.tileId === 'b')!.msg.requestId;
      l.onWorkerMessage(1, { type: 'error', requestId: bRequest, tileId: 'b', code: 'source', message: 'x' });
      l.requestTile(node('d'));
      expect(tileRequests(workers[1])).toEqual(['b', 'd']);
      // 作り直しは建物を持っている Worker へ
      l.tiles.get('a')!.state = 'ready';
      l.requestTile(node('a'), true);
      expect(tileRequests(workers[0])).toEqual(['a', 'a:remesh']);
    });
  });

  it('tells every worker to release an unloaded tile', () => {
    withPool(2, ({ layer, workers }) => {
      const l = internal(layer);
      l.requestTile(node('a'));
      l.unloadTile(l.tiles.get('a'));
      expect(workers.map((w) => w.posted.filter((p) => p.msg.type === 'release').length)).toEqual([1, 1]);
    });
  });

  it('uses one worker for GeoJSON and validates the count', () => {
    expect(() => new BuildingFacadeLayer({ id: 'x', source: { type: '3dtiles', url: '/t.json' }, workers: 0 })).toThrow(/workers/);
    expect(() => new BuildingFacadeLayer({ id: 'x', source: { type: '3dtiles', url: '/t.json' }, workers: 2.5 })).toThrow(/workers/);
    expect(defaultWorkerCount()).toBeGreaterThanOrEqual(1);
    expect(defaultWorkerCount()).toBeLessThanOrEqual(4);
  });
});

describe('markStaleNeighbors', () => {
  const tile = (id: string, bounds: number[], known: string[]): NeighborTile => ({ id, state: 'ready', bounds, known: new Set(known) });

  it('marks whichever side built its mesh without the other', () => {
    const a = tile('a', [0, 0, 1, 1], ['a']);
    const b = tile('b', [1, 0, 2, 1], ['a', 'b']); // b は a を見て作った
    const far = tile('far', [5, 5, 6, 6], ['far']);
    markStaleNeighbors(b, [a, b, far]);
    expect(a.stale).toBe(true); // a は b を見ずに作った
    expect(b.stale).toBeUndefined();
    expect(far.stale).toBeUndefined();
  });

  it('marks the new tile when a neighbor reached its worker too late', () => {
    const a = tile('a', [0, 0, 1, 1], ['a']);
    const b = tile('b', [1, 0, 2, 1], ['b']); // 並行して作られ、どちらも相手を知らない
    markStaleNeighbors(b, [a, b]);
    expect(a.stale).toBe(true);
    expect(b.stale).toBe(true);
  });

  it('leaves tiles being remeshed to their own result', () => {
    const a: NeighborTile = { ...tile('a', [0, 0, 1, 1], ['a']), remeshing: true };
    const b = tile('b', [1, 0, 2, 1], ['a', 'b']);
    markStaleNeighbors(b, [a, b]);
    expect(a.stale).toBeUndefined();
  });

  it('ignores tiles that are not ready or have no buildings', () => {
    const loading: NeighborTile = { id: 'l', state: 'loading', bounds: [0, 0, 1, 1] };
    const empty = tile('e', [Infinity, Infinity, -Infinity, -Infinity], ['e']);
    const b = tile('b', [0, 0, 1, 1], ['b']);
    markStaleNeighbors(b, [loading, empty, b]);
    expect(b.stale).toBeUndefined();
  });
});

describe('TileStore obstacles', () => {
  const rec = (id: string, lng: number): StyledRecord => ({
    record: {
      id, geometry: { kind: 'footprint', polygons: [[[[lng, 35], [lng + 0.0001, 35], [lng + 0.0001, 35.0001], [lng, 35.0001]]]] },
      height: 20, minHeight: 0, category: 'office', structure: 'rc', fireResistance: 'fireproof', openSided: false,
      provenance: { source: 's', heightEstimated: false, storeysEstimated: false, categoryEstimated: false },
    },
    style: 1,
  });

  it('keeps only what wall analysis needs and never overwrites own tiles', () => {
    const o = toObstacle(rec('x', 139));
    expect(Object.keys(o.record).sort()).toEqual(['geometry', 'height', 'id', 'minHeight']);
    expect(o.style).toBe(1);

    const store = new TileStore();
    store.set('own', [rec('a', 139)], 0);
    store.setObstacles('own', [toObstacle(rec('z', 139))]);
    expect(store.get('own')!.records[0].record.id).toBe('a');
    store.setObstacles('peer', [toObstacle(rec('b', 139.0001))]);
    expect(store.ids().sort()).toEqual(['own', 'peer']);
    expect(store.neighborsOf('own').map((r) => r.record.id)).toEqual(['b']);
  });
});
