import type { SatelliteLayerPayload, Storm } from "@/lib/types";
import type { BossAhiSummary } from "@/lib/bossEngine/types";

const INTERNAL_SIZE = 336;
const TWO_PI = Math.PI * 2;

interface StormVisualOptions {
  satelliteLayer?: SatelliteLayerPayload | null;
  ahi?: BossAhiSummary | null;
}

interface RenderMetrics {
  intensity: number;
  compactness: number;
  pressureSignal: number;
  eyeStrength: number;
  eyeRadius: number;
  eyeOffsetX: number;
  eyeOffsetY: number;
  spiralTightness: number;
  shearAngle: number;
  drySlotAngle: number;
  asymmetry: number;
  ahiColdCore: number;
  ahiMoistureOutflow: number;
  ahiVisibleTexture: number;
  ahiCompleteness: number;
  cloudRelief: number;
  towerSignal: number;
  feederReach: number;
  seed: number;
}

export function createStormVisualCanvas(storm: Storm, options: StormVisualOptions = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "storm-satellite-core-canvas";
  canvas.width = INTERNAL_SIZE;
  canvas.height = INTERNAL_SIZE;
  canvas.setAttribute("aria-hidden", "true");

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return canvas;

  const metrics = stormRenderMetrics(storm, options.ahi);
  let satelliteTexture: HTMLCanvasElement | null = null;
  let disposed = false;
  canvas.dataset.renderer = "static-texture-gpu-transform";

  const render = (timeMs: number) => {
    const phase = (timeMs / 1000) * (0.14 + metrics.intensity * 0.18);
    drawProceduralStorm(context, storm, metrics, phase);
    if (satelliteTexture) {
      drawSatelliteTexture(context, satelliteTexture, metrics, phase);
    }
  };

  render(0);
  if (options.satelliteLayer?.status === "available" && options.satelliteLayer.imageUrl) {
    void buildSatelliteTexture(storm, metrics, options.satelliteLayer).then((texture) => {
      if (!texture || disposed || !canvas.isConnected) return;
      satelliteTexture = texture;
      render(performance.now());
    });
  }

  canvas.addEventListener("storm-visual-dispose", () => {
    disposed = true;
    satelliteTexture = null;
  }, { once: true });
  return canvas;
}

function stormRenderMetrics(storm: Storm, ahi?: BossAhiSummary | null): RenderMetrics {
  const ahiProfile = ahiVisualProfile(ahi);
  const intensity = clamp((storm.maxWind - 17) / 55, 0.22, 1);
  const pressureSignal = clamp((1005 - storm.minPressure) / 95, 0.18, 1);
  const compactness = clamp(
    (storm.windRadiiKm.r12 || storm.windRadiiKm.r10 || 80) / Math.max(storm.windRadiiKm.r7 || 240, 1) + ahiProfile.coldCore * 0.06,
    0.16,
    0.88
  );
  const windEyeSignal = clamp((storm.maxWind - 34) / 24, 0, 1);
  const pressureEyeSignal = clamp((995 - storm.minPressure) / 62, 0, 1);
  const eyeStrength = clamp(windEyeSignal * 0.55 + pressureEyeSignal * 0.45, 0, 1) * clamp((windEyeSignal + pressureEyeSignal) / 1.4, 0, 1);
  const eyeRadius = 0.035 + (1 - compactness) * 0.025 + eyeStrength * 0.028;
  const shearAngle = stormMotionAngle(storm);
  const seed = hashStormSeed(`${storm.id}:${storm.updatedAt}:${storm.maxWind}:${storm.minPressure}:${ahi?.slot ?? "no-ahi"}`);
  const phase = (seed % 6283) / 1000;
  const speedSignal = clamp((storm.moveSpeed || 0) / 42, 0, 1);
  // The map marker, local eyewall analysis and satellite crop all use the
  // official track centre.  Keep the rendered eye on that same coordinate;
  // a decorative offset makes a correctly located wind vortex look wrong.
  const eyeOffset = 0;
  return {
    intensity,
    compactness,
    pressureSignal,
    eyeStrength,
    eyeRadius,
    eyeOffsetX: Math.cos(shearAngle + phase * 0.31) * eyeOffset,
    eyeOffsetY: Math.sin(shearAngle + phase * 0.31) * eyeOffset,
    spiralTightness: 5.2 + intensity * 2.45 + compactness * 1.1 + ahiProfile.coldCore * 0.7,
    shearAngle,
    drySlotAngle: shearAngle + Math.PI * (0.76 + ((seed >> 4) % 90) / 100) - ahiProfile.moistureOutflow * 0.22,
    asymmetry: 0.16 + speedSignal * 0.18 + (1 - compactness) * 0.16 + ahiProfile.moistureOutflow * 0.12,
    ahiColdCore: ahiProfile.coldCore,
    ahiMoistureOutflow: ahiProfile.moistureOutflow,
    ahiVisibleTexture: ahiProfile.visibleTexture,
    ahiCompleteness: ahiProfile.completeness,
    cloudRelief: clamp(0.46 + intensity * 0.24 + pressureSignal * 0.22 + ahiProfile.coldCore * 0.22, 0.42, 1),
    towerSignal: clamp(eyeStrength * 0.36 + intensity * 0.24 + ahiProfile.coldCore * 0.34, 0.12, 1),
    feederReach: clamp(0.62 + (storm.windRadiiKm.r7 || 260) / 920 + ahiProfile.moistureOutflow * 0.16, 0.7, 1.12),
    seed
  };
}

function ahiVisualProfile(ahi?: BossAhiSummary | null) {
  if (!ahi || ahi.status === "unavailable") {
    return {
      coldCore: 0,
      moistureOutflow: 0,
      visibleTexture: 0,
      completeness: 0
    };
  }

  const completeness = clamp(
    ahi.bands.reduce((sum, band) => sum + clamp(band.segmentCount / 10, 0, 1), 0) / Math.max(ahi.bands.length, 1),
    0,
    1
  );
  const freshness = ahi.slot ? ahiFreshness(ahi.slot) : 0.45;
  const quality = clamp((ahi.status === "available" ? 1 : 0.72) * (0.58 + completeness * 0.42) * freshness, 0, 1);

  return {
    coldCore: bandSignal(ahi, "B13") * quality,
    moistureOutflow: bandSignal(ahi, "B08") * quality,
    visibleTexture: bandSignal(ahi, "B03") * quality,
    completeness
  };
}

function bandSignal(ahi: BossAhiSummary, bandId: BossAhiSummary["availableBands"][number]) {
  const band = ahi.bands.find((item) => item.band === bandId);
  if (!band || band.status !== "available") return 0;
  return clamp(0.35 + band.segmentCount / 10, 0, 1);
}

function ahiFreshness(slot: string) {
  const parts = /^(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})(\d{2})$/.exec(slot);
  if (!parts) return 0.6;
  const time = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]), Number(parts[5]));
  if (!Number.isFinite(time)) return 0.6;
  const ageMinutes = Math.max(0, (Date.now() - time) / 60000);
  return clamp(1 - Math.max(0, ageMinutes - 40) / 160, 0.35, 1);
}

function drawProceduralStorm(context: CanvasRenderingContext2D, storm: Storm, metrics: RenderMetrics, phase = 0) {
  const image = context.createImageData(INTERNAL_SIZE, INTERNAL_SIZE);
  const pixels = image.data;
  const pixelCount = INTERNAL_SIZE * INTERNAL_SIZE;
  const densityField = new Float32Array(pixelCount);
  const coldField = new Float32Array(pixelCount);
  const vaporField = new Float32Array(pixelCount);
  const glintField = new Float32Array(pixelCount);
  const eyeField = new Float32Array(pixelCount);
  const seed = metrics.seed;
  const motionCos = Math.cos(metrics.shearAngle);
  const motionSin = Math.sin(metrics.shearAngle);
  const flowX = Math.cos(metrics.shearAngle + Math.PI * 0.48) * phase;
  const flowY = Math.sin(metrics.shearAngle + Math.PI * 0.48) * phase;

  for (let y = 0; y < INTERNAL_SIZE; y += 1) {
    for (let x = 0; x < INTERNAL_SIZE; x += 1) {
      const pixelIndex = y * INTERNAL_SIZE + x;
      const nx = (x + 0.5 - INTERNAL_SIZE * 0.5) / (INTERNAL_SIZE * 0.5);
      const ny = (y + 0.5 - INTERNAL_SIZE * 0.5) / (INTERNAL_SIZE * 0.5);
      const radius = Math.sqrt(nx * nx + ny * ny);
      const angle = Math.atan2(ny, nx);
      if (radius > 1.02) continue;

      const alongMotion = nx * motionCos + ny * motionSin;
      const acrossMotion = -nx * motionSin + ny * motionCos;
      const coarse = fbm(nx * 2.1 + flowX * 0.16, ny * 2.1 + flowY * 0.16, seed);
      const cellular = fbm(nx * 5.8 + 19.1 - flowY * 0.28, ny * 5.8 - 7.4 + flowX * 0.28, seed + 131);
      const filament = fbm(nx * 11.5 - 3.2 + phase * 0.46, ny * 11.5 + 5.7 - phase * 0.32, seed + 977);
      const ahiFilament = fbm(nx * 18.0 + phase * 0.22, ny * 18.0 - phase * 0.19, seed + 2213);
      const radialJitter =
        Math.sin(angle * 5.3 + coarse * 5.7 + seed * 0.003) * 0.024 +
        Math.sin(angle * 11.0 + filament * 4.0 - phase * 0.25) * 0.012 * metrics.ahiVisibleTexture;
      const shearStretch = 1 + alongMotion * metrics.asymmetry * 0.26 - Math.abs(acrossMotion) * metrics.asymmetry * 0.08;
      const warp = (coarse - 0.5) * 0.18 + (cellular - 0.5) * 0.11 + radialJitter;
      const warpedRadius = (radius + warp * smoothstep(0.1, 0.94, radius)) * shearStretch;
      const spiral = angle + warpedRadius * metrics.spiralTightness - metrics.shearAngle * 0.52 + coarse * 0.58 + phase * 0.72;
      const drySlot = Math.pow((Math.cos(angle - metrics.drySlotAngle - phase * 0.16) + 1) * 0.5, 7.5) * smoothstep(0.19, 0.72, warpedRadius);

      const innerEnvelope = smoothstep(0.04, 0.14, warpedRadius);
      const organicBoundary = clamp(
        0.82 +
          (coarse - 0.5) * 0.16 +
          (cellular - 0.5) * 0.08 +
          Math.sin(angle * 5.0 + seed * 0.004) * 0.032 +
          alongMotion * metrics.asymmetry * 0.04,
        0.7,
        0.93
      );
      const outerEnvelope = 1 - smoothstep(organicBoundary - 0.1, Math.min(0.985, organicBoundary + 0.075), radius);
      const cdo = gaussian(warpedRadius, 0.2 + metrics.compactness * 0.08, 0.14 + metrics.intensity * 0.035);
      const eyeNx = nx - metrics.eyeOffsetX;
      const eyeNy = ny - metrics.eyeOffsetY;
      const eyeRadius = Math.sqrt(eyeNx * eyeNx + eyeNy * eyeNy);
      const eyeAngle = Math.atan2(eyeNy, eyeNx);
      const raggedEyeRadius = metrics.eyeRadius * (2.05 + Math.sin(eyeAngle * 4.0 + coarse * 4.2) * 0.18);
      const eyewallBreaks = 0.66 + Math.pow((Math.cos(eyeAngle * 3.0 + filament * 3.2) + 1) * 0.5, 1.8) * 0.34;
      const eyewall = gaussian(eyeRadius, raggedEyeRadius, 0.013 + metrics.eyeStrength * 0.008) * eyewallBreaks;
      const eyewallMoat = gaussian(warpedRadius, raggedEyeRadius * 2.25 + 0.07, 0.045 + metrics.eyeStrength * 0.018) * (0.15 + metrics.eyeStrength * 0.32);
      const bandA = Math.pow((Math.cos(spiral * 2.0 + filament * 3.2) + 1) * 0.5, 3.5);
      const bandB = Math.pow((Math.cos(spiral * 4.35 - warpedRadius * 3.0 + cellular * 2.8) + 1) * 0.5, 6.8);
      const bandC = Math.pow((Math.cos(spiral * 1.16 + warpedRadius * 8.0 - coarse * 2.1) + 1) * 0.5, 2.8);
      const tailBias = smoothstep(-0.42, 0.86, alongMotion);
      const outerBands = gaussian(warpedRadius, 0.52, 0.23) * (bandA * 0.7 + bandB * 0.42 + bandC * 0.28) * (0.42 + tailBias * 0.72);
      const waterVaporArc =
        Math.pow((Math.cos(spiral * 0.82 - metrics.shearAngle + warpedRadius * 2.4 + coarse * 2.2 - phase * 0.18) + 1) * 0.5, 2.6) *
        gaussian(warpedRadius, 0.74, 0.28) *
        (0.34 + tailBias * 0.74) *
        metrics.ahiMoistureOutflow;
      const feederBands =
        gaussian(warpedRadius, 0.84 * metrics.feederReach, 0.24) *
        (bandB * 0.72 + bandC * 0.44) *
        (0.28 + tailBias * 0.96 + metrics.ahiMoistureOutflow * 0.28);
      const outflowCanopy =
        gaussian(warpedRadius, 0.92, 0.27) *
        Math.pow((Math.cos(angle - metrics.shearAngle * 0.4 + coarse * 3.0 + phase * 0.08) + 1) * 0.5, 2.2) *
        (0.12 + metrics.ahiMoistureOutflow * 0.36);
      const convection = Math.pow(clamp(coarse * 0.52 + cellular * 0.34 + filament * 0.28, 0, 1), 1.25);
      const visibleRaggedness = (ahiFilament - 0.5) * metrics.ahiVisibleTexture * smoothstep(0.18, 0.88, warpedRadius);
      const erosion =
        (0.56 + smoothstep(0.22, 0.82, cellular) * 0.3 + smoothstep(0.44, 0.94, filament + visibleRaggedness) * 0.22) *
        (1 - drySlot * (0.32 + metrics.asymmetry * 0.8 - metrics.ahiMoistureOutflow * 0.18));

      let density = cdo * (0.62 + metrics.intensity * 0.58 + metrics.ahiColdCore * 0.34);
      density += eyewall * (0.86 + metrics.eyeStrength * 0.92 + metrics.ahiColdCore * 0.32);
      density += outerBands * (0.44 + convection * 0.7);
      density += feederBands * (0.24 + convection * 0.64);
      density += waterVaporArc * (0.2 + metrics.ahiCompleteness * 0.34);
      density += outflowCanopy * (0.18 + metrics.ahiCompleteness * 0.22);
      density -= eyewallMoat;
      density *= innerEnvelope * outerEnvelope * erosion;

      const eyeCut = metrics.eyeStrength * (1 - smoothstep(metrics.eyeRadius * 0.72, metrics.eyeRadius * 1.78, eyeRadius));
      density *= 1 - eyeCut * 0.94;
      density = clamp(density, 0, 1);

      densityField[pixelIndex] = density;
      coldField[pixelIndex] = smoothstep(0.48 - metrics.ahiColdCore * 0.08, 0.93, density) * (0.76 + metrics.pressureSignal * 0.48 + metrics.ahiColdCore * 0.34);
      vaporField[pixelIndex] = clamp(waterVaporArc + outflowCanopy * 0.72, 0, 1);
      glintField[pixelIndex] = Math.max(0, ahiFilament - 0.56) * metrics.ahiVisibleTexture * density;
      eyeField[pixelIndex] = eyeCut;
    }
  }

  for (let y = 0; y < INTERNAL_SIZE; y += 1) {
    for (let x = 0; x < INTERNAL_SIZE; x += 1) {
      const pixelIndex = y * INTERNAL_SIZE + x;
      const density = densityField[pixelIndex];
      if (density <= 0.004) continue;

      const index = pixelIndex * 4;
      const nx = (x + 0.5 - INTERNAL_SIZE * 0.5) / (INTERNAL_SIZE * 0.5);
      const ny = (y + 0.5 - INTERNAL_SIZE * 0.5) / (INTERNAL_SIZE * 0.5);
      const left = densityField[pixelIndex - 1] ?? density;
      const right = densityField[pixelIndex + 1] ?? density;
      const up = densityField[pixelIndex - INTERNAL_SIZE] ?? density;
      const down = densityField[pixelIndex + INTERNAL_SIZE] ?? density;
      const relief = clamp((left - right) * 0.52 + (up - down) * 0.92, -0.22, 0.38) * metrics.cloudRelief;
      const coldTop = coldField[pixelIndex];
      const vaporTint = vaporField[pixelIndex];
      const visibleGlint = glintField[pixelIndex];
      const eyeCut = eyeField[pixelIndex];
      const directionalLight = clamp(0.55 - nx * 0.16 - ny * 0.34 + relief * 1.55, 0, 1.18);
      const cloudWallShadow = clamp((density - coldTop * 0.42) * (0.42 - relief), 0, 0.38);
      const alpha = Math.round(clamp(Math.pow(density, 0.74) * (226 + coldTop * 26), 0, 255));

      pixels[index] = Math.round(clamp(128 + coldTop * 118 + directionalLight * 44 - cloudWallShadow * 72 + visibleGlint * 42 - vaporTint * 18 - eyeCut * 20, 0, 255));
      pixels[index + 1] = Math.round(clamp(151 + coldTop * 102 + directionalLight * 39 - cloudWallShadow * 54 + visibleGlint * 36 + vaporTint * 9 - eyeCut * 18, 0, 255));
      pixels[index + 2] = Math.round(clamp(175 + coldTop * 88 + directionalLight * 50 + vaporTint * 64 - cloudWallShadow * 32 + metrics.pressureSignal * 12 - eyeCut * 8, 0, 255));
      pixels[index + 3] = alpha;
    }
  }

  context.clearRect(0, 0, INTERNAL_SIZE, INTERNAL_SIZE);
  context.putImageData(image, 0, 0);
  drawOutflowVeil(context, metrics, phase);
  drawOvershootingTops(context, metrics, phase);
  drawStormEye(context, metrics, phase);
  drawSubtleRadarLock(context, storm, metrics);
}

function drawOutflowVeil(context: CanvasRenderingContext2D, metrics: RenderMetrics, phase = 0) {
  const center = INTERNAL_SIZE * 0.5;
  const alpha = clamp(0.08 + metrics.ahiMoistureOutflow * 0.18 + metrics.intensity * 0.08, 0.08, 0.32);
  context.save();
  context.globalCompositeOperation = "screen";
  context.lineCap = "round";
  context.filter = "blur(0.7px)";
  for (let index = 0; index < 7; index += 1) {
    const radius = INTERNAL_SIZE * (0.23 + index * 0.055 + metrics.feederReach * 0.055);
    const start = metrics.shearAngle - Math.PI * (0.66 + index * 0.035) + phase * 0.025;
    const end = start + Math.PI * (0.7 + metrics.ahiMoistureOutflow * 0.35 + index * 0.025);
    context.globalAlpha = alpha * (1 - index * 0.08);
    context.strokeStyle = index % 2 === 0 ? "rgba(184, 235, 255, 0.72)" : "rgba(255, 255, 255, 0.62)";
    context.lineWidth = Math.max(1, INTERNAL_SIZE * (0.006 + metrics.ahiCompleteness * 0.003));
    context.beginPath();
    context.arc(center, center, radius, start, end);
    context.stroke();
  }
  context.restore();
}

function drawOvershootingTops(context: CanvasRenderingContext2D, metrics: RenderMetrics, phase = 0) {
  const center = INTERNAL_SIZE * 0.5;
  const towerCount = Math.round(12 + metrics.intensity * 10 + metrics.ahiColdCore * 10);
  context.save();
  context.globalCompositeOperation = "screen";
  context.shadowColor = "rgba(180, 235, 255, 0.75)";
  context.shadowBlur = INTERNAL_SIZE * (0.012 + metrics.towerSignal * 0.025);

  for (let index = 0; index < towerCount; index += 1) {
    const ringBias = index / Math.max(1, towerCount - 1);
    const nearEye = index < towerCount * 0.45;
    const randomA = hash2(index + 17, metrics.seed % 997, metrics.seed);
    const randomB = hash2(index + 43, metrics.seed % 577, metrics.seed + 811);
    const angle = randomA * TWO_PI + phase * (nearEye ? 0.12 : 0.045) - metrics.shearAngle * 0.18;
    const radiusNorm = nearEye
      ? metrics.eyeRadius * (2.0 + randomB * 1.9)
      : 0.31 + ringBias * 0.46 + randomB * 0.08;
    const spiralOffset = radiusNorm * metrics.spiralTightness * 0.18;
    const px = center + Math.cos(angle - spiralOffset) * radiusNorm * center;
    const py = center + Math.sin(angle - spiralOffset) * radiusNorm * center;
    const size = INTERNAL_SIZE * (0.008 + randomB * 0.011 + metrics.towerSignal * 0.008) * (nearEye ? 1.18 : 0.92);
    const alpha = clamp((nearEye ? 0.32 : 0.18) + metrics.towerSignal * 0.34 + randomA * 0.14, 0.12, 0.82);
    const gradient = context.createRadialGradient(px, py, 0, px, py, size * 4.2);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    gradient.addColorStop(0.26, `rgba(225, 248, 255, ${alpha * 0.6})`);
    gradient.addColorStop(0.62, `rgba(103, 205, 255, ${alpha * 0.18})`);
    gradient.addColorStop(1, "rgba(103, 205, 255, 0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(px, py, size * 4.2, 0, TWO_PI);
    context.fill();
  }

  context.restore();
}

async function buildSatelliteTexture(
  storm: Storm,
  metrics: RenderMetrics,
  satelliteLayer: SatelliteLayerPayload
) {
  const image = await loadImage(satelliteLayer.imageUrl);
  if (!image) return null;

  const crop = satelliteCropForStorm(image, storm, satelliteLayer);
  if (!crop) return null;

  const texture = document.createElement("canvas");
  texture.width = INTERNAL_SIZE;
  texture.height = INTERNAL_SIZE;
  const textureContext = texture.getContext("2d", { willReadFrequently: true });
  if (!textureContext) return null;

  textureContext.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, INTERNAL_SIZE, INTERNAL_SIZE);
  const source = textureContext.getImageData(0, 0, INTERNAL_SIZE, INTERNAL_SIZE);
  const pixels = source.data;
  for (let y = 0; y < INTERNAL_SIZE; y += 1) {
    for (let x = 0; x < INTERNAL_SIZE; x += 1) {
      const index = (y * INTERNAL_SIZE + x) * 4;
      const nx = (x + 0.5 - INTERNAL_SIZE * 0.5) / (INTERNAL_SIZE * 0.5);
      const ny = (y + 0.5 - INTERNAL_SIZE * 0.5) / (INTERNAL_SIZE * 0.5);
      const radius = Math.sqrt(nx * nx + ny * ny);
      const luminance = (pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722) / 255;
      const angle = Math.atan2(ny, nx);
      const edgeNoise = fbm(nx * 3.1 + 4.2, ny * 3.1 - 6.7, metrics.seed + 3023);
      const textureBoundary = clamp(
        0.82 + (edgeNoise - 0.5) * 0.14 + Math.sin(angle * 5.0 + metrics.seed * 0.004) * 0.026,
        0.72,
        0.9
      );
      const featheredEdge = 1 - smoothstep(textureBoundary - 0.1, Math.min(0.97, textureBoundary + 0.08), radius);
      const cloudSignal = smoothstep(0.42, 0.86, luminance) * featheredEdge;
      pixels[index] = 206;
      pixels[index + 1] = 224;
      pixels[index + 2] = 236;
      pixels[index + 3] = Math.round(cloudSignal * (72 + metrics.intensity * 76));
    }
  }
  textureContext.putImageData(source, 0, 0);
  return texture;
}

function drawSatelliteTexture(context: CanvasRenderingContext2D, texture: HTMLCanvasElement, metrics: RenderMetrics, phase = 0) {
  context.save();
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.34 + metrics.ahiCompleteness * 0.14;
  context.drawImage(texture, 0, 0);
  context.restore();
  drawStormEye(context, metrics, phase);
}

function drawStormEye(context: CanvasRenderingContext2D, metrics: RenderMetrics, phase = 0) {
  if (metrics.eyeStrength <= 0.06) return;
  const center = INTERNAL_SIZE * 0.5;
  const eyeCenterX = center + metrics.eyeOffsetX * INTERNAL_SIZE * 0.5;
  const eyeCenterY = center + metrics.eyeOffsetY * INTERNAL_SIZE * 0.5;
  const eyePx = INTERNAL_SIZE * metrics.eyeRadius * (1.05 + metrics.eyeStrength * 0.24);
  const gradient = context.createRadialGradient(eyeCenterX, eyeCenterY, eyePx * 0.1, eyeCenterX, eyeCenterY, eyePx * 1.8);
  gradient.addColorStop(0, `rgba(0, 8, 12, ${0.95 * metrics.eyeStrength})`);
  gradient.addColorStop(0.36, `rgba(6, 26, 34, ${0.72 * metrics.eyeStrength})`);
  gradient.addColorStop(0.66, `rgba(238, 248, 255, ${0.32 * metrics.eyeStrength})`);
  gradient.addColorStop(1, "rgba(238, 248, 255, 0)");
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = gradient;
  context.beginPath();
  for (let index = 0; index <= 42; index += 1) {
    const angle = (index / 42) * TWO_PI;
    const roughness = 1 + Math.sin(angle * 3.0 + metrics.seed * 0.006 + phase * 0.7) * 0.08 + Math.sin(angle * 7.0 + metrics.seed * 0.002 - phase * 0.44) * 0.045;
    const px = eyeCenterX + Math.cos(angle) * eyePx * 1.2 * roughness;
    const py = eyeCenterY + Math.sin(angle) * eyePx * 1.2 * roughness;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.fill();
  context.restore();

  const darkEye = context.createRadialGradient(eyeCenterX, eyeCenterY, eyePx * 0.08, eyeCenterX, eyeCenterY, eyePx * 1.5);
  darkEye.addColorStop(0, `rgba(0, 10, 14, ${0.7 * metrics.eyeStrength})`);
  darkEye.addColorStop(0.42, `rgba(4, 24, 32, ${0.48 * metrics.eyeStrength})`);
  darkEye.addColorStop(0.78, `rgba(52, 120, 140, ${0.14 * metrics.eyeStrength})`);
  darkEye.addColorStop(1, "rgba(52, 120, 140, 0)");
  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = darkEye;
  context.beginPath();
  context.arc(eyeCenterX, eyeCenterY, eyePx * 1.55, 0, TWO_PI);
  context.fill();
  context.restore();

  context.save();
  context.globalCompositeOperation = "screen";
  context.shadowColor = "rgba(200, 244, 255, 0.9)";
  context.shadowBlur = eyePx * (0.25 + metrics.ahiColdCore * 0.28);
  context.strokeStyle = `rgba(255, 255, 255, ${0.56 * metrics.eyeStrength + metrics.ahiColdCore * 0.14})`;
  context.lineWidth = Math.max(1.4, eyePx * 0.18);
  context.beginPath();
  for (let index = 0; index <= 54; index += 1) {
    const angle = (index / 54) * TWO_PI;
    const gap = Math.pow((Math.cos(angle - metrics.drySlotAngle - phase * 0.16) + 1) * 0.5, 9) * 0.22;
    const roughness = 1 + Math.sin(angle * 4.0 + metrics.seed * 0.004 + phase * 0.58) * 0.09 - gap;
    const px = eyeCenterX + Math.cos(angle) * eyePx * 1.45 * roughness;
    const py = eyeCenterY + Math.sin(angle) * eyePx * 1.45 * roughness;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.stroke();
  context.restore();

  context.save();
  context.globalCompositeOperation = "screen";
  context.strokeStyle = `rgba(104, 220, 255, ${0.24 * metrics.eyeStrength + metrics.ahiMoistureOutflow * 0.12})`;
  context.lineWidth = Math.max(1, eyePx * 0.07);
  context.beginPath();
  context.arc(eyeCenterX, eyeCenterY, eyePx * (2.15 + metrics.eyeStrength * 0.28), 0, TWO_PI);
  context.stroke();
  context.restore();
}

function drawSubtleRadarLock(context: CanvasRenderingContext2D, storm: Storm, metrics: RenderMetrics) {
  const center = INTERNAL_SIZE * 0.5;
  const radius = INTERNAL_SIZE * (0.14 + metrics.intensity * 0.035);
  context.save();
  context.globalCompositeOperation = "screen";
  context.strokeStyle = stageAccent(storm.stage, 0.24 + metrics.intensity * 0.14);
  context.lineWidth = 1.2;
  context.setLineDash([10, 14]);
  context.beginPath();
  context.arc(center, center, radius, 0, TWO_PI);
  context.stroke();
  context.restore();
}

function satelliteCropForStorm(image: HTMLImageElement, storm: Storm, satelliteLayer: SatelliteLayerPayload) {
  const { west, east, south, north } = satelliteLayer.bounds;
  if (storm.position.lon < west || storm.position.lon > east || storm.position.lat < south || storm.position.lat > north) return null;
  const x = ((storm.position.lon - west) / (east - west)) * image.naturalWidth;
  const northMercator = mercatorLatitude(north);
  const southMercator = mercatorLatitude(south);
  const y = ((northMercator - mercatorLatitude(storm.position.lat)) / (northMercator - southMercator)) * image.naturalHeight;
  const stormSpan = Math.max(5.5, Math.min(16, (storm.windRadiiKm.r7 || 260) / 88));
  const pxPerDegree = image.naturalWidth / (east - west);
  const size = Math.max(96, Math.min(image.naturalWidth, stormSpan * pxPerDegree));
  return {
    x: clamp(x - size / 2, 0, image.naturalWidth - size),
    y: clamp(y - size / 2, 0, image.naturalHeight - size),
    size
  };
}

function mercatorLatitude(latitude: number) {
  const clamped = clamp(latitude, -85, 85);
  const radians = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function loadImage(url: string | null) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function stageAccent(stage: Storm["stage"], alpha: number) {
  if (stage.includes("\u8d85\u5f3a")) return `rgba(255, 59, 50, ${alpha})`;
  if (stage.includes("\u5f3a\u53f0")) return `rgba(185, 94, 255, ${alpha})`;
  if (stage.includes("\u53f0\u98ce")) return `rgba(0, 216, 255, ${alpha})`;
  return `rgba(236, 251, 255, ${alpha})`;
}

function stormMotionAngle(storm: Storm) {
  const track = storm.track;
  if (track.length >= 2) {
    const prev = track[track.length - 2];
    const latest = track[track.length - 1];
    const dx = latest.lon - prev.lon;
    const dy = latest.lat - prev.lat;
    if (Math.hypot(dx, dy) > 0.01) return Math.atan2(dy, dx);
  }

  const text = storm.moveDirection;
  if (text.includes("\u897f\u5317")) return (-135 * Math.PI) / 180;
  if (text.includes("\u4e1c\u5317")) return (-45 * Math.PI) / 180;
  if (text.includes("\u897f\u5357")) return (135 * Math.PI) / 180;
  if (text.includes("\u4e1c\u5357")) return (45 * Math.PI) / 180;
  if (text.includes("\u897f")) return Math.PI;
  if (text.includes("\u4e1c")) return 0;
  if (text.includes("\u5317")) return -Math.PI / 2;
  if (text.includes("\u5357")) return Math.PI / 2;
  return -Math.PI * 0.35;
}

function fbm(x: number, y: number, seed: number) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < 5; octave += 1) {
    value += valueNoise(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
    total += amplitude;
    amplitude *= 0.52;
    frequency *= 2.07;
  }
  return value / total;
}

function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smoothstep(0, 1, x - xi);
  const yf = smoothstep(0, 1, y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

function hash2(x: number, y: number, seed: number) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 0.013) * 43758.5453123;
  return n - Math.floor(n);
}

function hashStormSeed(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function gaussian(value: number, center: number, spread: number) {
  return Math.exp(-((value - center) ** 2) / Math.max(0.0001, spread));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
