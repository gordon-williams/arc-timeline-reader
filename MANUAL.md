# Arc Timeline Diary Reader - User Manual

**Build 875**

A web-based viewer for [Arc Timeline](https://www.bigpaua.com/arcapp) and [Arc Editor](https://editor.arc.wiki) GPS tracking data. Generates interactive diaries with maps from your location history, stored locally in your browser. No server required.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Importing Your Data](#importing-your-data)
3. [The Diary Reader](#the-diary-reader)
4. [Navigating the Diary](#navigating-the-diary)
5. [The Map](#the-map)
6. [Search](#search)
7. [Favourites](#favourites)
8. [Events](#events)
9. [Map Tools](#map-tools)
10. [Day Replay Animation](#day-replay-animation)
11. [Activity Analysis](#activity-analysis)
12. [Heat Map](#heat-map)
13. [Location Analysis](#location-analysis)
14. [Exporting Your Data](#exporting-your-data)
15. [Settings](#settings)
16. [Database Management](#database-management)
17. [Keyboard Shortcuts](#keyboard-shortcuts)
18. [Troubleshooting](#troubleshooting)

---

## Getting Started

1. Open `index.html` in a modern browser (Chrome, Edge, Firefox, or Safari).
2. Import your Arc Timeline data using one of the three import methods below.
3. Click **Open Diary Reader** to start browsing your timeline.

### Optional: Mapbox Token

A free Mapbox token unlocks enhanced maps (multiple styles including satellite and dark mode), faster geocoding, and route searching. Enter it in the **Mapbox Integration** section on the landing page and click **Save**.

Get a free token at [mapbox.com/account/access-tokens](https://account.mapbox.com/access-tokens/).

---

## Importing Your Data

There are three ways to import data. You can use any combination.

### JSON Export (Daily Files)

Best for: incremental daily updates from Arc's JSON export feature.

1. Click the **Import JSON** tab on the landing page.
2. Click the drop zone and select your Arc Timeline export directory (containing `.json.gz` files).
3. The import runs automatically. A progress bar and log show what's happening.
4. Subsequent imports only process new or changed files unless you tick **Force full rescan**.

### Arc Editor Backup

Best for: full data recovery from the Arc Editor app's backup folder.

1. Click the **Import Backup** tab (selected by default).
2. Click the drop zone and select your Arc Editor backup folder. The folder should contain `items/`, `places/`, `notes/`, and `samples/` subdirectories.
3. Choose an import mode:
   - **Recent only** -- imports the last 2 months (fastest).
   - **Full import** (default) -- imports everything, skipping unchanged items.
   - **Force rescan** -- reimports everything from scratch.
4. Wait for the import to complete.

### iCloud / Legacy Arc Backup

Best for: full data recovery from Arc's iCloud backup.

1. Use the same **Import Backup** tab.
2. Select your iCloud backup folder:
   ```
   ~/Library/Mobile Documents/iCloud~com~bigpaua~LearnerCoacher/Documents/Backups/
   ```
3. The app auto-detects the backup format (Arc Editor vs Legacy) and handles it appropriately.

### Import Notes

- **Incremental sync**: After the first full import, subsequent imports only process changed items. This makes daily imports very fast.
- **Smart coalescing**: Imported data is automatically cleaned up -- GPS noise, data gaps, and duplicate artifacts are handled.
- **Data gap recovery**: Unresolved or unknown activity spans are reprocessed to recover likely walking, cycling, or driving activities from GPS samples.
- **Safari users**: The File System Access API is not available in Safari. A fallback mode is used which may be slower. A warning banner will appear.

---

## The Diary Reader

Click **Open Diary Reader** on the landing page to open the main interface. It consists of two panels:

- **Diary panel** (left) -- a scrollable timeline of your day's visits and activities.
- **Map panel** (right) -- an interactive map showing your routes and location markers.

### Header Bar

From left to right:
- **Analysis** -- opens the Analysis page in a new tab.
- **Year** and **Month** selectors -- jump to any month.
- **Previous/Next month** arrows.
- **Map style** selector -- choose between tile providers.
- **Tools** dropdown -- access map tools (see [Map Tools](#map-tools)).
- **Save** -- save the current map view as an image.
- **Zoom +/-** buttons.
- **Close (X)** -- returns to the landing page.

### Diary Panel

The diary panel shows one month (in month view) or one day (in day view).

Each entry shows:
- **Time** -- start and end time.
- **Location name** -- place name or custom title from Arc.
- **Duration** -- how long you were there.
- **Activity icon** -- colour-coded by transport type.
- **Notes** -- any notes you wrote in the Arc app.
- **Favourite star** -- gold star appears next to favourited locations.

At the top of the diary panel:
- **Date and navigation arrows** -- for day-by-day browsing.
- **Search box** -- for finding entries (see [Search](#search)).
- **Notes only** checkbox -- filters to show only entries with notes.
- **Download** -- exports the month's diary as Markdown.
- **Print** -- prints the diary.

The diary panel can be **resized** by dragging its right edge, or **hidden** by clicking the X. When hidden, a floating bookmark icon appears to bring it back.

---

## Navigating the Diary

### Month View

When you open the diary or select a month, you see all days for that month listed in the diary panel. The map shows every route for the month, colour-coded by activity type.

### Day View

Click any day header in the diary panel to zoom into that day. The map zooms to show only that day's routes and location markers. Use the Previous/Next day arrows to browse day by day.

### Entry Selection

Click any diary entry to:
- Highlight it in the diary.
- Pan the map to that location.
- Open the location's popup on the map.

This works both ways -- clicking a map marker highlights and scrolls to the corresponding diary entry.

### URL Navigation

You can link directly to a specific date or month:
- `index.html?date=2024-07-15` -- opens the diary at July 15, 2024.
- `index.html?month=2024-07` -- opens the diary at July 2024.

---

## The Map

### Tile Providers

With a Mapbox token:
- **Street** -- Mapbox Streets
- **Dark** -- Mapbox Dark
- **Outdoors** -- Mapbox Outdoors
- **Cycle** -- CyclOSM (topographic cycling map)
- **Satellite** -- Mapbox Satellite with labels

Without a Mapbox token:
- **Street** -- CARTO Light
- **Cycle** -- CyclOSM
- **Satellite** -- Esri World Imagery

### Routes

Routes are drawn as colour-coded polylines by activity type:
- Walking -- green
- Running -- orange
- Cycling -- blue
- Driving -- dark grey
- Bus -- blue
- Train -- gold
- Airplane -- purple
- And others (motorcycle, boat, skateboarding, skiing, etc.)

Each route segment has a white border underneath for visibility against any map background.

### Location Markers

Visits are shown as blue circle markers that cluster together at low zoom levels. Click a marker to see:
- Location name
- Altitude (if recorded)
- Coordinates
- A link to Google Street View
- A star button to add/remove from Favourites

### Right-Click Context Menu

Right-click anywhere on the map to:
- **Street View** -- open Google Street View at that location.
- **Google Maps** -- open Google Maps at that location.
- **Coordinates** -- view the latitude and longitude.

---

## Search

The search box is in the diary panel header. It supports three types of search:

### Text Search

Type at least 2 characters and press Enter (or click Find). The search scans all entries in the database for matching location names, notes, or addresses.

Results appear in a **search results slider** on the right, showing up to 100 matches in reverse chronological order. Each result shows the date, time, and matched text with highlighting.

Click any result to jump to that day and entry. Use the Previous/Next arrows to step through results.

### Date Search

Type a date in `YYYY-MM-DD` format. The search box shows a preview (e.g., "Mon 15 Jan 2024 (Enter to go)"). Press Enter to navigate directly to that day.

### Tag Search

Use the `#` prefix to search by tag:
- **`#new`** -- days added in the most recent import.
- **`#updated`** -- days modified in the most recent import.
- **`#event`** -- days that fall within any defined event.
- **`#event vacation`** -- days in events whose name contains "vacation".

---

## Favourites

Star up to 12 locations for quick access.

### Adding a Favourite

Click any map marker to open its popup, then click the star button at the bottom. It changes to "Favourited" with a gold star.

### Accessing Favourites

Click into the search box (leave it empty or type a star). A dropdown appears showing all your favourited locations. Click one to navigate to its recorded day and location on the map.

### Removing a Favourite

Either click the X next to a favourite in the dropdown, or click the star button again in its map popup.

Favourited locations show a gold star tag next to their name in diary entries.

---

## Events

Events let you group days into named ranges -- vacations, conferences, trips, or anything else.

### Creating an Event

1. Click the calendar icon in the diary panel header to open the **Event Slider**.
2. Click **+ New Event**.
3. Fill in: Event Name, Start date/time, End date/time, Category.
4. Optionally use **Pick from Diary** -- click a diary entry to set the event boundary from that entry's date and time.
5. Save the event.

### Editing and Deleting

Click any event in the list to edit it. A Delete button appears at the bottom of the edit form.

### Categories

Events have categories with colours (Vacation, Conference, Trip, Business, Family, Other). Click **Manage...** to add new categories with custom colours, edit existing ones, or remove them.

### Analysis Integration

In the Analysis page, the **Events** dropdown lists all your events. Selecting one auto-fills the date range, making it easy to analyse a specific trip or period.

---

## Map Tools

Open the **Tools** dropdown in the header bar.

### Search Location

A route search tool with From/To fields. Type a location name to search (uses Mapbox geocoding if available, otherwise searches your diary locations). Select start and end points, then click **Go** to calculate and display the route.

The route is drawn on the map with distance and duration info. Elevation data is fetched and displayed in the Elevation panel.

### Measure Distance

Activates a crosshair cursor. Click points on the map to measure distances between them. Each segment shows its distance. Double-click to finish. Click the tool again to clear.

### Elevation and Speed

Toggles a profile panel at the bottom of the map with two tabs:

- **Elevation** -- an interactive altitude chart for visible routes. Hover to see elevation at any point (a marker appears on the map). Stats show distance, duration, min/median/average/max elevation, and total elevation gain.
- **Speed** -- an interactive speed chart. A **Filter spikes** checkbox removes outlier readings. Stats update for any selected range.

### Transparency

A slider controlling how transparent the diary panel is over the map (0-100%). Each map style has a sensible default. Click **Set** to save your preference.

### Day Animation

See [Day Replay Animation](#day-replay-animation) below.

### Activity Filter

Checkboxes for each activity type (Walking, Cycling, Driving, Stationary). Uncheck an activity to hide its routes on the map. Useful for decluttering busy months.

---

## Day Replay Animation

Watch your day's journey animated on the map.

### Controls

- **Play/Pause** button -- start or pause the animation.
- **Speed slider** -- adjust playback speed from 1x to 64x.
- **Restart** button -- jump back to the start.
- **Timeline bar** -- a progress bar showing your journey by distance. Location stops are marked on the bar. Click or drag to scrub to any point.
- **Speedometer** -- shows the current speed in km/h.
- **Activity info** -- displays the current time, activity type, and the next stop.

### During Playback

An animated marker moves along your route, changing icon based on the transport mode (walking person, bicycle, car, etc.). At each location visit, the animation pauses and shows a popup with the place name and how long you stayed.

The diary panel highlights the current activity as the animation progresses.

---

## Activity Analysis

Open the Analysis page by clicking **Analysis** in the diary header. This opens a separate browser tab.

### Setting Up

1. Choose a date range using the date inputs, presets (1M, 3M, 6M, YTD, 1Y, All), or by selecting an event.
2. Check the activity types you want to analyse (walking, cycling, car, etc.).
3. Click **Analyze**.

### Trend View (default)

The trend view shows a chart and table of your activity over time.

- **Metric** -- Distance (km) or Duration (hrs).
- **Group** -- aggregate by Day, Week, or Month.
- **Chart type** -- Line, Bar, or Stacked Area.
- **Smoothing** -- applies a bidirectional moving average (0-5) to smooth noisy data.
- **Hide zeros** -- removes periods with no activity from the chart.

#### Chart Interaction
- **Scroll** to zoom in/out on the time axis.
- **Drag** to pan along the time axis.
- **Click** a data point to select the corresponding table row.
- **Double-click** a data point to navigate the diary tab to that date.

#### Table Interaction
- Click a row to highlight it on the chart.
- Cmd/Ctrl+click for multi-select; Shift+click for range select.
- Double-click a row to navigate the diary to that date.
- Columns are resizable by dragging the header borders.

---

## Heat Map

The heat map is an alternative view in the Activity Analysis tab. It shows a geographic density overlay revealing where you travel most over the selected date range.

### Switching to Heat Map

Click **Heat Map** in the Trend/Heat Map toggle in the controls row. The chart and table are replaced by a full Leaflet map with a heat layer overlay.

The date range, presets, event selector, and activity checkboxes all work exactly as they do in Trend view -- they control which data feeds the heat map.

### How It Works

The heat map streams through your raw GPS data day by day, extracting every sample point from the activities you have selected. These points are rendered as a coloured density overlay on the map -- areas you visit more often glow hotter (from blue through yellow to red).

### Variables

The **Variable** dropdown controls what the heat intensity represents. Different variables reveal different patterns in your data.

| Variable | How intensity is calculated | What it reveals | Best for | Watch out for |
|----------|---------------------------|-----------------|----------|---------------|
| **Frequency** | Every recorded GPS sample contributes intensity of 1. More samples in an area = hotter. | Where you have been, weighted by how densely your phone recorded GPS points there. | A general overview of everywhere you have travelled. Good starting point for exploring your data. | A single long walk with frequent GPS logging can outshine a daily commute with sparser logging. This counts raw samples, not visits -- so recording frequency matters as much as actual travel. |
| **Unique Days** | Points are bucketed into ~50m grid cells. Each cell's intensity is the number of different calendar days it was visited. A cell visited on 200 days glows far hotter than one visited once with 1,000 samples. | Your habitual routes and regular destinations, independent of GPS recording frequency. | Multi-year datasets. Reveals your daily commute, regular walks, gym route, school run -- the places you return to again and again. The most meaningful variable for long time periods. | Single visits do not stand out even if they had dense GPS logging, which is the intended behaviour. |
| **Time Spent** | Each GPS sample is weighted by the seconds until the next sample (capped at 5 minutes to prevent idle gaps inflating the result). Where you linger glows hotter than where you pass through. | Places where you actually spend time versus corridors you merely travel along. | Finding your real destinations -- the park bench you sit on, the cafe you linger in, the platform you wait at. A 30-minute park visit glows brighter than the street you walked down to reach it. | Stationary periods with GPS drift can create artificial hot spots. The 5-minute cap helps but does not eliminate this entirely. |
| **Speed** | Speed in m/s between consecutive GPS samples. Fast segments glow hot; slow segments stay cool. | Fast versus slow corridors in your travel patterns. | Visualising which roads you drive on versus walk along, where traffic typically slows down, or identifying cycling descent routes. | GPS inaccuracy near buildings or tunnels can create false speed spikes. The speed is capped at ~200 km/h to limit outliers. |
| **Recency** | Same as Frequency, but each day is time-weighted. The oldest day in your range contributes 10% intensity; the newest contributes 100%, scaling linearly. | How your travel patterns have shifted over time. Recent habits dominate while old patterns fade. | Seeing change -- if you moved house, changed jobs, or started a new exercise route, the old patterns fade while current ones glow brightly. | Short date ranges show little variation since all days are similarly weighted. Most useful over 6+ months. |

### Controls

| Control | Range | What it does |
|---------|-------|-------------|
| **Radius** | 5-40 px | Size of each heat point on screen. Larger values produce smoother, more blurred blobs; smaller values show tighter geographic detail. All slider changes are applied live without rebuilding. |
| **Blur** | 1-40 | Controls how sharp or soft the edges of heat blobs are. Low values give crisp, well-defined borders; high values create a smooth, diffuse gradient between hot and cold areas. |
| **Intensity** | 1-100 | Controls contrast and sensitivity. At low values, only the very hottest areas reach red -- useful for picking out your most-travelled routes from a dense dataset. At high values, more of the map lights up. The scale auto-adjusts to your data's 90th percentile so it works well regardless of which variable you choose. |
| **Opacity** | 0-100 | Overall transparency of the heat layer. Lower values let the base map show through more clearly, which is useful for identifying specific streets or landmarks under the heat overlay. |
| **Region** | All / 10-250 km | Limits the displayed points to a radius around a centre point. This is essential for large datasets that include distant trips -- without it, a holiday in Japan or a drive to another state would pull the map view out so far that your local patterns become invisible. The default is 50 km. |
| **Set Centre** | button | Sets the region centre to wherever the map is currently centred. Pan and zoom to the area you are interested in, then click Set Centre. The status text confirms the coordinates. If you do not set a centre, one is auto-detected from the median of all your points (which is robust against outliers like distant trips). |

### Performance

- **Streaming**: Data is read from the database one day at a time, so even 10+ years of data does not overwhelm memory.
- **Progress bar**: Shows "Day X of Y" with a point count during loading. A **Cancel** button lets you stop a long build.
- **Downsampling**: Datasets exceeding 150,000 points are automatically bucketed into ~50-metre grid cells. For speed data, the grid uses averages; for other variables it uses sums.
- **Unique Days mode**: Already grid-based from the start, so it handles arbitrarily large datasets efficiently.

### Capturing

Click **Capture** while in Heat Map view to save the map as a PNG image.

---

## Location Analysis

The Locations tab in the Analysis page lets you analyse visits to specific places.

### Setting Up

1. Switch to the **Locations** tab.
2. Set a date range using the date inputs or presets.
3. Type a location name in the search box. An autocomplete dropdown shows matching locations.
4. Click a location to select it (appears as a pill below the search box). Select as many as you like, or click **Select All**.
5. Toggle **Merge same-day** to combine multiple visits to the same place on one day.
6. Click **Analyze**.

### The Location Report

A visual infographic report is generated for each selected location, containing:

- **Headline stat** -- total visits and total time spent.
- **KPI tiles** -- key metrics like average visit duration and most common day of the week.
- **Visits by Year** -- a bar chart showing how your visits have changed over time.
- **Day of Week** -- a histogram showing which days you visit most.
- **Time of Day** -- a heat strip showing your typical visiting hours across 24 hours.
- **Mini Map** -- a Leaflet map showing the location's position.
- **Summary** -- first and most recent visit dates, longest and shortest visits, longest gap between visits.

### Physical Location Clustering

If you search for a chain or common name (e.g., "Woolworths"), the analysis distinguishes between physically different locations using proximity clustering (200m threshold). You can select specific branches rather than lumping them all together.

### Exporting Reports

- **Save PDF** -- renders the report in a print-optimised light theme and opens the browser print dialog.
- **Save PNG** -- captures the report as a high-resolution PNG image.

### View in Diary

Location data can be sent to the diary tab to enter **Location View Mode**, showing all visits to the selected locations in a dedicated list view with keyboard navigation.

---

## Exporting Your Data

### From the Landing Page

Click **Export** to open the export modal.

- **Format**: Choose JSON, GPX, or both.
- **Scope**: Export all days or a specific date range.
- **JSON export**: Produces sanitised `.json.gz` files (duplicate backup artifacts removed).
- **GPX export**: Produces `.gpx` files with track data for GPS applications.

A progress bar shows during export.

### From the Diary

- **Download** -- exports the current month's diary as a Markdown (`.md`) file.
- **Print** -- opens the browser print dialog with diary-optimised styling.
- **Save** (map) -- saves the current map view as a JPEG image.

### From Analysis

- **Capture** (Trend view) -- exports the chart as a PNG.
- **Capture** (Heat Map view) -- exports the heat map as a PNG.
- **Save PDF / Save PNG** (Locations tab) -- exports location reports.

---

## Settings

### Mapbox Token

Enter on the landing page under **Mapbox Integration**. Enables:
- Multiple map styles (Street, Dark, Outdoors, Satellite with labels).
- Faster geocoding for location names.
- Mapbox Directions API for route searching.
- Enhanced map tiles in the Analysis page.

The token is stored in localStorage and automatically shared with the Analysis tab.

### Map Style

Selected via the dropdown in the diary header. Available styles depend on whether a Mapbox token is configured.

### Theme

The diary reader follows a light theme. The Analysis page defaults to dark mode with a **Light/Dark** toggle in its header.

---

## Database Management

### Deleting Days

Click **Clear** (red button) on the landing page to open the Delete Days modal:
- **Single day** -- delete one specific date.
- **Date range** -- delete all days in a range.
- **Clear all data** -- delete the entire database.

After deletion, sync timestamps are reset so you can reimport the deleted days.

### Database Recovery

Open `delete-db.html` directly in your browser for a standalone utility that can:
- **Check Database** -- lists all data stores with record counts.
- **Delete Database** -- completely removes the IndexedDB database (all tabs using it must be closed first).

### Rebuild Analysis Data

In the Analysis page, click the **Rebuild** button to reconstruct analysis data (daily summaries, location visits, location aggregates) from raw imported data. Useful if analysis data appears inconsistent after an import.

---

## Keyboard Shortcuts

### Diary Mode

| Key | Action |
|-----|--------|
| Left / Right | Previous / Next day |
| Up / Down | Previous / Next diary entry |
| Shift + Left / Right | Previous / Next month |
| Home / End | First / Last entry |
| PageUp / PageDown | Scroll diary panel |

### Location View Mode

| Key | Action |
|-----|--------|
| Up / Down / Left / Right | Navigate between locations |
| Home / End | First / Last location |
| Enter / Space | Expand or collapse visits |
| PageUp / PageDown | Scroll list |

---

## Troubleshooting

### Import seems stuck or slow

- **Large datasets**: A first-time full backup import with years of data can take several minutes. Watch the progress bar and log for activity.
- **Safari users**: Import is slower due to browser API limitations. Consider using Chrome or Edge.
- **Cancel and retry**: Click **Cancel Import** and try again with **Recent only** mode if a full import is too slow.

### Map tiles are not loading

- Check your internet connection -- all map tiles are loaded from online services.
- If using Mapbox, verify your token is valid and has not expired.
- Try switching to a different map style.

### Analysis page shows no data

- Click **Rebuild** in the Analysis page header to reconstruct analysis data.
- Check that you have imported data for the selected date range.

### "X days updated" on every import

- This is normal on the first import after an update that changed the content hash format. The second import should show the correct count.

### Heat map is too zoomed out / showing distant trips

- Use the **Region** filter (default 50 km) to limit the view to your local area.
- Click **Set Centre** after panning to your area of interest.

### Browser storage full

- IndexedDB has generous limits (typically gigabytes) but if you encounter storage errors, try clearing other site data or using the Delete Days modal to remove old data you no longer need.

---

## Credits

- [Arc Timeline](https://www.bigpaua.com/arcapp) by Big Paua
- [Arc Editor](https://editor.arc.wiki) by Big Paua
- [Leaflet.js](https://leafletjs.com/) for maps
- [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat) for heat-map overlay
- [Chart.js](https://www.chartjs.org/) for charts
- [Mapbox](https://www.mapbox.com/) for tiles and geocoding
- [CARTO](https://carto.com/) for free map tiles
- [CyclOSM](https://www.cyclosm.org/) for cycling maps
- [Esri](https://www.esri.com/) for satellite imagery
- [OSRM](https://project-osrm.org/) for free routing
- [Open-Elevation](https://open-elevation.com/) for elevation data
- [Nominatim / OpenStreetMap](https://nominatim.org/) for fallback geocoding
