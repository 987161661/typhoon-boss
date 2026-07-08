# Component Map

## Current Route

- `app/page.tsx` renders `TyphoonMap`.
- `TyphoonMap` owns data fetching, MapLibre setup, overlays, top bar, left panel, storm switcher/case index, impact legend, bottom bar, and defense drawer.
- `IntelPanel` owns the right rail.
- `DefenseDrawer` owns the modal-like province detail panel.
- `BossEmblem` owns the CSS-generated boss icon.
- `app/dex/page.tsx` is a secondary page that can be affected by global CSS changes.

## Proposed Component Boundaries

- Keep `components/TyphoonMap.tsx` as the data/map orchestrator initially.
- Extract visual primitives before adding more HUD variants:
  - `HudPanel`
  - `HudFrame`
  - `StatusPill`
  - `MetricRow`
  - `ProvinceAlertCard`
  - `MapLegendPanel`
- Split large page regions after primitives are available:
  - `TopCommandBar`
  - `ProvinceDefensePanel`
  - `LegendPanel`
  - `StormSwitcher`
  - `DossierStormIndex`
  - `ImpactLegend`
  - `BottomAlertBar`
  - `MapLibreStormMarker`
  - `PathTimeOverlay`
- Keep `IntelPanel` as the right-rail owner, but split rendering by theme. `night-radar` keeps the boss telemetry rail; `archive-command` renders a dedicated dossier rail with case cover, classification strip, coordinate fields, metric ledger, a layered historical archive dossier control, source, and history entry. Skills and assessment are intentionally not rendered in dossier mode so the right rail reads as an archive file rather than a radar telemetry stack.
- `DossierArchiveStack` owns the historical dossier timeline and route evidence trace. Its SVG trace and FIX rows must be sourced from `storm.track`; forecast data belongs in metadata or separate forecast controls.

## Implementation Order

1. Fix or regenerate user-visible Chinese text currently affected by mojibake.
2. Add reusable HUD primitives and map them to existing CSS classes.
3. Refactor `TyphoonMap` by extracting region components without changing behavior.
4. Apply reference-aligned layout tokens and responsive constraints.
5. Add or generate any missing visual assets.
6. Run browser QA and iterate.

## Minimal High-Leverage Path

1. First adjust `app/globals.css` to align the existing classes with the reference layout, border language, typography density, bottom warning strip, and right panel density.
2. Make small structural edits in `components/TyphoonMap.tsx`: top bar composition, explicit `LIVE RADAR` center band, left legend panel, and bottom data-source area.
3. Make small structural edits in `components/IntelPanel.tsx`: convert the stat cards into a denser vertical metric table similar to the reference.
4. Optionally upgrade `components/BossEmblem.tsx` or replace the storm vortex with generated bitmap assets if CSS cannot reach the target resemblance.
5. Leave `app/api/**` and core data fetching alone unless UI state requirements expose a real data gap.

## Current Dossier Rebuild Path

- Standard document: `ui-rebuild/ui-control-standard.md`
- Generated material source: `public/ui-rebuild/hud-control-atlas.png`
- Dossier controls: CSS/React-generated sheets, tabs, ledgers, archive-stack dossier, stamps, meters, and desk props. The paper reference image is not used as an implementation asset.
- Code write set:
  - `components/HudPrimitives.tsx`: `ProvinceAlertCard` now owns metadata slots while staying level-driven.
  - `components/TyphoonMap.tsx`: owns the theme switch, keeps MapLibre full-size in dossier mode, hides the bottom strip for dossier mode, replaces the radar storm switcher with a dossier case index, and adds CSS-generated desk props with data-driven operation note and staff telegram copy.
  - `components/TyphoonMap.tsx`: also owns the dossier-specific top rail. In `archive-command`, the top rail is a `BOSS DOSSIER` case-file header with observation and forecast metadata rather than the radar mission-status command strip.
  - `components/TyphoonMap.tsx`: also owns the MapLibre custom storm marker. The boss core is anchored with `setLngLat([lon, lat])`, so it shares the map's real projection instead of using a separate absolute-position React overlay.
  - `components/IntelPanel.tsx`: renders the dedicated dossier right rail when `theme="archive-command"`, including the `DossierArchiveStack` historical-track archive file with a data-generated route trace, visible two-column FIX observation rows, movement deltas, and route-summary evidence.
  - `app/globals.css`: maps the standard into shared radar controls and dossier-specific sheets, fields, ledgers, tabs, and paper styling.

## Data Ownership

- `TyphoonMap` should continue to own live storm list, selected storm, and MapLibre lifecycle.
- Presentation components should receive props only.
- Alert levels should remain computed from storm distance and wind radii rather than hardcoded per province.

## Risks

- `TyphoonMap.tsx` is large; extraction should be mechanical first, visual changes second.
- Global CSS can hide specificity conflicts; prefer named HUD primitives and scoped class groups.
- MapLibre labels and overlays need screenshot verification because map projection affects label placement.
- External network dependencies can affect screenshots: map tiles, province GeoJSON, typhoon API, and fonts.
- In PowerShell, run npm scripts through `cmd /c npm ...` if execution policy blocks npm shims.
