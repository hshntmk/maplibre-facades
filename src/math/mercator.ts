// MapLibre と同じ定義のメルカトル座標（0..1）

export const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8;

export const mercatorX = (lng: number): number => (180 + lng) / 360;

export const mercatorY = (lat: number): number =>
  (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;

/** 緯度 lat における 1m のメルカトル単位 */
export const meterInMercator = (lat: number): number => 1 / EARTH_CIRCUMFERENCE / Math.cos((lat * Math.PI) / 180);
