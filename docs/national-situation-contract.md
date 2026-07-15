# National situation contract v1

The frozen shared contract lives in `lib/nationalWeatherTypes.ts`. The new
national endpoint is `/api/national-situation`; `/api/radar/snapshot` remains
the compatibility contract for existing typhoon consumers.

Contract invariants:

- `issuedAt`, `dataTime`, `updatedAt`, and source retrieval health remain
  separate concepts.
- Source state uses `fresh`, `delayed`, `expired`, `unavailable`, or
  `no-record`; failures are never represented as "no risk".
- County warnings enter a city card only when `cityAttribution` is
  `deterministic`.
- Official warnings and official risk products outrank typhoon impact events;
  radar/model observations remain `watch` events.
- Satellite index metadata stays non-georeferenced until a stable image URL
  and geographic calibration have both been verified.
- Product catalog records and image indexes carry metadata evidence only and
  cannot become numerical weather facts.
- Existing storm objects are passed through unchanged. National events cannot
  move a storm center or rewrite official tracks, forecasts, or wind radii.
