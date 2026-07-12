import { fetchCwaRadarImage } from "@/lib/environmentData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return fetchCwaRadarImage();
}
