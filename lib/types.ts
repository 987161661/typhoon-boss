export type BossRating = "微风级" | "暴雨级" | "台风级" | "强台风级" | "天灾级";

export type StormStage = "热带低压" | "热带风暴" | "强热带风暴" | "台风" | "强台风" | "超强台风";

export type DefenseStatus = "安全区" | "观察区" | "外围雨带区" | "核心风圈区";

export interface TrackPoint {
  time: string;
  lat: number;
  lon: number;
  wind: number;
  pressure: number;
}

export interface ForecastPoint extends TrackPoint {
  probability: number;
}

export interface StormSkill {
  name: string;
  detail: string;
  severity: number;
}

export interface Storm {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  stage: StormStage;
  rating: BossRating;
  status: string;
  position: {
    lat: number;
    lon: number;
  };
  maxWind: number;
  minPressure: number;
  moveDirection: string;
  moveSpeed: number;
  updatedAt: string;
  windRadiiKm: {
    r7: number;
    r10: number;
    r12: number;
  };
  track: TrackPoint[];
  forecast: ForecastPoint[];
  skills: StormSkill[];
  notice: string;
}

export interface ProvinceDefenseStatus {
  province: string;
  status: DefenseStatus;
  rating: BossRating;
  distanceKm: number;
  riskLine: string;
  advice: string;
  banter: string;
}

export interface DexEntry {
  id: string;
  year: number;
  nameZh: string;
  nameEn: string;
  rating: BossRating;
  stage: StormStage;
  retired: boolean;
  replacement?: string;
  maxWind: number;
  minPressure: number;
  summary: string;
  tags: string[];
}

export type EnvironmentLayerStatus = "available" | "unavailable";

export interface EnvironmentLayerMeta {
  source: string;
  updatedAt: string;
  status: EnvironmentLayerStatus;
  attribution: string;
  reason?: string;
}

export interface SatelliteLayerPayload extends EnvironmentLayerMeta {
  imageUrl: string | null;
  remoteImageUrl?: string;
  product: string;
  isStale: boolean;
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

export interface WindFieldPoint {
  lon: number;
  lat: number;
  u: number;
  v: number;
  speed: number;
  direction: number;
}

export interface WindFieldPayload extends EnvironmentLayerMeta {
  model: string;
  unit: "m/s";
  points: WindFieldPoint[];
}

export interface ImpactAreaPayload extends EnvironmentLayerMeta {
  stormId: string | null;
  stormName: string | null;
  featureCount: number;
  areas: GeoJSON.FeatureCollection;
}
