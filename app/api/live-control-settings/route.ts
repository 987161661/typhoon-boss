import { NextResponse } from "next/server";
import {
  readLiveControlSettings,
  updateLiveControlSettings
} from "@/lib/liveControlSettingsStore";
import {
  getTyphoonEvolutionSchedulerStatus,
  refreshTyphoonEvolutionScheduler
} from "@/lib/typhoonEvolutionScheduler";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, max-age=0"
};

export async function GET() {
  const settings = await readLiveControlSettings();
  return NextResponse.json(
    { settings, scheduler: getTyphoonEvolutionSchedulerStatus() },
    { headers: NO_CACHE_HEADERS }
  );
}

export async function PATCH(request: Request) {
  try {
    const patch = (await request.json()) as Record<string, unknown>;
    const settings = await updateLiveControlSettings(patch);
    await refreshTyphoonEvolutionScheduler();
    return NextResponse.json(
      { settings, scheduler: getTyphoonEvolutionSchedulerStatus() },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存直播设置失败" },
      { status: 400, headers: NO_CACHE_HEADERS }
    );
  }
}
