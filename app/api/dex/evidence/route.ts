import { NextRequest, NextResponse } from "next/server";
import { getGdacsEvidence } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name") ?? "";
  const startedAt = request.nextUrl.searchParams.get("startedAt");
  const endedAt = request.nextUrl.searchParams.get("endedAt");
  const gdacs = await getGdacsEvidence(name, startedAt, endedAt);
  return NextResponse.json({ gdacs }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
