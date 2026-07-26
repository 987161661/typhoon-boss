export interface CityBriefingRequestOptions<T> {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  retryDelayMs?: number;
  maxAttempts?: number;
  shouldRetryResult?: (value: T) => boolean;
}

export async function fetchCityBriefingWithRetry<T>(
  url: string,
  options: CityBriefingRequestOptions<T> = {}
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 300;
  const maxAttempts = Math.max(1, Math.min(5, options.maxAttempts ?? 2));
  let lastSuccessfulResult: T | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetcher(url, {
        cache: "no-store",
        signal: options.signal
      });
      if (response.ok) {
        const result = await response.json() as T;
        if (attempt < maxAttempts - 1 && options.shouldRetryResult?.(result)) {
          lastSuccessfulResult = result;
          await waitForRetry(retryDelayMs * (2 ** attempt), options.signal);
          continue;
        }
        return result;
      }

      const body = await response.json().catch(() => null) as { error?: string } | null;
      const error = new CityBriefingHttpError(
        response.status,
        body?.error ?? `HTTP ${response.status}`
      );
      if (attempt < maxAttempts - 1 && isTransientStatus(response.status)) {
        await waitForRetry(retryDelayMs * (2 ** attempt), options.signal);
        continue;
      }
      if (lastSuccessfulResult !== undefined) return lastSuccessfulResult;
      throw error;
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) throw error;
      if (attempt < maxAttempts - 1 && !(error instanceof CityBriefingHttpError)) {
        await waitForRetry(retryDelayMs * (2 ** attempt), options.signal);
        continue;
      }
      if (lastSuccessfulResult !== undefined) return lastSuccessfulResult;
      throw error;
    }
  }
  if (lastSuccessfulResult !== undefined) return lastSuccessfulResult;
  throw new Error("城市资料请求未完成。");
}

class CityBriefingHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "CityBriefingHttpError";
  }
}

function isTransientStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
