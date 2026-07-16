import { getEcmwfTracks } from "@/lib/ecmwfTracks";
import { noStoreHeaders } from "@/lib/environmentData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const payload = await getEcmwfTracks();
  return Response.json(payload, { status: payload.status === "available" ? 200 : 503, headers: payload.status === "available" ? noStoreHeaders() : { ...noStoreHeaders(), "Retry-After": "180" } });
}
