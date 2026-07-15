import { NextRequest, NextResponse } from "next/server";
import { getCityBriefing, getCityLocation } from "@/lib/cityBriefingData";
import { resolveServerAcceptanceScenario } from "@/lib/acceptanceScenarioServer";
import { createOrdinaryCityBriefing } from "@/lib/acceptanceScenarioFixtures";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city")?.trim();
  if (!city) {
    return NextResponse.json({ error: "缺少 city 参数。" }, { status: 400, headers: noStoreHeaders() });
  }
  try {
    const acceptanceScenario = resolveServerAcceptanceScenario(request.nextUrl.searchParams.get("acceptanceScenario"));
    if (acceptanceScenario === "ordinary-city") {
      const briefing = createOrdinaryCityBriefing();
      return NextResponse.json(
        request.nextUrl.searchParams.get("stage") === "location" ? briefing.city : briefing,
        { headers: noStoreHeaders() }
      );
    }
    if (request.nextUrl.searchParams.get("stage") === "location") {
      return NextResponse.json(await getCityLocation(city), { headers: noStoreHeaders() });
    }
    return NextResponse.json(await getCityBriefing(city), { headers: noStoreHeaders() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "城市战况数据暂时不可用。" },
      { status: 502, headers: noStoreHeaders() }
    );
  }
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store, max-age=0" };
}
