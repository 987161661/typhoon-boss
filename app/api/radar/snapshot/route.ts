import { NextRequest, NextResponse } from "next/server";
import { getRadarSnapshot } from "@/lib/radarSnapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const stormId = request.nextUrl.searchParams.get("stormId");

  try {
    const snapshot = await getRadarSnapshot(stormId);
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        source: "Typhoon Boss Radar",
        updatedAt: new Date().toISOString(),
        activeStormId: null,
        storms: [],
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
