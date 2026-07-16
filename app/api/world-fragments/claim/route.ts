import { NextResponse } from "next/server";
import {
  claimWorldFragment,
  type ClaimWorldFragmentInput,
  type WorldFragmentAccessSource
} from "@/lib/worldFragmentPool";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<ClaimWorldFragmentInput>;
    const result = await claimWorldFragment({
      requestId: body.requestId ?? "",
      cityKey: body.cityKey ?? "",
      platform: body.platform ?? "",
      viewerId: body.viewerId ?? "",
      accessSource: body.accessSource as WorldFragmentAccessSource
    });
    return NextResponse.json(result, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid claim request";
    return NextResponse.json({ error: message }, { status: 400, headers: noStoreHeaders() });
  }
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store, max-age=0" };
}
