# Future Weather Archive — QA report

## Revision outcome

- The standard right rail is a fixed-height archive cabinet with no desktop rail scrollbar.
- The source credential chain is a native collapsed `details` row by default; its source list only scrolls after the operator opens it.
- The city verification card is removed from the rendered archive panel.
- The former risk-seal card is replaced by a factual warning signal board with large red, orange, yellow, and blue counts plus the current highest official level.
- Seven theatrical hazard scenes are mapped by warning hazard: typhoon, thunderstorm/convection, rainstorm/flood, heatwave, gale, dust/visibility, and geological risk.
- The keyed hazard layer remounts on carousel changes and runs a one-shot reveal/flash performance; reduced-motion users get a static image.

## Browser verification

- 1920x1080: the rail fills exactly one viewport, the credential chain is collapsed, all four warning counts are visible, and no city verification copy is present.
- 1366x768: one queue preview, the warning count board, and the collapsed credential row remain visible in one screen; the footer is intentionally suppressed.
- 390x844: the bottom-sheet layout remains usable through hidden-scrollbar overflow rather than clipping inaccessible content.
- The deterministic 20-warning fixture switched the hero asset across heatwave, rainstorm, thunderstorm, gale, and typhoon records while the carousel was manually advanced.
- Captures: `future-weather-archive-v2-thunderstorm-1920x1080.png`, `future-weather-archive-v2-1366x768.png`, and `future-weather-archive-v2-390x844.png`.

## Automated verification

- `npm.cmd run typecheck` — passed.
- `npm.cmd run lint` — passed.
- `npm.cmd run test -- --runInBand` — passed, 205 tests / 0 failures.
- Isolated Next production build with `NEXT_DIST_DIR=.next-uiqa-build` — passed.
- Default production build — passed.

## Production handoff

- Rebuilt the default `.next` bundle and restarted `next start` on `127.0.0.1:3038`.
- `/api/health`, `/`, `/live`, `thunderstorm-show-v2.webp`, and `heatwave-show-v2.webp` returned HTTP 200.
- The client chunk served by port 3038 contains both `thunderstorm-show-v2.webp` and `风险信号总览`, proving the listener is serving this revision.
