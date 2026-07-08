import { NextRequest, NextResponse } from "next/server";
import { getWindField, noStoreHeaders } from "@/lib/environmentData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const stormId = request.nextUrl.searchParams.get("stormId");
  const payload = await getWindField(stormId);
  return NextResponse.json(payload, {
    headers: noStoreHeaders()
  });
}
