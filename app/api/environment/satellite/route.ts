import { NextResponse } from "next/server";
import { getSatelliteLayer, noStoreHeaders } from "@/lib/environmentData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const payload = await getSatelliteLayer();
  return NextResponse.json(payload, {
    headers: noStoreHeaders()
  });
}
