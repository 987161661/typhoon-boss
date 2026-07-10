import { getDexEntries } from "@/lib/realTyphoonData";
import DexAtlas from "@/components/DexAtlas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DexPage() {
  const entries = await loadDexEntries();
  return <DexAtlas entries={entries} />;
}

async function loadDexEntries() {
  try {
    return await getDexEntries(100);
  } catch {
    return [];
  }
}
