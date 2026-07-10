import { NextRequest, NextResponse } from "next/server";
import { getWindField, noStoreHeaders, type WindFieldBounds } from "@/lib/environmentData";
import { getRadarSnapshot } from "@/lib/radarSnapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const stormId = request.nextUrl.searchParams.get("stormId");
  const bounds = parseViewportBounds(request.nextUrl.searchParams);
  const payload = bounds ? await getWindField(stormId, bounds) : (await getRadarSnapshot(stormId)).environment.windField;
  return NextResponse.json(payload, {
    headers: noStoreHeaders()
  });
}

function parseViewportBounds(params: URLSearchParams): WindFieldBounds | null {
  const keys = ["west", "south", "east", "north"] as const;
  if (!keys.every((key) => params.has(key))) return null;
  const values = Object.fromEntries(keys.map((key) => [key, Number(params.get(key))])) as unknown as WindFieldBounds;
  if (!keys.every((key) => Number.isFinite(values[key]))) return null;
  return values;
}
