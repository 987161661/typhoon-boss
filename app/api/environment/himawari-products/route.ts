import { NextRequest, NextResponse } from "next/server";
import { getHimawariProductsForStorm } from "@/lib/bossEngine/satelliteProducts";
import { noStoreHeaders } from "@/lib/environmentData";
import { getCurrentStorms } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const stormId = request.nextUrl.searchParams.get("stormId");
  const storms = await getCurrentStorms();
  const storm = storms.find((item) => item.id === stormId) ?? storms[0] ?? null;

  if (!storm) {
    return NextResponse.json(
      {
        source: "jma-himawari",
        status: "unavailable",
        updatedAt: new Date().toISOString(),
        area: null,
        availableProducts: [],
        products: [],
        warnings: ["当前没有活动台风，未选择 Himawari 产品区域。"]
      },
      { headers: noStoreHeaders() }
    );
  }

  const payload = await getHimawariProductsForStorm(storm);
  return NextResponse.json(payload, {
    headers: noStoreHeaders()
  });
}
