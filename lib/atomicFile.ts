import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const writeTails = new Map<string, Promise<void>>();

export async function writeFileAtomic(
  targetPath: string,
  contents: string | Uint8Array
): Promise<void> {
  const previous = writeTails.get(targetPath) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(() =>
    writeFileAtomicNow(targetPath, contents)
  );
  writeTails.set(targetPath, operation);
  try {
    await operation;
  } finally {
    if (writeTails.get(targetPath) === operation) writeTails.delete(targetPath);
  }
}

async function writeFileAtomicNow(
  targetPath: string,
  contents: string | Uint8Array
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
