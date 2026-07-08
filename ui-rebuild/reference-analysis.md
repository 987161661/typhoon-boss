# Reference Analysis

## Visual Hierarchy

1. Central typhoon eye and cloud vortex, glowing red, placed over the ocean/map.
2. Top command identity: `TYPHOON BOSS RADAR`, `LIVE RADAR`, mission/threat/system status.
3. Right `BOSS INTEL` panel with super-typhoon identity and metrics.
4. Bottom province defense warning strip.
5. Left province defense and legend panels.

## Layout Regions

- Top command band: full width, about 11% of viewport height.
- Left operational rail: about 12-14% width, stacked defense and legend panels.
- Center map theater: about 62-66% width, full remaining height behind overlays.
- Right intel rail: about 18-20% width, full height between top/bottom frame.
- Bottom alert band: about 14-16% height, province cards plus ticker/data source.

## Visual Language

- Background: near-black, dark blue-black, satellite night map, subtle grid, noise, scanlines.
- Primary alert color: red/orange-red for boss, threat, active path, hottest borders.
- Secondary system color: cyan for radar, map grid, low alerts, supporting labels.
- Warning color: amber/yellow for medium alerts and wind-range hierarchy.
- Typography: condensed industrial display for English, heavy Chinese sans for labels, tabular/mono numerals for metrics.
- Panels: translucent dark glass, clipped corners, segmented armor lines, 1px neon borders, glow only on high-priority elements.

## Component Inventory

- `AppShell`
- `HudFrame`
- `TopCommandBar`
- `ProvinceDefensePanel`
- `LegendPanel`
- `SatelliteMapPanel`
- `TyphoonCore`
- `ForecastPathLayer`
- `ImpactRangeLayer`
- `BossIntelPanel`
- `MetricRow`
- `ProvinceAlertStrip`
- `AlertTicker`
- `DataSourceBar`

## Asset Needs

- Existing/code-generated:
  - MapLibre dark basemap
  - Radar grid and scanline overlays
  - Wind rings, path lines, path points
  - Lucide-based icons
- Candidate generated assets:
  - High-detail typhoon vortex texture with transparent center treatment
  - HUD panel texture/noise overlay
  - Optional satellite night-map fallback image
  - Boss vortex emblem for the right panel

## First-Screen Acceptance

- No scroll at 1920x1080.
- All top, left, center, right, and bottom regions visible.
- Storm eye is the brightest point.
- Right metric rows have aligned values and units.
- Province cards encode red/yellow/cyan levels consistently.
- Light motion exists but does not reduce readability.
