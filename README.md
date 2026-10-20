# maplibre-facades

MapLibre GL JS のカスタムレイヤーで、建物の外観（ファサード）を手続き的に装飾するライブラリです。窓・室内・夜景・反射・屋上・外壁の質感を、建物の種類と形状から自動で描きます。

- 建物の種類（用途・階数・構造）と形状・周囲の状況（壁の長さ、曲面、隣の建物との距離と高さ、向き）から、窓の種類と配置を自動で生成する
- 窓の中はインテリアマッピングで奥行きを表現する（部屋・家具・カーテン・ブラインド）
- 時刻に応じた昼夜の表現と、用途ごとの点灯率による夜景
- ガラスの反射（見る角度・内外の明るさの差・向かいの建物の映り込み）。昼は外の景色が映って中が見えにくく、夜は室内が見える
- 屋上の表現（パラペット、用途別の仕上げ・緑化・太陽光、塔屋や室外機などの設備、夜の航空障害灯）
- 外壁の経年変化（窓や屋上の縁からの雨だれ、地面近くの泥はね、くすみ、しみ）
- 表面の細部（タイル張りの目地の凹凸とつや、ガラス 1 枚ごとの歪みによる映り込みのずれ）
- PLATEAU 建築物モデルに対応。3D Tiles（LOD1）を直接、表示範囲だけ読み込める（アダプタ経由で他のデータソースにも拡張可能）

> **状態:** 試作（0.x）。API は変わる可能性があります。動作確認は maplibre-gl 6.12 で行っています。

オプション・メソッド・スタイルの全項目は [リファレンスマニュアル](docs/reference.md) にまとめています。

**デモ:** https://hshntmk.github.io/maplibre-facades/ （PLATEAU の東京23区の建物を直接読み込みます。時刻・効果・屋上などを切り替えられます）

## インストール

npm にはまだ公開していません。リポジトリからビルドして使います。

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
  // PLATEAU の 3D Tiles（LOD1）の tileset.json を直接指定する。表示範囲のタイルだけ読み込む
  source: { type: '3dtiles', url: 'https://assets.cms.plateau.reearth.io/.../13101_chiyoda-ku_lod1/tileset.json' },
  // 複数の区: url: [chiyodaTilesetUrl, chuoTilesetUrl, ...]
  adapter: { name: 'plateau' }, // 既定
  timeOfDay: 20,
});

layer.on('load', ({ stats }) => console.log(`${stats.total} buildings`));
layer.on('error', ({ error }) => console.error(error.code, error.message));

map.on('load', () => map.addLayer(layer));
```

### データソース

| `source.type` | 内容 |
|---|---|
| `'3dtiles'` | 3D Tiles（1.0 の b3dm と 1.1 の glb、LOD1 の建物）。表示範囲と距離に応じてタイルを選んで読み込み、離れたタイルは捨てる。各建物のメッシュからフットプリントと高さを復元する。`url` に配列を渡すと、複数のタイルセット（区ごとに分かれた PLATEAU のデータなど）を 1 つのレイヤーで扱う |
| `'geojson'` | Polygon / MultiPolygon のフットプリントを持つ GeoJSON を一括で読み込む（`npm run prepare-data` で PLATEAU から作れる） |

3D Tiles のオプション:

| 項目 | 既定値 | 内容 |
|---|---|---|
| `maximumScreenSpaceError` | 16 | 詳細なタイルに切り替える画面上の誤差 (px)。小さいほど細かいタイルを早く読む。広い範囲を見渡す用途では大きめ（32〜64）にすると読み込み量が減る |
| `maxCachedTiles` | 48 | 表示していないタイルを保持しておく数 |
| `dracoWasmUrl` | jsDelivr の `draco3d@1.5.7/draco_decoder.wasm` | Draco 圧縮の展開に使う wasm。外部 CDN を使えない環境では自前で配置して指定する |

- 粗いタイルから先に読み、表示範囲全体を大まかに埋めてから詳細なタイルを読む（同じ深さなら近い順）
- 隣と接する壁（界壁）などの判定は、読み込み済みの隣接タイルの建物も使う。隣のタイルが後から届いたら、境界付近のタイルを作り直す。区の境界をまたぐ建物どうしも同様
- 3D Tiles 1.0 の b3dm と、1.1 の glb タイル（建物の番号は `EXT_mesh_features`、属性は `EXT_structural_metadata` のプロパティテーブル）に対応。
  2025 年度の PLATEAU（23 区では台東区）は glb で配信されている
- 3D Tiles 1.1 の暗黙的タイリング（`implicitTiling`、QUADTREE / OCTREE、region / box）に対応。サブツリーは表示に必要になったときに読む
  （遠くて分割しない所のサブツリーは読まない）。外部スキーマ（`schemaUri`）、S2 の範囲、LOD2 の形状にはまだ対応していない
- Draco で量子化された座標では、屋根の三角形が細すぎて向きが反転することがある。輪郭が閉じないときは細い三角形を捨ててやり直し、
  それでも駄目なら屋根の頂点の凸包で代用する（粗い階層のタイルでまれに起きる）
- 統計（`stats`）は今描いているタイルの合計。タイルが増減するたびに `tileload` / `tileunload` イベントが届く
- 隣のタイルが届いたことによる作り直しは、表示中のタイルだけを、新しいタイルの読み込みが落ち着いてから行う
- `tileload` の `timing` で、タイルごとの処理時間（ダウンロード・解析・メッシュ生成・待ち時間を含む合計、ms）とダウンロード量が分かる。表示が遅いときの切り分けに使える

```ts
layer.on('tileload', ({ tileId, timing }) => console.log(tileId, timing));
// 例: { fetch: 2200, decode: 180, mesh: 140, total: 2600, bytes: 13469544, remesh: false, neighbors: 290 }
```

### API

| | |
|---|---|
| `setTimeOfDay(hour)` | 時刻（0–24）。昼夜・太陽・点灯率が変わる |
| `setEffects(enabled)` | 窓・室内・反射・屋上などの効果の ON/OFF（既定 ON）。OFF では単色の箱として、時刻に関係ない固定の陰影で描く（比較や軽量表示に）。オプション `effects` でも指定できる |
| `setInterior(enabled)` | インテリアマッピングの有効・無効 |
| `setRoof(options)` | 屋上の表現の ON/OFF とパラメータ（下記）。指定した項目だけが今の設定に重なる |
| `setWeathering(options)` | 外壁の経年変化の ON/OFF とパラメータ（下記）。指定した項目だけが今の設定に重なる |
| `setSurfaceDetail(options)` | 表面の細部（外壁の素材・ガラスの歪み）の ON/OFF とパラメータ（下記）。指定した項目だけが今の設定に重なる |
| `setReflection(strength)` | ガラスの反射の強さ（0–3、既定 1）。各スタイルの `reflectivity` に掛ける倍率。0 で反射なし。オプション `reflection` でも指定できる |
| `setDebugMode('none' \| 'category' \| 'style' \| 'facade')` | 用途・スタイル・壁面の分類で色分け表示（`facade` は配置された窓も表示） |
| `loaded` / `stats` / `tileStatus` / `effects` / `timeOfDay` / `reflection` / `roof` / `weathering` / `surfaceDetail` / `lightingState` | 状態の取得。`lightingState` は背景地図や空の色を合わせるのに使える |
| `on / off / once` | イベント: `load`（最初の表示範囲の読み込み完了）, `tileload`, `tileunload`, `error` |

設定エラーはコンストラクタで同期的に `BuildingFacadeLayerError`（`code: 'options'`）として投げられます。
読み込み後に起きるエラーは `error` イベントで通知され、`code` は `source` / `adapter` / `style` / `worker` / `webgl` のいずれかです。
`error` のリスナーがない場合は `console.error` に出力されます。

### 見た目のカスタマイズ

```ts
import { BuildingFacadeLayer, PRESET_STYLES, DEFAULT_STYLE_RULES } from 'maplibre-facades';

new BuildingFacadeLayer({
  id: 'facades',
  source: { type: 'geojson', url: '/buildings.geojson' },
  styles: {
    ...PRESET_STYLES,
    office: { ...PRESET_STYLES.office, wallColor: [0.6, 0.62, 0.66], warmRatio: 0.3 },
  },
  // MapLibre の式で書く。参照できるのは共通モデルの属性
  // （category, structure, fireResistance, storeys, height, floorHeight, openSided …）
  styleRules: [
    { when: ['>=', ['get', 'height'], 100], style: 'curtainWall' },
    ...DEFAULT_STYLE_RULES,
  ],
});
```

スタイルは 16 種類までです。

### 部屋のまとまり

オフィスなどでは、複数の窓が 1 つの部屋に面しています。スタイルの `windowsPerRoom`（1 部屋あたりの窓の数の目安）で、
連続する窓を 1 つの部屋にまとめます。部屋の中では室内（壁・床・天井照明・家具）がつながり、点灯・消灯と照明の色がそろいます。
仕切り壁は部屋の端にだけ見えます。カーテンとブラインドは窓ごとです（ブラインドの下げ具合は部屋でおおむねそろう）。

- 部屋の幅はフロアごとに目安の 0.6〜1.5 倍でばらつき、区切りの位置もフロアごとにずれる
- `openPlanRatio` の割合のフロアは仕切りのないワンフロアになり、フロア全体で点灯がそろう。1 階の店舗・ロビーは常にワンフロア
- 広い部屋の照明は天井に 3.6m おきに並ぶ

| プリセット | `windowsPerRoom` | `openPlanRatio` |
|---|---|---|
| `industrial`（工場・倉庫） | 8 | 0.8 |
| `curtainWall`（超高層） | 6 | 0.5 |
| `commercial`（商業） | 6 | 0.7 |
| `office` | 4 | 0.35 |
| `institutional`（官公庁・学校・病院） | 3 | 0.1 |
| `generic` | 2 | 0.1 |
| 住宅系・ホテル（`apartment` `house` `mixed` `hotel`） | 1 | 0 |

### 建物ごとの色

外壁とガラスは、スタイルの色の候補から建物ごとに 1 色を選びます（重みに応じた確率。同じ建物は常に同じ色）。
さらに `wallVariation` (0–1) で明るさと色味（暖色・寒色寄り）を少し揺らします。

```ts
office: {
  ...PRESET_STYLES.office,
  wallColors: [
    { color: [0.84, 0.84, 0.81], weight: 3 },  // 白
    { color: [0.6, 0.44, 0.35], weight: 1 },   // れんが色のタイル
    [0.42, 0.37, 0.33],                         // 重みを省くと 1
  ],
  glassTints: [[0.32, 0.5, 0.7], [0.64, 0.5, 0.34]],  // 青・ブロンズ
  wallVariation: 0.3,
},
```

- `wallColors` は最大 6 色、`glassTints` は最大 4 色。省略すると `wallColor` / `glassTint` の 1 色になる
- ガラスの色は室内の透過だけでなく映り込みにも付く（反射の強いガラスほど強く出る）
- 塔屋やパラペットの内側も、その建物の外壁と同じ色になる

## 屋上

```ts
const layer = new BuildingFacadeLayer({
  id: 'facades',
  source,
  roof: {
    parapet: { height: 1.1 },                 // true / false でも指定できる
    finish: true,
    equipment: { density: 0.5 },
    aviationLights: { minHeight: 60, blink: true, intensity: 1.2 },
  },
});

layer.setRoof({ aviationLights: false });     // 指定した項目だけ変わる
layer.setRoof({ equipment: { density: 0.2 } });
```

| 項目 | パラメータ（既定値） | 内容 |
|---|---|---|
| `parapet` | `height`（0.9 m、0–3） | 屋上の縁の立ち上がり。屋上面をその分下げ、内側の面と笠木を描く。高さは建物の高さの 8% まで |
| `finish` | — | 用途別の仕上げ（コンクリート目地・防水シートの継ぎ目・天窓）、屋上緑化、太陽光パネル |
| `equipment` | `density`（0.7、0–1） | 塔屋・室外機の列・受水槽・キュービクル・冷却塔。建物の面積・階数・用途から配置し、縁と中庭を避ける |
| `aviationLights` | `minHeight`（60 m）, `blink`（true）, `intensity`（1）, `color`（赤） | 屋上の 4 隅の航空障害灯。夜だけ点く。点滅中は夜間に毎フレーム再描画する。10 m 未満の建物には付かない |

いずれも描画時のパラメータなので、変更してもデータの再読み込みは起きません（設備は最大数まで生成しておき、表示する割合を `density` で選びます）。

建物の種類ごとの違いはスタイルで指定します。

- `parapet: boolean` — パラペットを付けるか（戸建てなどは false）
- `roofFinish: 'concrete' | 'membrane' | 'skylights'` — 基本の仕上げ
- `greenRoofRatio` (0–1) — 屋上緑化のある建物の割合（屋上面積 300 m² 以上が対象）。実際には少ないため、プリセットはすべて 0
- `solarRatio` (0–1) — 太陽光パネルのある建物の割合
- `rooftopEquipment` (0–2) — 設備の多さの倍率。`density` に掛かる。0 で設備なし

## 外壁の経年変化（くすみ）

窓の配置と同じく、壁の形状に沿ってシェーダで描きます。

- **雨だれ**: 窓台の両端と窓台の下、屋上の縁から外壁を伝う縦筋（壁に沿った位置ごとに長さが変わる）
- **くすみ**: 地面近くの泥はね（下ほど濃い）と、壁全体のゆるやかな濃淡
- **しみ**: 縦に伸びた、縁のぼやけた水の跡

汚れの量 = レイヤーの `strength` × スタイルの `weathering`（素材の汚れやすさ 0–1）× 建物の古さ。
古さは建築年（`BuildingRecord.yearBuilt`）があれば 50 年で最大になり、なければ建物ごとにばらつかせます。

```ts
new BuildingFacadeLayer({ id: 'facades', source, weathering: { strength: 1.2, stains: 0.5 } });
layer.setWeathering({ strength: 2 });   // 指定した項目だけ変わる
layer.setWeathering(false);             // OFF
```

| 項目 | 既定値 | 内容 |
|---|---|---|
| `strength` | 1 | 全体の強さ (0–2) |
| `streaks` | 1 | 雨だれ (0–1) |
| `grime` | 1 | 泥はね・くすみ (0–1) |
| `stains` | 1 | しみ (0–1) |

プリセットの `weathering` は、ガラスの超高層（`curtainWall`）0.25、オフィス 0.6、共同住宅 0.7、店舗併用住宅・工場 0.85 などです。

## 表面の細部（外壁の素材・ガラスの歪み）

**外壁の素材**: スタイルの `wallMaterials` で、素材ごとに使う建物の割合を指定します（合計 1 以下。残りは塗装などの平らな面）。
素材は法線（目地・穴・ふくらみ）、ラフネス（つや）、凹み（目地や斑点の暗さ）を持ち、太陽と空がつやとして映ります。界壁には使いません。

| 素材 | 内容 |
|---|---|
| `tile` | 二丁掛けタイル（227 × 60 mm）の破れ目地張り。タイルごとのわずかな傾き・つや・色むら |
| `concrete` | コンクリート打ち放し。型枠（900 × 1800 mm）の継ぎ目、450 mm 間隔のセパ穴、打設ごとの色むら。外壁の色は灰色に寄せる |
| `stone` | 石張り（御影石の本磨き）。900 × 600 mm の芋目地、強いつや、細かい斑点 |
| `metal` | 金属パネル（1000 × 2000 mm）。開いた目地、パネルごとのわずかなふくらみ（映り込みがゆがむ）。金属なので拡散反射が弱く、映り込みに外壁の色が付く |

```ts
office: { ...PRESET_STYLES.office, wallMaterials: { stone: 0.5, metal: 0.3 } }, // 5 割を石張り、3 割を金属パネル
```

- テクスチャは画像を配布せず、Worker で手続き的に作ります（1 素材 256 × 256、ミップマップ込みで約 350 KB、4 素材で約 1.4 MB の GPU メモリ。生成は 4 素材で約 0.1 秒）。追加のダウンロードはなく、メインスレッドも止めません
- ミップマップは自前で作り、平均されて消える凹凸の分をラフネスに足しています（Toksvig）。縮小してもちらつきません
- 目地が 1 ピクセルより細くなる距離（1 ピクセルに約 4 テクセル以上）からは、テクスチャもつやも計算せず、目地の暗さの平均だけを掛けます。見た目はほぼ変わらず、負荷はほとんどありません
- 窓ガラスに完全に隠れる所では素材を計算しません

**ガラスの歪み**: ガラス 1 枚（方立てで区切られた 1 枚）ごとに、取り付けの傾き（±1.4° 程度）と複層ガラスのふくらみ・へこみを付けます。
向かいの建物や太陽の映り込みがガラスごとに少しずつずれ、1 枚の鏡ではなく板の集まりに見えます。テクスチャは使いません。

```ts
new BuildingFacadeLayer({ id: 'facades', source, surfaceDetail: { materials: 1.5, glassDistortion: 0.5 } });
layer.setSurfaceDetail({ glassDistortion: 0 }); // 指定した項目だけ変わる
layer.setSurfaceDetail(false);                  // OFF
```

| 項目 | 既定値 | 内容 |
|---|---|---|
| `materials` | 1 | 外壁の素材の凹凸・つや・目地の強さ (0–2) |
| `glassDistortion` | 1 | ガラスの歪み (0–3) |

プリセットの `wallMaterials`:

| プリセット | `wallMaterials` |
|---|---|
| `office` | `{ tile: 0.35, stone: 0.2, metal: 0.15, concrete: 0.05 }` |
| `curtainWall` | `{ metal: 0.6 }`（窓の間の壁） |
| `apartment` | `{ tile: 0.6, concrete: 0.05 }` |
| `mixed` | `{ tile: 0.5 }` |
| `commercial` | `{ tile: 0.2, metal: 0.3, stone: 0.1 }` |
| `hotel` | `{ tile: 0.4, stone: 0.2 }` |
| `institutional` | `{ tile: 0.3, concrete: 0.25, stone: 0.1 }` |
| `industrial` | `{ metal: 0.5 }` |
| `generic` | `{ tile: 0.3, concrete: 0.1, metal: 0.05 }` |
| `house` / `plain` | なし |

## ガラスの反射

窓の色は「ガラスを透過した室内」と「ガラスに映った外の景色」を、反射率で混ぜたものです。

- **反射率**はスタイルの `reflectivity`（0 = 透明ガラスで正面から約 4%、1 = ミラーガラスで約 50%）から決まり、
  浅い角度から見るほど強くなります（フレネル反射）。レイヤーの `reflection` はこれに掛ける倍率です。
- **映る景色**は空と太陽に加えて、壁の解析で分かっている向かいの建物（距離と高さ）です。路地や通りでは向かいの壁や窓が映ります。
- **明るさの差**: 昼は外が室内よりずっと明るいので、照明が点いていても室内は暗く見え、反射が勝って中が見えにくくなります。
  夜は外が暗いので、点灯している部屋がよく見えます。

```ts
const layer = new BuildingFacadeLayer({ id: 'facades', source, reflection: 1.5 });
layer.setReflection(0); // 反射なし（常に室内が見える）
```

プリセットの `reflectivity` は、超高層のガラス（`curtainWall`）0.8、商業 0.5、オフィス 0.45、共同住宅 0.12、戸建て 0.08 などです。

## 窓の自動配置のしくみ

窓はフットプリントの形状と周囲の建物から自動で配置されます（Worker 内でまとめて解析し、窓そのものはシェーダで描きます）。

| 判断 | 方法 | 結果 |
|---|---|---|
| 連続面 | 25° 未満の曲がりで続く辺を 1 つの面とみなす | 曲面の外壁でも窓が途切れない。角の余白は面の両端だけ。角のない円筒形は継ぎ目なく一周 |
| 窓の列 | 面の長さを `windowSpacing` で割り、余りは窓間の壁で吸収 | 窓幅は一定。短い壁（1.2m 以上）にも 1 つは置く |
| 前面のあき | 壁から外へ光線を飛ばし、他の建物までの距離を測る | `partyWallMax`（既定 0.6m）未満は **界壁**（窓なし）、`sideWallMax`（既定 4m）未満は **側壁**（`sideWindows` に従う）、それ以上は **正面** |
| 隣の高さ | 前面をふさぐ建物の高さを記録 | それより上は開けた面。隣が自分の高さ × `openAboveRatio`（既定 0.25）より低ければ正面、そうでなければ 1 段階だけ開放（界壁 → 側壁、側壁 → 正面） |
| 向き | 開けた面のうち最も南を向いた面を **日当たり面** とする | `sunSideBalconies: true` のスタイルでは、バルコニーと大きな窓は日当たり面だけ、他の面は小窓 |
| 階の構成 | 階数と高さから階高を求め、最上部はパラペット | `groundFloor: 'storefront' \| 'lobby'` では 1 階の階高を上げる |

関係するスタイル項目:

- `sideWindows: 'none' | 'small' | 'same'` — 側壁の窓（なし / 小窓を間引いて配置 / 正面と同じ）
- `sunSideBalconies: boolean` — バルコニーを日当たり面に限定する
- `partyWallMax: number` — 界壁とみなす前面のあき (m)。既定 0.6
- `sideWallMax: number` — 側壁とみなす前面のあき (m)。既定 4。`partyWallMax` 以上
- `openAboveRatio: number` (0–1) — 隣の建物より上を正面として開放する高さの比率。既定 0.25。0 なら常に 1 段階だけ開放

しきい値はスタイルごとなので、建物の種類で変えられます。プリセットでは、神田のような細長い店舗併用住宅・商業（`mixed` / `commercial`）は
`openAboveRatio: 0.15`（側壁は隣がかなり低い場合だけ開放）、超高層（`curtainWall`）は `0.6`（全周ガラスに近づける）にしています。

```ts
styles: {
  ...PRESET_STYLES,
  // 側壁を広めに取り、隣より上もなるべく窓を付けない
  mixed: { ...PRESET_STYLES.mixed, sideWallMax: 6, openAboveRatio: 0 },
},
```

`setDebugMode('facade')` で壁面の分類（界壁・側壁・正面・日当たり面）と配置された窓を確認できます。
読み込み後の `stats.facades` に、分類ごとの壁の延長（m）が入ります（各建物のスタイルのしきい値で、地上部を分類した値）。

### 他のデータソース

組み込みのアダプタは `plateau` だけです。それ以外のデータは、JSON だけで書ける宣言的アダプタで扱います。
アダプタは Web Worker 内で動くため、関数は渡せません。

```ts
adapter: {
  name: 'declarative',
  spec: {
    name: 'osm',
    id: ['@id', 'id'],
    height: ['height', 'render_height'],
    storeys: ['building:levels'],
    category: { keys: ['building'], map: { office: 'office', apartments: 'apartment', house: 'house', retail: 'commercial' } },
  },
},
```

### ワーカーと CSP

ワーカーは既定でバンドル内に埋め込まれていて（Blob URL）、利用側でバンドラの設定は不要です。
CSP で `blob:` / `data:` の Worker が許可されていない場合は、同梱の `maplibre-facades/worker` を配置して URL を指定してください。

```ts
import { setWorkerUrl } from 'maplibre-facades';
import workerUrl from 'maplibre-facades/worker?url'; // Vite の場合

setWorkerUrl(workerUrl); // レイヤーごとに指定するなら options.workerUrl
```

> **maplibre-gl v6 と Vite で本番ビルドする場合:** MapLibre 自身のワーカーが配置されず、地図が起動しないことがあります。
> MapLibre 側のワーカー URL を次のように設定してください（本ライブラリとは独立した設定です）。
>
> ```ts
> import { setWorkerUrl } from 'maplibre-gl';
> import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
> setWorkerUrl(mapLibreWorkerUrl);
> ```

## PLATEAU データの準備（GeoJSON を使う場合）

3D Tiles を直接読む場合は不要です。オフラインで使う、全体を一括で読みたいなどの場合は、
PLATEAU の建築物モデル（LOD1 3D Tiles）を取得し、フットプリントと属性を持つ GeoJSON に変換できます。

```bash
npm run prepare-data -- 13101_bldg_lod1 --out ./public/data
```

データセット ID は PLATEAU データカタログ API の `id` です（例: `13101_bldg_lod1` = 千代田区）。
取得した元データは `data/raw/` にキャッシュされます。

## 開発

```bash
npm install
npm run dev            # 例（examples/chiyoda）を起動。http://localhost:5180（既定は PLATEAU の 3D Tiles で東京23区を直接読む）
npm run demo:build     # デモを examples/chiyoda/dist に出力（GitHub Pages に公開するもの）
npm run prepare-data   # GeoJSON 版（?source=geojson）を使う場合や、テストの実データ比較を動かす場合（初回のみ）
npm test
npm run build          # dist/index.js, dist/worker.js, dist/types/
```

```
Source ─▶ Adapter ─▶ Enricher ─▶ StyleResolver ─▶ MeshBuilder ─▶ BuildingFacadeLayer
(取得)     (正規化)    (欠損補完)    (見た目の選択)     (Worker 内)       (WebGL2 描画)
```

| パス | 役割 |
|---|---|
| `src/index.ts` | 公開 API。ここから export していないものは内部実装 |
| `src/layer/` | `BuildingFacadeLayer`（CustomLayerInterface）、イベント、設定の検証 |
| `src/sources/` | データソース。`tiles3d/` に tileset の読み込み・タイルの選択（メインスレッド）と、b3dm / glb の解析・フットプリントの復元（Worker） |
| `src/adapters/` | ソース固有属性 → 共通モデル。`plateau/` にコード表と年度別の候補キー |
| `src/enrich/` | 高さ・階数・階高の推定（推定したかどうかを `provenance` に記録） |
| `src/style/` | ファサードスタイル定義、プリセット、スタイル選択ルール |
| `src/mesh/` | 壁 1 辺 = 1 四角形、屋根は earcut。局所座標 (m) で RTC |
| `src/worker/` | パイプラインを Web Worker で実行。`createWorker.ts` がワーカーの読み込み方法を決める |
| `src/render/` | 窓グリッド・インテリアマッピング・点灯をすべてフラグメントシェーダで計算 |
| `scripts/prepare-plateau.mjs` | b3dm（Draco）を解析し、LOD1 の屋根面からフットプリントを復元して GeoJSON 化 |
| `scripts/make-implicit-sample.mjs` | 暗黙的タイリングの検証用データを作る。台東区のタイル（経緯度の格子で並んでいる）を、上野駅付近を根にした QUADTREE に並べ直して `data/implicit-taito/` に出力 |
| `examples/chiyoda/` | 千代田区のデモ |

main への push で、GitHub Actions（`.github/workflows/pages.yml`）が型チェック・テスト・ビルドを行い、デモを GitHub Pages に公開します。
GeoJSON 版のデータはリポジトリに含めていないので、公開版のデモでは 3D Tiles だけを選べます。

## ライセンス

[MIT](LICENSE)

## 出典

- 建物データ: 国土交通省 Project PLATEAU（3D 都市モデル 建築物モデル 東京23区 2025）、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)
- 背景地図: [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)（全国最新写真）
