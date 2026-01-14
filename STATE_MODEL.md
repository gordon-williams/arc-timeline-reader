# Arc Timeline Diary Reader

## State Model & Invariants (Do Not Break)

### Purpose

This document defines the authoritative state model for the Arc Timeline Diary Reader.
It exists to prevent recurring bugs caused by scattered state ownership, DOM-as-state, and duplicated navigation logic.

If a change violates any rule below, the app will regress — usually as keyboard navigation, map/diary sync, or favourite bugs.

---

## Core Principle

**There is exactly ONE selection state.**
Everything else is a rendered consequence of that state.

- Highlighting is not selection.
- Scrolling is not selection.
- Map focus is not selection.

---

## 1. State Categories

### A) Data State (read-only after load)

Loaded once per month and then treated as immutable.
- `monthKeys`
- `generatedDiaries[monthKey]`
- persisted favourites

Only data-loading code may modify this.

---

### A.1) Normalized Data Model (Build 303+)

The data model has two logical tables:

**entries** — One row per timeline item (visit or activity)
| Field | Type | Description |
|-------|------|-------------|
| entryId | string | PK - stable identifier |
| dayKey | string | YYYY-MM-DD |
| startDate | string | ISO timestamp |
| endDate | string | ISO timestamp |
| duration | number | seconds |
| type | 'visit' \| 'activity' | |
| activityType | string | e.g., 'stationary', 'walking' |
| location | string | display name |
| lat, lng, altitude | number? | coordinates |
| placeId | string? | Arc place ID |
| radiusMeters | number? | visit radius |
| distance | number? | meters (activities) |
| elevationGain | number? | meters (activities) |
| timelineItemId | string | Arc item ID |
| hasNote | boolean | has associated notes |

**itemNotes** — One row per note, FK → entryId
| Field | Type | Description |
|-------|------|-------------|
| noteId | string | PK |
| entryId | string | FK → entries |
| date | string | when note was created |
| body | string | note text |

**Data access functions:**
- `getDaysFromModel(monthKey)` → sorted dayKeys
- `getEntriesFromModel(monthKey, filters)` → filtered entries
- `getNotesFromModel(monthKey, entryId?)` → notes

**Storage structure:**
```javascript
monthData.days[dayKey] = {
    date: dayKey,
    // Legacy (for diary markdown generation)
    notes: [...],      // Flattened note+entry combo (DEPRECATED)
    locations: [...],  // Map pins
    tracks: [...],     // Route polylines
    // Normalized (for navigation/table/export)
    entries: [...],    // Entry objects
    itemNotes: [...]   // Note objects
};
```

---

### B) Navigation & Selection State (single source of truth)

**Owned by NavigationController (Build 306+):**
```javascript
NavigationController.selectedMonthKey   // Current month
NavigationController.selectedDayKey     // Current day
NavigationController.selectedEntryId    // Current entry ("lat,lng" or "activity-{timestamp}")
NavigationController.selectedEntryIndex // Index in flattened entries for month
```

**Legacy globals (kept for backwards compat, sync'd by controller):**
- `currentMonth`, `currentDayKey`, `currentDayIndex`, `currentLocationIndex`

**Derived values (never authoritative):**
- DOM element references
- Highlight state

**If keyboard navigation breaks, check NavigationController state first.**

---

### B.1) Viewport Margin State (Build 379+)

**Owned by NavigationController:**
```javascript
NavigationController.#margins = {
    left: 0,       // Diary panel width (pixels)
    sliderLeft: 0, // Search slider width (pixels)
    right: 0,      // Stats panel width (pixels)
    top: 95,       // Title bar height (pixels)
    bottom: 0
}
```

**Public interface:**
- `NavigationController.mapPadding` — getter for fitBounds padding
- `NavigationController.updateViewportMargins(margins, options)` — update margins and trigger map refit
- `NavigationController.panToLocation(lat, lng, zoom, animate)` — pan with viewport offset

**Who calls updateViewportMargins:**
- Slider open/close → `{ sliderLeft: 280 }` or `{ sliderLeft: 0 }`
- Diary show/hide → `{ left: diaryWidth }` or `{ left: 0 }`
- Diary resize → `{ left: newWidth }`
- Window resize → all margins
- Modal open → initialize all margins

**Do NOT:**
- Read DOM to determine current margins in render functions
- Call map.fitBounds/panTo directly without going through NavigationController
- Store margin state anywhere except NavigationController

---

### C) View State (presentation only)
- `mapMode` (day / month)
- `mapStyle`
- panel visibility (stats, diary)
- print mode flags

Changing view state must never change selection.

---

### D) Map Rendering State (ephemeral)

Leaflet objects:
- map instance
- clusters
- markers
- polylines

These are render artefacts, not application state.

---

## 2. Ownership Rules (Hard Boundaries)

### NavigationController (ES6 Class - ONLY writer of selection)

**Private state (Build 325+, truly encapsulated with #):**
- `#monthKey` — Currently selected month (YYYY-MM)
- `#dayKey` — Currently selected day (YYYY-MM-DD)
- `#entryId` — Currently selected entry identifier
- `#entryIndex` — Index in DOM entries array
- `#atDayLevel` — true when at "day level" (after day nav, before entry nav)
- `#renderVersion` — Async safety counter
- `#internalCall` — Prevents version increment during nested calls

**Public getters (read-only):**
- `monthKey`, `dayKey`, `entryId`, `entryIndex`, `atDayLevel`
- Legacy aliases: `selectedMonthKey`, `selectedDayKey`, `selectedEntryId`, `selectedEntryIndex`

**Public actions (Build 325+):**
- `reset()` — Clear selection state, return to "no selection" mode
- `selectMonth(monthKey)` — Load and display month
- `selectDay(dayKey)` — Select day, set `atDayLevel=true`
- `selectEntry(entryId, dayKey, options)` — Select entry from diary click
- `navigateBy(delta, level)` — Keyboard navigation
  - `level='day'` for ←/→ arrows (first goes to current day level, then adjacent days)
  - `level='entry'` for ↑/↓ arrows (continuous through diary, crosses months)
- `navigateMonth(delta)` — Month navigation for buttons/Shift+Arrow
- `selectEntryFromMap(lat, lng, dayKey)` — Sync diary highlight from map click
- `selectEntryFromMapById(placeId)` — Sync diary highlight by placeId

**Private methods (prefixed with #):**
- `#navigateByDay(delta, version)` — Day nav with month boundaries
- `#navigateByEntry(delta, version)` — Entry nav, continuous through diary
- `#goToPreviousMonthLastEntry(version)` — Cross-month backward
- `#goToNextMonthFirstEntry(version)` — Cross-month forward
- `#selectDomEntry(domEntries, idx, monthKey)` — Render from DOM index
- `#findEntryIndex(entries, entryId, options, dayKey)` — Find entry in DOM

❌ No external code can mutate selection state (private fields enforce this).

---

### DiaryRenderer (read-only)

**Responsible for:**
- rendering diary HTML
- applying highlight based on `selectedEntryId`
- scrolling selected entry into view

❌ Must never set selection variables.

---

### MapRenderer (read-only)

**Responsible for:**
- rendering markers, polylines
- focusing / popup display

**On click:**
- calls `NavigationController.selectEntryFromMap(lat, lng, dayKey)`

❌ Must never mutate selection directly.

---

### StatsRenderer (read-only)

**Responsible for:**
- displaying stats derived from selection

---

## 3. Mandatory Selection Flow

### Selecting an entry (diary click, map click, favourite jump)

Must execute only this sequence:
1. Ensure correct month is active → `selectMonth(...)` if needed
2. Set:
   - `selectedDayKey`
   - `selectedEntryId`
3. Render consequences:
   - diary highlight + scroll
   - map focus
   - stats update

**If arrow keys jump to the top after this, the sequence was violated.**

---

### Keyboard navigation (↑ / ↓ / ← / →) — Build 306+

**Implementation:**
```javascript
// In keydown handler:
case 'ArrowUp':
    NavigationController.navigateBy(-1, 'entry');
case 'ArrowDown':
    NavigationController.navigateBy(1, 'entry');
case 'ArrowLeft':
    NavigationController.navigateBy(-1, 'day');
case 'ArrowRight':
    NavigationController.navigateBy(1, 'day');
```

**NavigationController.navigateBy() flow:**
1. Get entries from data model: `getEntriesFromModel(monthKey, filters)`
2. Find current position using `selectedEntryIndex`
3. Calculate new index (handle day/month boundaries)
4. Call `_selectEntryByIndex()` to update state and render

**Entry navigation is continuous:**
- ↓ at end of day → first entry of next day
- ↓ at end of month → first entry of next month
- Respects active filters

Keyboard code must never:
- touch DOM indices directly
- manipulate highlights without going through controller

---

## 4. DOM Is Not State (Critical)

### Hard rule:

**innerHTML is never a source of truth.**

Replacing diary HTML:
- destroys handlers
- invalidates cached elements
- causes phantom bugs

If diary HTML changes:
- re-render from model
- use event delegation
- never restore old HTML blobs

---

## 5. Async Safety Rule

Any delayed operation (timeouts, map animations):
- must capture a `renderVersion`
- must abort if the version no longer matches

This prevents:
- late map updates
- "clusterGroup is null"
- UI jumping after fast navigation

---

## 6. What Always Causes Regressions

If you see these, stop immediately:
- multiple functions setting month/day
- selection logic inside render functions
- map click highlighting without updating selection
- keyboard code using DOM order
- cached DOM nodes reused after re-render
- fixes involving setTimeout

---

## One-Line Rule for AI or Humans

**All navigation paths must funnel into one selection function; renderers must never mutate selection.**

---

## AI Navigation Guardrail (Do Not Violate)

1. There is one authoritative selection state: month, day, entry — owned by NavigationController.
2. All navigation actions (keyboard, diary, map, favourites) must funnel through it.
3. Navigation actions are atomic, even when crossing months.
4. Internal navigation steps must not invalidate or cancel the parent action.
5. Render/version logic exists only to cancel stale async work, not valid navigation.
6. After any navigation, diary highlight, map focus, and keyboard continuity must all agree.
7. Keyboard ↑/↓ always continues from the last selected entry, never from the DOM.
8. Renderers (map, diary, stats) are read-only and must not set selection state.
9. DOM content is never state; replacing HTML requires reattachment, not restoration.
10. If a change breaks favourites, cross-day clicks, or ↑/↓, revert immediately.

---

## 7. IndexedDB Performance Rules

### NEVER use getAll() on large stores

**Critical:** The `days` store contains full timeline data including GPS samples. Each day can be 50KB-500KB.

```javascript
// ❌ NEVER DO THIS - will load 100MB+ into memory
const allDays = await store.getAll();

// ✅ Use getAllKeys() instead - returns only keys
const allDayKeys = await store.getAllKeys();

// ✅ Or use a cursor for streaming
const cursor = store.openCursor();
```

**Why this matters:**
- 3,000 days × 100KB average = 300MB in memory
- Browser will hang or crash
- This has caused bugs multiple times in both JSON import and backup import

**Safe patterns:**
- `getAllKeys()` - returns just the key strings (~3KB for 3000 days)
- `get(key)` - load one record at a time
- `openCursor()` - stream records without loading all at once
- `index.getAll(indexValue)` - OK if filtered to small subset (e.g., one month)
- `getDayTimestampsFromDB()` - cursor extracts only dayKey + lastUpdated (~50KB for 3000 days)

**Stores affected:**
- `days` - NEVER getAll()
- `locations` - NEVER getAll() 
- `locationVisits` - NEVER getAll()
