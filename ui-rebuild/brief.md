# UI Rebuild Brief

## Target

Rebuild the main frontend UI of `typhoon-boss-radar` toward the provided reference image:

- `D:\typhoon boss radar\ref-pic.png`

The target is a full-screen typhoon command radar interface: dense, high-contrast, military HUD, with a central storm/map composition and operational panels.

## Current App

- Framework: Next.js 15 / React 19 / TypeScript
- Main route: `app/page.tsx`
- Main component: `components/TyphoonMap.tsx`
- Styling entry: `app/globals.css`
- Data model: `lib/types.ts`, `lib/realTyphoonData.ts`
- Map engine: MapLibre GL
- Icons: `lucide-react`

## Scope

- Keep the existing real-time typhoon concept and MapLibre-backed center stage.
- Refactor UI through reusable HUD primitives, design tokens, and component contracts.
- Match the reference image's first-screen composition: top command bar, left defense panels, central typhoon/map/path, right boss intel panel, bottom alert strip.
- Preserve data-driven rendering. Do not replace the app with a static poster.

## Non-Goals

- Do not build many one-off hardcoded variants for every panel.
- Do not swap the mapping stack unless current MapLibre constraints block the target.
- Do not treat generated assets as the layout system; assets support the UI, not replace it.

## Immediate Risks

- Several source files currently show mojibake Chinese text. Fixing or regenerating user-visible copy should be an implementation gate.
- The current CSS is large and global; new HUD primitives should reduce repetition before adding more variants.
- The reference is wide-screen first. Mobile behavior should be deliberate, not an afterthought.

## Success Criteria

- At 1920x1080, the first screen shows all major reference regions without scrolling.
- Central storm eye is the brightest focus; path, wind rings, and time labels remain readable.
- Left/right panels do not obscure the storm path.
- Bottom province alert strip remains data-driven and uses consistent red/yellow/cyan semantics.
- Text fits at 1920x1080, 1366x768, and a narrow mobile viewport.
- Build/typecheck status and visual QA notes are recorded in `qa-report.md`.

## Current Phase

Phase 11: full dossier-theme rebuild. The previous source-reference crop approach has been rejected and removed from the live implementation. `archive-command` is now defined as a live dossier interface: full-size MapLibre canvas, no bottom province strip, CSS/React-generated paper controls, and a dedicated historical dossier right rail in `components/IntelPanel.tsx`.
