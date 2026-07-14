export interface WindSeedBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface StableWindSeed {
  key: string;
  lon: number;
  lat: number;
}

export interface StableWindSeedPlan {
  resolution: number;
  slotsPerCell: number;
}

export interface HierarchicalWindSeedPlan {
  lowerResolution: number;
  upperResolution: number;
  blend: number;
  lowerCount: number;
  upperCount: number;
}

export interface HierarchicalWindSeeds {
  plan: HierarchicalWindSeedPlan;
  seeds: StableWindSeed[];
}

export interface WindPoolSeedParticle {
  id: string;
  seedKey?: string;
  lon: number;
  lat: number;
  state: "active" | "retiring";
}

export interface WindParticlePoolReconciliation {
  keepIds: string[];
  reactivateIds: string[];
  retireIds: string[];
  spawnSeeds: StableWindSeed[];
}

const MAX_MERCATOR_LATITUDE = 85.051129;

export function createStableWindSeedPlan(bounds: WindSeedBounds, targetCount: number): StableWindSeedPlan {
  const normalized = normalizedBounds(bounds);
  const area = Math.max(1e-8, (normalized.east - normalized.west) * (normalized.south - normalized.north));
  const idealResolution = Math.sqrt(Math.max(1, targetCount) / area);
  const resolution = clampPowerOfTwo(idealResolution, 16, 4096);
  const cellCount = Math.max(1, countIntersectingCells(normalized, resolution));
  return {
    resolution,
    slotsPerCell: Math.max(1, Math.round(Math.max(1, targetCount) / cellCount))
  };
}

export function createStableWindSeeds(
  bounds: WindSeedBounds,
  plan: StableWindSeedPlan,
  maximumCount: number
): StableWindSeed[] {
  if (maximumCount <= 0) return [];
  const normalized = normalizedBounds(bounds);
  const resolution = Math.max(1, Math.round(plan.resolution));
  const slotsPerCell = Math.max(1, Math.round(plan.slotsPerCell));
  const minCellX = Math.floor(normalized.west * resolution);
  const maxCellX = Math.min(resolution - 1, Math.floor(normalized.east * resolution));
  const minCellY = Math.floor(normalized.north * resolution);
  const maxCellY = Math.min(resolution - 1, Math.floor(normalized.south * resolution));
  const candidates: Array<StableWindSeed & { rank: number }> = [];

  for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let slot = 0; slot < slotsPerCell; slot += 1) {
        const key = `${resolution}:${cellX}:${cellY}:${slot}`;
        const x = (cellX + 0.16 + hashUnit(`${key}:x`) * 0.68) / resolution;
        const y = (cellY + 0.16 + hashUnit(`${key}:y`) * 0.68) / resolution;
        if (x < normalized.west || x > normalized.east || y < normalized.north || y > normalized.south) continue;
        candidates.push({
          key,
          lon: x * 360 - 180,
          lat: mercatorYToLatitude(y),
          rank: hash32(`${key}:rank`)
        });
      }
    }
  }

  candidates.sort((left, right) => left.rank - right.rank || left.key.localeCompare(right.key));
  return candidates.slice(0, maximumCount).map(({ key, lon, lat }) => ({ key, lon, lat }));
}

export function createHierarchicalWindSeeds(
  bounds: WindSeedBounds,
  targetCount: number
): HierarchicalWindSeeds {
  const normalized = normalizedBounds(bounds);
  const safeTarget = Math.max(1, Math.round(targetCount));
  const area = Math.max(1e-8, (normalized.east - normalized.west) * (normalized.south - normalized.north));
  const idealResolution = Math.sqrt(safeTarget / area);
  const lowerResolution = clampPowerOfTwoFloor(idealResolution, 16, 4096);
  const upperResolution = Math.min(4096, lowerResolution * 2);
  const blend = upperResolution === lowerResolution
    ? 0
    : clamp(Math.log2(idealResolution / lowerResolution), 0, 1);
  const lowerCount = Math.round(safeTarget * (1 - blend));
  const upperCount = safeTarget - lowerCount;
  const lowerPlan = seedPlanAtResolution(normalized, lowerResolution, safeTarget);
  const upperPlan = seedPlanAtResolution(normalized, upperResolution, safeTarget);
  const lowerSeeds = createStableWindSeeds(bounds, lowerPlan, lowerCount);
  const lowerKeys = new Set(lowerSeeds.map((seed) => seed.key));
  const upperSeeds = createStableWindSeeds(bounds, upperPlan, upperCount)
    .filter((seed) => !lowerKeys.has(seed.key));

  return {
    plan: { lowerResolution, upperResolution, blend, lowerCount, upperCount },
    seeds: [...lowerSeeds, ...upperSeeds]
  };
}

export function planWindParticlePoolReconciliation(
  existing: readonly WindPoolSeedParticle[],
  seeds: readonly StableWindSeed[],
  bounds: WindSeedBounds,
  targetCount: number,
  poolCapacity: number
): WindParticlePoolReconciliation {
  const safeTarget = Math.max(0, Math.round(targetCount));
  const safeCapacity = Math.max(safeTarget, Math.round(poolCapacity));
  const inside = existing
    .filter((particle) => containsSeedPoint(bounds, particle.lon, particle.lat))
    .sort((left, right) => stableWindHash(left.id) - stableWindHash(right.id) || left.id.localeCompare(right.id));
  const desired = inside.slice(0, safeTarget);
  const desiredIds = new Set(desired.map((particle) => particle.id));
  const keepIds = desired.filter((particle) => particle.state === "active").map((particle) => particle.id);
  const reactivateIds = desired.filter((particle) => particle.state === "retiring").map((particle) => particle.id);
  const retireIds = existing.filter((particle) => !desiredIds.has(particle.id) && particle.state !== "retiring").map((particle) => particle.id);
  const existingSeedKeys = new Set(existing.map((particle) => particle.seedKey).filter((key): key is string => Boolean(key)));
  const availableSlots = Math.max(0, safeCapacity - existing.length);
  const missing = Math.max(0, safeTarget - desired.length);
  const spawnSeeds = seeds
    .filter((seed) => !existingSeedKeys.has(seed.key))
    .slice(0, Math.min(missing, availableSlots));

  return { keepIds, reactivateIds, retireIds, spawnSeeds };
}

export function stableWindHash(value: string) {
  return hash32(value);
}

function normalizedBounds(bounds: WindSeedBounds) {
  const west = clamp(Math.min(bounds.west, bounds.east), -180, 180);
  const east = clamp(Math.max(bounds.west, bounds.east), -180, 180);
  const southLatitude = clamp(Math.min(bounds.south, bounds.north), -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const northLatitude = clamp(Math.max(bounds.south, bounds.north), -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  return {
    west: (west + 180) / 360,
    east: (east + 180) / 360,
    north: latitudeToMercatorY(northLatitude),
    south: latitudeToMercatorY(southLatitude)
  };
}

function countIntersectingCells(bounds: ReturnType<typeof normalizedBounds>, resolution: number) {
  const columns = Math.max(1, Math.ceil(bounds.east * resolution) - Math.floor(bounds.west * resolution));
  const rows = Math.max(1, Math.ceil(bounds.south * resolution) - Math.floor(bounds.north * resolution));
  return columns * rows;
}

function seedPlanAtResolution(
  bounds: ReturnType<typeof normalizedBounds>,
  resolution: number,
  targetCount: number
): StableWindSeedPlan {
  const cellCount = Math.max(1, countIntersectingCells(bounds, resolution));
  return {
    resolution,
    slotsPerCell: Math.max(1, Math.ceil(Math.max(1, targetCount) / cellCount))
  };
}

function containsSeedPoint(bounds: WindSeedBounds, lon: number, lat: number) {
  return lon >= Math.min(bounds.west, bounds.east) &&
    lon <= Math.max(bounds.west, bounds.east) &&
    lat >= Math.min(bounds.south, bounds.north) &&
    lat <= Math.max(bounds.south, bounds.north);
}

function latitudeToMercatorY(latitude: number) {
  const radians = latitude * Math.PI / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
}

function mercatorYToLatitude(y: number) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

function clampPowerOfTwo(value: number, minimum: number, maximum: number) {
  const exponent = Math.round(Math.log2(Math.max(1, value)));
  return clamp(2 ** exponent, minimum, maximum);
}

function clampPowerOfTwoFloor(value: number, minimum: number, maximum: number) {
  const exponent = Math.floor(Math.log2(Math.max(1, value)));
  return clamp(2 ** exponent, minimum, maximum);
}

function hashUnit(value: string) {
  return hash32(value) / 0x1_0000_0000;
}

function hash32(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
