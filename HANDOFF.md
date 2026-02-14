# Arc Timeline Diary Reader - Handoff Document

## Current Build: 872

## Project Overview
A web-based viewer for [Arc Timeline](https://www.bigpaua.com/arcapp) and Arc Editor GPS tracking data. Generates interactive diaries with maps from backup data stored in IndexedDB. Single-file HTML application, no server required.

## Project Files

### Application Files
| File | Size | Lines | Description |
|------|------|-------|-------------|
| `index.html` | 49 KB | 812 | Main entry point, import UI, modal shells |
| `app.js` | 847 KB | 18,668 | Core application logic |
| `replay.js` | 68 KB | 1,731 | Day replay animation system |
| `styles.css` | 143 KB | 5,653 | All styling |
| `map-tools.js` | 59 KB | 1,692 | Map utilities and helpers |
| `import.js` | — | — | JSON export import module (used by importFilesToDatabase) |
| `analysis.html` | — | — | Location analysis tool (standalone) |
| `delete-db.html` | — | — | Database deletion utility |

### Documentation Files
| File | Description |
|------|-------------|
| `README.md` | Project overview and usage instructions |
| `CHANGELOG.md` | Version history (146 KB, extensive) |
| `HANDOFF.md` | This document - developer context |
| `STATE_MODEL.md` | NavigationController state documentation |
| `ACKNOWLEDGEMENTS.md` | Third-party library credits |

### Not Tracked (do not commit)
| Path | Description |
|------|-------------|
| `Arc Editor Backups/` | Arc Editor backup data for testing |
| `Backups/` | Legacy Arc Timeline backup data |
| `Console *.txt` | Debug console logs |
| `arc-timeline-daily.*.json` | Test data exports |

## Architecture
- **IndexedDB** stores imported timeline data (days, metadata, analysis)
- **NavigationController** (`window.NavigationController`) is the single source of truth for navigation state (see `STATE_MODEL.md`)
- **Leaflet.js** for maps with Mapbox/CARTO tile support
- **BroadcastChannel** (`arc-diary-nav`) syncs between diary and analysis tabs
- Data flow: Backup files → normalise → group by day → IndexedDB → diary renderer

## IndexedDB Stores

| Store | Key | Description |
|-------|-----|-------------|
| `days` | `dayKey` (YYYY-MM-DD) | Raw timeline data per day. Indexes: monthKey, lastUpdated, sourceFile |
| `metadata` | `key` | App metadata: lastBackupSync, lastSync timestamps |
| `dailySummaries` | `dayKey` | Activity stats per day (v2) |
| `locationVisits` | `id` (auto) | Individual location visits. Indexes: locationName, dayKey, locationDay |
| `locations` | `name` | Aggregated location stats (rebuilt from locationVisits) |
| `months` | `monthKey` | Month aggregates |

## Data Import

### Three Import Pathways

#### 1. Arc Editor Backup (Primary)
The main import path for current Arc Editor backups. Two parallel implementations:
- **Chrome**: `importFromBackupDir()` — uses File System Access API (`showDirectoryPicker`)
- **Safari**: `importFromBackupFiles()` — uses `webkitdirectory` FileList fallback

Arc Editor backup structure (bucketed format, schema v2.2.0):
```
<UUID>/
  metadata.json          — export metadata, record counts
  items/YYYY-MM.json     — monthly timeline item files (nested base/visit/trip)
  notes/YYYY-MM.json     — monthly note files
  samples/YYYY-Www.json.gz — weekly GPS sample files (gzipped)
  places/0-F.json        — hex-bucketed place files (16 files)
```

#### 2. Legacy Arc Timeline Backup
For older Arc Timeline iCloud backups:
```
TimelineItem/XX/UUID.json  — hex-bucketed individual item files
LocomotionSample/          — weekly gzip GPS samples
Place/                     — hex-bucketed places
Note/                      — hex-bucketed notes
```

#### 3. JSON Export Import (Quick Updates)
- `importFilesToDatabase()` — accepts directory of daily YYYY-MM-DD.json.gz files

### Import Modes (UI radio group)
- **Recent only** — reads last 2 months of item/note files (~97% fewer files)
- **Full import** — all files, skips unchanged items via `lastBackupSync` timestamp
- **Force rescan** — reimports everything, ignores timestamps

Last-used mode is persisted in localStorage.

### Key Import Functions
| Function | Line ~| Description |
|----------|-------|-------------|
| `normalizeBackupItem(rawItem)` | 3942 | Normalises Arc Editor nested `{base, visit, trip}` or legacy flat format |
| `normalizeBackupPlace(rawPlace)` | 3957 | Normalises place data |
| `normalizeBackupNote(rawNote)` | 3981 | Normalises notes, preserves `timelineItemId` |
| `normalizeBackupSample(rawSample)` | 3992 | Normalises GPS samples |
| `mapArcEditorActivityType(code)` | 3894 | Maps LocoKit2 numeric ActivityType enum to display strings |
| `importDayToDB(dayKey, ...)` | ~679 | Stores day with content hash comparison |
| `getRecentMonthKeys(n)` | ~3860 | Returns Set of last n month strings for filtering |
| `getRecentWeekKeys(n)` | ~3870 | Returns Set of last n ISO week strings for filtering |

### LocoKit2 Data Model (Arc Editor)
Source: https://github.com/sobri909/LocoKit2

Timeline items use a **composite structure**:
```json
{
  "base": { "id": "UUID", "isVisit": true, "startDate": "ISO", "endDate": "ISO", "previousItemId": "UUID", "nextItemId": "UUID", "lastSaved": "ISO", "deleted": false },
  "visit": { "itemId": "UUID", "placeId": "UUID", "customTitle": "...", "latitude": -27.5, "longitude": 153.1, "streetAddress": "..." },
  "trip": { "itemId": "UUID", "confirmedActivityType": 5, "classifiedActivityType": 5, "distance": 1865.7, "speed": 5.2 }
}
```

Items form a **doubly-linked list** via `previousItemId`/`nextItemId`.

Notes link to items via `timelineItemId` (newer notes, source: LocoKit2) or by time-range overlap (older notes, source: LocoKit).

ActivityType enum (key values): unknown=-1, bogus=0, stationary=1, walking=2, running=3, cycling=4, car=5, airplane=6, train=20, bus=21, motorcycle=22, boat=23, scooter=28, hiking=61. Full mapping in `mapArcEditorActivityType()`.

`confirmedActivityType` = user-confirmed → sets `manualActivityType: true`.

### Delete Days
- `deleteDaysFromDB(dayKeys)` — deletes from `days`, `dailySummaries`, `locationVisits`, rebuilds location aggregates, clears memory caches, resets `lastBackupSync` and `lastSync` so reimport restores deleted days
- UI: "Clear" button opens Delete Days modal (single day / date range / clear all)

## Display Pipeline

### Timeline Coalescing (display-only, non-destructive)
Applied only to backup imports. Key function: `coalesceTimelineForDisplay(items)` (~line 16218).

Rules:
1. **Containment**: visits fully within a longer visit's timespan are hidden (`_contained`)
2. **Zero-duration suppression**: zero-length visits without customTitle between same-place visits
3. **Low-signal suppression**: short (<15 min) stationary/unknown/tiny-walking fragments between same-place visits
4. **Adjacent visit merging**: same-place visits with gap ≤15 min merged for display
5. Items with `customTitle` are NEVER hidden or suppressed

### Diary Rendering
`extractNotesFromData()` → `coalesceTimelineForDisplay()` → generates markdown-like diary entries with timestamps, locations, notes, and activity icons.

## Replay System (replay.js)

`ReplayController` class animates a day as a journey with sprite moving along routes.

Key design: Timeline uses **DISTANCE** not time — this is a "trip player" where stationary time doesn't dominate the bar.

## Build Process
Build number source of truth: `index.html` line 35: `window.__ARC_BUILD__ = 872`

Update when releasing:
1. `index.html` — `window.__ARC_BUILD__` constant AND `#diaryBuild` span
2. `README.md` — Build number in header
3. `CHANGELOG.md` — Add entry for new build

### Window Function Exposure
Functions defined inside the main closure must be exposed via `window.funcName = funcName` at the bottom of app.js (~line 18490+) for inline `onclick` handlers to work. These are alphabetically ordered.

## User Context
- Gordon is a retired software developer (retired September 2025)
- Prefers brief, efficient explanations
- Uses Mapbox for tiles/geocoding (token in localStorage)
- Arc Editor backup data is at `Arc Editor Backups/26DD32A8-63E3-422E-92CB-C3321569E72B/`

## Git Notes
- **IMPORTANT**: `Arc Editor Backups/` and `Backups/` contain large data — do NOT commit
- Use `git add <specific files>` not `git add -A`
- Always expose new functions on `window` if they're called from HTML onclick handlers
