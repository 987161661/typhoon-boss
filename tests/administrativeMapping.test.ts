import assert from "node:assert/strict";
import test from "node:test";
import {
  canEnterCitySituation,
  createAdministrativeHierarchy,
  parseAdministrativeHierarchyCsv,
  resolveAdministrativeLocation,
  type AdministrativeHierarchyRow
} from "../lib/administrativeMapping";

const csv = `China-City-List fixture,,,,,,,,,,,,,
Location_ID,Location_Name_EN,Location_Name_ZH,ISO_3166_1,Country_Region_EN,Country_Region_ZH,Adm1_Name_EN,Adm1_Name_ZH,Adm2_Name_EN,Adm2_Name_ZH,Timezone,Latitude,Longitude,AD_code
101270801,Guangan,广安,CN,China,中国,Sichuan,四川省,Guangan,广安市,Asia/Shanghai,30.47,106.63,511600
101270803,Wusheng,武胜,CN,China,中国,Sichuan,四川省,Guangan,广安市,Asia/Shanghai,30.35,106.30,511622
101010100,Beijing,北京,CN,China,中国,Beijing,北京市,Beijing,北京市,Asia/Shanghai,39.90,116.40,110000
101010300,Chaoyang,朝阳,CN,China,中国,Beijing,北京市,Beijing,北京市,Asia/Shanghai,39.92,116.49,110105
101020100,Shanghai,上海,CN,China,中国,Shanghai,上海市,Shanghai,上海市,Asia/Shanghai,31.23,121.47,310000
101030100,Tianjin,天津,CN,China,中国,Tianjin,天津市,Tianjin,天津市,Asia/Shanghai,39.12,117.20,120000
101040100,Chongqing,重庆,CN,China,中国,Chongqing,重庆市,Chongqing,重庆市,Asia/Shanghai,29.56,106.55,500000
101320101,Hong Kong,香港,CN,China,中国,Hong Kong,香港特别行政区,Hong Kong,香港特别行政区,Asia/Hong_Kong,22.30,114.17,810000
101330101,Macao,澳门,CN,China,中国,Macao,澳门特别行政区,Macao,澳门特别行政区,Asia/Macau,22.20,113.54,820000
101340101,Taipei,台北,CN,China,中国,Taiwan,台湾省,Taipei,台北市,Asia/Taipei,25.04,121.56,710000`;

const rows = parseAdministrativeHierarchyCsv(csv);
const hierarchy = createAdministrativeHierarchy(rows, { source: "fixture", fetchedAt: "2026-07-15T00:00:00.000Z" });

test("CSV parser extracts the exact authoritative hierarchy fields", () => {
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[1], {
    locationId: "101270803",
    locationName: "武胜",
    provinceName: "四川省",
    cityName: "广安市",
    adCode: "511622"
  });
});

test("Wusheng resolves through its exact row and unique Adm2 root in the AD-code namespace", () => {
  const resolution = resolveAdministrativeLocation("101270803", hierarchy);
  assert.equal(resolution.provinceCode, "510000");
  assert.equal(resolution.cityCode, "511600");
  assert.equal(resolution.countyCode, "511622");
  assert.equal(resolution.cityLocationId, "101270801");
  assert.equal(resolution.cityName, "广安市");
  assert.equal(resolution.cityAttribution, "deterministic");
  assert.equal(canEnterCitySituation(resolution), true);
  assert.notEqual(resolution.cityCode, "1012708");
});

test("four municipalities use official six-digit administrative roots", () => {
  assert.deepEqual(
    ["101010300", "101020100", "101030100", "101040100"].map((id) => resolveAdministrativeLocation(id, hierarchy).cityCode),
    ["110000", "310000", "120000", "500000"]
  );
  const beijingDistrict = resolveAdministrativeLocation("101010300", hierarchy);
  assert.equal(beijingDistrict.countyCode, "110105");
  assert.equal(beijingDistrict.cityLocationId, "101010100");
});

test("Hong Kong, Macao and Taipei resolve in the same AD-code namespace", () => {
  assert.deepEqual(
    ["101320101", "101330101", "101340101"].map((id) => resolveAdministrativeLocation(id, hierarchy).cityCode),
    ["810000", "820000", "710000"]
  );
});

test("multiple provider locations sharing one direct-admin AD root do not create a false conflict", () => {
  const directRows: AdministrativeHierarchyRow[] = [
    ...rows,
    { locationId: "101320102", locationName: "九龙", provinceName: "香港特别行政区", cityName: "香港特别行政区", adCode: "810000" }
  ];
  const directHierarchy = createAdministrativeHierarchy(directRows, { source: "fixture", fetchedAt: "2026-07-15T00:00:00.000Z" });
  const resolution = resolveAdministrativeLocation("101320101", directHierarchy);
  assert.equal(resolution.cityAttribution, "deterministic");
  assert.equal(resolution.cityCode, "810000");
  assert.equal(resolution.cityLocationId, "101320101");
});

test("missing exact ids and unavailable hierarchy remain ambiguous without prefix fallback", () => {
  const shortened = resolveAdministrativeLocation("1012708", hierarchy);
  assert.equal(shortened.cityAttribution, "ambiguous");
  assert.equal(shortened.cityCode, null);
  assert.match(shortened.reason, /找不到精确/);
  assert.equal(canEnterCitySituation(shortened), false);

  const unavailable = resolveAdministrativeLocation("101270803", null);
  assert.equal(unavailable.cityAttribution, "ambiguous");
  assert.match(unavailable.reason, /快照不可用/);
});

test("conflicting exact rows or non-unique Adm2 roots remain ambiguous", () => {
  const exactConflictRows: AdministrativeHierarchyRow[] = [
    ...rows,
    { ...rows[1], provinceName: "冲突省", cityName: "冲突市", adCode: "999999" }
  ];
  const exactConflict = createAdministrativeHierarchy(exactConflictRows, { source: "fixture", fetchedAt: "2026-07-15T00:00:00.000Z" });
  assert.match(resolveAdministrativeLocation("101270803", exactConflict).reason, /冲突行政记录/);

  const rootConflictRows: AdministrativeHierarchyRow[] = [
    ...rows,
    { locationId: "conflicting-root", locationName: "冲突根", provinceName: "四川省", cityName: "广安市", adCode: "512000" }
  ];
  const rootConflict = createAdministrativeHierarchy(rootConflictRows, { source: "fixture", fetchedAt: "2026-07-15T00:00:00.000Z" });
  const resolution = resolveAdministrativeLocation("101270803", rootConflict);
  assert.equal(resolution.cityAttribution, "ambiguous");
  assert.match(resolution.reason, /没有唯一/);
});
