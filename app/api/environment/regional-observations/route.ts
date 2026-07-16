import { getRegionalObservations } from "@/lib/regionalObservations";
import { noStoreHeaders } from "@/lib/environmentData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const payload = await getRegionalObservations();
  return Response.json(payload, { status: payload.status === "available" ? 200 : 503, headers: payload.status === "available" ? noStoreHeaders() : { ...noStoreHeaders(), "Retry-After": "120" } });
}
