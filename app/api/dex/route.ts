import { NextResponse } from "next/server";
import { getDataSourceLabel, getDexEntries } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(url.searchParams.get("pageSize")) || 24)));
    const allEntries = await getDexEntries(100);
    const entries = allEntries.slice((page - 1) * pageSize, page * pageSize);
    return NextResponse.json(
      {
        source: getDataSourceLabel(),
        updatedAt: new Date().toISOString(),
        count: entries.length,
        total: allEntries.length,
        page,
        pageSize,
        entries
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        source: getDataSourceLabel(),
        updatedAt: new Date().toISOString(),
        count: 0,
        entries: [],
        error: error instanceof Error ? error.message : "台风接口暂时不可用"
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }
}
