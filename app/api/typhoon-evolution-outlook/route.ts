import { NextResponse } from "next/server";
import { readTyphoonEvolutionOutlook } from "@/lib/typhoonEvolutionOutlookStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await readTyphoonEvolutionOutlook();
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
