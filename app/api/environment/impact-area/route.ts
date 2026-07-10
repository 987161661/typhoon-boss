import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/environmentData";
import { getRadarSnapshot } from "@/lib/radarSnapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const stormId = request.nextUrl.searchParams.get("stormId");
  const payload = (await getRadarSnapshot(stormId)).environment.impactArea;
  return NextResponse.json(payload, {
    headers: noStoreHeaders()
  });
}
