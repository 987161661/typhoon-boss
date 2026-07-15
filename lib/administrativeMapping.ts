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
  /** Official six-digit administrative-code namespace. */
  provinceCode: string | null;
  /** Official six-digit administrative-code namespace. */
  cityCode: string | null;
  /** Official six-digit administrative-code namespace. */
  countyCode: string | null;
  /** Provider location id for the unique Adm2 root, when one exists. */
  cityLocationId: string | null;
  cityName: string | null;
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
    provinceCode,
    cityCode,
    countyCode: exact.adCode === cityCode ? null : exact.adCode,
    cityLocationId: cityLocationIds.length === 1 ? cityLocationIds[0] : exact.adCode === cityCode ? exact.locationId : null,
    cityName: exact.cityName,
    cityAttribution: "deterministic",
    reason: "由权威列表精确行及唯一 Adm2 行政根映射"
  };
}

export function canEnterCitySituation(resolution: AdministrativeResolution) {
  return resolution.cityAttribution === "deterministic" && resolution.cityCode !== null;
}

function administrativeGroupKey(row: AdministrativeHierarchyRow) {
  return `${row.provinceName}\u0000${row.cityName}`;
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
    provinceCode,
    cityCode: null,
    countyCode: null,
    cityLocationId: null,
    cityName: null,
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
