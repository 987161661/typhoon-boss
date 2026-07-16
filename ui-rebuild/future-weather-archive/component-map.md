# Component map

- `app/page.tsx` → `TyphoonMap` standard route.
- `TyphoonMap.tsx` keeps `NationalSituationSurface` as loading/error/retained-data owner.
- `variant="full"` now renders `FutureWeatherArchivePanel`.
- `variant="compact"` still renders `NationalSituationHud`, preserving `/live`.
- `FutureWeatherArchivePanel` owns only presentation composition and reuses:
  - `buildNationalSituationHudModel(snapshot)`
  - `useWarningCarousel(model.warningQueue)`
  - map event and city callbacks passed from `TyphoonMap`

## Golden components

- `StormSpecimen`: active event art, seal, evidence text, carousel and map action.
- `EvidenceTicket`: reusable five-state source voucher.

## Composed sections

- `BureauPlaque`
- `CaseRack`
- `VerificationGate`
- `EvidenceRibbon`
- `ArchiveFooter`

No API, national model, or map camera ownership moved into the new visual component.
