// PLATEAU 植生モデル（LOD1, 3D Tiles）。デモの都市のうち LOD1 の植生がある所（東京の一部の区と仙台市）。PLATEAU データカタログ API から生成
// 植生は区の一部（調査した範囲）だけで、仙台市が最も多い（約 1,800 本）
// https://api.plateau.reearth.io/datacatalog/plateau-datasets

export const VEGETATION_TILESETS: { id: string; name: string; url: string }[] = [
  { id: '04100_veg_SolitaryVegetationObject_lod1', name: '仙台市', url: 'https://assets.cms.plateau.reearth.io/assets/48/1f485a-a327-4d31-8a2f-402013e0525f/04100_sendai-shi_city_2024_citygml_1_op_veg_SolitaryVegetationObject_3dtiles_lod1/tileset.json' },
  { id: '13101_veg_PlantCover_lod1', name: '千代田区', url: 'https://assets.cms.plateau.reearth.io/assets/f3/cc8367-1902-4bcf-97eb-f84dabecd286/13101_chiyoda-ku_pref_2025_citygml_1_op_veg_PlantCover_3dtiles_lod1/tileset.json' },
  { id: '13101_veg_SolitaryVegetationObject_lod1', name: '千代田区', url: 'https://assets.cms.plateau.reearth.io/assets/0b/33bdda-b701-422d-a3da-13a68da908d2/13101_chiyoda-ku_pref_2025_citygml_1_op_veg_SolitaryVegetationObject_3dtiles_lod1/tileset.json' },
  { id: '13102_veg_PlantCover_lod1', name: '中央区', url: 'https://assets.cms.plateau.reearth.io/assets/c2/07d244-2089-44ab-a30d-326b28aa0079/13102_chuo-ku_pref_2025_citygml_1_op_veg_PlantCover_3dtiles_lod1/tileset.json' },
  { id: '13102_veg_SolitaryVegetationObject_lod1', name: '中央区', url: 'https://assets.cms.plateau.reearth.io/assets/56/582a20-1877-42a7-aa28-821a87a07083/13102_chuo-ku_pref_2025_citygml_1_op_veg_SolitaryVegetationObject_3dtiles_lod1/tileset.json' },
  { id: '13103_veg_PlantCover_lod1', name: '港区', url: 'https://assets.cms.plateau.reearth.io/assets/a0/930404-84a9-48cd-8431-d99cb1227354/13103_minato-ku_pref_2025_citygml_1_op_veg_PlantCover_3dtiles_lod1/tileset.json' },
  { id: '13103_veg_SolitaryVegetationObject_lod1', name: '港区', url: 'https://assets.cms.plateau.reearth.io/assets/30/04412f-52aa-4cac-ae61-e8cc6cb87aed/13103_minato-ku_pref_2025_citygml_1_op_veg_SolitaryVegetationObject_3dtiles_lod1/tileset.json' },
  { id: '13104_veg_PlantCover_lod1', name: '新宿区', url: 'https://assets.cms.plateau.reearth.io/assets/41/048ca6-dbe3-425d-b1df-5b9d504e38ee/13104_shinjuku-ku_pref_2025_citygml_1_op_veg_PlantCover_3dtiles_lod1/tileset.json' },
  { id: '13104_veg_SolitaryVegetationObject_lod1', name: '新宿区', url: 'https://assets.cms.plateau.reearth.io/assets/c0/059d02-7bcb-4899-b184-8bd7868f68b3/13104_shinjuku-ku_pref_2025_citygml_1_op_veg_SolitaryVegetationObject_3dtiles_lod1/tileset.json' },
  { id: '13106_veg_PlantCover_lod1', name: '台東区', url: 'https://assets.cms.plateau.reearth.io/assets/99/982ef0-616d-416b-8827-c43c19356ad8/13106_taito-ku_city_2025_citygml_1_op_veg_PlantCover_3dtiles_lod1/tileset.json' },
  { id: '13106_veg_SolitaryVegetationObject_lod1', name: '台東区', url: 'https://assets.cms.plateau.reearth.io/assets/94/afe6d9-ce97-4735-a0eb-ee9a512fe97f/13106_taito-ku_city_2025_citygml_1_op_veg_SolitaryVegetationObject_3dtiles_lod1/tileset.json' },
  { id: '13107_veg_PlantCover_lod1', name: '墨田区', url: 'https://assets.cms.plateau.reearth.io/assets/ce/8d43fe-7a05-4706-b48c-d835aa99b325/13107_sumida-ku_city_2025_citygml_1_op_veg_PlantCover_3dtiles_lod1/tileset.json' },
  { id: '13107_veg_SolitaryVegetationObject_lod1', name: '墨田区', url: 'https://assets.cms.plateau.reearth.io/assets/e0/ca9051-c6f5-4cc5-b000-39cead93bc81/13107_sumida-ku_city_2025_citygml_1_op_veg_SolitaryVegetationObject_3dtiles_lod1/tileset.json' },
  { id: '13108_veg_PlantCover_lod1', name: '江東区', url: 'https://assets.cms.plateau.reearth.io/assets/d6/ea125f-d94a-4b5d-8c6e-d46d7a31f8a2/13108_koto-ku_pref_2025_citygml_1_op_veg_PlantCover_3dtiles_lod1/tileset.json' },
  { id: '13108_veg_SolitaryVegetationObject_lod1', name: '江東区', url: 'https://assets.cms.plateau.reearth.io/assets/f6/9657e6-e4f2-4622-942c-f74234f98717/13108_koto-ku_pref_2025_citygml_1_op_veg_SolitaryVegetationObject_3dtiles_lod1/tileset.json' },
  { id: '13113_veg_PlantCover_lod1', name: '渋谷区', url: 'https://assets.cms.plateau.reearth.io/assets/70/9e1ef0-78c4-498d-9b4f-068c81f1037f/13113_shibuya-ku_pref_2025_citygml_1_op_veg_PlantCover_3dtiles_lod1/tileset.json' },
  { id: '13113_veg_SolitaryVegetationObject_lod1', name: '渋谷区', url: 'https://assets.cms.plateau.reearth.io/assets/25/00e117-923d-4970-8fb3-0a9eb99076ed/13113_shibuya-ku_pref_2025_citygml_1_op_veg_SolitaryVegetationObject_3dtiles_lod1/tileset.json' },
  { id: '13116_veg_PlantCover_lod1', name: '豊島区', url: 'https://assets.cms.plateau.reearth.io/assets/d9/f5b8a8-d3e2-4150-9b63-5cb91f119d83/13116_toshima-ku_pref_2025_citygml_1_op_veg_PlantCover_3dtiles_lod1/tileset.json' },
  { id: '13116_veg_SolitaryVegetationObject_lod1', name: '豊島区', url: 'https://assets.cms.plateau.reearth.io/assets/93/215d8d-c36c-469e-b433-b2395825b31a/13116_toshima-ku_pref_2025_citygml_1_op_veg_SolitaryVegetationObject_3dtiles_lod1/tileset.json' },
];
