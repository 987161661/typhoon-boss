import { NextResponse } from "next/server";
import { sanitizeControlConsoleSettings } from "@/lib/controlConsoleSettings";
import { readControlConsoleSettings, updateControlConsoleSettings } from "@/lib/controlConsoleSettingsStore";
import { refreshTyphoonEvolutionScheduler } from "@/lib/typhoonEvolutionScheduler";
import { updateLiveControlSettings } from "@/lib/liveControlSettingsStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET() { return NextResponse.json({ settings: sanitizeControlConsoleSettings(await readControlConsoleSettings()) }, { headers }); }
export async function PATCH(request: Request) {
  try {
    const settings = await updateControlConsoleSettings(await request.json());
    await updateLiveControlSettings({
      evolutionAgentEnabled: settings.automation.evolutionEnabled,
      evolutionAgentIntervalMinutes: settings.automation.intervalMinutes
    });
    await refreshTyphoonEvolutionScheduler();
    return NextResponse.json({ settings: sanitizeControlConsoleSettings(settings) }, { headers });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "保存控制台配置失败" }, { status: 400, headers }); }
}
