export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTyphoonEvolutionScheduler } = await import("./instrumentation.node");
    startTyphoonEvolutionScheduler();
  }
}
