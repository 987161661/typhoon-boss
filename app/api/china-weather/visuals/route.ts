import { NextResponse } from "next/server";
import { readChinaWeatherVisuals, refreshChinaWeatherVisuals } from "@/lib/chinaWeatherVisualFeed";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await readChinaWeatherVisuals() ?? await refreshChinaWeatherVisuals();
  return NextResponse.json({ ok: true, snapshot });
}
