// PLATEAU 都市設備モデル（LOD1, 3D Tiles）。デモの都市のうち LOD1 の都市設備がある所（東京の一部の区）。PLATEAU データカタログ API から生成
// 都市設備は区の一部（調査した範囲の通り）だけにある。描くのは信号機・街灯・道路標識・路面標示と、それらを取り付けた柱
// https://api.plateau.reearth.io/datacatalog/plateau-datasets

export const FURNITURE_TILESETS: { id: string; name: string; url: string }[] = [
  { id: '13113_frn_lod1', name: '渋谷区', url: 'https://assets.cms.plateau.reearth.io/assets/19/b0699d-ed27-450b-8857-b7fbe19c1565/13113_shibuya-ku_pref_2025_citygml_1_op_frn_3dtiles_lod1/tileset.json' },
  { id: '13102_frn_lod1', name: '中央区', url: 'https://assets.cms.plateau.reearth.io/assets/53/0a9bbd-29f0-4ec1-84e2-e40d8f47ba96/13102_chuo-ku_pref_2025_citygml_1_op_frn_3dtiles_lod1/tileset.json' },
  { id: '13104_frn_lod1', name: '新宿区', url: 'https://assets.cms.plateau.reearth.io/assets/5b/b8b5b8-20bf-425e-a941-f2f64e3cab8d/13104_shinjuku-ku_pref_2025_citygml_1_op_frn_3dtiles_lod1/tileset.json' },
  { id: '13101_frn_lod1', name: '千代田区', url: 'https://assets.cms.plateau.reearth.io/assets/65/d50bc6-6441-4257-96b4-81a317fa64ce/13101_chiyoda-ku_pref_2025_citygml_1_op_frn_3dtiles_lod1/tileset.json' },
  { id: '13108_frn_lod1', name: '江東区', url: 'https://assets.cms.plateau.reearth.io/assets/76/89156b-9d13-4510-a950-08fa12242075/13108_koto-ku_pref_2025_citygml_1_op_frn_3dtiles_lod1/tileset.json' },
  { id: '13116_frn_lod1', name: '豊島区', url: 'https://assets.cms.plateau.reearth.io/assets/8c/c17b42-d198-43a3-9561-18c1a3587ced/13116_toshima-ku_pref_2025_citygml_1_op_frn_3dtiles_lod1/tileset.json' },
  { id: '13103_frn_lod1', name: '港区', url: 'https://assets.cms.plateau.reearth.io/assets/9f/8ff9f7-bb9e-45ca-98ae-acca50f83144/13103_minato-ku_pref_2025_citygml_1_op_frn_3dtiles_lod1/tileset.json' },
  { id: '13106_frn_lod1', name: '台東区', url: 'https://assets.cms.plateau.reearth.io/assets/c2/adc208-0f8d-45fc-b41f-0f2d4ae04d2f/13106_taito-ku_city_2025_citygml_1_op_frn_3dtiles_lod1/tileset.json' },
  { id: '13107_frn_lod1', name: '墨田区', url: 'https://assets.cms.plateau.reearth.io/assets/e3/5f93fd-b981-4496-a5e2-6651213cfa42/13107_sumida-ku_pref_2025_citygml_1_op_frn_3dtiles_lod1/tileset.json' },
];
