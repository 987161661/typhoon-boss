import { NextRequest, NextResponse } from "next/server";
import { NATIONAL_NO_STORE_HEADERS, createNationalSituationResponse } from "@/lib/nationalWeatherResponse";
import { getNationalSituationSnapshot } from "@/lib/nationalWeatherService";
import { resolveServerAcceptanceScenario } from "@/lib/acceptanceScenarioServer";
import { createAcceptanceNationalSituation } from "@/lib/acceptanceScenarioFixtures";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const acceptanceScenario = resolveServerAcceptanceScenario(request.nextUrl.searchParams.get("acceptanceScenario"));
    const snapshot = acceptanceScenario
      ? createAcceptanceNationalSituation(acceptanceScenario)
      : await getNationalSituationSnapshot();
    return createNationalSituationResponse(snapshot, request.headers.get("if-none-match"));
  } catch (error) {
    return NextResponse.json(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        status: "unavailable",
        error: error instanceof Error ? error.message : "全国态势快照暂时不可用",
        limitations: ["接口失败不代表无预警、无台风或无气象风险。"]
      },
      { status: 503, headers: NATIONAL_NO_STORE_HEADERS }
    );
  }
}
