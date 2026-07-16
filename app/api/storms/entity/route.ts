import { NextRequest, NextResponse } from "next/server";
import { findTyphoonLifecycle } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const result = await findTyphoonLifecycle(query);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (error) {
    return NextResponse.json(
      { status: "unavailable", query, error: error instanceof Error ? error.message : "Typhoon archive temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
