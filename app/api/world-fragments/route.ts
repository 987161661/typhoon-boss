import { NextResponse } from "next/server";
import { consumeWorldFragment, warmWorldFragmentPool } from "@/lib/worldFragmentPool";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const result = await consumeWorldFragment();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST() {
  await warmWorldFragmentPool();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
