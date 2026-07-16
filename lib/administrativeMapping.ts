import type { EventGeography } from "@/lib/nationalWeatherTypes";

export interface AdministrativeHierarchyRow {
  locationId: string;
  locationName: string;
  provinceName: string;
  cityName: string;
  adCode: string;
}

export interface AdministrativeHierarchy {
  source: string;
  fetchedAt: string;
  rows: readonly AdministrativeHierarchyRow[];
  byLocationId: ReadonlyMap<string, readonly AdministrativeHierarchyRow[]>;
  byAdministrativeGroup: ReadonlyMap<string, readonly AdministrativeHierarchyRow[]>;
  error: string | null;
}

export interface AdministrativeResolution {
  locationId: string;
  /** Exact authoritative labels for the resolved location hierarchy. */
  provinceName: string | null;
  cityName: string | null;
  locationName: string | null;
  /** Official six-digit administrative-code namespace. */
  provinceCode: string | null;
  /** Official six-digit administrative-code namespace. */
  cityCode: string | null;
  /** Official six-digit administrative-code namespace. */
  countyCode: string | null;
  /** Provider location id for the unique Adm2 root, when one exists. */
  cityLocationId: string | null;
  cityAttribution: EventGeography["cityAttribution"];
  reason: string;
}

const DIRECT_ADMIN_PROVINCES = new Set(["110000", "120000", "310000", "500000", "710000", "810000", "820000"]);

export function parseAdministrativeHierarchyCsv(csv: string): AdministrativeHierarchyRow[] {
  const records = parseCsv(csv);
  const headerIndex = records.findIndex((record) => record[0]?.trim() === "Location_ID");
  if (headerIndex < 0) throw new Error("行政层级 CSV 缺少 Location_ID 表头");
  const header = records[headerIndex].map((field) => field.trim());
  const indexes = {
    locationId: header.indexOf("Location_ID"),
    locationName: header.indexOf("Location_Name_ZH"),
    provinceName: header.indexOf("Adm1_Name_ZH"),
    cityName: header.indexOf("Adm2_Name_ZH"),
    adCode: header.indexOf("AD_code")
  };
  if (Object.values(indexes).some((index) => index < 0)) throw new Error("行政层级 CSV 缺少必需字段");

  return records.slice(headerIndex + 1).flatMap((record) => {
    const row: AdministrativeHierarchyRow = {
      locationId: record[indexes.locationId]?.trim() ?? "",
      locationName: record[indexes.locationName]?.trim() ?? "",
      provinceName: record[indexes.provinceName]?.trim() ?? "",
      cityName: record[indexes.cityName]?.trim() ?? "",
      adCode: record[indexes.adCode]?.trim() ?? ""
    };
    return /^\d+$/.test(row.locationId) && /^\d{6}$/.test(row.adCode) && row.provinceName && row.cityName ? [row] : [];
  });
}

export function createAdministrativeHierarchy(
  rows: readonly AdministrativeHierarchyRow[],
  metadata: { source: string; fetchedAt: string; error?: string | null }
): AdministrativeHierarchy {
  const byLocationId = groupRows(rows, (row) => row.locationId);
  const byAdministrativeGroup = groupRows(rows, administrativeGroupKey);
  return {
    source: metadata.source,
    fetchedAt: metadata.fetchedAt,
    rows,
    byLocationId,
    byAdministrativeGroup,
    error: metadata.error ?? null
  };
}

/**
 * Resolution is deliberately exact and data driven. Missing ids, conflicting
 * rows, or groups without one verifiable Adm2 root remain ambiguous; there is
 * no location-id prefix or nearest-coordinate fallback.
 */
export function resolveAdministrativeLocation(
  rawLocationId: string,
  hierarchy: AdministrativeHierarchy | null
): AdministrativeResolution {
  const locationId = rawLocationId.trim();
  if (!hierarchy) return unresolved(locationId, "行政层级快照不可用");
  const exactRows = uniqueRows(hierarchy.byLocationId.get(locationId) ?? []);
  if (exactRows.length === 0) return unresolved(locationId, "权威列表中找不到精确 locationId");
  if (exactRows.length !== 1) return unresolved(locationId, "同一 locationId 存在冲突行政记录");

  const exact = exactRows[0];
  const provinceCode = `${exact.adCode.slice(0, 2)}0000`;
  const group = hierarchy.byAdministrativeGroup.get(administrativeGroupKey(exact)) ?? [];
  const rootCodes = unique(group.map((row) => row.adCode).filter((adCode) => adCode.endsWith("00")));
  const candidateRootCodes = DIRECT_ADMIN_PROVINCES.has(provinceCode)
    ? rootCodes.filter((adCode) => adCode === provinceCode)
    : rootCodes;
  if (candidateRootCodes.length !== 1) {
    return unresolved(locationId, "Adm2 分组没有唯一、可验证的行政根", provinceCode);
  }

  const cityCode = candidateRootCodes[0];
  const cityLocationIds = unique(group.filter((row) => row.adCode === cityCode).map((row) => row.locationId));
  if (!exact.adCode.startsWith(provinceCode.slice(0, 2))) {
    return unresolved(locationId, "行政码省级关系不一致", provinceCode);
  }

  return {
    locationId,
    provinceName: exact.provinceName,
    cityName: exact.cityName,
    locationName: exact.locationName,
    provinceCode,
    cityCode,
    countyCode: exact.adCode === cityCode ? null : exact.adCode,
    cityLocationId: cityLocationIds.length === 1 ? cityLocationIds[0] : exact.adCode === cityCode ? exact.locationId : null,
    cityAttribution: "deterministic",
    reason: "由权威列表精确行及唯一 Adm2 行政根映射"
  };
}

/**
 * A narrow recovery path for a city mention whose weather provider did not
 * return a location id. It accepts only one exact Adm2 city-name group and
 * then delegates to the same AD-code resolver used for provider ids.
 *
 * This is intentionally not a fuzzy name lookup: a same-named city in
 * another province, a missing city root, or any conflicting group stays
 * ambiguous and cannot receive national warning facts.
 */
export function resolveAdministrativeCityName(
  rawCityName: string,
  hierarchy: AdministrativeHierarchy | null
): AdministrativeResolution {
  const cityName = normalizeCityName(rawCityName);
  if (!hierarchy) return unresolved(rawCityName.trim(), "administrative hierarchy unavailable");
  if (!cityName) return unresolved(rawCityName.trim(), "city name is empty");

  const candidates = [...hierarchy.byAdministrativeGroup.values()].filter((group) =>
    normalizeCityName(group[0]?.cityName ?? "") === cityName
  );
  if (candidates.length !== 1) {
    return unresolved(rawCityName.trim(), "city name does not identify one administrative root");
  }

  const roots = uniqueRows(candidates[0].filter((row) => row.adCode.endsWith("00")));
  if (roots.length !== 1) {
    return unresolved(rawCityName.trim(), "city name group does not have one administrative root");
  }
  return resolveAdministrativeLocation(roots[0].locationId, hierarchy);
}

/**
 * Resolve an exact viewer-entered place name against the authoritative
 * location list. This covers county-level cities such as Puning without
 * maintaining a hand-written alias table. A province qualifier narrows
 * duplicate place names; otherwise only a single exact match (or a single
 * administrative root among duplicates) is accepted.
 */
export function resolveAdministrativeLocationName(
  rawLocationName: string,
  rawProvinceName: string | null | undefined,
  hierarchy: AdministrativeHierarchy | null
): AdministrativeResolution {
  const locationName = splitAdministrativeLocationName(rawLocationName);
  if (!hierarchy) return unresolved(rawLocationName.trim(), "administrative hierarchy unavailable");
  if (!locationName.base) return unresolved(rawLocationName.trim(), "location name is empty");

  const provinceName = normalizeProvinceName(rawProvinceName ?? "");
  const provinceRows = hierarchy.rows.filter((row) =>
    !provinceName || normalizeProvinceName(row.provinceName) === provinceName
  );
  const exactLabel = uniqueRows(provinceRows.filter((row) =>
    splitAdministrativeLocationName(row.locationName).full === locationName.full
  ));
  const sameBase = provinceRows.filter((row) =>
    splitAdministrativeLocationName(row.locationName).base === locationName.base
  );
  const sameSuffix = locationName.suffix
    ? sameBase.filter((row) => splitAdministrativeLocationName(row.locationName).suffix === locationName.suffix)
    : [];
  // QWeather's authoritative list commonly omits “市” from county-level city
  // labels (for example 普宁), while retaining “县/区/旗”. Prefer an exact
  // label, then the requested administrative kind, and only then a suffixless
  // provider label. A different explicit kind is never treated as equivalent.
  const suffixless = locationName.suffix
    ? sameBase.filter((row) => splitAdministrativeLocationName(row.locationName).suffix === null)
    : [];
  const exact = uniqueRows(
    exactLabel.length > 0
      ? exactLabel
      : sameSuffix.length > 0
        ? sameSuffix
        : locationName.suffix
          ? suffixless
          : sameBase
  );
  const candidates = exact.length > 1
    ? exact.filter((row) => row.adCode.endsWith("00"))
    : exact;
  if (candidates.length !== 1) {
    return unresolved(rawLocationName.trim(), "location name does not identify one administrative location");
  }
  return resolveAdministrativeLocation(candidates[0].locationId, hierarchy);
}

/**
 * Provider location ids are useful only when they agree with the separately
 * resolved city identity. A stale or mis-scoped provider id must never route
 * one city's national warnings into another city's card.
 */
export function resolveAdministrativeCityIdentity(
  rawCityName: string,
  rawLocationId: string | null | undefined,
  hierarchy: AdministrativeHierarchy | null
): AdministrativeResolution {
  if (rawLocationId) {
    const byLocation = resolveAdministrativeLocation(rawLocationId, hierarchy);
    if (
      byLocation.cityAttribution === "deterministic"
      && normalizeCityName(byLocation.cityName ?? "") === normalizeCityName(rawCityName)
    ) {
      return byLocation;
    }
  }
  return resolveAdministrativeCityName(rawCityName, hierarchy);
}

export function canEnterCitySituation(resolution: AdministrativeResolution) {
  return resolution.cityAttribution === "deterministic" && resolution.cityCode !== null;
}

/**
 * The QWeather location list often omits the final county-level administrative
 * suffix (for example, 惠阳 for 惠阳区). Restore only the suffix encoded by the
 * official six-digit administrative-code convention; preserve labels that
 * already carry one.
 */
export function displayAdministrativeLocationName(resolution: AdministrativeResolution) {
  const name = resolution.locationName;
  if (!name || !resolution.countyCode || /(?:区|县|市|旗|自治县|自治旗)$/.test(name)) return name;
  const localCode = Number(resolution.countyCode.slice(-2));
  if (!Number.isInteger(localCode)) return name;
  if (localCode <= 20) return `${name}区`;
  if (localCode >= 81) return `${name}市`;
  return `${name}县`;
}

function administrativeGroupKey(row: AdministrativeHierarchyRow) {
  return `${row.provinceName}\u0000${row.cityName}`;
}

function normalizeCityName(value: string) {
  return value.trim().replace(/\s+/g, "").replace(/市$/, "");
}

function splitAdministrativeLocationName(value: string) {
  const full = value.trim().normalize("NFKC").replace(/\s+/g, "");
  const suffixMatch = full.match(/([市县区旗])$/);
  const suffix = suffixMatch?.[1] ?? null;
  return {
    full,
    base: suffix ? full.slice(0, -suffix.length) : full,
    suffix
  };
}

function normalizeProvinceName(value: string) {
  return value
    .trim()
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/(?:壮族|回族|维吾尔)?自治区$|特别行政区$|[省市]$/g, "");
}

function groupRows(
  rows: readonly AdministrativeHierarchyRow[],
  keyOf: (row: AdministrativeHierarchyRow) => string
): ReadonlyMap<string, readonly AdministrativeHierarchyRow[]> {
  const grouped = new Map<string, AdministrativeHierarchyRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return grouped;
}

function uniqueRows(rows: readonly AdministrativeHierarchyRow[]) {
  return [...new Map(rows.map((row) => [JSON.stringify(row), row])).values()];
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function unresolved(locationId: string, reason: string, provinceCode: string | null = null): AdministrativeResolution {
  return {
    locationId,
    provinceName: null,
    cityName: null,
    locationName: null,
    provinceCode,
    cityCode: null,
    countyCode: null,
    cityLocationId: null,
    cityAttribution: "ambiguous",
    reason
  };
}

function parseCsv(input: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  return records;
}
