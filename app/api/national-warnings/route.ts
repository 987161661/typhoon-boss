import { NextResponse } from "next/server";
import { readChinaWeatherWarnings } from "@/lib/chinaWeatherWarningFeed";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await readChinaWeatherWarnings();
  if (!snapshot) return NextResponse.json({ ok: false, error: "warning snapshot unavailable" }, { status: 503 });
  return NextResponse.json({ ok: true, ...snapshot });
}
