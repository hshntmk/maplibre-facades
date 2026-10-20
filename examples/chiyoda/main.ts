import * as maplibregl from 'maplibre-gl';
// maplibre-gl v6 は自身の Worker を import.meta.url 基準で探すが、本番ビルドではそのファイルが出力されないので、Vite に Worker として取り込ませて URL を渡す
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { TOKYO_23_WARDS } from './tokyo23';
import { CloudLayer } from './clouds';
import { GSI_DEM_PROTOCOL, registerGsiDemProtocol } from './gsiTerrain';
import { BUILDING_CATEGORIES, BuildingFacadeLayer, CATEGORY_COLORS, clearTileCache, tileCacheUsage, type BuildingStats, type DebugMode, type RGB } from 'maplibre-facades';

maplibregl.setWorkerUrl(mapLibreWorkerUrl);
registerGsiDemProtocol();

const CATEGORY_LABELS: Record<string, string> = {
  unknown: '不明',
  office: '業務施設',
  commercial: '商業施設',
  hotel: '宿泊施設',
  mixed_commercial: '商業系複合施設',
  house: '住宅',
  apartment: '共同住宅',
  mixed_house: '店舗等併用住宅',
  mixed_apartment: '店舗等併用共同住宅',
  public: '官公庁施設',
  education_welfare: '文教厚生施設',
  warehouse: '運輸倉庫施設',
  factory: '工場',
  utility: '供給処理施設',
  other: 'その他',
};

const VIEWS: Record<string, maplibregl.CameraOptions> = {
  marunouchi: { center: [139.7652, 35.6812], zoom: 16.4, pitch: 68, bearing: -28 },
  kanda: { center: [139.7697, 35.6936], zoom: 17.2, pitch: 64, bearing: 24 },
  akihabara: { center: [139.7721, 35.6992], zoom: 17.1, pitch: 66, bearing: -38 },
  shinjuku: { center: [139.6935, 35.6905], zoom: 16.3, pitch: 66, bearing: 30 },
  shibuya: { center: [139.7016, 35.6590], zoom: 16.8, pitch: 64, bearing: -20 },
  overview: { center: [139.7565, 35.6875], zoom: 14.6, pitch: 55, bearing: -15 },
};

const TOKYO_OVERVIEW: maplibregl.CameraOptions = { center: [139.735, 35.682], zoom: 12.8, pitch: 50, bearing: -10 };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    // 時刻に合わせたペイントの変更はすぐに反映する（地形に貼るテクスチャを描き直すときに、変化の途中の色が残らないように）
    transition: { duration: 0, delay: 0 },
    sources: {
      gsi: {
        type: 'raster',
        // 地理院タイル「全国最新写真（シームレス）」
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル（全国最新写真）</a>',
      },
      // 地理院タイル「標高タイル（基盤地図情報 数値標高モデル）」。読み込み時に Terrarium 形式へ変換する（gsiTerrain.ts）
      'gsi-dem': {
        type: 'raster-dem',
        tiles: [`${GSI_DEM_PROTOCOL}://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png`],
        tileSize: 256,
        maxzoom: 14,
        encoding: 'terrarium',
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル（標高タイル）</a>',
      },
    },
    ...($<HTMLInputElement>('terrain').checked ? { terrain: { source: 'gsi-dem', exaggeration: Number($<HTMLInputElement>('terrain-exaggeration').value) } } : {}),
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0b0d12' } },
      { id: 'gsi', type: 'raster', source: 'gsi' },
    ],
  },
  ...VIEWS.marunouchi,
  maxPitch: 80,
  hash: true,
  canvasContextAttributes: { antialias: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(
  new maplibregl.AttributionControl({
    customAttribution: '<a href="https://www.mlit.go.jp/plateau/" target="_blank">国土交通省 Project PLATEAU</a>',
  }),
);

// データ: 既定は PLATEAU の 3D Tiles（東京23区）を直接、表示範囲だけ読む。
// ?source=geojson で事前変換した千代田区の GeoJSON を一括で読む（データがあるときだけ。vite.config.ts を参照）
declare const __DEMO_GEOJSON__: boolean;
const sourceKind = __DEMO_GEOJSON__ && new URLSearchParams(location.search).get('source') === 'geojson' ? 'geojson' : '3dtiles';
const sourceSelect = $<HTMLSelectElement>('source');
if (!__DEMO_GEOJSON__) sourceSelect.querySelector('option[value="geojson"]')?.remove();
sourceSelect.value = sourceKind;
sourceSelect.addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('source', sourceSelect.value);
  location.href = url.href;
});

const layer = new BuildingFacadeLayer({
  id: 'plateau-facades',
  source:
    sourceKind === 'geojson'
      ? { type: 'geojson', url: `${import.meta.env.BASE_URL}data/13101_bldg_lod1.geojson` }
      : { type: '3dtiles', url: TOKYO_23_WARDS.map((w) => w.url) },
  adapter: { name: 'plateau' },
  timeOfDay: 20,
});
// 3D Tiles ではタイルが増減するたびに凡例を更新する（まとめて 1 フレームに 1 回）
let statsFrame = 0;
const scheduleStats = () => {
  if (statsFrame) return;
  statsFrame = requestAnimationFrame(() => {
    statsFrame = 0;
    if (layer.stats) renderStats(layer.stats);
  });
};
layer.on('load', scheduleStats).on('tileload', scheduleStats).on('tileunload', scheduleStats);
// 3D Tiles: 展開したタイルはブラウザ（IndexedDB）に保存され、次からはダウンロードを省く。保存量を表示し、消せるようにする
let usageTimer = 0;
const showCacheUsage = () => {
  if (usageTimer) return; // 1 秒に 1 回まで
  usageTimer = window.setTimeout(async () => {
    usageTimer = 0;
    const { tiles, bytes } = await tileCacheUsage().catch(() => ({ tiles: 0, bytes: 0 }));
    $('cache-usage').textContent = `ブラウザに保存したタイル: ${tiles} 枚（${(bytes / 1e6).toFixed(1)} MB）`;
  }, 1000);
};
layer.on('tileload', showCacheUsage);
if (sourceKind === 'geojson') $('cache-usage').parentElement!.style.display = 'none';
else showCacheUsage();
$('cache-clear').addEventListener('click', async () => {
  await clearTileCache();
  showCacheUsage();
});
// 開発時の確認用: タイルごとの処理時間
const tileLog: { tileId: string; at: number; timing: unknown }[] = [];
(window as unknown as { tileLog: typeof tileLog }).tileLog = tileLog;
layer.on('tileload', ({ tileId, timing }) => tileLog.push({ tileId, at: performance.now(), timing }));
layer.on('error', ({ error }) => {
  $('errors').textContent = `読み込みに失敗しました（${error.code}）: ${error.message}`;
});
// 開発時の確認用
(window as unknown as { layer: BuildingFacadeLayer; map: maplibregl.Map }).layer = layer;
(window as unknown as { layer: BuildingFacadeLayer; map: maplibregl.Map }).map = map;

// 霞と雲（デモ専用のカスタムレイヤー。航空写真と空にだけかかり、建物にはかからない）
const clouds = new CloudLayer('clouds', () => layer.lightingState, {
  enabled: $<HTMLInputElement>('clouds').checked,
  coverage: Number($<HTMLInputElement>('cloud-coverage').value),
  animate: $<HTMLInputElement>('cloud-animate').checked,
});
(window as unknown as { clouds: CloudLayer }).clouds = clouds;

map.on('load', () => {
  // 雲は演出なので、作れない環境でも建物は表示する
  try {
    map.addLayer(clouds);
  } catch (e) {
    console.warn('雲のレイヤーを追加できませんでした', e);
    if (map.getLayer(clouds.id)) map.removeLayer(clouds.id);
  }
  map.addLayer(layer);
  applyTimeOfDay(layer.timeOfDay);
});

// ---------------------------------------------------------------- 時刻と背景地図

const hex = (c: RGB) =>
  `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

let lastRasterBrightness = NaN;

function applyTimeOfDay(hour: number): void {
  layer.setTimeOfDay(hour);
  const L = layer.lightingState;
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  $('hour-label').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (!map.isStyleLoaded()) return;
  // 背景の地理院タイルを夜は暗く
  // 航空写真は昼はそのまま、夜は暗く彩度を落とす
  const brightness = 1 - 0.85 * L.night - 0.15 * L.twilight;
  map.setPaintProperty('gsi', 'raster-brightness-max', brightness);
  map.setPaintProperty('gsi', 'raster-saturation', -0.6 * L.night);
  map.setPaintProperty('gsi', 'raster-contrast', 0.1 * L.night);
  // 地形があるとき、MapLibre は地図をタイルごとのテクスチャに描いて地形に貼るが、ペイントの変更ではそれを描き直さない。
  // 明るさが変わったらテクスチャを捨てて描き直させる（MapLibre の内部の API。時間を進めている間は変化が小さいうちは描き直さない）
  if (Math.abs(brightness - lastRasterBrightness) > 0.01) {
    lastRasterBrightness = brightness;
    (map as unknown as { terrain?: { tileManager?: { releaseAllRTT?: () => void } } }).terrain?.tileManager?.releaseAllRTT?.();
  }
  map.setSky({
    'sky-color': hex(L.skyZenith),
    'horizon-color': hex(L.skyHorizon),
    'fog-color': hex(L.skyHorizon),
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.8,
    // MapLibre の霞（地形があるときだけ、ピッチ 60° 以上で地面にかかる）。fog-ground-blend より奥が霞む。建物にも同じ霞がかかる
    'fog-ground-blend': $<HTMLInputElement>('haze').checked ? 1 - Number($<HTMLInputElement>('haze-amount').value) : 1,
  });
}

const hourInput = $<HTMLInputElement>('hour');
hourInput.addEventListener('input', () => applyTimeOfDay(Number(hourInput.value)));

let lastFrame = performance.now();
function tick(now: number) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if ($<HTMLInputElement>('advance').checked) {
    // 1 秒で 20 分進む
    const next = (Number(hourInput.value) + dt / 3) % 24;
    hourInput.value = String(next);
    applyTimeOfDay(next);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------------------------------------------------------------- 表示切り替え

$<HTMLSelectElement>('effects').addEventListener('change', (e) => layer.setEffects((e.target as HTMLSelectElement).value === 'on'));
$<HTMLInputElement>('interior').addEventListener('change', (e) => layer.setInterior((e.target as HTMLInputElement).checked));
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const updateRoof = () =>
  layer.setRoof({
    parapet: checked('roof-parapet'),
    finish: checked('roof-finish'),
    equipment: { enabled: checked('roof-equipment'), density: Number($<HTMLInputElement>('roof-density').value) },
    aviationLights: { enabled: checked('roof-lights'), blink: checked('roof-blink') },
  });
for (const id of ['roof-parapet', 'roof-finish', 'roof-equipment', 'roof-lights', 'roof-blink']) $(id).addEventListener('change', updateRoof);
$('roof-density').addEventListener('input', () => {
  $('roof-density-label').textContent = Number($<HTMLInputElement>('roof-density').value).toFixed(2);
  updateRoof();
});
const weatheringStrength = $<HTMLInputElement>('weathering-strength');
const updateWeathering = () => {
  layer.setWeathering({ enabled: $<HTMLInputElement>('weathering').checked, strength: Number(weatheringStrength.value) });
  $('weathering-label').textContent = Number(weatheringStrength.value).toFixed(1);
};
$('weathering').addEventListener('change', updateWeathering);
weatheringStrength.addEventListener('input', updateWeathering);

const surfaceMaterials = $<HTMLInputElement>('surface-materials');
const glassDistortion = $<HTMLInputElement>('glass-distortion');
const updateSurfaceDetail = () => {
  layer.setSurfaceDetail({
    enabled: $<HTMLInputElement>('surface-detail').checked,
    materials: Number(surfaceMaterials.value),
    glassDistortion: Number(glassDistortion.value),
  });
  $('surface-materials-label').textContent = Number(surfaceMaterials.value).toFixed(1);
  $('glass-distortion-label').textContent = Number(glassDistortion.value).toFixed(1);
};
$('surface-detail').addEventListener('change', updateSurfaceDetail);
surfaceMaterials.addEventListener('input', updateSurfaceDetail);
glassDistortion.addEventListener('input', updateSurfaceDetail);
const reflectionInput = $<HTMLInputElement>('reflection');
reflectionInput.addEventListener('input', () => {
  layer.setReflection(Number(reflectionInput.value));
  $('reflection-label').textContent = Number(reflectionInput.value).toFixed(1);
});
// 地形・霞・雲
const exaggeration = $<HTMLInputElement>('terrain-exaggeration');
const updateTerrain = () => {
  map.setTerrain(checked('terrain') ? { source: 'gsi-dem', exaggeration: Number(exaggeration.value) } : null);
  $('terrain-exaggeration-label').textContent = `${Number(exaggeration.value).toFixed(1)} 倍`;
};
$('terrain').addEventListener('change', updateTerrain);
exaggeration.addEventListener('input', updateTerrain);
const hazeAmount = $<HTMLInputElement>('haze-amount');
const updateHaze = () => {
  $('haze-amount-label').textContent = Number(hazeAmount.value).toFixed(2);
  applyTimeOfDay(Number(hourInput.value));
};
$('haze').addEventListener('change', updateHaze);
hazeAmount.addEventListener('input', updateHaze);
const cloudCoverage = $<HTMLInputElement>('cloud-coverage');
const updateClouds = () => {
  clouds.setOptions({ enabled: checked('clouds'), coverage: Number(cloudCoverage.value), animate: checked('cloud-animate') });
  $('cloud-coverage-label').textContent = Number(cloudCoverage.value).toFixed(2);
};
for (const id of ['clouds', 'cloud-animate']) $(id).addEventListener('change', updateClouds);
cloudCoverage.addEventListener('input', updateClouds);
$<HTMLSelectElement>('debug').addEventListener('change', (e) => {
  layer.setDebugMode((e.target as HTMLSelectElement).value as DebugMode);
  if (layer.stats) renderStats(layer.stats);
});
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    // 「全体」は 3D Tiles なら 23 区、GeoJSON なら千代田区
    const view = b.dataset.view === 'overview' && sourceKind === '3dtiles' ? TOKYO_OVERVIEW : VIEWS[b.dataset.view!];
    map.flyTo({ ...view, duration: 2500, essential: true });
  }),
);

// ---------------------------------------------------------------- 統計・凡例

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

function renderStats(stats: BuildingStats): void {
  const mode = $<HTMLSelectElement>('debug').value as DebugMode;
  let title: string;
  let rows: (readonly [RGB, string, string])[];
  if (mode === 'facade') {
    const f = stats.facades;
    title = '壁面の分類（地上部の延長）';
    rows = [
      [layer.debugColor('facade', 'sunSide'), '正面（日当たり面）', km(f.sunSide)],
      [layer.debugColor('facade', 'front'), '正面（その他）', km(f.front - f.sunSide)],
      [layer.debugColor('facade', 'side'), '側壁（狭い隙間に面する）', km(f.side)],
      [layer.debugColor('facade', 'party'), '界壁（隣と接する）', km(f.party)],
    ];
  } else if (mode === 'style') {
    title = `ファサードスタイル — ${stats.total.toLocaleString()} 棟`;
    rows = Object.entries(stats.byStyle)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => [layer.debugColor('style', name), name, n.toLocaleString()] as const);
  } else {
    title = `用途（共通カテゴリ） — ${stats.total.toLocaleString()} 棟`;
    rows = BUILDING_CATEGORIES.filter((c) => stats.byCategory[c])
      .sort((a, b) => stats.byCategory[b] - stats.byCategory[a])
      .map((c) => [CATEGORY_COLORS[c], CATEGORY_LABELS[c], stats.byCategory[c].toLocaleString()] as const);
  }
  $('stats').innerHTML = `
    <h2>${title}</h2>
    <table>${rows
      .map(([c, label, n]) => `<tr><td><span class="chip" style="background:${hex(c)}"></span>${label}</td><td class="num">${n}</td></tr>`)
      .join('')}</table>
    <p class="muted">推定値: 高さ ${stats.estimated.height} / 階数 ${stats.estimated.storeys} / 用途 ${stats.estimated.category} 棟</p>
    ${sourceKind === '3dtiles' ? `<p class="muted">タイル: 表示 ${layer.tileStatus.rendered} / 読み込み中 ${layer.tileStatus.loading} / 保持 ${layer.tileStatus.cached}</p>` : ''}`;
}
