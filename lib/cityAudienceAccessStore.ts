import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CityAudienceAccessValidationError,
  cityAudienceAccessKey,
  normalizeCityAudienceIdentity,
  normalizeCityAudienceNote,
  resolveAudienceAccessSource,
  type AudienceAccessSource,
  type CityAudienceAccessEntry
} from "@/lib/cityAudienceAccess";

const DEFAULT_ACCESS_PATH = path.join(process.cwd(), ".runtime", "city-audience-access.json");

interface CityAudienceAccessFile {
  schemaVersion: 1;
  updatedAt: string;
  entries: CityAudienceAccessEntry[];
}

export class CityAudienceAccessDuplicateError extends Error {
  constructor() {
    super("该 platform + viewerId 已存在于白名单中。");
    this.name = "CityAudienceAccessDuplicateError";
  }
}

export interface CityAudienceAccessStore {
  list(): Promise<CityAudienceAccessEntry[]>;
  add(input: { platform: unknown; viewerId: unknown; note?: unknown }): Promise<CityAudienceAccessEntry>;
  remove(input: { platform: unknown; viewerId: unknown }): Promise<boolean>;
  resolve(platform: unknown, viewerId: unknown): Promise<AudienceAccessSource>;
}

export function createCityAudienceAccessStore(options: {
  filePath?: string;
  now?: () => Date;
} = {}): CityAudienceAccessStore {
  const filePath = options.filePath ?? DEFAULT_ACCESS_PATH;
  const now = options.now ?? (() => new Date());
  let mutationQueue: Promise<void> = Promise.resolve();

  const readSnapshot = async (): Promise<CityAudienceAccessFile> => {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (isFileNotFound(error)) return emptySnapshot(now());
      throw error;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
      throw new CityAudienceAccessValidationError("观众权限文件格式无效。");
    }
    const entries = parsed.entries.map(parseStoredEntry);
    const keys = new Set<string>();
    for (const entry of entries) {
      const key = cityAudienceAccessKey(entry);
      if (keys.has(key)) throw new CityAudienceAccessValidationError("观众权限文件包含重复身份。");
      keys.add(key);
    }
    return {
      schemaVersion: 1,
      updatedAt: validIsoDate(parsed.updatedAt, "updatedAt"),
      entries
    };
  };

  const writeSnapshot = async (entries: CityAudienceAccessEntry[]) => {
    const snapshot: CityAudienceAccessFile = {
      schemaVersion: 1,
      updatedAt: now().toISOString(),
      entries
    };
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await rename(temporaryPath, filePath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  };

  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    async list() {
      const snapshot = await readSnapshot();
      return [...snapshot.entries]
        .sort((a, b) => a.platform.localeCompare(b.platform) || a.viewerId.localeCompare(b.viewerId))
        .map((entry) => ({ ...entry }));
    },
    add(input) {
      return mutate(async () => {
        const identity = normalizeCityAudienceIdentity(input.platform, input.viewerId);
        const note = normalizeCityAudienceNote(input.note);
        const snapshot = await readSnapshot();
        const key = cityAudienceAccessKey(identity);
        if (snapshot.entries.some((entry) => cityAudienceAccessKey(entry) === key)) {
          throw new CityAudienceAccessDuplicateError();
        }
        const timestamp = now().toISOString();
        const entry: CityAudienceAccessEntry = { ...identity, note, createdAt: timestamp, updatedAt: timestamp };
        await writeSnapshot([...snapshot.entries, entry]);
        return { ...entry };
      });
    },
    remove(input) {
      return mutate(async () => {
        const identity = normalizeCityAudienceIdentity(input.platform, input.viewerId);
        const snapshot = await readSnapshot();
        const key = cityAudienceAccessKey(identity);
        const entries = snapshot.entries.filter((entry) => cityAudienceAccessKey(entry) !== key);
        if (entries.length === snapshot.entries.length) return false;
        await writeSnapshot(entries);
        return true;
      });
    },
    async resolve(platform, viewerId) {
      const identity = normalizeCityAudienceIdentity(platform, viewerId);
      const snapshot = await readSnapshot();
      const key = cityAudienceAccessKey(identity);
      const whitelisted = snapshot.entries.some((entry) => cityAudienceAccessKey(entry) === key);
      return resolveAudienceAccessSource({ whitelisted });
    }
  };
}

const defaultStore = createCityAudienceAccessStore();

export const listCityAudienceAccess = () => defaultStore.list();
export const addCityAudienceAccess = (input: { platform: unknown; viewerId: unknown; note?: unknown }) => defaultStore.add(input);
export const removeCityAudienceAccess = (input: { platform: unknown; viewerId: unknown }) => defaultStore.remove(input);
export const resolveCityAudienceAccess = (platform: unknown, viewerId: unknown) => defaultStore.resolve(platform, viewerId);

function emptySnapshot(now: Date): CityAudienceAccessFile {
  return { schemaVersion: 1, updatedAt: now.toISOString(), entries: [] };
}

function parseStoredEntry(value: unknown): CityAudienceAccessEntry {
  if (!isRecord(value)) throw new CityAudienceAccessValidationError("观众权限记录格式无效。");
  const identity = normalizeCityAudienceIdentity(value.platform, value.viewerId);
  return {
    ...identity,
    note: normalizeCityAudienceNote(value.note),
    createdAt: validIsoDate(value.createdAt, "createdAt"),
    updatedAt: validIsoDate(value.updatedAt, "updatedAt")
  };
}

function validIsoDate(value: unknown, label: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new CityAudienceAccessValidationError(`${label} 必须是有效时间。`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
