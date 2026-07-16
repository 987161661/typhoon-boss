export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRuntimeBackgroundWork } = await import("./instrumentation.node");
    startRuntimeBackgroundWork();
  }
}
