/**
 * Arc Timeline Diary Reader — Shared Application State
 *
 * Central state object so extracted modules (arc-db.js, import.js, events.js, etc.)
 * can read/write shared variables without dependency injection for every variable.
 *
 * Loaded first, before all other modules.
 */
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
