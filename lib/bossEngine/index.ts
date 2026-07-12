import type { Storm, TrackPoint } from "@/lib/types";
import { findProvinceAtCoordinate, getProvinceReferencePoints } from "@/lib/provinceGeo";
import { getAhiEvidenceForStorm, type AhiEvidenceSummary } from "./ahiEvidence";
import { sampleBossEnvironment, type EnvironmentFeatures } from "./environmentSampler";
import { getHimawariProductsForStorm, type SatelliteProductsSummary } from "./satelliteProducts";
import { getStormStructureIntelligence } from "./structureIntelligence";
import type {
  BossArchetype,
  BossEvent,
  BossEvidenceLevel,
  BossPhase,
  BossPhaseAxes,
  BossProfile,
  BossSkill,
  BossSkillEvidence,
  BossStructureSummary
} from "./types";

const SOURCE_POLICY = {
  canonicalAuthority: "权威口径以中央气象台 / 国家气象中心和属地气象应急部门为准",
  machineReadableTrackSource: "浙江省水利厅公开台风路径接口",
  regionalWarningAuthority: "国家海洋预报台 / 属地气象台与应急部门",
  structureAnalysisSource: "JTWC结构分析；JAXA / NOAA微波交叉验证待接入"
};

export async function buildBossProfiles(storms: Storm[]): Promise<BossProfile[]> {
  return Promise.all(storms.map((storm) => buildBossProfile(storm)));
}

export async function buildBossProfile(storm: Storm): Promise<BossProfile> {
  const intensity = buildIntensityFeatures(storm);
  const landfall = buildLandfallFeatures(storm);
  const [environment, satellite, ahi, structure] = await Promise.all([
    sampleBossEnvironment(storm),
    getHimawariProductsForStorm(storm),
    getAhiEvidenceForStorm(storm),
    getStormStructureIntelligence(storm)
  ]);
  const archetype = chooseArchetype(storm, intensity, landfall, environment, structure);
  const phase = choosePhase(storm, intensity, landfall, structure);
  const phaseAxes = buildPhaseAxes(storm, intensity, landfall, structure);
  const displayPhaseLabel = structure.state === "unknown" ? phaseLabel(phase) : structure.stateLabel;
  const skills = chooseSkills([
    eyewallTransformationSkill(structure),
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
    coreRestructureHintSkill(storm, intensity, satellite),
    ahiMultibandEvidenceSkill(ahi)
  ]);
  const events = buildEvents(storm, intensity, landfall, structure);
  const energy = calculateBossEnergy(storm);
  const landfallScenarios = buildLandfallScenarios(storm, landfall);

  return {
    stormId: storm.id,
    code: storm.code,
    nameZh: storm.nameZh,
    nameEn: storm.nameEn,
    title: `${storm.nameZh} ${archetypeLabel(archetype)}`,
    subtitle: `${displayPhaseLabel} / ${storm.stage}`,
    archetype,
    archetypeLabel: archetypeLabel(archetype),
    phase,
    phaseLabel: displayPhaseLabel,
    phaseAxes,
    rating: String(storm.rating),
    energy,
    landfall: summarizeLandfall(landfall),
    landfallScenarios,
    riskSummary: buildRiskSummary(storm, archetype, phase, landfall, environment, satellite, structure),
    primarySkillIds: skills.slice(0, 3).map((skill) => skill.id),
    skills,
    events,
    evidenceSummary: buildEvidenceSummary(storm, skills, environment, satellite, ahi, structure),
    environment: buildEnvironmentSummary(environment),
    satellite: buildSatelliteSummary(satellite),
    ahi: buildAhiSummary(ahi),
    structure,
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
  const path = [
    { ...storm.position, time: storm.updatedAt, isForecast: false },
    ...storm.forecast.map((point) => ({ lon: point.lon, lat: point.lat, time: point.time, isForecast: true }))
  ];
  const watchPoints = getProvinceReferencePoints({ coastalOnly: true });
  const distances = watchPoints.map((watch) => ({
    name: watch.shortName,
    distanceKm: Math.min(...path.map((point) => distanceBetweenKm(point, { lon: watch.center[0], lat: watch.center[1] })))
  })).sort((a, b) => a.distanceKm - b.distanceKm);
  const nearest = distances[0] ?? null;
  const influenceRadius = Math.max(storm.windRadiiKm.r7 || 0, 260);
  const currentProvince = findProvinceAtCoordinate(storm.position, { coastalOnly: true });
  let previousProvince = currentProvince;
  let forecastLandfall: { province: string; time: string } | null = null;

  for (const point of storm.forecast) {
    const province = findProvinceAtCoordinate(point, { coastalOnly: true });
    if (!previousProvince && province) {
      forecastLandfall = { province: province.shortName, time: point.time };
      break;
    }
    previousProvince = province;
  }

  return {
    nearestProvince: nearest?.name ?? null,
    nearestDistanceKm: nearest?.distanceKm ?? null,
    provincesInCorridor: distances.filter((item) => item.distanceKm <= Math.max(influenceRadius, 360)).map((item) => item.name),
    isLandfallPressure: Boolean(nearest && nearest.distanceKm <= Math.max(influenceRadius * 1.2, 420)),
    currentProvince: currentProvince?.shortName ?? null,
    forecastLandfallProvince: forecastLandfall?.province ?? null,
    forecastLandfallAt: forecastLandfall?.time ?? null,
    provinceDistances: distances
  };
}

function summarizeLandfall(landfall: ReturnType<typeof buildLandfallFeatures>) {
  if (landfall.currentProvince) {
    return {
      status: "overland" as const,
      targetProvince: landfall.currentProvince,
      estimatedAt: null,
      nearestDistanceKm: 0,
      evidenceLevel: "inferred" as const,
      detail: `中心位置已进入${landfall.currentProvince}行政范围，是否正式登陆仍以气象部门通报为准。`
    };
  }
  if (landfall.forecastLandfallProvince && landfall.forecastLandfallAt) {
    return {
      status: "forecast-landfall" as const,
      targetProvince: landfall.forecastLandfallProvince,
      estimatedAt: landfall.forecastLandfallAt,
      nearestDistanceKm: landfall.nearestDistanceKm,
      evidenceLevel: "inferred" as const,
      detail: `主预报路径首个进入陆地区域的点位于${landfall.forecastLandfallProvince}，时次为${landfall.forecastLandfallAt}。`
    };
  }
  if (landfall.isLandfallPressure && landfall.nearestProvince) {
    return {
      status: "approaching" as const,
      targetProvince: landfall.nearestProvince,
      estimatedAt: null,
      nearestDistanceKm: landfall.nearestDistanceKm,
      evidenceLevel: "inferred" as const,
      detail: `未来路径走廊靠近${landfall.nearestProvince}，尚无可明确标注的登陆时次。`
    };
  }
  return {
    status: "open-ocean" as const,
    targetProvince: null,
    estimatedAt: null,
    nearestDistanceKm: landfall.nearestDistanceKm,
    evidenceLevel: "inferred" as const,
    detail: "当前主预报路径没有给出明确的沿海登陆点。"
  };
}

function buildLandfallScenarios(storm: Storm, landfall: ReturnType<typeof buildLandfallFeatures>) {
  const sourceScenarios = storm.forecastScenarios.length > 0
    ? storm.forecastScenarios
    : storm.forecast.length > 0
      ? [{ id: `${storm.id}-primary`, agency: "中国", agencyCode: "CMA", points: storm.forecast, isPrimary: true }]
      : [];
  const coastalProvinces = getProvinceReferencePoints({ coastalOnly: true });
  const agencyTotal = Math.max(1, sourceScenarios.length);
  const aggregates = new Map<string, {
    province: string;
    score: number;
    timeWeightedMs: number;
    timeWeight: number;
    windWeighted: number;
    windWeight: number;
    directHits: number;
    agencies: Set<string>;
  }>();

  const addCandidate = ({
    province,
    score,
    point,
    agencyCode,
    direct
  }: {
    province: string;
    score: number;
    point?: TrackPoint | null;
    agencyCode?: string | null;
    direct?: boolean;
  }) => {
    if (!Number.isFinite(score) || score <= 0) return;
    const current = aggregates.get(province) ?? {
      province,
      score: 0,
      timeWeightedMs: 0,
      timeWeight: 0,
      windWeighted: 0,
      windWeight: 0,
      directHits: 0,
      agencies: new Set<string>()
    };
    current.score += score;
    if (agencyCode) current.agencies.add(agencyCode);
    if (direct) current.directHits += 1;
    if (point) {
      const pointTime = parseStormTime(point.time);
      if (pointTime !== null) {
        current.timeWeightedMs += pointTime * score;
        current.timeWeight += score;
      }
      if (Number.isFinite(point.wind) && point.wind > 0) {
        current.windWeighted += point.wind * score;
        current.windWeight += score;
      }
    }
    aggregates.set(province, current);
  };

  if (landfall.currentProvince) {
    addCandidate({
      province: landfall.currentProvince,
      score: 4,
      point: { ...storm.position, time: storm.updatedAt, wind: storm.maxWind, pressure: storm.minPressure },
      agencyCode: "OBS",
      direct: true
    });
  }

  sourceScenarios.forEach((scenario) => {
    const points = scenario.points.filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat));
    if (points.length === 0) return;
    const directPoint = points.find((point) => findProvinceAtCoordinate(point, { coastalOnly: true }));
    const scenarioWeight = scenario.isPrimary ? 1.35 : 1;

    if (directPoint) {
      const province = findProvinceAtCoordinate(directPoint, { coastalOnly: true });
      if (!province) return;
      const pointConfidence = clamp((directPoint.probability || 65) / 100, 0.4, 1);
      addCandidate({
        province: province.shortName,
        score: scenarioWeight * pointConfidence,
        point: directPoint,
        agencyCode: scenario.agencyCode,
        direct: true
      });
      return;
    }

    const nearest = coastalProvinces
      .map((province) => {
        const point = points.reduce((best, candidate) => {
          const candidateDistance = distanceBetweenKm(candidate, { lon: province.center[0], lat: province.center[1] });
          return candidateDistance < best.distanceKm ? { point: candidate, distanceKm: candidateDistance } : best;
        }, { point: points[0], distanceKm: Number.POSITIVE_INFINITY });
        return { province, ...point };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];
    const corridorLimitKm = Math.max((storm.windRadiiKm.r7 || 0) * 1.3, 520);
    if (!nearest || nearest.distanceKm > corridorLimitKm) return;
    addCandidate({
      province: nearest.province.shortName,
      score: scenarioWeight * Math.exp(-nearest.distanceKm / 300) * 0.62,
      point: nearest.point,
      agencyCode: scenario.agencyCode,
      direct: false
    });
  });

  landfall.provinceDistances.slice(0, 5).forEach((candidate, index) => {
    if (aggregates.size >= 3 && aggregates.has(candidate.name)) return;
    const province = coastalProvinces.find((item) => item.shortName === candidate.name);
    const closestPoint = province && storm.forecast.length > 0
      ? storm.forecast.reduce((best, point) => {
          const distanceKm = distanceBetweenKm(point, { lon: province.center[0], lat: province.center[1] });
          return distanceKm < best.distanceKm ? { point, distanceKm } : best;
        }, { point: storm.forecast[0], distanceKm: Number.POSITIVE_INFINITY }).point
      : storm.forecast[0] ?? null;
    addCandidate({
      province: candidate.name,
      score: Math.exp(-candidate.distanceKm / 340) * (0.24 - index * 0.025),
      point: closestPoint,
      direct: false
    });
  });

  const ranked = [...aggregates.values()]
    .map((item) => ({ ...item, calibratedScore: Math.pow(item.score, 0.72) }))
    .sort((a, b) => b.calibratedScore - a.calibratedScore)
    .slice(0, 3);
  const totalScore = ranked.reduce((sum, item) => sum + item.calibratedScore, 0);
  if (ranked.length === 0 || totalScore <= 0) return [];
  const probabilities = ranked.map((item) => Math.max(1, Math.round((item.calibratedScore / totalScore) * 100)));
  probabilities[0] += 100 - probabilities.reduce((sum, value) => sum + value, 0);

  return ranked.map((item, index) => {
    const windSpeedMs = item.windWeight > 0 ? Math.round(item.windWeighted / item.windWeight) : null;
    const estimatedTimeMs = item.timeWeight > 0 ? item.timeWeightedMs / item.timeWeight : null;
    return {
      province: item.province,
      probability: probabilities[index],
      estimatedAt: estimatedTimeMs === null ? null : new Date(estimatedTimeMs).toISOString(),
      windSpeedMs,
      windForceLevel: windSpeedMs === null ? "--" : windForceFromSpeed(windSpeedMs),
      agencySupport: item.agencies.size,
      agencyTotal,
      evidenceLevel: "inferred" as const,
      basis: item.directHits > 0
        ? `${item.agencies.size}/${agencyTotal} 家机构路径直接进入该省行政范围。`
        : "根据多机构路径走廊与沿海省份邻近度推算。"
    };
  });
}

function chooseArchetype(
  storm: Storm,
  intensity: ReturnType<typeof buildIntensityFeatures>,
  landfall: ReturnType<typeof buildLandfallFeatures>,
  environment: EnvironmentFeatures,
  structure: BossStructureSummary
): BossArchetype {
  const scores: Record<BossArchetype, number> = {
    "wind-core": scoreWindCore(storm),
    "eyewall-shifter": structure.state === "unknown" || structure.state === "stable-eye" ? 0 : 10.5,
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
  landfall: ReturnType<typeof buildLandfallFeatures>,
  structure: BossStructureSummary
): BossPhase {
  if (isArchived(storm)) return "archived";
  if (structure.state !== "unknown" && structure.state !== "stable-eye") return "restructuring-hint";
  if (landfall.isLandfallPressure) return "landfall-pressure";
  if (intensity.isRapidIntensifying) return "intensifying";
  if (intensity.isWeakening) return "weakening";
  if (isStrongStorm(storm) && hasMeaningfulIntensitySwing(intensity)) return "restructuring-hint";
  if (storm.maxWind < 24) return "forming";
  return "mature";
}

function buildPhaseAxes(
  storm: Storm,
  intensity: ReturnType<typeof buildIntensityFeatures>,
  landfall: ReturnType<typeof buildLandfallFeatures>,
  structure: BossStructureSummary
): BossPhaseAxes {
  const intensityValue = isArchived(storm)
    ? "archived"
    : intensity.isRapidIntensifying
      ? "intensifying"
      : intensity.isWeakening
        ? "weakening"
        : storm.maxWind < 24
          ? "forming"
          : "mature";
  const intensityLabels = {
    forming: "生成中",
    intensifying: "增强中",
    mature: "成熟体",
    weakening: "减弱中",
    archived: "停编归档"
  } as const;
  const threatValue = isArchived(storm) ? "archived" : landfall.isLandfallPressure ? "landfall-pressure" : "open-ocean";
  const threatLabels = {
    "open-ocean": "远洋活动",
    "landfall-pressure": "登陆压迫",
    archived: "威胁解除"
  } as const;

  return {
    intensity: { value: intensityValue, label: intensityLabels[intensityValue] },
    threat: { value: threatValue, label: threatLabels[threatValue] },
    structure: { value: structure.state, label: structure.stateLabel }
  };
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

function eyewallTransformationSkill(structure: BossStructureSummary): BossSkill | null {
  if (structure.state === "unknown" || structure.state === "stable-eye") return null;
  const severityByState: Partial<Record<BossStructureSummary["state"], number>> = {
    "secondary-ring-forming": 7,
    "replacement-active": 9,
    "replacement-stalled": 8,
    "replacement-completed": 7,
    "replacement-collapsed": 6
  };
  const nameByState: Partial<Record<BossStructureSummary["state"], string>> = {
    "secondary-ring-forming": "二重眼墙生成",
    "replacement-active": "眼壁蜕变",
    "replacement-stalled": "蜕变受阻",
    "replacement-completed": "外环继位",
    "replacement-collapsed": "外环崩解"
  };
  return {
    id: `core_structure_${structure.state}`,
    name: nameByState[structure.state] ?? "内核结构变化",
    category: "structure",
    severity: severityByState[structure.state] ?? 5,
    confidence: structure.confidence,
    evidenceLevel: structure.evidenceLevel,
    detail: `${structure.cycleLabel}。${structure.detail}`,
    evidence: [
      evidence(
        "jtwc",
        structure.evidenceLevel,
        ["innerEyewall", "outerEyewall", "replacementState", "windRingRadius"],
        `${structure.sourceLabel} ${structure.bulletinId ?? "current"} 归一化为 ${structure.stateLabel}。`
      )
    ]
  };
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

function ahiMultibandEvidenceSkill(ahi: AhiEvidenceSummary): BossSkill | null {
  if (ahi.status === "unavailable" || ahi.availableBands.length === 0) return null;
  const hasCoreBand = ahi.availableBands.includes("B13");
  const hasMoistureBand = ahi.availableBands.includes("B08");
  if (!hasCoreBand && !hasMoistureBand) return null;
  return {
    id: "ahi_multiband_evidence",
    name: "AHI 多波段证据",
    category: "structure",
    severity: hasCoreBand && hasMoistureBand ? 5 : 3,
    confidence: 0.42,
    evidenceLevel: "visualHint",
    detail: `Himawari-9 AHI ${ahi.slot ?? "--"} 时次可用 ${ahi.availableBands.join("/")} 波段，仅作为云顶冷却、水汽外流和结构观察证据，不替代官方台风强度。`,
    evidence: [
      evidence(
        "noaa-himawari-ahi",
        "visualHint",
        ahi.availableBands.map((band) => `AHI:${band}`),
        "NOAA Open Data Himawari-9 AHI L1b metadata confirms raw multispectral files are available for satellite evidence."
      )
    ]
  };
}

function buildEvents(
  storm: Storm,
  intensity: ReturnType<typeof buildIntensityFeatures>,
  landfall: ReturnType<typeof buildLandfallFeatures>,
  structure: BossStructureSummary
): BossEvent[] {
  const latestTime = storm.updatedAt || new Date().toISOString();
  const events: BossEvent[] = [];
  if (structure.state !== "unknown" && structure.state !== "stable-eye") {
    const structureTitles: Partial<Record<BossStructureSummary["state"], string>> = {
      "secondary-ring-forming": "二重眼墙生成",
      "replacement-active": "眼壁置换进行中",
      "replacement-stalled": "眼壁蜕变受阻",
      "replacement-completed": "外环继位完成",
      "replacement-collapsed": "置换结构崩解"
    };
    events.push({
      id: `event-structure-${structure.bulletinId ?? structure.observedAt}-${structure.state}`,
      time: structure.observedAt,
      title: structureTitles[structure.state] ?? structure.stateLabel,
      detail: `${structure.cycleLabel} / ${structure.detail}`,
      evidenceLevel: structure.evidenceLevel,
      category: "structure",
      sourceLabel: structure.sourceLabel
    });
  }
  if (intensity.isRapidIntensifying) {
    events.push({
      id: "event-intensifying",
      time: latestTime,
      title: "增强记录",
      detail: `近12小时风速变化 ${signed(intensity.windDelta12h)} m/s，气压变化 ${signed(intensity.pressureDelta12h)} hPa。`,
      evidenceLevel: "confirmed",
      category: "intensity"
    });
  }
  if (intensity.isWeakening) {
    events.push({
      id: "event-weakening",
      time: latestTime,
      title: "减弱记录",
      detail: `历史点显示风速或气压已出现回落趋势。`,
      evidenceLevel: "confirmed",
      category: "intensity"
    });
  }
  if (landfall.isLandfallPressure && landfall.nearestProvince) {
    events.push({
      id: "event-landfall-pressure",
      time: latestTime,
      title: "防线压迫",
      detail: `路径走廊靠近${landfall.nearestProvince}，属地预警仍需查看官方发布。`,
      evidenceLevel: "inferred",
      category: "landfall"
    });
  }
  return events.slice(0, 4);
}

function buildEvidenceSummary(
  storm: Storm,
  skills: BossSkill[],
  environment: EnvironmentFeatures,
  satellite: SatelliteProductsSummary,
  ahi: AhiEvidenceSummary,
  structure: BossStructureSummary
): BossSkillEvidence[] {
  const fields = new Set(skills.flatMap((skill) => skill.evidence.flatMap((item) => item.fields)));
  const summary: BossSkillEvidence[] = [
    evidence(
      "canonical-authority",
      "confirmed",
      ["authority-policy"],
      `${SOURCE_POLICY.canonicalAuthority}；当前引擎只用机器可读路径源生成 Boss 技能。`
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
  if (ahi.status !== "unavailable") {
    summary.push(
      evidence(
        "noaa-himawari-ahi",
        "visualHint",
        ahi.availableBands.map((band) => `AHI:${band}`),
        `Himawari-9 AHI ${ahi.slot ?? "--"} raw L1b metadata is available for ${ahi.availableBands.length}/${ahi.bands.length} evidence bands; raw files are not interpreted as official warnings.`
      )
    );
  } else {
    summary.push(evidence("noaa-himawari-ahi", "visualHint", [], `Himawari-9 AHI metadata unavailable: ${ahi.warnings[0] ?? "unknown reason"}`));
  }
  if (structure.state !== "unknown") {
    summary.push(
      evidence(
        "jtwc",
        structure.evidenceLevel,
        ["coreStructure", "eyewallReplacement", "bulletin"],
        `${structure.sourceLabel} ${structure.bulletinId ?? "current"}：${structure.stateLabel}。`
      )
    );
  }
  return summary;
}

function buildRiskSummary(
  storm: Storm,
  archetype: BossArchetype,
  phase: BossPhase,
  landfall: ReturnType<typeof buildLandfallFeatures>,
  environment: EnvironmentFeatures,
  satellite: SatelliteProductsSummary,
  structure: BossStructureSummary
) {
  const regionText = landfall.provincesInCorridor.length > 0 ? `，路径走廊需关注${landfall.provincesInCorridor.join("、")}` : "";
  const environmentText =
    environment.status === "available" && (environment.isMoistureLoaded || environment.isRainThreat || environment.isConvective)
      ? "，环境模型提示水汽/降水/对流条件存在抬升"
      : "";
  const satelliteText = satellite.status !== "unavailable" ? "，卫星产品已接入视觉提示链路" : "";
  const structureText = structure.state !== "unknown" ? `，内核结构为${structure.stateLabel}` : "";
  return `${storm.nameZh} 当前为${storm.stage}，Boss 原型判定为${archetypeLabel(archetype)}，阶段为${phaseLabel(phase)}${structureText}${regionText}${environmentText}${satelliteText}。真实预警以中央气象台和属地气象应急部门为准。`;
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

function buildAhiSummary(ahi: AhiEvidenceSummary) {
  return {
    source: ahi.source,
    status: ahi.status,
    sensor: ahi.sensor,
    dataset: ahi.dataset,
    bucket: ahi.bucket,
    slot: ahi.slot,
    updatedAt: ahi.updatedAt,
    availableBands: ahi.availableBands,
    bands: ahi.bands.map((band) => ({
      band: band.band,
      label: band.label,
      use: band.use,
      resolution: band.resolution,
      status: band.status,
      segmentCount: band.segmentCount,
      sampleKey: band.sampleKey,
      sampleUrl: band.sampleUrl
    })),
    attribution: ahi.attribution,
    warnings: ahi.warnings
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
    "eyewall-shifter": "眼壁蜕变型",
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

function parseStormTime(value: string) {
  const time = new Date(value.includes("T") ? value : value.replace(" ", "T")).getTime();
  return Number.isFinite(time) ? time : null;
}

function windForceFromSpeed(speed: number) {
  const thresholds = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37, 41.5, 46.2, 51, 56.1, 61.3];
  const level = thresholds.findIndex((threshold) => speed < threshold);
  return level === -1 ? "17+" : String(level);
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
