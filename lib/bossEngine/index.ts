import type { Storm, TrackPoint } from "@/lib/types";
import { sampleBossEnvironment, type EnvironmentFeatures } from "./environmentSampler";
import { getHimawariProductsForStorm, type SatelliteProductsSummary } from "./satelliteProducts";
import type {
  BossArchetype,
  BossEvent,
  BossEvidenceLevel,
  BossPhase,
  BossProfile,
  BossSkill,
  BossSkillEvidence
} from "./types";

const SOURCE_POLICY = {
  canonicalAuthority: "中央气象台 / 国家气象中心台风产品",
  machineReadableTrackSource: "浙江省水利厅公开台风路径接口",
  regionalWarningAuthority: "国家海洋预报台 / 属地气象台与应急部门"
};

const WATCH_POINTS = [
  { name: "浙江", lon: 120.2, lat: 30.3 },
  { name: "福建", lon: 119.3, lat: 26.1 },
  { name: "广东", lon: 113.3, lat: 23.1 },
  { name: "海南", lon: 110.3, lat: 20.0 },
  { name: "台湾", lon: 121.0, lat: 23.7 },
  { name: "上海", lon: 121.5, lat: 31.2 },
  { name: "江苏", lon: 118.8, lat: 32.1 }
];

export async function buildBossProfiles(storms: Storm[]): Promise<BossProfile[]> {
  return Promise.all(storms.map((storm) => buildBossProfile(storm)));
}

export async function buildBossProfile(storm: Storm): Promise<BossProfile> {
  const intensity = buildIntensityFeatures(storm);
  const landfall = buildLandfallFeatures(storm);
  const [environment, satellite] = await Promise.all([sampleBossEnvironment(storm), getHimawariProductsForStorm(storm)]);
  const archetype = chooseArchetype(storm, intensity, landfall, environment);
  const phase = choosePhase(storm, intensity, landfall);
  const skills = chooseSkills([
    windPressureCoreSkill(storm, intensity),
    outerRingSkill(storm),
    innerWallSkill(storm),
    burstSkill(storm, intensity),
    weakeningSkill(storm, intensity),
    suddenDashSkill(storm),
    coastalSiegeSkill(storm, landfall),
    moistureDevourSkill(environment),
    rainCurtainDomainSkill(environment),
    convectiveChargeSkill(environment),
    stallingDrainSkill(storm, environment),
    satelliteRainPotentialHintSkill(environment, satellite),
    coreRestructureHintSkill(storm, intensity, satellite)
  ]);
  const events = buildEvents(storm, intensity, landfall);
  const energy = calculateBossEnergy(storm);

  return {
    stormId: storm.id,
    code: storm.code,
    nameZh: storm.nameZh,
    nameEn: storm.nameEn,
    title: `${storm.nameZh} ${archetypeLabel(archetype)}`,
    subtitle: `${phaseLabel(phase)} / ${storm.stage}`,
    archetype,
    archetypeLabel: archetypeLabel(archetype),
    phase,
    phaseLabel: phaseLabel(phase),
    rating: String(storm.rating),
    energy,
    riskSummary: buildRiskSummary(storm, archetype, phase, landfall, environment, satellite),
    primarySkillIds: skills.slice(0, 3).map((skill) => skill.id),
    skills,
    events,
    evidenceSummary: buildEvidenceSummary(storm, skills, environment, satellite),
    environment: buildEnvironmentSummary(environment),
    satellite: buildSatelliteSummary(satellite),
    sourcePolicy: SOURCE_POLICY,
    generatedAt: new Date().toISOString()
  };
}

function buildIntensityFeatures(storm: Storm) {
  const latest = storm.track.at(-1);
  const sixHourPoint = findPreviousPoint(storm.track, latest, 6);
  const twelveHourPoint = findPreviousPoint(storm.track, latest, 12);
  const windDelta6h = latest && sixHourPoint ? latest.wind - sixHourPoint.wind : null;
  const windDelta12h = latest && twelveHourPoint ? latest.wind - twelveHourPoint.wind : null;
  const pressureDelta6h = latest && sixHourPoint ? latest.pressure - sixHourPoint.pressure : null;
  const pressureDelta12h = latest && twelveHourPoint ? latest.pressure - twelveHourPoint.pressure : null;

  return {
    windDelta6h,
    windDelta12h,
    pressureDelta6h,
    pressureDelta12h,
    isRapidIntensifying:
      (windDelta6h !== null && windDelta6h >= 5 && (pressureDelta6h ?? 0) <= 0) ||
      (windDelta12h !== null && windDelta12h >= 8 && (pressureDelta12h ?? 0) <= 0),
    isWeakening:
      (windDelta6h !== null && windDelta6h <= -5) ||
      (windDelta12h !== null && windDelta12h <= -8) ||
      (pressureDelta12h !== null && pressureDelta12h >= 10)
  };
}

function buildLandfallFeatures(storm: Storm) {
  const path = [storm.position, ...storm.forecast.map((point) => ({ lon: point.lon, lat: point.lat }))];
  const distances = WATCH_POINTS.map((watch) => ({
    name: watch.name,
    distanceKm: Math.min(...path.map((point) => distanceBetweenKm(point, watch)))
  })).sort((a, b) => a.distanceKm - b.distanceKm);
  const nearest = distances[0] ?? null;
  const influenceRadius = Math.max(storm.windRadiiKm.r7 || 0, 260);

  return {
    nearestProvince: nearest?.name ?? null,
    nearestDistanceKm: nearest?.distanceKm ?? null,
    provincesInCorridor: distances.filter((item) => item.distanceKm <= Math.max(influenceRadius, 360)).map((item) => item.name),
    isLandfallPressure: Boolean(nearest && nearest.distanceKm <= Math.max(influenceRadius * 1.2, 420))
  };
}

function chooseArchetype(
  storm: Storm,
  intensity: ReturnType<typeof buildIntensityFeatures>,
  landfall: ReturnType<typeof buildLandfallFeatures>,
  environment: EnvironmentFeatures
): BossArchetype {
  const scores: Record<BossArchetype, number> = {
    "wind-core": scoreWindCore(storm),
    "rain-bulk": scoreRainBulk(environment),
    "giant-radius": clamp((storm.windRadiiKm.r7 || 0) / 70, 0, 9),
    "track-trickster": storm.forecast.length >= 7 ? 3.2 : 1.4,
    "landfall-siege": landfall.isLandfallPressure ? 7 : 0,
    "weak-remnant": isArchived(storm) ? 8 : 0,
    "balanced-threat": 4
  };
  if (intensity.isRapidIntensifying) scores["wind-core"] += 1.5;
  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] as BossArchetype | undefined;
  return winner ?? "balanced-threat";
}

function choosePhase(
  storm: Storm,
  intensity: ReturnType<typeof buildIntensityFeatures>,
  landfall: ReturnType<typeof buildLandfallFeatures>
): BossPhase {
  if (isArchived(storm)) return "archived";
  if (landfall.isLandfallPressure) return "landfall-pressure";
  if (intensity.isRapidIntensifying) return "intensifying";
  if (intensity.isWeakening) return "weakening";
  if (isStrongStorm(storm) && hasMeaningfulIntensitySwing(intensity)) return "restructuring-hint";
  if (storm.maxWind < 24) return "forming";
  return "mature";
}

function chooseSkills(candidates: Array<BossSkill | null>) {
  const sorted = candidates
    .filter((skill): skill is BossSkill => Boolean(skill))
    .sort((a, b) => {
      const evidenceRank = evidenceWeight(b.evidenceLevel) - evidenceWeight(a.evidenceLevel);
      return evidenceRank || b.severity - a.severity || b.confidence - a.confidence;
    });
  const selected = sorted.slice(0, 6);
  const visualHint = sorted.find((skill) => skill.evidenceLevel === "visualHint");
  if (visualHint && !selected.some((skill) => skill.id === visualHint.id) && selected.length >= 6) {
    selected[selected.length - 1] = visualHint;
  }
  return selected;
}

function windPressureCoreSkill(storm: Storm, intensity: ReturnType<typeof buildIntensityFeatures>): BossSkill {
  const severity = clamp(Math.round((storm.maxWind || 0) / 7.5 + Math.max(0, (1000 - (storm.minPressure || 1000)) / 32)), 1, 9);
  const trend = intensity.windDelta6h !== null ? `，近6小时风速变化 ${signed(intensity.windDelta6h)} m/s` : "";
  return {
    id: "wind_pressure_core",
    name: "风压核心",
    category: "wind",
    severity,
    confidence: 0.95,
    evidenceLevel: "confirmed",
    detail: `中心最大风速 ${storm.maxWind || "--"} m/s，中心气压 ${storm.minPressure || "--"} hPa${trend}。`,
    evidence: [evidence("zhejiang-typhoon", "confirmed", ["speed", "pressure", "track"], "路径实况确认当前风速、气压和历史变化。")]
  };
}

function outerRingSkill(storm: Storm): BossSkill | null {
  if (!storm.windRadiiKm.r7 || storm.windRadiiKm.r7 < 220) return null;
  return {
    id: "outer_ring_suppression",
    name: "外环压制",
    category: "wind",
    severity: clamp(Math.round(storm.windRadiiKm.r7 / 70), 2, 9),
    confidence: 0.9,
    evidenceLevel: "confirmed",
    detail: `七级风圈最大半径约 ${storm.windRadiiKm.r7} km，外围风雨影响范围较大。`,
    evidence: [evidence("zhejiang-typhoon", "confirmed", ["radius7"], "七级风圈半径来自公开路径接口。")]
  };
}

function innerWallSkill(storm: Storm): BossSkill | null {
  const core = Math.max(storm.windRadiiKm.r10 || 0, storm.windRadiiKm.r12 || 0);
  if (core < 80) return null;
  return {
    id: "inner_wall",
    name: "强风内核",
    category: "wind",
    severity: clamp(Math.round(core / 38), 2, 9),
    confidence: 0.9,
    evidenceLevel: "confirmed",
    detail: `十级风圈约 ${storm.windRadiiKm.r10 || "--"} km，十二级风圈约 ${storm.windRadiiKm.r12 || "--"} km。`,
    evidence: [evidence("zhejiang-typhoon", "confirmed", ["radius10", "radius12"], "10/12级风圈半径来自公开路径接口。")]
  };
}

function burstSkill(storm: Storm, intensity: ReturnType<typeof buildIntensityFeatures>): BossSkill | null {
  if (!intensity.isRapidIntensifying) return null;
  return {
    id: "burst_intensification",
    name: "爆发强化",
    category: "wind",
    severity: clamp(Math.round(Math.max(intensity.windDelta6h ?? 0, intensity.windDelta12h ?? 0) / 2), 4, 9),
    confidence: 0.82,
    evidenceLevel: "confirmed",
    detail: `历史路径显示风速快速上升，近6小时 ${signed(intensity.windDelta6h)} m/s，近12小时 ${signed(intensity.windDelta12h)} m/s。`,
    evidence: [evidence("zhejiang-typhoon", "confirmed", ["track.speed", "track.pressure"], "历史点差分显示增强趋势。")]
  };
}

function weakeningSkill(storm: Storm, intensity: ReturnType<typeof buildIntensityFeatures>): BossSkill | null {
  if (!intensity.isWeakening) return null;
  return {
    id: "weakening_break",
    name: "强度破防",
    category: "wind",
    severity: clamp(Math.round(Math.abs(intensity.windDelta12h ?? intensity.windDelta6h ?? 5) / 2), 3, 8),
    confidence: 0.82,
    evidenceLevel: "confirmed",
    detail: `历史路径显示强度回落，近6小时风速 ${signed(intensity.windDelta6h)} m/s，气压 ${signed(intensity.pressureDelta6h)} hPa。`,
    evidence: [evidence("zhejiang-typhoon", "confirmed", ["track.speed", "track.pressure"], "历史点差分显示减弱趋势。")]
  };
}

function suddenDashSkill(storm: Storm): BossSkill | null {
  if (!storm.moveSpeed || storm.moveSpeed < 30) return null;
  return {
    id: "sudden_dash",
    name: "急行突袭",
    category: "track",
    severity: clamp(Math.round(storm.moveSpeed / 5), 4, 9),
    confidence: 0.9,
    evidenceLevel: "confirmed",
    detail: `当前向${storm.moveDirection || "未知方向"}移动，速度约 ${storm.moveSpeed} km/h，路径变化需要高频关注。`,
    evidence: [evidence("zhejiang-typhoon", "confirmed", ["movespeed", "movedirection"], "移动方向和速度来自公开路径接口。")]
  };
}

function coastalSiegeSkill(storm: Storm, landfall: ReturnType<typeof buildLandfallFeatures>): BossSkill | null {
  if (!landfall.isLandfallPressure || !landfall.nearestProvince) return null;
  return {
    id: "coastal_siege",
    name: "沿海压迫",
    category: "landfall",
    severity: clamp(Math.round(9 - (landfall.nearestDistanceKm ?? 900) / 95), 3, 9),
    confidence: 0.78,
    evidenceLevel: "inferred",
    detail: `未来路径走廊靠近${landfall.nearestProvince}，最近估算距离约 ${Math.round(landfall.nearestDistanceKm ?? 0)} km。`,
    evidence: [
      evidence("zhejiang-typhoon", "confirmed", ["forecast", "position"], "路径和预报点来自公开路径接口。"),
      evidence("zhejiang-typhoon", "inferred", ["province-distance"], "省份压迫由路径走廊和省份参考点计算。")
    ]
  };
}

function moistureDevourSkill(environment: EnvironmentFeatures): BossSkill | null {
  if (environment.status !== "available" || !environment.isMoistureLoaded) return null;
  const tcwv = environment.maxTcwvKgM2 ?? environment.meanTcwvKgM2 ?? 0;
  const humidity = environment.meanHumidityPct ?? 0;
  return {
    id: "moisture_devour",
    name: "水汽吞噬",
    category: "rain",
    severity: clamp(Math.round(tcwv / 9 + Math.max(0, humidity - 75) / 8), 3, 9),
    confidence: 0.62,
    evidenceLevel: "inferred",
    detail: `环境采样显示整层水汽最高约 ${formatNumber(environment.maxTcwvKgM2, 1)} kg/m2，平均湿度约 ${formatNumber(environment.meanHumidityPct, 0)}%，强降雨潜势偏高。`,
    evidence: [
      evidence(
        "open-meteo",
        "inferred",
        ["total_column_integrated_water_vapour", "relative_humidity_2m", "cloud_cover"],
        "Open-Meteo 环境场显示水汽和湿度偏高，属于模型推断。"
      )
    ]
  };
}

function rainCurtainDomainSkill(environment: EnvironmentFeatures): BossSkill | null {
  if (environment.status !== "available" || !environment.isRainThreat) return null;
  return {
    id: "rain_curtain_domain",
    name: "雨幕领域",
    category: "rain",
    severity: clamp(Math.round((environment.maxPrecipMm ?? 0) * 1.5 + (environment.meanCloudCoverPct ?? 0) / 18), 3, 9),
    confidence: 0.62,
    evidenceLevel: "inferred",
    detail: `路径采样最大逐小时降水约 ${formatNumber(environment.maxPrecipMm, 1)} mm，平均云量约 ${formatNumber(environment.meanCloudCoverPct, 0)}%。`,
    evidence: [
      evidence(
        "open-meteo",
        "inferred",
        ["precipitation", "cloud_cover", "relative_humidity_2m"],
        "Open-Meteo 降水、云量和湿度共同用于雨幕推断。"
      )
    ]
  };
}

function convectiveChargeSkill(environment: EnvironmentFeatures): BossSkill | null {
  if (environment.status !== "available" || !environment.isConvective) return null;
  return {
    id: "convective_charge",
    name: "对流充能",
    category: "environment",
    severity: clamp(Math.round((environment.maxCapeJkg ?? 0) / 360), 3, 9),
    confidence: 0.62,
    evidenceLevel: "inferred",
    detail: `环境 CAPE 最高约 ${formatNumber(environment.maxCapeJkg, 0)} J/kg，水汽条件支持强对流发展。`,
    evidence: [
      evidence("open-meteo", "inferred", ["cape", "relative_humidity_2m"], "Open-Meteo CAPE 与湿度用于对流潜势推断。")
    ]
  };
}

function stallingDrainSkill(storm: Storm, environment: EnvironmentFeatures): BossSkill | null {
  if (environment.status !== "available" || storm.moveSpeed <= 0 || storm.moveSpeed > 10) return null;
  if (!environment.isMoistureLoaded && !environment.isRainThreat) return null;
  return {
    id: "stalling_drain",
    name: "滞留消耗",
    category: "track",
    severity: clamp(Math.round(8 - storm.moveSpeed / 2 + (environment.maxPrecipMm ?? 0)), 4, 9),
    confidence: 0.66,
    evidenceLevel: "inferred",
    detail: `移动速度约 ${storm.moveSpeed} km/h，叠加水汽或降水条件，需关注持续影响。`,
    evidence: [
      evidence("zhejiang-typhoon", "confirmed", ["movespeed"], "移动速度来自公开路径接口。"),
      evidence("open-meteo", "inferred", ["precipitation", "total_column_integrated_water_vapour"], "环境水汽/降水来自模型采样。")
    ]
  };
}

function satelliteRainPotentialHintSkill(environment: EnvironmentFeatures, satellite: SatelliteProductsSummary): BossSkill | null {
  if (!hasProduct(satellite, "hrp")) return null;
  if (environment.status === "available" && !environment.isRainThreat && !environment.isMoistureLoaded) return null;
  return {
    id: "satellite_rain_potential_hint",
    name: "雨势卫星提示",
    category: "rain",
    severity: clamp(Math.round((environment.maxPrecipMm ?? 2) + (environment.maxTcwvKgM2 ?? 45) / 14), 3, 7),
    confidence: environment.status === "available" ? 0.75 : 0.45,
    evidenceLevel: "visualHint",
    detail: `Himawari HRP 暴雨潜势产品可用，结合水汽/降水模型只能提示继续观察雨势，不等同官方暴雨预警。`,
    evidence: [
      evidence("jma-himawari", "visualHint", ["hrp"], "Himawari HRP 产品可用，作为暴雨潜势视觉提示。"),
      ...(environment.status === "available"
        ? [evidence("open-meteo", "inferred", ["precipitation", "total_column_integrated_water_vapour"], "Open-Meteo 环境模型与卫星产品方向一致时提高提示置信度。")]
        : [])
    ]
  };
}

function coreRestructureHintSkill(
  storm: Storm,
  intensity: ReturnType<typeof buildIntensityFeatures>,
  satellite: SatelliteProductsSummary
): BossSkill | null {
  if (!isStrongStorm(storm) || !hasMeaningfulIntensitySwing(intensity)) return null;
  if (!hasProduct(satellite, "b13") && !hasProduct(satellite, "b08")) return null;
  return {
    id: "core_restructure_hint",
    name: "核心重构迹象",
    category: "structure",
    severity: 4,
    confidence: 0.45,
    evidenceLevel: "visualHint",
    detail: "强台风阶段出现强度波动，且红外/水汽卫星产品可用；只能提示继续观察核心结构，不自动断言眼壁置换。",
    evidence: [
      evidence("zhejiang-typhoon", "inferred", ["track.speed", "track.pressure"], "强度波动来自历史点差分。"),
      evidence("jma-himawari", "visualHint", ["b13", "b08", "hrp"], "卫星产品只能提供视觉提示，不能自动断言眼壁置换。")
    ]
  };
}

function buildEvents(
  storm: Storm,
  intensity: ReturnType<typeof buildIntensityFeatures>,
  landfall: ReturnType<typeof buildLandfallFeatures>
): BossEvent[] {
  const latestTime = storm.updatedAt || new Date().toISOString();
  const events: BossEvent[] = [];
  if (intensity.isRapidIntensifying) {
    events.push({
      id: "event-intensifying",
      time: latestTime,
      title: "增强记录",
      detail: `近12小时风速变化 ${signed(intensity.windDelta12h)} m/s，气压变化 ${signed(intensity.pressureDelta12h)} hPa。`,
      evidenceLevel: "confirmed"
    });
  }
  if (intensity.isWeakening) {
    events.push({
      id: "event-weakening",
      time: latestTime,
      title: "减弱记录",
      detail: `历史点显示风速或气压已出现回落趋势。`,
      evidenceLevel: "confirmed"
    });
  }
  if (landfall.isLandfallPressure && landfall.nearestProvince) {
    events.push({
      id: "event-landfall-pressure",
      time: latestTime,
      title: "防线压迫",
      detail: `路径走廊靠近${landfall.nearestProvince}，属地预警仍需查看官方发布。`,
      evidenceLevel: "inferred"
    });
  }
  return events.slice(0, 4);
}

function buildEvidenceSummary(
  storm: Storm,
  skills: BossSkill[],
  environment: EnvironmentFeatures,
  satellite: SatelliteProductsSummary
): BossSkillEvidence[] {
  const fields = new Set(skills.flatMap((skill) => skill.evidence.flatMap((item) => item.fields)));
  const summary: BossSkillEvidence[] = [
    evidence(
      "canonical-authority",
      "confirmed",
      ["authority-policy"],
      `${SOURCE_POLICY.canonicalAuthority}作为全国权威口径；当前引擎保留字段校验接口。`
    ),
    evidence(
      "zhejiang-typhoon",
      "confirmed",
      [...fields].slice(0, 8),
      `${SOURCE_POLICY.machineReadableTrackSource}提供${storm.track.length}个历史点和${storm.forecast.length}个预报点。`
    )
  ];
  if (environment.status === "available") {
    summary.push(
      evidence(
        "open-meteo",
        "inferred",
        ["total_column_integrated_water_vapour", "precipitation", "relative_humidity_2m", "cloud_cover", "cape"],
        `Open-Meteo 已完成 ${environment.sampleCount} 个中心/风圈/路径走廊采样点，仅用于环境趋势推断。`
      )
    );
  } else {
    summary.push(evidence("open-meteo", "inferred", [], `Open-Meteo 环境采样不可用：${environment.warnings[0] ?? "未知原因"}`));
  }
  if (satellite.status !== "unavailable") {
    summary.push(
      evidence(
        "jma-himawari",
        "visualHint",
        satellite.availableProducts,
        `Himawari ${satellite.area} 当前可用 ${satellite.availableProducts.length}/${satellite.products.length} 个产品，仅作为卫星视觉提示。`
      )
    );
  } else {
    summary.push(evidence("jma-himawari", "visualHint", [], `Himawari 产品状态不可用：${satellite.warnings[0] ?? "未知原因"}`));
  }
  return summary;
}

function buildRiskSummary(
  storm: Storm,
  archetype: BossArchetype,
  phase: BossPhase,
  landfall: ReturnType<typeof buildLandfallFeatures>,
  environment: EnvironmentFeatures,
  satellite: SatelliteProductsSummary
) {
  const regionText = landfall.provincesInCorridor.length > 0 ? `，路径走廊需关注${landfall.provincesInCorridor.join("、")}` : "";
  const environmentText =
    environment.status === "available" && (environment.isMoistureLoaded || environment.isRainThreat || environment.isConvective)
      ? "，环境模型提示水汽/降水/对流条件存在抬升"
      : "";
  const satelliteText = satellite.status !== "unavailable" ? "，卫星产品已接入视觉提示链路" : "";
  return `${storm.nameZh} 当前为${storm.stage}，Boss 原型判定为${archetypeLabel(archetype)}，阶段为${phaseLabel(phase)}${regionText}${environmentText}${satelliteText}。真实预警以中央气象台和属地气象应急部门为准。`;
}

function buildEnvironmentSummary(environment: EnvironmentFeatures) {
  return {
    source: "open-meteo" as const,
    status: environment.status,
    updatedAt: environment.updatedAt,
    sampleCount: environment.sampleCount,
    maxTcwvKgM2: environment.maxTcwvKgM2,
    maxPrecipMm: environment.maxPrecipMm,
    maxCapeJkg: environment.maxCapeJkg,
    warnings: environment.warnings
  };
}

function buildSatelliteSummary(satellite: SatelliteProductsSummary) {
  return {
    source: "jma-himawari" as const,
    status: satellite.status,
    updatedAt: satellite.updatedAt,
    area: satellite.area,
    availableProducts: satellite.availableProducts,
    products: satellite.products.map((product) => ({
      product: product.product,
      status: product.status,
      imageUrl: product.imageUrl,
      label: product.label,
      use: product.use
    })),
    warnings: satellite.warnings
  };
}

function calculateBossEnergy(storm: Storm) {
  const windScore = clamp(((storm.maxWind || 0) / 70) * 48, 0, 48);
  const pressureScore = storm.minPressure ? clamp(((1010 - storm.minPressure) / 120) * 30, 0, 30) : 0;
  const radiusScore = clamp(((storm.windRadiiKm.r7 || 0) / 650) * 22, 0, 22);
  return Math.round(clamp(windScore + pressureScore + radiusScore, 0, 100));
}

function scoreWindCore(storm: Storm) {
  return clamp((storm.maxWind || 0) / 7.5 + (storm.minPressure ? (1000 - storm.minPressure) / 30 : 0), 0, 9);
}

function scoreRainBulk(environment: EnvironmentFeatures) {
  if (environment.status !== "available") return 0;
  const moistureScore = clamp(((environment.maxTcwvKgM2 ?? 0) - 40) / 5, 0, 5);
  const rainScore = clamp((environment.maxPrecipMm ?? 0) * 1.2, 0, 4);
  const cloudHumidityScore = clamp(((environment.meanHumidityPct ?? 0) - 76) / 8 + ((environment.meanCloudCoverPct ?? 0) - 55) / 18, 0, 3);
  return clamp(moistureScore + rainScore + cloudHumidityScore, 0, 9);
}

function findPreviousPoint(points: TrackPoint[], latest: TrackPoint | undefined, hours: number) {
  if (!latest) return null;
  const latestTime = new Date(latest.time.replace(" ", "T")).getTime();
  if (!Number.isFinite(latestTime)) return null;
  return (
    points
      .slice()
      .reverse()
      .find((point) => {
        const pointTime = new Date(point.time.replace(" ", "T")).getTime();
        return Number.isFinite(pointTime) && (latestTime - pointTime) / 36e5 >= hours;
      }) ?? null
  );
}

function evidence(
  source: BossSkillEvidence["source"],
  level: BossEvidenceLevel,
  fields: string[],
  summary: string
): BossSkillEvidence {
  return { source, level, fields, summary };
}

function archetypeLabel(value: BossArchetype) {
  const labels: Record<BossArchetype, string> = {
    "wind-core": "风压核心型",
    "rain-bulk": "水汽雨洪型",
    "giant-radius": "巨型风圈型",
    "track-trickster": "路径诡诈型",
    "landfall-siege": "登陆压迫型",
    "weak-remnant": "残血雨带型",
    "balanced-threat": "综合威胁型"
  };
  return labels[value];
}

function phaseLabel(value: BossPhase) {
  const labels: Record<BossPhase, string> = {
    forming: "生成中",
    intensifying: "增强中",
    mature: "成熟体",
    "restructuring-hint": "核心重构迹象",
    "landfall-pressure": "登陆压迫",
    weakening: "减弱中",
    archived: "停编归档"
  };
  return labels[value];
}

function isStrongStorm(storm: Storm) {
  return storm.maxWind >= 42 || String(storm.stage).includes("强") || String(storm.stage).includes("台风");
}

function isArchived(storm: Storm) {
  return String(storm.status).includes("停") || String(storm.status).toLowerCase().includes("inactive");
}

function hasMeaningfulIntensitySwing(intensity: ReturnType<typeof buildIntensityFeatures>) {
  return (
    Math.abs(intensity.windDelta6h ?? 0) >= 3 ||
    Math.abs(intensity.windDelta12h ?? 0) >= 5 ||
    Math.abs(intensity.pressureDelta12h ?? 0) >= 8
  );
}

function hasProduct(satellite: SatelliteProductsSummary, product: "dnc" | "b13" | "b08" | "tre" | "hrp") {
  return satellite.availableProducts.includes(product);
}

function evidenceWeight(level: BossEvidenceLevel) {
  if (level === "confirmed") return 3;
  if (level === "inferred") return 2;
  return 1;
}

function signed(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return value > 0 ? `+${value}` : String(value);
}

function formatNumber(value: number | null, digits: number) {
  if (value === null || !Number.isFinite(value)) return "--";
  return value.toFixed(digits);
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
