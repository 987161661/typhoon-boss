import { NextResponse } from "next/server";
import { getRadarSnapshot } from "@/lib/radarSnapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const snapshot = await getRadarSnapshot();
    return NextResponse.json(
      {
        source: snapshot.source,
        updatedAt: snapshot.updatedAt,
        count: snapshot.storms.length,
        storms: snapshot.storms,
        cache: snapshot.cache
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
