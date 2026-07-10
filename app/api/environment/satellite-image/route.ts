import { NextRequest } from "next/server";
import { fetchJmaImage } from "@/lib/environmentData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const region = request.nextUrl.searchParams.get("region") ?? "";
  const product = request.nextUrl.searchParams.get("product") ?? "";
  const frame = request.nextUrl.searchParams.get("frame") ?? "";
  return fetchJmaImage(region, product, frame);
}
