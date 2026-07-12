import { NextResponse } from "next/server";
import { getTrackSnapshot } from "@/lib/realTyphoonData";
import { runtimeMetrics } from "@/lib/runtimeMetrics";

export const dynamic = "force-dynamic";

export async function GET() {
  const track = await getTrackSnapshot();
  const observedAt = Date.parse(track.observedAt ?? "");
  return NextResponse.json({
    status: track.status === "unavailable" ? "degraded" : "ok",
    generatedAt: new Date().toISOString(),
    track: {
      status: track.status,
      stormCount: track.storms.length,
      observedAt: track.observedAt,
      ageSeconds: Number.isFinite(observedAt) ? Math.max(0, Math.round((Date.now() - observedAt) / 1000)) : null,
      warnings: track.warnings
    },
    radar: runtimeMetrics()
  }, { headers: { "Cache-Control": "no-store" } });
}
