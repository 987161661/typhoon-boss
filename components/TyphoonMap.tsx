"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent
} from "react";
import maplibregl, { type ImageSource, type Map as MapLibreMap } from "maplibre-gl";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Database, Palette, RadioTower, Satellite, Settings2, Shield, Wind } from "lucide-react";
import Link from "next/link";
import { makeCircle } from "@/lib/provinceGeo";
import { createStormVisualCanvas } from "@/lib/stormVisualRenderer";
import { alignStormToWindCenter, buildGfsAnalysisCenterMarkerModels, buildStormFleetGeo, FORECAST_ROUTE_COLORS, selectCanonicalStormWindField, stormFleetBounds, stormTrackColor, windFieldMatchesStorm, type GfsAnalysisCenterMarkerModel } from "@/lib/stormFleet";
import { cycloneTangentialSign, cycloneVisualKinematics } from "@/lib/stormKinematics";
import {
  createCompositeWindVectorIndex,
  mergeWindVectorPoints,
  sampleCompositeWindVector,
  windFieldsShareFrame,
  type CompositeWindVectorIndex
} from "@/lib/windVectorGrid";
import {
  createHierarchicalWindSeeds,
  planWindParticlePoolReconciliation,
  stableWindHash,
  type StableWindSeed,
} from "@/lib/windParticleSeeding";
import { computeWindFlowPolicy, trimWindTrailToPixelLength, type WindFlowPolicy } from "@/lib/windFlowPolicy";
import type { BossProfile } from "@/lib/bossEngine/types";
import { useRadarSnapshot } from "./useRadarSnapshot";
import type {
  GfsScalarLayerId,
  GfsScalarLayerPayload,
  GfsWaveLayerPayload,
  MarinePoint,
  MarineLayerPayload,
  EcmwfStormTrack,
  EcmwfTrackPayload,
  OfficialAlertPayload,
  RegionalObservationPayload,
  ImpactAreaPayload,
  ForecastScenario,
  ProvinceDefenseStatus,
  RadarMosaicLayerPayload,
  SatelliteLayerPayload,
  Storm,
  WindFieldPayload,
  WindFieldPoint
} from "@/lib/types";
import { DefenseDrawer } from "./DefenseDrawer";
import { useStormCoreWindField, useViewportWindField } from "./map/useViewportWindField";
import { useViewportGfsLayer, useViewportGridLayer } from "./map/useViewportGfsLayer";
import { usePollingEnvironmentLayer } from "./map/usePollingEnvironmentLayer";
import { installTyphoonStormLayer, removeTyphoonStormLayer, updateTyphoonStormLayer } from "./map/TyphoonStormLayer";
import { NationalEventLayer } from "./map/NationalEventLayer";
import { NationalMapModeControl } from "./map/NationalMapModeControl";
import { NationalRadarPlayback } from "./map/NationalRadarPlayback";
import {
  NATIONAL_CAMERA,
  activeStormIndexForMap,
  createNationalMapState,
  reduceNationalMapState,
  selectedStormForMap
} from "./map/nationalMapState";
import { NationalSituationHud } from "./NationalSituationHud";
import { FutureWeatherArchivePanel } from "./FutureWeatherArchivePanel";
import nationalRailStyles from "./NationalSituationRail.module.css";
import { useNationalSituation, type NationalSituationState } from "./useNationalSituation";
import { HudPanel, StatusPill } from "./HudPrimitives";
import { BossSkillSlotPanel, IntelPanel } from "./IntelPanel";
import type { CityAttention, CityAttentionAnchor } from "@/lib/liveCityInteraction";
import {
  buildLiveBroadcastModel,
  LiveAudiencePanel,
  LiveBottomBar,
  LiveForecastOverlay,
  LiveIntelPanel,
  LiveTopBar,
  type LiveDeckView
} from "./LiveBroadcastView";

const MAP_STYLE = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      // Standard OSM raster uses each place's local `name` tag. In China this
      // keeps city and district labels Chinese without introducing GCJ-02
      // offsets from a commercial China-only basemap.
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "OpenStreetMap, CARTO"
    },
    terrainDem: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      encoding: "terrarium",
      attribution: "AWS Terrain Tiles"
    },
    terrainColor: {
      type: "raster",
      tiles: ["/api/terrain-color/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 3,
      maxzoom: 6,
      attribution: "AWS Terrain Tiles"
    },
    landMask: {
      type: "geojson",
      data: "/data/ne_110m_land.geojson",
      attribution: "Natural Earth"
    },
    oceanMask: {
      type: "geojson",
      data: "/data/ne_110m_ocean.geojson",
      attribution: "Natural Earth"
    }
  },
  layers: [
    {
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: {
        "raster-saturation": 0.18,
        "raster-brightness-min": 0.06,
        "raster-brightness-max": 0.96,
        "raster-contrast": 0.1,
        // Avoid compositing two full tile sets during wheel zoom. Camera
        // response matters more here than a decorative tile cross-fade.
        "raster-fade-duration": 0
      }
    },
    {
      id: "terrain-color",
      type: "raster",
      source: "terrainColor",
      paint: {
        "raster-opacity": 0.9,
        "raster-saturation": 0.22,
        "raster-contrast": 0.08,
        "raster-fade-duration": 0,
        "raster-resampling": "linear"
      }
    },
    {
      id: "terrain-hillshade",
      type: "hillshade",
      source: "terrainDem",
      paint: {
        "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 3, 0.18, 5, 0.36, 8, 0.52],
        "hillshade-shadow-color": "rgba(39, 28, 18, 0.48)",
        "hillshade-highlight-color": "rgba(255, 244, 194, 0.34)",
        "hillshade-accent-color": "rgba(116, 87, 42, 0.28)",
        "hillshade-illumination-direction": 315
      }
    },
    {
      id: "ocean-terrain-mute",
      type: "fill",
      source: "oceanMask",
      paint: {
        "fill-color": "#6fc6df",
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.7, 5, 0.64, 8, 0.56]
      }
    },
    {
      id: "land-relief-contrast",
      type: "fill",
      source: "landMask",
      paint: {
        "fill-color": "#d7b66a",
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.08, 5, 0.12, 8, 0.16]
      }
    }
  ]
} as maplibregl.StyleSpecification;

const CANVAS_DPR_CAP = 1.5;
const REGIONAL_SATELLITE_SOURCE_ID = "regional-satellite-source";
const REGIONAL_SATELLITE_LAYER_ID = "regional-satellite-layer";
const GLOBAL_SATELLITE_SOURCE_ID = "global-satellite-source";
const GLOBAL_SATELLITE_LAYER_ID = "global-satellite-layer";
const CWA_RADAR_SOURCE_ID = "cwa-radar-source";
const CWA_RADAR_LAYER_ID = "cwa-radar-layer";
const regionalSatelliteImageUrls = new WeakMap<MapLibreMap, string>();
const globalSatelliteImageUrls = new WeakMap<MapLibreMap, string>();
const cwaRadarImageUrls = new WeakMap<MapLibreMap, string>();
let windFlowRendererSequence = 0;

const DEFENSE_REGION_SHORT_NAMES = ["浙江", "福建", "广东", "上海", "江苏"] as const;

const DEFAULT_REGION_LABELS: MapRegionLabel[] = [];
const CHINA_LABEL_FOCUS_POLYGON: ReadonlyArray<readonly [number, number]> = [
  [72, 40], [79, 29], [88, 27], [97, 21], [108, 17], [122, 18],
  [126, 28], [135, 48], [126, 54], [96, 50], [82, 47]
];

type RadarTheme = "night-radar" | "archive-command";
export type RadarView = "standard" | "live";
type WindRenderMode = "gfs" | "streamlines";

type EnvironmentLayerKey = "satellite" | "impact" | "wind" | "marineCurrent" | "seaSurfaceTemperature";

type EnvironmentLayerToggles = Record<EnvironmentLayerKey, boolean>;

interface MapRegionLabel {
  id: string;
  zh: string;
  coordinate: [number, number];
}

interface ProvinceAlertPoint {
  name: string;
  center: [number, number];
}

interface DefenseResponse {
  defense: ProvinceDefenseStatus;
}

const DEFAULT_ENVIRONMENT_LAYERS: EnvironmentLayerToggles = {
  satellite: true,
  impact: true,
  wind: true,
  marineCurrent: false,
  seaSurfaceTemperature: false
};

export function TyphoonMap({
  view = "standard",
  liveDeck = "briefing",
  cityAttention = null,
  onCityAttentionAnchor,
  onSceneReady
}: {
  view?: RadarView;
  liveDeck?: LiveDeckView;
  cityAttention?: CityAttention | null;
  onCityAttentionAnchor?: (anchor: CityAttentionAnchor | null) => void;
  onSceneReady?: () => void;
}) {
  const isLiveView = view === "live";
  const secondsToSwitch = 0;
  const liveDeckCycle = 0;
  const [storms, setStorms] = useState<Storm[]>([]);
  const [bossProfiles, setBossProfiles] = useState<BossProfile[]>([]);
  const [nationalMapState, dispatchNationalMap] = useReducer(
    reduceNationalMapState,
    undefined,
    () => createNationalMapState()
  );
  const [theme, setTheme] = useState<RadarTheme>("night-radar");
  const [selectedDefense, setSelectedDefense] = useState<ProvinceDefenseStatus | null>(null);
  const [sourceLabel, setSourceLabel] = useState("浙江省水利厅台风路径公开接口");
  const [lastUpdated, setLastUpdated] = useState("等待刷新");
  const [dataError, setDataError] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapRegionLabels, setMapRegionLabels] = useState<MapRegionLabel[]>(DEFAULT_REGION_LABELS);
  const [environmentLayers, setEnvironmentLayers] = useState<EnvironmentLayerToggles>(DEFAULT_ENVIRONMENT_LAYERS);
  // The operational default is a station-style, decoded view. Flow animation
  // remains available, but is intentionally an opt-in model visualisation.
  const [windRenderMode, setWindRenderMode] = useState<WindRenderMode>("streamlines");
  const [satelliteLayer, setSatelliteLayer] = useState<SatelliteLayerPayload | null>(null);
  const [windField, setWindField] = useState<WindFieldPayload | null>(null);
  const [gfsScalarLayer, setGfsScalarLayer] = useState<GfsScalarLayerId | null>(null);
  const [gfsWaveVisible, setGfsWaveVisible] = useState(false);
  const [ecmwfTracksVisible, setEcmwfTracksVisible] = useState(false);
  const [observationsVisible, setObservationsVisible] = useState(false);
  const [cwaRadarVisible, setCwaRadarVisible] = useState(false);
  const [nationalWarningsVisible, setNationalWarningsVisible] = useState(true);
  const [nationalRadarVisible, setNationalRadarVisible] = useState(false);
  const [impactArea, setImpactArea] = useState<ImpactAreaPayload | null>(null);
  const [watchRegions, setWatchRegions] = useState<ProvinceAlertPoint[]>([]);
  useEffect(() => {
    if (view === "live" || typeof window === "undefined") return;
    const requestedTheme = new URLSearchParams(window.location.search).get("theme");
    if (requestedTheme === "dossier" || requestedTheme === "archive-command") {
      setTheme("archive-command");
    }
    void fetch("/api/control-console", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const mapSettings = payload?.settings?.map;
        if (!mapSettings) return;
        if (!requestedTheme && (mapSettings.defaultTheme === "night-radar" || mapSettings.defaultTheme === "archive-command")) setTheme(mapSettings.defaultTheme);
        const layers = mapSettings.defaultLayers;
        if (layers && typeof layers === "object") setEnvironmentLayers({
          satellite: layers.satellite !== false,
          impact: layers.impact !== false,
          wind: mapSettings.performanceMode === "reduced" ? false : layers.wind !== false,
          marineCurrent: false,
          seaSurfaceTemperature: false
        });
      })
      .catch(() => undefined);
  }, [view]);
  const mapNode = useRef<HTMLDivElement | null>(null);
  const windColorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gfsScalarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gfsWaveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const marineCurrentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const marineCurrentInteractionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const seaSurfaceTemperatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const marineCurrentRef = useRef<WindFieldPayload | null>(null);
  const emptyWindFieldRef = useRef<WindFieldPayload | null>(null);
  const ecmwfTrackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const observationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const windCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const windInteractionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const forecastCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const gfsCenterMarkerRefs = useRef<Map<string, maplibregl.Marker>>(new Map());
  const fleetMarkerRefs = useRef<Map<string, maplibregl.Marker>>(new Map());
  const cityAttentionMarkerRef = useRef<maplibregl.Marker | null>(null);
  const cityAttentionElementRef = useRef<HTMLDivElement | null>(null);
  const cityCameraSnapshotRef = useRef<{ center: [number, number]; zoom: number; bearing: number; pitch: number } | null>(null);
  const cityAttentionRef = useRef<CityAttention | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const stormRef = useRef<Storm | null>(null);
  const stormsRef = useRef<Storm[]>([]);
  const cycloneCoreRef = useRef<CycloneCoreAnalysis | null>(null);
  const focusedStormIdRef = useRef<string | null>(null);
  const requestedStormId = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("stormId");
  // Live keeps its existing first-storm behavior while the standard map is
  // explicitly national-first. This avoids a one-frame standby flash before
  // the live compatibility selection effect runs.
  const activeIndex = isLiveView && nationalMapState.mode === "national"
    ? 0
    : activeStormIndexForMap(nationalMapState, storms);
  const storm = isLiveView && nationalMapState.mode === "national"
    ? storms[0] ?? null
    : selectedStormForMap(nationalMapState, storms);
  // Live decks are storm-specific.  When the upstream feed has no active
  // storm, the broadcast becomes a map-first environmental monitoring view.
  const showLiveStandbyEnvironment = isLiveView && !storm;
  const selectStorm = useCallback((index: number) => {
    const selectedId = storms[index]?.id;
    if (!selectedId) return;
    dispatchNationalMap({ type: "select-storm", stormId: selectedId });
    if (typeof window === "undefined" || view === "live") return;
    const url = new URL(window.location.href);
    url.searchParams.set("stormId", selectedId);
    window.history.replaceState(window.history.state, "", url);
  }, [storms, view]);
  const selectStormById = useCallback((stormId: string) => {
    const index = storms.findIndex((item) => item.id === stormId);
    if (index >= 0) selectStorm(index);
  }, [selectStorm, storms]);
  const returnToNational = useCallback(() => {
    dispatchNationalMap({ type: "return-national" });
    if (typeof window === "undefined" || view === "live") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("stormId");
    window.history.replaceState(window.history.state, "", url);
  }, [view]);
  const viewportBoundsForMap = useCallback((map: MapLibreMap) => visibleWindBounds(map, 0.08), []);
  const windRequestBoundsForMap = useCallback((map: MapLibreMap) => visibleWindBounds(map, 0.65), []);
  const windRequiredBoundsForMap = useCallback((map: MapLibreMap) => visibleWindBounds(map, 0.24), []);
  const viewportWindField = useViewportWindField({
    map: mapReady ? mapRef.current : null,
    enabled: mapReady && environmentLayers.wind,
    stormId: storm?.id,
    boundsForMap: windRequestBoundsForMap,
    requiredBoundsForMap: windRequiredBoundsForMap
  });
  const coreWindCenter = windFieldMatchesStorm(windField, storm)
    ? windField?.analysisCenter ?? storm?.position
    : storm?.position;
  const coreWindField = useStormCoreWindField({
    enabled: mapReady && environmentLayers.wind,
    stormId: storm?.id,
    center: coreWindCenter,
    refreshKey: windField?.updatedAt
  });
  const viewportGfsLayer = useViewportGfsLayer({
    map: mapReady ? mapRef.current : null,
    layer: gfsScalarLayer,
    boundsForMap: viewportBoundsForMap
  });
  const viewportGfsWave = useViewportGridLayer<GfsWaveLayerPayload>({
    map: mapReady ? mapRef.current : null,
    endpoint: "/api/environment/gfs-wave",
    enabled: gfsWaveVisible,
    boundsForMap: viewportBoundsForMap
  });
  const viewportMarineLayer = useViewportGridLayer<MarineLayerPayload>({
    map: mapReady ? mapRef.current : null,
    endpoint: "/api/environment/marine",
    enabled: mapReady && (environmentLayers.marineCurrent || environmentLayers.seaSurfaceTemperature),
    boundsForMap: viewportBoundsForMap,
    refreshIntervalMs: 30 * 60 * 1000
  });
  const marineCurrentField = useMemo<WindFieldPayload | null>(() => {
    if (viewportMarineLayer?.status !== "available") return null;
    const points = viewportMarineLayer.points.map((point) => ({
      lon: point.lon,
      lat: point.lat,
      u: point.currentU,
      v: point.currentV,
      speed: Math.hypot(point.currentU, point.currentV),
      direction: (Math.atan2(point.currentU, point.currentV) * 180) / Math.PI
    }));
    return {
      source: viewportMarineLayer.source,
      updatedAt: viewportMarineLayer.updatedAt,
      status: "available",
      attribution: viewportMarineLayer.attribution,
      model: viewportMarineLayer.model,
      unit: "m/s",
      points,
      nativeResolutionDegrees: viewportMarineLayer.nativeResolutionDegrees,
      displayResolutionDegrees: viewportMarineLayer.displayResolutionDegrees,
      sampling: "viewport",
      coverage: viewportMarineLayer.coverage,
      isStale: viewportMarineLayer.isStale
    };
  }, [viewportMarineLayer]);
  marineCurrentRef.current = marineCurrentField;
  const cwaRadarLayer = usePollingEnvironmentLayer<RadarMosaicLayerPayload>({
    url: "/api/environment/cwa-radar",
    intervalMs: 5 * 60 * 1000,
    enabled: !isLiveView || showLiveStandbyEnvironment
  });
  const ecmwfTrackLayer = usePollingEnvironmentLayer<EcmwfTrackPayload>({
    url: "/api/environment/ecmwf-tracks",
    intervalMs: 30 * 60 * 1000,
    // On the live standby deck this is an on-demand, cancellable layer. The
    // toggle is not merely cosmetic: turning it off aborts its active fetch
    // and stops the 30-minute polling loop.
    enabled: !isLiveView || (showLiveStandbyEnvironment && ecmwfTracksVisible)
  });
  const officialAlerts = usePollingEnvironmentLayer<OfficialAlertPayload>({
    url: "/api/environment/official-alerts",
    intervalMs: 5 * 60 * 1000,
    enabled: !isLiveView || showLiveStandbyEnvironment
  });
  const regionalObservations = usePollingEnvironmentLayer<RegionalObservationPayload>({
    url: "/api/environment/regional-observations",
    intervalMs: 5 * 60 * 1000,
    enabled: !isLiveView || showLiveStandbyEnvironment
  });
  const nationalSituation = useNationalSituation({ enabled: true });
  const focusNationalEvent = useCallback((eventId: string) => {
    const event = nationalSituation.snapshot?.events.find((candidate) => candidate.id === eventId);
    const center = event?.geography.centroid;
    const map = mapRef.current;
    if (!map || !center) return;
    map.easeTo({ center: [center.longitude, center.latitude], zoom: Math.max(map.getZoom(), 5.2), duration: 700 });
  }, [nationalSituation.snapshot]);
  const firstDeterministicCityEventId = useMemo(() => nationalSituation.snapshot?.events.find((event) =>
    event.geography.cityAttribution === "deterministic" && event.geography.cityCode !== null && event.geography.centroid !== null
  )?.id ?? null, [nationalSituation.snapshot]);
  const matchedEcmwfTracks = useMemo(() => matchEcmwfTracks(storm, ecmwfTrackLayer), [ecmwfTrackLayer, storm]);
  const activeWindField = viewportWindField ?? windField;
  // A viewport GFS field is valid without a tracked cyclone as long as it was
  // requested without a storm id.  The old storm-only guard hid those real
  // ambient vectors whenever the active-storm list became empty.
  const scopedActiveWindField = windFieldMatchesMapContext(activeWindField, storm) ? activeWindField : null;
  const windFieldSignature = useMemo(() => {
    if (scopedActiveWindField?.status !== "available") return `${storm?.id ?? "no-storm"};${scopedActiveWindField?.status ?? "pending"}`;
    return [
      scopedActiveWindField.stormId ?? "no-storm",
      scopedActiveWindField.source,
      scopedActiveWindField.updatedAt,
      scopedActiveWindField.points.length,
      scopedActiveWindField.displayResolutionDegrees ?? "unknown-resolution",
      scopedActiveWindField.coverage ? `${scopedActiveWindField.coverage.west}:${scopedActiveWindField.coverage.south}:${scopedActiveWindField.coverage.east}:${scopedActiveWindField.coverage.north}` : "unknown-coverage"
    ].join(";");
  }, [scopedActiveWindField, storm?.id]);
  const pendingWindFieldRef = useRef<WindFieldPayload | null>(scopedActiveWindField);
  const latestWindFieldRef = useRef<WindFieldPayload | null>(scopedActiveWindField);
  const latestCoreWindFieldRef = useRef<WindFieldPayload | null>(null);
  const [stableWindField, setStableWindField] = useState<WindFieldPayload | null>(scopedActiveWindField);
  pendingWindFieldRef.current = scopedActiveWindField;
  // Polling replaces payload objects every cycle. Only advance the renderer's
  // field when the actual vectors differ, so an unchanged snapshot cannot
  // reset every particle at once.
  useEffect(() => {
    latestWindFieldRef.current = pendingWindFieldRef.current;
    setStableWindField(pendingWindFieldRef.current);
  }, [windFieldSignature]);
  const stormWindField = windFieldMatchesMapContext(stableWindField, storm) ? stableWindField : null;
  const compatibleCoreWindField = windFieldsShareFrame(stormWindField, coreWindField) ? coreWindField : null;
  latestCoreWindFieldRef.current = compatibleCoreWindField;
  const canonicalStormWindField = useMemo(
    () => selectCanonicalStormWindField(storm, compatibleCoreWindField, windField),
    [compatibleCoreWindField, storm, windField]
  );
  const gfsAlignedStorm = useMemo(
    () => stormAtGfsAnalysisCenter(storm, canonicalStormWindField),
    [canonicalStormWindField, storm]
  );
  const {
    snapshot,
    error: snapshotError,
    fetchDurationMs: snapshotFetchDurationMs,
    loaded: snapshotLoaded,
    lastSyncedAt,
    refreshSequence,
    pollIntervalMs
  } = useRadarSnapshot(requestedStormId ?? storm?.id ?? null);
  const [showPerfOverlay] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("perf") === "1";
  });
  const bossProfile = useMemo(
    () => (storm ? bossProfiles.find((profile) => profile.stormId === storm.id) ?? null : null),
    [bossProfiles, storm]
  );
  const cycloneCoreAnalysis = useMemo(() => buildCycloneCoreAnalysis(storm, bossProfile), [storm, bossProfile]);
  const liveModel = useMemo(
    () =>
      buildLiveBroadcastModel({
        storm,
        bossProfile,
        sourceLabel,
        lastUpdated,
        lastSyncedAt,
        dataError,
        snapshotStale: snapshot?.cache.stale,
        satelliteLayer,
        lastTrackedStorm: snapshot?.lastTrackedStorm
      }),
    [storm, bossProfile, sourceLabel, lastUpdated, lastSyncedAt, dataError, snapshot?.cache.stale, snapshot?.lastTrackedStorm, satelliteLayer]
  );

  const stormGeo = useMemo(() => buildStormGeo(storm), [storm]);
  const stormFleetGeo = useMemo(() => buildStormFleetGeo(storms, storm?.id ?? null), [storm, storms]);
  const markerStorms = useMemo(
    () => storms.map((item) => {
      const recordedCenterStorm = alignStormToWindCenter(item, snapshot?.environment.windCenters?.[item.id]);
      if (item.id !== storm?.id) return recordedCenterStorm;
      return canonicalStormWindField?.analysisCenter
        ? gfsAlignedStorm ?? recordedCenterStorm
        : recordedCenterStorm;
    }),
    [canonicalStormWindField?.analysisCenter, gfsAlignedStorm, snapshot?.environment.windCenters, storm, storms]
  );
  const gfsAnalysisCenterMarkers = useMemo(
    () => buildGfsAnalysisCenterMarkerModels(
      storms,
      storm?.id ?? null,
      canonicalStormWindField,
      snapshot?.environment.windCenters
    ),
    [canonicalStormWindField, snapshot?.environment.windCenters, storm?.id, storms]
  );
  const officialWindRadiusFeatureCount = stormGeo.r7.features.length
    + stormGeo.r10.features.length
    + stormGeo.r12.features.length;
  const activeMarkerStorm = markerStorms.find((item) => item.id === storm?.id) ?? null;
  const provinceAlerts = useMemo(() => buildProvinceAlerts(storm, watchRegions), [storm, watchRegions]);
  const toggleEnvironmentLayer = useCallback((layer: EnvironmentLayerKey) => {
    setEnvironmentLayers((current) => ({
      ...current,
      [layer]: !current[layer]
    }));
  }, []);

  useEffect(() => {
    if (!snapshot && !snapshotLoaded) return;
    if (!snapshot) {
      setDataError(snapshotError ?? "实时台风接口暂时不可用");
      return;
    }

    setSourceLabel(snapshot.source);
    setLastUpdated(formatClock(snapshot.updatedAt));
    setStorms(snapshot.storms ?? []);
    setBossProfiles(snapshot.bosses ?? []);
    setSatelliteLayer(snapshot.environment.satellite);
    setWindField(snapshot.environment.windField);
    setImpactArea(snapshot.environment.impactArea);
    setDataError(snapshotError);
  }, [snapshot, snapshotError, snapshotLoaded]);

  useEffect(() => {
    if (!requestedStormId || storms.length === 0) return;
    const requestedIndex = storms.findIndex((item) => item.id === requestedStormId);
    if (requestedIndex >= 0 && nationalMapState.selectedStormId !== requestedStormId) {
      dispatchNationalMap({ type: "select-storm", stormId: requestedStormId });
    }
  }, [nationalMapState.selectedStormId, requestedStormId, storms]);

  useEffect(() => {
    if (isLiveView && nationalMapState.mode === "national" && storms[0]) {
      dispatchNationalMap({ type: "select-storm", stormId: storms[0].id });
      return;
    }
    dispatchNationalMap({ type: "reconcile-storms", stormIds: storms.map((item) => item.id) });
  }, [isLiveView, nationalMapState.mode, storms]);

  useEffect(() => {
    stormRef.current = storm;
    stormsRef.current = markerStorms;
  }, [markerStorms, storm]);

  useEffect(() => {
    cycloneCoreRef.current = cycloneCoreAnalysis;
  }, [cycloneCoreAnalysis]);

  useEffect(() => {
    if (isLiveView && mapReady && snapshotLoaded) onSceneReady?.();
  }, [isLiveView, mapReady, onSceneReady, snapshotLoaded]);

  const fetchDefense = useCallback(async (province: string) => {
    const query = new URLSearchParams({ province });
    if (stormRef.current?.id) query.set("stormId", stormRef.current.id);

    try {
      query.set("t", String(Date.now()));
      const response = await fetch(`/api/city-status?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("省份防御状态接口暂时不可用");
      const payload = (await response.json()) as DefenseResponse;
      setSelectedDefense(payload.defense);
    } catch {
      setSelectedDefense({
        province,
        status: "观察区" as ProvinceDefenseStatus["status"],
        rating: "狼级" as ProvinceDefenseStatus["rating"],
        distanceKm: 0,
        riskLine: "防御状态接口暂时没有返回数据。",
        advice: "请直接查看中央气象台和本地应急部门发布的信息。",
        banter: "情报链路断开，但官方预警仍是主线任务。"
      });
    }
  }, []);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    let resizeObserver: ResizeObserver | null = null;
    const fleetMarkers = fleetMarkerRefs.current;
    const gfsCenterMarkers = gfsCenterMarkerRefs.current;

    try {
      const map = new maplibregl.Map({
        container: mapNode.current,
        style: MAP_STYLE,
        center: NATIONAL_CAMERA.center,
        zoom: NATIONAL_CAMERA.zoom,
        minZoom: 3,
        maxZoom: 8,
        attributionControl: false
      });

      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      mapRef.current = map;
      // ResizeObserver runs before paint. Resizing immediately keeps the
      // MapLibre surface and every projected canvas in one coordinate space.
      resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(mapNode.current);

      map.on("load", async () => {
        const initialStorm = stormRef.current;
        renderStormOnMap(map, initialStorm, markerRef);
        const provinces = await fetchProvinceGeoJson();
        const geoLabels = buildMapRegionLabels(provinces);
        const geoWatchRegions = buildWatchRegions(provinces);
        setWatchRegions(geoWatchRegions);
        if (geoLabels.length > 0) setMapRegionLabels(geoLabels);
        map.addSource("provinces", { type: "geojson", data: provinces });
        map.addLayer({
          id: "province-fill",
          type: "fill",
          source: "provinces",
          paint: {
            "fill-color": "#46d68c",
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.2, 0.035]
          }
        });
        map.addLayer({
          id: "province-line",
          type: "line",
          source: "provinces",
          paint: {
            "line-color": "#1f9f72",
            "line-opacity": 0.64,
            "line-width": 1
          }
        });
        installTyphoonStormLayer(map);

        map.on("click", "province-fill", (event) => {
          const name = event.features?.[0]?.properties?.name as string | undefined;
          if (name) fetchDefense(name);
        });
        map.on("mouseenter", "province-fill", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "province-fill", () => {
          map.getCanvas().style.cursor = "";
        });

        const currentStorm = stormRef.current;
        updateTyphoonStormLayer(map, {
          storm: buildStormGeo(currentStorm),
          fleet: buildStormFleetGeo(stormsRef.current, currentStorm?.id ?? null)
        });
        renderStormOnMap(map, stormRef.current, markerRef);
        focusMapOnStorm(map, currentStorm, false);
        focusedStormIdRef.current = currentStorm?.id ?? null;
        setMapReady(true);
      });

      const syncOverlaysNow = () => {
        syncStormMarkerScale(map, stormRef.current, markerRef);
        syncStormFleetMarkerScale(map, stormsRef.current, stormRef.current?.id ?? null, fleetMarkers);
      };
      const syncOverlays = rafThrottle(syncOverlaysNow);
      // Marker size only depends on zoom. Keep the current visual during the
      // gesture and resize once at the end instead of forcing filtered DOM
      // markers through width/height transitions on every zoom frame.
      map.on("zoomend", syncOverlays);
      map.on("resize", syncOverlays);
      map.on("error", () => undefined);
    } catch {
      setMapFailed(true);
    }

      return () => {
        resizeObserver?.disconnect();
      disposeStormMarker(markerRef.current);
      cityAttentionMarkerRef.current?.remove();
      cityAttentionMarkerRef.current = null;
      cityAttentionElementRef.current = null;
      cityCameraSnapshotRef.current = null;
      cityAttentionRef.current = null;
      disposeGfsAnalysisCenterMarkers(gfsCenterMarkers);
      disposeStormFleetMarkers(fleetMarkers);
      markerRef.current = null;
      focusedStormIdRef.current = null;
      if (mapRef.current) removeTyphoonStormLayer(mapRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [fetchDefense]);

  useLayoutEffect(() => {
    if (!isLiveView || !mapReady) return;
    // Initial live-scene projection sync. Each live route owns one fixed map
    // for its entire lifetime; the director never resizes this surface.
    const map = mapRef.current;
    if (!map) return;
    map.resize();
    syncStormMarkerScale(map, stormRef.current, markerRef);
    syncStormFleetMarkerScale(map, stormsRef.current, stormRef.current?.id ?? null, fleetMarkerRefs.current);
  }, [isLiveView, mapReady]);

  useEffect(() => {
    cityAttentionRef.current = cityAttention;
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!cityAttention) {
      onCityAttentionAnchor?.(null);
      cityAttentionMarkerRef.current?.remove();
      cityAttentionMarkerRef.current = null;
      cityAttentionElementRef.current = null;
      const previousCamera = cityCameraSnapshotRef.current;
      cityCameraSnapshotRef.current = null;
      if (previousCamera) map.easeTo({ ...previousCamera, duration: 760, essential: true });
      return;
    }

    const syncAttentionAnchor = () => {
      const point = map.project([cityAttention.longitude, cityAttention.latitude]);
      const rect = map.getCanvas().getBoundingClientRect();
      const x = rect.left + point.x;
      const y = rect.top + point.y;
      onCityAttentionAnchor?.({
        x,
        y,
        horizontal: x > window.innerWidth * 0.58 ? "left" : "right",
        vertical: y > window.innerHeight * 0.62 ? "up" : "down"
      });
    };
    map.on("move", syncAttentionAnchor);
    map.on("resize", syncAttentionAnchor);

    const isNewTarget = cityAttentionMarkerRef.current?.getLngLat().lng !== cityAttention.longitude ||
      cityAttentionMarkerRef.current?.getLngLat().lat !== cityAttention.latitude;
    if (isNewTarget) {
      if (!cityCameraSnapshotRef.current) {
        const center = map.getCenter();
        cityCameraSnapshotRef.current = {
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch()
        };
      }
      const element = document.createElement("div");
      element.className = "city-attention-marker";
      element.setAttribute("aria-hidden", "true");
      element.innerHTML = "<i></i><b></b><span></span>";
      cityAttentionElementRef.current = element;
      cityAttentionMarkerRef.current?.remove();
      cityAttentionMarkerRef.current = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([cityAttention.longitude, cityAttention.latitude])
        .addTo(map);
      map.stop();
      map.easeTo({
        center: [cityAttention.longitude, cityAttention.latitude],
        zoom: Math.max(map.getZoom(), 5.6),
        duration: 720,
        essential: true
      });
    }
    const element = cityAttentionElementRef.current;
    if (element) {
      element.dataset.phase = cityAttention.phase;
      element.dataset.city = cityAttention.city;
    }
    syncAttentionAnchor();
    return () => {
      map.off("move", syncAttentionAnchor);
      map.off("resize", syncAttentionAnchor);
    };
  }, [cityAttention, mapReady, onCityAttentionAnchor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    updateTyphoonStormLayer(map, {
      storm: stormGeo,
      fleet: stormFleetGeo,
      windRadiiVisible: environmentLayers.impact
    });
    renderStormOnMap(map, activeMarkerStorm, markerRef, satelliteLayer, bossProfile);
    syncStormFleetMarkers(map, markerStorms, storm?.id ?? null, fleetMarkerRefs.current, bossProfiles, satelliteLayer);
    if (cityAttentionRef.current) return;
    if (storm) {
      // The live deck changes every five seconds. It must not be treated as a
      // new target: fitBounds/easeTo during the layout swap causes canvas
      // overlays to be projected twice and leaves a visible afterimage.
      const focusKey = storm.id;
      if (focusedStormIdRef.current !== focusKey) {
        focusMapOnStorm(map, storm, true, theme, view);
        focusedStormIdRef.current = focusKey;
      }
    } else if (focusedStormIdRef.current !== null) {
      map.easeTo({ center: NATIONAL_CAMERA.center, zoom: NATIONAL_CAMERA.zoom, duration: 900 });
      focusedStormIdRef.current = null;
    }
  }, [storm, storms, markerStorms, activeMarkerStorm, stormGeo, stormFleetGeo, mapReady, theme, satelliteLayer, bossProfile, bossProfiles, view, environmentLayers.impact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    syncGfsAnalysisCenterMarkers(map, gfsCenterMarkerRefs.current, gfsAnalysisCenterMarkers);
  }, [gfsAnalysisCenterMarkers, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    syncRegionalSatelliteLayer(map, satelliteLayer, environmentLayers.satellite);
    syncGlobalSatelliteLayer(map, satelliteLayer, environmentLayers.satellite);
  }, [satelliteLayer, environmentLayers.satellite, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    syncCwaRadarLayer(map, cwaRadarLayer, cwaRadarVisible);
  }, [cwaRadarLayer, cwaRadarVisible, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = windColorCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startWindColorFieldRenderer(map, canvas, stormWindField, compatibleCoreWindField, environmentLayers.wind);
  }, [compatibleCoreWindField, environmentLayers.wind, mapReady, stormWindField, theme]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = gfsScalarCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startGfsScalarLayerRenderer(map, canvas, viewportGfsLayer);
  }, [mapReady, theme, viewportGfsLayer]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = gfsWaveCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startGfsWaveRenderer(map, canvas, viewportGfsWave);
  }, [mapReady, theme, viewportGfsWave]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = marineCurrentCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startWindFieldRenderer(
      map,
      canvas,
      marineCurrentInteractionCanvasRef.current,
      marineCurrentRef,
      emptyWindFieldRef,
      cycloneCoreRef,
      environmentLayers.marineCurrent,
      "streamlines",
      isLiveView,
      "marine"
    );
  }, [environmentLayers.marineCurrent, isLiveView, mapReady, theme, viewportMarineLayer]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = seaSurfaceTemperatureCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startMarineSstRenderer(map, canvas, viewportMarineLayer, environmentLayers.seaSurfaceTemperature);
  }, [environmentLayers.seaSurfaceTemperature, mapReady, theme, viewportMarineLayer]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = ecmwfTrackCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startEcmwfTrackRenderer(map, canvas, matchedEcmwfTracks, ecmwfTracksVisible);
  }, [ecmwfTracksVisible, mapReady, matchedEcmwfTracks, theme]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = observationCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startRegionalObservationRenderer(map, canvas, regionalObservations, observationsVisible);
  }, [mapReady, observationsVisible, regionalObservations, theme]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = windCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startWindFieldRenderer(
      map,
      canvas,
      windInteractionCanvasRef.current,
      latestWindFieldRef,
      latestCoreWindFieldRef,
      cycloneCoreRef,
      environmentLayers.wind,
      windRenderMode,
      isLiveView
    );
  }, [environmentLayers.wind, isLiveView, mapReady, theme, windRenderMode]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = forecastCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startForecastRouteRenderer(map, canvas, storm);
  }, [storm, mapReady, theme]);

  return (
    <main
      className={`radar-shell ${isLiveView
        ? nationalRailStyles.hasNationalSideRail
        : nationalMapState.mode === "national" ? nationalRailStyles.hasStandardNationalRail : ""}`.trim()}
      data-theme={theme}
      data-view={view}
      data-map-mode={nationalMapState.mode}
      data-live-deck={isLiveView ? liveDeck : undefined}
      data-live-standby={showLiveStandbyEnvironment ? "true" : undefined}
      data-national-side-rail={isLiveView ? "true" : undefined}
    >
      {!isLiveView ? <div className="boot-scan" /> : null}
      <section className="map-stage" aria-label="气象 Boss 雷达全国气象地图">
        {mapFailed ? <FallbackMap storm={storm} /> : <div className="map-canvas" ref={mapNode} />}
        {!mapFailed && gfsScalarLayer ? <canvas className="gfs-scalar-canvas" ref={gfsScalarCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed && gfsWaveVisible ? <canvas className="gfs-wave-canvas" ref={gfsWaveCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed && environmentLayers.marineCurrent ? <canvas className="marine-current-canvas" ref={marineCurrentCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed && environmentLayers.marineCurrent ? <canvas className="marine-current-interaction-canvas" ref={marineCurrentInteractionCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed && environmentLayers.seaSurfaceTemperature ? <canvas className="sea-surface-temperature-canvas" ref={seaSurfaceTemperatureCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed && ecmwfTracksVisible ? <canvas className="ecmwf-track-canvas" ref={ecmwfTrackCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed && observationsVisible ? <canvas className="regional-observation-canvas" ref={observationCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed && environmentLayers.wind ? <canvas className="wind-color-canvas" ref={windColorCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed && environmentLayers.wind ? <canvas className="wind-particle-canvas" ref={windCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed && environmentLayers.wind ? <canvas className="wind-particle-interaction-canvas" ref={windInteractionCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed && storm ? <canvas className="forecast-route-canvas" ref={forecastCanvasRef} aria-hidden="true" /> : null}
        {isLiveView && !mapFailed ? <WindFieldTimeBadge placement="live" windField={stormWindField} currentStorm={storm} /> : null}
        {!mapFailed ? (
          <ProjectedMapOverlays
            map={mapReady ? mapRef.current : null}
            storm={storm}
            storms={storms}
            regionLabels={mapRegionLabels}
            showPathTimes={!isLiveView}
          />
        ) : null}
        {!isLiveView ? (
          <NationalEventLayer
            map={mapReady ? mapRef.current : null}
            events={nationalSituation.snapshot?.events ?? []}
            enabled={nationalWarningsVisible}
          />
        ) : null}
        {isLiveView && liveDeck === "briefing" ? <LiveRouteLegend storm={storm} /> : null}
        <PerformanceOverlay
          enabled={showPerfOverlay}
          fetchDurationMs={snapshotFetchDurationMs}
          windPointCount={activeWindField?.points.length ?? 0}
          warningCount={snapshot?.warnings.length ?? 0}
          windCanvasRef={windCanvasRef}
        />

        <div className="map-effects" aria-hidden="true">
          <div className="map-vignette" />
          <div className="radar-grid" />
          <div className="hud-circuit-layer" />
        </div>

        {theme === "archive-command" ? <DossierSceneDecor storm={storm} sourceLabel={sourceLabel} dataError={dataError} /> : null}
        {theme === "archive-command" ? <DossierMapFurniture /> : null}

        {!isLiveView ? <ForecastBadge storm={storm} /> : null}
        {!isLiveView ? (
          <NationalMapModeControl
            state={nationalMapState}
            storms={storms}
            warningsVisible={nationalWarningsVisible}
            onReturnNational={returnToNational}
            onSelectStorm={selectStormById}
            onWarningsVisibleChange={setNationalWarningsVisible}
          />
        ) : null}
        {!isLiveView ? (
          <NationalRadarPlayback
            radar={nationalSituation.snapshot?.radar ?? null}
            enabled={nationalRadarVisible}
            onEnabledChange={setNationalRadarVisible}
          />
        ) : null}

        {isLiveView ? (
          <>
            <LiveTopBar
              model={liveModel}
              refreshSequence={refreshSequence}
              deck={liveDeck}
              secondsToSwitch={secondsToSwitch}
              cycle={liveDeckCycle}
            />
            {liveDeck === "analysis" ? <LiveForecastOverlay model={liveModel} /> : null}
          </>
        ) : (
          <TopCommandBar
            storm={storm}
            storms={storms}
            activeIndex={activeIndex}
            onSelect={selectStorm}
            bossProfile={bossProfile}
            count={storms.length}
            lastUpdated={lastUpdated}
            dataError={dataError}
            sourceLabel={sourceLabel}
            theme={theme}
            onThemeChange={setTheme}
          />
        )}

        {!isLiveView && theme === "night-radar" ? <OfficialAlertStrip payload={officialAlerts} /> : null}

        {!isLiveView && theme === "night-radar" ? (
          <div className="left-tactical-stack">
            <DefenseStatusPanel alerts={provinceAlerts} onSelect={fetchDefense} />
            <BossSkillSlotPanel storm={storm} bossProfile={bossProfile} className="left-boss-skill-panel" />
            <div className="environment-panel-stack">
              <EnvironmentLayerPanel
                layers={environmentLayers}
                satellite={satelliteLayer}
                windField={activeWindField}
                detailWindField={compatibleCoreWindField}
                impactArea={impactArea}
                officialWindRadiusFeatureCount={officialWindRadiusFeatureCount}
                gfsScalarLayer={gfsScalarLayer}
                gfsScalarPayload={viewportGfsLayer}
                cwaRadar={cwaRadarLayer}
                cwaRadarVisible={cwaRadarVisible}
                gfsWave={viewportGfsWave}
                gfsWaveVisible={gfsWaveVisible}
                marineLayer={viewportMarineLayer}
                ecmwfTracks={ecmwfTrackLayer}
                ecmwfTracksVisible={ecmwfTracksVisible}
                ecmwfMemberCount={matchedEcmwfTracks.ensemble?.members.length ?? 0}
                observations={regionalObservations}
                observationsVisible={observationsVisible}
                windRenderMode={windRenderMode}
                onToggle={toggleEnvironmentLayer}
                onGfsScalarLayerChange={setGfsScalarLayer}
                onCwaRadarToggle={() => setCwaRadarVisible((current) => !current)}
                onGfsWaveToggle={() => setGfsWaveVisible((current) => !current)}
                onEcmwfTracksToggle={() => setEcmwfTracksVisible((current) => !current)}
                onObservationsToggle={() => setObservationsVisible((current) => !current)}
                onWindRenderModeChange={setWindRenderMode}
              />
              {!mapFailed ? <WindFieldTimeBadge placement="main" windField={stormWindField} currentStorm={storm} /> : null}
            </div>
          </div>
        ) : !isLiveView ? (
          <>
            <DefenseStatusPanel alerts={provinceAlerts} onSelect={fetchDefense} />
            <div className="environment-panel-stack">
              <EnvironmentLayerPanel
                layers={environmentLayers}
                satellite={satelliteLayer}
                windField={activeWindField}
                detailWindField={compatibleCoreWindField}
                impactArea={impactArea}
                officialWindRadiusFeatureCount={officialWindRadiusFeatureCount}
                gfsScalarLayer={gfsScalarLayer}
                gfsScalarPayload={viewportGfsLayer}
                cwaRadar={cwaRadarLayer}
                cwaRadarVisible={cwaRadarVisible}
                gfsWave={viewportGfsWave}
                gfsWaveVisible={gfsWaveVisible}
                marineLayer={viewportMarineLayer}
                ecmwfTracks={ecmwfTrackLayer}
                ecmwfTracksVisible={ecmwfTracksVisible}
                ecmwfMemberCount={matchedEcmwfTracks.ensemble?.members.length ?? 0}
                observations={regionalObservations}
                observationsVisible={observationsVisible}
                windRenderMode={windRenderMode}
                onToggle={toggleEnvironmentLayer}
                onGfsScalarLayerChange={setGfsScalarLayer}
                onCwaRadarToggle={() => setCwaRadarVisible((current) => !current)}
                onGfsWaveToggle={() => setGfsWaveVisible((current) => !current)}
                onEcmwfTracksToggle={() => setEcmwfTracksVisible((current) => !current)}
                onObservationsToggle={() => setObservationsVisible((current) => !current)}
                onWindRenderModeChange={setWindRenderMode}
              />
              {!mapFailed ? <WindFieldTimeBadge placement="main" windField={stormWindField} currentStorm={storm} /> : null}
            </div>
          </>
        ) : null}
        {!isLiveView && theme === "archive-command" ? <MapLegendPanel /> : null}
        {!isLiveView && theme === "archive-command" ? <DossierStormIndex storms={storms} activeIndex={activeIndex} onSelect={selectStorm} /> : null}
        {!isLiveView && theme === "archive-command" ? <ImpactLegend /> : null}
        {!isLiveView && theme === "night-radar" ? <BottomAlertBar storm={storm} bossProfile={bossProfile} alerts={provinceAlerts} dataError={dataError} sourceLabel={sourceLabel} lastTrackedStorm={snapshot?.lastTrackedStorm ?? null} /> : null}
        {!isLiveView ? <DefenseDrawer defense={selectedDefense} onClose={() => setSelectedDefense(null)} /> : null}
      </section>

      {isLiveView ? (
        <div
          className={`${nationalRailStyles.liveRail} ${showLiveStandbyEnvironment ? nationalRailStyles.liveRailStandby : ""}`.trim()}
          aria-label="气象 Boss 雷达直播证据侧栏"
        >
          <NationalSituationSurface
            state={nationalSituation}
            variant={showLiveStandbyEnvironment ? "full" : "compact"}
            className={showLiveStandbyEnvironment ? nationalRailStyles.standardHud : nationalRailStyles.compactHud}
            liveStandby={showLiveStandbyEnvironment}
          />
          {showLiveStandbyEnvironment ? (
            <div className={nationalRailStyles.environmentInRail}>
              <EnvironmentLayerPanel
                layers={environmentLayers}
                satellite={satelliteLayer}
                windField={activeWindField}
                detailWindField={compatibleCoreWindField}
                impactArea={impactArea}
                officialWindRadiusFeatureCount={officialWindRadiusFeatureCount}
                gfsScalarLayer={gfsScalarLayer}
                gfsScalarPayload={viewportGfsLayer}
                cwaRadar={cwaRadarLayer}
                cwaRadarVisible={cwaRadarVisible}
                gfsWave={viewportGfsWave}
                gfsWaveVisible={gfsWaveVisible}
                marineLayer={viewportMarineLayer}
                ecmwfTracks={ecmwfTrackLayer}
                ecmwfTracksVisible={ecmwfTracksVisible}
                ecmwfMemberCount={matchedEcmwfTracks.ensemble?.members.length ?? 0}
                observations={regionalObservations}
                observationsVisible={observationsVisible}
                windRenderMode={windRenderMode}
                onToggle={toggleEnvironmentLayer}
                onGfsScalarLayerChange={setGfsScalarLayer}
                onCwaRadarToggle={() => setCwaRadarVisible((current) => !current)}
                onGfsWaveToggle={() => setGfsWaveVisible((current) => !current)}
                onEcmwfTracksToggle={() => setEcmwfTracksVisible((current) => !current)}
                onObservationsToggle={() => setObservationsVisible((current) => !current)}
                onWindRenderModeChange={setWindRenderMode}
              />
            </div>
          ) : null}
          {!showLiveStandbyEnvironment && liveDeck === "briefing" ? (
            <LiveAudiencePanel
              model={liveModel}
              storm={storm}
              satelliteLayer={satelliteLayer}
              refreshSequence={refreshSequence}
            />
          ) : !showLiveStandbyEnvironment ? (
            <LiveIntelPanel model={liveModel} storm={storm} satelliteLayer={satelliteLayer} />
          ) : null}
        </div>
      ) : nationalMapState.mode === "national" ? (
        <div className={nationalRailStyles.standardRail} aria-label="全国气象态势侧栏">
          <NationalSituationSurface
            state={nationalSituation}
            variant="full"
            className={nationalRailStyles.standardHud}
            onSelectEvent={focusNationalEvent}
            onOpenCitySituation={firstDeterministicCityEventId
              ? () => focusNationalEvent(firstDeterministicCityEventId)
              : undefined}
          />
        </div>
      ) : (
        <IntelPanel
          storm={storm}
          bossProfile={bossProfile}
          source={sourceLabel}
          dataError={dataError}
          lastSyncedAt={lastSyncedAt}
          refreshSequence={refreshSequence}
          pollIntervalMs={pollIntervalMs}
          theme={theme}
          satelliteLayer={satelliteLayer}
        />
      )}
      {isLiveView ? <LiveBottomBar model={liveModel} deck={liveDeck} secondsToSwitch={secondsToSwitch} /> : null}
    </main>
  );
}

function DossierSceneDecor({
  storm,
  sourceLabel,
  dataError
}: {
  storm: Storm | null;
  sourceLabel: string;
  dataError: string | null;
}) {
  const operation = buildDossierOperation(storm, dataError);
  const telegram = buildDossierTelegram(storm, sourceLabel, dataError);

  return (
    <div className="dossier-scene-decor" aria-hidden="true">
      <div className="dossier-desk-prop prop-order-note">
        <span>作战命令</span>
        <strong>{operation.title}</strong>
        <p>{operation.detail}</p>
      </div>
      <div className="dossier-desk-prop prop-telegram">
        <span>{telegram.kicker}</span>
        <p>{telegram.detail}</p>
      </div>
      <div className="dossier-desk-prop prop-clock">
        <i />
      </div>
      <div className="dossier-desk-prop prop-pen" />
      <div className="dossier-desk-prop prop-paperclip" />
    </div>
  );
}

function buildDossierOperation(storm: Storm | null, dataError: string | null) {
  if (dataError) {
    return {
      title: "链路复核",
      detail: "实时接口异常，纸面档案保留最近一次公开资料。"
    };
  }

  if (!storm) {
    return {
      title: "待机巡航",
      detail: "当前无活动台风，档案组保持地图与公开资料巡检。"
    };
  }

  const title = String(storm.rating) === "神级" || String(storm.rating) === "龙级" ? "最高戒备" : "防御优先";
  return {
    title,
    detail: `${storm.nameZh} 为${storm.stage}，中心风速 ${storm.maxWind || "--"} m/s，沿海单位按${storm.rating}响应。`
  };
}

function buildDossierTelegram(storm: Storm | null, sourceLabel: string, dataError: string | null) {
  if (dataError) {
    return {
      kicker: "LINK MEMO",
      detail: `数据链路异常：${dataError}`
    };
  }

  if (!storm) {
    return {
      kicker: "STAFF TELEGRAM",
      detail: `来源：${sourceLabel}。等待下一轮公开台风路径资料。`
    };
  }

  return {
    kicker: "STAFF TELEGRAM",
    detail: `${sourceLabel} 已同步 ${storm.track.length} 条历史轨迹与 ${storm.forecast.length} 条预报点。`
  };
}

function DossierMapFurniture() {
  return (
    <div className="dossier-map-furniture" aria-hidden="true">
      <div className="map-compass">
        <b>N</b>
        <span />
        <small>S</small>
      </div>
      <div className="map-scale">
        <i />
        <span>0</span>
        <span>250</span>
        <span>500 km</span>
      </div>
    </div>
  );
}

function PerformanceOverlay({
  enabled,
  fetchDurationMs,
  windPointCount,
  warningCount,
  windCanvasRef
}: {
  enabled: boolean;
  fetchDurationMs: number | null;
  windPointCount: number;
  warningCount: number;
  windCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
}) {
  const [fps, setFps] = useState(0);
  const [longTasks, setLongTasks] = useState(0);
  const [windMetrics, setWindMetrics] = useState({ fps: 0, renderMs: 0, particles: 0, quality: 0 });

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let frames = 0;
    let lastSample = performance.now();
    const tick = (time: number) => {
      frames += 1;
      if (time - lastSample >= 1000) {
        setFps(Math.round((frames * 1000) / (time - lastSample)));
        frames = 0;
        lastSample = time;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      const dataset = windCanvasRef.current?.dataset;
      const frameMs = Number(dataset?.averageFrameMs ?? 0);
      setWindMetrics({
        fps: frameMs > 0 ? Math.round(1000 / frameMs) : 0,
        renderMs: Number(dataset?.averageRenderMs ?? 0),
        particles: Number(dataset?.activeParticleCount ?? 0),
        quality: Number(dataset?.qualityScale ?? 0)
      });
    };
    read();
    const timer = window.setInterval(read, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, windCanvasRef]);

  useEffect(() => {
    if (!enabled || typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => {
        setLongTasks((count) => count + list.getEntries().length);
      });
      observer.observe({ entryTypes: ["longtask"] });
      return () => observer.disconnect();
    } catch {
      return undefined;
    }
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="performance-overlay" aria-live="polite">
      <b>PERF</b>
      <span>{fps || "--"} RAF FPS</span>
      <span>{windMetrics.fps || "--"} wind FPS / {windMetrics.renderMs || "--"} ms</span>
      <span>{windMetrics.particles || "--"} particles / Q{windMetrics.quality || "--"}</span>
      <span>{fetchDurationMs ?? "--"} ms fetch</span>
      <span>{windPointCount} wind pts</span>
      <span>{longTasks} long tasks</span>
      <span>{warningCount} warnings</span>
    </div>
  );
}

function ProjectedMapOverlays({
  map,
  storm,
  storms,
  regionLabels,
  showPathTimes
}: {
  map: MapLibreMap | null;
  storm: Storm | null;
  storms: Storm[];
  regionLabels: MapRegionLabel[];
  showPathTimes: boolean;
}) {
  const regionNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const pathNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const centerNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const trackNodesRef = useRef<Map<string, SVGSVGElement>>(new Map());
  const regionLayerRef = useRef<HTMLDivElement | null>(null);
  const pathLayerRef = useRef<HTMLDivElement | null>(null);
  const trackLayerRef = useRef<HTMLDivElement | null>(null);
  const centerLayerRef = useRef<HTMLDivElement | null>(null);
  const pathCandidates = useMemo(() => {
    if (!storm || !showPathTimes) return [];
    const candidates = storm.forecast.length > 0 ? storm.forecast : storm.track.slice(-6);
    return candidates
      .filter((_, index) => index % 2 === 0)
      .map((point, index) => ({
        id: `${point.time}-${index}`,
        coordinate: [point.lon, point.lat] as [number, number],
        label: formatPathTime(point.time)
      }));
  }, [showPathTimes, storm]);

  useLayoutEffect(() => {
    if (!map) return;
    let frame = 0;
    let cameraMoving = false;
    let cameraAnchors: CanvasCameraAnchors | null = null;
    const mapStage = map.getContainer().closest<HTMLElement>(".map-stage");
    const layerNodes = () => [regionLayerRef.current, pathLayerRef.current, trackLayerRef.current, centerLayerRef.current].filter((node): node is HTMLDivElement => Boolean(node));
    const setLayerTransform = (transform: string) => {
      layerNodes().forEach((node) => {
        node.style.transformOrigin = "0 0";
        node.style.transform = transform;
      });
    };
    const sync = () => {
      frame = 0;
      setLayerTransform("none");
      const canvas = map.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const center = map.getCenter();
      const centerLongitude = ((center.lng + 180) % 360 + 360) % 360 - 180;
      const showProvinceLabels = polygonContainsCoordinate(CHINA_LABEL_FOCUS_POLYGON, [centerLongitude, center.lat]);

      regionLabels.forEach((label) => {
        const node = regionNodesRef.current.get(label.id);
        if (!node) return;
        const point = map.project(label.coordinate);
        const visible = showProvinceLabels && point.x > 16 && point.y > 16 && point.x < width - 16 && point.y < height - 16;
        node.hidden = !visible;
        if (visible) {
          node.style.left = `${Math.round(point.x)}px`;
          node.style.top = `${Math.round(point.y)}px`;
        }
      });

      const stormPoint = storm ? map.project([storm.position.lon, storm.position.lat]) : null;
      const safeBox = {
        left: width <= 760 ? 18 : 230,
        top: 126,
        right: width - 230,
        bottom: height - 126
      };
      pathCandidates.forEach((candidate) => {
        const node = pathNodesRef.current.get(candidate.id);
        if (!node) return;
        const point = map.project(candidate.coordinate);
        const x = Math.round(point.x + 16);
        const y = Math.round(point.y - 18);
        const visible = Boolean(
          stormPoint &&
          Math.hypot(point.x - stormPoint.x, point.y - stormPoint.y) > 110 &&
          x > safeBox.left && x < safeBox.right && y > safeBox.top && y < safeBox.bottom
        );
        node.hidden = !visible;
        if (visible) {
          node.style.left = `${x}px`;
          node.style.top = `${y}px`;
        }
      });

      storms.forEach((item) => {
        const trackNode = trackNodesRef.current.get(item.id);
        if (trackNode) {
          const points = item.track
            .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
            .map((point) => map.project([point.lon, point.lat]));
          trackNode.style.display = points.length < 2 ? "none" : "";
          if (points.length >= 2) {
            trackNode.setAttribute("viewBox", `0 0 ${width} ${height}`);
            const serialized = points.map((point) => `${point.x},${point.y}`).join(" ");
            trackNode.querySelectorAll("polyline").forEach((polyline) => polyline.setAttribute("points", serialized));
          }
        }

        const centerNode = centerNodesRef.current.get(item.id);
        if (!centerNode) return;
        const latest = item.track.at(-1) ?? item.position;
        const valid = Number.isFinite(latest.lon) && Number.isFinite(latest.lat);
        centerNode.hidden = !valid;
        if (!valid) return;
        const point = map.project([latest.lon, latest.lat]);
        const hudOffset = Math.max(0, 122 - point.y);
        centerNode.style.left = `${point.x}px`;
        centerNode.style.top = `${point.y + hudOffset}px`;
        centerNode.style.setProperty("--hud-offset", `${hudOffset}px`);
        if (hudOffset > 0) centerNode.dataset.hudOffset = "true";
        else delete centerNode.dataset.hudOffset;
      });
    };
    const schedule = () => {
      if (cameraMoving || frame) return;
      frame = window.requestAnimationFrame(sync);
    };
    const beginCameraMove = () => {
      if (cameraMoving) return;
      cameraMoving = true;
      if (mapStage) mapStage.dataset.cameraMoving = "true";
      window.cancelAnimationFrame(frame);
      frame = 0;
      setLayerTransform("none");
      cameraAnchors = captureCanvasCameraAnchors(map, map.getCanvas());
    };
    const followCamera = () => {
      if (!cameraMoving) beginCameraMove();
      if (!cameraAnchors) return;
      const transform = canvasCameraTransform(map, cameraAnchors);
      setLayerTransform(`matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${transform.e}, ${transform.f})`);
    };
    const finishCameraMove = () => {
      cameraMoving = false;
      if (mapStage) delete mapStage.dataset.cameraMoving;
      cameraAnchors = null;
      schedule();
    };

    sync();
    map.on("movestart", beginCameraMove);
    map.on("move", followCamera);
    map.on("moveend", finishCameraMove);
    map.on("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      map.off("movestart", beginCameraMove);
      map.off("move", followCamera);
      map.off("moveend", finishCameraMove);
      map.off("resize", schedule);
      if (mapStage) delete mapStage.dataset.cameraMoving;
      setLayerTransform("none");
    };
  }, [map, pathCandidates, regionLabels, storm, storms]);

  return (
    <>
      <div className="map-label-layer" aria-hidden="true" ref={regionLayerRef}>
        {regionLabels.map((label) => (
          <div
            className="map-region-label"
            key={label.id}
            ref={(node) => {
              if (node) regionNodesRef.current.set(label.id, node);
              else regionNodesRef.current.delete(label.id);
            }}
          >
            <b>{label.zh}</b>
          </div>
        ))}
      </div>
      {showPathTimes ? (
        <div className="path-time-layer" aria-hidden="true" ref={pathLayerRef}>
          {pathCandidates.map((candidate) => (
            <div
              className="path-time-label"
              key={candidate.id}
              ref={(node) => {
                if (node) pathNodesRef.current.set(candidate.id, node);
                else pathNodesRef.current.delete(candidate.id);
              }}
            >
              {candidate.label}
            </div>
          ))}
        </div>
      ) : null}
      <div className="historical-track-layer" ref={trackLayerRef} aria-hidden="true">
        {storms.map((item) => (
          <svg
            className="historical-track-overlay"
            key={`track-${item.id}`}
            preserveAspectRatio="none"
            style={{ "--track-color": stormTrackColor(item.id) } as CSSProperties}
            ref={(node) => {
              if (node) trackNodesRef.current.set(item.id, node);
              else trackNodesRef.current.delete(item.id);
            }}
          >
            <polyline className="historical-track-shadow" />
            <polyline className="historical-track-line" />
          </svg>
        ))}
      </div>
      <div className="latest-track-center-layer" ref={centerLayerRef}>
        {storms.map((item) => (
          <div
            className="latest-path-center-marker"
            key={`center-${item.id}`}
            style={{ "--track-color": stormTrackColor(item.id), "--hud-offset": "0px" } as CSSProperties}
            aria-label={`${item.nameZh} 最新路径中心 ${formatBeijingTime(item.updatedAt)} 北京时间`}
            ref={(node) => {
              if (node) centerNodesRef.current.set(item.id, node);
              else centerNodesRef.current.delete(item.id);
            }}
          >
            <span aria-hidden="true">☠</span>
            <small>{item.nameZh} · 最新路径中心</small>
            <em>{formatBeijingTime(item.updatedAt)} BJT</em>
          </div>
        ))}
      </div>
    </>
  );
}

function syncRegionalSatelliteLayer(map: MapLibreMap, layer: SatelliteLayerPayload | null, visible: boolean) {
  const imageUrl = layer?.status === "available" ? layer.imageUrl : null;
  if (!visible || !imageUrl || !layer) {
    if (map.getLayer(REGIONAL_SATELLITE_LAYER_ID)) map.removeLayer(REGIONAL_SATELLITE_LAYER_ID);
    if (map.getSource(REGIONAL_SATELLITE_SOURCE_ID)) map.removeSource(REGIONAL_SATELLITE_SOURCE_ID);
    regionalSatelliteImageUrls.delete(map);
    map.getContainer().dataset.regionalSatelliteLayer = "removed";
    return;
  }

  const { bounds } = layer;
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south]
  ];
  const existingSource = map.getSource(REGIONAL_SATELLITE_SOURCE_ID) as ImageSource | undefined;
  const imageKey = satelliteImageKey(imageUrl, bounds);
  const previousImageKey = regionalSatelliteImageUrls.get(map);
  if (!existingSource) {
    map.addSource(REGIONAL_SATELLITE_SOURCE_ID, { type: "image", url: imageUrl, coordinates });
  } else if (previousImageKey !== imageKey) {
    existingSource.updateImage({ url: imageUrl, coordinates });
  }
  regionalSatelliteImageUrls.set(map, imageKey);

  if (!map.getLayer(REGIONAL_SATELLITE_LAYER_ID)) {
    const beforeLayer = map.getLayer("province-fill") ? "province-fill" : undefined;
    map.addLayer(
      {
        id: REGIONAL_SATELLITE_LAYER_ID,
        type: "raster",
        source: REGIONAL_SATELLITE_SOURCE_ID,
        paint: {
          "raster-opacity": 0.52,
          "raster-saturation": 0.32,
          "raster-contrast": 0.1,
          "raster-fade-duration": 420,
          "raster-resampling": "linear"
        }
      },
      beforeLayer
    );
  }
  map.getContainer().dataset.regionalSatelliteLayer = "visible";
}

function NationalSituationSurface({
  state,
  variant,
  className,
  liveStandby = false,
  onSelectEvent,
  onOpenCitySituation
}: {
  state: NationalSituationState;
  variant: "full" | "compact";
  className?: string;
  liveStandby?: boolean;
  onSelectEvent?: (eventId: string) => void;
  onOpenCitySituation?: () => void;
}) {
  if (state.snapshot) {
    if (!state.error) return variant === "full" ? (
      <FutureWeatherArchivePanel
        snapshot={state.snapshot}
        className={className}
        displayMode={liveStandby ? "live-standby" : "default"}
        onSelectEvent={onSelectEvent}
        onOpenCitySituation={onOpenCitySituation}
      />
    ) : (
      <NationalSituationHud
        snapshot={state.snapshot}
        variant="compact"
        className={className}
        onSelectEvent={onSelectEvent}
        onOpenCitySituation={onOpenCitySituation}
      />
    );
    return (
      <div
        className={`${nationalRailStyles.retainedWrap} ${className ?? ""}`.trim()}
        data-variant={variant}
        aria-busy={state.refreshing}
      >
        <p className={nationalRailStyles.retainedNotice} role="status">
          全国态势刷新失败，继续显示最近有效统一快照；这不代表当前无风险。{state.error}
        </p>
        {variant === "full" ? (
          <FutureWeatherArchivePanel
            snapshot={state.snapshot}
            className={nationalRailStyles.standardHud}
            displayMode={liveStandby ? "live-standby" : "default"}
            onSelectEvent={onSelectEvent}
            onOpenCitySituation={onOpenCitySituation}
          />
        ) : (
          <NationalSituationHud
            snapshot={state.snapshot}
            variant="compact"
            onSelectEvent={onSelectEvent}
            onOpenCitySituation={onOpenCitySituation}
          />
        )}
      </div>
    );
  }

  const loading = !state.loaded;
  return (
    <section
      className={`${nationalRailStyles.stateSurface} ${className ?? ""}`.trim()}
      data-variant={variant}
      aria-live="polite"
      aria-busy={loading || state.refreshing}
    >
      <span>NATIONAL SITUATION</span>
      <strong>{loading ? "正在加载全国态势快照" : "全国态势快照暂时不可用"}</strong>
      <p>{loading
        ? "正在核对官方预警、环境图层和来源时效。"
        : `${state.error ?? "统一快照未返回记录"}；当前无法据此判断全国风险。`}</p>
      {!loading ? <button type="button" onClick={state.refresh}>重新获取快照</button> : null}
    </section>
  );
}

function satelliteImageKey(
  imageUrl: string,
  bounds: { west: number; south: number; east: number; north: number }
) {
  return `${imageUrl}|${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
}

function syncGlobalSatelliteLayer(map: MapLibreMap, layer: SatelliteLayerPayload | null, visible: boolean) {
  const imageUrl = layer?.status === "available" ? layer.globalImageUrl : null;
  const bounds = layer?.globalBounds;
  if (!visible || !imageUrl || !bounds) {
    if (map.getLayer(GLOBAL_SATELLITE_LAYER_ID)) map.removeLayer(GLOBAL_SATELLITE_LAYER_ID);
    if (map.getSource(GLOBAL_SATELLITE_SOURCE_ID)) map.removeSource(GLOBAL_SATELLITE_SOURCE_ID);
    globalSatelliteImageUrls.delete(map);
    map.getContainer().dataset.globalSatelliteLayer = "removed";
    return;
  }

  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south]
  ];
  const imageKey = satelliteImageKey(imageUrl, bounds);
  const previousImageKey = globalSatelliteImageUrls.get(map);
  const existingSource = map.getSource(GLOBAL_SATELLITE_SOURCE_ID) as ImageSource | undefined;
  if (!existingSource) {
    map.addSource(GLOBAL_SATELLITE_SOURCE_ID, {
      type: "image",
      url: imageUrl,
      coordinates
    });
  } else if (previousImageKey !== imageKey) {
    existingSource.updateImage({ url: imageUrl, coordinates });
  }
  globalSatelliteImageUrls.set(map, imageKey);

  if (!map.getLayer(GLOBAL_SATELLITE_LAYER_ID)) {
    const beforeLayer = map.getLayer("province-fill") ? "province-fill" : undefined;
    map.addLayer(
      {
        id: GLOBAL_SATELLITE_LAYER_ID,
        type: "raster",
        source: GLOBAL_SATELLITE_SOURCE_ID,
        paint: {
          "raster-opacity": 0.5,
          "raster-saturation": -0.4,
          "raster-contrast": 0.12,
          "raster-brightness-min": 0,
          "raster-brightness-max": 1,
          "raster-fade-duration": 420,
          "raster-resampling": "linear"
        }
      },
      beforeLayer
    );
  }
  map.getContainer().dataset.globalSatelliteLayer = "visible";
}

function syncCwaRadarLayer(map: MapLibreMap, layer: RadarMosaicLayerPayload | null, visible: boolean) {
  const imageUrl = layer?.status === "available" ? layer.imageUrl : null;
  if (!imageUrl || !layer) {
    if (map.getLayer(CWA_RADAR_LAYER_ID)) map.removeLayer(CWA_RADAR_LAYER_ID);
    if (map.getSource(CWA_RADAR_SOURCE_ID)) map.removeSource(CWA_RADAR_SOURCE_ID);
    cwaRadarImageUrls.delete(map);
    return;
  }

  const { bounds } = layer;
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south]
  ];
  const existingSource = map.getSource(CWA_RADAR_SOURCE_ID) as ImageSource | undefined;
  const previousImageUrl = cwaRadarImageUrls.get(map);
  if (!existingSource) {
    map.addSource(CWA_RADAR_SOURCE_ID, { type: "image", url: imageUrl, coordinates });
  } else if (previousImageUrl !== imageUrl) {
    existingSource.updateImage({ url: imageUrl, coordinates });
  }
  cwaRadarImageUrls.set(map, imageUrl);

  if (!map.getLayer(CWA_RADAR_LAYER_ID)) {
    const beforeLayer = map.getLayer("province-fill") ? "province-fill" : undefined;
    map.addLayer(
      {
        id: CWA_RADAR_LAYER_ID,
        type: "raster",
        source: CWA_RADAR_SOURCE_ID,
        paint: {
          "raster-opacity": 0.72,
          "raster-saturation": 0.15,
          "raster-contrast": 0.08,
          "raster-fade-duration": 300,
          "raster-resampling": "linear"
        }
      },
      beforeLayer
    );
  }
  map.setLayoutProperty(CWA_RADAR_LAYER_ID, "visibility", visible ? "visible" : "none");
}

function OfficialAlertStrip({ payload }: { payload: OfficialAlertPayload | null }) {
  if (!payload || (!payload.alerts.length && !payload.tide)) return null;
  const hongKongHour = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours() + 1;
  const tide = payload.tide?.hourly.find((point) => point.hour === hongKongHour) ?? payload.tide?.hourly[0];
  return (
    <aside className="official-alert-strip" aria-label="官方气象警特报">
      <AlertTriangle size={14} />
      <b>官方警特报</b>
      <div>
        {payload.alerts.slice(0, 3).map((alert) => <span key={alert.id}><i>{alert.source}</i>{alert.title}</span>)}
        {tide ? <span title={payload.tide?.note}><i>HKO 天文潮</i>横澜岛 {tide.heightM.toFixed(2)}m</span> : null}
      </div>
    </aside>
  );
}

function ForecastBadge({ storm }: { storm: Storm | null }) {
  if (!storm || storm.forecast.length === 0) return null;
  const scenarios = forecastScenariosForStorm(storm);
  return (
    <div className="forecast-badge" aria-label="多机构预测路径图例">
      <div className="forecast-badge-title">
        <b>多机构预测</b>
        <span>{scenarios.length} 组公开机构预报</span>
      </div>
      <div className="forecast-route-keys">
        {scenarios.map((scenario, index) => {
          const style = forecastScenarioStyle(scenario, index);
          return (
            <div
              className={scenario.isPrimary ? "is-primary" : undefined}
              key={scenario.id}
              style={{ "--route-color": style.color } as CSSProperties}
            >
              <i />
              <strong>{scenario.agencyCode}</strong>
              <small>{scenario.agency}</small>
            </div>
          );
        })}
      </div>
      <em>机构路径，不代表概率排名</em>
    </div>
  );
}

function LiveRouteLegend({ storm }: { storm: Storm | null }) {
  if (!storm) return null;
  const scenarios = forecastScenariosForStorm(storm);
  if (scenarios.length === 0) return null;

  return (
    <section className="live-route-legend" aria-label="多机构预测路径颜色说明">
      <strong>路径颜色说明</strong>
      <span>实线为主预报，其余为机构路径</span>
      <div>
        {scenarios.map((scenario, index) => {
          const style = forecastScenarioStyle(scenario, index);
          return (
            <b key={scenario.id} style={{ "--route-color": style.color } as CSSProperties}>
              <i />
              <span>{scenario.agencyCode}</span>
              <small>· {scenario.agency}</small>
            </b>
          );
        })}
      </div>
    </section>
  );
}

function focusMapOnStorm(
  map: MapLibreMap,
  storm: Storm | null,
  animated: boolean,
  theme: RadarTheme = "night-radar",
  view: RadarView = "standard"
) {
  if (storm && theme === "night-radar" && (map.getCanvas().clientWidth > 760 || view === "live")) {
    const forecastBounds = forecastCorridorBounds(storm);
    if (forecastBounds) {
      const width = map.getCanvas().clientWidth;
      const height = map.getCanvas().clientHeight;
      map.fitBounds(forecastBounds, {
        padding:
          view === "live"
            ? {
                top: height <= 760 ? 118 : 132,
                bottom: height <= 760 ? 140 : 160,
                left: width <= 900 ? 34 : 48,
                right: width <= 900 ? 34 : 48
              }
            : {
                top: height <= 760 ? 126 : 142,
                bottom: height <= 760 ? 128 : 146,
                left: width <= 1180 ? 278 : 320,
                right: width <= 1180 ? 238 : 270
              },
        maxZoom: 4.55,
        duration: animated ? 900 : 0
      });
      return;
    }
  }
  const target = storm ? cameraCenterForStorm(storm, map.getCanvas().clientWidth, theme) : NATIONAL_CAMERA.center;
  const camera = {
    center: target as [number, number],
    zoom: storm ? (theme === "archive-command" ? 4.85 : 4.65) : NATIONAL_CAMERA.zoom,
    duration: animated ? 900 : 0
  };
  if (animated) {
    map.easeTo(camera);
  } else {
    map.jumpTo(camera);
  }
}

function forecastCorridorBounds(storm: Storm): [[number, number], [number, number]] | null {
  const forecastPoints = forecastScenariosForStorm(storm).flatMap((scenario) => scenario.points);
  if (forecastPoints.length < 2) return null;
  const coordinates = [storm.position, ...forecastPoints];
  const west = Math.min(...coordinates.map((point) => point.lon));
  const east = Math.max(...coordinates.map((point) => point.lon));
  const south = Math.min(...coordinates.map((point) => point.lat));
  const north = Math.max(...coordinates.map((point) => point.lat));
  return [
    [west, south],
    [east, north]
  ];
}

function cameraCenterForStorm(storm: Storm, viewportWidth = 1200, theme: RadarTheme = "night-radar"): [number, number] {
  if (viewportWidth <= 760) {
    return [storm.position.lon, storm.position.lat - 0.18];
  }

  if (theme === "archive-command") {
    return [storm.position.lon - 0.6, storm.position.lat - 0.2];
  }

  return [storm.position.lon - 0.9, storm.position.lat - 0.45];
}

function TopCommandBar({
  storm,
  storms,
  activeIndex,
  onSelect,
  bossProfile,
  count,
  lastUpdated,
  dataError,
  sourceLabel,
  theme,
  onThemeChange
}: {
  storm: Storm | null;
  storms: Storm[];
  activeIndex: number;
  onSelect: (index: number) => void;
  bossProfile?: BossProfile | null;
  count: number;
  lastUpdated: string;
  dataError: string | null;
  sourceLabel: string;
  theme: RadarTheme;
  onThemeChange: (theme: RadarTheme) => void;
}) {
  if (theme === "archive-command") {
    return (
      <header className="top-command dossier-command">
        <div className="dossier-command-brand">
          <span>气象 Boss 雷达</span>
          <strong>WEATHER EVIDENCE DOSSIER</strong>
          <b>HISTORICAL COMMAND FILE</b>
        </div>

        <div className="dossier-command-ledger" aria-label="dossier dispatch ledger">
          <DossierCommandCell label="CASE FILE" value={storm ? storm.code : "--"} alert={Boolean(storm)} />
          <DossierCommandCell label="OBS LOG" value={storm ? `${storm.track.length} REC` : "0 REC"} />
          <DossierCommandCell label="LAST FIX" value={storm?.updatedAt ? formatDossierFixTime(storm.updatedAt) : lastUpdated} />
          <DossierCommandCell label="FORECAST" value={storm ? `${storm.forecast.length} PTS` : "--"} alert={Boolean(dataError)} />
        </div>

        <div className="dossier-command-tools" title={sourceLabel}>
          <div className="dossier-source-stamp">
            <Satellite size={15} />
            <span>{sourceLabel}</span>
            <b>{count} FILES</b>
          </div>
          <Link className="main-live-link" href="/live">
            <RadioTower size={15} aria-hidden="true" />
            直播版
          </Link>
          <Link className="main-console-link" href="/console" aria-label="打开气象 Boss 雷达控制台">
            <Settings2 size={15} aria-hidden="true" />
            控制台
          </Link>
          <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />
        </div>
      </header>
    );
  }

  return (
    <header className="top-command">
      <div className="brand-block">
        <span>气象 Boss 雷达<i aria-label={storm && !dataError ? "执行中" : "未执行"} className={`brand-run-indicator ${storm && !dataError ? "is-running" : ""}`} title={storm && !dataError ? "执行中" : "未执行"} /></span>
        <strong>实时气象战术态势</strong>
      </div>
      <div className="live-radar-band">
        <b>实时雷达</b>
        <div className="command-strip">
          <CurrentStormControl storms={storms} activeIndex={activeIndex} onSelect={onSelect} />
          <StatusPill label="BOSS 阶段" value={bossProfile?.phaseLabel ?? storm?.rating ?? "低威胁"} alert={Boolean(storm)} />
          <StatusPill label="系统时间" value={lastUpdated} />
        </div>
      </div>
      <div className="source-chip" title={sourceLabel}>
        <Satellite size={16} />
        <span>{sourceLabel} / {"\u76ee\u6807\u6570"} {count}</span>
        <Link className="main-live-link" href="/live">
          <RadioTower size={15} aria-hidden="true" />
          直播版
        </Link>
        <Link className="main-console-link" href="/console">
          <Settings2 size={15} aria-hidden="true" />
          控制台
        </Link>
        <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />
      </div>
    </header>
  );
}

function formatDossierFixTime(value: string) {
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
function DossierCommandCell({ label, value, alert = false }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className={`dossier-command-cell ${alert ? "is-alert" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ThemeSwitcher({ theme, onThemeChange }: { theme: RadarTheme; onThemeChange: (theme: RadarTheme) => void }) {
  const options: Array<{ value: RadarTheme; label: string }> = [
    { value: "night-radar", label: "雷达" },
    { value: "archive-command", label: "档案" }
  ];

  return (
    <div className="theme-switcher" aria-label="界面主题">
      <Palette size={14} aria-hidden="true" />
      {options.map((option) => (
        <button
          className={theme === option.value ? "active" : ""}
          key={option.value}
          type="button"
          onClick={() => onThemeChange(option.value)}
          aria-pressed={theme === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function DefenseStatusPanel({
  alerts,
  onSelect
}: {
  alerts: ReturnType<typeof buildProvinceAlerts>;
  onSelect: (province: string) => void;
}) {
  return (
    <HudPanel as="aside" className="defense-panel" aria-label="省份防御态势">
      <div className="section-title">
        <Shield size={18} />
        <span>省份防御</span>
      </div>
      <small className="section-subtitle">防御态势</small>
      <div className="defense-list">
        {alerts.map((item) => (
          <button className={`defense-item level-${item.level}`} key={item.name} type="button" onClick={() => onSelect(item.name)}>
            <i className="defense-sigil" />
            <span>{item.name}</span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </div>
      <button className="deploy-button" type="button" onClick={() => onSelect("浙江省")}>
        防御资源部署
        <ChevronRight size={16} />
      </button>
    </HudPanel>
  );
}

function MapLegendPanel() {
  const rows = [
    { kind: "station", label: "沿海雷达站" },
    { kind: "command", label: "防御指挥中心" },
    { kind: "harbor", label: "避风港 / 港口" },
    { kind: "current", label: "当前台风位置" },
    { kind: "forecast", label: "预测路径（未来）" },
    { kind: "range", label: "影响范围（风圈）" }
  ];

  return (
    <HudPanel as="aside" className="legend-panel" aria-label="图例">
      <div className="section-title compact">
        <span>LEGEND</span>
      </div>
      <small className="section-subtitle">图例</small>
      <div className="map-legend-list">
        {rows.map((row) => (
          <div className={`map-legend-row legend-${row.kind}`} key={row.kind}>
            <i />
            <span>{row.label}</span>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function EnvironmentLayerPanel({
  className = "",
  collapsible = false,
  collapsed = false,
  onCollapsedChange,
  layers,
  satellite,
  windField,
  detailWindField,
  impactArea,
  officialWindRadiusFeatureCount,
  gfsScalarLayer,
  gfsScalarPayload,
  cwaRadar,
  cwaRadarVisible,
  gfsWave,
  gfsWaveVisible,
  marineLayer,
  ecmwfTracks,
  ecmwfTracksVisible,
  ecmwfMemberCount,
  observations,
  observationsVisible,
  windRenderMode,
  onToggle,
  onGfsScalarLayerChange,
  onCwaRadarToggle,
  onGfsWaveToggle,
  onEcmwfTracksToggle,
  onObservationsToggle,
  onWindRenderModeChange
}: {
  className?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: () => void;
  layers: EnvironmentLayerToggles;
  satellite: SatelliteLayerPayload | null;
  windField: WindFieldPayload | null;
  detailWindField: WindFieldPayload | null;
  impactArea: ImpactAreaPayload | null;
  officialWindRadiusFeatureCount: number;
  gfsScalarLayer: GfsScalarLayerId | null;
  gfsScalarPayload: GfsScalarLayerPayload | null;
  cwaRadar: RadarMosaicLayerPayload | null;
  cwaRadarVisible: boolean;
  gfsWave: GfsWaveLayerPayload | null;
  gfsWaveVisible: boolean;
  marineLayer: MarineLayerPayload | null;
  ecmwfTracks: EcmwfTrackPayload | null;
  ecmwfTracksVisible: boolean;
  ecmwfMemberCount: number;
  observations: RegionalObservationPayload | null;
  observationsVisible: boolean;
  windRenderMode: WindRenderMode;
  onToggle: (layer: EnvironmentLayerKey) => void;
  onGfsScalarLayerChange: (layer: GfsScalarLayerId | null) => void;
  onCwaRadarToggle: () => void;
  onGfsWaveToggle: () => void;
  onEcmwfTracksToggle: () => void;
  onObservationsToggle: () => void;
  onWindRenderModeChange: (mode: WindRenderMode) => void;
}) {
  const hasDirectNcepGfs = windField?.source === "NOAA/NCEP NOMADS Grib Filter";
  const windResolution = windField?.status === "available"
    ? `显示 ${windField.displayResolutionDegrees ?? "?"}° / 原生 ${windField.nativeResolutionDegrees ?? "?"}°`
    : "";
  const coreResolution = detailWindField?.status === "available" && detailWindField.points.length > 0
    ? ` · 核心 ${detailWindField.displayResolutionDegrees ?? "?"}°`
    : "";
  const rows: Array<{
    id: EnvironmentLayerKey;
    icon: ComponentType<{ size?: number }>;
    label: string;
    status: string;
    alert: boolean;
  }> = [
    {
      id: "satellite",
      icon: Satellite,
      label: "全球真实云图",
      status: layerStatusText(satellite),
      alert: satellite?.status !== "available" || Boolean(satellite?.isStale)
    },
    {
      id: "impact",
      icon: Shield,
      label: "官方风圈",
      status: officialWindRadiusFeatureCount > 0
        ? `${officialWindRadiusFeatureCount} 个官方风圈`
        : impactArea?.status === "available" ? `${impactArea.featureCount} 个风力阈值范围` : impactArea?.reason ?? "等待资料",
      alert: impactArea?.status !== "available"
    },
    {
      id: "wind",
      icon: Wind,
      label: hasDirectNcepGfs ? "NCEP GFS 10m 风" : "备用环境风（非 GFS）",
      status:
        windField?.status === "available"
          ? hasDirectNcepGfs
            ? windField.points.length > 0
              ? `${windField.isStale ? "延迟保护 · " : ""}${windField.points.length} 格点 · ${windResolution}${coreResolution} · ${windField.cycle ?? "未知时次"}`
              : `视口格点加载中 · ${windField.cycle ?? "未知时次"}`
            : `${windField.model} · 未冒充 NCEP`
          : "官方模式格点暂不可用",
      alert: windField?.status !== "available" || !hasDirectNcepGfs || Boolean(windField?.isStale)
    }
  ];
  const selectWindRenderMode = (mode: WindRenderMode) => {
    // The display-mode controls are also the fastest way to silence an active
    // wind visual. Clicking the active mode closes it; choosing the other
    // mode swaps it in, and a closed wind layer is reopened explicitly.
    if (layers.wind && windRenderMode === mode) {
      onToggle("wind");
      return;
    }
    if (!layers.wind) onToggle("wind");
    onWindRenderModeChange(mode);
  };

  return (
    <HudPanel as="aside" className={`environment-panel ${className} ${collapsible ? "is-collapsible" : ""} ${collapsed ? "is-collapsed" : ""}`.trim()} aria-label="环境图层控制">
      <div className="environment-panel-heading">
        <div className="section-title compact">
          <Satellite size={16} />
          <span>环境图层</span>
        </div>
        {collapsible ? (
          <button className="environment-panel-collapse" type="button" onClick={onCollapsedChange} aria-expanded={!collapsed}>
            {collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
            <span>{collapsed ? "放下" : "收起"}</span>
          </button>
        ) : null}
      </div>
      <div className="environment-panel-content" aria-hidden={collapsed}>
      <div className="environment-panel-content-inner">
      <small className="section-subtitle">卫星云图 / 大气模式 / 海洋环境</small>
      <div className="environment-layer-list">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <button
              className={`environment-layer-row ${layers[row.id] ? "active" : ""} ${row.alert ? "has-warning" : ""}`}
              key={row.id}
              type="button"
              onClick={() => onToggle(row.id)}
              aria-pressed={layers[row.id]}
            >
              <Icon size={16} />
              <span>{row.label}</span>
              <b>{layers[row.id] ? "开启" : "关闭"}</b>
              <small>{row.status}</small>
            </button>
          );
        })}
      </div>
      <div className="gfs-scalar-control" aria-label="GFS 气象格点图层">
        <span>GFS 格点分析</span>
        <div role="group" aria-label="选择 GFS 气象图层">
          {([
            ["pressure", "气压"],
            ["precipitation", "降水"],
            ["gust", "阵风"],
            ["reflectivity", "模式回波"],
            ["precipitable-water", "水汽"]
          ] as Array<[GfsScalarLayerId, string]>).map(([id, label]) => (
            <button
              className={gfsScalarLayer === id ? "active" : ""}
              key={id}
              onClick={() => onGfsScalarLayerChange(gfsScalarLayer === id ? null : id)}
              type="button"
              aria-pressed={gfsScalarLayer === id}
            >{label}</button>
          ))}
        </div>
        <small>{gfsScalarPayload
          ? `${gfsScalarPayload.label} · ${gfsScalarPayload.points.length} 格点 · ${gfsScalarPayload.cycle} · ${gfsScalarPayload.unit}`
          : "按当前视口请求；模式回波不是实况雷达。"}</small>
      </div>
      <div className="supplemental-layer-grid">
      <div className="cwa-radar-control" aria-label="CWA 实况雷达图层">
        <span>降水实况</span>
        <button
          className={cwaRadarVisible ? "active" : ""}
          disabled={cwaRadar?.status !== "available"}
          onClick={onCwaRadarToggle}
          type="button"
          aria-pressed={cwaRadarVisible}
        >CWA 实况雷达</button>
        <small>{cwaRadar?.status === "available"
          ? `${formatClock(cwaRadar.updatedAt)} · 10 分钟更新${cwaRadar.isStale ? " · 资料偏旧" : ""}`
          : cwaRadar?.reason ?? "正在连接台湾中央气象署实况雷达…"}</small>
      </div>
      <div className="gfs-wave-control" aria-label="GFS Wave 海况图层">
        <span>海况模式</span>
        <button className={gfsWaveVisible ? "active" : ""} onClick={onGfsWaveToggle} type="button" aria-pressed={gfsWaveVisible}>
          GFS Wave 波高 / 波向
        </button>
        <small>{gfsWave
          ? `${gfsWave.points.length} 格点 · ${gfsWave.cycle} · 有效波高 m`
          : "按当前视口请求；箭头表示主波向。"}</small>
      </div>
      <div className="marine-current-control" aria-label="全球洋流粒子图层">
        <span>海洋动力</span>
        <button className={layers.marineCurrent ? "active" : ""} onClick={() => onToggle("marineCurrent")} type="button" aria-pressed={layers.marineCurrent}>
          {layers.marineCurrent ? "关闭全球洋流粒子" : "全球洋流粒子"}
        </button>
        <small>{marineLayer?.status === "available"
          ? `${marineLayer.points.length} 格点 · ${marineLayer.model}${marineLayer.isStale ? " · 延迟保护" : ""}`
          : marineLayer?.reason ?? "按当前视口请求；粒子表示表层洋流方向。"}</small>
      </div>
      <div className="marine-sst-control" aria-label="海表温度分布图层">
        <span>海温分布</span>
        <button className={layers.seaSurfaceTemperature ? "active" : ""} onClick={() => onToggle("seaSurfaceTemperature")} type="button" aria-pressed={layers.seaSurfaceTemperature}>
          {layers.seaSurfaceTemperature ? "关闭海表温度" : "海表温度分布"}
        </button>
        <small>{marineLayer?.status === "available"
          ? `${marineLayer.points.length} 格点 · °C${marineLayer.isStale ? " · 延迟保护" : ""}`
          : marineLayer?.reason ?? "按当前视口请求；颜色表示海表温度。"}</small>
      </div>
      <div className="ecmwf-track-control" aria-label="ECMWF 集合路径图层">
        <span>补充路径资料</span>
        <button
          className={ecmwfTracksVisible ? "active" : ""}
          onClick={onEcmwfTracksToggle}
          type="button"
          aria-pressed={ecmwfTracksVisible}
        >{ecmwfTracksVisible ? "停止 ECMWF 路径" : "ECMWF 集合路径"}</button>
        <small>{!ecmwfTracksVisible
          ? "按需获取；点击后开始请求，随时可停止。"
          : ecmwfTracks?.status === "available"
          ? ecmwfMemberCount > 0 ? `${ecmwfTracks.cycle} · 匹配 ${ecmwfMemberCount} 个集合成员` : `${ecmwfTracks.cycle} · 当前目标未匹配到成员`
          : ecmwfTracks?.reason ?? "正在获取 ECMWF BUFR 路径…"}</small>
      </div>
      <div className="observation-control" aria-label="区域实况观测图层">
        <span>区域观测</span>
        <button
          className={observationsVisible ? "active" : ""}
          disabled={observations?.status !== "available"}
          onClick={onObservationsToggle}
          type="button"
          aria-pressed={observationsVisible}
        >测站 / 浮标 / 闪电</button>
        <small>{observations?.status === "available"
          ? `${observations.points.filter((point) => point.kind === "station").length} 站 · ${observations.points.filter((point) => point.kind === "buoy").length} 浮标 · ${observations.points.filter((point) => point.kind === "lightning").length} 闪电`
          : observations?.reason ?? "正在获取区域实况观测…"}</small>
      </div>
      </div>
      <div className="wind-render-mode" aria-label="10 米风显示方式">
        <span>10m 风显示</span>
        <div role="group" aria-label="选择风场显示方式">
          <button className={layers.wind && windRenderMode === "streamlines" ? "active" : ""} type="button" onClick={() => selectWindRenderMode("streamlines")} aria-pressed={layers.wind && windRenderMode === "streamlines"}>
            {layers.wind && windRenderMode === "streamlines" ? "关闭流线" : "全屏流线"}
          </button>
          <button className={layers.wind && windRenderMode === "gfs" ? "active" : ""} type="button" onClick={() => selectWindRenderMode("gfs")} aria-pressed={layers.wind && windRenderMode === "gfs"}>
            {layers.wind && windRenderMode === "gfs" ? "关闭风羽" : "GFS 风羽"}
          </button>
        </div>
        <small>
          {windRenderMode === "streamlines"
            ? hasDirectNcepGfs
              ? "严格按当前 GFS U/V 格点积分；不叠加理想化台风核心。"
              : "按已标明来源的备用模式风积分；不冒充原始 GFS。"
            : "原始模式格点；风羽按 5 kt 编码。"}
        </small>
        <div className="gfs-wind-key" aria-label="10米风速色阶"><i /><i /><i /><i /><i /><span>0 · 5 · 10 · 17 · 25 · 33 · 45+ m/s</span></div>
      </div>
      <div className="terrain-elevation-key" aria-label="地形高程色阶">
        <span>地形高差</span>
        <div className="terrain-key-ramp" aria-hidden="true">
          <i className="terrain-low" />
          <i className="terrain-plain" />
          <i className="terrain-hill" />
          <i className="terrain-mountain" />
          <i className="terrain-high" />
        </div>
        <small>80 / 250 / 700 / 1400 / 2600m+</small>
      </div>
      <p className="environment-attribution">
        {windField?.status === "available" ? `${windField.source} · ${windField.model} · ${windField.unit}` : "仅显示已接通的实时公开数据源。"}
      </p>
      </div>
      </div>
    </HudPanel>
  );
}

function layerStatusText(layer: SatelliteLayerPayload | null) {
  if (!layer) return "等待资料";
  if (layer.status !== "available") return layer.reason ?? "链路不可用";
  if (layer.isStale) return "资料偏旧";
  const synchronizedAt = layer.synchronizedAt ?? layer.updatedAt;
  const skew = layer.synchronizationSkewMinutes ?? 0;
  const referenceSkew = layer.referenceSkewMinutes ?? 0;
  const interval = layer.refreshIntervalMinutes ?? 30;
  return `同步 ${formatClock(synchronizedAt)} · 云Δ${skew}m · 路径Δ${referenceSkew}m / ${interval}m刷新`;
}

function DossierStormIndex({
  storms,
  activeIndex,
  onSelect
}: {
  storms: Storm[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav className="dossier-storm-index" aria-label="档案目标索引">
      <div className="dossier-storm-index-head">
        <span>CASE INDEX</span>
        <b>{storms.length || 0} FILES</b>
      </div>
      <div className="dossier-storm-tabs">
        {storms.length > 0 ? (
          storms.map((item, index) => (
            <button className={index === activeIndex ? "active" : ""} key={item.id} type="button" onClick={() => onSelect(index)}>
              <span>{item.code}</span>
              <strong>{item.nameZh}</strong>
              <small>{item.stage}</small>
            </button>
          ))
        ) : (
          <button className="active" type="button">
            <span>NO FILE</span>
            <strong>待机扫描</strong>
            <small>当前无活动台风</small>
          </button>
        )}
      </div>
    </nav>
  );
}

function ImpactLegend() {
  return (
    <HudPanel as="aside" className="impact-legend" aria-label="影响范围图例">
      <div className="section-title">
        <Wind size={18} />
        <span>IMPACT RANGE</span>
      </div>
      <small className="section-subtitle">影响范围</small>
      <LegendLine color="cyan" label="七级风圈" detail=">= 10.8 m/s" />
      <LegendLine color="yellow" label="十级风圈" detail=">= 24.5 m/s" />
      <LegendLine color="red" label="十二级风圈" detail=">= 32.7 m/s" />
      <LegendLine color="white" label="多机构路径" detail="CMA / JMA / JTWC 等" />
    </HudPanel>
  );
}

function LegendLine({ color, label, detail }: { color: string; label: string; detail: string }) {
  return (
    <div className="legend-line">
      <i className={`legend-swatch ${color}`} />
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  );
}

function BottomAlertBar({
  storm,
  bossProfile,
  alerts,
  dataError,
  sourceLabel,
  lastTrackedStorm
}: {
  storm: Storm | null;
  bossProfile?: BossProfile | null;
  alerts: ReturnType<typeof buildProvinceAlerts>;
  dataError: string | null;
  sourceLabel: string;
  lastTrackedStorm: { nameZh: string; nameEn: string; lastObservedAt: string; status: "active" | "exited-live-track" } | null;
}) {
  const events = bossProfile?.events.slice(0, 3) ?? [];
  const isClosure = !storm && lastTrackedStorm?.status === "exited-live-track";
  const message = dataError
    ? "数据链路异常，请以官方预警为准。雷达将在下一轮刷新时重试。"
    : isClosure
      ? `${lastTrackedStorm.nameZh} 已退出实时路径清单；当前未发现活动台风，雷达继续监听后续公开实况。`
    : bossProfile
      ? bossProfile.riskSummary
    : storm
      ? `${storm.nameZh} 当前为${storm.stage}，中心最大风速 ${storm.maxWind || "暂无"} m/s，请沿海地区持续关注路径变化。`
      : "当前无活动台风，雷达保持待机巡航。";

  return (
    <footer className={`bottom-command ${isClosure ? "is-cycle-closed" : ""}`}>
      <div className="bottom-defense-title">
        {isClosure ? <RadioTower size={40} /> : <Shield size={40} />}
        <div>
          <b>{isClosure ? "本轮台风收束" : "BOSS 战况追踪"}</b>
          <span>{isClosure ? "最后实况归档 / 实时监听" : "战斗履历 / 省份防线"}</span>
        </div>
      </div>
      <div className="boss-event-strip">
        {events.length > 0
          ? events.map((event) => (
              <div className={`boss-event-card evidence-${event.evidenceLevel} category-${event.category ?? "general"}`} key={event.id}>
                <b>{event.title}</b>
                <p>{event.detail}</p>
                <small>{formatClock(event.time)} / {event.sourceLabel ? `${event.sourceLabel} / ` : ""}{eventEvidenceLabel(event.evidenceLevel)}</small>
              </div>
            ))
          : isClosure
            ? [
              { title: "实时路径状态", detail: `${lastTrackedStorm.nameZh} 已退出活动清单`, note: "本轮路径追踪已收束" },
              { title: "最后公开实况", detail: `${formatClock(lastTrackedStorm.lastObservedAt)} · ${lastTrackedStorm.nameEn}`, note: "保留最后有效时次，不延用旧路径" },
              { title: "雷达监听", detail: "当前 0 个活动台风", note: "等待上游发布新目标" }
            ].map((item) => (
              <div className="boss-event-card is-cycle-closure" key={item.title}>
                <b>{item.title}</b>
                <p><ScrollWhenOverflow>{item.detail}</ScrollWhenOverflow></p>
                <small><ScrollWhenOverflow>{item.note}</ScrollWhenOverflow></small>
              </div>
            ))
            : alerts.slice(0, 3).map((item) => (
              <div className={`boss-event-card level-${item.level}`} key={item.name}>
                <b>{item.name}</b>
                <p>{item.label}</p>
                <small>省份防线 / 巡航态势</small>
              </div>
            ))}
      </div>
      <div className="bottom-source-rack">
        <span>路径 / 权威来源</span>
        <b>{bossProfile?.sourcePolicy.machineReadableTrackSource ?? sourceLabel}</b>
        <small>{bossProfile?.sourcePolicy.canonicalAuthority ?? "JMA HIMAWARI / OPEN-METEO"}</small>
      </div>
      <div className="alert-ticker">
        <AlertTriangle size={18} />
        <p>{message}</p>
        <Link href="/dex">
          <Database size={16} />
          历史图鉴
        </Link>
      </div>
    </footer>
  );
}

function ScrollWhenOverflow({ children }: { children: string }) {
  const viewportRef = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setOverflowing(viewport.scrollWidth > viewport.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [children]);

  return (
    <span className={`boss-event-scroll ${overflowing ? "is-overflowing" : ""}`} ref={viewportRef} title={children}>
      <span className="boss-event-scroll-track">
        <span>{children}</span>
        {overflowing ? <span aria-hidden="true">{children}</span> : null}
      </span>
    </span>
  );
}

async function fetchProvinceGeoJson(): Promise<GeoJSON.FeatureCollection> {
  try {
    const response = await fetch("/api/geo/provinces");
    if (!response.ok) throw new Error("Province geo API unavailable");
    return (await response.json()) as GeoJSON.FeatureCollection;
  } catch {
    return emptyFeatureCollection();
  }
}

function focusMapOnStormFleet(map: MapLibreMap, storms: Storm[], animated: boolean) {
  const bounds = stormFleetBounds(storms);
  if (!bounds) {
    focusMapOnStorm(map, null, animated);
    return;
  }
  const width = map.getCanvas().clientWidth;
  const height = map.getCanvas().clientHeight;
  map.fitBounds(bounds, {
    padding: {
      top: height <= 760 ? 126 : 142,
      bottom: height <= 760 ? 128 : 146,
      left: width <= 760 ? 28 : width <= 1180 ? 278 : 320,
      right: width <= 760 ? 28 : width <= 1180 ? 238 : 270
    },
    maxZoom: 4.7,
    duration: animated ? 900 : 0
  });
}

function CurrentStormControl({ storms, activeIndex, onSelect }: { storms: Storm[]; activeIndex: number; onSelect: (index: number) => void }) {
  const storm = storms[activeIndex] ?? null;
  const canSwitch = storms.length > 1;
  const move = (delta: number) => canSwitch && onSelect((activeIndex + delta + storms.length) % storms.length);
  return (
    <section className="current-storm-control" aria-label="当前台风">
      <span>当前台风 · {storms.length} 个同屏目标{storm ? ` · 已锁定 ${formatClock(storm.updatedAt)}` : ""}</span>
      <div aria-live="polite">
        <button type="button" aria-label="锁定上一个台风" onClick={() => move(-1)} disabled={!canSwitch}><ChevronLeft size={15} /></button>
        <strong>{storm ? `${storm.code} ${storm.nameZh}` : "待机"}</strong>
        <em>{storm?.stage ?? "--"} · {storm?.maxWind ?? "--"} m/s</em>
        <button type="button" aria-label="锁定下一个台风" onClick={() => move(1)} disabled={!canSwitch}><ChevronRight size={15} /></button>
      </div>
    </section>
  );
}

function setLayerVisibility(map: MapLibreMap, layerIds: string[], visible: boolean) {
  layerIds.forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  });
}


function startGfsScalarLayerRenderer(
  map: MapLibreMap,
  canvas: HTMLCanvasElement,
  payload: GfsScalarLayerPayload | null
) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;

  const render = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!payload?.points.length) return;

    const halfCell = Math.max(payload.displayResolutionDegrees, 0.25) * 0.56;
    context.save();
    context.globalCompositeOperation = "source-over";
    for (const point of payload.points) {
      const northwest = map.project([point.lon - halfCell, point.lat + halfCell]);
      const southeast = map.project([point.lon + halfCell, point.lat - halfCell]);
      const cellWidth = Math.max(2, southeast.x - northwest.x + 1);
      const cellHeight = Math.max(2, southeast.y - northwest.y + 1);
      const color = gfsScalarColor(payload.layer, point.value);
      if (!color) continue;
      context.fillStyle = color;
      context.fillRect(northwest.x, northwest.y, cellWidth, cellHeight);
    }
    context.restore();
  };

  render();
  map.on("move", render);
  map.on("zoom", render);
  map.on("resize", render);
  return () => {
    map.off("move", render);
    map.off("zoom", render);
    map.off("resize", render);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  };
}

function gfsScalarColor(layer: GfsScalarLayerId, value: number) {
  if (layer === "pressure") {
    const t = Math.max(0, Math.min(1, (value - 960) / 80));
    return `rgba(${Math.round(220 - t * 175)},${Math.round(62 + t * 145)},${Math.round(92 + t * 138)},0.2)`;
  }
  if (layer === "precipitation") {
    if (value < 0.05) return null;
    // Rain intensity is encoded with one intuitive hue: more rain means a
    // deeper, darker blue instead of switching through unrelated alert colors.
    if (value < 1) return "rgba(157,220,255,0.24)";
    if (value < 5) return "rgba(77,166,245,0.34)";
    if (value < 15) return "rgba(25,103,210,0.44)";
    return "rgba(5,35,120,0.58)";
  }
  if (layer === "gust") {
    if (value < 5) return null;
    if (value < 15) return "rgba(37,211,177,0.2)";
    if (value < 25) return "rgba(255,202,61,0.32)";
    if (value < 35) return "rgba(255,101,38,0.42)";
    return "rgba(235,38,72,0.52)";
  }
  if (layer === "reflectivity") {
    if (value < 5) return null;
    if (value < 20) return "rgba(49,203,111,0.24)";
    if (value < 35) return "rgba(242,220,55,0.34)";
    if (value < 50) return "rgba(246,103,38,0.44)";
    return "rgba(210,40,165,0.54)";
  }
  if (value < 20) return "rgba(56,120,216,0.12)";
  if (value < 40) return "rgba(31,205,220,0.2)";
  if (value < 60) return "rgba(45,224,146,0.28)";
  return "rgba(255,205,66,0.36)";
}

function startGfsWaveRenderer(map: MapLibreMap, canvas: HTMLCanvasElement, payload: GfsWaveLayerPayload | null) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;
  const render = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!payload?.points.length) return;
    const halfCell = Math.max(payload.displayResolutionDegrees, 0.25) * 0.56;
    const arrowStride = Math.max(1, Math.ceil(Math.sqrt(payload.points.length / 420)));
    payload.points.forEach((point, index) => {
      if (point.heightM < 0.15) return;
      const northwest = map.project([point.lon - halfCell, point.lat + halfCell]);
      const southeast = map.project([point.lon + halfCell, point.lat - halfCell]);
      context.fillStyle = waveHeightColor(point.heightM);
      context.fillRect(northwest.x, northwest.y, Math.max(2, southeast.x - northwest.x + 1), Math.max(2, southeast.y - northwest.y + 1));
      if (index % arrowStride !== 0) return;
      const center = map.project([point.lon, point.lat]);
      const radians = (point.directionDeg * Math.PI) / 180;
      const length = 7 + Math.min(7, point.heightM * 1.4);
      const dx = Math.sin(radians) * length;
      const dy = -Math.cos(radians) * length;
      context.strokeStyle = "rgba(224,252,255,0.72)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(center.x - dx * 0.5, center.y - dy * 0.5);
      context.lineTo(center.x + dx * 0.5, center.y + dy * 0.5);
      context.stroke();
    });
  };
  render();
  map.on("move", render); map.on("zoom", render); map.on("resize", render);
  return () => { map.off("move", render); map.off("zoom", render); map.off("resize", render); context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight); };
}

function waveHeightColor(heightM: number) {
  if (heightM < 1) return "rgba(32,139,190,0.18)";
  if (heightM < 2.5) return "rgba(29,190,193,0.25)";
  if (heightM < 4) return "rgba(239,207,63,0.34)";
  if (heightM < 6) return "rgba(248,118,44,0.43)";
  return "rgba(220,40,82,0.52)";
}

function matchEcmwfTracks(storm: Storm | null, payload: EcmwfTrackPayload | null) {
  if (!storm || payload?.status !== "available") return { deterministic: null, ensemble: null };
  const nearest = (tracks: EcmwfStormTrack[]) => {
    let match: EcmwfStormTrack | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const candidate of tracks) {
      const point = candidate.members[0]?.points[0];
      if (!point) continue;
      const nextDistance = distanceBetweenKm(storm.position, point);
      if (nextDistance < distance) { distance = nextDistance; match = candidate; }
    }
    return distance <= 800 ? match : null;
  };
  return { deterministic: nearest(payload.deterministic), ensemble: nearest(payload.ensemble) };
}

function startEcmwfTrackRenderer(
  map: MapLibreMap,
  canvas: HTMLCanvasElement,
  tracks: { deterministic: EcmwfStormTrack | null; ensemble: EcmwfStormTrack | null },
  visible: boolean
) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;
  const render = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!visible) return;
    for (const member of tracks.ensemble?.members ?? []) drawModelTrack(context, map, member.points, "rgba(207,119,255,0.2)", 1);
    const deterministic = tracks.deterministic?.members[0];
    if (deterministic) drawModelTrack(context, map, deterministic.points, "rgba(255,181,61,0.92)", 2.4);
  };
  render(); map.on("move", render); map.on("zoom", render); map.on("resize", render);
  return () => { map.off("move", render); map.off("zoom", render); map.off("resize", render); context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight); };
}

function drawModelTrack(context: CanvasRenderingContext2D, map: MapLibreMap, points: Array<{ lon: number; lat: number }>, color: string, width: number) {
  if (points.length < 2) return;
  context.beginPath();
  points.forEach((point, index) => {
    const pixel = map.project([point.lon, point.lat]);
    if (index === 0) context.moveTo(pixel.x, pixel.y); else context.lineTo(pixel.x, pixel.y);
  });
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash(width > 2 ? [8, 5] : []);
  context.stroke();
  context.setLineDash([]);
}

function startRegionalObservationRenderer(map: MapLibreMap, canvas: HTMLCanvasElement, payload: RegionalObservationPayload | null, visible: boolean) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;
  const render = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr)); const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!visible || payload?.status !== "available") return;
    for (const point of payload.points) {
      const pixel = map.project([point.lon, point.lat]);
      if (pixel.x < -10 || pixel.y < -10 || pixel.x > canvas.clientWidth + 10 || pixel.y > canvas.clientHeight + 10) continue;
      if (point.kind === "station") {
        context.beginPath(); context.arc(pixel.x, pixel.y, 2.2, 0, Math.PI * 2);
        context.fillStyle = point.gustSpeed && point.gustSpeed >= 17 ? "#ff7449" : "rgba(139,246,226,0.88)"; context.fill();
      } else if (point.kind === "buoy") {
        context.save(); context.translate(pixel.x, pixel.y); context.rotate(Math.PI / 4); context.fillStyle = "#ffd65b"; context.fillRect(-3, -3, 6, 6); context.restore();
      } else {
        context.strokeStyle = "#fff36a"; context.lineWidth = 1.5; context.beginPath(); context.moveTo(pixel.x + 2, pixel.y - 5); context.lineTo(pixel.x - 2, pixel.y); context.lineTo(pixel.x + 1, pixel.y); context.lineTo(pixel.x - 2, pixel.y + 5); context.stroke();
      }
    }
  };
  render(); map.on("move", render); map.on("zoom", render); map.on("resize", render);
  return () => { map.off("move", render); map.off("zoom", render); map.off("resize", render); context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight); };
}

function startStormIntensityRenderer(
  map: MapLibreMap,
  canvas: HTMLCanvasElement,
  storm: Storm | null,
  visible: boolean
) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;
  let frame = 0;

  const resizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const clear = () => {
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  };

  const render = () => {
    resizeCanvas();
    clear();
    if (!visible || !storm) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const renderScale = width <= 760 ? 0.48 : 0.38;
    const field = document.createElement("canvas");
    field.width = Math.max(1, Math.ceil(width * renderScale));
    field.height = Math.max(1, Math.ceil(height * renderScale));
    const fieldContext = field.getContext("2d");
    if (!fieldContext) return;

    const image = fieldContext.createImageData(field.width, field.height);
    const pixels = image.data;
    const center = map.project([storm.position.lon, storm.position.lat]);
    const radiusPx = Math.max(1, projectRadiusKmToPixels(map, storm.position, stormThreatRadiusKm(storm), center));
    const centerX = center.x * renderScale;
    const centerY = center.y * renderScale;
    const radiusX = radiusPx * renderScale;
    const radiusY = radiusX * 0.92;
    const seed = stableStormHash(storm.id) * 0.0007;
    const bearing = degToRad(stormVisualBearingDeg(storm));
    const intensity = Math.max(0.48, Math.min(1, (storm.maxWind || 32) / 66));
    const minX = Math.max(0, Math.floor(centerX - radiusX * 1.08));
    const maxX = Math.min(field.width - 1, Math.ceil(centerX + radiusX * 1.08));
    const minY = Math.max(0, Math.floor(centerY - radiusY * 1.08));
    const maxY = Math.min(field.height - 1, Math.ceil(centerY + radiusY * 1.08));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const nx = (x + 0.5 - centerX) / radiusX;
        const ny = (y + 0.5 - centerY) / radiusY;
        const angle = Math.atan2(ny, nx);
        const asymmetry =
          1 +
          Math.cos(angle - bearing) * 0.075 +
          Math.sin(angle * 3 + seed) * 0.035 +
          Math.sin(angle * 7 - seed * 0.4) * 0.018;
        const radius = Math.hypot(nx, ny) / asymmetry;
        if (radius > 1.035) continue;

        const strength = 1 - smoothStep(0.025, 1.02, radius);
        const spiralTexture = 0.94 + Math.sin(angle * 5.2 + radius * 16 - seed) * 0.035;
        const color = threatFieldColor(Math.max(0, Math.min(1, strength * spiralTexture)), intensity);
        const eyeOpening = smoothStep(0.018, 0.07, radius);
        const outerFade = 1 - smoothStep(0.94, 1.035, radius);
        const index = (y * field.width + x) * 4;
        pixels[index] = color[0];
        pixels[index + 1] = color[1];
        pixels[index + 2] = color[2];
        pixels[index + 3] = Math.round(color[3] * eyeOpening * outerFade);
      }
    }

    fieldContext.putImageData(image, 0, 0);
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(field, 0, 0, width, height);
    context.restore();
  };

  const schedule = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(render);
  };
  const clearWhileMoving = () => {
    window.cancelAnimationFrame(frame);
    clear();
  };
  const clearAndSchedule = () => {
    clearWhileMoving();
    schedule();
  };

  render();
  map.on("movestart", clearWhileMoving);
  map.on("moveend", schedule);
  map.on("zoomend", schedule);
  map.on("resize", clearAndSchedule);
  window.addEventListener("resize", schedule);

  return () => {
    window.cancelAnimationFrame(frame);
    map.off("movestart", clearWhileMoving);
    map.off("moveend", schedule);
    map.off("zoomend", schedule);
    map.off("resize", clearAndSchedule);
    window.removeEventListener("resize", schedule);
    clear();
  };
}

const THREAT_FIELD_STOPS = [
  [0, 24, 92, 145, 0],
  [0.06, 36, 101, 166, 96],
  [0.17, 48, 143, 194, 150],
  [0.3, 65, 207, 181, 190],
  [0.44, 213, 226, 78, 216],
  [0.6, 255, 158, 57, 232],
  [0.75, 233, 70, 107, 240],
  [0.89, 135, 40, 154, 246],
  [1, 42, 10, 76, 250]
] as const;

function threatFieldColor(value: number, intensity: number): [number, number, number, number] {
  const scaledValue = Math.max(0, Math.min(1, value * (0.88 + intensity * 0.16)));
  for (let index = 1; index < THREAT_FIELD_STOPS.length; index += 1) {
    const lower = THREAT_FIELD_STOPS[index - 1];
    const upper = THREAT_FIELD_STOPS[index];
    if (scaledValue > upper[0]) continue;
    const progress = (scaledValue - lower[0]) / Math.max(0.0001, upper[0] - lower[0]);
    return [
      Math.round(lower[1] + (upper[1] - lower[1]) * progress),
      Math.round(lower[2] + (upper[2] - lower[2]) * progress),
      Math.round(lower[3] + (upper[3] - lower[3]) * progress),
      Math.round((lower[4] + (upper[4] - lower[4]) * progress) * (0.72 + intensity * 0.28))
    ];
  }
  const last = THREAT_FIELD_STOPS[THREAT_FIELD_STOPS.length - 1];
  return [last[1], last[2], last[3], Math.round(last[4] * (0.72 + intensity * 0.28))];
}

function forecastScenariosForStorm(storm: Storm): ForecastScenario[] {
  if (storm.forecastScenarios.length > 0) return storm.forecastScenarios.slice(0, 5);
  if (storm.forecast.length < 2) return [];
  return [
    {
      id: `${storm.id}-primary-forecast`,
      agency: "中国",
      agencyCode: "CMA",
      points: storm.forecast,
      isPrimary: true
    }
  ];
}

function forecastScenarioStyle(scenario: ForecastScenario, index: number) {
  const fallbackColors = ["#fff0a8", "#61efff", "#9cff72", "#ff70c7", "#ff985d"];
  return {
    color: FORECAST_ROUTE_COLORS[scenario.agencyCode] ?? fallbackColors[index % fallbackColors.length],
    width: scenario.isPrimary ? 4.8 : 3.1,
    opacity: scenario.isPrimary ? 0.98 : 0.86
  };
}

function startForecastRouteRenderer(map: MapLibreMap, canvas: HTMLCanvasElement, storm: Storm | null) {
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) return undefined;
  let frame = 0;
  let width = 1;
  let height = 1;

  const resizeCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, CANVAS_DPR_CAP);
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    const pixelWidth = Math.max(1, Math.floor(width * dpr));
    const pixelHeight = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = () => {
    frame = 0;
    resizeCanvas();
    context.clearRect(0, 0, width, height);
    if (!storm) return;

    const scenarios = forecastScenariosForStorm(storm);
    scenarios.forEach((scenario, index) => {
      const points = scenario.points.map((point) => map.project([point.lon, point.lat]));
      if (points.length < 2) return;
      const path = smoothScreenPath(points);
      const style = forecastScenarioStyle(scenario, index);

      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = style.color;
      context.globalAlpha = scenario.isPrimary ? 0.26 : 0.17;
      context.lineWidth = style.width + (scenario.isPrimary ? 9 : 6);
      context.shadowColor = style.color;
      context.shadowBlur = scenario.isPrimary ? 18 : 12;
      context.stroke(path);

      context.globalAlpha = style.opacity;
      context.lineWidth = style.width;
      context.shadowBlur = scenario.isPrimary ? 8 : 4;
      context.setLineDash(scenario.isPrimary ? [14, 7] : [9, 7]);
      context.stroke(path);
      context.setLineDash([]);

      const endpoint = points[points.length - 1];
      context.globalAlpha = 0.96;
      context.fillStyle = style.color;
      context.beginPath();
      context.arc(endpoint.x, endpoint.y, scenario.isPrimary ? 5.5 : 4.2, 0, Math.PI * 2);
      context.fill();
      context.font = "800 10px ui-monospace, SFMono-Regular, Consolas, monospace";
      context.textBaseline = "middle";
      const labelWidth = context.measureText(scenario.agencyCode).width + 10;
      const labelX = Math.max(6, Math.min(width - labelWidth - 6, endpoint.x + 8));
      const labelY = Math.max(12, Math.min(height - 12, endpoint.y + (index - 2) * 13));
      context.fillStyle = "rgba(3, 8, 13, 0.84)";
      context.fillRect(labelX - 3, labelY - 8, labelWidth, 16);
      context.fillStyle = style.color;
      context.fillText(scenario.agencyCode, labelX + 2, labelY);
      context.restore();
    });
  };

  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(draw);
  };
  const clearAndSchedule = () => {
    context.clearRect(0, 0, width, height);
    schedule();
  };

  draw();
  map.on("move", schedule);
  map.on("resize", clearAndSchedule);
  window.addEventListener("resize", schedule);
  return () => {
    window.cancelAnimationFrame(frame);
    map.off("move", schedule);
    map.off("resize", clearAndSchedule);
    window.removeEventListener("resize", schedule);
    context.clearRect(0, 0, width, height);
  };
}

function smoothScreenPath(points: Array<{ x: number; y: number }>) {
  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    path.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  }
  const endpoint = points[points.length - 1];
  path.lineTo(endpoint.x, endpoint.y);
  return path;
}

function stableStormHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function smoothStep(edge0: number, edge1: number, value: number) {
  const progress = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
  return progress * progress * (3 - 2 * progress);
}

function startWindColorFieldRenderer(
  map: MapLibreMap,
  canvas: HTMLCanvasElement,
  windField: WindFieldPayload | null,
  detailWindField: WindFieldPayload | null,
  visible: boolean
) {
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) return undefined;
  const points = windField?.status === "available" ? windField.points : [];
  const detailPoints = detailWindField?.status === "available" ? detailWindField.points : [];
  const vectorIndex = createCompositeWindVectorIndex(points, detailPoints);
  const backdropTexture = document.createElement("canvas");
  let surface: ProjectedCanvasSurface | null = null;
  const resize = () => {
    surface = resizeProjectedCanvas(map, canvas, context, 1);
  };
  const clear = () => {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  };
  const draw = () => {
    canvas.style.transform = "none";
    resize();
    clear();
    if (!visible || (points.length === 0 && detailPoints.length === 0) || !surface) return;
    const textureMetrics = drawGfsWindBackdrop(context, map, vectorIndex, surface, backdropTexture, 0.48);
    canvas.dataset.cameraContinuity = "overscanned-affine-surface";
    canvas.dataset.overscanCoverage = `${Math.round(surface.width)}x${Math.round(surface.height)}`;
    canvas.dataset.backdropTexture = `${textureMetrics.width}x${textureMetrics.height}`;
    canvas.dataset.backdropRenderMs = textureMetrics.renderMs.toFixed(1);
    canvas.dataset.detailVectorCount = String(detailPoints.length);
    canvas.dataset.detailResolution = String(detailWindField?.displayResolutionDegrees ?? "none");
  };
  let cameraAnchors: CanvasCameraAnchors | null = null;
  const beginCameraMove = () => {
    canvas.style.transform = "none";
    cameraAnchors = captureCanvasCameraAnchors(map, canvas);
  };
  const followCamera = () => {
    if (!cameraAnchors) beginCameraMove();
    if (!cameraAnchors) return;
    const transform = canvasCameraTransform(map, cameraAnchors);
    canvas.style.transformOrigin = "0 0";
    canvas.style.transform = `matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${transform.e}, ${transform.f})`;
  };
  const finishCameraMove = () => {
    cameraAnchors = null;
    draw();
  };
  draw();
  map.on("movestart", beginCameraMove);
  map.on("move", followCamera);
  map.on("moveend", finishCameraMove);
  map.on("resize", draw);
  window.addEventListener("resize", draw);
  return () => {
    map.off("movestart", beginCameraMove);
    map.off("move", followCamera);
    map.off("moveend", finishCameraMove);
    map.off("resize", draw);
    window.removeEventListener("resize", draw);
    canvas.style.transform = "none";
    clear();
  };
}

interface CanvasCameraAnchors {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  topLeft: { lng: number; lat: number };
  topRight: { lng: number; lat: number };
  bottomLeft: { lng: number; lat: number };
}

function captureCanvasCameraAnchors(map: MapLibreMap, canvas: HTMLCanvasElement): CanvasCameraAnchors {
  const rect = canvas.getBoundingClientRect();
  const mapRect = map.getCanvas().getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const offsetX = rect.left - mapRect.left;
  const offsetY = rect.top - mapRect.top;
  const topLeft = map.unproject([offsetX, offsetY]);
  const topRight = map.unproject([offsetX + width, offsetY]);
  const bottomLeft = map.unproject([offsetX, offsetY + height]);
  return {
    width,
    height,
    offsetX,
    offsetY,
    topLeft: { lng: topLeft.lng, lat: topLeft.lat },
    topRight: { lng: topRight.lng, lat: topRight.lat },
    bottomLeft: { lng: bottomLeft.lng, lat: bottomLeft.lat }
  };
}

function canvasCameraTransform(map: MapLibreMap, anchors: CanvasCameraAnchors) {
  const topLeft = map.project([anchors.topLeft.lng, anchors.topLeft.lat]);
  const topRight = map.project([anchors.topRight.lng, anchors.topRight.lat]);
  const bottomLeft = map.project([anchors.bottomLeft.lng, anchors.bottomLeft.lat]);
  return {
    a: (topRight.x - topLeft.x) / anchors.width,
    b: (topRight.y - topLeft.y) / anchors.width,
    c: (bottomLeft.x - topLeft.x) / anchors.height,
    d: (bottomLeft.y - topLeft.y) / anchors.height,
    e: topLeft.x - anchors.offsetX,
    f: topLeft.y - anchors.offsetY
  };
}

interface ProjectedCanvasSurface {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  dpr: number;
}

function resizeProjectedCanvas(
  map: MapLibreMap,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  dprCap: number
): ProjectedCanvasSurface {
  const rect = canvas.getBoundingClientRect();
  const mapRect = map.getCanvas().getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const offsetX = rect.left - mapRect.left;
  const offsetY = rect.top - mapRect.top;
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  const pixelWidth = Math.max(1, Math.floor(width * dpr));
  const pixelHeight = Math.max(1, Math.floor(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(dpr, 0, 0, dpr, -offsetX * dpr, -offsetY * dpr);
  return { width, height, offsetX, offsetY, dpr };
}

function projectedCanvasWindBounds(
  map: MapLibreMap,
  surface: ProjectedCanvasSurface,
  paddingRatio = 0
): WindParticleBounds {
  const widthPadding = surface.width * paddingRatio;
  const heightPadding = surface.height * paddingRatio;
  const topLeft = map.unproject([surface.offsetX - widthPadding, surface.offsetY - heightPadding]);
  const bottomRight = map.unproject([
    surface.offsetX + surface.width + widthPadding,
    surface.offsetY + surface.height + heightPadding
  ]);
  return {
    west: Math.max(-180, Math.min(topLeft.lng, bottomRight.lng)),
    east: Math.min(180, Math.max(topLeft.lng, bottomRight.lng)),
    south: Math.max(-80, Math.min(topLeft.lat, bottomRight.lat)),
    north: Math.min(80, Math.max(topLeft.lat, bottomRight.lat))
  };
}

function startWindFieldRenderer(
  map: MapLibreMap,
  canvas: HTMLCanvasElement,
  interactionCanvas: HTMLCanvasElement | null,
  windFieldRef: MutableRefObject<WindFieldPayload | null>,
  detailWindFieldRef: MutableRefObject<WindFieldPayload | null>,
  cycloneCoreRef: MutableRefObject<CycloneCoreAnalysis | null>,
  visible: boolean,
  renderMode: WindRenderMode,
  livePerformanceMode: boolean,
  flowKind: "wind" | "marine" = "wind"
) {
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) return undefined;
  const interactionContext = interactionCanvas?.getContext("2d", { alpha: true, desynchronized: true }) ?? null;

  const seedMode: WindParticleSeedMode = new URLSearchParams(window.location.search).get("windSeed") === "viewport"
    ? "viewport"
    : "stable";

  let frame = 0;
  let projectionFrame = 0;
  let moveEndTimer = 0;
  let interactionHideTimer = 0;
  let lastFrameTime = 0;
  let frameTimingTotal = 0;
  let frameTimingMax = 0;
  let frameTimingSamples = 0;
  let renderTimingTotal = 0;
  let renderTimingMax = 0;
  let renderTimingSamples = 0;
  let underBudgetFrameCount = 0;
  const recentRenderTimes: number[] = [];
  let adaptiveQuality = livePerformanceMode ? 0.78 : 0.62;
  let canvasWidth = 1;
  let canvasHeight = 1;
  let surface: ProjectedCanvasSurface | null = null;
  let cameraRevision = 1;
  let fieldHotSwapCount = 0;
  let cameraMoving = false;
  let cameraAnchors: CanvasCameraAnchors | null = null;
  let handoffReady = false;
  let projectionGeneration = 0;
  let particleSequence = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Let the browser present at display cadence. The adaptive particle budget
  // below controls work per frame; a 30 ms gate permanently capped even a
  // high-end GPU system near 30 fps and made interaction feel discontinuous.
  const targetFrameIntervalMs = 14;
  const targetRenderBudgetMs = livePerformanceMode ? 18 : 15;
  let observedWindField: WindFieldPayload | null = null;
  let observedDetailWindField: WindFieldPayload | null = null;
  let observedCoreSignature = "";
  let cycloneCore: CycloneCoreAnalysis | null = null;
  let points: WindFieldPoint[] = [];
  let vectorIndex = createCompositeWindVectorIndex(points);
  let particles: WindParticle[] = [];
  let seedCandidates: StableWindSeed[] = [];
  let policy: WindFlowPolicy;
  const flowSession = ++windFlowRendererSequence;
  const fadeDurationSeconds = 0.18;
  const isMarineFlow = flowKind === "marine";
  const minimumVectorSpeed = isMarineFlow ? 0.015 : 0.6;
  const calmVectorSpeed = isMarineFlow ? 0.025 : 1.1;

  const warmStartParticle = (particle: WindParticle, projectImmediately: boolean) => {
    if (points.length === 0) return particle;
    const sample = { u: 0, v: 0 };
    if (!sampleCompositeWindVector(vectorIndex, particle.lon, particle.lat, sample)) return particle;
    const initialSpeed = Math.hypot(sample.u, sample.v);
    if (initialSpeed < minimumVectorSpeed) return particle;
    const metresPerPixel = 156_543.03392 * Math.max(0.2, Math.cos(degToRad(particle.lat))) / 2 ** map.getZoom();
    const phase = 0.78 + (stableWindHash(`${particle.id}:warm`) / 0x1_0000_0000) * 0.32;
    const strengthScale = 0.35 + smoothStep(isMarineFlow ? 0.04 : 1.1, isMarineFlow ? 0.45 : 5, initialSpeed) * 0.65;
    const targetTravelKm = Math.max(8, (policy.targetTrailPx * metresPerPixel * phase * strengthScale) / 1000);
    const integrationSteps = 32;
    const stepDistanceMetres = (targetTravelKm * 1000) / integrationSteps;
    const trail: Array<{ lon: number; lat: number }> = [{ lon: particle.lon, lat: particle.lat }];
    let travelledKm = 0;
    for (let step = 0; step < integrationSteps; step += 1) {
      if (!sampleCompositeWindVector(vectorIndex, particle.lon, particle.lat, sample)) break;
      const speed = Math.hypot(sample.u, sample.v);
      if (speed < minimumVectorSpeed) break;
      const stepSeconds = stepDistanceMetres / speed;
      const latitudeScale = 111_320;
      const longitudeScale = latitudeScale * Math.max(0.2, Math.cos(degToRad(particle.lat)));
      particle.lon += (sample.u * stepSeconds) / longitudeScale;
      particle.lat += (sample.v * stepSeconds) / latitudeScale;
      particle.u = sample.u;
      particle.v = sample.v;
      travelledKm += stepDistanceMetres / 1000;
      trail.push({ lon: particle.lon, lat: particle.lat });
    }
    particle.trail = trail;
    particle.travelKm = travelledKm;
    if (projectImmediately) {
      particle.trailScreen = trail.map((point) => map.project([point.lon, point.lat]));
      particle.headScreen = map.project([particle.lon, particle.lat]);
      particle.projectionRevision = cameraRevision;
    } else {
      particle.trailScreen = [];
      particle.headScreen = null;
      particle.projectionRevision = 0;
    }
    return particle;
  };

  const resetParticle = (particle: WindParticle, currentBounds: WindParticleBounds, projectionRevision: number) => {
    const resetGeneration = particle.resetGeneration + 1;
    const preserved = {
      id: particle.id,
      opacity: particle.opacity,
      state: particle.state,
      resetGeneration
    } as const;
    if (seedMode === "stable" && seedCandidates.length > 0) {
      const seed = seedCandidates[stableWindHash(`${particle.id}:${resetGeneration}`) % seedCandidates.length];
      return warmStartParticle({ ...stableWindParticle(seed, projectionRevision, particle.id), ...preserved }, !cameraMoving);
    }
    return warmStartParticle({ ...randomWindParticle(currentBounds, projectionRevision, particle.id), ...preserved }, !cameraMoving);
  };

  const updatePolicy = () => {
    const basePolicy = computeWindFlowPolicy({
      zoom: map.getZoom(),
      viewportWidth: canvasWidth,
      viewportHeight: canvasHeight,
      adaptiveQuality,
      livePerformanceMode
    });
    policy = isMarineFlow ? {
      ...basePolicy,
      headSpacingPx: basePolicy.headSpacingPx * 1.22,
      targetTrailPx: basePolicy.targetTrailPx * 0.86,
      targetParticleCount: Math.max(180, Math.round(basePolicy.targetParticleCount * 0.42)),
      poolCapacity: Math.max(225, Math.round(basePolicy.poolCapacity * 0.42)),
      segmentBudget: Math.max(1_400, Math.round(basePolicy.segmentBudget * 0.38)),
      historyPointLimit: 96,
      minimumSampleDistancePx: 1.7
    } : basePolicy;
    canvas.dataset.targetTrailPx = policy.targetTrailPx.toFixed(1);
    canvas.dataset.headSpacingPx = policy.headSpacingPx.toFixed(1);
    canvas.dataset.segmentBudget = String(policy.segmentBudget);
    canvas.dataset.particleBudget = String(policy.targetParticleCount);
    canvas.dataset.trailPoints = String(policy.historyPointLimit);
  };

  const syncWindField = () => {
    const nextField = windFieldRef.current;
    const nextDetailField = detailWindFieldRef.current;
    if (nextField === observedWindField && nextDetailField === observedDetailWindField) return false;
    observedWindField = nextField;
    observedDetailWindField = nextDetailField;
    const ambientPoints = nextField?.status === "available"
      ? nextField.points
      : [];
    const detailPoints = nextDetailField?.status === "available"
      ? nextDetailField.points
      : [];
    points = mergeWindVectorPoints(ambientPoints, detailPoints);
    vectorIndex = createCompositeWindVectorIndex(ambientPoints, detailPoints);
    fieldHotSwapCount += 1;
    canvas.dataset.fieldHotSwaps = String(fieldHotSwapCount);
    canvas.dataset.vectorCount = String(points.length);
    canvas.dataset.ambientVectorCount = String(ambientPoints.length);
    canvas.dataset.detailVectorCount = String(detailPoints.length);
    canvas.dataset.windSource = nextField?.source ?? "unavailable";
    canvas.dataset.windResolution = String(nextField?.displayResolutionDegrees ?? "unknown");
    canvas.dataset.detailResolution = String(nextDetailField?.displayResolutionDegrees ?? "none");
    canvas.dataset.displayFrame = "geographic-source-grid";
    delete canvas.dataset.displayRegistrationKm;
    delete canvas.dataset.displayAnchorLon;
    delete canvas.dataset.displayAnchorLat;
    delete canvas.dataset.analysisCenterLon;
    delete canvas.dataset.analysisCenterLat;
    delete canvas.dataset.analysisCenterX;
    delete canvas.dataset.analysisCenterY;
    return true;
  };

  const syncCycloneCore = () => {
    const nextCore = cycloneCoreRef.current;
    const nextSignature = nextCore?.signature ?? "none";
    if (nextSignature === observedCoreSignature) return false;
    observedCoreSignature = nextSignature;
    cycloneCore = nextCore;
    canvas.dataset.cycloneCoreMode = nextCore
      ? nextCore.hasConfirmedEye
        ? "jtwc-confirmed-eye"
        : "track-and-wind-radius-core"
      : "none";
    canvas.dataset.cycloneCenter = nextCore ? `${nextCore.center.lon.toFixed(4)},${nextCore.center.lat.toFixed(4)}` : "none";
    syncCycloneCoreScreen();
    canvas.dataset.eyeRadiusKm = nextCore?.hasConfirmedEye ? nextCore.eyeRadiusKm.toFixed(1) : "0";
    canvas.dataset.coreParticleCount = "0";
    return true;
  };

  const syncCycloneCoreScreen = () => {
    const centerScreen = cycloneCore ? map.project([cycloneCore.center.lon, cycloneCore.center.lat]) : null;
    canvas.dataset.cycloneCenterScreen = centerScreen ? `${centerScreen.x.toFixed(1)},${centerScreen.y.toFixed(1)}` : "none";
  };

  const resizeCanvas = () => {
    surface = resizeProjectedCanvas(map, canvas, context, 1);
    canvasWidth = Math.max(1, map.getCanvas().clientWidth);
    canvasHeight = Math.max(1, map.getCanvas().clientHeight);
  };

  const clear = () => {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  };

  const clearInteractionCanvas = () => {
    if (!interactionCanvas || !interactionContext) return;
    interactionContext.setTransform(1, 0, 0, 1, 0, 0);
    interactionContext.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
  };

  const reconcileParticlePool = (initial = false) => {
    updatePolicy();
    particles = particles.filter((particle) => {
      if (particle.state === "retiring" && particle.opacity <= 0) return false;
      return containsWindPoint(bounds, particle.lon, particle.lat);
    });

    let preservedParticles = 0;
    let spawnedParticles = 0;
    if (seedMode === "stable") {
      if (isMarineFlow) {
        const seedSpread = Math.max(0.1, observedWindField?.displayResolutionDegrees ?? 1) * 0.62;
        seedCandidates = points
          .filter((point) => point.speed >= minimumVectorSpeed && containsWindPoint(bounds, point.lon, point.lat))
          .flatMap((point) => Array.from({ length: 4 }, (_, slot) => {
            const key = `marine:${point.lon.toFixed(4)}:${point.lat.toFixed(4)}:${slot}`;
            const lon = point.lon + (stableWindHash(`${key}:lon`) / 0x1_0000_0000 - 0.5) * seedSpread;
            const lat = point.lat + (stableWindHash(`${key}:lat`) / 0x1_0000_0000 - 0.5) * seedSpread;
            return { key, lon, lat };
          }))
          .filter((seed) => containsWindPoint(bounds, seed.lon, seed.lat))
          .sort((left, right) => stableWindHash(left.key) - stableWindHash(right.key));
        canvas.dataset.stableSeedResolution = "marine-source-grid";
        canvas.dataset.stableSeedBlend = "0";
      } else {
        const hierarchical = createHierarchicalWindSeeds(bounds, policy.targetParticleCount);
        seedCandidates = hierarchical.seeds;
        canvas.dataset.stableSeedResolution = `${hierarchical.plan.lowerResolution}:${hierarchical.plan.upperResolution}`;
        canvas.dataset.stableSeedBlend = hierarchical.plan.blend.toFixed(3);
      }
      const reconciliation = planWindParticlePoolReconciliation(
        particles,
        seedCandidates,
        bounds,
        policy.targetParticleCount,
        policy.poolCapacity
      );
      const keep = new Set(reconciliation.keepIds);
      const reactivate = new Set(reconciliation.reactivateIds);
      const retire = new Set(reconciliation.retireIds);
      particles.forEach((particle) => {
        if (keep.has(particle.id) || reactivate.has(particle.id)) {
          particle.state = "active";
          preservedParticles += 1;
        } else if (retire.has(particle.id)) {
          particle.state = "retiring";
        }
      });
      const spawned = reconciliation.spawnSeeds.map((seed) => warmStartParticle(stableWindParticle(
        seed,
        cameraRevision,
        `stable:${seed.key}`,
        initial ? 1 : 0
      ), !cameraMoving));
      spawnedParticles = spawned.length;
      particles.push(...spawned);
    } else {
      seedCandidates = [];
      const active = particles
        .filter((particle) => particle.state === "active")
        .sort((left, right) => stableWindHash(left.id) - stableWindHash(right.id));
      preservedParticles = Math.min(active.length, policy.targetParticleCount);
      const desiredIds = new Set(active.slice(0, policy.targetParticleCount).map((particle) => particle.id));
      particles.forEach((particle) => {
        particle.state = desiredIds.has(particle.id) ? "active" : "retiring";
      });
      const availableSlots = Math.max(0, policy.poolCapacity - particles.length);
      const missing = Math.min(availableSlots, Math.max(0, policy.targetParticleCount - preservedParticles));
      for (let index = 0; index < missing; index += 1) {
        particles.push(warmStartParticle(
          randomWindParticle(bounds, cameraRevision, `viewport:${flowSession}:${++particleSequence}`, initial ? 1 : 0),
          !cameraMoving
        ));
      }
      spawnedParticles = missing;
    }

    canvas.dataset.particleCount = String(particles.length);
    canvas.dataset.preservedParticles = String(preservedParticles);
    canvas.dataset.spawnedParticles = String(spawnedParticles);
    canvas.dataset.retiringParticles = String(particles.filter((particle) => particle.state === "retiring").length);
  };

  resizeCanvas();
  updatePolicy();
  canvas.style.opacity = "1";
  canvas.style.transform = "none";
  if (interactionCanvas) {
    interactionCanvas.style.opacity = "0";
    interactionCanvas.style.visibility = "hidden";
    interactionCanvas.style.transform = "none";
  }
  if (!visible) {
    clear();
    return () => clear();
  }
  syncWindField();
  syncCycloneCore();
  let bounds = visibleWindBounds(map, 0.12);
  // Seed the whole layer from the observed/model grid. Injecting particles into
  // an idealized cyclone ring creates a visually perfect circle that the source
  // data does not support.
  const coreParticleCount = 0;
  reconcileParticlePool(true);
  canvas.dataset.flowSession = String(flowSession);
  canvas.dataset.renderer = isMarineFlow ? "open-meteo-marine-current-streamlines" : renderMode === "gfs" ? "ncep-gfs-wind-barbs" : "ncep-gfs-streamlines";
  canvas.dataset.vectorInterpolation = "structured-grid-bilinear-raw-uv";
  canvas.dataset.backgroundMode = "raw-ncep-gfs-grid";
  canvas.dataset.cameraContinuity = "interaction-snapshot-affine-transform-then-chunked-geographic-handoff";
  canvas.dataset.windSeedMode = seedMode;
  canvas.dataset.particleCount = String(particles.length);
  canvas.dataset.particleJourney = "model-grid-streamlines";
  canvas.dataset.simulationSecondsPerSecond = "18000";
  canvas.dataset.maxVisibleHeadDensity = "ambient:3/core:2";
  canvas.dataset.coreParticleCount = String(coreParticleCount);

  const drawStatic = () => {
    syncWindField();
    resizeCanvas();
    clear();
    context.globalCompositeOperation = "source-over";
    drawMeteorologicalWindBarbs(context, map, points, livePerformanceMode);
  };

  if (reducedMotion || renderMode === "gfs") {
    drawStatic();
    let staticCameraAnchors: CanvasCameraAnchors | null = null;
    const beginStaticCameraMove = () => {
      canvas.style.transform = "none";
      staticCameraAnchors = captureCanvasCameraAnchors(map, canvas);
    };
    const followStaticCamera = () => {
      if (!staticCameraAnchors) beginStaticCameraMove();
      if (!staticCameraAnchors) return;
      const transform = canvasCameraTransform(map, staticCameraAnchors);
      canvas.style.transformOrigin = "0 0";
      canvas.style.transform = `matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${transform.e}, ${transform.f})`;
    };
    const finishStaticCameraMove = () => {
      staticCameraAnchors = null;
      drawStatic();
    };
    map.on("movestart", beginStaticCameraMove);
    map.on("move", followStaticCamera);
    map.on("moveend", finishStaticCameraMove);
    map.on("resize", drawStatic);
    window.addEventListener("resize", drawStatic);
    return () => {
      map.off("movestart", beginStaticCameraMove);
      map.off("move", followStaticCamera);
      map.off("moveend", finishStaticCameraMove);
      map.off("resize", drawStatic);
      window.removeEventListener("resize", drawStatic);
      canvas.style.transform = "none";
      canvas.style.opacity = "1";
      clear();
    };
  }

  const render = (timeMs: number) => {
    if (document.visibilityState !== "visible") {
      frame = window.requestAnimationFrame(render);
      return;
    }
    if (cameraMoving) {
      lastFrameTime = timeMs;
      frame = window.requestAnimationFrame(render);
      return;
    }
    if (timeMs - lastFrameTime < targetFrameIntervalMs) {
      frame = window.requestAnimationFrame(render);
      return;
    }
    const frameIntervalMs = lastFrameTime > 0 ? timeMs - lastFrameTime : 0;
    const deltaSeconds = Math.min(0.034, Math.max(0.008, frameIntervalMs > 0 ? frameIntervalMs / 1000 : 1 / 60));
    if (frameIntervalMs > 0) {
      frameTimingTotal += frameIntervalMs;
      frameTimingMax = Math.max(frameTimingMax, frameIntervalMs);
      frameTimingSamples += 1;
      if (frameTimingSamples >= 60) {
        canvas.dataset.averageFrameMs = (frameTimingTotal / frameTimingSamples).toFixed(1);
        canvas.dataset.maxFrameMs = frameTimingMax.toFixed(1);
        frameTimingTotal = 0;
        frameTimingMax = 0;
        frameTimingSamples = 0;
      }
    }
    const renderStartedAt = performance.now();
    lastFrameTime = timeMs;

    syncWindField();
    syncCycloneCore();
    syncCycloneCoreScreen();
    clear();
    if (points.length === 0) {
      frame = window.requestAnimationFrame(render);
      return;
    }
    context.globalCompositeOperation = "source-over";
    const trailScale = 1.12;
    const strokeScale = 0.96;
    const opacityScale = 0.94;
    canvas.dataset.qualityScale = adaptiveQuality.toFixed(2);
    canvas.dataset.zoomSignal = policy.zoomSignal.toFixed(2);
    const paths = WIND_PARTICLE_STYLES.map(() => WIND_RIBBON_LAYERS.map(() => WIND_OPACITY_BUCKETS.map(() => new Path2D())));
    const pathCounts = WIND_PARTICLE_STYLES.map(() => WIND_RIBBON_LAYERS.map(() => WIND_OPACITY_BUCKETS.map(() => 0)));
    let rawTrailLengthTotal = 0;
    let renderedTrailLengthTotal = 0;
    let measuredTrailCount = 0;
    const impactTintCounts: Record<WindImpactTint, number> = { none: 0, r7: 0, r10: 0, r12: 0 };
    let reseedCount = 0;
    let densitySuppressedCount = 0;
    let segmentBudgetUsed = 0;
    let renderedParticleCount = 0;
    const reseedBudget = Math.max(6, Math.ceil(particles.length / 26));
    // A streamline is a finite sample of the model field, rather than a
    // permanently released tracer.  That keeps a real closed or weak-wind
    // circulation from collecting every particle on its innermost orbit.
    const simulationSecondsPerSecond = isMarineFlow
      ? 96_000 - policy.zoomSignal * 16_000
      : 18_000 - policy.zoomSignal * 4_000;
    const simulationSeconds = simulationSecondsPerSecond * deltaSeconds;
    canvas.dataset.simulationSecondsPerSecond = simulationSecondsPerSecond.toFixed(0);
    const visibleAmbientHeads = new Map<number, number>();
    const visibleCoreHeads = new Map<number, number>();
    const windSample = { u: 0, v: 0 };
    const midpointSample = { u: 0, v: 0 };
    const ambientHeadCellSize = policy.headSpacingPx;
    const coreHeadCellSize = Math.max(24, policy.headSpacingPx * 0.72);
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      particle.opacity = particle.state === "retiring"
        ? Math.max(0, particle.opacity - deltaSeconds / fadeDurationSeconds)
        : Math.min(1, particle.opacity + deltaSeconds / fadeDurationSeconds);
      if (particle.opacity <= 0) continue;
      if (particle.kind === "core" && !cycloneCore) {
        Object.assign(particle, resetParticle(particle, bounds, cameraRevision));
      }
      if (particle.projectionRevision !== cameraRevision) {
        continue;
      }
      if (!sampleCompositeWindVector(vectorIndex, particle.lon, particle.lat, windSample)) {
        if (reseedCount < reseedBudget) {
          Object.assign(particle, resetParticle(particle, bounds, cameraRevision));
          reseedCount += 1;
        }
        continue;
      }

      if (particle.trail.length === 0) {
        particle.trail.push({ lon: particle.lon, lat: particle.lat });
        particle.trailScreen.push(map.project([particle.lon, particle.lat]));
      }

      // This is streamline integration distance, not a playback-speed trick:
      // the finite-distance cap below keeps the visual field evenly sampled
      // while the direction and speed remain the raw NCEP U/V values.
      const latitudeScale = 111_320;
      const startLongitudeScale = latitudeScale * Math.max(0.2, Math.cos(degToRad(particle.lat)));
      const midpointLon = particle.lon + (windSample.u * simulationSeconds * 0.5) / startLongitudeScale;
      const midpointLat = particle.lat + (windSample.v * simulationSeconds * 0.5) / latitudeScale;
      const hasMidpoint = sampleCompositeWindVector(vectorIndex, midpointLon, midpointLat, midpointSample);
      particle.u = hasMidpoint ? midpointSample.u : windSample.u;
      particle.v = hasMidpoint ? midpointSample.v : windSample.v;
      const midpointLongitudeScale = latitudeScale * Math.max(0.2, Math.cos(degToRad(midpointLat)));
      const vectorSpeed = Math.hypot(particle.u, particle.v);
      particle.lon += (particle.u * simulationSeconds) / midpointLongitudeScale;
      particle.lat += (particle.v * simulationSeconds) / latitudeScale;
      particle.headScreen = map.project([particle.lon, particle.lat]);
      particle.life -= deltaSeconds;
      particle.travelKm += (vectorSpeed * simulationSeconds) / 1000;
      const trappedInCalm = vectorSpeed < calmVectorSpeed && particle.trail.length >= 7;
      if (
        particle.life <= 0 ||
        particle.travelKm >= particle.maxTravelKm ||
        trappedInCalm ||
        !containsWindPoint(bounds, particle.lon, particle.lat)
      ) {
        if (reseedCount < reseedBudget) {
          Object.assign(particle, resetParticle(particle, bounds, cameraRevision));
          reseedCount += 1;
        }
        continue;
      }

      const lastCommittedPoint = particle.trailScreen.at(-1);
      if (!lastCommittedPoint || Math.hypot(particle.headScreen.x - lastCommittedPoint.x, particle.headScreen.y - lastCommittedPoint.y) >= policy.minimumSampleDistancePx) {
        particle.trail.push({ lon: particle.lon, lat: particle.lat });
        particle.trailScreen.push({ x: particle.headScreen.x, y: particle.headScreen.y });
        if (particle.trail.length > policy.historyPointLimit) particle.trail.shift();
        if (particle.trailScreen.length > policy.historyPointLimit) particle.trailScreen.shift();
      }
      const trimmedTrail = trimWindTrailToPixelLength(particle.trailScreen, particle.headScreen, policy.targetTrailPx);
      const displayTrail = trimmedTrail.points;
      const head = displayTrail.at(-1);
      if (!head || displayTrail.length < 2) continue;
      const isCoreParticle = particle.kind === "core";
      const headCellSize = isCoreParticle ? coreHeadCellSize : ambientHeadCellSize;
      const visibleHeads = isCoreParticle ? visibleCoreHeads : visibleAmbientHeads;
      const maximumHeads = isCoreParticle ? 2 : 3;
      const headCell = Math.floor(head.x / headCellSize) + Math.floor(head.y / headCellSize) * 4096;
      const visibleHeadsInCell = visibleHeads.get(headCell) ?? 0;
      visibleHeads.set(headCell, visibleHeadsInCell + 1);
      if (visibleHeadsInCell >= maximumHeads) {
        densitySuppressedCount += 1;
        continue;
      }
      const estimatedSegments = Math.min(8, Math.max(1, displayTrail.length - 1));
      if (segmentBudgetUsed + estimatedSegments > policy.segmentBudget) {
        densitySuppressedCount += 1;
        continue;
      }
      segmentBudgetUsed += estimatedSegments;
      rawTrailLengthTotal += windTrailLength(particle.trailScreen);
      renderedTrailLengthTotal += trimmedTrail.lengthPx;
      measuredTrailCount += 1;
      renderedParticleCount += 1;
      const bucket = windParticleStyleIndex(Math.hypot(particle.u, particle.v));
      const opacityBucket = windOpacityBucketIndex(particle.opacity);
      impactTintCounts.none += 1;
      WIND_RIBBON_LAYERS.forEach((layer, layerIndex) => {
        const startIndex = Math.max(0, Math.floor((displayTrail.length - 1) * layer.start));
        appendSmoothWindTrail(paths[bucket][layerIndex][opacityBucket], displayTrail, startIndex);
        pathCounts[bucket][layerIndex][opacityBucket] += 1;
      });
    }
    particles = particles.filter((particle) => particle.opacity > 0 || particle.state !== "retiring");
    canvas.dataset.activeParticleCount = String(renderedParticleCount);
    canvas.dataset.averageRawTrailPx = measuredTrailCount > 0 ? (rawTrailLengthTotal / measuredTrailCount).toFixed(1) : "0";
    canvas.dataset.averageRenderedTrailPx = measuredTrailCount > 0 ? (renderedTrailLengthTotal / measuredTrailCount).toFixed(1) : "0";
    canvas.dataset.renderedTrailCount = String(measuredTrailCount);
    canvas.dataset.impactTintCounts = JSON.stringify(impactTintCounts);
    canvas.dataset.densitySuppressedCount = String(densitySuppressedCount);
    canvas.dataset.reseedCount = String(reseedCount);
    canvas.dataset.segmentBudgetUsed = String(segmentBudgetUsed);
    canvas.dataset.retiringParticles = String(particles.filter((particle) => particle.state === "retiring").length);
    WIND_PARTICLE_STYLES.forEach((style, styleIndex) => {
      WIND_RIBBON_LAYERS.forEach((layer, layerIndex) => {
        WIND_OPACITY_BUCKETS.forEach((opacity, opacityIndex) => {
          if (pathCounts[styleIndex][layerIndex][opacityIndex] === 0) return;
          context.strokeStyle = windStrokeStyle(style.speed, 1);
          context.globalAlpha = opacityScale * layer.alpha * 0.94 * opacity;
          context.lineWidth = style.width * strokeScale * layer.widthScale * trailScale * 1.12;
          context.lineCap = "round";
          context.lineJoin = "round";
          context.shadowColor = windStrokeStyle(style.speed, 0.34);
          context.shadowBlur = style.blur * strokeScale * 1.8;
          context.stroke(paths[styleIndex][layerIndex][opacityIndex]);
        });
      });
    });
    context.globalAlpha = 1;
    context.shadowBlur = 0;
    context.globalCompositeOperation = "source-over";
    const renderWorkMs = performance.now() - renderStartedAt;
    renderTimingTotal += renderWorkMs;
    renderTimingMax = Math.max(renderTimingMax, renderWorkMs);
    renderTimingSamples += 1;
    recentRenderTimes.push(renderWorkMs);
    if (recentRenderTimes.length > 120) recentRenderTimes.shift();
    if (renderTimingSamples >= 20) {
      const averageRenderMs = renderTimingTotal / renderTimingSamples;
      const previousQuality = adaptiveQuality;
      if (averageRenderMs > targetRenderBudgetMs * 1.08) {
        adaptiveQuality = Math.max(0.35, adaptiveQuality - 0.08);
        underBudgetFrameCount = 0;
      } else if (averageRenderMs < targetRenderBudgetMs * 0.7) {
        underBudgetFrameCount += renderTimingSamples;
        if (underBudgetFrameCount >= 60) {
          adaptiveQuality = Math.min(1, adaptiveQuality + 0.04);
          underBudgetFrameCount = 0;
        }
      } else {
        underBudgetFrameCount = 0;
      }
      canvas.dataset.averageRenderMs = averageRenderMs.toFixed(1);
      canvas.dataset.maxRenderMs = renderTimingMax.toFixed(1);
      canvas.dataset.targetRenderMs = String(targetRenderBudgetMs);
      const sortedRenderTimes = [...recentRenderTimes].sort((left, right) => left - right);
      const p95Index = Math.max(0, Math.ceil(sortedRenderTimes.length * 0.95) - 1);
      canvas.dataset.p95RenderMs = (sortedRenderTimes[p95Index] ?? 0).toFixed(1);
      renderTimingTotal = 0;
      renderTimingMax = 0;
      renderTimingSamples = 0;
      if (adaptiveQuality !== previousQuality) reconcileParticlePool();
    }
    if (handoffReady) {
      handoffReady = false;
      canvas.style.opacity = "1";
      if (interactionCanvas) {
        interactionCanvas.style.opacity = "0";
        window.clearTimeout(interactionHideTimer);
        interactionHideTimer = window.setTimeout(() => {
          interactionCanvas.style.visibility = "hidden";
          interactionCanvas.style.transform = "none";
          clearInteractionCanvas();
        }, 130);
      }
    }
    frame = window.requestAnimationFrame(render);
  };

  const captureInteractionFrame = () => {
    if (!interactionCanvas || !interactionContext) return false;
    if (interactionCanvas.width !== canvas.width) interactionCanvas.width = canvas.width;
    if (interactionCanvas.height !== canvas.height) interactionCanvas.height = canvas.height;
    interactionContext.setTransform(1, 0, 0, 1, 0, 0);
    interactionContext.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);
    interactionContext.drawImage(canvas, 0, 0);
    interactionCanvas.style.transition = "none";
    interactionCanvas.style.transform = "none";
    interactionCanvas.style.visibility = "visible";
    interactionCanvas.style.opacity = "1";
    canvas.style.opacity = "0";
    requestAnimationFrame(() => {
      if (interactionCanvas) interactionCanvas.style.transition = "opacity 120ms linear";
    });
    return true;
  };

  const cancelProjection = () => {
    projectionGeneration += 1;
    window.cancelAnimationFrame(projectionFrame);
    projectionFrame = 0;
    canvas.dataset.projectionQueueSize = "0";
  };

  const beginCameraMove = () => {
    window.clearTimeout(moveEndTimer);
    window.clearTimeout(interactionHideTimer);
    cancelProjection();
    if (cameraMoving) return;
    cameraMoving = true;
    captureInteractionFrame();
    cameraAnchors = captureCanvasCameraAnchors(map, interactionCanvas ?? canvas);
    canvas.dataset.cameraInteraction = "snapshot-affine-transform";
  };
  const followCamera = () => {
    if (!cameraMoving || !cameraAnchors) return;
    const transform = canvasCameraTransform(map, cameraAnchors);
    const target = interactionCanvas ?? canvas;
    target.style.transformOrigin = "0 0";
    target.style.transform = `matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${transform.e}, ${transform.f})`;
  };
  const finishProjectionHandoff = () => {
    if (!cameraMoving) return;
    const generation = ++projectionGeneration;
    bounds = visibleWindBounds(map, 0.12);
    cameraRevision += 1;
    reconcileParticlePool();
    canvas.dataset.cameraRevision = String(cameraRevision);
    canvas.dataset.cameraInteraction = "chunked-geographic-projection";
    syncCycloneCoreScreen();
    const queue = [...particles];
    let cursor = 0;
    let totalProjectionWorkMs = 0;
    let maximumProjectionChunkMs = 0;
    const handoffStartedAt = performance.now();
    const projectChunk = () => {
      if (generation !== projectionGeneration || !cameraMoving) return;
      const startedAt = performance.now();
      while (cursor < queue.length && performance.now() - startedAt < 4) {
        const particle = queue[cursor];
        particle.trailScreen = particle.trail.map((point) => map.project([point.lon, point.lat]));
        particle.headScreen = map.project([particle.lon, particle.lat]);
        particle.projectionRevision = cameraRevision;
        cursor += 1;
      }
      const chunkWorkMs = performance.now() - startedAt;
      totalProjectionWorkMs += chunkWorkMs;
      maximumProjectionChunkMs = Math.max(maximumProjectionChunkMs, chunkWorkMs);
      canvas.dataset.projectionQueueSize = String(queue.length - cursor);
      canvas.dataset.projectionWorkMs = totalProjectionWorkMs.toFixed(1);
      canvas.dataset.projectionChunkMaxMs = maximumProjectionChunkMs.toFixed(1);
      if (cursor < queue.length) {
        projectionFrame = window.requestAnimationFrame(projectChunk);
        return;
      }
      projectionFrame = 0;
      cameraMoving = false;
      cameraAnchors = null;
      canvas.dataset.cameraInteraction = "geographic-handoff";
      canvas.dataset.projectionQueueSize = "0";
      canvas.dataset.projectionHandoffMs = (performance.now() - handoffStartedAt).toFixed(1);
      handoffReady = true;
      lastFrameTime = 0;
    };
    projectionFrame = window.requestAnimationFrame(projectChunk);
  };
  const finishCameraMove = () => {
    if (!cameraMoving) return;
    window.clearTimeout(moveEndTimer);
    moveEndTimer = window.setTimeout(finishProjectionHandoff, 80);
  };
  const resetForResize = () => {
    beginCameraMove();
    resizeCanvas();
    finishCameraMove();
  };

  frame = window.requestAnimationFrame(render);
  map.on("movestart", beginCameraMove);
  map.on("move", followCamera);
  map.on("moveend", finishCameraMove);
  map.on("resize", resetForResize);
  window.addEventListener("resize", resetForResize);

  return () => {
    window.cancelAnimationFrame(frame);
    window.cancelAnimationFrame(projectionFrame);
    window.clearTimeout(moveEndTimer);
    window.clearTimeout(interactionHideTimer);
    map.off("movestart", beginCameraMove);
    map.off("move", followCamera);
    map.off("moveend", finishCameraMove);
    map.off("resize", resetForResize);
    window.removeEventListener("resize", resetForResize);
    canvas.style.transform = "none";
    canvas.style.opacity = "1";
    if (interactionCanvas) {
      interactionCanvas.style.transform = "none";
      interactionCanvas.style.opacity = "0";
      interactionCanvas.style.visibility = "hidden";
    }
    clearInteractionCanvas();
    clear();
  };
}

function startMarineSstRenderer(map: MapLibreMap, canvas: HTMLCanvasElement, payload: MarineLayerPayload | null, visible: boolean) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;
  const texture = payload?.status === "available" ? createMarineSstTexture(payload.points) : null;
  canvas.dataset.renderer = "geographic-sst-texture";
  canvas.dataset.textureSize = texture ? `${texture.canvas.width}x${texture.canvas.height}` : "none";
  canvas.dataset.scalarCount = String(payload?.points.filter((point) => Number.isFinite(point.seaSurfaceTemperature)).length ?? 0);
  const render = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!visible || !texture) return;
    const northwest = map.project([texture.west, texture.north]);
    const southeast = map.project([texture.east, texture.south]);
    context.save();
    context.globalAlpha = 0.78;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.filter = "blur(0.8px) saturate(1.08)";
    context.drawImage(texture.canvas, northwest.x, northwest.y, southeast.x - northwest.x, southeast.y - northwest.y);
    context.restore();
  };
  render();
  map.on("move", render); map.on("zoom", render); map.on("resize", render);
  return () => { map.off("move", render); map.off("zoom", render); map.off("resize", render); context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight); };
}

function createMarineSstTexture(points: MarinePoint[]) {
  const valid = points.filter((point) => Number.isFinite(point.seaSurfaceTemperature));
  if (valid.length < 4) return null;
  const lons = [...new Set(points.map((point) => point.lon))].sort((a, b) => a - b);
  const lats = [...new Set(points.map((point) => point.lat))].sort((a, b) => b - a);
  const byKey = new Map(points.map((point) => [`${point.lon.toFixed(5)}:${point.lat.toFixed(5)}`, point]));
  const texture = document.createElement("canvas");
  texture.width = lons.length;
  texture.height = lats.length;
  const textureContext = texture.getContext("2d");
  if (!textureContext) return null;
  const image = textureContext.createImageData(texture.width, texture.height);
  for (let y = 0; y < lats.length; y += 1) {
    for (let x = 0; x < lons.length; x += 1) {
      const temperature = byKey.get(`${lons[x].toFixed(5)}:${lats[y].toFixed(5)}`)?.seaSurfaceTemperature;
      if (!Number.isFinite(temperature)) continue;
      const [r, g, b] = seaSurfaceTemperatureRgb(temperature as number);
      const offset = (y * texture.width + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 118;
    }
  }
  textureContext.putImageData(image, 0, 0);
  return { canvas: texture, west: lons[0], east: lons[lons.length - 1], north: lats[0], south: lats[lats.length - 1] };
}

function seaSurfaceTemperatureRgb(value: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [24, 65, 154]], [10, [31, 151, 198]], [18, [47, 207, 161]],
    [24, [246, 214, 77]], [28, [247, 117, 46]], [32, [204, 41, 61]]
  ];
  if (value <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index += 1) {
    const lower = stops[index - 1];
    const upper = stops[index];
    if (value > upper[0]) continue;
    const t = Math.max(0, Math.min(1, (value - lower[0]) / (upper[0] - lower[0])));
    const r = Math.round(lower[1][0] + (upper[1][0] - lower[1][0]) * t);
    const g = Math.round(lower[1][1] + (upper[1][1] - lower[1][1]) * t);
    const b = Math.round(lower[1][2] + (upper[1][2] - lower[1][2]) * t);
    return [r, g, b];
  }
  return stops[stops.length - 1][1];
}

const WIND_PARTICLE_STYLES = [
  { speed: 3, width: 0.74, blur: 0.55 },
  { speed: 7, width: 0.82, blur: 0.68 },
  { speed: 13, width: 0.9, blur: 0.82 },
  { speed: 21, width: 1, blur: 1 },
  { speed: 31, width: 1.1, blur: 1.2 }
] as const;

type WindImpactTint = "none" | "r7" | "r10" | "r12";

function windStrokeStyle(speed: number, alpha: number) {
  const opacity = Math.min(1, alpha * (0.78 + smoothStep(2, 25, speed) * 0.22));
  if (speed < 10) return `rgba(74, 255, 170, ${opacity})`;
  if (speed < 18) return `rgba(154, 255, 116, ${opacity})`;
  if (speed < 27) return `rgba(255, 226, 78, ${opacity})`;
  if (speed < 36) return `rgba(255, 130, 53, ${opacity})`;
  return `rgba(255, 62, 103, ${opacity})`;
}

const WIND_RIBBON_LAYERS = [
  { start: 0, alpha: 0.34, widthScale: 0.72 },
  { start: 0.62, alpha: 1, widthScale: 1 }
] as const;

const WIND_OPACITY_BUCKETS = [0.25, 0.5, 0.75, 1] as const;

function appendSmoothWindTrail(path: Path2D, points: Array<{ x: number; y: number }>, startIndex: number) {
  if (points.length - startIndex < 2) return;
  const lastIndex = points.length - 1;
  // Eight quadratic segments preserve the long meteorological curve while
  // keeping high-zoom storm analysis below the frame budget.
  const segmentStride = Math.max(1, Math.ceil((lastIndex - startIndex) / 8));
  const first = points[startIndex];
  path.moveTo(first.x, first.y);
  if (lastIndex - startIndex === 1) {
    path.lineTo(points[lastIndex].x, points[lastIndex].y);
    return;
  }
  for (let index = startIndex + segmentStride; index < lastIndex; index += segmentStride) {
    const current = points[index];
    const next = points[Math.min(lastIndex, index + segmentStride)];
    path.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  path.lineTo(points[lastIndex].x, points[lastIndex].y);
}

function windTrailLength(points: Array<{ x: number; y: number }>) {
  let length = 0;
  const stride = Math.max(1, Math.ceil((points.length - 1) / 12));
  let previous = points[0];
  for (let index = stride; index < points.length; index += stride) {
    const point = points[index];
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  const endpoint = points.at(-1);
  if (endpoint && previous !== endpoint) {
    length += Math.hypot(endpoint.x - previous.x, endpoint.y - previous.y);
  }
  return length;
}

function windParticleStyleIndex(speed: number) {
  if (speed >= 28) return 4;
  if (speed >= 18) return 3;
  if (speed >= 11) return 2;
  if (speed >= 6) return 1;
  return 0;
}

function windOpacityBucketIndex(opacity: number) {
  return Math.max(0, Math.min(WIND_OPACITY_BUCKETS.length - 1, Math.ceil(opacity * WIND_OPACITY_BUCKETS.length) - 1));
}

interface WindParticleBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

type WindParticleSeedMode = "stable" | "viewport";

interface WindParticle {
  id: string;
  kind: "ambient" | "core";
  lon: number;
  lat: number;
  seedKey?: string;
  seedLon?: number;
  seedLat?: number;
  life: number;
  travelKm: number;
  maxTravelKm: number;
  u: number;
  v: number;
  opacity: number;
  state: "active" | "retiring";
  resetGeneration: number;
  trail: Array<{ lon: number; lat: number }>;
  trailScreen: Array<{ x: number; y: number }>;
  headScreen: { x: number; y: number } | null;
  projectionRevision: number;
}

function visibleWindBounds(map: MapLibreMap, paddingRatio = 0.04): WindParticleBounds {
  const raw = map.getBounds();
  const rawWest = Math.max(-180, raw.getWest());
  const rawEast = Math.min(180, raw.getEast());
  const rawSouth = Math.max(-80, raw.getSouth());
  const rawNorth = Math.min(80, raw.getNorth());
  const lonPadding = Math.max(0.6, (rawEast - rawWest) * paddingRatio);
  const latPadding = Math.max(0.45, (rawNorth - rawSouth) * paddingRatio);
  return {
    west: Math.max(-180, rawWest - lonPadding),
    east: Math.min(180, rawEast + lonPadding),
    south: Math.max(-80, rawSouth - latPadding),
    north: Math.min(80, rawNorth + latPadding)
  };
}

function drawMeteorologicalWindBarbs(
  context: CanvasRenderingContext2D,
  map: MapLibreMap,
  points: WindFieldPoint[],
  compact: boolean
) {
  const minimumSpacing = compact ? 38 : 46;
  const occupied = new Map<string, { x: number; y: number }>();
  for (const vector of points) {
    const projected = map.project([vector.lon, vector.lat]);
    if (projected.x < -20 || projected.y < -20 || projected.x > map.getCanvas().clientWidth + 20 || projected.y > map.getCanvas().clientHeight + 20) continue;
    const cellX = Math.floor(projected.x / minimumSpacing);
    const cellY = Math.floor(projected.y / minimumSpacing);
    let crowded = false;
    for (let yOffset = -1; yOffset <= 1 && !crowded; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        const sample = occupied.get(`${cellX + xOffset}:${cellY + yOffset}`);
        if (sample && Math.hypot(sample.x - projected.x, sample.y - projected.y) < minimumSpacing) {
          crowded = true;
          break;
        }
      }
    }
    if (crowded) continue;
    occupied.set(`${cellX}:${cellY}`, projected);
    drawWindBarb(
      context,
      projected.x,
      projected.y,
      vector,
      gfsWindBarbColor(vector.speed)
    );
  }
}

// A GFS-style forecast layer is a continuous scalar field first, with decoded
// vectors on top. The colours are derived only from the same 10m u/v grid that
// supplies the barbs; no storm-centred shape is added.
function drawGfsWindBackdrop(
  context: CanvasRenderingContext2D,
  map: MapLibreMap,
  index: CompositeWindVectorIndex,
  surface: ProjectedCanvasSurface,
  texture: HTMLCanvasElement,
  opacity: number
) {
  const renderStartedAt = performance.now();
  const textureWidth = Math.max(240, Math.min(520, Math.round(surface.width / 4)));
  const textureHeight = Math.max(180, Math.min(420, Math.round(surface.height / 4)));
  if (texture.width !== textureWidth || texture.height !== textureHeight) {
    texture.width = textureWidth;
    texture.height = textureHeight;
  }
  const textureContext = texture.getContext("2d", { alpha: true });
  if (!textureContext) return { width: 0, height: 0, renderMs: 0 };
  const image = textureContext.createImageData(textureWidth, textureHeight);
  const pixels = image.data;
  const axisAligned = Math.abs(map.getBearing()) < 0.001 && Math.abs(map.getPitch()) < 0.001;
  const longitudes = axisAligned ? new Float64Array(textureWidth) : null;
  const latitudes = axisAligned ? new Float64Array(textureHeight) : null;
  const centerX = surface.offsetX + surface.width / 2;
  const centerY = surface.offsetY + surface.height / 2;
  if (longitudes && latitudes) {
    for (let x = 0; x < textureWidth; x += 1) {
      const screenX = surface.offsetX + ((x + 0.5) * surface.width) / textureWidth;
      longitudes[x] = map.unproject([screenX, centerY]).lng;
    }
    for (let y = 0; y < textureHeight; y += 1) {
      const screenY = surface.offsetY + ((y + 0.5) * surface.height) / textureHeight;
      latitudes[y] = map.unproject([centerX, screenY]).lat;
    }
  }
  const sample = { u: 0, v: 0 };
  for (let y = 0; y < textureHeight; y += 1) {
    const screenY = surface.offsetY + ((y + 0.5) * surface.height) / textureHeight;
    for (let x = 0; x < textureWidth; x += 1) {
      const screenX = surface.offsetX + ((x + 0.5) * surface.width) / textureWidth;
      const location = longitudes && latitudes
        ? { lng: longitudes[x], lat: latitudes[y] }
        : map.unproject([screenX, screenY]);
      const offset = (y * textureWidth + x) * 4;
      if (!sampleCompositeWindVector(index, location.lng, location.lat, sample)) {
        pixels[offset + 3] = 0;
        continue;
      }
      writeGfsWindSpeedColor(pixels, offset, Math.hypot(sample.u, sample.v));
    }
  }
  textureContext.putImageData(image, 0, 0);
  context.save();
  context.globalAlpha = opacity;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = "blur(2px) saturate(1.2)";
  const bleed = 3;
  context.drawImage(
    texture,
    surface.offsetX - bleed,
    surface.offsetY - bleed,
    surface.width + bleed * 2,
    surface.height + bleed * 2
  );
  context.restore();
  return { width: textureWidth, height: textureHeight, renderMs: performance.now() - renderStartedAt };
}

const GFS_WIND_COLOR_STOPS = [
  [0, [30, 85, 171]],
  [5, [36, 194, 184]],
  [10, [99, 214, 104]],
  [17, [248, 214, 75]],
  [25, [250, 129, 47]],
  [33, [220, 50, 57]],
  [45, [166, 38, 122]]
] as const;

function writeGfsWindSpeedColor(pixels: Uint8ClampedArray, offset: number, speed: number) {
  for (let index = 1; index < GFS_WIND_COLOR_STOPS.length; index += 1) {
    const lower = GFS_WIND_COLOR_STOPS[index - 1];
    const upper = GFS_WIND_COLOR_STOPS[index];
    if (speed > upper[0]) continue;
    const progress = Math.max(0, Math.min(1, (speed - lower[0]) / (upper[0] - lower[0])));
    pixels[offset] = Math.round(lower[1][0] + (upper[1][0] - lower[1][0]) * progress);
    pixels[offset + 1] = Math.round(lower[1][1] + (upper[1][1] - lower[1][1]) * progress);
    pixels[offset + 2] = Math.round(lower[1][2] + (upper[1][2] - lower[1][2]) * progress);
    pixels[offset + 3] = 255;
    return;
  }
  const strongest = GFS_WIND_COLOR_STOPS.at(-1)![1];
  pixels[offset] = strongest[0];
  pixels[offset + 1] = strongest[1];
  pixels[offset + 2] = strongest[2];
  pixels[offset + 3] = 255;
}

function gfsWindBarbColor(speed: number) {
  if (speed >= 25) return "rgba(255, 246, 224, 0.98)";
  if (speed >= 15) return "rgba(244, 255, 235, 0.98)";
  return "rgba(236, 251, 255, 0.96)";
}

// Standard station-plot convention: the shaft points toward the direction the
// wind comes FROM. Feathers encode speed in knots (half=5, full=10, flag=50).
function drawWindBarb(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  vector: WindFieldPoint,
  color: string
) {
  const knots = Math.max(0, Math.round((vector.speed / 0.514444) / 5) * 5);
  const shaftLength = Math.max(21, Math.min(34, 18 + knots * 0.12));
  const angle = (vector.direction * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const endX = x + dx * shaftLength;
  const endY = y + dy * shaftLength;
  const normalX = -dy;
  const normalY = dx;

  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 1.35;
  context.lineCap = "round";
  context.shadowColor = "rgba(0, 10, 18, 0.94)";
  context.shadowBlur = 2.4;
  context.beginPath();
  if (knots < 5) {
    context.arc(x, y, 2.2, 0, Math.PI * 2);
  } else {
    context.moveTo(x, y);
    context.lineTo(endX, endY);
  }
  context.stroke();

  let remaining = knots;
  let offset = 2;
  while (remaining >= 50) {
    const baseX = endX - dx * offset;
    const baseY = endY - dy * offset;
    const nextX = endX - dx * (offset + 8);
    const nextY = endY - dy * (offset + 8);
    context.beginPath();
    context.moveTo(baseX, baseY);
    context.lineTo(baseX + normalX * 8 - dx * 3, baseY + normalY * 8 - dy * 3);
    context.lineTo(nextX, nextY);
    context.closePath();
    context.fill();
    remaining -= 50;
    offset += 9;
  }
  while (remaining >= 10) {
    const baseX = endX - dx * offset;
    const baseY = endY - dy * offset;
    context.beginPath();
    context.moveTo(baseX, baseY);
    context.lineTo(baseX + normalX * 8 - dx * 3, baseY + normalY * 8 - dy * 3);
    context.stroke();
    remaining -= 10;
    offset += 4.5;
  }
  if (remaining >= 5) {
    const baseX = endX - dx * offset;
    const baseY = endY - dy * offset;
    context.beginPath();
    context.moveTo(baseX, baseY);
    context.lineTo(baseX + normalX * 4.5 - dx * 1.5, baseY + normalY * 4.5 - dy * 1.5);
    context.stroke();
  }
  context.restore();
}

function randomWindParticle(
  bounds: WindParticleBounds,
  projectionRevision = 0,
  id = `viewport:${Math.random().toString(36).slice(2)}`,
  opacity = 1
): WindParticle {
  return {
    id,
    kind: "ambient",
    lon: bounds.west + Math.random() * (bounds.east - bounds.west),
    lat: bounds.south + Math.random() * (bounds.north - bounds.south),
    // Every particle gets an independent lifetime and distance budget.  This
    // deliberately avoids a periodic global reset while keeping the large
    // environmental flow readable over a long continuous path.
    life: 45 + Math.random() * 35,
    travelKm: 0,
    maxTravelKm: 7_000 + Math.random() * 4_000,
    u: 0,
    v: 0,
    opacity,
    state: "active",
    resetGeneration: 0,
    trail: [],
    trailScreen: [],
    headScreen: null,
    projectionRevision
  };
}

function stableWindParticle(
  seed: StableWindSeed,
  projectionRevision = 0,
  id = `stable:${seed.key}`,
  opacity = 1
): WindParticle {
  return {
    id,
    kind: "ambient",
    lon: seed.lon,
    lat: seed.lat,
    seedKey: seed.key,
    seedLon: seed.lon,
    seedLat: seed.lat,
    life: 45 + Math.random() * 35,
    travelKm: 0,
    maxTravelKm: 7_000 + Math.random() * 4_000,
    u: 0,
    v: 0,
    opacity,
    state: "active",
    resetGeneration: 0,
    trail: [],
    trailScreen: [],
    headScreen: null,
    projectionRevision
  };
}

interface CycloneCoreAnalysis {
  signature: string;
  center: { lon: number; lat: number };
  hasConfirmedEye: boolean;
  eyeRadiusKm: number;
  eyewallRadiusKm: number;
  outerRadiusKm: number;
  peakWindMs: number;
  tangentialSign: 1 | -1;
}

function buildCycloneCoreAnalysis(storm: Storm | null, bossProfile: BossProfile | null): CycloneCoreAnalysis | null {
  if (!storm || storm.maxWind < 17.2) return null;
  const structure = bossProfile?.structure;
  const hasConfirmedEye = Boolean(
    structure && structure.state === "stable-eye" && structure.evidenceLevel === "confirmed" && !structure.stale
  );
  const reportedInnerRadiusKm = structure?.signals.innerRadiusNm ? structure.signals.innerRadiusNm * 1.852 : 0;
  const reportedOuterRadiusKm = structure?.signals.outerRadiusNm ? structure.signals.outerRadiusNm * 1.852 : 0;
  const windCoreRadiusKm = Math.max(storm.windRadiiKm.r12 * 1.35, storm.windRadiiKm.r10 * 0.74, 42);
  const eyewallRadiusKm = Math.max(reportedInnerRadiusKm, windCoreRadiusKm);
  const eyeRadiusKm = hasConfirmedEye ? Math.max(10, Math.min(46, eyewallRadiusKm * 0.5)) : 0;
  const outerRadiusKm = Math.max(reportedOuterRadiusKm, eyewallRadiusKm * 3.3, storm.windRadiiKm.r7 * 0.27, 110);
  const signature = [
    storm.id,
    storm.position.lon.toFixed(4),
    storm.position.lat.toFixed(4),
    storm.maxWind,
    storm.windRadiiKm.r7,
    storm.windRadiiKm.r10,
    storm.windRadiiKm.r12,
    structure?.state ?? "unknown",
    structure?.signals.innerRadiusNm ?? "none",
    structure?.signals.outerRadiusNm ?? "none"
  ].join("|");
  return {
    signature,
    center: { ...storm.position },
    hasConfirmedEye,
    eyeRadiusKm,
    eyewallRadiusKm,
    outerRadiusKm,
    peakWindMs: Math.max(18, Math.min(75, storm.maxWind * 1.05)),
    tangentialSign: cycloneTangentialSign(storm.position.lat)
  };
}

function containsWindPoint(bounds: WindParticleBounds, lon: number, lat: number) {
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function renderStormOnMap(
  map: MapLibreMap,
  storm: Storm | null,
  markerOverride?: MutableRefObject<maplibregl.Marker | null>,
  satelliteLayer?: SatelliteLayerPayload | null,
  bossProfile?: BossProfile | null
) {
  const ref = markerOverride ?? ({ current: null } as MutableRefObject<maplibregl.Marker | null>);
  if (!storm) {
    disposeStormMarker(ref.current);
    ref.current = null;
    return;
  }
  ref.current = upsertStormMarker(map, storm, ref.current, satelliteLayer, bossProfile);
}

function upsertStormMarker(
  map: MapLibreMap,
  storm: Storm,
  marker: maplibregl.Marker | null,
  satelliteLayer?: SatelliteLayerPayload | null,
  bossProfile?: BossProfile | null
) {
  const nextKey = stormMarkerRenderKey(storm, satelliteLayer, bossProfile);
  const currentElement = marker?.getElement();
  if (marker && currentElement?.dataset.renderKey === nextKey) {
    marker.setLngLat([storm.position.lon, storm.position.lat]);
    applyStormMarkerDimensions(map, storm, currentElement);
    return marker;
  }

  disposeStormMarker(marker);
  const element = createStormMarkerElement(map, storm, satelliteLayer, bossProfile);
  element.dataset.renderKey = nextKey;
  return new maplibregl.Marker({ element, anchor: "center" })
    .setLngLat([storm.position.lon, storm.position.lat])
    .addTo(map);
}

function stormAtGfsAnalysisCenter(storm: Storm | null, windField: WindFieldPayload | null) {
  // Keep the official marker on the reported track. The raw GFS vortex has a
  // distinct marker and must never replace the observation.
  void windField;
  return storm;
}

function stormMarkerRenderKey(storm: Storm, satelliteLayer?: SatelliteLayerPayload | null, bossProfile?: BossProfile | null) {
  // Position and provider timestamps are camera/data concerns, not texture
  // concerns. Including them here rebuilt the expensive 336px procedural
  // texture after every viewport wind refresh, causing a hitch just after a
  // drag or zoom. Marker position and dimensions are updated by the fast path.
  return [
    storm.id,
    storm.stage,
    storm.maxWind,
    storm.minPressure,
    storm.position.lat >= 0 ? "north" : "south",
    stormVisualBearingDeg(storm).toFixed(1),
    satelliteLayer?.imageUrl ?? "no-satellite",
    bossProfile?.ahi?.slot ?? "no-ahi",
    bossProfile?.structure?.bulletinId ?? "no-structure",
    bossProfile?.structure?.state ?? "unknown"
  ].join("|");
}

function createStormMarkerElement(
  map: MapLibreMap,
  storm: Storm,
  satelliteLayer?: SatelliteLayerPayload | null,
  bossProfile?: BossProfile | null
) {
  const intensity = Math.max(0.56, Math.min(1, (storm.maxWind || 32) / 72));
  const forceLevel = windForceLevel(storm.maxWind);
  const textureOpacity = windForceTextureOpacity(forceLevel);
  const kinematics = cycloneVisualKinematics(storm.position.lat);

  const root = document.createElement("div");
  root.className = `storm-map-marker structure-${bossProfile?.structure.state ?? "unknown"}`;
  root.dataset.stormId = storm.id;
  root.dataset.centerLon = String(storm.position.lon);
  root.dataset.centerLat = String(storm.position.lat);
  root.dataset.rotationDirection = kinematics.direction;
  root.dataset.windForceLevel = String(forceLevel);
  root.style.setProperty("--storm-core-intensity", String(intensity));
  root.style.setProperty("--storm-spin-duration", `${Math.max(7.5, 16 - intensity * 7)}s`);
  root.style.setProperty("--storm-texture-spin-duration", `${Math.max(30, 56 - forceLevel * 1.45)}s`);
  root.style.setProperty("--storm-texture-opacity", String(textureOpacity));
  root.style.setProperty("--storm-pulse-duration", `${Math.max(1.8, 3.6 - intensity * 1.3)}s`);
  root.style.setProperty("--storm-wave-opacity", String(0.2 + intensity * 0.26));
  root.style.setProperty("--storm-bearing", `${stormVisualBearingDeg(storm)}deg`);
  root.style.setProperty("--storm-texture-start", `${kinematics.textureStartDeg}deg`);
  root.style.setProperty("--storm-texture-end", `${kinematics.textureEndDeg}deg`);
  root.style.setProperty("--storm-rainband-mid-delta", `${kinematics.rainbandMidDeltaDeg}deg`);
  root.style.setProperty("--storm-rainband-end-delta", `${kinematics.rainbandEndDeltaDeg}deg`);
  root.style.setProperty("--storm-texture-mirror", String(kinematics.textureMirror));
  applyStormMarkerDimensions(map, storm, root);

  const core = document.createElement("div");
  core.className = `storm-satellite-core vortex-${stageSlug(storm.stage)}`;

  const atmosphere = document.createElement("span");
  atmosphere.className = "storm-atmosphere-field";
  core.appendChild(atmosphere);

  const rainband = document.createElement("span");
  rainband.className = "storm-rainband-sweep";
  core.appendChild(rainband);

  const visualCanvas = createStormVisualCanvas(storm, { satelliteLayer, ahi: bossProfile?.ahi ?? null });
  core.appendChild(visualCanvas);

  const pressureHalo = document.createElement("span");
  pressureHalo.className = "storm-pressure-halo";
  core.appendChild(pressureHalo);

  const lockRing = document.createElement("span");
  lockRing.className = "storm-analysis-lock-ring";
  core.appendChild(lockRing);

  root.append(core);
  return root;
}

function disposeStormMarker(marker: maplibregl.Marker | null) {
  if (!marker) return;
  marker
    .getElement()
    .querySelectorAll(".storm-satellite-core-canvas")
    .forEach((canvas) => canvas.dispatchEvent(new Event("storm-visual-dispose")));
  marker.remove();
}

function syncGfsAnalysisCenterMarkers(
  map: MapLibreMap,
  markers: Map<string, maplibregl.Marker>,
  models: GfsAnalysisCenterMarkerModel[]
) {
  const visibleIds = new Set(models.map((model) => model.stormId));
  markers.forEach((marker, stormId) => {
    if (visibleIds.has(stormId)) return;
    marker.remove();
    markers.delete(stormId);
  });

  models.forEach((model) => {
    const { center } = model;
    const displayCenter = center;
    let marker = markers.get(model.stormId);
    if (!marker) {
      const root = document.createElement("div");
      root.className = "gfs-analysis-center-marker";
      root.innerHTML = [
        '<span class="gfs-analysis-center-crosshair" aria-hidden="true"></span>',
        '<span class="gfs-analysis-center-label"><strong></strong><small></small></span>'
      ].join("");
      marker = new maplibregl.Marker({ element: root, anchor: "center" })
        .setLngLat([displayCenter.lon, displayCenter.lat])
        .addTo(map);
      markers.set(model.stormId, marker);
    }

    const element = marker.getElement();
    const confidence = center.confidence === "high" ? "高置信" : center.confidence === "medium" ? "中置信" : "待确认";
    const offset = center.offsetKm === undefined ? "" : ` · 偏同期路径 ${center.offsetKm} km`;
    const referenceAt = center.referenceAt ?? model.updatedAt;
    const sourceAge = formatSourceAgeHours(referenceAt);
    const detail = `${formatBeijingTime(referenceAt)} BJT · ${confidence}${offset} · ${sourceAge}坐标`;
    element.classList.toggle("is-active", model.active);
    element.dataset.stormId = model.stormId;
    element.dataset.centerLon = String(displayCenter.lon);
    element.dataset.centerLat = String(displayCenter.lat);
    element.dataset.displayFrame = "geographic-source-grid";
    element.dataset.referenceAt = referenceAt;
    element.style.setProperty("--gfs-center-color", stormTrackColor(model.stormId));
    element.setAttribute("aria-label", `${model.stormName} GFS 主涡旋中心 ${displayCenter.lon.toFixed(2)} 东经 ${displayCenter.lat.toFixed(2)} 北纬，${detail}`);
    const titleElement = element.querySelector("strong");
    if (titleElement) titleElement.textContent = `${model.stormName} · GFS 主涡旋（${sourceAge}坐标）`;
    const detailElement = element.querySelector("small");
    if (detailElement) detailElement.textContent = detail;
    marker.setLngLat([displayCenter.lon, displayCenter.lat]);
  });
}

function disposeGfsAnalysisCenterMarkers(markers: Map<string, maplibregl.Marker>) {
  markers.forEach((marker) => marker.remove());
  markers.clear();
}

function syncStormFleetMarkers(
  map: MapLibreMap,
  storms: Storm[],
  activeStormId: string | null,
  markers: Map<string, maplibregl.Marker>,
  bossProfiles: BossProfile[],
  satelliteLayer?: SatelliteLayerPayload | null
) {
  const visibleIds = new Set(storms.filter((storm) => storm.id !== activeStormId).map((storm) => storm.id));
  markers.forEach((marker, stormId) => {
    if (visibleIds.has(stormId)) return;
    disposeStormMarker(marker);
    markers.delete(stormId);
  });

  storms.forEach((storm) => {
    if (storm.id === activeStormId) return;
    const bossProfile = bossProfiles.find((profile) => profile.stormId === storm.id) ?? null;
    const marker = upsertStormMarker(map, storm, markers.get(storm.id) ?? null, satelliteLayer, bossProfile);
    markers.set(storm.id, marker);
  });
}

function disposeStormFleetMarkers(markers: Map<string, maplibregl.Marker>) {
  markers.forEach((marker) => marker.remove());
  markers.clear();
}

function syncStormMarkerScale(
  map: MapLibreMap,
  storm: Storm | null,
  markerRef: MutableRefObject<maplibregl.Marker | null>
) {
  const element = markerRef.current?.getElement();
  if (!storm || !element) return;
  applyStormMarkerDimensions(map, storm, element);
}

function syncStormFleetMarkerScale(
  map: MapLibreMap,
  storms: Storm[],
  activeStormId: string | null,
  markers: Map<string, maplibregl.Marker>
) {
  storms.forEach((storm) => {
    if (storm.id === activeStormId) return;
    const element = markers.get(storm.id)?.getElement();
    if (element) applyStormMarkerDimensions(map, storm, element);
  });
}

function applyStormMarkerDimensions(map: MapLibreMap, storm: Storm, root: HTMLElement) {
  const center = map.project([storm.position.lon, storm.position.lat]);
  const radiusPx = projectRadiusKmToPixels(map, storm.position, stormVisualRadiusKm(storm), center);
  const canvas = map.getCanvas();
  const maxDiameter = canvas.clientWidth <= 760 ? Math.max(132, canvas.clientWidth * 0.54) : 760;
  const minDiameter = canvas.clientWidth <= 760 ? 42 : 34;
  const diameter = Math.min(maxDiameter, Math.max(minDiameter, Math.round(radiusPx * 2)));
  root.style.width = `${diameter}px`;
  root.style.height = `${diameter}px`;
  root.style.setProperty("--storm-screen-diameter", String(diameter));
  root.style.setProperty("--storm-glow-radius", `${Math.max(18, Math.round(diameter * 0.08))}px`);
}

function stormVisualBearingDeg(storm: Storm) {
  const track = storm.track;
  if (track.length >= 2) {
    const prev = track[track.length - 2];
    const latest = track[track.length - 1];
    const dx = latest.lon - prev.lon;
    const dy = latest.lat - prev.lat;
    if (Math.hypot(dx, dy) > 0.01) {
      return (Math.atan2(dy, dx) * 180) / Math.PI;
    }
  }
  return -52;
}

function rafThrottle(callback: () => void) {
  let frame = 0;
  return () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      callback();
    });
  };
}

function stormVisualRadiusKm(storm: Storm) {
  const { r7, r10, r12 } = storm.windRadiiKm;
  return Math.max(r10 * 0.9, r12 * 1.5, r7 * 0.44, 190);
}

function stormThreatRadiusKm(storm: Storm) {
  const { r7, r10, r12 } = storm.windRadiiKm;
  return Math.max(r7 * 2.45, r10 * 4, r12 * 5.5, 1050);
}

function projectRadiusKmToPixels(
  map: MapLibreMap,
  center: { lon: number; lat: number },
  radiusKm: number,
  centerPoint = map.project([center.lon, center.lat])
) {
  const metersPerDegreeLon = 111.32 * Math.max(Math.cos(degToRad(center.lat)), 0.2);
  const edge = map.project([center.lon + radiusKm / metersPerDegreeLon, center.lat]);
  return Math.abs(edge.x - centerPoint.x);
}

function stageSlug(stage: Storm["stage"]) {
  const value = String(stage);
  if (value === "超强台风") return "super";
  if (value === "强台风") return "severe";
  if (value === "台风" || value === "强热带风暴") return "typhoon";
  return "storm";
}

function buildStormGeo(storm: Storm | null) {
  if (!storm) {
    return {
      track: emptyFeatureCollection(),
      forecast: emptyFeatureCollection(),
      trackPoints: emptyFeatureCollection(),
      forecastPoints: emptyFeatureCollection(),
      r7: emptyFeatureCollection(),
      r10: emptyFeatureCollection(),
      r12: emptyFeatureCollection()
    };
  }

  return {
    track: lineFeatureCollection(storm.track.map((point) => [point.lon, point.lat])),
    forecast: forecastLineFeatureCollection(storm),
    trackPoints: pointFeatureCollection(storm.track.map((point) => [point.lon, point.lat])),
    forecastPoints: forecastPointFeatureCollection(storm),
    r7: circleFeatureCollection(storm, storm.windRadiiKm.r7),
    r10: circleFeatureCollection(storm, storm.windRadiiKm.r10),
    r12: circleFeatureCollection(storm, storm.windRadiiKm.r12)
  };
}

function circleFeatureCollection(storm: Storm, radiusKm: number): GeoJSON.FeatureCollection {
  if (radiusKm <= 0) return emptyFeatureCollection();
  return featureCollection([makeCircle(storm.position.lon, storm.position.lat, radiusKm)]);
}

function lineFeatureCollection(coordinates: number[][]): GeoJSON.FeatureCollection {
  if (coordinates.length < 2) return emptyFeatureCollection();
  return featureCollection([
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates
      }
    }
  ]);
}

function forecastLineFeatureCollection(storm: Storm): GeoJSON.FeatureCollection {
  return featureCollection(
    forecastScenariosForStorm(storm).map((scenario, index) => ({
      type: "Feature",
      properties: {
        agency: scenario.agency,
        agencyCode: scenario.agencyCode,
        isPrimary: scenario.isPrimary,
        color: forecastScenarioStyle(scenario, index).color
      },
      geometry: {
        type: "LineString",
        coordinates: scenario.points.map((point) => [point.lon, point.lat])
      }
    }))
  );
}

function forecastPointFeatureCollection(storm: Storm): GeoJSON.FeatureCollection {
  return featureCollection(
    forecastScenariosForStorm(storm).flatMap((scenario, scenarioIndex) => {
      const color = forecastScenarioStyle(scenario, scenarioIndex).color;
      return scenario.points
        .filter((_, pointIndex, points) => pointIndex === points.length - 1 || pointIndex % 2 === 0)
        .map((point) => ({
          type: "Feature" as const,
          properties: {
            agency: scenario.agency,
            agencyCode: scenario.agencyCode,
            isPrimary: scenario.isPrimary,
            color
          },
          geometry: {
            type: "Point" as const,
            coordinates: [point.lon, point.lat]
          }
        }));
    })
  );
}

function pointFeatureCollection(coordinates: number[][]): GeoJSON.FeatureCollection {
  return featureCollection(
    coordinates.map((coordinate) => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Point",
        coordinates: coordinate
      }
    }))
  );
}

function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features
  };
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return featureCollection([]);
}

function buildMapRegionLabels(collection: GeoJSON.FeatureCollection): MapRegionLabel[] {
  return collection.features
    .map((feature, index) => {
      const rawName = String(feature.properties?.name ?? "");
      const zh = shortRegionName(rawName);
      const propertyCenter = readPropertyCenter(feature.properties);
      const coordinate = propertyCenter ?? geometryCenter(feature.geometry);
      if (!zh || !coordinate) return null;
      return {
        id: `${rawName || zh}-${index}`,
        zh,
        coordinate
      };
    })
    .filter((label): label is MapRegionLabel => Boolean(label));
}

function buildWatchRegions(collection: GeoJSON.FeatureCollection): ProvinceAlertPoint[] {
  const regions = collection.features
    .map((feature) => {
      const rawName = String(feature.properties?.name ?? "");
      const shortName = shortRegionName(rawName);
      const coordinate = readPropertyCenter(feature.properties) ?? geometryCenter(feature.geometry);
      if (!shortName || !coordinate) return null;
      return {
        name: rawName || shortName,
        shortName,
        center: coordinate
      };
    })
    .filter((region): region is ProvinceAlertPoint & { shortName: string } => Boolean(region));

  return DEFENSE_REGION_SHORT_NAMES.map((name) => regions.find((region) => region.shortName === name))
    .filter((region): region is ProvinceAlertPoint & { shortName: string } => Boolean(region))
    .map(({ name, center }) => ({ name, center }));
}

function readPropertyCenter(properties: GeoJSON.GeoJsonProperties): [number, number] | null {
  const center = properties?.centroid ?? properties?.center;
  if (!Array.isArray(center) || center.length < 2) return null;
  const lon = Number(center[0]);
  const lat = Number(center[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function shortRegionName(name: string) {
  return name.replace(/特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市/g, "").trim();
}

function polygonContainsCoordinate(
  polygon: ReadonlyArray<readonly [number, number]>,
  coordinate: readonly [number, number]
) {
  const [x, y] = coordinate;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const [currentX, currentY] = polygon[current];
    const [previousX, previousY] = polygon[previous];
    if ((currentY > y) === (previousY > y)) continue;
    const intersectionX = ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (x < intersectionX) inside = !inside;
  }
  return inside;
}

function geometryCenter(geometry: GeoJSON.Geometry): [number, number] | null {
  const coordinates = collectPositions(geometry);
  if (coordinates.length === 0) return null;
  const bounds = coordinates.reduce(
    (acc, coordinate) => ({
      minLon: Math.min(acc.minLon, coordinate[0]),
      maxLon: Math.max(acc.maxLon, coordinate[0]),
      minLat: Math.min(acc.minLat, coordinate[1]),
      maxLat: Math.max(acc.maxLat, coordinate[1])
    }),
    {
      minLon: Number.POSITIVE_INFINITY,
      maxLon: Number.NEGATIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY
    }
  );
  return [(bounds.minLon + bounds.maxLon) / 2, (bounds.minLat + bounds.maxLat) / 2];
}

function collectPositions(geometry: GeoJSON.Geometry): number[][] {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") return geometry.coordinates.flat();
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(collectPositions);
  return [];
}

function buildProvinceAlerts(storm: Storm | null, provinces: ProvinceAlertPoint[]) {
  return provinces.map((province) => {
    if (!storm) return { name: province.name, label: "待机", level: "low" as const };
    const target = { lon: province.center[0], lat: province.center[1] };
    const distance = distanceToStormCorridorKm(storm, target);
    const core = Math.max(storm.windRadiiKm.r10 * 1.7, storm.windRadiiKm.r12 + 170, 260);
    const outer = Math.max(storm.windRadiiKm.r7 * 1.15, storm.windRadiiKm.r10 * 2.4, 460);
    if (distance <= core) return { name: province.name, label: "高戒备", level: "high" as const };
    if (distance <= outer) return { name: province.name, label: "中戒备", level: "mid" as const };
    if (distance <= Math.max(outer * 1.7, 760)) return { name: province.name, label: "低戒备", level: "low" as const };
    return { name: province.name, label: "巡航", level: "idle" as const };
  });
}

function distanceToStormCorridorKm(storm: Storm, target: { lon: number; lat: number }) {
  const pathPoints = [
    storm.position,
    ...storm.forecast.map((point) => ({ lon: point.lon, lat: point.lat }))
  ];
  return Math.min(...pathPoints.map((point) => distanceBetweenKm(point, target)));
}

function distanceBetweenKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const earthRadiusKm = 6371;
  const dLat = degToRad(b.lat - a.lat);
  const dLon = degToRad(b.lon - a.lon);
  const lat1 = degToRad(a.lat);
  const lat2 = degToRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function windForceLevel(speedMps: number) {
  // China Beaufort force scale: 2 corresponds to 1.6–3.3 m/s and force 17
  // begins at 56.1 m/s; 17+ remains at the maximum visual level.
  const lowerBounds = [0, 0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37, 41.5, 46.2, 51, 56.1];
  const speed = Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0;
  let level = 0;
  for (let index = 1; index < lowerBounds.length; index += 1) {
    if (speed >= lowerBounds[index]) level = index;
  }
  return Math.min(17, level);
}

function windForceTextureOpacity(forceLevel: number) {
  if (forceLevel <= 2) return 1;
  if (forceLevel >= 17) return 0;
  return Math.max(0, Math.min(1, 1 - (forceLevel - 2) / 15));
}

function windFieldMatchesMapContext(windField: WindFieldPayload | null, storm: Storm | null) {
  if (!windField || windField.status !== "available" || windField.points.length === 0) return false;
  // Preserve strict identity matching while a storm is active.  In standby,
  // only accept a field explicitly fetched as ambient map coverage.
  return storm ? windFieldMatchesStorm(windField, storm) : windField.stormId == null;
}

function WindFieldTimeBadge({
  placement,
  windField,
  currentStorm
}: {
  placement: "main" | "live";
  windField: WindFieldPayload | null;
  currentStorm: Storm | null;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const badgeRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    offsetX: number;
    offsetY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  const resetPosition = useCallback(() => setOffset({ x: 0, y: 0 }), []);
  const onDragStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const badge = badgeRef.current;
    const bounds = badge?.closest<HTMLElement>(placement === "live" ? ".map-stage" : ".radar-shell");
    if (!badge || !bounds) return;
    event.preventDefault();
    event.stopPropagation();
    const badgeRect = badge.getBoundingClientRect();
    const stageRect = bounds.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
      minX: offset.x + stageRect.left - badgeRect.left,
      maxX: offset.x + stageRect.right - badgeRect.right,
      minY: offset.y + stageRect.top - badgeRect.top,
      maxY: offset.y + stageRect.bottom - badgeRect.bottom
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [offset.x, offset.y, placement]);
  const onDragMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: Math.min(drag.maxX, Math.max(drag.minX, drag.offsetX + event.clientX - drag.originX)),
      y: Math.min(drag.maxY, Math.max(drag.minY, drag.offsetY + event.clientY - drag.originY))
    });
  }, []);
  const onDragEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);
  const onHandleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 32 : 12;
    const delta = event.key === "ArrowLeft" ? [-step, 0]
      : event.key === "ArrowRight" ? [step, 0]
        : event.key === "ArrowUp" ? [0, -step]
          : event.key === "ArrowDown" ? [0, step]
            : null;
    if (event.key === "Home") {
      event.preventDefault();
      resetPosition();
    } else if (delta) {
      event.preventDefault();
      setOffset((current) => ({ x: current.x + delta[0], y: current.y + delta[1] }));
    }
  }, [resetPosition]);
  if (windField?.status !== "available" || windField.source !== "NOAA/NCEP NOMADS Grib Filter") return null;
  const fieldTime = Date.parse(windField.updatedAt);
  const currentTime = currentStorm ? Date.parse(currentStorm.updatedAt) : Number.NaN;
  const lagHours = Number.isFinite(fieldTime) && Number.isFinite(currentTime) ? Math.max(0, Math.round((currentTime - fieldTime) / 3_600_000)) : null;
  return (
    <aside
      className={`wind-field-time-badge is-${placement}`}
      data-stale={windField.isStale ? "true" : "false"}
      aria-label="GFS 风场数据时次"
      ref={badgeRef}
      style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
    >
      <button
        className="wind-field-time-badge-handle"
        type="button"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onDoubleClick={resetPosition}
        onKeyDown={onHandleKeyDown}
        aria-label="拖动 GFS 风场有效时刻窗；方向键微调，Home 或双击复位"
        title="拖动移动；方向键微调；双击复位"
      >
        {windField.isStale ? "GFS 风场延迟保护" : "GFS 风场有效时刻"}
      </button>
      <strong>{formatBeijingTime(windField.updatedAt)} BJT</strong>
      <small>{formatGfsTime(windField.updatedAt)} · {windField.cycle ?? "F000"} · 显示 {windField.displayResolutionDegrees ?? "?"}° / 原生 {windField.nativeResolutionDegrees ?? "?"}°</small>
      {windField.isStale ? <em>最新刷新失败，当前为最后有效模式场</em> : null}
      {currentStorm ? <em>最新路径 {formatBeijingTime(currentStorm.updatedAt)} BJT{lagHours !== null ? ` · 相差 ${lagHours} 小时` : ""}</em> : null}
    </aside>
  );
}

function formatGfsTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}Z`;
}

function formatBeijingTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatSourceAgeHours(value: string, nowMs = Date.now()) {
  const sourceMs = Date.parse(value);
  if (!Number.isFinite(sourceMs)) return "未知时次";
  const elapsedHours = Math.max(0, Math.floor((nowMs - sourceMs) / 3_600_000));
  return elapsedHours === 0 ? "不到1小时" : `${elapsedHours}小时前`;
}

function eventEvidenceLabel(level: BossProfile["events"][number]["evidenceLevel"]) {
  if (level === "confirmed") return "实况确认";
  if (level === "inferred") return "模型推断";
  return "卫星提示";
}

function formatPathTime(value: string) {
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value.slice(5, 16);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function FallbackMap({ storm }: { storm: Storm | null }) {
  return (
    <div className="fallback-map">
      <RadioTower size={38} />
      <h2>{storm ? `${storm.nameZh} 地图链路降级` : "当前无活动台风"}</h2>
      <p>{storm ? "地图瓦片暂时不可用，雷达保留 Boss 情报与路径数据。" : "地图链路暂时不可用，雷达进入待机态。"}</p>
    </div>
  );
}
