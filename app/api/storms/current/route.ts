import { NextResponse } from "next/server";
import { getTrackSnapshot } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const snapshot = await getTrackSnapshot();
    return NextResponse.json(
      {
        source: snapshot.source,
        observedAt: snapshot.observedAt,
        fetchedAt: snapshot.fetchedAt,
        updatedAt: snapshot.fetchedAt,
        status: snapshot.status,
        count: snapshot.storms.length,
        storms: snapshot.storms,
        // A storm leaving the upstream active list is a meaningful state
        // transition. Expose it so downstream clients distinguish ended from absent data.
        lastTrackedStorm: snapshot.lastTrackedStorm,
        warnings: snapshot.warnings
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        source: "Typhoon Boss Radar",
        updatedAt: new Date().toISOString(),
        count: 0,
        storms: [],
        lastTrackedStorm: null,
        error: error instanceof Error ? error.message : "Typhoon API temporarily unavailable."
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
