# Arc Timeline Diary Reader - Handoff Document

## Current Build: 599

## Project Overview
A web-based viewer for Arc Timeline GPS tracking data that generates interactive diaries with maps. Single-file HTML applications with no server required.

## Key Files
- `index.html` - Main diary viewer entry point
- `app.js` - Core application logic (~11,900 lines)
- `styles.css` - All styling (~3,500 lines)
- `analysis.html` - Location analysis tool (~5,600 lines)
- `map-tools.js` - Map utilities

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

### 2. iCloud Backup Import (Full Recovery) - NEW in Build 599
- Located in `app.js`, function `importFromBackup()` around line 2480
- Reads from Arc Timeline's iCloud Backup folder structure:
  - `TimelineItem/` - UUID-bucketed JSON files (visits/activities)
  - `LocomotionSample/` - Weekly gzip files with GPS samples
  - `Place/` - Named locations with coordinates
  - `Note/` - Diary notes with timestamps
- Reconstructs complete daily records by joining related data
- Best for: recovering missing days (1163+ days not in JSON export)

## Key Data Structures

### IndexedDB Stores
- `days` - keyed by date string "YYYY-MM-DD", contains timeline items
- `locations` - keyed by location name, aggregated visit stats
- `locationVisits` - individual visits with coords for clustering
- `metadata` - lastSync, lastBackupSync timestamps

## Recent Work (Builds 585-599)
- Build 599: iCloud Backup import support with dual import UI
- Build 598: Location view mode with keyboard navigation
- Multi-location clustering (150m diary, 300m analysis)
- Geocoding with Mapbox/Nominatim for suburb names

## Build Process
```bash
sed -i 's/__ARC_BUILD__ = 599/__ARC_BUILD__ = 600/g' index.html
sed -i 's/ANALYSIS_BUILD = 599/ANALYSIS_BUILD = 600/g' analysis.html
zip -r Arc_Timeline_Diary_Reader-build-600.zip index.html app.js map-tools.js styles.css analysis.html f1car.js F1_Car.svg README.md CHANGELOG.md STATE_MODEL.md ACKNOWLEDGEMENTS.md REFACTORING_PLAN.md delete-db.html HANDOFF.md
```

## User Context
- Gordon is a software developer retiring September 2025
- Prefers brief, efficient explanations
- Uses Mapbox for tiles/geocoding (token in localStorage)
