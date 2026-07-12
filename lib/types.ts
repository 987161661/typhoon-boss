export type BossRating = "微风级" | "暴雨级" | "台风级" | "强台风级" | "天灾级";

export type StormStage = "热带低压" | "热带风暴" | "强热带风暴" | "台风" | "强台风" | "超强台风";

export type DefenseStatus = "安全区" | "观察区" | "外围雨带区" | "核心风圈区";

export interface TrackPoint {
  time: string;
  lat: number;
  lon: number;
  wind: number;
  pressure: number;
  /** Provider-supplied location text. Never reverse-geocoded by this app. */
  locationDescription?: string;
}

export type ForecastPoint = TrackPoint;

export interface WindRadiiQuadrants {
  ne: number;
  se: number;
  sw: number;
  nw: number;
}

export interface WindRadiusLevel extends WindRadiiQuadrants {
  max: number;
}

export interface ForecastScenario {
  id: string;
  agency: string;
  agencyCode: string;
  points: ForecastPoint[];
  isPrimary: boolean;
}

export interface StormSkill {
  name: string;
  detail: string;
  severity: number;
}

export interface StormLandfall {
  time: string;
  place: string;
  lat: number;
  lon: number;
  note?: string;
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
    quadrants: {
      r7: WindRadiusLevel;
      r10: WindRadiusLevel;
      r12: WindRadiusLevel;
    };
  };
  /** Last provider-published radius for each level; historical, not current. */
  windRadiiReports?: {
    r7: WindRadiusReport | null;
    r10: WindRadiusReport | null;
    r12: WindRadiusReport | null;
  };
  track: TrackPoint[];
  forecast: ForecastPoint[];
  forecastScenarios: ForecastScenario[];
  /** Officially published landfall notices from the track provider. */
  landfalls: StormLandfall[];
  skills: StormSkill[];
  notice: string;
}

export interface WindRadiusReport extends WindRadiusLevel {
  observedAt: string;
  position: { lat: number; lon: number };
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
  lifecycle: {
    startedAt: string | null;
    endedAt: string | null;
    durationHours: number | null;
    origin: DexTrackPoint | null;
    finalPosition: DexTrackPoint | null;
  };
  track: DexTrackPoint[];
  landfalls: DexLandfall[];
  impactData: {
    formationCause: string | null;
    affectedWindow: string | null;
    directEconomicLoss: string | null;
    sourceNote: string;
    gdacs?: {
      alertLevel: string;
      countries: string[];
      severity: string;
      sourceUrl: string;
      from: string;
      to: string;
    };
  };
}

export interface DexTrackPoint {
  time: string;
  lat: number;
  lon: number;
  wind: number;
  pressure: number;
  windRadiusKm: number;
}

export interface DexLandfall {
  time: string;
  place: string;
  lat: number;
  lon: number;
  note?: string;
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
  globalTileUrl?: string | null;
  globalImageUrl?: string | null;
  globalProduct?: string;
  globalUpdatedAt?: string;
  globalBounds?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  synchronizedAt?: string;
  synchronizationSkewMinutes?: number;
  referenceUpdatedAt?: string;
  referenceSkewMinutes?: number;
  refreshIntervalMinutes?: number;
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
  nativeResolutionDegrees?: number;
  displayResolutionDegrees?: number;
  cycle?: string;
  isStale?: boolean;
  lastSuccessfulAt?: string;
  sampling?: "storm" | "viewport";
  coverage?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

export interface RadarMosaicLayerPayload extends EnvironmentLayerMeta {
  imageUrl: string | null;
  product: string;
  isStale: boolean;
  refreshIntervalMinutes: number;
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

export type GfsScalarLayerId = "pressure" | "precipitation" | "gust" | "reflectivity" | "precipitable-water";

export interface GfsScalarPoint {
  lon: number;
  lat: number;
  value: number;
}

export interface GfsScalarLayerPayload extends EnvironmentLayerMeta {
  layer: GfsScalarLayerId;
  label: string;
  model: string;
  unit: "hPa" | "mm/h" | "m/s" | "dBZ" | "mm";
  points: GfsScalarPoint[];
  nativeResolutionDegrees: number;
  displayResolutionDegrees: number;
  cycle: string;
  isStale?: boolean;
  lastSuccessfulAt?: string;
  sampling: "viewport";
  coverage: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

export interface GfsWavePoint {
  lon: number;
  lat: number;
  heightM: number;
  directionDeg: number;
  periodS?: number;
}

export interface GfsWaveLayerPayload extends EnvironmentLayerMeta {
  model: string;
  unit: "m";
  points: GfsWavePoint[];
  nativeResolutionDegrees: number;
  displayResolutionDegrees: number;
  cycle: string;
  sampling: "viewport";
  coverage: { west: number; south: number; east: number; north: number };
  isStale?: boolean;
}

export interface EcmwfTrackPoint {
  stepHours: number;
  time: string;
  lat: number;
  lon: number;
  pressurePa: number | null;
}

export interface EcmwfTrackMember {
  member: number;
  points: EcmwfTrackPoint[];
}

export interface EcmwfStormTrack {
  stormIdentifier: string;
  baseTime: string;
  members: EcmwfTrackMember[];
}

export interface EcmwfTrackPayload extends EnvironmentLayerMeta {
  cycle: string;
  deterministic: EcmwfStormTrack[];
  ensemble: EcmwfStormTrack[];
  isStale?: boolean;
}

export interface OfficialWeatherAlert {
  id: string;
  source: "CWA" | "HKO";
  title: string;
  description?: string;
  issuedAt: string;
  expiresAt?: string;
  code?: string;
}

export interface OfficialAlertPayload extends EnvironmentLayerMeta {
  alerts: OfficialWeatherAlert[];
  tide?: {
    station: string;
    date: string;
    unit: "m";
    hourly: Array<{ hour: number; heightM: number }>;
    note: string;
  };
}

export interface RegionalObservationPoint {
  id: string;
  kind: "station" | "buoy" | "lightning";
  name: string;
  lon: number;
  lat: number;
  observedAt?: string;
  windSpeed?: number;
  gustSpeed?: number;
  pressureHpa?: number;
  rainMm?: number;
  temperatureC?: number;
  intensityKa?: number;
}

export interface RegionalObservationPayload extends EnvironmentLayerMeta {
  points: RegionalObservationPoint[];
}

export interface ImpactAreaPayload extends EnvironmentLayerMeta {
  stormId: string | null;
  stormName: string | null;
  featureCount: number;
  areas: GeoJSON.FeatureCollection;
}
