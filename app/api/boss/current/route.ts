import { NextResponse } from "next/server";
import { buildBossProfiles } from "@/lib/bossEngine";
import { getTrackSnapshot } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const track = await getTrackSnapshot();
    const bosses = await buildBossProfiles(track.storms);
    const firstBoss = bosses[0] ?? null;
    return NextResponse.json(
      {
        source: {
          primary:
            firstBoss?.sourcePolicy.canonicalAuthority ??
            "Official warnings remain the source of truth; this API only provides machine-readable radar analysis.",
          machineReadableTrackSource: track.source,
          updatedAt: track.fetchedAt
        },
        observedAt: track.observedAt,
        fetchedAt: track.fetchedAt,
        status: track.status,
        count: bosses.length,
        bosses,
        degraded: track.warnings.length > 0,
        warnings: track.warnings
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
