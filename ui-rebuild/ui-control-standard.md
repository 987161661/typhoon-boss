# UI Control Standard

## Sources

- Night-radar reference image: `D:\typhoon boss radar\ref-pic.png`
- Dossier style reference image: `D:\typhoon boss radar\ui-rebuild\reference-paper-clean.png`
- Generated radar HUD atlas: `public/ui-rebuild/hud-control-atlas.png`
- Radar storm marker assets:
  - `public/ui-rebuild/storm-core-super-red.png`
  - `public/ui-rebuild/storm-core-storm-cyan.png`
  - `public/ui-rebuild/storm-core-typhoon-amber.png`
  - `public/ui-rebuild/storm-core-severe-violet.png`
  - `public/ui-rebuild/storm-core-steel-red.png`

## Non-Negotiable Asset Rule

The dossier reference is a visual target, not an asset library. Do not crop UI controls, props, text blocks, map surfaces, dossiers, notes, clocks, pens, telegrams, or card frames from the reference image for implementation. Reference-derived bitmaps create baked text, hardcoded status, projection drift, and duplicated content.

Allowed asset types:

- Image2/generated material with no readable text and no real app data baked in.
- CSS-generated geometry, paper grain, seals, tabs, meters, ledgers, and small desk props.
- Existing generated radar HUD textures for the `night-radar` theme only.
- Live React/MapLibre rendering for all labels, storm data, map overlays, wind ranges, and history records.

## Image2 Prompt Record

### HUD Control Atlas

Use case: ui-mockup.
Asset type: reusable game HUD control material atlas for a web app.
Primary request: clean futuristic typhoon command radar UI control material atlas, no readable text, no logos, no icons.
Style: dark glass panels, red alert armor borders, cyan secondary circuit traces, amber warning accents.
Controls requested: empty panel backplates, clipped-corner button plates, metric-row strips, bottom alert-card plates, divider lines, corner brackets, scanline/noise samples.
Constraints: no readable typography, no brand marks, no photographic map, no storm background; UI text must remain live HTML.

### Dossier Missing Controls

Current implementation uses CSS/React-generated dossier controls plus Image2/generated neutral material grains. If image2 is used later, generate only neutral, blank material families:

- Blank aged-paper sheet texture, no text, no diagrams, no real map.
- Empty folder-tab strip, no labels.
- Blank stamp/seal texture, no readable words.
- Desk-prop silhouettes, no source-image reuse.

The generated material must be reusable behind live controls. It must not encode top-bar values, right-rail dossier content, province rows, historical records, or map elements.

Current generated dossier material:

- `public/ui-rebuild/dossier-material-atlas-v1.png`: no-text generated archive material atlas.
- `public/ui-rebuild/dossier-paper-grain-v1.png`: light paper grain for sheets and left paper controls.
- `public/ui-rebuild/dossier-folder-grain-v1.png`: folder grain for archive tab layers.
- `public/ui-rebuild/dossier-worn-grain-v1.png`: worn paper grain for archive files and pinned notes.

## Theme Contracts

### `night-radar`

Dense dark radar HUD. It owns:

- Top command rail.
- Left province defense and legend panels.
- Central MapLibre map with live storm core, path, wind ranges, time labels, and province labels.
- Right boss intel rail.
- Bottom province alert strip.

### `archive-command`

Commercial dossier theme, not a skin of `night-radar`.

Layout rules:

- MapLibre canvas stays full-size inside `.map-stage`; do not inset it for paper frames. React overlay coordinates are projected in canvas space and must not be shifted by theme decoration.
- Bottom province alert strip is not rendered in dossier mode because it duplicates the left-side defense information.
- Top rail is a dossier file header, not a radar command rail. Its brand reads as an archive case cover (`BOSS DOSSIER`) and its ledger cells are file metadata: case file, observation log count, last fix time, and forecast count.
- Right rail is a historical dossier panel with tabs, case cover, classification strip, coordinate fields, metric ledger, a full archive-stack dossier control, data source, notice, and history link. Threat skills and assessment notes are not rendered in dossier mode because they dilute the archive-file hierarchy.
- The archive-stack dossier must use real historical `storm.track` records for its timeline. Forecast points may appear only as separate metadata counts or forecast panels; do not present forecast points as historical evidence.
- Storm selection in dossier mode uses a paper-file case index control, not the radar-mode bottom storm card.
- Left defense/legend panels remain live components, restyled as compact paper-control widgets. They must not be replaced by static images.
- Desk props, operation notes, and staff telegrams may exist only as CSS-generated controls or generated neutral assets. Operation notes and staff telegrams must carry live DOM text derived from current storm/source/error state, not fixed text copied from the reference image.

Reusable dossier grammar:

- `dossier-sheet`: aged paper panel with live content.
- `dossier-tabs`: folder-tab navigation surface.
- `dossier-field`: compact coordinate/stat field.
- `dossier-meter`: public-data energy bar.
- `dossier-ledger-row`: metric table row.
- `dossier-archive-stack`: right-rail historical dossier control. It must look like a layered case file, not a normal card list. It owns folder tabs, target print/photo plate, case metadata, route evidence trace, route timeline, archive index strip, and last-fix stamp.
- `dossier-storm-index`: map-stage case index for switching storm files in dossier mode. It replaces the radar bottom storm switcher and must not overlap the top rail, left defense panel, or right dossier.
- `archive-index-strip`: compact file-index ledger showing the archive mode, evidence type, and historical observation count.
- `archive-route-trace`: compact SVG evidence map generated from historical `storm.track` coordinates. It is data-driven and must not be a static route image.
- `archive-event`: data-driven historical coordinate/time record from `storm.track` inside the archive stack. Records include a FIX number, time, coordinate, wind, and movement delta when available. In laptop/desktop dossier mode, records may use compact two-column file-index rows to avoid one-line compression.
- `dossier-history-link`: primary archive action.
- `dossier-side-tabs`: vertical folder tabs on the right edge of the dossier rail.
- `prop-order-note`: CSS-generated pinned operation note. Its title and detail are derived from current storm severity, wind, and data-link state.
- `prop-telegram`: CSS-generated staff telegram. Its detail is derived from data source, historical track count, forecast count, or link error state; hidden on small mobile screens.
- `dossier-map-furniture`: CSS-generated map furniture layer for compass rose and scale bar. It must sit above the map visually but must not resize or offset the MapLibre canvas. Do not add fixed longitude/latitude text labels unless they are computed from the current MapLibre camera projection.

## Core Map Rules

Wind impact ranges are geographic data, not screen decoration. Render `r7/r10/r12` as MapLibre GeoJSON circle layers so they scale, pan, and zoom with the map. Do not rebuild them as fixed-size HTML/CSS rings.

The typhoon visual core must be a projected overlay anchored to the live storm coordinate. Dossier mode may move the map camera to keep the projected point in a readable safe zone, but it must not fake the typhoon by placing the visual with arbitrary viewport percentages. Generated/neutral visual assets must not contain baked labels, path points, wind-range rings, or reference-map fragments.

## Color Semantics

- Red: boss identity, active threat, high alert, current typhoon marker, hot metric, dossier classification stamp.
- Amber/brass: dossier paper controls, medium alert, command metadata.
- Cyan/blue-gray: data source, radar support, low alert, neutral geospatial aids.
- Dark brown/ink: dossier frame, ledger text, desk background.

## Typography

- English display labels: condensed uppercase, heavy weight, zero negative letter spacing.
- Chinese titles: heavy sans, short lines, no bitmap text.
- Numeric values: tabular numerals, right aligned in metric rows.
- Buttons and cards must tolerate the longest expected Chinese labels without clipping.

## Responsive Rules

- Desktop `1920x1080`: show dossier right rail, top controls, live left panels, impact legend, central map, and CSS desk props. No bottom bar in dossier mode.
- Laptop `1366x768`: preserve right rail, avoid overlapping map overlays, and keep the dossier rail first-viewport fit. The dossier case index and boss visual must remain in the central map safe zone. Secondary source/notice copy, footer actions, and lower-priority duplicate metric rows may collapse, but the archive-stack dossier, classification, energy, coordinate fields, route trace, and 8 FIX records must remain visible.
- Tablet/mobile below `1180px`: right rail may be hidden by the existing one-column app layout; map canvas must remain full-size.
- Mobile below `760px`: no map inset, no bottom dossier strip, no source-image decoration dependencies.

## Implementation Boundary

Do not add hand-written variants for every province/status. Add one reusable control contract, then map state through props and CSS classes.

Do not add source-image crops back into the dossier theme. If a reference detail matters, reproduce its design language through live components or neutral generated material.
