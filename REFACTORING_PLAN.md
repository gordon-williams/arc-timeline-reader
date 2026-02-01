# Refactoring Plan - Arc Timeline Diary Reader

## Current State (Build 693)

| Metric | Count |
|--------|-------|
| Lines in app.js | 13,526 |
| Lines in replay.js | 1,566 |
| Lines in map-tools.js | 1,180 |
| Lines in analysis.html | ~5,600 (embedded) |
| Lines in styles.css | ~3,500 |
| Total JS | ~16,300 |

### History
- Build 447: app.js had 9,890 lines
- Build 692: app.js grew to 15,214 lines (+54%, primarily Replay System)
- Build 693: Replay System extracted to replay.js (-1,688 lines from app.js)

## Progress

### Phase 1: MeasurementTool ✅ (Complete)
- Extracted to class in map-tools.js
- ~250 lines moved

### Phase 2: Map Classes (In Progress)
- ✅ MeasurementTool class → map-tools.js
- ✅ LocationSearch class → map-tools.js  
- ✅ RouteAnimator class → map-tools.js (Build 447)
- ⏸️ MapController - deferred (tightly coupled with app state)
- ⏸️ MarkerController - deferred (tightly coupled with app state)

## Proposed File Structure (Minimal)

```
app.js        - Core app, data layer, initialization (~3000 lines target)
map-tools.js  - Map tools: measurement, search, animation (~1500 lines)
diary.js      - Diary rendering, markdown, highlighting (~2000 lines)  
analysis.js   - Already separate (1185 lines)
styles.css    - Unchanged
index.html    - Unchanged
```

## map-tools.js Contents (Current)

```javascript
// map-tools.js - Build 447

class MeasurementTool {
    // Distance measurement tool
}

class LocationSearch {
    // Nominatim search, geolocation, routing
}

class RouteAnimator {
    // F1 car animation, playback controls
}

// Utility functions
// - getVehicleColor, calculateBearing, getFallbackVehicleSvg
// - adjustColor, getPointTime
// - Bridge functions for HTML onclick
```

## App.js Classes

```javascript
// app.js

class NavigationControllerClass {
    // Central navigation state management
    // Coordinates diary ↔ map selection
}

// Future extraction candidates:
// - DataStore (IndexedDB operations)
// - PlacesManager (Places cache, favorites)
// - PopupController (Toolbar popup coordination)
```

## Diary.js Classes (Future)

```javascript
// diary.js

class DiaryRenderer {
    // Markdown generation from data
}

class DiaryUI {
    // Panel visibility, scrolling, highlighting
    // Communicates with NavigationController for selection state
}
```

## Interdependency Solution

**NavigationController is the bridge:**

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────┐
│   Diary     │────▶│ NavigationController │◀────│    Map      │
│  (diary.js) │     │     (app.js)         │     │  (map.js)   │
└─────────────┘     └──────────────────────┘     └─────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │    DataStore     │
                    │    (app.js)      │
                    └──────────────────┘
```

## Implementation Order (Remaining)

### Phase 3: Replay System Extraction ✅ (Complete - Build 693)
- Extracted ~1,688 lines to `replay.js`
- Created `ReplayController` class with dependency injection
- Uses getter functions for async-created objects (`getMap`, `getGeneratedDiaries`, `getCurrentDayKey`)
- Direct function references for utilities (`getMapPadding`, `clearMapLayers`, `showDayMap`, `calculateDistance`, `calculateDistanceMeters`, `getPointTime`, `cancelMeasurement`)
- Maintains backward compatibility via global window exports (`window.replayState`, `window.loadReplayDay`, etc.)

### Phase 4: Diary Classes
- DiaryRenderer (markdown generation)
- DiaryUI (panel management)
- Move to diary.js

### Phase 5: Cleanup App.js
- DataStore (clean up AppDB)
- PlacesManager
- PopupController
- Keep NavigationController as bridge

## Notes

MapController and MarkerController were originally planned for Phase 2 but are **deferred** because they are tightly coupled with:
- `generatedDiaries` (main data store)
- NavigationController state
- UI elements (diary panel, stats panel)

A proper extraction would require:
1. Event-based architecture between map and data layers
2. Dependency injection for the data store
3. More extensive refactoring than originally estimated

The current approach (MeasurementTool, LocationSearch, RouteAnimator) extracts **self-contained tools** that don't depend heavily on app state.

---

**Next: Phase 4 - Diary Classes** (optional - diary rendering is tightly coupled with data)
