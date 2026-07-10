import { NextRequest } from "next/server";
import { fetchGlobalSatelliteImage } from "@/lib/environmentData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const frame = request.nextUrl.searchParams.get("frame") ?? "";
  return fetchGlobalSatelliteImage(frame);
}
