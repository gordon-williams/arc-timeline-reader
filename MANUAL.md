# Arc Timeline Diary Reader - User Manual

**Build 02.244**

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
14. [Attendance Chart](#attendance-chart)
15. [Exporting Your Data](#exporting-your-data)
16. [Share Tour](#share-tour)
17. [AI Chat](#ai-chat)
18. [Apple Photos & Videos](#apple-photos--videos)
19. [Privacy & Security](#privacy--security)
20. [Settings](#settings)
21. [Database Management](#database-management)
22. [Keyboard Shortcuts](#keyboard-shortcuts)
23. [Troubleshooting](#troubleshooting)

---

## Getting Started

You can run the app two ways:

- **Hosted version** — open [gordon-williams.github.io/arc-timeline-reader](https://gordon-williams.github.io/arc-timeline-reader/) in a modern browser (Chrome, Edge, Firefox, or Safari). No install required; your data stays in your browser.
- **Local copy** — clone the repository and open `index.html` directly from disk.

Then:

1. Import your Arc Timeline data using one of the three import methods below.
2. Click **Open Diary Reader** to start browsing your timeline.

### Optional: Mapbox Token

A free Mapbox token unlocks enhanced maps (multiple styles including satellite and outdoors), faster geocoding, and route searching. Enter it in the **Mapbox Integration** section on the landing page and click **Save**.

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
- **Tools** dropdown -- map style selector and map tools (see [Map Tools](#map-tools)).
- **Year** and **Month** selectors -- jump to any month.
- **Previous/Next month** arrows.
- **Analysis** -- opens the Analysis page in a new tab.
- **Save** -- save the current map view as an image.
- **Close (X)** -- returns to the landing page.

Floating controls (bottom-right of map):
- **Zoom +/-** buttons.

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

#### Font Size

A floating **A− / A+** pill at the bottom-right of the diary panel lets you adjust text size. All text scales proportionately — body text, day titles, and month headings. The setting is saved and restored across sessions.

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
- **Outdoors** -- Mapbox Outdoors
- **Cycle** -- CyclOSM (topographic cycling map)
- **Satellite** -- Mapbox Satellite with labels (brightness-boosted)

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

Visits are shown as blue circle markers that cluster together at low zoom levels. Markers for visits that have notes use a lighter blue to distinguish them at a glance. Click a marker to see:
- Location name
- Altitude and note indicator (if applicable)
- Note text (for visits with notes, with expand/collapse for longer notes)
- Coordinates and a link to Google Street View
- A star button to add/remove from Favourites

The map automatically pans to keep popups fully visible, including when expanding a long note.

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

- **Metric** -- Choose what to plot from the dropdown:
  - **Distance (km)** -- Total distance covered.
  - **Duration (hrs)** -- Total active time.
  - **Elevation Gain (m)** -- Cumulative metres of climbing, computed from GPS altitude samples. Only positive altitude changes are counted.
  - **Elev. Density (m/km)** -- Terrain steepness: elevation gain divided by distance. Higher values indicate hillier routes (e.g. 20 m/km = gentle, 50+ m/km = steep hill walks).
  - **Avg Speed (km/h)** -- Average speed from distance and duration.
  - **Est. VO₂ (ml/kg/min)** -- Estimated oxygen cost using the ACSM walking equation: VO₂ = 3.5 + (0.1 × speed) + (1.8 × speed × grade). Bars are colour-coded by intensity zone: green (light, <14 ml/kg/min), orange (moderate, 14–24), red (vigorous, >24).
  - **METs (intensity)** -- Metabolic Equivalent of Task. METs = VO₂ ÷ 3.5. A MET of 1.0 is resting; ~3.0 is normal walking; 4+ is brisk or uphill walking. Useful for comparing exercise intensity independent of body weight.
  - **MET-hours (training load)** -- Cumulative training volume: METs × hours for each activity segment, summed per period. Unlike VO₂ or METs (which measure intensity), MET-hours captures both how hard *and* how long you exercised. A 2-hour gentle walk (3 METs × 2 hrs = 6 MET-hours) and a 1-hour brisk hill walk (6 METs × 1 hr = 6 MET-hours) produce the same training load. Computed per-segment for accuracy, not from period averages.
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

## Attendance Chart

The Attendance Chart is an alternative view in the Locations tab that shows a daily bar chart of hours spent at your selected locations. Switch between the Infographic report and Attendance Chart using the **View** toggle in the controls row.

### Setting Up

Use the same workflow as Location Analysis: search and select locations, set a date range, toggle merge same-day if desired, then click **Analyze**. The attendance chart renders automatically when the view is set to Attendance Chart.

### Searching for Special Locations

In addition to named places, you can search for:

- **Unnamed Location** -- visits where Arc recorded a stay but had no place name, custom title, or street address. These are common in areas with poor GPS or places you have not named in Arc.
- **Data Gap** -- periods where Arc was running but recorded no GPS samples and no manual activity type. Useful for identifying when your phone was off, in airplane mode, or Arc was backgrounded.

Both require a **Rebuild** after updating to make them appear in the database.

### Reading the Chart

Each bar represents one time period (day, week, fortnight, or month, set by the **Group** dropdown). The height of the bar shows the total hours at the selected location(s) during that period. Days with no visits have no bar, creating visible gaps.

When multiple locations are selected, bars are **stacked** with a distinct colour per location. The selection chips above the chart are colour-coded to match, serving as the legend.

### Percentage Mode

Tick the **Percentage** checkbox to normalise all bars to 100%. In this mode, every bar with any data reaches the same height, and each colour segment shows its proportional share. This is designed for finding gaps -- holidays, sick leave, weekends, or other absences stand out as missing bars against a uniform ceiling.

### Interacting with the Chart

| Action | Effect |
|--------|--------|
| **Scroll wheel** | Zoom in/out on the time axis |
| **Drag** | Select a date range (highlighted in blue) |
| **Click** a bar | Select a single day/period |
| **Click** outside bars | Clear selection |
| **Escape** | Clear selection |
| **Zoom presets** (6M, 1Y, 2Y, All) | Jump to predefined time windows |
| **Reset Zoom** | Return to the full date range |
| **View in Diary** | Open the diary tab at the start of the selected range |

### Stats Panel

The right-hand panel updates in real-time as you zoom or select:

- **Selected Range** -- the date span currently visible or selected, with total days count.
- **Total Visits / Total Duration** -- aggregate counts within the visible or selected range.
- **Average Duration** -- mean hours per visit.
- **Peak Day / Peak Period** -- the single day and grouped period with the most hours.
- **Duration Distribution** -- a smoothed line chart showing how visit durations are spread across 1-hour buckets (e.g., how many visits were 2-3 hours vs 6-7 hours).

### Minimum Bar Width

With 12+ years of daily data, bars can become sub-pixel and invisible when fully zoomed out. The chart enforces a minimum 1px bar width at render time, so the overall attendance pattern remains visible even at maximum zoom-out. Bars overlap slightly at this scale, creating a dense filled appearance. Zooming in reveals individual bars as normal.

### State Persistence

Your zoom level, selection, group-by setting, and percentage mode are preserved when switching between views or toggling themes. Returning to the attendance chart restores exactly where you left off.

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

## Share Tour

Share trips and holidays with other Arc Reader users as `.arctrip` files. The recipient views the tour in a guest mode that does not touch their own database.

### Creating a Tour

1. Click **Share** in the toolbar.
2. Select the **Create Tour** tab.
3. If you use the Events feature, choose an event from the dropdown to auto-fill the title and date range.
4. Enter or adjust the **Title**, **Author**, **Start** and **End** dates. Maximum range is 182 days.
5. Click **OK**. The app reads the days from your database, compresses them, and saves a `.arctrip` file.
6. Send the file to another Arc Reader user.

Your author name is remembered for next time.

### Opening a Tour

1. Click **Share** in the toolbar.
2. Select the **Open Tour** tab.
3. Click the file picker zone and select a `.arctrip` file.
4. A preview shows the tour title, author, date range, day count, item count, and file size.
5. Click **OK** to enter guest viewing mode.

### Guest Viewing Mode

When a tour is open:
- The **Share** button turns green and changes to **Close Tour**.
- The map control bar gets a green tint.
- The diary, map, and routes display the tour data exactly as they would your own data.
- The **Analysis** button is disabled (Analysis reads from the database and cannot display tour data).
- Your own data is safely preserved in the background.

Click **Close Tour** to restore your own data. Closing the diary reader window also ends tour mode automatically.

### Tour Security

Files received from others are validated before opening: file size limits, format checks, day count and item count caps, and HTML stripping on text fields. No tour data is written to your database.

### Tour Privacy

A privacy warning is displayed in the Create Tour dialog. The `.arctrip` file contains precise GPS coordinates, place names, street addresses, and visit times for every day in the selected range. Consider starting and ending your date range at the airport or train station rather than at home, to avoid sharing your private home or work locations. Once sent, you lose control of this data.

---

## AI Chat

Ask questions about your timeline data in natural language, powered by Anthropic's Claude API or Google's Gemini API. The AI Chat is in the Analysis page under the **Chat AI** tab.

### Getting Started

1. Open the **Analysis** page (click **Analysis** in the diary reader toolbar, or the Analysis button on the start screen).
2. Select the **Chat AI** tab.
3. Choose a provider from the **Provider** dropdown: **Anthropic** or **Gemini**.
4. Enter your API key for the chosen provider and click **Save Key**.
   - Anthropic: Get a key from [console.anthropic.com](https://console.anthropic.com/)
   - Gemini: Get a key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
5. Choose a model from the dropdown.
6. Type a question and press Enter or click Send.

API keys are stored locally in your browser's localStorage. They are only sent directly to their respective API endpoints and nowhere else.

### Models

**Anthropic:**

| Model | Input / Output cost (per M tokens) | Best for |
|-------|-------------------------------------|----------|
| **Sonnet 4.6** | $3 / $15 | Best quality, most capable reasoning |
| **Sonnet 4.5** | $3 / $15 | Strong quality, good all-round |
| **Haiku 4.5** | $1 / $5 | Good quality at lower cost |
| **Haiku 3** | $0.25 / $1.25 | Cheapest, suitable for simple questions |

**Google Gemini:**

| Model | Input / Output cost (per M tokens) | Best for |
|-------|-------------------------------------|----------|
| **Gemini 2.5 Flash** | $0.30 / $2.50 | Best price-performance |
| **Gemini 2.5 Flash Lite** | $0.10 / $0.40 | Cheapest, fast responses |
| **Gemini 2.5 Pro** | $1.25 / $10 | Strong reasoning at moderate cost |
| **Gemini 3 Flash (Preview)** | $0.50 / $3.00 | Latest frontier performance |
| **Gemini 3.1 Flash Lite (Preview)** | $0.25 / $1.50 | Latest efficient model |
| **Gemini 3.1 Pro (Preview)** | $2.00 / $12 | Latest advanced reasoning |

Cost per message is displayed after each response, along with a running session total. Click the cost display to expand a breakdown of cumulative costs by model across all sessions.

### What You Can Ask

The AI has access to 15 query tools for extracting data from your timeline database, plus display tools for maps, routes, heat maps, and charts. Example questions:

**Activities and distances:**
- "How far did I walk last month?"
- "Compare my cycling distance this year vs last year"
- "What was my most active day in January?"
- "Show me my monthly walking elevation gain for the last 8 months as a bar chart"
- "Plot my walking distance and elevation gain together on the same chart"

**Locations and visits:**
- "How often did I go to the gym this year?"
- "What are my top 10 most visited places?"
- "When was the last time I visited Mum's house?"

**Attendance and absences:**
- "List my absences from work in 2025"
- "Graph my hours at work by week for the last 6 months"
- "When was I off sick?" (detects single days, partial weeks, and multi-week spans)
- Works with fuzzy name matching — typos and partial names are handled automatically

**Trips and regions:**
- "When did I go to Japan?"
- "Which hotels did I stay at during my 2019 Japan trip?"
- "What did I do on Miyajima Island?"

**Day details:**
- "What did I do on 15th March 2024?"
- "Show me the route I took yesterday"

**Maps:**
- "Show those locations on the map"
- "Draw the route for my trip to the coast"

### Map Display

Claude can display results on an interactive map panel that appears alongside the chat:

- **Markers** — Location pins with visit counts, showing where you've been.
- **Routes** — Colour-coded GPS tracks drawn on the map, matching the main diary reader's colour scheme (walking=green, car=grey, cycling=blue, running=red, etc.).
- **Heat maps** — GPS density overlays for long date ranges, with frequency, recency, or time-spent modes.
- **Activity filtering** — Claude can filter routes to specific activity types (e.g. only walking, or only car/bus/train).

The map panel has controls to clear markers, close the panel, and switch map styles.

### Charts

Claude can render charts inline in the chat to visualise trends and comparisons:

- **Chart types** — Bar, line, pie, and doughnut charts.
- **Dual y-axes** — Compare two metrics with different units on the same chart (e.g. distance on the left axis, elevation gain on the right).
- **Custom axis ranges** — Claude can zoom into narrow data ranges to make trends more visible.
- **Export** — Each chart includes a download button to save as PNG.

### Cost Tracking

Every message displays its token usage and cost. The cost indicator at the top of the chat shows:

- **Session cost** — Total cost since the chat was last cleared.
- **Cumulative costs** — Click the cost display to expand a per-model breakdown of all-time costs, persisted across sessions in localStorage.

Typical costs are very low — a single question-and-answer exchange costs around $0.001 to $0.01 depending on the model and complexity.

### Tips

- **Be specific with dates** — "How far did I walk in March 2024?" works better than "How far did I walk recently?"
- **Start broad, then narrow** — Ask about a country first, then drill down to specific cities or days.
- **Use the map** — Ask Claude to "show that on the map" after any location-based answer.
- **Clear the chat** to reset the conversation and free up context for new topics. The **Clear Chat** button resets the message history and session cost.
- **Multi-step queries** — Claude can chain tool calls together, e.g. finding your Japan trip dates, then looking up what you did each day, then showing the route on the map.
- **Retry on errors** — If a request fails, click the **Retry** button on the error message to re-send without retyping.
- **Gemini for cost savings** — Use Gemini Flash for simple queries at a fraction of the cost. Switch to Anthropic Sonnet for complex multi-step reasoning or chart generation.

---

## Apple Photos & Videos

Display photos and videos from your Apple Photos library alongside your timeline entries. Thumbnails appear inline in diary entries, in a slide-out gallery, and as map markers at their GPS locations. Videos play inline in the viewer with native controls.

> **macOS and Windows.** The photo server runs on macOS (reading from the Apple Photos library) and Windows (reading from the iCloud for Windows photo folder). Linux and mobile platforms are not currently supported.

### Prerequisites

**macOS:**

1. **macOS** with Apple Photos (any recent version).
2. **Node.js** (version 18 or later) — see [Installing Node.js](#installing-nodejs) below.
3. **Xcode Command Line Tools** — required for the iCloud media download feature. The server uses a small Swift helper tool that is compiled automatically at startup. Install with:
   ```
   xcode-select --install
   ```
   If you already have Xcode or the Command Line Tools installed, this step is not needed. The server still works without them, but photos and videos offloaded to iCloud will not be downloadable on demand.

**Windows:**

1. **Windows 10 or later** with [iCloud for Windows](https://apps.microsoft.com/detail/icloud/9PKTQ5699M62) installed and photos synced.
2. **Node.js** (version 18 or later) — see [Installing Node.js](#installing-nodejs) below.
3. **FFmpeg** (optional) — needed for video thumbnail generation. Download from [ffmpeg.org](https://ffmpeg.org/) and add to your system PATH. Without it, videos are still served but thumbnails show a fallback icon.

### Installing Node.js

If you don't have Node.js installed:

1. **Download** the installer from [nodejs.org](https://nodejs.org/) — choose the **LTS** (Long Term Support) version. Select the macOS or Windows installer as appropriate.
2. **Run** the installer and follow the prompts. The defaults are fine.
3. **Verify** the installation by opening Terminal (macOS) or Command Prompt (Windows) and running:
   ```
   node --version
   ```
   You should see a version number like `v22.x.x`.

On macOS, you can alternatively install via Homebrew:

```
brew install node
```

### Setting Up the Photo Server

The photo server is a small Node.js application included in the `photo-server/` folder. It reads your Apple Photos library and serves thumbnails and full-resolution media to the diary reader.

1. **Open Terminal** and navigate to the photo-server directory:
   ```
   cd /path/to/arc-diary-reader/photo-server
   ```

2. **Install dependencies** (first time only):
   ```
   npm install
   ```
   This installs Express, Sharp (image processing), better-sqlite3 (database access), and CORS middleware.

3. **Start the server:**
   ```
   npm start
   ```
   You should see output like:
   ```
   Arc Photo Server
   Library: /Users/you/Pictures/Photos Library.photoslibrary
   Media:   12,345 (photos + videos)
   Cache:   /path/to/photo-server/.cache
   iCloud:  photo-fetch available — on-demand video download enabled
   Server:  http://localhost:3000

   Ready. Keep this running while using Arc Diary Reader.
   ```
   On first startup, the server compiles a small Swift helper tool (`photo-fetch`) that enables on-demand downloading of photos and videos stored in iCloud. This compilation takes 5–10 seconds and only happens once — subsequent starts reuse the compiled binary. If the Command Line Tools are not installed, you will see `photo-fetch: not available` instead, and iCloud media will not be downloadable on demand.

4. **Grant Photos access (first time only):** The first time a photo or video is downloaded from iCloud, macOS will show a permission dialog asking you to allow `photo-fetch` to access your Photos library. Click **Allow** — this is a one-time prompt and the permission persists across restarts. You can review or change this in **System Settings → Privacy & Security → Photos**.

5. **Keep the terminal window open** while using the diary reader. The server must be running for photo and video features to work.

**Custom library path:** If your Photos library is not in the default location (`~/Pictures/Photos Library.photoslibrary`), specify the path with:

```
node server.js --library "/path/to/Photos Library.photoslibrary"
```

**Note:** If Photos.app is running, the server may report a database lock error. Quit Photos.app and try again.

### Setting Up the Photo Server (Windows)

Windows users with **iCloud for Windows** installed can use the Windows photo server. It reads photos directly from the iCloud Photos folder using EXIF metadata (no Apple Photos database needed).

**Requirements:**

- [Node.js](https://nodejs.org/) LTS (v18 or later)
- iCloud for Windows with photos synced to your PC
- Optional: [FFmpeg](https://ffmpeg.org/) for video thumbnail generation

**Recommended: Install HEIC codec extensions** for fast iPhone photo support:

Most iPhone photos use the HEIC format. Windows doesn't decode these natively — you need two free/cheap extensions from the Microsoft Store. Without them, the server falls back to a slower software decoder.

1. **[HEIF Image Extensions](https://apps.microsoft.com/detail/9pmmsr1cgpwg)** (free) — open the link in your browser and click "Get" to install from the Microsoft Store.
2. **[HEVC Video Extensions](https://apps.microsoft.com/detail/9nmzlz57r3t7)** ($0.99) — decodes the HEVC-compressed image data inside HEIC files. Alternatively, search the Microsoft Store for **"HEVC Video Extensions from Device Manufacturer"** which is free on many OEM devices.

With both installed, the photo server uses the same decoder as Microsoft Photos — including GPU hardware acceleration where available. Thumbnail generation drops from ~2–4 seconds per HEIC image to under 1 second. The server detects these automatically at startup and reports its HEIC decoder chain:

```
HEIC:    WIC (Windows-native, fastest) → heic-convert (WASM fallback)
```

If the extensions are not installed, you'll see only the fallback decoders — everything still works, just slower for HEIC files.

**Quick start (double-click):**

1. Open the `photo-server/` folder.
2. Double-click **`Start Photo Server (Windows).bat`**.
3. The launcher checks for Node.js, installs dependencies on first run, and starts the server.
4. Keep the window open while using Arc Diary Reader.

**Manual start (command line):**

1. **Open Command Prompt** or PowerShell and navigate to the photo-server directory:
   ```
   cd C:\path\to\arc-diary-reader\photo-server
   ```

2. **Install dependencies** (first time only):
   ```
   npm install
   ```

3. **Start the server:**
   ```
   node server-windows.js
   ```
   You should see output like:
   ```
   Arc Photo Server (Windows)
   Folder: C:\Users\You\Pictures\iCloud Photos\Photos
   Scanning photos...
   Indexed 3,456 items (3,200 photos, 256 videos)
   Server: http://localhost:3000

   Ready. Keep this running while using Arc Diary Reader.
   ```

**Custom photo folder:** If your iCloud Photos are not in the default location (`%USERPROFILE%\Pictures\iCloud Photos\Photos`), specify the path with:

```
node server-windows.js --folder "D:\My Photos\iCloud"
```

**Custom port:**

```
node server-windows.js --port 3001
```

**How it works:**

- The server scans your iCloud Photos folder and reads EXIF metadata from each image file (date, GPS, dimensions, camera info).
- Files smaller than 1 KB are skipped as iCloud placeholders — these are cloud-only files that haven't been downloaded to your PC yet. To make them available, open iCloud for Windows settings and enable "Download and keep originals", or right-click individual files in File Explorer and choose "Always keep on this device".
- An index cache (`.cache/index.json`) is saved after the first scan. Subsequent starts only process new or modified files, making restarts fast.
- Video metadata requires FFmpeg/FFprobe. If not installed, videos are still served but thumbnails show a fallback icon.
- The Windows server exposes the same API as the macOS server, so the diary reader works identically with either one.

### Connecting the Diary Reader

1. Open the Arc Diary Reader start screen.
2. In the **Apple Photos Integration** section, the server URL defaults to `http://localhost:3000`.
3. Click **Connect** to verify the server is running. A green status badge shows the connection is active and how many photos and videos are available.
4. Click **Import** to begin importing thumbnails.

### Importing Photos

The import process fetches metadata and thumbnails from the photo server and stores them in your browser's IndexedDB:

- **First import** downloads thumbnails for all available photos and videos. This can take several minutes for large libraries (10,000+ items).
- **Subsequent imports** are incremental — only new items added since the last import are fetched.
- **Date range import** lets you import only photos and videos from a specific period. The date range is auto-populated from your Arc diary coverage (earliest day to today).
- Items not downloaded from iCloud appear as **placeholder thumbnails** (camera or film icon) so you can see they exist and trigger on-demand download from the viewer.
- Progress is shown during import with counts of imported, skipped, placeholders, and total items.

After import, photos and videos appear in the diary reader immediately.

### Features

#### Diary Thumbnails

Photos and videos matching each timeline entry appear as inline thumbnail strips below the entry. Click a thumbnail to open the viewer, or click the count badge to open the gallery slider.

#### Gallery Slider

Click the camera button (📷) in the diary toolbar or click a day's photo count to open the slide-out gallery. This shows a grid of all photos and videos for the current day, sorted chronologically.

- **Resizable** — drag the right edge handle to resize between 1 and 4 columns. The width is saved and restored next time you open the gallery.
- Video thumbnails display a **▶ play icon** overlay to distinguish them from photos.
- Click any thumbnail to open it in the viewer.
- The gallery updates automatically when you navigate to a different day.
- The gallery moves with the diary panel when you resize it, and closes automatically when the diary is hidden.
- Opening the gallery closes the search results panel, and vice versa — the slide-out panels (gallery, search, events) are mutually exclusive to avoid crowding.

#### Photo & Video Viewer

A non-modal viewer panel that overlays the map area. Features:

- **Photos** load at full resolution (up to 1600px) from the server, with a fast thumbnail fallback while loading.
- **Videos** play inline with native browser controls (play, pause, seek, volume, fullscreen). Videos stream from the server with seeking support.
- **iCloud media** — photos and videos that have been offloaded to iCloud are downloaded automatically when you open them in the viewer. A progress overlay shows the download status. Downloaded media is cached locally so it loads instantly on subsequent views.
- **Day sync** — when the viewer is open and you navigate to a different day, the viewer automatically updates to show that day's photos without stealing keyboard focus.
- **Navigation** — use the left/right arrow buttons or keyboard arrow keys to step through media. Videos automatically pause when navigating away.
- **Info bar** — shows the date, time, camera model, video duration, and position counter.
- **Draggable** — grab the header bar to reposition the viewer on screen.
- **Resizable** — drag the edges to resize, or click the maximize button to fill the viewport.
- **Fullscreen** — the maximize button enters true browser fullscreen via the Fullscreen API. Controls auto-hide after a few seconds and reappear on mouse movement. Press Escape or click the button again to exit.
- **Open in new tab** — click ↗ to open the current photo or video in a separate browser tab. Subsequent clicks in the gallery update the same tab.
- **Slideshow** — click the play button (▶) to start an automatic slideshow that cycles through photos with smooth transitions. Press Space to toggle play/pause. Use the speed button to cycle between 3s, 5s, 8s, and 12s intervals. Videos are skipped during playback. Arrow keys stop the slideshow and return to manual navigation.
- **Transition effects** — four styles for moving between photos: crossfade (default), slide, zoom, and fade-to-black. Transitions apply to both automatic slideshow playback and manual prev/next navigation. The slide transition is direction-aware, matching the navigation direction.
- **Ken Burns effect** — an optional cinematic zoom-and-pan that animates each photo during slideshow playback. Configurable zoom intensity and pan direction (random, left-right, right-left, up-down, down-up, or none).
- **Slideshow settings** — click the gear button (⚙) to open a settings popup where you can toggle Ken Burns, adjust zoom intensity, choose pan direction, select transition type, and enable/disable auto-fit on play. All settings are remembered across sessions.
- **Fit to content** — click the fit button to resize the viewer to match the photo's aspect ratio, centred in the available map area (avoiding diary, gallery, and stats panels). Click again to toggle back to default size. Dragging the header after fitting snaps cleanly to the cursor without visual glitches.
- **Thumbnail tracking** — the currently viewed photo is highlighted in both the diary strip and the gallery slider. Clicking a thumbnail from a different day scrolls to the strip (not the day header) so the clicked photo stays visible. The gallery centres the active thumbnail.
- **Keyboard shortcuts** — Escape to close, Left/Right to navigate, Space to toggle slideshow.

#### Map Markers

When the map marker toggle is active (📍 button in the gallery toolbar), photos and videos appear as small thumbnail markers on the map at their GPS coordinates. Click a marker to see a popup with the image, time, and camera model. Click the popup image to open the viewer.

When multiple photos overlap at the same location, the popup shows ◀/▶ navigation buttons and a counter (e.g. "2 / 5") to browse all stacked photos. The grouping radius adapts to the current zoom level -- markers are grouped tighter when zoomed in and broader when zoomed out.

Video markers also show the ▶ play icon overlay.

### Troubleshooting

#### "Photo server not connected"

- Make sure the server is running (`npm start` in the `photo-server/` directory).
- Check that the URL matches (default: `http://localhost:3000`).
- Check the terminal for error messages.

#### Videos not playing

- The browser must support the video format. Most Mac-recorded videos are MOV (QuickTime) or MP4, which are supported by Safari and Chrome.
- If the video is stored in iCloud, the server will attempt to download it automatically. Check the terminal for `iCloud: fetching video...` messages. If you see `photo-fetch: not available`, install Xcode Command Line Tools (`xcode-select --install`) and restart the server.
- If the first iCloud video download fails with a permission error, check that `photo-fetch` has Photos access in **System Settings → Privacy & Security → Photos**.

#### Some photos/videos are missing

- Run a fresh import to pick up newly added items.
- Click **Repair** to re-fetch thumbnails that may have been corrupted.

#### Server reports "database locked"

- Quit Photos.app and restart the server.

---

## Privacy & Security

Arc Diary Reader is designed with privacy as a core principle. Your location data is sensitive personal information, and the application handles it accordingly.

### Local-Only Storage

All your timeline data is stored locally in your browser's IndexedDB. No data is uploaded to any server. The application runs entirely as static files — there is no backend, no account system, and no analytics.

### AI Chat Privacy

When using the AI Chat feature, a subset of your timeline data is sent to the chosen AI provider (Anthropic Claude API or Google Gemini API) to answer your questions. The following safeguards are in place:

**What is sent to the API:**
- Place names (e.g. "Keio Plaza Hotel Tokyo")
- Activity types (e.g. "walking", "car")
- Durations, distances, and elevation gain
- Dates and times
- Aggregated statistics

**What is NEVER sent to the API:**
- GPS coordinates (latitude/longitude)
- Street addresses
- Raw GPS track samples
- Your API key (sent only to Anthropic's endpoint, not to any other service)

Coordinates are stripped from all tool results before they are sent to the API by the `stripCoordsForAPI()` function. Instead, coordinates are cached locally in your browser for map display — the API never sees them.

**Anthropic's data policy for API usage:**
- API data is **not used for model training**.
- API data is retained for up to **30 days** for safety and abuse monitoring purposes only, then deleted.
- These protections apply automatically to all API usage — no opt-out is required.

### Photo Server Privacy

The Apple Photos server runs entirely on your local machine (`localhost`). No photo or video data leaves your computer — the server reads directly from your Apple Photos library database and serves thumbnails and media only to your local browser. Imported thumbnails are stored in your browser's IndexedDB alongside your timeline data. No external services are contacted by the photo server.

### Tour Sharing Privacy

When you create a `.arctrip` file to share a trip, the file contains the **complete raw data** for every day in the selected date range, including:

- Precise GPS coordinates (sub-metre accuracy)
- Place names and street addresses
- Visit times (arrival and departure)
- GPS track samples (per-second location breadcrumbs)

**To protect your privacy when sharing:**
- Start and end your date range at the airport, train station, or other public place — not at your home or workplace.
- Review the date range carefully before exporting.
- Remember that once you send the file, you lose control of the data it contains.

A privacy warning is displayed in the Create Tour dialog as a reminder.

### Mapbox and External Services

If you configure a Mapbox token, the following external services are contacted:

| Service | Data Sent | Purpose |
|---------|-----------|---------|
| Mapbox Tiles | Map viewport coordinates | Loading map tiles |
| Mapbox Geocoding | Location coordinates | Reverse geocoding (adding suburb names) |
| Mapbox Directions | Route start/end coordinates | Route search |
| CARTO / CyclOSM / Esri | Map viewport coordinates | Alternative map tiles |
| Nominatim (OSM) | Location coordinates | Fallback geocoding |
| Open-Elevation | Route coordinates | Elevation profiles |
| OSRM | Route start/end coordinates | Fallback route search |

These services receive only the coordinates necessary for their function. No place names, visit times, or personal data are sent.

### Browser Storage

| Storage | Contents | Scope |
|---------|----------|-------|
| IndexedDB | All timeline data, analysis aggregates | Per-origin, persists until cleared |
| localStorage | API key, model preference, cost totals, author name, Mapbox token, geocoding cache, event data | Per-origin, persists until cleared |

All data can be cleared using the **Clear** button on the start screen or the browser's site data settings. The standalone `delete-db.html` page can also be used to delete the IndexedDB database.

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

The diary reader uses a light theme. The Analysis page defaults to dark mode with a **Light/Dark** toggle in its header.

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

### Photo & Video Viewer

| Key | Action |
|-----|--------|
| Left / Right | Previous / Next photo or video (stops slideshow if playing) |
| Space | Toggle slideshow play / pause |
| Escape | Close settings popup, exit fullscreen, or close viewer |

### Location Search (Analysis Page)

| Key | Action |
|-----|--------|
| Up / Down | Navigate dropdown matches |
| Enter / Space | Select highlighted match |
| Escape | Close dropdown |

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
