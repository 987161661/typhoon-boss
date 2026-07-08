"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MutableRefObject } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { AlertTriangle, ChevronRight, Database, Palette, RadioTower, Satellite, Shield, Wind } from "lucide-react";
import Link from "next/link";
import { makeCircle } from "@/lib/provinceGeo";
import type { BossProfile } from "@/lib/bossEngine/types";
import type {
  ImpactAreaPayload,
  ProvinceDefenseStatus,
  SatelliteLayerPayload,
  Storm,
  WindFieldPayload,
  WindFieldPoint
} from "@/lib/types";
import { DefenseDrawer } from "./DefenseDrawer";
import { HudPanel, StatusPill } from "./HudPrimitives";
import { BossSkillSlotPanel, IntelPanel } from "./IntelPanel";

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
const terrainTileCache = new Map<string, Promise<HTMLCanvasElement | null>>();

const WATCH_PROVINCES = [
  { name: "浙江省", center: [120.2, 30.3] },
  { name: "福建省", center: [119.3, 26.1] },
  { name: "广东省", center: [113.3, 23.1] },
  { name: "上海市", center: [121.5, 31.2] },
  { name: "江苏省", center: [118.8, 32.1] }
] as const;

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

const DEFAULT_REGION_LABELS: MapRegionLabel[] = [
  { id: "jiangsu", zh: "江苏", en: "JIANGSU", coordinate: [118.8, 32.1] },
  { id: "shanghai", zh: "上海", en: "SHANGHAI", coordinate: [121.5, 31.2] },
  { id: "zhejiang", zh: "浙江", en: "ZHEJIANG", coordinate: [120.2, 30.3] },
  { id: "fujian", zh: "福建", en: "FUJIAN", coordinate: [119.3, 26.1] },
  { id: "guangdong", zh: "广东", en: "GUANGDONG", coordinate: [113.3, 23.1] },
  { id: "taiwan", zh: "台湾", en: "TAIWAN", coordinate: [121.0, 23.7] }
];

type RadarTheme = "night-radar" | "archive-command";

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

interface CurrentStormResponse {
  source: string;
  updatedAt: string;
  storms: Storm[];
  error?: string;
}

interface CurrentBossResponse {
  source: {
    primary: string;
    machineReadableTrackSource: string;
    updatedAt: string;
  };
  bosses: BossProfile[];
  degraded?: boolean;
  warnings?: string[];
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

export function TyphoonMap() {
  const [storms, setStorms] = useState<Storm[]>([]);
  const [bossProfiles, setBossProfiles] = useState<BossProfile[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [theme, setTheme] = useState<RadarTheme>(() => {
    if (typeof window === "undefined") return "night-radar";
    const requestedTheme = new URLSearchParams(window.location.search).get("theme");
    return requestedTheme === "dossier" || requestedTheme === "archive-command" ? "archive-command" : "night-radar";
  });
  const [selectedDefense, setSelectedDefense] = useState<ProvinceDefenseStatus | null>(null);
  const [sourceLabel, setSourceLabel] = useState("浙江省水利厅台风路径公开接口");
  const [lastUpdated, setLastUpdated] = useState("等待刷新");
  const [dataError, setDataError] = useState<string | null>(null);
  const [stormLoadComplete, setStormLoadComplete] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [pathScreenLabels, setPathScreenLabels] = useState<Array<{ id: string; x: number; y: number; label: string }>>([]);
  const [regionScreenLabels, setRegionScreenLabels] = useState<ScreenRegionLabel[]>([]);
  const [environmentLayers, setEnvironmentLayers] = useState<EnvironmentLayerToggles>(DEFAULT_ENVIRONMENT_LAYERS);
  const [satelliteLayer, setSatelliteLayer] = useState<SatelliteLayerPayload | null>(null);
  const [windField, setWindField] = useState<WindFieldPayload | null>(null);
  const [impactArea, setImpactArea] = useState<ImpactAreaPayload | null>(null);
  const [satelliteScreenBox, setSatelliteScreenBox] = useState<ScreenBox | null>(null);
  const mapNode = useRef<HTMLDivElement | null>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const windCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const stormRef = useRef<Storm | null>(null);
  const regionLabelsRef = useRef<MapRegionLabel[]>(DEFAULT_REGION_LABELS);
  const storm = storms[activeIndex] ?? null;
  const bossProfile = useMemo(
    () => (storm ? bossProfiles.find((profile) => profile.stormId === storm.id) ?? null : null),
    [bossProfiles, storm]
  );

  const stormGeo = useMemo(() => buildStormGeo(storm), [storm]);
  const provinceAlerts = useMemo(() => buildProvinceAlerts(storm), [storm]);
  const toggleEnvironmentLayer = useCallback((layer: EnvironmentLayerKey) => {
    setEnvironmentLayers((current) => ({
      ...current,
      [layer]: !current[layer]
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadStorms() {
      try {
        const stamp = Date.now();
        const [stormResponse, bossResponse] = await Promise.all([
          fetch(`/api/storms/current?t=${stamp}`, { cache: "no-store" }),
          fetch(`/api/boss/current?t=${stamp}`, { cache: "no-store" })
        ]);
        const payload = (await stormResponse.json()) as CurrentStormResponse;
        const bossPayload = (await bossResponse.json()) as CurrentBossResponse;
        if (cancelled) return;
        setSourceLabel(payload.source);
        setLastUpdated(formatClock(payload.updatedAt));
        setStorms(payload.storms ?? []);
        setBossProfiles(bossPayload.bosses ?? []);
        setDataError(stormResponse.ok ? null : payload.error ?? "实时台风接口暂时不可用");
        setStormLoadComplete(true);
      } catch (error) {
        if (cancelled) return;
        setStorms([]);
        setBossProfiles([]);
        setDataError(error instanceof Error ? error.message : "实时台风接口暂时不可用");
        setLastUpdated(formatClock(new Date().toISOString()));
        setStormLoadComplete(true);
      }
    }

    loadStorms();
    const timer = window.setInterval(loadStorms, 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (activeIndex >= storms.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, storms.length]);

  useEffect(() => {
    stormRef.current = storm;
  }, [storm]);

  useEffect(() => {
    if (!stormLoadComplete) return;
    let cancelled = false;

    async function loadEnvironmentLayers() {
      const stormQuery = storm?.id ? `?stormId=${encodeURIComponent(storm.id)}` : "";
      const fetchJson = async <T,>(url: string) => {
        const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
        return (await response.json()) as T;
      };

      const [satelliteResult, windResult, impactResult] = await Promise.allSettled([
        fetchJson<SatelliteLayerPayload>("/api/environment/satellite"),
        fetchJson<WindFieldPayload>(`/api/environment/wind-field${stormQuery}`),
        fetchJson<ImpactAreaPayload>(`/api/environment/impact-area${stormQuery}`)
      ]);

      if (cancelled) return;
      if (satelliteResult.status === "fulfilled") setSatelliteLayer(satelliteResult.value);
      if (windResult.status === "fulfilled") setWindField(windResult.value);
      if (impactResult.status === "fulfilled") setImpactArea(impactResult.value);
    }

    loadEnvironmentLayers();
    const timer = window.setInterval(loadEnvironmentLayers, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [storm?.id, stormLoadComplete]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    renderStormOnMap(map, storm, markerRef);
  }, [storm]);

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

      map.on("load", async () => {
        syncMapOverlays(
          map,
          stormRef.current,
          setPathScreenLabels,
          regionLabelsRef.current,
          setRegionScreenLabels
        );
        const provinces = await fetchProvinceGeoJson();
        const geoLabels = buildMapRegionLabels(provinces);
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
        syncMapOverlays(
          map,
          stormRef.current,
          setPathScreenLabels,
          regionLabelsRef.current,
          setRegionScreenLabels
        );
        setMapReady(true);
      });

      const syncOverlays = () =>
        syncMapOverlays(
          map,
          stormRef.current,
          setPathScreenLabels,
          regionLabelsRef.current,
          setRegionScreenLabels
        );
      map.on("move", syncOverlays);
      map.on("zoom", syncOverlays);
      map.on("resize", syncOverlays);
      map.on("error", () => undefined);
    } catch {
      setMapFailed(true);
    }

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [fetchDefense]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    updateStormSources(map, stormGeo);
    renderStormOnMap(map, storm, markerRef);
    syncMapOverlays(map, storm, setPathScreenLabels, regionLabelsRef.current, setRegionScreenLabels);
    if (storm) {
      map.resize();
      focusMapOnStorm(map, storm, theme !== "archive-command", theme);
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
      } else {
        map.once("moveend", () =>
          syncMapOverlays(
            map,
            storm,
            setPathScreenLabels,
            regionLabelsRef.current,
            setRegionScreenLabels
          )
        );
      }
    } else {
      map.easeTo({ center: [122.5, 27.4], zoom: 4.7, duration: 900 });
      setPathScreenLabels([]);
      setRegionScreenLabels(projectRegionLabels(map, regionLabelsRef.current));
    }
  }, [storm, stormGeo, mapReady, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const syncSatellite = () => {
      setSatelliteScreenBox(
        satelliteLayer?.status === "available" && environmentLayers.satellite
          ? projectSatelliteBox(map, satelliteLayer.bounds)
          : null
      );
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
    const canvas = windCanvasRef.current;
    if (!map || !canvas || !mapReady) return;
    return startWindFieldRenderer(map, canvas, windField, environmentLayers.wind);
  }, [windField, environmentLayers.wind, mapReady, theme]);

  return (
    <main className="radar-shell" data-theme={theme}>
      <div className="boot-scan" />
      <section className="map-stage" aria-label="台风 Boss 雷达地图">
        {mapFailed ? <FallbackMap storm={storm} /> : <div className="map-canvas" ref={mapNode} />}
        {!mapFailed ? <canvas className="terrain-elevation-canvas" ref={terrainCanvasRef} aria-hidden="true" /> : null}
        <SatelliteCloudOverlay layer={satelliteLayer} box={satelliteScreenBox} />
        {!mapFailed ? <canvas className="wind-particle-canvas" ref={windCanvasRef} aria-hidden="true" /> : null}

        <div className="map-effects" aria-hidden="true">
          <div className="map-vignette" />
          <div className="radar-grid" />
          <div className="hud-circuit-layer" />
          <div className="radar-sweep" />
        </div>

        {theme === "archive-command" ? <DossierSceneDecor storm={storm} sourceLabel={sourceLabel} dataError={dataError} /> : null}
        {theme === "archive-command" ? <DossierMapFurniture /> : null}

        <MapLabelLayer labels={regionScreenLabels} />
        <PathTimeOverlay labels={pathScreenLabels} />
        <ForecastBadge storm={storm} />

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

        {theme === "night-radar" ? (
          <div className="left-tactical-stack">
            <DefenseStatusPanel alerts={provinceAlerts} onSelect={fetchDefense} />
            <BossSkillSlotPanel storm={storm} bossProfile={bossProfile} className="left-boss-skill-panel" />
          </div>
        ) : (
          <DefenseStatusPanel alerts={provinceAlerts} onSelect={fetchDefense} />
        )}
        {theme === "archive-command" ? <MapLegendPanel /> : null}
        <EnvironmentLayerPanel
          layers={environmentLayers}
          satellite={satelliteLayer}
          windField={windField}
          impactArea={impactArea}
          onToggle={toggleEnvironmentLayer}
        />
        {theme === "archive-command" ? (
          <DossierStormIndex storms={storms} activeIndex={activeIndex} onSelect={setActiveIndex} />
        ) : (
          <StormSwitcher storms={storms} activeIndex={activeIndex} onSelect={setActiveIndex} />
        )}
        {theme === "archive-command" ? <ImpactLegend /> : null}
        {theme === "night-radar" ? <BottomAlertBar storm={storm} bossProfile={bossProfile} alerts={provinceAlerts} dataError={dataError} sourceLabel={sourceLabel} /> : null}
        <DefenseDrawer defense={selectedDefense} onClose={() => setSelectedDefense(null)} />
      </section>

      <IntelPanel storm={storm} bossProfile={bossProfile} source={sourceLabel} dataError={dataError} theme={theme} />
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

function ForecastBadge({ storm }: { storm: Storm | null }) {
  if (!storm || storm.forecast.length === 0) return null;
  return (
    <div className="forecast-badge" aria-hidden="true">
      <b>FORECAST PATH</b>
      <span>预测路径</span>
    </div>
  );
}

function focusMapOnStorm(map: MapLibreMap, storm: Storm | null, animated: boolean, theme: RadarTheme = "night-radar") {
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
          <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />
        </div>
      </header>
    );
  }

  return (
    <header className="top-command">
      <div className="brand-block">
        <span>TYPHOON BOSS RADAR</span>
        <strong>{"\u53f0\u98ce BOSS \u96f7\u8fbe"}</strong>
      </div>
      <div className="live-radar-band">
        <b>LIVE RADAR</b>
        <div className="command-strip">
          <StatusPill label="MISSION STATUS" value={dataError ? "LINK ERROR" : storm ? "ACTIVE" : "STANDBY"} alert={Boolean(dataError || storm)} />
          <StatusPill label="BOSS PHASE" value={bossProfile?.phaseLabel ?? storm?.rating ?? "LOW"} alert={Boolean(storm)} />
          <StatusPill label="SYSTEM TIME" value={lastUpdated} />
        </div>
      </div>
      <div className="source-chip" title={sourceLabel}>
        <Satellite size={16} />
        <span>{sourceLabel} / {"\u76ee\u6807\u6570"} {count}</span>
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
    { value: "night-radar", label: "RADAR" },
    { value: "archive-command", label: "DOSSIER" }
  ];

  return (
    <div className="theme-switcher" aria-label="UI theme">
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
        <span>PROVINCE DEFENSE</span>
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
      label: "真实云图",
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
      status: windField?.status === "available" ? `${windField.points.length} 风矢量` : windField?.reason ?? "等待资料",
      alert: windField?.status !== "available"
    }
  ];

  return (
    <HudPanel as="aside" className="environment-panel" aria-label="环境图层控制">
      <div className="section-title compact">
        <Satellite size={16} />
        <span>ENV LAYERS</span>
      </div>
      <small className="section-subtitle">实时云气 / 风场 / 高差</small>
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
              <b>{layers[row.id] ? "ON" : "OFF"}</b>
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
  return formatClock(layer.updatedAt);
}

function StormSwitcher({
  storms,
  activeIndex,
  onSelect
}: {
  storms: Storm[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav className="storm-switcher" aria-label="切换当前台风">
      {storms.length > 0 ? (
        storms.map((item, index) => (
          <button className={index === activeIndex ? "active" : ""} key={item.id} type="button" onClick={() => onSelect(index)}>
            <span>{item.nameZh}</span>
            <small>{item.stage}</small>
          </button>
        ))
      ) : (
        <button className="active" type="button">
          <span>待机扫描</span>
          <small>当前无活动台风</small>
        </button>
      )}
    </nav>
  );
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
      <LegendLine color="white" label="预测路径" detail="公开预报" />
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
          <b>BOSS EVENT TRACE</b>
          <span>战斗履历 / 省份防线</span>
        </div>
      </div>
      <div className="boss-event-strip">
        {events.length > 0
          ? events.map((event) => (
              <div className={`boss-event-card evidence-${event.evidenceLevel}`} key={event.id}>
                <b>{event.title}</b>
                <p>{event.detail}</p>
                <small>{formatClock(event.time)} / {eventEvidenceLabel(event.evidenceLevel)}</small>
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
        <span>TRACK / AUTHORITY</span>
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
    id: "forecast-line",
    type: "line",
    source: "forecast",
    paint: {
      "line-color": "#e8f5fb",
      "line-width": 3,
      "line-dasharray": [1.4, 1.4],
      "line-opacity": 0.9
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
      "circle-radius": 4.6,
      "circle-color": "#e8f5fb",
      "circle-stroke-color": "#071015",
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.92
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
    x,
    y,
    width: Math.abs(southeast.x - northwest.x),
    height: Math.abs(southeast.y - northwest.y)
  };
}

function startTerrainElevationRenderer(map: MapLibreMap, canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;

  let cancelled = false;
  let renderId = 0;
  let frame = 0;

  const resizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    const currentRender = ++renderId;
    resizeCanvas();
    clear();

    const zoom = Math.max(TERRAIN_TILE_ZOOM_MIN, Math.min(TERRAIN_TILE_ZOOM_MAX, Math.round(map.getZoom())));
    const tiles = terrainTilesForViewport(map, zoom, canvas.clientWidth, canvas.clientHeight);
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
  };

  const scheduleRender = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      void render();
    });
  };

  const invalidateAndClear = () => {
    renderId += 1;
    window.cancelAnimationFrame(frame);
    resizeCanvas();
    clear();
  };

  const scheduleInteractiveRender = () => {
    invalidateAndClear();
    scheduleRender();
  };

  scheduleRender();
  map.on("movestart", invalidateAndClear);
  map.on("zoomstart", invalidateAndClear);
  map.on("move", scheduleInteractiveRender);
  map.on("zoom", scheduleInteractiveRender);
  map.on("moveend", scheduleRender);
  map.on("zoomend", scheduleRender);
  map.on("resize", scheduleRender);
  window.addEventListener("resize", scheduleRender);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
    map.off("movestart", invalidateAndClear);
    map.off("zoomstart", invalidateAndClear);
    map.off("move", scheduleInteractiveRender);
    map.off("zoom", scheduleInteractiveRender);
    map.off("moveend", scheduleRender);
    map.off("zoomend", scheduleRender);
    map.off("resize", scheduleRender);
    window.removeEventListener("resize", scheduleRender);
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

function startWindFieldRenderer(
  map: MapLibreMap,
  canvas: HTMLCanvasElement,
  windField: WindFieldPayload | null,
  visible: boolean
) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;

  let frame = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const points = windField?.status === "available" ? windField.points : [];

  const resizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const clear = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
  };

  resizeCanvas();
  if (!visible || points.length === 0) {
    clear();
    return () => clear();
  }

  const bounds = windBounds(points);
  const particleCount = Math.max(200, Math.min(800, canvas.clientWidth <= 760 ? 240 : 560));
  const particles = Array.from({ length: particleCount }, () => randomWindParticle(bounds));

  const drawParticle = (particle: ReturnType<typeof randomWindParticle>, alpha: number) => {
    const vector = nearestWindVector(points, particle.lon, particle.lat);
    if (!vector) return;
    const start = map.project([particle.lon, particle.lat]);
    const speedFactor = Math.max(0.35, Math.min(1.8, vector.speed / 18));
    const dx = vector.u * 2.4;
    const dy = -vector.v * 2.4;
    context.strokeStyle = windColor(vector.speed, alpha);
    context.lineWidth = 0.7 + speedFactor * 0.85;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(start.x - dx, start.y - dy);
    context.stroke();

    particle.lon += vector.u * 0.0045;
    particle.lat += vector.v * 0.0045;
    particle.life -= 1;
    if (particle.life <= 0 || !containsWindPoint(bounds, particle.lon, particle.lat)) {
      Object.assign(particle, randomWindParticle(bounds));
    }
  };

  const drawStatic = () => {
    resizeCanvas();
    clear();
    context.globalCompositeOperation = "lighter";
    points.forEach((point) => {
      const projected = map.project([point.lon, point.lat]);
      context.strokeStyle = windColor(point.speed, 0.44);
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(projected.x, projected.y);
      context.lineTo(projected.x - point.u * 3.2, projected.y + point.v * 3.2);
      context.stroke();
    });
    context.globalCompositeOperation = "source-over";
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

  const render = () => {
    resizeCanvas();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "rgba(3, 8, 12, 0.13)";
    context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    context.globalCompositeOperation = "lighter";

    for (let index = 0; index < particles.length; index += 1) {
      drawParticle(particles[index], 0.22 + ((index + frame) % 7) * 0.035);
    }
    context.globalCompositeOperation = "source-over";
    frame = window.requestAnimationFrame(render);
  };

  const resetProjection = () => {
    clear();
  };

  frame = window.requestAnimationFrame(render);
  map.on("move", resetProjection);
  map.on("resize", resizeCanvas);
  window.addEventListener("resize", resizeCanvas);

  return () => {
    window.cancelAnimationFrame(frame);
    map.off("move", resetProjection);
    map.off("resize", resizeCanvas);
    window.removeEventListener("resize", resizeCanvas);
    clear();
  };
}

function windBounds(points: WindFieldPoint[]) {
  return points.reduce(
    (acc, point) => ({
      west: Math.min(acc.west, point.lon),
      east: Math.max(acc.east, point.lon),
      south: Math.min(acc.south, point.lat),
      north: Math.max(acc.north, point.lat)
    }),
    {
      west: Number.POSITIVE_INFINITY,
      east: Number.NEGATIVE_INFINITY,
      south: Number.POSITIVE_INFINITY,
      north: Number.NEGATIVE_INFINITY
    }
  );
}

function randomWindParticle(bounds: ReturnType<typeof windBounds>) {
  return {
    lon: bounds.west + Math.random() * (bounds.east - bounds.west),
    lat: bounds.south + Math.random() * (bounds.north - bounds.south),
    life: 45 + Math.floor(Math.random() * 120)
  };
}

function containsWindPoint(bounds: ReturnType<typeof windBounds>, lon: number, lat: number) {
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function nearestWindVector(points: WindFieldPoint[], lon: number, lat: number) {
  let nearest = points[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point) => {
    const distance = (point.lon - lon) ** 2 + (point.lat - lat) ** 2;
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function windColor(speed: number, alpha: number) {
  if (speed >= 18) return `rgba(255, 74, 50, ${alpha + 0.2})`;
  if (speed >= 11) return `rgba(255, 176, 0, ${alpha + 0.16})`;
  if (speed >= 6) return `rgba(0, 216, 255, ${alpha + 0.12})`;
  return `rgba(116, 255, 202, ${alpha})`;
}

function renderStormOnMap(
  map: MapLibreMap,
  storm: Storm | null,
  markerOverride?: MutableRefObject<maplibregl.Marker | null>
) {
  const ref = markerOverride ?? ({ current: null } as MutableRefObject<maplibregl.Marker | null>);
  ref.current?.remove();
  ref.current = null;
  if (!storm) return;

  const element = createStormMarkerElement(map, storm);
  ref.current = new maplibregl.Marker({ element, anchor: "center" })
    .setLngLat([storm.position.lon, storm.position.lat])
    .addTo(map);
}

function createStormMarkerElement(map: MapLibreMap, storm: Storm) {
  const center = map.project([storm.position.lon, storm.position.lat]);
  const radiusPx = projectRadiusKmToPixels(map, storm.position, stormVisualRadiusKm(storm), center);
  const canvas = map.getCanvas();
  const maxDiameter = canvas.clientWidth <= 760 ? Math.max(132, canvas.clientWidth * 0.48) : 520;
  const minDiameter = canvas.clientWidth <= 760 ? 96 : 96;
  const diameter = Math.min(maxDiameter, Math.max(minDiameter, Math.round(radiusPx * 2)));
  const intensity = Math.max(0.56, Math.min(1, (storm.maxWind || 32) / 72));

  const root = document.createElement("div");
  root.className = "storm-map-marker";
  root.style.width = `${diameter}px`;
  root.style.height = `${diameter}px`;
  root.style.setProperty("--storm-core-intensity", String(intensity));
  root.style.setProperty("--storm-spin-duration", `${Math.max(7.5, 16 - intensity * 7)}s`);
  root.style.setProperty("--storm-pulse-duration", `${Math.max(1.8, 3.6 - intensity * 1.3)}s`);
  root.style.setProperty("--storm-wave-opacity", String(0.2 + intensity * 0.26));

  const vortex = document.createElement("div");
  vortex.className = `storm-vortex vortex-${stageSlug(storm.stage)}`;
  ["storm-pressure-wave wave-a", "storm-pressure-wave wave-b", "storm-band-sheen"].forEach((className) => {
    const part = document.createElement("span");
    part.className = className;
    vortex.appendChild(part);
  });

  const liveCore = document.createElement("span");
  liveCore.className = "storm-live-core";
  vortex.appendChild(liveCore);

  const hotspot = document.createElement("span");
  hotspot.className = "storm-core-hotspot";
  vortex.appendChild(hotspot);

  const label = document.createElement("div");
  label.className = "storm-target-label";
  const name = document.createElement("span");
  name.textContent = storm.nameZh;
  const stage = document.createElement("strong");
  stage.textContent = storm.stage;
  label.append(name, stage);

  root.append(vortex, label);
  return root;
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
        x: projected.x + 16,
        y: projected.y - 18,
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
        x: point.x,
        y: point.y
      };
    })
    .filter((label) => label.x > 16 && label.y > 16 && label.x < canvas.clientWidth - 16 && label.y < canvas.clientHeight - 16);
}

function syncMapOverlays(
  map: MapLibreMap,
  storm: Storm | null,
  setPathLabels: (labels: Array<{ id: string; x: number; y: number; label: string }>) => void,
  regionLabels: MapRegionLabel[],
  setRegionLabels: (labels: ScreenRegionLabel[]) => void
) {
  setPathLabels(projectPathLabels(map, storm));
  setRegionLabels(projectRegionLabels(map, regionLabels));
}

function stormVisualRadiusKm(storm: Storm) {
  const { r7, r10, r12 } = storm.windRadiiKm;
  return Math.max(r10 * 1.18, r12 * 2.1, r7 * 0.46, 140);
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
    forecast: lineFeatureCollection(storm.forecast.map((point) => [point.lon, point.lat])),
    trackPoints: pointFeatureCollection(storm.track.map((point) => [point.lon, point.lat])),
    forecastPoints: pointFeatureCollection(storm.forecast.map((point) => [point.lon, point.lat])),
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

function buildProvinceAlerts(storm: Storm | null) {
  return WATCH_PROVINCES.map((province) => {
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
