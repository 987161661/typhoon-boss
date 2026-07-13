import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TILE_SIZE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 6;
const MAX_CACHE_ENTRIES = 384;
const TERRARIUM_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const tileCache = new Map<string, Promise<Buffer | null>>();

export async function GET(
  _request: Request,
  context: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const params = await context.params;
  const z = Number(params.z);
  const x = Number(params.x);
  const y = Number(params.y);
  const maxIndex = Number.isInteger(z) ? 2 ** z - 1 : -1;
  if (
    !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) ||
    z < MIN_ZOOM || z > MAX_ZOOM || x < 0 || y < 0 || x > maxIndex || y > maxIndex
  ) {
    return new Response("Invalid terrain tile", { status: 400 });
  }

  const key = `${z}/${x}/${y}`;
  let pending = tileCache.get(key);
  if (!pending) {
    if (tileCache.size >= MAX_CACHE_ENTRIES) tileCache.clear();
    pending = createColoredTerrainTile(z, x, y);
    tileCache.set(key, pending);
  }
  const tile = await pending;
  if (!tile) {
    tileCache.delete(key);
    return new Response("Terrain tile unavailable", { status: 502 });
  }

  return new Response(new Uint8Array(tile), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000"
    }
  });
}

async function createColoredTerrainTile(z: number, x: number, y: number) {
  try {
    const url = TERRARIUM_TILE_URL
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return null;

    const { data, info } = await sharp(await response.arrayBuffer())
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== TILE_SIZE || info.height !== TILE_SIZE || info.channels !== 4) return null;

    for (let index = 0; index < data.length; index += 4) {
      const elevation = data[index] * 256 + data[index + 1] + data[index + 2] / 256 - 32768;
      const color = terrainBandColor(elevation);
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = color[3];
    }

    return await sharp(data, { raw: info }).png({ compressionLevel: 4 }).toBuffer();
  } catch {
    return null;
  }
}

function terrainBandColor(elevation: number): readonly [number, number, number, number] {
  if (elevation <= 5) return [0, 0, 0, 0];
  if (elevation < 80) return [39, 151, 127, 116];
  if (elevation < 250) return [92, 164, 94, 132];
  if (elevation < 700) return [188, 164, 70, 148];
  if (elevation < 1400) return [213, 116, 50, 164];
  if (elevation < 2600) return [181, 67, 55, 178];
  return [238, 220, 184, 192];
}
