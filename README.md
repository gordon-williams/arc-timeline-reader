# Arc Timeline Diary Reader

**Current Build: 752**

A web-based viewer for [Arc Timeline](https://www.bigpaua.com/arcapp) GPS tracking data that generates interactive diaries with maps.

## Features

### Data Import
- **JSON Export** - Import daily Arc Timeline JSON export files (fast incremental updates)
- **iCloud Backup** - Import directly from Arc's iCloud backup folder (full data recovery)
- **Incremental Sync** - Backup imports only process changed items after first import
- **Automatic Detection** - Validates backup folder structure before import
- **Smart Coalescing** - iCloud imports automatically clean up GPS noise and data gaps

### Diary Viewer
- **Interactive Maps** - Leaflet.js maps with Mapbox or CARTO tiles
- **Daily Entries** - Timeline of visits and activities with times, durations, notes
- **Custom Titles** - Per-visit custom names (e.g., "Drop off Katherine") preserved
- **Keyboard Navigation** - Arrow keys for days/entries, Home/End for first/last
- **Search** - Find entries by location name, date, or notes
- **Favourites** - Star locations for quick access
- **Events** - Define multi-day date ranges (vacations, trips) with start/end times
- **Dark Mode** - System-aware theme with toggle
- **Raw Toggle** - View uncoalesced timeline data for debugging

### Events
- **Multi-Day Ranges** - Group days into named events (vacations, conferences, trips)
- **Precise Bounds** - Set start/end date and time to include only relevant activities
- **Visual Creation** - Click diary entries to set event boundaries
- **Categories** - Custom categories with colors (Vacation, Conference, Trip, etc.)
- **Event Slider** - Dedicated panel for browsing and editing events
- **Analysis Integration** - Select events to auto-fill date range in Analysis page
- **Export/Import** - Events included in data export for backup and sync

### Day Trip Replay
- **Animated Playback** - Watch your day's journey animated on the map
- **Activity Icons** - Marker changes based on transport mode (walking, cycling, car, etc.)
- **Location Stops** - Pauses at visited locations with popup showing name and duration
- **Speed Display** - Real-time speedometer based on GPS data
- **Diary Sync** - Current activity highlighted in diary panel during playback
- **Playback Controls** - Play/pause, speed adjustment (1x-64x), scrubbing via progress bar

### Location Analysis
- **Multi-Location Selection** - Search and select multiple locations
- **Physical Location Clustering** - Distinguishes same-name locations at different addresses (e.g., multiple Bunnings stores)
- **Date Range Filtering** - Presets (1M, 3M, 6M, YTD, 1Y, All) or custom dates
- **Visit Statistics** - Total visits, duration, day-of-week patterns, time-of-day heatmap
- **Location Infographic** - Visual report with year bars, KPI tiles, mini-map
- **Export** - PNG and PDF export of analysis reports

### Location View Mode
- **Dedicated View** - Focus on specific locations with all visits listed
- **Keyboard Navigation** - Arrow keys navigate between locations
- **Auto-Geocoding** - Automatically adds suburb names via Mapbox/Nominatim
- **Map Integration** - Click markers to pan map, click visits to jump to diary entry

### Map Features
- **Route Visualization** - Color-coded tracks by activity type
- **Elevation Profile** - Interactive altitude chart for visible routes with hover tooltip and map marker sync
- **Google Street View** - Links in location popups and right-click context menu
- **Tools Menu** - Consolidated dropdown for Search, Measure, Elevation, Transparency, Animation, Filter
- **Measure Tool** - Click to measure distances between points
- **Location Search** - Mapbox-powered place search
- **Multiple Tile Providers** - Mapbox (streets, dark, satellite, outdoors) or CARTO
- **PNG/PDF Export** - Save maps with markers and routes

### Activity Analysis
- **Trend Charts** - Distance, duration, or trip count over time
- **Activity Filtering** - Walking, cycling, running, driving, etc.
- **Grouping Options** - By day, week, or month
- **Stacked Charts** - Compare multiple activities

## Files

| File | Description |
|------|-------------|
| `index.html` | Main entry point |
| `app.js` | Core application (~11,600 lines) |
| `styles.css` | All styling (~3,500 lines) |
| `analysis.html` | Standalone analysis tool (~5,600 lines) |
| `map-tools.js` | Measurement and search tools |
| `delete-db.html` | Database reset utility |

## Usage

1. Open `index.html` in a modern browser
2. Choose import method:
   - **JSON Export** - Select your Arc Timeline export directory (daily .json.gz files)
   - **iCloud Backup** - Select Arc's iCloud backup folder for full data recovery
3. Wait for import to complete
4. Use month/year selectors to navigate
5. Click "Analysis" to open location/activity analysis in a new tab

### iCloud Backup Location
```
~/Library/Mobile Documents/iCloud~com~bigpaua~LearnerCoacher/Documents/Backups/
```

## Keyboard Shortcuts

### Diary Mode
| Key | Action |
|-----|--------|
| ←/→ | Previous/Next day |
| ↑/↓ | Previous/Next entry |
| Shift+←/→ | Previous/Next month |
| Home/End | First/Last entry |
| PageUp/PageDown | Scroll diary |

### Location View Mode
| Key | Action |
|-----|--------|
| ↑/↓/←/→ | Navigate between locations |
| Home/End | First/Last location |
| Enter/Space | Toggle expand/collapse visits |
| PageUp/PageDown | Scroll list |

## Data Storage

- **IndexedDB** stores imported data locally in browser
- **LocalStorage** caches geocoding results and settings
- No server required - runs entirely in browser

## Requirements

- Modern browser with IndexedDB support (Chrome, Firefox, Safari, Edge)
- Arc Timeline JSON export files
- Optional: Mapbox API token for enhanced maps and geocoding

## Settings

Access via gear icon or Settings button:
- **Mapbox Token** - Enable Mapbox tiles and fast geocoding
- **Map Style** - Choose tile provider and style
- **Theme** - Light/Dark/System

## Credits

- [Arc Timeline](https://www.bigpaua.com/arcapp) by Big Paua
- [Leaflet.js](https://leafletjs.com/) for maps
- [Chart.js](https://www.chartjs.org/) for charts
- [Mapbox](https://www.mapbox.com/) for tiles and geocoding
- [CARTO](https://carto.com/) for free map tiles
- [Nominatim/OpenStreetMap](https://nominatim.org/) for fallback geocoding
