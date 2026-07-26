export const CHUNK_LOAD_RECOVERY_SCRIPT = String.raw`
(() => {
  const recoveryKey = "typhoon-boss-radar:chunk-recovery-at";
  const cooldownMs = 15_000;
  const failurePattern =
    /ChunkLoadError|Loading chunk [^ ]+ failed|Failed to fetch dynamically imported module/i;

  const describe = (value) => {
    if (typeof value === "string") return value;
    if (!value) return "";
    if (typeof value.message === "string") {
      return value.name ? value.name + ": " + value.message : value.message;
    }
    return String(value);
  };

  const recover = (value) => {
    if (!failurePattern.test(describe(value))) return;
    const now = Date.now();
    let previous = 0;
    try {
      previous = Number(sessionStorage.getItem(recoveryKey) || 0);
    } catch {}
    if (now - previous < cooldownMs) return;
    try {
      sessionStorage.setItem(recoveryKey, String(now));
    } catch {}
    const next = new URL(location.href);
    next.searchParams.set("__chunk_retry", String(now));
    location.replace(next.toString());
  };

  addEventListener("error", (event) => {
    recover(event.error || event.message || event.target?.src);
  });
  addEventListener("unhandledrejection", (event) => {
    recover(event.reason);
  });
})();
`;
