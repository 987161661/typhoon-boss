import { NextRequest, NextResponse } from "next/server";
import { getDataSourceLabel, getProvinceDefenseStatus } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const province = request.nextUrl.searchParams.get("province") ?? "浙江";
  const stormId = request.nextUrl.searchParams.get("stormId") ?? undefined;

  try {
    const defense = await getProvinceDefenseStatus(province, stormId);
    return NextResponse.json(
      {
        source: getDataSourceLabel(),
        defense
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
