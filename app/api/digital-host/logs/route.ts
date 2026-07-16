import { NextResponse } from "next/server";
import { readDigitalHostServiceLog } from "@/lib/digitalHostServiceLog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("limit") || 100);
  const limit = Number.isFinite(requested) ? Math.min(500, Math.max(1, Math.floor(requested))) : 100;
  const events = await readDigitalHostServiceLog(limit);
  return NextResponse.json(
    { events },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
