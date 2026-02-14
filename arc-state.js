/**
 * Arc Timeline Diary Reader — Shared Application State
 *
 * Central state object so extracted modules (arc-db.js, import.js, events.js, etc.)
 * can read/write shared variables without dependency injection for every variable.
 *
 * Loaded first, before all other modules.
 */

// =====================================================
// Logging (must load before all modules)
// =====================================================
(() => {
  window.__ARC_DEBUG_LOGS__ = false; // Toggle with F13 key
  window.logInfo  = (...args) => console.info(...args);
  window.logWarn  = (...args) => console.warn(...args);
  window.logError = (...args) => console.error(...args);
  window.logDebug = (...args) => { if (window.__ARC_DEBUG_LOGS__) console.debug(...args); };

  // Helper to clear all debug overlays
  window.clearDebugOverlays = () => {
    if (window._debugBoundsRect) { window._debugBoundsRect.remove(); window._debugBoundsRect = null; }
    if (window._debugBoundsLabel) { window._debugBoundsLabel.remove(); window._debugBoundsLabel = null; }
    if (window._debugTargetMarker) { window._debugTargetMarker.remove(); window._debugTargetMarker = null; }
    if (window._debugTargetLabel) { window._debugTargetLabel.remove(); window._debugTargetLabel = null; }
  };

  // F13 key toggles debug mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F13' || e.code === 'F13') {
      window.__ARC_DEBUG_LOGS__ = !window.__ARC_DEBUG_LOGS__;
      console.info(`🐛 Debug mode: ${window.__ARC_DEBUG_LOGS__ ? 'ON' : 'OFF'}`);
      // Clear overlays when turning off
      if (!window.__ARC_DEBUG_LOGS__) {
        window.clearDebugOverlays();
      }
      e.preventDefault();
    }
  });
})();

(() => {
    'use strict';

    window.ArcState = {
        // ---- Database ----
        DB_NAME: 'ArcTimelineDiary',
        DB_VERSION: 2,  // Must stay at v2 — can't downgrade
        db: null,
        dbReadyResolve: null,
        dbReadyPromise: null, // Initialized below

        // ---- Data Cache ----
        generatedDiaries: {},
        placesById: {},       // { placeId: "Display Name" }

        // ---- Navigation ----
        currentMonth: null,
        currentDayKey: null,
        monthKeys: [],
        currentYear: null,
        currentMonthNum: null,  // 1-12
        availableYears: [],
        mapMode: null,          // 'day' or 'month'

        // ---- Import Tracking ----
        selectedFiles: [],
        selectedBackupFiles: [],
        currentImportType: 'backup',  // 'json' or 'backup'
        importAddedDays: [],
        importUpdatedDays: [],
        importChangedItemIds: new Set(),
        lastImportReport: '',

        // ---- Search ----
        allSearchMatches: [],
        currentSearchIndex: -1,
        currentMonthMatches: [],
        originalContent: '',

        // ---- Map ----
        map: null,              // Leaflet map instance
        cancelProcessing: false
    };

    // Create the DB ready promise with exposed resolver
    const S = window.ArcState;
    S.dbReadyPromise = new Promise(resolve => { S.dbReadyResolve = resolve; });
})();
