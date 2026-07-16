# QA report

- Commands run: `npm.cmd run typecheck` (pass); `npm.cmd test` (52 pass); `npm.cmd run lint` (pass); live `GET /api/city-briefing?city=郑州` on port 3038 (pass).
- Viewports: CSS rules cover 700px desktop and <=760px mobile; browser screenshot verification is pending because this session has no connected browser-control runtime.
- Initial issue: fixed telemetry grids elevate ordinary values and consume most of the card height.
- Fixed issues: fixed 3-risk/8-metric layout is hidden; primary signal text is enlarged for live-room distance viewing; ordinary readings collapse into one calm card; raw supporting values moved to a compact ledger.
- Ranking verification: ran `npm.cmd run cities:rank:refresh`, which fetched 2,584 fulfilled QWeather observations from the official China Location List roster of 3,203 points. After restart, `@郑州` returned `全国城市点位` ranking with denominator 2,584.
- Daily operation: installed Windows task `TyphoonBossRadar-NationalCityRank`, scheduled for 03:15 local time. Repeated live `@郑州` requests preserved generated time, observation time and humidity while changing only the battle-report text.
- Queue timing: no pending request leaves a report visible for 30 seconds. A waiting request may preempt only after the active report has held for 10 seconds; an operator request goes to the front of that waiting line.
- Remaining risk: this is a nationwide QWeather city-location-point population, which may include district/county weather locations rather than only administrative prefecture cities. The UI explicitly says `全国城市点位`; it does not claim a prefecture-city census. The snapshot expires after 75 minutes and must be refreshed by the rank job.
