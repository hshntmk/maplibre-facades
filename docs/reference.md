# maplibre-facades リファレンス

対象バージョン: 0.1.0

## 構成

- 1\. 概要
  - 1.1 動作環境
  - 1.2 公開 API
  - 1.3 処理の流れ
- 2\. `BuildingFacadeLayer`
  - 2.1 コンストラクタ
  - 2.2 `BuildingFacadeLayerOptions`
  - 2.3 プロパティ
  - 2.4 メソッド
  - 2.5 イベント
  - 2.6 地図への追加と削除
- 3\. データソース
  - 3.1 `SourceConfig`
  - 3.2 `Tiles3DSourceConfig`
  - 3.3 `GeoJsonSourceConfig`
- 4\. アダプタ
  - 4.1 `AdapterConfig`
  - 4.2 PLATEAU アダプタ
  - 4.3 宣言的アダプタ
- 5\. 共通モデル
  - 5.1 `BuildingRecord`
  - 5.2 欠損値の補完
- 6\. ファサードスタイル
  - 6.1 `FacadeStyle`
  - 6.2 `PRESET_STYLES`
- 7\. スタイル選択ルール
  - 7.1 `StyleRule`
  - 7.2 式で参照する属性
  - 7.3 `DEFAULT_STYLE_RULES`
- 8\. 描画オプション
  - 8.1 `RoofOptions`
  - 8.2 `WeatheringOptions`
  - 8.3 `SurfaceDetailOptions`
  - 8.4 `DebugMode`
- 9\. 時刻と照明
  - 9.1 `computeLighting()`
  - 9.2 `LightingState`
- 10\. 統計
  - 10.1 `BuildingStats`
  - 10.2 `TileTiming`
  - 10.3 `TileStatus`
- 11\. エラー
  - 11.1 `BuildingFacadeLayerError`
  - 11.2 エラーコード
- 12\. Worker
  - 12.1 `setWorkerUrl()`
  - 12.2 `getWorkerUrl()`
- 13\. 定数
- 14\. 制限事項

---

## 1. 概要

`maplibre-facades` は MapLibre GL JS のカスタムレイヤーを提供する。レイヤーは建物の外形と属性から、建物の外観（窓・室内・夜間照明・ガラスの反射・屋上・外壁の汚れと素材）をシェーダで描く。窓のジオメトリは生成しない。

### 1.1 動作環境

| 項目 | 値 |
|---|---|
| peerDependency | `maplibre-gl` `^5.0.0 \|\| ^6.0.0` |
| WebGL | WebGL2 |
| モジュール形式 | ES Modules |
| Node.js（ビルド時） | 20 以上 |

### 1.2 公開 API

公開 API は `maplibre-facades` から export される名前に限る。ほかのモジュールは内部実装であり、予告なく変更される。

サブパス `maplibre-facades/worker` は Worker のスクリプト（`dist/worker.js`）を指す。[12. Worker](#12-worker) を参照。

### 1.3 処理の流れ

1. メインスレッドがデータソースの URL を Worker に送る。
2. Worker がデータを取得し、建物ごとに次を行う。
   1. アダプタが属性を `BuildingRecord` に変換する。
   2. 欠損値を補完する（[5.2](#52-欠損値の補完)）。
   3. スタイル選択ルールがスタイルを決める。
   4. 壁面を分類し、メッシュを生成する。
3. Worker がメッシュをメインスレッドに転送する。
4. メインスレッドがメッシュを GPU に送り、描画する。

時刻・反射・屋上などの描画オプションはシェーダの入力である。描画オプションを変更しても、データは再取得されない。

---

## 2. `BuildingFacadeLayer`

```ts
class BuildingFacadeLayer implements CustomLayerInterface
```

MapLibre の `CustomLayerInterface` を実装するクラス。`type` は `'custom'`、`renderingMode` は `'3d'` である。

### 2.1 コンストラクタ

```ts
new BuildingFacadeLayer(options: BuildingFacadeLayerOptions)
```

コンストラクタは `options` を同期的に検証する。値が不正な場合、`BuildingFacadeLayerError`（`code: 'options'`）を送出する。

コンストラクタが検証する項目:

- `id` が空でない文字列であること。
- `source.type` が `'3dtiles'` または `'geojson'` であること。
- `source.url` が空でない文字列であること。`'3dtiles'` では文字列の配列も受け付ける。
- `styles` が 1 個以上 16 個以下のスタイルを持ち、各スタイルが [6.1](#61-facadestyle) の範囲内にあること。
- `styleRules` が空でない配列であり、各ルールの `style` が `styles` に存在し、`when` が配列または `true` であること。
- `timeOfDay` が有限の数であること。
- `reflection` が 0 以上 3 以下であること。
- `effects` が真偽値であること。
- `interior` が真偽値であること。
- `debug` が `DebugMode` の値であること。
- `roof`・`weathering`・`surfaceDetail` が [8](#8-描画オプション) の範囲内にあること。

`adapter` と `styleRules[].when` の式の内容は、コンストラクタでは検証されない。これらは Worker で評価される。

### 2.2 `BuildingFacadeLayerOptions`

| 名前 | 型 | 既定値 | 説明 |
|---|---|---|---|
| `id` | `string` | 必須 | MapLibre のレイヤー ID。 |
| `source` | `SourceConfig` | 必須 | 建物データ。[3](#3-データソース) を参照。 |
| `adapter` | `AdapterConfig` | `{ name: 'plateau' }` | 属性の変換方法。[4](#4-アダプタ) を参照。 |
| `styles` | `Record<string, FacadeStyle>` | `PRESET_STYLES` | スタイルの定義。最大 16 個。指定した場合、`PRESET_STYLES` とは統合されない。 |
| `styleRules` | `StyleRule[]` | `DEFAULT_STYLE_RULES` | スタイル選択ルール。[7](#7-スタイル選択ルール) を参照。 |
| `timeOfDay` | `number` | `20` | 時刻（時）。24 を法とする剰余に正規化される。 |
| `effects` | `boolean` | `true` | `false` の場合、窓・室内・反射・屋上・汚れ・表面の細部を描かない。建物は時刻に依存しない固定の陰影で単色の箱として描かれる。 |
| `interior` | `boolean` | `true` | `false` の場合、窓の内側を照明色の平面として描く。 |
| `reflection` | `number` | `1` | ガラス反射率に掛ける係数。範囲は 0–3。 |
| `roof` | `RoofOptions` | `DEFAULT_ROOF_OPTIONS` | 屋上の描画。[8.1](#81-roofoptions) を参照。 |
| `weathering` | `boolean \| WeatheringOptions` | `DEFAULT_WEATHERING_OPTIONS` | 外壁の汚れ。[8.2](#82-weatheringoptions) を参照。 |
| `surfaceDetail` | `boolean \| SurfaceDetailOptions` | `DEFAULT_SURFACE_DETAIL_OPTIONS` | 外壁の素材とガラスの歪み。[8.3](#83-surfacedetailoptions) を参照。 |
| `debug` | `DebugMode` | `'none'` | 色分け表示。[8.4](#84-debugmode) を参照。 |
| `workerUrl` | `string \| URL` | `undefined` | Worker のスクリプトの URL。[12](#12-worker) を参照。 |

### 2.3 プロパティ

すべて読み取り専用である。

| 名前 | 型 | 説明 |
|---|---|---|
| `id` | `string` | レイヤー ID。 |
| `type` | `'custom'` | MapLibre のレイヤー種別。 |
| `renderingMode` | `'3d'` | MapLibre の描画モード。 |
| `loaded` | `boolean` | 最初の `load` イベントを発行済みであれば `true`。 |
| `stats` | `BuildingStats \| null` | 描画中の建物の統計。3D Tiles では描画中のタイルの合計。描画中のタイルがない場合は `null`。 |
| `tileStatus` | `TileStatus` | タイルの件数。 |
| `styleNames` | `readonly string[]` | `styles` のキーの配列。順序は `Object.keys(styles)` に従う。 |
| `timeOfDay` | `number` | 正規化後の時刻。範囲は `[0, 24)`。 |
| `effects` | `boolean` | 効果の有無。 |
| `reflection` | `number` | 反射の係数。 |
| `roof` | `Readonly<ResolvedRoofOptions>` | 既定値を補完した屋上の設定。 |
| `weathering` | `Readonly<ResolvedWeatheringOptions>` | 既定値を補完した汚れの設定。 |
| `surfaceDetail` | `Readonly<ResolvedSurfaceDetailOptions>` | 既定値を補完した表面の細部の設定。 |
| `lightingState` | `Readonly<LightingState>` | 現在の時刻から計算した照明。[9.2](#92-lightingstate) を参照。 |

### 2.4 メソッド

`set` で始まるメソッドは `this` を返す。各メソッドは値を更新したあと、`map.triggerRepaint()` を呼ぶ。検証に失敗したメソッドは `BuildingFacadeLayerError`（`code: 'options'`）を送出し、現在の設定を変更しない。

#### `setTimeOfDay(hour: number): this`

時刻を設定する。`hour` は 24 を法とする剰余に正規化される。`hour` が有限の数でない場合、例外を送出する。

```ts
layer.setTimeOfDay(18.5);
```

#### `setEffects(enabled: boolean): this`

効果の有無を設定する。`enabled` が真偽値でない場合、例外を送出する。

#### `setInterior(enabled: boolean): this`

室内の描画の有無を設定する。`enabled` が真偽値でない場合、例外を送出する。

#### `setReflection(strength: number): this`

反射の係数を設定する。`strength` が 0–3 の範囲外の場合、例外を送出する。

#### `setRoof(options: RoofOptions): this`

屋上の設定を更新する。`options` に含まれる項目だけが現在の設定に上書きされる。

```ts
layer.setRoof({ equipment: { density: 0.3 }, aviationLights: false });
```

#### `setWeathering(options: boolean | WeatheringOptions): this`

汚れの設定を更新する。

- `true` / `false` は `enabled` だけを変更する。
- オブジェクトは、含まれる項目を現在の設定に上書きする。`enabled` を省略した場合、`enabled` は `true` になる。

```ts
layer.setWeathering({ strength: 1.5, stains: 0 });
layer.setWeathering(false);
```

#### `setSurfaceDetail(options: boolean | SurfaceDetailOptions): this`

表面の細部の設定を更新する。引数の扱いは `setWeathering()` と同じである。

#### `setDebugMode(mode: DebugMode): this`

色分け表示のモードを設定する。`mode` が `DebugMode` の値でない場合、例外を送出する。

#### `debugColor(mode: 'category' | 'style' | 'facade', key: string): RGB`

色分け表示の色を返す。

| `mode` | `key` | 参照先 |
|---|---|---|
| `'category'` | `BuildingCategory` の値 | `CATEGORY_COLORS` |
| `'style'` | スタイル名 | `styleNames` の順に割り当てた 16 色 |
| `'facade'` | `'party'` `'side'` `'front'` `'sunSide'` | `FACADE_COLORS` |

`key` が存在しない場合、`[0.5, 0.5, 0.5]` を返す。

#### `on(type, listener): this`

イベントリスナーを登録する。

#### `off(type, listener): this`

イベントリスナーを解除する。

#### `once(type, listener): this`

1 回だけ呼ばれるイベントリスナーを登録する。

#### `onAdd(map, gl)` / `onRemove(map, gl)` / `render(gl, options)`

`CustomLayerInterface` のメソッド。MapLibre が呼ぶ。利用者は呼ばない。

### 2.5 イベント

型は `BuildingFacadeLayerEvents` である。すべてのイベントオブジェクトは `target: BuildingFacadeLayer` を持つ。

| 名前 | 発行の条件 | イベントオブジェクト |
|---|---|---|
| `load` | 3D Tiles: 読み込むべきタイルとサブツリーがなくなり、描画中のタイルが 1 つ以上ある。GeoJSON: データ全体のメッシュが届いた。 | `{ target, stats: BuildingStats }` |
| `tileload` | タイル 1 つのメッシュが届いた。隣接タイルの到着による再生成を含む。GeoJSON ではデータ全体を 1 タイルとし、`tileId` は `'geojson'` である。 | `{ target, tileId: string, stats: BuildingStats, timing: TileTiming & { total: number } }` |
| `tileunload` | キャッシュから外れたタイルを破棄した。 | `{ target, tileId: string }` |
| `error` | 取得・変換・描画のいずれかが失敗した。 | `{ target, error: BuildingFacadeLayerError }` |

`timing.total` は、タイルの要求からメッシュの受信までの経過時間（ミリ秒）である。待ち時間を含む。

`error` のリスナーが 1 つも登録されていない場合、エラーは `console.error()` に出力される。

`load` はレイヤーを地図に追加するたびに 1 回発行される。

```ts
layer.on('tileload', ({ tileId, timing }) => console.log(tileId, timing.total));
layer.once('load', ({ stats }) => console.log(stats.total));
```

### 2.6 地図への追加と削除

```ts
map.on('load', () => map.addLayer(layer));
```

`map.addLayer()` は `onAdd()` を呼ぶ。`onAdd()` は次を行う。

1. シェーダをコンパイルする。失敗した場合、`error`（`code: 'webgl'`）を発行して終了する。
2. Worker を起動する。失敗した場合、`error`（`code: 'worker'`）を発行して終了する。
3. データソースの読み込みを開始する。

`map.removeLayer()` は `onRemove()` を呼ぶ。`onRemove()` は Worker を終了し、GPU 資源とタイルのキャッシュを破棄する。処理中の応答は破棄される。

1 つのインスタンスを同時に複数の地図に追加してはならない。

---

## 3. データソース

### 3.1 `SourceConfig`

```ts
type SourceConfig = Tiles3DSourceConfig | GeoJsonSourceConfig;
```

### 3.2 `Tiles3DSourceConfig`

```ts
interface Tiles3DSourceConfig {
  type: '3dtiles';
  url: string | string[];
  maximumScreenSpaceError?: number;
  maxCachedTiles?: number;
  dracoWasmUrl?: string;
}
```

| 名前 | 型 | 既定値 | 範囲 | 説明 |
|---|---|---|---|---|
| `url` | `string \| string[]` | 必須 | — | `tileset.json` の URL。配列の場合、すべてのタイルセットを 1 つのレイヤーで描く。相対 URL は `document.baseURI` を基準に解決される。 |
| `maximumScreenSpaceError` | `number` | `16` | 1–256 | 子タイルに分割する画面上の誤差（px）。 |
| `maxCachedTiles` | `number` | `48` | 0–10000 | 描画に使っていないタイルを保持する上限数。上限を超えた分は、最後に使われた時刻が古い順に破棄される。 |
| `dracoWasmUrl` | `string` | `DEFAULT_DRACO_WASM_URL` | — | `draco_decoder.wasm` の URL。相対 URL は `document.baseURI` を基準に解決される。 |

#### タイルの選択

- レイヤーは描画のたびにタイルを選択する。
- 視錐台の外にあるタイルは選択されない。
- 画面上の誤差が `maximumScreenSpaceError` を超えるタイルは、子タイルに分割される。
- 読み込み順は、浅いタイルが先、同じ深さではカメラに近いタイルが先である。
- 同時に読み込むタイルは最大 3 個である。
- 同時に読み込む暗黙的タイリングのサブツリーは最大 4 個である。
- `refine: REPLACE` の親タイルは、可視の子タイルがすべて読み込まれるまで描画される。
- 読み込みに失敗したタイルは、内容が空のタイルとして扱われる。

#### 隣接タイル

- Worker は壁面の分類に、読み込み済みの隣接タイルの建物を使う。隣接タイルの建物は描画されない。
- 新しいタイルが届くと、境界付近の分類が変わりうる読み込み済みタイルに再生成の印が付く。
- 印が付いたタイルは、描画中であり、読み込み中のタイルが 0 個のときに再生成される。同時に再生成するタイルは最大 1 個である。
- 再生成されたタイルについても `tileload` が発行される。このとき `timing.remesh` は `true` である。

#### 複数のタイルセット

`url` が配列の場合、取得に失敗したタイルセットごとに `error` が発行される。残りのタイルセットは描画される。すべて失敗した場合、`error` が発行される。

#### 読み込む形式

| 項目 | 値 |
|---|---|
| タイルの内容 | b3dm（3D Tiles 1.0）、glb（3D Tiles 1.1） |
| glb の建物 ID | `EXT_mesh_features` |
| glb の属性 | `EXT_structural_metadata` のプロパティテーブル（スキーマはファイル内に埋め込まれたものに限る） |
| メッシュ圧縮 | `KHR_draco_mesh_compression` |
| タイルの木 | 明示的な木、外部タイルセット、暗黙的タイリング（`QUADTREE`、`OCTREE`） |
| 暗黙的タイリングのサブツリー | バイナリ、JSON |
| 範囲（明示的な木） | `region`、`box`、`sphere` |
| 範囲（暗黙的タイリング） | `region`、`box` |
| 建物の形状 | LOD1。屋根面の三角形から外形と高さを復元する。 |

Draco の wasm は、Draco を使うタイルを最初に読むときに Worker が取得する。取得に失敗した場合、または応答が WebAssembly でない場合、そのタイルについて `error`（`code: 'source'`）が発行される。wasm は、次に Draco を使うタイルで再取得される。

### 3.3 `GeoJsonSourceConfig`

```ts
interface GeoJsonSourceConfig {
  type: 'geojson';
  url: string;
}
```

| 名前 | 型 | 説明 |
|---|---|---|
| `url` | `string` | GeoJSON の `FeatureCollection` の URL。相対 URL は `document.baseURI` を基準に解決される。配列は受け付けない。 |

- Worker はデータ全体を 1 回で取得し、1 つのメッシュを生成する。
- ジオメトリが `Polygon` または `MultiPolygon` の Feature だけが読まれる。ほかの Feature は無視される。
- Feature の `id` は `properties.id` としてアダプタに渡される。`properties.id` が存在する場合は `properties.id` が優先される。
- 外形の高さは使われない。高さはアダプタが属性から読む。

---

## 4. アダプタ

アダプタは、データソースの属性を `BuildingRecord` に変換する。アダプタは Worker 内で実行される。

### 4.1 `AdapterConfig`

```ts
type AdapterConfig =
  | { name: string; options?: Record<string, unknown> }
  | { name: 'declarative'; spec: DeclarativeAdapterSpec };
```

組み込みのアダプタ名は `'plateau'` だけである。`name` が未知の場合、Worker でエラー（`code: 'adapter'`）になる。

`AdapterConfig` は Worker に構造化複製で渡される。関数は含められない。

### 4.2 PLATEAU アダプタ

`{ name: 'plateau' }` で選択する。PLATEAU の建築物モデルの属性を読む。

属性の取得:

- 各項目について、候補キーを順に調べ、最初に見つかった値を使う。`undefined`、`null`、`''` は値なしとして扱う。
- 属性 `attributes` が JSON 文字列またはオブジェクトの場合、その中の CityGML 属性も候補になる。
- `9999`、`-9999`（数値と文字列）は欠損値として扱う。

| `BuildingRecord` | 候補キー（優先順） | 備考 |
|---|---|---|
| `id` | `gml_id`, `gml:id`, `id` | 値がない建物は描画されない。 |
| `height` | `bldg:measuredHeight`, `measuredHeight`, `計測高さ` | 値がない場合は `_zmax - _zmin`。 |
| `minHeight` | — | 常に `0`。 |
| `storeys` | `bldg:storeysAboveGround`, `storeysAboveGround`, `地上階数` | 0 以下の値は値なしとして扱う。 |
| `storeysBelow` | `bldg:storeysBelowGround`, `storeysBelowGround`, `地下階数` | |
| `category` | `bldg:usage_code`, `usage_code`, `bldg:usage`, `usage`, `用途` | 下の変換表を参照。 |
| `structure` | `uro:buildingStructureType` ほか | コード（`601`–`606`）と名称を読む。値がなく、東京都の「建物構造コード」が `木造` の場合は `'wood'`。 |
| `fireResistance` | `uro:fireproofStructureType` ほか、東京都の「建物構造コード」 | `準耐火`で始まる → `'quasi_fireproof'`、`耐火`で始まる → `'fireproof'`、`防火`を含む → `'fire_protected'`、`木造`・`その他` → `'other'`。 |
| `openSided` | `bldg:class`, `class` | 値が `無壁舎` を含む場合に `true`。 |
| `name` | `gml:name`, `name` | |
| `yearBuilt` | `bldg:yearOfConstruction` ほか | |
| `extras.usage` | `bldg:usage` ほか | 文字列。値がない場合は `''`。 |
| `extras.detailedUsage` | `uro:detailedUsage` ほか | 文字列。値がない場合は `''`。 |
| `extras.buildingClass` | `bldg:class` ほか | 文字列。値がない場合は `''`。 |

`provenance.heightEstimated` は、`bldg:measuredHeight` がない場合に `true` になる。`_zmax - _zmin` を使った場合も `true` である。

`bldg:usage` から `category` への変換:

| コード | 名称 | `category` |
|---|---|---|
| 401 | 業務施設 | `office` |
| 402 | 商業施設 | `commercial` |
| 403 | 宿泊施設 | `hotel` |
| 404 | 商業系複合施設 | `mixed_commercial` |
| 411 | 住宅 | `house` |
| 412 | 共同住宅 | `apartment` |
| 413 | 店舗等併用住宅 | `mixed_house` |
| 414 | 店舗等併用共同住宅 | `mixed_apartment` |
| 415 | 作業所併用住宅 | `mixed_house` |
| 421 | 官公庁施設 | `public` |
| 422 | 文教厚生施設 | `education_welfare` |
| 431 | 運輸倉庫施設 | `warehouse` |
| 441 | 工場 | `factory` |
| 451 | 農林漁業用施設 | `other` |
| 452 | 供給処理施設 | `utility` |
| 453 | 防衛施設 | `other` |
| 454 | その他 | `other` |
| 461 | 不明 | `unknown` |

`category` が未決定、`'unknown'`、`'other'` のいずれかの場合、`uro:detailedUsage` の値で置き換える:

| `uro:detailedUsage` | `category` |
|---|---|
| 事務所建築物 | `office` |
| 商業施設、遊興施設、興行施設 | `commercial` |
| 宿泊施設 | `hotel` |
| 集合住宅 | `apartment` |
| 独立住宅 | `house` |
| 住商併用建物、住居併用工場 | `mixed_house` |
| 教育施設、医療施設、厚生施設 | `education_welfare` |
| 文化施設、官公庁施設 | `public` |
| 運輸施設等、倉庫施設等 | `warehouse` |
| 専用工場 | `factory` |
| 供給施設、処理施設 | `utility` |

### 4.3 宣言的アダプタ

`{ name: 'declarative', spec }` で選択する。

```ts
interface DeclarativeAdapterSpec {
  name: string;
  id: string[];
  height?: string[];
  minHeight?: string[];
  storeys?: string[];
  category?: { keys: string[]; map: Record<string, BuildingCategory>; default?: BuildingCategory };
  structure?: { keys: string[]; map: Record<string, StructureType> };
  missingValues?: (number | string)[];
  extras?: string[];
}
```

| 名前 | 説明 |
|---|---|
| `name` | アダプタ名。エラーメッセージに使われる。 |
| `id` | ID の候補キー。値がない建物は描画されない。 |
| `height` | 高さ（m）の候補キー。値がない場合は `0` となり、[5.2](#52-欠損値の補完) で補完される。 |
| `minHeight` | 下端の高さ（m）の候補キー。値がない場合は `0`。 |
| `storeys` | 地上階数の候補キー。 |
| `category.keys` | 用途の候補キー。 |
| `category.map` | 属性値（文字列化したもの）から `BuildingCategory` への変換表。 |
| `category.default` | 変換表にない場合の値。省略時は `'unknown'`。 |
| `structure.keys` | 構造の候補キー。 |
| `structure.map` | 属性値（文字列化したもの）から `StructureType` への変換表。該当しない場合は `'unknown'`。 |
| `missingValues` | 欠損値として扱う値。`height`、`minHeight`、`storeys` に適用される。 |
| `extras` | `BuildingRecord.extras` に複製する属性名。値が文字列・数値・真偽値の属性だけが複製される。 |

- 候補キーは配列の順に調べられる。`undefined`、`null`、`''` は値なしとして扱う。
- `fireResistance` は常に `'unknown'`、`openSided` は常に `false` である。
- `provenance.categoryEstimated` は、`category` が `'unknown'` の場合に `true` になる。

```ts
new BuildingFacadeLayer({
  id: 'facades',
  source: { type: 'geojson', url: '/osm-buildings.geojson' },
  adapter: {
    name: 'declarative',
    spec: {
      name: 'osm',
      id: ['@id', 'id'],
      height: ['height'],
      storeys: ['building:levels'],
      category: {
        keys: ['building'],
        map: { office: 'office', retail: 'commercial', apartments: 'apartment', house: 'house', hotel: 'hotel' },
        default: 'unknown',
      },
      extras: ['name'],
    },
  },
});
```

---

## 5. 共通モデル

### 5.1 `BuildingRecord`

| 名前 | 型 | 説明 |
|---|---|---|
| `id` | `string` | データソース内で一意な ID。同じ ID の 2 件目以降は描画されない。建物ごとの乱数の種に使われる。 |
| `height` | `number` | 地面から屋上までの高さ（m）。 |
| `minHeight` | `number` | 地面から下端までの高さ（m）。 |
| `storeys` | `number \| undefined` | 地上階数。 |
| `storeysBelow` | `number \| undefined` | 地下階数。 |
| `floorHeight` | `number \| undefined` | 階高（m）。[5.2](#52-欠損値の補完) で設定される。 |
| `category` | `BuildingCategory` | 用途。値は `BUILDING_CATEGORIES` のいずれか。 |
| `structure` | `StructureType` | `'wood' \| 'rc' \| 'src' \| 'steel' \| 'light_steel' \| 'masonry' \| 'unknown'` |
| `fireResistance` | `FireResistance` | `'fireproof' \| 'quasi_fireproof' \| 'fire_protected' \| 'other' \| 'unknown'` |
| `openSided` | `boolean` | 壁のない建物。 |
| `name` | `string \| undefined` | 名称。 |
| `yearBuilt` | `number \| undefined` | 建築年。外壁の汚れの量に使われる。 |
| `floorArea` | `number \| undefined` | 延べ面積。 |
| `provenance` | `object` | `source`（データソースの URL）、`heightEstimated`、`storeysEstimated`、`categoryEstimated`。 |
| `extras` | `Record<string, string \| number \| boolean> \| undefined` | スタイル選択ルールから参照する追加の属性。 |

### 5.2 欠損値の補完

Worker はアダプタの出力に次の処理を順に適用する。

1. **高さ**: `height` が正の数でない場合、`height = (storeys ?? 2) × 標準階高 + 0.6` とする。`heightEstimated` を `true` にする。
2. **用途**: `category` が `'unknown'`、`openSided` が `false`、`height` が 30 以上の場合、`category = 'office'` とする。`categoryEstimated` を `true` にする。
3. **階数**: `storeys` がない場合、`storeys = max(1, round(有効高さ / 標準階高))` とする。`storeysEstimated` を `true` にする。
4. **階高**: `floorHeight = 有効高さ / storeys` とする。上限を超える場合は `有効高さ / ceil(有効高さ / 上限)`、2.5 m 未満の場合は `有効高さ / max(1, floor(有効高さ / 2.5))` とする。

有効高さは `max(height − p, 1)` である。`p` は `height × 0.03` を 0.4–2.5 に制限した値である。

| `category` | 標準階高（m） | 階高の上限（m） |
|---|---|---|
| `office` | 3.8 | 5.5 |
| `commercial` | 4.5 | 6.5 |
| `mixed_commercial` | 4.2 | 6.5 |
| `hotel` | 3.2 | 5.5 |
| `house` | 2.9 | 5.5 |
| `apartment` | 3.0 | 5.5 |
| `mixed_house` | 3.1 | 5.5 |
| `mixed_apartment` | 3.1 | 5.5 |
| `public` | 4.0 | 6 |
| `education_welfare` | 3.8 | 6 |
| `warehouse` | 6.0 | 12 |
| `factory` | 6.0 | 12 |
| `utility` | 5.0 | 10 |
| `unknown`, `other` | 3.2 | 5.5 |

---

## 6. ファサードスタイル

### 6.1 `FacadeStyle`

1 種類の建物の外観を定義する。比率は、窓 1 枚分の区画（`windowSpacing` × 階高）に対する値である。

範囲外の値はコンストラクタで `BuildingFacadeLayerError`（`code: 'options'`）になる。「任意」と記した項目以外は必須である。

```ts
type RGB = [number, number, number];             // 各成分 0–1
type PaletteColor = RGB | { color: RGB; weight: number };  // RGB の重みは 1
```

#### 窓

| 名前 | 型 | 範囲 | 説明 |
|---|---|---|---|
| `windowSpacing` | `number` | 0.5–50 | 窓の配置間隔（m）。壁の長さをこの値で割り、列数を決める。 |
| `windowWidth` | `number` | 0–1 | 窓幅 / 区画の幅。`0` の場合、窓を描かない。 |
| `windowHeight` | `number` | 0–1 | 窓の高さ / 階高。 |
| `sill` | `number` | 0–1 | 窓の下端の高さ / 階高。`sill + windowHeight` は 1 以下。 |
| `mullions` | `number` | 1–16 | 窓の縦方向の分割数。 |
| `curtainWall` | `boolean` | — | `true` の場合、全面ガラスとして描く。 |
| `groundFloor` | `GroundFloor` | `'same' \| 'storefront' \| 'lobby'` | 1 階の扱い。`'storefront'` と `'lobby'` は 1 階の階高を上げ、大判ガラスとして描く。 |
| `balcony` | `number` | 0–1 | 2 階以上のバルコニー手すりの強さ。 |
| `slabLine` | `number` | 0–1 | 床スラブの横帯の強さ。 |

#### 壁面の分類

Worker は各壁の前面のあき（向かいの建物までの水平距離）を求め、壁を次の 3 種類に分類する。

| 分類 | 条件 | 窓 |
|---|---|---|
| 界壁 | あき < `partyWallMax` | なし |
| 側壁 | `partyWallMax` ≤ あき < `sideWallMax` | `sideWindows` に従う |
| 正面 | `sideWallMax` ≤ あき | 通常の窓 |

| 名前 | 型 | 範囲 | 説明 |
|---|---|---|---|
| `partyWallMax` | `number` | 0–40 | 界壁とみなすあき（m）の上限。 |
| `sideWallMax` | `number` | 0–40 | 側壁とみなすあき（m）の上限。`partyWallMax` 以上。 |
| `sideWindows` | `SideWindows` | `'none' \| 'small' \| 'same'` | 側壁の窓。なし、小窓、正面と同じ。 |
| `openAboveRatio` | `number` | 0–1 | 前面の建物より上の部分の扱い。前面の建物の高さが自身の高さ × `openAboveRatio` 未満の場合、上の部分を正面とする。それ以外の場合、上の部分を 1 段階だけ開放する（界壁 → 側壁、側壁 → 正面）。 |
| `sunSideBalconies` | `boolean` | — | `true` の場合、バルコニーと大きな窓を日照面だけに描く。日照面は、正面のうち最も南向きの面である。ほかの面には小窓を描く。 |

#### 色

| 名前 | 型 | 範囲 | 説明 |
|---|---|---|---|
| `wallColor` | `RGB` | — | 外壁の色。`wallColors` がない場合に使われる。 |
| `wallColors` | `PaletteColor[]` | 1–6 個、任意 | 外壁の色の候補。建物ごとに重みに比例した確率で 1 色が選ばれる。 |
| `wallVariation` | `number` | 0–1 | 建物ごとの外壁色の明度・色相の揺らぎ。 |
| `frameColor` | `RGB` | — | 窓枠の色。 |
| `glassTint` | `RGB` | — | ガラスの色。`glassTints` がない場合に使われる。 |
| `glassTints` | `PaletteColor[]` | 1–4 個、任意 | ガラスの色の候補。選び方は `wallColors` と同じ。 |
| `roofColor` | `RGB` | — | 屋根の色。 |

`PaletteColor` の `weight` は正の数である。

#### ガラスと外壁

| 名前 | 型 | 範囲 | 説明 |
|---|---|---|---|
| `reflectivity` | `number` | 0–1 | 正面から見たガラスの反射率を決める。`0` は約 4%、`1` は約 50% に相当する。反射率は入射角が浅いほど大きくなる（フレネル項）。レイヤーの `reflection` が乗じられる。 |
| `weathering` | `number` | 0–1 | 外壁の汚れやすさ。 |
| `wallMaterials` | `Partial<Record<WallMaterialName, number>>` | 各 0–1、合計 1 以下、任意 | 素材ごとの適用率。建物ごとに抽選される。残りの建物は素材なしで描かれる。界壁には適用されない。 |

#### 室内と夜間照明

| 名前 | 型 | 範囲 | 説明 |
|---|---|---|---|
| `interior` | `InteriorPalette` | `'office' \| 'residential' \| 'shop' \| 'warehouse'` | 室内の配色・照明・家具の種類。 |
| `roomDepth` | `number` | 0.5–50 | 部屋の奥行き（m）。部屋ごとに ±25% の幅で変動する。 |
| `windowsPerRoom` | `number` | 1–50、任意、既定 1 | 1 部屋あたりの窓の数。階ごとに 0.6–1.5 倍の幅で変動する。同じ部屋の窓は、室内・点灯状態・照明色を共有する。 |
| `openPlanRatio` | `number` | 0–1、任意、既定 0 | 間仕切りのない階の割合。該当する階では階全体が同じ点灯状態になる。`groundFloor` が `'storefront'` または `'lobby'` の 1 階は常に間仕切りなしとして扱う。 |
| `curtainRatio` | `number` | 0–1 | カーテンのある窓の割合。 |
| `blindsRatio` | `number` | 0–1 | ブラインドのある窓の割合。 |
| `floorCoherence` | `number` | 0–1 | 点灯状態の相関。`0` は部屋ごとに独立、`1` は階全体で一致。 |
| `warmRatio` | `number` | 0–1 | 電球色の照明の割合。残りは昼白色。 |
| `litScale` | `number` | 0–10 | 用途ごとの点灯率（[9.2](#92-lightingstate) の `litRatio`）に乗じる係数。 |

#### 屋上

| 名前 | 型 | 範囲 | 説明 |
|---|---|---|---|
| `parapet` | `boolean` | — | パラペットの有無。 |
| `roofFinish` | `RoofFinish` | `'concrete' \| 'membrane' \| 'skylights'` | 屋上の仕上げ。コンクリート押さえ、防水シート、天窓列。 |
| `greenRoofRatio` | `number` | 0–1 | 屋上緑化のある建物の割合。屋上面積 300 m² 以上の建物だけが対象になる。 |
| `solarRatio` | `number` | 0–1 | 太陽光パネルのある建物の割合。 |
| `rooftopEquipment` | `number` | 0–2 | 屋上設備の数に乗じる係数。`0` の場合、設備を描かない。 |

レイヤー全体の屋上の設定は [8.1](#81-roofoptions) を参照。

### 6.2 `PRESET_STYLES`

```ts
const PRESET_STYLES: Record<string, FacadeStyle>;
```

11 個のスタイルを持つ。`generic` 以外は `generic` の値を基にし、一部の項目を上書きしている。

| 名前 | `windowSpacing` | `windowWidth` | `groundFloor` | `interior` | `reflectivity` | `windowsPerRoom` | `openPlanRatio` | `wallMaterials.tile` |
|---|---|---|---|---|---|---|---|---|
| `generic` | 3.2 | 0.5 | `same` | `office` | 0.25 | 2 | 0.1 | 0.3 |
| `plain` | 3.2 | 0 | `same` | `office` | 0.25 | 2 | 0.1 | — |
| `curtainWall` | 1.8 | 0.96 | `lobby` | `office` | 0.8 | 6 | 0.5 | — |
| `office` | 3.2 | 0.66 | `lobby` | `office` | 0.45 | 4 | 0.35 | 0.35 |
| `apartment` | 3.6 | 0.52 | `same` | `residential` | 0.12 | 1 | 0 | 0.6 |
| `house` | 3.0 | 0.38 | `same` | `residential` | 0.08 | 1 | 0 | — |
| `mixed` | 3.2 | 0.46 | `storefront` | `residential` | 0.25 | 1 | 0 | 0.5 |
| `commercial` | 4.5 | 0.8 | `storefront` | `shop` | 0.5 | 6 | 0.7 | 0.2 |
| `hotel` | 2.6 | 0.46 | `lobby` | `residential` | 0.25 | 1 | 0 | 0.4 |
| `institutional` | 3.4 | 0.72 | `lobby` | `office` | 0.25 | 3 | 0.1 | 0.3 |
| `industrial` | 6 | 0.26 | `same` | `warehouse` | 0.25 | 8 | 0.8 | — |

ほかの項目の値は `PRESET_STYLES` を直接参照する。

```ts
const styles = {
  ...PRESET_STYLES,
  office: { ...PRESET_STYLES.office, warmRatio: 0.3 },
};
```

---

## 7. スタイル選択ルール

### 7.1 `StyleRule`

```ts
interface StyleRule {
  when: ExpressionFilterSpecification | true;
  style: string;
}
```

| 名前 | 説明 |
|---|---|
| `when` | MapLibre のフィルター式、または `true`。`true` はすべての建物に一致する。 |
| `style` | `styles` のキー。 |

- Worker はルールを配列の順に評価し、最初に一致したルールの `style` を建物に割り当てる。
- どのルールにも一致しない建物は描画されない。この建物は `BuildingStats.skipped` に計上される。
- 式は `zoom = 0`、ジオメトリ種別 `Polygon` として評価される。
- 式の構文エラーは Worker で検出される。

### 7.2 式で参照する属性

式は `['get', name]` で次の属性を参照する。

| 名前 | 型 | 値 |
|---|---|---|
| `id` | `string` | `BuildingRecord.id` |
| `category` | `string` | `BuildingRecord.category` |
| `structure` | `string` | `BuildingRecord.structure` |
| `fireResistance` | `string` | `BuildingRecord.fireResistance` |
| `openSided` | `boolean` | `BuildingRecord.openSided` |
| `height` | `number` | `BuildingRecord.height` |
| `storeys` | `number \| null` | `BuildingRecord.storeys`（補完後） |
| `floorHeight` | `number \| null` | `BuildingRecord.floorHeight` |
| `yearBuilt` | `number \| null` | `BuildingRecord.yearBuilt` |
| `floorArea` | `number \| null` | `BuildingRecord.floorArea` |
| `source` | `string` | `BuildingRecord.provenance.source` |
| `extras` の各キー | `string \| number \| boolean` | `BuildingRecord.extras` |

`extras` のキーが上表の名前と重なる場合、上表の値が優先される。

```ts
styleRules: [
  { when: ['>=', ['get', 'height'], 100], style: 'curtainWall' },
  { when: ['==', ['get', 'detailedUsage'], '医療施設'], style: 'institutional' },
  ...DEFAULT_STYLE_RULES,
],
```

### 7.3 `DEFAULT_STYLE_RULES`

| 順 | 条件 | `style` |
|---|---|---|
| 1 | `openSided` が `true` | `plain` |
| 2 | `category` が `office`・`hotel`・`mixed_commercial` のいずれかで、`height` ≥ 60 | `curtainWall` |
| 3 | `category` が `office` | `office` |
| 4 | `category` が `apartment`・`mixed_apartment` のいずれか | `apartment` |
| 5 | `category` が `house` で、`storeys` ≤ 3 | `house` |
| 6 | `category` が `house` | `apartment` |
| 7 | `category` が `mixed_house` | `mixed` |
| 8 | `category` が `hotel` | `hotel` |
| 9 | `category` が `commercial`・`mixed_commercial` のいずれか | `commercial` |
| 10 | `category` が `public`・`education_welfare` のいずれか | `institutional` |
| 11 | `category` が `warehouse`・`factory`・`utility` のいずれか | `industrial` |
| 12 | `true` | `generic` |

---

## 8. 描画オプション

`RoofOptions`・`WeatheringOptions`・`SurfaceDetailOptions` の各項目は、次の規則で現在の設定に統合される。

- `true` / `false`: `enabled` だけを変更する。
- オブジェクト: 含まれる項目を上書きする。`enabled` を省略した場合、`enabled` は `true` になる。
- `undefined`: 変更しない。

統合後の値が範囲外の場合、`BuildingFacadeLayerError`（`code: 'options'`）が送出される。

### 8.1 `RoofOptions`

```ts
interface RoofOptions {
  parapet?: boolean | ParapetOptions;
  finish?: boolean | RoofFinishOptions;
  equipment?: boolean | RooftopEquipmentOptions;
  aviationLights?: boolean | AviationLightOptions;
}
```

| 名前 | 型 | 既定値 | 範囲 | 説明 |
|---|---|---|---|---|
| `parapet.enabled` | `boolean` | `true` | — | パラペットを描く。スタイルの `parapet` が `false` の建物には描かない。 |
| `parapet.height` | `number` | `0.9` | 0–3 | パラペットの高さ（m）。建物の高さの 8% を上限とする。 |
| `finish.enabled` | `boolean` | `true` | — | 屋上の仕上げ・屋上緑化・太陽光パネルを描く。 |
| `equipment.enabled` | `boolean` | `true` | — | 屋上設備を描く。 |
| `equipment.density` | `number` | `0.7` | 0–1 | 生成した設備のうち描画する割合。スタイルの `rooftopEquipment` が乗じられる。 |
| `aviationLights.enabled` | `boolean` | `true` | — | 航空障害灯を描く。 |
| `aviationLights.minHeight` | `number` | `60` | 0–1000 | 航空障害灯を描く建物の高さ（m）の下限。灯は屋上の角に置かれる。 |
| `aviationLights.blink` | `boolean` | `true` | — | 点滅させる。 |
| `aviationLights.intensity` | `number` | `1` | 0–5 | 明るさの係数。 |
| `aviationLights.color` | `RGB` | `[1, 0.1, 0.05]` | 各 0–1 | 灯の色。 |

航空障害灯は `lightingState.night` が 0.02 を超える場合だけ描かれる。

次の条件をすべて満たす間、レイヤーは毎フレーム `map.triggerRepaint()` を呼ぶ。

- `effects` が `true`
- `aviationLights.enabled` が `true`
- `aviationLights.blink` が `true`
- `lightingState.night` が 0.02 を超える

`ResolvedRoofOptions` は、すべての項目が必須である `RoofOptions` である。

### 8.2 `WeatheringOptions`

```ts
interface WeatheringOptions {
  enabled?: boolean;
  strength?: number;
  streaks?: number;
  grime?: number;
  stains?: number;
}
```

| 名前 | 型 | 既定値 | 範囲 | 説明 |
|---|---|---|---|---|
| `enabled` | `boolean` | `true` | — | 汚れを描く。 |
| `strength` | `number` | `1` | 0–2 | 全体の係数。 |
| `streaks` | `number` | `1` | 0–1 | 雨だれ。窓台の端・窓の下・屋上の縁から下に伸びる筋。 |
| `grime` | `number` | `1` | 0–1 | 地面付近の泥はねと、壁全体の濃淡。 |
| `stains` | `number` | `1` | 0–1 | 縦長で輪郭のぼやけた水跡。 |

汚れの量は `strength` × スタイルの `weathering` × 経年係数である。経年係数は、`yearBuilt` がある場合は経過年数から求め、50 年で最大になる。`yearBuilt` がない場合は建物ごとの乱数で決まる。

`ResolvedWeatheringOptions` は `Required<WeatheringOptions>` である。

### 8.3 `SurfaceDetailOptions`

```ts
interface SurfaceDetailOptions {
  enabled?: boolean;
  materials?: number;
  glassDistortion?: number;
}
```

| 名前 | 型 | 既定値 | 範囲 | 説明 |
|---|---|---|---|---|
| `enabled` | `boolean` | `true` | — | 表面の細部を描く。 |
| `materials` | `number` | `1` | 0–2 | 外壁の素材の凹凸・光沢・目地の係数。 |
| `glassDistortion` | `number` | `1` | 0–3 | ガラスの歪みの係数。ガラスごとの取り付け角（約 ±1.4°）と、複層ガラスの膨らみ・へこみを表す。 |

素材のテクスチャ:

- Worker がレイヤーの初期化時に手続き的に生成する。画像ファイルは取得しない。
- 1 素材あたり 256 × 256 テクセルの RGBA8 で、ミップマップを持つ。
- テクスチャが届くまで、外壁は素材なしで描かれる。
- 目地の幅が 1 ピクセル未満になる距離では、テクスチャを参照せず、素材の平均値を使う。

`WALL_MATERIALS` の値:

| 名前 | 内容 |
|---|---|
| `tile` | 二丁掛けタイル（227 × 60 mm）、破れ目地張り。 |

`ResolvedSurfaceDetailOptions` は `Required<SurfaceDetailOptions>` である。

### 8.4 `DebugMode`

```ts
type DebugMode = 'none' | 'category' | 'style' | 'facade';
```

| 値 | 表示 |
|---|---|
| `'none'` | 通常の描画。 |
| `'category'` | `category` ごとの色。色は `CATEGORY_COLORS`。 |
| `'style'` | スタイルごとの色。 |
| `'facade'` | 壁面の分類（界壁・側壁・正面・日照面）ごとの色と、配置された窓。色は `FACADE_COLORS`。 |

---

## 9. 時刻と照明

### 9.1 `computeLighting()`

```ts
function computeLighting(hour: number): LightingState
```

時刻 `hour` の照明を返す。`hour` は 24 を法とする剰余に正規化される。レイヤーの `lightingState` はこの関数の戻り値である。

太陽の位置は次の簡易モデルで求める。

- 6 時に東、12 時に南、18 時に西にある。
- 最大高度は 62° である。

### 9.2 `LightingState`

| 名前 | 型 | 説明 |
|---|---|---|
| `hour` | `number` | 正規化後の時刻。範囲は `[0, 24)`。 |
| `night` | `number` | 夜の度合い。`0` は昼、`1` は夜。 |
| `twilight` | `number` | 薄明の度合い。`0` は日中、`1` は日の出・日の入り。 |
| `sunDir` | `[number, number, number]` | 太陽の方向の単位ベクトル。座標系は東・北・上。 |
| `sunColor` | `RGB` | 太陽光の色。 |
| `skyZenith` | `RGB` | 天頂の空の色。 |
| `skyHorizon` | `RGB` | 地平線付近の空の色。 |
| `litRatio` | `Float32Array` | 用途ごとの点灯率。添字は `BUILDING_CATEGORIES` の順序。長さは 16。 |
| `shopOpen` | `number` | 店舗の 1 階の営業度合い。 |

`litRatio` は 1 時間ごとの値を線形補間して求める。用途は次の 6 種類の時間変化のいずれかを使う。

| 時間変化 | `category` |
|---|---|
| 業務 | `office` |
| 住宅 | `house`, `apartment`, `mixed_house`, `mixed_apartment` |
| 店舗 | `commercial`, `mixed_commercial` |
| 宿泊 | `hotel` |
| 公共 | `public`, `education_welfare`（`other` は公共 × 0.6） |
| 産業 | `warehouse`, `factory`, `utility` |

`unknown` は（住宅 + 業務）× 0.4 である。

```ts
const { night, skyHorizon } = layer.setTimeOfDay(19).lightingState;
map.setPaintProperty('background', 'background-color',
  `rgb(${skyHorizon.map((c) => Math.round(c * 255)).join(',')})`);
```

---

## 10. 統計

### 10.1 `BuildingStats`

| 名前 | 型 | 説明 |
|---|---|---|
| `total` | `number` | 描画する建物の数。 |
| `skipped` | `number` | 描画しない建物の数。アダプタが `null` を返した建物、ID が重複した建物、どのルールにも一致しない建物を含む。 |
| `byCategory` | `Record<string, number>` | `category` ごとの建物数。 |
| `byStyle` | `Record<string, number>` | スタイルごとの建物数。 |
| `estimated` | `{ height: number; storeys: number; category: number }` | 補完した建物の数。 |
| `facades` | `{ front: number; side: number; party: number; sunSide: number }` | 壁面の分類ごとの延長（m）。`sunSide` は日照面の延長であり、ほかの 3 項目と重複して計上される。 |
| `bounds` | `[number, number, number, number]` | `[west, south, east, north]`（経緯度）。 |

### 10.2 `TileTiming`

単位はミリ秒である。`bytes` を除く。

| 名前 | 型 | 説明 |
|---|---|---|
| `fetch` | `number` | 取得に要した時間。再生成と GeoJSON では `0`。 |
| `decode` | `number` | 解析・Draco の展開・外形の復元・`BuildingRecord` への変換に要した時間。GeoJSON では取得時間を含む。 |
| `mesh` | `number` | 壁面の分類とメッシュ生成に要した時間。 |
| `bytes` | `number` | 取得したバイト数。再生成と GeoJSON では `0`。 |
| `remesh` | `boolean` | 隣接タイルの到着による再生成であれば `true`。 |
| `neighbors` | `number` | 壁面の分類に使った隣接タイルの建物の数。 |

### 10.3 `TileStatus`

| 名前 | 型 | 説明 |
|---|---|---|
| `rendered` | `number` | 描画中のタイルの数。 |
| `loading` | `number` | 読み込み中のタイルの数。 |
| `cached` | `number` | 読み込み済みのタイルの数。描画中のタイルを含む。 |

---

## 11. エラー

### 11.1 `BuildingFacadeLayerError`

```ts
class BuildingFacadeLayerError extends Error {
  readonly name: 'BuildingFacadeLayerError';
  readonly code: BuildingFacadeLayerErrorCode;
  readonly cause?: unknown;
}
```

ライブラリが送出または通知するエラーは、すべてこのクラスのインスタンスである。`cause` には元の例外が入る場合がある。

### 11.2 エラーコード

```ts
type BuildingFacadeLayerErrorCode = 'options' | 'source' | 'adapter' | 'style' | 'worker' | 'webgl';
```

| `code` | 原因 | 通知方法 |
|---|---|---|
| `options` | 設定値が不正。 | コンストラクタまたは `set` メソッドが同期的に送出する。 |
| `source` | データの取得または解析の失敗。HTTP エラー、未知の形式、Draco の wasm の取得失敗を含む。 | `error` イベント |
| `adapter` | アダプタ名が未知、またはアダプタが例外を送出した。 | `error` イベント |
| `style` | スタイル選択ルールの式が不正。 | `error` イベント |
| `worker` | Worker の起動または通信の失敗。 | `error` イベント |
| `webgl` | シェーダのコンパイルなど WebGL の失敗。 | `error` イベント |

タイル単位のエラーでは、`message` の末尾にタイルの URL が付く。

`adapter`（アダプタ名が未知の場合）と `style` のエラーは、Worker の初期化時に検出される。この場合、`error` は 1 回だけ発行される。レイヤーは Worker を終了し、以降のデータを読み込まない。

Worker が停止した場合（上記の初期化時のエラー、または `worker` エラー）、レイヤーは次のように動作する。

- 読み込み中だったタイルは破棄される。`tileStatus.loading` は `0` になる。
- 新しいタイルの読み込み、隣接タイルによる再生成、暗黙的タイリングのサブツリーの読み込みは行われない。
- 読み込み済みのタイルは描画を続ける。
- `load` イベントは、まだ発行していない場合も発行されない。

```ts
try {
  layer.setReflection(5);
} catch (e) {
  if (e instanceof BuildingFacadeLayerError && e.code === 'options') console.warn(e.message);
}
```

---

## 12. Worker

データの取得からメッシュ生成までは Web Worker で実行される。

Worker のスクリプトは次の順で決まる。

1. `BuildingFacadeLayerOptions.workerUrl`
2. `setWorkerUrl()` で設定した URL
3. バンドルに埋め込まれたスクリプト（Blob URL）

1 と 2 の URL は `new Worker(url, { type: 'module' })` で読み込まれる。指定するスクリプトは `maplibre-facades/worker`（`dist/worker.js`）である。

Content Security Policy の `worker-src` が `blob:` を許可しない場合、3 の Worker は起動しない。この場合は 1 または 2 を指定する。

```ts
import { setWorkerUrl } from 'maplibre-facades';
import workerUrl from 'maplibre-facades/worker?url'; // Vite

setWorkerUrl(workerUrl);
```

データソースの URL と `Tiles3DSourceConfig.dracoWasmUrl` は、メインスレッドで `document.baseURI` を基準に絶対 URL に変換されてから Worker に渡される。

### 12.1 `setWorkerUrl()`

```ts
function setWorkerUrl(url: string | URL | undefined): void
```

すべてのレイヤーの既定の Worker URL を設定する。`undefined` は設定を解除する。設定は、この呼び出しのあとに地図へ追加されるレイヤーに適用される。

### 12.2 `getWorkerUrl()`

```ts
function getWorkerUrl(): string | URL | undefined
```

`setWorkerUrl()` で設定した値を返す。

---

## 13. 定数

| 名前 | 型 | 値 |
|---|---|---|
| `PRESET_STYLES` | `Record<string, FacadeStyle>` | [6.2](#62-preset_styles) を参照。 |
| `DEFAULT_STYLE_RULES` | `StyleRule[]` | [7.3](#73-default_style_rules) を参照。 |
| `DEFAULT_ROOF_OPTIONS` | `Readonly<ResolvedRoofOptions>` | [8.1](#81-roofoptions) の既定値。 |
| `DEFAULT_WEATHERING_OPTIONS` | `Readonly<ResolvedWeatheringOptions>` | [8.2](#82-weatheringoptions) の既定値。 |
| `DEFAULT_SURFACE_DETAIL_OPTIONS` | `Readonly<ResolvedSurfaceDetailOptions>` | [8.3](#83-surfacedetailoptions) の既定値。 |
| `DEFAULT_DRACO_WASM_URL` | `string` | `'https://cdn.jsdelivr.net/npm/draco3d@1.5.7/draco_decoder.wasm'` |
| `WALL_MATERIALS` | `readonly ['tile']` | 外壁の素材名。 |
| `BUILDING_CATEGORIES` | `readonly BuildingCategory[]` | `'unknown'`, `'office'`, `'commercial'`, `'hotel'`, `'mixed_commercial'`, `'house'`, `'apartment'`, `'mixed_house'`, `'mixed_apartment'`, `'public'`, `'education_welfare'`, `'warehouse'`, `'factory'`, `'utility'`, `'other'` |
| `CATEGORY_COLORS` | `Readonly<Record<BuildingCategory, RGB>>` | `'category'` 表示の色。 |
| `FACADE_COLORS` | `Readonly<Record<'party' \| 'side' \| 'front' \| 'sunSide', RGB>>` | `'facade'` 表示の色。 |

---

## 14. 制限事項

| 項目 | 内容 |
|---|---|
| 建物の形状 | LOD1 の押し出し形状だけを扱う。セットバックと勾配屋根は描かれない。 |
| 窓の位置 | 窓の位置は属性と形状から生成される。実際の建物の窓とは一致しない。 |
| 地形 | 建物は標高 0 m から描かれる。MapLibre の terrain は考慮されない。 |
| 投影 | 動作の確認はメルカトル投影だけで行われている。globe 投影は未確認である。 |
| 影 | 建物は影を落とさない。 |
| スタイルの数 | 1 レイヤーあたり最大 16 個。 |
| 3D Tiles | `EXT_structural_metadata` の外部スキーマ（`schemaUri`）は読めない。暗黙的タイリングの S2 範囲は読めない。 |
| GeoJSON | データ全体を 1 回で取得し、1 つのメッシュにする。 |
