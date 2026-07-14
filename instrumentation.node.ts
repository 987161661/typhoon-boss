import { startTyphoonEvolutionScheduler } from "./lib/typhoonEvolutionScheduler";
import { warmWorldFragmentPool } from "./lib/worldFragmentPool";

export function startRuntimeBackgroundWork() {
  startTyphoonEvolutionScheduler();
  void warmWorldFragmentPool().catch((error) => console.warn("[world-fragments] warmup failed", error));
}
