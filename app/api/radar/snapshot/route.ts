import { NextRequest, NextResponse } from "next/server";
import { getRadarSnapshot } from "@/lib/radarSnapshot";
import { createHash } from "node:crypto";
import { recordSnapshot } from "@/lib/runtimeMetrics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const stormId = request.nextUrl.searchParams.get("stormId");

  try {
    const startedAt = Date.now();
    const snapshot = await getRadarSnapshot(stormId);
    const etag = `"${createHash("sha1").update(`${snapshot.activeStormId}:${snapshot.cache.stormUpdatedAt}:${snapshot.cache.derivedGeneratedAt}`).digest("hex")}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store, max-age=0" } });
    }
    const body = JSON.stringify(snapshot);
    recordSnapshot(Buffer.byteLength(body), Date.now() - startedAt, snapshot.bosses.length);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        ETag: etag
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        source: "Typhoon Boss Radar",
        updatedAt: new Date().toISOString(),
        activeStormId: null,
        storms: [],
        lastTrackedStorm: null,
        bosses: [],
        environment: null,
        warnings: [error instanceof Error ? error.message : "Radar snapshot temporarily unavailable."]
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }
}
