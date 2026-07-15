import { NextResponse } from "next/server";
import { readChinaWeatherProducts } from "@/lib/chinaWeatherProductFeed";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await readChinaWeatherProducts();
  if (!snapshot) return NextResponse.json({ ok: false, error: "product snapshot unavailable" }, { status: 503 });
  return NextResponse.json({ ok: true, ...snapshot });
}
