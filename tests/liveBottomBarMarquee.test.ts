import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("city typhoon updates scroll by default while other fact-rail copy scrolls on overflow", async () => {
  const [component, css] = await Promise.all([
    readFile("components/LiveBroadcastView.tsx", "utf8"),
    readFile("app/globals.css", "utf8")
  ]);

  assert.match(
    component,
    /<strong key=\{cityTicker\.id\}>\s*<OverflowMarquee alwaysScroll>\{cityTicker\.message\}<\/OverflowMarquee>\s*<\/strong>/
  );
  assert.match(component, /const scrolling = alwaysScroll \|\| overflowing/);
  assert.match(component, /content\.scrollWidth > viewport\.clientWidth \+ 1/);
  assert.match(css, /\.live-fact-marquee\.is-scrolling \.live-fact-marquee-track\s*\{[\s\S]*?animation:\s*liveFactRailMarquee/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?\.live-fact-marquee\.is-scrolling \.live-fact-marquee-track\s*\{[\s\S]*?animation:\s*none/);
  assert.match(css, /\.live-city-ticker-slot\s*>\s*span/);
  assert.doesNotMatch(css, /\.live-city-ticker-slot span,/);
});
