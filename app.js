// Logging now lives in arc-state.js (loaded first)
logInfo(`📦 Loaded app.js • Build ${window.__ARC_BUILD__ || '???'}`);

// Handle both direct load and dynamic load (DOMContentLoaded may have already fired)
function initApp() {



// === Smart map movement: animate short hops, jump long distances ===
function moveMapSmart(latlng, zoom) {
    if (!window.map) return;

    const current = window.map.getCenter();
    const distM = current.distanceTo(latlng);

    const LONG_JUMP_M = 3000; // 3 km threshold – tune if needed

    // For long distances, jump immediately (avoids slow tile loading during animation).
    if (distM > LONG_JUMP_M) {
        const z = (typeof zoom === 'number') ? zoom : window.map.getZoom();
        window.map.setView(latlng, z, { animate: false });
        return;
    }

    // For short hops, animate smoothly.
    const z = (typeof zoom === 'number') ? zoom : window.map.getZoom();
    window.map.flyTo(latlng, z, { animate: true, duration: 0.8 });
}

// Version and Build Information
        const VERSION = "3.0";
        const BUILD = window.__ARC_BUILD__ || "???";
        // Build number is set in index.html: window.__ARC_BUILD__
        // Update VERSION for major feature releases
        
        // v3.0 - IndexedDB storage for handling large datasets (175MB+)
        
        logInfo(`📔 Arc Timeline Diary Reader v${VERSION} • Build ${BUILD}`);

        const fileInput = document.getElementById('fileInput');

        const fileCount = document.getElementById('fileCount');
        const cancelBtn = document.getElementById('cancelBtn');
        const progress = document.getElementById('progress');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const results = document.getElementById('results');
        const resultsList = document.getElementById('resultsList');
        const logDiv = document.getElementById('log');
        const modalOverlay = document.getElementById('modalOverlay');
        const monthSelector = document.getElementById('monthSelector');
        const yearSelector = document.getElementById('yearSelector');
        const markdownContent = document.getElementById('markdownContent');
        const prevMonthBtn = document.getElementById('prevMonthBtn');
        const nextMonthBtn = document.getElementById('nextMonthBtn');
        const searchInput = document.getElementById('searchInput');
        const searchCount = document.getElementById('searchCount');
        const prevSearchBtn = document.getElementById('prevSearchBtn');
        const nextSearchBtn = document.getElementById('nextSearchBtn');
		  
		  function shouldListDayInDiary(dayObj) {
				// Robust: treat “has notes” as either (a) any location pin with note or (b) any explicit day notes list
				const hasPinNotes = Array.isArray(dayObj.locations) && dayObj.locations.some(p => !!p.hasNote);
				const hasDayNotes = Array.isArray(dayObj.notes) && dayObj.notes.some(n => (n || '').trim().length > 0);
		  
				return hasPinNotes || hasDayNotes;
		  }
        // Version info
        const APP_VERSION = `${VERSION} • Build ${BUILD}`;
        
        
        // ========================================
        // IndexedDB Layer — Bridge to arc-db.js
        // ========================================
        
        const S = window.ArcState;
        const {
            initDatabase,
            setUICallbacks: _setDBCallbacks,
            getDBStats,
            saveMetadata,
            getMetadata,
            getDayFromDB,
            getAllDayKeysFromDB,
            getMonthDaysFromDB,
            clearDatabase,
            exportDatabaseToJSON,
            filterGhostItems,
            applyImportFixes,
            getLocalDayKey,
            getPreviousDayKey,
            getStoredDisplayNameForTimelineItem,
            getStoredActivityTypeForTimelineItem,
            loadPlacesFromSelectedFiles,
            checkAndRebuildAnalysisData,
            updateAnalysisDataInBackground,
            rebuildLocationsAggregate,
        } = window.ArcDB;

        // ========================================
        // Utilities — Bridge to arc-utils.js
        // ========================================

        const { addLog, formatTime, formatDate, formatDuration, formatDistance,
                calculateDistance, decompressFile } = window.ArcUtils;

        // ========================================
        // Data Extraction — Bridge to arc-data.js
        // ========================================

        const {
            getActivityFilterType,
            extractNotesFromData,
            extractEntriesAndNotesFromData,
            extractPinsFromData,
            extractTracksFromData,
            getDaysFromModel,
            getFilteredNotesForDay,
            calculateDailyActivityStats,
            calculateMonthlyActivityStats,
        } = window.ArcData;

        // Alias — backward compat
        const calculateDistanceMeters = calculateDistance;

        // Simple HTML escaper (was in events section, still needed for generateMarkdown)
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Local aliases for shared state (backward compat with existing code)
        let db = null;                  // synced from S.db
        let _dbReadyResolve = S.dbReadyResolve;
        const dbReadyPromise = S.dbReadyPromise;

        // placesById — local alias kept in sync with ArcState
        let placesById = S.placesById;

        // Update database status display in UI
        async function updateDBStatusDisplay() {
            const stats = await getDBStats();
            const dbStatusSection = document.getElementById('dbStatusSection');
            const dbStats = document.getElementById('dbStats');
            const fileInputSection = document.getElementById('fileInputSection');

            if (stats.dayCount > 0) {
                // Show database status
                if (dbStatusSection) dbStatusSection.style.display = 'block';

                const lastSyncText = stats.lastSync
                    ? `Last sync: ${new Date(stats.lastSync).toLocaleString()}`
                    : 'Never synced';

                if (dbStats) dbStats.textContent = `${stats.monthCount} months • ${stats.dayCount} days • ${lastSyncText}`;

                // Hide file input section when database has data
                if (fileInputSection) fileInputSection.style.display = 'none';
            } else {
                // No data - show file input
                if (dbStatusSection) dbStatusSection.style.display = 'none';
                if (fileInputSection) fileInputSection.style.display = 'block';
            }
        }
        
        // Import files to IndexedDB — delegates to import module
        async function importFilesToDatabase() {
            return window.ArcImport.importFilesToDatabase();
        }

        
        // Load most recent month from database (optimized for large datasets)
        async function loadMostRecentMonth() {
            // Get unique months using cursor (efficient for large datasets)
            const months = await new Promise((resolve, reject) => {
                const tx = db.transaction(['days'], 'readonly');
                const dayStore = tx.objectStore('days');
                const monthIndex = dayStore.index('monthKey');
                
                const monthSet = new Set();
                const cursorReq = monthIndex.openCursor(null, 'nextunique');
                
                cursorReq.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        monthSet.add(cursor.key);
                        cursor.continue();
                    }
                };
                
                tx.oncomplete = () => {
                    resolve(Array.from(monthSet).sort());
                };
                
                tx.onerror = () => reject(tx.error);
            });
            
            if (months.length === 0) {
                addLog('No data in database', 'error');
                return;
            }
            
            // Populate global monthKeys with ALL months
            monthKeys = months;
            const mostRecentMonth = months[months.length - 1]; // Get last (most recent)
            
            logDebug(`📅 Available months in database: ${months.length} months from ${months[0]} to ${months[months.length - 1]}`);
            addLog(`Loading ${mostRecentMonth}...`);
            
            // Set current month BEFORE loading (critical for selector population)
            currentMonth = mostRecentMonth;
            currentYear = mostRecentMonth.split('-')[0];
            currentMonthNum = parseInt(mostRecentMonth.split('-')[1]);
            
            // Load ONLY the most recent month's data into memory
            await loadMonthFromDatabase(mostRecentMonth);
            
            // Update current month display (if modal is open)
            const currentMonthDisplay = document.getElementById('currentMonthDisplay');
            if (currentMonthDisplay) {
                currentMonthDisplay.textContent = formatMonthDisplay(mostRecentMonth);
            }
            
            // Populate year and month selectors
            await populateYearAndMonthSelectors();
        }
        
        // Load a specific month from database into memory
        async function loadMonthFromDatabase(monthKey) {
            const dayRecords = await getMonthDaysFromDB(monthKey);
            
            logDebug(`📅 Loading ${monthKey}: ${dayRecords.length} day records from DB`);
            
            if (dayRecords.length === 0) {
                addLog(`No data found for ${monthKey}`, 'error');
                return;
            }
            
            // Sort dayRecords by dayKey to ensure proper order
            dayRecords.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
            
            // Build a map for quick lookup
            const dayDataMap = new Map();
            for (const rec of dayRecords) {
                dayDataMap.set(rec.dayKey, rec.data);
            }
            
            // Build index of ALL multi-day visits in this month (and from previous month)
            // Key: dayKey, Value: array of visits that span INTO that day
            const spanningVisitsIndex = new Map();
            
            // First, collect all visits that span multiple days (deduplicated by itemId)
            const allSpanningVisits = [];
            const seenSpanningItemIds = new Set();
            
            for (const rec of dayRecords) {
                if (!rec.data?.timelineItems) continue;
                for (const item of rec.data.timelineItems) {
                    if (!item.isVisit || !item.endDate || !item.startDate) continue;
                    if (!item.itemId || seenSpanningItemIds.has(item.itemId)) continue;
                    
                    const startDay = getLocalDayKey(item.startDate);
                    const endDay = getLocalDayKey(item.endDate);
                    if (endDay > startDay) {
                        // This visit spans multiple days (in local time)
                        seenSpanningItemIds.add(item.itemId);
                        allSpanningVisits.push({
                            item,
                            startDay,
                            endDay
                        });
                    }
                }
            }
            
            // For the first day of the month, check previous month for spanning visits
            if (dayRecords.length > 0) {
                const firstDayKey = dayRecords[0].dayKey;
                const prevDayKey = getPreviousDayKey(firstDayKey);
                if (prevDayKey.substring(0, 7) !== monthKey) {
                    // Previous day is in a different month - load it
                    const prevDayRecord = await getDayFromDB(prevDayKey);
                    if (prevDayRecord?.data?.timelineItems) {
                        for (const item of prevDayRecord.data.timelineItems) {
                            if (!item.isVisit || !item.endDate || !item.startDate) continue;
                            if (!item.itemId || seenSpanningItemIds.has(item.itemId)) continue;
                            
                            const startDay = getLocalDayKey(item.startDate);
                            const endDay = getLocalDayKey(item.endDate);
                            if (endDay >= firstDayKey) {
                                seenSpanningItemIds.add(item.itemId);
                                allSpanningVisits.push({ item, startDay, endDay });
                            }
                        }
                    }
                }
            }
            
            // Now build the index: for each day, which visits span into it?
            for (const { item, startDay, endDay } of allSpanningVisits) {
                // Add this visit to every day it spans INTO (not the start day, which already has it)
                let currentDay = getPreviousDayKey(endDay); // Start from day before end
                // Walk backwards, but don't go before start day
                while (currentDay > startDay) {
                    if (!spanningVisitsIndex.has(currentDay)) {
                        spanningVisitsIndex.set(currentDay, []);
                    }
                    spanningVisitsIndex.get(currentDay).push(item);
                    currentDay = getPreviousDayKey(currentDay);
                }
                // Also add to the end day itself
                if (endDay > startDay) {
                    if (!spanningVisitsIndex.has(endDay)) {
                        spanningVisitsIndex.set(endDay, []);
                    }
                    spanningVisitsIndex.get(endDay).push(item);
                }
            }
            
            // Find days that have spanning visits but NO day record (stayed home all day)
            const existingDayKeys = new Set(dayRecords.map(r => r.dayKey));
            const spanningOnlyDays = [];
            for (const [dayKey, visits] of spanningVisitsIndex) {
                // Only include days in this month that don't have existing data
                if (dayKey.startsWith(monthKey) && !existingDayKeys.has(dayKey)) {
                    spanningOnlyDays.push({
                        dayKey,
                        data: { timelineItems: visits }
                    });
                }
            }
            
            // Combine existing day records with spanning-only days
            const allDayRecords = [...dayRecords, ...spanningOnlyDays];
            allDayRecords.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
            
            // Reconstruct month data in the format expected by the diary generator
            const monthData = {
                month: monthKey,
                days: {},
                emptyDays: new Set()  // Days with DB records but no timeline items
            };
            
            let totalTracks = 0;
            let totalPoints = 0;
            let totalEntries = 0;
            let totalNotes = 0;
            
            for (const dayRecord of allDayRecords) {
                const dayKey = dayRecord.dayKey;
                const data = dayRecord.data;
                const sourceFile = dayRecord.sourceFile || 'json-import'; // Track import source
                
                // Check for visits that span into this day (from any previous day)
                const spanningVisits = spanningVisitsIndex.get(dayKey) || [];
                
                // Get existing itemIds in this day's data to avoid duplicates
                const existingItemIds = new Set();
                if (data?.timelineItems) {
                    for (const item of data.timelineItems) {
                        if (item.itemId) existingItemIds.add(item.itemId);
                    }
                }
                
                // Filter out spanning visits that are already in this day's data
                const newSpanningVisits = spanningVisits.filter(v => !existingItemIds.has(v.itemId));
                
                // Merge spanning visits into current day's data
                let mergedItems = [...newSpanningVisits, ...(data.timelineItems || [])];
                
                // Sort by startDate to ensure chronological order
                mergedItems.sort((a, b) => {
                    const aStart = a.startDate ? new Date(a.startDate).getTime() : 0;
                    const bStart = b.startDate ? new Date(b.startDate).getTime() : 0;
                    return aStart - bStart;
                });

                // Filter out ghost items (0-sample duplicates that overlap real items)
                mergedItems = filterGhostItems(mergedItems);

                const mergedData = { ...data, timelineItems: mergedItems };
                
                // Extract LEGACY notes, pins, tracks (for existing diary/map code)
                // Pass sourceFile to determine if coalescing should be applied
                const notes = extractNotesFromData(mergedData, dayKey, sourceFile);
                const pins = extractPinsFromData(mergedData);
                const tracks = extractTracksFromData(mergedData);
                
                // Extract NEW normalized entries and notes
                const { entries, notes: itemNotes } = extractEntriesAndNotesFromData(mergedData, dayKey);
                
                totalTracks += tracks.length;
                totalEntries += entries.length;
                totalNotes += itemNotes.length;
                
                if (notes.length > 0 || (pins && pins.length > 0) || (tracks && tracks.length > 0) || entries.length > 0) {
                    monthData.days[dayKey] = {
                        date: dayKey,
                        // Raw data for re-extraction (when coalesce settings change)
                        _rawData: mergedData,
                        _sourceFile: sourceFile, // Track import source for coalescing decision
                        // Legacy fields (for existing diary markdown generation)
                        notes: notes,
                        locations: pins || [],
                        tracks: tracks || [],
                        // New normalized fields (for navigation/table/database)
                        entries: entries,
                        itemNotes: itemNotes  // Renamed to avoid confusion with legacy 'notes'
                    };
                } else {
                    // Day has DB record but no content - Arc crashed or nothing recorded
                    monthData.emptyDays.add(dayKey);
                }
            }
            
            // Store in memory (for existing diary display code)
            generatedDiaries[monthKey] = {
                monthData: monthData,
                routesByDay: {},
                locationsByDay: {}
            };
            
            // Process locationsByDay and routesByDay (same structure as generateDiaries)
            let totalRoutePoints = 0;
            for (const dayKey in monthData.days) {
                const dayData = monthData.days[dayKey];
                
                // Process locations (pins) for showDayMap
                // extractPinsFromData returns pins with: location, lat, lng, altitude, hasNote, startDate, endDate, timelineItemId
                const dayPins = dayData.locations || []; // 'locations' is populated from extractPinsFromData
                const seen = new Set();
                const locs = [];
                
                for (const p of dayPins) {
                    if (!p.lat || !p.lng) continue;
                    const uniqueKey = p.timelineItemId || `${p.location}_${p.lat}_${p.lng}`;
                    if (seen.has(uniqueKey)) continue;
                    seen.add(uniqueKey);
                    
                    locs.push({
                        day: dayKey,
                        name: p.location || 'Unknown Location',
                        location: p.location || 'Unknown Location',
                        lat: p.lat,
                        lng: p.lng,
                        altitude: p.altitude ?? null,
                        date: p.startDate || null,
                        startDate: p.startDate || null,
                        endDate: p.endDate || null,
                        hasNote: !!p.hasNote,
                        timelineItemId: p.timelineItemId || uniqueKey
                    });
                }
                
                if (locs.length) {
                    generatedDiaries[monthKey].locationsByDay[dayKey] = locs;
                }
                
                // Process routes (tracks) for map display
                if (dayData.tracks && dayData.tracks.length > 0) {
                    const routePoints = [];
                    for (const track of dayData.tracks) {
                        // extractTracksFromData returns tracks with 'points' property, not 'samples'
                        if (track.points) {
                            for (const point of track.points) {
                                routePoints.push({
                                    lat: point.lat,
                                    lng: point.lng,
                                    altitude: point.alt ?? null,  // Include altitude
                                    activityType: track.activityType || 'unknown',
                                    timelineItemId: point.timelineItemId || track.timelineItemId || null,
                                    timestamp: point.t,
                                    date: point.t,
                                    dayKey: dayKey,
                                    t: point.t  // Add 't' for sorting
                                });
                            }
                            totalPoints += track.points.length;
                        }
                    }
                    
                    // Sort route points by time (same as old code)
                    routePoints.sort((a, b) => {
                        if (a.t == null && b.t == null) return 0;
                        if (a.t == null) return 1;
                        if (b.t == null) return -1;
                        const ta = (typeof a.t === 'number') ? a.t : Date.parse(a.t);
                        const tb = (typeof b.t === 'number') ? b.t : Date.parse(b.t);
                        return (ta || 0) - (tb || 0);
                    });
                    
                    if (routePoints.length >= 2) {
                        generatedDiaries[monthKey].routesByDay[dayKey] = routePoints;
                        totalRoutePoints += routePoints.length;
                    }
                }
            }
            
            logDebug(`✅ Loaded ${monthKey}: ${Object.keys(monthData.days).length} days, ${Object.keys(generatedDiaries[monthKey].locationsByDay).length} days with locations, ${totalRoutePoints} route points, ${totalEntries} entries, ${totalNotes} notes`);
            
            // Update global state - DO NOT modify monthKeys (already set globally)
            currentMonth = monthKey;
            
            // Update month selector
            if (monthSelector) {
                monthSelector.value = monthKey;
            }
            
            // Update month nav buttons
            updateMonthNavButtons();
            
            // If diary is not open, open it. Otherwise just update the display
            if (modalOverlay.style.display === 'block') {
                // Diary already open - just update display
                displayDiary(monthKey);
                showMonthMap();
                setTimeout(() => updateStatsForCurrentView(), 10);
            } else {
                // Open diary reader for first time
                openDiaryReader();
            }
        }
        
        // Helper: Format month for display
        function formatMonthDisplay(monthKey) {
            const [year, month] = monthKey.split('-');
            const date = new Date(year, parseInt(month) - 1);
            return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
        
        // Open Diary button handler - loads most recent month
        async function openDiaryFromDatabase() {
            try {
                // Wait for database to be ready
                await dbReadyPromise;
                
                if (!db) {
                    throw new Error('Database not initialized');
                }
                
                await loadMostRecentMonth();
            } catch (error) {
                logError('Error loading diary:', error);
                alert('Error loading diary: ' + error.message);
            }
        }
        
        // Mapbox settings for main page
        function initMainMapboxSettings() {
            const token = localStorage.getItem('arc_mapbox_token') || '';
            const input = document.getElementById('mainMapboxToken');
            const badge = document.getElementById('mapboxStatusBadge');
            
            if (input) input.value = token;
            
            if (badge) {
                if (token) {
                    badge.textContent = 'Active';
                    badge.style.background = '#34c759';
                    badge.style.color = 'white';
                } else {
                    badge.textContent = 'Not configured';
                    badge.style.background = '#e5e5ea';
                    badge.style.color = '#86868b';
                }
            }
        }
        
        window.saveMainMapboxToken = function() {
            const input = document.getElementById('mainMapboxToken');
            const token = input?.value.trim() || '';
            
            if (token) {
                localStorage.setItem('arc_mapbox_token', token);
            } else {
                localStorage.removeItem('arc_mapbox_token');
            }
            
            initMainMapboxSettings();
            
            // Notify other tabs/pages
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'arc_mapbox_token',
                newValue: token || null
            }));
        };
        
        // Initialize Mapbox settings when page loads
        // Call directly since we're already in DOMContentLoaded/ready state
        initMainMapboxSettings();
        
        // Populate month selector from monthKeys (works with IndexedDB)
        // Populate year and month selectors from database (v3.0 multi-year support)
        async function populateYearAndMonthSelectors() {
            // Extract unique years from monthKeys
            availableYears = [...new Set(monthKeys.map(mk => mk.split('-')[0]))].sort();
            
            // Populate year selector
            yearSelector.innerHTML = '';
            for (const year of availableYears) {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                yearSelector.appendChild(option);
            }
            
            // Set current year
            if (currentMonth) {
                currentYear = currentMonth.split('-')[0];
                currentMonthNum = parseInt(currentMonth.split('-')[1]);
                yearSelector.value = currentYear;
            }
            
            // Populate month selector based on current year
            populateMonthSelector(currentYear);
            
            // Set month selector to current month
            if (currentMonthNum) {
                monthSelector.value = currentMonthNum;
            }
        }
        
        // Populate month selector with months that have data for selected year
        function populateMonthSelector(year) {
            monthSelector.innerHTML = '';
            
            // Defensive: if no year provided, try to get from monthKeys
            if (!year && monthKeys.length > 0) {
                year = monthKeys[monthKeys.length - 1].split('-')[0];
            }
            
            // Filter monthKeys to only this year
            const monthsInYear = monthKeys
                .filter(mk => mk.startsWith(year + '-'))
                .map(mk => parseInt(mk.split('-')[1]));
            
            // Create all 12 months but disable ones without data
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                               'July', 'August', 'September', 'October', 'November', 'December'];
            
            // Only show months that have data
            for (let m = 1; m <= 12; m++) {
                if (!monthsInYear.includes(m)) continue;
                
                const option = document.createElement('option');
                option.value = m;
                option.textContent = monthNames[m - 1];
                monthSelector.appendChild(option);
            }
            
            // Don't auto-select here - let loadAndDisplayMonth() handle it
            // This prevents the selector from jumping to wrong values
        }
        
        // Handle year change with smart month preservation
        async function switchYear() {
            const selectedYear = yearSelector.value;

            // Get months available in this year
            const monthsInYear = monthKeys
                .filter(mk => mk.startsWith(selectedYear + '-'))
                .map(mk => parseInt(mk.split('-')[1]));
            
            
            if (monthsInYear.length === 0) {
                logError(`❌ No data found for year ${selectedYear}`);
                // Reset year selector back to current year since selected year has no data
                yearSelector.value = currentYear;
                alert(`No data available for ${selectedYear}`);
                return;
            }
            
            // Update month selector for this year (disables unavailable months)
            populateMonthSelector(selectedYear);
            
            // Smart month selection logic:
            // 1. Try to preserve current month (e.g., Dec 2025 → Dec 2024)
            // 2. If not available, use closest earlier month (e.g., Dec → Nov → Oct...)
            // 3. If no earlier month, use first available (e.g., only Jan-Mar data → Mar)
            
            let targetMonth = null;
            
            if (currentMonthNum && monthsInYear.includes(currentMonthNum)) {
                // Same month exists in new year - use it!
                targetMonth = currentMonthNum;
                logDebug(`📅 Preserving month ${currentMonthNum} in year ${selectedYear}`);
            } else {
                // Find closest available month
                // First try earlier months (Dec→Nov→Oct...)
                for (let m = currentMonthNum - 1; m >= 1; m--) {
                    if (monthsInYear.includes(m)) {
                        targetMonth = m;
                        logDebug(`📅 Month ${currentMonthNum} not available, using earlier month ${m}`);
                        break;
                    }
                }
                
                // If no earlier month found, use latest available month
                if (!targetMonth) {
                    targetMonth = Math.max(...monthsInYear);
                    logDebug(`📅 No earlier month available, using latest month ${targetMonth}`);
                }
            }
            
            // Load the selected month via NavigationController
            const monthKey = `${selectedYear}-${String(targetMonth).padStart(2, '0')}`;
            
            // Clear selection state - we're jumping to a new month via dropdown
            NavigationController.reset();
            
            await NavigationController.selectMonth(monthKey);
        }
        
        // Handle month change
        async function switchMonth() {
            const selectedYear = yearSelector.value;
            const selectedMonthNum = monthSelector.value;
            const monthKey = `${selectedYear}-${selectedMonthNum.padStart(2, '0')}`;

            // Clear selection state - we're jumping to a new month via dropdown
            NavigationController.reset();

            await NavigationController.selectMonth(monthKey);
        }
        
        // Helper function to load and display a month
        async function loadAndDisplayMonth(monthKey) {
            logDebug(`🔄 loadAndDisplayMonth: ${monthKey}`);
            
            // Set currentMonth FIRST, unconditionally (fixes year selector bug)
            currentMonth = monthKey;
            
            // Load the month from database if not already loaded
            if (!generatedDiaries[monthKey]) {
                logDebug(`📥 Loading ${monthKey} from database...`);
                await loadMonthFromDatabase(monthKey);
                // loadMonthFromDatabase handles display and map updates
            } else {
                // Month already loaded, just display it
                displayDiary(currentMonth);
                updateMonthNavButtons();
                
                // Show month map for new month
                showMonthMap();
            }
            
            // Update tracking variables
            currentYear = monthKey.split('-')[0];
            currentMonthNum = parseInt(monthKey.split('-')[1]);
            
            // Update the selector UI elements to match
            yearSelector.value = currentYear;
            monthSelector.value = currentMonthNum;
            
            // Safety check: verify selector actually updated (can fail if dropdown was repopulated for different year)
            if (monthSelector.value != currentMonthNum) {
                logWarn(`⚠️ Month selector mismatch! Wanted ${currentMonthNum}, got "${monthSelector.value}". Repopulating...`);
                populateMonthSelector(currentYear);
                monthSelector.value = currentMonthNum;
            }
            
            
            // Update current month display (if element exists - modal may not be open yet)
            const currentMonthDisplay = document.getElementById('currentMonthDisplay');
            if (currentMonthDisplay) {
                currentMonthDisplay.textContent = formatMonthDisplay(monthKey);
            }
        }
        
        // Import More Files button handler
        function importMoreFiles() {
            // Close location search popup if open
            if (typeof window.closeSearchPopup === 'function') {
                window.closeSearchPopup();
            }

            // Delegate to import module if available
            if (window.ArcImport?.importMoreFiles) {
                return window.ArcImport.importMoreFiles();
            }

            // Fallback: original implementation
            const logDiv = document.getElementById('log');
            if (logDiv) logDiv.style.display = 'none';

            fileInput.value = '';
            selectedFiles = [];
            fileCount.textContent = '';

            document.getElementById('fileInputSection').style.display = 'block';
            document.getElementById('fileInputSection').scrollIntoView({ behavior: 'smooth' });
        }
        
        // Export database to JSON file
        async function exportDatabaseBackup() {
            const data = await exportDatabaseToJSON();
            
            if (!data) {
                alert('No data to export');
                return;
            }
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `arc-diary-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            
            addLog(`✅ Exported ${data.dayCount} days to JSON backup`);
        }
        
        // Clear database and reset UI
        async function clearDatabaseAndReset() {
            await clearDatabase();
            generatedDiaries = {};
            S.generatedDiaries = generatedDiaries; // sync to ArcState
            monthKeys = [];
            currentMonth = null;
            
            await updateDBStatusDisplay();
            
            // Close diary reader if open
            if (modalOverlay.style.display === 'block') {
                modalOverlay.style.display = 'none';
            }
            
            addLog('✅ Database cleared');
        }
        
        // ============================================================
        // Delete Days Modal
        // ============================================================

        function openDeleteModal() {
            const overlay = document.getElementById('deleteModalOverlay');
            if (!overlay) return;

            // Default date to currently viewed day or today
            const dayKey = (window.NavigationController && window.NavigationController.dayKey) || currentDayKey;
            const defaultDate = dayKey || new Date().toISOString().slice(0, 10);

            const singleInput = document.getElementById('deleteSingleDate');
            const startInput = document.getElementById('deleteStartDate');
            const endInput = document.getElementById('deleteEndDate');

            if (singleInput) singleInput.value = defaultDate;
            if (startInput) startInput.value = defaultDate;
            if (endInput) endInput.value = defaultDate;

            // Reset to single day mode
            const singleRadio = document.querySelector('input[name="deleteMode"][value="single"]');
            if (singleRadio) singleRadio.checked = true;

            document.getElementById('deleteSingleRow').style.display = '';
            document.getElementById('deleteRangeRow').style.display = 'none';

            overlay.style.display = 'flex';
            updateDeletePreview();
        }

        function closeDeleteModal() {
            const overlay = document.getElementById('deleteModalOverlay');
            if (overlay) overlay.style.display = 'none';
        }

        async function updateDeletePreview() {
            const mode = document.querySelector('input[name="deleteMode"]:checked')?.value || 'single';
            const preview = document.getElementById('deletePreview');
            const deleteBtn = document.getElementById('deleteConfirmBtn');
            const singleRow = document.getElementById('deleteSingleRow');
            const rangeRow = document.getElementById('deleteRangeRow');

            // Show/hide date inputs based on mode
            if (singleRow) singleRow.style.display = (mode === 'single') ? '' : 'none';
            if (rangeRow) rangeRow.style.display = (mode === 'range') ? '' : 'none';

            if (mode === 'all') {
                const stats = await getDBStats();
                if (preview) {
                    preview.style.color = '#ff3b30';
                    preview.textContent = `⚠️ All ${stats.dayCount.toLocaleString()} days will be permanently deleted`;
                }
                if (deleteBtn) deleteBtn.disabled = stats.dayCount === 0;
                return;
            }

            let startKey, endKey;
            if (mode === 'single') {
                const val = document.getElementById('deleteSingleDate')?.value;
                if (!val) {
                    if (preview) { preview.style.color = '#86868b'; preview.textContent = 'Select a date'; }
                    if (deleteBtn) deleteBtn.disabled = true;
                    return;
                }
                startKey = endKey = val;
            } else {
                startKey = document.getElementById('deleteStartDate')?.value;
                endKey = document.getElementById('deleteEndDate')?.value;
                if (!startKey || !endKey) {
                    if (preview) { preview.style.color = '#86868b'; preview.textContent = 'Select start and end dates'; }
                    if (deleteBtn) deleteBtn.disabled = true;
                    return;
                }
                if (startKey > endKey) {
                    if (preview) { preview.style.color = '#ff3b30'; preview.textContent = 'Start date must be before end date'; }
                    if (deleteBtn) deleteBtn.disabled = true;
                    return;
                }
            }

            try {
                const dayKeys = await getDayKeysInRange(startKey, endKey);
                if (dayKeys.length === 0) {
                    if (preview) { preview.style.color = '#86868b'; preview.textContent = 'No days found in this range'; }
                    if (deleteBtn) deleteBtn.disabled = true;
                } else {
                    const label = dayKeys.length === 1
                        ? `1 day will be deleted (${dayKeys[0]})`
                        : `${dayKeys.length} days will be deleted (${dayKeys[0]} to ${dayKeys[dayKeys.length - 1]})`;
                    if (preview) { preview.style.color = '#ff3b30'; preview.textContent = label; }
                    if (deleteBtn) deleteBtn.disabled = false;
                }
            } catch (err) {
                if (preview) { preview.style.color = '#ff3b30'; preview.textContent = 'Error reading database'; }
                if (deleteBtn) deleteBtn.disabled = true;
            }
        }

        async function getDayKeysInRange(startKey, endKey) {
            if (!db) return [];
            return new Promise((resolve, reject) => {
                const tx = db.transaction(['days'], 'readonly');
                const store = tx.objectStore('days');
                const range = IDBKeyRange.bound(startKey, endKey);
                const req = store.getAllKeys(range);
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        }

        async function confirmDeleteDays() {
            const mode = document.querySelector('input[name="deleteMode"]:checked')?.value || 'single';

            if (mode === 'all') {
                if (confirm('Are you sure you want to clear the entire database? This cannot be undone.')) {
                    closeDeleteModal();
                    await clearDatabaseAndReset();
                }
                return;
            }

            let startKey, endKey;
            if (mode === 'single') {
                startKey = endKey = document.getElementById('deleteSingleDate')?.value;
            } else {
                startKey = document.getElementById('deleteStartDate')?.value;
                endKey = document.getElementById('deleteEndDate')?.value;
            }

            if (!startKey || !endKey) return;

            const dayKeys = await getDayKeysInRange(startKey, endKey);
            if (dayKeys.length === 0) return;

            const label = dayKeys.length === 1
                ? `Delete ${dayKeys[0]}? This cannot be undone.`
                : `Delete ${dayKeys.length} days (${dayKeys[0]} to ${dayKeys[dayKeys.length - 1]})? This cannot be undone.`;

            if (!confirm(label)) return;

            closeDeleteModal();
            const count = await deleteDaysFromDB(dayKeys);
            addLog(`🗑️ Deleted ${count} day${count !== 1 ? 's' : ''}`);
        }

        async function deleteDaysFromDB(dayKeys) {
            if (!db || dayKeys.length === 0) return 0;

            // Delete from days, dailySummaries, locationVisits, and reset sync timestamps
            const stores = ['days', 'metadata'];
            if (db.objectStoreNames.contains('dailySummaries')) stores.push('dailySummaries');
            if (db.objectStoreNames.contains('locationVisits')) stores.push('locationVisits');

            await new Promise((resolve, reject) => {
                const tx = db.transaction(stores, 'readwrite');
                const daysStore = tx.objectStore('days');
                const metaStore = tx.objectStore('metadata');
                const summaryStore = stores.includes('dailySummaries') ? tx.objectStore('dailySummaries') : null;
                const visitStore = stores.includes('locationVisits') ? tx.objectStore('locationVisits') : null;

                for (const dayKey of dayKeys) {
                    daysStore.delete(dayKey);
                    if (summaryStore) summaryStore.delete(dayKey);

                    // Delete locationVisits for this dayKey via index
                    if (visitStore) {
                        const dayIndex = visitStore.index('dayKey');
                        const cursor = dayIndex.openCursor(IDBKeyRange.only(dayKey));
                        cursor.onsuccess = (e) => {
                            const c = e.target.result;
                            if (c) { c.delete(); c.continue(); }
                        };
                    }
                }

                // Reset sync timestamps so next import will re-process deleted days
                metaStore.delete('lastBackupSync');
                metaStore.delete('lastSync');

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            // Rebuild location aggregates
            if (db.objectStoreNames.contains('locationVisits')) {
                try { await rebuildLocationsAggregate(); } catch (e) { logWarn('Location rebuild failed:', e); }
            }

            // Clear memory caches
            for (const dayKey of dayKeys) {
                const monthKey = dayKey.substring(0, 7);
                if (generatedDiaries[monthKey]) {
                    delete generatedDiaries[monthKey].days?.[dayKey];
                    delete generatedDiaries[monthKey].locationsByDay?.[dayKey];
                    delete generatedDiaries[monthKey].routesByDay?.[dayKey];
                }
            }

            // Update UI
            await updateDBStatusDisplay();

            // If diary is open, close it (simplest safe approach)
            if (modalOverlay && modalOverlay.style.display === 'block') {
                modalOverlay.style.display = 'none';
            }

            return dayKeys.length;
        }

        let selectedFiles = [];
        let generatedDiaries = S.generatedDiaries; // shared with arc-db.js via ArcState
        let currentMonth = null;
        let monthKeys = [];
        
        // Import type/backup UI — delegated to import.js

        // Backup import functions — delegated to import.js
        // (selectBackupFolder, handleBackupFolderSelected, importFromBackupDir, importFromBackupFiles, etc.)

        // REMOVED: setupBackupImportHandler, selectBackupFolder, handleBackupFolderSelected,
        // selectBackupFolderModern, readJsonFilesFromHexDirs, getRecentMonthKeys, getRecentWeekKeys,
        // readFileAsJson, toRecordArray, mapArcEditorActivityType, normalizeBackupItem,
        // normalizeBackupPlace, normalizeBackupNote, normalizeBackupSample,
        // createBackupImportDiagnostics, logBackupImportDiagnostics, orderItemsByLinkedList,
        // readGzippedFileAsJson, importFromBackupDir, importFromBackupFiles,
        // getISOWeek, getISOWeekUTC, getAdjacentWeekKeys, getCandidateWeekKeysForItem
        // All moved to import.js (Phase 2 modularization)

        // ── backup import section removed ── see import.js ──

        // Track days added/updated in last import (for diary display)
        // Synced from import.js via deps.updateImportTracking
        let importAddedDays = [];
        let importUpdatedDays = [];
        let importChangedItemIds = new Set(); // itemIds changed in last import (for + bullet)

        // Year/Month tracking for selector
        let currentYear = null;
        let currentMonthNum = null; // 1-12
        let availableYears = []; // List of years that have data
        
        // Map state
        let mapMode = null; // 'day' or 'month'
        let currentDayKey = null;
        let allSearchMatches = [];
        let currentSearchIndex = -1;
        let currentMonthMatches = [];
        let originalContent = '';
        
        // Favorites state
        const FAVORITES_STORAGE_KEY = 'arcDiaryFavorites';
        const MAX_FAVORITES = 12;
        let favorites = [];
        let searchDropdownVisible = false;
        
        // Favorites management functions
        function loadFavorites() {
            try {
                const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
                favorites = stored ? JSON.parse(stored) : [];
                logDebug(`⭐ Loaded ${favorites.length} favorites`);
            } catch (error) {
                logError('Error loading favorites:', error);
                favorites = [];
            }
        }
        
        function saveFavorites() {
            try {
                localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
                logDebug(`⭐ Saved ${favorites.length} favorites`);
            } catch (error) {
                logError('Error saving favorites:', error);
            }
        }
        
        function isFavorite(lat, lng) {
            // Check if location is in favorites (with tolerance for GPS precision)
            return favorites.some(fav => 
                Math.abs(fav.lat - lat) < 0.0001 && 
                Math.abs(fav.lng - lng) < 0.0001
            );
        }
        
        function addFavorite(name, lat, lng, altitude = null, monthKey = null, dayKey = null) {
            if (favorites.length >= MAX_FAVORITES) {
                alert(`Maximum ${MAX_FAVORITES} favorites reached. Please remove one first.`);
                return false;
            }
            
            if (isFavorite(lat, lng)) {
                return false; // Already favorited
            }
            
            favorites.push({
                name: name,
                lat: lat,
                lng: lng,
                altitude: altitude,
                monthKey: monthKey || currentMonth,  // Store current month
                dayKey: dayKey || currentDayKey,      // Store current day
                addedDate: new Date().toISOString()
            });
            
            saveFavorites();
            updateFavouriteTags(); // Update diary display
            return true;
        }
        
        function removeFavorite(lat, lng) {
            const initialLength = favorites.length;
            favorites = favorites.filter(fav => 
                Math.abs(fav.lat - lat) >= 0.0001 || 
                Math.abs(fav.lng - lng) >= 0.0001
            );
            
            if (favorites.length < initialLength) {
                saveFavorites();
                updateFavouriteTags(); // Update diary display
                return true;
            }
            return false;
        }
        
        function toggleFavorite(name, lat, lng, altitude = null, monthKey = null, dayKey = null) {
            if (isFavorite(lat, lng)) {
                removeFavorite(lat, lng);
                return false; // Removed
            } else {
                addFavorite(name, lat, lng, altitude, monthKey, dayKey);
                return true; // Added
            }
        }


        // ========================================
        // Events — Bridge to events.js
        // ========================================

        const {
            createEvent,
            updateEvent,
            deleteEvent,
            getEventById,
            getAllEvents,
            getEventsForDay,
            getEventsForDateTime,
            getEventsInRange,
            getEventCategory,
            addEventCategory,
            updateEventCategory,
            deleteEventCategory,
            exportEventsData,
            importEventsData,
            openEventSlider,
            openEventList,
            closeEventSlider,
            cancelEventEdit,
            navigateToEvent,
            setEventBoundMode,
            handleEventBoundSelection,
            updateEventBoundFromInput,
            saveEvent: saveEventFn,
            deleteCurrentEvent,
            startNewEvent,
            openCategoryManager,
            closeCategoryManager,
            updateCategoryColor,
            updateCategoryName,
            deleteCategoryFromManager,
            addNewCategory,
            getEventCreationState,
            getEventBoundMode,
            setUICallbacks: _setEventsCallbacks,
        } = window.ArcEvents;


        let map = null;
        let currentTileLayer = null;
        let currentMapStyle = 'street';
        let mapResizeObserver = null;
        let markerLayer = null;
        let clusterGroup = null;
        let cancelProcessing = false;
        let dayRoutePolyline = null;
        let allRouteSegments = [];
        let allCircleMarkers = []; // Track circle markers for zoom-based resizing
        
        // Popup delay functions
        let pendingPopupTimer = null;
        const POPUP_DELAY_MS = 400;
        
        function openPopupDelayed(target, delay = POPUP_DELAY_MS) {
            if (pendingPopupTimer) {
                clearTimeout(pendingPopupTimer);
                pendingPopupTimer = null;
            }
            
            pendingPopupTimer = setTimeout(() => {
                pendingPopupTimer = null;
                if (target && target.openPopup) {
                    target.openPopup();
                    updatePopupZoomLevel();
                }
            }, delay);
        }
        
        function cancelPendingPopup() {
            if (pendingPopupTimer) {
                clearTimeout(pendingPopupTimer);
                pendingPopupTimer = null;
            }
        }
        
        // Calculate marker radius based on zoom level (like Arc Timeline)
        function getMarkerRadius(zoom) {
            // REVERSED LOGIC: Smaller when zoomed out (to avoid confusion with cluster markers)
            // Larger when zoomed in (better for touch interaction)
            // Cluster markers are 40px, so stay well below that when zoomed out
            if (zoom <= 10) return 7;   // Zoomed out: 14px diameter (country view)
            if (zoom <= 13) return 8;   // Medium zoom: 16px diameter
            if (zoom <= 15) return 10;  // Getting closer: 20px diameter
            return 12;                  // Zoomed in: 24px diameter (street level)
        }
        
        // Update zoom level in any open popup (dynamically updates as user zooms)
        function updatePopupZoomLevel() {
            if (!map) return;
            
            const currentZoom = Math.round(map.getZoom() * 10) / 10; // Round to 1 decimal
            const openPopup = map._popup;
            
            if (openPopup) {
                // Skip measure popup and route popup - they shouldn't show zoom
                if (MeasurementTool.isMeasurePopup(openPopup)) {
                    return;
                }
                if (openPopup.options?.className === 'route-popup') {
                    return;
                }
                
                const content = openPopup.getContent();
                // Remove existing zoom line if present
                const contentWithoutZoom = content.replace(/<div class="popup-zoom".*?<\/div>/, '');
                // Add updated zoom line
                const newContent = contentWithoutZoom + `<div class="popup-zoom" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 11px; opacity: 0.7;">Zoom: ${currentZoom}</div>`;
                openPopup.setContent(newContent);
            }
        }
        
        // Set default date range - removed in v3.0 (date range inputs no longer exist)
        
        // Quick year range selector
        // selectYearRange function removed - date range inputs no longer exist in v3.0
        
        // Display version
        document.getElementById('appVersion').textContent = APP_VERSION;
        
        // Year button population removed - Quick Select buttons no longer exist in v3.0
        
        const notesOnlyEl = document.getElementById('notesOnly');
        
        if (notesOnlyEl) {
            notesOnlyEl.addEventListener('change', () => {
                if (currentMonth) {
                    displayDiary(currentMonth, true); // re-render, keep search state stable
                    
                    // Update stats panel after DOM updates
                    setTimeout(() => updateStatsForCurrentView(), 10);
                }
            });
        }
        
        // Raw timeline toggle removed
        
        fileInput.addEventListener('change', async (e) => {
            const allFiles = Array.from(e.target.files);

            // Load custom place names from Arc export (places/*.json), if present
            await loadPlacesFromSelectedFiles(allFiles);
            
            selectedFiles = allFiles.filter(file => {
                return /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(file.name);
            });
            
            const totalFiles = allFiles.length;
            const validFiles = selectedFiles.length;
            
            if (validFiles === 0) {
                fileCount.textContent = `No valid daily JSON files found in this folder`;
                fileCount.style.color = '#d32f2f';
            } else {
                fileCount.textContent = `Found ${validFiles} daily JSON file${validFiles !== 1 ? 's' : ''} - Processing...`;
                if (validFiles < totalFiles) {
                    fileCount.textContent += ` (${totalFiles - validFiles} other files ignored)`;
                }
                fileCount.style.color = '#388e3c';
                fileCount.style.fontWeight = '600';
                
                // v3.0: Import to IndexedDB instead of generating in-memory
                await importFilesToDatabase();
            }
        });
        
        // Initialize import module (if loaded)
        // (setupBackupImportHandler is now called inside import.js init)
        if (window.ArcImportModule) {
            window.ArcImportModule.init({
                // Database access
                getDB: () => db,
                getDayFromDB: getDayFromDB,
                getLocalDayKey: getLocalDayKey,
                getStoredDisplayNameForTimelineItem: getStoredDisplayNameForTimelineItem,
                getStoredActivityTypeForTimelineItem: getStoredActivityTypeForTimelineItem,

                // State access
                getSelectedFiles: () => selectedFiles,
                getCancelProcessing: () => cancelProcessing,
                setCancelProcessing: (val) => { cancelProcessing = val; },

                // Metadata functions
                getMetadata: getMetadata,
                saveMetadata: saveMetadata,

                // UI functions
                addLog: addLog,
                updateDBStatusDisplay: updateDBStatusDisplay,
                loadMostRecentMonth: loadMostRecentMonth,

                // Data processing
                decompressFile: decompressFile,
                applyImportFixes: applyImportFixes,

                // Cache management
                invalidateMonthCache: (affectedMonths) => {
                    affectedMonths.forEach(monthKey => {
                        if (generatedDiaries[monthKey]) {
                            logDebug(`🗑️ Invalidating cache for ${monthKey}`);
                            delete generatedDiaries[monthKey];
                        }
                    });
                },

                // Places management
                updatePlacesById: (placeLookup) => {
                    for (const [placeId, place] of placeLookup) {
                        if (place.name) {
                            placesById[placeId] = place.name;
                        }
                    }
                    saveMetadata('placesById', placesById);
                },

                // Analysis update
                updateAnalysisDataInBackground: updateAnalysisDataInBackground,

                // File input reset
                resetFileInput: () => {
                    fileInput.value = '';
                    selectedFiles = [];
                    fileCount.textContent = '';
                },

                // Update import tracking (syncs import.js state to app.js)
                updateImportTracking: (added, updated, changedIds) => {
                    importAddedDays = added || [];
                    importUpdatedDays = updated || [];
                    importChangedItemIds = changedIds instanceof Set ? changedIds : new Set(changedIds || []);
                }
            });
            logInfo('📦 Import module connected');
        }

        async function openDiaryReader(skipMapInit = false) {
            // Check if we have data - either in old generatedDiaries or in IndexedDB
            const hasOldData = Object.keys(generatedDiaries).length > 0;
            let hasDbData = db && monthKeys && monthKeys.length > 0;
            
            // If DB exists but monthKeys not loaded, try loading
            if (db && !hasDbData) {
                try {
                    await loadMostRecentMonth();
                    hasDbData = monthKeys && monthKeys.length > 0;
                } catch (e) {
                    console.error('Failed to load data:', e);
                }
            }
            
            if (!hasOldData && !hasDbData) {
                alert('Please import data first');
                return;
            }
				modalOverlay.style.display = 'block';
				document.body.style.overflow = 'hidden';
				
				const modalDialog = document.querySelector('.modal-dialog');
				
				// Prevent visible “jump”: initialise hidden, lock position, then fade in
				if (modalDialog) {
					 modalDialog.style.animation = 'none';              // avoid slideIn (uses transform)
					 modalDialog.style.transition = 'opacity 0.15s ease';
					 modalDialog.style.opacity = '0';
					 modalDialog.style.visibility = 'hidden';
				}
				
				if (modalDialog && !modalDialog.dataset.positionFixed) {
					 requestAnimationFrame(() => {
						  // While still hidden, capture where it is and lock that as top/left
						  const rect = modalDialog.getBoundingClientRect();
						  modalDialog.style.top = rect.top + 'px';
						  modalDialog.style.left = rect.left + 'px';
						  modalDialog.style.transform = 'none';
						  modalDialog.dataset.positionFixed = 'true';
				
						  // Next frame: reveal (now it will appear already “settled”)
						  requestAnimationFrame(() => {
								modalDialog.style.visibility = 'visible';
								modalDialog.style.opacity = '1';
						  });
					 });
				} else if (modalDialog) {
					 // Already fixed: just reveal cleanly
					 requestAnimationFrame(() => {
						  modalDialog.style.visibility = 'visible';
						  modalDialog.style.opacity = '1';
					 });
				}            
            
				// Re-render diary on open to restore click handlers (search/innerHTML operations can wipe them)
				if (!currentMonth) {
					 currentMonth = monthKeys[0] || monthSelector.value;
				}
				if (currentMonth) {
					 // Set year and month from currentMonth
					 currentYear = currentMonth.split('-')[0];
					 currentMonthNum = parseInt(currentMonth.split('-')[1]);
					 
					 // Populate selectors with options FIRST
					 await populateYearAndMonthSelectors();
					 
					 // CRITICAL: Reload from DB if cache was invalidated (e.g., after import)
					 if (!generatedDiaries[currentMonth]) {
					     logDebug(`📥 Cache miss for ${currentMonth}, reloading from DB...`);
					     await loadMonthFromDatabase(currentMonth);
					 } else {
					     displayDiary(currentMonth, true); // skipSearch=true, but rebind all click handlers
					 }
				}
				
				// Wait for initialization to complete
				await new Promise(resolve => {
					setTimeout(() => {
						 initializeMapPanel(skipMapInit);
						 initializeDiaryResize();
						 initializeResponsiveDiaryHeader();
						 
						 // Set build number in diary header
						 const diaryBuild = document.getElementById('diaryBuild');
						 if (diaryBuild) {
						     diaryBuild.textContent = `Build ${BUILD}`;
						 }
						 
						 initializeFocusHandling();
						 // Load saved transparency setting from localStorage
						 loadTransparencySetting();
						 // Set initial transparency based on map style (unless custom value is set)
						 updateDiaryTransparencyForMapStyle(currentMapStyle);
						 
						 // Initialize NavigationController viewport margins
						 const diaryFloat = document.querySelector('.diary-float');
						 const statsFloat = document.getElementById('statsFloat');
						 if (diaryFloat) {
						     const diaryWidth = diaryFloat.offsetWidth || 0;
						     const statsWidth = (statsFloat && statsFloat.style.display !== 'none') ? (statsFloat.offsetWidth || 0) : 0;
						     NavigationController.updateViewportMargins({
						         left: diaryWidth,
						         right: statsWidth,
						         sliderLeft: 0
						     }, { delay: 0 });
						 }
						 
						 // Resolve after everything is initialized
						 resolve();
					}, 100);
				});
				
				// Handle URL parameters (deep links from Analysis tool)
				await handleUrlParameters();
        }
        
        // Handle URL parameters for deep linking (e.g., ?day=2024-03-15 or ?date=2024-03-15 or ?month=2024-03)
        // Communication interface with standalone Analysis tool
        async function handleUrlParameters() {
            const urlParams = new URLSearchParams(window.location.search);
            const dayParam = urlParams.get('day') || urlParams.get('date');
            const monthParam = urlParams.get('month');
            
            // Clear URL params after reading (don't pollute browser history)
            if (dayParam || monthParam) {
                window.history.replaceState({}, '', window.location.pathname);
            }
            
            if (dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)) {
                logDebug(`🔗 URL parameter: day=${dayParam}`);
                
                // Navigate via NavigationController
                await NavigationController.selectEntry(null, dayParam, { source: 'url' });
            } else if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
                logDebug(`🔗 URL parameter: month=${monthParam}`);
                
                // Navigate to month view
                await navigateToMonth(monthParam);
            }
        }
        
        function closeDiaryReader() {
            modalOverlay.style.display = 'none';
            document.body.style.overflow = 'auto';

            // Close route search popup if open
            if (typeof window.closeSearchPopup === 'function') {
                window.closeSearchPopup();
            }

				// Just reset the search UI state.
				searchInput.value = '';
				searchCount.textContent = '';
				currentSearchIndex = -1;
				allSearchMatches = [];
				currentMonthMatches = [];
				prevSearchBtn.disabled = true;
				nextSearchBtn.disabled = true;
            
            // Reset modal position for next open
            const modalDialog = document.querySelector('.modal-dialog');
            if (modalDialog) {
					 modalDialog.style.top = '50%';
					 modalDialog.style.left = '50%';
					 modalDialog.style.transform = 'translate(-50%, -50%)';
					 delete modalDialog.dataset.positionFixed;
				
					 // Reset visibility/animation overrides used for no-jump opening
					 modalDialog.style.opacity = '';
					 modalDialog.style.visibility = '';
					 modalDialog.style.transition = '';
					 modalDialog.style.animation = '';
				
					 // Reset draggable init so it reinitializes properly
					 const header = document.querySelector('.modal-header');
					 if (header) delete header.dataset.draggableInit;
				}
            
            if (mapResizeObserver) {
                mapResizeObserver.disconnect();
                mapResizeObserver = null;
            }
        }
        
        async function navigateMonth(direction) {
            const currentIndex = monthKeys.indexOf(currentMonth);
            const newIndex = currentIndex + direction;
            
            if (newIndex >= 0 && newIndex < monthKeys.length) {
                const newMonth = monthKeys[newIndex];
                
                // Use helper function to load and display
                await loadAndDisplayMonth(newMonth);
                
                // Update year and month selectors
                yearSelector.value = currentYear;
                monthSelector.value = currentMonthNum;
                
                // Reset day index
                currentDayIndex = -1;
                
                // Update nav buttons
                updateMonthNavButtons();
            }
        }
        
        function updateMonthNavButtons() {
            const currentIndex = monthKeys.indexOf(currentMonth);
            prevMonthBtn.disabled = currentIndex <= 0;
            nextMonthBtn.disabled = currentIndex >= monthKeys.length - 1;
        }
        
        // Day navigation
        let currentDayIndex = 0;
        let currentLocationIndex = 0; // Track current location for up/down navigation
        
        
        // ============================================================
        // NAVIGATION CONTROLLER (ES6 Class)
        // Single source of truth for navigation state.
        // All navigation must go through this controller.
        // See: STATE_MODEL.md for rules.
        // ============================================================
        class NavigationControllerClass {
            // ═══════════════════════════════════════════════════════════════
            // PRIVATE STATE - only this class can modify
            // ═══════════════════════════════════════════════════════════════
            #monthKey = null;
            #dayKey = null;
            #entryId = null;
            #entryIndex = 0;
            #atDayLevel = false;
            #renderVersion = 0;
            #internalCall = false;
            
            // Viewport margin state (pixels from each edge that are obstructed)
            #margins = {
                left: 0,      // Diary panel width
                sliderLeft: 0, // Search slider width (added to left)
                right: 0,     // Stats panel width
                top: 95,      // Title bar (8px margin + 72px height + 15px gap)
                bottom: 0
            };
            
            // ═══════════════════════════════════════════════════════════════
            // PUBLIC GETTERS - read-only access to state
            // ═══════════════════════════════════════════════════════════════
            get monthKey() { return this.#monthKey; }
            get dayKey() { return this.#dayKey; }
            get entryId() { return this.#entryId; }
            get entryIndex() { return this.#entryIndex; }
            get atDayLevel() { return this.#atDayLevel; }
            get renderVersion() { return this.#renderVersion; }
            get margins() { return { ...this.#margins }; }  // Return copy to prevent mutation
            
            // Legacy getters for backwards compatibility
            get selectedMonthKey() { return this.#monthKey; }
            get selectedDayKey() { return this.#dayKey; }
            get selectedEntryId() { return this.#entryId; }
            get selectedEntryIndex() { return this.#entryIndex; }
            
            /**
             * Get current map padding for fitBounds operations
             * @returns {{paddingTopLeft: [number, number], paddingBottomRight: [number, number]}}
             */
            get mapPadding() {
                const buffer = 20; // Extra buffer around content
                return {
                    paddingTopLeft: [this.#margins.left + this.#margins.sliderLeft + buffer, this.#margins.top + buffer],
                    paddingBottomRight: [this.#margins.right + buffer, this.#margins.bottom + buffer]
                };
            }
            
            // ═══════════════════════════════════════════════════════════════
            // VIEWPORT MARGIN MANAGEMENT
            // ═══════════════════════════════════════════════════════════════
            
            /**
             * Update viewport margins and refit map to new bounds
             * @param {Object} margins - Partial margins to update {left?, sliderLeft?, right?, top?, bottom?}
             * @param {Object} options - {animate?: boolean, delay?: number}
             */
            updateViewportMargins(margins, options = {}) {
                const { animate = true, delay = 0, noRefit = false } = options;
                
                // Update only provided margins
                if (margins.left !== undefined) this.#margins.left = margins.left;
                if (margins.sliderLeft !== undefined) this.#margins.sliderLeft = margins.sliderLeft;
                if (margins.right !== undefined) this.#margins.right = margins.right;
                if (margins.top !== undefined) this.#margins.top = margins.top;
                if (margins.bottom !== undefined) this.#margins.bottom = margins.bottom;
                
                logDebug(`🗺️ updateMargins: L=${this.#margins.left} slider=${this.#margins.sliderLeft} R=${this.#margins.right} T=${this.#margins.top}`);

                // Reposition elevation panel if visible
                if (typeof positionElevationPanel === 'function') {
                    positionElevationPanel();
                }

                // Skip refit entirely if explicitly requested (caller handles positioning)
                if (noRefit) {
                    if (map) map.invalidateSize();
                    return;
                }
                
                // Refit map after optional delay (for animations)
                const doRefit = () => {
                    if (!map) return;
                    
                    map.invalidateSize();
                    
                    // Skip refit if fitBounds was called recently (within 500ms)
                    // This prevents margin changes from overriding intentional zoom operations
                    const timeSinceFitBounds = Date.now() - (window._lastFitBoundsTime || 0);
                    if (timeSinceFitBounds < 500) {
                        logDebug(`🗺️ updateMargins: skipping refit (fitBounds was ${timeSinceFitBounds}ms ago)`);
                        return;
                    }
                    
                    // If route search has active route, refit to those bounds
                    if (window.routeSearchLayer) {
                        map.fitBounds(window.routeSearchLayer.getBounds(), { padding: [50, 50] });
                        return;
                    }
                    
                    // If we have a highlighted location entry, pan to it
                    const highlighted = document.querySelector('li.diary-highlight .location-data');
                    if (highlighted) {
                        const lat = parseFloat(highlighted.dataset.lat);
                        const lng = parseFloat(highlighted.dataset.lng);
                        if (!isNaN(lat) && !isNaN(lng)) {
                            this.#panToWithOffset(lat, lng, null, animate);
                            return;
                        }
                    }
                    
                    // Refit bounds with current padding
                    refitMapBounds(true);
                };
                
                if (delay > 0) {
                    setTimeout(doRefit, delay);
                } else {
                    doRefit();
                }
            }
            
            /**
             * Pan map to location with offset for obstructed areas
             * @private
             */
            #panToWithOffset(lat, lng, zoom = null, animate = true) {
                if (!map) return;
                
                // Calculate offset to center target in visible area (between UI panels)
                // Visible area: left edge at (left + sliderLeft), right edge at (mapWidth - right)
                // To center: shift map by (leftObstruction - rightObstruction) / 2
                const leftObstruction = this.#margins.left + this.#margins.sliderLeft;
                const rightObstruction = this.#margins.right;
                const horizontalOffsetPixels = (leftObstruction - rightObstruction) / 2;
                
                // Vertical: shift by (topObstruction - bottomObstruction) / 2
                const topObstruction = this.#margins.top;
                const bottomObstruction = this.#margins.bottom;
                const verticalOffsetPixels = (topObstruction - bottomObstruction) / 2;
                
                logDebug(`📍 panTo: target=(${lat.toFixed(5)},${lng.toFixed(5)}), offset=(${horizontalOffsetPixels}px,${verticalOffsetPixels}px)`);
                
                // Visual debug: show target point on map (persists until next command)
                if (window.__ARC_DEBUG_LOGS__) {
                    // Remove all previous debug elements
                    if (window._debugBoundsRect) {
                        window._debugBoundsRect.remove();
                        window._debugBoundsRect = null;
                    }
                    if (window._debugBoundsLabel) {
                        window._debugBoundsLabel.remove();
                        window._debugBoundsLabel = null;
                    }
                    if (window._debugTargetMarker) {
                        window._debugTargetMarker.remove();
                    }
                    if (window._debugTargetLabel) {
                        window._debugTargetLabel.remove();
                    }
                    
                    // Draw circle at target location
                    window._debugTargetMarker = L.circleMarker([lat, lng], {
                        radius: 15,
                        color: '#00ff00',
                        weight: 3,
                        fillColor: '#00ff00',
                        fillOpacity: 0.3,
                        interactive: false
                    }).addTo(map);
                    
                    // Add label
                    window._debugTargetLabel = L.marker([lat, lng], {
                        icon: L.divIcon({
                            className: 'debug-target-label',
                            html: `<div style="background:rgba(0,200,0,0.8);color:white;padding:2px 6px;border-radius:3px;font-size:11px;white-space:nowrap;">panTo</div>`,
                            iconSize: [60, 20],
                            iconAnchor: [30, -10]
                        }),
                        interactive: false
                    }).addTo(map);
                }
                
                const targetZoom = zoom !== null ? zoom : map.getZoom();
                const targetPoint = map.project([lat, lng], targetZoom);
                const offsetPoint = L.point(
                    targetPoint.x - horizontalOffsetPixels,
                    targetPoint.y + verticalOffsetPixels
                );
                const offsetLatLng = map.unproject(offsetPoint, targetZoom);
                
                // Calculate zoom delta for adaptive animation speed
                const currentZoom = map.getZoom();
                const zoomDelta = Math.abs(targetZoom - currentZoom);
                
                // Slow down animation for large zoom changes (> 3 levels)
                let duration = 0.8;
                if (zoomDelta > 3) {
                    duration = 0.4 + (zoomDelta * 0.15); // Base 0.4s + 0.15s per zoom level
                    duration = Math.min(duration, 1.5); // Cap at 1.5s
                    logDebug(`📍 panTo: zoomDelta=${zoomDelta.toFixed(1)}, duration=${duration.toFixed(2)}s`);
                }
                
                const animateOptions = animate ? { animate: true, duration } : { animate: false };
                
                if (zoom !== null) {
                    map.setView(offsetLatLng, zoom, animateOptions);
                } else {
                    map.panTo(offsetLatLng, animateOptions);
                }
            }
            
            /**
             * Public method to pan to a location with viewport offset
             * Used by map display functions
             */
            panToLocation(lat, lng, zoom = null, animate = true) {
                this.#panToWithOffset(lat, lng, zoom, animate);
            }
            
            // ═══════════════════════════════════════════════════════════════
            // PUBLIC ACTIONS - the ONLY way to change state
            // ═══════════════════════════════════════════════════════════════
            
            /**
             * Reset selection state (e.g., after month dropdown change)
             * Clears day/entry selection, puts controller in "no selection" state
             */
            reset() {
                logDebug(`🎯 NavigationController.reset()`);
                this.#dayKey = null;
                this.#entryId = null;
                this.#entryIndex = 0;
                this.#atDayLevel = false;
                
                // Sync legacy globals
                currentDayIndex = -1;
                currentLocationIndex = 0;
                
                // Clear highlights
                clearDayHighlights();
                clearLocationHighlights();
            }
            
            /**
             * Select a month - loads and displays the month
             * @param {string} monthKey - YYYY-MM format
             * @returns {Promise<boolean>} - true if successful
             */
            async selectMonth(monthKey, options = {}) {
                if (!this.#internalCall) {
                    this.#renderVersion++;
                }
                const version = this.#renderVersion;
                
                logDebug(`🎯 NavigationController.selectMonth(${monthKey})`);
                
                // Clear route search if active (user is returning to diary mode)
                if (window.routeSearchLayer && !options.preserveRouteSearch && !window.routeSearchState?.active) {
                    clearRouteSearch();
                    if (typeof showDiaryRoutes === 'function') {
                        showDiaryRoutes();
                    }
                }
                
                // Update state
                this.#monthKey = monthKey;
                
                // Load and display
                await loadAndDisplayMonth(monthKey);
                
                // Async safety check
                if (this.#renderVersion !== version) {
                    logDebug(`⚠️ selectMonth(${monthKey}) superseded`);
                    return false;
                }
                return true;
            }
            
            /**
             * Select a day within current month
             * @param {string} dayKey - YYYY-MM-DD format
             */
            selectDay(dayKey, options = {}) {
                this.#renderVersion++;
                logDebug(`🎯 NavigationController.selectDay(${dayKey})`);
                
                // Clear route search if active (user is returning to diary mode)
                if (window.routeSearchLayer && !options.preserveRouteSearch && !window.routeSearchState?.active) {
                    clearRouteSearch();
                    if (typeof showDiaryRoutes === 'function') {
                        showDiaryRoutes();
                    }
                }
                
                // Update state
                this.#dayKey = dayKey;
                this.#entryId = null;
                this.#atDayLevel = true;
                
                // Sync legacy globals (but NOT currentDayKey yet - map needs to compare)
                const days = getDaysInCurrentMonth();
                currentDayIndex = days.indexOf(dayKey);
                if (currentDayIndex === -1) currentDayIndex = 0;
                
                // Find first entry of this day for keyboard nav continuity
                const entries = getLocationsInCurrentMonth();
                const firstEntryIdx = entries.findIndex(li => {
                    const locData = li.querySelector('.location-data');
                    return locData && locData.dataset.daykey === dayKey;
                });
                if (firstEntryIdx !== -1) {
                    currentLocationIndex = firstEntryIdx;
                    this.#entryIndex = firstEntryIdx;
                }
                
                // Render
                clearDayHighlights();
                clearLocationHighlights();
                highlightAndScrollToDay(dayKey, { instant: !!options.instant });
                showDayMap(dayKey);
                
                // NOW update currentDayKey (after map has checked/rebuilt)
                currentDayKey = dayKey;
            }
            
            /**
             * Select an entry from diary/map click
             * @param {string} entryId - Entry identifier
             * @param {string} dayKey - YYYY-MM-DD format
             * @param {Object} options - {source, type, startTime, lat, lng}
             * @returns {Promise<boolean>}
             */
            async selectEntry(entryId, dayKey, options = {}) {
                this.#renderVersion++;
                const version = this.#renderVersion;

                logDebug(`🎯 NavigationController.selectEntry(${entryId}, ${dayKey}, ${options.source || 'unknown'})`);

                // Handle replay mode interactions
                if (window.replayState && window.replayState.active) {
                    const replayDayKey = window.replayState.selectedDayKey;

                    if (dayKey === replayDayKey) {
                        // Same day - pause replay and seek to entry's start time
                        let seekTime = null;

                        if (options.startTime) {
                            // Activity click - startTime is already a timestamp
                            seekTime = options.startTime;
                        } else if (options.date) {
                            // Location click - date is ISO string
                            seekTime = new Date(options.date).getTime();
                        }

                        if (seekTime && typeof window.replaySeekToTime === 'function') {
                            window.replaySeekToTime(seekTime);

                            // Still highlight the entry in the diary
                            const entries = getLocationsInCurrentMonth();
                            const entryIndex = this.#findEntryIndex(entries, entryId, options, dayKey);
                            clearDiaryHighlights();
                            if (entryIndex !== -1 && entries[entryIndex]) {
                                entries[entryIndex].classList.add('diary-highlight');
                                entries[entryIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                            return true;
                        }
                    } else {
                        // Different day - close replay and proceed with normal navigation
                        if (typeof window.closeReplayController === 'function') {
                            window.closeReplayController();
                        }
                    }
                }

                // Clear route search if active (user is returning to diary mode)
                if (window.routeSearchLayer && !options.preserveRouteSearch && !window.routeSearchState?.active) {
                    clearRouteSearch();
                    if (typeof showDiaryRoutes === 'function') {
                        showDiaryRoutes();
                    }
                }

                // Ensure correct month is loaded
                const monthKey = dayKey.substring(0, 7);
                if (currentMonth !== monthKey) {
                    this.#internalCall = true;
                    const success = await this.selectMonth(monthKey);
                    this.#internalCall = false;
                    if (!success) return false;
                }
                
                // Async safety check
                if (this.#renderVersion !== version) {
                    logDebug(`⚠️ selectEntry superseded`);
                    return false;
                }
                
                // Update state
                this.#monthKey = monthKey;
                this.#dayKey = dayKey;
                this.#entryId = entryId;
                this.#atDayLevel = false;
                
                // Sync legacy globals
                const days = getDaysInCurrentMonth();
                currentDayIndex = days.indexOf(dayKey);
                if (currentDayIndex === -1) currentDayIndex = 0;
                
                // Show on map
                if (options.type === 'activity' && options.startTime) {
                    showActivityRoutePopup(dayKey, options.startTime);
                } else if (options.lat !== undefined && options.lng !== undefined) {
                    showDayMap(dayKey, options.lat, options.lng);
                } else {
                    showDayMap(dayKey);
                }
                
                // Find and highlight entry
                const entries = getLocationsInCurrentMonth();
                const entryIndex = this.#findEntryIndex(entries, entryId, options, dayKey);
                if (entryIndex !== -1) {
                    currentLocationIndex = entryIndex;
                    this.#entryIndex = entryIndex;
                }
                
                // Render highlight
                clearDiaryHighlights();
                clearDayHighlights();
                if (entryIndex !== -1 && entries[entryIndex]) {
                    entries[entryIndex].classList.add('diary-highlight');
                    entries[entryIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                
                return true;
            }
            
            /**
             * Navigate by delta (keyboard navigation)
             * @param {number} delta - +1 for next, -1 for previous
             * @param {string} level - 'day' or 'entry'
             * @returns {Promise<boolean>}
             */
            async navigateBy(delta, level = 'entry') {
                this.#renderVersion++;
                const version = this.#renderVersion;
                logDebug(`🎯 NavigationController.navigateBy(${delta}, ${level})`);
                
                if (level === 'day') {
                    return this.#navigateByDay(delta, version);
                } else {
                    return this.#navigateByEntry(delta, version);
                }
            }
            
            /**
             * Navigate to next/previous month
             * @param {number} delta - +1 for next, -1 for previous
             * @returns {Promise<boolean>}
             */
            async navigateMonth(delta) {
                this.#renderVersion++;
                const version = this.#renderVersion;
                logDebug(`🎯 NavigationController.navigateMonth(${delta})`);
                
                const monthKey = this.#monthKey || currentMonth;
                const currentIndex = monthKeys.indexOf(monthKey);
                const newIndex = currentIndex + delta;
                
                if (newIndex < 0 || newIndex >= monthKeys.length) {
                    return false;
                }
                
                const newMonth = monthKeys[newIndex];
                
                // Clear selection - going to month level
                this.#dayKey = null;
                this.#entryId = null;
                this.#atDayLevel = false;
                
                // Load month
                await this.selectMonth(newMonth);
                if (this.#renderVersion !== version) return false;
                
                // Update selectors
                const yearSelector = document.getElementById('yearSelector');
                const monthSelector = document.getElementById('monthSelector');
                if (yearSelector) yearSelector.value = currentYear;
                if (monthSelector) monthSelector.value = currentMonthNum;
                
                // Reset indices
                currentDayIndex = -1;
                currentLocationIndex = 0;
                
                // Clear highlights
                clearDayHighlights();
                clearLocationHighlights();
                
                updateMonthNavButtons();
                return true;
            }
            
            /**
             * Select entry from map marker click
             * @param {number} lat
             * @param {number} lng
             * @param {string} dayKey - optional
             * @returns {boolean}
             */
            selectEntryFromMap(lat, lng, dayKey = null) {
                logDebug(`🎯 NavigationController.selectEntryFromMap(${lat}, ${lng}, ${dayKey})`);
                
                this.#atDayLevel = false;
                
                const entries = getLocationsInCurrentMonth();
                for (let i = 0; i < entries.length; i++) {
                    const li = entries[i];
                    const locData = li.querySelector('.location-data');
                    if (!locData) continue;
                    
                    if (dayKey && locData.dataset.daykey !== dayKey) continue;
                    
                    const entryLat = parseFloat(locData.dataset.lat);
                    const entryLng = parseFloat(locData.dataset.lng);
                    
                    if (Math.abs(entryLat - lat) < 0.00001 && Math.abs(entryLng - lng) < 0.00001) {
                        // Update state
                        this.#entryIndex = i;
                        this.#entryId = `${lat},${lng}`;
                        this.#dayKey = locData.dataset.daykey;
                        currentLocationIndex = i;
                        
                        // Render
                        clearDiaryHighlights();
                        clearDayHighlights();
                        li.classList.add('diary-highlight');
                        li.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        return true;
                    }
                }
                return false;
            }
            
            /**
             * Select entry from map by placeId
             * @param {string} placeId
             * @returns {boolean}
             */
            selectEntryFromMapById(placeId) {
                logDebug(`🎯 NavigationController.selectEntryFromMapById(${placeId})`);
                
                this.#atDayLevel = false;
                
                const locationData = markdownContent.querySelector(`[data-place-id="${placeId}"]`);
                if (!locationData) return false;
                
                const listItem = locationData.closest('li');
                if (!listItem) return false;
                
                const entries = getLocationsInCurrentMonth();
                const idx = entries.indexOf(listItem);
                
                if (idx !== -1) {
                    // Update state
                    this.#entryIndex = idx;
                    this.#dayKey = locationData.dataset.daykey;
                    const lat = parseFloat(locationData.dataset.lat);
                    const lng = parseFloat(locationData.dataset.lng);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        this.#entryId = `${lat},${lng}`;
                    }
                    currentLocationIndex = idx;
                    
                    // Render
                    clearDiaryHighlights();
                    clearDayHighlights();
                    listItem.classList.add('diary-highlight');
                    listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return true;
                }
                return false;
            }
            
            /**
             * Go to first entry of current month (Home key)
             * @returns {boolean}
             */
            goToFirst() {
                logDebug(`🎯 NavigationController.goToFirst()`);
                
                const monthKey = this.#monthKey || currentMonth;
                if (!monthKey) return false;
                
                const domEntries = getLocationsInCurrentMonth();
                if (domEntries.length === 0) return false;
                
                return this.#selectDomEntry(domEntries, 0, monthKey);
            }
            
            /**
             * Go to last entry of current month (End key)
             * @returns {boolean}
             */
            goToLast() {
                logDebug(`🎯 NavigationController.goToLast()`);
                
                const monthKey = this.#monthKey || currentMonth;
                if (!monthKey) return false;
                
                const domEntries = getLocationsInCurrentMonth();
                if (domEntries.length === 0) return false;
                
                const lastIdx = domEntries.length - 1;
                return this.#selectDomEntry(domEntries, lastIdx, monthKey);
            }
            
            // ═══════════════════════════════════════════════════════════════
            // PRIVATE METHODS
            // ═══════════════════════════════════════════════════════════════
            
            async #navigateByDay(delta, version) {
                const monthKey = this.#monthKey || currentMonth;
                if (!monthKey) return false;
                const fromDayKey = this.#dayKey || currentDayKey || null;
                
                const days = getDaysFromModel(monthKey);
                if (days.length === 0) return false;
                
                // No selection state - conceptually "before" the month
                if (this.#dayKey === null && this.#entryId === null) {
                    if (delta > 0) {
                        // Right → first day
                        this.selectDay(days[0], { instant: shouldUseInstantDayJump(fromDayKey, days[0]) });
                    } else {
                        // Left → previous month's last day
                        const prevMonthIdx = monthKeys.indexOf(monthKey) - 1;
                        if (prevMonthIdx < 0) return false;
                        
                        const prevMonth = monthKeys[prevMonthIdx];
                        this.#internalCall = true;
                        await this.selectMonth(prevMonth);
                        this.#internalCall = false;
                        if (this.#renderVersion !== version) return false;
                        
                        const prevDays = getDaysFromModel(prevMonth);
                        if (prevDays.length > 0) {
                            const targetDay = prevDays[prevDays.length - 1];
                            this.selectDay(targetDay, { instant: shouldUseInstantDayJump(fromDayKey, targetDay) });
                        }
                    }
                    return true;
                }
                
                // Find current position
                let currentIdx = days.indexOf(this.#dayKey || currentDayKey);
                if (currentIdx === -1) currentIdx = 0;
                
                // At entry level - behavior depends on direction
                if (!this.#atDayLevel) {
                    if (delta < 0) {
                        // Left: go to current day's day level
                        this.selectDay(days[currentIdx], { instant: shouldUseInstantDayJump(fromDayKey, days[currentIdx]) });
                        return true;
                    }
                    // Right: fall through to next day
                }
                
                // Navigate to adjacent day
                const newIdx = currentIdx + delta;
                
                // Handle month boundaries
                if (newIdx < 0) {
                    const prevMonthIdx = monthKeys.indexOf(monthKey) - 1;
                    if (prevMonthIdx < 0) return false;
                    
                    const prevMonth = monthKeys[prevMonthIdx];
                    this.#internalCall = true;
                    await this.selectMonth(prevMonth);
                    this.#internalCall = false;
                    if (this.#renderVersion !== version) return false;
                    
                    const prevDays = getDaysFromModel(prevMonth);
                    if (prevDays.length > 0) {
                        const targetDay = prevDays[prevDays.length - 1];
                        this.selectDay(targetDay, { instant: shouldUseInstantDayJump(fromDayKey, targetDay) });
                    }
                    return true;
                }
                
                if (newIdx >= days.length) {
                    const nextMonthIdx = monthKeys.indexOf(monthKey) + 1;
                    if (nextMonthIdx >= monthKeys.length) return false;
                    
                    const nextMonth = monthKeys[nextMonthIdx];
                    this.#internalCall = true;
                    await this.selectMonth(nextMonth);
                    this.#internalCall = false;
                    if (this.#renderVersion !== version) return false;
                    
                    const nextDays = getDaysFromModel(nextMonth);
                    if (nextDays.length > 0) {
                        const targetDay = nextDays[0];
                        this.selectDay(targetDay, { instant: shouldUseInstantDayJump(fromDayKey, targetDay) });
                    }
                    return true;
                }
                
                // Same month
                this.selectDay(days[newIdx], { instant: shouldUseInstantDayJump(fromDayKey, days[newIdx]) });
                return true;
            }
            
            async #navigateByEntry(delta, version) {
                const monthKey = this.#monthKey || currentMonth;
                if (!monthKey) return false;
                
                const domEntries = getLocationsInCurrentMonth();
                logDebug(`🔢 #navigateByEntry: delta=${delta}, entries=${domEntries.length}, atDayLevel=${this.#atDayLevel}`);
                if (domEntries.length === 0) return false;
                
                // Day level navigation
                if (this.#atDayLevel) {
                    this.#atDayLevel = false;
                    
                    if (delta > 0) {
                        // Down → first entry of current day
                        return this.#selectDomEntry(domEntries, currentLocationIndex, monthKey);
                    } else {
                        // Up → last entry of previous day
                        const newIdx = currentLocationIndex - 1;
                        if (newIdx < 0) {
                            return this.#goToPreviousMonthLastEntry(version);
                        }
                        return this.#selectDomEntry(domEntries, newIdx, monthKey);
                    }
                }
                
                // No selection state
                if (this.#entryId === null) {
                    if (delta > 0) {
                        // Down → first entry
                        return this.#selectDomEntry(domEntries, 0, monthKey);
                    } else {
                        // Up → previous month's last entry
                        return this.#goToPreviousMonthLastEntry(version);
                    }
                }
                
                // Normal entry navigation
                let currentIdx = currentLocationIndex;
                if (currentIdx < 0 || currentIdx >= domEntries.length) {
                    currentIdx = 0;
                }
                
                const newIdx = currentIdx + delta;
                logDebug(`🔢 currentIdx=${currentIdx}, newIdx=${newIdx}`);
                
                // Previous month boundary
                if (newIdx < 0) {
                    return this.#goToPreviousMonthLastEntry(version);
                }
                
                // Next month boundary
                if (newIdx >= domEntries.length) {
                    return this.#goToNextMonthFirstEntry(version);
                }
                
                // Same month
                return this.#selectDomEntry(domEntries, newIdx, monthKey);
            }
            
            async #goToPreviousMonthLastEntry(version) {
                const monthKey = this.#monthKey || currentMonth;
                const prevMonthIdx = monthKeys.indexOf(monthKey) - 1;
                if (prevMonthIdx < 0) return false;
                
                const prevMonth = monthKeys[prevMonthIdx];
                logDebug(`🔢 Going to previous month: ${prevMonth}`);
                
                this.#internalCall = true;
                await this.selectMonth(prevMonth);
                this.#internalCall = false;
                if (this.#renderVersion !== version) return false;
                
                const prevDomEntries = getLocationsInCurrentMonth();
                if (prevDomEntries.length > 0) {
                    const lastIdx = prevDomEntries.length - 1;
                    currentLocationIndex = lastIdx;
                    return this.#selectDomEntry(prevDomEntries, lastIdx, prevMonth);
                }
                return false;
            }
            
            async #goToNextMonthFirstEntry(version) {
                const monthKey = this.#monthKey || currentMonth;
                const nextMonthIdx = monthKeys.indexOf(monthKey) + 1;
                if (nextMonthIdx >= monthKeys.length) return false;
                
                const nextMonth = monthKeys[nextMonthIdx];
                logDebug(`🔢 Going to next month: ${nextMonth}`);
                
                this.#internalCall = true;
                await this.selectMonth(nextMonth);
                this.#internalCall = false;
                if (this.#renderVersion !== version) return false;
                
                const nextDomEntries = getLocationsInCurrentMonth();
                if (nextDomEntries.length > 0) {
                    currentLocationIndex = 0;
                    return this.#selectDomEntry(nextDomEntries, 0, nextMonth);
                }
                return false;
            }
            
            #selectDomEntry(domEntries, idx, monthKey) {
                if (idx < 0 || idx >= domEntries.length) return false;
                
                const li = domEntries[idx];
                const locationData = li.querySelector('.location-data');
                if (!locationData) return false;
                
                const dayKey = locationData.dataset.daykey;
                const lat = parseFloat(locationData.dataset.lat);
                const lng = parseFloat(locationData.dataset.lng);
                const startDate = locationData.dataset.startDate;
                const isActivity = locationData.dataset.type === 'activity';
                
                // Update state
                this.#monthKey = monthKey;
                this.#dayKey = dayKey;
                this.#entryIndex = idx;
                this.#atDayLevel = false;
                
                if (isActivity && startDate) {
                    this.#entryId = `activity-${new Date(startDate).getTime()}`;
                } else if (!isNaN(lat) && !isNaN(lng)) {
                    this.#entryId = `${lat},${lng}`;
                }
                
                // Sync legacy globals (but NOT currentDayKey yet - map functions need to compare)
                currentLocationIndex = idx;
                const days = getDaysInCurrentMonth();
                currentDayIndex = days.indexOf(dayKey);
                if (currentDayIndex === -1) currentDayIndex = 0;
                
                // Render: highlight diary
                clearLocationHighlights();
                clearDayHighlights();
                
                li.classList.add('diary-highlight');
                const diaryPanel = document.querySelector('.diary-panel');
                if (diaryPanel) {
                    const itemRect = li.getBoundingClientRect();
                    const panelRect = diaryPanel.getBoundingClientRect();
                    const scrollTop = itemRect.top - panelRect.top + diaryPanel.scrollTop - 60;
                    diaryPanel.scrollTo({ top: scrollTop, behavior: 'smooth' });
                }
                
                // Render: show on map (BEFORE updating currentDayKey so map knows if day changed)
                if (isActivity && startDate) {
                    showActivityRoutePopup(dayKey, new Date(startDate).getTime());
                } else if (!isNaN(lat) && !isNaN(lng)) {
                    showDayMap(dayKey, lat, lng);
                } else {
                    showDayMap(dayKey);
                }
                
                // NOW update currentDayKey (after map has checked/rebuilt)
                currentDayKey = dayKey;
                
                return true;
            }
            
            #findEntryIndex(entries, entryId, options, dayKey) {
                for (let i = 0; i < entries.length; i++) {
                    const li = entries[i];
                    const locationData = li.querySelector('.location-data');
                    if (!locationData) continue;
                    
                    if (dayKey && locationData.dataset.daykey !== dayKey) continue;
                    
                    if (options.type === 'activity' && options.startTime) {
                        const startDate = locationData.dataset.startDate;
                        if (startDate) {
                            const entryTime = new Date(startDate).getTime();
                            if (entryTime === options.startTime) return i;
                        }
                    } else if (options.lat !== undefined && options.lng !== undefined) {
                        const lat = parseFloat(locationData.dataset.lat);
                        const lng = parseFloat(locationData.dataset.lng);
                        const entryDate = locationData.dataset.date;
                        
                        // If date is provided, use it for unique matching (handles same location visited multiple times)
                        if (options.date && entryDate) {
                            if (options.date === entryDate) {
                                return i;
                            }
                        } else {
                            // Fallback to coordinate matching (for map clicks)
                            if (Math.abs(lat - options.lat) < 0.00001 && Math.abs(lng - options.lng) < 0.00001) {
                                return i;
                            }
                        }
                    }
                }
                return -1;
            }
        }
        
        // Create singleton instance (this is what external code uses)
        const NavigationController = new NavigationControllerClass();
        
        // Expose for analysis.js
        window.NavigationController = NavigationController;
        
        /* =========================
           Analysis Module
           Moved to analysis.js (Build 270)
           ========================= */
        
        function getLocationsInCurrentMonth() {
            // Get all diary entries (list items) in the CURRENT month only
            if (!markdownContent || !currentMonth) {
                return [];
            }
            
            // Get all list items that have location-data for the current month
            const listItems = markdownContent.querySelectorAll('li');
            const entries = [];
            
            listItems.forEach(li => {
                const locationData = li.querySelector('.location-data');
                if (locationData) {
                    const dayKey = locationData.dataset.daykey;
                    // dayKey format: "2019-12-02", currentMonth format: "2019-12"
                    if (dayKey && dayKey.startsWith(currentMonth)) {
                        entries.push(li);
                    }
                }
            });
            
            return entries;
        }
        
        // REMOVED: navigateLocation() - replaced by NavigationController.navigateBy()
        
        function clearLocationHighlights() {
            // Use the global markdownContent variable
            if (!markdownContent) return;
            
            // Remove highlight from all diary entries (list items)
            markdownContent.querySelectorAll('li.diary-highlight').forEach(li => {
                li.classList.remove('diary-highlight');
            });
        }
        
        // REMOVED: highlightAndScrollToLocation() - replaced by NavigationController.#selectDomEntry()
        
        function showLocationOnMap(lat, lon, radius) {
            // Center map on the location
            if (map) {
                map.setView([lat, lon], 16);
                
                // Optionally add a temporary highlight circle
                if (window.tempLocationCircle) {
                    map.removeLayer(window.tempLocationCircle);
                }
                
                if (radius && radius > 0) {
                    window.tempLocationCircle = L.circle([lat, lon], {
                        radius: radius,
                        color: '#FF6B35',
                        fillColor: '#FF6B35',
                        fillOpacity: 0.2,
                        weight: 3
                    }).addTo(map);
                    
                    // Remove after 3 seconds
                    setTimeout(() => {
                        if (window.tempLocationCircle) {
                            map.removeLayer(window.tempLocationCircle);
                            window.tempLocationCircle = null;
                        }
                    }, 3000);
                }
            }
        }
        
        function getDaysInCurrentMonth() {
            const dayTitles = markdownContent.querySelectorAll('.day-map-title');
            return Array.from(dayTitles).map(el => el.dataset.day).filter(Boolean);
        }

        function shouldUseInstantDayJump(fromDayKey, toDayKey) {
            if (!fromDayKey || !toDayKey) return false;
            // Month boundary transitions should always be instant.
            if (fromDayKey.slice(0, 7) !== toDayKey.slice(0, 7)) return true;
            const fromMs = Date.parse(fromDayKey + 'T00:00:00Z');
            const toMs = Date.parse(toDayKey + 'T00:00:00Z');
            if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return false;
            const dayDelta = Math.abs((toMs - fromMs) / (24 * 60 * 60 * 1000));
            return dayDelta > 5;
        }
        
        async function navigateDay(direction) {
            const days = getDaysInCurrentMonth();
            if (days.length === 0) return;
            const fromDayKey = currentDayKey || days[Math.max(0, currentDayIndex)] || null;
            
            // Clear previous day highlight
            clearDayHighlights();
            
            // Clear location highlights (day navigation takes precedence)
            clearLocationHighlights();
            currentLocationIndex = 0;
            
            // Calculate new index
            const newIndex = currentDayIndex + direction;
            
            // Check if we need to change months
            if (newIndex < 0) {
                // Going backward from first day - try to go to previous month
                const currentMonthIndex = monthKeys.indexOf(currentMonth);
                if (currentMonthIndex > 0) {
                    // Switch to previous month via NavigationController
                    const prevMonth = monthKeys[currentMonthIndex - 1];
                    await NavigationController.selectMonth(prevMonth);
                    
                    // Go to last day of previous month
                    const prevMonthDays = getDaysInCurrentMonth();
                    currentDayIndex = prevMonthDays.length - 1;
                    if (prevMonthDays.length > 0) {
                        const targetDayKey = prevMonthDays[currentDayIndex];
                        highlightAndScrollToDay(targetDayKey, { instant: shouldUseInstantDayJump(fromDayKey, targetDayKey) });
                    }
                    return;
                } else {
                    // Already at first month, wrap to last day of current month
                    currentDayIndex = days.length - 1;
                    const targetDayKey = days[currentDayIndex];
                    highlightAndScrollToDay(targetDayKey, { instant: shouldUseInstantDayJump(fromDayKey, targetDayKey) });
                }
            } else if (newIndex >= days.length) {
                // Going forward from last day - try to go to next month
                const currentMonthIndex = monthKeys.indexOf(currentMonth);
                if (currentMonthIndex < monthKeys.length - 1) {
                    // Switch to next month via NavigationController
                    const nextMonth = monthKeys[currentMonthIndex + 1];
                    await NavigationController.selectMonth(nextMonth);
                    
                    // Go to first day of next month
                    currentDayIndex = 0;
                    const nextMonthDays = getDaysInCurrentMonth();
                    if (nextMonthDays.length > 0) {
                        const targetDayKey = nextMonthDays[0];
                        highlightAndScrollToDay(targetDayKey, { instant: shouldUseInstantDayJump(fromDayKey, targetDayKey) });
                    }
                    return;
                } else {
                    // Already at last month, wrap to first day of current month
                    currentDayIndex = 0;
                    const targetDayKey = days[0];
                    highlightAndScrollToDay(targetDayKey, { instant: shouldUseInstantDayJump(fromDayKey, targetDayKey) });
                }
            } else {
                // Normal navigation within same month
                currentDayIndex = newIndex;
                const targetDayKey = days[currentDayIndex];
                highlightAndScrollToDay(targetDayKey, { instant: shouldUseInstantDayJump(fromDayKey, targetDayKey) });
            }
            
            // Update day nav button states
            updateDayNavButtons();
            
            // Update stats panel if it's open
            updateStatsForCurrentView();
        }
        
        function highlightAndScrollToDay(dayKey, options = {}) {
            const instant = !!options.instant;
            // Find and highlight the day title
            const dayTitle = markdownContent.querySelector(`.day-map-title[data-day="${dayKey}"]`);
            if (dayTitle) {
                const h2 = dayTitle.closest('h2');
                if (h2) {
                    h2.classList.add('day-highlight');
                }
                
                // Scroll to position with breathing room at top
                const diaryPanel = markdownContent.closest('.diary-panel');
                if (diaryPanel) {
                    // Get the position of the h2 relative to the scrollable container
                    const h2Rect = h2.getBoundingClientRect();
                    const panelRect = diaryPanel.getBoundingClientRect();
                    const currentScroll = diaryPanel.scrollTop;
                    
                    // Calculate how far down the h2 is from the current scroll position
                    const h2OffsetFromViewport = h2Rect.top - panelRect.top;
                    
                    // Scroll so the h2 is 37px from the top (clean day start, previous day hidden)
                    const targetScroll = currentScroll + h2OffsetFromViewport - 37;
                    const nextTop = Math.max(0, targetScroll);
                    if (instant) {
                        // Hard jump to cancel any in-flight smooth scrolling.
                        diaryPanel.scrollTop = nextTop;
                    } else {
                        diaryPanel.scrollTo({
                            top: nextTop,
                            behavior: 'smooth'
                        });
                    }
                } else {
                    // Fallback to standard scrollIntoView
                    if (instant) {
                        dayTitle.scrollIntoView({ block: 'start' });
                    } else {
                        dayTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
                
                // Show day on map
                showDayMap(dayKey);
            }
        }
        
        function clearDayHighlights() {
            const highlighted = markdownContent.querySelectorAll('h2.day-highlight');
            highlighted.forEach(el => el.classList.remove('day-highlight'));
        }
        
        // Reset all map highlights (polylines and diary) when clicking on empty map area
        function resetMapHighlights() {
            // Reset all route segment opacity and colors
            allRouteSegments.forEach(seg => {
                seg.segment.setStyle({ 
                    opacity: 1.0, 
                    weight: 7,
                    color: seg.color  // Reset to original color
                });
                seg.border.setStyle({ 
                    opacity: 1.0, 
                    weight: 10 
                });
                seg.segment._isHighlighted = false;
                seg.border._isHighlighted = false;
            });

            // Clear selected profile segment
            selectedProfileSegmentPoints = null;
            selectedProfileSegmentColor = null;
            if (elevationPanelVisible) updateElevationChart();
            
            // Clear diary highlights
            clearDiaryHighlights();
            
            // Clear location highlights
            const highlightedLocations = markdownContent.querySelectorAll('h3.location-highlight');
            highlightedLocations.forEach(el => el.classList.remove('location-highlight'));
        }
        
        function updateDayNavButtons() {
            const days = getDaysInCurrentMonth();
            const prevBtn = document.getElementById('prevDayBtn');
            const nextBtn = document.getElementById('nextDayBtn');
            
            // Always enabled since we wrap around, but disable if no days
            if (prevBtn) prevBtn.disabled = days.length === 0;
            if (nextBtn) nextBtn.disabled = days.length === 0;
        }
        
        // Diary highlighting functions
        function clearDiaryHighlights() {
            const highlightedItems = markdownContent.querySelectorAll('.diary-highlight');
            highlightedItems.forEach(item => item.classList.remove('diary-highlight'));
        }
        
        function highlightDiaryEntryByTime(dayKey, timestamp, activityType) {
            clearDiaryHighlights();
            
            // Find diary entries for this day
            const locationDataElements = markdownContent.querySelectorAll(`.location-data[data-daykey="${dayKey}"]`);
            
            if (locationDataElements.length === 0) {
                return;
            }
            
            // Convert timestamp to Date object for comparison
            const targetTime = new Date(timestamp);
            let closestEntry = null;
            let closestTimeDiff = Infinity;
            
            for (const locData of locationDataElements) {
                // For activities, prefer startDate over note date for matching
                const startDate = locData.dataset.startDate;
                const entryDate = startDate ? new Date(startDate) : new Date(locData.dataset.date);
                const timeDiff = Math.abs(entryDate - targetTime);
                
                // Find the entry closest to this timestamp
                if (timeDiff < closestTimeDiff) {
                    closestTimeDiff = timeDiff;
                    closestEntry = locData;
                }
            }
            
            // Highlight the closest entry
            // Use a 15-minute tolerance for activities (routes can have timing variance between start and recorded time)
            if (closestEntry && closestTimeDiff < 900000) { // Within 15 minutes
                const listItem = closestEntry.closest('li');
                if (listItem) {
                    listItem.classList.add('diary-highlight');
                    
                    // Update currentLocationIndex so arrow navigation works from here
                    const entries = getLocationsInCurrentMonth();
                    const idx = entries.indexOf(listItem);
                    if (idx !== -1) {
                        currentLocationIndex = idx;
                    }
                    
                    // Scroll to the highlighted entry within the diary panel
                    const diaryPanel = markdownContent.closest('.diary-panel');
                    if (diaryPanel) {
                        const listItemRect = listItem.getBoundingClientRect();
                        const panelRect = diaryPanel.getBoundingClientRect();
                        const currentScroll = diaryPanel.scrollTop;
                        const listItemOffsetFromViewport = listItemRect.top - panelRect.top;
                        
                        // Center the item in the viewport
                        const targetScroll = currentScroll + listItemOffsetFromViewport - (panelRect.height / 2) + (listItemRect.height / 2);
                        diaryPanel.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
                    }
                }
            }
        }
        
        // REMOVED: highlightDiaryEntry() - replaced by NavigationController.selectEntryFromMap()
        // REMOVED: highlightDiaryEntryById() - replaced by NavigationController.selectEntryFromMap()
        
        function scrollToDiaryDay(dayKey) {
            // Find the day title in the diary
            const dayTitle = markdownContent.querySelector(`.day-map-title[data-day="${dayKey}"]`);
            if (dayTitle) {
                const h2 = dayTitle.closest('h2');
                const diaryPanel = markdownContent.closest('.diary-panel');
                
                if (h2 && diaryPanel) {
                    // Get the position of the h2 relative to the current viewport
                    const h2Rect = h2.getBoundingClientRect();
                    const panelRect = diaryPanel.getBoundingClientRect();
                    const currentScroll = diaryPanel.scrollTop;
                    
                    // Calculate how far down the h2 is from the current scroll position
                    const h2OffsetFromViewport = h2Rect.top - panelRect.top;
                    
                    // Scroll so the h2 is 37px from the top (clean day start, previous day hidden)
                    const targetScroll = currentScroll + h2OffsetFromViewport - 37;
                    diaryPanel.scrollTo({
                        top: Math.max(0, targetScroll),
                        behavior: 'smooth'
                    });
                } else {
                    // Fallback to standard scrollIntoView
                    dayTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        }
        
        // Attach click handlers to diary elements (locations, activities, day titles, month title)
        // Must be called after any innerHTML modification (e.g., search highlighting)
        function attachDiaryClickHandlers() {
            const listItems = markdownContent.querySelectorAll('li');
            
            // Add click handlers for LOCATIONS -> Open Day Map with Popup
            let clickableCount = 0;
            listItems.forEach((li) => {
                const locationData = li.querySelector('.location-data');
                if (locationData) {
                    const firstStrong = li.querySelector('strong');
                    if (firstStrong && !firstStrong.classList.contains('diary-clickable')) {
                        firstStrong.style.cursor = 'pointer';
                        firstStrong.title = 'Show on day map';
                        firstStrong.classList.add('diary-clickable');
                        clickableCount++;
                        
                        firstStrong.addEventListener('click', function(e) {
                            e.stopPropagation();
                            const lat = parseFloat(locationData.dataset.lat);
                            const lng = parseFloat(locationData.dataset.lng);
                            const dayKey = locationData.dataset.daykey;
                            const entryId = `${lat},${lng}`;
                            const date = locationData.dataset.date;
                            const placeId = locationData.dataset.placeId;

                            // Check if we're in event bound selection mode
                            if (getEventCreationState().active && getEventBoundMode()) {
                                // Extract time from date - parse as Date for proper timezone handling
                                let time = null;
                                if (date) {
                                    const d = new Date(date);
                                    if (!isNaN(d.getTime())) {
                                        const hours = d.getHours().toString().padStart(2, '0');
                                        const mins = d.getMinutes().toString().padStart(2, '0');
                                        time = `${hours}:${mins}`;
                                    }
                                }
                                handleEventBoundSelection(dayKey, time, placeId || entryId);
                                return;
                            }

                            // All selection via NavigationController
                            // Pass date for unique matching when multiple entries have same coordinates
                            NavigationController.selectEntry(entryId, dayKey, {
                                source: 'diary',
                                type: 'location',
                                lat: lat,
                                lng: lng,
                                date: date  // Use date for unique matching
                            });
                        });
                    }
                }
            });
            
            // Add click handlers for ACTIVITIES (routes) -> Show route popup at center
            let activityClickableCount = 0;
            listItems.forEach((li) => {
                const locationData = li.querySelector('.location-data');
                if (!locationData) return;
                
                const startDate = locationData.dataset.startDate;
                if (!startDate) return;
                
                const firstStrong = li.querySelector('strong');
                if (firstStrong) return;
                
                const firstSpan = li.querySelector('span[style*="color"]');
                if (firstSpan && !firstSpan.classList.contains('diary-activity-clickable')) {
                    firstSpan.style.cursor = 'pointer';
                    firstSpan.title = 'Show route on map';
                    firstSpan.classList.add('diary-activity-clickable');
                    activityClickableCount++;
                    
                    firstSpan.addEventListener('click', function(e) {
                        const dayKey = locationData.dataset.daykey;
                        const activityStartTime = new Date(startDate).getTime();
                        const entryId = `activity-${activityStartTime}`;

                        // Check if we're in event bound selection mode
                        if (getEventCreationState().active && getEventBoundMode()) {
                            // Extract time from startDate - parse as Date for proper timezone handling
                            let time = null;
                            if (startDate) {
                                const d = new Date(startDate);
                                if (!isNaN(d.getTime())) {
                                    const hours = d.getHours().toString().padStart(2, '0');
                                    const mins = d.getMinutes().toString().padStart(2, '0');
                                    time = `${hours}:${mins}`;
                                }
                            }
                            handleEventBoundSelection(dayKey, time, entryId);
                            return;
                        }

                        // All selection via NavigationController
                        NavigationController.selectEntry(entryId, dayKey, {
                            source: 'diary',
                            type: 'activity',
                            startTime: activityStartTime
                        });
                    });
                }
            });
            
            // Add click handlers to day titles
            const dayMapTitles = markdownContent.querySelectorAll('.day-map-title');
            dayMapTitles.forEach(title => {
                if (title.classList.contains('day-title-clickable')) return;
                title.classList.add('day-title-clickable');
                
                title.addEventListener('click', function() {
                    const dayKey = this.dataset.day;
                    
                    // Use NavigationController for consistent state management
                    NavigationController.selectDay(dayKey);
                    
                    setTimeout(() => {
                        const monthKey = dayKey.substring(0, 7);
                        
                        if (generatedDiaries[monthKey]?.monthData?.days?.[dayKey]) {
                            const dayData = generatedDiaries[monthKey].monthData.days[dayKey];
                            const notesOnly = document.getElementById('notesOnly')?.checked ?? false;
                            const includeAll = !notesOnly;
                            const visibleNotes = getFilteredNotesForDay(dayData, includeAll, includeAll);
                            const dayStats = calculateDailyActivityStats(visibleNotes);
                            
                            if (dayStats && Object.keys(dayStats).length > 0) {
                                const date = new Date(dayKey);
                                const dayName = date.toLocaleDateString('en-US', { 
                                    weekday: 'long', 
                                    month: 'long', 
                                    day: 'numeric' 
                                });
                                showStatsPanel(dayStats, dayName);
                            }
                        }
                    }, 100);
                });
            });
            
            // Add click handler to month title
            const monthMapTitle = markdownContent.querySelector('.month-map-title');
            if (monthMapTitle && !monthMapTitle.classList.contains('month-title-clickable')) {
                monthMapTitle.classList.add('month-title-clickable');
                
                monthMapTitle.addEventListener('click', function() {
                    // Clear route search if active (user is returning to diary mode)
                    if (window.routeSearchLayer) {
                        clearRouteSearch();
                        if (typeof showDiaryRoutes === 'function') {
                            showDiaryRoutes();
                        }
                    }

                    currentDayIndex = -1;
                    clearDayHighlights();
                    showMonthMap();
                    
                    setTimeout(() => {
                        const monthKey = this.dataset.month;
                        if (monthKey && generatedDiaries[monthKey]?.monthData) {
                            const monthStats = calculateMonthlyActivityStats(generatedDiaries[monthKey].monthData);
                            if (monthStats && Object.keys(monthStats).length > 0) {
                                const [year, month] = monthKey.split('-');
                                const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
                                showStatsPanel(monthStats, `${monthName} ${year}`);
                            }
                        }
                    }, 300);
                });
            }
        }
        
        // Re-extract notes from stored raw data (when coalesce settings change)
        function regenerateCurrentMonthDiary() {
            if (!currentMonth) return;
            const diary = generatedDiaries[currentMonth];
            if (!diary || !diary.monthData?.days) return;
            
            // Re-extract notes for each day from stored raw data
            for (const dayKey in diary.monthData.days) {
                const dayData = diary.monthData.days[dayKey];
                if (!dayData._rawData) continue;
                
                // Re-extract with current coalesce settings, using stored source file
                const sourceFile = dayData._sourceFile || 'json-import';
                const notes = extractNotesFromData(dayData._rawData, dayKey, sourceFile);
                dayData.notes = notes;
            }
            
            // Re-display the diary
            displayDiary(currentMonth, true);
            
            // Update stats panel
            setTimeout(() => updateStatsForCurrentView(), 10);
        }
        
        function sanitizeHtml(html) {
            if (window.DOMPurify) {
                return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
            }
            // Fail-safe fallback: escape HTML if sanitizer isn't available.
            const div = document.createElement('div');
            div.textContent = html;
            return div.innerHTML;
        }

        function displayDiary(monthKey, skipSearch = false, onComplete = null) {
            const diary = generatedDiaries[monthKey];
            if (!diary) return;
            
            // Render markdown
            const notesOnly = document.getElementById('notesOnly')?.checked ?? false;
            const includeAll = !notesOnly; // Inverted logic: notesOnly checked = includeAll false
            const md = generateMarkdown(diary.monthData, includeAll, includeAll);
            diary.markdown = md; 
            markdownContent.innerHTML = sanitizeHtml(marked.parse(md));
            
            // Store original for search (before any highlighting)
            originalContent = markdownContent.innerHTML;
            
            // Apply search highlighting BEFORE attaching click handlers
            // This way handlers are attached to the final DOM state
            if (!skipSearch && searchInput.value && searchInput.value.length >= 2) {
                highlightMatchesInCurrentMonth();
            }
            
            updateMonthNavButtons();
            
            // Attach all click handlers (locations, activities, day titles, month title)
            attachDiaryClickHandlers();

            // Re-enable route search click mode if search popup is open
            const searchPopup = document.getElementById('searchPopup');
            if (searchPopup && searchPopup.style.display !== 'none' && typeof enableDiaryLocationClickMode === 'function') {
                enableDiaryLocationClickMode();
            }

            // Update favourite tags based on current favourites
            updateFavouriteTags();

            // Reset day navigation
            currentDayIndex = 0;
            clearDayHighlights();
            updateDayNavButtons();
            
            // Reset location navigation
            currentLocationIndex = 0;
            clearLocationHighlights();

            // Search highlighting was already applied at the start of displayDiary
            // (before click handlers were attached, so handlers survive)
            
            // Execute completion callback after diary DOM is fully rendered
            if (onComplete && typeof onComplete === 'function') {
                // Use requestAnimationFrame to ensure DOM is painted
                requestAnimationFrame(() => onComplete());
            }
        }

        
        // Update favourite tags on diary entries based on current favourites
        function updateFavouriteTags() {
            if (!markdownContent) return;
            
            // Remove all existing favourite tags first
            markdownContent.querySelectorAll('.diary-tag-favourite').forEach(tag => tag.remove());
            
            // Find all location-data elements that are VISITS with lat/lng coordinates
            const locationDataElements = markdownContent.querySelectorAll('.location-data[data-lat][data-lng][data-is-visit="true"]');
            
            locationDataElements.forEach(locData => {
                const lat = parseFloat(locData.dataset.lat);
                const lng = parseFloat(locData.dataset.lng);
                
                if (isNaN(lat) || isNaN(lng)) return;
                
                // Check if this location is a favourite
                if (isFavorite(lat, lng)) {
                    // Add space then favourite star after location-data span
                    const space = document.createTextNode(' ');
                    const favouriteTag = document.createElement('span');
                    favouriteTag.className = 'diary-tag diary-tag-favourite';
                    favouriteTag.textContent = '⭐';
                    locData.after(space, favouriteTag);
                }
            });
        }
        
        // Helper function to get map padding based on visible panels
        function getMapPadding() {
            // Delegate to NavigationController which owns viewport margin state
            return NavigationController.mapPadding;
        }
        
        // Debug wrapper for map.fitBounds - logs bounds and padding
        function debugFitBounds(bounds, options, caller = 'unknown') {
            if (!map || !bounds) return;
            
            // Mark that we just did a fitBounds - prevent panTo override for 500ms
            window._lastFitBoundsTime = Date.now();
            
            // Calculate actual bounds extent
            let boundsObj;
            if (Array.isArray(bounds)) {
                boundsObj = L.latLngBounds(bounds);
            } else {
                boundsObj = bounds;
            }
            
            const sw = boundsObj.getSouthWest();
            const ne = boundsObj.getNorthEast();
            const center = boundsObj.getCenter();
            
            logDebug(`📍 fitBounds [${caller}]: content bounds SW=(${sw.lat.toFixed(5)},${sw.lng.toFixed(5)}) NE=(${ne.lat.toFixed(5)},${ne.lng.toFixed(5)}) center=(${center.lat.toFixed(5)},${center.lng.toFixed(5)})`);
            logDebug(`📍 fitBounds [${caller}]: padding L=${options.paddingTopLeft?.[0]} T=${options.paddingTopLeft?.[1]} R=${options.paddingBottomRight?.[0]} B=${options.paddingBottomRight?.[1]}`);
            
            // Visual debug: show content bounds rectangle on map (persists until next command)
            if (window.__ARC_DEBUG_LOGS__) {
                // Remove previous debug elements
                if (window._debugBoundsRect) {
                    window._debugBoundsRect.remove();
                }
                if (window._debugBoundsLabel) {
                    window._debugBoundsLabel.remove();
                }
                if (window._debugTargetMarker) {
                    window._debugTargetMarker.remove();
                    window._debugTargetMarker = null;
                }
                if (window._debugTargetLabel) {
                    window._debugTargetLabel.remove();
                    window._debugTargetLabel = null;
                }
                
                // Draw rectangle showing content bounds
                window._debugBoundsRect = L.rectangle(boundsObj, {
                    color: '#ff0000',
                    weight: 3,
                    fillColor: '#ff0000',
                    fillOpacity: 0.1,
                    dashArray: '10, 5',
                    interactive: false
                }).addTo(map);
                
                // Add label at center
                window._debugBoundsLabel = L.marker(center, {
                    icon: L.divIcon({
                        className: 'debug-bounds-label',
                        html: `<div style="background:rgba(255,0,0,0.8);color:white;padding:2px 6px;border-radius:3px;font-size:11px;white-space:nowrap;">${caller}</div>`,
                        iconSize: [100, 20],
                        iconAnchor: [50, 10]
                    }),
                    interactive: false
                }).addTo(map);
            }
            
            // Calculate zoom delta to determine animation speed
            const currentZoom = map.getZoom();
            const targetZoom = map.getBoundsZoom(boundsObj, false, options.paddingTopLeft || [0, 0]);
            const zoomDelta = Math.abs(targetZoom - currentZoom);
            
            // Slow down animation for large zoom changes (> 3 levels = 50% slower)
            if (zoomDelta > 3 && options.animate !== false) {
                const duration = 0.25 + (zoomDelta * 0.1); // Base 0.25s + 0.1s per zoom level
                logDebug(`📍 fitBounds [${caller}]: zoomDelta=${zoomDelta.toFixed(1)}, duration=${duration.toFixed(2)}s`);
                map.fitBounds(bounds, { ...options, animate: true, duration: Math.min(duration, 1.5) });
            } else {
                map.fitBounds(bounds, options);
            }

        }
        
        // Initialize the map panel with month routes
        function initializeMapPanel(skipMapInit = false) {
            const mapContainer = document.getElementById('mapContainer');
            const placeholder = document.getElementById('mapPlaceholder');
            
            if (placeholder) {
                placeholder.style.display = 'none';
            }
            
            // Create map if it doesn't exist
            if (!map) {
                map = L.map('mapContainer', {
                    zoomControl: false,  // Disable default zoom controls, using custom ones
                    zoomDelta: 0.5,      // Make scroll wheel zoom 50% more gradual
                    zoomSnap: 0.5        // Allow half-zoom levels for smoother zooming
                }).setView([0, 0], 2);
                
                // Create custom pane for circle markers so they appear ABOVE route polylines
                // Default overlayPane (polylines) is z-index 400, markerPane is 600
                map.createPane('circleMarkerPane');
                map.getPane('circleMarkerPane').style.zIndex = 450;
                
                currentTileLayer = getTileLayer(currentMapStyle);
                currentTileLayer.addTo(map);
                
                // Add zoom event listener to dynamically resize markers (like Arc Timeline)
                map.on('zoomend', function() {
                    const newZoom = map.getZoom();
                    const newRadius = getMarkerRadius(newZoom);
                    
                    // Update all circle markers with new radius
                    allCircleMarkers.forEach(marker => {
                        if (marker && marker.setRadius) {
                            marker.setRadius(newRadius);
                        }
                    });
                    
                    // Update zoom level in any open popup
                    updatePopupZoomLevel();
                });
                
                // Add click handler to reset highlights when clicking on empty map area
                map.on('click', function(e) {
                    // Handle measurement tool clicks
                    if (window.measurementTool?.isActive) {
                        window.measurementTool.handleClick(e);
                        return;
                    }
                    
                    // Check if click was on a route segment or marker (they handle their own clicks)
                    // This only triggers for clicks on the empty map area
                    resetMapHighlights();
                });
                
                // Handle double-click to finish measurement
                map.on('dblclick', function(e) {
                    if (window.measurementTool?.isActive) {
                        window.measurementTool.handleDoubleClick(e);
                        L.DomEvent.stopPropagation(e);
                    }
                });

                // Right-click context menu for Street View
                map.on('contextmenu', function(e) {
                    // Remove existing context menu if any
                    const existingMenu = document.querySelector('.map-context-menu');
                    if (existingMenu) existingMenu.remove();

                    const lat = e.latlng.lat.toFixed(6);
                    const lng = e.latlng.lng.toFixed(6);
                    const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
                    const googleMapsUrl = `https://www.google.com/maps/@${lat},${lng},17z`;

                    const menu = document.createElement('div');
                    menu.className = 'map-context-menu';
                    menu.innerHTML = `
                        <a href="${streetViewUrl}" target="_blank" class="context-menu-item">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <circle cx="12" cy="8" r="4"/>
                                <path d="M12 14c-4 0-6 2-6 4v2h12v-2c0-2-2-4-6-4z"/>
                            </svg>
                            Street View
                        </a>
                        <a href="${googleMapsUrl}" target="_blank" class="context-menu-item">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                            </svg>
                            Google Maps
                        </a>
                        <div class="context-menu-item context-menu-coords">${lat}, ${lng}</div>
                    `;

                    // Position menu at click location
                    menu.style.left = e.containerPoint.x + 'px';
                    menu.style.top = e.containerPoint.y + 'px';

                    document.getElementById('mapContainer').appendChild(menu);

                    // Close menu when clicking elsewhere
                    const closeMenu = () => {
                        if (menu.parentNode) menu.remove();
                        document.removeEventListener('click', closeMenu);
                        map.off('click', closeMenu);
                        map.off('movestart', closeMenu);
                    };
                    setTimeout(() => {
                        document.addEventListener('click', closeMenu);
                        map.on('click', closeMenu);
                        map.on('movestart', closeMenu);
                    }, 10);
                });

                // Initialize measurement tool now that map exists
                window.measurementTool = new MeasurementTool(map);

                // Expose map globally for map-tools.js (route search, etc.)
                window.map = map;
            }
            
            // Setup resize observer
            monitorMapResize();
            
            // Show month map (unless caller wants to show a different map)
            if (!skipMapInit) {
                showMonthMap();
            }
        }
        
        // Zoom functions
        function zoomIn() {
            if (!map) return;
            
            const diaryFloat = document.querySelector('.diary-float');
            const isDiaryVisible = diaryFloat && diaryFloat.style.display !== 'none';
            
            if (!isDiaryVisible) {
                // No diary panel, just zoom normally
                map.zoomIn();
                return;
            }
            
            // Calculate what point is currently in the center of the visible area
            const diaryWidth = diaryFloat.offsetWidth || 0;
            const mapCenter = map.getCenter();
            const currentZoom = map.getZoom();
            
            // The visible area center is offset to the right by half the diary width
            const centerPoint = map.project(mapCenter, currentZoom);
            const visibleCenterPoint = L.point(centerPoint.x + (diaryWidth / 2), centerPoint.y);
            const visibleCenter = map.unproject(visibleCenterPoint, currentZoom);
            
            // Zoom in
            map.zoomIn();
            
            // Re-center on the same visible point with offset
            panToWithDiaryOffset(visibleCenter.lat, visibleCenter.lng);
        }
        
        function zoomOut() {
            if (!map) return;
            
            const diaryFloat = document.querySelector('.diary-float');
            const isDiaryVisible = diaryFloat && diaryFloat.style.display !== 'none';
            
            if (!isDiaryVisible) {
                // No diary panel, just zoom normally
                map.zoomOut();
                return;
            }
            
            // Calculate what point is currently in the center of the visible area
            const diaryWidth = diaryFloat.offsetWidth || 0;
            const mapCenter = map.getCenter();
            const currentZoom = map.getZoom();
            
            // The visible area center is offset to the right by half the diary width
            const centerPoint = map.project(mapCenter, currentZoom);
            const visibleCenterPoint = L.point(centerPoint.x + (diaryWidth / 2), centerPoint.y);
            const visibleCenter = map.unproject(visibleCenterPoint, currentZoom);
            
            // Zoom out
            map.zoomOut();
            
            // Re-center on the same visible point with offset
            panToWithDiaryOffset(visibleCenter.lat, visibleCenter.lng);
        }
        
        // Toggle diary visibility
        function toggleDiary() {
            const diaryFloat = document.querySelector('.diary-float');
            const toggleBtn = document.getElementById('toggleDiaryBtn');
            const floatToggle = document.getElementById('diaryToggleFloat');
            
            if (!diaryFloat || !map) return;
            
            // Get current diary width before any changes
            const oldWidth = diaryFloat.style.display === 'none' ? 0 : (diaryFloat.offsetWidth || 0);
            
            if (diaryFloat.style.display === 'none') {
                // Show diary
                diaryFloat.style.display = 'flex';
                if (toggleBtn) {
                    toggleBtn.innerHTML = '&times;';
                    toggleBtn.title = 'Hide diary';
                }
                if (floatToggle) {
                    floatToggle.style.display = 'none';
                }
                
                // Get new width after showing
                const newWidth = diaryFloat.offsetWidth || 0;
                const delta = newWidth - oldWidth;
                
                // Update margin tracking only (no automatic refit)
                NavigationController.updateViewportMargins({ left: newWidth }, { noRefit: true });
                
                // Pan map to keep visible content stable
                if (delta !== 0) {
                    const center = map.getCenter();
                    const zoom = map.getZoom();
                    const centerPoint = map.project(center, zoom);
                    const newCenterPoint = L.point(centerPoint.x - delta / 2, centerPoint.y);
                    const newCenter = map.unproject(newCenterPoint, zoom);
                    
                    setTimeout(() => {
                        map.panTo(newCenter, { animate: true, duration: 0.3 });
                    }, 50);
                }
            } else {
                // Hide diary - close sliders first, then hide diary after slider animation completes
                const searchSlider = document.getElementById('searchResultsSlider');
                const eventSlider = document.getElementById('eventSlider');
                const hasOpenSlider = (searchSlider && searchSlider.classList.contains('open')) ||
                                      (eventSlider && eventSlider.classList.contains('open'));

                // Close sliders first
                if (searchSlider && searchSlider.classList.contains('open')) {
                    closeSearchResults();
                }
                if (eventSlider && eventSlider.classList.contains('open')) {
                    closeEventSlider();
                }

                // Function to hide diary
                const hideDiary = () => {
                    diaryFloat.style.display = 'none';
                    if (toggleBtn) {
                        toggleBtn.innerHTML = '&times;';
                        toggleBtn.title = 'Hide diary';
                    }
                    if (floatToggle) {
                        floatToggle.style.display = 'flex';
                    }

                    // Calculate delta (negative since diary is closing)
                    const newWidth = 0;
                    const delta = newWidth - oldWidth;

                    // Update margin tracking only (no automatic refit)
                    NavigationController.updateViewportMargins({ left: 0, sliderLeft: 0 }, { noRefit: true });

                    // Pan map to keep visible content stable
                    if (delta !== 0) {
                        const center = map.getCenter();
                        const zoom = map.getZoom();
                        const centerPoint = map.project(center, zoom);
                        const newCenterPoint = L.point(centerPoint.x - delta / 2, centerPoint.y);
                        const newCenter = map.unproject(newCenterPoint, zoom);

                        setTimeout(() => {
                            map.panTo(newCenter, { animate: true, duration: 0.3 });
                        }, 0);
                    }
                };

                // If slider was open, wait for its animation to complete before hiding diary
                if (hasOpenSlider) {
                    setTimeout(hideDiary, 350); // Slider transition is 0.3s
                } else {
                    hideDiary();
                }
            }
            
            // Reposition replay controller if visible
            setTimeout(() => {
                const replayControllerEl = document.getElementById('replayController');
                if (replayControllerEl && replayControllerEl.style.display === 'flex') {
                    if (window.positionReplayController) window.positionReplayController();
                }
            }, 50);
        }


        // ===== REPLAY CONTROLLER INITIALIZATION =====
        // Replay system extracted to replay.js (Build 693)
        // Note: Uses getter for map because map is created later in initializeMapPanel()
        if (window.replayController) {
            window.replayController.init({
                getMap: () => map,  // Getter because map is created asynchronously
                getGeneratedDiaries: () => generatedDiaries,  // Getter to handle reassignment
                getCurrentDayKey: () => currentDayKey,
                getMapPadding: getMapPadding,
                clearMapLayers: clearMapLayers,
                showDayMap: showDayMap,
                calculateDistance: calculateDistance,
                calculateDistanceMeters: calculateDistanceMeters,
                getPointTime: getPointTime,
                cancelMeasurement: cancelMeasurement
            });
        }
        
        
        // Keyboard navigation for diary panel
        document.addEventListener('keydown', function(e) {
            const diaryPanel = document.querySelector('.diary-panel');
            if (!diaryPanel) {
                return;
            }
            
            // Only handle keys if not typing in an input field
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                return;
            }
            
            // Spacebar toggles play/pause during replay
            if (e.key === ' ' && window.replayState && window.replayState.active) {
                e.preventDefault();
                if (window.replayTogglePlay) window.replayTogglePlay();
                return;
            }
            
            // Check if search slider has focus for up/down navigation
            const slider = document.getElementById('searchResultsSlider');
            const sliderHasFocus = slider && (slider.contains(activeElement) || activeElement === slider);
            
            if (sliderHasFocus && slider.classList.contains('open')) {
                // Handle up/down within search results
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const delta = e.key === 'ArrowDown' ? 1 : -1;
                    const currentActive = document.querySelector('.search-result-item.active');
                    let currentIndex = currentActive ? parseInt(currentActive.dataset.index) : -1;
                    let newIndex = currentIndex + delta;
                    
                    const items = document.querySelectorAll('.search-result-item');
                    if (items.length === 0) return;
                    
                    // Clamp to valid range
                    newIndex = Math.max(0, Math.min(newIndex, items.length - 1));
                    
                    if (newIndex !== currentIndex) {
                        navigateToSearchResultByIndex(newIndex);
                        // Scroll item into view in slider
                        const newItem = document.querySelector(`.search-result-item[data-index="${newIndex}"]`);
                        if (newItem) {
                            newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                    }
                    return;
                }
                // Escape closes slider
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeSearchResults();
                    return;
                }
            }
            
            const scrollAmount = diaryPanel.clientHeight * 0.8; // 80% of visible height
            
            // Check for modifier keys (Shift, Cmd, Ctrl, or Windows key)
            const hasModifier = e.shiftKey || e.metaKey || e.ctrlKey;
            
            // In location view mode, arrow keys navigate between locations
            if (window.isLocationViewMode && window.isLocationViewMode()) {
                switch(e.key) {
                    case 'ArrowUp':
                    case 'ArrowLeft':
                        e.preventDefault();
                        if (window.navigateLocationList) window.navigateLocationList(-1);
                        break;
                    case 'ArrowDown':
                    case 'ArrowRight':
                        e.preventDefault();
                        if (window.navigateLocationList) window.navigateLocationList(1);
                        break;
                    case 'Home':
                        e.preventDefault();
                        if (window.navigateLocationList) window.navigateLocationList('first');
                        break;
                    case 'End':
                        e.preventDefault();
                        if (window.navigateLocationList) window.navigateLocationList('last');
                        break;
                    case 'Enter':
                    case ' ':
                        e.preventDefault();
                        if (window.toggleCurrentLocationVisits) window.toggleCurrentLocationVisits();
                        break;
                    case 'PageDown':
                        e.preventDefault();
                        diaryPanel.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                        break;
                    case 'PageUp':
                        e.preventDefault();
                        diaryPanel.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
                        break;
                }
                return;
            }
            
            switch(e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    cancelPendingPopup();
                    if (hasModifier) {
                        // Shift/Cmd/Ctrl + Left Arrow → Previous Month
                        NavigationController.navigateMonth(-1);
                    } else {
                        // Left Arrow alone → Previous Day (via controller)
                        NavigationController.navigateBy(-1, 'day');
                    }
                    break;
                    
                case 'ArrowRight':
                    e.preventDefault();
                    cancelPendingPopup();
                    if (hasModifier) {
                        // Shift/Cmd/Ctrl + Right Arrow → Next Month
                        NavigationController.navigateMonth(1);
                    } else {
                        // Right Arrow alone → Next Day (via controller)
                        NavigationController.navigateBy(1, 'day');
                    }
                    break;
                    
                case 'ArrowUp':
                    e.preventDefault();
                    cancelPendingPopup(); // Cancel any pending popup when navigating
                    if (e.altKey) {
                        // Option + Up Arrow → First Entry (same as Home)
                        NavigationController.goToFirst();
                    } else {
                        // Up Arrow alone → Previous Entry (via controller, uses data model)
                        NavigationController.navigateBy(-1, 'entry');
                    }
                    break;

                case 'ArrowDown':
                    e.preventDefault();
                    cancelPendingPopup(); // Cancel any pending popup when navigating
                    if (e.altKey) {
                        // Option + Down Arrow → Last Entry (same as End)
                        NavigationController.goToLast();
                    } else {
                        // Down Arrow alone → Next Entry (via controller, uses data model)
                        NavigationController.navigateBy(1, 'entry');
                    }
                    break;
                    
                case 'PageDown':
                    e.preventDefault();
                    diaryPanel.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                    break;
                    
                case 'PageUp':
                    e.preventDefault();
                    diaryPanel.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
                    break;
                    
                case 'Home':
                    e.preventDefault();
                    cancelPendingPopup();
                    NavigationController.goToFirst();
                    break;
                    
                case 'End':
                    e.preventDefault();
                    cancelPendingPopup();
                    NavigationController.goToLast();
                    break;
            }
        });
        
        // Make diary panel resizable
        function initializeDiaryResize() {
            const diaryFloat = document.querySelector('.diary-float');
            const resizeHandle = document.getElementById('diaryResizeHandle');
            
            if (!diaryFloat || !resizeHandle) return;
            
            // Set initial max width constraint (30% of screen, but no more than 50%)
            const initialWidth = diaryFloat.offsetWidth;
            const maxWidth = window.innerWidth * 0.5;
            if (initialWidth > maxWidth) {
                diaryFloat.style.width = maxWidth + 'px';
            }
            
            let isResizing = false;
            let startX = 0;
            let startWidth = 0;
            
            resizeHandle.addEventListener('mousedown', function(e) {
                isResizing = true;
                startX = e.clientX;
                startWidth = diaryFloat.offsetWidth;
                
                // Prevent text selection while resizing
                e.preventDefault();
                document.body.style.userSelect = 'none';
            });
            
            document.addEventListener('mousemove', function(e) {
                if (!isResizing) return;
                
                const deltaX = e.clientX - startX;
                const newWidth = startWidth + deltaX;
                
                // Enforce min and max width
                const minWidth = 315;
                const maxWidth = window.innerWidth * 0.5; // Max 50% of screen
                const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
                
                // Update diary width
                diaryFloat.style.width = clampedWidth + 'px';
                
                // Invalidate map size so it adjusts to new space
                if (map) {
                    map.invalidateSize();
                }
            });
            
            document.addEventListener('mouseup', function(e) {
                if (isResizing) {
                    isResizing = false;
                    document.body.style.userSelect = '';
                    
                    // Update NavigationController with new diary width
                    const newWidth = diaryFloat.offsetWidth || 0;
                    NavigationController.updateViewportMargins({ left: newWidth }, { delay: 50 });
                }
            });
        }
        
        // Responsive diary header - hide title then nav buttons as width decreases
        function initializeResponsiveDiaryHeader() {
            const diaryFloat = document.querySelector('.diary-float');
            const diaryTitleGroup = document.querySelector('.diary-title-group');
            const diaryNavGroup = document.getElementById('diaryNavGroup');
            
            if (!diaryFloat || !diaryTitleGroup || !diaryNavGroup) return;
            
            // Create a ResizeObserver to watch diary width changes
            const resizeObserver = new ResizeObserver(entries => {
                for (const entry of entries) {
                    const width = entry.contentRect.width;
                    
                    // Hide title group (title + build) when width < 600px (BEFORE Print/Download/Close buttons get cut off)
                    if (width < 600) {
                        diaryTitleGroup.style.display = 'none';
                    } else {
                        diaryTitleGroup.style.display = '';
                    }
                    
                    // Hide nav buttons when width < 500px (gives checkboxes more room)
                    if (width < 500) {
                        diaryNavGroup.style.display = 'none';
                    } else {
                        diaryNavGroup.style.display = '';
                    }
                    
                    // Reposition search slider if open
                    const slider = document.getElementById('searchResultsSlider');
                    if (slider && slider.classList.contains('open')) {
                        positionSearchSlider();
                    }
                }
            });
            
            resizeObserver.observe(diaryFloat);
        }
        
        function initializeFocusHandling() {
            const diaryFloat = document.querySelector('.diary-float');
            const mapContainer = document.getElementById('mapContainer');
            const slider = document.getElementById('searchResultsSlider');
            
            if (!diaryFloat || !mapContainer) return;
            
            // Track which panel was last focused
            let diaryHasFocus = true; // Start with diary focused
            
            // Add tabindex to make elements focusable
            if (!mapContainer.hasAttribute('tabindex')) {
                mapContainer.setAttribute('tabindex', '0');
            }
            if (!diaryFloat.hasAttribute('tabindex')) {
                diaryFloat.setAttribute('tabindex', '0');
            }
            
            // Helper function to update transparency
            function updateTransparency(mapFocused) {
                const sliderEl = document.getElementById('searchResultsSlider');
                const eventSliderEl = document.getElementById('eventSlider');

                if (mapFocused) {
                    diaryFloat.classList.add('unfocused');
                    if (sliderEl) sliderEl.classList.add('unfocused');
                    if (eventSliderEl) eventSliderEl.classList.add('unfocused');

                    // Get the dynamic opacity value based on current map style
                    const contentOpacity = parseFloat(diaryFloat.dataset.unfocusedOpacity) || 0.05;
                    const diaryPanel = diaryFloat.querySelector('.diary-panel');
                    const diaryHeader = diaryFloat.querySelector('.diary-header');
                    if (diaryPanel) {
                        diaryPanel.style.background = `rgba(255, 255, 255, ${contentOpacity})`;
                    }
                    // Header should match panel transparency
                    if (diaryHeader) {
                        diaryHeader.style.background = `rgba(255, 255, 255, ${contentOpacity})`;
                    }
                    // Apply same opacity to search slider
                    if (sliderEl) {
                        sliderEl.style.background = `rgba(255, 255, 255, ${contentOpacity})`;
                        const sliderHeader = sliderEl.querySelector('.search-results-header');
                        if (sliderHeader) {
                            sliderHeader.style.background = `rgba(248, 249, 250, ${contentOpacity})`;
                        }
                    }
                    // Apply same opacity to event slider
                    if (eventSliderEl) {
                        eventSliderEl.style.background = `rgba(255, 255, 255, ${contentOpacity})`;
                        const eventSliderHeader = eventSliderEl.querySelector('.event-slider-header');
                        if (eventSliderHeader) {
                            eventSliderHeader.style.background = `rgba(248, 249, 250, ${contentOpacity})`;
                        }
                    }
                    // Note: Map titlebar transparency does NOT change on focus - only via slider control
                } else {
                    diaryFloat.classList.remove('unfocused');
                    if (sliderEl) sliderEl.classList.remove('unfocused');
                    if (eventSliderEl) eventSliderEl.classList.remove('unfocused');

                    // Restore default focused opacity (0.95)
                    const diaryPanel = diaryFloat.querySelector('.diary-panel');
                    const diaryHeader = diaryFloat.querySelector('.diary-header');
                    if (diaryPanel) {
                        diaryPanel.style.background = ''; // Remove inline style, use CSS default (0.95)
                    }
                    if (diaryHeader) {
                        diaryHeader.style.background = ''; // Remove inline style, use CSS default (0.95)
                    }
                    // Restore search slider opacity
                    if (sliderEl) {
                        sliderEl.style.background = '';
                        const sliderHeader = sliderEl.querySelector('.search-results-header');
                        if (sliderHeader) {
                            sliderHeader.style.background = '';
                        }
                    }
                    // Restore event slider opacity
                    if (eventSliderEl) {
                        eventSliderEl.style.background = '';
                        const eventSliderHeader = eventSliderEl.querySelector('.event-slider-header');
                        if (eventSliderHeader) {
                            eventSliderHeader.style.background = '';
                        }
                    }
                    // Note: Map titlebar stays at its current transparency
                }
            }

            // Diary panel focus/click handlers
            diaryFloat.addEventListener('mousedown', () => {
                diaryHasFocus = true;
                updateTransparency(false);
            });

            // Event slider focus/click handler - restores focus to both slider and diary
            const eventSliderEl = document.getElementById('eventSlider');
            if (eventSliderEl) {
                eventSliderEl.addEventListener('mousedown', () => {
                    diaryHasFocus = true;
                    updateTransparency(false);
                });
            }
            
            diaryFloat.addEventListener('focus', () => {
                diaryHasFocus = true;
                updateTransparency(false);
            }, true); // Use capture to catch focus on child elements
            
            // Slider focus/click handlers - slider focus restores both diary and slider
            if (slider) {
                slider.addEventListener('mousedown', () => {
                    diaryHasFocus = true;
                    updateTransparency(false);
                });
                
                slider.addEventListener('focus', () => {
                    diaryHasFocus = true;
                    updateTransparency(false);
                }, true);
            }
            
            // Flag to prevent map handlers from unfocusing diary when clicking markers
            let preventMapUnfocus = false;
            
            // Map container focus/click handlers
            mapContainer.addEventListener('mousedown', () => {
                if (preventMapUnfocus) {
                    return; // Don't reset here - click handler will also need to check
                }
                diaryHasFocus = false;
                updateTransparency(true);
            });
            
            mapContainer.addEventListener('focus', () => {
                diaryHasFocus = false;
                updateTransparency(true);
            }, true); // Use capture to catch focus on child elements
            
            // Detect clicks on map controls and child elements
            mapContainer.addEventListener('click', (e) => {
                if (preventMapUnfocus) {
                    preventMapUnfocus = false; // Reset after click (last event in sequence)
                    return;
                }
                // Any click in the map area should give it focus
                diaryHasFocus = false;
                updateTransparency(true);
            });
            
            // Also detect when scrolling/interacting with diary content
            const diaryContent = diaryFloat.querySelector('#markdownContent');
            if (diaryContent) {
                diaryContent.addEventListener('mousedown', () => {
                    diaryHasFocus = true;
                    updateTransparency(false);
                });
            }
            
            // Expose focusDiary for use by location view markers
            window.focusDiary = function() {
                preventMapUnfocus = true;
                diaryHasFocus = true;
                updateTransparency(false);
            };
        }
        
        // Helper function to pan map to center a location in the visible area (accounting for diary)
        function panToWithDiaryOffset(lat, lng, zoom = null) {
            logDebug(`📍 panToWithDiaryOffset: lat=${lat}, lng=${lng}, zoom=${zoom}`);
            // Delegate to NavigationController which owns viewport margin state
            NavigationController.panToLocation(lat, lng, zoom, true);
        }
        
        // Helper function to refit map bounds with or without diary padding
        function refitMapBounds(withDiaryPadding) {
            const diaryFloat = document.querySelector('.diary-float');
            
            if (mapMode === 'month' && allRouteSegments.length > 0) {
                const bounds = [];
                allRouteSegments.forEach(({ segment }) => {
                    if (segment && segment.getLatLngs) {
                        const latlngs = segment.getLatLngs();
                        latlngs.forEach(ll => bounds.push([ll.lat, ll.lng]));
                    }
                });
                if (bounds.length >= 2) {
                    if (withDiaryPadding) {
                        const padding = getMapPadding();
                        debugFitBounds(bounds, { 
                            paddingTopLeft: padding.paddingTopLeft,
                            paddingBottomRight: padding.paddingBottomRight
                        }, 'refitMapBounds-month-diary');
                    } else {
                        // No diary padding, but still account for title bar (8px margin + 72px height + 15px gap = 95px)
                        debugFitBounds(bounds, { 
                            paddingTopLeft: [30, 125],  // 30 left, 125 top (30 base + 95 for title bar area)
                            paddingBottomRight: [30, 30]
                        }, 'refitMapBounds-month-nodiary');
                    }
                }
            } else if (mapMode === 'day') {
                const bounds = [];
                
                if (clusterGroup) {
                    clusterGroup.eachLayer(layer => {
                        if (layer.getLatLng) {
                            const ll = layer.getLatLng();
                            bounds.push([ll.lat, ll.lng]);
                        }
                    });
                }
                
                if (dayRoutePolyline) {
                    dayRoutePolyline.eachLayer(layer => {
                        if (layer.getLatLngs) {
                            const latlngs = layer.getLatLngs();
                            latlngs.forEach(ll => bounds.push([ll.lat, ll.lng]));
                        }
                    });
                }
                
                if (bounds.length >= 2) {
                    if (withDiaryPadding) {
                        const padding = getMapPadding();
                        debugFitBounds(bounds, { 
                            paddingTopLeft: padding.paddingTopLeft,
                            paddingBottomRight: padding.paddingBottomRight
                        }, 'refitMapBounds-day-diary');
                    } else {
                        // No diary padding, but still account for title bar (8px margin + 72px height + 15px gap = 95px)
                        debugFitBounds(bounds, { 
                            paddingTopLeft: [30, 125],  // 30 left, 125 top (30 base + 95 for title bar area)
                            paddingBottomRight: [30, 30]
                        }, 'refitMapBounds-day-nodiary');
                    }
                }
            }
            
            if (map) {
                map.invalidateSize();
            }
        }
        
        function showMonthMap() {
            if (!currentMonth || !generatedDiaries[currentMonth]) return;

            // If elevation panel is visible, auto-select first day instead of showing month view
            // This ensures elevation data is available when navigating between months/years
            if (elevationPanelVisible) {
                const diary = generatedDiaries[currentMonth];
                const routesByDay = diary.routesByDay || {};
                const allDays = Object.keys(routesByDay).sort();
                if (allDays.length > 0) {
                    showDayMap(allDays[0]);
                    // Also update day navigation state
                    currentDayIndex = 0;
                    highlightAndScrollToDay(allDays[0]);
                    updateDayNavButtons();
                    return;
                }
            }

            // FIRST: Clear any existing layers to prevent flash of old content at wrong scale
            clearMapLayers();

            const diary = generatedDiaries[currentMonth];
            const routesByDay = diary.routesByDay || {};

            // Combine all routes from all days
            const allRoutes = [];
            const allDays = Object.keys(routesByDay).sort();

            // Set mode
            mapMode = 'month';
            currentDayKey = null;
            
            // Reset day index to indicate we're viewing the whole month
            currentDayIndex = -1;
            
            // Update title
            const [year, month] = currentMonth.split('-');
            const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
            document.getElementById('mapPanelTitle').textContent = `All routes — ${monthName}`;

            // Show controls
            document.getElementById('toolsBtn').style.display = 'block';
            document.getElementById('mapSaveBtn').style.display = 'block';
            document.getElementById('mapStyleSelector').style.display = 'block';
            updateMapStyleOptions(); // Update options based on Mapbox availability
            document.getElementById('mapStyleSelector').value = currentMapStyle;
            
            // Populate activity filters
            const activities = getUniqueActivitiesFromRoutes(routesByDay);
            populateActivityFilters(activities);
            
            // Check all filters (without triggering map update to avoid double-draw)
            checkAllActivityFilters();
            
            if (allDays.length === 0) {
                // No route data, show placeholder
                document.getElementById('mapPanelTitle').textContent = `No routes — ${monthName}`;
                // Don't reset to world view - keep current map position
                // User can manually pan/zoom if needed
                return;
            }
            
            // Collect all routes
            for (const dayKey of allDays) {
                const dayRoutes = routesByDay[dayKey];
                if (dayRoutes && dayRoutes.length > 0) {
                    const routesWithDay = dayRoutes.map(point => ({
                        ...point,
                        dayKey: dayKey
                    }));
                    allRoutes.push(...routesWithDay);
                }
            }
            
            if (allRoutes.length < 2) {
                return;
            }

            // Ensure map has correct size before drawing
            if (map) {
                map.invalidateSize();
            }

            // Draw all routes
            drawColorCodedRoute(allRoutes);
            
            // Fit map to show all routes
            if (dayRoutePolyline) {
                // Filter to valid coordinates only
                const bounds = allRoutes
                    .filter(p => p.lat !== undefined && p.lng !== undefined &&
                                 isFinite(p.lat) && isFinite(p.lng) &&
                                 p.lat >= -90 && p.lat <= 90 &&
                                 p.lng >= -180 && p.lng <= 180)
                    .map(p => [p.lat, p.lng]);
                if (bounds.length >= 2) {
                    // Add padding to keep routes visible next to diary and stats panels
                    const padding = getMapPadding();
                    debugFitBounds(bounds, { 
                        paddingTopLeft: padding.paddingTopLeft,
                        paddingBottomRight: padding.paddingBottomRight,
                        animate: false  // Disable animation to prevent visual glitch
                    }, 'showMonthMap');
                }
            }
            
            // Auto-show stats panel when map first loads
            setTimeout(() => {
                updateStatsForCurrentView();
            }, 250);
        }
        
        function showDayMap(dayKey, targetLat = null, targetLng = null, skipFit = false) {
            // Guard: map must be initialized
            if (!map) {
                logWarn(`showDayMap: map not initialized yet, deferring`);
                return;
            }
            
            if (!currentMonth || !generatedDiaries[currentMonth]) {
                logError(`showDayMap failed: currentMonth=${currentMonth}, has diary=${!!generatedDiaries[currentMonth]}`);
                return;
            }

            const diary = generatedDiaries[currentMonth];
            const locs = diary.locationsByDay?.[dayKey] || [];
            const routeData = diary.routesByDay?.[dayKey];
            
            logDebug(`📍 showDayMap(${dayKey}): ${locs.length} locations, ${routeData?.length || 0} route points`);

            // Need either locations OR routes to show anything
            if (locs.length === 0 && (!routeData || routeData.length < 2)) {
                logWarn(`showDayMap: No GPS data for ${dayKey}`);
                return;
            }

            
            // If we're already showing this day, and the user clicked a specific location again,
            // do NOT rebuild the map or refit bounds (that causes the zoom-out toggle).
            if (mapMode === 'day' && currentDayKey === dayKey && clusterGroup && targetLat !== null) {
                let targetMarker = null;

                clusterGroup.eachLayer(layer => {
                    if (layer && layer.getLatLng) {
                        const ll = layer.getLatLng();
                        if (Math.abs(ll.lat - targetLat) < 0.00001 && Math.abs(ll.lng - targetLng) < 0.00001) {
                            targetMarker = layer;
                        }
                    }
                });

                if (targetMarker) {
                    // Pan to the marker with diary offset
                    const ll = targetMarker.getLatLng();
                    panToWithDiaryOffset(ll.lat, ll.lng);
                    
                    // Handle clustering: expand cluster if needed, then open popup
                    setTimeout(() => {
                        if (!clusterGroup) return;
                        const visibleParent = clusterGroup.getVisibleParent(targetMarker);
                        
                        if (visibleParent && visibleParent !== targetMarker) {
                            // Marker is clustered - expand it
                            // Use one-time spiderfied event listener for reliable popup opening
                            const onSpiderfied = () => {
                                clusterGroup.off('spiderfied', onSpiderfied);
                                setTimeout(() => {
                                    panToWithDiaryOffset(ll.lat, ll.lng);
                                    openPopupDelayed(targetMarker, 50);
                                }, 100);
                            };
                            clusterGroup.on('spiderfied', onSpiderfied);
                            
                            if (visibleParent.spiderfy) {
                                visibleParent.spiderfy();
                            }
                            
                            // Fallback timeout in case spiderfied doesn't fire
                            setTimeout(() => {
                                clusterGroup.off('spiderfied', onSpiderfied);
                            }, 1000);
                        } else {
                            // Already visible
                            openPopupDelayed(targetMarker);
                        }
                    }, 100);
                } else {
                    // Fallback: at least centre the map
                    panToWithDiaryOffset(targetLat, targetLng);
                }
                return;
            }

            // FIRST: Clear any existing layers to prevent flash of old content at wrong scale
            clearMapLayers();

// Set mode and current day
            mapMode = 'day';
            currentDayKey = dayKey;
            
            // Set currentDayIndex based on currentDayKey so stats panel shows correct day
            const days = getDaysInCurrentMonth();
            currentDayIndex = days.indexOf(dayKey);
            
            // Update title (Use backticks for template literal)
            document.getElementById('mapPanelTitle').textContent = `All locations — ${formatDate(dayKey)}`;

            // Show controls
            document.getElementById('toolsBtn').style.display = 'block';
            document.getElementById('mapSaveBtn').style.display = 'block';
            document.getElementById('mapStyleSelector').style.display = 'block';
            updateMapStyleOptions(); // Update options based on Mapbox availability
            document.getElementById('mapStyleSelector').value = currentMapStyle;
            
            // Populate activity filters
            if (routeData) {
                const activities = getUniqueActivitiesFromRoutes(routeData);
                populateActivityFilters(activities);
            }
            
            // Check all filters (without triggering map update to avoid double-draw)
            checkAllActivityFilters();

            // Ensure map has correct size before adding markers
            map.invalidateSize();

            // Draw colour-coded route FIRST (so it appears under markers)
            // NOTE: Always pass fit: false here - showDayMap handles fitBounds itself
            // to include both markers AND route points in comprehensive bounds
            if (routeData && routeData.length > 1) {
                drawColorCodedRoute(routeData, { fit: false });
            }

            // Add marker clustering (drawn AFTER routes, so markers appear on top)
            markerLayer = L.layerGroup().addTo(map);
            
            clusterGroup = L.markerClusterGroup({
                iconCreateFunction: function (cluster) {
                    const children = cluster.getAllChildMarkers();
                    const anyNote = children.some(m => !!m.options._hasNote);
                    const count = cluster.getChildCount();
                    const cls = anyNote ? 'marker-cluster-note' : 'marker-cluster-nonote';
                    return L.divIcon({
                        html: `<div><span>${count}</span></div>`,
                        className: `marker-cluster ${cls}`,
                        iconSize: L.point(40, 40)
                    });
                }
            });

            markerLayer.addLayer(clusterGroup);

            // Add all pins
            const bounds = [];
            let targetMarker = null;
            
            // Clear previous circle markers tracking
            allCircleMarkers = [];

            // Robust target matching: pick the closest marker to the clicked coordinates (tolerant to rounding)
            let bestTargetMarker = null;
            let bestTargetD2 = Infinity;
            
            // Get current zoom level for marker sizing
            const currentZoom = map.getZoom();

            for (const p of locs) {
                // Guard against clusterGroup being cleared by concurrent operations
                if (!clusterGroup) {
                    logWarn('showDayMap: clusterGroup cleared during marker creation');
                    break;
                }
                
                const label = p.location || 'Unknown Location';
                
                // Arc Timeline style: blue circle marker with white border
                // Size dynamically based on zoom level
                const mm = L.circleMarker([p.lat, p.lng], {
                    radius: getMarkerRadius(currentZoom),
                    fillColor: '#4285F4',  // Arc Timeline blue
                    color: '#FFFFFF',      // White border
                    weight: 3,             // Border width (thicker for better visibility)
                    opacity: 1,
                    fillOpacity: 1,
                    pane: 'circleMarkerPane',  // Custom pane to render above polylines
                    _hasNote: !!p.hasNote
                });
                
                // Track marker for zoom updates
                allCircleMarkers.push(mm);
                
                // Create popup with altitude and star button
                const isFav = isFavorite(p.lat, p.lng);
                const starIcon = isFav ? '★' : '☆';
                const starColor = isFav ? '#FFD700' : '#ccc';
                const starText = isFav ? 'Favorited' : 'Add to Favorites';
                
                let popupContent = `
                    <div style="min-width: 200px; max-width: 300px;">
                        <b style="display: block; margin-bottom: 8px; word-wrap: break-word; line-height: 1.4; font-size: 14px;">${label}</b>`;
                
                if (p.altitude !== null && p.altitude !== undefined) {
                    popupContent += `<div style="color: #666; margin-bottom: 6px; font-size: 13px;">↑ ${Math.round(p.altitude)}m</div>`;
                }
                popupContent += `<div style="font-size: 11px; color: #999; margin-bottom: 10px;">Lat: ${p.lat.toFixed(6)}<br>Lng: ${p.lng.toFixed(6)}</div>`;

                // Street View link
                const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}`;
                popupContent += `<a href="${streetViewUrl}" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #4285F4; text-decoration: none; margin-bottom: 10px; padding: 4px 8px; background: #f0f7ff; border-radius: 4px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M12 14c-4 0-6 2-6 4v2h12v-2c0-2-2-4-6-4z"/></svg>
                    Street View
                </a>`;

                // Star button at bottom
                popupContent += `
                        <button 
                            onclick="toggleFavoriteFromPopup('${label.replace(/'/g, "\\'")}', ${p.lat}, ${p.lng}, ${p.altitude}); return false;" 
                            style="width: 100%; padding: 6px 12px; background: ${isFav ? '#FFF9E6' : '#f5f5f5'}; border: 1px solid ${isFav ? '#FFD700' : '#ddd'}; border-radius: 6px; cursor: pointer; font-size: 13px; color: #333; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s;"
                            onmouseover="this.style.background='${isFav ? '#FFF3CC' : '#e8e8e8'}'" 
                            onmouseout="this.style.background='${isFav ? '#FFF9E6' : '#f5f5f5'}'"
                            title="${isFav ? 'Remove from favorites' : 'Add to favorites'}"
                        ><span style="font-size: 16px; color: ${starColor};">${starIcon}</span> ${starText}</button>
                    </div>`;
                
                mm.bindPopup(popupContent);
                
                // Add click handler to highlight diary entry
                mm.on('click', function() {
                    // Check if this location has a note
                    const hasNote = !!p.hasNote;
                    const notesOnlyCheckbox = document.getElementById('notesOnly');
                    
                    // If location has no note and "Notes only" is checked, auto-uncheck it to show all
                    if (!hasNote && notesOnlyCheckbox && notesOnlyCheckbox.checked) {
                        notesOnlyCheckbox.checked = false;
                        // Trigger change event to refresh diary
                        notesOnlyCheckbox.dispatchEvent(new Event('change'));
                        
                        // Wait for diary to refresh before highlighting
                        setTimeout(() => {
                            NavigationController.selectEntryFromMap(p.lat, p.lng, dayKey);
                        }, 100);
                    } else {
                        NavigationController.selectEntryFromMap(p.lat, p.lng, dayKey);
                    }
                });
                
                clusterGroup.addLayer(mm);
                bounds.push([p.lat, p.lng]);
                // Track closest marker to the clicked coordinates (more reliable than exact float comparison)
                if (targetLat !== null && targetLng !== null) {
                    const dLat = p.lat - targetLat;
                    const dLng = p.lng - targetLng;
                    const d2 = dLat * dLat + dLng * dLng;
                    if (d2 < bestTargetD2) {
                        bestTargetD2 = d2;
                        bestTargetMarker = mm;
                    }
                }
            }

            // Resolve clicked target marker (use closest marker; rounding between diary pins and route points can differ)
            if (targetLat !== null && targetLng !== null && bestTargetMarker) {
                targetMarker = bestTargetMarker;
            }

            // Fit bounds / focus logic (skip if caller will handle fitting)
            if (!skipFit && targetMarker) {
                // When a specific location was clicked, focus immediately on it (don’t start zoomed-out)
                const ll = targetMarker.getLatLng();
                panToWithDiaryOffset(ll.lat, ll.lng, 15);

                // Ensure it is visible even if inside a cluster, then open the popup
                setTimeout(() => {
                    // Guard against clusterGroup being cleared by rapid navigation
                    if (!clusterGroup) return;
                    
                    // Check if the marker is inside a cluster
                    const visibleParent = clusterGroup.getVisibleParent(targetMarker);
                    
                    if (visibleParent && visibleParent !== targetMarker) {
                        // Marker is clustered - use spiderfied event for reliable popup opening
                        const onSpiderfied = () => {
                            clusterGroup.off('spiderfied', onSpiderfied);
                            setTimeout(() => {
                                panToWithDiaryOffset(ll.lat, ll.lng);
                                openPopupDelayed(targetMarker, 50);
                            }, 100);
                        };
                        clusterGroup.on('spiderfied', onSpiderfied);
                        
                        if (visibleParent.spiderfy) {
                            visibleParent.spiderfy();
                        }
                        
                        // Fallback timeout in case spiderfied doesn't fire
                        setTimeout(() => {
                            clusterGroup.off('spiderfied', onSpiderfied);
                        }, 1000);
                    } else {
                        // Marker is already visible (not clustered)
                        openPopupDelayed(targetMarker);
                    }
                }, 300);
            } else if (!skipFit && bounds.length >= 2) {
                // Calculate comprehensive bounds including BOTH markers AND polyline points
                const allBounds = [...bounds]; // Start with marker locations
                
                // Add all route points to bounds (polylines may extend beyond marker locations)
                // Filter to valid coordinates only (lat: -90 to 90, lng: -180 to 180)
                if (routeData && routeData.length > 0) {
                    for (const point of routeData) {
                        if (point.lat !== undefined && point.lng !== undefined &&
                            isFinite(point.lat) && isFinite(point.lng) &&
                            point.lat >= -90 && point.lat <= 90 &&
                            point.lng >= -180 && point.lng <= 180) {
                            allBounds.push([point.lat, point.lng]);
                        }
                    }
                }
                
                // Add padding to keep routes visible (not hidden under diary and stats panels)
                const padding = getMapPadding();
                debugFitBounds(allBounds, {
                    paddingTopLeft: padding.paddingTopLeft,
                    paddingBottomRight: padding.paddingBottomRight,
                    animate: false  // Disable animation to prevent visual glitch
                }, 'showDayMap');
            } else if (!skipFit && bounds.length === 1) {
                panToWithDiaryOffset(bounds[0][0], bounds[0][1], 15);
            } else if (!skipFit && routeData && routeData.length >= 2) {
                // No markers but have route data - fit to route
                // Filter to valid coordinates only
                const routeBounds = routeData
                    .filter(p => p.lat !== undefined && p.lng !== undefined &&
                                 isFinite(p.lat) && isFinite(p.lng) &&
                                 p.lat >= -90 && p.lat <= 90 &&
                                 p.lng >= -180 && p.lng <= 180)
                    .map(p => [p.lat, p.lng]);
                if (routeBounds.length >= 2) {
                    const padding = getMapPadding();
                    debugFitBounds(routeBounds, { 
                        paddingTopLeft: padding.paddingTopLeft,
                        paddingBottomRight: padding.paddingBottomRight,
                        animate: false
                    }, 'showDayMap-routeOnly');
                }
            }
            
            // Update stats panel for current day
            setTimeout(() => {
                updateStatsForCurrentView();
            }, 250);
            
            // If replay controller is visible, update it for this day
            const replayControllerEl = document.getElementById('replayController');
            if (replayControllerEl && replayControllerEl.style.display === 'flex') {
                if (window.replayState) window.replayState.selectedDayKey = dayKey;
                if (window.updateReplayDateDisplay) window.updateReplayDateDisplay(dayKey);
                if (window.loadReplayDay) window.loadReplayDay(dayKey);
                if (window.positionReplayController) window.positionReplayController();
            }
        }

        function showActivityRoutePopup(dayKey, activityStartTime) {
            // If we're already on the day map, check if the activity is filtered out
            if (mapMode === 'day' && currentDayKey === dayKey) {
                // First determine which activity type this is
                const activityType = getActivityTypeFromTime(dayKey, activityStartTime);
                
                if (activityType) {
                    // Check if this activity is currently filtered out
                    const checkbox = document.querySelector(`.activity-filter[data-activity="${activityType}"]`);
                    if (checkbox && !checkbox.checked) {
                        // Re-enable this activity type
                        checkbox.checked = true;
                        // Redraw routes to include this activity
                        updateMapRoutes();
                        // Wait for routes to be drawn, then highlight
                        setTimeout(() => {
                            highlightAndShowRouteByTime(activityStartTime);
                        }, 100);
                        return;
                    }
                }
                
                highlightAndShowRouteByTime(activityStartTime);
                return;
            }
            
            // First find the matching route to get its center point
            // We need to calculate this from the day's route data before opening the map
            const diary = generatedDiaries[getDiaryKeyForDay(dayKey)];
            
            if (!diary || !diary.routesByDay || !diary.routesByDay[dayKey]) {
                showDayMap(dayKey, null, null);
                return;
            }
            
            // Find the route segment matching this start time from the raw route data
            const dayRoutes = diary.routesByDay[dayKey];
            const centerPoint = findRouteCenterByTime(dayRoutes, activityStartTime);
            
            if (centerPoint) {
                // Open day map but skip initial fit - let highlightAndShowRouteByTime handle it
                showDayMap(dayKey, null, null, true);  // skipFit = true
                
                // After map loads, highlight the route (this does the proper fit)
                setTimeout(() => {
                    highlightAndShowRouteByTime(activityStartTime);
                }, 300);
            } else {
                showDayMap(dayKey, null, null);
            }
        }
        
        function getActivityTypeFromTime(dayKey, targetStartTime) {
            // Find the activity type by searching route data for this time
            const diary = generatedDiaries[getDiaryKeyForDay(dayKey)];
            if (!diary || !diary.routesByDay || !diary.routesByDay[dayKey]) {
                return null;
            }
            
            const dayRoutes = diary.routesByDay[dayKey];
            const TIME_TOLERANCE = 2 * 60 * 1000; // 2 minutes
            
            for (const point of dayRoutes) {
                const pointTime = getPointTime(point);
                if (pointTime === null) continue;
                
                const timeDiff = Math.abs(pointTime - targetStartTime);
                if (timeDiff < TIME_TOLERANCE && point.activityType) {
                    return point.activityType;
                }
            }
            
            return null;
        }
        
        function highlightAndShowRouteByTime(activityStartTime) {
            // Find the route segment that matches this activity's start time
            const matchingSegment = findRouteSegmentByTime(activityStartTime);
            
            if (matchingSegment && matchingSegment.segment) {
                // Calculate bounds of the route for proper zoom
                const bounds = L.latLngBounds(matchingSegment.points.map(p => [p.lat, p.lng]));
                
                // Use centralized padding from NavigationController
                const padding = getMapPadding();
                
                debugFitBounds(bounds, {
                    paddingTopLeft: padding.paddingTopLeft,
                    paddingBottomRight: padding.paddingBottomRight,
                    maxZoom: 18
                }, 'highlightAndShowRouteByTime');
                
                // Dim other segments and reset to original colors
                allRouteSegments.forEach(seg => {
                    seg.segment.setStyle({ 
                        opacity: 0.2, 
                        weight: 7,
                        color: seg.color  // Reset to original color
                    });
                    seg.border.setStyle({ opacity: 0.2, weight: 10 });
                    seg.segment._isHighlighted = false;
                    seg.border._isHighlighted = false;
                });
                
                // Highlight this segment with bright color for better feedback
                const segmentColor = matchingSegment.color || getActivityColor(matchingSegment.segment.options.activityType);
                const brightColor = lightenColor(segmentColor, 0.3);  // Make 30% brighter
                
                matchingSegment.segment._isHighlighted = true;
                matchingSegment.border._isHighlighted = true;
                
                // Close any existing popups before showing new one
                map.closePopup();
                
                // Show segment immediately (animation removed - use replay controller for animated playback)
                matchingSegment.border.setStyle({ opacity: 1, weight: 12 });
                matchingSegment.segment.setStyle({ 
                    opacity: 1, 
                    weight: 10,
                    color: brightColor
                });
                
                // Open the popup with delay
                openPopupDelayed(matchingSegment.segment, 300);
            }
        }
        
        function findRouteCenterByTime(routePoints, targetStartTime) {
            // Find route points that match the activity start time
            const TIME_TOLERANCE = 2 * 60 * 1000; // 2 minutes
            
            // Get locations for checking if visits occurred during gaps
            const dayKey = routePoints[0]?.dayKey;
            const monthKey = dayKey ? dayKey.substring(0, 7) : null;
            const dayLocations = (monthKey && dayKey && generatedDiaries[monthKey]?.locationsByDay?.[dayKey]) || [];
            
            let segmentPoints = [];
            let targetActivityType = null;
            let lastPointTime = null;
            
            for (const point of routePoints) {
                const pointTime = getPointTime(point);
                if (pointTime === null) continue;
                
                // Check if this is the start of our target segment
                const timeDiff = Math.abs(pointTime - targetStartTime);
                if (timeDiff < TIME_TOLERANCE && segmentPoints.length === 0) {
                    // Found the start of our segment
                    segmentPoints.push(point);
                    targetActivityType = point.activityType;
                    lastPointTime = pointTime;
                } else if (segmentPoints.length > 0) {
                    // We're collecting points for this segment
                    // Stop when activity type changes
                    if (point.activityType !== targetActivityType) {
                        break;
                    }
                    
                    // Check if there's a location visit in the gap
                    let visitInGap = false;
                    if (lastPointTime !== null) {
                        const gapStart = lastPointTime;
                        const gapEnd = pointTime;
                        
                        for (const loc of dayLocations) {
                            const visitStart = loc.startDate ? new Date(loc.startDate).getTime() : null;
                            const visitEnd = loc.endDate ? new Date(loc.endDate).getTime() : null;
                            
                            if (visitStart !== null && visitEnd !== null) {
                                if (visitStart < gapEnd && visitEnd > gapStart) {
                                    visitInGap = true;
                                    break;
                                }
                            }
                        }
                    }
                    
                    if (visitInGap) {
                        // End of segment - location visit in gap
                        break;
                    }
                    
                    segmentPoints.push(point);
                    lastPointTime = pointTime;
                }
            }
            
            if (segmentPoints.length > 0) {
                return calculateRouteCenter(segmentPoints);
            }
            
            return null;
        }
        
        function getDiaryKeyForDay(dayKey) {
            // Convert day key (2025-12-04) to month key (2025-12)
            const parts = dayKey.split('-');
            return `${parts[0]}-${parts[1]}`;
        }
        
        function findRouteSegmentByTime(targetStartTime) {
            // Search through all route segments to find one with matching start time
            const TIME_TOLERANCE = 2 * 60 * 1000; // 2 minutes tolerance
            
            for (const segObj of allRouteSegments) {
                const segment = segObj.segment;
                const latlngs = segment.getLatLngs();
                
                // Get the segment's start time from the first point
                if (latlngs.length > 0) {
                    // We need to find the corresponding route point with time data
                    // This is stored when the segment was created
                    if (segment._routePoints && segment._routePoints.length > 0) {
                        const firstPoint = segment._routePoints[0];
                        const segmentStartTime = getPointTime(firstPoint);
                        
                        if (segmentStartTime !== null) {
                            const timeDiff = Math.abs(segmentStartTime - targetStartTime);
                            
                            if (timeDiff < TIME_TOLERANCE) {
                                return {
                                    segment: segment,
                                    border: segObj.border,
                                    points: segment._routePoints,
                                    color: segObj.color  // Include color for bright highlighting
                                };
                            }
                        }
                    }
                }
            }
            
            return null;
        }
        
        function calculateRouteCenter(points) {
            if (!points || points.length === 0) return null;
            
            // Calculate the geographic center (average lat/lng)
            let sumLat = 0;
            let sumLng = 0;
            let count = 0;
            
            for (const point of points) {
                if (point.lat && point.lng) {
                    sumLat += point.lat;
                    sumLng += point.lng;
                    count++;
                }
            }
            
            if (count === 0) return null;
            
            return {
                lat: sumLat / count,
                lng: sumLng / count
            };
        }
        
        
        function clearMapLayers() {
            clusterGroup = null;
            if (markerLayer) {
                map.removeLayer(markerLayer);
                markerLayer = null;
            }
            clearDayRoute();
        }
        
        function clearDayRoute() {
            if (!map) return;
            if (dayRoutePolyline) {
                map.removeLayer(dayRoutePolyline);
                dayRoutePolyline = null;
            }
            allRouteSegments = [];
        }

        // Expose map functions for external tools (map-tools.js)
        window.clearMapLayers = clearMapLayers;
        window.showDayMap = showDayMap;

        function drawColorCodedRoute(routePoints, options = {}) {
            if (!map || !routePoints || routePoints.length < 2) return;
            
            const shouldFit = (options.fit !== false);
            let currentActivity = null;
            let currentSegment = [];
            let lastPointTime = null;
            let lastTimelineItemId = null;
            const allDrawnBounds = [];
            
            // Get locations for checking if visits occurred during gaps
            const dayKey = routePoints[0]?.dayKey;
            const monthKey = dayKey ? dayKey.substring(0, 7) : null;
            const dayLocations = (monthKey && dayKey && generatedDiaries[monthKey]?.locationsByDay?.[dayKey]) || [];
            
            for (let i = 0; i < routePoints.length; i++) {
                const point = routePoints[i];
                const activity = (point.activityType || 'unknown').toLowerCase();
                const pointTime = getPointTime(point);
                
                // Determine if we should start a new segment
                let shouldStartNewSegment = false;
                const pointTimelineItemId = point.timelineItemId || null;
                
                if (activity !== currentActivity) {
                    // Different activity type - always split
                    shouldStartNewSegment = true;
                } else if (lastTimelineItemId && pointTimelineItemId && pointTimelineItemId !== lastTimelineItemId) {
                    // Prefer explicit timeline item boundaries when available.
                    shouldStartNewSegment = true;
                } else if (lastPointTime !== null && pointTime !== null && currentSegment.length > 0) {
                    // Same activity type - check if there's a location visit in the gap
                    const gapStart = lastPointTime;
                    const gapEnd = pointTime;
                    
                    // Check if any location visit occurred during this gap
                    for (const loc of dayLocations) {
                        const visitStart = loc.startDate ? new Date(loc.startDate).getTime() : null;
                        const visitEnd = loc.endDate ? new Date(loc.endDate).getTime() : null;
                        
                        if (visitStart !== null && visitEnd !== null) {
                            // Visit overlaps with gap if visit started before gap ended AND visit ended after gap started
                            if (visitStart < gapEnd && visitEnd > gapStart) {
                                if (activity === 'walking') {
                                    logDebug(`🚶 Splitting walking due to visit: ${loc.location || 'unknown'}`);
                                }
                                shouldStartNewSegment = true;
                                break;
                            }
                        }
                    }
                }
                
                if (shouldStartNewSegment) {
                    if (currentSegment.length >= 2) {
                        const bounds = drawActivitySegment(currentSegment, currentActivity);
                        if (bounds) allDrawnBounds.push(...bounds);
                    } else if (currentSegment.length === 1 && currentActivity === 'walking') {
                        logDebug(`🚶 Walking segment NOT drawn: only ${currentSegment.length} point(s)`);
                    }
                    currentActivity = activity;
                    currentSegment = [point];
                } else {
                    currentSegment.push(point);
                }
                
                // Update last point time
                if (pointTime !== null) {
                    lastPointTime = pointTime;
                }
                lastTimelineItemId = pointTimelineItemId;
            }
            
            if (currentSegment.length >= 2) {
                const bounds = drawActivitySegment(currentSegment, currentActivity);
                if (bounds) allDrawnBounds.push(...bounds);
            } else if (currentSegment.length === 1 && currentActivity === 'walking') {
                logDebug(`🚶 Final walking segment NOT drawn: only ${currentSegment.length} point(s)`);
            }
            
            // If we have any route points at all, make sure we fit to ALL of them (not just drawn segments)
            if (shouldFit) {
                if (allDrawnBounds.length >= 2) {
                    // Use the bounds from drawn segments
                    const padding = getMapPadding();
                    debugFitBounds(allDrawnBounds, { 
                        paddingTopLeft: padding.paddingTopLeft,
                        paddingBottomRight: padding.paddingBottomRight,
                        animate: false
                    }, 'drawDayRoutes-drawnBounds');
                } else if (routePoints.length >= 2) {
                    // Fallback: if no segments were drawn (filtered out), use all route points
                    const allPoints = routePoints.map(p => [p.lat, p.lng]);
                    const padding = getMapPadding();
                    debugFitBounds(allPoints, { 
                        paddingTopLeft: padding.paddingTopLeft,
                        paddingBottomRight: padding.paddingBottomRight,
                        animate: false
                    }, 'drawDayRoutes-allPoints');
                }
            }
        }
        
        function drawActivitySegment(points, activity) {
            if (!points || points.length < 2) return null;
            
            const activityType = getActivityFilterType(activity);

            // Stationary isn’t a “path” — don’t render it as a route segment
            if (activityType === 'stationary') return null;

            const filterCheckbox = document.querySelector(`.activity-filter[data-activity="${activityType}"]`);
            if (filterCheckbox && !filterCheckbox.checked) {
                return null;
            }
            
            const color = getActivityColor(activityType);
            // Filter to valid coordinates only
            const validPoints = points.filter(p => 
                p.lat !== undefined && p.lng !== undefined &&
                isFinite(p.lat) && isFinite(p.lng) &&
                p.lat >= -90 && p.lat <= 90 &&
                p.lng >= -180 && p.lng <= 180
            );
            if (validPoints.length < 2) return null;
            
            const latlngs = validPoints.map(p => [p.lat, p.lng]);
            
            const border = L.polyline(latlngs, {
                color: '#ffffff',
                weight: 10,
                opacity: 0.8
            });
            
            const segment = L.polyline(latlngs, {
                color: color,
                weight: 7,
                opacity: 1
            });
            
            const shouldShowPopup = (mapMode === 'month' && validPoints[0].dayKey) || (mapMode === 'day' && currentDayKey);
            
            if (shouldShowPopup) {
                const dayKey = (mapMode === 'month' ? validPoints[0].dayKey : currentDayKey);
                const date = new Date(dayKey);
                const dateStr = date.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                
                const activityLabel = activity ? activity.charAt(0).toUpperCase() + activity.slice(1) : 'Unknown';
                
                let distanceText = '';
                if (validPoints.length >= 2) {
                    let totalDistance = 0;
                    for (let i = 1; i < validPoints.length; i++) {
                        const p1 = validPoints[i - 1];
                        const p2 = validPoints[i];
                        if (p1.lat && p1.lng && p2.lat && p2.lng) {
                            totalDistance += calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
                        }
                    }
                    
                    if (totalDistance >= 1000) {
                        distanceText = ` • ${(totalDistance / 1000).toFixed(1)} km`;
                    } else if (totalDistance > 0) {
                        distanceText = ` • ${Math.round(totalDistance)} m`;
                    }
                }
                
                let durationText = '';
                const tStart = getPointTime(validPoints[0]);
                const tEnd = getPointTime(validPoints[validPoints.length - 1]);
                if (tStart != null && tEnd != null && tEnd > tStart) {
                    durationText = formatRouteTime(tEnd - tStart);
                }
                
                // Calculate elevation gain for this segment
                let elevationGainText = '';
                if (validPoints.length >= 2) {
                    const altitudes = validPoints
                        .map(p => p.altitude)  // Route points have 'altitude' property
                        .filter(alt => alt != null && !isNaN(alt));
                    
                    if (altitudes.length >= 2) {
                        let gain = 0;
                        for (let i = 1; i < altitudes.length; i++) {
                            const change = altitudes[i] - altitudes[i - 1];
                            if (change > 0) {
                                gain += change;
                            }
                        }
                        if (gain > 0) {
                            elevationGainText = `↑ ${Math.round(gain)}m`;
                        }
                    }
                }
                
                // Build popup content
                // Line 1: Date
                // Line 2: Start time - End time • Activity
                // Line 3: Distance • Duration
                let line2 = '';
                if (tStart != null && tEnd != null) {
                    const startTime = formatTime(new Date(tStart));
                    const endTime = formatTime(new Date(tEnd));
                    line2 = `${startTime} - ${endTime} • ${activityLabel}`;
                } else {
                    line2 = activityLabel;
                }
                
                let line3Parts = [];
                if (distanceText) {
                    line3Parts.push(distanceText.replace(' • ', '')); // Remove leading bullet from distance
                }
                if (durationText) {
                    line3Parts.push(durationText);
                }
                // Calculate average speed
                if (tStart != null && tEnd != null && tEnd > tStart && validPoints.length >= 2) {
                    let totalDistance = 0;
                    for (let i = 1; i < validPoints.length; i++) {
                        const p1 = validPoints[i - 1];
                        const p2 = validPoints[i];
                        if (p1.lat && p1.lng && p2.lat && p2.lng) {
                            totalDistance += calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
                        }
                    }
                    if (totalDistance > 0) {
                        const durationHours = (tEnd - tStart) / (1000 * 3600);
                        const speedKph = (totalDistance / 1000) / durationHours;
                        if (speedKph >= 0.1) {
                            line3Parts.push(`${speedKph.toFixed(1)} km/h`);
                        }
                    }
                }
                if (elevationGainText) {
                    line3Parts.push(elevationGainText);
                }
                const line3 = line3Parts.join(' • ');
                
                const currentZoom = Math.round(map.getZoom() * 10) / 10;
                const popupContent = `<strong>${dateStr}</strong><br>${line2}${line3 ? '<br>' + line3 : ''}<div class="popup-zoom" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 11px; opacity: 0.7;">Zoom: ${currentZoom}</div>`;
                segment.bindPopup(popupContent);
                border.bindPopup(popupContent);
                
                if (mapMode === 'month' && points[0].dayKey) {
                    segment._isHighlighted = false;
                    border._isHighlighted = false;
                    
                    const highlightSegment = function(e) {
                        const zoomToSegment = e && e.originalEvent && e.originalEvent.altKey;
                        
                        // Auto-uncheck "Notes only" if needed (similar to location behavior)
                        const notesOnlyCheckbox = document.getElementById('notesOnly');
                        const firstPoint = points[0];
                        
                        // Check if this activity might not have a note by looking for the hasNote property
                        // If we can't determine, auto-uncheck anyway to ensure visibility
                        if (notesOnlyCheckbox && notesOnlyCheckbox.checked) {
                            notesOnlyCheckbox.checked = false;
                            notesOnlyCheckbox.dispatchEvent(new Event('change'));
                            // Wait for diary to refresh before highlighting
                            setTimeout(() => {
                                performHighlight(zoomToSegment);
                            }, 100);
                            return; // Exit early, will highlight after refresh
                        }
                        
                        performHighlight(zoomToSegment);
                    };
                    
                        const performHighlight = function(zoomToSegment = false) {
                        allRouteSegments.forEach(seg => {
                            seg.segment.setStyle({ 
                                opacity: 0.2, 
                                weight: 7,
                                color: seg.color  // Reset to original color
                            });
                            seg.border.setStyle({ opacity: 0.2, weight: 10 });
                            seg.segment._isHighlighted = false;
                            seg.border._isHighlighted = false;
                        });
                        
                        // Highlight this segment with increased weight AND brighter color
                        const brightColor = lightenColor(color, 0.3);  // Make 30% brighter
                        segment.setStyle({ 
                            opacity: 1, 
                            weight: 10,
                            color: brightColor  // Brighter version of activity color
                        });
                        border.setStyle({ opacity: 1, weight: 12 });
                        segment._isHighlighted = true;
                        border._isHighlighted = true;
                        
                        // Zoom to this segment's bounds if Option/Alt key held
                        if (zoomToSegment && validPoints && validPoints.length >= 2) {
                            const bounds = L.latLngBounds(validPoints.map(p => [p.lat, p.lng]));
                            const padding = getMapPadding();
                            debugFitBounds(bounds, {
                                paddingTopLeft: padding.paddingTopLeft,
                                paddingBottomRight: padding.paddingBottomRight,
                                maxZoom: 18
                            }, 'segmentClick-monthMode');
                        }
                        
                        // Scroll diary to the day and highlight the specific activity entry
                        const dayKey = (mapMode === 'month' ? validPoints[0].dayKey : currentDayKey);
                        
                        if (dayKey) {
                            scrollToDiaryDay(dayKey);
                            
                            // Find and highlight the diary entry for this activity
                            // Use the start time and activity type to match
                            if (tStart != null && validPoints[0]) {
                                highlightDiaryEntryByTime(dayKey, tStart, activity);
                            }
                        }

                        hideProfileSelection();
                        // Sync elevation/speed panel to this segment
                        selectedProfileSegmentPoints = validPoints;
                        selectedProfileSegmentColor = color;
                        if (elevationPanelVisible) updateElevationChart();
                    };
                    
                    segment.on('click', highlightSegment);
                    border.on('click', highlightSegment);
                    
                    segment.on('mouseover', function() {
                        if (!this._isHighlighted) this.setStyle({ opacity: 0.4, weight: 8 });
                    });
                    segment.on('mouseout', function() {
                        if (!this._isHighlighted) {
                            const anyHighlighted = allRouteSegments.some(seg => seg.segment._isHighlighted);
                            this.setStyle({ 
                                opacity: anyHighlighted ? 0.2 : 1, 
                                weight: 7,
                                color: color  // Reset to original color
                            });
                        }
                    });
                    
                    border.on('mouseover', function() {
                        if (!this._isHighlighted) this.setStyle({ opacity: 0.4, weight: 11 });
                    });
                    border.on('mouseout', function() {
                        if (!this._isHighlighted) {
                            const anyHighlighted = allRouteSegments.some(seg => seg.segment._isHighlighted);
                            this.setStyle({ opacity: anyHighlighted ? 0.2 : 0.8, weight: 10 });
                        }
                    });
                } else if (mapMode === 'day' && currentDayKey) {
                    // Add click handler for day mode to scroll and highlight the activity
                    segment._isHighlighted = false;
                    border._isHighlighted = false;
                    
                    const scrollToDay = function(e) {
                        const zoomToSegment = e && e.originalEvent && e.originalEvent.altKey;
                        
                        // Auto-uncheck "Notes only" if needed
                        const notesOnlyCheckbox = document.getElementById('notesOnly');
                        
                        if (notesOnlyCheckbox && notesOnlyCheckbox.checked) {
                            notesOnlyCheckbox.checked = false;
                            notesOnlyCheckbox.dispatchEvent(new Event('change'));
                            // Wait for diary to refresh before highlighting
                            setTimeout(() => {
                                performDayHighlight(zoomToSegment);
                            }, 100);
                            return;
                        }
                        
                        performDayHighlight(zoomToSegment);
                    };
                    
                    const performDayHighlight = function(zoomToSegment = false) {
                        // Dim all segments and reset colors
                        allRouteSegments.forEach(seg => {
                            seg.segment.setStyle({ 
                                opacity: 0.3, 
                                weight: 7,
                                color: seg.color  // Reset to original color
                            });
                            seg.border.setStyle({ opacity: 0.3, weight: 10 });
                            seg.segment._isHighlighted = false;
                            seg.border._isHighlighted = false;
                        });
                        
                        // Highlight this segment with brighter color
                        const brightColor = lightenColor(color, 0.3);
                        segment.setStyle({ 
                            opacity: 1, 
                            weight: 10,
                            color: brightColor
                        });
                        border.setStyle({ opacity: 1, weight: 12 });
                        segment._isHighlighted = true;
                        border._isHighlighted = true;
                        
                        // Zoom to this segment's bounds if Option/Alt key held
                        if (zoomToSegment && validPoints && validPoints.length >= 2) {
                            const bounds = L.latLngBounds(validPoints.map(p => [p.lat, p.lng]));
                            const padding = getMapPadding();
                            debugFitBounds(bounds, {
                                paddingTopLeft: padding.paddingTopLeft,
                                paddingBottomRight: padding.paddingBottomRight,
                                maxZoom: 18
                            }, 'segmentClick-dayMode');
                        }
                        
                        if (currentDayKey) {
                            // Keep keyboard day navigation aligned with the day clicked on the map
                            const allDays = getDaysInCurrentMonth();
                            const idx = allDays.indexOf(currentDayKey);
                            if (idx !== -1) currentDayIndex = idx;

scrollToDiaryDay(currentDayKey);
                            
                            // Highlight the specific activity entry
                            if (tStart != null) {
                                highlightDiaryEntryByTime(currentDayKey, tStart, activity);
                            }
                        }

                        hideProfileSelection();
                        // Sync elevation/speed panel to this segment
                        selectedProfileSegmentPoints = validPoints;
                        selectedProfileSegmentColor = color;
                        if (elevationPanelVisible) updateElevationChart();
                    };
                    
                    segment.on('click', scrollToDay);
                    border.on('click', scrollToDay);
                    
                    // Add hover effects for day mode
                    segment.on('mouseover', function() {
                        if (!this._isHighlighted) this.setStyle({ opacity: 0.6, weight: 8 });
                    });
                    segment.on('mouseout', function() {
                        if (!this._isHighlighted) {
                            const anyHighlighted = allRouteSegments.some(seg => seg.segment._isHighlighted);
                            this.setStyle({ 
                                opacity: anyHighlighted ? 0.3 : 1, 
                                weight: 7,
                                color: color
                            });
                        }
                    });
                    
                    border.on('mouseover', function() {
                        if (!this._isHighlighted) this.setStyle({ opacity: 0.6, weight: 11 });
                    });
                    border.on('mouseout', function() {
                        if (!this._isHighlighted) {
                            const anyHighlighted = allRouteSegments.some(seg => seg.segment._isHighlighted);
                            this.setStyle({ opacity: anyHighlighted ? 0.3 : 0.8, weight: 10 });
                        }
                    });
                }
            }
            
            if (!dayRoutePolyline) {
                dayRoutePolyline = L.layerGroup().addTo(map);
            }
            dayRoutePolyline.addLayer(border);
            dayRoutePolyline.addLayer(segment);
            
            // Store route points with the segment for later matching (when clicking diary entries)
            segment._routePoints = validPoints;
            border._routePoints = validPoints;
            
            // Store in allRouteSegments for both month and day modes
            if (validPoints[0].dayKey && mapMode === 'month') {
                allRouteSegments.push({ segment, border, color, points: validPoints });
            } else if (mapMode === 'day') {
                allRouteSegments.push({ segment, border, color, points: validPoints });
            }
            
            return latlngs;
        }
        
        // Hide/show diary routes (used by location search routing)
        function hideDiaryRoutes() {
            if (dayRoutePolyline && map.hasLayer(dayRoutePolyline)) {
                map.removeLayer(dayRoutePolyline);
            }
            if (markerLayer && map.hasLayer(markerLayer)) {
                map.removeLayer(markerLayer);
            }
            if (clusterGroup && map.hasLayer(clusterGroup)) {
                map.removeLayer(clusterGroup);
            }
        }
        
        function showDiaryRoutes() {
            const searchPopup = document.getElementById('searchPopup');
            if (searchPopup && searchPopup.style.display === 'block') {
                return; // Keep routes hidden while route search is open
            }
            if (dayRoutePolyline && !map.hasLayer(dayRoutePolyline)) {
                map.addLayer(dayRoutePolyline);
            }
            if (markerLayer && !map.hasLayer(markerLayer)) {
                map.addLayer(markerLayer);
            }
            if (clusterGroup && !map.hasLayer(clusterGroup)) {
                map.addLayer(clusterGroup);
            }
        }
        
        function getActivityColor(activityType) {
            const colors = {
                'stationary': '#7A3CFC',
                'walking': '#12A656',
                'hiking': '#0E8444',
                'running': '#EB781B',
                'cycling': '#039FD4',
                'car': '#4E5268',
                'bus': '#4056B5',
                'motorcycle': '#E35641',
                'airplane': '#8E1DD2',
                'boat': '#3B71F6',
                'train': '#AA9131',
                'skateboarding': '#18A1B1',
                'inlineSkating': '#D85582',
                'snowboarding': '#4884AE',
                'skiing': '#26398B',
                'horseback': '#8B408C',
                'surfing': '#D85582',
                'tractor': '#2D2F3E',
                'tuktuk': '#B4831D',
                'unknown': '#808080'
            };
            
            return colors[activityType] || '#808080';
        }
        
        function lightenColor(hexColor, percent) {
            // Convert hex to RGB
            const hex = hexColor.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            
            // Lighten by moving towards white
            const nr = Math.min(255, Math.round(r + (255 - r) * percent));
            const ng = Math.min(255, Math.round(g + (255 - g) * percent));
            const nb = Math.min(255, Math.round(b + (255 - b) * percent));
            
            // Convert back to hex
            const toHex = (n) => {
                const hex = n.toString(16);
                return hex.length === 1 ? '0' + hex : hex;
            };
            
            return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
        }
        
        function getActivityLabel(activityType) {
            const labels = {
                'stationary': 'Stationary',
                'walking': 'Walking',
                'hiking': 'Hiking',
                'running': 'Running',
                'cycling': 'Cycling/Water',
                'car': 'Car/Taxi',
                'bus': 'Bus',
                'motorcycle': 'Motorcycle/Scooter',
                'airplane': 'Airplane',
                'boat': 'Boat',
                'train': 'Rail Transport',
                'skateboarding': 'Skateboarding',
                'inlineSkating': 'Inline Skating',
                'snowboarding': 'Snowboarding',
                'skiing': 'Skiing',
                'horseback': 'Horseback',
                'surfing': 'Surfing',
                'tractor': 'Tractor',
                'tuktuk': 'Tuk-tuk',
                'unknown': 'Other'
            };
            
            return labels[activityType] || 'Other';
        }
        
        function getActivityIcon(activityType) {
            const icons = {
                'stationary': '📍',
                'walking': '🚶',
                'hiking': '🥾',
                'running': '🏃',
                'cycling': '🚴',
                'car': '🚗',
                'bus': '🚌',
                'motorcycle': '🏍️',
                'airplane': '✈️',
                'boat': '⛴️',
                'train': '🚆',
                'skateboarding': '🛹',
                'inlineSkating': '⛸️',
                'snowboarding': '🏂',
                'skiing': '⛷️',
                'horseback': '🐴',
                'surfing': '🏄',
                'tractor': '🚜',
                'tuktuk': '🛺',
                'unknown': '❓'
            };
            
            return icons[activityType] || '';
        }
        
        function getUniqueActivitiesFromRoutes(routeData) {
            const activitySet = new Set();
            
            if (Array.isArray(routeData)) {
                routeData.forEach(point => {
                    if (point.activityType) {
                        const filterType = getActivityFilterType(point.activityType);
                        if (filterType !== 'stationary') {
                            activitySet.add(filterType);
                        }
                    }
                });
            } else {
                Object.values(routeData).forEach(dayRoutes => {
                    if (Array.isArray(dayRoutes)) {
                        dayRoutes.forEach(point => {
                            if (point.activityType) {
                                const filterType = getActivityFilterType(point.activityType);
                                if (filterType !== 'stationary') {
                                    activitySet.add(filterType);
                                }
                            }
                        });
                    }
                });
            }
            
            const activities = Array.from(activitySet).sort();
            return activities;
        }
        
        function populateActivityFilters(activities) {
            const filterBody = document.querySelector('.filter-modal-body');
            if (!filterBody) return;
            
            const currentStates = {};
            filterBody.querySelectorAll('.activity-filter').forEach(checkbox => {
                currentStates[checkbox.dataset.activity] = checkbox.checked;
            });
            
            let html = `
                <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; margin-bottom: 14px; font-weight: 600;">
                    <input type="checkbox" id="selectAllActivities" checked onchange="toggleAllActivities()">
                    Select All
                </label>
                <div style="border-top: 1px solid #e0e0e0; padding-top: 14px;">
            `;
            
            activities.forEach(activityType => {
                const color = getActivityColor(activityType);
                const label = getActivityLabel(activityType);
                const isChecked = currentStates[activityType] !== undefined ? currentStates[activityType] : true;
                html += `
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; margin-bottom: 12px;">
                        <input type="checkbox" class="activity-filter" data-activity="${activityType}" ${isChecked ? 'checked' : ''} onchange="logDebug('🔔 Checkbox onchange: ${activityType}', this.checked); updateMapRoutes()">
                        <span style="color: ${color}; font-weight: bold; font-size: 16px;">●</span> ${label}
                    </label>
                `;
            });
            
            html += '</div>';
            filterBody.innerHTML = html;
        }
        
        function filterToActivity(activityType, event) {
            // Prevent accidental clicks when stats panel just appeared under mouse cursor
            const currentTime = Date.now();
            const timeSinceShowPanel = currentTime - lastStatsPanelShowTime;
            
            if (timeSinceShowPanel < 200) {
                return;
            }
            
            // Get all activity filter checkboxes
            const checkboxes = document.querySelectorAll('.activity-filter');
            
            // Check if modifier key is pressed (Shift, Ctrl, Cmd/Meta)
            const isMultiSelect = event && (event.shiftKey || event.ctrlKey || event.metaKey);
            
            if (isMultiSelect) {
                // Multi-select mode: toggle this activity
                checkboxes.forEach(checkbox => {
                    if (checkbox.dataset.activity === activityType) {
                        checkbox.checked = !checkbox.checked;
                    }
                });
                
                // If nothing is checked, check everything (avoid empty state)
                const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
                if (!anyChecked) {
                    checkboxes.forEach(checkbox => {
                        checkbox.checked = true;
                    });
                }
            } else {
                // Single-select mode: check if we're already filtering to just this activity
                let currentlyFiltered = true;
                let checkedCount = 0;
                
                checkboxes.forEach(checkbox => {
                    const isThisActivity = checkbox.dataset.activity === activityType;
                    if (checkbox.checked) checkedCount++;
                    if (!isThisActivity && checkbox.checked) currentlyFiltered = false;
                });
                
                // If already filtered to just this activity, show all activities
                if (currentlyFiltered && checkedCount === 1) {
                    // Show all
                    checkboxes.forEach(checkbox => {
                        checkbox.checked = true;
                    });
                } else {
                    // Filter to just this activity
                    checkboxes.forEach(checkbox => {
                        checkbox.checked = (checkbox.dataset.activity === activityType);
                    });
                }
            }
            
            // Update visual feedback: dim unselected tiles
            updateStatsTileVisuals();
            
            // Update the map to show the filtered routes
            updateMapRoutes();
        }
        
        function updateStatsTileVisuals() {
            // Get which activities are currently selected
            const selectedActivities = new Set();
            document.querySelectorAll('.activity-filter').forEach(checkbox => {
                if (checkbox.checked) {
                    selectedActivities.add(checkbox.dataset.activity);
                }
            });
            
            // Check if all are selected
            const allSelected = document.querySelectorAll('.activity-filter').length === selectedActivities.size;
            
            // Update tile visual states
            document.querySelectorAll('.stats-tile').forEach(tile => {
                const tileActivity = tile.dataset.activity;
                const isSelected = selectedActivities.has(tileActivity);
                
                if (allSelected) {
                    // All selected = none dimmed
                    tile.classList.remove('dimmed');
                } else if (isSelected) {
                    // This activity is selected = not dimmed
                    tile.classList.remove('dimmed');
                } else {
                    // This activity is not selected = dimmed
                    tile.classList.add('dimmed');
                }
            });
        }
        
        function restoreAllActivities() {
            // Check all activity filter checkboxes
            document.querySelectorAll('.activity-filter').forEach(checkbox => {
                checkbox.checked = true;
            });
            
            // Check the "Select All" checkbox
            const selectAllCheckbox = document.getElementById('selectAllActivities');
            if (selectAllCheckbox) {
                selectAllCheckbox.checked = true;
            }
            
            // Remove dimmed class from all tiles
            document.querySelectorAll('.stats-tile').forEach(tile => {
                tile.classList.remove('dimmed');
            });
            
            // Update the map to show all routes
            updateMapRoutes();
        }
        
        // Global flag to prevent updateMapRoutes from running during programmatic changes
        let suppressMapUpdates = false;
        let lastStatsPanelShowTime = 0; // Timestamp to prevent accidental tile clicks
        
        function checkAllActivityFilters() {
            // Just check all checkboxes without updating map
            // Used when initializing day/month views to avoid double-drawing
            suppressMapUpdates = true;  // Prevent onchange events from triggering map updates
            
            const checkboxes = document.querySelectorAll('.activity-filter');
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
            });
            
            const selectAllCheckbox = document.getElementById('selectAllActivities');
            if (selectAllCheckbox) {
                selectAllCheckbox.checked = true;
            }
            
            document.querySelectorAll('.stats-tile').forEach(tile => {
                tile.classList.remove('dimmed');
            });
            
            suppressMapUpdates = false;  // Re-enable map updates
        }
        
        function updateMapRoutes() {
            // Skip if we're suppressing updates (during programmatic checkbox changes)
            if (suppressMapUpdates) {
                return;
            }
            
            clearDayRoute();
            
            if (mapMode === 'day' && currentDayKey) {
                const diary = generatedDiaries[currentMonth];
                const routeData = diary?.routesByDay?.[currentDayKey];
                
                if (routeData && routeData.length > 1) {
                    drawColorCodedRoute(routeData);
                }
            } else if (mapMode === 'month' && currentMonth) {
                const diary = generatedDiaries[currentMonth];
                const routesByDay = diary?.routesByDay || {};
                
                const allRoutes = [];
                const allDays = Object.keys(routesByDay).sort();
                
                for (const dayKey of allDays) {
                    const dayRoutes = routesByDay[dayKey];
                    if (dayRoutes && dayRoutes.length > 0) {
                        const routesWithDay = dayRoutes.map(point => ({
                            ...point,
                            dayKey: dayKey
                        }));
                        allRoutes.push(...routesWithDay);
                    }
                }
                
                if (allRoutes.length > 1) {
                    drawColorCodedRoute(allRoutes);
                }
            }
            
            // Sync "Select All" checkbox state based on individual activity checkboxes
            const selectAllCheckbox = document.getElementById('selectAllActivities');
            if (selectAllCheckbox) {
                const activityCheckboxes = document.querySelectorAll('.activity-filter');
                const allChecked = Array.from(activityCheckboxes).every(cb => cb.checked);
                selectAllCheckbox.checked = allChecked;
            }
            
            // Update stats tile visual feedback to match current filter state
            updateStatsTileVisuals();
        }
        
        function getPointTime(p) {
            if (!p) return null;
            if (p.t == null) return null;
            if (typeof p.t === 'number') return p.t;
            const parsed = Date.parse(p.t);
            return isNaN(parsed) ? null : parsed;
        }
        
        // calculateDistance — now in arc-utils.js (bridged at top of utils section)

        function formatRouteTime(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            
            let displayMinutes = minutes;
            if (seconds >= 30) {
                displayMinutes += 1;
                if (displayMinutes >= 60) {
                    displayMinutes = 0;
                }
            }
            
            if (hours > 0) {
                return `${hours}h ${displayMinutes}m`;
            }
            return `${displayMinutes}m`;
        }
        
        function getTileLayer(style) {
            const mapboxToken = localStorage.getItem('arc_mapbox_token');
            
            // Mapbox styles (when token available)
            if (mapboxToken) {
                const mapboxStyles = {
                    street: { style: 'streets-v12', maxZoom: 20 },
                    dark: { style: 'dark-v11', maxZoom: 20 },
                    outdoors: { style: 'outdoors-v12', maxZoom: 20 },
                    satellite: { style: 'satellite-streets-v12', maxZoom: 20 }
                };
                
                if (mapboxStyles[style]) {
                    const config = mapboxStyles[style];
                    return L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/${config.style}/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`, {
                        attribution: '© Mapbox © OpenStreetMap',
                        maxZoom: config.maxZoom,
                        tileSize: 512,
                        zoomOffset: -1,
                        crossOrigin: 'anonymous'
                    });
                }
                
                // CyclOSM even with Mapbox (specialized)
                if (style === 'cycle') {
                    return L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
                        attribution: '© OpenStreetMap contributors, CyclOSM',
                        maxZoom: 20,
                        crossOrigin: 'anonymous'
                    });
                }
            }
            
            // Free fallback options (no Mapbox token)
            const tileLayers = {
                street: {
                    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
                    attribution: '© OpenStreetMap contributors © CARTO',
                    maxZoom: 19
                },
                cycle: {
                    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
                    attribution: '© OpenStreetMap contributors, CyclOSM',
                    maxZoom: 20
                },
                satellite: {
                    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                    attribution: '© Esri, Maxar, Earthstar Geographics',
                    maxZoom: 19
                }
            };
            
            const config = tileLayers[style] || tileLayers.street;
            return L.tileLayer(config.url, {
                attribution: config.attribution,
                maxZoom: config.maxZoom,
                crossOrigin: 'anonymous'
            });
        }
        
        function changeMapStyle() {
            if (!map) return;
            
            const selector = document.getElementById('mapStyleSelector');
            const newStyle = selector.value;
            
            if (currentTileLayer) {
                map.removeLayer(currentTileLayer);
            }
            
            currentTileLayer = getTileLayer(newStyle);
            currentTileLayer.addTo(map);
            currentMapStyle = newStyle;
            
            // Update diary transparency based on map style
            updateDiaryTransparencyForMapStyle(newStyle);
            
            // Update stats panel transparency
            updateStatsTransparency();
        }
        
        // Update map style selector options based on Mapbox availability
        function updateMapStyleOptions() {
            const selector = document.getElementById('mapStyleSelector');
            if (!selector) return;
            
            const mapboxToken = localStorage.getItem('arc_mapbox_token');
            const currentValue = selector.value;
            
            // Clear existing options
            selector.innerHTML = '';
            
            if (mapboxToken) {
                // Mapbox options (more choices)
                selector.innerHTML = `
                    <option value="street">Street</option>
                    <option value="dark">Dark</option>
                    <option value="outdoors">Outdoors</option>
                    <option value="cycle">Cycle</option>
                    <option value="satellite">Satellite</option>
                `;
            } else {
                // Free options only
                selector.innerHTML = `
                    <option value="street">Street</option>
                    <option value="cycle">Cycle</option>
                    <option value="satellite">Satellite</option>
                `;
            }
            
            // Restore selection if still valid, otherwise default to street
            const validOptions = Array.from(selector.options).map(o => o.value);
            selector.value = validOptions.includes(currentValue) ? currentValue : 'street';
            
            // Update the map if style changed
            if (map && currentMapStyle !== selector.value) {
                changeMapStyle();
            }
        }
        
        // Listen for Mapbox token changes (from analysis.html settings)
        window.addEventListener('storage', (e) => {
            if (e.key === 'arc_mapbox_token') {
                updateMapStyleOptions();
            }
        });
        
        function updateDiaryTransparencyForMapStyle(mapStyle) {
            const diaryFloat = document.querySelector('.diary-float');
            if (!diaryFloat) return;
            
            const slider = document.getElementById('transparencySlider');
            let contentOpacity;
            
            // Check if there's a saved custom value for this specific map style
            const savedValue = localStorage.getItem(`diaryTransparency-${mapStyle}`);
            
            if (savedValue !== null) {
                // Use saved custom value for this map style
                contentOpacity = parseFloat(savedValue) / 100;
                if (slider) {
                    slider.dataset.customValue = contentOpacity;
                }
            } else {
                // Use default values based on map type
                // Clear custom value flag since we're using defaults
                if (slider) {
                    delete slider.dataset.customValue;
                }
                
                switch(mapStyle) {
                    case 'street':
                        contentOpacity = 0.05; // 5% for street map
                        break;
                    case 'dark':
                        contentOpacity = 0.10; // 10% for dark map
                        break;
                    case 'outdoors':
                        contentOpacity = 0.10; // 10% for outdoors map
                        break;
                    case 'cycle':
                        contentOpacity = 0.15; // 15% for cycle map
                        break;
                    case 'satellite':
                        contentOpacity = 0.30; // 30% for satellite map
                        break;
                    default:
                        contentOpacity = 0.05;
                }
            }
            
            // Store the opacity value as a data attribute so CSS can use it
            diaryFloat.dataset.unfocusedOpacity = contentOpacity;
            
            // Update slider position if slider exists
            // IMPORTANT: Set a flag to prevent updateTransparencyValue from setting customValue
            if (slider) {
                const sliderValue = Math.round(contentOpacity * 100);
                
                // Set flag to prevent oninput from marking this as custom
                slider.dataset.programmaticUpdate = 'true';
                slider.value = sliderValue;
                delete slider.dataset.programmaticUpdate;
                
                const valueDisplay = document.getElementById('transparencyValue');
                if (valueDisplay) {
                    valueDisplay.textContent = sliderValue + '%';
                }
            }
            
            // If currently unfocused, apply the new opacity immediately
            const diaryPanel = diaryFloat.querySelector('.diary-panel');
            const diaryHeader = diaryFloat.querySelector('.diary-header');
            const mapHeader = document.querySelector('.modal-header');
            
            if (diaryFloat.classList.contains('unfocused')) {
                if (diaryPanel) {
                    diaryPanel.style.background = `rgba(255, 255, 255, ${contentOpacity})`;
                }
                // Header should match panel transparency
                if (diaryHeader) {
                    diaryHeader.style.background = `rgba(255, 255, 255, ${contentOpacity})`;
                }
            }
            
            // ALWAYS update map titlebar transparency (not just when unfocused)
            // This ensures it uses the saved value when first loaded
            if (mapHeader) {
                mapHeader.style.background = `rgba(255, 255, 255, ${contentOpacity})`;
            }
        }
        
        
        // ========== Credits Modal ==========

        function showCredits() {
            // Card-based layout with categories
            const categories = [
                {
                    title: 'Libraries',
                    icon: '📚',
                    items: [
                        { name: 'Leaflet', desc: 'Interactive maps', license: 'BSD-2', url: 'https://leafletjs.com/' },
                        { name: 'Leaflet.markercluster', desc: 'Marker clustering', license: 'MIT', url: 'https://github.com/Leaflet/Leaflet.markercluster' },
                        { name: 'Chart.js', desc: 'Charts & graphs', license: 'MIT', url: 'https://www.chartjs.org/' },
                        { name: 'Pako', desc: 'Compression', license: 'MIT', url: 'https://github.com/nodeca/pako' },
                        { name: 'Marked', desc: 'Markdown parser', license: 'MIT', url: 'https://marked.js.org/' }
                    ]
                },
                {
                    title: 'Map Tiles',
                    icon: '🗺️',
                    items: [
                        { name: 'Mapbox', desc: 'Premium tiles & geocoding', url: 'https://www.mapbox.com/' },
                        { name: 'CARTO', desc: 'Street map tiles', url: 'https://carto.com/' },
                        { name: 'CyclOSM', desc: 'Cycle map tiles', url: 'https://www.cyclosm.org/' },
                        { name: 'Esri', desc: 'Satellite imagery', url: 'https://www.esri.com/' }
                    ]
                },
                {
                    title: 'Services',
                    icon: '🌐',
                    items: [
                        { name: 'OpenStreetMap', desc: 'Map data', license: 'ODbL', url: 'https://www.openstreetmap.org/' },
                        { name: 'Nominatim', desc: 'Geocoding', url: 'https://nominatim.org/' },
                        { name: 'OSRM', desc: 'Routing engine', url: 'https://project-osrm.org/' },
                        { name: 'Open-Elevation', desc: 'Elevation data', url: 'https://open-elevation.com/' }
                    ]
                },
                {
                    title: 'Data & Tools',
                    icon: '🛠️',
                    items: [
                        { name: 'Arc Timeline', desc: 'iOS location history', url: 'https://www.bigpaua.com/arcapp' },
                        { name: 'Claude Code', desc: 'AI pair programming', url: 'https://claude.ai/claude-code' }
                    ]
                }
            ];

            const renderCategory = (cat) => {
                const itemsHtml = cat.items.map(item => {
                    const license = item.license ? `<span style="background: #f0f0f0; color: #666; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">${item.license}</span>` : '';
                    const link = item.url ? `<a href="${item.url}" target="_blank" rel="noopener" style="color: #007AFF; text-decoration: none; font-weight: 500;">${item.name}</a>` : `<span style="font-weight: 500;">${item.name}</span>`;
                    return `<div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f5f5f5;">
                        <div>${link}${license}</div>
                        <div style="color: #86868b; font-size: 13px;">${item.desc}</div>
                    </div>`;
                }).join('');

                return `
                    <div style="margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                            <span style="font-size: 18px;">${cat.icon}</span>
                            <span style="font-weight: 600; color: #1d1d1f;">${cat.title}</span>
                        </div>
                        <div style="background: #fafafa; border-radius: 10px; padding: 4px 12px;">
                            ${itemsHtml}
                        </div>
                    </div>
                `;
            };

            const creditsHtml = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; width: 420px; max-height: 70vh; overflow-y: auto;">
                    ${categories.map(renderCategory).join('')}
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e5e5; text-align: center; color: #86868b; font-size: 12px;">
                        Arc Timeline Diary Reader © 2025–2026 Gordon Williams<br>
                        <span style="color: #007AFF;">MIT License</span>
                    </div>
                </div>
            `;

            // Create modal
            const modal = document.createElement('div');
            modal.id = 'creditsModal';
            modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100000;';
            modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

            const content = document.createElement('div');
            content.style.cssText = 'background: white; padding: 24px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); position: relative;';
            content.innerHTML = `
                <button onclick="this.closest('#creditsModal').remove()" style="position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,0.06); border: none; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;">×</button>
                <h2 style="margin: 0 0 20px 0; color: #1d1d1f; font-size: 22px;">Acknowledgements</h2>
                ${creditsHtml}
            `;

            modal.appendChild(content);
            document.body.appendChild(modal);

            // Close on Escape
            const closeOnEsc = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', closeOnEsc);
                }
            };
            document.addEventListener('keydown', closeOnEsc);
        }
        
        function toggleTransparencySlider() {
            const popup = document.getElementById('transparencySliderPopup');
            if (!popup) return;

            // Close other popups if open
            const searchPopup = document.getElementById('searchPopup');
            if (searchPopup && searchPopup.style.display === 'block') {
                closeSearchPopup();
            }

            if (popup.style.display === 'none' || popup.style.display === '') {
                // Reset position to CSS default (centered via transform)
                popup.style.left = '';
                popup.style.top = '';
                popup.style.transform = '';

                // Show popup (CSS will center it)
                popup.style.display = 'block';

                // Immediately unfocus diary so user can see the transparency effect
                const diaryFloat = document.querySelector('.diary-float');
                if (diaryFloat && !diaryFloat.classList.contains('unfocused')) {
                    diaryFloat.classList.add('unfocused');
                }

                // Always initialize slider with current opacity value
                const slider = document.getElementById('transparencySlider');
                if (slider && diaryFloat) {
                    const currentOpacity = parseFloat(diaryFloat.dataset.unfocusedOpacity) || 0.05;

                    // Set flag to prevent oninput from marking this as custom
                    slider.dataset.programmaticUpdate = 'true';
                    slider.value = Math.round(currentOpacity * 100);
                    delete slider.dataset.programmaticUpdate;

                    // Update the display
                    const valueDisplay = document.getElementById('transparencyValue');
                    if (valueDisplay) {
                        valueDisplay.textContent = slider.value + '%';
                    }
                }
            } else {
                // Hide popup
                closeTransparencyPopup();
            }
        }
        
        function updateTransparencyValue() {
            const slider = document.getElementById('transparencySlider');
            const valueDisplay = document.getElementById('transparencyValue');
            const diaryFloat = document.querySelector('.diary-float');
            const mapHeader = document.querySelector('.modal-header');
            
            if (!slider || !valueDisplay || !diaryFloat) return;
            
            const percentage = slider.value;
            valueDisplay.textContent = percentage + '%';
            
            // Only mark as custom value if this is a user interaction (not programmatic)
            if (!slider.dataset.programmaticUpdate) {
                const opacity = parseFloat(percentage) / 100;
                slider.dataset.customValue = opacity;
            }
            
            // Update the stored opacity
            const opacity = parseFloat(percentage) / 100;
            diaryFloat.dataset.unfocusedOpacity = opacity;
            
            // Force diary to unfocused state to show transparency live
            if (!diaryFloat.classList.contains('unfocused')) {
                diaryFloat.classList.add('unfocused');
            }
            
            // Apply the transparency immediately to diary
            const diaryPanel = diaryFloat.querySelector('.diary-panel');
            const diaryHeader = diaryFloat.querySelector('.diary-header');
            if (diaryPanel) {
                diaryPanel.style.background = `rgba(255, 255, 255, ${opacity})`;
            }
            // Header should match panel transparency
            if (diaryHeader) {
                diaryHeader.style.background = `rgba(255, 255, 255, ${opacity})`;
            }
            
            // Apply the same transparency to map titlebar live
            if (mapHeader) {
                mapHeader.style.background = `rgba(255, 255, 255, ${opacity})`;
            }
            
            // Update stats panel transparency to match
            updateStatsTransparency();

            // Update elevation panel transparency to match
            applyElevationPanelTransparency();
        }

        function applyElevationPanelTransparency() {
            const panel = document.getElementById('elevationPanel');
            const diaryFloat = document.querySelector('.diary-float');
            if (!panel) return;

            // Get current diary transparency
            const opacity = diaryFloat ? parseFloat(diaryFloat.dataset.unfocusedOpacity) || 0.05 : 0.05;

            // Apply to elevation panel background
            panel.style.background = `rgba(255, 255, 255, ${opacity})`;
        }

        function saveTransparencySetting() {
            const slider = document.getElementById('transparencySlider');
            if (!slider) return;
            
            const percentage = slider.value;
            
            // Save to localStorage with map style key
            localStorage.setItem(`diaryTransparency-${currentMapStyle}`, percentage);
            
            // Close the popup
            const popup = document.getElementById('transparencySliderPopup');
            if (popup) {
                popup.style.display = 'none';
            }
        }
        
        function resetTransparencySetting() {
            const slider = document.getElementById('transparencySlider');
            const diaryFloat = document.querySelector('.diary-float');
            if (!slider || !diaryFloat) return;
            
            // Get default opacity for current map style
            let defaultOpacity;
            switch(currentMapStyle) {
                case 'street':
                    defaultOpacity = 0.05; // 5%
                    break;
                case 'cycle':
                    defaultOpacity = 0.15; // 15%
                    break;
                case 'satellite':
                    defaultOpacity = 0.30; // 30%
                    break;
                default:
                    defaultOpacity = 0.05;
            }
            
            // Remove saved custom value for this map style
            localStorage.removeItem(`diaryTransparency-${currentMapStyle}`);
            
            // Clear custom value flag
            delete slider.dataset.customValue;
            
            // Set slider to default value (with programmaticUpdate flag to prevent marking as custom)
            const defaultPercentage = Math.round(defaultOpacity * 100);
            slider.dataset.programmaticUpdate = 'true';
            slider.value = defaultPercentage;
            delete slider.dataset.programmaticUpdate;
            
            // Update display
            const valueDisplay = document.getElementById('transparencyValue');
            if (valueDisplay) {
                valueDisplay.textContent = defaultPercentage + '%';
            }
            
            // Apply to diary
            diaryFloat.dataset.unfocusedOpacity = defaultOpacity;
            const diaryPanel = diaryFloat.querySelector('.diary-panel');
            const diaryHeader = diaryFloat.querySelector('.diary-header');
            const mapHeader = document.querySelector('.modal-header');
            
            if (diaryPanel) {
                diaryPanel.style.background = `rgba(255, 255, 255, ${defaultOpacity})`;
            }
            // Header should match panel transparency
            if (diaryHeader) {
                diaryHeader.style.background = `rgba(255, 255, 255, ${defaultOpacity})`;
            }
            // Map titlebar should also match
            if (mapHeader) {
                mapHeader.style.background = `rgba(255, 255, 255, ${defaultOpacity})`;
            }
            
            // Update stats panel transparency to match
            updateStatsTransparency();
            
            // Close the popup
            const popup = document.getElementById('transparencySliderPopup');
            if (popup) {
                popup.style.display = 'none';
            }
        }
        
        function loadTransparencySetting() {
            // Migrate old global transparency setting to per-map-style storage
            const oldSavedValue = localStorage.getItem('diaryTransparency');
            if (oldSavedValue !== null) {
                // Migrate to new system: apply old value to all map styles
                localStorage.setItem('diaryTransparency-street', oldSavedValue);
                localStorage.setItem('diaryTransparency-cycle', oldSavedValue);
                localStorage.setItem('diaryTransparency-satellite', oldSavedValue);
                
                // Remove old key
                localStorage.removeItem('diaryTransparency');
            }
        }
        
        // Close transparency slider when clicking outside
        document.addEventListener('click', function(e) {
            const popup = document.getElementById('transparencySliderPopup');
            const btn = document.getElementById('transparencyBtn');
            if (popup && btn && popup.style.display === 'block') {
                if (!popup.contains(e.target) && !btn.contains(e.target)) {
                    popup.style.display = 'none';
                    btn.classList.remove('popup-open');
                }
            }
            
            // Also close animation popup when clicking outside
            const animPopup = document.getElementById('animationSettingsPopup');
            const animBtn = document.getElementById('animationBtn');
            if (animPopup && animBtn && animPopup.style.display === 'block') {
                if (!animPopup.contains(e.target) && !animBtn.contains(e.target)) {
                    animPopup.style.display = 'none';
                    animBtn.classList.remove('popup-open');
                }
            }
            
            // Also close search popup when clicking outside
            const searchPopup = document.getElementById('searchPopup');
            const searchBtn = document.getElementById('searchBtn');
            if (searchPopup && searchBtn && searchPopup.style.display === 'block') {
                if (!searchPopup.contains(e.target) && !searchBtn.contains(e.target)) {
                    searchPopup.style.display = 'none';
                    searchBtn.classList.remove('popup-open');
                }
            }
        });
        
        
        function makeDiaryModalDraggable() {
            const modal = document.querySelector('.modal-dialog');
            const header = document.querySelector('.modal-header');
            
            if (!modal || !header || header.dataset.draggableInit) return;
            
            let isDragging = false;
            let startX, startY;
            let startLeft, startTop;
            
            header.addEventListener('mousedown', dragStart);
            document.addEventListener('mousemove', drag);
            document.addEventListener('mouseup', dragEnd);
            
            function dragStart(e) {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
                    return;
                }
                
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                startLeft = modal.offsetLeft;
                startTop = modal.offsetTop;
            }
            
            function drag(e) {
                if (isDragging) {
                    e.preventDefault();
                    
                    const deltaX = e.clientX - startX;
                    const deltaY = e.clientY - startY;
                    
                    modal.style.left = (startLeft + deltaX) + 'px';
                    modal.style.top = (startTop + deltaY) + 'px';
                }
            }
            
            function dragEnd(e) {
                isDragging = false;
            }
            
            header.dataset.draggableInit = 'true';
        }
        
        function monitorMapResize() {
            const mapContainer = document.getElementById('mapContainer');
            if (!mapContainer) return;

            if (mapResizeObserver) mapResizeObserver.disconnect();

            mapResizeObserver = new ResizeObserver(() => {
                if (map) {
                    map.invalidateSize();
                }
            });
            
            mapResizeObserver.observe(mapContainer);
        }
        
        function toggleAllActivities() {
            const selectAll = document.getElementById('selectAllActivities');
            const checkboxes = document.querySelectorAll('.activity-filter');
            
            checkboxes.forEach(checkbox => {
                checkbox.checked = selectAll.checked;
            });
            
            updateMapRoutes();
        }
        
        function toggleMapFilters() {
            const filterModal = document.getElementById('filterModal');
            const filterBackdrop = document.getElementById('filterModalBackdrop');
            
            if (filterModal && filterBackdrop) {
                if (filterModal.style.display === 'none' || !filterModal.style.display) {
                    filterModal.style.display = 'block';
                    filterBackdrop.style.display = 'block';
                    filterModal.style.transform = 'translate(-50%, -50%)';
                    
                    if (!filterModal.dataset.draggableInit) {
                        makeFilterModalDraggable();
                        filterModal.dataset.draggableInit = 'true';
                    }
                } else {
                    filterModal.style.display = 'none';
                    filterBackdrop.style.display = 'none';
                }
            }
        }
        
        function closeFilterModal() {
            const filterModal = document.getElementById('filterModal');
            const filterBackdrop = document.getElementById('filterModalBackdrop');
            
            if (filterModal) filterModal.style.display = 'none';
            if (filterBackdrop) filterBackdrop.style.display = 'none';
        }
        
        function makeFilterModalDraggable() {
            const modal = document.getElementById('filterModal');
            const header = modal?.querySelector('.filter-modal-header');
            
            if (!modal || !header) return;
            
            let isDragging = false;
            let currentX;
            let currentY;
            let initialX;
            let initialY;
            let xOffset = 0;
            let yOffset = 0;
            
            header.addEventListener('mousedown', dragStart);
            document.addEventListener('mousemove', drag);
            document.addEventListener('mouseup', dragEnd);
            
            function dragStart(e) {
                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;
                
                if (e.target === header || header.contains(e.target)) {
                    isDragging = true;
                }
            }
            
            function drag(e) {
                if (isDragging) {
                    e.preventDefault();
                    
                    currentX = e.clientX - initialX;
                    currentY = e.clientY - initialY;
                    
                    xOffset = currentX;
                    yOffset = currentY;
                    
                    modal.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
                }
            }
            
            function dragEnd(e) {
                initialX = currentX;
                initialY = currentY;
                isDragging = false;
            }
        }

        // ========== TOOLS DROPDOWN ==========

        let toolsDropdownOpen = false;

        function toggleToolsDropdown() {
            const menu = document.getElementById('toolsDropdownMenu');
            const btn = document.getElementById('toolsBtn');
            if (!menu) return;

            toolsDropdownOpen = !toolsDropdownOpen;

            if (toolsDropdownOpen) {
                menu.classList.add('open');
                if (btn) btn.classList.add('popup-open');

                // Close dropdown when clicking outside
                setTimeout(() => {
                    document.addEventListener('click', closeToolsDropdownOnClickOutside);
                }, 0);
            } else {
                menu.classList.remove('open');
                if (btn) btn.classList.remove('popup-open');
                document.removeEventListener('click', closeToolsDropdownOnClickOutside);
            }
        }

        function closeToolsDropdownOnClickOutside(e) {
            const menu = document.getElementById('toolsDropdownMenu');
            const btn = document.getElementById('toolsBtn');
            if (!menu || !btn) return;

            if (!menu.contains(e.target) && !btn.contains(e.target)) {
                toolsDropdownOpen = false;
                menu.classList.remove('open');
                btn.classList.remove('popup-open');
                document.removeEventListener('click', closeToolsDropdownOnClickOutside);
            }
        }

        function closeToolsDropdown() {
            const menu = document.getElementById('toolsDropdownMenu');
            const btn = document.getElementById('toolsBtn');
            toolsDropdownOpen = false;
            if (menu) menu.classList.remove('open');
            if (btn) btn.classList.remove('popup-open');
            document.removeEventListener('click', closeToolsDropdownOnClickOutside);
        }

        function selectToolFromDropdown(tool) {
            closeToolsDropdown();

            switch (tool) {
                case 'search':
                    activateLocationSearch();
                    break;
                case 'measure':
                    // toggleMeasureTool is defined in map-tools.js
                    if (window.toggleMeasureTool) window.toggleMeasureTool();
                    break;
                case 'elevation':
                    toggleElevationPanel();
                    break;
                case 'transparency':
                    toggleTransparencySlider();
                    break;
                case 'animation':
                    // Close elevation panel if open (mutually exclusive)
                    if (elevationPanelVisible) {
                        closeElevationPanel();
                    }
                    // toggleReplayController is defined in replay.js
                    if (window.toggleReplayController) window.toggleReplayController();
                    break;
                case 'filter':
                    toggleMapFilters();
                    break;
            }
        }

        // Route search functions are now in map-tools.js

        function closeTransparencyPopup() {
            const popup = document.getElementById('transparencySliderPopup');
            if (popup) popup.style.display = 'none';
        }

        // Draggable modal functionality
        let dragState = { active: false, modalId: null, startX: 0, startY: 0, modalStartX: 0, modalStartY: 0 };

        function startDragModal(e, modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return;

            // Don't start drag if clicking the close button
            if (e.target.classList.contains('modal-close')) return;

            e.preventDefault();
            e.stopPropagation();

            // Get the current visual position (works whether CSS centered or already dragged)
            const rect = modal.getBoundingClientRect();

            // Convert from CSS transform centering to explicit positioning
            modal.style.left = rect.left + 'px';
            modal.style.top = rect.top + 'px';
            modal.style.transform = 'none';

            dragState.active = true;
            dragState.modalId = modalId;
            dragState.startX = e.clientX;
            dragState.startY = e.clientY;
            dragState.modalStartX = rect.left;
            dragState.modalStartY = rect.top;

            document.addEventListener('mousemove', dragModal, true);
            document.addEventListener('mouseup', stopDragModal, true);
        }

        function dragModal(e) {
            if (!dragState.active) return;

            e.preventDefault();
            e.stopPropagation();

            const modal = document.getElementById(dragState.modalId);
            if (!modal) return;

            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;

            modal.style.left = (dragState.modalStartX + dx) + 'px';
            modal.style.top = (dragState.modalStartY + dy) + 'px';
        }

        function stopDragModal(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            dragState.active = false;
            document.removeEventListener('mousemove', dragModal, true);
            document.removeEventListener('mouseup', stopDragModal, true);
        }

        // ========== ELEVATION PANEL ==========

        let elevationPanelVisible = false;
        let elevationMarker = null;
        let elevationChartData = null;
        let speedChartData = null;
        let elevationProfileMode = 'elevation';
        let selectedProfileSegmentPoints = null;
        let selectedProfileSegmentColor = null;
        let _elevationPanelDragGuardAttached = false;
        let _isProfileSelecting = false;
        let _profileSelectStartX = 0;
        let _profileSelectEndX = 0;
        let _profileSelectionRange = null; // { startDist, endDist }
        let _elevationMoveEndHandler = null;
        let speedOutlierFilterEnabled = true;

        function toggleElevationPanel() {
            if (elevationPanelVisible) {
                closeElevationPanel();
            } else {
                openElevationPanel();
            }
        }

        function setElevationProfile(mode) {
            const nextMode = mode === 'speed' ? 'speed' : 'elevation';
            if (elevationProfileMode === nextMode) return;
            elevationProfileMode = nextMode;
            hideProfileSelection();
            updateElevationTabs();
            updateElevationChart();
        }

        function updateElevationTabs() {
            const tabs = document.querySelectorAll('.elevation-tab');
            const speedTab = document.querySelector('.elevation-tab[data-profile="speed"]');
            const routeSearchActive = !!window.routeSearchLayer;
            if (routeSearchActive && elevationProfileMode === 'speed') {
                elevationProfileMode = 'elevation';
            }
            tabs.forEach(tab => {
                const profile = tab.dataset.profile;
                if (profile === 'speed') {
                    if (speedTab) {
                        speedTab.disabled = routeSearchActive;
                        speedTab.classList.toggle('disabled', routeSearchActive);
                    }
                }
                if (profile === elevationProfileMode) {
                    tab.classList.add('active');
                } else {
                    tab.classList.remove('active');
                }
            });
            const panel = document.getElementById('elevationPanel');
            if (panel) panel.dataset.mode = elevationProfileMode;
            updateProfileSelectionStats();
        }

        function initSpeedOutlierToggle() {
            const stored = localStorage.getItem('arc_speed_filter_enabled');
            speedOutlierFilterEnabled = stored ? stored === 'true' : true;
            const toggle = document.getElementById('speedOutlierToggle');
            if (toggle) {
                toggle.checked = speedOutlierFilterEnabled;
                toggle.addEventListener('change', () => {
                    speedOutlierFilterEnabled = toggle.checked;
                    localStorage.setItem('arc_speed_filter_enabled', String(speedOutlierFilterEnabled));
                    if (elevationPanelVisible) {
                        updateElevationChart();
                    }
                });
            }
        }

        function openElevationPanel() {
            // Close animation player if open (mutually exclusive)
            // Only close if it's actually visible
            const replayController = document.getElementById('replayController');
            if (replayController && replayController.style.display !== 'none' && replayController.style.display !== '') {
                if (typeof closeReplayController === 'function') {
                    closeReplayController();
                }
            }

            const panel = document.getElementById('elevationPanel');
            if (!panel) return;

            elevationPanelVisible = true;
            panel.style.display = 'block';
            panel.classList.add('unfocused');

            updateElevationTabs();
            attachElevationPanelDragGuard();
            initSpeedOutlierToggle();
            attachElevationPanelDblClickGuard();

            // Apply current diary transparency to elevation panel
            applyElevationPanelTransparency();

            // Position panel in safe space
            positionElevationPanel();

            // If no day selected yet, default to first day of current month
            if (!currentDayKey) {
                const days = getDaysInCurrentMonth();
                if (days.length > 0) {
                    if (window.NavigationController && typeof NavigationController.selectDay === 'function') {
                        NavigationController.selectDay(days[0], { preserveRouteSearch: true });
                    } else {
                        showDayMap(days[0]);
                    }
                }
            }

            // Register bottom margin with NavigationController so map content avoids the panel
            // Panel is ~236px tall + 20px bottom margin
            // Allow refit so map adjusts to show content above the panel
            NavigationController.updateViewportMargins({ bottom: 260 }, { delay: 100 });

            // Update chart with visible routes
            updateElevationChart();

            // Refit map bounds to respect the new panel margins
            if (window.routeSearchLayer && map && window.routeSearchLayer.getBounds) {
                const padding = (window.NavigationController && window.NavigationController.mapPadding)
                    ? window.NavigationController.mapPadding
                    : { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] };
                setTimeout(() => {
                    map.fitBounds(window.routeSearchLayer.getBounds(), {
                        paddingTopLeft: padding.paddingTopLeft,
                        paddingBottomRight: padding.paddingBottomRight
                    });
                }, 120);
            } else {
                setTimeout(() => refitMapBounds(true), 120);
            }

            // Listen for map move events to update chart
            if (map) {
                _elevationMoveEndHandler = () => {
                    hideProfileSelection();
                    updateElevationChart();
                };
                map.on('moveend', _elevationMoveEndHandler);
            }

            window.addEventListener('resize', handleElevationPanelResize);
        }

        function positionElevationPanel() {
            const panel = document.getElementById('elevationPanel');
            if (!panel) return;

            // Get current margins from NavigationController
            const margins = NavigationController.margins;
            const buffer = 30; // Gap between panel edges and obstructions (larger for visual spacing)

            // Calculate left position: diary width + slider width + buffer
            const leftPos = margins.left + margins.sliderLeft + buffer;

            // Calculate right position: stats width + buffer
            const rightPos = margins.right + buffer;

            panel.style.left = leftPos + 'px';
            panel.style.right = rightPos + 'px';
        }

        function closeElevationPanel() {
            const panel = document.getElementById('elevationPanel');
            if (!panel) return;

            elevationPanelVisible = false;
            panel.style.display = 'none';

            if (panel._draggingDisabledByPanel && map && map.dragging) {
                map.dragging.enable();
                panel._draggingDisabledByPanel = false;
            }

            hideProfileSelection();

            // Clear bottom margin from NavigationController
            // Allow refit so map can reclaim the space
            NavigationController.updateViewportMargins({ bottom: 0 }, { delay: 100 });

            // Remove elevation marker from map
            hideElevationMapMarker();

            // Stop listening for map moves
            if (map) {
                if (_elevationMoveEndHandler) {
                    map.off('moveend', _elevationMoveEndHandler);
                    _elevationMoveEndHandler = null;
                }
            }

            window.removeEventListener('resize', handleElevationPanelResize);
        }

        function handleElevationPanelResize() {
            if (!elevationPanelVisible) return;
            updateElevationChart();
            refreshProfileSelectionOverlay();
        }

        function attachElevationPanelDragGuard() {
            const panel = document.getElementById('elevationPanel');
            if (!panel || _elevationPanelDragGuardAttached) return;

            let draggingWasEnabled = false;

            const disableMapDrag = () => {
                if (!map || !map.dragging) return;
                draggingWasEnabled = map.dragging.enabled();
                if (draggingWasEnabled) {
                    map.dragging.disable();
                    panel._draggingDisabledByPanel = true;
                }
            };

            const enableMapDrag = () => {
                if (!map || !map.dragging) return;
                if (draggingWasEnabled && panel._draggingDisabledByPanel) {
                    map.dragging.enable();
                    panel._draggingDisabledByPanel = false;
                }
            };

            panel.addEventListener('mouseenter', disableMapDrag);
            panel.addEventListener('mouseleave', enableMapDrag);
            panel.addEventListener('touchstart', disableMapDrag, { passive: true });
            panel.addEventListener('touchend', enableMapDrag, { passive: true });
            panel.addEventListener('mousedown', (e) => {
                if (e.button === 0) {
                    e.stopPropagation();
                }
            });
            panel.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            _elevationPanelDragGuardAttached = true;
        }

        function attachElevationPanelDblClickGuard() {
            const panel = document.getElementById('elevationPanel');
            if (!panel || panel._dblclickGuardAttached) return;
            panel.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            panel._dblclickGuardAttached = true;
        }

        function updateElevationChart() {
            const canvas = document.getElementById('elevationCanvas');
            const noDataEl = document.getElementById('elevationNoData');
            if (!canvas || !map) return;

            const ctx = canvas.getContext('2d');
            const bounds = map.getBounds();
            const mode = elevationProfileMode;

            function showNoData(message) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (noDataEl) {
                    noDataEl.innerHTML = `<span>${message}</span>`;
                    noDataEl.style.display = 'block';
                }
                canvas.style.display = 'none';
            }

            function renderActiveProfile() {
                if (mode === 'speed') {
                    if (speedChartData && speedChartData.length > 0) {
                        if (noDataEl) noDataEl.style.display = 'none';
                        canvas.style.display = 'block';
                        renderSpeedChart(ctx, canvas, speedChartData);
                        updateProfileSelectionStats();
                        refreshProfileSelectionOverlay();
                    } else {
                        showNoData('No speed data for visible routes');
                        updateProfileSelectionStats();
                    }
                    return;
                }

                if (elevationChartData && elevationChartData.length > 0) {
                    if (noDataEl) noDataEl.style.display = 'none';
                    canvas.style.display = 'block';
                    renderElevationChart(ctx, canvas, elevationChartData);
                    updateProfileSelectionStats();
                    refreshProfileSelectionOverlay();
                } else {
                    showNoData('No elevation data for visible routes');
                    updateProfileSelectionStats();
                }
            }

            // Prefer a selected segment when user clicks a polyline
            if (selectedProfileSegmentPoints && selectedProfileSegmentPoints.length >= 2) {
                const basePoints = buildProfileBasePoints(selectedProfileSegmentPoints, selectedProfileSegmentColor);
                elevationChartData = basePoints.filter(p => p.altitude != null);
                speedChartData = buildSpeedDataFromElevation(basePoints);
                renderActiveProfile();
                return;
            }

            // Check for route search elevation data first
            const routeSearchElevation = window.routeSearchState?.elevationData;
            if (routeSearchElevation && routeSearchElevation.length > 0 && window.routeSearchLayer) {
                // Route search is active with elevation data - use it
                const elevationPoints = routeSearchElevation.map((pt, idx, arr) => {
                    // Calculate cumulative distance
                    let distance = 0;
                    if (idx > 0) {
                        for (let i = 1; i <= idx; i++) {
                            const prev = arr[i - 1];
                            const curr = arr[i];
                            distance += haversineDistanceKm(prev.lat, prev.lng, curr.lat, curr.lng);
                        }
                    }
                    return {
                        lat: pt.lat,
                        lng: pt.lng,
                        altitude: pt.elevation,
                        distance: distance,
                        color: '#667eea',  // Route search color
                        activityType: 'driving',
                        segmentId: 0
                    };
                });

                elevationChartData = elevationPoints;
                speedChartData = buildSpeedDataFromElevation(elevationPoints);

                renderActiveProfile();
                return;
            }

            // Check if we're in day mode - elevation only works for specific days
            if (mapMode !== 'day' || !currentDayKey) {
                elevationChartData = null;
                speedChartData = null;
                const msg = mode === 'speed'
                    ? 'Select a specific day to view speed profile'
                    : 'Select a specific day to view elevation profile';
                showNoData(msg);
                updateProfileSelectionStats();
                return;
            }

            // Get visible routes with elevation data
            const visibleElevationData = getVisibleElevationData(bounds);

            if (visibleElevationData.length === 0) {
                elevationChartData = null;
                speedChartData = null;
                renderActiveProfile();
                return;
            }

            elevationChartData = visibleElevationData;
            speedChartData = buildSpeedDataFromElevation(visibleElevationData);

            renderActiveProfile();
        }

        function getVisibleElevationData(bounds) {
            // Collect elevation points from visible route segments
            const elevationPoints = [];

            if (!allRouteSegments || allRouteSegments.length === 0) return elevationPoints;

            allRouteSegments.forEach((segObj, segIdx) => {
                const { segment, points, color } = segObj;
                if (!segment || !points || points.length === 0) return;

                // Check if any part of this route is visible
                const latlngs = segment.getLatLngs();
                const routeVisible = latlngs.some(ll => bounds.contains(ll));

                if (routeVisible) {
                    // Extract points with altitude that are within bounds
                    points.forEach(point => {
                        if (point.altitude !== undefined && point.altitude !== null) {
                            const latlng = L.latLng(point.lat, point.lng);
                            if (bounds.contains(latlng)) {
                                const activityType = (point.activityType || 'unknown').toLowerCase();
                                elevationPoints.push({
                                    lat: point.lat,
                                    lng: point.lng,
                                    altitude: point.altitude,
                                    activityType: activityType,
                                    color: color,
                                    timestamp: point.timestamp,
                                    segmentId: segIdx
                                });
                            }
                        }
                    });
                }
            });

            // Sort by timestamp if available
            elevationPoints.sort((a, b) => {
                if (a.timestamp && b.timestamp) {
                    return new Date(a.timestamp) - new Date(b.timestamp);
                }
                return 0;
            });

            // Calculate cumulative distance
            let cumulativeDistance = 0;
            for (let i = 0; i < elevationPoints.length; i++) {
                if (i > 0) {
                    const prev = elevationPoints[i - 1];
                    const curr = elevationPoints[i];
                    const segmentDist = haversineDistanceKm(prev.lat, prev.lng, curr.lat, curr.lng);
                    cumulativeDistance += segmentDist;
                }
                elevationPoints[i].distance = cumulativeDistance;
            }

            return elevationPoints;
        }

        function buildProfileBasePoints(points, colorOverride = null) {
            if (!Array.isArray(points) || points.length < 2) return [];

            const basePoints = [];
            let cumulativeDistance = 0;

            for (let i = 0; i < points.length; i++) {
                if (i > 0) {
                    const prev = points[i - 1];
                    const curr = points[i];
                    const segmentDist = haversineDistanceKm(prev.lat, prev.lng, curr.lat, curr.lng);
                    cumulativeDistance += segmentDist;
                }

                const p = points[i];
                basePoints.push({
                    lat: p.lat,
                    lng: p.lng,
                    altitude: p.altitude,
                    distance: cumulativeDistance,
                    color: colorOverride || p.color,
                    activityType: p.activityType || 'unknown',
                    timestamp: p.timestamp,
                    segmentId: p.segmentId ?? 0
                });
            }

            return basePoints;
        }

        function hideProfileSelection() {
            const selectionEl = document.getElementById('elevationSelection');
            if (selectionEl) selectionEl.style.display = 'none';
            _profileSelectionRange = null;
            updateProfileSelectionStats();
        }

        function setStatValue(key, value) {
            const el = document.querySelector(`.elevation-stat-tag[data-stat="${key}"]`);
            if (el) el.textContent = value;
        }

        function updateProfileSelectionStats() {
            const mode = elevationProfileMode;
            const data = mode === 'speed' ? speedChartData : elevationChartData;
            if (!Array.isArray(data) || data.length === 0) {
                setStatValue('dist', 'Dist --');
                setStatValue('dur', 'Dur --');
                setStatValue('min', 'Min --');
                setStatValue('med', 'Med --');
                setStatValue('avg', 'Avg --');
                setStatValue('max', 'Max --');
                setStatValue('gain', 'Gain --');
                setStatValue('diff', 'Δ --');
                return;
            }

            const startDist = _profileSelectionRange
                ? Math.min(_profileSelectionRange.startDist, _profileSelectionRange.endDist)
                : 0;
            const endDist = _profileSelectionRange
                ? Math.max(_profileSelectionRange.startDist, _profileSelectionRange.endDist)
                : (data[data.length - 1]?.distance || 0);
            const selected = data.filter(p => p.distance >= startDist && p.distance <= endDist);
            if (selected.length === 0) {
                setStatValue('dist', 'Dist --');
                setStatValue('dur', 'Dur --');
                setStatValue('min', 'Min --');
                setStatValue('med', 'Med --');
                setStatValue('avg', 'Avg --');
                setStatValue('max', 'Max --');
                setStatValue('gain', 'Gain --');
                setStatValue('diff', 'Δ --');
                return;
            }

            const distanceKm = Math.max(0, endDist - startDist);
            let durationText = '';
            const tStart = selected[0].timestamp ? Date.parse(selected[0].timestamp) : null;
            const tEnd = selected[selected.length - 1].timestamp ? Date.parse(selected[selected.length - 1].timestamp) : null;
            if (Number.isFinite(tStart) && Number.isFinite(tEnd) && tEnd > tStart) {
                durationText = formatRouteTime(tEnd - tStart);
            }

            if (mode === 'speed') {
                const speeds = selected.map(p => p.speedKmh).filter(v => Number.isFinite(v));
                if (speeds.length === 0) {
                    setStatValue('dist', 'Dist --');
                    setStatValue('dur', 'Dur --');
                    setStatValue('min', 'Min --');
                    setStatValue('med', 'Med --');
                    setStatValue('avg', 'Avg --');
                    setStatValue('max', 'Max --');
                    setStatValue('gain', '');
                    setStatValue('diff', '');
                    return;
                }
                const max = Math.max(...speeds);
                const min = Math.min(...speeds);
                const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
                const sorted = speeds.slice().sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

                setStatValue('dist', `Dist ${distanceKm.toFixed(distanceKm < 1 ? 2 : 1)}km`);
                setStatValue('dur', durationText ? `Dur ${durationText}` : 'Dur --');
                setStatValue('min', `Min ${min.toFixed(1)}`);
                setStatValue('med', `Med ${median.toFixed(1)}`);
                setStatValue('avg', `Avg ${avg.toFixed(1)}`);
                setStatValue('max', `Max ${max.toFixed(1)} km/h`);
                setStatValue('gain', '');
                setStatValue('diff', '');
                return;
            }

            const elevations = selected.map(p => p.altitude).filter(v => Number.isFinite(v));
            if (elevations.length === 0) {
                setStatValue('dist', 'Dist --');
                setStatValue('dur', 'Dur --');
                setStatValue('min', 'Min --');
                setStatValue('med', 'Med --');
                setStatValue('avg', 'Avg --');
                setStatValue('max', 'Max --');
                setStatValue('gain', 'Gain --');
                setStatValue('diff', 'Δ --');
                return;
            }
            const max = Math.max(...elevations);
            const min = Math.min(...elevations);
            const avg = elevations.reduce((a, b) => a + b, 0) / elevations.length;
            const diff = max - min;
            let gain = 0;
            for (let i = 1; i < selected.length; i++) {
                const prevAlt = selected[i - 1].altitude;
                const currAlt = selected[i].altitude;
                const sameSegment = (selected[i - 1].segmentId ?? null) === (selected[i].segmentId ?? null);
                if (sameSegment && Number.isFinite(prevAlt) && Number.isFinite(currAlt)) {
                    const delta = currAlt - prevAlt;
                    if (delta > 0) gain += delta;
                }
            }

            setStatValue('dist', `Dist ${distanceKm.toFixed(distanceKm < 1 ? 2 : 1)}km`);
            setStatValue('dur', durationText ? `Dur ${durationText}` : 'Dur --');
            setStatValue('min', `Min ${Math.round(min)}m`);
            setStatValue('med', '');
            setStatValue('avg', `Avg ${Math.round(avg)}m`);
            setStatValue('max', `Max ${Math.round(max)}m`);
            setStatValue('gain', `Gain ${Math.round(gain)}m`);
            setStatValue('diff', `Δ ${Math.round(diff)}m`);
        }

        function refreshProfileSelectionOverlay() {
            const canvas = document.getElementById('elevationCanvas');
            if (!canvas || !canvas._chartInfo || !_profileSelectionRange) return;
            if (typeof canvas._updateSelectionOverlayFromRange === 'function') {
                canvas._updateSelectionOverlayFromRange(canvas._chartInfo);
            }
        }

        function buildSpeedDataFromElevation(points) {
            if (!Array.isArray(points) || points.length < 2) return [];

            const speedPoints = [];
            for (let i = 1; i < points.length; i++) {
                const prev = points[i - 1];
                const curr = points[i];
                if (!prev || !curr) continue;
                if (!prev.timestamp || !curr.timestamp) continue;

                const t1 = Date.parse(prev.timestamp);
                const t2 = Date.parse(curr.timestamp);
                if (!Number.isFinite(t1) || !Number.isFinite(t2)) continue;

                const dtSec = (t2 - t1) / 1000;
                if (!(dtSec > 0 && dtSec < 3600)) continue;

                const distKm = Math.max(0, (curr.distance ?? 0) - (prev.distance ?? 0));
                const speedKmh = (distKm / dtSec) * 3600;

                speedPoints.push({
                    lat: curr.lat,
                    lng: curr.lng,
                    distance: curr.distance ?? 0,
                    speedKmh,
                    color: curr.color,
                    activityType: curr.activityType,
                    timestamp: curr.timestamp
                });
            }

            if (!speedOutlierFilterEnabled) return speedPoints;
            return filterSpeedOutliers(speedPoints, 5, 3.5);
        }

        function median(values) {
            if (!values.length) return 0;
            const sorted = values.slice().sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        }

        function filterSpeedOutliers(points, windowSize = 5, madThreshold = 3.5) {
            const result = points.map(p => ({ ...p }));
            const speeds = points.map(p => p.speedKmh);

            function accelThreshold(activityType) {
                const act = (activityType || '').toLowerCase();
                if (act.includes('walk')) return 1.5;      // m/s^2
                if (act.includes('cycl') || act.includes('bike')) return 3.0;
                if (act.includes('car') || act.includes('auto') || act.includes('drive')) return 6.0;
                return 4.0;
            }

            for (let i = 0; i < points.length; i++) {
                const start = Math.max(0, i - windowSize);
                const end = Math.min(points.length - 1, i + windowSize);
                const window = [];
                for (let j = start; j <= end; j++) {
                    const v = speeds[j];
                    if (Number.isFinite(v)) window.push(v);
                }
                if (window.length < 3) continue;

                const med = median(window);
                const deviations = window.map(v => Math.abs(v - med));
                const mad = median(deviations);

                const speed = speeds[i];
                if (!Number.isFinite(speed)) continue;

                const diff = Math.abs(speed - med);
                let isOutlier = false;

                if (mad > 0) {
                    isOutlier = diff > madThreshold * mad;
                } else {
                    const fallback = Math.max(1, med * 0.3);
                    isOutlier = diff > fallback;
                }

                if (i > 0) {
                    const prev = points[i - 1];
                    if (prev && prev.timestamp && points[i].timestamp) {
                        const t1 = Date.parse(prev.timestamp);
                        const t2 = Date.parse(points[i].timestamp);
                        if (Number.isFinite(t1) && Number.isFinite(t2) && t2 > t1) {
                            const dtSec = (t2 - t1) / 1000;
                            const v1 = (prev.speedKmh || 0) / 3.6;
                            const v2 = (speed || 0) / 3.6;
                            const accel = Math.abs(v2 - v1) / dtSec;
                            if (accel > accelThreshold(points[i].activityType)) {
                                isOutlier = true;
                            }
                        }
                    }
                }

                if (isOutlier) {
                    result[i].speedKmh = med;
                }
            }

            return result;
        }

        function haversineDistanceKm(lat1, lng1, lat2, lng2) {
            const R = 6371; // Earth's radius in km
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        }

        function hexToRgba(hex, alpha) {
            // Convert hex color to rgba with specified alpha
            // Handle both #RGB and #RRGGBB formats
            let r, g, b;
            hex = hex.replace('#', '');
            if (hex.length === 3) {
                r = parseInt(hex[0] + hex[0], 16);
                g = parseInt(hex[1] + hex[1], 16);
                b = parseInt(hex[2] + hex[2], 16);
            } else {
                r = parseInt(hex.substring(0, 2), 16);
                g = parseInt(hex.substring(2, 4), 16);
                b = parseInt(hex.substring(4, 6), 16);
            }
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        function renderElevationChart(ctx, canvas, data) {
            // Get device pixel ratio for retina display
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();

            // Set canvas size accounting for retina
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            const width = rect.width;
            const height = rect.height;
            const padding = { top: 16, right: 15, bottom: 25, left: 60 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;

            // Clear canvas
            ctx.clearRect(0, 0, width, height);

            // Find min/max values
            const altitudes = data.map(d => d.altitude);
            const minAlt = Math.min(...altitudes);
            const maxAlt = Math.max(...altitudes);
            const maxDist = data[data.length - 1]?.distance || 0;

            // Add padding to altitude range (asymmetric for below/above sea level)
            const altRange = maxAlt - minAlt || 1;
            const altPadding = altRange * 0.1;
            const negPadding = minAlt < 0 ? Math.abs(minAlt) * 0.1 : altPadding;
            const posPadding = maxAlt > 0 ? maxAlt * 0.1 : altPadding;
            const yMin = minAlt < 0 ? (minAlt - negPadding) : Math.max(0, minAlt - altPadding);
            const yMax = maxAlt + posPadding;

            // Scale functions
            const xScale = (dist) => padding.left + (dist / maxDist) * chartWidth;
            const yScale = (alt) => padding.top + chartHeight - ((alt - yMin) / (yMax - yMin)) * chartHeight;

            // Store scale info for tooltip
            canvas._chartInfo = {
                padding, chartWidth, chartHeight, xScale, yScale,
                maxDist, yMin, yMax, data, mode: 'elevation'
            };

            // Draw grid lines
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
            ctx.lineWidth = 1;

            // Horizontal grid lines (altitude) with "nice" step sizes
            const range = yMax - yMin;
            const rawStep = range / 4;
            const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
            const normalized = rawStep / pow10;
            const niceSteps = [5, 10, 20, 50, 100];
            const nice = niceSteps.find(s => s >= normalized) || 100;
            const step = nice * pow10;
            // Keep major ticks inside the drawable range to avoid clipped top labels.
            const yStart = Math.ceil(yMin / step) * step;
            const yEnd = Math.floor(yMax / step) * step;

            for (let altVal = yStart; altVal <= yEnd; altVal += step) {
                const y = yScale(altVal);
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();

                // Y-axis labels
                ctx.fillStyle = '#86868b';
                ctx.font = '10px -apple-system, sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${Math.round(altVal)}m`, padding.left - 5, y);
            }

            // Draw subtle zero line if elevations include negative values
            if (yMin < 0 && yMax > 0) {
                const zeroY = yScale(0);
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(padding.left, zeroY);
                ctx.lineTo(width - padding.right, zeroY);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
                ctx.lineWidth = 1;

                // Ensure 0 is labeled on the y-axis
                ctx.fillStyle = '#86868b';
                ctx.font = '10px -apple-system, sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText('0m', padding.left - 5, zeroY);
            }

            // X-axis labels
            const xTicks = 5;
            for (let i = 0; i <= xTicks; i++) {
                const dist = (maxDist / xTicks) * i;
                const x = xScale(dist);

                ctx.fillStyle = '#86868b';
                ctx.font = '10px -apple-system, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                const label = dist < 1 ? `${(dist * 1000).toFixed(0)}m` : `${dist.toFixed(1)}km`;
                ctx.fillText(label, x, height - 5);
            }

            // Draw filled area under line segments with activity colors
            if (data.length > 1) {
                const bottomY = height - padding.bottom;

                for (let i = 1; i < data.length; i++) {
                    const prev = data[i - 1];
                    const curr = data[i];

                    // Create gradient for this segment using the activity color
                    const segColor = curr.color || '#007aff';
                    const gradient = ctx.createLinearGradient(0, padding.top, 0, bottomY);
                    gradient.addColorStop(0, hexToRgba(segColor, 0.4));
                    gradient.addColorStop(1, hexToRgba(segColor, 0.08));

                    // Draw filled trapezoid for this segment
                    ctx.beginPath();
                    ctx.moveTo(xScale(prev.distance), yScale(prev.altitude));
                    ctx.lineTo(xScale(curr.distance), yScale(curr.altitude));
                    ctx.lineTo(xScale(curr.distance), bottomY);
                    ctx.lineTo(xScale(prev.distance), bottomY);
                    ctx.closePath();
                    ctx.fillStyle = gradient;
                    ctx.fill();
                }
            }

            // Draw line segments with activity colors
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            for (let i = 1; i < data.length; i++) {
                const prev = data[i - 1];
                const curr = data[i];

                ctx.beginPath();
                ctx.strokeStyle = curr.color;
                ctx.moveTo(xScale(prev.distance), yScale(prev.altitude));
                ctx.lineTo(xScale(curr.distance), yScale(curr.altitude));
                ctx.stroke();
            }

            // Set up mouse event handlers
            setupElevationCanvasEvents(canvas);
        }

        function renderSpeedChart(ctx, canvas, data) {
            // Get device pixel ratio for retina display
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();

            // Set canvas size accounting for retina
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            const width = rect.width;
            const height = rect.height;
            const basePadding = { top: 16, right: 15, bottom: 25, left: 45 };
            const chartHeight = height - basePadding.top - basePadding.bottom;

            // Clear canvas
            ctx.clearRect(0, 0, width, height);

            // Find min/max values
            const speeds = data.map(d => d.speedKmh);
            const minSpeed = Math.min(...speeds, 0);
            const maxSpeed = Math.max(...speeds, 1);
            const maxDist = data[data.length - 1]?.distance || 0;

            // Add padding to speed range
            const speedRange = maxSpeed - minSpeed || 1;
            const speedPadding = speedRange * 0.1;
            const yMin = Math.max(0, minSpeed - speedPadding);
            const yMax = maxSpeed + speedPadding;

            // Horizontal grid lines (speed) with "nice" step sizes
            const range = yMax - yMin;
            const rawStep = range / 4;
            const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
            const normalized = rawStep / pow10;
            const niceSteps = [2, 5, 10, 20];
            const nice = niceSteps.find(s => s >= normalized) || 20;
            const step = nice * pow10;
            // Keep major ticks inside the drawable range to avoid clipped top labels.
            const yStart = Math.ceil(yMin / step) * step;
            const yEnd = Math.floor(yMax / step) * step;

            // Dynamic left gutter for large speed labels (e.g., 1000+ km/h).
            ctx.font = '10px -apple-system, sans-serif';
            let maxYLabelWidth = 0;
            for (let speedVal = yStart; speedVal <= yEnd; speedVal += step) {
                const label = step < 1 ? speedVal.toFixed(1) : Math.round(speedVal).toString();
                const text = `${label}km/h`;
                maxYLabelWidth = Math.max(maxYLabelWidth, ctx.measureText(text).width);
            }
            const padding = {
                ...basePadding,
                left: Math.max(basePadding.left, Math.ceil(maxYLabelWidth) + 10)
            };
            const chartWidth = width - padding.left - padding.right;
            // Scale functions
            const xScale = (dist) => padding.left + (dist / maxDist) * chartWidth;
            const yScale = (speed) => padding.top + chartHeight - ((speed - yMin) / (yMax - yMin)) * chartHeight;

            // Store scale info for tooltip
            canvas._chartInfo = {
                padding, chartWidth, chartHeight, xScale, yScale,
                maxDist, yMin, yMax, data, mode: 'speed'
            };

            // Draw grid lines
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
            ctx.lineWidth = 1;

            for (let speedVal = yStart; speedVal <= yEnd; speedVal += step) {
                const y = yScale(speedVal);
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();

                // Y-axis labels
                ctx.fillStyle = '#86868b';
                ctx.font = '10px -apple-system, sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                const label = step < 1 ? speedVal.toFixed(1) : Math.round(speedVal).toString();
                ctx.fillText(`${label}km/h`, padding.left - 5, y);
            }

            // X-axis labels
            const xTicks = 5;
            for (let i = 0; i <= xTicks; i++) {
                const dist = (maxDist / xTicks) * i;
                const x = xScale(dist);

                ctx.fillStyle = '#86868b';
                ctx.font = '10px -apple-system, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                const label = dist < 1 ? `${(dist * 1000).toFixed(0)}m` : `${dist.toFixed(1)}km`;
                ctx.fillText(label, x, height - 5);
            }

            // Draw filled area under line segments with activity colors
            if (data.length > 1) {
                const bottomY = height - padding.bottom;

                for (let i = 1; i < data.length; i++) {
                    const prev = data[i - 1];
                    const curr = data[i];

                    // Create gradient for this segment using the activity color
                    const segColor = curr.color || '#34c759';
                    const gradient = ctx.createLinearGradient(0, padding.top, 0, bottomY);
                    gradient.addColorStop(0, hexToRgba(segColor, 0.35));
                    gradient.addColorStop(1, hexToRgba(segColor, 0.08));

                    // Draw filled trapezoid for this segment
                    ctx.beginPath();
                    ctx.moveTo(xScale(prev.distance), yScale(prev.speedKmh));
                    ctx.lineTo(xScale(curr.distance), yScale(curr.speedKmh));
                    ctx.lineTo(xScale(curr.distance), bottomY);
                    ctx.lineTo(xScale(prev.distance), bottomY);
                    ctx.closePath();
                    ctx.fillStyle = gradient;
                    ctx.fill();
                }
            }

            // Draw line segments with activity colors
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            for (let i = 1; i < data.length; i++) {
                const prev = data[i - 1];
                const curr = data[i];

                ctx.beginPath();
                ctx.strokeStyle = curr.color || '#34c759';
                ctx.moveTo(xScale(prev.distance), yScale(prev.speedKmh));
                ctx.lineTo(xScale(curr.distance), yScale(curr.speedKmh));
                ctx.stroke();
            }

            // Set up mouse event handlers
            setupElevationCanvasEvents(canvas);
        }

        function setupElevationCanvasEvents(canvas) {
            // Remove existing handlers
            canvas.onmousemove = null;
            canvas.onmouseleave = null;
            canvas.onmousedown = null;
            canvas.onmouseup = null;

            const cursor = document.getElementById('elevationCursor');

            function clamp(val, min, max) {
                return Math.max(min, Math.min(max, val));
            }

            function updateSelectionOverlay(chartInfo, startX, endX) {
                const selectionEl = document.getElementById('elevationSelection');
                if (!selectionEl || !chartInfo) return;

                const leftX = Math.min(startX, endX);
                const rightX = Math.max(startX, endX);

                const contentPaddingLeft = 16;
                const contentPaddingTop = 12;

                selectionEl.style.left = (leftX + contentPaddingLeft) + 'px';
                selectionEl.style.top = (chartInfo.padding.top + contentPaddingTop) + 'px';
                selectionEl.style.width = Math.max(1, rightX - leftX) + 'px';
                selectionEl.style.height = chartInfo.chartHeight + 'px';
                selectionEl.style.display = 'block';
            }

            function updateSelectionRange(chartInfo, startX, endX) {
                if (!chartInfo) return;
                const { padding, chartWidth, maxDist } = chartInfo;
                const startDist = ((startX - padding.left) / chartWidth) * maxDist;
                const endDist = ((endX - padding.left) / chartWidth) * maxDist;
                _profileSelectionRange = {
                    startDist: clamp(startDist, 0, maxDist),
                    endDist: clamp(endDist, 0, maxDist)
                };
            }

            function findNearestPointByDistance(data, dist) {
                if (!Array.isArray(data) || data.length === 0) return null;
                let nearest = data[0];
                let minDiff = Math.abs(data[0].distance - dist);
                for (let i = 1; i < data.length; i++) {
                    const diff = Math.abs(data[i].distance - dist);
                    if (diff < minDiff) {
                        minDiff = diff;
                        nearest = data[i];
                    }
                }
                return nearest;
            }

            function updateSelectionOverlayFromRange(chartInfo) {
                if (!chartInfo || !_profileSelectionRange) return;
                const { padding, chartWidth, maxDist } = chartInfo;
                if (maxDist <= 0) return;

                const startX = padding.left + (Math.min(_profileSelectionRange.startDist, _profileSelectionRange.endDist) / maxDist) * chartWidth;
                const endX = padding.left + (Math.max(_profileSelectionRange.startDist, _profileSelectionRange.endDist) / maxDist) * chartWidth;
                updateSelectionOverlay(chartInfo, startX, endX);
            }

            canvas.onmousedown = (e) => {
                if (!canvas._chartInfo) return;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const { padding, chartWidth } = canvas._chartInfo;
                if (x < padding.left || x > padding.left + chartWidth) return;

                _isProfileSelecting = true;
                _profileSelectStartX = x;
                _profileSelectEndX = x;
                hideElevationTooltip();
                hideElevationCursor();

                updateSelectionRange(canvas._chartInfo, _profileSelectStartX, _profileSelectEndX);
                updateSelectionOverlay(canvas._chartInfo, _profileSelectStartX, _profileSelectEndX);
                updateProfileSelectionStats();
            };

            canvas.onmousemove = (e) => {
                if (!canvas._chartInfo) return;

                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const { padding, chartWidth, chartHeight, maxDist, data, mode } = canvas._chartInfo;

                // Check if mouse is in chart area
                if (x < padding.left || x > padding.left + chartWidth) {
                    if (_isProfileSelecting) return;
                    hideElevationTooltip();
                    hideElevationMapMarker();
                    hideElevationCursor();
                    return;
                }

                if (_isProfileSelecting) {
                    _profileSelectEndX = x;
                    updateSelectionRange(canvas._chartInfo, _profileSelectStartX, _profileSelectEndX);
                    updateSelectionOverlay(canvas._chartInfo, _profileSelectStartX, _profileSelectEndX);
                    updateProfileSelectionStats();
                    const dist = ((x - padding.left) / chartWidth) * maxDist;
                    const nearest = findNearestPointByDistance(data, dist);
                    if (nearest) showElevationMapMarker(nearest.lat, nearest.lng);
                    return;
                }

                // Find distance at cursor position
                const dist = ((x - padding.left) / chartWidth) * maxDist;

                // Find nearest data point
                let nearest = data[0];
                let minDiff = Math.abs(data[0].distance - dist);

                for (let i = 1; i < data.length; i++) {
                    const diff = Math.abs(data[i].distance - dist);
                    if (diff < minDiff) {
                        minDiff = diff;
                        nearest = data[i];
                    }
                }

                let grade = null;
                if (mode === 'elevation') {
                    const idx = data.indexOf(nearest);
                    if (idx > 0) {
                        const prev = data[idx - 1];
                        const distDiff = (nearest.distance - prev.distance) * 1000; // in meters
                        if (distDiff > 0) {
                            const altDiff = nearest.altitude - prev.altitude;
                            grade = (altDiff / distDiff) * 100;
                        }
                    }
                }

                // Show cursor line from chart top to 0m baseline
                showElevationCursor(x, padding.top, chartHeight);

                // Show tooltip
                showProfileTooltip(e.clientX, e.clientY, nearest, mode, grade);

                // Show marker on map
                showElevationMapMarker(nearest.lat, nearest.lng);
            };

            canvas.onmouseup = (e) => {
                if (!_isProfileSelecting || !canvas._chartInfo) return;
                _isProfileSelecting = false;

                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                _profileSelectEndX = x;

                const dragWidth = Math.abs(_profileSelectEndX - _profileSelectStartX);
                if (dragWidth < 4) {
                    hideProfileSelection();
                    updateProfileSelectionStats();
                    return;
                }

                updateSelectionRange(canvas._chartInfo, _profileSelectStartX, _profileSelectEndX);
                updateSelectionOverlay(canvas._chartInfo, _profileSelectStartX, _profileSelectEndX);
                updateProfileSelectionStats();
            };

            canvas.onmouseleave = () => {
                if (_isProfileSelecting) {
                    _isProfileSelecting = false;
                }
                hideElevationTooltip();
                hideElevationMapMarker();
                hideElevationCursor();
            };

            canvas._updateSelectionOverlayFromRange = updateSelectionOverlayFromRange;
        }

        function showElevationCursor(x, chartTop, chartHeight) {
            const cursor = document.getElementById('elevationCursor');
            if (!cursor) return;

            // x is mouse position relative to canvas
            // Canvas is inside .elevation-content which has 16px left padding and 12px top padding
            // Cursor is positioned relative to .elevation-content, so we need to add the padding offsets
            const contentPaddingLeft = 16;
            const contentPaddingTop = 12;
            cursor.style.left = (x + contentPaddingLeft) + 'px';
            cursor.style.top = (chartTop + contentPaddingTop) + 'px';
            cursor.style.height = chartHeight + 'px';
            cursor.style.display = 'block';
        }

        function hideElevationCursor() {
            const cursor = document.getElementById('elevationCursor');
            if (cursor) {
                cursor.style.display = 'none';
            }
        }

        function showProfileTooltip(clientX, clientY, point, mode, grade) {
            const tooltip = document.getElementById('elevationTooltip');
            const valueEl = document.getElementById('elevationTooltipValue');
            if (!tooltip || !valueEl) return;

            const distStr = point.distance < 1
                ? `${(point.distance * 1000).toFixed(0)}m`
                : `${point.distance.toFixed(2)}km`;

            let html = '';
            if (mode === 'speed') {
                html = `<div><strong>${point.speedKmh.toFixed(1)} km/h</strong> at ${distStr}</div>`;
            } else {
                html = `<div><strong>${Math.round(point.altitude)}m</strong> at ${distStr}</div>`;
                if (grade !== null) {
                    const gradeStr = grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;
                    html += `<div style="font-size: 11px; opacity: 0.8;">Grade: ${gradeStr}</div>`;
                }
            }

            valueEl.innerHTML = html;
            tooltip.style.display = 'block';

            // Position tooltip away from cursor, flipping to left side if near right edge
            const panel = document.getElementById('elevationPanel');
            if (panel) {
                const panelRect = panel.getBoundingClientRect();
                const tooltipWidth = tooltip.offsetWidth || 120; // Estimate if not yet rendered
                const cursorXInPanel = clientX - panelRect.left;
                const spaceOnRight = panelRect.width - cursorXInPanel;
                const tooltipOffset = 25; // Distance from cursor line

                // If not enough space on right, position to the left of cursor
                if (spaceOnRight < tooltipWidth + tooltipOffset + 10) {
                    tooltip.style.left = `${cursorXInPanel - tooltipWidth - tooltipOffset}px`;
                } else {
                    tooltip.style.left = `${cursorXInPanel + tooltipOffset}px`;
                }
                tooltip.style.top = `${clientY - panelRect.top - 40}px`;
            }
        }

        function hideElevationTooltip() {
            const tooltip = document.getElementById('elevationTooltip');
            if (tooltip) tooltip.style.display = 'none';
        }

        function showElevationMapMarker(lat, lng) {
            if (!map) return;

            if (elevationMarker) {
                elevationMarker.setLatLng([lat, lng]);
            } else {
                const icon = L.divIcon({
                    className: 'elevation-marker',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });
                elevationMarker = L.marker([lat, lng], { icon: icon, zIndexOffset: 1000 }).addTo(map);
            }
        }

        function hideElevationMapMarker() {
            if (elevationMarker && map) {
                map.removeLayer(elevationMarker);
                elevationMarker = null;
            }
        }

        async function saveMapAsImage() {
            const mapSaveBtn = document.getElementById('mapSaveBtn');
            const mapPanelTitle = (document.getElementById('mapPanelTitle')?.textContent || 'map').trim();

            if (!map) return;

            const sleep = (ms) => new Promise(r => setTimeout(r, ms));

            function safeFilename(s) {
                return (s || 'map')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .replace(/[^a-z0-9]+/gi, '_')
                    .replace(/^_+|_+$/g, '')
                    .toLowerCase() || 'map';
            }

            async function ensureScript(src, testFn, timeoutMs = 15000) {
                if (testFn()) return;

                const existing = Array.from(document.scripts).find(s => s.src === src);
                if (existing) {
                    const start = Date.now();
                    while (!testFn()) {
                        if (Date.now() - start > timeoutMs) throw new Error(`Timeout loading ${src}`);
                        await sleep(50);
                    }
                    return;
                }

                await new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    s.src = src;
                    s.async = true;
                    s.onload = resolve;
                    s.onerror = reject;
                    document.head.appendChild(s);
                });

                const start = Date.now();
                while (!testFn()) {
                    if (Date.now() - start > timeoutMs) throw new Error(`Timeout initialising ${src}`);
                    await sleep(50);
                }
            }

            async function waitForTileLayerLoad(timeoutMs = 9000) {
                try {
                    map.invalidateSize({ animate: false });
                } catch {
                    map.invalidateSize();
                }

                if (currentTileLayer && typeof currentTileLayer.once === 'function') {
                    await new Promise((resolve) => {
                        const timer = setTimeout(resolve, timeoutMs);
                        currentTileLayer.once('load', () => {
                            clearTimeout(timer);
                            resolve();
                        });
                    });
                }

                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                await sleep(600);
            }

            function downloadDataUrl(dataUrl, baseName) {
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = `${baseName}.jpg`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }

            const prevBtnText = mapSaveBtn?.textContent;
            if (mapSaveBtn) {
                mapSaveBtn.disabled = true;
                mapSaveBtn.textContent = 'Saving...';
            }

            const mapContainer = document.getElementById('mapContainer');
            const diaryFloat = document.querySelector('.diary-float');
            const restore = {};

            try {
                await ensureScript(
                    'https://cdnjs.cloudflare.com/ajax/libs/dom-to-image/2.6.0/dom-to-image.min.js',
                    () => typeof window.domtoimage !== 'undefined'
                );

                // Temporarily hide diary for clean capture
                // (only if diary is currently visible)
                const diaryWasVisible = diaryFloat && diaryFloat.style.display !== 'none';
                const statsFloat = document.getElementById('statsFloat');
                const statsWasVisible = statsFloat && statsFloat.style.display === 'flex';
                
                if (diaryFloat && diaryWasVisible) {
                    restore.diaryDisplay = diaryFloat.style.display;
                    diaryFloat.style.display = 'none';
                }
                
                if (statsFloat && statsWasVisible) {
                    restore.statsDisplay = statsFloat.style.display;
                    statsFloat.style.display = 'none';
                }
                
                // Refit without diary/stats padding if we have routes/markers
                if (diaryWasVisible || statsWasVisible) {
                    if (mapMode === 'month' && allRouteSegments.length > 0) {
                        const bounds = [];
                        allRouteSegments.forEach(({ segment }) => {
                            if (segment && segment.getLatLngs) {
                                const latlngs = segment.getLatLngs();
                                latlngs.forEach(ll => bounds.push([ll.lat, ll.lng]));
                            }
                        });
                        if (bounds.length >= 2) {
                            // Account for title bar (8px margin + 72px height + 15px gap = 95px)
                            map.fitBounds(bounds, { 
                                paddingTopLeft: [30, 125],  // 30 left, 125 top (30 base + 95 for title bar area)
                                paddingBottomRight: [30, 30]
                            });
                        }
                    } else if (mapMode === 'day') {
                        const bounds = [];
                        
                        if (clusterGroup) {
                            clusterGroup.eachLayer(layer => {
                                if (layer.getLatLng) {
                                    const ll = layer.getLatLng();
                                    bounds.push([ll.lat, ll.lng]);
                                }
                            });
                        }
                        
                        if (dayRoutePolyline) {
                            dayRoutePolyline.eachLayer(layer => {
                                if (layer.getLatLngs) {
                                    const latlngs = layer.getLatLngs();
                                    latlngs.forEach(ll => bounds.push([ll.lat, ll.lng]));
                                }
                            });
                        }
                        
                        if (bounds.length >= 2) {
                            // Account for title bar (8px margin + 72px height + 15px gap = 95px)
                            map.fitBounds(bounds, { 
                                paddingTopLeft: [30, 125],  // 30 left, 125 top (30 base + 95 for title bar area)
                                paddingBottomRight: [30, 30]
                            });
                        }
                    }
                    
                    map.invalidateSize({ animate: false });
                    await sleep(100);
                }

                await waitForTileLayerLoad();

                const zoomControls = mapContainer.querySelector('.leaflet-control-zoom');
                const attribControls = mapContainer.querySelector('.leaflet-control-attribution');
                if (zoomControls) { restore.zoomDisplay = zoomControls.style.display; zoomControls.style.display = 'none'; }
                if (attribControls) { restore.attribDisplay = attribControls.style.display; attribControls.style.display = 'none'; }

                await sleep(200); // Extra time for rendering

                const baseName = safeFilename(mapPanelTitle);
                const target = mapContainer;

                const w = target.clientWidth || target.offsetWidth;
                const h = target.clientHeight || target.offsetHeight;

                if (!w || !h) {
                    throw new Error('Invalid map container dimensions');
                }

                const dataUrl = await window.domtoimage.toJpeg(target, {
                    quality: 0.92,
                    bgcolor: '#ffffff',
                    width: w,
                    height: h,
                    style: {
                        transform: 'none'
                    },
                    filter: (node) => {
                        if (!(node instanceof Element)) return true;
                        if (node.classList.contains('leaflet-control-container')) return false;
                        if (node.classList.contains('diary-float')) return false;
                        return true;
                    }
                });

                if (!dataUrl || !dataUrl.startsWith('data:image')) {
                    throw new Error('Failed to generate image data');
                }

                downloadDataUrl(dataUrl, baseName);

            } catch (err) {
                logError('saveMapAsImage failed:', err);
                const errorMsg = err.message || err.toString();
                alert(`Failed to save map image: ${errorMsg}\n\nIf you are using Satellite view, the tile server may be blocking canvas export (CORS). Try Street/Cycle view and retry.`);
            } finally {
                const zoomControls = mapContainer.querySelector('.leaflet-control-zoom');
                const attribControls = mapContainer.querySelector('.leaflet-control-attribution');
                if (zoomControls) zoomControls.style.display = restore.zoomDisplay ?? '';
                if (attribControls) attribControls.style.display = restore.attribDisplay ?? '';

                // Restore diary and stats panels if they were visible before
                if (diaryFloat && restore.diaryDisplay !== undefined) {
                    diaryFloat.style.display = restore.diaryDisplay;
                }
                
                if (statsFloat && restore.statsDisplay !== undefined) {
                    statsFloat.style.display = restore.statsDisplay;
                }
                
                // Refit bounds with padding after restoration
                if ((restore.diaryDisplay !== undefined) || (restore.statsDisplay !== undefined)) {
                    setTimeout(() => {
                        refitMapBounds(true);
                    }, 100);
                }

                monitorMapResize();
                try { map.invalidateSize({ animate: false }); } catch { map.invalidateSize(); }

                if (mapSaveBtn) {
                    mapSaveBtn.disabled = false;
                    mapSaveBtn.textContent = prevBtnText || 'Save';
                }
            }
        }
        
        function printDiary() {
            window.print();
        }
        
        // Handle print styling - clear inline width constraints
        let savedDiaryWidth = null;
        window.addEventListener('beforeprint', () => {
            const diaryFloat = document.querySelector('.diary-float');
            if (diaryFloat) {
                savedDiaryWidth = diaryFloat.style.width;
                diaryFloat.style.width = '';
            }
        });
        
        window.addEventListener('afterprint', () => {
            const diaryFloat = document.querySelector('.diary-float');
            if (diaryFloat && savedDiaryWidth) {
                diaryFloat.style.width = savedDiaryWidth;
            }
        });
        
        function downloadCurrentMonth() {
            if (!currentMonth || !generatedDiaries[currentMonth]) return;
            
            const diary = generatedDiaries[currentMonth];
            const blob = new Blob([diary.markdown], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `diary-${currentMonth}.md`;
            a.click();
            URL.revokeObjectURL(url);
        }

        function openExportModal() {
            const overlay = document.getElementById('exportModalOverlay');
            if (!overlay) return;
            const allCheckbox = document.getElementById('exportAllDays');
            const startInput = document.getElementById('exportStart');
            const endInput = document.getElementById('exportEnd');
            const jsonCheckbox = document.getElementById('exportJson');
            const gpxCheckbox = document.getElementById('exportGpx');
            const progress = document.getElementById('exportProgress');
            const progressFill = document.getElementById('exportProgressFill');
            const progressText = document.getElementById('exportProgressText');

            if (jsonCheckbox) jsonCheckbox.checked = true;
            if (gpxCheckbox) gpxCheckbox.checked = true;
            if (allCheckbox) allCheckbox.checked = false;

            const dayKey = (window.NavigationController && window.NavigationController.dayKey) || currentDayKey;
            if (startInput) startInput.value = dayKey || '';
            if (endInput) endInput.value = dayKey || '';

            if (progress) progress.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
            if (progressFill) progressFill.textContent = '0%';
            if (progressText) progressText.textContent = '';

            overlay.style.display = 'flex';
        }
        window.openExportModal = openExportModal;

        function closeExportModal() {
            const overlay = document.getElementById('exportModalOverlay');
            if (overlay) overlay.style.display = 'none';
        }
        window.closeExportModal = closeExportModal;

        function getDateRangeDayKeys(allDays, start, end) {
            if (!start && !end) return [];
            const startKey = start || end;
            const endKey = end || start;
            return allDays.filter(dk => dk >= startKey && dk <= endKey);
        }

        function updateExportProgress(current, total, dayKey) {
            const progress = document.getElementById('exportProgress');
            const progressFill = document.getElementById('exportProgressFill');
            const progressText = document.getElementById('exportProgressText');
            if (!progress || !progressFill || !progressText) return;
            progress.style.display = 'block';
            const pct = total === 0 ? 0 : Math.round((current / total) * 100);
            progressFill.style.width = `${pct}%`;
            progressFill.textContent = `${pct}%`;
            progressText.textContent = dayKey ? `Exporting ${dayKey} (${current}/${total})` : `${current}/${total}`;
        }

        async function exportDayJson(dayKey) {
            const record = await getDayFromDB(dayKey);
            if (!record || !record.data) return null;
            const exportData = getSanitizedDayDataForExport(record.data);
            const json = JSON.stringify(exportData, null, 2);
            return { name: `arc-timeline-${dayKey}.json`, blob: new Blob([json], { type: 'application/json' }) };
        }

        function formatGpxTime(value) {
            if (!value) return null;
            if (typeof value === 'string') {
                if (/[+-]\d{2}:\d{2}$/.test(value) || /Z$/.test(value)) return value;
                const parsed = Date.parse(value);
                if (!isNaN(parsed)) return new Date(parsed).toISOString();
                return null;
            }
            if (typeof value === 'number') return new Date(value).toISOString();
            return null;
        }

        function getTimelineItemsForGpx(dayData) {
            const items = Array.isArray(dayData?.timelineItems) ? dayData.timelineItems : [];
            if (items.length === 0) return [];

            // Reuse import/display dedupe logic so GPX doesn't include known duplicate artifacts.
            const deduped = filterGhostItems(items);

            // Extra safety: drop exact duplicate item IDs in export output.
            const seenIds = new Set();
            return deduped.filter(item => {
                const stableId = item.itemId || `${item.startDate || ''}|${item.endDate || ''}|${item.isVisit ? 'visit' : 'activity'}|${item.activityType || ''}`;
                if (seenIds.has(stableId)) return false;
                seenIds.add(stableId);
                return true;
            });
        }

        function getSanitizedDayDataForExport(dayData) {
            if (!dayData || typeof dayData !== 'object') return dayData;
            const timelineItems = getTimelineItemsForGpx(dayData);
            return { ...dayData, timelineItems };
        }

        function buildGpxFromDayData(dayKey, dayData) {
            const gpxHeader = `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n` +
                `<gpx creator="Arc App" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n`;
            const gpxFooter = `</gpx>\n`;

            const wptXml = [];
            const timelineItems = getTimelineItemsForGpx(dayData);
            const tracks = extractTracksFromData({ ...dayData, timelineItems });

            for (const item of timelineItems) {
                if (!item || !item.isVisit) continue;
                const center = item.center || item.place?.center;
                const lat = center?.latitude ?? center?.lat;
                const lng = center?.longitude ?? center?.lng;
                if (lat == null || lng == null) continue;
                const name = item.place?.name || item.locationName || item.placeName || 'Unknown';
                const time = formatGpxTime(item.startDate);
                const ele = center?.altitude ?? center?.alt;
                wptXml.push(`  <wpt lat="${lat}" lon="${lng}">` +
                    `${time ? `<time>${time}</time>` : ''}` +
                    `${ele != null ? `<ele>${ele}</ele>` : ''}` +
                    `<name>${name}</name>` +
                    `</wpt>`);
            }

            if (!tracks || tracks.length === 0) return gpxHeader + wptXml.join('\n') + '\n' + gpxFooter;

            const grouped = new Map();
            for (const track of tracks) {
                const name = track.activityType || 'activity';
                if (!grouped.has(name)) grouped.set(name, []);
                grouped.get(name).push(track);
            }

            const trackXml = [];
            for (const [name, group] of grouped.entries()) {
                trackXml.push(`  <trk>`);
                trackXml.push(`    <type>${name}</type>`);
                for (const track of group) {
                    trackXml.push('    <trkseg>');
                    for (const p of track.points || []) {
                        if (p.lat == null || p.lng == null) continue;
                        const ele = p.alt ?? p.altitude ?? p.elevation;
                        const t = formatGpxTime(p.t ?? p.timestamp ?? p.date);
                        trackXml.push(`      <trkpt lat="${p.lat}" lon="${p.lng}">` +
                            `${ele != null ? `<ele>${ele}</ele>` : ''}` +
                            `${t ? `<time>${t}</time>` : ''}` +
                            `</trkpt>`);
                    }
                    trackXml.push('    </trkseg>');
                }
                trackXml.push('  </trk>');
            }

            return gpxHeader + wptXml.join('\n') + '\n' + trackXml.join('\n') + '\n' + gpxFooter;
        }

        async function exportDayGpx(dayKey) {
            const record = await getDayFromDB(dayKey);
            if (!record || !record.data) return null;
            const exportData = getSanitizedDayDataForExport(record.data);
            const gpx = buildGpxFromDayData(dayKey, exportData);
            return { name: `arc-timeline-${dayKey}.gpx`, blob: new Blob([gpx], { type: 'application/gpx+xml' }) };
        }

        async function saveBlobs(blobs) {
            if (blobs.length === 0) return;
            if (window.showDirectoryPicker && blobs.length > 1) {
                const dirHandle = await window.showDirectoryPicker();
                for (const file of blobs) {
                    const handle = await dirHandle.getFileHandle(file.name, { create: true });
                    const writable = await handle.createWritable();
                    await writable.write(file.blob);
                    await writable.close();
                }
                return;
            }
            for (const file of blobs) {
                await saveBlobToFile(file.blob, file.name, [
                    { description: 'File', accept: { '*/*': [`.${file.name.split('.').pop()}`] } }
                ]);
            }
        }

        async function startExport() {
            const jsonCheckbox = document.getElementById('exportJson');
            const gpxCheckbox = document.getElementById('exportGpx');
            const allCheckbox = document.getElementById('exportAllDays');
            const startInput = document.getElementById('exportStart');
            const endInput = document.getElementById('exportEnd');

            const doJson = jsonCheckbox?.checked;
            const doGpx = gpxCheckbox?.checked;
            if (!doJson && !doGpx) {
                alert('Select JSON and/or GPX');
                return;
            }

            const allDays = await getAllDayKeysFromDB();
            let dayKeys = [];

            if (allCheckbox?.checked) {
                dayKeys = allDays.sort();
            } else {
                const start = startInput?.value || '';
                const end = endInput?.value || '';
                if (!start && !end) {
                    const dayKey = (window.NavigationController && window.NavigationController.dayKey) || currentDayKey;
                    if (!dayKey) {
                        alert('Select a day or range');
                        return;
                    }
                    dayKeys = [dayKey];
                } else {
                    dayKeys = getDateRangeDayKeys(allDays, start, end);
                }
            }

            if (dayKeys.length === 0) {
                alert('No days found for export');
                return;
            }

            const blobs = [];
            let processed = 0;
            for (const dayKey of dayKeys) {
                if (doJson) {
                    const jsonFile = await exportDayJson(dayKey);
                    if (jsonFile) blobs.push(jsonFile);
                }
                if (doGpx) {
                    const gpxFile = await exportDayGpx(dayKey);
                    if (gpxFile) blobs.push(gpxFile);
                }
                processed += 1;
                updateExportProgress(processed, dayKeys.length, dayKey);
            }

            await saveBlobs(blobs);
            closeExportModal();
        }
        window.startExport = startExport;
        async function saveBlobToFile(blob, suggestedName, types) {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = suggestedName;
            a.click();
            URL.revokeObjectURL(url);
        }

        function buildGpxForDayRoutes(dayKey, dayRoutes) {
            const gpxHeader = `<?xml version="1.0" encoding="UTF-8"?>\n` +
                `<gpx version="1.1" creator="Arc Timeline Diary Reader" xmlns="http://www.topografix.com/GPX/1/1">\n` +
                `  <metadata><name>${dayKey}</name></metadata>\n`;
            const gpxFooter = `</gpx>\n`;

            if (!dayRoutes || dayRoutes.length === 0) return gpxHeader + gpxFooter;

            const tracksByType = new Map();
            for (const pt of dayRoutes) {
                const type = pt.activityType || 'Unknown';
                if (!tracksByType.has(type)) tracksByType.set(type, []);
                tracksByType.get(type).push(pt);
            }

            const segmentsByType = new Map();
            for (const [type, points] of tracksByType) {
                const segments = [];
                let current = [];
                let lastType = null;
                for (const pt of points) {
                    if (lastType !== null && pt.activityType !== lastType) {
                        if (current.length) segments.push(current);
                        current = [];
                    }
                    current.push(pt);
                    lastType = pt.activityType;
                }
                if (current.length) segments.push(current);
                segmentsByType.set(type, segments);
            }

            const trackXml = [];
            for (const [type, segments] of segmentsByType) {
                trackXml.push(`  <trk><name>${type}</name>`);
                for (const seg of segments) {
                    trackXml.push('    <trkseg>');
                    for (const p of seg) {
                        if (p.lat == null || p.lng == null) continue;
                        const ele = p.alt ?? p.altitude ?? p.elevation;
                        const t = getPointTime(p);
                        trackXml.push(`      <trkpt lat="${p.lat}" lon="${p.lng}">` +
                            `${ele != null ? `<ele>${ele}</ele>` : ''}` +
                            `${t ? `<time>${new Date(t).toISOString()}</time>` : ''}` +
                            `</trkpt>`);
                    }
                    trackXml.push('    </trkseg>');
                }
                trackXml.push('  </trk>');
            }

            return gpxHeader + trackXml.join('\n') + '\n' + gpxFooter;
        }

        
        // Search functions
        function handleSearchKeyup(event) {
            const query = searchInput.value.trim();
            const findBtn = document.getElementById('findBtn');
            const clearSearchBtn = document.getElementById('clearSearchBtn');
            
            // Clear cache if query changed
            if (query !== window.lastSearchQuery) {
                window.lastSearchQuery = null;
            }
            
            // Show/hide Find button based on input
            if (query.length >= 2) {
                // Tag search: #new, #updated, #event, #event Name
                if (query.startsWith('#')) {
                    findBtn.style.display = 'inline-block';
                    searchCount.textContent = '🏷️ Tag search (Enter to find)';
                    if (event.key === 'Enter') {
                        performFindSearch();
                    }
                } else {
                // Check if it's a date - dates navigate immediately
                const dateKey = parseDateQuery(query);
                if (dateKey) {
                    findBtn.style.display = 'none';
                    // Date search - execute immediately
                    if (event.key === 'Enter') {
                        performDateSearch(dateKey);
                    } else {
                        // Show date preview in search count
                        const date = new Date(dateKey + 'T00:00:00');
                        const displayDate = date.toLocaleDateString('en-AU', { 
                            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' 
                        });
                        searchCount.textContent = `📅 ${displayDate} (Enter to go)`;
                    }
                } else {
                    findBtn.style.display = 'inline-block';
                    searchCount.textContent = '';
                    // Enter key triggers Find
                    if (event.key === 'Enter') {
                        performFindSearch();
                    }
                }
                } // end else (non-tag branch)
                clearSearchBtn.style.display = 'inline-block';
            } else {
                findBtn.style.display = 'none';
                clearSearchBtn.style.display = query.length > 0 ? 'inline-block' : 'none';
                searchCount.textContent = '';
            }
        }
        
        // Perform date navigation
        async function performDateSearch(dateKey) {
            const monthKey = dateKey.substring(0, 7);
            
            // Check if month exists in our data
            if (!monthKeys.includes(monthKey)) {
                if (monthKeys.length > 0) {
                    const firstMonth = monthKeys[0];
                    const lastMonth = monthKeys[monthKeys.length - 1];
                    if (monthKey < firstMonth || monthKey > lastMonth) {
                        searchCount.textContent = `Outside data range`;
                    } else {
                        searchCount.textContent = 'No data for this month';
                    }
                }
                return;
            }
            
            // Load month if needed
            if (!generatedDiaries[monthKey]) {
                await loadMonthFromDatabase(monthKey);
            }
            
            const diary = generatedDiaries[monthKey];
            const dayExists = diary?.monthData?.days?.[dateKey];
            
            if (!dayExists) {
                searchCount.textContent = `No data for ${dateKey}`;
                return;
            }
            
            // Clear search and navigate
            searchInput.value = '';
            document.getElementById('findBtn').style.display = 'none';
            document.getElementById('clearSearchBtn').style.display = 'none';
            searchCount.textContent = '';
            
            await navigateToDate(monthKey, dateKey);
        }
        
        // Main Find search function (called by Find button or Enter)
        async function performFindSearch() {
            const query = searchInput.value.trim();
            if (query.length < 2) return;

            // Close event slider if open
            const eventSlider = document.getElementById('eventSlider');
            if (eventSlider && eventSlider.classList.contains('open')) {
                closeEventSlider();
            }

            // Check for tag search (#new, #updated, #event)
            if (query.startsWith('#')) {
                performTagSearch(query);
                return;
            }

            // Check for date first
            const dateKey = parseDateQuery(query);
            if (dateKey) {
                performDateSearch(dateKey);
                return;
            }
            
            // Check if we have cached results for this exact query
            if (window.lastSearchQuery === query && window.currentSearchMatches && window.currentSearchMatches.length > 0) {
                // Just reopen the slider with existing results
                const slider = document.getElementById('searchResultsSlider');
                const resultsList = document.getElementById('searchResultsList');
                const resultsTitle = document.getElementById('searchResultsTitle');
                const container = document.getElementById('diaryContentContainer');
                
                positionSearchSlider();
                slider.classList.add('open');
                if (container) container.classList.add('slider-open');
                updateMapPaddingForSlider(true);
                
                resultsTitle.textContent = `${window.currentSearchMatches.length}${window.currentSearchMatches.length >= 100 ? '+' : ''} results`;
                return;
            }
            
            const MAX_RESULTS = 100;
            const matches = [];
            const queryLower = query.toLowerCase();
            
            if (!db) {
                searchCount.textContent = 'No database';
                return;
            }
            
            // Open slider immediately to show progress
            const slider = document.getElementById('searchResultsSlider');
            const resultsList = document.getElementById('searchResultsList');
            const resultsTitle = document.getElementById('searchResultsTitle');
            const container = document.getElementById('diaryContentContainer');
            
            // Set up search state for stopping
            window.searchAborted = false;
            
            resultsTitle.textContent = 'Searching...';
            resultsList.innerHTML = `<div class="search-progress" id="searchProgress">
                <div class="search-progress-bar-container">
                    <div class="search-progress-bar" id="searchProgressBar" style="width: 0%"></div>
                </div>
                <div class="search-progress-text" id="searchProgressText">0 found</div>
                <button class="btn-stop-search" onclick="window.searchAborted = true; this.textContent = 'Stopping...'">Stop</button>
            </div>`;
            
            // Position slider to the right of diary-float
            positionSearchSlider();
            slider.classList.add('open');
            if (container) container.classList.add('slider-open');
            updateMapPaddingForSlider(true);
            
            // Store for navigation during search
            window.currentSearchMatches = matches;
            window.currentSearchQuery = query;
            
            const highlightRegex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            
            // Get total count for progress (fast)
            let totalDays = 0;
            try {
                totalDays = await new Promise((resolve, reject) => {
                    const tx = db.transaction(['days'], 'readonly');
                    const store = tx.objectStore('days');
                    const req = store.count();
                    req.onsuccess = () => resolve(req.result || 0);
                    req.onerror = () => reject(req.error);
                });
            } catch (e) {
                totalDays = 1000; // Fallback estimate
            }
            
            let processedDays = 0;
            let lastRenderedCount = 0;
            let lastUIUpdate = Date.now();
            const UI_UPDATE_INTERVAL = 100; // ms between UI updates
            
            // Use cursor to iterate through days (single transaction, low memory)
            await new Promise((resolve, reject) => {
                const tx = db.transaction(['days'], 'readonly');
                const store = tx.objectStore('days');
                const req = store.openCursor(null, 'prev'); // Reverse chronological
                
                req.onsuccess = (event) => {
                    const cursor = event.target.result;
                    
                    // Check termination conditions
                    if (!cursor || matches.length >= MAX_RESULTS || window.searchAborted) {
                        resolve();
                        return;
                    }
                    
                    const dayRecord = cursor.value;
                    const dayKey = cursor.key;
                    processedDays++;
                    
                    // Process this day's data (synchronous - no await)
                    if (dayRecord?.data?.timelineItems) {
                        const monthKey = dayKey.substring(0, 7);
                        const data = dayRecord.data;
                        
                        for (const item of data.timelineItems) {
                            if (matches.length >= MAX_RESULTS) break;
                            
                            // Build location name
                            let locationName = item.displayName || item.customTitle || '';
                            
                            const placeId = item?.place?.placeId || item?.place?.id || item?.placeId || item?.placeUUID;
                            if (!locationName && placeId && placesById && placesById[String(placeId)]) {
                                locationName = placesById[String(placeId)];
                            }
                            
                            if (!locationName) {
                                locationName = item.place?.name || 
                                              item.place?.customTitle ||
                                              item.streetAddress ||
                                              (item.isVisit ? 'Visit' : (item.activityType || 'Activity'));
                            }

                            // Keep search labels consistent with diary rendering:
                            // unknown/no-GPS activity spans are "Data Gap", not "Unknown".
                            let activityType = item.activityType || '';
                            if (!item.isVisit) {
                                const act = activityType.toLowerCase();
                                const hasNoGpsSamples = !Array.isArray(item.samples) || item.samples.length === 0;
                                if ((act === 'unknown' || act === '') && hasNoGpsSamples) {
                                    locationName = 'Data Gap';
                                    activityType = '';
                                }
                            }
                            const searchText = `${locationName} ${activityType}`.toLowerCase();
                            
                            // Use indexOf for faster matching
                            if (searchText.indexOf(queryLower) !== -1) {
                                matches.push({
                                    monthKey,
                                    dayKey,
                                    time: item.startDate ? new Date(item.startDate).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '',
                                    type: item.isVisit ? 'visit' : 'activity',
                                    name: locationName,
                                    text: locationName,
                                    inNote: false,
                                    startTime: item.startDate,
                                    lat: item.center?.latitude || item.place?.center?.latitude,
                                    lng: item.center?.longitude || item.place?.center?.longitude
                                });
                            }
                            
                            // Search notes
                            const notes = item.notes;
                            if (notes && matches.length < MAX_RESULTS) {
                                let notesArray = [];
                                if (typeof notes === 'string' && notes.trim()) {
                                    notesArray = [{ body: notes, date: item.startDate }];
                                } else if (Array.isArray(notes)) {
                                    notesArray = notes;
                                } else if (typeof notes === 'object' && notes.body) {
                                    notesArray = [notes];
                                }
                                
                                for (const note of notesArray) {
                                    if (matches.length >= MAX_RESULTS) break;
                                    
                                    const noteBody = (typeof note === 'string') ? note : (note.body || note.text || '');
                                    if (noteBody && noteBody.toLowerCase().indexOf(queryLower) !== -1) {
                                        matches.push({
                                            monthKey,
                                            dayKey,
                                            time: (note.date || item.startDate) ? new Date(note.date || item.startDate).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '',
                                            type: 'note',
                                            name: locationName,
                                            text: noteBody,
                                            inNote: true,
                                            startTime: note.date || item.startDate,
                                            lat: item.center?.latitude || item.place?.center?.latitude,
                                            lng: item.center?.longitude || item.place?.center?.longitude
                                        });
                                    }
                                }
                            }
                        }
                    }
                    
                    // Update UI periodically (time-based, not count-based)
                    const now = Date.now();
                    if (now - lastUIUpdate > UI_UPDATE_INTERVAL) {
                        lastUIUpdate = now;
                        
                        const progressBar = document.getElementById('searchProgressBar');
                        const progressText = document.getElementById('searchProgressText');
                        if (progressBar && totalDays > 0) {
                            const pct = Math.round((processedDays / totalDays) * 100);
                            progressBar.style.width = Math.min(pct, 100) + '%';
                        }
                        if (progressText) {
                            progressText.textContent = `${matches.length} found`;
                        }
                        
                        // Render new matches
                        if (matches.length > lastRenderedCount) {
                            appendSearchResults(matches, lastRenderedCount, highlightRegex);
                            lastRenderedCount = matches.length;
                        }
                    }
                    
                    // Continue to next record
                    cursor.continue();
                };
                
                req.onerror = () => reject(req.error);
            });
            
            // Remove progress element
            const progressEl = document.getElementById('searchProgress');
            if (progressEl) progressEl.remove();

            // Sort matches in reverse chronological order (newest first)
            matches.sort((a, b) => b.dayKey.localeCompare(a.dayKey));

            // Clear and re-render all results in sorted order
            resultsList.innerHTML = '';
            appendSearchResults(matches, 0, highlightRegex);

            // Final status
            const wasAborted = window.searchAborted;
            window.searchAborted = false;

            if (matches.length === 0) {
                searchCount.textContent = 'No matches found';
                resultsTitle.textContent = 'No results';
                resultsList.replaceChildren();
                const empty = document.createElement('div');
                empty.className = 'search-results-empty';
                empty.textContent = `No matches found for "${query}"`;
                resultsList.appendChild(empty);
                return;
            }
            
            const isTruncated = matches.length >= MAX_RESULTS;
            if (wasAborted) {
                resultsTitle.textContent = `${matches.length} results (stopped)`;
                searchCount.textContent = `${matches.length} matches (stopped)`;
            } else if (isTruncated) {
                resultsTitle.textContent = `${MAX_RESULTS}+ results`;
                searchCount.textContent = `${MAX_RESULTS}+ matches - narrow your search`;
                // Add warning at top
                const warning = document.createElement('div');
                warning.className = 'search-results-warning';
                warning.textContent = `⚠️ Showing first ${MAX_RESULTS} results. Narrow your search.`;
                resultsList.insertBefore(warning, resultsList.firstChild);
            } else {
                resultsTitle.textContent = `${matches.length} results`;
                searchCount.textContent = `${matches.length} matches`;
            }
            
            // Show nav buttons
            const prevSearchBtn = document.getElementById('prevSearchBtn');
            const nextSearchBtn = document.getElementById('nextSearchBtn');
            if (prevSearchBtn) { prevSearchBtn.style.display = 'inline-block'; prevSearchBtn.disabled = false; }
            if (nextSearchBtn) { nextSearchBtn.style.display = 'inline-block'; nextSearchBtn.disabled = false; }
            
            updateMapPaddingForSlider(true);
            
            // Cache search query for reopening
            window.lastSearchQuery = query;
            
            // Make slider focusable for keyboard navigation
            const sliderEl = document.getElementById('searchResultsSlider');
            if (sliderEl) {
                sliderEl.tabIndex = 0;
                sliderEl.focus();
            }
        }

        // Tag search: #new, #updated, #event, #event <name>
        async function performTagSearch(query) {
            const tag = query.substring(1).trim().toLowerCase();
            const spaceIdx = tag.indexOf(' ');
            const tagName = spaceIdx > 0 ? tag.substring(0, spaceIdx) : tag;
            const tagArg = spaceIdx > 0 ? tag.substring(spaceIdx + 1).trim() : '';

            // Build lookup sets for O(1) matching
            const addedSet = new Set(importAddedDays);
            const updatedSet = new Set(importUpdatedDays);

            // Determine match function
            let matchDay;
            let tagLabel;
            if (tagName === 'new') {
                matchDay = (dayKey) => addedSet.has(dayKey) ? 'NEW' : null;
                tagLabel = 'NEW';
            } else if (tagName === 'updated') {
                matchDay = (dayKey) => updatedSet.has(dayKey) ? 'UPDATED' : null;
                tagLabel = 'UPDATED';
            } else if (tagName === 'event') {
                matchDay = (dayKey) => {
                    const evts = getEventsForDay(dayKey);
                    if (evts.length === 0) return null;
                    if (tagArg) {
                        const match = evts.find(e => e.name.toLowerCase().includes(tagArg));
                        return match ? match.name : null;
                    }
                    return evts.map(e => e.name).join(', ');
                };
                tagLabel = tagArg ? `EVENT: ${tagArg}` : 'EVENT';
            } else {
                searchCount.textContent = 'Unknown tag: #' + tagName;
                return;
            }

            const MAX_RESULTS = 100;
            const matches = [];

            // Open slider with progress
            const slider = document.getElementById('searchResultsSlider');
            const resultsList = document.getElementById('searchResultsList');
            const resultsTitle = document.getElementById('searchResultsTitle');
            const container = document.getElementById('diaryContentContainer');

            window.searchAborted = false;
            resultsTitle.textContent = `Searching #${tagName}...`;
            resultsList.innerHTML = `<div class="search-progress" id="searchProgress">
                <div class="search-progress-bar-container">
                    <div class="search-progress-bar" id="searchProgressBar" style="width: 0%"></div>
                </div>
                <div class="search-progress-text" id="searchProgressText">0 found</div>
                <button class="btn-stop-search" onclick="window.searchAborted = true; this.textContent = 'Stopping...'">Stop</button>
            </div>`;

            positionSearchSlider();
            slider.classList.add('open');
            if (container) container.classList.add('slider-open');
            updateMapPaddingForSlider(true);

            window.currentSearchMatches = matches;
            window.currentSearchQuery = query;
            window.lastSearchQuery = query;

            // Count days for progress
            let totalDays = 0;
            try {
                totalDays = await new Promise((resolve, reject) => {
                    const tx = db.transaction(['days'], 'readonly');
                    const req = tx.objectStore('days').count();
                    req.onsuccess = () => resolve(req.result || 0);
                    req.onerror = () => reject(req.error);
                });
            } catch (e) { totalDays = 1000; }

            let processedDays = 0;
            let lastRenderedCount = 0;
            let lastUIUpdate = Date.now();

            // Iterate days via cursor (reverse chronological)
            await new Promise((resolve) => {
                const tx = db.transaction(['days'], 'readonly');
                const req = tx.objectStore('days').openCursor(null, 'prev');

                req.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (!cursor || matches.length >= MAX_RESULTS || window.searchAborted) {
                        resolve();
                        return;
                    }

                    const dayKey = cursor.key;
                    processedDays++;

                    const label = matchDay(dayKey);
                    if (label) {
                        const monthKey = dayKey.substring(0, 7);
                        const date = new Date(dayKey + 'T00:00:00');
                        const dayTitle = date.toLocaleDateString('en-AU', {
                            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                        });
                        matches.push({
                            monthKey,
                            dayKey,
                            time: '',
                            type: 'tag',
                            name: label,
                            text: dayTitle,
                            inNote: false,
                            startTime: dayKey + 'T00:00:00'
                        });
                    }

                    // Update UI periodically
                    const now = Date.now();
                    if (now - lastUIUpdate > 100) {
                        lastUIUpdate = now;
                        const bar = document.getElementById('searchProgressBar');
                        const txt = document.getElementById('searchProgressText');
                        if (bar && totalDays > 0) bar.style.width = Math.min(Math.round((processedDays / totalDays) * 100), 100) + '%';
                        if (txt) txt.textContent = `${matches.length} found`;
                        if (matches.length > lastRenderedCount) {
                            appendSearchResults(matches, lastRenderedCount, null);
                            lastRenderedCount = matches.length;
                        }
                    }

                    cursor.continue();
                };
                req.onerror = () => resolve();
            });

            // Final render
            if (matches.length > lastRenderedCount) {
                appendSearchResults(matches, lastRenderedCount, null);
            }

            // Remove progress bar
            const progress = document.getElementById('searchProgress');
            if (progress) progress.remove();

            resultsTitle.textContent = matches.length === 0 ? 'No results' :
                `${matches.length}${matches.length >= MAX_RESULTS ? '+' : ''} results`;

            if (matches.length === 0) {
                resultsList.innerHTML = `<div class="search-result-item" style="text-align:center;color:#888;">No days with #${tagName} tag</div>`;
            }

            searchCount.textContent = `${matches.length} ${tagLabel}`;
        }

        function buildHighlightedFragment(text, regex, highlightClass = '', tagName = 'mark') {
            const fragment = document.createDocumentFragment();
            const rawText = String(text ?? '');
            if (!(regex instanceof RegExp) || !rawText) {
                fragment.appendChild(document.createTextNode(rawText));
                return fragment;
            }

            const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
            const safeRegex = new RegExp(regex.source, flags);
            let lastIndex = 0;
            let match;

            while ((match = safeRegex.exec(rawText)) !== null) {
                const matchedText = match[0];
                if (!matchedText) {
                    safeRegex.lastIndex += 1;
                    continue;
                }

                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(rawText.slice(lastIndex, match.index)));
                }

                const highlight = document.createElement(tagName);
                if (highlightClass) highlight.className = highlightClass;
                highlight.textContent = matchedText;
                fragment.appendChild(highlight);
                lastIndex = match.index + matchedText.length;
            }

            if (lastIndex < rawText.length) {
                fragment.appendChild(document.createTextNode(rawText.slice(lastIndex)));
            }

            return fragment;
        }
        
        // Append new search results to the list (for progressive rendering)
        function appendSearchResults(matches, startIndex, highlightRegex) {
            const resultsList = document.getElementById('searchResultsList');
            if (!resultsList) return;
            
            const query = window.currentSearchQuery || '';
            
            for (let i = startIndex; i < matches.length; i++) {
                const match = matches[i];
                const date = new Date(match.dayKey + 'T00:00:00');
                const dateStr = date.toLocaleDateString('en-AU', { 
                    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' 
                });
                
                let displayText = match.text;
                if (displayText.length > 80) {
                    const matchPos = displayText.toLowerCase().indexOf(query.toLowerCase());
                    if (matchPos > 30) {
                        displayText = '...' + displayText.substring(matchPos - 20);
                    }
                    if (displayText.length > 80) {
                        displayText = displayText.substring(0, 77) + '...';
                    }
                }
                const icon = match.type === 'tag' ? '🏷️' : match.type === 'note' ? '📝' : (match.type === 'visit' ? '📍' : '🚶');
                
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.dataset.index = i;
                div.addEventListener('click', () => navigateToSearchResultByIndex(i));

                const dateEl = document.createElement('div');
                dateEl.className = 'search-result-date';
                dateEl.textContent = dateStr;

                const timeEl = document.createElement('div');
                timeEl.className = 'search-result-time';
                timeEl.textContent = `${match.time} ${icon} ${match.name}`;

                const textEl = document.createElement('div');
                textEl.className = 'search-result-text';
                textEl.appendChild(buildHighlightedFragment(displayText, highlightRegex, '', 'mark'));

                div.appendChild(dateEl);
                div.appendChild(timeEl);
                div.appendChild(textEl);
                
                resultsList.appendChild(div);
            }
        }
        
        // Update slider content with search results (after search completes)
        function showSearchResultsContent(matches, query, isTruncated) {
            const resultsList = document.getElementById('searchResultsList');
            const resultsTitle = document.getElementById('searchResultsTitle');
            
            const MAX_RESULTS = 100;
            resultsTitle.textContent = isTruncated ? `${MAX_RESULTS}+ results` : `${matches.length} results`;
            
            const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

            resultsList.replaceChildren();
            if (isTruncated) {
                const warning = document.createElement('div');
                warning.className = 'search-results-warning';
                warning.textContent = `⚠️ Showing first ${MAX_RESULTS} results. Narrow your search.`;
                resultsList.appendChild(warning);
            }

            appendSearchResults(matches, 0, regex);
            
            // Store for navigation
            window.currentSearchMatches = matches;
            window.currentSearchQuery = query;
            
            // Show nav buttons
            const prevSearchBtn = document.getElementById('prevSearchBtn');
            const nextSearchBtn = document.getElementById('nextSearchBtn');
            if (prevSearchBtn) { prevSearchBtn.style.display = 'inline-block'; prevSearchBtn.disabled = false; }
            if (nextSearchBtn) { nextSearchBtn.style.display = 'inline-block'; nextSearchBtn.disabled = false; }
            
            updateMapPaddingForSlider(true);
        }
        
        // Parse various date formats and return YYYY-MM-DD or null
        function parseDateQuery(query) {
            if (!query) return null;

            const trimmed = query.trim();
            if (!trimmed) return null;

            // Never auto-jump on a bare year fragment (prevents "20" -> 2020 while typing)
            if (/^\d{1,4}$/.test(trimmed)) return null;

            // Try various date patterns (supports 4-digit year, plus 2-digit year when the full date is present)
            const patterns = [
                // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (4 or 2 digit year)
                /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2}|\d{4})$/,
                // YYYY-MM-DD or YYYY/MM/DD (4 digit year only)
                /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/,
                // DD MMM YYYY/YY (e.g., 27 Sep 2025, 27-Sep-25)
                /^(\d{1,2})[\s\-]?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-]?(\d{2}|\d{4})$/i,
                // MMM DD YYYY/YY (e.g., Sep 27 25)
                /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-]?(\d{1,2})[\s,\-]+(\d{2}|\d{4})$/i
            ];

            const monthNames = {
                'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
                'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
                'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
            };

            const expandYear = (yyOrYyyy) => {
                const y = String(yyOrYyyy);
                if (y.length === 4) return y;

                // 2-digit year windowing:
                // - default to 20xx for near-future years
                // - otherwise 19xx (helps older history)
                const yy = parseInt(y, 10);
                if (!Number.isFinite(yy)) return null;

                const now = new Date();
                const currentYY = now.getFullYear() % 100;
                const cutoff = (currentYY + 5) % 100;

                // If within [0..cutoff] (wrapping handled by simple rule), treat as 20xx.
                // Practical: in 2026, 00..31 => 2000..2031, otherwise 1900..1999.
                if (yy <= cutoff) return String(2000 + yy);
                return String(1900 + yy);
            };

            // Pattern 1: DD/MM/YYYY or DD/MM/YY
            let match = trimmed.match(patterns[0]);
            if (match) {
                const day = match[1].padStart(2, '0');
                const month = match[2].padStart(2, '0');
                const year = expandYear(match[3]);
                if (!year) return null;
                return `${year}-${month}-${day}`;
            }

            // Pattern 2: YYYY-MM-DD
            match = trimmed.match(patterns[1]);
            if (match) {
                const year = match[1];
                const month = match[2].padStart(2, '0');
                const day = match[3].padStart(2, '0');
                return `${year}-${month}-${day}`;
            }

            // Pattern 3: DD MMM YYYY/YY
            match = trimmed.match(patterns[2]);
            if (match) {
                const day = match[1].padStart(2, '0');
                const month = monthNames[match[2].toLowerCase().substring(0, 3)];
                const year = expandYear(match[3]);
                if (!year) return null;
                return `${year}-${month}-${day}`;
            }

            // Pattern 4: MMM DD YYYY/YY
            match = trimmed.match(patterns[3]);
            if (match) {
                const month = monthNames[match[1].toLowerCase().substring(0, 3)];
                const day = match[2].padStart(2, '0');
                const year = expandYear(match[3]);
                if (!year) return null;
                return `${year}-${month}-${day}`;
            }

            return null;
        }
        
        // Navigate to a specific date
        async function navigateToDate(monthKey, dayKey) {
            // ALWAYS use loadAndDisplayMonth as the single pipeline for navigation
            // This ensures consistent behavior with Year/Month menu, keyboard nav, etc.
            await loadAndDisplayMonth(monthKey);
            
            // Find the day header and scroll to it, then show day map
            setTimeout(() => {
                const dayHeader = markdownContent.querySelector(`[data-day="${dayKey}"]`);
                if (dayHeader) {
                    const h2 = dayHeader.closest('h2');
                    if (h2) {
                        clearDayHighlights();
                        h2.classList.add('day-highlight');
                        h2.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        
                        // Update currentDayIndex for consistency
                        const allDays = getDaysInCurrentMonth();
                        currentDayIndex = allDays.indexOf(dayKey);
                        if (currentDayIndex === -1) currentDayIndex = 0;
                        
                        // Update currentLocationIndex to first entry of this day
                        const entries = getLocationsInCurrentMonth();
                        const firstEntryIndex = entries.findIndex(li => {
                            const locData = li.querySelector('.location-data');
                            return locData && locData.dataset.daykey === dayKey;
                        });
                        if (firstEntryIndex !== -1) {
                            currentLocationIndex = firstEntryIndex;
                        }
                        
                        // Show day map
                        showDayMap(dayKey, null, null);
                    }
                } else {
                    // Day not found in current view - may be filtered out
                    // Try unchecking "Notes only" and refreshing
                    const notesOnly = document.getElementById('notesOnly');
                    if (notesOnly && notesOnly.checked) {
                        notesOnly.checked = false;
                        notesOnly.dispatchEvent(new Event('change'));
                        // Try again after refresh
                        setTimeout(() => {
                            const dayHeader2 = markdownContent.querySelector(`[data-day="${dayKey}"]`);
                            if (dayHeader2) {
                                const h2 = dayHeader2.closest('h2');
                                if (h2) {
                                    clearDayHighlights();
                                    h2.classList.add('day-highlight');
                                    h2.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    
                                    const allDays = getDaysInCurrentMonth();
                                    currentDayIndex = allDays.indexOf(dayKey);
                                    if (currentDayIndex === -1) currentDayIndex = 0;
                                    
                                    // Update currentLocationIndex to first entry of this day
                                    const entries = getLocationsInCurrentMonth();
                                    const firstEntryIndex = entries.findIndex(li => {
                                        const locData = li.querySelector('.location-data');
                                        return locData && locData.dataset.daykey === dayKey;
                                    });
                                    if (firstEntryIndex !== -1) {
                                        currentLocationIndex = firstEntryIndex;
                                    }
                                    
                                    showDayMap(dayKey, null, null);
                                }
                            }
                        }, 200);
                    }
                }
            }, 300); // Slightly longer delay to ensure diary is rendered
        }
        
        // Close search results slider
        function closeSearchResults() {
            const slider = document.getElementById('searchResultsSlider');
            const container = document.getElementById('diaryContentContainer');
            
            if (slider) slider.classList.remove('open');
            if (container) container.classList.remove('slider-open');
            
            // Clear active state
            document.querySelectorAll('.search-result-item.active').forEach(el => el.classList.remove('active'));
            
            // Update map padding and recenter
            updateMapPaddingForSlider(false);
        }
        
        // Position slider to the right of diary-float
        function positionSearchSlider() {
            const slider = document.getElementById('searchResultsSlider');
            const diaryFloat = document.querySelector('.diary-float');
            const modalHeader = document.querySelector('.modal-header');
            
            if (!slider || !diaryFloat) return;
            
            const diaryRect = diaryFloat.getBoundingClientRect();
            const headerBottom = modalHeader ? modalHeader.getBoundingClientRect().bottom + 15 : 0; // +15 margin
            
            // Ensure slider doesn't overlap modal header
            const sliderTop = Math.max(diaryRect.top, headerBottom);
            
            // Position slider slightly under diary (20px overlap) to hide corner gap
            // Since slider has lower z-index, diary's rounded corner covers the overlap
            slider.style.left = (diaryRect.right - 20) + 'px';
            slider.style.top = sliderTop + 'px';
            slider.style.bottom = (window.innerHeight - diaryRect.bottom) + 'px';
            slider.style.height = 'auto'; // Let top/bottom control height
        }
        
        // Reposition slider and update margins when window resizes
        window.addEventListener('resize', () => {
            const slider = document.getElementById('searchResultsSlider');
            if (slider && slider.classList.contains('open')) {
                positionSearchSlider();
            }

            // Also reposition event slider
            const eventSlider = document.getElementById('eventSlider');
            if (eventSlider && eventSlider.classList.contains('open')) {
                positionEventSlider();
            }
            
            // Reposition replay controller if visible
            const replayControllerEl = document.getElementById('replayController');
            if (replayControllerEl && replayControllerEl.style.display === 'flex') {
                if (window.positionReplayController) window.positionReplayController();
            }

            // Update NavigationController margins on resize
            const diaryFloat = document.querySelector('.diary-float');
            const statsFloat = document.getElementById('statsFloat');
            if (diaryFloat && diaryFloat.style.display !== 'none') {
                const diaryWidth = diaryFloat.offsetWidth || 0;
                const statsWidth = (statsFloat && statsFloat.style.display !== 'none') ? (statsFloat.offsetWidth || 0) : 0;
                const sliderWidth = (slider && slider.classList.contains('open')) ? 280 : 0;
                NavigationController.updateViewportMargins({
                    left: diaryWidth,
                    right: statsWidth,
                    sliderLeft: sliderWidth
                }, { delay: 100 });
            }
        });


        // Listen for navigation messages from analysis page via BroadcastChannel
        // This allows communication between independent browser windows/tabs
        const navChannel = new BroadcastChannel('arc-diary-nav');
        
        // State for location view mode
        let locationViewMode = false;
        // Expose for keyboard handler
        window.isLocationViewMode = () => locationViewMode;
        let savedDiaryState = null;
        
        navChannel.onmessage = async (event) => {
            if (event.data?.type === 'navigateToDate' && event.data?.date) {
                const date = event.data.date; // YYYY-MM-DD format
                const monthKey = date.substring(0, 7); // YYYY-MM
                
                // Send acknowledgment back
                navChannel.postMessage({ type: 'navigateAck', date: date });
                
                await navigateToDate(monthKey, date);
                window.focus(); // Bring diary window to front
            } else if (event.data?.type === 'navigateToMonth' && event.data?.month) {
                const monthKey = event.data.month; // YYYY-MM format
                
                // Send acknowledgment back
                navChannel.postMessage({ type: 'navigateMonthAck', month: monthKey });
                
                await navigateToMonth(monthKey);
                window.focus(); // Bring diary window to front
            } else if (event.data?.type === 'showLocations' && event.data?.locations) {
                // Enter location view mode
                enterLocationViewMode(event.data.locations);
                window.focus(); // Bring diary window to front
            }
        };
        
        // Enter location view mode - shows selected locations on main map
        let locationViewLocations = null; // Store for interactions
        let locationMarkers = []; // Track location markers for interactions
        
        // Calculate distance between two coordinates in meters
        function haversineDistance(lat1, lng1, lat2, lng2) {
            const R = 6371000; // Earth's radius in meters
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        }
        
        // Merge nearby locations (within 150m) into single locations
        function mergeNearbyLocations(locations) {
            const MERGE_THRESHOLD_M = 150;
            const locArray = Object.entries(locations);
            const merged = {};
            const used = new Set();
            
            for (let i = 0; i < locArray.length; i++) {
                if (used.has(i)) continue;
                
                const [locId, loc] = locArray[i];
                const cluster = [{ locId, loc }];
                used.add(i);
                
                // Find nearby locations
                for (let j = i + 1; j < locArray.length; j++) {
                    if (used.has(j)) continue;
                    
                    const [otherId, other] = locArray[j];
                    const dist = haversineDistance(loc.lat, loc.lng, other.lat, other.lng);
                    
                    if (dist <= MERGE_THRESHOLD_M) {
                        cluster.push({ locId: otherId, loc: other });
                        used.add(j);
                    }
                }
                
                if (cluster.length === 1) {
                    // No merge needed
                    merged[locId] = loc;
                } else {
                    // Merge cluster - combine visits from nearby locations
                    const allVisits = [];
                    const names = new Set();
                    let totalLat = 0, totalLng = 0;
                    
                    for (const { loc: l } of cluster) {
                        allVisits.push(...l.visits);
                        names.add(l.name.split(',')[0].trim()); // Base name without suburb
                        totalLat += l.lat;
                        totalLng += l.lng;
                    }
                    
                    // Sort visits by date descending (keep all visits, don't merge same-day)
                    allVisits.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
                    
                    // Use centroid
                    const avgLat = totalLat / cluster.length;
                    const avgLng = totalLng / cluster.length;
                    
                    // Create merged location with first location's ID
                    const mergedName = Array.from(names)[0]; // Use first name (they should be same)
                    merged[locId] = {
                        name: mergedName,
                        lat: avgLat,
                        lng: avgLng,
                        visits: allVisits
                    };
                }
            }
            
            return merged;
        }
        
        function enterLocationViewMode(locations) {
            
            // Merge nearby locations before displaying
            const mergedLocations = mergeNearbyLocations(locations);
            
            // Store for interactions
            locationViewLocations = mergedLocations;
            
            // Save current state
            savedDiaryState = {
                monthKey: currentMonth,
                dayIndex: currentDayIndex,
                scrollTop: markdownContent?.scrollTop || 0,
                diaryTitle: document.getElementById('diaryTitle')?.textContent || '',
                diaryBuild: document.getElementById('diaryBuild')?.textContent || ''
            };
            
            locationViewMode = true;
            
            // Hide navigation and controls
            document.querySelector('.modal-controls')?.classList.add('location-view-hidden');
            document.getElementById('diaryNavGroup')?.classList.add('location-view-hidden');
            document.querySelector('.diary-search')?.classList.add('location-view-hidden');
            document.querySelector('.diary-checkboxes')?.classList.add('location-view-hidden');
            document.getElementById('statsFloat')?.classList.add('location-view-hidden');
            
            // Update viewport margins since stats panel is hidden
            NavigationController.updateViewportMargins({ right: 0 }, { delay: 0 });
            
            // Hide map controls that don't apply to location view (keep measure tool)
            document.getElementById('mapFilterBtn')?.classList.add('location-view-hidden');
            document.getElementById('animationBtn')?.classList.add('location-view-hidden');
            document.getElementById('transparencyBtn')?.classList.add('location-view-hidden');
            document.getElementById('mapSaveBtn')?.classList.add('location-view-hidden');
            // measureBtn stays visible for distance measurement
            
            // Update title to "Location View"
            const diaryTitle = document.getElementById('diaryTitle');
            if (diaryTitle) diaryTitle.textContent = 'Location View';
            
            const diaryBuild = document.getElementById('diaryBuild');
            if (diaryBuild) diaryBuild.textContent = '';
            
            // Add back button next to Print/Download (in diary-actions)
            const diaryActions = document.querySelector('.diary-actions');
            if (diaryActions && !document.getElementById('backToDiaryBtn')) {
                const backBtn = document.createElement('button');
                backBtn.id = 'backToDiaryBtn';
                backBtn.className = 'btn-diary-action btn-back-to-diary';
                backBtn.textContent = 'Back to Diary';
                backBtn.onclick = exitLocationViewMode;
                diaryActions.insertBefore(backBtn, diaryActions.firstChild);
            }
            
            // Generate location-focused content with subtitle header
            const markdown = generateLocationMarkdown(mergedLocations);
            if (markdownContent) {
                markdownContent.innerHTML = sanitizeHtml(markdown);
                markdownContent.scrollTop = 0;
            }
            
            // Clear existing map layers and show location markers
            showLocationMarkers(mergedLocations);
            
            // Geocode locations that don't have suburbs
            geocodeLocationsWithoutSuburbs(mergedLocations);
        }
        
        // Geocode locations that don't have suburbs and update display
        async function geocodeLocationsWithoutSuburbs(locations) {
            const GEOCODE_CACHE_KEY = 'arc_geocode_cache';
            
            // Get geocode cache
            let geocodeCache = {};
            try {
                geocodeCache = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}');
            } catch { }
            
            // Find locations needing geocoding (no comma in name = no suburb)
            const needsGeocoding = [];
            for (const [locId, loc] of Object.entries(locations)) {
                if (loc.lat && loc.lng && !loc.name.includes(',')) {
                    const cacheKey = `${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;
                    const cachedSuburb = geocodeCache[cacheKey];
                    if (cachedSuburb) {
                        // Use cached value immediately
                        if (!loc.name.includes(cachedSuburb)) {
                            loc.name = `${loc.name}, ${cachedSuburb}`;
                            updateLocationNameInDOM(locId, loc.name);
                        }
                    } else {
                        needsGeocoding.push({ locId, loc, cacheKey });
                    }
                }
            }
            
            if (needsGeocoding.length === 0) return;
            
            // Check Mapbox token
            const mapboxToken = localStorage.getItem('mapbox_token');
            
            if (mapboxToken) {
                // Mapbox - can run in parallel (no rate limit)
                const promises = needsGeocoding.map(async ({ locId, loc, cacheKey }) => {
                    try {
                        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${loc.lng},${loc.lat}.json?types=locality,neighborhood,place&limit=1&access_token=${mapboxToken}`;
                        const res = await fetch(url);
                        const data = await res.json();
                        if (data.features && data.features.length > 0) {
                            const feature = data.features[0];
                            let suburb = feature.text || '';
                            
                            // Check context for more specific locality
                            if (feature.context) {
                                for (const ctx of feature.context) {
                                    if (ctx.id?.startsWith('locality.') || ctx.id?.startsWith('neighborhood.')) {
                                        suburb = ctx.text;
                                        break;
                                    }
                                }
                            }
                            
                            // Only take first part if contains comma
                            if (suburb && suburb.includes(',')) {
                                suburb = suburb.split(',')[0].trim();
                            }
                            if (suburb) {
                                geocodeCache[cacheKey] = suburb;
                                if (!loc.name.includes(suburb)) {
                                    loc.name = `${loc.name}, ${suburb}`;
                                    updateLocationNameInDOM(locId, loc.name);
                                }
                            }
                        }
                    } catch (err) {
                        console.warn('Mapbox geocoding failed:', err);
                    }
                });
                
                await Promise.all(promises);
            } else {
                // Nominatim - must be sequential with rate limiting
                for (const { locId, loc, cacheKey } of needsGeocoding) {
                    try {
                        await new Promise(r => setTimeout(r, 1100));
                        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lng}&zoom=14`;
                        const res = await fetch(url, {
                            headers: { 'User-Agent': 'ArcTimelineDiaryReader/1.0' }
                        });
                        const data = await res.json();
                        const suburb = data.address?.suburb || data.address?.town || 
                                       data.address?.city || data.address?.village || null;
                        
                        if (suburb) {
                            geocodeCache[cacheKey] = suburb;
                            if (!loc.name.includes(suburb)) {
                                loc.name = `${loc.name}, ${suburb}`;
                                updateLocationNameInDOM(locId, loc.name);
                            }
                        }
                    } catch (err) {
                        console.warn('Nominatim geocoding failed:', err);
                    }
                }
            }
            
            // Save cache
            try {
                localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(geocodeCache));
            } catch { }
        }
        
        // Update a location name in the DOM after geocoding
        function updateLocationNameInDOM(locId, newName) {
            const escapedLocId = CSS.escape(locId);
            
            // Update location header
            const section = document.querySelector(`.location-section[data-loc-id="${escapedLocId}"]`);
            if (section) {
                const nameEl = section.querySelector('.location-name');
                if (nameEl) nameEl.textContent = newName;
            }
            
            // Update subtitle header
            const titleEl = document.querySelector('.location-view-title');
            const othersEl = document.querySelector('.location-view-others');
            
            if (locationViewLocations) {
                const names = Object.values(locationViewLocations).map(l => l.name);
                if (titleEl && names[0]) titleEl.textContent = names[0];
                if (othersEl && names.length > 1) othersEl.textContent = names.slice(1).join(', ');
            }
            
            // Update marker tooltip
            const marker = locationMarkers.find(m => m._locId === locId);
            if (marker) {
                const loc = locationViewLocations[locId];
                if (loc) {
                    const visitCount = loc.visits.length;
                    marker.setTooltipContent(`${newName}<br>${visitCount} visit${visitCount !== 1 ? 's' : ''}`);
                }
            }
        }
        
        // Exit location view mode - restore diary state
        function exitLocationViewMode() {
            if (!locationViewMode || !savedDiaryState) return;
            
            locationViewMode = false;
            locationViewLocations = null;
            
            // Clear location view markers
            locationMarkers.forEach(m => map.removeLayer(m));
            locationMarkers = [];
            
            // Remove back button
            document.getElementById('backToDiaryBtn')?.remove();
            
            // Show hidden elements
            document.querySelector('.modal-controls')?.classList.remove('location-view-hidden');
            document.getElementById('diaryNavGroup')?.classList.remove('location-view-hidden');
            document.querySelector('.diary-search')?.classList.remove('location-view-hidden');
            document.querySelector('.diary-checkboxes')?.classList.remove('location-view-hidden');
            document.getElementById('statsFloat')?.classList.remove('location-view-hidden');
            
            // Restore viewport margins for stats panel
            const statsFloatEl = document.getElementById('statsFloat');
            const statsWidth = (statsFloatEl && statsFloatEl.style.display !== 'none') ? (statsFloatEl.offsetWidth || 0) : 0;
            NavigationController.updateViewportMargins({ right: statsWidth }, { delay: 0 });
            
            // Restore map controls (measureBtn was never hidden)
            document.getElementById('mapFilterBtn')?.classList.remove('location-view-hidden');
            document.getElementById('animationBtn')?.classList.remove('location-view-hidden');
            document.getElementById('transparencyBtn')?.classList.remove('location-view-hidden');
            document.getElementById('mapSaveBtn')?.classList.remove('location-view-hidden');
            
            // Restore title
            const diaryTitle = document.getElementById('diaryTitle');
            if (diaryTitle) diaryTitle.textContent = savedDiaryState.diaryTitle;
            
            const diaryBuild = document.getElementById('diaryBuild');
            if (diaryBuild) diaryBuild.textContent = savedDiaryState.diaryBuild;
            
            // Restore diary content
            if (savedDiaryState.monthKey && generatedDiaries[savedDiaryState.monthKey]) {
                // Capture values before async operation (savedDiaryState will be nulled)
                const restoreMonthKey = savedDiaryState.monthKey;
                const restoreDayIndex = savedDiaryState.dayIndex;
                const restoreScrollTop = savedDiaryState.scrollTop;
                
                loadAndDisplayMonth(restoreMonthKey).then(() => {
                    // Restore day selection
                    if (restoreDayIndex >= 0) {
                        currentDayIndex = restoreDayIndex;
                        highlightDay(currentDayIndex);
                    }
                    // Restore scroll position
                    if (markdownContent) {
                        markdownContent.scrollTop = restoreScrollTop;
                    }
                });
            }
            
            savedDiaryState = null;
        }
        
        // Navigate to a specific date from location view (exits location view)
        window.navigateToVisitDate = async function(dayKey, lat, lng, locationName) {
            // Exit location view mode first
            locationViewMode = false;
            locationViewLocations = null;
            
            // Clear location view markers
            locationMarkers.forEach(m => map.removeLayer(m));
            locationMarkers = [];
            
            // Remove back button
            document.getElementById('backToDiaryBtn')?.remove();
            
            // Show hidden elements
            document.querySelector('.modal-controls')?.classList.remove('location-view-hidden');
            document.getElementById('diaryNavGroup')?.classList.remove('location-view-hidden');
            document.querySelector('.diary-search')?.classList.remove('location-view-hidden');
            document.querySelector('.diary-checkboxes')?.classList.remove('location-view-hidden');
            document.getElementById('statsFloat')?.classList.remove('location-view-hidden');
            
            // Restore viewport margins for stats panel
            const statsFloatEl = document.getElementById('statsFloat');
            const statsWidthRestore = (statsFloatEl && statsFloatEl.style.display !== 'none') ? (statsFloatEl.offsetWidth || 0) : 0;
            NavigationController.updateViewportMargins({ right: statsWidthRestore }, { delay: 0 });
            
            // Restore map controls (measureBtn was never hidden)
            document.getElementById('mapFilterBtn')?.classList.remove('location-view-hidden');
            document.getElementById('animationBtn')?.classList.remove('location-view-hidden');
            document.getElementById('transparencyBtn')?.classList.remove('location-view-hidden');
            document.getElementById('mapSaveBtn')?.classList.remove('location-view-hidden');
            
            // Restore title format
            const diaryBuild = document.getElementById('diaryBuild');
            if (diaryBuild && savedDiaryState) {
                diaryBuild.textContent = savedDiaryState.diaryBuild;
            }
            
            savedDiaryState = null;
            
            // Navigate to the date first
            const monthKey = dayKey.substring(0, 7);
            await navigateToDate(monthKey, dayKey);
            
            // Then select the specific location entry if coordinates provided
            if (lat && lng) {
                setTimeout(() => {
                    NavigationController.selectEntryFromMap(lat, lng, dayKey);
                }, 100);
            }
        };
        
        // Zoom to a specific location on the map (stays in location view)
        window.zoomToLocation = function(locId) {
            if (!locationViewLocations || !locationViewLocations[locId]) {
                console.warn('zoomToLocation: location not found', locId);
                return;
            }
            
            const loc = locationViewLocations[locId];
            if (!loc.lat || !loc.lng) {
                console.warn('zoomToLocation: no coordinates', locId);
                return;
            }
            
            // Use NavigationController to zoom to location (respects viewport margins)
            NavigationController.panToLocation(loc.lat, loc.lng, 16, true);
            
            // Highlight this location section in the list (also sets start location for measure tool)
            highlightLocationSection(locId);
        };
        
        // Show only one location on map
        window.showSingleLocation = function(locId) {
            if (!locationViewLocations || !locationViewLocations[locId]) {
                console.warn('showSingleLocation: location not found', locId);
                return;
            }
            
            // Show just this location
            const singleLoc = { [locId]: locationViewLocations[locId] };
            showLocationMarkers(singleLoc, true);
            
            // Highlight this section (also sets start location for measure tool)
            highlightLocationSection(locId);
        };
        
        // Show all locations on map
        window.showAllLocations = function() {
            if (!locationViewLocations) return;
            showLocationMarkers(locationViewLocations, false);
            
            // Clear highlights
            document.querySelectorAll('.location-section.highlighted').forEach(el => {
                el.classList.remove('highlighted');
            });
        };
        
        // Toggle visibility of location visits list
        window.toggleLocationVisits = function(toggleEl, event) {
            event.stopPropagation();
            const section = toggleEl.closest('.location-section');
            if (!section) return;
            
            const visitsList = section.querySelector('.location-visits');
            if (!visitsList) return;
            
            const isCollapsed = visitsList.classList.contains('collapsed');
            if (isCollapsed) {
                visitsList.classList.remove('collapsed');
                toggleEl.classList.add('expanded');
            } else {
                visitsList.classList.add('collapsed');
                toggleEl.classList.remove('expanded');
            }
        };
        
        // Navigate between locations in the list
        window.navigateLocationList = function(direction) {
            const sections = Array.from(document.querySelectorAll('.location-section'));
            if (sections.length === 0) return;
            
            // Find currently highlighted section
            const currentIndex = sections.findIndex(s => s.classList.contains('highlighted'));
            
            let newIndex;
            if (direction === 'first') {
                newIndex = 0;
            } else if (direction === 'last') {
                newIndex = sections.length - 1;
            } else if (currentIndex === -1) {
                // No current selection - start from first or last based on direction
                newIndex = direction > 0 ? 0 : sections.length - 1;
            } else {
                newIndex = currentIndex + direction;
                // Clamp to valid range
                newIndex = Math.max(0, Math.min(sections.length - 1, newIndex));
            }
            
            const targetSection = sections[newIndex];
            if (!targetSection) return;
            
            // Get locId and highlight
            const locId = targetSection.dataset.locId;
            if (locId) {
                highlightLocationSection(locId);
                
                // Scroll section into view
                targetSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                
                // Also pan map to this location
                const lat = parseFloat(targetSection.dataset.lat);
                const lng = parseFloat(targetSection.dataset.lng);
                if (!isNaN(lat) && !isNaN(lng)) {
                    NavigationController.panToLocation(lat, lng, 16, true);
                }
            }
        };
        
        // Toggle visits for the currently highlighted location
        window.toggleCurrentLocationVisits = function() {
            const highlighted = document.querySelector('.location-section.highlighted');
            if (!highlighted) return;
            
            const toggle = highlighted.querySelector('.location-toggle');
            if (toggle) {
                toggleLocationVisits(toggle, { stopPropagation: () => {} });
            }
        };
        
        // Highlight a location section in the list and focus diary
        function highlightLocationSection(locId) {
            // Focus the diary panel using exposed function
            if (typeof window.focusDiary === 'function') {
                window.focusDiary();
            }
            
            // Clear existing highlights
            document.querySelectorAll('.location-section.highlighted').forEach(el => {
                el.classList.remove('highlighted');
            });
            
            // Add highlight to matching section (use CSS.escape for special characters in locId)
            const escapedLocId = CSS.escape(locId);
            const section = document.querySelector(`.location-section[data-loc-id="${escapedLocId}"]`);
            if (section) {
                section.classList.add('highlighted');
                section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
        
        // Highlight a visit row
        function highlightVisitRow(locId, dayKey) {
            // Clear existing highlights
            document.querySelectorAll('.location-visit.highlighted').forEach(el => {
                el.classList.remove('highlighted');
            });
            
            // Add highlight to matching visit (use CSS.escape for special characters)
            const escapedLocId = CSS.escape(locId);
            const visit = document.querySelector(`.location-visit[data-loc-id="${escapedLocId}"][data-date="${dayKey}"]`);
            if (visit) {
                visit.classList.add('highlighted');
                visit.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
        
        // Generate markdown for location visits
        function generateLocationMarkdown(locations) {
            // Build subtitle header: first location large, rest smaller
            const locationNames = Object.values(locations).map(l => l.name);
            const firstLocation = locationNames[0] || '';
            const otherLocations = locationNames.slice(1);
            
            let subtitleHtml;
            if (otherLocations.length === 0) {
                subtitleHtml = `<div class="location-view-title">${firstLocation}</div>`;
            } else {
                const othersText = otherLocations.join(', ');
                subtitleHtml = `
                    <div class="location-view-title">${firstLocation}</div>
                    <div class="location-view-others">${othersText}</div>
                `;
            }
            
            let html = `<div class="location-view-header" onclick="showAllLocations()" title="Click to show all locations">
                ${subtitleHtml}
            </div>`;
            
            for (const [locId, loc] of Object.entries(locations)) {
                const visitCount = loc.visits.length;
                const totalDuration = loc.visits.reduce((sum, v) => sum + (v.duration || 0), 0);
                
                // Escape locId for use in onclick handlers (may contain special characters like |)
                const escapedLocId = locId.replace(/'/g, "\\'").replace(/"/g, '\\"');
                
                // Start collapsed if more than 5 visits
                const startCollapsed = visitCount > 5;
                const collapsedClass = startCollapsed ? 'collapsed' : '';
                const chevronClass = startCollapsed ? '' : 'expanded';
                
                html += `<div class="location-section" data-loc-id="${escapedLocId}" data-lat="${loc.lat}" data-lng="${loc.lng}">`;
                html += `<div class="location-header">`;
                html += `<h2 class="location-name" onclick="showSingleLocation('${escapedLocId}')" title="Click to show only this location">${loc.name}</h2>`;
                html += `</div>`;
                html += `<div class="location-summary">`;
                html += `<span class="location-toggle ${chevronClass}" onclick="toggleLocationVisits(this, event)" title="Click to expand/collapse visits">▶</span>`;
                html += `<span class="location-stats">${visitCount} visit${visitCount !== 1 ? 's' : ''} • ${formatDurationCompact(totalDuration)} total</span>`;
                html += `</div>`;
                html += `<div class="location-visits ${collapsedClass}">`;
                
                for (const visit of loc.visits) {
                    const date = new Date(visit.dayKey + 'T00:00:00');
                    const dateStr = date.toLocaleDateString('en-US', { 
                        weekday: 'short', 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric' 
                    });
                    const timeStr = visit.firstVisit || '';
                    const durationStr = visit.duration ? formatDurationCompact(visit.duration) : '';
                    
                    // Pass dayKey, lat, lng, and location name to navigate function
                    const escapedName = (loc.name || '').replace(/'/g, "\\'");
                    html += `<div class="location-visit" data-loc-id="${escapedLocId}" data-date="${visit.dayKey}" onclick="navigateToVisitDate('${visit.dayKey}', ${loc.lat}, ${loc.lng}, '${escapedName}')" title="Click to view in diary">`;
                    html += `<span class="visit-date">${dateStr}</span>`;
                    if (timeStr) html += `<span class="visit-time">${timeStr}</span>`;
                    if (durationStr) html += `<span class="visit-duration">${durationStr}</span>`;
                    html += `</div>`;
                }
                
                html += `</div></div>`;
            }
            
            return html;
        }
        
        // Format duration compactly
        function formatDurationCompact(seconds) {
            if (!seconds || seconds < 0) return '';
            const hrs = Math.floor(seconds / 3600);
            const mins = Math.round((seconds % 3600) / 60);
            if (hrs === 0) return `${mins}m`;
            if (mins === 0) return `${hrs}h`;
            return `${hrs}h ${mins}m`;
        }
        
        // Show location markers on map
        function showLocationMarkers(locations, isSingleLocation = false) {
            // Clear existing route layers and markers
            clearMapLayers();
            locationMarkers.forEach(m => map.removeLayer(m));
            locationMarkers = [];
            
            const coords = [];
            
            for (const [locId, loc] of Object.entries(locations)) {
                if (!loc.lat || !loc.lng) continue;
                
                coords.push([loc.lat, loc.lng]);
                
                // Create marker
                const marker = L.circleMarker([loc.lat, loc.lng], {
                    radius: 10,
                    fillColor: '#ff3b30',
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 0.9
                }).addTo(map);
                
                // Store locId on marker for reference
                marker._locId = locId;
                locationMarkers.push(marker);
                
                // Add tooltip with name and visit count
                const visitCount = loc.visits.length;
                marker.bindTooltip(`${loc.name}<br>${visitCount} visit${visitCount !== 1 ? 's' : ''}`, {
                    permanent: false,
                    className: 'location-tooltip'
                });
                
                // Click to highlight location in diary list and focus diary
                marker.on('click', (e) => {
                    // Stop the event from propagating
                    L.DomEvent.stopPropagation(e);
                    L.DomEvent.preventDefault(e);
                    
                    // Highlight the location section
                    highlightLocationSection(locId);
                    
                    // Focus diary after a brief delay to override map container's mousedown handler
                    // The mousedown fires before click, so by now the diary might be unfocused
                    setTimeout(() => {
                        if (typeof window.focusDiary === 'function') {
                            window.focusDiary();
                        }
                    }, 0);
                });
            }
            
            // Fit bounds to show all markers using proper padding
            if (coords.length > 0) {
                if (isSingleLocation && coords.length === 1) {
                    // Single location - use NavigationController to center properly
                    NavigationController.panToLocation(coords[0][0], coords[0][1], 16, true);
                } else {
                    // Multiple locations - fit bounds with diary padding
                    const padding = getMapPadding();
                    const bounds = L.latLngBounds(coords);
                    map.fitBounds(bounds, {
                        paddingTopLeft: padding.paddingTopLeft,
                        paddingBottomRight: padding.paddingBottomRight
                    });
                }
            }
        }
        
        // Navigate to a month and show all routes (month map view)
        async function navigateToMonth(monthKey) {
            // Load the month
            await loadAndDisplayMonth(monthKey);
            
            // Clear any day highlights and show month map
            setTimeout(() => {
                currentDayIndex = -1;
                clearDayHighlights();
                showMonthMap();
                
                // Scroll to top to show month title
                markdownContent.scrollTop = 0;
                
                // Show month stats if available
                if (generatedDiaries[monthKey]?.monthData) {
                    const monthStats = calculateMonthlyActivityStats(generatedDiaries[monthKey].monthData);
                    if (monthStats && Object.keys(monthStats).length > 0) {
                        const [year, month] = monthKey.split('-');
                        const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
                        showStatsPanel(monthStats, `${monthName} ${year}`);
                    }
                }
            }, 100);
        }
        
        // Update map padding when slider opens/closes
        function updateMapPaddingForSlider(sliderOpen) {
            const oldSliderWidth = NavigationController.margins?.sliderLeft || 0;
            const newSliderWidth = sliderOpen ? 280 : 0;
            const delta = newSliderWidth - oldSliderWidth;
            
            // Update the margin tracking
            NavigationController.updateViewportMargins(
                { sliderLeft: newSliderWidth },
                { noRefit: true }  // Don't do automatic refit
            );
            
            // Pan map horizontally by half the delta (to keep target centered)
            // Only horizontal adjustment - don't touch vertical
            if (map && delta !== 0) {
                const center = map.getCenter();
                const zoom = map.getZoom();
                const centerPoint = map.project(center, zoom);
                // Shift by delta/2 to keep the visible center stable
                const newCenterPoint = L.point(centerPoint.x - delta / 2, centerPoint.y);
                const newCenter = map.unproject(newCenterPoint, zoom);
                
                setTimeout(() => {
                    map.panTo(newCenter, { animate: true, duration: 0.3 });
                }, sliderOpen ? 50 : 0);  // Small delay when opening to let CSS transition start
            }
        }
        
        // Navigate to search result by index (called from slider)
        async function navigateToSearchResultByIndex(index) {
            if (!window.currentSearchMatches || index < 0 || index >= window.currentSearchMatches.length) return;
            
            // Update active state in slider
            document.querySelectorAll('.search-result-item.active').forEach(el => el.classList.remove('active'));
            const item = document.querySelector(`.search-result-item[data-index="${index}"]`);
            if (item) item.classList.add('active');
            
            await navigateToSearchResult(window.currentSearchMatches[index], window.currentSearchQuery);
        }
        
        // Navigate to a specific search result
        async function navigateToSearchResult(match, query) {
            const dayKey = match.dayKey;
            const monthKey = match.monthKey;
            
            // Tag results: navigate to day directly
            if (match.type === 'tag') {
                navigateToDate(monthKey, dayKey);
                return;
            }

            // If match is in a note and Notes Only is checked, disable it first
            const notesOnly = document.getElementById('notesOnly');
            if (match.inNote && notesOnly && notesOnly.checked) {
                notesOnly.checked = false;
                notesOnly.dispatchEvent(new Event('change'));
                await new Promise(r => setTimeout(r, 100));
            }
            
            // Load month first if needed
            if (currentMonth !== monthKey) {
                await NavigationController.selectMonth(monthKey);
                await new Promise(r => setTimeout(r, 50)); // Brief delay for render
            }
            
            // Use lat/lng for navigation if available (works for visits)
            if (match.lat && match.lng) {
                NavigationController.selectEntryFromMap(match.lat, match.lng, dayKey);
                // Show on map
                showDayMap(dayKey, match.lat, match.lng);
            } else {
                // For activities without lat/lng, find by startTime
                const entries = getLocationsInCurrentMonth();
                let foundEntry = null;
                let foundIndex = -1;
                
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    const locData = entry.querySelector('.location-data');
                    if (locData && locData.dataset.daykey === dayKey) {
                        // Match by start date
                        const entryStartDate = locData.dataset.startDate;
                        if (entryStartDate && match.startTime && entryStartDate === match.startTime) {
                            foundEntry = entry;
                            foundIndex = i;
                            break;
                        }
                    }
                }
                
                if (foundEntry) {
                    // Highlight and scroll to entry
                    currentLocationIndex = foundIndex;
                    clearDiaryHighlights();
                    clearDayHighlights();
                    foundEntry.classList.add('diary-highlight');
                    foundEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    
                    // Show activity route on map
                    if (match.type === 'activity' && match.startTime) {
                        showActivityRoutePopup(dayKey, new Date(match.startTime).getTime());
                    } else {
                        showDayMap(dayKey, null, null);
                    }
                } else {
                    // Last resort: navigate to day
                    await NavigationController.selectEntry(null, dayKey, { source: 'search' });
                    showDayMap(dayKey, null, null);
                }
            }
        }
        
        // Highlight search query in current content
        function highlightQueryInContent(query) {
            if (!query || query.length < 2) return;
            
            // Store original if not already stored
            if (!originalContent) {
                originalContent = markdownContent.innerHTML;
            }
            
            const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            
            // Walk text nodes and highlight
            const walker = document.createTreeWalker(
                markdownContent,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function(node) {
                        const parent = node.parentElement;
                        if (parent && (
                            parent.style.display === 'none' ||
                            parent.classList.contains('location-data') ||
                            parent.tagName === 'SCRIPT' ||
                            parent.tagName === 'STYLE' ||
                            parent.classList.contains('search-highlight')
                        )) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            
            const nodesToReplace = [];
            let node;
            while (node = walker.nextNode()) {
                if (regex.test(node.textContent)) {
                    nodesToReplace.push(node);
                }
                regex.lastIndex = 0;
            }
            
            for (const textNode of nodesToReplace) {
                const fragment = buildHighlightedFragment(textNode.textContent, regex, 'search-highlight', 'mark');
                textNode.parentNode.replaceChild(fragment, textNode);
            }
            
            attachDiaryClickHandlers();
        }
        
        // Old function - kept for compatibility but modified
        async function navigateToSearchMatch(index) {
            // Legacy - redirect to new system
            if (window.currentSearchMatches && window.currentSearchMatches[index]) {
                await navigateToSearchResultByIndex(index);
            }
        }
        
        function highlightMatchesInCurrentMonth() {
            if (!searchInput.value || searchInput.value.length < 2) return;
            
            if (originalContent) {
                markdownContent.innerHTML = originalContent;
            } else {
                return;
            }
            
            const regex = new RegExp(searchInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            
            const walker = document.createTreeWalker(
                markdownContent,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function(node) {
                        // Skip hidden elements
                        const parent = node.parentElement;
                        if (parent && (
                            parent.style.display === 'none' ||
                            parent.classList.contains('location-data')
                        )) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            
            const nodesToReplace = [];
            let node;
            
            while (node = walker.nextNode()) {
                if (node.textContent.match(regex)) {
                    nodesToReplace.push(node);
                }
            }
            
            nodesToReplace.forEach(node => {
                const fragment = buildHighlightedFragment(node.textContent, regex, 'search-highlight', 'span');
                node.parentNode.replaceChild(fragment, node);
            });
            
            currentMonthMatches = Array.from(markdownContent.querySelectorAll('.search-highlight'));
            
            // Re-add event listeners (use shared function to avoid duplication)
            attachDiaryClickHandlers();

            let globalMatchesBeforeThisMonth = 0;
            const monthMatchCount = new Map();
            for (const match of allSearchMatches) {
                monthMatchCount.set(match.monthKey, (monthMatchCount.get(match.monthKey) || 0) + 1);
            }
            for (let i = 0; i < monthKeys.length; i++) {
                if (monthKeys[i] === currentMonth) break;
                globalMatchesBeforeThisMonth += monthMatchCount.get(monthKeys[i]) || 0;
            }
            
            const localIndex = currentSearchIndex - globalMatchesBeforeThisMonth;
            
            if (localIndex >= 0 && localIndex < currentMonthMatches.length) {
                currentMonthMatches.forEach((el, idx) => {
                    if (idx === localIndex) {
                        el.classList.remove('search-highlight');
                        el.classList.add('search-highlight-current');
                    }
                });
                
                const currentHighlight = currentMonthMatches[localIndex];
                currentHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Update map to show the location of the search match
                const listItem = currentHighlight.closest('li');
                if (listItem) {
                    const locationData = listItem.querySelector('.location-data');
                    if (locationData) {
                        // Found a location - show it on the map
                        const lat = parseFloat(locationData.dataset.lat);
                        const lng = parseFloat(locationData.dataset.lng);
                        const dayKey = locationData.dataset.daykey;
                        if (!isNaN(lat) && !isNaN(lng) && dayKey) {
                            showDayMap(dayKey, lat, lng);
                        }
                    }
                } else {
                    // Not in a location list item - try to find the day context
                    const dayMapTitle = currentHighlight.closest('.markdown-body').querySelector('.day-map-title[data-day]');
                    if (dayMapTitle) {
                        const dayKey = dayMapTitle.dataset.day;
                        if (dayKey) {
                            showDayMap(dayKey);
                        }
                    }
                }
            }
        }
        
        function navigateSearch(direction) {
            // Navigate through results in the slider
            if (!window.currentSearchMatches || window.currentSearchMatches.length === 0) return;
            
            currentSearchIndex += direction;
            
            if (currentSearchIndex >= window.currentSearchMatches.length) {
                currentSearchIndex = 0;
            } else if (currentSearchIndex < 0) {
                currentSearchIndex = window.currentSearchMatches.length - 1;
            }
            
            navigateToSearchResultByIndex(currentSearchIndex);
        }
        
        function clearSearch() {
            searchInput.value = '';
            clearSearchHighlights();
            allSearchMatches = [];
            window.currentSearchMatches = null;
            window.currentSearchQuery = null;
            window.lastSearchQuery = null; // Clear cache
            currentSearchIndex = -1;
            searchCount.textContent = '';
            
            // Hide new UI elements
            const findBtn = document.getElementById('findBtn');
            const clearSearchBtn = document.getElementById('clearSearchBtn');
            const prevSearchBtn = document.getElementById('prevSearchBtn');
            const nextSearchBtn = document.getElementById('nextSearchBtn');
            
            if (findBtn) findBtn.style.display = 'none';
            if (clearSearchBtn) clearSearchBtn.style.display = 'none';
            if (prevSearchBtn) prevSearchBtn.style.display = 'none';
            if (nextSearchBtn) nextSearchBtn.style.display = 'none';
            
            // Close slider
            closeSearchResults();
            
            hideSearchDropdown();
        }
        
        function clearSearchHighlights() {
            if (originalContent) {
                markdownContent.innerHTML = originalContent;
            }
            currentMonthMatches = [];
        }
        
        // Favorites dropdown functions
        let dropdownHideTimeout = null;
        
        function showSearchDropdown() {
            if (dropdownHideTimeout) {
                clearTimeout(dropdownHideTimeout);
                dropdownHideTimeout = null;
            }
            
            const dropdown = document.getElementById('searchDropdown');
            const searchValue = searchInput.value.trim();
            
            // Show favorites if search is empty or starts with star
            if (!searchValue || searchValue.startsWith('⭐')) {
                populateFavoritesList();
                dropdown.style.display = 'block';
                searchDropdownVisible = true;
            }
        }
        
        function hideSearchDropdownDelayed() {
            // Delay hiding to allow clicking on dropdown items
            dropdownHideTimeout = setTimeout(() => {
                hideSearchDropdown();
            }, 200);
        }
        
        function hideSearchDropdown() {
            const dropdown = document.getElementById('searchDropdown');
            dropdown.style.display = 'none';
            searchDropdownVisible = false;
        }
        
        function populateFavoritesList() {
            const favoritesList = document.getElementById('favoritesList');
            
            if (favorites.length === 0) {
                favoritesList.innerHTML = '<div class="search-dropdown-empty">No favorites yet. Star locations on the map to add them!</div>';
                return;
            }
            
            favoritesList.innerHTML = '';
            
            for (const fav of favorites) {
                const item = document.createElement('div');
                item.className = 'search-dropdown-item';
                item.onmousedown = (e) => {
                    e.preventDefault(); // Prevent input blur
                    jumpToFavorite(fav);
                };
                
                const content = document.createElement('div');
                content.style.flex = '1';
                
                const name = document.createElement('span');
                name.className = 'search-dropdown-item-name';
                name.textContent = fav.name;
                content.appendChild(name);
                
                if (fav.altitude !== null && fav.altitude !== undefined) {
                    const meta = document.createElement('span');
                    meta.className = 'search-dropdown-item-meta';
                    meta.textContent = `(${Math.round(fav.altitude)}m)`;
                    content.appendChild(meta);
                }
                
                const removeBtn = document.createElement('span');
                removeBtn.className = 'search-dropdown-item-remove';
                removeBtn.textContent = '✕';
                removeBtn.title = 'Remove favorite';
                removeBtn.onmousedown = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeFavorite(fav.lat, fav.lng);
                    populateFavoritesList();
                };
                
                item.appendChild(content);
                item.appendChild(removeBtn);
                favoritesList.appendChild(item);
            }
        }
        
        async function jumpToFavorite(fav) {
            logDebug(`⭐ Jumping to favorite: ${fav.name} (${fav.monthKey}, ${fav.dayKey})`);
            hideSearchDropdown();
            
            // Blur search input so keyboard navigation works
            if (searchInput) {
                searchInput.blur();
            }
            
            // Show loading indicator
            const searchCount = document.getElementById('searchCount');
            const originalText = searchCount.textContent;
            
            try {
                // If old favorite without month/day, search for it once and update
                if (!fav.monthKey || !fav.dayKey) {
                    logDebug(`🔍 Old favorite without location data, searching to update...`);
                    searchCount.textContent = 'Updating favorite...';
                    
                    // Search recent months first (most likely location)
                    for (let i = monthKeys.length - 1; i >= 0; i--) {
                        const monthKey = monthKeys[i];
                        const dayRecords = await getMonthDaysFromDB(monthKey);
                        
                        for (const dayRecord of dayRecords) {
                            const data = dayRecord.data;
                            if (!data || !data.timelineItems) continue;
                            
                            for (const item of data.timelineItems) {
                                if (!item.isVisit) continue;
                                
                                const lat = item.center?.latitude;
                                const lng = item.center?.longitude;
                                
                                if (!lat || !lng) continue;
                                
                                if (Math.abs(lat - fav.lat) < 0.0001 && Math.abs(lng - fav.lng) < 0.0001) {
                                    // Found it! Update the favorite
                                    fav.monthKey = dayRecord.monthKey;
                                    fav.dayKey = dayRecord.dayKey;
                                    saveFavorites();
                                    logDebug(`✅ Updated favorite with location: ${fav.monthKey}, ${fav.dayKey}`);
                                    
                                    // Ensure modal is open
                                    if (modalOverlay.style.display !== 'block') {
                                        await openDiaryReader(true);
                                        await new Promise(resolve => setTimeout(resolve, 150));
                                    }
                                    
                                    // Jump via NavigationController
                                    const entryId = `${fav.lat},${fav.lng}`;
                                    await NavigationController.selectEntry(entryId, fav.dayKey, {
                                        source: 'favorite',
                                        type: 'location',
                                        lat: fav.lat,
                                        lng: fav.lng
                                    });
                                    
                                    searchCount.textContent = originalText;
                                    return;
                                }
                            }
                        }
                        
                        // Update progress
                        searchCount.textContent = `Searching ${monthKeys.length - i}/${monthKeys.length}...`;
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                    
                    // Not found
                    searchCount.textContent = originalText;
                    alert(`"${fav.name}" not found. It may have been removed from Arc Timeline data. Try removing and re-favoriting it.`);
                    return;
                }
                
                // Favorite has month/day - jump directly via NavigationController
                searchCount.textContent = 'Loading...';
                
                // Ensure modal is open
                if (modalOverlay.style.display !== 'block') {
                    await openDiaryReader(true);
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
                
                // Single entry point for navigation
                const entryId = `${fav.lat},${fav.lng}`;
                await NavigationController.selectEntry(entryId, fav.dayKey, {
                    source: 'favorite',
                    type: 'location',
                    lat: fav.lat,
                    lng: fav.lng
                });
                
                searchCount.textContent = originalText;
                
            } catch (error) {
                searchCount.textContent = originalText;
                logError('Error in jumpToFavorite:', error);
                alert('Error jumping to favorite location.');
            }
        }
        
        // Toggle favorite from map popup (called via onclick in HTML)
        function toggleFavoriteFromPopup(name, lat, lng, altitude) {
            // Pass current month and day context when favoriting
            const wasAdded = toggleFavorite(name, lat, lng, altitude, currentMonth, currentDayKey);
            
            // Refresh the map to update star icons
            if (mapMode === 'day' && currentDayKey) {
                showDayMap(currentDayKey);
            } else if (mapMode === 'month') {
                showMonthMap();
            }
            
            logDebug(`⭐ ${wasAdded ? 'Added' : 'Removed'} favorite: ${name} (${currentMonth}, ${currentDayKey})`);
        }
        
        function showStatsPanel(stats, title) {
            // Record when stats panel is shown to prevent accidental tile clicks
            lastStatsPanelShowTime = Date.now();
            
            const statsFloat = document.getElementById('statsFloat');
            const statsTitle = document.getElementById('statsTitle');
            const statsTiles = document.getElementById('statsTiles');
            
            if (!statsFloat || !statsTitle || !statsTiles) return;
            if (!stats || Object.keys(stats).length === 0) return;
            
            // Update transparency based on current map style
            updateStatsTransparency();
            
            // Set title with intelligent line breaking for day names
            // If title contains comma (e.g., "Thursday, December 4"), split it for better wrapping
            if (title.includes(',')) {
                const parts = title.split(',');
                statsTitle.innerHTML = parts[0] + ',<br>' + parts.slice(1).join(',').trim();
            } else {
                statsTitle.textContent = title;
            }
            
            // Clear existing tiles
            statsTiles.innerHTML = '';
            
            // Sort activities
            const sortedActivities = Object.keys(stats).sort((a, b) => {
                const order = ['walking', 'cycling', 'car', 'automotive', 'airplane', 'boat', 'train', 'bus'];
                const indexA = order.indexOf(a);
                const indexB = order.indexOf(b);
                if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                if (indexA !== -1) return -1;
                if (indexB !== -1) return 1;
                return a.localeCompare(b);
            });
            
            // Create tiles
            for (const activityType of sortedActivities) {
                const stat = stats[activityType];
                const icon = getActivityIcon(activityType);
                const color = getActivityColor(activityType);
                
                const distanceStr = formatDistance(stat.distance);
                const durationStr = formatDuration(stat.duration);
                const elevationStr = stat.elevationGain > 0 ? `↑ ${Math.round(stat.elevationGain)}m` : null;
                
                // Skip if no distance (only show activities with movement)
                if (!distanceStr) continue;
                
                const tile = document.createElement('div');
                tile.className = 'stats-tile';
                tile.style.background = color;
                tile.dataset.activity = activityType;  // Store activity type for click handler
                
                // Distance is primary (large), duration is secondary (smaller)
                tile.innerHTML = `
                    <div class="stats-tile-header">
                        <span class="stats-tile-icon">${icon}</span>
                        <span class="stats-tile-name">${capitalize(activityType)}</span>
                    </div>
                    ${distanceStr ? `<div class="stats-tile-distance">${distanceStr}</div>` : ''}
                    ${durationStr ? `<div class="stats-tile-duration">${durationStr}</div>` : ''}
                    ${elevationStr ? `<div class="stats-tile-elevation">${elevationStr}</div>` : ''}
                `;
                
                // Add click handler to filter routes by this activity
                tile.addEventListener('click', (e) => {
                    filterToActivity(activityType, e);
                });
                
                statsTiles.appendChild(tile);
            }
            
            // Show panel
            statsFloat.style.display = 'flex';
            
            // Update NavigationController with stats panel width after it's visible
            setTimeout(() => {
                const statsWidth = statsFloat.offsetWidth || 0;
                NavigationController.updateViewportMargins({ right: statsWidth }, { delay: 0 });
                
                // Reposition replay controller if visible
                const replayControllerEl = document.getElementById('replayController');
                if (replayControllerEl && replayControllerEl.style.display === 'flex') {
                    if (window.positionReplayController) window.positionReplayController();
                }
            }, 50);
        }

        function updateStatsTransparency() {
            const statsFloat = document.getElementById('statsFloat');
            if (!statsFloat) return;
            
            // Use the same opacity as the diary's unfocused state
            const diaryFloat = document.querySelector('.diary-float');
            if (diaryFloat) {
                const opacity = parseFloat(diaryFloat.dataset.unfocusedOpacity) || 0.05;
                statsFloat.style.background = `rgba(255, 255, 255, ${opacity})`;
            }
        }
        
        function updateStatsForCurrentView() {
            // Use NavigationController's authoritative dayKey instead of legacy currentDayIndex
            const selectedDayKey = NavigationController.dayKey;
            
            if (selectedDayKey) {
                // Show day stats for the selected day
                const monthKey = selectedDayKey.substring(0, 7);
                
                if (generatedDiaries[monthKey]?.monthData?.days?.[selectedDayKey]) {
                    const dayData = generatedDiaries[monthKey].monthData.days[selectedDayKey];
                    
                    // Get filtered notes (respects "Notes only" checkbox)
                    const notesOnly = document.getElementById('notesOnly')?.checked ?? false;
                    const includeAll = !notesOnly;
                    const visibleNotes = getFilteredNotesForDay(dayData, includeAll, includeAll);
                    
                    // When "Notes only" is checked, show month stats if day has no visible notes
                    if (notesOnly && visibleNotes.length === 0) {
                        showMonthStatsForCurrent();
                        return;
                    }
                    
                    const dayStats = calculateDailyActivityStats(visibleNotes);
                    
                    if (dayStats && Object.keys(dayStats).length > 0) {
                        const date = new Date(selectedDayKey);
                        const dayName = date.toLocaleDateString('en-US', { 
                            weekday: 'long', 
                            month: 'long', 
                            day: 'numeric',
                            year: 'numeric'
                        });
                        showStatsPanel(dayStats, dayName);
                    } else {
                        // No stats for this day, show month stats instead
                        showMonthStatsForCurrent();
                    }
                } else {
                    // No day data, show month stats instead
                    showMonthStatsForCurrent();
                }
            } else {
                // No day selected, show month stats
                showMonthStatsForCurrent();
            }
        }
        
        function showMonthStatsForCurrent() {
            if (!currentMonth) return;
            
            if (generatedDiaries[currentMonth]?.monthData) {
                const monthStats = calculateMonthlyActivityStats(generatedDiaries[currentMonth].monthData);
                
                if (monthStats && Object.keys(monthStats).length > 0) {
                    const [year, month] = currentMonth.split('-');
                    const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
                    showStatsPanel(monthStats, `${monthName} ${year}`);
                }
            }
        }
        
        function closeStatsPanel() {
            const statsFloat = document.getElementById('statsFloat');
            if (statsFloat) {
                statsFloat.style.display = 'none';
                // Update NavigationController to remove stats panel margin
                NavigationController.updateViewportMargins({ right: 0 }, { delay: 0 });
                
                // Reposition replay controller if visible
                setTimeout(() => {
                    const replayControllerEl = document.getElementById('replayController');
                    if (replayControllerEl && replayControllerEl.style.display === 'flex') {
                        if (window.positionReplayController) window.positionReplayController();
                    }
                }, 50);
            }
        }

        function capitalize(str) {
            return str.charAt(0).toUpperCase() + str.slice(1);
        }
        
		  function generateMarkdown(monthData, includeAllLocations = false, includeAllActivities = true) {

            const [year, month] = monthData.month.split('-');
            const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
            
            const daysWithData = Object.keys(monthData.days).sort();
            
            // Also include empty days (days with DB records but no content)
            const emptyDays = monthData.emptyDays ? Array.from(monthData.emptyDays).sort() : [];
            
            // Combine for range calculation
            const allKnownDays = [...new Set([...daysWithData, ...emptyDays])].sort();
            
            // If no days with data or empty records, return just the header
            if (allKnownDays.length === 0) {
                return `# <span class="month-map-title" data-month="${monthData.month}" title="Click to show month statistics" style="cursor:pointer;">${monthName} ${year}</span>\n\n`;
            }
            
            const allDays = new Set();
            
            // Add all days with data (these will always be shown)
            daysWithData.forEach(d => allDays.add(d));
            // Also add empty days (with DB records but no content)
            emptyDays.forEach(d => allDays.add(d));
            
            // Only add missing day placeholders when showing all locations (not "Notes Only" mode)
            // Missing days are visual noise when filtering to just notes
            let missingDaysCount = 0;
            if (includeAllLocations) {
                // Generate all days from first to last known day
                // But cap at today's date for missing placeholders - don't show future days as "missing"
                const firstDay = allKnownDays[0];
                const lastKnownDay = allKnownDays[allKnownDays.length - 1];
                const today = new Date().toISOString().split('T')[0];
                
                // Add missing day placeholders only between first day and min(lastKnownDay, today)
                const lastDayForPlaceholders = lastKnownDay > today ? today : lastKnownDay;
                
                if (firstDay <= lastDayForPlaceholders) {
                    let currentDate = new Date(firstDay);
                    const endDate = new Date(lastDayForPlaceholders);
                    
                    while (currentDate <= endDate) {
                        allDays.add(currentDate.toISOString().split('T')[0]);
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }
                
                // Count missing days (days without data)
                missingDaysCount = Array.from(allDays).filter(d => !monthData.days[d]).length;
            }
            
            // Convert to sorted array
            const sortedDays = Array.from(allDays).sort();
            
            // Build month heading with optional missing days note
            let missingNote = '';
            if (missingDaysCount > 0) {
                const dayWord = missingDaysCount === 1 ? 'day' : 'days';
                missingNote = ` <span class="missing-days-note">${missingDaysCount} ${dayWord} missing</span>`;
            }
            
            let md = `# <span class="month-map-title" data-month="${monthData.month}" title="Click to show month statistics" style="cursor:pointer;">${monthName} ${year}</span>${missingNote}\n\n`;
            
            for (const day of sortedDays) {
                const dayData = monthData.days[day];
                const date = new Date(day);
                const fullDayName = date.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
                
                // If no data for this day, insert a placeholder (only in "show all" mode)
                if (!dayData) {
                    // This shouldn't happen in Notes Only mode since we don't add missing days
                    // But safeguard anyway
                    if (!includeAllLocations) {
                        continue;
                    }
                    // Check if this day has a DB record but no content (Arc crashed/nothing recorded)
                    const isEmptyDay = monthData.emptyDays?.has(day);
                    if (isEmptyDay) {
                        md += `## <span class="day-title-missing" data-day="${day}">${fullDayName}</span>\n\n`;
                        md += `*No data was recorded on this day*\n\n`;
                    } else {
                        md += `## <span class="day-title-missing" data-day="${day}">${fullDayName}</span>\n\n`;
                    }
                    continue;
                }
                
                // 1. Sort chronological first
                dayData.notes.sort((a, b) => new Date(a.date) - new Date(b.date));

                // 2. Filter items based on checkboxes
                // Separate filtering for locations (visits) and activities (routes)
                let visibleNotes = dayData.notes.filter(note => {
                    if (note.isVisit) {
                        // Location/visit filtering - only apply includeAllLocations
                        if (includeAllLocations) return true;
                        return (note.body && note.body.trim().length > 0);
                    } else {
                        // Activity/route filtering - apply both filters
                        // First check if activities should be shown at all
                        if (!includeAllActivities) {
                            // Only show activities with notes
                            return (note.body && note.body.trim().length > 0);
                        }
                        // If includeAllActivities is true, show all activities
                        return true;
                    }
                });
                
                // 3. Filter out activities that are inside location GPS radius
                // Get all visits (locations) with radius for this day
                const locationVisits = visibleNotes.filter(n => n.isVisit && n.radiusMeters && n.latitude && n.longitude);
                const MAX_VISIT_FILTER_RADIUS_M = 150; // Prevent oversized place radii from swallowing real trips
                
                if (locationVisits.length > 0) {
                    visibleNotes = visibleNotes.filter(note => {
                        // Keep all visits
                        if (note.isVisit) return true;
                        
                        // For activities, check if they're inside any location's radius
                        if (!note.latitude || !note.longitude) return true; // Keep if no coordinates

                        // Never suppress motorized/long-distance trips by visit radius.
                        const activityType = getActivityFilterType(note.activityType || '');
                        if (['car', 'bus', 'train', 'motorcycle', 'boat', 'airplane'].includes(activityType)) {
                            return true;
                        }
                        
                        // Check if activity is inside any location's radius
                        for (const visit of locationVisits) {
                            const distance = calculateDistance(
                                note.latitude, note.longitude,
                                visit.latitude, visit.longitude
                            );
                            const effectiveRadius = Math.min(Math.max(Number(visit.radiusMeters) || 50, 1), MAX_VISIT_FILTER_RADIUS_M);

                            // If activity distance is materially larger than radius, keep it.
                            if ((note.distance || 0) > effectiveRadius * 2) {
                                continue;
                            }
                            
                            // If activity is inside this location's radius, exclude it
                            if (distance <= effectiveRadius) {
                                return false;
                            }
                        }
                        
                        return true; // Keep activity if not inside any location
                    });
                }

                // Final display pass: collapse consecutive visits to the same location label.
                // This prevents duplicate adjacent location bullets after filtering/suppression.
                if (visibleNotes.length > 1) {
                    const collapsedNotes = [];
                    for (const note of visibleNotes) {
                        const prev = collapsedNotes.length > 0 ? collapsedNotes[collapsedNotes.length - 1] : null;
                        const canMerge =
                            prev &&
                            prev.isVisit &&
                            note.isVisit &&
                            String(prev.location || '').trim().toLowerCase() === String(note.location || '').trim().toLowerCase();

                        if (canMerge) {
                            const prevStartMs = prev.startDate ? new Date(prev.startDate).getTime() : null;
                            const prevEndMs = prev.endDate ? new Date(prev.endDate).getTime() : null;
                            const noteStartMs = note.startDate ? new Date(note.startDate).getTime() : null;
                            const noteEndMs = note.endDate ? new Date(note.endDate).getTime() : null;
                            const mergedStartMs = [prevStartMs, noteStartMs].filter(v => Number.isFinite(v)).reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
                            const mergedEndMs = [prevEndMs, noteEndMs].filter(v => Number.isFinite(v)).reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);

                            if (Number.isFinite(mergedStartMs)) prev.startDate = new Date(mergedStartMs).toISOString();
                            if (Number.isFinite(mergedEndMs)) prev.endDate = new Date(mergedEndMs).toISOString();
                            if (Number.isFinite(mergedStartMs) && Number.isFinite(mergedEndMs) && mergedEndMs >= mergedStartMs) {
                                prev.duration = (mergedEndMs - mergedStartMs) / 1000;
                            } else if ((prev.duration || 0) > 0 || (note.duration || 0) > 0) {
                                prev.duration = (prev.duration || 0) + (note.duration || 0);
                            }

                            const prevCount = (prev._mergedCount && prev._mergedCount > 1) ? prev._mergedCount : 1;
                            const noteCount = (note._mergedCount && note._mergedCount > 1) ? note._mergedCount : 1;
                            const totalCount = prevCount + noteCount;
                            if (totalCount > 1) {
                                prev._hasCollapsedSegments = true;
                                prev._mergedCount = totalCount;
                            }
                            prev._suppressedCount = (prev._suppressedCount || 0) + (note._suppressedCount || 0);

                            if (!prev.body && note.body) prev.body = note.body;
                            continue;
                        }

                        collapsedNotes.push(note);
                    }
                    visibleNotes = collapsedNotes;
                }

                // 3. If no items remain after filtering, skip day or show as missing
                if (visibleNotes.length === 0) {
                    // In "Notes Only" mode, just skip days without notes entirely
                    if (!includeAllLocations) {
                        continue;
                    }
                    // Otherwise show as missing day placeholder
                    md += `## <span class="day-title-missing" data-day="${day}">${fullDayName}</span>\n\n`;
                    continue;
                }

                // Check for locations - DB path uses 'locations', folder path uses 'pins'
                const dayHasLocations = (dayData.locations || dayData.pins || []).length > 0;
                const dayHasRoute = (dayData.tracks || []).length > 0;
                
                // Check if this day was added or updated in last import
                let importTag = '';
                if (importAddedDays.includes(day)) {
                    importTag = ' <span class="import-tag import-added" title="Added in last import">NEW</span>';
                } else if (importUpdatedDays.includes(day)) {
                    importTag = ' <span class="import-tag import-updated" title="Updated in last import">UPDATED</span>';
                }

                // Check if this day is part of any event
                let eventTag = '';
                const dayEvents = getEventsForDay(day);
                if (dayEvents.length > 0) {
                    const eventNames = dayEvents.map(e => e.name).join(', ');
                    const eventColor = dayEvents[0].color || '#9C27B0';
                    eventTag = ` <span class="import-tag event-tag" style="background: ${eventColor};" title="${escapeHtml(eventNames)}" onclick="openEventSlider('${dayEvents[0].eventId}')" data-event-id="${dayEvents[0].eventId}">EVENT</span>`;
                }

                if (dayHasLocations || dayHasRoute) {
                    md += `## <span class="day-map-title" data-day="${day}" title="Click to show day statistics" style="cursor:pointer;">${fullDayName}</span>${importTag}${eventTag}\n\n`;
                } else {
                    md += `## ${fullDayName}${importTag}${eventTag}\n\n`;
                }
                
                for (const note of visibleNotes) {
                    let bulletHeader = `${formatTime(note.date)}`;
                    
                    // Add location/activity name
                    bulletHeader += ` ${note.location}`;
                    
                    // Add altitude if available (for visits/locations)
                    if (note.isVisit && note.altitude !== null && note.altitude !== undefined) {
                        bulletHeader += ` (${Math.round(note.altitude)}m)`;
                    }
                    
                    const metrics = [];
                    if (note.isVisit && note.duration) {
                        // For visits: show duration only (how long they stayed)
                        const durationStr = formatDuration(note.duration);
                        if (durationStr) metrics.push(durationStr);
                    } else if (!note.isVisit) {
                        // For routes/activities: show distance, duration, and average speed
                        if (note.distance) {
                            const distanceStr = formatDistance(note.distance);
                            if (distanceStr) metrics.push(distanceStr);
                        }
                        if (note.duration) {
                            const durationStr = formatDuration(note.duration);
                            if (durationStr) metrics.push(durationStr);
                        }
                        // Calculate and show average speed (helps identify misclassified activities)
                        if (note.distance && note.duration && note.duration > 0) {
                            const speedKph = (note.distance / 1000) / (note.duration / 3600);
                            if (speedKph >= 0.1) {
                                metrics.push(`${speedKph.toFixed(1)} km/h`);
                            }
                        }
                    }
                    
                    if (metrics.length > 0) {
                        bulletHeader += ` • ${metrics.join(' • ')}`;
                    }
                    
                    // Only bold for visits (locations), not for activities
                    if (note.isVisit) {
                        bulletHeader = `**${bulletHeader}**`;
                    } else if (note.activityType) {
                        // For activities (routes), wrap entire line in color
                        const activityType = getActivityFilterType(note.activityType);
                        const color = getActivityColor(activityType);
                        bulletHeader = `<span style="color: ${color};">${bulletHeader}</span>`;
                    }
                    
                    if (note.latitude && note.longitude) {
                        const escapedLocation = note.location.replace(/"/g, '&quot;').replace(/'/g, "\\'");
                        // Create stable placeId from Arc's placeId or fallback to lat_lng
                        const placeId = note.placeId || `${note.latitude}_${note.longitude}`;
                        // Added data-daykey="${day}" and data-start-date/data-end-date for activities
                        const startDateAttr = note.startDate ? ` data-start-date="${note.startDate}"` : '';
                        const endDateAttr = note.endDate ? ` data-end-date="${note.endDate}"` : '';
                        const isVisitAttr = note.isVisit ? ' data-is-visit="true"' : '';
                        const typeAttr = note.isVisit ? '' : ' data-type="activity"';
                        const activityTypeAttr = note.activityType ? ` data-activity-type="${note.activityType}"` : '';
                        bulletHeader += `<span class="location-data" data-daykey="${day}" data-lat="${note.latitude}" data-lng="${note.longitude}" data-place-id="${placeId}" data-location="${escapedLocation}" data-date="${note.date}"${startDateAttr}${endDateAttr}${isVisitAttr}${typeAttr}${activityTypeAttr} style="display:none;"></span>`;
                        
                        // Show coalescing indicator when items were merged
                        if (note._hasCollapsedSegments && note._mergedCount > 1) {
                            bulletHeader += ` <span class="diary-tag diary-tag-merged" title="${note._mergedCount} visits merged">×${note._mergedCount}</span>`;
                        }
                        
                        // Show NO GPS tag for data gaps
                        if (note._dataGap) {
                            bulletHeader += ` <span class="diary-tag diary-tag-no-gps">NO GPS</span>`;
                        }
                    } else if (!note.isVisit && note.startDate) {
                        // For activities without coordinates, still add location-data with startDate for matching
                        const escapedLocation = note.location.replace(/"/g, '&quot;').replace(/'/g, "\\'");
                        // Create placeId from activity start time for activities without coordinates
                        const placeId = `activity_${note.startDate}`;
                        const activityTypeAttr = note.activityType ? ` data-activity-type="${note.activityType}"` : '';
                        const endDateAttr = note.endDate ? ` data-end-date="${note.endDate}"` : '';
                        bulletHeader += `<span class="location-data" data-daykey="${day}" data-place-id="${placeId}" data-location="${escapedLocation}" data-date="${note.date}" data-start-date="${note.startDate}"${endDateAttr} data-type="activity"${activityTypeAttr} data-no-gps="true" style="display:none;"></span>`;
                        // Add "No GPS" label for entries without map coordinates (with leading space)
                        bulletHeader += ` <span class="diary-tag diary-tag-no-gps">No GPS</span>`;
                    }
                    
                    const noteBody = note.body || '';

                    // Mark changed items - the li:has(.item-changed) selector will color the bullet
                    const isChanged = note.timelineItemId && importChangedItemIds.has(note.timelineItemId);
                    const changeMarker = isChanged ? '<span class="item-changed"></span>' : '';

                    if (noteBody.trim() === '') {
                        // Just header (Location info), no body
                        md += `- ${changeMarker}${bulletHeader}\n`;
                    } else {
                        // Header + Body
                        const lines = noteBody.split('\n');
                        if (lines.length > 1) {
                            const firstLine = lines[0];
                            const continuationLines = lines.slice(1).map(line => {
                                return line.trim() === '' ? '' : '  ' + line;
                            });
                            const indentedBody = [firstLine, ...continuationLines].join('\n');
                            md += `- ${changeMarker}${bulletHeader} ${indentedBody}\n`;
                        } else {
                            md += `- ${changeMarker}${bulletHeader} ${noteBody}\n`;
                        }
                    }
                }
                
                md += `\n`;
            }
            
            return md;
        }
                        
        // Initialize IndexedDB and auto-load on page startup (v3.0)
        (async function initializeApp() {
            try {
                // Hide any leftover progress indicators
                const progress = document.getElementById('progress');
                const cancelBtn = document.getElementById('cancelBtn');
                if (progress) progress.style.display = 'none';
                if (cancelBtn) cancelBtn.style.display = 'none';

                // Show loading indicator
                const dbStatusSection = document.getElementById('dbStatusSection');
                const fileInputSection = document.getElementById('fileInputSection');
                const dbLoadingBar = document.getElementById('dbLoadingBar');
                const dbStats = document.getElementById('dbStats');

                // Show temporary loading state with animated bar
                if (dbStatusSection) dbStatusSection.style.display = 'block';
                if (fileInputSection) fileInputSection.style.display = 'none';
                if (dbLoadingBar) dbLoadingBar.style.display = 'block';
                if (dbStats) dbStats.textContent = 'Initializing database...';

                // Initialize database (arc-db.js)
                await initDatabase();
                db = S.db; // sync local ref from ArcState
                _dbReadyResolve(db); // Signal that DB is ready

                // Wire up UI callbacks so DB layer can trigger UI updates
                _setDBCallbacks({
                    updateDBStatusDisplay,
                    displayDiary,
                    updateStatsForCurrentView,
                });

                // Wire up events module callbacks
                if (_setEventsCallbacks) {
                    _setEventsCallbacks({
                        renderMonth: () => displayDiary(S.currentMonth),
                        closeSearchResults,
                        updateMapPaddingForSlider,
                    });
                }

                // Check if analysis data needs rebuilding (after DB upgrade)
                checkAndRebuildAnalysisData();

                // Load favorites from localStorage
                loadFavorites();

                // Load import tags from IndexedDB (for persistence)
                const savedAddedDays = await getMetadata('importAddedDays');
                const savedUpdatedDays = await getMetadata('importUpdatedDays');
                const savedChangedItemIds = await getMetadata('importChangedItemIds');
                if (savedAddedDays) importAddedDays = savedAddedDays;
                if (savedUpdatedDays) importUpdatedDays = savedUpdatedDays;
                if (savedChangedItemIds) importChangedItemIds = new Set(savedChangedItemIds);

                // Load place-name mappings (if previously imported)
                const savedPlaces = await getMetadata('placesById');
                if (savedPlaces) {
                    placesById = savedPlaces;
                    S.placesById = savedPlaces; // sync to ArcState for arc-db.js
                }

                // Update status display
                await updateDBStatusDisplay();

                // Check if database has data
                const stats = await getDBStats();

                if (stats.dayCount > 0) {
                    // Show loading message
                    if (dbStats) dbStats.textContent = `Loading most recent month from ${stats.dayCount} days...`;

                    // Auto-load most recent month
                    await loadMostRecentMonth();

                    // Hide loading bar, update to final stats
                    if (dbLoadingBar) dbLoadingBar.style.display = 'none';
                    await updateDBStatusDisplay();
                } else {
                    // Hide loading, show file input
                    if (dbLoadingBar) dbLoadingBar.style.display = 'none';
                    if (dbStatusSection) dbStatusSection.style.display = 'none';
                    if (fileInputSection) fileInputSection.style.display = 'block';
                }

            } catch (error) {
                logError('Error initializing app:', error);
                const dbLoadingBar = document.getElementById('dbLoadingBar');
                if (dbLoadingBar) dbLoadingBar.style.display = 'none';
                alert('Error initializing database. Please refresh the page.');
            }
        })();
        

// === Expose UI handlers required by inline HTML (consolidated) ===
if (typeof changeMapStyle === 'function') window.changeMapStyle = changeMapStyle;
if (typeof clearSearch === 'function') window.clearSearch = clearSearch;
if (typeof closeDeleteModal === 'function') window.closeDeleteModal = closeDeleteModal;
if (typeof closeDiaryReader === 'function') window.closeDiaryReader = closeDiaryReader;
if (typeof closeFilterModal === 'function') window.closeFilterModal = closeFilterModal;
if (typeof closeSearchResults === 'function') window.closeSearchResults = closeSearchResults;
if (typeof closeStatsPanel === 'function') window.closeStatsPanel = closeStatsPanel;
if (typeof confirmDeleteDays === 'function') window.confirmDeleteDays = confirmDeleteDays;
if (typeof downloadCurrentMonth === 'function') window.downloadCurrentMonth = downloadCurrentMonth;
if (typeof exportDatabaseBackup === 'function') window.exportDatabaseBackup = exportDatabaseBackup;
if (typeof getMapPadding === 'function') window.getMapPadding = getMapPadding;
if (typeof handleSearchKeyup === 'function') window.handleSearchKeyup = handleSearchKeyup;
if (typeof hideDiaryRoutes === 'function') window.hideDiaryRoutes = hideDiaryRoutes;
if (typeof hideSearchDropdownDelayed === 'function') window.hideSearchDropdownDelayed = hideSearchDropdownDelayed;
if (typeof importMoreFiles === 'function') window.importMoreFiles = importMoreFiles;
if (typeof navigateDay === 'function') window.navigateDay = navigateDay;
if (typeof navigateMonth === 'function') window.navigateMonth = navigateMonth;
if (typeof navigateSearch === 'function') window.navigateSearch = navigateSearch;
if (typeof navigateToSearchResultByIndex === 'function') window.navigateToSearchResultByIndex = navigateToSearchResultByIndex;
if (typeof openDeleteModal === 'function') window.openDeleteModal = openDeleteModal;
if (typeof openDiaryFromDatabase === 'function') window.openDiaryFromDatabase = openDiaryFromDatabase;
if (typeof openDiaryReader === 'function') window.openDiaryReader = openDiaryReader;
if (typeof performFindSearch === 'function') window.performFindSearch = performFindSearch;
if (typeof printDiary === 'function') window.printDiary = printDiary;
if (typeof resetTransparencySetting === 'function') window.resetTransparencySetting = resetTransparencySetting;
if (typeof saveMapAsImage === 'function') window.saveMapAsImage = saveMapAsImage;
if (typeof saveTransparencySetting === 'function') window.saveTransparencySetting = saveTransparencySetting;
if (typeof showCredits === 'function') window.showCredits = showCredits;
if (typeof showDiaryRoutes === 'function') window.showDiaryRoutes = showDiaryRoutes;
if (typeof showSearchDropdown === 'function') window.showSearchDropdown = showSearchDropdown;
if (typeof switchMonth === 'function') window.switchMonth = switchMonth;
if (typeof switchYear === 'function') window.switchYear = switchYear;
if (typeof toggleAllActivities === 'function') window.toggleAllActivities = toggleAllActivities;
if (typeof toggleAnalysisPanel === 'function') window.toggleAnalysisPanel = toggleAnalysisPanel;

        // Analysis opens in separate tab - reuse existing if same build
        const analysisChannel = new BroadcastChannel('arc-analysis-control');
        let analysisWindowRef = null;
        let awaitingAnalysisAck = false;
        
        // Listen for acknowledgment from analysis tab
        analysisChannel.onmessage = (event) => {
            if (event.data?.type === 'analysisAck') {
                awaitingAnalysisAck = false;
                
                // Check if analysis tab is running an older build
                const analysisBuild = event.data.build || 0;
                const currentBuild = window.__ARC_BUILD__ || 0;
                
                if (analysisBuild < currentBuild) {
                    // Old version - open new tab with current version
                    const buildId = `arc_analysis_${currentBuild}`;
                    analysisWindowRef = window.open('analysis.html', buildId);
                    showAnalysisUpgradeToast();
                } else {
                    // Analysis tab is current - show brief tooltip
                    showAnalysisOpenToast();
                }
            }
        };
        
        function showAnalysisUpgradeToast() {
            // Remove existing toast
            document.querySelector('.analysis-open-toast')?.remove();
            
            const toast = document.createElement('div');
            toast.className = 'analysis-open-toast';
            toast.textContent = 'Opening updated Analysis tab...';
            toast.style.cssText = `
                position: fixed;
                top: 60px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(52, 199, 89, 0.9);
                color: white;
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                z-index: 10000;
                animation: toastFade 2s ease-out forwards;
            `;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
        }
        
        function showAnalysisOpenToast() {
            // Remove existing toast
            document.querySelector('.analysis-open-toast')?.remove();
            
            const toast = document.createElement('div');
            toast.className = 'analysis-open-toast';
            toast.textContent = 'Analysis tab is open - check your browser tabs';
            toast.style.cssText = `
                position: fixed;
                top: 60px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                z-index: 10000;
                animation: toastFade 2s ease-out forwards;
            `;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
        }
        
        // Add toast animation style
        if (!document.getElementById('analysis-toast-style')) {
            const style = document.createElement('style');
            style.id = 'analysis-toast-style';
            style.textContent = `
                @keyframes toastFade {
                    0%, 70% { opacity: 1; }
                    100% { opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        window.toggleAnalysisPanel = function() {
            const buildId = `arc_analysis_${window.__ARC_BUILD__ || 'dev'}`;
            
            // Send focus request to any existing analysis tab
            awaitingAnalysisAck = true;
            analysisChannel.postMessage({ type: 'focusAnalysis' });
            
            // Wait briefly for response
            setTimeout(() => {
                if (awaitingAnalysisAck) {
                    // No response - open new tab
                    awaitingAnalysisAck = false;
                    analysisWindowRef = window.open('analysis.html', buildId);
                }
            }, 150);
        };
if (typeof positionElevationPanel === 'function') window.positionElevationPanel = positionElevationPanel;
if (typeof toggleDiary === 'function') window.toggleDiary = toggleDiary;
if (typeof toggleElevationPanel === 'function') window.toggleElevationPanel = toggleElevationPanel;
if (typeof setElevationProfile === 'function') window.setElevationProfile = setElevationProfile;
if (typeof toggleFavoriteFromPopup === 'function') window.toggleFavoriteFromPopup = toggleFavoriteFromPopup;
if (typeof toggleMapFilters === 'function') window.toggleMapFilters = toggleMapFilters;
if (typeof toggleToolsDropdown === 'function') window.toggleToolsDropdown = toggleToolsDropdown;
if (typeof toggleTransparencySlider === 'function') window.toggleTransparencySlider = toggleTransparencySlider;
if (typeof selectToolFromDropdown === 'function') window.selectToolFromDropdown = selectToolFromDropdown;
if (typeof closeElevationPanel === 'function') window.closeElevationPanel = closeElevationPanel;
// Route search functions are now in map-tools.js (no exports needed - they're global)
if (typeof closeTransparencyPopup === 'function') window.closeTransparencyPopup = closeTransparencyPopup;
if (typeof startDragModal === 'function') window.startDragModal = startDragModal;
if (typeof updateDeletePreview === 'function') window.updateDeletePreview = updateDeletePreview;
if (typeof updateElevationChart === 'function') window.updateElevationChart = updateElevationChart;
if (typeof updateMapRoutes === 'function') window.updateMapRoutes = updateMapRoutes;
if (typeof updateTransparencyValue === 'function') window.updateTransparencyValue = updateTransparencyValue;
if (typeof zoomIn === 'function') window.zoomIn = zoomIn;
if (typeof zoomOut === 'function') window.zoomOut = zoomOut;
// Note: toggleMeasureTool, toggleSearchPopup, handleSearchKeydown, selectSearchResult
// are defined in map-tools.js
// Replay functions are exported inside initApp where they are defined

}

// Initialize: run immediately if DOM ready, otherwise wait
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
