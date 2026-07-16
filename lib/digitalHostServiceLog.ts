import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

const LOG_PATH = path.join(process.cwd(), "runtime", "logs", "digital-host-service.jsonl");
let writeQueue: Promise<void> = Promise.resolve();

export type DigitalHostServiceLogEvent = {
  at?: number;
  event: string;
  requestId?: string;
  channel?: "postmessage" | "http-fallback" | "virtual-runtime";
  reasons?: string[];
  status?: number;
  error?: string;
  textLength?: number;
};

function cleanText(value: string, limit: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function chatTextMetadata(text: string) {
  return {
    textLength: text.length
  };
}

export async function appendDigitalHostServiceLog(event: DigitalHostServiceLogEvent) {
  const record = {
    at: event.at ?? Date.now(),
    ...event,
    reasons: event.reasons?.slice(0, 8).map((reason) => cleanText(reason, 160)),
    error: event.error ? cleanText(event.error, 300) : undefined
  };
  const line = `${JSON.stringify(record)}\n`;
  const task = writeQueue.then(async () => {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    const size = await stat(LOG_PATH).then((value) => value.size).catch(() => 0);
    if (size > 5 * 1024 * 1024) await rename(LOG_PATH, `${LOG_PATH}.1`).catch(() => undefined);
    await appendFile(LOG_PATH, line, "utf8");
  });
  writeQueue = task.catch(() => undefined);
  await task;
}

export async function readDigitalHostServiceLog(limit: number) {
  try {
    const raw = await readFile(LOG_PATH, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as DigitalHostServiceLogEvent & { textPreview?: unknown };
          delete parsed.textPreview;
          return [parsed];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export { LOG_PATH as DIGITAL_HOST_SERVICE_LOG_PATH };
