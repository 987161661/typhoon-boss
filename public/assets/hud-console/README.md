# HUD console art pack

This pack supplies quiet, static visual texture for the National Situation HUD's
"meteorological operations console" direction. It is deliberately not a component
library: controls, data, statuses, severity colours and accessible labels must stay
in React/CSS.

## Asset contract

- Every shipped file is a 1254 × 1254 RGBA PNG with transparent corners.
- Assets contain no text, digits, logos, watermarks, severity labels or interactive
  affordances. They are always `aria-hidden` and `pointer-events: none`.
- Place art in a clipped pseudo-element or decorative child behind/around the content;
  the readable data and control layers must keep a solid, contrast-safe background.
- Use only the opacity ceilings in `manifest.json`; the art should establish station
  identity, never compete with a warning title or source time.
- On 320–440 px panels, hide `radar-sector-overlay.png` and
  `synoptic-contours-overlay.png`; retain at most the cropped
  `polar-calibration-corner.png` at opacity ≤ 0.16.
- The assets are static. For `prefers-reduced-motion: reduce`, do not sweep, rotate,
  pulse, pan or parallax them. They may remain visible as still artwork.

## Theme rules

The console palette is deliberately distinct from alert severity. Cyan/ocean/slate
express the weather watch desk. Red, orange, yellow and blue remain reserved for
official warning severity as defined by the HUD's alert tokens. Hazard-specific
textures remain the responsibility of `WarningSignalCard`; do not recolor this pack
per warning type.

See `manifest.json` for asset-level placement, opacity and provenance.
