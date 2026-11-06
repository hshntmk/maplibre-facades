# maplibre-facades

建物のフットプリントと属性から窓・室内・夜景・屋上・1 階の店先を手続き的に描く、MapLibre GL JS のカスタムレイヤーです。PLATEAU の 3D Tiles（LOD1）を直接読み込めます。

PLATEAU の建物は、用途・階数・耐火構造を持っています（千代田区では用途が 86%、階数が 85% の建物で埋まっています）。一方、LOD1 の形は押し出した箱だけなので、そのまま地図に載せると窓も屋根もない箱が並びます。このライブラリは、属性と形状、隣の建物との距離から窓の種類と配置を決め、室内・点灯・反射までシェーダで描きます。Mapbox の Standard スタイルにも窓のある建物はありますが、Mapbox のデータでしか使えません。PLATEAU SDK Toolkits for Unity は窓のテクスチャを貼る方式で、Web 地図では使えません。

デモ: https://hshntmk.github.io/maplibre-facades/ （東京 23 区の PLATEAU の 3D Tiles を直接読みます）

試作（0.x）の段階で、API は変わることがあります。動作は maplibre-gl 6.12 で確かめています。

## インストール

npm にはまだ公開していないので、リポジトリからビルドします。

```bash
git clone https://github.com/hshntmk/maplibre-facades.git
cd maplibre-facades
npm install
npm run build          # dist/ に本体・Worker・型定義を出力
```

利用側のプロジェクトでは、ローカルのパスを指定してインストールします。

```bash
npm install ../maplibre-facades maplibre-gl
```

`maplibre-gl`（5.x / 6.x）は peerDependency です。WebGL2 が必要です。

## 使い方

```ts
import { Map } from 'maplibre-gl';
import { BuildingFacadeLayer } from 'maplibre-facades';

const map = new Map({ container: 'map', style: '...', center: [139.7652, 35.6812], zoom: 16, pitch: 60 });

const layer = new BuildingFacadeLayer({
  id: 'facades',
  // PLATEAU の 3D Tiles（LOD1）の tileset.json。表示範囲のタイルだけ読む。複数の区は配列で渡す
  source: { type: '3dtiles', url: 'https://assets.cms.plateau.reearth.io/.../13101_chiyoda-ku_lod1/tileset.json' },
  timeOfDay: 20,
});

layer.on('load', ({ stats }) => console.log(`${stats.total} buildings`));
layer.on('error', ({ error }) => console.error(error.code, error.message));

map.on('load', () => map.addLayer(layer));
```

設定の誤りは、コンストラクタと `set*` メソッドが `BuildingFacadeLayerError`（`code: 'options'`）を投げます。読み込み後のエラーは `error` イベントで届き、リスナーがなければ `console.error` に出ます。

時刻や効果は、作ったあとでも変えられます。変えてもデータは読み直しません。

```ts
layer.setTimeOfDay(6.5);
layer.setRoof({ equipment: { density: 0.3 } }); // 指定した項目だけ変わる
layer.setWeathering(false);
```

すべてのオプション・メソッド・イベント・スタイルの項目は [リファレンスマニュアル](docs/reference.md) にあります。

## 設定

主なオプションです。

| オプション | 既定値 | 内容 |
|---|---|---|
| `source` | （必須） | `{ type: '3dtiles', url }` または `{ type: 'geojson', url }` |
| `adapter` | `{ name: 'plateau' }` | 属性を共通モデルに変換する方法。PLATEAU 以外は `{ name: 'declarative', spec }` で JSON のまま書く |
| `styles` / `styleRules` | `PRESET_STYLES` / `DEFAULT_STYLE_RULES` | 建物の見た目（最大 16 種類）と、どの建物にどれを使うか（MapLibre の式） |
| `timeOfDay` | `20` | 時刻（0–24）。太陽・空の色・点灯率が変わる |
| `effects` | `true` | `false` で窓などを描かず、単色の箱にする |
| `interior` | `true` | 窓の奥の部屋（インテリアマッピング） |
| `reflection` | `1` | ガラスの反射の強さ（0–3） |
| `roof` | すべて ON | パラペット・屋上の仕上げ・屋上設備・航空障害灯 |
| `weathering` | ON | 外壁の雨だれ・くすみ・しみ |
| `surfaceDetail` | ON | 外壁の素材（タイル・コンクリート・石・金属）の凹凸とつや、ガラスの歪み |
| `balconies` | `true` | 共同住宅のバルコニーを立体で描く |
| `solidFixtures` | `false` | 1 階の庇・テント・突き出し看板を立体で描く |
| `terrain` / `fog` | `true` / `true` | MapLibre の地形に建物を載せる / sky の霞を建物にもかける |
| `workers` | CPU のコア数の半分（1〜4） | 3D Tiles の処理に使う Worker の数 |

3D Tiles のソースには次のオプションがあります。

| オプション | 既定値 | 内容 |
|---|---|---|
| `maximumScreenSpaceError` | `16` | 詳細なタイルに切り替える画面上の誤差（px）。広い範囲を見渡すなら 32〜64 にすると読み込み量が減る |
| `maxCachedTiles` | `48` | 表示していないタイルを保持しておく数 |
| `cache` | `{ maxSizeMB: 200, maxAgeDays: 2 }` | 展開したタイルをブラウザ（IndexedDB）に保存し、次からはダウンロードを省く。`false` で保存しない |
| `dracoWasmUrl` | jsDelivr の `draco3d@1.5.7/draco_decoder.wasm` | Draco の展開に使う wasm。外部の CDN を使えない環境では自分で置いて指定する |

建物の種類ごとの見た目（窓の間隔、外壁の色の候補、1 階の構成、勾配屋根の割合など）は、スタイルを上書きして変えます。

```ts
import { BuildingFacadeLayer, PRESET_STYLES, DEFAULT_STYLE_RULES } from 'maplibre-facades';

new BuildingFacadeLayer({
  id: 'facades',
  source,
  styles: {
    ...PRESET_STYLES,
    office: { ...PRESET_STYLES.office, wallMaterials: { stone: 0.5, metal: 0.3 }, warmRatio: 0.3 },
  },
  styleRules: [{ when: ['>=', ['get', 'height'], 100], style: 'curtainWall' }, ...DEFAULT_STYLE_RULES],
});
```

### Worker と CSP

Worker は既定でバンドルに埋め込まれていて（Blob URL）、バンドラの設定は要りません。CSP で `blob:` の Worker が許可されていない場合は、同梱の `maplibre-facades/worker` を置いて URL を指定します。

```ts
import { setWorkerUrl } from 'maplibre-facades';
import workerUrl from 'maplibre-facades/worker?url'; // Vite の場合

setWorkerUrl(workerUrl); // レイヤーごとに指定するなら options.workerUrl
```

maplibre-gl v6 を Vite で本番ビルドすると、MapLibre 自身の Worker が出力されず、地図が起動しないことがあります。これは本ライブラリとは別の問題で、MapLibre の Worker の URL を次のように指定すると直ります。

```ts
import { setWorkerUrl } from 'maplibre-gl';
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
setWorkerUrl(mapLibreWorkerUrl);
```

## 制限事項

- 扱えるのは LOD1 の押し出した形だけで、セットバックは描きません。戸建ての勾配屋根は、外形が長方形に近い家に推定で架けたものです。
- 窓の位置、店の種類、入口の位置、屋根の形と材料はすべて推定で、実際の建物とは一致しません。看板の文字は模様で、読めません。
- 建物は影を落としません（バルコニーの中だけは影を付けます）。
- 地形の標高は建物ごとに 1 つで、斜面に沿って傾きません。
- 動作を確かめたのはメルカトル投影だけです。
- 3D Tiles の外部スキーマ（`schemaUri`）と、暗黙的タイリングの S2 の範囲は読めません。
- M1 の GPU（画面 1600 × 1000）で、丸の内を見下ろす視点が 1 フレーム約 20〜40 ms、通りを低く見通す視点が約 70 ms です。

## PLATEAU のデータを GeoJSON にする

3D Tiles を直接読む場合は不要です。オフラインで使う場合や、全体を一度に読みたい場合は、PLATEAU の建築物モデル（LOD1 の 3D Tiles）から、フットプリントと属性を持つ GeoJSON を作れます。

```bash
npm run prepare-data -- 13101_bldg_lod1 --out ./public/data
```

データセット ID は PLATEAU データカタログ API の `id` です（`13101_bldg_lod1` は千代田区）。取得した元データは `data/raw/` に保存されます。

## 開発

```bash
npm install
npm run dev            # デモ（examples/chiyoda）を http://localhost:5180 で起動
npm test
npm run typecheck
npm run build          # dist/index.js, dist/worker.js, dist/types/
npm run demo:build     # デモを examples/chiyoda/dist に出力
```

処理は、取得（Source）→ 属性の変換（Adapter）→ 欠損の補完（Enricher）→ 見た目の選択（StyleResolver）→ メッシュの生成の順で Worker の中で進み、メインスレッドはタイルの選択と WebGL2 での描画だけをします。窓・室内・点灯は、壁 1 辺を 1 枚の四角形にして、フラグメントシェーダで描いています。

| パス | 内容 |
|---|---|
| `src/layer/` | `BuildingFacadeLayer`、イベント、設定の検証 |
| `src/sources/` | GeoJSON と 3D Tiles（タイルの選択、b3dm / glb の解析、フットプリントの復元） |
| `src/adapters/` | PLATEAU と宣言的アダプタ |
| `src/style/` | スタイルの定義、プリセット、選択ルール |
| `src/mesh/` | 壁面の解析、壁・屋根・バルコニー・1 階の部材・勾配屋根のメッシュ |
| `src/render/` | シェーダ |
| `src/worker/` | Worker 本体、パイプライン、タイルの保存（IndexedDB） |
| `examples/chiyoda/` | デモ |

main に push すると、GitHub Actions（`.github/workflows/pages.yml`）が型チェック・テスト・ビルドをしてデモを GitHub Pages に公開します。GeoJSON 版のデータはリポジトリに入れていないので、公開版のデモで選べるのは 3D Tiles だけです。

## ライセンス

[MIT](LICENSE)

## 出典

- 建物データ: 国土交通省 Project PLATEAU（3D 都市モデル 建築物モデル 東京23区 2025）、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)
- 背景地図: [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)（全国最新写真）
