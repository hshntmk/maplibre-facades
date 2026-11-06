// PLATEAU 建築物モデル（LOD1, 3D Tiles）東京23区以外の都市。PLATEAU データカタログ API の各区の最新年度から生成
// （札幌市 2020、仙台市 2024、新潟市 2023、大阪市 2025、広島市 2024、福岡市 2024 年度）
// https://api.plateau.reearth.io/datacatalog/plateau-datasets

export const SAPPORO_WARDS: { code: string; name: string; url: string }[] = [
  { code: '01101', name: '中央区', url: 'https://assets.cms.plateau.reearth.io/assets/a6/031403-b4dc-4d5d-8c2f-50361fedc764/01100_sapporo-shi_city_2020_citygml_7_op_bldg_3dtiles_01101_chuo-ku_lod1/tileset.json' },
  { code: '01102', name: '北区', url: 'https://assets.cms.plateau.reearth.io/assets/b6/2fe16c-44c8-4a42-8138-82c971cd0e2c/01100_sapporo-shi_city_2020_citygml_7_op_bldg_3dtiles_01102_kita-ku_lod1/tileset.json' },
  { code: '01103', name: '東区', url: 'https://assets.cms.plateau.reearth.io/assets/98/2f5131-ad3c-4551-943a-3607ed6afa3c/01100_sapporo-shi_city_2020_citygml_7_op_bldg_3dtiles_01103_higashi-ku_lod1/tileset.json' },
  { code: '01104', name: '白石区', url: 'https://assets.cms.plateau.reearth.io/assets/a2/2d4d91-f50a-4fd8-a055-771bf1495095/01100_sapporo-shi_city_2020_citygml_7_op_bldg_3dtiles_01104_shiroishi-ku_lod1/tileset.json' },
  { code: '01105', name: '豊平区', url: 'https://assets.cms.plateau.reearth.io/assets/02/d7a24f-76db-4295-844e-c667831fea43/01100_sapporo-shi_city_2020_citygml_7_op_bldg_3dtiles_01105_toyohira-ku_lod1/tileset.json' },
  { code: '01106', name: '南区', url: 'https://assets.cms.plateau.reearth.io/assets/aa/5f71a5-4442-4dcb-80bb-a022adbe409c/01100_sapporo-shi_city_2020_citygml_7_op_bldg_3dtiles_01106_minami-ku_lod1/tileset.json' },
  { code: '01107', name: '西区', url: 'https://assets.cms.plateau.reearth.io/assets/e1/e6b234-82bd-4311-b72b-5920b6dfc569/01100_sapporo-shi_city_2020_citygml_7_op_bldg_3dtiles_01107_nishi-ku_lod1/tileset.json' },
  { code: '01108', name: '厚別区', url: 'https://assets.cms.plateau.reearth.io/assets/26/96d6b5-1c35-40e3-bb79-c5b53f15405a/01100_sapporo-shi_city_2020_citygml_7_op_bldg_3dtiles_01108_atsubetsu-ku_lod1/tileset.json' },
  { code: '01109', name: '手稲区', url: 'https://assets.cms.plateau.reearth.io/assets/70/811042-e748-47a7-9f3e-420003f445b9/01100_sapporo-shi_city_2020_citygml_7_op_bldg_3dtiles_01109_teine-ku_lod1/tileset.json' },
  { code: '01110', name: '清田区', url: 'https://assets.cms.plateau.reearth.io/assets/1d/c2a380-16cd-4a40-b860-0889727d752c/01100_sapporo-shi_city_2020_citygml_7_op_bldg_3dtiles_01110_kiyota-ku_lod1/tileset.json' },
];

export const SENDAI_WARDS: { code: string; name: string; url: string }[] = [
  { code: '04101', name: '青葉区', url: 'https://assets.cms.plateau.reearth.io/assets/ec/e80d4a-8b3a-4f88-ae4e-d29c9f3e9647/04100_sendai-shi_city_2024_citygml_1_op_bldg_3dtiles_04101_aoba-ku_lod1/tileset.json' },
  { code: '04102', name: '宮城野区', url: 'https://assets.cms.plateau.reearth.io/assets/09/6daefd-ecfb-4b0a-b95d-f5b4e6fd61ad/04100_sendai-shi_city_2024_citygml_1_op_bldg_3dtiles_04102_miyagino-ku_lod1/tileset.json' },
  { code: '04103', name: '若林区', url: 'https://assets.cms.plateau.reearth.io/assets/35/d17bce-10fb-42b7-a31d-b6a37c55ed90/04100_sendai-shi_city_2024_citygml_1_op_bldg_3dtiles_04103_wakabayashi-ku_lod1/tileset.json' },
  { code: '04104', name: '太白区', url: 'https://assets.cms.plateau.reearth.io/assets/1a/082bec-f0d3-45b7-b7ce-94c9c9411928/04100_sendai-shi_city_2024_citygml_1_op_bldg_3dtiles_04104_taihaku-ku_lod1/tileset.json' },
  { code: '04105', name: '泉区', url: 'https://assets.cms.plateau.reearth.io/assets/09/3f6e4d-272f-4177-b027-aa69735f5e02/04100_sendai-shi_city_2024_citygml_1_op_bldg_3dtiles_04105_izumi-ku_lod1/tileset.json' },
];

export const NIIGATA_WARDS: { code: string; name: string; url: string }[] = [
  { code: '15101', name: '北区', url: 'https://assets.cms.plateau.reearth.io/assets/a9/773598-8295-4d57-bb22-e61fcd730955/15100_niigata-shi_city_2023_citygml_2_op_bldg_3dtiles_15101_kita-ku_lod1/tileset.json' },
  { code: '15102', name: '東区', url: 'https://assets.cms.plateau.reearth.io/assets/3a/e33abf-f354-4cf1-a931-9004b12bf4d5/15100_niigata-shi_city_2023_citygml_2_op_bldg_3dtiles_15102_higashi-ku_lod1/tileset.json' },
  { code: '15103', name: '中央区', url: 'https://assets.cms.plateau.reearth.io/assets/cd/f0bfa1-f657-450a-b463-5b974eaee9de/15100_niigata-shi_city_2023_citygml_2_op_bldg_3dtiles_15103_chuo-ku_lod1/tileset.json' },
  { code: '15104', name: '江南区', url: 'https://assets.cms.plateau.reearth.io/assets/a0/4c02e1-691b-4395-bf8e-50156e43dbbe/15100_niigata-shi_city_2023_citygml_2_op_bldg_3dtiles_15104_konan-ku_lod1/tileset.json' },
  { code: '15105', name: '秋葉区', url: 'https://assets.cms.plateau.reearth.io/assets/7e/4446eb-89a4-415c-bfb9-59ac2fa80948/15100_niigata-shi_city_2023_citygml_2_op_bldg_3dtiles_15105_akiha-ku_lod1/tileset.json' },
  { code: '15106', name: '南区', url: 'https://assets.cms.plateau.reearth.io/assets/89/58dd2a-cc69-4d54-a3dd-19c72af360f5/15100_niigata-shi_city_2023_citygml_2_op_bldg_3dtiles_15106_minami-ku_lod1/tileset.json' },
  { code: '15107', name: '西区', url: 'https://assets.cms.plateau.reearth.io/assets/90/b413ee-0b40-40f0-8ade-39f8b3946e5f/15100_niigata-shi_city_2023_citygml_2_op_bldg_3dtiles_15107_nishi-ku_lod1/tileset.json' },
  { code: '15108', name: '西蒲区', url: 'https://assets.cms.plateau.reearth.io/assets/7f/8f7c27-bf2b-45c9-86d0-54991a94023a/15100_niigata-shi_city_2023_citygml_2_op_bldg_3dtiles_15108_nishikan-ku_lod1/tileset.json' },
];

export const OSAKA_WARDS: { code: string; name: string; url: string }[] = [
  { code: '27102', name: '都島区', url: 'https://assets.cms.plateau.reearth.io/assets/ea/520f01-415e-424f-a973-6a35856e6430/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27102_miyakojima-ku_lod1/tileset.json' },
  { code: '27103', name: '福島区', url: 'https://assets.cms.plateau.reearth.io/assets/db/dadcf8-1214-4161-bf22-a60d9142cfc7/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27103_fukushima-ku_lod1/tileset.json' },
  { code: '27104', name: '此花区', url: 'https://assets.cms.plateau.reearth.io/assets/4c/7f47b0-6ff9-41ce-92b4-b2dbeb3be119/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27104_konohana-ku_lod1/tileset.json' },
  { code: '27106', name: '西区', url: 'https://assets.cms.plateau.reearth.io/assets/37/00bcbf-5b8c-49be-9c89-76a68507aa61/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27106_nishi-ku_lod1/tileset.json' },
  { code: '27107', name: '港区', url: 'https://assets.cms.plateau.reearth.io/assets/58/e2ff4e-4afe-40d9-97ff-f12371127bb9/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27107_minato-ku_lod1/tileset.json' },
  { code: '27108', name: '大正区', url: 'https://assets.cms.plateau.reearth.io/assets/06/2458e8-5ace-4b51-9f99-c4a048852a11/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27108_taisho-ku_lod1/tileset.json' },
  { code: '27109', name: '天王寺区', url: 'https://assets.cms.plateau.reearth.io/assets/84/435ce6-00dd-47fe-87db-19958af5a6ac/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27109_tennoji-ku_lod1/tileset.json' },
  { code: '27111', name: '浪速区', url: 'https://assets.cms.plateau.reearth.io/assets/01/9e98f9-121f-4a18-80c8-32b2c3fc071c/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27111_naniwa-ku_lod1/tileset.json' },
  { code: '27113', name: '西淀川区', url: 'https://assets.cms.plateau.reearth.io/assets/87/d206f3-29c6-4b1e-8135-08f9a9a870a3/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27113_nishiyodogawa-ku_lod1/tileset.json' },
  { code: '27114', name: '東淀川区', url: 'https://assets.cms.plateau.reearth.io/assets/ba/a16b05-652a-491b-9e0e-b3550398e65f/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27114_higashiyodogawa-ku_lod1/tileset.json' },
  { code: '27115', name: '東成区', url: 'https://assets.cms.plateau.reearth.io/assets/0e/c24fa1-af58-48c9-bf24-63bc58daaaf1/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27115_higashinari-ku_lod1/tileset.json' },
  { code: '27116', name: '生野区', url: 'https://assets.cms.plateau.reearth.io/assets/4a/9f6675-d430-4170-8a40-df8308ee9984/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27116_ikuno-ku_lod1/tileset.json' },
  { code: '27117', name: '旭区', url: 'https://assets.cms.plateau.reearth.io/assets/25/e6ec51-85da-4133-b595-91a1dca16fea/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27117_asahi-ku_lod1/tileset.json' },
  { code: '27118', name: '城東区', url: 'https://assets.cms.plateau.reearth.io/assets/bb/0993c8-e192-458b-8c87-bd507f7d811a/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27118_joto-ku_lod1/tileset.json' },
  { code: '27119', name: '阿倍野区', url: 'https://assets.cms.plateau.reearth.io/assets/43/2982ec-f91c-4d81-a70f-d13c997f520a/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27119_abeno-ku_lod1/tileset.json' },
  { code: '27120', name: '住吉区', url: 'https://assets.cms.plateau.reearth.io/assets/48/116eb6-d434-4920-9de1-5951e53b099e/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27120_sumiyoshi-ku_lod1/tileset.json' },
  { code: '27121', name: '東住吉区', url: 'https://assets.cms.plateau.reearth.io/assets/e6/22e19a-e2d1-4334-8b5c-85eb5401c0ce/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27121_higashisumiyoshi-ku_lod1/tileset.json' },
  { code: '27122', name: '西成区', url: 'https://assets.cms.plateau.reearth.io/assets/33/62510b-6c6f-4937-94d4-777874906ac8/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27122_nishinari-ku_lod1/tileset.json' },
  { code: '27123', name: '淀川区', url: 'https://assets.cms.plateau.reearth.io/assets/da/6340ff-d3c4-4e15-8577-975d0ba44446/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27123_yodogawa-ku_lod1/tileset.json' },
  { code: '27124', name: '鶴見区', url: 'https://assets.cms.plateau.reearth.io/assets/2c/2d107b-375a-49c9-8877-106ed53db820/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27124_tsurumi-ku_lod1/tileset.json' },
  { code: '27125', name: '住之江区', url: 'https://assets.cms.plateau.reearth.io/assets/74/4f2272-b0ef-4742-bb22-f9f97ef662cf/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27125_suminoe-ku_lod1/tileset.json' },
  { code: '27126', name: '平野区', url: 'https://assets.cms.plateau.reearth.io/assets/de/f68892-cd4e-476e-899e-7a9818f41fee/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27126_hirano-ku_lod1/tileset.json' },
  { code: '27127', name: '北区', url: 'https://assets.cms.plateau.reearth.io/assets/73/bc9017-e521-43f2-8777-2837eefd9795/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27127_kita-ku_lod1/tileset.json' },
  { code: '27128', name: '中央区', url: 'https://assets.cms.plateau.reearth.io/assets/6e/cc10bb-07ec-4f6c-949d-aaace115b581/27100_osaka-shi_city_2025_citygml_1_op_bldg_3dtiles_27128_chuo-ku_lod1/tileset.json' },
];

export const HIROSHIMA_WARDS: { code: string; name: string; url: string }[] = [
  { code: '34101', name: '中区', url: 'https://assets.cms.plateau.reearth.io/assets/9b/776f13-5dfc-4fc9-b358-2cf7a1067cc7/34100_hiroshima-shi_city_2024_citygml_1_op_bldg_3dtiles_34101_naka-ku_lod1/tileset.json' },
  { code: '34102', name: '東区', url: 'https://assets.cms.plateau.reearth.io/assets/2e/6ce2b3-3e5d-4ad3-8c51-f4dec384245e/34100_hiroshima-shi_city_2024_citygml_1_op_bldg_3dtiles_34102_higashi-ku_lod1/tileset.json' },
  { code: '34103', name: '南区', url: 'https://assets.cms.plateau.reearth.io/assets/1d/4cda01-9592-4d65-a8e7-c1388fde31c7/34100_hiroshima-shi_city_2024_citygml_1_op_bldg_3dtiles_34103_minami-ku_lod1/tileset.json' },
  { code: '34104', name: '西区', url: 'https://assets.cms.plateau.reearth.io/assets/d3/c2581a-3e4d-4c8a-8720-0df22205699b/34100_hiroshima-shi_city_2024_citygml_1_op_bldg_3dtiles_34104_nishi-ku_lod1/tileset.json' },
  { code: '34105', name: '安佐南区', url: 'https://assets.cms.plateau.reearth.io/assets/0e/46ea83-788b-4c95-ad2d-d36928bfd400/34100_hiroshima-shi_city_2024_citygml_1_op_bldg_3dtiles_34105_asaminami-ku_lod1/tileset.json' },
  { code: '34106', name: '安佐北区', url: 'https://assets.cms.plateau.reearth.io/assets/17/f525fd-6bd6-4fe4-92c0-e37a9a89f1fe/34100_hiroshima-shi_city_2024_citygml_1_op_bldg_3dtiles_34106_asakita-ku_lod1/tileset.json' },
  { code: '34107', name: '安芸区', url: 'https://assets.cms.plateau.reearth.io/assets/82/266468-654b-458d-a58b-406303515108/34100_hiroshima-shi_city_2024_citygml_1_op_bldg_3dtiles_34107_aki-ku_lod1/tileset.json' },
  { code: '34108', name: '佐伯区', url: 'https://assets.cms.plateau.reearth.io/assets/a1/c93261-c42f-4019-aaf5-a6d8f4b7c16d/34100_hiroshima-shi_city_2024_citygml_1_op_bldg_3dtiles_34108_saeki-ku_lod1/tileset.json' },
];

export const FUKUOKA_WARDS: { code: string; name: string; url: string }[] = [
  { code: '40131', name: '東区', url: 'https://assets.cms.plateau.reearth.io/assets/d2/833c4a-acbd-476c-8fe7-c0cde4d9d579/40130_fukuoka-shi_city_2024_citygml_2_op_bldg_3dtiles_40131_higashi-ku_lod1/tileset.json' },
  { code: '40132', name: '博多区', url: 'https://assets.cms.plateau.reearth.io/assets/19/b41be6-0ae1-4e9a-90b6-fe059b4d1ade/40130_fukuoka-shi_city_2024_citygml_2_op_bldg_3dtiles_40132_hakata-ku_lod1/tileset.json' },
  { code: '40133', name: '中央区', url: 'https://assets.cms.plateau.reearth.io/assets/39/0650bd-2980-4f07-8a33-ec9908ba8f80/40130_fukuoka-shi_city_2024_citygml_2_op_bldg_3dtiles_40133_chuo-ku_lod1/tileset.json' },
  { code: '40134', name: '南区', url: 'https://assets.cms.plateau.reearth.io/assets/c4/b21110-51c3-4e3b-9e72-7bdbfdd45a41/40130_fukuoka-shi_city_2024_citygml_2_op_bldg_3dtiles_40134_minami-ku_lod1/tileset.json' },
  { code: '40135', name: '西区', url: 'https://assets.cms.plateau.reearth.io/assets/2a/710dae-225a-4d0b-b144-c0af9b121609/40130_fukuoka-shi_city_2024_citygml_2_op_bldg_3dtiles_40135_nishi-ku_lod1/tileset.json' },
  { code: '40136', name: '城南区', url: 'https://assets.cms.plateau.reearth.io/assets/c2/716542-908e-46dc-958e-3670dc503372/40130_fukuoka-shi_city_2024_citygml_2_op_bldg_3dtiles_40136_jonan-ku_lod1/tileset.json' },
  { code: '40137', name: '早良区', url: 'https://assets.cms.plateau.reearth.io/assets/d4/f3cdf5-d809-4f78-97c8-26d5b8874d2b/40130_fukuoka-shi_city_2024_citygml_2_op_bldg_3dtiles_40137_sawara-ku_lod1/tileset.json' },
];
