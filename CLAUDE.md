# CLAUDE.md — Arc Diary Reader Architecture Guide

This file helps Claude Code navigate the codebase efficiently. Keep it high-level — detailed enough to know where to look, coarse enough to stay accurate as code evolves.

## Application Overview

Arc Diary Reader is a browser-based tool for exploring Arc Timeline / Arc Editor location history. It imports daily JSON exports or iCloud backups into IndexedDB, then presents them as a searchable diary with maps, routes, statistics, and AI-powered analysis. Everything runs client-side — no server, no account.

## File Map

### Entry Points

| File | Role |
|------|------|
| `index.html` | Start screen — import, database status, settings, documentation links. Opens the diary reader modal. |
| `analysis.html` | Separate page — Analysis panel with tabs for Activities, Locations, Daily stats, Heatmap, and AI Chat. Own IndexedDB connection. |
| `styles.css` | All CSS for index.html and the diary reader UI. |

### JavaScript Modules (load order in index.html)

| # | File | Module | Purpose |
|---|------|--------|---------|
| 1 | `arc-state.js` | `window.ArcState` | Singleton shared state — DB refs, navigation, import tracking, map instance. No dependencies. |
| 2 | `arc-utils.js` | `window.ArcUtils` | Pure utilities — formatting, haversine distance, elevation, compression. No dependencies. |
| 3 | `arc-db.js` | `window.ArcDB` | IndexedDB layer — CRUD, metadata, ghost filtering, place names, activity types, analysis rebuild. Depends on ArcState, ArcUtils. |
| 4 | `arc-data.js` | `window.ArcData` | Data transformation — coalescing timeline items, extracting tracks/notes/pins, clustering locations, daily stats. Depends on ArcState, ArcUtils, ArcDB. |
| 5 | `events.js` | `window.ArcEvents` | Multi-day events — CRUD, categories, event slider UI. Uses localStorage. Minimal dependencies. |
| 6 | `share.js` | `window.ArcShare` | Tour sharing — create/open `.arctrip` files, guest viewing mode. Privacy warning on create. |
| 7 | `replay.js` | `ReplayController` class | Day animation — route playback on map with activity icons, speed control. |
| 8 | `map-tools.js` | Global functions + `MeasurementTool` class | Distance measurement, OSRM route search, elevation profiles. |
| 9 | `import.js` | `window.ArcImport` | Import engine — parse backup zips or JSON exports, merge, report. Depends on all data layers. |
| 10 | `app.js` | Global `initApp()` | Main orchestrator — initialises everything, handles navigation, renders diary/map/stats. Coordinates all modules via UI callbacks. |

### Analysis (separate page)

| File | Role |
|------|------|
| `analysis-ai.js` | AI Chat tab — Anthropic Claude API integration, tool definitions, executors, system prompt, cost tracking. IIFE, not a window module. Runs inside analysis.html. |

### Utility Pages

| File | Role |
|------|------|
| `delete-db.html` | Standalone page to delete the IndexedDB database. |
| `backup-extractor.html` | Extract individual days from backup archives. |
| `gzip-compressor.html` | Compress/decompress gzip files. |
| `gzip-batch-compressor.html` | Batch compress multiple files. |

## Key Architectural Patterns

- **IIFE modules** — Most files wrap in `(() => { ... })()` with public API on `window.ModuleName`.
- **Singleton state** — `ArcState` holds shared variables (db, navigation, import state) so modules avoid circular dependencies.
- **UI callbacks** — `arc-db.js`, `events.js`, `share.js`, `replay.js` accept callback registrations from `app.js` for loose coupling.
- **Privacy by design** — `analysis-ai.js` strips GPS coordinates and addresses before sending data to the Anthropic API via `stripCoordsForAPI()`. Coordinates are cached locally in `coordsCache` for map display.

## IndexedDB Stores

| Store | Key | Contents |
|-------|-----|----------|
| `days` | `dayKey` (YYYY-MM-DD) | Raw timeline data — `timelineItems[]` with visits, activities, GPS samples. |
| `dailySummaries` | `dayKey` | Aggregated stats per day — activity counts, durations, distances. |
| `locations` | `name` | Aggregate location data — total visits, duration, first/last visit, lat/lng. |
| `locationVisits` | auto-increment | Per-day visit records — locationName, dayKey, duration, visitCount, lat/lng. Indexed by `locationName` and `dayKey`. |
| `metadata` | string key | App settings — mapbox token, activity totals, import state. |

## AI Chat Tools (analysis-ai.js)

The LLM has 15 tools for querying timeline data. Tool executors run client-side and return results to Claude.

**Query tools:**
- `get_activity_summary` — Activity totals for a date range (from dailySummaries)
- `get_monthly_summary` — Per-month activity breakdown
- `get_daily_stats` — Day-by-day stats (max 90 days)
- `get_day_timeline` — Full timeline for one day (visits, activities, times)
- `get_date_range_places` — All places visited in a date range (from days store)
- `get_top_locations` — Top N locations by visits or duration
- `search_locations` — Substring search on location names
- `find_location_visits` — Search + visit history for a location
- `get_location_details` — Full details + last 100 visits for a location
- `find_days_in_region` — Bounding box GPS search (for "when did I go to Japan?")
- `get_elevation_stats` — Find highest/lowest altitude points from GPS samples

**Display tools:**
- `show_map` — Render markers on Leaflet map (resolves coords from local cache)
- `show_route` — Draw colour-coded GPS routes on map (from days store GPS samples)
- `show_heatmap` — Render GPS data as heat map on chat map (frequency, recency, or time spent modes)
- `show_chart` — Render Chart.js charts inline in chat (bar, line, pie, doughnut) with PNG export

## Common Tasks

**Adding a new AI chat tool:**
1. Add tool definition (name, description, input_schema) to the tools array (~line 190-340 in analysis-ai.js)
2. Add executor function in the executors object (~line 420-800)
3. Update system prompt if Claude needs guidance on when to use it (~line 1079)

**Modifying the start screen:**
- Layout is in `index.html` lines 158-270 (container → header → dbStatusSection → mapboxSettings → docLinks → fileInputSection)
- Styles in `styles.css` (search for `.import-panel`, `.btn-primary`, `.btn-secondary`, `.doc-link`)

**Modifying the diary reader:**
- Modal structure in `index.html` starting ~line 440 (toolbar, map container, diary panel)
- Diary markdown rendering in `app.js` — search for `generateMarkdown`, `marked.parse`

**Modifying analysis page:**
- All in `analysis.html` — self-contained with inline CSS and embedded JS
- AI chat tab code in `analysis-ai.js`

## External Dependencies

| Library | Purpose | Loaded From |
|---------|---------|-------------|
| Leaflet | Maps | unpkg CDN |
| Leaflet.markercluster | Marker clustering | unpkg CDN |
| Chart.js | Charts in analysis | jsdelivr CDN |
| Marked | Markdown rendering | jsdelivr CDN |
| DOMPurify | HTML sanitisation | jsdelivr CDN |
| Pako | Gzip compression | cdnjs CDN |

## Build & Deployment

- No build step — plain HTML/JS/CSS served as static files.
- CSS and JS loaded with `?v=BUILD_NUMBER` for cache invalidation.

### Build Numbering Scheme

Format: **`VV.BBB`** (e.g. `02.000`, `02.001`, `02.015`)

- **VV** — Version number. Increments for major feature releases (e.g. `01` → `02` when AI Chat was added). No strict rules on what constitutes a version bump — use judgement for significant new capabilities.
- **BBB** — Build number within that version. **Must increment with every code change**, no matter how small. This is the developer's primary tool for confirming the correct build is running during testing. Resets to `000` when the version increments.

**Source of truth:** `window.__ARC_BUILD__` in `index.html` (line ~39). This is a string (e.g. `'02.000'`).

**Where it appears:**
- `index.html` — `window.__ARC_BUILD__` (single source of truth)
- `analysis.html` — `ANALYSIS_BUILD` constant (must be updated in sync)
- Diary header — `#diaryBuild` span, populated dynamically from `__ARC_BUILD__`
- Start screen footer — `#appVersion` span, populated dynamically from `__ARC_BUILD__`
- Browser tab title — appended by init script
- Documentation (README.md, MANUAL.md, CHANGELOG.md) — update on release

**IMPORTANT:** When making any code change, increment the build number in both `index.html` (`__ARC_BUILD__`) and `analysis.html` (`ANALYSIS_BUILD`). The diary header and footer are populated dynamically and do not need manual updates.
