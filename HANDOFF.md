# Arc Timeline Diary Reader - Handoff Document

## Current Build: 700

## Project Overview
A web-based viewer for Arc Timeline GPS tracking data that generates interactive diaries with maps. Single-file HTML applications with no server required.

## Project Files

### Application Files
| File | Size | Description |
|------|------|-------------|
| `index.html` | 33 KB | Main diary viewer entry point |
| `app.js` | 620 KB | Core application logic (~13,500 lines) |
| `replay.js` | 60 KB | Day replay animation system (~1,600 lines) |
| `styles.css` | 111 KB | All styling (~3,500 lines) |
| `analysis.html` | 240 KB | Location analysis tool (standalone) |
| `map-tools.js` | 43 KB | Map utilities and helpers |
| `delete-db.html` | 6 KB | Database deletion utility |

### Documentation Files
| File | Description |
|------|-------------|
| `README.md` | Project overview and usage instructions |
| `CHANGELOG.md` | Version history (95 KB, extensive) |
| `HANDOFF.md` | This document - developer context |
| `ACKNOWLEDGEMENTS.md` | Third-party library credits |
| `STATE_MODEL.md` | Application state documentation |
| `REFACTORING_PLAN.md` | Future refactoring notes |

### Git/Config
| File | Description |
|------|-------------|
| `.gitignore` | Git ignore patterns |
| `.claude/` | Claude Code settings |

### Not Tracked (do not commit)
| File | Description |
|------|-------------|
| `Backups/` | Large data files for testing |
| `Console *.txt` | Debug console logs |
| `arc-timeline-daily.*.json` | Test data exports |

## Architecture
- **IndexedDB** stores imported Arc Timeline JSON data
- **BroadcastChannel** (`arc-diary-nav`) syncs between diary and analysis tabs
- **Leaflet.js** for maps with Mapbox/CARTO tile support
- Data flow: JSON/Backup files → IndexedDB → rendered diary entries

## Data Import - Two Pathways

### 1. JSON Export Import (Quick Updates)
- Located in `app.js`, function `importFilesToDatabase()` around line 1536
- Accepts directory of Arc Timeline JSON files
- Parses daily YYYY-MM-DD.json.gz files from Arc's export format
- Best for: updating specific days quickly

### 2. iCloud Backup Import (Full Recovery)
- Located in `app.js`, function `importFromBackup()` around line 2480
- Reads from Arc Timeline's iCloud Backup folder structure:
  - `TimelineItem/` - UUID-bucketed JSON files (visits/activities)
  - `LocomotionSample/` - Weekly gzip files with GPS samples
  - `Place/` - Named locations with coordinates
  - `Note/` - Diary notes with timestamps
- Reconstructs complete daily records by joining related data
- Best for: recovering missing days

## Replay System (Major Feature)

**Extracted to `replay.js` in Build 693** - now a standalone `ReplayController` class.

### Overview
The replay system animates the user's day as a journey, showing a sprite moving along routes with location popups appearing at stops.

### Architecture (replay.js)
- `ReplayController` class with `init()` method receiving dependencies from app.js
- Dependencies use getter functions for async-created objects:
  - `getMap`, `getGeneratedDiaries`, `getCurrentDayKey` - getter functions
  - `getMapPadding`, `clearMapLayers`, `showDayMap` - direct functions
  - `calculateDistance`, `calculateDistanceMeters`, `getPointTime`, `cancelMeasurement` - utility functions
- Exposes global functions for compatibility: `window.replayState`, `window.toggleReplayController`, `window.loadReplayDay`, etc.

### Key Methods (ReplayController)
- `toggle()` - Opens/closes replay UI
- `animate()` - Main animation loop
- `seekTo(event)` - Seek by clicking timeline (TIME-based)
- `seekToTime(targetTime)` - Seek to specific timestamp programmatically
- `checkForLocationInPath()` - Detects when sprite passes a location
- `findNearestStop()` - Finds next location for deceleration
- `createTimelineMarkers()` - Creates timeline markers (TIME-based)
- `showLocationPopup()` - Shows green road-sign popup at locations

### Key State (ReplayController.state)
- `active` / `playing` - Replay state flags
- `routeData` - Array of GPS points for the day
- `cumulativeDistances` - Distance at each point for interpolation
- `dayLocations` - Location visits for the day
- `selectedDayKey` - YYYY-MM-DD of day being replayed
- `visitedLocations` - Set of locations already shown (prevents duplicates)

### Recent Replay Fixes (Builds 686-696)
- **Build 687**: Timeline bar changed from DISTANCE to TIME-based (reverted in 694)
- **Build 688**: Diary clicks work during replay
  - Same day: pause and seek to entry's start time
  - Different day: close replay and navigate normally
- **Build 689-691**: Location popup improvements on seek
  - Shows popup immediately when seeking to a location
  - Uses target time for matching (not route point time)
  - Centers map on location coordinates
- **Build 692**: Reset sprite icon when seeking (was staying as finish flag)
- **Build 693**: Extracted replay system to `replay.js` (Phase 3 refactoring)
- **Build 694**: Timeline bar reverted to DISTANCE-based
  - All timeline components now consistent: markers, progress bar, seeking all use distance
  - Clicking 50% on timeline = 50% of trip distance traveled
  - Long stays at one location take minimal space on timeline (trip player concept)
- **Build 696**: Fixed popup double-showing when arriving at locations
  - Added `visitedLocations.add()` in `checkLocationArrival()` before showing popup

### Important Design Decisions
- Timeline uses DISTANCE (not time) - this is a "trip player" where staying at one location for hours doesn't dominate the timeline
- `checkForLocationInPath()` uses same logic as `findNearestStop()` - finds THE closest route point to each location
- Popup appears at location's coordinates, sprite stops at closest route point

## Key Data Structures

### IndexedDB Stores
- `days` - keyed by date string "YYYY-MM-DD", contains timeline items
- `locations` - keyed by location name, aggregated visit stats
- `locationVisits` - individual visits with coords for clustering
- `metadata` - lastSync, lastBackupSync timestamps

## NavigationController
Central controller for all navigation (line ~4500). Handles:
- Day/entry selection from diary clicks
- Map marker clicks
- Keyboard navigation
- **Replay integration** - checks `replayState.active` and either seeks (same day) or closes replay (different day)

## Build Process
Build number is in `index.html` line 35: `window.__ARC_BUILD__ = 692`

Update all three files when releasing:
- `index.html` - Build constant
- `README.md` - Build number in header
- `CHANGELOG.md` - Add entry for new build

## User Context
- Gordon is a software developer (retired September 2025)
- Prefers brief, efficient explanations
- Uses Mapbox for tiles/geocoding (token in localStorage)

## Git Notes
- **IMPORTANT**: The `Backups/` folder contains large data files - do NOT commit
- Use `git add <specific files>` not `git add -A`
- Untracked files to ignore: `Backups/`, `Console *.txt`, `arc-timeline-daily.*.json`
