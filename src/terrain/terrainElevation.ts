import type { Map as MapLibreMap } from 'maplibre-gl';

/** 地形の標高を引く関数。地形がない・使わないときは undefined */
export function terrainElevation(map: MapLibreMap): ((lng: number, lat: number) => number | null) | undefined {
  if (!map.getTerrain()) return undefined;
  const point: [number, number] = [0, 0];
  return (lng, lat) => {
    point[0] = lng;
    point[1] = lat;
    return map.queryTerrainElevation(point);
  };
}
