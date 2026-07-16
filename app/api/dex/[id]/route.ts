import { NextRequest, NextResponse } from "next/server";
import { getDexEntry } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await getDexEntry(id);
  return entry
    ? NextResponse.json({ entry }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } })
    : NextResponse.json({ error: "dex_entry_not_found" }, { status: 404 });
}
