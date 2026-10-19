#!/usr/bin/env node
// 暗黙的タイリング（3D Tiles 1.1 implicit tiling）の検証用データを作る。
// PLATEAU 台東区（2025、glb）のタイルは経緯度を同じ角度で区切る格子（z/x/y、y は北から）になっているので、
// 指定した地点を含むレベル 15 のタイルを根にして、その下のタイル（レベル 15〜18）を QUADTREE の暗黙的タイリングに並べ直す。
//
//   node scripts/make-implicit-sample.mjs [経度] [緯度]   # 既定は上野駅付近
//
// 出力: data/implicit-taito/（tileset.json、subtrees/、content/）。中身の glb は PLATEAU から取得する。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BASE = 'https://assets.cms.plateau.reearth.io/assets/98/c5ff8d-d6b4-40fb-8ef9-fcca1407f9c0/13106_taito-ku_city_2025_citygml_1_op_bldg_3dtiles_lod1/';
const OUT = 'data/implicit-taito';
const ROOT_ZOOM = 15;
const AVAILABLE_LEVELS = 4; // レベル 15〜18
const SUBTREE_LEVELS = 2; // サブツリーはレベル 0 と 2 から始まる（子サブツリーの読み込みも確かめられる）

const lon = Number(process.argv[2] ?? 139.7745);
const lat = Number(process.argv[3] ?? 35.7115);

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ---- 元のタイルセット（明示的な木）から、根の下のタイルを集める
const tilesetPath = 'data/raw/13106/tileset.json';
if (!existsSync(tilesetPath)) {
  mkdirSync(dirname(tilesetPath), { recursive: true });
  writeFileSync(tilesetPath, await fetchBytes(`${BASE}tileset.json`));
}
const source = JSON.parse(readFileSync(tilesetPath, 'utf8'));
const uris = [];
(function walk(n) {
  if (n.content?.uri) uris.push(n.content.uri);
  for (const c of n.children ?? []) walk(c);
})(source.root);

const n = 2 ** ROOT_ZOOM;
const rootX = Math.floor(((lon + 180) / 360) * n);
const rootY = Math.floor(((90 - lat) / 360) * n); // 北から数える
const tiles = []; // { level, x, y（南から）, uri }
for (const uri of uris) {
  const [z, x, rest] = uri.split('/');
  const zoom = Number(z), tx = Number(x), ty = Number(rest.split('_')[0]);
  const level = zoom - ROOT_ZOOM;
  if (level < 0 || level >= AVAILABLE_LEVELS || tx >> level !== rootX || ty >> level !== rootY) continue;
  const size = 2 ** level;
  tiles.push({ level, x: tx - rootX * size, y: size - 1 - (ty - rootY * size), uri });
}
console.log(`root ${ROOT_ZOOM}/${rootX}/${rootY}: ${tiles.length} tiles`);

// ---- 中身を取得して content/{level}/{x}/{y}.glb に置く
for (const t of tiles) {
  const path = join(OUT, 'content', String(t.level), String(t.x), `${t.y}.glb`);
  if (existsSync(path)) continue;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, await fetchBytes(BASE + t.uri));
}

// ---- 有無: 中身のあるタイルと、その祖先はすべて「タイルあり」
const key = (l, x, y) => `${l}/${x}/${y}`;
const content = new Set(tiles.map((t) => key(t.level, t.x, t.y)));
const available = new Set();
for (const t of tiles) for (let l = t.level, x = t.x, y = t.y; l >= 0; l--, x >>= 1, y >>= 1) available.add(key(l, x, y));

const morton = (x, y) => {
  let m = 0;
  for (let bit = 0; x >> bit || y >> bit; bit++) m += (((x >> bit) & 1) + ((y >> bit) & 1) * 2) * 4 ** bit;
  return m;
};
const levelOffset = (l) => (4 ** l - 1) / 3;

function subtreeFile(level0, x0, y0) {
  const tileCount = levelOffset(SUBTREE_LEVELS);
  const tileBits = new Uint8Array(Math.ceil(tileCount / 8));
  const contentBits = new Uint8Array(Math.ceil(tileCount / 8));
  const childBits = new Uint8Array(Math.ceil(4 ** SUBTREE_LEVELS / 8));
  const set = (bits, i) => (bits[i >> 3] |= 1 << (i & 7));
  for (let l = 0; l < SUBTREE_LEVELS && level0 + l < AVAILABLE_LEVELS; l++) {
    const size = 2 ** l;
    for (let lx = 0; lx < size; lx++)
      for (let ly = 0; ly < size; ly++) {
        const k = key(level0 + l, x0 * size + lx, y0 * size + ly);
        const i = levelOffset(l) + morton(lx, ly);
        if (available.has(k)) set(tileBits, i);
        if (content.has(k)) set(contentBits, i);
      }
  }
  const children = [];
  if (level0 + SUBTREE_LEVELS < AVAILABLE_LEVELS) {
    const size = 2 ** SUBTREE_LEVELS;
    for (let lx = 0; lx < size; lx++)
      for (let ly = 0; ly < size; ly++) {
        if (!available.has(key(level0 + SUBTREE_LEVELS, x0 * size + lx, y0 * size + ly))) continue;
        set(childBits, morton(lx, ly));
        children.push([level0 + SUBTREE_LEVELS, x0 * size + lx, y0 * size + ly]);
      }
  }
  // バイナリのサブツリー: "subt" + version + JSON 長 + バイナリ長、JSON（8 バイト境界）、ビット列
  const chunks = [tileBits, contentBits, childBits];
  const views = [];
  let offset = 0;
  for (const c of chunks) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: c.byteLength });
    offset += Math.ceil(c.byteLength / 8) * 8;
  }
  let text = JSON.stringify({
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    tileAvailability: { bitstream: 0 },
    contentAvailability: [{ bitstream: 1 }],
    childSubtreeAvailability: { bitstream: 2 },
  });
  while (text.length % 8) text += ' ';
  const json = new TextEncoder().encode(text);
  const out = new Uint8Array(24 + json.byteLength + offset);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x74627573, true);
  dv.setUint32(4, 1, true);
  dv.setBigUint64(8, BigInt(json.byteLength), true);
  dv.setBigUint64(16, BigInt(offset), true);
  out.set(json, 24);
  chunks.forEach((c, i) => out.set(c, 24 + json.byteLength + views[i].byteOffset));
  const path = join(OUT, 'subtrees', `${level0}.${x0}.${y0}.subtree`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out);
  return children;
}

let subtrees = 0;
const queue = [[0, 0, 0]];
while (queue.length) {
  const [l, x, y] = queue.shift();
  queue.push(...subtreeFile(l, x, y));
  subtrees++;
}

// ---- tileset.json（根の範囲 = レベル 15 の格子 1 マス。高さは元のタイルセットの根から）
const rad = (d) => (d * Math.PI) / 180;
const [, , , , minH, maxH] = source.root.boundingVolume.region;
const tileset = {
  asset: { version: '1.1', generator: 'maplibre-facades scripts/make-implicit-sample.mjs' },
  geometricError: 128,
  root: {
    boundingVolume: {
      region: [rad((rootX / n) * 360 - 180), rad(90 - ((rootY + 1) / n) * 360), rad(((rootX + 1) / n) * 360 - 180), rad(90 - (rootY / n) * 360), minH, maxH],
    },
    geometricError: 64.2038007938601, // 元のレベル 15 のタイルと同じ（レベルごとに半分）
    refine: 'REPLACE',
    content: { uri: 'content/{level}/{x}/{y}.glb' },
    implicitTiling: { subdivisionScheme: 'QUADTREE', subtreeLevels: SUBTREE_LEVELS, availableLevels: AVAILABLE_LEVELS, subtrees: { uri: 'subtrees/{level}.{x}.{y}.subtree' } },
  },
};
writeFileSync(join(OUT, 'tileset.json'), JSON.stringify(tileset, null, 2));
console.log(`wrote ${OUT}: ${content.size} contents, ${available.size} tiles, ${subtrees} subtrees`);
