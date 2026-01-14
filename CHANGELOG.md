# Arc Timeline Diary Reader - Changelog

## Build 674 (2026-01-14)

### Fix - ISO Week Calculation Bug Causing Missing GPS Samples
- **Fixed GPS samples not loading for early January dates**: The `getISOWeek()` function had a subtle bug where the time-of-day component affected the week calculation
- **Root cause**: When calculating the Thursday of a week, the original time component was preserved. Combined with `yearStart` being set to midnight, this caused fractional day offsets that pushed `Math.ceil()` to round up to the wrong week number
- **Example**: `2016-01-04T23:22:07Z` was calculated as `2016-W02` instead of `2016-W01` because the Thursday fell at 23:22, creating a 6.97 day difference instead of exactly 6 days
- **Fix**: Normalize Thursday to midnight before calculating week number (`thursday.setHours(0, 0, 0, 0)`)
- This was the actual root cause of "NO GPS" tags for dates in early 2016 - the sample file `2016-W01.json.gz` existed but was never loaded because items were being mapped to `2016-W02` instead
- Requires re-import of affected data to load the correct GPS samples

## Build 669 (2026-01-14)

### Fix - Support Uncompressed LocomotionSample Files
- **Fixed GPS samples not loading for older data (MOVES imports)**: LocomotionSample files from older Arc versions may be stored as plain `.json` files instead of `.json.gz`
- Previous behavior: Only loaded gzipped sample files (`.json.gz`), silently skipping plain JSON files
- New behavior: Loads both `.json.gz` and `.json` sample files from the LocomotionSample directory
- This was the root cause of "NO GPS" tags appearing for activities that have GPS data in the backup

### Enhancement - Backup Inspection Utilities (Builds 667-668)
- Added `inspectDay("2016-01-05")` - Inspect raw data stored in IndexedDB for a specific day
- Added `inspectBackupDay("2016-01-05")` - Inspect raw backup files directly (must select backup folder first)
- These utilities help diagnose GPS data issues by showing exactly what data exists and where

## Build 666 (2026-01-14)

### Fix - Preserve Embedded GPS Samples from MOVES Import
- **Fixed "NO GPS" tag incorrectly showing for activities that have GPS data**: Data imported from MOVES (or other sources) into Arc may have GPS samples embedded directly in the timeline item, rather than in the separate LocomotionSample directory
- Previous behavior: Only attached samples from LocomotionSample files, ignoring any embedded samples
- New behavior: Preserves existing embedded samples when no LocomotionSample data is found for an item
- Also normalizes sample format to ensure consistent `location.latitude/longitude` structure
- Requires re-import of affected days to pick up the embedded GPS data

## Build 665 (2026-01-14)

### Enhancement - Disable Map Controls During Replay Mode
- **Map controls are now disabled while the replay sprite controller is active**: Prevents accidental navigation that would conflict with replay
- Disabled controls (grayed out):
  - Year selector
  - Month selector
  - Month navigation arrows (‹ ›)
- Hidden controls (removed from view):
  - Location search (🔍)
  - Measurement tool (📏)
  - Filter button
- Controls that remain active:
  - Map style selector (Street/Cycle/Satellite)
  - Transparency control
  - Save button
- All controls are re-enabled when closing the replay controller
- Added disabled styling (40% opacity, gray background) for visual feedback

## Build 664 (2026-01-14)

### Enhancement - Clear Replay When Navigating Away
- Superseded by Build 665 - now controls are disabled instead of clearing replay on navigation

## Build 663 (2026-01-14)

### Enhancement - Replay Scrubbing Now Properly Handles Location Popups
- **Fixed location popups being ignored after scrubbing with the progress bar**: When user seeked to a new position using the scrub bar, location popups would not appear when playback resumed
- Root cause: `replaySeekTo` didn't update `visitedLocations` when seeking - locations that were ahead of the new position remained marked as visited
- Fix: `replaySeekTo` now:
  - Clears current popup and pause state
  - Rebuilds `visitedLocations` based on the new timeline position
  - Only marks locations as visited if their end time is before the current seek position
  - Resets `lastLocationEndTime` to the latest passed location's end time
- This ensures location popups correctly appear for locations that haven't been passed yet at the new position

### Enhancement - Smoother Popup Animation
- Removed angular/rotational movement from the Disney-style location popup bounce animation
- Animation now uses pure scale and vertical translation for a cleaner effect

## Build 660 (2026-01-14)

### Fix - Diary Highlighting Previous Activity After Location Stop
- **Fixed diary briefly highlighting previous activity (e.g., "Car") after stopping at a location**: After visiting "Walk Start" at 07:18, the diary would briefly highlight "Car (07:08-07:18)" before switching to the next "Walking" activity
- Root cause: GPS data points near location stops often have timestamps BEFORE the location's start time, causing the activity matcher to find the previous activity
- Fix: Added `lastLocationEndTime` state to track when the last visited location ended
- `highlightReplayDiaryEntryByTime` now skips any activity whose end time is before `lastLocationEndTime`
- This ensures activities that occurred BEFORE the current location are never highlighted after leaving that location
- State is reset when starting or restarting replay

## Build 659 (2026-01-14)

### Fix - Activity Flash After Location Stop (Complete Fix)
- **Fixed brief previous activity highlight when leaving a location stop**: Build 658's delay mechanism was being bypassed
- Root cause discovered: `checkLocationArrival` was immediately clearing `currentLocationName` when detecting sprite left the location area
- This happened BEFORE the 500ms delay could protect against activity highlighting
- Fix 1: `checkLocationArrival` now respects `locationClearTime` - won't clear `currentLocationName` during the delay period
- Fix 2: Updated `checkLocationArrival` to use composite keys (`${name}_${startTime}`) for visited tracking, consistent with `checkForLocationInPath`
- This ensures both location detection methods handle repeat visits correctly

## Build 658 (2026-01-14)

### Fix - Activity Flash After Location Stop
- **Fixed brief previous activity highlight when leaving a location stop**: After pausing at a location, the previous activity would briefly highlight before moving forward
- Root cause: `currentLocationName` was cleared immediately when pause ended, allowing `highlightActivityEntry` to run and match the previous activity (since current timestamp was between activities)
- Fix: Delay clearing `currentLocationName` by 500ms after pause ends using new `locationClearTime` state
- This gives time for the sprite to move into the next activity's time range before activity highlighting resumes

## Build 657 (2026-01-14)

### Fix - Replay Stops Triggering Multiple Times
- **Fixed sprite showing popup multiple times at same location**: Animation frames were racing ahead of visitedLocations update
- Root cause: `checkForLocationInPath` returned location info, but `visitedLocations.add()` happened inside `showReplayLocationPopup` which took time
- Multiple animation frames could detect the same location before it was marked as visited
- Fix: Return `visitKey` from `checkForLocationInPath` and add to `visitedLocations` IMMEDIATELY before showing popup
- Pass `skipVisited=true` to `showReplayLocationPopup` since we already marked it

## Build 656 (2026-01-14)

### Fix - Replay Animation Issues
- **Fixed sprite not stopping at repeat location visits**: Locations visited multiple times in a day (e.g., home → work → home) now all trigger stops
- Root cause: `visitedLocations` Set was tracking by name only, so second visit to same location was skipped
- Fix: Track visits using composite key `${name}_${startTime}` to make each visit unique
- Also improved location matching for popup display to use time proximity for repeat visits
- **Fixed activity not highlighting in diary during replay**: Car/walking activities now highlight correctly
- Root cause: Matching used 10-minute window from start time, but long activities exceed this
- Fix: Check if current time falls WITHIN activity duration (start to end), not just near start
- Added `data-end-date` attribute to activity elements for accurate duration matching

## Build 655 (2026-01-14)

### Fix - Activity Polyline Click Not Highlighting Diary
- **Fixed clicking activity polylines not highlighting diary entry**: Regression where clicking a route segment no longer highlighted the corresponding activity in the diary
- Root cause: Duplicate function definition - `highlightDiaryEntryByTime` was defined twice with different signatures
- The 3-parameter version (for route clicks) was being overwritten by a 1-parameter version (for replay mode)
- Fix: Renamed replay version to `highlightReplayDiaryEntryByTime` to avoid conflict

## Build 654 (2026-01-14)

### Critical Fix - Missing Closing Brace in showDayMap
- **Fixed map bounds not respecting padding**: Routes were extending behind diary/stats panels
- Root cause: Missing closing brace for the `for (const p of locs)` loop in `showDayMap`
- The fitBounds code was accidentally inside the loop, causing it to run once per location marker
- This resulted in 13+ redundant fitBounds calls per day (one per location) with incrementing bounds
- Added missing `}` to properly close the marker creation loop
- Also: `showDayMap` now passes `fit: false` to `drawColorCodedRoute` to avoid double fitBounds

## Build 653 (2026-01-14)

### Fix - Map Bounds Respecting Padding (incomplete)
- Attempted to fix routes extending behind panels by eliminating double fitBounds
- Changed `showDayMap` to pass `fit: false` to `drawColorCodedRoute`
- This was a partial fix - the real issue was the missing closing brace (fixed in Build 654)

## Build 652 (2026-01-14)

### Fix - Progress Bar Text During Backup Import
- Progress bar now shows percentage text (0%, 5%, 10%, etc.) during iCloud backup import
- Previously only the bar width updated, text stayed at "0%"

## Build 651 (2026-01-14)

### Smart Import - Content Comparison
- **Won't overwrite if existing has more content**: Import now compares timeline item counts, not just timestamps
- If existing day has MORE items than incoming data, import skips (preserves richer data)
- If same item count, falls back to timestamp comparison
- Applies to both JSON export and iCloud backup imports
- `getDayMetadataFromDB()` loads dayKey + lastUpdated + itemCount in one cursor pass
- Reverted "Missing days only" to unchecked (content comparison handles protection)

## Build 650 (2026-01-14)

### iCloud Backup Import - Safe Default
- **"Missing days only" now checked by default**: Prevents backup import from overwriting existing JSON export data
- JSON export data is more complete than reconstructed backup data, so backup should only fill gaps

## Build 649 (2026-01-14)

### Bug Fix - Month Selector Blank After Import
- **Fixed month selector empty after iCloud backup import**: `monthKeys` wasn't being refreshed after import completed
- Now calls `loadMostRecentMonth()` after both JSON and iCloud backup imports finish
- This refreshes `monthKeys` and repopulates year/month selectors with imported data

## Build 648 (2026-01-14)

### Import Performance Optimization (Safe Version)
- **Fixed crash from previous optimization attempt**: Build 648 in Chat used `getAll()` on days store which crashes with 300MB+ data
- **New safe approach**: `getDayTimestampsFromDB()` uses cursor to extract only `dayKey` + `lastUpdated` fields (~50KB vs 300MB)
- **O(n) → O(1) optimization**: Pre-loads timestamps into Map before import loop, enabling O(1) lookups instead of individual DB queries
- **Backward compatible**: `importDayToDB()` accepts optional `existingTimestamps` parameter, falls back to individual queries if not provided
- Re-imports with 4000 files now use 1 DB query + 4000 Map lookups instead of 4000 DB queries

### Additional getAll() Fixes
- **`rebuildAnalysisData()`**: Now uses cursor streaming instead of `getAll()` - processes days one at a time
- **`exportDatabaseToJSON()`**: Now uses cursor streaming with UI yields every 100 days to prevent browser freeze
- Both functions now safe with 3000+ days of data

## Build 647 (2026-01-14)

### Critical Fix - Diary Highlighting
- **Fixed location entries highlighted early**: `highlightDiaryEntryByTime()` was matching ALL entries by time, including location entries kilometers ahead. Now only matches activity entries (`data-type="activity"`)
- Location entries are now ONLY highlighted when the popup appears (via `highlightDiaryEntryByName()`)
- Activity entries continue to be highlighted while traveling between locations

## Build 646 (2026-01-14)

### Animation Controller Fixes
- **Removed clickable timeline markers**: The click-to-jump feature was causing popups to stop appearing; reverted to simple non-interactive yellow position indicators
- **Fixed diary highlighting timing**: Location entries now highlight only when the popup appears (synced with popup), not early
- **Activity highlighting**: Activity entries (walking, driving, etc.) still highlight during travel between locations
- **Improved acceleration/deceleration**: 
  - Uses actual route distances instead of time-based estimates
  - Smoother easing curves (quadratic) for natural deceleration approaching stops
  - Starts slowing 150m before stops, minimum 15% speed
  - Gradual acceleration when leaving stops

## Build 645 (2026-01-14)

### Animation Diary Highlighting Improvements
- **Fixed duplicate location name issue**: Now matches diary entries by both name AND start time to correctly highlight when multiple locations share the same name
- **Fixed timeline marker click**: Now correctly centers map on location coordinates (not just route point) and positions sprite at the location
- **Activity highlighting**: Highlights activity entries (walking, driving, etc.) during animation when sprite is between locations, using time-based matching within 10 minutes
- **Day filtering**: Highlighting now filters by current day's entries (`data-daykey`) to avoid matching entries from other days
- **Marker click improvements**: No longer calls `replayUpdatePosition` after click to prevent overriding the correct highlight

## Build 644 (2026-01-14)

### Bug Fixes
- **Fixed diary highlighting**: Now properly finds entries using `data-location` attribute instead of text matching
- **Fixed popup signs**: Reverted to highway sign style (green with white border), kept bounce animation, shows time and duration
- **Fixed popups stopping after marker click**: Clicking timeline markers now uses `skipVisited` flag so future popups still appear
- Added proximity-based highlighting (100m) in addition to time-window matching for better diary tracking
- Directly highlight diary entry when clicking timeline markers

## Build 643 (2026-01-14)

### Animation Controller Enhancements
- **Fixed multiple sprites**: Old marker is now removed before creating new one when changing days
- **Diary highlighting**: Current location entry automatically highlighted and scrolled into view as sprite progresses (respects if user closed diary)
- **Clickable timeline markers**: Yellow markers on progress bar now clickable - click to jump to that location and show popup
- **Enhanced popups**: 
  - Bounce-in animation when appearing
  - Location-specific emoji icons (🏠 home, ☕ cafe, 🏢 office, etc.)
  - Shows visit duration alongside arrival time
  - Gradient background with improved styling
- **Marker hover effects**: Yellow markers glow and scale on hover, showing they're interactive
- Clears diary highlights when closing animation controller

## Build 642 (2026-01-13)

### Animation Controller Fixes
- Fixed animation getting stuck at first location - now uses `visitedLocations` Set to track shown popups
- Fixed yellow markers on timeline bar - now positioned by DISTANCE along route (matching progress bar) instead of TIME
- Fixed date picker months being grayed out - removed min/max constraints that caused browser to disable months
- Clear `currentLocationName` when pause ends to allow next location detection
- Clear `visitedLocations` on restart and when loading new day

## Build 641 (2026-01-13)

### Bug Fix
- Fixed "Cannot read properties of null (reading 'addLayer')" error at startup
- Added guard at start of showDayMap() to check map is initialized
- Added guard in marker loop to handle clusterGroup being cleared

## Build 640 (2026-01-13)

### Animation Look-Ahead for Locations
- Added `checkForLocationInPath()` to detect locations before the sprite reaches them
- Prevents skipping locations at high speeds - sprite now stops at location even if frame would have passed it
- Checks route points between current and proposed distance for proximity to locations
- Uses 75m proximity threshold with optional timestamp validation

## Build 639 (2026-01-13)

### Animation Controller Fixes
- Fixed date picker not finding available dates (now checks routesByDay, locationsByDay, and days)
- Fixed location popups not showing for some visits (now handles missing startDate/endDate with proximity fallback)
- Fixed speed display causing layout shifts (fixed width for 3-digit speeds: `90px` container, `3ch` min-width)
- Updated findNearestStop to work with partial timestamp data

## Build 638 (2026-01-13)

### Cleanup
- Removed debug console logging from containment detection

## Build 637 (2026-01-13)

### Timeline Sorting Fix
- Fixed items not being chronologically sorted before containment detection
- Items were appearing in wrong order (4:51 AM before 12:00 AM overnight visit)
- Added sorting by startDate in: loadMonthFromDatabase merge, findContainedItems, coalesceTimelineForDisplay
- Overnight visits now properly contain subsequent noise items

## Build 636 (2026-01-13)

### Debug Logging
- Added console logging to findContainedItems and coalesceTimelineForDisplay
- Check browser console to diagnose containment issues

## Build 635 (2026-01-13)

### Containment Logic Fix
- Fixed first item incorrectly containing itself
- Only check containment after a container has been established (not against pre-scanned boundary)
- 4:51 AM and 4:52 AM noise now properly hidden within 12:00 AM - 8:45 AM visit

## Build 634 (2026-01-13)

### Notes Timezone Fix
- Fixed notes not attaching to visits during backup import
- Notes stored with UTC timestamps (e.g., `2026-01-10T21:25:56Z`) were being filed under UTC date
- Now converts to local date for proper day matching (21:25 UTC = 07:25 local in UTC+10)
- Fixes missing notes on visits near midnight UTC

## Build 633 (2026-01-13)

### Bug Fix
- Fixed `currentContainer is not defined` error in coalescer after refactoring

## Build 632 (2026-01-13)

### Shared Containment Detection
- Extracted `findContainedItems()` as shared function for display and analysis
- Both coalescer and analysis functions use same containment logic
- Fixes edge cases only need to be fixed once
- Guarantees consistency between diary display and activity statistics

## Build 631 (2026-01-13)

### Duration Display & Midnight Containment Fix
- Duration now shows seconds for short items (`20s` instead of `0m`)
- Fixed containment for midnight-spanning visits (pre-scans first item)
- Visits starting before a long visit's endDate are properly contained

## Build 630 (2026-01-13)

### Containment Logic (Option C)
- Items contained within longer visits (>30 min) marked `_contained` and hidden
- Data gaps (no GPS) marked `_dataGap`, shown with `[NO GPS]` tag
- Items with `customTitle` always shown regardless of containment
- Analysis skips contained items for consistent statistics

## Build 629 (2026-01-13)

### iCloud Backup Import Fixes
- `customTitle` now preserved during backup import (custom visit names)
- `placeId` preserved for coalescer place matching
- "Missing days only" checkbox unchecked by default
- Mapbox settings moved outside database panel (always visible)

## Build 628 (2026-01-13)

### Display-Only Timeline Coalescer
- Added coalescing for iCloud backup imports (display only, doesn't modify stored data)
- Coordinate-based place matching for visits without placeId
- "Raw" toggle to see uncoalesced timeline
- Visual indicators for merged/coalesced items
- Places loaded from backup with radiusMeters
- Progress bar: 0-5% places, 5-10% notes, 10-60% timeline, 60-80% GPS, 80-100% saving

## Build 627 (2026-01-13)

### Coalescer Architecture Design
- Planned display-only coalescing approach
- Rules: merge adjacent same-place visits, suppress ultra-short visits, collapse short unknowns
- Never modifies canonical chain - display purposes only

## Build 626 (2026-01-13)

### Bug Fixes
- Fixed linked list ordering in backup import
- ActivityType preserved from backup data
- Notes attachment improved with timestamp overlap matching

## Build 625 (2026-01-13)

### Linked List Ordering
- Backup import now respects `previousItemId`/`nextItemId` chain
- `orderItemsByLinkedList()` reconstructs canonical order
- Fixes timeline sequence for iCloud imports

## Build 601-624
- Various incremental fixes to backup import
- GPS sample loading optimizations
- Place lookup improvements
- Note matching refinements

## Build 600 (2026-01-12)

### Incremental Backup Import
- Backup imports now track `lastBackupSync` (max `lastSaved` timestamp from TimelineItems)
- Subsequent imports only process items modified since last sync
- GPS sample loading filtered to weeks containing changed items
- Places loaded only for referenced items (incremental imports)
- Notes loaded only for changed days
- First import: processes everything (~minutes)
- Subsequent imports: only changes (~seconds)

## Build 599 (2026-01-12)

### iCloud Backup Import Support
- Added dual import mode with tabbed UI (JSON Export / iCloud Backup)
- Backup import reads Arc's iCloud backup structure:
  - TimelineItem/ - visits and activities
  - LocomotionSample/ - GPS samples (weekly .json.gz files)
  - Place/ - named locations
  - Note/ - diary entries
- Reconstructs daily records by joining relational data
- Decompresses GPS samples using pako.ungzip()
- Attaches samples to timeline items by timelineItemId
- Notes matched to items by timestamp overlap
- Expected to recover 1163+ missing days from backup
- Both import methods write to same IndexedDB format

## Build 598 (2026-01-12)

### Location View UI Improvements
- Triangle toggle moved to left of stats line ("▶ 66 visits • 12h 13m total")
- Toggle is larger (14px), blue, with hover highlight
- Keyboard navigation in Location View:
  - ↑/↓/←/→ navigate between locations
  - Home/End jump to first/last location
  - Enter/Space toggle expand/collapse
  - Map pans to show selected location

## Build 597 (2026-01-12)

### Fixed Multi-Location Visit Matching
- `sendLocationsToDiary` now matches visits by proximity, not just name
- Same-day merge key includes coordinates to separate physical locations
- Fixes: visits to same-name stores (e.g., Bunnings Mansfield vs Coffs Harbour) now correctly assigned

## Build 596 (2026-01-12)

### Location Aggregation Fixes
- Capped variation circle radius at 500m
- Stricter filtering requires both location and visit to have coordinates
- Visit counting uses centroid distance

## Build 595 (2026-01-12)

### Increased Location Thresholds
- Clustering threshold: 200m → 300m
- Visit counting in search: 50m → 500m
- Visit filtering in analysis: 300m → 500m
- Fixes undercounting at large locations like Bunnings

## Build 593-594 (2026-01-12)

### Location Merging in Diary
- Added `mergeNearbyLocations()` - merges locations within 150m
- Uses centroid for merged marker position
- Keeps all visits separate (no automatic same-day merging)

## Build 592 (2026-01-12)

### Geocoding Improvements
- Mapbox requests run in parallel (no rate limiting needed)
- Cached results applied immediately
- Fixed verbose suburb names (e.g., "Yandina, Sunshine Coast Regional" → "Yandina")
- Checks Mapbox context for more specific locality names

## Build 591 (2026-01-12)

### Auto-Geocode Locations Without Suburbs
- `geocodeLocationsWithoutSuburbs()` runs after entering location view
- Uses Mapbox if token available, falls back to Nominatim
- Results cached in localStorage
- Updates location names in DOM dynamically

## Build 590 (2026-01-12)

### Marker Click Diary Focus Fix
- Fixed diary remaining transparent when clicking location markers
- Uses `setTimeout(() => focusDiary(), 0)` to ensure proper timing

## Build 587 (2026-01-12)

### Bug Fixes
- Date preset mismatch after data refresh - validates dates within new data range
- Fixed null reference errors in analysis.html and app.js
- Fixed `savedDiaryState` race condition in async callback

## Build 585-586 (2026-01-12)

### Analysis Location Search Enhancements
- Added "Select All" button for matching locations (up to 50)
- Improved map tooltip: "Click to view these locations in the diary map"
- Location markers cleared when exiting location view

## Builds 574-584 (2026-01-11 to 2026-01-12)

### Location View Mode Refinements
- Collapsible visit lists (>5 visits start collapsed)
- Map marker transparency fix
- Mapbox search integration
- Analysis tab version checking
- Location marker clearing when restoring diary

## Builds 563-573 (2026-01-11)

### Location View Mode Implementation
- BroadcastChannel communication between analysis and diary
- Visual notifications for tab reuse
- Title/subtitle/back button layout
- Variable name bug fixes

## Builds 550-562 (2026-01-11)

### Multi-Location Analysis
- Results area scrolling fix
- Dynamic marker sizing based on count
- Consistent button styling
- PNG export captures full content
- Date range preservation across imports

## Builds 530-549 (2026-01-10 to 2026-01-11)

### Location Infographic Enhancements
- Mapbox dark-v11 style for dark mode
- Theme toggle updates map tiles
- CSS filter only for CARTO tiles
- Multi-location title truncation
- Full-page scrolling for analysis results

## Builds 510-529 (2026-01-10)

### PDF and PNG Export Improvements
- PDF map positioning fix with tile-based rendering
- 3x resolution for both exports
- Mapbox tile support in exports
- Dark mode map styles

## Builds 500-509 (2026-01-09 to 2026-01-10)

### Location Analysis Features
- Physical location clustering (200m threshold)
- Lazy reverse geocoding with Nominatim API
- localStorage caching for geocode results
- Suburb display in hero subtitle
- PDF export with jsPDF

## Build 498 (2026-01-09)

### Analysis Moved to Separate Tab
- Analysis now opens in a new browser tab (analysis.html)
- Can view diary and analysis side-by-side
- Cleaner separation of concerns
- Full-featured standalone analysis page with:
  - Activities and Locations tabs
  - Date presets (1M, 3M, 6M, YTD, 1Y, All)
  - Stacked chart option
  - Week grouping option
  - Built-in rebuild functionality
  - Export to PNG

### Location Visits Fix (Build 497)
- Fixed `updateAnalysisDataForDaySafe()` to include location visits
- Locations now populate correctly after rebuild

## Build 495 (2026-01-09)

### Analysis Panel Redesign
- Apple Liquid Glass style matching the rest of the app
- Compact header with small rebuild button (⟳ icon)
- Date range presets: 1M, 3M, 6M, YTD, 1Y, All
- 3M preset selected by default
- Cleaner options row with labeled dropdowns
- Export button now shows camera icon (📷)

### Distance Calculation Fix
- Fixed `calculateDistanceForAnalysis()` to use correct sample structure
- Samples use `sample.location.latitude` not `sample.latitude`
- Distance data now calculated correctly from GPS samples

## Build 489 (2026-01-09)

### UI Changes
- Renamed "Database" button to "Analysis"

### Rebuild Progress Fix
- Rebuild button now shows full progress UI in results area
- Progress bar with percentage and day count
- Completion message when done
- Increased yield time (10ms) for smoother UI updates

## Build 488 (2026-01-09)

### Fix: Distance Data Missing
- Now uses `item.distance` directly from Arc data instead of calculating from samples
- Previous builds had 0 distance because sample calculation didn't work

### Activity Checkboxes Shown Before Analysis
- Activities appear immediately when opening Analysis panel
- Sorted by total distance across all data
- Top 4 pre-selected

### Rebuild Button
- Added "Rebuild" button in Analysis panel header
- Click to recalculate all analysis data with the fix
- Shows progress percentage during rebuild

## Build 486-487 (2026-01-09)

### Recovery from DB Crash
- Simplified DB init to avoid crashes
- Added safety checks for v2 stores
- Created delete-db.html recovery tool
- Re-enabled analysis features after recovery

## Build 485 (2026-01-09)

### Better DB Upgrade Debugging
- Added detailed logging to identify where DB init hangs
- Shows "Upgrading database from v1 to v2..." in UI during upgrade
- Shows red error message if database is blocked by another tab
- Console shows each step: opening, upgrading, creating stores

## Build 484 (2026-01-09)

### Fix: Cylon Bar Hidden During Rebuild
- Hides the indeterminate loading bar when rebuild progress is shown
- Shows "starting..." message immediately when rebuild begins
- Refreshes stats display when rebuild completes

## Build 483 (2026-01-09)

### Main Screen Rebuild Progress
- Shows "Building analysis data: 234 / 4450 days (5%)" on main screen
- Message clarifies "You can Open Diary Reader now - this runs in background"
- User doesn't have to wait for rebuild to complete

## Build 482 (2026-01-09)

### Bug Fix: DB Not Ready Error
- Fixed "Cannot read properties of null (reading 'transaction')" error
- `openDiaryFromDatabase` now waits for `dbReadyPromise`
- Better error handling and logging during DB upgrade
- Added `onblocked` handler for DB upgrade conflicts

## Build 481 (2026-01-09)

### Interruptible Rebuild
- On startup, checks if analysis data is complete (day count vs summary count)
- If interrupted rebuild detected, automatically resumes
- User can safely close browser during rebuild

## Build 480 (2026-01-09)

### Rebuild Progress Feedback
- Database button shows pulsing orange dot while rebuilding
- Analysis panel shows progress bar if opened during rebuild
- Progress text: "1,234 / 4,450 days"
- Auto-refreshes when rebuild completes

## Build 479 (2026-01-09)

### New IndexedDB Schema (v2)
- Added `dailySummaries` store - lightweight activity stats per day
- Added `locationVisits` store - per-day location records with indexes
- Added `locations` store - unique locations for autocomplete
- Background rebuild on DB upgrade from v1 to v2
- Incremental updates after import (background task)

### Analysis Panel - Two Tabs
**Activities Tab:**
- Date range picker
- Metrics: Distance, Duration, Trip Count
- Group by: Day or Month
- Shows missing days warning when gaps in data

**Locations Tab:**
- Search input with fuzzy autocomplete
- Multi-select locations
- Optional date range filter
- Results: Total visits, total time, days visited
- Day-of-week chart showing visit patterns
- Visit history table

## Build 478 (2026-01-09)

### Activity Trends: Date Range Analysis
- No auto-analysis on open - select dates first
- Date range picker (From/To)
- Daily summaries stored in IndexedDB (~4,450 days supported)
- Group by: Day or Month
- Summary header shows totals for selected range
- Use case: "How far did I walk during our Japan trip?"
- Cache invalidated after import

## Build 477 (2026-01-09)

### Replaced spreadsheet with Activity Trends
- Removed Luckysheet (was too slow)
- New trend chart UI using Chart.js
- Monthly summaries calculated from daily data
- Summaries cached in IndexedDB for instant subsequent loads
- Cache invalidated automatically after import
- Metrics: Distance, Duration, Trip Count
- Chart types: Line, Bar
- Activity checkboxes to filter what's shown
- Monthly summary table with top activities
- Export chart as PNG

## Build 476 (2026-01-07)

### Fixed: Stale data after import
- Cache invalidation: After import, affected months are cleared from memory
- This forces reload from IndexedDB when user views those months
- Fixed: openDiaryReader now reloads from DB if cache is empty
- Fixes issues with: recently loaded days not displaying, missing stats

## Build 475 (2026-01-07)

### Performance: Load one month at a time
- Added month picker with prev/next buttons
- Loads current month by default
- Uses IndexedDB monthKey index for fast queries
- Much faster initial load (~30 days vs 4000+ days)

## Build 474 (2026-01-07)

### Changed spreadsheet to show timeline items
- Columns: Date, Time, Activity, Location, Distance (km), Duration, Speed (km/h), Notes
- Each row is a timeline item (visit or activity)
- Activity types color-coded
- Distance/speed calculated from GPS samples
- Sorted by date descending, then time ascending

## Build 473 (2026-01-07)

### Switched to Luckysheet (Excel-like UI)
- Full Excel-like spreadsheet interface
- Sheet tabs for Days and Metadata
- Formula bar
- Cell selection and copy/paste
- Column resize
- Frozen header row
- Export to Excel button
- "Go to" links in cells navigate to diary

## Build 472 (2026-01-07)

### Integrated Tabulator spreadsheet library
- Virtual scrolling for 4000+ rows
- Built-in column sorting and filtering
- Multi-row selection with shift+click
- Export to CSV
- Resizable columns
- Removed 350 lines of custom table code

## Build 471 (2026-01-07)

### Replaced Analysis panel with Database spreadsheet viewer
- New spreadsheet-style view of IndexedDB contents
- Days tab: sortable columns, filter by day/month, pagination
- Metadata tab: key-value pairs with delete option
- Select multiple rows for bulk delete
- "View" button shows record details, "Go to" navigates to diary
- Removed old preset queries and ad-hoc query forms

## Build 470 (2026-01-07)

### Code cleanup - removed 287 lines
- Consolidated 3 duplicate window export blocks into 1
- Removed dead functions:
  - `getAllDaysFromDB` - never called
  - `getPinIcon`, `makeSvgPin`, `pinIconCache` - never called  
  - `getEntriesFromModel` - never called
  - `getNotesFromModel` - never called
  - `generateMonthlyStatsMarkdown` - never called
  - `generateDailyStatsMarkdown` - never called

## Build 469 (2026-01-07)

### Fixed print text wrapping
- Text was running off right edge of page
- Added beforeprint/afterprint handlers to clear inline width styles
- Added comprehensive word-wrap CSS for all print containers
- Added @page margin setup

### Smoothed vehicle animation rotation
- Added exponential smoothing filter (factor 0.2) to bearing calculations
- Handles 0/360 degree wraparound correctly
- Reduces car "wriggle" from GPS noise

### Fixed diary toggle preserving map position
- Rewrote toggleDiary to use simple pan-by-delta approach
- Uses noRefit: true + manual pan by delta/2 pixels

### Measurement tool button state
- Button stays active while measurement lines are displayed
- Click clears measurement when inactive with existing measurement

### Option+click zoom for polylines
- Normal click: highlight + scroll diary (no zoom change)
- Option/Alt+click: highlight + scroll + zoom to segment bounds

## Build 461 (2026-01-07)

### Fixed measurement tool popup not appearing after zoom
- Bug: popup existed but was closed by fitBounds, code updated content but didn't reopen
- Fix: check if popup is on map, reopen with openOn() if closed
- Added debug logging and magenta debug rectangle for diagnosis

### Changed maxZoom for single route highlight
- highlightAndShowRouteByTime now uses maxZoom: 18 (was 17)

## Build 460 (2026-01-07)

### Fixed measurement tool popup (reverted broken changes)
- Popup shows before zoom, then re-shows 300ms after zoom completes
- Clicking line or marker: shows popup then zooms
- Restored original toggle behavior

## Build 459 (2026-01-07)

### Fixed measurement tool popup behavior
- Popup now appears at center of measurement bounds (not last point)
- Popup reliably shows after double-click zoom animation completes
- Clicking measurement path now zooms to fit AND shows popup
- Clicking measurement markers also zooms to fit with popup
- Added timeout fallback if moveend event doesn't fire

## Build 458 (2026-01-07)

### Optimized diary search performance
- Single IndexedDB cursor iterates through all days (1 transaction vs thousands)
- Processes one day at a time - minimal memory footprint
- Uses indexOf() instead of regex for faster case-insensitive matching
- Time-based UI updates (every 100ms) for responsive progress bar

### Fixed measurement tool issues
- Popup now re-appears after zoom animation completes (was disappearing)
- Clicking on measurement line restores popup without re-zooming
- Button toggle now has 3 states: active → inactive (with measurement) → clear → active
- Clicking button while measurement exists clears it instead of activating tool

### Fixed popup opening for clustered markers at same location
- Uses 'spiderfied' event listener instead of fixed timeout delays
- Popup reliably opens after cluster animation completes
- Works correctly when multiple visits share exact same coordinates

## Build 456 (2026-01-07)

### Fixed measurement tool zoom after double-click
- Now uses NavigationController.mapPadding for correct centering in visible area
- Accounts for diary panel and search slider when centering measurement bounds
- Increased maxZoom from 16 to 18 for better zoom on short measurements

## Build 455 (2026-01-07)

### Fixed search results slider map adjustment
- Slider opening/closing now only pans horizontally (no unwanted vertical movement)
- Calculates delta from old slider width and pans by half the difference
- Added `margins` getter to NavigationController for tracking current slider state
- Map smoothly adjusts to keep the visible area centered as slider animates

## Build 454 (2026-01-07)

### Fixed search results slider issues
- Increased left padding in slider content (28px → 36px) for better margin from diary edge

## Build 453 (2026-01-07)

### Fixed diary search results formatting
- Fixed: Search results were displayed in horizontal flex layout instead of vertical stack
- Scoped flex layout CSS to only apply to location search popup (`#searchResults`)
- Diary search slider results now display correctly with date, time, and text on separate lines

## Build 452 (2026-01-07)

### Fixed measurement button active state
- Added orange active state styling for measurement button
- Fixed: Button now gets fresh DOM reference on each toggle (was caching stale reference)
- Visual feedback so user knows measurement mode is on

## Build 451 (2026-01-07)

### Fixed: Measurement tool and other map tools now work
- Changed all tool initializations to assign directly to window.*
- Removed intermediate local variable assignments
- MeasurementTool: `window.measurementTool = new MeasurementTool(map)`
- LocationSearch: `window.locationSearch = new LocationSearch(map)`
- Updated event handlers to use window.measurementTool consistently

## Build 450 (2026-01-07)

### Fixed map tools not working after refactoring
- Fixed: Measurement tool, location search, and route animator bridge functions now use window references
- Removed unused local variables (measurementTool, locationSearch, routeAnimator) from map-tools.js
- All bridge functions now properly reference window.measurementTool, window.locationSearch, window.routeAnimator
- Cleaned up unused init functions

## Build 449 (2026-01-07)

### Removed duplicate distance function
- Removed `calculateHaversineDistance` (identical to `calculateDistance`)
- Updated 5 call sites to use `calculateDistance`
- Updated window export from `calculateHaversineDistance` to `calculateDistance`
- Fixed: Removed stale window exports for functions now in map-tools.js
  (toggleMeasureTool, toggleSearchPopup, handleSearchKeydown, selectSearchResult,
   toggleAnimationPopup, toggleAnimationSetting, updateAnimationSpeed)
- app.js reduced by ~20 lines

## Build 447 (2026-01-07)

### RouteAnimator moved to map-tools.js
- RouteAnimator class extracted from app.js to map-tools.js
- Utility functions moved: getVehicleColor, calculateBearing, getFallbackVehicleSvg, adjustColor, getPointTime
- Bridge functions remain in app.js for legacy compatibility
- app.js reduced by ~390 lines (10,278 → 9,890)
- map-tools.js increased to ~1,507 lines

## Build 446 (2026-01-07)

### Full route cleanup when exiting route planner
- Route popup is now closed when clearing route
- Search popup is closed and input cleared
- Start marker is removed
- All route state fully reset when returning to diary mode

## Build 445 (2026-01-07)

### Month title click also clears route planner
- Added route clearing to month map title click handler
- Now all diary interactions properly exit route planning mode

## Build 444 (2026-01-07)

### Diary interaction clears route planner
- Clicking any diary entry (time or activity) clears active location route
- Clicking any day title clears active location route
- Changing months clears active location route
- Diary routes are automatically restored when location route is cleared
- All clearing via NavigationController.selectMonth/selectDay/selectEntry

## Build 443 (2026-01-07)

### Route refits to use available space when panels change
- Added `refitRoute()` method to LocationSearch
- When diary/stats panels open or close, route automatically refits to available space
- Route uses larger space when panels close, smaller space when panels open
- Centralized active route check in NavigationController.updateViewportMargins
- `noRefit` option for explicit skip when caller handles zoom (e.g., during route calculation)

## Build 442 (2026-01-07)

### Route preserved during all diary/UI changes
- Opening diary no longer zooms out active route
- Resizing diary no longer zooms out active route
- Search slider open/close no longer zooms out active route
- Window resize no longer zooms out active route
- All `updateViewportMargins` calls now check for active location route

## Build 441 (2026-01-07)

### Fix: Closing diary no longer zooms out active route
- Added `hasActiveRoute` getter to LocationSearch class
- When diary is closed with a location route active, skips refit to month bounds
- Route view is preserved when hiding diary panel

## Build 440 (2026-01-07)

### Route uses full map space when stats panel closes
- Fixed: NavigationController margin now properly cleared when stats panel closes
- Route fitBounds now uses full available space (no phantom right margin)
- Exposed getMapPadding to window for cross-module access
- Added skipRefit option to updateViewportMargins

## Build 439 (2026-01-07)

### Trip planning UX improvements
- Activity stats panel closes automatically when route is calculated
- Increased right padding on search results for scrollbar clearance
- Distance and Route button no longer cut off by scrollbar

## Build 438 (2026-01-07)

### Preserve zoom when editing waypoints
- Adding waypoints (⌥+click) no longer zooms out - keeps detailed view
- Dragging waypoints no longer zooms out - preserves precision
- Removing waypoints (right-click) no longer zooms out
- Only initial route calculation and clicking on route line will zoom to fit
- Better UX for precise waypoint placement

## Build 437 (2026-01-07)

### Hide diary routes during location routing
- Diary routes, markers, and clusters hidden when location route is displayed
- Routes automatically restored when location route is cleared (right-click or close popup)
- Added `hideDiaryRoutes()` and `showDiaryRoutes()` functions to app.js
- Cleaner view when planning routes without diary data clutter

## Build 436 (2026-01-07)

### Route click behavior change
- **Click on route** → shows whole route with popup (zoom to fit)
- **Option/Alt + click on route** → adds waypoint
- Route info stored for reuse on subsequent clicks
- Updated hint text: "⌥+click to add stop"

## Build 435 (2026-01-07)

### Route popup and zoom fixes
- Popup now positioned at actual route midpoint (distance-based, not bounds center)
- Fixed `getMapPadding is not defined` error - uses fallback padding if not available
- Reduced maxZoom from 15 to 14 to ensure whole route is visible
- Added `#getRouteMidpoint()` method that calculates point at 50% of route distance

## Build 434 (2026-01-07)

### Code reorganization - map-tools.js
- Moved MeasurementTool class to separate file (map-tools.js)
- Moved LocationSearch class to separate file
- Moved utility functions (calculateDistanceKm, formatSearchDistance)
- app.js reduced from ~11,150 lines to ~10,200 lines
- map-tools.js: ~960 lines
- Dynamic script loading: f1car.js → map-tools.js → app.js

## Build 433 (2026-01-07)

### Improved route popup
- Popup now shows both "From" and "To" locations
- Popup positioned at route center (not at destination marker)
- Cleaner layout with labeled From/To sections

## Build 432 (2026-01-07)

### Custom start location for routes
- **"Start" button** on each search result to set custom starting point
- Green marker shows custom start location on map
- GPS location used as fallback if no custom start set
- Debug bar shows current start: custom name or "(GPS)"
- "clear" link to remove custom start and revert to GPS
- Routes recalculate automatically when start changes
- Warning shown if no start location available
- Search results always show both Start and Route buttons

## Build 431 (2026-01-07)

### Route popup close button fix
- Properly positioned close button inside popup bounds
- Added padding-right to content to avoid text/button overlap
- Styled close button (smaller, lighter color)
- Close button now clearly inside the popup area

## Build 430 (2026-01-07)

### Route popup margin fix
- Increased top margin on route popup content (12px → 16px)
- Close button now sits comfortably within popup bounds

## Build 429 (2026-01-07)

### Cleaner route popup design
- Simplified popup layout - no more cluttered buttons
- Removed zoom level from route popup
- Uses NavigationController padding for fitBounds
- Right-click destination marker to clear entire route
- Hint text: "Click route to add stop · Right-click to clear"
- Custom route-popup CSS class for styling

## Build 428 (2026-01-07)

### Improved route UI and waypoints
- Redesigned search result layout - cleaner with distance and Route button on right
- **Waypoints support:**
  - Click anywhere on the route line to add a waypoint
  - Drag waypoint markers to reposition them
  - Right-click waypoint markers to remove them
  - Route recalculates automatically with each change
  - Orange numbered markers show waypoint order
- Popup shows waypoint count and instructions
- Debug bar shows stop count

## Build 427 (2026-01-07)

### OSRM road routing in Location Search
- "🚗 Route" button on each search result (when user location available)
- Fetches driving route from OSRM (Open Source Routing Machine)
- Draws route polyline on map in purple (#667eea)
- Shows road distance and estimated drive time in popup
- "Clear Route" button to remove route from map
- Zooms to fit entire route with padding
- Debug bar shows route distance and time

## Build 426 (2026-01-07)

### Phase 2 Refactoring: RouteAnimator class
- Converted route animation from procedural to OOP class
- Private fields: #map, #enabled, #speedMultiplier, #currentAnimationId, #sequence, #vehicleMarker
- Public methods: togglePopup(), toggleEnabled(), updateSpeed(), loadSettings(), animate(), removeVehicle()
- Getters: enabled, speedMultiplier, sequence, newSequence()
- Bridge functions maintain HTML onclick and legacy code compatibility
- Kept utility functions global: getVehicleColor(), calculateBearing(), adjustColor(), getFallbackVehicleSvg()
- Global count: 79 → 75 (removed 5 animation globals, added 1 class instance)

## Build 425 (2026-01-07)

### Phase 2 Refactoring: LocationSearch class
- Converted location search from procedural to OOP class
- Private fields: #map, #userLocation, #userLocationName, #searchTimeout, #searchMarker, etc.
- Public methods: toggle(), handleKeydown(), search(), selectResult()
- Removed window._searchMarker global (now encapsulated)
- Kept calculateDistance() and formatSearchDistance() as shared utilities
- Bridge functions maintain HTML onclick compatibility
- Global count: 80 → 79

## Build 424 (2026-01-07)

### Simplified marker hover
- Pointer cursor when hovering over markers while measuring
- Removed Alt key cursor change (too confusing)
- Alt-click still works to undo last point

## Build 423 (2026-01-07)

### Marker hover cursor feedback
- Cursor changes to pointer when hovering over a marker while measuring
- Cursor changes to 🚫 (not-allowed) when hovering over a marker AND Alt is held
- Indicates "Alt-click here to delete last point"
- Cursor returns to crosshair when leaving the marker

## Build 422 (2026-01-07)

### Measurement tool improvements
- Removed context menu feature (browser conflicts)
- Added cursor feedback: cursor changes to "not-allowed" when Alt key is held
- Indicates undo mode - Alt-click on marker to remove last point
- Removed ~90 lines of context menu code

## Build 421 (2026-01-07)

### Fixed context menu not appearing
- Fixed private method binding (use arrow function wrappers)
- Added browser contextmenu event prevention on map container
- Context menu should now appear on right-click while measuring

## Build 420 (2026-01-07)

### Measurement tool context menu
- Right-click while measuring to show context menu
- Menu options:
  - **Undo Last Point** (↩) - removes the last placed point
  - **Finish Measurement** (✓) - completes the measurement (same as double-click)
  - **Cancel** (✕) - clears all points and exits measurement mode
- Menu auto-positions to stay within viewport
- Closes on click outside
- New methods: `finish()`, `cancel()`
- Refactored `handleDoubleClick()` to use `finish()` internally

## Build 419 (2026-01-07)

### Measurement tool rubber band line
- Live "rubber band" line from last point to cursor while measuring
- Provides visual feedback showing where next segment will be placed
- Lighter dashed style (2px, opacity 0.6) to distinguish from placed segments
- Updates on mouse move, removed when point is placed

## Build 418 (2026-01-07)

### Measurement tool undo
- Option/Alt-click on any marker to remove the last point (undo)
- New `undoLastPoint()` method in MeasurementTool class
- Works while actively measuring
- Distance recalculates after undo
- Deactivates tool if all points removed

## Build 417 (2026-01-07)

### Refactoring Phase 1: MeasurementTool Class
- Converted measurement tool from procedural code to OOP class
- New `MeasurementTool` class with private fields (#active, #points, #markers, #lines, #popup)
- Public methods: `toggle()`, `handleClick(e)`, `handleDoubleClick(e)`, `zoomToFit()`, `clear()`
- Public getters: `isActive`, `hasPoints`
- Static method: `isMeasurePopup(popup)` for popup type checking
- Reduced 5 global variables to 1 class instance
- Instance exposed as `window.measurementTool` for debugging

### Code changes
- Removed globals: `measureActive`, `measurePoints`, `measureMarkers`, `measureLines`, `measureDistancePopup`
- Removed functions: `handleMeasureClick()`, `handleMeasureDoubleClick()`, `updateMeasureDistance()`, `clearMeasurement()`, `showMeasureInstruction()`
- Bridge function `toggleMeasureTool()` maintained for HTML onclick compatibility

## Build 416 (2026-01-07)

### Added Credits/Acknowledgements
- New "Credits" link in footer
- Modal showing all external libraries and services used:
  - Leaflet, Leaflet.markercluster, Marked, Chart.js, Pako
  - CARTO, CyclOSM, Esri map tiles
  - OpenStreetMap data, Nominatim geocoding
  - Arc Timeline by Big Paua
- Added ACKNOWLEDGEMENTS.md file with full details

## Build 415 (2026-01-07)

### Click measurement to zoom to fit
- Clicking on measurement line or markers now zooms map to show entire measurement
- Uses NavigationController.mapPadding for proper diary panel offset
- Smooth 0.5s animation
- maxZoom: 16 to prevent over-zooming on short distances

## Build 414 (2026-01-07)

### Remove zoom from measurement popup
- Measurement popup now only shows distance (no "Zoom: X.X")

## Build 413 (2026-01-07)

### Cleaner measurement display
- Intermediate markers removed when measurement completes (double-click)
- Only start (green) and end (red) markers remain with the dotted line
- Lines and markers still clickable to restore popup after ESC

## Build 412 (2026-01-07)

### Improved measurement tool
- Single click on 📏 clears existing measurement
- Click on measurement line or markers to restore popup after ESC
- Hover effect on lines/markers when measurement is complete (indicates clickable)
- Slightly thicker lines for better visibility

## Build 410 (2026-01-07)

### Measurement tool
- New 📏 button in toolbar to measure distances on map
- Click to add points, lines drawn between them
- Running total distance shown in popup
- Double-click or click 📏 again to finish measuring
- Orange markers and dashed lines for visibility
- Click 📏 to clear and start new measurement

## Build 408 (2026-01-07)

### Active state for toolbar toggles
- Search, Transparency, Animation buttons now have prominent active state when popup is open
- Blue tint + glow for Search/Transparency when active
- Green tint + glow for Animation when enabled (and stronger when popup open)
- Colored text to match the active state

## Build 407 (2026-01-07)

### Show location name instead of coordinates
- Uses reverse geocoding to show suburb/city name (e.g., "Mt Gravatt, Brisbane")
- Caches location name to avoid repeated API calls
- Falls back to coordinates if reverse geocode fails

## Build 406 (2026-01-07)

### Fixed distance format
- Renamed formatSearchDistance to avoid conflict with existing formatDistance
- Now correctly shows km (e.g., "158 km" instead of "158 m")
- Fixed horizontal scrollbar with overflow-x: hidden

## Build 404 (2026-01-07)

### Fixed distance display
- Always show km (e.g., "0.31 km" instead of "305 m")
- Wider popup (360px) and fixed layout to prevent cropping
- Distance column has min-width and won't shrink
- Removed status indicator (cleaner UI)

## Build 403 (2026-01-07)

### Distance shown in map marker popup
- Map marker popup now shows "X km away" when clicking a search result
- Search popup widened to 340px to accommodate distance display
- Status indicator shows when location is available

## Build 401 (2026-01-04)

### Distance from current location in search results
- Search results now show distance from your current location
- Uses browser Geolocation API (permission requested on first search)
- Distance shown in meters (< 1km) or kilometers
- Location cached for 5 minutes to avoid repeated permission prompts
- Gracefully handles denied permission (just hides distance)

## Build 400 (2026-01-04) 🎉

### Location search in toolbar
- Search button (🔍) added to toolbar, left of map style selector
- Toggle popup like transparency/animation popups (click to open/close, click outside to close)
- Uses Nominatim (OpenStreetMap) API directly
- Auto-search after typing 3+ characters (500ms debounce)
- Results show as clickable list with location name and detail
- Selecting a result zooms map and shows temporary marker (30s)
- Australian results prioritized
- Escape key closes popup
- No external library dependencies

## Build 395 (2026-01-04)

### Hide missing days in "Notes Only" mode
- Missing day placeholders are hidden when "Notes Only" is checked
- "X days missing" note in month header also hidden in Notes Only mode
- Days with data but no notes are simply skipped (not shown as missing)
- Missing days only shown when viewing all locations

## Build 394 (2026-01-04)

### Fixed: Clicking entry highlights wrong entry
- Root cause: Multiple entries at same location (e.g., visited twice in one day)
- Coordinate matching found the FIRST entry with those coordinates, not the clicked one
- Fix: Now uses entry's timestamp (`data-date`) for unique matching when clicking from diary
- Fallback to coordinate matching for map clicks (which don't have date context)

## Build 393 (2026-01-04)

### Debug build for entry selection investigation
- Added temporary debug logging (removed in 394)

## Build 392 (2026-01-04)

### Missing days count in month heading
- Month heading now shows "X days missing" note when there are gaps
- Small, subtle styling (50% font size, gray color)
- Only counts truly missing days (no data at all), not filtered-out days
- Example: "January 2025 3 days missing"

## Build 391 (2026-01-04)

### Sanity checks for missing day placeholders
- Future days (after today) are never shown as "missing"
- Days before the first day with data are never shown as "missing"
- Missing placeholders only appear BETWEEN days that have data
- Days with data are always shown, even if somehow in the future
- Uses Set to avoid duplicates when combining data days with placeholder range

## Build 390 (2026-01-04)

### Missing days shown as disabled placeholders
- Days without data (or filtered out) now appear as gray italicized placeholder headings
- Placeholders span from first day with data to last day with data in each month
- Navigation skips over placeholder days (they don't have `.day-map-title` class)
- Visual feedback that days are missing without breaking diary flow
- Styled with light gray text (#ccc light / #555 dark mode), italic, non-clickable

## Build 389 (2026-01-04)

### Adaptive animation speed for large zoom changes
- Large zoom transitions (> 3 zoom levels) now animate 50% slower
- `debugFitBounds`: duration = 0.25s + 0.1s per zoom level (max 1.5s)
- `panToWithOffset`: duration = 0.4s + 0.15s per zoom level (max 1.5s)
- Small zoom changes keep default fast animation
- Prevents jarring jumps when switching between day detail and month overview

## Build 388 (2026-01-04)

### Fixed: Visual flash of large polylines when switching views
- Root cause: Old polylines visible at wrong zoom level during view transition
- Fix 1: `clearMapLayers()` now called FIRST in both `showMonthMap()` and `showDayMap()`
- Fix 2: `updateViewportMargins()` now uses `refitMapBounds()` instead of full redraw
  - Margin changes (diary toggle, stats panel, slider) no longer trigger clear/redraw cycle
  - Just repositions existing content, avoiding flash

Order of operations now:
1. Clear old layers (immediate)
2. Set mode/title/controls
3. invalidateSize()
4. Draw new layers
5. Fit bounds

## Build 387 (2026-01-04)

### Tighter margins + proper centering for locations
- Reduced fitBounds buffer from 50px to 20px (less liberal margins)
- Fixed `panToWithOffset` centering calculation:
  - OLD: `offset = leftObstruction / 2` (shifted too far right)
  - NEW: `offset = (leftObstruction - rightObstruction) / 2` (true center of visible area)
- Stats panel now updates NavigationController with its width when shown/hidden
- Locations should now center properly in the visible map area between diary and stats panels

## Build 386 (2026-01-04)

### Fixed: Day view bounds now include polyline extent, not just marker locations
- **Root cause**: `showDayMap` was calculating bounds only from marker locations, ignoring polyline points
- **Fix**: Now combines both marker locations AND all route points for comprehensive bounds
- Added fallback case for days with routes but no markers (route-only bounds)
- `refitMapBounds` already handled this correctly; only `showDayMap` was affected

This fixes the issue where activity routes extended beyond the visible map area.

## Build 385 (2026-01-04)

### Debug overlays persist until next command
- Debug rectangles/markers now stay visible until the next map operation (no auto-remove)
- Press F13 again to turn off debug mode and clear all overlays
- Added `window.clearDebugOverlays()` helper to manually clear if needed

## Build 384 (2026-01-04)

### Visual debug mode with F13 toggle
- Press **F13** to toggle debug mode on/off (console shows "🐛 Debug mode: ON/OFF")
- When debug mode is ON:
  - **Red dashed rectangle** shows content bounds for `fitBounds()` operations (polylines, activities, day/month overviews)
  - **Green circle** shows target point for `panTo()` operations (single location visits)
  - Labels show the caller name (e.g., "showDayMap", "highlightAndShowRouteByTime")
  - Debug overlays auto-remove after 5 seconds
- Console logging also enabled when debug mode is ON

This helps visualize what geographic bounds are being calculated for fitting, separate from the viewport padding.

## Build 383 (2026-01-04)

### Simplified debug logging - removed visual overlays
- Removed DEBUG_BOUNDS visual overlay code
- Kept essential bounds logging in `debugFitBounds()`: shows content SW/NE/center and padding values
- Simplified `updateViewportMargins()` logging to single line
- Simplified `#panToWithOffset()` logging to single line

Debug output (when `__ARC_DEBUG_LOGS__=true`):
```
📍 fitBounds [showDayMap]: content bounds SW=(-27.5,153.0) NE=(-27.4,153.1) center=(-27.45,153.05)
📍 fitBounds [showDayMap]: padding L=380 T=125 R=50 B=30
📍 panTo: target=(-27.45,153.05), offset=(190px,47px)
🗺️ updateMargins: L=330 slider=280 R=0 T=95
```

## Build 382 (2026-01-04)

### Fixed activity entries not showing debug overlay
- `highlightAndShowRouteByTime()` was calling `map.fitBounds()` directly with inline padding calculation (ignoring slider!)
- Now uses `getMapPadding()` and `debugFitBounds()` for consistent margin handling
- Updated `refitMapBounds()` to use `debugFitBounds()` for all 4 code paths
- Updated `drawDayRoutes()` to use `debugFitBounds()` for route fitting
- All interactive map operations now use centralized padding from NavigationController

**Root cause:** Activity entry clicks used `highlightAndShowRouteByTime()` which calculated its own padding inline, completely bypassing the NavigationController margin system.

## Build 381 (2026-01-04)

### Debug boundary overlay now shows for diary entry clicks
- Added boundary rectangle overlay to `NC.#panToWithOffset()` (used when clicking diary entries)
- Shows red dashed rectangle for effective visible area + yellow circle at target point
- Both `panToLocation` and `fitBounds` now show debug overlays when `DEBUG_BOUNDS = true`

## Build 380 (2026-01-04)

### Debug logging for viewport margins and fitBounds
- Added detailed logging to `NavigationController.mapPadding` getter
- Added detailed logging to `NavigationController.updateViewportMargins()`
- Added `debugFitBounds()` wrapper function that logs bounds, padding, map size, and effective visible area
- Added visual debug overlay (red dashed rectangle) showing effective visible area
  - Enable with: `window.DEBUG_BOUNDS = true` in console
  - Auto-removes after 3 seconds
- Updated `showDayMap()` and `showMonthMap()` to use `debugFitBounds()`
- Added logging to `updateMapPaddingForSlider()`

To debug: 
1. Open browser console
2. Run: `window.__ARC_DEBUG_LOGS__ = true` (enables all debug logs)
3. Run: `window.DEBUG_BOUNDS = true` (shows red rectangle overlay)
4. Trigger a map operation (search, navigate, etc.)

## Build 379 (2026-01-04)

### NavigationController owns viewport margins (STATE_MODEL compliance)
- Added `#margins` private state to NavigationController (left, sliderLeft, right, top, bottom)
- Added `mapPadding` getter for fitBounds operations
- Added `updateViewportMargins(margins, options)` method to update margins and trigger map refit
- Added `panToLocation(lat, lng, zoom, animate)` method for offset-aware panning
- `getMapPadding()` now delegates to `NavigationController.mapPadding`
- `panToWithDiaryOffset()` now delegates to `NavigationController.panToLocation()`
- `updateMapPaddingForSlider()` now calls `NavigationController.updateViewportMargins()`
- `toggleDiary()` updates margins when diary shown/hidden
- Window resize handler updates margins
- Diary drag-resize updates margins on mouseup
- Margins initialized when diary reader opens

## Build 378 (2026-01-04)

### Map bounds account for search slider
- `getMapPadding()` now includes slider width (280px) in `paddingTopLeft`
- `updateMapPaddingForSlider()` now refits day/month view if no highlighted entry
- Routes and markers now fit within visible area when slider is open

## Build 377 (2026-01-04)

### Map rebuild on slider open/close
- `updateMapPaddingForSlider()` now calls `map.invalidateSize()` and recenters
- Called when slider opens (both cached and new search paths)
- Called when slider closes
- Consolidated recenter logic into single function

## Build 376 (2026-01-04)

### Map offset accounts for search slider
- `panToWithDiaryOffset()` now includes slider width when calculating visible area
- Map recenters when slider closes (after 350ms animation delay)

### Stats panel title fix
- Now uses `NavigationController.dayKey` instead of legacy `currentDayIndex`
- Day names now display correctly for all selected entries

## Build 375 (2026-01-04)

### Phase 4: Legacy navigation code removal
- Removed `navigateLocation()` - replaced by `NavigationController.navigateBy()`
- Removed `highlightAndScrollToLocation()` - replaced by `NavigationController.#selectDomEntry()`
- Removed `highlightDiaryEntry()` - replaced by `NavigationController.selectEntryFromMap()`
- Removed `highlightDiaryEntryById()` - replaced by `NavigationController.selectEntryFromMap()`
- ~131 lines of dead code removed

## Builds 365-374 (2026-01-03 to 2026-01-04)

### Search system implementation
- Database-wide search with progressive results
- Search results slider panel
- Keyboard navigation in search results (up/down arrows, Escape to close)
- Result caching to prevent redundant searches
- Focus-linked transparency (slider follows diary opacity)
- Activity navigation via startTime matching

## Build 332 (2026-01-02)

### Debug logging removed
- Cleaned up temporary console.log statements used for troubleshooting

## Build 331 (2026-01-02)

### Fixed day transition bug in arrow key navigation
- When navigating to a new day with arrow keys, the map now correctly rebuilds
- Root cause: `currentDayKey` was updated before map functions ran, causing them to think the map was already showing the new day
- Fix: Update `currentDayKey` AFTER map function calls in `selectDay()` and `#selectDomEntry()`

## Build 329 (2026-01-02)

### Fixed missing activity type attributes on diary entries
- Added `data-type="activity"` to activity entries (was missing, causing all entries to be treated as visits)
- Added `data-activity-type="car"` etc. for activity classification
- Arrow key navigation now correctly calls `showActivityRoutePopup()` for activities instead of `showDayMap()`
- **Note:** Requires diary regeneration for fix to take effect

## Build 327 (2026-01-02)

### Home and End key navigation
- `Home` key: Navigate to first entry of current month
- `End` key: Navigate to last entry of current month
- Added `goToFirst()` and `goToLast()` methods to NavigationController

## Build 326 (2026-01-02)

### Fixed class vs instance naming bug
- Renamed class to `NavigationControllerClass`
- Instance is now `NavigationController` (matching all existing callers)
- Arrow key navigation now works correctly

## Build 325 (2026-01-02)

### NavigationController Refactored to ES6 Class

Complete OOP refactor with proper encapsulation:

**Private state (cannot be accessed externally):**
- `#monthKey`, `#dayKey`, `#entryId`, `#entryIndex`
- `#atDayLevel`, `#renderVersion`, `#internalCall`

**Public getters (read-only access):**
- `monthKey`, `dayKey`, `entryId`, `entryIndex`, `atDayLevel`
- Legacy aliases: `selectedMonthKey`, `selectedDayKey`, etc.

**Public actions (the ONLY way to change state):**
- `reset()` — Clear selection, return to "no selection" state
- `selectMonth(monthKey)` — Load and display month
- `selectDay(dayKey)` — Select day
- `selectEntry(entryId, dayKey, options)` — Select entry
- `navigateBy(delta, level)` — Keyboard navigation
- `navigateMonth(delta)` — Month navigation
- `selectEntryFromMap(lat, lng, dayKey)` — Map click sync
- `selectEntryFromMapById(placeId)` — Map click by ID

**Private methods (prefixed with #):**
- `#navigateByDay()`, `#navigateByEntry()`
- `#goToPreviousMonthLastEntry()`, `#goToNextMonthFirstEntry()`
- `#selectDomEntry()`, `#findEntryIndex()`

External code can no longer bypass the controller by directly setting properties.

## Build 320 (2026-01-01)

### NavigationController Now Owns All Navigation

All navigation now goes through NavigationController - no more bypassing:

**New methods added:**
- `navigateMonth(delta)` - Navigate to prev/next month, clears day/entry state
- `selectEntryFromMap(lat, lng, dayKey)` - Sync diary from map marker click
- `selectEntryFromMapById(placeId)` - Sync diary from map by placeId

**Migrated to NavigationController:**
- Month prev/next buttons → `NavigationController.navigateMonth()`
- Shift+Arrow keys → `NavigationController.navigateMonth()`
- Map marker clicks → `NavigationController.selectEntryFromMap()`

**Navigation architecture now complete:**
- ✅ Up/Down arrows (entry nav)
- ✅ Left/Right arrows (day nav)
- ✅ Shift+Left/Right (month nav)
- ✅ Prev/Next day buttons
- ✅ Prev/Next month buttons
- ✅ Day title clicks
- ✅ Entry clicks
- ✅ Map marker clicks

## Build 316 (2026-01-01)

### Fixed Cross-Month Entry Navigation

**Bug:** When pressing up-arrow at first entry of a month, it would jump to the previous month but start at entry 0 instead of the last entry. This caused repeated up-arrows to skip through months rapidly.

**Root cause:** `selectMonth()` incremented `_renderVersion`, so after it returned, the version check `if (this._renderVersion !== version)` was always true, causing early return before setting `currentLocationIndex = lastIdx`.

**Fix:** Use `_internalCall = true` before calling `selectMonth()` to prevent version increment. Applied to both `_navigateByEntry` and `_navigateByDay`.

### Fixed Day/Entry Navigation Coordination

**Bug:** After using left-arrow (day navigation) to go to a different day, the entry highlight remained on the old entry, and up/down arrows would continue from the old position.

**Fix:** `selectDay()` now:
- Clears entry highlights when switching days
- Updates `currentLocationIndex` to point to first entry of the new day
- Syncs `selectedEntryIndex` for consistency

Now left/right (day nav) and up/down (entry nav) are properly coordinated.

## Build 306 (2026-01-01)

### Phase 2: NavigationController with Authoritative State

**Keyboard navigation now uses data model, not DOM.**

**NavigationController changes:**
- Added authoritative selection state: `selectedMonthKey`, `selectedDayKey`, `selectedEntryId`, `selectedEntryIndex`
- Implemented `navigateBy(delta, level)` using data model
- `_navigateByDay()` - navigate days with month boundary crossing
- `_navigateByEntry()` - navigate entries continuously through days/months
- `_selectEntryByIndex()` - select and render from data model
- `_findEntryInModel()` - find entry in data model by ID
- `_getActiveFilters()` - get current UI filter state

**Keyboard handler updated:**
- ArrowUp/Down now call `NavigationController.navigateBy(±1, 'entry')`
- ArrowLeft/Right now call `NavigationController.navigateBy(±1, 'day')`
- Navigation respects active filters (Notes Only, activity types)

**Benefits:**
- Entry navigation continues through entire diary (crosses day/month boundaries)
- No more DOM index desync after re-renders
- Filter-aware navigation (skips filtered entries)

## Build 305 (2026-01-01)

### Month Selector Shows Only Months with Data

Removed empty months from selector entirely (previously showed as disabled).



## Build 303 (2026-01-01)

### Phase 1: Normalized Data Model

Added relational data model for entries and notes, coexisting with legacy structure.

**New functions:**
- `extractEntriesAndNotesFromData(data, dayKey)` — Extracts normalized entries and notes
- `extractItemNotes(item, entryId, dayKey)` — Extracts notes for one timeline item
- `getDaysFromModel(monthKey)` — Get sorted dayKeys from data model (not DOM)
- `getEntriesFromModel(monthKey, filters)` — Get filtered entries with optional filters (notesOnly, activityTypes, dayKey)
- `getNotesFromModel(monthKey, entryId?)` — Get notes, optionally filtered by entry

**New data structure:**
```javascript
monthData.days[dayKey] = {
    // Legacy (unchanged)
    notes, locations, tracks,
    // New normalized
    entries: [...],    // Entry objects
    itemNotes: [...]   // Note objects with FK → entryId
};
```

**Updated STATE_MODEL.md** with data model documentation.

This is Phase 1 of the navigation refactor. Next phases will migrate keyboard navigation to use the data model instead of DOM queries.



## Build 302 (2026-01-01)

### Fixed Up/Down Navigation After Date Search

- **Root cause:** After using date search to navigate to a specific day (e.g., Dec 31), `currentLocationIndex` was reset to 0 by `displayDiary`. This meant pressing up/down would start from the first entry in the month (Dec 1), not from the target day.
- **Fix:** `navigateToDate` now sets `currentLocationIndex` to the first entry of the target day after navigation, so up/down navigation starts from the correct position.



## Build 301 (2026-01-01)

### Fixed Map Marker Click Highlighting Wrong Day

- **Related to Build 300:** The map marker click handler also had the same bug - `highlightDiaryEntry()` matched by lat/lng only, ignoring the current day.
- **Fix:** Added `dayKey` parameter to `highlightDiaryEntry()` and pass it from the marker click handler.



## Build 300 (2026-01-01)

### Fixed Multi-Day Visit Click Highlighting Wrong Day

- **Root cause:** `_findEntryIndex()` matched entries by lat/lng only, ignoring the dayKey. For multi-day visits at the same location (e.g., home), clicking Dec 31st would match the first occurrence (Dec 3rd) instead.
- **Fix:** Added `dayKey` parameter to `_findEntryIndex()` and filter entries to match the target day before matching coordinates.



## Build 299 (2026-01-01)

### Fixed Day Title Not Clickable (Multi-Day Visit)

- **Root cause:** The markdown generation was checking `dayData.pins` to determine if a day title should be clickable, but the DB path stores location pins in `dayData.locations`. This caused day titles to render without the clickable `day-map-title` span.
- **Fix:** Changed check to `(dayData.locations || dayData.pins || []).length > 0` to work for both DB path (uses `locations`) and folder import path (uses `pins`).



## Build 298 (2026-01-01)

### Fixed Last Day Title Not Clickable

- **Added padding-bottom to markdown-body** — Added 50px padding at bottom to ensure last elements are fully accessible when scrolled to bottom.
- **Explicit click styles for day titles** — Added `pointer-events: auto` and `display: inline-block` to `.day-map-title` and `.month-map-title` to ensure clicks are captured.



## Build 297 (2026-01-01)

### Fixed Month Selector Showing Dashes on All Months

- **Duplicate function bug** — There were two `populateMonthSelector()` functions in the same scope. The second (no-param legacy version at line 7907) was overriding the first (takes `year` param). When the DB flow called `populateMonthSelector(currentYear)`, the year was ignored.
- **Fix:** Renamed legacy function to `populateSelectorsLegacy()` to avoid shadowing.
- **Added defensive fallback** — If `year` is undefined, defaults to most recent year from `monthKeys`.



## Build 296 (2026-01-01)

### Multi-Day Visit Note Handling

- **Notes now appear on their creation date** — For multi-day visits that span several day files (e.g., 30/12 → 01/01), notes are now filtered to only appear on the day matching `note.date`. Previously, notes could appear on the wrong day (e.g., showing on 01/01 instead of 31/12).
- Added `dayKey` parameter to `extractNotesFromData()` to enable per-day filtering.



## Build 295 (2026-01-01)

### Map Close Button Fix (Take 2)

- **Forced circular dimensions** — Applied same constraint technique that works on `.analysis-close`:
  - `box-sizing: border-box`
  - `width/height: 32px !important`
  - `min-width/max-width: 32px`
  - `min-height/max-height: 32px`
  - `flex: 0 0 32px`
  - `align-self: center` (prevents vertical stretching by flex parent)



## Build 294 (2026-01-01)

### UI Fixes

- **Map titlebar close button** — Changed from rounded rectangle (10px radius, 40×40) to circular (50% radius, 32×32) to match the Stats panel close button.
- **Analysis button** — Replaced 📊 histogram emoji with "Database" text label. The emoji was causing inconsistent titlebar height and reducing the gap to the stats panel.



## Build 293 (2026-01-01)

### Fixed Import Not Running Twice

- **Reset file input after import** — The browser's file input doesn't fire a `change` event if you select the same folder again. Now `fileInput.value` and `selectedFiles` are cleared after import completes.
- **Reset state in Import JSON button** — Clicking "Import JSON" now also clears file input, `selectedFiles` array, and file count display.



## Build 292 (2026-01-01)

### Fixed Favourite Star Spacing

- **Proper text node insertion** — Space before ⭐ is now inserted as a DOM text node using `.after(space, star)`, fixing the missing gap.



## Build 291 (2026-01-01)

### Fixed Label Spacing

- **Added actual space characters** before NO GPS tag and ⭐ favourite indicator in HTML output. CSS margin alone was insufficient.



## Build 290 (2026-01-01)

### Label Styling Polish

- **Favourite indicator** — Now displays as plain ⭐ without any surrounding tag/box styling.
- **Consistent spacing** — Both NO GPS tag and ⭐ favourite indicator have consistent margin from preceding text.



## Build 289 (2026-01-01)

### Diary Label Refinements

- **"No GPS" label styling** — Changed from red warning style to neutral black text on white background.
- **Increased label spacing** — Added gap between diary text and label (e.g., "8:39 AM Car • 6m [NO GPS]").
- **Favourite label simplified** — Now shows just ⭐ instead of "⭐ FAVOURITE".
- **Fixed favourite label on activities** — Favourite tags now only appear on visits (locations), not on walking/cycling/car activities that happen to start from a favourited location.



## Build 288 (2026-01-01)

### Diary Entry Labels

- **"No GPS" label** — Activities without GPS coordinates now display a red "NO GPS" tag, indicating they won't appear on the map.
- **"Favourite" label** — Diary entries for favourited locations now display a gold "⭐ FAVOURITE" tag. Tags update instantly when favourites are added/removed.



## Build 287 (2026-01-01)

### Bug Fixes

- **Fixed infinite recursion in logging** — `logWarn()`, `logError()`, and `logDebug()` were calling themselves instead of `console.warn/error/debug`. Any warning or error would crash the app.
- **Fixed `deleteDay()` database error** — Referenced non-existent store `'meta'` instead of `'metadata'`. Debug command `await AppDB.deleteDay('2024-01-01')` now works.
- **Fixed Analysis preset crashes** — Internal helper functions (`_aggregateActivities`, `_findLastActivity`, `_getWeeklyWalking`) referenced undefined `query.kind` variable, causing ReferenceError when running presets like "Walking this week".



## Build 286 (2026-01-01)

- Added ad-hoc **Visit count** query (e.g., "Bunnings" in a date range) and support for saving as a preset.
- Restored/strengthened **activity type inference** (walking vs car) using speed-based sanity checks.
- Restored **custom place naming** by loading place-name mappings from Arc export `places/*.json` (if present).
- UI polish: analysis close button is now circular.



## Build 283 (2026-01-01)

### Housekeeping: essential logging only

- Removed verbose debug logging (per-record dumps, loop spam).
- Added centralised logging helpers: `logInfo`, `logWarn`, `logError`, `logDebug`.
- `logDebug` is disabled by default; enable via `window.__ARC_DEBUG_LOGS__ = true;` then reload.

## Build 282 (2026-01-01)

### Date Search: Require 4-digit years

- Updated `parseDateQuery()` to only accept full 4-digit years (e.g., `2025`, not `25`).
- Prevents premature navigation while typing years like `2014` (no longer interprets `20` as `2020`).

## Build 281 (2025-12-31)

### Debug Logging for Missing Map Routes

Added debug logging to diagnose why some walking activities don't appear on the map:

- `extractTracksFromData`: Logs each track extracted with point count and startDate
- `extractTracksFromData`: Logs if walking tracks are skipped due to insufficient samples
- `drawColorCodedRoute`: Logs if walking segments are not drawn due to only having 1 point
- `drawColorCodedRoute`: Logs when visits cause segment splits

**New debug functions:**
- `await AppDB.deleteDay('2014-07-12')` - deletes a single day from IndexedDB for re-import
- `await AppDB.debugDay('2014-07-12')` - dumps all timeline items (visits AND activities with sample counts)
- `await AppDB.debugRoutes('2014-07-12')` - shows route points grouped by activity type

---

## Build 280 (2025-12-31)

### Fixed: streetAddress Fallback for Location Names

When a visit has no `place.name`, now falls back to `streetAddress` before using generic "Location A/B/C" names.

**Priority order:**
1. `customTitle` (user-set title)
2. `place.name` (venue name from Foursquare/etc)
3. `streetAddress` (street address from Arc) ← NEW
4. `activityType` (for non-visits)
5. Cluster name ("Location A/B/C" only if nothing else available)

**Debug logging** (temporary):
- `buildLocationClusters`: Logs all visits and their place.name values
- `getSmartLocationName`: Logs which priority path is used

**New debug function:** `await AppDB.debugDay('2014-07-12')` - dumps raw IndexedDB record.

---

## Build 279 (2025-12-31)

### Force Full Rescan Option

**Bug fix:** Files copied with today's date/time could be missed if the scan ran and updated lastScanTime before detecting them.

**Changes:**
- Added "Force full rescan" checkbox to import section
- When checked, ignores lastScanTime and processes all files
- Checkbox auto-resets after import completes
- If force scan finds nothing to import, lastScanTime is NOT updated (preserves ability to retry)

---

## Build 278 (2025-12-31)

### Ad-hoc Query Builder

Added tabbed interface with Presets tab and new Ad-hoc Query tab.

**Filters (all ANDed):**
- Activity type: any, walking, cycling, running, vehicle
- Date range: 7/30/90 days, YTD, or custom
- Minimum distance (km)
- Minimum duration (minutes)
- Day type: any, weekday, weekend

**Metrics (select at least one):**
- Total distance
- Total duration
- Activity count
- Days active
- Average distance per day

**Execution:**
- Explicit Run Query button (no auto-run on change)
- Cancel button for long queries
- Live execution stats: days/activities scanned, matched, time

**Jump Actions:**
- Jump to first matching day
- Jump to last matching day
- Jump to max distance day

**Architecture per spec:**
- Read-only (no state mutation)
- Activity summaries only (no GPS point scans)
- Chunk processing with UI yield
- Abort support

---

## Build 277 (2025-12-31)

### Complete Analysis Rewrite - Fast Presets Only

**Philosophy:** Activity-level summaries only. No GPS point scans. All queries time-bounded.

**New Presets:**

1. **Walking this week** - Current Mon-Sun
2. **Walking last week** - Previous Mon-Sun
3. **Walking this year (YTD)** - Jan 1 to today, with avg per active day
4. **Last bicycle ride** - Most recent cycling, with days ago + deep link
5. **Last long walk (≥5 km)** - Most recent walk over 5km
6. **Weekly walking (12 months)** - Bar chart + stats for last 52 weeks
7. **Monthly: this year vs last** - Side-by-side bar chart Jan through current month
8. **Last 2 months vs year ago** - Percentage change comparison

**Removed:**
- Japan trip detection (GPS point scanning)
- DB Sanity Check (debugging tool)

**Performance:**
- All queries log execution time to console
- Target: <200ms on cold load
- Bounded time ranges prevent full-DB scans

**Code cleanup:**
- Removed chunked processing (not needed for bounded queries)
- Removed geographic detection functions
- Simplified aggregation logic
- Added multi-dataset chart support for year comparisons

---

## Build 276 (2025-12-31)

### Japan Trip Browser Freeze Fix

**Problem:** Japan trip query scanning 3098 days × thousands of GPS samples blocked the browser main thread.

**Fixes:**
- Process days in chunks of 50 with `setTimeout(0)` between chunks to yield to browser
- Sample GPS points every 50th instead of every 20th (faster detection)
- Only calculate walking distance for days that ARE in Japan (skip for non-Japan days)
- Removed per-match console.log spam (was logging every Japan coordinate found)

---

## Build 275 (2025-12-31)

### Japan Trip Detection Fix

**Problem:** Japan trip query returned null despite walking queries working.

**Fixes:**
- Expanded search range from 3 years to ALL data (2010-01-01 onward)
- Added debug logging:
  - Search range being queried
  - Number of records retrieved
  - Coordinates checked count
  - Sample coordinate for debugging (first coord found)
  - Each Japan coord match found
- Will log `Sample coord: lat, lng from dayKey` to show what coordinates exist

---

## Build 274 (2025-12-31)

### Critical Fix: Data Structure Mismatch

**Problem:** Analysis queries returned zero for all metrics despite 3098 days in database.

**Root Cause:** Analysis code was reading `record.data.notes` which doesn't exist in IndexedDB. The DB stores `record.data.timelineItems` (raw GPS data). The `notes` array is computed on-the-fly by `extractNotesFromData()` only when displaying a month.

**Fixes:**
- `_aggregateDays()` - Now reads `timelineItems`, calculates distance via `calculatePathDistance(samples)`
- `_findLastActivity()` - Same fix
- `_findJapanTrip()` - Same fix
- `sanityCheck()` - Now reports `timelineItems` structure instead of `notes`
- Exposed `calculatePathDistance()` and `calculateHaversineDistance()` on window

**Data Structure (actual):**
```javascript
record.data.timelineItems[n] = {
  isVisit: boolean,
  activityType: "walking" | "cycling" | "automotive" | ...,
  startDate: ISO string,
  endDate: ISO string,
  samples: [{ location: { latitude, longitude } }, ...],
  center: { latitude, longitude }  // for visits
}
```

---

## Build 273 (2025-12-31)

### Debug Logging
- Added explicit instrumentation output showing exact values
- Added first record structure dump to identify data shape issues
- Discovered `record.data.notes is missing!` - led to Build 274 fix

---

## Build 272 (2025-12-31)

### Missing Globals Fix
- Exposed `formatDistance()` on window
- Exposed `formatDuration()` on window  
- Exposed `NavigationController` on window
- These were trapped inside app.js closure, causing `ReferenceError`

---

## Build 271 (2025-12-31)

### Proper DB Architecture
- Added `dbReadyPromise` - single promise that resolves when DB is ready
- Created `window.AppDB` public API with only 3 methods:
  - `ready` - Promise to await
  - `getDay(dayKey)` - Get single day
  - `getDaysInRange(start, end)` - Get days in range (single transaction)
  - `sanityCheck()` - Diagnostic info
- Added "DB Sanity Check" button to Analysis panel
- Added mandatory instrumentation logging for all queries
- Standardized on `YYYY-MM-DD` dayKey strings (local timezone)
- Analysis reads only from IndexedDB via AppDB API (no DOM state)

---

## Build 270 (2025-12-31)

### Module Extraction
- Extracted 659 lines from app.js → analysis.js
- analysis.js contains: `AnalysisController`, UI functions, Chart.js integration
- app.js reduced to 7,477 lines

---

## Build 269 (2025-12-31)

### Data Structure Bug Fix (partial)
- Changed analysis to read `notes` instead of `timelineItems`
- This was incorrect - see Build 274 for actual fix
- Removed debug logging from Build 268
