import { BuildingFacadeLayerError } from '../errors';
import { WALL_MATERIALS } from '../material/WallMaterials';
import { MAX_CLEARANCE } from '../mesh/FacadeAnalyzer';
import { GLASS_PALETTE_SIZE, WALL_PALETTE_SIZE, paletteEntry, type FacadeStyle, type PaletteColor } from '../style/FacadeStyle';
import type { StyleRule } from '../style/StyleResolver';

export const MAX_STYLES = 16;

/** DebugMode の値（BuildingFacadeLayer の DEBUG_INDEX と合わせること） */
const DEBUG_MODES = ['none', 'category', 'style', 'facade'] as const;

const fail = (message: string): never => {
  throw new BuildingFacadeLayerError('options', message);
};

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function checkRange(path: string, v: unknown, min: number, max: number): void {
  if (!isFiniteNumber(v) || v < min || v > max) fail(`${path} must be a number between ${min} and ${max} (got ${JSON.stringify(v)})`);
}

function checkColor(path: string, v: unknown): void {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((c) => isFiniteNumber(c) && c >= 0 && c <= 1)) {
    fail(`${path} must be an [r, g, b] array with components in 0–1`);
  }
}

function checkPalette(path: string, v: PaletteColor[] | undefined, max: number): void {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length === 0 || v.length > max) fail(`${path} must be an array of 1–${max} colors`);
  v.forEach((c, i) => {
    const e = typeof c === 'object' && c !== null && !Array.isArray(c) ? c : paletteEntry(c);
    checkColor(`${path}[${i}]${Array.isArray(c) ? '' : '.color'}`, e.color);
    if (!isFiniteNumber(e.weight) || e.weight <= 0) fail(`${path}[${i}].weight must be a positive number`);
  });
}

export function validateStyle(name: string, s: FacadeStyle): void {
  const p = (k: string) => `styles.${name}.${k}`;
  if (!s || typeof s !== 'object') fail(`styles.${name} must be an object`);
  checkRange(p('windowSpacing'), s.windowSpacing, 0.5, 50);
  checkRange(p('windowWidth'), s.windowWidth, 0, 1);
  checkRange(p('windowHeight'), s.windowHeight, 0, 1);
  checkRange(p('sill'), s.sill, 0, 1);
  if (s.sill + s.windowHeight > 1.0001) fail(`${p('sill')} + ${p('windowHeight')} must not exceed 1`);
  checkRange(p('mullions'), s.mullions, 1, 16);
  checkColor(p('wallColor'), s.wallColor);
  checkPalette(p('wallColors'), s.wallColors, WALL_PALETTE_SIZE);
  checkRange(p('wallVariation'), s.wallVariation, 0, 1);
  checkRange(p('weathering'), s.weathering, 0, 1);
  if (s.wallMaterials !== undefined) {
    if (typeof s.wallMaterials !== 'object' || s.wallMaterials === null || Array.isArray(s.wallMaterials)) fail(`${p('wallMaterials')} must be an object`);
    let total = 0;
    for (const [k, v] of Object.entries(s.wallMaterials)) {
      if (!(WALL_MATERIALS as readonly string[]).includes(k)) fail(`${p('wallMaterials')}: unknown material '${k}' (available: ${WALL_MATERIALS.join(', ')})`);
      checkRange(p(`wallMaterials.${k}`), v, 0, 1);
      total += v as number;
    }
    if (total > 1.0001) fail(`${p('wallMaterials')}: ratios must add up to 1 or less (got ${total})`);
  }
  checkColor(p('frameColor'), s.frameColor);
  checkColor(p('glassTint'), s.glassTint);
  checkPalette(p('glassTints'), s.glassTints, GLASS_PALETTE_SIZE);
  checkRange(p('reflectivity'), s.reflectivity, 0, 1);
  checkColor(p('roofColor'), s.roofColor);
  if (!['same', 'storefront', 'lobby'].includes(s.groundFloor)) fail(`${p('groundFloor')} must be 'same', 'storefront' or 'lobby'`);
  if (!['none', 'small', 'same'].includes(s.sideWindows)) fail(`${p('sideWindows')} must be 'none', 'small' or 'same'`);
  if (typeof s.sunSideBalconies !== 'boolean') fail(`${p('sunSideBalconies')} must be a boolean`);
  checkRange(p('partyWallMax'), s.partyWallMax, 0, MAX_CLEARANCE);
  checkRange(p('sideWallMax'), s.sideWallMax, 0, MAX_CLEARANCE);
  if (s.sideWallMax < s.partyWallMax) fail(`${p('sideWallMax')} must be >= ${p('partyWallMax')}`);
  checkRange(p('openAboveRatio'), s.openAboveRatio, 0, 1);
  if (typeof s.parapet !== 'boolean') fail(`${p('parapet')} must be a boolean`);
  if (!['concrete', 'membrane', 'skylights'].includes(s.roofFinish)) fail(`${p('roofFinish')} must be 'concrete', 'membrane' or 'skylights'`);
  checkRange(p('greenRoofRatio'), s.greenRoofRatio, 0, 1);
  checkRange(p('solarRatio'), s.solarRatio, 0, 1);
  checkRange(p('rooftopEquipment'), s.rooftopEquipment, 0, 2);
  checkRange(p('slabLine'), s.slabLine, 0, 1);
  checkRange(p('balcony'), s.balcony, 0, 1);
  if (typeof s.curtainWall !== 'boolean') fail(`${p('curtainWall')} must be a boolean`);
  if (!['office', 'residential', 'shop', 'warehouse'].includes(s.interior)) fail(`${p('interior')} must be 'office', 'residential', 'shop' or 'warehouse'`);
  checkRange(p('roomDepth'), s.roomDepth, 0.5, 50);
  checkRange(p('curtainRatio'), s.curtainRatio, 0, 1);
  checkRange(p('blindsRatio'), s.blindsRatio, 0, 1);
  if (s.windowsPerRoom !== undefined) checkRange(p('windowsPerRoom'), s.windowsPerRoom, 1, 50);
  if (s.openPlanRatio !== undefined) checkRange(p('openPlanRatio'), s.openPlanRatio, 0, 1);
  checkRange(p('floorCoherence'), s.floorCoherence, 0, 1);
  checkRange(p('warmRatio'), s.warmRatio, 0, 1);
  checkRange(p('litScale'), s.litScale, 0, 10);
}

export function validateLayerOptions(opts: {
  id: unknown;
  source: unknown;
  styles: Record<string, FacadeStyle>;
  styleRules: StyleRule[];
  timeOfDay?: unknown;
  reflection?: unknown;
  effects?: unknown;
  interior?: unknown;
  debug?: unknown;
}): void {
  if (typeof opts.id !== 'string' || !opts.id) fail('id must be a non-empty string');
  const source = opts.source as { type?: unknown; url?: unknown; maximumScreenSpaceError?: unknown; maxCachedTiles?: unknown; dracoWasmUrl?: unknown } | undefined;
  if (!source || (source.type !== 'geojson' && source.type !== '3dtiles')) fail(`source.type must be 'geojson' or '3dtiles'`);
  const urls = Array.isArray(source!.url) ? source!.url : [source!.url];
  if (source!.type === 'geojson' && Array.isArray(source!.url)) fail('source.url must be a single URL for geojson');
  if (!urls.length || !urls.every((u) => typeof u === 'string' && u)) fail('source.url must be a non-empty string (or an array of them for 3dtiles)');
  if (source!.type === '3dtiles') {
    if (source!.maximumScreenSpaceError !== undefined) checkRange('source.maximumScreenSpaceError', source!.maximumScreenSpaceError, 1, 256);
    if (source!.maxCachedTiles !== undefined) checkRange('source.maxCachedTiles', source!.maxCachedTiles, 0, 10000);
    if (source!.dracoWasmUrl !== undefined && (typeof source!.dracoWasmUrl !== 'string' || !source!.dracoWasmUrl)) fail('source.dracoWasmUrl must be a non-empty string');
  }

  const names = Object.keys(opts.styles ?? {});
  if (names.length === 0) fail('styles must define at least one style');
  if (names.length > MAX_STYLES) fail(`at most ${MAX_STYLES} styles are supported (got ${names.length})`);
  for (const name of names) validateStyle(name, opts.styles[name]);

  if (!Array.isArray(opts.styleRules) || opts.styleRules.length === 0) fail('styleRules must be a non-empty array');
  opts.styleRules.forEach((rule, i) => {
    if (!names.includes(rule?.style)) fail(`styleRules[${i}].style "${rule?.style}" is not defined in styles`);
    if (rule.when !== true && !Array.isArray(rule.when)) fail(`styleRules[${i}].when must be an expression array or true`);
  });

  if (opts.timeOfDay !== undefined && !isFiniteNumber(opts.timeOfDay)) fail('timeOfDay must be a finite number');
  if (opts.reflection !== undefined) checkRange('reflection', opts.reflection, 0, 3);
  if (opts.effects !== undefined && typeof opts.effects !== 'boolean') fail('effects must be a boolean');
  if (opts.interior !== undefined && typeof opts.interior !== 'boolean') fail('interior must be a boolean');
  if (opts.debug !== undefined && !(DEBUG_MODES as readonly unknown[]).includes(opts.debug)) fail(`unknown debug mode: ${opts.debug}`);
}
