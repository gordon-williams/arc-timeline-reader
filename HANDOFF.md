# Arc Timeline Diary Reader - Handoff Document

## Current Build: 873

## Project Overview
A web-based viewer for [Arc Timeline](https://www.bigpaua.com/arcapp) and Arc Editor GPS tracking data. Generates interactive diaries with maps from backup data stored in IndexedDB. Single-file HTML application, no server required.

## Project Files

### Application Files
| File | Lines | Description |
|------|-------|-------------|
| `index.html` | ~830 | Main entry point, import UI, modal shells |
| `app.js` | ~11,710 | Core application logic (UI, rendering, navigation) |
| `arc-state.js` | ~90 | Shared state (`window.ArcState`) + logging setup |
| `arc-utils.js` | ~207 | Pure utility functions (formatting, distance, decompression) |
| `arc-db.js` | ~2,540 | IndexedDB storage layer (CRUD, analysis, place names) |
| `arc-data.js` | ~1,200 | Data extraction & transformation (notes, pins, tracks, stats) |
| `events.js` | ~1,105 | Events system (CRUD, slider UI, categories) |
| `import.js` | ~2,560 | All import: JSON export + Arc Editor/Legacy backup import |
| `map-tools.js` | ~1,692 | Map utilities, measurement, location search |
| `replay.js` | ~1,731 | Day replay animation system |
| `styles.css` | ~5,650 | All styling |
| `analysis.html` | — | Location analysis tool (standalone) |
| `delete-db.html` | — | Database deletion utility |

### Module Loading Chain
```
arc-state.js → arc-utils.js → arc-db.js → arc-data.js → events.js →
map-tools.js → replay.js → import.js → app.js
```

### Module Pattern
All modules use IIFE + `window.ArcXxx` namespace. Modules that need app.js UI functions use a `_ui` callback pattern (registered via `setUICallbacks()`) to avoid circular dependencies. App.js has bridge aliases (`const { fn } = window.ArcDB;`) so existing call sites don't need renaming.

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
- **Modular design**: Shared state (`arc-state.js`), utilities (`arc-utils.js`), DB layer (`arc-db.js`), data extraction (`arc-data.js`), events (`events.js`), then app.js for UI/rendering
- **IndexedDB** stores imported timeline data (days, metadata, analysis)
- **NavigationController** (`window.NavigationController`) is the single source of truth for navigation state (see `STATE_MODEL.md`)
- **Leaflet.js** for maps with Mapbox/CARTO tile support
- **BroadcastChannel** (`arc-diary-nav`) syncs between diary and analysis tabs
- Data flow: Backup files → normalise → group by day → IndexedDB → diary renderer
- **Import module** (`import.js`) handles all three import pathways: JSON export, Arc Editor backup, and Legacy backup

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

### Key Import Functions (all in import.js)
| Function | Line ~| Description |
|----------|-------|-------------|
| `importFromBackupDir()` | ~1327 | Chrome backup import (File System Access API) |
| `importFromBackupFiles()` | ~1962 | Safari backup import (webkitdirectory fallback) |
| `normalizeBackupItem(rawItem)` | ~1062 | Normalises Arc Editor nested `{base, visit, trip}` or legacy flat format |
| `normalizeBackupPlace(rawPlace)` | ~1101 | Normalises place data |
| `normalizeBackupNote(rawNote)` | ~1125 | Normalises notes, preserves `timelineItemId` |
| `normalizeBackupSample(rawSample)` | ~1137 | Normalises GPS samples |
| `mapArcEditorActivityType(code)` | ~1014 | Maps LocoKit2 numeric ActivityType enum to display strings |
| `orderItemsByLinkedList()` | ~1190 | Orders items using doubly-linked list pointers |
| `getRecentMonthKeys(n)` | ~976 | Returns Set of last n month strings for filtering |
| `getRecentWeekKeys(n)` | ~987 | Returns Set of last n ISO week strings for filtering |
| `importDayToDB(dayKey, ...)` | arc-db.js ~679 | Stores day with content hash comparison |

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
Applied only to backup imports. Key function: `coalesceTimelineForDisplay(items)` in arc-data.js (~line 75).

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
Functions defined inside the main closure must be exposed via `window.funcName = funcName` at the bottom of app.js (~line 11680+) for inline `onclick` handlers to work. These are alphabetically ordered. Import-related window exposures (`selectImportType`, `selectBackupFolder`, `handleBackupFolderSelected`) are now set in import.js `init()`.

## User Context
- Gordon is a retired software developer (retired September 2025)
- Prefers brief, efficient explanations
- Uses Mapbox for tiles/geocoding (token in localStorage)
- Arc Editor backup data is at `Arc Editor Backups/26DD32A8-63E3-422E-92CB-C3321569E72B/`

## Modularization Lessons (Build 873)

When extracting code from app.js into modules, these issues arose repeatedly and must be checked for in future extractions:

### 1. Missing Exports
Functions defined in a module but not listed in its `window.ArcXxx` export object won't be visible to app.js. **After extracting, verify every function used by app.js is in the export AND in the app.js bridge destructure.** (e.g., `calculateMonthlyActivityStats` was in arc-data.js but missing from both the export and the bridge.)

### 2. Orphaned References
When extracting a section that contains utility functions (like `escapeHtml`), other parts of app.js may still call those functions. **Search the entire app.js for every function name being extracted** before removing the code. (e.g., `escapeHtml` was in the events section and got extracted to events.js, but `generateMarkdown` in app.js still called it.)

### 3. Temporal Dead Zone (TDZ)
Bridge destructures using `const { fn } = window.ArcXxx` at the bottom of app.js cause TDZ errors — the `const` binding exists throughout the scope but can't be accessed before its declaration line. **All bridge destructures must be at the top of the IIFE scope** (currently lines 77-145). This applies even though the functions are only called at runtime, because JavaScript's TDZ check is lexical.

### 4. Phantom Function Names in Callbacks
When wiring `_ui` callbacks, the callback name in the receiving module may not match any actual function in app.js. **Verify every callback name exists as a real function** before wiring. Use a wrapper if names differ. (e.g., events.js expected `renderMonth` but the actual function is `displayDiary(monthKey)` — fixed with `renderMonth: () => displayDiary(S.currentMonth)`.)

### 5. Functions That Live in Multiple Sections
A function may be referenced in the section being extracted but actually defined elsewhere in app.js. Don't include it in the module's exports if its body isn't in the module. (e.g., `orderItemsByLinkedList` was referenced in the DB section but defined in the backup import section — exporting it from arc-db.js caused a crash. It now lives in import.js.)

### Checklist for Future Extractions
1. For every function in the extracted section, grep app.js for callers — add to export if needed
2. For every function called FROM the extracted section, verify it's accessible (imported or passed via `_ui`)
3. Place all bridge destructures at the TOP of app.js IIFE (lines 77-145)
4. Verify `_ui` callback names match real function names in app.js
5. Test by loading the app and checking console — errors cascade, fix them top-down

## Git Notes
- **IMPORTANT**: `Arc Editor Backups/` and `Backups/` contain large data — do NOT commit
- Use `git add <specific files>` not `git add -A`
- Always expose new functions on `window` if they're called from HTML onclick handlers
