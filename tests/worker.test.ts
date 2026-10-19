import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE_RULES, PRESET_STYLES } from '../src/style/presets';
import type { PipelineConfig, WorkerRequest, WorkerResponse } from '../src/worker/protocol';

// buildingWorker は import 時に self.onmessage を設定する。self を差し替えてから読み込む
interface FakeSelf {
  onmessage?: (ev: { data: WorkerRequest }) => Promise<void>;
  postMessage: (msg: WorkerResponse) => void;
}

async function loadWorker() {
  vi.resetModules();
  const posted: WorkerResponse[] = [];
  const fake: FakeSelf = { postMessage: (msg) => posted.push(msg) };
  vi.stubGlobal('self', fake);
  await import('../src/worker/buildingWorker');
  const send = (data: WorkerRequest) => fake.onmessage!({ data });
  return { posted, send };
}

const config = (patch: Partial<PipelineConfig>): PipelineConfig => ({
  adapter: { name: 'plateau' },
  styleRules: DEFAULT_STYLE_RULES,
  styleNames: Object.keys(PRESET_STYLES),
  ...patch,
});

const geojson = { type: 'build', requestId: 1, tileId: 'geojson', source: { type: 'geojson', url: 'https://example.invalid/a.geojson' } } as const;

describe('buildingWorker: init', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('reports an invalid style expression as a style error, once', async () => {
    const { posted, send } = await loadWorker();
    await send({ type: 'init', config: config({ styleRules: [{ when: ['nope'] as never, style: 'generic' }] }) });
    await send(geojson);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'initError', code: 'style' });
  });

  it('reports an unknown adapter as an adapter error', async () => {
    const { posted, send } = await loadWorker();
    await send({ type: 'init', config: config({ adapter: { name: 'osm' } }) });
    expect(posted).toEqual([expect.objectContaining({ type: 'initError', code: 'adapter' })]);
  });

  it('posts nothing for a valid config', async () => {
    const { posted, send } = await loadWorker();
    await send({ type: 'init', config: config({}) });
    expect(posted).toEqual([]);
  });
});
