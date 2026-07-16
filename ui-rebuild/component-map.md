# Component map

- Route: `app/api/city-briefing/route.ts` produces `CityBriefing`.
- Keep: `LiveCityInteraction` upper command/verdict, warnings, action list and footer.
- Replace: `live-city-risk-arcs`, `TelemetryDeck` and `live-city-nowcast` with `CitySignalBoard` and `CityEvidenceStrip`.
- Add: `lib/citySignalBoard.ts` for pure selection, rank attachment and deterministic comments; a server-only QWeather comparator for the provincial-capital sample.
- State ownership: the server attaches optional rank facts to `CityBriefing`; client only renders the already-selected board.
