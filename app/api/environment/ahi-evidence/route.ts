import { NextRequest, NextResponse } from "next/server";
import { getAhiEvidenceForStorm } from "@/lib/bossEngine/ahiEvidence";
import { noStoreHeaders } from "@/lib/environmentData";
import { getCurrentStorms } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const stormId = request.nextUrl.searchParams.get("stormId");
  const storms = await getCurrentStorms();
  const storm = storms.find((item) => item.id === stormId) ?? storms[0] ?? null;

  if (!storm) {
    return NextResponse.json(
      {
        source: "noaa-himawari-ahi",
        status: "unavailable",
        sensor: "Himawari-9 AHI",
        dataset: "AHI-L1b-FLDK",
        bucket: "noaa-himawari9",
        slot: null,
        updatedAt: new Date().toISOString(),
        availableBands: [],
        bands: [],
        attribution: "NOAA Open Data / JMA Himawari-9 AHI",
        warnings: ["No active storm was available for AHI evidence selection."]
      },
      { headers: noStoreHeaders() }
    );
  }

  const payload = await getAhiEvidenceForStorm(storm);
  return NextResponse.json(payload, {
    headers: noStoreHeaders()
  });
}
