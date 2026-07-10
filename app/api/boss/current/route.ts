import { NextResponse } from "next/server";
import { getRadarSnapshot } from "@/lib/radarSnapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const snapshot = await getRadarSnapshot();
    const firstBoss = snapshot.bosses[0] ?? null;
    return NextResponse.json(
      {
        source: {
          primary:
            firstBoss?.sourcePolicy.canonicalAuthority ??
            "Official warnings remain the source of truth; this API only provides machine-readable radar analysis.",
          machineReadableTrackSource: snapshot.source,
          updatedAt: snapshot.updatedAt
        },
        count: snapshot.bosses.length,
        bosses: snapshot.bosses,
        degraded: snapshot.warnings.length > 0,
        warnings: snapshot.warnings,
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
        source: {
          primary: "Official warnings remain the source of truth.",
          machineReadableTrackSource: "Typhoon Boss Radar",
          updatedAt: new Date().toISOString()
        },
        count: 0,
        bosses: [],
        degraded: true,
        warnings: [error instanceof Error ? error.message : "Boss engine temporarily unavailable."]
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
