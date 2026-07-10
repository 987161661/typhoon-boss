# Component Map

## Boss Dex Refactor — Requested Target

### Page Grammar

`app/dex/page.tsx` becomes a client-side dossier workspace fed by the existing server-loaded `DexEntry[]`, not a grid of independent cards.

```
DexWorkspace
├─ DexIndexRail (persistent desktop sidebar)
│  ├─ DexToolbar (back link, archive count, optional name/year filter)
│  ├─ YearGroup[] (accordion; closed by default except selected year)
│  │  └─ StormIndexRow[] (name, English name, rank chip, compact wind level)
│  └─ ArchiveLegend (rank meaning and public-data disclaimer)
└─ StormDossier (selected entry; URL state `?storm=<id>`)
   ├─ DossierHeader (case number, status, Chinese/English name, rank)
   ├─ StormMediaStage (real satellite/observational image; timestamp/source/fallback)
   ├─ CombatReadout (maximum wind, minimum pressure, peak stage, active/retired state)
   ├─ BossProfile (game-flavoured fact summary derived from existing public fields)
   ├─ EncounterRecord (track/start-end/retirement facts when supplied by detail data)
   └─ EvidenceFooter (source, refresh time, safety disclaimer)
```

### Existing Components / Data To Keep

- Keep `getDexEntries()` as the initial list source; it already provides year, name, peak wind, pressure, stage, retirement state, and tags.
- Keep `app/api/dex/route.ts` for refresh or client navigation; preserve `Cache-Control: no-store`.
- Keep shared global color primitives and `lucide-react`; do not introduce an icon pack merely for this route.
- Reuse the existing environment/satellite route family only after an entry-specific evidence contract exists. Do not display a satellite product for a different time/storm as if it were historic proof.

### New Component Contracts

- `components/dex/DexWorkspace.tsx`: owns selected id, expanded years, and URL synchronization. Default selection is the newest entry; selection changes reset dossier scroll and announce the name via an `aria-live` label.
- `components/dex/DexIndexRail.tsx`: receives grouped `DexEntry[]`, selected id, callbacks. It is the only owner of year accordion interaction.
- `components/dex/YearGroup.tsx`: receives `{ year, entries, expanded, selectedId }`; a button controls the contained list through `aria-expanded` and `aria-controls`.
- `components/dex/StormDossier.tsx`: receives one `DexEntry` plus optional `StormEvidence`. It owns the right-side hierarchy only, with no fetching/list state.
- `components/dex/StormMediaStage.tsx`: receives time-bound media data `{ imageUrl, observedAt, source, status }`. States: `loading | available | unavailable | mismatched`. Only `available` may call itself “真实影像”; otherwise render an intentional live radar/evidence fallback with explicit wording.
- `components/dex/CombatReadout.tsx`: maps facts to the four stable primary cards: `峰值风力`, `最低气压`, `最高强度`, `档案状态`. Rank is a derived presentation token, never a replacement for stage.
- `lib/dexNarrative.ts`: one small pure formatter that produces game-like headings and copy from verified facts. It must avoid fabricated “damage”, landfall or battle results when the data does not contain them.

### State / URL / Data Boundary

- Add `storm=<DexEntry.id>` query state so a selected dossier can be shared and refreshed without a fragile positional index.
- Group entries locally by `year`; do not make one request per accordion year.
- The current `DexEntry` lacks detailed track, start/end, landfall and storm-scoped imagery. Add an opt-in `GET /api/dex/[id]` only when the detail panel needs those facts; return `entry`, verified `track`, and evidence metadata separately.
- Satellite imagery needs an acquisition time and source linked to the selected storm window. If the current satellite APIs only yield present-day imagery, label it “当前卫星环境参考”, not “该台风真实影像”. Historic true imagery requires a source-backed archive mapping before UI can claim it.

### Responsive and Interaction Rules

- Desktop (`>=960px`): fixed/independent scrolling sidebar, right dossier scroll; the media stage is the largest first-screen region.
- Tablet/mobile (`<960px`): year index becomes a top sheet/accordion; selection closes it and reveals the dossier. Never render a narrow two-column desktop rail.
- Keyboard: arrow/tab navigation reaches year toggles and storm rows; Enter/Space selects; current storm has `aria-current="true"`.
- Loading: keep the dossier shell and skeleton media/stat blocks to prevent layout shift. Empty/error: keep the index and show an actionable empty dossier, not a blank route.

### Planned Write Set

- `app/dex/page.tsx` — server fetch boundary and workspace entry.
- `components/dex/*` — new composable presentation/state components.
- `app/globals.css` or a scoped dex stylesheet — `boss-dex` tokens, layout and responsive rules.
- `lib/dexNarrative.ts` and, only if required, a scoped entry-detail adapter/route.

### Explicit Non-Goals

- No return to a four-column card wall.
- No static “news recap” copy pasted per typhoon.
- No fake historic satellite images, generic hurricane stock photos, or hand-authored cases per year.
- No unbounded loading of every detailed track when opening the page; request the selected dossier detail lazily.

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
