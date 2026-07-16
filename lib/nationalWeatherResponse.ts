import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { NationalSituationSnapshot } from "@/lib/nationalWeatherTypes";

export const NATIONAL_NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" } as const;

export function createNationalSituationResponse(snapshot: NationalSituationSnapshot, ifNoneMatch: string | null) {
  const body = JSON.stringify(snapshot);
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  if (ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: { ...NATIONAL_NO_STORE_HEADERS, ETag: etag } });
  }
  return new NextResponse(body, {
    headers: {
      ...NATIONAL_NO_STORE_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag
    }
  });
}
