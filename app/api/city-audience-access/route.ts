import { NextResponse } from "next/server";
import { CityAudienceAccessValidationError } from "@/lib/cityAudienceAccess";
import {
  CityAudienceAccessDuplicateError,
  addCityAudienceAccess,
  listCityAudienceAccess,
  removeCityAudienceAccess,
  resolveCityAudienceAccess
} from "@/lib/cityAudienceAccessStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const platform = url.searchParams.get("platform");
    const viewerId = url.searchParams.get("viewerId");
    if (platform === null && viewerId === null) {
      return NextResponse.json({ entries: await listCityAudienceAccess() }, { headers: NO_STORE_HEADERS });
    }
    if (platform === null || viewerId === null) {
      throw new CityAudienceAccessValidationError("精确查询必须同时提供 platform 和 viewerId。");
    }
    const source = await resolveCityAudienceAccess(platform, viewerId);
    return NextResponse.json({ platform: platform.trim().toLowerCase(), viewerId: viewerId.trim(), source }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readObjectBody(request);
    const entry = await addCityAudienceAccess({
      platform: body.platform,
      viewerId: body.viewerId,
      note: body.note
    });
    return NextResponse.json({ entry }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readObjectBody(request);
    const removed = await removeCityAudienceAccess({ platform: body.platform, viewerId: body.viewerId });
    if (!removed) {
      return NextResponse.json({ error: "未找到该精确身份记录。" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({ removed: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

async function readObjectBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json() as unknown;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new CityAudienceAccessValidationError("请求体必须是 JSON 对象。");
  }
  return body as Record<string, unknown>;
}

function errorResponse(error: unknown) {
  const status = error instanceof CityAudienceAccessDuplicateError
    ? 409
    : error instanceof CityAudienceAccessValidationError || error instanceof SyntaxError
      ? 400
      : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "观众权限操作失败。" },
    { status, headers: NO_STORE_HEADERS }
  );
}
