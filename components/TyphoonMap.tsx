"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MapLibreMap } from "maplibre-gl";
import { AlertTriangle, ChevronRight, Database, Palette, RadioTower, Satellite, Shield, Wind } from "lucide-react";
import Link from "next/link";
import { makeCircle } from "@/lib/provinceGeo";
import { createStormVisualCanvas } from "@/lib/stormVisualRenderer";
import { cycloneTangentialSign, cycloneVisualKinematics } from "@/lib/stormKinematics";
import type { BossProfile } from "@/lib/bossEngine/types";
import { useRadarSnapshot } from "./useRadarSnapshot";
import type {
  ImpactAreaPayload,
  ForecastScenario,
  ProvinceDefenseStatus,
  SatelliteLayerPayload,
  Storm,
  WindFieldPayload,
  WindFieldPoint
} from "@/lib/types";
import { DefenseDrawer } from "./DefenseDrawer";
import { HudPanel, StatusPill } from "./HudPrimitives";
import { BossSkillSlotPanel, IntelPanel } from "./IntelPanel";
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
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    basemap: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"],
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
        "raster-contrast": 0.1
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

const TERRAIN_TILE_SIZE = 256;
const TERRAIN_TILE_ZOOM_MIN = 3;
const TERRAIN_TILE_ZOOM_MAX = 6;
const TERRAIN_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TERRAIN_RENDER_DEBOUNCE_MS = 140;
const MAX_TERRAIN_TILES_PER_RENDER = 40;
const WIND_FRAME_INTERVAL_MS = 1000 / 80;
const CANVAS_DPR_CAP = 1.5;
const GLOBAL_SATELLITE_SOURCE_ID = "global-satellite-source";
const GLOBAL_SATELLITE_LAYER_ID = "global-satellite-layer";
const terrainTileCache = new Map<string, Promise<HTMLCanvasElement | null>>();
const globalSatelliteImageUrls = new WeakMap<MapLibreMap, string>();

const DEFENSE_REGION_SHORT_NAMES = ["浙江", "福建", "广东", "上海", "江苏"] as const;

const REGION_EN_NAMES: Record<string, string> = {
  江苏: "JIANGSU",
  上海: "SHANGHAI",
  浙江: "ZHEJIANG",
  福建: "FUJIAN",
  广东: "GUANGDONG",
  台湾: "TAIWAN",
  山东: "SHANDONG",
  安徽: "ANHUI",
  江西: "JIANGXI",
  海南: "HAINAN"
};

const DEFAULT_REGION_LABELS: MapRegionLabel[] = [];

type RadarTheme = "night-radar" | "archive-command";
export type RadarView = "standard" | "live";

type EnvironmentLayerKey = "satellite" | "impact" | "wind";

type EnvironmentLayerToggles = Record<EnvironmentLayerKey, boolean>;

interface MapRegionLabel {
  id: string;
  zh: string;
  en: string;
  coordinate: [number, number];
}

interface ScreenRegionLabel {
  id: string;
  zh: string;
  en: string;
  x: number;
  y: number;
}

interface ProvinceAlertPoint {
  name: string;
  center: [number, number];
}

interface PathScreenLabel {
  id: string;
  x: number;
  y: number;
  label: string;
}

interface DefenseResponse {
  defense: ProvinceDefenseStatus;
}

interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_ENVIRONMENT_LAYERS: EnvironmentLayerToggles = {
  satellite: true,
  impact: true,
  wind: true
};

export function TyphoonMap({
  view = "standard",
  liveDeck = "briefing",
  onSceneReady
}: {
  view?: RadarView;
  liveDeck?: LiveDeckView;
  onSceneReady?: () => void;
}) {
  const isLiveView = view === "live";
  const secondsToSwitch = 0;
  const liveDeckCycle = 0;
  const [storms, setStorms] = useState<Storm[]>([]);
  const [bossProfiles, setBossProfiles] = useState<BossProfile[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [theme, setTheme] = useState<RadarTheme>(() => {
    if (typeof window === "undefined" || view === "live") return "night-radar";
    const requestedTheme = new URLSearchParams(window.location.search).get("theme");
    return requestedTheme === "dossier" || requestedTheme === "archive-command" ? "archive-command" : "night-radar";
  });
  const [selectedDefense, setSelectedDefense] = useState<ProvinceDefenseStatus | null>(null);
  const [sourceLabel, setSourceLabel] = useState("浙江省水利厅台风路径公开接口");
  const [lastUpdated, setLastUpdated] = useState("等待刷新");
  const [dataError, setDataError] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [pathScreenLabels, setPathScreenLabels] = useState<PathScreenLabel[]>([]);
  const [regionScreenLabels, setRegionScreenLabels] = useState<ScreenRegionLabel[]>([]);
  const [environmentLayers, setEnvironmentLayers] = useState<EnvironmentLayerToggles>(DEFAULT_ENVIRONMENT_LAYERS);
  const [satelliteLayer, setSatelliteLayer] = useState<SatelliteLayerPayload | null>(null);
  const [windField, setWindField] = useState<WindFieldPayload | null>(null);
  const [viewportWindField, setViewportWindField] = useState<WindFieldPayload | null>(null);
  const [impactArea, setImpactArea] = useState<ImpactAreaPayload | null>(null);
  const [satelliteScreenBox, setSatelliteScreenBox] = useState<ScreenBox | null>(null);
  const [watchRegions, setWatchRegions] = useState<ProvinceAlertPoint[]>([]);
  const mapNode = useRef<HTMLDivElement | null>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stormIntensityCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const windCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const forecastCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const stormRef = useRef<Storm | null>(null);
  const focusedStormIdRef = useRef<string | null>(null);
  const regionLabelsRef = useRef<MapRegionLabel[]>(DEFAULT_REGION_LABELS);
  const storm = storms[activeIndex] ?? null;
  const activeWindField = viewportWindField ?? windField;
  const {
    snapshot,
    error: snapshotError,
    fetchDurationMs: snapshotFetchDurationMs,
    loaded: snapshotLoaded,
    lastSyncedAt,
    refreshSequence,
    pollIntervalMs
  } = useRadarSnapshot(storm?.id ?? null);
  const [showPerfOverlay] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("perf") === "1";
  });
  const bossProfile = useMemo(
    () => (storm ? bossProfiles.find((profile) => profile.stormId === storm.id) ?? null : null),
    [bossProfiles, storm]
  );
  const liveModel = useMemo(
    () =>
      buildLiveBroadcastModel({
        storm,
        bossProfile,
        sourceLabel,
        lastUpdated,
        lastSyncedAt,
        dataError,
        snapshotStale: snapshot?.cache.stale
      }),
    [storm, bossProfile, sourceLabel, lastUpdated, lastSyncedAt, dataError, snapshot?.cache.stale]
  );

  const stormGeo = useMemo(() => buildStormGeo(storm), [storm]);
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
    if (activeIndex >= storms.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, storms.length]);

  useEffect(() => {
    stormRef.current = storm;
  }, [storm]);

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
        rating: "暴雨级" as ProvinceDefenseStatus["rating"],
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

    try {
      const map = new maplibregl.Map({
        container: mapNode.current,
        style: MAP_STYLE,
        center: [122.5, 27.4],
        zoom: 4.7,
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
        syncMapOverlays(
          map,
          stormRef.current,
          setPathScreenLabels,
          regionLabelsRef.current,
          setRegionScreenLabels
        );
        const provinces = await fetchProvinceGeoJson();
        const geoLabels = buildMapRegionLabels(provinces);
        const geoWatchRegions = buildWatchRegions(provinces);
        setWatchRegions(geoWatchRegions);
        if (geoLabels.length > 0) {
          regionLabelsRef.current = geoLabels;
          syncMapOverlays(
            map,
            stormRef.current,
            setPathScreenLabels,
            regionLabelsRef.current,
            setRegionScreenLabels
          );
        }
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
        map.addSource("track", { type: "geojson", data: emptyFeatureCollection() });
        map.addSource("forecast", { type: "geojson", data: emptyFeatureCollection() });
        map.addSource("trackPoints", { type: "geojson", data: emptyFeatureCollection() });
        map.addSource("forecastPoints", { type: "geojson", data: emptyFeatureCollection() });
        map.addSource("windR7", { type: "geojson", data: emptyFeatureCollection() });
        map.addSource("windR10", { type: "geojson", data: emptyFeatureCollection() });
        map.addSource("windR12", { type: "geojson", data: emptyFeatureCollection() });
        map.addSource("impactAreas", { type: "geojson", data: emptyFeatureCollection() });

        addStormLayers(map);

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
        updateStormSources(map, buildStormGeo(currentStorm));
        renderStormOnMap(map, stormRef.current, markerRef);
        focusMapOnStorm(map, currentStorm, false);
        focusedStormIdRef.current = currentStorm?.id ?? null;
        syncMapOverlays(
          map,
          stormRef.current,
          setPathScreenLabels,
          regionLabelsRef.current,
          setRegionScreenLabels
        );
        setMapReady(true);
      });

      const syncOverlaysNow = () => {
        syncStormMarkerScale(map, stormRef.current, markerRef);
        syncMapOverlays(
          map,
          stormRef.current,
          setPathScreenLabels,
          regionLabelsRef.current,
          setRegionScreenLabels
        );
      };
      const syncOverlays = rafThrottle(syncOverlaysNow);
      map.on("move", syncOverlays);
      map.on("zoom", syncOverlays);
      map.on("resize", syncOverlays);
      map.on("error", () => undefined);
    } catch {
      setMapFailed(true);
    }

      return () => {
        resizeObserver?.disconnect();
      disposeStormMarker(markerRef.current);
      markerRef.current = null;
      focusedStormIdRef.current = null;
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
    syncMapOverlays(
      map,
      stormRef.current,
      setPathScreenLabels,
      regionLabelsRef.current,
      setRegionScreenLabels
    );
  }, [isLiveView, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    updateStormSources(map, stormGeo);
    renderStormOnMap(map, storm, markerRef, satelliteLayer, bossProfile);
    syncMapOverlays(map, storm, setPathScreenLabels, regionLabelsRef.current, setRegionScreenLabels);
    if (storm) {
      // The live deck changes every five seconds. It must not be treated as a
      // new target: fitBounds/easeTo during the layout swap causes canvas
      // overlays to be projected twice and leaves a visible afterimage.
      if (focusedStormIdRef.current !== storm.id) {
        focusMapOnStorm(map, storm, true, theme, view);
        focusedStormIdRef.current = storm.id;
      }
      if (theme === "archive-command") {
        const syncProjectedOverlays = () =>
          syncMapOverlays(
            map,
            storm,
            setPathScreenLabels,
            regionLabelsRef.current,
            setRegionScreenLabels
          );
        syncProjectedOverlays();
        window.requestAnimationFrame(syncProjectedOverlays);
        window.setTimeout(syncProjectedOverlays, 120);
      }
    } else if (focusedStormIdRef.current !== null) {
      map.easeTo({ center: [122.5, 27.4], zoom: 4.7, duration: 900 });
      focusedStormIdRef.current = null;
      setPathScreenLabels([]);
      setRegionScreenLabels(projectRegionLabels(map, regionLabelsRef.current));
    }
  }, [storm, stormGeo, mapReady, theme, satelliteLayer, bossProfile, view]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    syncGlobalSatelliteLayer(map, satelliteLayer, environmentLayers.satellite);
  }, [satelliteLayer, environmentLayers.satellite, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !environmentLayers.wind) {
      setViewportWindField(null);
      return;
    }

    let disposed = false;
    let timer = 0;
    let controller: AbortController | null = null;

    const loadViewportWind = async () => {
      controller?.abort();
      controller = new AbortController();
      const bounds = visibleWindBounds(map, 0.08);
      const query = new URLSearchParams({
        west: bounds.west.toFixed(2),
        south: bounds.south.toFixed(2),
        east: bounds.east.toFixed(2),
        north: bounds.north.toFixed(2),
        t: String(Date.now())
      });
      if (storm?.id) query.set("stormId", storm.id);

      try {
        const response = await fetch(`/api/environment/wind-field?${query.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Viewport wind request failed: ${response.status}`);
        const payload = (await response.json()) as WindFieldPayload;
        if (!disposed && payload.status === "available" && payload.points.length > 0) {
          setViewportWindField(payload);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Retain the last successful field while the global model endpoint recovers.
        }
      }
    };

    const scheduleViewportWind = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void loadViewportWind(), 180);
    };

    setViewportWindField(null);
    scheduleViewportWind();
    map.on("moveend", scheduleViewportWind);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
      map.off("moveend", scheduleViewportWind);
    };
  }, [mapReady, storm?.id, environmentLayers.wind]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const syncSatellite = () => {
      const nextBox =
        satelliteLayer?.status === "available" && environmentLayers.satellite
          ? projectSatelliteBox(map, satelliteLayer.bounds)
          : null;
      setSatelliteScreenBox((current) => (screenBoxesEqual(current, nextBox) ? current : nextBox));
    };
    syncSatellite();
    map.on("move", syncSatellite);
    map.on("zoom", syncSatellite);
    map.on("resize", syncSatellite);
    return () => {
      map.off("move", syncSatellite);
      map.off("zoom", syncSatellite);
      map.off("resize", syncSatellite);
    };
  }, [satelliteLayer, environmentLayers.satellite, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    updateImpactAreaLayer(map, impactArea, environmentLayers.impact);
  }, [impactArea, environmentLayers.impact, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = terrainCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startTerrainElevationRenderer(map, canvas);
  }, [mapReady, theme]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = stormIntensityCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startStormIntensityRenderer(map, canvas, storm, environmentLayers.wind);
  }, [storm, environmentLayers.wind, mapReady, theme]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = windCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startWindFieldRenderer(map, canvas, activeWindField, environmentLayers.wind, storm);
  }, [activeWindField, environmentLayers.wind, mapReady, theme, storm]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = forecastCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startForecastRouteRenderer(map, canvas, storm);
  }, [storm, mapReady, theme]);

  return (
    <main className="radar-shell" data-theme={theme} data-view={view} data-live-deck={isLiveView ? liveDeck : undefined}>
      {!isLiveView ? <div className="boot-scan" /> : null}
      <section className="map-stage" aria-label="台风 Boss 雷达地图">
        {mapFailed ? <FallbackMap storm={storm} /> : <div className="map-canvas" ref={mapNode} />}
        {!mapFailed ? <canvas className="terrain-elevation-canvas" ref={terrainCanvasRef} aria-hidden="true" /> : null}
        <SatelliteCloudOverlay layer={satelliteLayer} box={satelliteScreenBox} />
        {!mapFailed ? <canvas className="storm-intensity-canvas" ref={stormIntensityCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed ? <canvas className="wind-particle-canvas" ref={windCanvasRef} aria-hidden="true" /> : null}
        {!mapFailed ? <canvas className="forecast-route-canvas" ref={forecastCanvasRef} aria-hidden="true" /> : null}
        {isLiveView && liveDeck === "briefing" ? <LiveRouteLegend storm={storm} /> : null}
        <PerformanceOverlay
          enabled={showPerfOverlay}
          fetchDurationMs={snapshotFetchDurationMs}
          windPointCount={activeWindField?.points.length ?? 0}
          warningCount={snapshot?.warnings.length ?? 0}
        />

        <div className="map-effects" aria-hidden="true">
          <div className="map-vignette" />
          <div className="radar-grid" />
          <div className="hud-circuit-layer" />
        </div>

        {theme === "archive-command" ? <DossierSceneDecor storm={storm} sourceLabel={sourceLabel} dataError={dataError} /> : null}
        {theme === "archive-command" ? <DossierMapFurniture /> : null}

        <MapLabelLayer labels={regionScreenLabels} />
        {!isLiveView ? <PathTimeOverlay labels={pathScreenLabels} /> : null}
        {!isLiveView ? <ForecastBadge storm={storm} /> : null}

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
            bossProfile={bossProfile}
            count={storms.length}
            lastUpdated={lastUpdated}
            dataError={dataError}
            sourceLabel={sourceLabel}
            theme={theme}
            onThemeChange={setTheme}
          />
        )}

        {!isLiveView && theme === "night-radar" ? (
          <div className="left-tactical-stack">
            <DefenseStatusPanel alerts={provinceAlerts} onSelect={fetchDefense} />
            <BossSkillSlotPanel storm={storm} bossProfile={bossProfile} className="left-boss-skill-panel" />
            <EnvironmentLayerPanel
              layers={environmentLayers}
              satellite={satelliteLayer}
              windField={activeWindField}
              impactArea={impactArea}
              onToggle={toggleEnvironmentLayer}
            />
          </div>
        ) : !isLiveView ? (
          <>
            <DefenseStatusPanel alerts={provinceAlerts} onSelect={fetchDefense} />
            <EnvironmentLayerPanel
              layers={environmentLayers}
              satellite={satelliteLayer}
              windField={activeWindField}
              impactArea={impactArea}
              onToggle={toggleEnvironmentLayer}
            />
          </>
        ) : null}
        {!isLiveView && theme === "archive-command" ? <MapLegendPanel /> : null}
        {!isLiveView && theme === "archive-command" ? <DossierStormIndex storms={storms} activeIndex={activeIndex} onSelect={setActiveIndex} /> : null}
        {!isLiveView && theme === "archive-command" ? <ImpactLegend /> : null}
        {!isLiveView && theme === "night-radar" ? <BottomAlertBar storm={storm} bossProfile={bossProfile} alerts={provinceAlerts} dataError={dataError} sourceLabel={sourceLabel} /> : null}
        {!isLiveView ? <DefenseDrawer defense={selectedDefense} onClose={() => setSelectedDefense(null)} /> : null}
      </section>

      {isLiveView ? liveDeck === "briefing" ? (
        <LiveAudiencePanel
          model={liveModel}
          storm={storm}
          satelliteLayer={satelliteLayer}
          refreshSequence={refreshSequence}
        />
      ) : (
        <LiveIntelPanel model={liveModel} storm={storm} satelliteLayer={satelliteLayer} />
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

  const title = String(storm.rating) === "天灾级" || String(storm.stage) === "超强台风" ? "最高戒备" : "防御优先";
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
  warningCount
}: {
  enabled: boolean;
  fetchDurationMs: number | null;
  windPointCount: number;
  warningCount: number;
}) {
  const [fps, setFps] = useState(0);
  const [longTasks, setLongTasks] = useState(0);

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
      <span>{fps || "--"} FPS</span>
      <span>{fetchDurationMs ?? "--"} ms fetch</span>
      <span>{windPointCount} wind pts</span>
      <span>{longTasks} long tasks</span>
      <span>{warningCount} warnings</span>
    </div>
  );
}

function MapLabelLayer({ labels }: { labels: ScreenRegionLabel[] }) {
  if (labels.length === 0) return null;

  return (
    <div className="map-label-layer" aria-hidden="true">
      {labels.map((label) => (
        <div className="map-region-label" key={label.id} style={{ left: label.x, top: label.y }}>
          <b>{label.zh}</b>
          <span>{label.en}</span>
        </div>
      ))}
    </div>
  );
}

function SatelliteCloudOverlay({ layer, box }: { layer: SatelliteLayerPayload | null; box: ScreenBox | null }) {
  if (!layer?.imageUrl || layer.status !== "available" || !box) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="satellite-cloud-overlay"
      src={layer.imageUrl}
      alt=""
      aria-hidden="true"
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height
      }}
    />
  );
}

function syncGlobalSatelliteLayer(map: MapLibreMap, layer: SatelliteLayerPayload | null, visible: boolean) {
  const imageUrl = layer?.status === "available" ? layer.globalImageUrl : null;
  const bounds = layer?.globalBounds;
  if (!imageUrl || !bounds) {
    if (map.getLayer(GLOBAL_SATELLITE_LAYER_ID)) map.removeLayer(GLOBAL_SATELLITE_LAYER_ID);
    if (map.getSource(GLOBAL_SATELLITE_SOURCE_ID)) map.removeSource(GLOBAL_SATELLITE_SOURCE_ID);
    globalSatelliteImageUrls.delete(map);
    return;
  }

  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south]
  ];
  const previousImageUrl = globalSatelliteImageUrls.get(map);
  const existingSource = map.getSource(GLOBAL_SATELLITE_SOURCE_ID) as ImageSource | undefined;
  if (!existingSource) {
    map.addSource(GLOBAL_SATELLITE_SOURCE_ID, {
      type: "image",
      url: imageUrl,
      coordinates
    });
  } else if (previousImageUrl !== imageUrl) {
    existingSource.updateImage({ url: imageUrl, coordinates });
  }
  globalSatelliteImageUrls.set(map, imageUrl);

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
  map.setLayoutProperty(GLOBAL_SATELLITE_LAYER_ID, "visibility", visible ? "visible" : "none");
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
  const target = storm ? cameraCenterForStorm(storm, map.getCanvas().clientWidth, theme) : [122.5, 27.4];
  const camera = {
    center: target as [number, number],
    zoom: storm ? (theme === "archive-command" ? 4.85 : 4.65) : 4.7,
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

function PathTimeOverlay({ labels }: { labels: Array<{ id: string; x: number; y: number; label: string }> }) {
  if (labels.length === 0) return null;

  return (
    <div className="path-time-layer" aria-hidden="true">
      {labels.map((item) => (
        <div className="path-time-label" key={item.id} style={{ left: item.x, top: item.y }}>
          {item.label}
        </div>
      ))}
    </div>
  );
}

function TopCommandBar({
  storm,
  bossProfile,
  count,
  lastUpdated,
  dataError,
  sourceLabel,
  theme,
  onThemeChange
}: {
  storm: Storm | null;
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
          <span>{"\u53f0\u98ce\u60c5\u62a5\u6863\u6848\u5ba4"}</span>
          <strong>BOSS DOSSIER</strong>
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
          <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />
        </div>
      </header>
    );
  }

  return (
    <header className="top-command">
      <div className="brand-block">
        <span>{"\u53f0\u98ce BOSS \u96f7\u8fbe"}</span>
        <strong>实时气象战术态势</strong>
      </div>
      <div className="live-radar-band">
        <b>实时雷达</b>
        <div className="command-strip">
          <StatusPill label="任务状态" value={dataError ? "链路异常" : storm ? "执行中" : "待机巡航"} alert={Boolean(dataError || storm)} />
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
  layers,
  satellite,
  windField,
  impactArea,
  onToggle
}: {
  layers: EnvironmentLayerToggles;
  satellite: SatelliteLayerPayload | null;
  windField: WindFieldPayload | null;
  impactArea: ImpactAreaPayload | null;
  onToggle: (layer: EnvironmentLayerKey) => void;
}) {
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
      label: "影响描边",
      status: impactArea?.status === "available" ? `${impactArea.featureCount} 圈层` : impactArea?.reason ?? "等待资料",
      alert: impactArea?.status !== "available"
    },
    {
      id: "wind",
      icon: Wind,
      label: "大气流场",
      status:
        windField?.status === "available"
          ? `${windField.points.length} 视口矢量 · 全球可漫游`
          : "全球背景流场 · 模式源待恢复",
      alert: windField?.status !== "available"
    }
  ];

  return (
    <HudPanel as="aside" className="environment-panel" aria-label="环境图层控制">
      <div className="section-title compact">
        <Satellite size={16} />
        <span>环境图层</span>
      </div>
      <small className="section-subtitle">全球卫星 / 视口风场 / 高差</small>
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
        {satellite?.status === "available" ? satellite.attribution : "仅显示已接通的实时公开数据源。"}
      </p>
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
  sourceLabel
}: {
  storm: Storm | null;
  bossProfile?: BossProfile | null;
  alerts: ReturnType<typeof buildProvinceAlerts>;
  dataError: string | null;
  sourceLabel: string;
}) {
  const events = bossProfile?.events.slice(0, 3) ?? [];
  const message = dataError
    ? "数据链路异常，请以官方预警为准。雷达将在下一轮刷新时重试。"
    : bossProfile
      ? bossProfile.riskSummary
    : storm
      ? `${storm.nameZh} 当前为${storm.stage}，中心最大风速 ${storm.maxWind || "暂无"} m/s，请沿海地区持续关注路径变化。`
      : "当前无活动台风，雷达保持待机巡航。";

  return (
    <footer className="bottom-command">
      <div className="bottom-defense-title">
        <Shield size={40} />
        <div>
          <b>BOSS 战况追踪</b>
          <span>战斗履历 / 省份防线</span>
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

async function fetchProvinceGeoJson(): Promise<GeoJSON.FeatureCollection> {
  try {
    const response = await fetch("/api/geo/provinces");
    if (!response.ok) throw new Error("Province geo API unavailable");
    return (await response.json()) as GeoJSON.FeatureCollection;
  } catch {
    return emptyFeatureCollection();
  }
}

function addImpactAreaLayers(map: MapLibreMap) {
  const colorExpression = [
    "match",
    ["get", "radiusLevel"],
    "r12",
    "#ff3b32",
    "r10",
    "#ffb000",
    "#00d8ff"
  ] as maplibregl.ExpressionSpecification;

  map.addLayer({
    id: "impact-area-fill",
    type: "fill",
    source: "impactAreas",
    paint: {
      "fill-color": colorExpression,
      "fill-opacity": [
        "match",
        ["get", "radiusLevel"],
        "r12",
        0.14,
        "r10",
        0.1,
        0.07
      ]
    }
  });
  map.addLayer({
    id: "impact-area-glow",
    type: "line",
    source: "impactAreas",
    paint: {
      "line-color": colorExpression,
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 5, 6, 8, 8, 12],
      "line-opacity": 0.18,
      "line-blur": 5
    }
  });
  map.addLayer({
    id: "impact-area-line",
    type: "line",
    source: "impactAreas",
    paint: {
      "line-color": colorExpression,
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.4, 6, 2.2, 8, 3],
      "line-opacity": 0.9,
      "line-blur": 0.2
    }
  });
}

function addStormLayers(map: MapLibreMap) {
  addImpactAreaLayers(map);

  map.addLayer({
    id: "track-line",
    type: "line",
    source: "track",
    paint: {
      "line-color": "#ff4b3e",
      "line-width": 4,
      "line-opacity": 0.92,
      "line-blur": 1.2
    }
  });
  map.addLayer({
    id: "forecast-glow",
    type: "line",
    source: "forecast",
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#e8f5fb"],
      "line-width": ["case", ["boolean", ["get", "isPrimary"], false], 11, 7],
      "line-opacity": ["case", ["boolean", ["get", "isPrimary"], false], 0.28, 0.16],
      "line-blur": 5
    }
  });
  map.addLayer({
    id: "forecast-line",
    type: "line",
    source: "forecast",
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#e8f5fb"],
      "line-width": ["case", ["boolean", ["get", "isPrimary"], false], 4.2, 2.6],
      "line-dasharray": [2.2, 1.35],
      "line-opacity": ["case", ["boolean", ["get", "isPrimary"], false], 0.98, 0.82]
    }
  });
  map.addLayer({
    id: "track-points",
    type: "circle",
    source: "trackPoints",
    paint: {
      "circle-radius": 5,
      "circle-color": "#071015",
      "circle-stroke-color": "#ff4b3e",
      "circle-stroke-width": 2.4,
      "circle-opacity": 0.96
    }
  });
  map.addLayer({
    id: "forecast-points",
    type: "circle",
    source: "forecastPoints",
    paint: {
      "circle-radius": ["case", ["boolean", ["get", "isPrimary"], false], 5, 3.4],
      "circle-color": ["coalesce", ["get", "color"], "#e8f5fb"],
      "circle-stroke-color": "#071015",
      "circle-stroke-width": 1.4,
      "circle-opacity": ["case", ["boolean", ["get", "isPrimary"], false], 0.98, 0.82]
    }
  });
}

function updateStormSources(map: MapLibreMap, stormGeo: ReturnType<typeof buildStormGeo>) {
  (map.getSource("track") as GeoJSONSource | undefined)?.setData(stormGeo.track);
  (map.getSource("forecast") as GeoJSONSource | undefined)?.setData(stormGeo.forecast);
  (map.getSource("trackPoints") as GeoJSONSource | undefined)?.setData(stormGeo.trackPoints);
  (map.getSource("forecastPoints") as GeoJSONSource | undefined)?.setData(stormGeo.forecastPoints);
  (map.getSource("windR7") as GeoJSONSource | undefined)?.setData(stormGeo.r7);
  (map.getSource("windR10") as GeoJSONSource | undefined)?.setData(stormGeo.r10);
  (map.getSource("windR12") as GeoJSONSource | undefined)?.setData(stormGeo.r12);
}

function updateImpactAreaLayer(map: MapLibreMap, impactArea: ImpactAreaPayload | null, visible: boolean) {
  (map.getSource("impactAreas") as GeoJSONSource | undefined)?.setData(impactArea?.areas ?? emptyFeatureCollection());
  setLayerVisibility(map, ["impact-area-fill", "impact-area-glow", "impact-area-line"], visible && impactArea?.status === "available");
}

function setLayerVisibility(map: MapLibreMap, layerIds: string[], visible: boolean) {
  layerIds.forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  });
}

function projectSatelliteBox(map: MapLibreMap, bounds: SatelliteLayerPayload["bounds"]): ScreenBox {
  const northwest = map.project([bounds.west, bounds.north]);
  const southeast = map.project([bounds.east, bounds.south]);
  const x = Math.min(northwest.x, southeast.x);
  const y = Math.min(northwest.y, southeast.y);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.abs(southeast.x - northwest.x)),
    height: Math.round(Math.abs(southeast.y - northwest.y))
  };
}

function startTerrainElevationRenderer(map: MapLibreMap, canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;

  let cancelled = false;
  let renderId = 0;
  let frame = 0;
  let debounceTimer: number | undefined;
  let lastRenderedViewport = "";

  const resizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, CANVAS_DPR_CAP);
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

  const render = async () => {
    if (document.visibilityState !== "visible") return;
    const currentRender = ++renderId;
    resizeCanvas();

    const zoom = Math.max(TERRAIN_TILE_ZOOM_MIN, Math.min(TERRAIN_TILE_ZOOM_MAX, Math.round(map.getZoom())));
    const tiles = terrainTilesForViewport(map, zoom, canvas.clientWidth, canvas.clientHeight).slice(0, MAX_TERRAIN_TILES_PER_RENDER);
    const center = map.getCenter();
    const viewportKey = [
      zoom,
      Math.round(center.lng * 100),
      Math.round(center.lat * 100),
      canvas.width,
      canvas.height,
      tiles.map((tile) => `${tile.z}/${tile.x}/${tile.y}`).join(",")
    ].join("|");
    if (viewportKey === lastRenderedViewport) return;
    const renderedTiles = await Promise.all(
      tiles.map(async (tile) => ({
        ...tile,
        canvas: await getColoredTerrainTile(tile.z, tile.x, tile.y)
      }))
    );
    if (cancelled || currentRender !== renderId) return;

    clear();
    renderedTiles.forEach((tile) => {
      if (!tile.canvas) return;
      const northwest = map.project(tileLonLat(tile.x, tile.y, tile.z));
      const southeast = map.project(tileLonLat(tile.x + 1, tile.y + 1, tile.z));
      const x = Math.floor(Math.min(northwest.x, southeast.x));
      const y = Math.floor(Math.min(northwest.y, southeast.y));
      const width = Math.ceil(Math.abs(southeast.x - northwest.x));
      const height = Math.ceil(Math.abs(southeast.y - northwest.y));
      context.drawImage(tile.canvas, x, y, width, height);
    });
    lastRenderedViewport = viewportKey;
  };

  const scheduleRender = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      void render();
    });
  };

  const scheduleRenderDebounced = () => {
    if (debounceTimer !== undefined) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(scheduleRender, TERRAIN_RENDER_DEBOUNCE_MS);
  };

  const invalidateRender = () => {
    renderId += 1;
    lastRenderedViewport = "";
    window.cancelAnimationFrame(frame);
    resizeCanvas();
    clear();
  };

  const invalidateForResize = () => {
    invalidateRender();
    scheduleRenderDebounced();
  };

  scheduleRender();
  map.on("movestart", invalidateRender);
  map.on("zoomstart", invalidateRender);
  map.on("moveend", scheduleRenderDebounced);
  map.on("zoomend", scheduleRenderDebounced);
  map.on("resize", invalidateForResize);
  window.addEventListener("resize", scheduleRenderDebounced);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
    if (debounceTimer !== undefined) {
      window.clearTimeout(debounceTimer);
    }
    map.off("movestart", invalidateRender);
    map.off("zoomstart", invalidateRender);
    map.off("moveend", scheduleRenderDebounced);
    map.off("zoomend", scheduleRenderDebounced);
    map.off("resize", invalidateForResize);
    window.removeEventListener("resize", scheduleRenderDebounced);
    clear();
  };
}

function terrainTilesForViewport(map: MapLibreMap, z: number, width: number, height: number) {
  const corners = [
    map.unproject([0, 0]),
    map.unproject([width, 0]),
    map.unproject([width, height]),
    map.unproject([0, height])
  ];
  const west = Math.max(-180, Math.min(...corners.map((corner) => corner.lng)));
  const east = Math.min(180, Math.max(...corners.map((corner) => corner.lng)));
  const south = Math.max(-85, Math.min(...corners.map((corner) => corner.lat)));
  const north = Math.min(85, Math.max(...corners.map((corner) => corner.lat)));
  const minTile = lngLatToTile(west, north, z);
  const maxTile = lngLatToTile(east, south, z);
  const maxIndex = 2 ** z - 1;
  const xStart = clampInteger(Math.min(minTile.x, maxTile.x), 0, maxIndex);
  const xEnd = clampInteger(Math.max(minTile.x, maxTile.x), 0, maxIndex);
  const yStart = clampInteger(Math.min(minTile.y, maxTile.y), 0, maxIndex);
  const yEnd = clampInteger(Math.max(minTile.y, maxTile.y), 0, maxIndex);
  const tiles: Array<{ z: number; x: number; y: number }> = [];

  for (let x = xStart; x <= xEnd; x += 1) {
    for (let y = yStart; y <= yEnd; y += 1) {
      tiles.push({ z, x, y });
    }
  }

  return tiles;
}

function lngLatToTile(lon: number, lat: number, z: number) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const scale = 2 ** z;
  return {
    x: Math.floor(((lon + 180) / 360) * scale),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale)
  };
}

function tileLonLat(x: number, y: number, z: number): [number, number] {
  const scale = 2 ** z;
  const lon = (x / scale) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale)));
  return [lon, (latRad * 180) / Math.PI];
}

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function getColoredTerrainTile(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`;
  if (!terrainTileCache.has(key)) {
    if (terrainTileCache.size > 240) terrainTileCache.clear();
    terrainTileCache.set(key, loadColoredTerrainTile(z, x, y));
  }
  return terrainTileCache.get(key) ?? Promise.resolve(null);
}

async function loadColoredTerrainTile(z: number, x: number, y: number) {
  try {
    const url = TERRAIN_TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    const response = await fetch(url, { cache: "force-cache", mode: "cors" });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const source = document.createElement("canvas");
    source.width = TERRAIN_TILE_SIZE;
    source.height = TERRAIN_TILE_SIZE;
    const sourceContext = source.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) return null;
    sourceContext.drawImage(bitmap, 0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);

    const image = sourceContext.getImageData(0, 0, TERRAIN_TILE_SIZE, TERRAIN_TILE_SIZE);
    const pixels = image.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const elevation = pixels[index] * 256 + pixels[index + 1] + pixels[index + 2] / 256 - 32768;
      const color = terrainBandColor(elevation);
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
    sourceContext.putImageData(image, 0, 0);
    bitmap.close();
    return source;
  } catch {
    return null;
  }
}

function terrainBandColor(elevation: number): [number, number, number, number] {
  if (elevation <= 5) return [0, 0, 0, 0];
  if (elevation < 80) return [39, 151, 127, 116];
  if (elevation < 250) return [92, 164, 94, 132];
  if (elevation < 700) return [188, 164, 70, 148];
  if (elevation < 1400) return [213, 116, 50, 164];
  if (elevation < 2600) return [181, 67, 55, 178];
  return [238, 220, 184, 192];
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

const FORECAST_ROUTE_COLORS: Record<string, string> = {
  CMA: "#fff0a8",
  JMA: "#61efff",
  JTWC: "#9cff72",
  CWA: "#ff70c7",
  HKO: "#ff985d"
};

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

function startWindFieldRenderer(
  map: MapLibreMap,
  canvas: HTMLCanvasElement,
  windField: WindFieldPayload | null,
  visible: boolean,
  storm: Storm | null
) {
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) return undefined;

  let frame = 0;
  let lastFrameTime = 0;
  let frameTimingTotal = 0;
  let frameTimingMax = 0;
  let frameTimingSamples = 0;
  let mapMoving = false;
  let canvasWidth = 1;
  let canvasHeight = 1;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const points = windField?.status === "available" ? windField.points : [];
  const trailPointLimit = canvas.clientWidth <= 760 ? 14 : 20;

  const resizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, CANVAS_DPR_CAP);
    const rect = canvas.getBoundingClientRect();
    canvasWidth = Math.max(1, Math.floor(rect.width));
    canvasHeight = Math.max(1, Math.floor(rect.height));
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const clear = () => {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  };

  resizeCanvas();
  if (!visible) {
    clear();
    return () => clear();
  }

  let bounds = visibleWindBounds(map);
  const vectorIndex = createWindVectorIndex(points);
  const particleCount = canvas.clientWidth <= 760 ? 360 : Math.min(1050, Math.max(820, Math.round((canvasWidth * canvasHeight) / 820)));
  const particles = Array.from({ length: particleCount }, (_, index) => randomWindParticle(bounds, storm, index % 2 === 0));
  canvas.dataset.renderer = "batched-2d-gpu-composite";
  canvas.dataset.vectorInterpolation = "idw-4-inertial";
  canvas.dataset.backgroundMode = points.length > 0 ? "open-meteo-idw" : "global-circulation-fallback";
  canvas.dataset.particleCount = String(particleCount);
  canvas.dataset.trailPoints = String(trailPointLimit);

  const drawStatic = () => {
    resizeCanvas();
    clear();
    context.globalCompositeOperation = "source-over";
    staticWindSamples(bounds, 10, 7).forEach((point, index) => {
      const vector = renderedWindVector(vectorIndex, point.lon, point.lat, storm);
      if (!vector) return;
      const projected = map.project([point.lon, point.lat]);
      const magnitude = Math.max(0.01, Math.hypot(vector.u, vector.v));
      const length = Math.max(7, Math.min(16, 5 + vector.speed * 0.32));
      const dx = (vector.u / magnitude) * length;
      const dy = (-vector.v / magnitude) * length;
      context.strokeStyle = windColor(vector.speed, 0.4);
      context.lineWidth = 0.72;
      context.lineCap = "round";
      context.beginPath();
      appendWindCurve(context, projected.x, projected.y, dx, dy, index, storm);
      context.stroke();
    });
  };

  if (reducedMotion) {
    drawStatic();
    map.on("move", drawStatic);
    map.on("resize", drawStatic);
    window.addEventListener("resize", drawStatic);
    return () => {
      map.off("move", drawStatic);
      map.off("resize", drawStatic);
      window.removeEventListener("resize", drawStatic);
      clear();
    };
  }

  const render = (timeMs: number) => {
    if (document.visibilityState !== "visible" || mapMoving) {
      frame = window.requestAnimationFrame(render);
      return;
    }
    if (timeMs - lastFrameTime < WIND_FRAME_INTERVAL_MS) {
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
    lastFrameTime = timeMs;

    clear();
    context.globalCompositeOperation = "source-over";
    const zoomSignal = smoothStep(3.25, 5.65, map.getZoom());
    const activeParticleCount = Math.max(320, Math.round(particles.length * (0.56 + zoomSignal * 0.44)));
    const trailScale = 0.78 + zoomSignal * 0.3;
    const strokeScale = 0.84 + zoomSignal * 0.24;
    const opacityScale = 0.9 + zoomSignal * 0.08;
    canvas.dataset.activeParticleCount = String(activeParticleCount);
    canvas.dataset.zoomSignal = zoomSignal.toFixed(2);
    const paths = WIND_PARTICLE_STYLES.map(() => WIND_RIBBON_LAYERS.map(() => new Path2D()));
    let rawTrailLengthTotal = 0;
    let renderedTrailLengthTotal = 0;
    let measuredTrailCount = 0;
    for (let index = 0; index < activeParticleCount; index += 1) {
      const particle = particles[index];
      const vector = renderedWindVector(vectorIndex, particle.lon, particle.lat, storm);
      if (!vector) {
        Object.assign(particle, randomWindParticle(bounds, storm, Math.random() < 0.5));
        continue;
      }

      if (particle.trail.length === 0) {
        particle.u = vector.u;
        particle.v = vector.v;
        particle.trail.push({ lon: particle.lon, lat: particle.lat });
      } else {
        const response = 1 - Math.exp(-deltaSeconds * 5.4);
        particle.u += (vector.u - particle.u) * response;
        particle.v += (vector.v - particle.v) * response;
      }

      const simulationSeconds = 6800 * deltaSeconds;
      const latitudeScale = 111_320;
      const longitudeScale = latitudeScale * Math.max(0.2, Math.cos(degToRad(particle.lat)));
      particle.lon += (particle.u * simulationSeconds) / longitudeScale;
      particle.lat += (particle.v * simulationSeconds) / latitudeScale;
      particle.life -= deltaSeconds * 20;
      if (particle.life <= 0 || !containsWindPoint(bounds, particle.lon, particle.lat)) {
        Object.assign(particle, randomWindParticle(bounds, storm, Math.random() < 0.5));
        continue;
      }

      particle.trail.push({ lon: particle.lon, lat: particle.lat });
      if (particle.trail.length > trailPointLimit) particle.trail.shift();
      const projectedTrail = particle.trail.map((point) => map.project([point.lon, point.lat]));
      if (windTrailHasProjectionJump(projectedTrail)) {
        particle.trail = [{ lon: particle.lon, lat: particle.lat }];
        continue;
      }
      const rawTrailLength = windTrailLength(projectedTrail);
      const targetTrailLength = Math.max(12, Math.min(34, 9 + Math.hypot(particle.u, particle.v) * 0.52)) * trailScale;
      const displayTrail = stretchWindTrail(projectedTrail, targetTrailLength, rawTrailLength);
      rawTrailLengthTotal += rawTrailLength;
      renderedTrailLengthTotal += windTrailLength(displayTrail);
      measuredTrailCount += 1;
      const bucket = windParticleStyleIndex(Math.hypot(particle.u, particle.v));
      WIND_RIBBON_LAYERS.forEach((layer, layerIndex) => {
        const startIndex = Math.max(0, Math.floor((displayTrail.length - 1) * layer.start));
        appendSmoothWindTrail(paths[bucket][layerIndex], displayTrail, startIndex);
      });
    }
    canvas.dataset.averageRawTrailPx = measuredTrailCount > 0 ? (rawTrailLengthTotal / measuredTrailCount).toFixed(1) : "0";
    canvas.dataset.averageRenderedTrailPx = measuredTrailCount > 0 ? (renderedTrailLengthTotal / measuredTrailCount).toFixed(1) : "0";
    WIND_PARTICLE_STYLES.forEach((style, index) => {
      WIND_RIBBON_LAYERS.forEach((layer, layerIndex) => {
        context.strokeStyle = style.color;
        context.globalAlpha = opacityScale * layer.alpha;
        context.lineWidth = style.width * strokeScale * layer.widthScale * trailScale;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.shadowColor = style.glow;
        context.shadowBlur = style.blur * strokeScale;
        context.stroke(paths[index][layerIndex]);
      });
    });
    context.globalAlpha = 1;
    context.shadowBlur = 0;
    context.globalCompositeOperation = "source-over";
    frame = window.requestAnimationFrame(render);
  };

  const resetProjection = () => {
    mapMoving = true;
    clear();
  };
  const resumeProjection = () => {
    bounds = visibleWindBounds(map);
    particles.forEach((particle, index) => Object.assign(particle, randomWindParticle(bounds, storm, index % 3 === 0)));
    mapMoving = false;
    clear();
    lastFrameTime = 0;
  };
  const resetForResize = () => {
    resizeCanvas();
    resumeProjection();
  };

  frame = window.requestAnimationFrame(render);
  map.on("movestart", resetProjection);
  map.on("moveend", resumeProjection);
  map.on("resize", resetForResize);
  window.addEventListener("resize", resizeCanvas);

  return () => {
    window.cancelAnimationFrame(frame);
    map.off("movestart", resetProjection);
    map.off("moveend", resumeProjection);
    map.off("resize", resetForResize);
    window.removeEventListener("resize", resizeCanvas);
    clear();
  };
}

const WIND_PARTICLE_STYLES = [
  { color: "rgba(255, 255, 255, 0.62)", glow: "rgba(255, 255, 255, 0.24)", width: 0.74, blur: 0.55 },
  { color: "rgba(255, 255, 255, 0.7)", glow: "rgba(255, 255, 255, 0.28)", width: 0.82, blur: 0.68 },
  { color: "rgba(255, 255, 255, 0.78)", glow: "rgba(255, 255, 255, 0.32)", width: 0.9, blur: 0.82 },
  { color: "rgba(255, 255, 255, 0.86)", glow: "rgba(255, 255, 255, 0.38)", width: 1, blur: 1 },
  { color: "rgba(255, 255, 255, 0.94)", glow: "rgba(255, 255, 255, 0.44)", width: 1.1, blur: 1.2 }
] as const;

const WIND_RIBBON_LAYERS = [
  { start: 0, alpha: 0.24, widthScale: 0.68 },
  { start: 0.38, alpha: 0.5, widthScale: 0.84 },
  { start: 0.7, alpha: 1, widthScale: 1 }
] as const;

function appendSmoothWindTrail(path: Path2D, points: Array<{ x: number; y: number }>, startIndex: number) {
  if (points.length - startIndex < 2) return;
  const first = points[startIndex];
  path.moveTo(first.x, first.y);
  for (let index = startIndex + 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    path.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  }
  const endpoint = points[points.length - 1];
  path.lineTo(endpoint.x, endpoint.y);
}

function windTrailHasProjectionJump(points: Array<{ x: number; y: number }>) {
  for (let index = 1; index < points.length; index += 1) {
    if (Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y) > 54) return true;
  }
  return false;
}

function windTrailLength(points: Array<{ x: number; y: number }>) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function stretchWindTrail(points: Array<{ x: number; y: number }>, targetLength: number, currentLength: number) {
  if (points.length < 2 || currentLength <= 0.05 || currentLength >= targetLength) return points;
  const head = points[points.length - 1];
  const scale = Math.min(6, targetLength / currentLength);
  return points.map((point) => ({
    x: head.x + (point.x - head.x) * scale,
    y: head.y + (point.y - head.y) * scale
  }));
}

function appendWindCurve(
  path: Path2D | CanvasRenderingContext2D,
  headX: number,
  headY: number,
  dx: number,
  dy: number,
  particleIndex: number,
  storm?: Storm | null
) {
  const tailX = headX - dx;
  const tailY = headY - dy;
  const length = Math.max(1, Math.hypot(dx, dy));
  const curveSign = storm ? cycloneTangentialSign(storm.position.lat) : 1;
  const organicVariation = 0.72 + Math.sin(particleIndex * 12.9898) * 0.18;
  const bend = length * 0.22 * organicVariation * curveSign;
  const perpendicularX = -dy / length;
  const perpendicularY = dx / length;
  path.moveTo(tailX, tailY);
  path.quadraticCurveTo(
    (tailX + headX) / 2 + perpendicularX * bend,
    (tailY + headY) / 2 + perpendicularY * bend,
    headX,
    headY
  );
}

function windParticleStyleIndex(speed: number) {
  if (speed >= 28) return 4;
  if (speed >= 18) return 3;
  if (speed >= 11) return 2;
  if (speed >= 6) return 1;
  return 0;
}

interface WindParticleBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

interface WindParticle {
  lon: number;
  lat: number;
  life: number;
  u: number;
  v: number;
  trail: Array<{ lon: number; lat: number }>;
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

function staticWindSamples(bounds: WindParticleBounds, columns: number, rows: number) {
  const samples: Array<{ lon: number; lat: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      samples.push({
        lon: bounds.west + ((bounds.east - bounds.west) * (column + 0.5)) / columns,
        lat: bounds.south + ((bounds.north - bounds.south) * (row + 0.5)) / rows
      });
    }
  }
  return samples;
}

function randomWindParticle(bounds: WindParticleBounds, storm?: Storm | null, preferStorm = false): WindParticle {
  if (storm && preferStorm) {
    const radiusOfMaxWindKm = stormRadiusOfMaxWindKm(storm);
    const influenceKm = stormFlowInfluenceKm(storm);
    const radiusKm =
      Math.random() < 0.62
        ? radiusOfMaxWindKm * (0.52 + Math.random() * 1.48)
        : radiusOfMaxWindKm * 1.35 + Math.sqrt(Math.random()) * Math.max(1, influenceKm * 0.78 - radiusOfMaxWindKm * 1.35);
    const angle = Math.random() * Math.PI * 2;
    const lat = storm.position.lat + (Math.sin(angle) * radiusKm) / 111.32;
    const lon =
      storm.position.lon +
      (Math.cos(angle) * radiusKm) / (111.32 * Math.max(0.2, Math.cos(degToRad(storm.position.lat))));
    if (containsWindPoint(bounds, lon, lat)) {
      return {
        lon,
        lat,
        life: 90 + Math.floor(Math.random() * 170),
        u: 0,
        v: 0,
        trail: []
      };
    }
  }
  return {
    lon: bounds.west + Math.random() * (bounds.east - bounds.west),
    lat: bounds.south + Math.random() * (bounds.north - bounds.south),
    life: 70 + Math.floor(Math.random() * 150),
    u: 0,
    v: 0,
    trail: []
  };
}

function containsWindPoint(bounds: WindParticleBounds, lon: number, lat: number) {
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

interface WindVectorIndex {
  points: WindFieldPoint[];
}

function createWindVectorIndex(points: WindFieldPoint[]): WindVectorIndex {
  return { points };
}

function lookupWindVector(index: WindVectorIndex, lon: number, lat: number) {
  if (index.points.length === 0) return null;
  const cosLat = Math.max(0.2, Math.cos(degToRad(lat)));
  const nearest: Array<{ point: WindFieldPoint; distanceSquared: number }> = [];
  index.points.forEach((point) => {
    const dx = (point.lon - lon) * cosLat;
    const dy = point.lat - lat;
    const distanceSquared = dx * dx + dy * dy;
    let insertAt = nearest.findIndex((candidate) => distanceSquared < candidate.distanceSquared);
    if (insertAt < 0) insertAt = nearest.length;
    nearest.splice(insertAt, 0, { point, distanceSquared });
    if (nearest.length > 4) nearest.pop();
  });
  if (nearest[0].distanceSquared < 0.000001) return nearest[0].point;

  let totalWeight = 0;
  let u = 0;
  let v = 0;
  nearest.forEach(({ point, distanceSquared }) => {
    const weight = 1 / Math.pow(distanceSquared + 0.18, 1.18);
    totalWeight += weight;
    u += point.u * weight;
    v += point.v * weight;
  });
  if (totalWeight <= 0) return nearest[0].point;
  u /= totalWeight;
  v /= totalWeight;
  return {
    ...nearest[0].point,
    lon,
    lat,
    u,
    v,
    speed: Math.hypot(u, v),
    direction: (Math.atan2(-u, -v) * 180) / Math.PI
  };
}

function renderedWindVector(index: WindVectorIndex, lon: number, lat: number, storm?: Storm | null) {
  const background = lookupWindVector(index, lon, lat) ?? globalBackgroundWindVector(lon, lat);
  const vortex = storm ? stormVortexVector(storm, lon, lat) : null;
  if (!vortex) return background;
  if (!background) return vortex;

  const u = background.u * (1 - vortex.weight * 0.86) + vortex.u;
  const v = background.v * (1 - vortex.weight * 0.86) + vortex.v;
  return {
    ...background,
    u,
    v,
    speed: Math.hypot(u, v),
    direction: (Math.atan2(u, v) * 180) / Math.PI
  };
}

function globalBackgroundWindVector(lon: number, lat: number): WindFieldPoint {
  const absoluteLatitude = Math.abs(lat);
  const tropicalWeight = 1 - smoothStep(18, 34, absoluteLatitude);
  const midLatitudeWeight = smoothStep(18, 36, absoluteLatitude) * (1 - smoothStep(58, 72, absoluteLatitude));
  const polarWeight = smoothStep(58, 76, absoluteLatitude);
  const longitudeWave = Math.sin(degToRad(lon * 1.7 + lat * 0.8));
  const planetaryWave = Math.sin(degToRad(lon * 2.6 - lat * 1.4));
  const hemisphereSign = lat >= 0 ? 1 : -1;
  const u = -5.6 * tropicalWeight + 9.8 * midLatitudeWeight - 3.4 * polarWeight + longitudeWave * 1.7;
  const v = (planetaryWave * 1.55 + Math.cos(degToRad(lon * 0.9)) * 0.7) * hemisphereSign;
  return {
    lon,
    lat,
    u,
    v,
    speed: Math.hypot(u, v),
    direction: (Math.atan2(-u, -v) * 180) / Math.PI
  };
}

function stormVortexVector(storm: Storm, lon: number, lat: number) {
  const cosLat = Math.max(0.2, Math.cos(degToRad(storm.position.lat)));
  const dxKm = (lon - storm.position.lon) * 111.32 * cosLat;
  const dyKm = (lat - storm.position.lat) * 111.32;
  const radiusKm = Math.hypot(dxKm, dyKm);
  const influenceKm = stormFlowInfluenceKm(storm);
  if (radiusKm > influenceKm) return null;

  const radiusOfMaxWindKm = stormRadiusOfMaxWindKm(storm);
  const calmEyeRadiusKm = Math.max(8, Math.min(24, radiusOfMaxWindKm * 0.32));
  const peakWind = Math.max(18, storm.maxWind || 32);
  const radialProfile =
    radiusKm <= radiusOfMaxWindKm
      ? smoothStep(calmEyeRadiusKm, radiusOfMaxWindKm, radiusKm)
      : Math.pow(radiusOfMaxWindKm / Math.max(radiusKm, 1), 0.62);
  const edgeFade = 1 - smoothStep(0.74, 1, radiusKm / influenceKm);
  const tangentialSpeed = peakWind * radialProfile * edgeFade;
  const inflowSpeed = tangentialSpeed * (0.045 + 0.09 * smoothStep(radiusOfMaxWindKm, influenceKm, radiusKm));
  const safeRadius = Math.max(radiusKm, 0.5);
  const unitX = dxKm / safeRadius;
  const unitY = dyKm / safeRadius;
  const weight = edgeFade * (0.92 + smoothStep(calmEyeRadiusKm, radiusOfMaxWindKm, radiusKm) * 0.08);
  const tangentialSign = cycloneTangentialSign(storm.position.lat);

  return {
    lon,
    lat,
    u: -unitY * tangentialSpeed * tangentialSign - unitX * inflowSpeed,
    v: unitX * tangentialSpeed * tangentialSign - unitY * inflowSpeed,
    speed: tangentialSpeed,
    direction: 0,
    weight
  };
}

function stormRadiusOfMaxWindKm(storm: Storm) {
  const structuralRadius = storm.windRadiiKm.r12 || storm.windRadiiKm.r10 || Math.max(70, storm.windRadiiKm.r7 * 0.32);
  return Math.max(22, Math.min(78, structuralRadius * 0.28));
}

function stormFlowInfluenceKm(storm: Storm) {
  const { r7, r10, r12 } = storm.windRadiiKm;
  return Math.max(r7 * 1.55, r10 * 2.4, r12 * 3.2, 620);
}

function windColor(speed: number, alpha: number) {
  const speedSignal = smoothStep(3, 30, speed);
  return `rgba(255, 255, 255, ${Math.min(0.96, alpha + 0.18 + speedSignal * 0.26)})`;
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
  const nextKey = stormMarkerRenderKey(storm, satelliteLayer, bossProfile);
  const currentElement = ref.current?.getElement();
  if (ref.current && currentElement?.dataset.renderKey === nextKey) {
    ref.current.setLngLat([storm.position.lon, storm.position.lat]);
    applyStormMarkerDimensions(map, storm, currentElement);
    return;
  }

  disposeStormMarker(ref.current);
  ref.current = null;

  const element = createStormMarkerElement(map, storm, satelliteLayer, bossProfile);
  element.dataset.renderKey = nextKey;
  ref.current = new maplibregl.Marker({ element, anchor: "center" })
    .setLngLat([storm.position.lon, storm.position.lat])
    .addTo(map);
}

function stormMarkerRenderKey(storm: Storm, satelliteLayer?: SatelliteLayerPayload | null, bossProfile?: BossProfile | null) {
  return [
    storm.id,
    storm.updatedAt,
    storm.maxWind,
    storm.minPressure,
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
  const kinematics = cycloneVisualKinematics(storm.position.lat);

  const root = document.createElement("div");
  root.className = `storm-map-marker structure-${bossProfile?.structure.state ?? "unknown"}`;
  root.dataset.rotationDirection = kinematics.direction;
  root.style.setProperty("--storm-core-intensity", String(intensity));
  root.style.setProperty("--storm-spin-duration", `${Math.max(7.5, 16 - intensity * 7)}s`);
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

  const label = document.createElement("div");
  label.className = "storm-target-label";
  const name = document.createElement("span");
  name.textContent = storm.nameZh;
  const stage = document.createElement("strong");
  stage.textContent = storm.stage;
  label.append(name, stage);

  root.append(core, label);
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

function syncStormMarkerScale(
  map: MapLibreMap,
  storm: Storm | null,
  markerRef: MutableRefObject<maplibregl.Marker | null>
) {
  const element = markerRef.current?.getElement();
  if (!storm || !element) return;
  applyStormMarkerDimensions(map, storm, element);
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

function projectPathLabels(map: MapLibreMap, storm: Storm | null) {
  if (!storm) return [];
  const canvas = map.getCanvas();
  const stormPoint = map.project([storm.position.lon, storm.position.lat]);
  const safeBox = {
    left: 320,
    top: 132,
    right: canvas.clientWidth - 230,
    bottom: canvas.clientHeight - 126
  };
  const candidates = storm.forecast.length > 0 ? storm.forecast : storm.track.slice(-6);
  return candidates
    .filter((_, index) => index % 2 === 0)
    .map((point, index) => {
      const projected = map.project([point.lon, point.lat]);
      return {
        id: `${point.time}-${index}`,
        x: Math.round(projected.x + 16),
        y: Math.round(projected.y - 18),
        label: formatPathTime(point.time),
        distanceFromStorm: Math.hypot(projected.x - stormPoint.x, projected.y - stormPoint.y)
      };
    })
    .filter(
      (item) =>
        item.distanceFromStorm > 110 &&
        item.x > safeBox.left &&
        item.x < safeBox.right &&
        item.y > safeBox.top &&
        item.y < safeBox.bottom
    )
    .slice(0, 4);
}

function projectRegionLabels(map: MapLibreMap, labels: MapRegionLabel[]): ScreenRegionLabel[] {
  const canvas = map.getCanvas();
  return labels
    .map((label) => {
      const point = map.project(label.coordinate);
      return {
        id: label.id,
        zh: label.zh,
        en: label.en,
        x: Math.round(point.x),
        y: Math.round(point.y)
      };
    })
    .filter((label) => label.x > 16 && label.y > 16 && label.x < canvas.clientWidth - 16 && label.y < canvas.clientHeight - 16);
}

function syncMapOverlays(
  map: MapLibreMap,
  storm: Storm | null,
  setPathLabels: Dispatch<SetStateAction<PathScreenLabel[]>>,
  regionLabels: MapRegionLabel[],
  setRegionLabels: Dispatch<SetStateAction<ScreenRegionLabel[]>>
) {
  const nextPathLabels = projectPathLabels(map, storm);
  const nextRegionLabels = projectRegionLabels(map, regionLabels);
  setPathLabels((current) => (pathLabelsEqual(current, nextPathLabels) ? current : nextPathLabels));
  setRegionLabels((current) => (regionLabelsEqual(current, nextRegionLabels) ? current : nextRegionLabels));
}

function pathLabelsEqual(current: PathScreenLabel[], next: PathScreenLabel[]) {
  return (
    current.length === next.length &&
    current.every((item, index) => {
      const other = next[index];
      return item.id === other.id && item.x === other.x && item.y === other.y && item.label === other.label;
    })
  );
}

function regionLabelsEqual(current: ScreenRegionLabel[], next: ScreenRegionLabel[]) {
  return (
    current.length === next.length &&
    current.every((item, index) => {
      const other = next[index];
      return item.id === other.id && item.x === other.x && item.y === other.y && item.zh === other.zh && item.en === other.en;
    })
  );
}

function screenBoxesEqual(current: ScreenBox | null, next: ScreenBox | null) {
  if (!current || !next) return current === next;
  return current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height;
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
      if (!(zh in REGION_EN_NAMES)) return null;
      return {
        id: `${rawName || zh}-${index}`,
        zh,
        en: REGION_EN_NAMES[zh] ?? zh.toUpperCase(),
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
