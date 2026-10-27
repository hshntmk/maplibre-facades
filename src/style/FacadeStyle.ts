import { MAX_WALL_MATERIALS, WALL_MATERIALS, type WallMaterialName } from '../material/WallMaterials';
import type { BalconyLayout } from '../mesh/Balconies';

export type RGB = [number, number, number];

/** 色の候補。色だけ（重み 1）か、重み付きの色 */
export type PaletteColor = RGB | { color: RGB; weight: number };

/** 外壁・ガラスの色の候補の最大数 */
export const WALL_PALETTE_SIZE = 6;
export const GLASS_PALETTE_SIZE = 4;

export type InteriorPalette = 'office' | 'residential' | 'shop' | 'warehouse';
export type GroundFloor = 'same' | 'storefront' | 'lobby';
/** 屋上の基本の仕上げ。concrete: コンクリート押さえ（目地）/ membrane: 防水シート（継ぎ目）/ skylights: 天窓の列（倉庫・工場） */
export type RoofFinish = 'concrete' | 'membrane' | 'skylights';

/** 狭い隙間（4m 未満）に面した側壁の窓。隣と接している壁（界壁）には常に窓を付けない */
export type SideWindows = 'none' | 'small' | 'same';

/** ファサード（外壁と窓）の見た目。比率はセル（窓 1 枚分の幅 × 階高）に対する値 */
export interface FacadeStyle {
  /** 窓の配置間隔 (m) */
  windowSpacing: number;
  /** 窓幅 / セル幅 (0–1)。0 なら窓なし */
  windowWidth: number;
  /** 窓高 / 階高 (0–1) */
  windowHeight: number;
  /** 窓下端の高さ / 階高 (0–1) */
  sill: number;
  /** 窓を縦に分割する数 */
  mullions: number;
  /** 外壁の色。wallColors を指定しないときに使う */
  wallColor: RGB;
  /** 外壁の色の候補（最大 6 色）。建物ごとに重みに応じて 1 色を選ぶ */
  wallColors?: PaletteColor[];
  /** 建物ごとの壁色の揺らぎ (0–1)。明るさと、暖色・寒色寄りの色味を少し変える */
  wallVariation: number;
  /** 外壁の汚れやすさ (0–1)。雨だれ・くすみ・しみの出やすさ（ガラスのカーテンウォールは小さく、古いタイルやコンクリートは大きく） */
  weathering: number;
  /**
   * 外壁の素材と、それを使う建物の割合 (0–1、合計 1 以下)。残りは素材なし（塗装などの平らな面）。
   * 素材は凹凸（目地）とつやを持ち、近くでは陰影、遠くでは日の当たり方の違いとして見える。界壁には使わない。
   * `tile`（二丁掛けタイル）、`concrete`（コンクリート打ち放し。外壁の色は灰色に寄せる）、`stone`（石張り）、`metal`（金属パネル）
   * ```ts
   * wallMaterials: { tile: 0.5, concrete: 0.1 } // 5 割をタイル張り、1 割をコンクリート打ち放しにする
   * ```
   */
  wallMaterials?: Partial<Record<WallMaterialName, number>>;
  frameColor: RGB;
  /** ガラスの色。glassTints を指定しないときに使う */
  glassTint: RGB;
  /** ガラスの色の候補（最大 4 色）。建物ごとに重みに応じて 1 色を選ぶ */
  glassTints?: PaletteColor[];
  /**
   * ガラスの反射率 (0–1)。0 = 一般的な透明ガラス（正面から見て約 4%）、1 = ミラーガラス（約 50%）。
   * 実際の反射率は見る角度で変わり（浅い角度ほど強い）、レイヤーの reflection を掛けた値になる
   */
  reflectivity: number;
  roofColor: RGB;
  // ---- 屋上（レイヤーの roof オプションで全体の ON/OFF とパラメータを指定する）
  /** 屋上の縁の立ち上がり（パラペット）を付けるか */
  parapet: boolean;
  roofFinish: RoofFinish;
  /** 屋上緑化のある建物の割合 (0–1)。屋上面積 300m² 以上の建物が対象。プリセットはすべて 0 */
  greenRoofRatio: number;
  /** 太陽光パネルを載せた建物の割合 (0–1) */
  solarRatio: number;
  /** 屋上設備（塔屋・室外機・受水槽・キュービクル・冷却塔）の多さの倍率 (0–2)。0 で設備なし */
  rooftopEquipment: number;
  /** 1 階の扱い。storefront / lobby は 1 階の階高を上げる */
  groundFloor: GroundFloor;
  /** 側壁（狭い隙間に面した壁）の窓 */
  sideWindows: SideWindows;
  /** true: バルコニーと大きな窓は日当たり面（開けた面のうち最も南向き）だけ。他の面は小窓（共同住宅の北側廊下など） */
  sunSideBalconies: boolean;
  /** 前面のあき (m) がこれ未満の壁は界壁（隣と接している）として窓を付けない */
  partyWallMax: number;
  /** 前面のあき (m) がこれ未満の壁は側壁（狭い隙間に面している）として sideWindows に従う */
  sideWallMax: number;
  /**
   * 前面をふさぐ隣の建物より上の壁の扱い。隣の高さが自分の高さ × この値より低ければ、上の部分は正面として窓を付ける。
   * そうでなければ 1 段階だけ開放する（界壁 → 側壁、側壁 → 正面）。0 にすると常に 1 段階だけ開放
   */
  openAboveRatio: number;
  /** 床スラブのライン（横帯）の強さ */
  slabLine: number;
  /** バルコニーの手すりの表現 (0–1)。0 ならバルコニーなし。立体のバルコニーは 0 より大きい場合に作る */
  balcony: number;
  /**
   * バルコニーの奥行き (m、0.5–3、既定 1.5)。外壁の面（建物の外形）を手すりの面とし、その内側に引っ込めて作る
   * （PLATEAU の外形はバルコニーの先端までを含むため）
   */
  balconyDepth?: number;
  /** 全面ガラス（カーテンウォール） */
  curtainWall: boolean;
  // ---- 室内（インテリアマッピング）
  interior: InteriorPalette;
  /** 部屋の奥行き (m) */
  roomDepth: number;
  /** カーテンがある部屋の割合 */
  curtainRatio: number;
  /** ブラインドがある部屋の割合 */
  blindsRatio: number;
  /**
   * 1 部屋あたりの窓の数の目安 (1–50、既定 1)。オフィスでは複数の窓が 1 つの部屋に面する。
   * フロアごとに 0.6〜1.5 倍の範囲でばらつかせ、部屋の中では室内（壁・床・天井照明・家具）がつながり、点灯と照明の色がそろう
   */
  windowsPerRoom?: number;
  /** 仕切りのないワンフロアの割合 (0–1、既定 0)。1 階の店舗・ロビーは常にワンフロア */
  openPlanRatio?: number;
  // ---- 夜間
  /** 点灯の単位: 0 = 窓ごとにばらばら、1 = フロア全体がまとまって点灯（オフィス的） */
  floorCoherence: number;
  /** 電球色の割合（残りは昼白色） */
  warmRatio: number;
  /** カテゴリ別の点灯率に掛ける係数 */
  litScale: number;
}

/** バルコニーの奥行きの既定値 (m) */
export const DEFAULT_BALCONY_DEPTH = 1.5;

/** Worker でバルコニーの形を作るための設定 */
export function balconyLayout(s: FacadeStyle): BalconyLayout {
  return {
    depth: s.balcony > 0 && s.windowWidth > 0 ? (s.balconyDepth ?? DEFAULT_BALCONY_DEPTH) : 0,
    windowSpacing: s.windowSpacing,
    curtainWall: s.curtainWall,
    raisedGroundFloor: s.groundFloor !== 'same',
    sunSideOnly: s.sunSideBalconies,
    openAboveRatio: s.openAboveRatio,
  };
}

/** GPU に渡すときの 1 スタイルあたりのテクセル数（RGBA32F） */
export const STYLE_TEXELS = 10 + WALL_PALETTE_SIZE + GLASS_PALETTE_SIZE + 2;

const GROUND: Record<GroundFloor, number> = { same: 0, storefront: 1, lobby: 2 };
const INTERIOR: Record<InteriorPalette, number> = { office: 0, residential: 1, shop: 2, warehouse: 3 };
const SIDE: Record<SideWindows, number> = { none: 0, small: 1, same: 2 };
const FINISH: Record<RoofFinish, number> = { concrete: 0, membrane: 1, skylights: 2 };

export const paletteEntry = (c: PaletteColor): { color: RGB; weight: number } => (Array.isArray(c) ? { color: c, weight: 1 } : c);

/** 候補を (r, g, b, weight) × size に詰める。空きは weight 0 */
function packPalette(colors: PaletteColor[] | undefined, fallback: RGB, size: number): number[] {
  const entries = colors?.length ? colors.map(paletteEntry) : [{ color: fallback, weight: 1 }];
  const out: number[] = [];
  for (let i = 0; i < size; i++) {
    const e = entries[i];
    out.push(...(e ? [...e.color, e.weight] : [0, 0, 0, 0]));
  }
  return out;
}

/** シェーダ側の styleTexel() の番号とレイアウトを合わせること（10–15: 外壁の候補、16–19: ガラスの候補、20: 汚れやすさと素材の割合 1–3、21: 部屋の大きさと素材の割合 4–5） */
export function packStyle(s: FacadeStyle, out: Float32Array, offset: number): void {
  // 素材の割合（WALL_MATERIALS の順）。テクセル 20 の yzw と 21 の zw に詰める
  const ratios = Array.from({ length: MAX_WALL_MATERIALS }, (_, i) => (i < WALL_MATERIALS.length ? (s.wallMaterials?.[WALL_MATERIALS[i]] ?? 0) : 0));
  const v = [
    s.windowSpacing, s.windowWidth, s.windowHeight, s.sill,
    ...s.wallColor, s.wallVariation,
    ...s.frameColor, s.mullions,
    ...s.glassTint, s.reflectivity,
    s.roomDepth, s.floorCoherence, s.warmRatio, s.curtainRatio,
    GROUND[s.groundFloor], s.slabLine, s.balcony, s.litScale,
    ...s.roofColor, INTERIOR[s.interior],
    s.curtainWall ? 1 : 0, s.blindsRatio, SIDE[s.sideWindows], s.sunSideBalconies ? 1 : 0,
    s.partyWallMax, s.sideWallMax, s.openAboveRatio, s.parapet ? 1 : 0,
    FINISH[s.roofFinish], s.greenRoofRatio, s.solarRatio, s.rooftopEquipment,
    ...packPalette(s.wallColors, s.wallColor, WALL_PALETTE_SIZE),
    ...packPalette(s.glassTints, s.glassTint, GLASS_PALETTE_SIZE),
    s.weathering, ratios[0], ratios[1], ratios[2],
    s.windowsPerRoom ?? 1, s.openPlanRatio ?? 0, ratios[3], ratios[4],
  ];
  out.set(v, offset);
}
