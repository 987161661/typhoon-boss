# UI Rebuild QA Report

## Current Phase

Phase 18: dossier-theme laptop layout collision fix after the Phase 17 command/left-rail pass.

## Requirements Under Test

- Dossier theme must not implement UI by cutting controls or decorations from the reference image.
- Dossier theme must not render the bottom province strip.
- MapLibre canvas must remain full-size in dossier mode so storm core, path labels, and province labels do not shift due to CSS inset.
- Right rail must be a real historical dossier interface, not a restyled radar panel.
- Theme switch must still support `RADAR` and `DOSSIER`.
- The interface must remain data-driven and avoid per-province hand-written variants.

## Fixed In Phase 11

- Removed source-reference crop URLs and old paper asset variables from `app/globals.css`.
- Replaced old crop-based decoration layer with CSS-generated desk props in `components/TyphoonMap.tsx`.
- Stopped rendering `BottomAlertBar` when `theme === "archive-command"`.
- Kept `.map-canvas` and `.map-effects` full-inset in dossier mode.
- Added a dedicated `DossierIntelPanel` render path in `components/IntelPanel.tsx`.
- Added dossier control grammar: sheet, tabs, classification strip, coordinate field, meter, metric ledger, history rows, skill rows, data source, notice, and history action.
- Updated `ui-rebuild/ui-control-standard.md`, `ui-rebuild/asset-manifest.json`, `ui-rebuild/design-tokens.json`, and `ui-rebuild/component-map.md` to ban source-reference crops for dossier implementation.

## Verification Log

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Production server started with `npm run start -- -H 127.0.0.1 -p 3000` and returned HTTP 200.

Screenshots:

- Desktop dossier final: `D:\typhoon boss radar\ui-rebuild\screenshots\phase11-dossier-desktop-1920x1080-final-v2.png`
- Mobile dossier final: `D:\typhoon boss radar\ui-rebuild\screenshots\phase11-dossier-mobile-390x844-final-v2.png`

Desktop DOM/layout checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.dossier-panel` exists.
- `.dossier-history` exists.
- `.map-canvas` computed inset: top/right/bottom/left all `0px`.
- No stylesheet rule references the removed source-reference crop folder.
- No horizontal or vertical document overflow.
- Storm visual is inside `.map-stage`.

Mobile DOM/layout checks at 390x844:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.map-stage` width is 390px.
- `.map-canvas` width is 389px and height is 844px.
- Storm visual is fully inside the viewport.
- No horizontal or vertical document overflow.

## Remaining Risks

- The global CSS file remains large. Further work should split dossier and radar styles into clearer modules if the project adds more themes.
- Some existing Chinese text in source files appears as mojibake in PowerShell output; browser rendering has historically displayed readable text, but this should still be audited separately before commercial polish.

## Phase 12 Polish

Changes added after the Phase 11 verification:

- Strengthened dossier left defense and legend panels with more opaque paper surfaces, sharper borders, and deeper shadows so live map labels do not visually bleed through the controls.
- Added CSS/React-generated `prop-order-note` and `prop-telegram` decorations. These reproduce the reference's operation-note and staff-telegram layout habit without using source-reference crops.
- Moved the impact legend upward on desktop so it does not collide with the generated staff telegram.
- Hid operation-note, telegram, pen, and paperclip decorations on small mobile screens.

Verification for Phase 12:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Source-crop residue scan: no `archive-crops`, old paper crop variable, or old archive prop class references in app code/assets.
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase12-dossier-desktop-1920x1080.png`
- Mobile screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase12-dossier-mobile-390x844.png`

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.dossier-panel` and `.dossier-history` exist.
- `.prop-order-note` and `.prop-telegram` are visible.
- Storm visual is inside `.map-stage`.
- No horizontal or vertical document overflow.

Mobile checks at 390x844:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.prop-order-note` and `.prop-telegram` are hidden.
- `.map-stage` width is 390px and `.map-canvas` height is 844px.
- Storm visual is fully inside the viewport.
- No horizontal or vertical document overflow.

## Phase 15 Map Furniture Pass

Changes added after Phase 14:

- Added `DossierMapFurniture` as a live React/CSS layer for longitude/latitude rulers, compass rose, and scale bar.
- Kept MapLibre canvas full-size; the furniture layer is visual only and does not alter projected overlay coordinates.
- Added mobile rules that hide large rulers and keep only reduced compass/scale furniture.
- Updated the UI standard and asset manifest so map furniture remains a reusable dossier grammar element rather than a source-image crop.

Verification for Phase 15:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed after stopping the old `next start` process so `.next` was not being used by another Node process.
- Source-crop residue scan: no `archive-crops`, old paper crop variable, or old archive prop class references in app code/assets.
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase15-dossier-desktop-1920x1080.png`
- Mobile screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase15-dossier-mobile-390x844.png`

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.map-canvas` and `.map-effects` both keep `inset: 0px 0px 0px 0px`.
- `.dossier-map-furniture` is visible, with desktop longitude/latitude rulers visible.
- `.dossier-panel` `scrollHeight` equals `clientHeight` at 1080px, so the dossier rail remains first-viewport fit.
- Storm visual is fully inside `.map-stage`.
- No horizontal or vertical document overflow.
- Decorative clock, compass, scale, and attribution do not intersect.

Mobile checks at 390x844:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.intel-panel` is hidden and `.dossier-side-tabs` computed display is `none`.
- `.map-canvas` and `.map-effects` both keep `inset: 0px 0px 0px 0px`.
- Large rulers are hidden; reduced compass and scale remain visible.
- Storm visual is fully inside `.map-stage`.
- No horizontal or vertical document overflow.
- Decorative clock, compass, scale, and compact attribution do not intersect.

## Phase 16 Archive Stack Pass

Changes added after Phase 15:

- Replaced the old three-row `dossier-history` card with `DossierArchiveStack`, a layered live dossier control in `components/IntelPanel.tsx`.
- Added CSS-generated folder layers, a target print/photo plate, case metadata, a 3-row route timeline, and a last-fix stamp.
- Removed the unused `dossier-radio`/waveform implementation from current code so the right rail no longer carries dead UI residue.
- Updated `ui-rebuild/ui-control-standard.md`, `ui-rebuild/asset-manifest.json`, and `ui-rebuild/component-map.md` to make the archive-stack dossier the right-rail history contract.

Verification for Phase 16:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed after stopping the old `next start` process so `.next` was not being used by another Node process.
- Current implementation scan: no `dossier-radio`, `dossier-waveform`, or `RADIO INTERCEPT` residue in `components`, `app`, `ui-control-standard.md`, or `asset-manifest.json`.
- Source-crop residue scan: no `archive-crops`, old paper crop variable, or old archive prop class references in app code/assets.
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase16-dossier-desktop-1920x1080-final-v3.png`
- Mobile screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase16-dossier-mobile-390x844-final-v3.png`

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.dossier-archive-stack` exists with 3 `.archive-event` rows, 3 folder-tab layers, a photo plate, and a last-fix foot.
- `.dossier-panel` `scrollHeight` equals `clientHeight` at 1080px, so the dossier rail remains first-viewport fit.
- Storm visual is fully inside `.map-stage`.
- No horizontal or vertical document overflow.
- No source-reference crop usage found in DOM style/src attributes.

Mobile checks at 390x844:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.intel-panel` is hidden and `.dossier-side-tabs` computed display is `none`.
- Storm visual is fully inside `.map-stage`.
- No horizontal or vertical document overflow.
- No source-reference crop usage found in DOM style/src attributes.

## Phase 14 First-Viewport Density Pass

Changes added after Phase 13:

- Measured the dossier right rail and found that `dossier-coordinate-grid` and `dossier-metric-ledger` were collapsing to border-only height while their children overflowed.
- Added explicit row heights for coordinate fields and metric ledger rows.
- Converted the metric ledger to a compact two-column table so live meteorological metrics remain visible without pushing the dossier footer out of the first viewport.
- Tightened dossier vertical rhythm: smaller cover identity block, denser classification/energy/history/radio/skills/assessment/source/notice/link spacing.

Verification for Phase 14:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase14-dossier-desktop-1920x1080-final.png`
- Mobile screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase14-dossier-mobile-390x844-final.png`

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.dossier-coordinate-grid` height is 44px.
- `.dossier-metric-ledger` height is 116px.
- `.dossier-footer` is fully visible; history link bottom is 1064px.
- `.dossier-panel` `scrollHeight` equals `clientHeight` at 1080px, so the dossier rail no longer requires scrolling in the checked viewport.
- Storm visual is inside `.map-stage`.
- No horizontal or vertical document overflow.

Mobile checks at 390x844:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.dossier-panel` is hidden by mobile layout.
- `.dossier-side-tabs` computed display is `none`.
- `.map-stage` width is 390px and `.map-canvas` height is 844px.
- Storm visual is fully inside the viewport.
- No horizontal or vertical document overflow.

## Phase 13 Dossier Archive Pass

Changes added after Phase 12:

- Added `dossier-side-tabs`, a live CSS folder-tab spine on the right edge of the dossier rail.
- Added `dossier-radio`, a deterministic CSS waveform panel for radio intercept data. It is generated from storm data and contains no bitmap text.
- Added `dossier-assessment`, a live assessment note with a CSS-generated confidentiality stamp.
- Updated the UI standard and asset manifest so these remain reusable dossier controls rather than one-off decorations.

Verification for Phase 13:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase13-dossier-desktop-1920x1080.png`
- Mobile screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase13-dossier-mobile-390x844-final.png`

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.dossier-panel` exists.
- `.dossier-side-tabs` contains 4 folder tabs.
- `.dossier-radio` exists with 38 waveform bars.
- `.dossier-assessment` exists.
- Storm visual is inside `.map-stage`.
- No horizontal or vertical document overflow.

Mobile checks at 390x844:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- `.dossier-panel` is hidden by the mobile layout.
- `.dossier-side-tabs` computed display is `none`.
- `.map-stage` width is 390px and `.map-canvas` height is 844px.
- Storm visual is fully inside the viewport.
- No horizontal or vertical document overflow.

## Phase 18 Laptop Left-Rail Collision Fix

Changes added after Phase 17:

- Confirmed the 1366x768 dossier screenshot still had a real layout collision: `.defense-panel` bottom was `476px` while `.legend-panel` top was `408px`.
- Added a scoped `1181px-1500px` dossier breakpoint that compresses the left defense paper, readiness bars, deploy button, and legend rows.
- Moved the legend paper to `top: 424px` at that breakpoint so it no longer intersects the defense paper or the preserved lower-left clock/pen decoration.
- Kept page-level scrolling disabled; the right dossier rail remains the only scroll container at laptop height.

Verification for Phase 18:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed after stopping the old `next start` process.
- Production server returned HTTP 200 at `http://127.0.0.1:3000/`.
- Current implementation scan: no `archive-crops`, old paper crop variable, `dossier-radio`, `dossier-waveform`, or `RADIO INTERCEPT` residue in current implementation/spec/assets.
- Laptop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase18-dossier-laptop-1366x768-fixed-left-column.png`

Laptop DOM/layout checks at 1366x768:

- `data-theme="archive-command"`
- Document size equals viewport size: `scrollWidth=1366`, `scrollHeight=768`.
- `.defense-panel` bottom is `414px`; `.legend-panel` top is `424px`, so the left rail no longer overlaps.
- `.legend-panel` bottom is `622px`; `.prop-clock` top is `638px`, so the preserved clock/pen area remains visible.
- `.legend-panel` does not intersect `.map-compass`.
- `.prop-clock` does not intersect `.map-scale`.
- `.impact-legend` right edge remains before the dossier rail.
- `.dossier-panel` uses internal scrolling at this height: `clientHeight=768`, `scrollHeight=1023`, `overflow-y:auto`.

## Phase 19 Historical Archive Right-Rail Pass

Changes added after Phase 18:

- Changed `DossierArchiveStack` so the archive timeline is sourced from real historical `storm.track` records instead of mixing the latest track point with forecast points.
- Added an `archive-index-strip` ledger inside the case file: `HISTORY LOG`, `TRACK EVIDENCE`, and historical observation count.
- Added `HIST` and `FCST` metadata cells to the case file so forecast data is visible as metadata but not misrepresented as historical evidence.
- Added a themed dossier scrollbar and tightened the 1181px-1500px right-rail rhythm so the archive area is more prominent at laptop height.
- Updated `ui-rebuild/ui-control-standard.md`, `ui-rebuild/asset-manifest.json`, and `ui-rebuild/component-map.md` to make historical-track sourcing an explicit contract.

Verification for Phase 19:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed after stopping the old `next start` process.
- Production server returned HTTP 200 at `http://127.0.0.1:3000/`.
- Laptop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase19-dossier-laptop-1366x768-archive-log.png`
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase19-dossier-desktop-1920x1080-archive-log.png`

Laptop checks at 1366x768:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1366`, `scrollHeight=768`.
- `.archive-event` count is `4`.
- `.archive-index-strip` values are `HISTORY LOG`, `TRACK EVIDENCE`, and `47 OBS`.
- Archive case metadata contains `WIND`, `PRESS`, `HIST`, and `FCST`.
- `.dossier-panel` remains the only scroll container at this height; `scrollHeight` reduced from Phase 18's `1023` to `907`.
- Storm visual anchor remains fully inside `.map-stage`.

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1920`, `scrollHeight=1080`.
- `.archive-event` count is `4`.
- `.archive-index-strip` values are `HISTORY LOG`, `TRACK EVIDENCE`, and `47 OBS`.
- `.dossier-panel` first-viewport fit is preserved: `clientHeight=1080`, `scrollHeight=1080`, `overflow-y:hidden`.
- Storm visual anchor remains fully inside `.map-stage`.

## Phase 20 Laptop First-Viewport Fit Pass

Changes added after Phase 19:

- Tightened only the `1181px-1500px` dossier breakpoint so 1366x768 no longer needs right-rail internal scrolling.
- Collapsed low-priority cover body copy, limited laptop threat skills to the first two rows, compressed the assessment stamp, and merged the footer into one compact source/action row.
- Kept the historical archive stack unchanged as the dominant right-rail control: 4 historical `storm.track` rows remain visible.
- Updated `ui-rebuild/ui-control-standard.md` so 1366x768 first-viewport dossier fit is an explicit responsive rule.

Verification for Phase 20:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed after stopping the old `next start` process.
- Production server returned HTTP 200 at `http://127.0.0.1:3000/`.
- Laptop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase20-dossier-laptop-1366x768-first-viewport-fit.png`
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase20-dossier-desktop-1920x1080-regression.png`

Laptop checks at 1366x768:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1366`, `scrollHeight=768`.
- `.dossier-panel` first-viewport fit is achieved: `clientHeight=768`, `scrollHeight=768`.
- `.archive-event` count remains `4`.
- Visible skill rows are reduced to `2` only at this breakpoint.
- `.dossier-footer .dossier-notice` and source body copy are collapsed at this breakpoint.
- Storm visual anchor remains fully inside `.map-stage`.

Desktop regression checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1920`, `scrollHeight=1080`.
- `.dossier-panel` first-viewport fit remains: `clientHeight=1080`, `scrollHeight=1080`.
- `.archive-event` count remains `4`.
- Visible skill rows remain `3`; `.dossier-footer .dossier-notice` remains visible.
- Storm visual anchor remains fully inside `.map-stage`.

## Phase 21 Data-Driven Dossier Notes Pass

Changes added after Phase 20:

- Replaced fixed `prop-order-note` copy with `buildDossierOperation(storm, dataError)`.
- Replaced fixed `prop-telegram` copy with `buildDossierTelegram(storm, sourceLabel, dataError)`.
- The operation note now reflects current severity, storm stage, wind speed, and link state.
- The staff telegram now reflects source label, historical track count, forecast count, or link error state.
- Added line clamps and stamp padding so generated note text does not collide with the CSS confidentiality stamp.
- Updated `ui-rebuild/ui-control-standard.md`, `ui-rebuild/asset-manifest.json`, and `ui-rebuild/component-map.md` to make live note/telegram text an explicit dossier contract.

Verification for Phase 21:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed after stopping the old `next start` process.
- Production server returned HTTP 200 at `http://127.0.0.1:3000/`.
- Laptop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase21-dossier-laptop-1366x768-data-driven-notes-final.png`
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase21-dossier-desktop-1920x1080-data-driven-notes-final.png`

Laptop checks at 1366x768:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1366`, `scrollHeight=768`.
- `.dossier-panel` first-viewport fit remains: `clientHeight=768`, `scrollHeight=768`.
- Operation note text is live: `作战命令最高戒备巴威 为超强台风，中心风速 58 m/s，沿海单位按天灾级响应。`
- Staff telegram text is live: `STAFF TELEGRAM浙江省水利厅台风路径公开接口 已同步 47 条历史轨迹与 9 条预报点。`
- `.archive-event` count remains `4`.
- Storm visual anchor remains fully inside `.map-stage`.

Desktop regression checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1920`, `scrollHeight=1080`.
- `.dossier-panel` first-viewport fit remains: `clientHeight=1080`, `scrollHeight=1080`, `overflow-y:hidden`.
- Operation note and staff telegram contain the same live storm/source-derived values.
- `.archive-event` count remains `4`.

## Phase 22 Generated Dossier Material Pass

Changes added after Phase 21:

- Used the built-in image generation tool to create a no-text/no-map/no-data archive material atlas.
- Copied the generated atlas into the project as `public/ui-rebuild/dossier-material-atlas-v1.png`.
- Cropped project-local generated material swatches:
  - `public/ui-rebuild/dossier-paper-grain-v1.png`
  - `public/ui-rebuild/dossier-folder-grain-v1.png`
  - `public/ui-rebuild/dossier-worn-grain-v1.png`
- Integrated the generated grains into `app/globals.css` via CSS variables and layered backgrounds for:
  - `.dossier-sheet`
  - `.defense-panel`
  - `.legend-panel`
  - `.impact-legend`
  - `.archive-folder-stack span`
  - `.archive-main-file`
  - `.prop-order-note`
  - `.prop-telegram`
- Changed generated-material blending to `soft-light` after screenshot review because `multiply` made left and right controls too dark.
- Updated `ui-rebuild/ui-control-standard.md` and `ui-rebuild/asset-manifest.json` with the generated-material contract.

Generation prompt constraints:

- Use case: `ui-mockup`.
- Asset: reusable archive dossier UI material atlas.
- Required: blank aged paper panels, blank folder tabs, paper strips, ink smudges, worn edges, faint ruled paper grain, blank stamp textures, brass corner wear.
- Forbidden: readable text, letters, digits, icons, maps, weather symbols, logos, UI screenshot composition, app data, watermark.

Verification for Phase 22:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed after stopping the old `next start` process.
- Production server returned HTTP 200 at `http://127.0.0.1:3000/`.
- Laptop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase22-dossier-laptop-1366x768-generated-materials-final.png`
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase22-dossier-desktop-1920x1080-generated-materials.png`

Laptop checks at 1366x768:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1366`, `scrollHeight=768`.
- `.dossier-panel` first-viewport fit remains: `clientHeight=768`, `scrollHeight=768`.
- `.archive-event` count remains `4`.
- Generated material URLs are present in computed backgrounds for `.dossier-sheet`, `.archive-main-file`, `.archive-folder-stack span`, and `.defense-panel`.
- Generated material blend mode is `soft-light, normal, normal` for these controls.
- Storm visual anchor remains fully inside `.map-stage`.

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1920`, `scrollHeight=1080`.
- `.dossier-panel` first-viewport fit remains: `clientHeight=1080`, `scrollHeight=1080`, `overflow-y:hidden`.
- `.archive-event` count remains `4`.
- Generated material is loaded in `.dossier-sheet`.
- Storm visual anchor remains fully inside `.map-stage`.

## Phase 23 Dossier Readability And Left Layout Pass

Issue found during desktop screenshot review:

- The archive/dossier left-side `LEGEND` panel overlapped the bottom of the province defense sheet on 1920x1080.
- Measured overlap before fix: defense panel bottom `495px`, legend panel top `408px`, overlap `87px`.
- The 1366x768 layout also had a small overlap: defense panel bottom `433px`, legend panel top `424px`, overlap `9px`.

Changes added after Phase 22:

- Added a stronger paper-label title treatment for dossier section headers in `.defense-panel`, `.legend-panel`, and `.impact-legend`.
- Increased dossier map legend and impact legend text contrast for generated paper textures.
- Moved the dossier `.legend-panel` down to avoid stacking over the province defense sheet:
  - desktop/base: `top: 512px`
  - 1181px-1500px breakpoint: `top: 446px`

Verification for Phase 23:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Production server was restarted and returned HTTP 200 at `http://127.0.0.1:3000/`.
- Laptop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase23-dossier-laptop-1366x768-left-layout-final.png`
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase23-dossier-desktop-1920x1080-left-layout-final.png`

Laptop checks at 1366x768:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1366`, `scrollHeight=768`.
- `.dossier-panel` first-viewport fit remains: `clientHeight=768`, `scrollHeight=768`.
- `.archive-event` count remains `4`.
- Storm visual anchor remains fully inside `.map-stage`.
- Labels out of map: `0`.
- Left panel overlap is fixed: defense panel bottom `433px`, legend panel top `446px`, overlap `-13px`.

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1920`, `scrollHeight=1080`.
- `.dossier-panel` first-viewport fit remains: `clientHeight=1080`, `scrollHeight=1080`, `overflow-y:hidden`.
- `.archive-event` count remains `4`.
- Storm visual anchor remains fully inside `.map-stage`.
- Labels out of map: `0`.
- Left panel overlap is fixed: defense panel bottom `495px`, legend panel top `512px`, overlap `-17px`.

## Phase 24 Dossier History Archive Rebuild

Changes added after Phase 23:

- Rewrote `components/IntelPanel.tsx` as ASCII-safe source so visible Chinese UI strings are no longer stored as mojibake-prone raw terminal text.
- Removed the previous unused dossier implementation and made the active `DossierIntelPanel` the only dossier right-rail render path.
- Rebuilt the right rail around a stronger historical archive file:
  - `DossierArchiveStack` now renders the last `8` historical track observations.
  - Added `archive-route-summary` with first record, latest fix, and sampled route span.
  - Changed the dossier right rail priority so skills and assessment cards are hidden in dossier mode; the right rail now favors the historical file, source, and history entry.
- Kept generated paper/folder materials and CSS-generated archive elements; no reference-image crops are used.

Verification for Phase 24:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Production server was restarted and returned HTTP 200 at `http://127.0.0.1:3000/`.
- Laptop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase24-dossier-laptop-1366x768-history-final.png`
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase24-dossier-desktop-1920x1080-history-final.png`
- Residual scan for old crop variables, old radio controls, old fixed command text, and forbidden reference-image crop names returned no matches.

Laptop checks at 1366x768:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1366`, `scrollHeight=768`.
- `.dossier-panel` first-viewport fit remains: `clientHeight=768`, `scrollHeight=768`.
- `.archive-event` count is `8`.
- `8 / 8` archive events are visible inside `.archive-main-file`.
- `.dossier-skills` and `.dossier-assessment` are not visible in dossier mode.
- Storm visual anchor remains fully inside `.map-stage`.
- Labels out of map: `0`.
- Left panel overlap remains fixed: `-13px`.

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1920`, `scrollHeight=1080`.
- `.dossier-panel` first-viewport fit remains: `clientHeight=1080`, `scrollHeight=1080`, `overflow-y:hidden`.
- `.archive-event` count is `8`.
- `8 / 8` archive events are visible inside `.archive-main-file`.
- `.dossier-skills` and `.dossier-assessment` are not visible in dossier mode.
- Storm visual anchor remains fully inside `.map-stage`.
- Labels out of map: `0`.
- Left panel overlap remains fixed: `-17px`.

## Phase 25 Dossier Top Rail Rebuild

Changes added after Phase 24:

- Rebuilt the dossier top rail so it no longer reads as a recolored radar command bar.
- `archive-command` top rail now uses:
  - Brand: `台风情报档案室 / BOSS DOSSIER / HISTORICAL COMMAND FILE`
  - Ledger cells: `CASE FILE`, `OBS LOG`, `LAST FIX`, `FORECAST`
  - Source stamp count label: `FILES`
- Updated dossier top rail styling into a case-file header with a red file-index strip and case stamp treatment.
- Cleaned remaining visible mojibake in `components/TyphoonMap.tsx`, including operation note title, forecast subtitle, province names, legend labels, impact legend labels, fallback copy, and radar/dossier source labels.
- Updated `ui-rebuild/ui-control-standard.md` and `ui-rebuild/component-map.md` to reflect the current dossier top rail and right-rail archive responsibilities.

Verification for Phase 25:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Production server was restarted and returned HTTP 200 at `http://127.0.0.1:3000/`.
- Laptop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase25-dossier-laptop-1366x768-topbar-dossier.png`
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase25-dossier-desktop-1920x1080-topbar-final.png`

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- Top brand text is `台风情报档案室BOSS DOSSIERHISTORICAL COMMAND FILE`.
- Top ledger cells are `CASE FILE202609`, `OBS LOG48 REC`, `LAST FIX07/08 05:00`, `FORECAST9 PTS`.
- Operation note text is live and readable: `作战命令最高戒备巴威 为超强台风，中心风速 60 m/s，沿海单位按天灾级响应。`
- `.bottom-command` element does not exist.
- Document size equals viewport size: `scrollWidth=1920`, `scrollHeight=1080`.
- `.dossier-panel` first-viewport fit remains: `clientHeight=1080`, `scrollHeight=1080`, `overflow-y:hidden`.
- `.archive-event` count remains `8`.

## Phase 26 Dossier Right-Rail DOM Cleanup

Changes added after Phase 25:

- Removed the previously hidden dossier threat-skill and assessment sections from the `archive-command` React tree.
- Deleted the unused `DossierAssessment` function and related dossier-only constants from `components/IntelPanel.tsx`.
- Removed obsolete `.dossier-skills`, `.dossier-skill-row`, and `.dossier-assessment` CSS rules from the active stylesheet.
- Updated the UI standard and component map so the right rail contract says these sections are not rendered, not merely hidden.

Verification for Phase 26:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Current implementation scan for `dossier-skills`, `dossier-skill-row`, `DossierAssessment`, `dossier-assessment`, and related assessment constants returned no matches in `components/IntelPanel.tsx`, `app/globals.css`, `ui-control-standard.md`, and `component-map.md`.
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase26-dossier-desktop-1920x1080-dom-cleanup.png`

Desktop checks at 1920x1080:

- `data-theme="archive-command"`
- `.dossier-skills` element does not exist.
- `.dossier-assessment` element does not exist.
- `.archive-event` count remains `8`.
- `8 / 8` archive events are visible inside `.archive-main-file`.
- `.bottom-command` element does not exist.
- `.dossier-panel` first-viewport fit remains: `clientHeight=1080`, `scrollHeight=1080`, `overflow-y:hidden`.

## Phase 27 Dossier Layout Cleanup

Changes added after Phase 26:

- Replaced the old archive-mode bottom storm card with `DossierStormIndex`, a paper-file case index control.
- Kept storm switching behavior, but moved it out of the radar-style bottom HUD placement.
- Added `?theme=dossier` / `?theme=archive-command` initial theme support for direct QA entry into the dossier theme. The in-app RADAR/DOSSIER switcher remains unchanged.
- Reworked the right-rail archive timeline from compressed one-line rows into two-column file-index event cards while keeping the last 8 historical records.
- Added an archive-theme storm visual fallback so the typhoon core remains in the map safe zone when map projection is unavailable or would place it under preserved props/panels.

Verification for Phase 27:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Production server was restarted and returned HTTP 200 at `http://127.0.0.1:3000/?theme=dossier`.
- Laptop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase27c-dossier-1366x768-final.png`
- Desktop screenshot: `D:\typhoon boss radar\ui-rebuild\screenshots\phase27c-dossier-1920x1080-final.png`

Visual checks:

- Dossier top rail no longer overlaps with the case index.
- The old bottom `storm-switcher` card is no longer present in archive-command rendering.
- The typhoon boss visual is visible in the central map safe zone at 1366x768 and 1920x1080.
- The right intelligence dossier still shows 8 history records, now as compact two-column archive entries.
- Preserved decorative/control elements remain visible: left province defense, legend, operation note, right intelligence dossier, staff telegram, lower-left clock/pen prop.

## Phase 31 Geographic Marker Correction

Changes added after Phase 27:

- Removed the archive-theme percentage-based storm visual fallback. The boss visual is no longer placed with arbitrary viewport percentages.
- Replaced the old React absolute-position storm visual with a MapLibre custom marker created by `renderStormOnMap`.
- The marker is anchored with `setLngLat([storm.position.lon, storm.position.lat])`, so the typhoon core, path, wind rings, and basemap share the same map projection.
- Removed fixed longitude/latitude text rulers from `DossierMapFurniture`; only compass and scale furniture remain. Fixed degree labels were not camera-projected and could visually imply map-label drift.
- Updated `ui-control-standard.md` and `component-map.md` to prohibit fake storm safe-zone placement and fixed unprojected coordinate labels.

Verification for Phase 31:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed with no warnings. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Production server was restarted and returned HTTP 200 at `http://127.0.0.1:3000/?theme=dossier`.
- Stable laptop screenshot via CDP: `D:\typhoon boss radar\ui-rebuild\screenshots\phase31b-dossier-1366x768-marker-visible-stable.png`
- Stable desktop screenshot via CDP: `D:\typhoon boss radar\ui-rebuild\screenshots\phase31c-dossier-1920x1080-marker-visible-stable.png`

Runtime checks captured from CDP:

- `data-theme="archive-command"`.
- `.storm-map-marker` count is `1`.
- `.storm-visual-anchor` count is `0`.
- `.map-ruler span` count is `0`.
- `.archive-event` count is `8`.
- `.bottom-command` is absent.
- At desktop capture, the marker rect is inside the map viewport and the boss core is visible with the forecast path and wind ring.

## Phase 34 Right-Rail Historical Archive Upgrade

Changes added after Phase 31:

- Reworked `DossierArchiveStack` so the history area is no longer just a compressed coordinate table.
- Added `ArchiveRouteTrace`, a compact SVG evidence route generated from the latest historical `storm.track` coordinates.
- Updated archive FIX rows to include:
  - FIX number.
  - Historical time.
  - Coordinate.
  - Wind value.
  - Movement delta from the previous historical fix.
  - A latest-row state.
- Compressed duplicated target metrics inside the archive stack so the first viewport can show the trace and all 8 FIX records on laptop width.
- Split MapLibre storm marker rendering from map style readiness so the boss core appears earlier and is not delayed by slow external map tiles.
- Updated `ui-control-standard.md` and `component-map.md` with the data-generated route trace and FIX-row contract.

Verification for Phase 34:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed with no warnings. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Production server was restarted and returned HTTP 200 at `http://127.0.0.1:3000/?theme=dossier`.
- Stable laptop screenshot via CDP: `D:\typhoon boss radar\ui-rebuild\screenshots\phase34-dossier-1366x768-archive-trace-marker.png`

Runtime checks captured from CDP at 1366x768:

- `data-theme="archive-command"`.
- `.storm-map-marker` count is `1`.
- `.archive-route-trace` exists.
- `.archive-route-trace circle` count is `8`.
- `.archive-event` count is `8`.
- Visible archive events in viewport: `8`.
- `.archive-event.is-latest` count is `1`.
- `.bottom-command` is absent.
- `.storm-visual-anchor` count is `0`.

## Phase 36 Laptop Dossier First-Viewport Fit

Changes added after Phase 34:

- Tightened the `1366x768` dossier right rail so the historical archive is no longer visually clipped at the bottom.
- At laptop width, collapsed lower-priority duplicate metric rows after the first four ledger rows.
- Hid the right-rail footer and the archive `LAST FIX` foot only in the laptop breakpoint so the historical evidence trace and all 8 FIX rows remain visible in the first viewport.
- Kept the route trace, FIX rows, classification, energy meter, coordinate fields, and MapLibre storm marker visible.
- Updated `ui-control-standard.md` so the laptop rule explicitly prioritizes the archive stack and allows footer/lower-priority duplicate metrics to collapse.

Verification for Phase 36:

- `cmd /c npm run typecheck`: passed.
- `cmd /c npm run lint`: passed with no warnings. `next lint` printed its standard deprecation notice.
- `cmd /c npm run build`: passed.
- Production server was restarted and returned HTTP 200 at `http://127.0.0.1:3000/?theme=dossier`.
- Stable laptop screenshot via CDP: `D:\typhoon boss radar\ui-rebuild\screenshots\phase36-dossier-1366x768-right-rail-fit-final.png`

Runtime checks captured from CDP at 1366x768:

- `data-theme="archive-command"`.
- `.storm-map-marker` count is `1`.
- `.archive-route-trace` exists.
- `.archive-event` count is `8`.
- Visible archive events in viewport: `8`.
- `.archive-file-foot` is hidden at the laptop breakpoint.
- `.dossier-footer` is hidden at the laptop breakpoint.
- `.bottom-command` is absent.
- `.dossier-panel` first-viewport fit is restored: `clientHeight=673`, `scrollHeight=673`.
# Boss atlas QA report

## Commands run

- `npm.cmd run typecheck` — passed.
- `npm.cmd run build` — passed after the Boss atlas integration.

## Viewports checked

- Build-level responsive CSS coverage: desktop (sidebar + large detail), narrow screens (`max-width: 850px`).
- In-app browser visual capture was attempted against local `/dex`, but the local browser webview did not attach before timeout. No screenshot could be produced in this run.

## Fixed issues

- Replaced the flat card grid with a two-stage state model: year, then storm, then selected dossier.
- Made the top visual explicitly a *current satellite reference*, not a fabricated historical image for the selected record.
- Added small-screen stacking rules to preserve both the year rail and storm list.

## Remaining risk

- Historic, storm-scoped satellite imagery needs a timestamped archive source before the top panel can truthfully be labelled as the selected storm's historic real image.

## World-track dossier update

- Replaced the top satellite-reference panel with an SVG world track map rendered from the selected record's public path points.
- Red circles are labelled and implemented as the maximum recorded seventh-grade wind-radius approximation; they are not represented as a measured damage footprint.
- Verified `/api/dex` returns lifecycle timestamps, 94 path points, and official landing nodes for sample `202610`.
- `npm.cmd run typecheck` and `npm.cmd run build` passed after the update; `/dex` returned HTTP 200 from the restarted local server.
- Browser console monitoring captured no new client exception while navigating to `/dex`. The browser debugging connection closed during the monitoring window, so no screenshot artifact was retained.

## Auto-zoom and evidence update

- The top SVG now derives its `viewBox` from all selected track points plus recorded seventh-grade wind radii. It preserves the world land layer but frames the active Boss path rather than always rendering the full globe.
- Added an on-demand `/api/dex/evidence` route for GDACS event evidence. It is fetched only for the selected Boss so the archive list does not trigger a large external request fan-out.
- Verified `npm.cmd run typecheck`, `npm.cmd run build`, and local `/dex` HTTP 200 after this update.
- Current local Node network could not complete GDACS TLS handshakes even though the public endpoint was independently reachable from the system HTTP client. The UI treats a failed lookup as absent evidence; it does not invent countries, alert levels, or losses.

## Map annotation scaling fix

- Screenshot reference: `C:\Users\98716\AppData\Local\Temp\codex-clipboard-5ca00215-dd74-4b54-9c07-e4e014979035.png`.
- Converted all SVG annotation dimensions from fixed map units to a `uiScale` derived from the auto-fit `viewBox`: route stroke, glow, dash interval, marker radius, label offsets, text size, and outline width now remain screen-readable as the geographic layer zooms.
- LAND pins use a scaled local group transform, so their diamond and text stay attached to the associated route point without covering the map.
- Visual check: `C:\Users\98716\AppData\Local\Temp\dex-auto-zoom-final2.png` at 1366×768. Route, wind-radius circles, landing markers, and start/end labels are legible without the oversized-label collision from the supplied reference.
