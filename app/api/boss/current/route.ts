import { NextResponse } from "next/server";
import { buildBossProfiles } from "@/lib/bossEngine";
import { getCurrentStorms, getDataSourceLabel } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const storms = await getCurrentStorms();
    const bosses = await buildBossProfiles(storms);
    return NextResponse.json(
      {
        source: {
          primary: "中央气象台 / 国家气象中心台风产品",
          machineReadableTrackSource: getDataSourceLabel(),
          updatedAt: new Date().toISOString()
        },
        count: bosses.length,
        bosses,
        degraded: false,
        warnings: bosses.length
          ? ["当前 Boss 技能由机器可读路径源生成；全国权威口径以中央气象台/国家气象中心和属地气象应急部门为准。"]
          : []
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        source: {
          primary: "中央气象台 / 国家气象中心台风产品",
          machineReadableTrackSource: getDataSourceLabel(),
          updatedAt: new Date().toISOString()
        },
        count: 0,
        bosses: [],
        degraded: true,
        warnings: [error instanceof Error ? error.message : "Boss 引擎暂时不可用"]
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }
}
