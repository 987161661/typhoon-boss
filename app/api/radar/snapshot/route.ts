import { NextRequest, NextResponse } from "next/server";
import { getRadarSnapshot } from "@/lib/radarSnapshot";
import { recordSnapshot } from "@/lib/runtimeMetrics";
import { resolveServerAcceptanceScenario } from "@/lib/acceptanceScenarioServer";
import { createAcceptanceRadarSnapshot } from "@/lib/acceptanceScenarioFixtures";
import { createRadarSnapshotResponse } from "@/lib/radarSnapshotResponse";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const stormId = request.nextUrl.searchParams.get("stormId");

  try {
    const startedAt = Date.now();
    const acceptanceScenario = resolveServerAcceptanceScenario(request.nextUrl.searchParams.get("acceptanceScenario"));
    const snapshot = acceptanceScenario
      ? createAcceptanceRadarSnapshot(acceptanceScenario)
      : await getRadarSnapshot(stormId);
    const body = JSON.stringify(snapshot);
    recordSnapshot(Buffer.byteLength(body), Date.now() - startedAt, snapshot.bosses.length);
    return createRadarSnapshotResponse(snapshot, request.headers.get("if-none-match"));
  } catch (error) {
    return NextResponse.json(
      {
        source: "Weather Boss Radar",
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
