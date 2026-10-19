import { describe, expect, it, vi } from 'vitest';
import { BuildingFacadeLayerError } from '../src/errors';
import { BuildingFacadeLayer } from '../src/layer/BuildingFacadeLayer';
import { Evented } from '../src/layer/Evented';
import { MAX_STYLES, validateLayerOptions } from '../src/layer/validateOptions';
import { createMat4, invert, multiply, translateScale } from '../src/math/mat4';
import { STYLE_TEXELS, packStyle } from '../src/style/FacadeStyle';
import { DEFAULT_STYLE_RULES, PRESET_STYLES } from '../src/style/presets';

const valid = {
  id: 'facades',
  source: { type: 'geojson', url: '/data.geojson' },
  styles: PRESET_STYLES,
  styleRules: DEFAULT_STYLE_RULES,
};

const optionsError = (fn: () => void): BuildingFacadeLayerError => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BuildingFacadeLayerError);
    expect((e as BuildingFacadeLayerError).code).toBe('options');
    return e as BuildingFacadeLayerError;
  }
  throw new Error('expected an options error');
};

describe('validateLayerOptions', () => {
  it('accepts the presets', () => {
    expect(() => validateLayerOptions(valid)).not.toThrow();
  });

  it('rejects out-of-range style values with a path to the field', () => {
    const e = optionsError(() =>
      validateLayerOptions({ ...valid, styles: { ...PRESET_STYLES, office: { ...PRESET_STYLES.office, windowWidth: 1.5 } } }),
    );
    expect(e.message).toContain('styles.office.windowWidth');
  });

  it('rejects a window that does not fit in the floor', () => {
    const e = optionsError(() =>
      validateLayerOptions({ ...valid, styles: { ...PRESET_STYLES, office: { ...PRESET_STYLES.office, sill: 0.6, windowHeight: 0.6 } } }),
    );
    expect(e.message).toContain('must not exceed 1');
  });

  it('rejects inconsistent facade thresholds', () => {
    const e = optionsError(() =>
      validateLayerOptions({ ...valid, styles: { ...PRESET_STYLES, office: { ...PRESET_STYLES.office, partyWallMax: 3, sideWallMax: 2 } } }),
    );
    expect(e.message).toContain('styles.office.sideWallMax');
    optionsError(() =>
      validateLayerOptions({ ...valid, styles: { ...PRESET_STYLES, office: { ...PRESET_STYLES.office, openAboveRatio: 1.5 } } }),
    );
  });

  it('validates wall and glass palettes', () => {
    const withWalls = (wallColors: unknown) =>
      validateLayerOptions({ ...valid, styles: { ...PRESET_STYLES, office: { ...PRESET_STYLES.office, wallColors: wallColors as never } } });
    expect(() => withWalls([[0.5, 0.5, 0.5], { color: [0.8, 0.7, 0.6], weight: 2 }])).not.toThrow();
    expect(optionsError(() => withWalls([])).message).toContain('styles.office.wallColors');
    expect(optionsError(() => withWalls(Array(7).fill([0.5, 0.5, 0.5]))).message).toContain('1–6');
    expect(optionsError(() => withWalls([{ color: [0.5, 0.5, 0.5], weight: 0 }])).message).toContain('weight');
    expect(optionsError(() => withWalls([[1.2, 0.5, 0.5]])).message).toContain('wallColors[0]');
  });

  it('rejects rules that reference undefined styles', () => {
    const e = optionsError(() => validateLayerOptions({ ...valid, styleRules: [{ when: true, style: 'nope' }] }));
    expect(e.message).toContain('styleRules[0]');
  });

  it(`rejects more than ${MAX_STYLES} styles`, () => {
    const styles = Object.fromEntries(Array.from({ length: MAX_STYLES + 1 }, (_, i) => [`s${i}`, PRESET_STYLES.generic]));
    optionsError(() => validateLayerOptions({ ...valid, styles, styleRules: [{ when: true, style: 's0' }] }));
  });

  it('rejects a missing source url', () => {
    optionsError(() => validateLayerOptions({ ...valid, source: { type: 'geojson' } }));
  });
});

describe('BuildingFacadeLayer: reflection', () => {
  const source = { type: 'geojson' as const, url: '/data.geojson' };

  it('defaults to 1 and can be changed', () => {
    const layer = new BuildingFacadeLayer({ id: 'w', source });
    expect(layer.reflection).toBe(1);
    expect(layer.setReflection(2.5).reflection).toBe(2.5);
    expect(layer.setReflection(0).reflection).toBe(0);
  });

  it('rejects out-of-range values', () => {
    optionsError(() => new BuildingFacadeLayer({ id: 'w', source, reflection: -0.5 }));
    optionsError(() => new BuildingFacadeLayer({ id: 'w', source }).setReflection(4));
    optionsError(() => new BuildingFacadeLayer({ id: 'w', source }).setReflection(Number.NaN));
  });
});

describe('BuildingFacadeLayer: effects', () => {
  const source = { type: 'geojson' as const, url: '/data.geojson' };

  it('defaults to on and can be switched off', () => {
    const layer = new BuildingFacadeLayer({ id: 'w', source });
    expect(layer.effects).toBe(true);
    expect(layer.setEffects(false).effects).toBe(false);
    expect(new BuildingFacadeLayer({ id: 'w', source, effects: false }).effects).toBe(false);
  });

  it('rejects non-boolean values', () => {
    optionsError(() => new BuildingFacadeLayer({ id: 'w', source, effects: 'no' as never }));
    optionsError(() => new BuildingFacadeLayer({ id: 'w', source }).setEffects(0 as never));
  });
});

describe('BuildingFacadeLayer: weathering', () => {
  const source = { type: 'geojson' as const, url: '/data.geojson' };

  it('is on by default and merges partial settings', () => {
    const layer = new BuildingFacadeLayer({ id: 'w', source });
    expect(layer.weathering).toEqual({ enabled: true, strength: 1, streaks: 1, grime: 1, stains: 1 });
    layer.setWeathering({ strength: 1.5, stains: 0 });
    expect(layer.weathering).toEqual({ enabled: true, strength: 1.5, streaks: 1, grime: 1, stains: 0 });
    layer.setWeathering(false);
    expect(layer.weathering.enabled).toBe(false);
    expect(layer.weathering.strength).toBe(1.5);
    expect(new BuildingFacadeLayer({ id: 'w', source, weathering: false }).weathering.enabled).toBe(false);
  });

  it('rejects out-of-range values', () => {
    optionsError(() => new BuildingFacadeLayer({ id: 'w', source, weathering: { strength: 3 } }));
    optionsError(() => new BuildingFacadeLayer({ id: 'w', source }).setWeathering({ streaks: -0.1 }));
    optionsError(() =>
      validateLayerOptions({ ...valid, styles: { ...PRESET_STYLES, office: { ...PRESET_STYLES.office, weathering: 1.2 } } }),
    );
  });
});

describe('BuildingFacadeLayer: surfaceDetail', () => {
  const source = { type: 'geojson' as const, url: '/data.geojson' };

  it('is on by default and merges partial settings', () => {
    const layer = new BuildingFacadeLayer({ id: 'w', source });
    expect(layer.surfaceDetail).toEqual({ enabled: true, materials: 1, glassDistortion: 1 });
    layer.setSurfaceDetail({ glassDistortion: 2 });
    expect(layer.surfaceDetail).toEqual({ enabled: true, materials: 1, glassDistortion: 2 });
    layer.setSurfaceDetail(false);
    expect(layer.surfaceDetail).toEqual({ enabled: false, materials: 1, glassDistortion: 2 });
    expect(new BuildingFacadeLayer({ id: 'w', source, surfaceDetail: { materials: 0.5 } }).surfaceDetail.materials).toBe(0.5);
  });

  it('rejects out-of-range values and unknown materials', () => {
    optionsError(() => new BuildingFacadeLayer({ id: 'w', source, surfaceDetail: { materials: 2.5 } }));
    optionsError(() => new BuildingFacadeLayer({ id: 'w', source }).setSurfaceDetail({ glassDistortion: -1 }));
    const withMaterials = (wallMaterials: unknown) =>
      validateLayerOptions({ ...valid, styles: { ...PRESET_STYLES, office: { ...PRESET_STYLES.office, wallMaterials: wallMaterials as never } } });
    expect(() => withMaterials({ tile: 1 })).not.toThrow();
    expect(optionsError(() => withMaterials({ marble: 0.5 })).message).toMatch(/unknown material 'marble'/);
    optionsError(() => withMaterials({ tile: 1.2 }));
    optionsError(() => withMaterials([0.5]));
    const withRooms = (patch: object) => validateLayerOptions({ ...valid, styles: { ...PRESET_STYLES, office: { ...PRESET_STYLES.office, ...patch } } });
    optionsError(() => withRooms({ windowsPerRoom: 0 }));
    optionsError(() => withRooms({ openPlanRatio: 1.5 }));
    expect(() => withRooms({ windowsPerRoom: 50, openPlanRatio: 1 })).not.toThrow();
  });
});

describe('BuildingFacadeLayer: interior', () => {
  const source = { type: 'geojson' as const, url: '/data.geojson' };

  it('accepts booleans and rejects other values', () => {
    expect(() => new BuildingFacadeLayer({ id: 'w', source, interior: false }).setInterior(true)).not.toThrow();
    expect(optionsError(() => new BuildingFacadeLayer({ id: 'w', source, interior: 'no' as never })).message).toContain('interior');
    expect(optionsError(() => new BuildingFacadeLayer({ id: 'w', source }).setInterior(0 as never)).message).toContain('interior');
  });
});

describe('BuildingFacadeLayer: debug', () => {
  const source = { type: 'geojson' as const, url: '/data.geojson' };

  it('rejects unknown modes in the constructor and in setDebugMode', () => {
    expect(() => new BuildingFacadeLayer({ id: 'w', source, debug: 'facade' })).not.toThrow();
    expect(optionsError(() => new BuildingFacadeLayer({ id: 'w', source, debug: 'walls' as never })).message).toContain('debug mode');
    optionsError(() => new BuildingFacadeLayer({ id: 'w', source }).setDebugMode('walls' as never));
  });
});

describe('BuildingFacadeLayer: dracoWasmUrl', () => {
  it('resolves a relative URL against the page before sending it to the worker', () => {
    const posted: unknown[] = [];
    vi.stubGlobal('document', { baseURI: 'https://example.com/app/index.html' });
    vi.stubGlobal(
      'Worker',
      class {
        postMessage(msg: unknown) {
          posted.push(msg);
        }
      },
    );
    try {
      const layer = new BuildingFacadeLayer({
        id: 'w',
        source: { type: '3dtiles', url: '/tileset.json', dracoWasmUrl: 'wasm/draco_decoder.wasm' },
        workerUrl: '/worker.js',
      });
      (layer as unknown as { startWorker(): boolean }).startWorker();
      expect(posted[0]).toMatchObject({ type: 'init', dracoWasmUrl: 'https://example.com/app/wasm/draco_decoder.wasm' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('BuildingFacadeLayer: worker init errors', () => {
  const source = { type: 'geojson' as const, url: '/data.geojson' };

  it('emits the error code reported by the worker once', () => {
    const layer = new BuildingFacadeLayer({ id: 'w', source });
    const listener = vi.fn();
    layer.on('error', listener);
    (layer as unknown as { onWorkerMessage(msg: unknown): void }).onWorkerMessage({ type: 'initError', code: 'style', message: 'styleRules[0].when: bad' });
    expect(listener).toHaveBeenCalledOnce();
    const { error } = listener.mock.calls[0][0];
    expect(error).toBeInstanceOf(BuildingFacadeLayerError);
    expect(error.code).toBe('style');
  });

  // Worker を差し替えて、読み込み中のタイルがある状態で Worker が止まる場合を再現する
  const withFakeWorker = (run: (ctx: { layer: BuildingFacadeLayer; posted: unknown[]; workers: { onerror?: (ev: unknown) => void; terminated: boolean }[] }) => void) => {
    const posted: unknown[] = [];
    const workers: { onerror?: (ev: unknown) => void; terminated: boolean }[] = [];
    vi.stubGlobal('document', { baseURI: 'https://example.com/' });
    vi.stubGlobal(
      'Worker',
      class {
        onerror?: (ev: unknown) => void;
        terminated = false;
        constructor() {
          workers.push(this);
        }
        postMessage(msg: unknown) {
          posted.push(msg);
        }
        terminate() {
          this.terminated = true;
        }
      },
    );
    try {
      const layer = new BuildingFacadeLayer({ id: 'w', source: { type: '3dtiles', url: '/tileset.json' }, workerUrl: '/worker.js' });
      layer.on('error', () => {});
      (layer as unknown as { startWorker(): boolean }).startWorker();
      run({ layer, posted, workers });
    } finally {
      vi.unstubAllGlobals();
    }
  };
  const node = (id: string) => ({ id, contentUrl: `https://example.com/${id}.glb`, geometricError: 0, refine: 'REPLACE', depth: 0, children: [], bounds: {} });
  const internal = (layer: BuildingFacadeLayer) =>
    layer as unknown as { requestTile(n: unknown): void; onWorkerMessage(msg: unknown): void; inFlight: number };

  it('drops pending tiles and stops requesting new ones after an init error', () => {
    withFakeWorker(({ layer, posted, workers }) => {
      internal(layer).requestTile(node('a'));
      internal(layer).requestTile(node('b'));
      expect(layer.tileStatus.loading).toBe(2);

      internal(layer).onWorkerMessage({ type: 'initError', code: 'adapter', message: 'Unknown building adapter: osm' });
      expect(workers[0].terminated).toBe(true);
      expect(layer.tileStatus.loading).toBe(0);
      expect(internal(layer).inFlight).toBe(0);

      const before = posted.length;
      internal(layer).requestTile(node('c'));
      expect(layer.tileStatus.loading).toBe(0);
      expect(posted).toHaveLength(before);
    });
  });

  it('does the same when the worker itself fails', () => {
    withFakeWorker(({ layer, workers }) => {
      internal(layer).requestTile(node('a'));
      workers[0].onerror!({ preventDefault() {}, message: 'boom' });
      expect(layer.tileStatus.loading).toBe(0);
      internal(layer).requestTile(node('b'));
      expect(layer.tileStatus.loading).toBe(0);
    });
  });
});

describe('Evented', () => {
  class Emitter extends Evented<{ ping: number }> {
    emit(n: number) {
      this.fire('ping', n);
    }
  }

  it('supports on / off / once', () => {
    const e = new Emitter();
    const a = vi.fn();
    const b = vi.fn();
    e.on('ping', a).once('ping', b);
    e.emit(1);
    e.emit(2);
    e.off('ping', a);
    e.emit(3);
    expect(a.mock.calls).toEqual([[1], [2]]);
    expect(b.mock.calls).toEqual([[1]]);
  });
});

describe('mat4', () => {
  it('composes translate * scale and inverts it in double precision', () => {
    // 千代田区付近のメルカトル座標と 1m のスケール（float32 だと桁が落ちる値）
    const t: [number, number, number] = [0.888233, 0.393775, 0];
    const s = 2.9e-8;
    const m = translateScale(createMat4(), t, [s, -s, s]);
    const p = multiply(createMat4(), m, translateScale(createMat4(), [100, 200, 30], [1, 1, 1]));
    expect(p[12]).toBeCloseTo(t[0] + 100 * s, 15);
    expect(p[13]).toBeCloseTo(t[1] - 200 * s, 15);

    const inv = invert(createMat4(), m)!;
    const id = multiply(createMat4(), m, inv);
    for (let i = 0; i < 16; i++) expect(id[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9);
  });

  it('returns null for singular matrices', () => {
    expect(invert(createMat4(), new Float64Array(16))).toBeNull();
  });
});

describe('packStyle', () => {
  it('packs palettes with weights and falls back to the single color', () => {
    const out = new Float32Array(STYLE_TEXELS * 4);
    packStyle({ ...PRESET_STYLES.office, wallColors: [[0.1, 0.2, 0.3], { color: [0.4, 0.5, 0.6], weight: 3 }] }, out, 0);
    expect(Array.from(out.slice(40, 48)).map((v) => Math.round(v * 100) / 100)).toEqual([0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 3]);
    expect(out[48 + 3]).toBe(0); // 空き
    const single = new Float32Array(STYLE_TEXELS * 4);
    packStyle({ ...PRESET_STYLES.office, wallColors: undefined, glassTints: undefined }, single, 0);
    expect(Array.from(single.slice(40, 44)).map((v) => Math.round(v * 100) / 100)).toEqual([...PRESET_STYLES.office.wallColor, 1]);
    expect(Array.from(single.slice(64, 68)).map((v) => Math.round(v * 100) / 100)).toEqual([...PRESET_STYLES.office.glassTint, 1]);
    expect(single[80]).toBeCloseTo(PRESET_STYLES.office.weathering); // texel 20: 汚れやすさ
    expect(single[81]).toBeCloseTo(PRESET_STYLES.office.wallMaterials!.tile!); // texel 20.y: タイルの割合
    expect(single[82]).toBe(0);
    packStyle({ ...PRESET_STYLES.office, wallMaterials: undefined }, single, 0);
    expect(single[81]).toBe(0);
    // texel 21: 部屋の大きさ（省略時は窓 1 枚 = 1 部屋、ワンフロアなし）
    expect([single[84], single[85]]).toEqual([PRESET_STYLES.office.windowsPerRoom, Math.fround(PRESET_STYLES.office.openPlanRatio!)]);
    packStyle({ ...PRESET_STYLES.office, windowsPerRoom: undefined, openPlanRatio: undefined }, single, 0);
    expect([single[84], single[85]]).toEqual([1, 0]);
  });
});
