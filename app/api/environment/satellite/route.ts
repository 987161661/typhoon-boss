import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/environmentData";
import { getRadarSnapshot } from "@/lib/radarSnapshot";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const payload = (await getRadarSnapshot()).environment.satellite;
  return NextResponse.json(payload, {
    headers: noStoreHeaders()
  });
}
