import assert from "node:assert/strict";
import test from "node:test";
import { fetchCityBriefingWithRetry } from "../lib/cityBriefingClient";

test("a transient cold-start 502 is retried before a city interaction is failed", async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return Response.json({ error: "城市资料源短暂不可用" }, { status: 502 });
    }
    return Response.json({ city: { name: "东莞" }, current: { temperatureC: 31 } });
  };

  const result = await fetchCityBriefingWithRetry<{ city: { name: string } }>(
    "/api/city-briefing?city=%E4%B8%9C%E8%8E%9E",
    { fetcher, retryDelayMs: 0 }
  );

  assert.equal(attempts, 2);
  assert.equal(result.city.name, "东莞");
});

test("a client error is not retried", async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    return Response.json({ error: "缺少 city 参数。" }, { status: 400 });
  };

  await assert.rejects(
    fetchCityBriefingWithRetry("/api/city-briefing", { fetcher, retryDelayMs: 0 }),
    /缺少 city 参数/
  );
  assert.equal(attempts, 1);
});

test("a city report survives three consecutive transient failures", async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    return attempts < 4
      ? Response.json({ error: "fetch failed" }, { status: 502 })
      : Response.json({ city: { name: "东莞" }, status: "available" });
  };

  const result = await fetchCityBriefingWithRetry<{ city: { name: string }; status: string }>(
    "/api/city-briefing?city=%E4%B8%9C%E8%8E%9E",
    { fetcher, retryDelayMs: 0, maxAttempts: 4 }
  );

  assert.equal(attempts, 4);
  assert.equal(result.city.name, "东莞");
});

test("an HTTP 200 partial response is retried before showing an incomplete report", async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    return Response.json(attempts === 1
      ? { city: { name: "惠州" }, status: "degraded" }
      : { city: { name: "惠州" }, status: "available" });
  };

  const result = await fetchCityBriefingWithRetry<{ city: { name: string }; status: string }>(
    "/api/city-briefing?city=%E6%83%A0%E5%B7%9E",
    {
      fetcher,
      retryDelayMs: 0,
      maxAttempts: 4,
      shouldRetryResult: (briefing) => briefing.status !== "available"
    }
  );

  assert.equal(attempts, 2);
  assert.equal(result.status, "available");
});

test("a successful partial report survives later transient failures", async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    return attempts === 1
      ? Response.json({
        city: { name: "汕尾" },
        status: "degraded",
        current: { sourceId: "qweather-now", temperatureC: 25 }
      })
      : Response.json({ error: "fetch failed" }, { status: 502 });
  };

  const result = await fetchCityBriefingWithRetry<{
    city: { name: string };
    status: string;
    current: { sourceId: string; temperatureC: number };
  }>("/api/city-briefing?city=%E6%B1%95%E5%B0%BE", {
    fetcher,
    retryDelayMs: 0,
    maxAttempts: 4,
    shouldRetryResult: (briefing) => briefing.status !== "available"
  });

  assert.equal(attempts, 4);
  assert.equal(result.city.name, "汕尾");
  assert.equal(result.current.temperatureC, 25);
});
