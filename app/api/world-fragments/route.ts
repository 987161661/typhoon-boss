import { NextResponse } from "next/server";
import { getWorldFragmentRuntimeStatus, warmWorldFragmentPool } from "@/lib/worldFragmentPool";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const status = await getWorldFragmentRuntimeStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST() {
  await warmWorldFragmentPool();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
