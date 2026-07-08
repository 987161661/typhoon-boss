import type { FeatureCollection, Polygon } from "geojson";

const box = (name: string, west: number, south: number, east: number, north: number) => ({
  type: "Feature" as const,
  properties: { name },
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south]
      ]
    ]
  }
});

export const provinceGeoJson: FeatureCollection<Polygon, { name: string }> = {
  type: "FeatureCollection",
  features: [
    box("浙江省", 118.0, 27.0, 122.8, 31.3),
    box("上海市", 120.8, 30.6, 122.2, 31.9),
    box("福建省", 116.0, 23.5, 120.8, 28.5),
    box("江苏省", 116.5, 31.0, 122.3, 35.2),
    box("山东省", 114.8, 34.3, 122.8, 38.6),
    box("广东省", 109.5, 20.0, 117.4, 25.6),
    box("台湾省", 120.0, 21.8, 122.2, 25.5),
    box("安徽省", 114.8, 29.4, 119.8, 34.7),
    box("江西省", 113.5, 24.4, 118.5, 30.1),
    box("海南省", 108.6, 18.0, 111.2, 20.2)
  ]
};

export function makeCircle(lon: number, lat: number, radiusKm: number, points = 128) {
  const coordinates: [number, number][] = [];
  const latRadius = radiusKm / 111;
  const lonRadius = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    coordinates.push([lon + Math.cos(angle) * lonRadius, lat + Math.sin(angle) * latRadius]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Polygon" as const,
      coordinates: [coordinates]
    }
  };
}
