import { NextResponse } from "next/server";
import { provinceGeoJson } from "@/lib/provinceGeo";

const DATAV_CHINA_PROVINCES = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json";

export async function GET() {
  try {
    const response = await fetch(DATAV_CHINA_PROVINCES, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TyphoonBossRadar/0.1"
      },
      next: { revalidate: 24 * 60 * 60 }
    });

    if (!response.ok) {
      throw new Error(`Province boundary request failed: ${response.status}`);
    }

    const geojson = await response.json();
    return NextResponse.json(geojson, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800"
      }
    });
  } catch {
    return NextResponse.json(provinceGeoJson, {
      headers: {
        "Cache-Control": "public, max-age=300"
      }
    });
  }
}
