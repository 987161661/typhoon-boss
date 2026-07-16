import { NextRequest, NextResponse } from "next/server";
import { getGfsWaveLayer, noStoreHeaders, type WindFieldBounds } from "@/lib/environmentData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const bounds = parseViewportBounds(request.nextUrl.searchParams);
  if (!bounds) return NextResponse.json({ error: "A finite west/south/east/north viewport is required." }, { status: 400, headers: noStoreHeaders() });
  try {
    return NextResponse.json(await getGfsWaveLayer(bounds), { headers: noStoreHeaders() });
  } catch (error) {
    return NextResponse.json({ source: "NOAA/NCEP NOMADS Grib Filter", status: "unavailable", warnings: [error instanceof Error ? error.message : String(error)] }, { status: 503, headers: { ...noStoreHeaders(), "Retry-After": "120" } });
  }
}

function parseViewportBounds(params: URLSearchParams): WindFieldBounds | null {
  const keys = ["west", "south", "east", "north"] as const;
  const values = Object.fromEntries(keys.map((key) => [key, Number(params.get(key))])) as unknown as WindFieldBounds;
  if (!keys.every((key) => params.has(key) && Number.isFinite(values[key]))) return null;
  return values.east > values.west && values.north > values.south ? values : null;
}
