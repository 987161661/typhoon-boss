import { NextResponse } from "next/server";
import { getCurrentStorms, getDataSourceLabel } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const storms = await getCurrentStorms();
    return NextResponse.json(
      {
        source: getDataSourceLabel(),
        updatedAt: new Date().toISOString(),
        count: storms.length,
        storms
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
        storms: [],
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
