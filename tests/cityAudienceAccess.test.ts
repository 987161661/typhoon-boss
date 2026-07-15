import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CityAudienceAccessValidationError,
  cityAudienceAccessKey,
  normalizeCityAudienceIdentity,
  resolveAudienceAccessSource
} from "@/lib/cityAudienceAccess";
import {
  CityAudienceAccessDuplicateError,
  createCityAudienceAccessStore
} from "@/lib/cityAudienceAccessStore";

test("identity key normalizes platform but keeps viewerId case-sensitive", () => {
  const upperPlatform = normalizeCityAudienceIdentity(" BiliBili ", " Viewer-A ");
  const lowerViewer = normalizeCityAudienceIdentity("bilibili", "viewer-a");
  assert.deepEqual(upperPlatform, { platform: "bilibili", viewerId: "Viewer-A" });
  assert.notEqual(cityAudienceAccessKey(upperPlatform), cityAudienceAccessKey(lowerViewer));
});

test("access source never rewrites unknown as not-following", () => {
  assert.equal(resolveAudienceAccessSource({ observedFollowing: true, whitelisted: true }), "observed");
  assert.equal(resolveAudienceAccessSource({ whitelisted: true }), "whitelist");
  assert.equal(resolveAudienceAccessSource({ whitelisted: false }), "unknown");
});

test("strict validation rejects missing, oversized, malformed, and control-character identities", () => {
  assert.throws(() => normalizeCityAudienceIdentity("", "viewer"), CityAudienceAccessValidationError);
  assert.throws(() => normalizeCityAudienceIdentity("platform with spaces", "viewer"), CityAudienceAccessValidationError);
  assert.throws(() => normalizeCityAudienceIdentity("a".repeat(33), "viewer"), CityAudienceAccessValidationError);
  assert.throws(() => normalizeCityAudienceIdentity("bilibili", "v".repeat(129)), CityAudienceAccessValidationError);
  assert.throws(() => normalizeCityAudienceIdentity("bilibili", "viewer\n2"), CityAudienceAccessValidationError);
});

test("runtime store atomically adds, resolves, rejects duplicates, and removes exact ids", async () => {
  const fixture = await createStoreFixture();
  try {
    const entry = await fixture.store.add({ platform: " BiliBili ", viewerId: " User-ABC ", note: " 历史关注证明 " });
    assert.deepEqual({ platform: entry.platform, viewerId: entry.viewerId, note: entry.note }, {
      platform: "bilibili",
      viewerId: "User-ABC",
      note: "历史关注证明"
    });
    assert.equal(await fixture.store.resolve("BILIBILI", "User-ABC"), "whitelist");
    assert.equal(await fixture.store.resolve("bilibili", "user-abc"), "unknown");
    await assert.rejects(
      fixture.store.add({ platform: "bilibili", viewerId: "User-ABC" }),
      CityAudienceAccessDuplicateError
    );
    assert.equal(await fixture.store.remove({ platform: "BILIBILI", viewerId: "user-abc" }), false);
    assert.equal(await fixture.store.remove({ platform: "BILIBILI", viewerId: "User-ABC" }), true);
    assert.equal(await fixture.store.resolve("bilibili", "User-ABC"), "unknown");

    const disk = JSON.parse(await readFile(fixture.filePath, "utf8")) as { schemaVersion: number; entries: unknown[] };
    assert.equal(disk.schemaVersion, 1);
    assert.deepEqual(disk.entries, []);
    assert.deepEqual((await readdir(fixture.directory)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await fixture.cleanup();
  }
});

test("serialized concurrent mutations do not lose distinct viewers", async () => {
  const fixture = await createStoreFixture();
  try {
    await Promise.all(Array.from({ length: 12 }, (_, index) => fixture.store.add({
      platform: "bilibili",
      viewerId: `viewer-${index}`,
      note: `fixture-${index}`
    })));
    const entries = await fixture.store.list();
    assert.equal(entries.length, 12);
    assert.equal(new Set(entries.map((entry) => cityAudienceAccessKey(entry))).size, 12);
  } finally {
    await fixture.cleanup();
  }
});

test("API and console remain independent from generic live settings and never expose nickname matching", async () => {
  const route = await readProjectFile("app/api/city-audience-access/route.ts");
  const consoleSource = await readProjectFile("components/ControlConsole.tsx");
  const core = await readProjectFile("lib/cityAudienceAccess.ts");
  const store = await readProjectFile("lib/cityAudienceAccessStore.ts");
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /platform/);
  assert.match(route, /viewerId/);
  assert.match(consoleSource, /未知不等于未关注/);
  assert.match(consoleSource, /\/api\/city-audience-access/);
  assert.doesNotMatch(`${route}\n${core}\n${store}`, /nickname|displayName|viewerName|昵称/);
  assert.doesNotMatch(`${route}\n${store}`, /liveControlSettings|control-console\.json/);
  assert.match(store, /\.runtime["'], "city-audience-access\.json/);
  assert.match(store, /rename\(temporaryPath, filePath\)/);
});

async function createStoreFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "city-audience-access-"));
  const filePath = path.join(directory, "city-audience-access.json");
  const store = createCityAudienceAccessStore({
    filePath,
    now: () => new Date("2026-07-15T08:00:00.000Z")
  });
  return {
    directory,
    filePath,
    store,
    cleanup: () => rm(directory, { recursive: true, force: true })
  };
}

async function readProjectFile(relativePath: string) {
  return readFile(path.resolve(process.cwd(), relativePath), "utf8");
}
