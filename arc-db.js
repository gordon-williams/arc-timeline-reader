/**
 * Arc Timeline Diary Reader — IndexedDB Storage Layer
 *
 * All database operations: init, CRUD, metadata, place names, activity types,
 * ghost filtering, containment detection, analysis data, export/clear.
 *
 * Depends on: arc-state.js (ArcState), arc-utils.js (ArcUtils)
 */
(() => {
    'use strict';

    const S = window.ArcState;
    const { addLog, calculateDistance, calculatePathDistance } = window.ArcUtils;

    const DB_NAME = S.DB_NAME;
    const DB_VERSION = S.DB_VERSION;
    let db = null;

    // Getter for generatedDiaries — lives on ArcState, may be reassigned by app.js
    function _diaries() { return S.generatedDiaries; }

    // UI callbacks — set by app.js after load (avoids circular dependency)
    const _ui = {
        updateDBStatusDisplay: null,
        displayDiary: null,
        updateStatsForCurrentView: null,
    };

async function initDatabase() {
    return new Promise((resolve, reject) => {
        logDebug('📂 Opening IndexedDB...');
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (event) => {
            logError('IndexedDB open error:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            db = request.result;
            S.db = db; // sync to ArcState for cross-module access
            logInfo('✅ IndexedDB initialized');
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            const oldVersion = event.oldVersion;
            
            logDebug(`📦 Upgrading database from v${oldVersion} to v${DB_VERSION}`);
            
            // v1 stores - core functionality
            if (!database.objectStoreNames.contains('days')) {
                const dayStore = database.createObjectStore('days', { keyPath: 'dayKey' });
                dayStore.createIndex('monthKey', 'monthKey', { unique: false });
                dayStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
                dayStore.createIndex('sourceFile', 'sourceFile', { unique: false });
            }
            
            if (!database.objectStoreNames.contains('months')) {
                const monthStore = database.createObjectStore('months', { keyPath: 'monthKey' });
                monthStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
            }
            
            if (!database.objectStoreNames.contains('metadata')) {
                database.createObjectStore('metadata', { keyPath: 'key' });
            }
            
            // v2 stores - create empty, don't populate yet
            if (oldVersion < 2) {
                if (!database.objectStoreNames.contains('dailySummaries')) {
                    database.createObjectStore('dailySummaries', { keyPath: 'dayKey' });
                }
                if (!database.objectStoreNames.contains('locationVisits')) {
                    const lvStore = database.createObjectStore('locationVisits', { keyPath: 'id', autoIncrement: true });
                    lvStore.createIndex('locationName', 'locationName', { unique: false });
                    lvStore.createIndex('dayKey', 'dayKey', { unique: false });
                    lvStore.createIndex('locationDay', ['locationName', 'dayKey'], { unique: false });
                }
                if (!database.objectStoreNames.contains('locations')) {
                    const locStore = database.createObjectStore('locations', { keyPath: 'name' });
                    locStore.createIndex('totalVisits', 'totalVisits', { unique: false });
                }
            }
        };
        
        request.onblocked = () => {
            logError('⚠️ Database blocked - close other tabs');
            alert('Please close other tabs with this app and refresh');
        };
    });
}

// Get database statistics (optimized for large datasets)
async function getDBStats() {
    if (!db) return { dayCount: 0, monthCount: 0, lastSync: null };

    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(['days', 'metadata'], 'readonly');
            const dayStore = tx.objectStore('days');
            const metaStore = tx.objectStore('metadata');

            // Use count() instead of getAll() - much faster!
            const dayCountReq = dayStore.count();
            const lastSyncReq = metaStore.get('lastSync');

            // Get all day keys to calculate unique months
            // Note: Using getAllKeys() instead of cursor with 'nextunique' to avoid Safari IndexedDB bug
            const allKeysReq = dayStore.getAllKeys();

            tx.oncomplete = () => {
                // Extract unique months from day keys (YYYY-MM-DD -> YYYY-MM)
                const monthSet = new Set();
                const dayKeys = allKeysReq.result || [];
                for (const dk of dayKeys) {
                    if (typeof dk === 'string' && dk.length >= 7) {
                        monthSet.add(dk.substring(0, 7));
                    }
                }
                resolve({
                    dayCount: dayCountReq.result,
                    monthCount: monthSet.size,
                    lastSync: lastSyncReq.result?.value || null
                });
            };

            tx.onerror = () => reject(tx.error);
        } catch (err) {
            reject(err);
        }
    });
}

// Save metadata
async function saveMetadata(key, value) {
    if (!db) return;
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['metadata'], 'readwrite');
        const store = tx.objectStore('metadata');
        store.put({ key, value });
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Get metadata
async function getMetadata(key) {
    if (!db) return null;
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['metadata'], 'readonly');
        const store = tx.objectStore('metadata');
        const req = store.get(key);
        
        req.onsuccess = () => resolve(req.result?.value || null);
        req.onerror = () => reject(req.error);
    });
}



// ========================================
// Place Name Mapping (Arc export places/*.json)
// ========================================
// placesById lives on ArcState — local alias for convenience
// Note: when reassigning, must update S.placesById too
let placesById = S.placesById;

function _collectPlaceIdNamePairs(node, out) {
    if (!node) return;
    if (Array.isArray(node)) {
        for (const v of node) _collectPlaceIdNamePairs(v, out);
        return;
    }
    if (typeof node !== 'object') return;

    // Common shapes: {id, name}, {placeId, name}, {id, title}, {placeId, title}
    const id = node.placeId || node.id || node.uuid || node.identifier;
    const name = node.customTitle || node.customName || node.title || node.name || node.displayName;
    if (id && name && typeof name === 'string') {
        out.push([String(id), name.trim()]);
    }

    for (const k of Object.keys(node)) {
        _collectPlaceIdNamePairs(node[k], out);
    }
}

async function loadPlacesFromSelectedFiles(allFiles) {
    // Accept Arc export relative paths like "places/F.json" or any path containing "/places/"
    const placeFiles = allFiles.filter(f => {
        const rp = f.webkitRelativePath || '';
        const isPlacesPath = rp.includes('/places/') || rp.startsWith('places/');
        const isJson = f.name.toLowerCase().endsWith('.json');
        return isPlacesPath && isJson;
    });

    if (placeFiles.length === 0) return false;

    const pairs = [];
    for (const f of placeFiles) {
        try {
            const text = await f.text();
            const json = JSON.parse(text);
            _collectPlaceIdNamePairs(json, pairs);
        } catch (e) {
            // Ignore malformed place files
        }
    }

    if (pairs.length === 0) return false;

    // Build map; last write wins (lets user overrides take precedence)
    const map = {};
    for (const [id, name] of pairs) {
        if (id && name) map[id] = name;
    }

    placesById = map;
    S.placesById = map; // sync to ArcState
    await saveMetadata('placesById', placesById);
    logInfo(`📍 Loaded ${Object.keys(placesById).length} place names from places folder`);
    return true;
}

function applyPlaceNamesToDayData(dayData) {
    if (!dayData?.timelineItems || !placesById || Object.keys(placesById).length === 0) return;

    for (const item of dayData.timelineItems) {
        const pid = item?.place?.placeId || item?.place?.id || item?.placeId || item?.placeUUID;
        if (!pid) continue;

        const mappedName = placesById[String(pid)];
        if (!mappedName) continue;

        // Always update place.name from current placesById mapping
        // This ensures place name changes in Arc are reflected here
        if (!item.place) item.place = {};
        item.place.name = mappedName;

        // NOTE: We intentionally do NOT set customTitle here.
        // customTitle should only be used if set explicitly by the user in Arc.
        // Setting it here caused stale names to persist even after the place
        // was renamed in Arc (see Build 681 fix).
    }
}

// ========================================
// Activity Type Inference (speed sanity checks)
// ========================================
function _getLatLngFromSample(s) {
    const loc = s.location || s;
    const lat = loc.latitude ?? loc.lat;
    const lng = loc.longitude ?? loc.lng;
    return (typeof lat === 'number' && typeof lng === 'number') ? { lat, lng } : null;
}

function _getTimeMsFromSample(s) {
    const t = s.date || s.timestamp || s.time || s.startDate;
    if (!t) return null;
    const ms = (typeof t === 'number') ? t : Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
}

function inferActivityTypeFromSamples(samples, fallbackType = null) {
    if (!Array.isArray(samples) || samples.length < 2) return fallbackType;

    let totalDist = 0;
    let totalTime = 0;
    let maxSpeed = 0;

    for (let i = 1; i < samples.length; i++) {
        const a = _getLatLngFromSample(samples[i - 1]);
        const b = _getLatLngFromSample(samples[i]);
        if (!a || !b) continue;

        const t1 = _getTimeMsFromSample(samples[i - 1]);
        const t2 = _getTimeMsFromSample(samples[i]);
        if (t1 == null || t2 == null) continue;

        const dt = (t2 - t1) / 1000;
        if (!(dt > 0 && dt < 3600)) continue;

        const d = calculateDistance(a.lat, a.lng, b.lat, b.lng);
        totalDist += d;
        totalTime += dt;

        const sp = d / dt; // m/s
        if (sp > maxSpeed) maxSpeed = sp;
    }

    if (totalTime <= 0) return fallbackType;

    const avgSpeed = totalDist / totalTime; // m/s

    // Conservative thresholds:
    // - walking usually < 2.2 m/s (8 km/h)
    // - cycling roughly 2.2–7 m/s (8–25 km/h)
    // - car typically > 7 m/s (>25 km/h)
    if (avgSpeed > 7 || maxSpeed > 12) return 'car';
    if (avgSpeed > 2.2) return 'cycling';
    return 'walking';
}

function applyActivityTypeFixesToDayData(dayData) {
    if (!dayData?.timelineItems) return;

    for (const item of dayData.timelineItems) {
        if (item.isVisit) continue;
        
        // CRITICAL: Honor manual overrides - never re-infer if user set the type
        if (item.manualActivityType) continue;

        let act = (item.activityType || '').toLowerCase().trim();
        if (act === 'automotive') act = 'car';
        
        // Only set activity type if it's completely missing
        // Do NOT re-infer from samples - Arc's decision is authoritative
        if (!act || act === 'unknown') {
            item.activityType = 'unknown';
        } else {
            item.activityType = act;
        }
    }
}

function applyImportFixes(dayData) {
    applyPlaceNamesToDayData(dayData);
    applyActivityTypeFixesToDayData(dayData);
}

// ========================================
// Public API for Analysis Module
// ========================================
window.AppDB = {
    ready: S.dbReadyPromise,
    
    // Get a single day by dayKey (YYYY-MM-DD)
    async getDay(dayKey) {
        await S.dbReadyPromise;
        return getDayFromDB(dayKey);
    },
    
    // Get all days in a range (inclusive, YYYY-MM-DD format)
    async getDaysInRange(startDayKey, endDayKey) {
        await S.dbReadyPromise;
        if (!db) return [];
        
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['days'], 'readonly');
            const store = tx.objectStore('days');
            const range = IDBKeyRange.bound(startDayKey, endDayKey);
            const request = store.getAll(range);
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },
    
    // Debug: Inspect raw IndexedDB data for a day
    // Usage: await AppDB.inspectDay('2014-07-12')
    async inspectDay(dayKey) {
        await S.dbReadyPromise;
        const dayRecord = await getDayFromDB(dayKey);
        if (!dayRecord) {
            logDebug(`❌ No data found for ${dayKey}`);
            return null;
        }
        return dayRecord;
    },
    
    // Debug: Delete a single day from IndexedDB
    // Usage: await AppDB.deleteDay('2014-07-12')
    // Then copy/touch the JSON file and re-import
    async deleteDay(dayKey) {
        await S.dbReadyPromise;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['days', 'metadata'], 'readwrite');
            const daysStore = tx.objectStore('days');
            const metaStore = tx.objectStore('metadata');
            
            const deleteRequest = daysStore.delete(dayKey);
            
            deleteRequest.onsuccess = () => {
                logDebug(`🗑️ Deleted ${dayKey} from IndexedDB`);
                
                // Also clear from generatedDiaries cache
                const monthKey = dayKey.substring(0, 7);
                if (_diaries()[monthKey]) {
                    delete _diaries()[monthKey].days[dayKey];
                    delete _diaries()[monthKey].locationsByDay[dayKey];
                    delete _diaries()[monthKey].routesByDay[dayKey];
                    logDebug(`🗑️ Cleared ${dayKey} from memory cache`);
                }
                
                // Reset lastScanTime to yesterday so recent files get picked up
                const yesterday = Date.now() - (24 * 60 * 60 * 1000);
                metaStore.put({ key: 'lastScanTime', value: yesterday });
                logDebug(`🗑️ Reset lastScanTime to yesterday - copy/touch the file then re-import`);
                
                resolve(true);
            };
            
            deleteRequest.onerror = () => {
                logError(`❌ Failed to delete ${dayKey}`);
                reject(deleteRequest.error);
            };
        });
    },
    
    // Debug: Dump route data for a specific day
    // Usage: await AppDB.debugRoutes('2014-07-12')
    async debugRoutes(dayKey) {
        await S.dbReadyPromise;
        const monthKey = dayKey.substring(0, 7);
        const routes = _diaries()[monthKey]?.routesByDay?.[dayKey];
        if (!routes) {
            logDebug(`❌ No routes found for ${dayKey}`);
            return null;
        }
        
        logDebug(`📍 Routes for ${dayKey}: ${routes.length} points`);
        
        // Group by activity type
        const byActivity = {};
        for (const pt of routes) {
            const act = pt.activityType || 'unknown';
            if (!byActivity[act]) byActivity[act] = [];
            byActivity[act].push(pt);
        }
        
        for (const [act, pts] of Object.entries(byActivity)) {
            logDebug(`  ${act}: ${pts.length} points`);
        }
        
        return routes;
    },
    
    // Debug: Dump place names for a specific day
    // Usage: await AppDB.debugDay('2014-07-12')
    async debugDay(dayKey) {
        await S.dbReadyPromise;
        const record = await getDayFromDB(dayKey);
        if (!record) {
            logDebug(`❌ No record found for ${dayKey}`);
            return null;
        }
        
        logDebug(`📦 Raw record for ${dayKey}:`, record);
        
        const items = record.data?.timelineItems || [];
        logDebug(`📍 Found ${items.length} timeline items`);
        
        items.forEach((item, i) => {
            if (item.isVisit) {
                logDebug(`  Visit #${i}:`, {
                    'place exists': !!item.place,
                    'place.name': item.place?.name,
                    'streetAddress': item.streetAddress,
                    'center': item.center,
                });
            } else {
                const samples = item.samples || [];
                logDebug(`  Activity #${i}: ${item.activityType}, ${samples.length} samples, start=${item.startDate}`);
            }
        });
        
        return record;
    },
    
    // DB sanity check - returns diagnostic info
    async sanityCheck() {
        await S.dbReadyPromise;
        const result = {
            dbExists: !!db,
            storeNames: [],
            daysCount: 0,
            firstRecordKeys: null,
            sampleNotes: null,
            error: null
        };
        
        if (!db) {
            result.error = 'Database not initialized';
            return result;
        }
        
        try {
            // Get store names
            result.storeNames = Array.from(db.objectStoreNames);
            
            // Count days
            const countTx = db.transaction(['days'], 'readonly');
            const countStore = countTx.objectStore('days');
            const countReq = countStore.count();
            
            result.daysCount = await new Promise((resolve, reject) => {
                countReq.onsuccess = () => resolve(countReq.result);
                countReq.onerror = () => reject(countReq.error);
            });
            
            // Get first record
            if (result.daysCount > 0) {
                const firstTx = db.transaction(['days'], 'readonly');
                const firstStore = firstTx.objectStore('days');
                const cursorReq = firstStore.openCursor();
                
                const firstRecord = await new Promise((resolve, reject) => {
                    cursorReq.onsuccess = (e) => {
                        const cursor = e.target.result;
                        resolve(cursor ? cursor.value : null);
                    };
                    cursorReq.onerror = () => reject(cursorReq.error);
                });
                
                if (firstRecord) {
                    result.firstRecordKeys = Object.keys(firstRecord);
                    
                    // Check for timelineItems array (this is what's actually stored)
                    if (firstRecord.data && firstRecord.data.timelineItems) {
                        const items = firstRecord.data.timelineItems;
                        result.sampleItems = {
                            count: items.length,
                            firstItemKeys: items[0] ? Object.keys(items[0]) : null,
                            hasIsVisit: items.some(i => 'isVisit' in i),
                            hasActivityType: items.some(i => 'activityType' in i),
                            hasSamples: items.some(i => i.samples && i.samples.length > 0)
                        };
                    }
                }
            }
        } catch (e) {
            result.error = e.message;
        }
        
        return result;
    }
};

function getStoredDisplayNameForTimelineItem(item) {
    if (!item || item.isVisit) return null;
    const act = (item.activityType || '').toLowerCase();
    const hasNoGpsSamples = !Array.isArray(item.samples) || item.samples.length === 0;
    if ((act === 'unknown' || act === '') && hasNoGpsSamples) {
        return 'Data Gap';
    }
    return null;
}

function getStoredActivityTypeForTimelineItem(item) {
    if (!item) return 'unknown';
    if (item.isVisit) return 'stationary';

    let act = (item.activityType || '').toLowerCase().trim();
    if (act === 'automotive') act = 'car';

    // When Arc backup omits confirmed/classified type, infer from samples
    // so stored output matches Arc Timeline display more closely.
    if (!act || act === 'unknown') {
        const inferred = inferActivityTypeFromSamples(item.samples || [], 'unknown');
        return (inferred || 'unknown').toLowerCase();
    }
    return act;
}

// generateDayHash, importDayToDB, getDayMetadataFromDB removed —
// now only in import.js (Phase 2 cleanup)

// Get day from IndexedDB
async function getDayFromDB(dayKey) {
    if (!db) return null;
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const store = tx.objectStore('days');
        const req = store.get(dayKey);
        
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

// Lightweight version - just get day keys, not full data
async function getAllDayKeysFromDB() {
    if (!db) return [];

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const store = tx.objectStore('days');
        const req = store.getAllKeys();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// Get all days for a month from IndexedDB
async function getMonthDaysFromDB(monthKey) {
    if (!db) return [];
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const store = tx.objectStore('days');
        const index = store.index('monthKey');
        const req = index.getAll(monthKey);
        
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// Get all months from IndexedDB
async function getAllMonthsFromDB() {
    if (!db) return [];
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['months'], 'readonly');
        const store = tx.objectStore('months');
        const req = store.getAll();
        
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// Helper: Get the previous day's key (YYYY-MM-DD)
function getPreviousDayKey(dayKey) {
    const date = new Date(dayKey + 'T12:00:00'); // Noon to avoid DST issues
    date.setDate(date.getDate() - 1);
    return date.toISOString().substring(0, 10);
}

// Helper: Get previous month key (YYYY-MM)
function getPreviousMonthKey(monthKey) {
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return null;
    const [y, m] = monthKey.split('-').map(Number);
    const date = new Date(y, m - 1, 15);
    date.setMonth(date.getMonth() - 1);
    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${yy}-${mm}`;
}

// Helper: Convert UTC date string to local day key (YYYY-MM-DD)
// CRITICAL: Arc stores dates in UTC, but diary is organized by local date
function getLocalDayKey(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return d.getFullYear() + '-' + 
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

// Save month aggregated data
async function saveMonthToDB(monthKey, monthData) {
    if (!db) return;
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['months'], 'readwrite');
        const store = tx.objectStore('months');
        
        store.put({
            monthKey,
            lastUpdated: Date.now(),
            ...monthData
        });
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ============================================================
// Ghost Item Filtering
// ============================================================

/**
 * Filter out "ghost" timeline items - items with 0 samples that overlap
 * with items that have samples. These ghosts can incorrectly act as
 * containers and hide legitimate data.
 *
 * A ghost is removed if:
 * - It has 0 samples (no GPS data)
 * - Another item with samples overlaps it significantly (>50% overlap)
 *
 * Items with 0 samples that don't overlap are kept (shows gap in timeline).
 *
 * @param {Array} items - Timeline items for a day
 * @returns {Array} - Filtered items with ghosts removed
 */
function filterGhostItems(items) {
    if (!items || items.length === 0) return items;

    // Separate items with and without samples
    const withSamples = [];
    const withoutSamples = [];

    for (const item of items) {
        const hasSamples = item.samples && item.samples.length > 0;
        // For visits, having a center point counts as having location data
        const hasCenter = item.isVisit && item.center?.latitude && item.center?.longitude;

        if (hasSamples || (item.isVisit && hasCenter && item.samples?.length > 0)) {
            withSamples.push(item);
        } else if (!hasSamples) {
            withoutSamples.push(item);
        } else {
            withSamples.push(item);
        }
    }

    // Check each 0-sample item for overlap with items that have samples
    const ghostIds = new Set();
    if (withoutSamples.length > 0) {
        for (const ghost of withoutSamples) {
            if (!ghost.startDate || !ghost.endDate) continue;

            const ghostStart = new Date(ghost.startDate).getTime();
            const ghostEnd = new Date(ghost.endDate).getTime();
            const ghostDuration = ghostEnd - ghostStart;

            if (ghostDuration <= 0) continue;

            // Check if any item with samples overlaps this ghost significantly
            for (const real of withSamples) {
                if (!real.startDate || !real.endDate) continue;

                const realStart = new Date(real.startDate).getTime();
                const realEnd = new Date(real.endDate).getTime();

                // Calculate overlap
                const overlapStart = Math.max(ghostStart, realStart);
                const overlapEnd = Math.min(ghostEnd, realEnd);
                const overlap = Math.max(0, overlapEnd - overlapStart);

                // If overlap is >50% of ghost's duration, it's a duplicate
                if (overlap > ghostDuration * 0.5) {
                    ghostIds.add(ghost.itemId || ghost.startDate);
                    logDebug(`👻 Filtering ghost item: ${ghost.isVisit ? 'Visit' : 'Activity'} ${ghost.place?.name || ghost.activityType || 'unknown'} (${ghost.startDate}) - overlaps with item that has ${real.samples?.length || 0} samples`);
                    break;
                }
            }
        }
    }

    // First pass result: remove classic 0-sample ghosts
    const nonGhostItems = (ghostIds.size === 0) ? items : items.filter(item => {
        const itemId = item.itemId || item.startDate;
        return !ghostIds.has(itemId);
    });

    // Second pass: remove overlapping duplicate activity items that BOTH have samples.
    // This occurs in some Arc Editor backups where an updated item and a stale item
    // coexist after incremental merges (often unknown vs classified activity).
    const duplicatesToRemove = new Set();
    const activitiesWithSamples = nonGhostItems.filter(item =>
        !item.isVisit &&
        Array.isArray(item.samples) &&
        item.samples.length > 0 &&
        item.startDate &&
        item.endDate
    );

    function overlapRatioMs(aStart, aEnd, bStart, bEnd) {
        const overlapStart = Math.max(aStart, bStart);
        const overlapEnd = Math.min(aEnd, bEnd);
        const overlap = Math.max(0, overlapEnd - overlapStart);
        const minDuration = Math.min(aEnd - aStart, bEnd - bStart);
        if (minDuration <= 0) return 0;
        return overlap / minDuration;
    }

    function scoreActivityItem(item) {
        const sampleCount = Array.isArray(item.samples) ? item.samples.length : 0;
        const activity = (item.activityType || 'unknown').toLowerCase();
        let score = sampleCount;
        if (activity !== 'unknown') score += 1000;
        if (item.previousItemId) score += 50;
        if (item.nextItemId) score += 50;
        if (item.manualActivityType) score += 200;
        return score;
    }

    for (let i = 0; i < activitiesWithSamples.length; i++) {
        const a = activitiesWithSamples[i];
        const aId = a.itemId || a.startDate;
        if (duplicatesToRemove.has(aId)) continue;

        const aStart = new Date(a.startDate).getTime();
        const aEnd = new Date(a.endDate).getTime();
        if (!(aEnd > aStart)) continue;

        for (let j = i + 1; j < activitiesWithSamples.length; j++) {
            const b = activitiesWithSamples[j];
            const bId = b.itemId || b.startDate;
            if (duplicatesToRemove.has(bId)) continue;
            if (aId === bId) continue;

            const bStart = new Date(b.startDate).getTime();
            const bEnd = new Date(b.endDate).getTime();
            if (!(bEnd > bStart)) continue;

            const overlap = overlapRatioMs(aStart, aEnd, bStart, bEnd);
            if (overlap < 0.85) continue;

            const startDiff = Math.abs(aStart - bStart);
            const endDiff = Math.abs(aEnd - bEnd);
            const aType = (a.activityType || 'unknown').toLowerCase();
            const bType = (b.activityType || 'unknown').toLowerCase();

            const unknownVsKnown = (aType === 'unknown' && bType !== 'unknown') || (bType === 'unknown' && aType !== 'unknown');
            const nearSameWindow = startDiff <= 10 * 60 * 1000 && endDiff <= 10 * 60 * 1000;
            const sameType = aType === bType;

            if (!sameType && !unknownVsKnown) continue;
            if (!nearSameWindow && overlap < 0.95) continue;

            const scoreA = scoreActivityItem(a);
            const scoreB = scoreActivityItem(b);
            const dropA = scoreA < scoreB;
            const dropId = dropA ? aId : bId;
            const keep = dropA ? b : a;
            const drop = dropA ? a : b;
            duplicatesToRemove.add(dropId);

            logDebug(`👻 Filtering overlapping duplicate activity: drop ${drop.activityType || 'unknown'} (${drop.startDate}–${drop.endDate}) keep ${keep.activityType || 'unknown'} (${keep.startDate}–${keep.endDate}) overlap=${Math.round(overlap * 100)}%`);
        }
    }

    if (duplicatesToRemove.size === 0) return nonGhostItems;
    return nonGhostItems.filter(item => {
        const itemId = item.itemId || item.startDate;
        return !duplicatesToRemove.has(itemId);
    });
}

// ============================================================
// Shared Containment Detection
// ============================================================

/**
 * Find items that are "contained" within longer visits.
 * Used by both display coalescer and analysis to ensure consistency.
 * 
 * Rules:
 * - Visits > 30 minutes become "containers"
 * - Items starting within a container's timespan are marked as contained
 * - Items with customTitle are NEVER contained (user intentionally named them)
 * - Handles midnight-spanning visits (first item of day may be container)
 *
 * @param {Array} items - Timeline items for a day
 * @returns {Set} - Set of item IDs that are contained
 */
function findContainedItems(items) {
    const containedIds = new Set();
    if (!items || items.length === 0) return containedIds;

    // Sort items by startDate to ensure chronological processing
    const sortedItems = [...items].sort((a, b) => {
        const aStart = a.startDate ? new Date(a.startDate).getTime() : 0;
        const bStart = b.startDate ? new Date(b.startDate).getTime() : 0;
        return aStart - bStart;
    });

    let activeContainerEnd = 0;

    // Main pass: Track containers and mark contained items
    // Only long VISITS become containers.
    // Contained = VISIT that starts and ends inside an active container.
    // Activities/trips are never hidden by containment (fixes missing car entries).
    for (let i = 0; i < sortedItems.length; i++) {
        const item = sortedItems[i];
        if (!item.startDate) continue;

        const itemId = item.itemId || item.startDate;
        const itemStart = new Date(item.startDate).getTime();
        const itemEnd = item.endDate ? new Date(item.endDate).getTime() : itemStart;
        // Check if this VISIT is contained (skip custom-titled items)
        if (item.isVisit && !item.customTitle && activeContainerEnd > 0 && itemStart < activeContainerEnd) {
            // Hide only if visit also ends within current container
            if (itemEnd <= activeContainerEnd) {
                containedIds.add(itemId);
                continue; // Don't let contained items become containers
            }
        }

        // Any visit can become a container (short visits can legitimately contain noise too)
        if (item.isVisit && itemEnd > activeContainerEnd) {
            activeContainerEnd = itemEnd;
        }
    }

    return containedIds;
}

// ============================================================
// Analysis Data Functions (daily summaries + location visits)
// ============================================================

/**
 * Update analysis data for a single day
 * Called after importing a day, and during background rebuild
 */
async function updateAnalysisDataForDay(dayKey, dayData) {
    if (!db) return;
    
    // Check if v2 stores exist
    if (!db.objectStoreNames.contains('dailySummaries')) {
        return; // v2 stores not available
    }
    
    const items = dayData?.timelineItems || [];
    
    // Calculate daily summary (activities)
    const summary = {
        dayKey,
        totalDistance: 0,
        totalDuration: 0,
        activityStats: {}
    };
    
    // Collect location visits
    const locationVisits = [];  // { locationName, duration, visitCount, firstVisit }
    const locationMap = new Map();  // Aggregate same location on same day
    
    // Use shared containment detection
    const containedItemIds = findContainedItems(items);
    
    // Process items, skipping contained ones
    for (const item of items) {
        // Skip contained items (noise inside larger visits)
        if (containedItemIds.has(item.itemId || item.startDate)) {
            continue;
        }
        
        if (item.isVisit) {
            // Process location visit
            const name = item.place?.name || item.customTitle || item.streetAddress;
            if (!name) continue;
            
            const duration = getDurationSecondsForAnalysis(item.startDate, item.endDate);
            const visitTime = item.startDate ? new Date(item.startDate).toTimeString().slice(0, 5) : null;
            
            if (locationMap.has(name)) {
                const existing = locationMap.get(name);
                existing.duration += duration;
                existing.visitCount++;
                if (visitTime && (!existing.firstVisit || visitTime < existing.firstVisit)) {
                    existing.firstVisit = visitTime;
                }
            } else {
                locationMap.set(name, {
                    dayKey,
                    locationName: name,
                    duration,
                    visitCount: 1,
                    firstVisit: visitTime
                });
            }
        } else {
            // Process activity
            const activityType = normalizeActivityTypeForAnalysis(item.activityType);
            if (activityType === 'stationary' || activityType === 'unknown') continue;
            
            const duration = getDurationSecondsForAnalysis(item.startDate, item.endDate);
            // Calculate distance from samples (Arc doesn't store distance directly on items)
            const distance = item.samples ? calculateDistanceForAnalysis(item.samples) : 0;
            
            if (!summary.activityStats[activityType]) {
                summary.activityStats[activityType] = { count: 0, duration: 0, distance: 0 };
            }
            
            summary.activityStats[activityType].count++;
            summary.activityStats[activityType].duration += duration;
            summary.activityStats[activityType].distance += distance;
            
            summary.totalDistance += distance;
            summary.totalDuration += duration;
        }
    }
    
    // Convert location map to array
    for (const visit of locationMap.values()) {
        locationVisits.push(visit);
    }
    
    // Store in database
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['dailySummaries', 'locationVisits', 'locations'], 'readwrite');
        const summaryStore = tx.objectStore('dailySummaries');
        const visitStore = tx.objectStore('locationVisits');
        const locStore = tx.objectStore('locations');
        
        // Store daily summary
        summaryStore.put(summary);
        
        // Delete existing location visits for this day (in case of update)
        const dayIndex = visitStore.index('dayKey');
        const deleteReq = dayIndex.openCursor(IDBKeyRange.only(dayKey));
        deleteReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        
        // Add new location visits
        for (const visit of locationVisits) {
            visitStore.add(visit);
            
            // Update locations aggregate (for autocomplete)
            const locReq = locStore.get(visit.locationName);
            locReq.onsuccess = () => {
                const existing = locReq.result;
                if (existing) {
                    existing.totalVisits += visit.visitCount;
                    existing.totalDuration += visit.duration;
                    if (dayKey > existing.lastVisit) existing.lastVisit = dayKey;
                    if (dayKey < existing.firstVisit) existing.firstVisit = dayKey;
                    locStore.put(existing);
                } else {
                    locStore.put({
                        name: visit.locationName,
                        totalVisits: visit.visitCount,
                        totalDuration: visit.duration,
                        firstVisit: dayKey,
                        lastVisit: dayKey
                    });
                }
            };
        }
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Rebuild all analysis data from existing days (background task)
 * Called after DB upgrade or manually
 */
async function rebuildAnalysisData(onProgress = null) {
    if (!db) return;
    
    // Check if v2 stores exist
    if (!db.objectStoreNames.contains('dailySummaries')) {
        logDebug('📊 Analysis stores not available, skipping rebuild');
        return;
    }
    
    logInfo('🔄 Rebuilding analysis data...');
    
    // Set global rebuild state for UI feedback
    window._analysisRebuildState = { running: true, processed: 0, total: 0 };
    updateAnalysisButtonIndicator(true);
    updateMainStatusForRebuild(0, 0, true);
    
    // Clear existing analysis stores
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['dailySummaries', 'locationVisits', 'locations'], 'readwrite');
        tx.objectStore('dailySummaries').clear();
        tx.objectStore('locationVisits').clear();
        tx.objectStore('locations').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });

    // Get total count first (safe - just counts, doesn't load data)
    const total = await new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const req = tx.objectStore('days').count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
    });

    let processed = 0;
    window._analysisRebuildState.total = total;
    updateMainStatusForRebuild(0, total, true);

    // Stream days using cursor - NEVER load all into memory
    // Process one day at a time to avoid 300MB+ memory usage
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const store = tx.objectStore('days');
        const req = store.openCursor();

        const processNext = async (cursor) => {
            if (!cursor) {
                resolve();
                return;
            }

            const day = cursor.value;
            await updateAnalysisDataForDay(day.dayKey, day.data);
            processed++;
            window._analysisRebuildState.processed = processed;

            // Update UI every 50 days
            if (processed % 50 === 0) {
                if (onProgress) {
                    onProgress(processed, total);
                }
                updateMainStatusForRebuild(processed, total, true);
                // Yield to main thread
                await new Promise(r => setTimeout(r, 10));
            }

            cursor.continue();
        };

        req.onsuccess = (event) => {
            const cursor = event.target.result;
            processNext(cursor).catch(reject);
        };
        req.onerror = () => reject(req.error);
    });

    // Final UI update
    if (onProgress) {
        onProgress(processed, total);
    }
    updateMainStatusForRebuild(processed, total, true);
    
    // Rebuild locations aggregate and activity totals
    await rebuildLocationsAggregate();
    await rebuildActivityTotals();

    logInfo(`✅ Rebuilt analysis data: ${processed} days processed`);
    
    // Mark rebuild complete
    await saveMetadata('analysisDataVersion', Date.now());
    
    // Clear rebuild state
    window._analysisRebuildState = { running: false, processed: processed, total: total };
    updateAnalysisButtonIndicator(false);
    updateMainStatusForRebuild(processed, total, false);
}

/**
 * Update main status text to show rebuild progress
 */
function updateMainStatusForRebuild(processed, total, isRunning) {
    const dbStats = document.getElementById('dbStats');
    const dbLoadingBar = document.getElementById('dbLoadingBar');
    if (!dbStats) return;
    
    // Only update if we're on the main screen (not in diary view)
    if (document.getElementById('diaryContainer')?.style.display !== 'none') return;
    
    if (isRunning && total > 0) {
        // Hide the indeterminate loading bar
        if (dbLoadingBar) dbLoadingBar.style.display = 'none';
        
        const pct = Math.round((processed / total) * 100);
        dbStats.innerHTML = `Building analysis data: ${processed.toLocaleString()} / ${total.toLocaleString()} days (${pct}%)<br><span style="font-size: 14px; opacity: 0.7;">You can Open Diary Reader now - this runs in background</span>`;
    } else if (!isRunning) {
        // Rebuild complete - update stats display
        if (_ui.updateDBStatusDisplay) _ui.updateDBStatusDisplay();
    }
}

/**
 * Update the Analysis button to show rebuild indicator
 */
function updateAnalysisButtonIndicator(isRebuilding) {
    const btn = document.getElementById('dbButton');
    if (!btn) return;
    
    if (isRebuilding) {
        btn.classList.add('rebuilding');
        btn.innerHTML = 'Analysis <span class="rebuild-indicator">●</span>';
    } else {
        btn.classList.remove('rebuilding');
        btn.textContent = 'Analysis';
    }
}

/**
 * Start background rebuild if needed (after DB upgrade)
 */
function checkAndRebuildAnalysisData() {
    if (window._needsAnalysisRebuild) {
        window._needsAnalysisRebuild = false;
        logInfo('🔄 Starting analysis rebuild (new DB version)');
        startAnalysisRebuild();
    } else {
        // Check if previous rebuild was interrupted
        checkAnalysisDataIntegrity();
    }
}

/**
 * Check if analysis data is complete, rebuild if not
 */
async function checkAnalysisDataIntegrity() {
    if (!db) return;
    
    // Check if v2 stores exist
    if (!db.objectStoreNames.contains('dailySummaries')) {
        logDebug('📊 Analysis stores not available');
        return;
    }
    
    try {
        // Count days and summaries
        const [dayCount, summaryCount] = await Promise.all([
            new Promise((resolve, reject) => {
                const tx = db.transaction(['days'], 'readonly');
                const req = tx.objectStore('days').count();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            }),
            new Promise((resolve, reject) => {
                const tx = db.transaction(['dailySummaries'], 'readonly');
                const req = tx.objectStore('dailySummaries').count();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            })
        ]);
        
        logDebug(`📊 Analysis data check: ${summaryCount}/${dayCount} summaries`);
        
        // If counts don't match, rebuild was interrupted
        if (dayCount > 0 && summaryCount < dayCount) {
            logInfo(`⚠️ Analysis data incomplete (${summaryCount}/${dayCount} days), rebuilding...`);
            startAnalysisRebuild();
        }
    } catch (e) {
        logError('Error checking analysis integrity:', e);
    }
}

/**
 * Start the analysis rebuild in background
 */
function startAnalysisRebuild() {
    // Show immediate feedback
    const dbStats = document.getElementById('dbStats');
    const dbLoadingBar = document.getElementById('dbLoadingBar');
    if (dbLoadingBar) dbLoadingBar.style.display = 'none';
    if (dbStats) dbStats.innerHTML = 'Building analysis data: starting...<br><span style="font-size: 14px; opacity: 0.7;">You can Open Diary Reader now - this runs in background</span>';
    
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 1000));
    
    schedule(() => {
        rebuildAnalysisData((processed, total) => {
            if (processed % 500 === 0) {
                logDebug(`Analysis rebuild: ${processed}/${total}`);
            }
        });
    });
}

/**
 * Update analysis data for specific days (after import)
 * Runs in background to not block UI
 */
function updateAnalysisDataInBackground(dayKeys) {
    if (!dayKeys || dayKeys.length === 0) return;
    if (!db || !db.objectStoreNames.contains('dailySummaries')) return;
    
    logDebug(`🔄 Updating analysis data for ${dayKeys.length} days in background...`);
    
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));
    
    schedule(async () => {
        try {
            // Get full day data for each key
            for (const dayKey of dayKeys) {
                const dayRecord = await getDayFromDB(dayKey);
                if (dayRecord && dayRecord.data) {
                    await updateAnalysisDataForDay(dayKey, dayRecord.data);
                }
            }
            
            // Update locations aggregate and activity totals after all visits are processed
            await rebuildLocationsAggregate();
            await rebuildActivityTotals();

            logDebug(`✅ Analysis data updated for ${dayKeys.length} days`);
        } catch (e) {
            logError('Error updating analysis data:', e);
        }
    });
}

/**
 * Rebuild the locations aggregate store from locationVisits
 * Called after incremental updates to ensure counts are accurate
 */
async function rebuildLocationsAggregate() {
    if (!db) return;
    if (!db.objectStoreNames.contains('locationVisits')) return;
    
    const locations = new Map();
    
    // Iterate all location visits and aggregate
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['locationVisits'], 'readonly');
        const cursor = tx.objectStore('locationVisits').openCursor();
        
        cursor.onsuccess = (e) => {
            const result = e.target.result;
            if (result) {
                const v = result.value;
                if (locations.has(v.locationName)) {
                    const loc = locations.get(v.locationName);
                    loc.totalVisits += v.visitCount;
                    loc.totalDuration += v.duration;
                    if (v.dayKey < loc.firstVisit) loc.firstVisit = v.dayKey;
                    if (v.dayKey > loc.lastVisit) loc.lastVisit = v.dayKey;
                } else {
                    locations.set(v.locationName, {
                        name: v.locationName,
                        totalVisits: v.visitCount,
                        totalDuration: v.duration,
                        firstVisit: v.dayKey,
                        lastVisit: v.dayKey
                    });
                }
                result.continue();
            }
        };
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    
    // Write aggregated locations
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['locations'], 'readwrite');
        const store = tx.objectStore('locations');
        store.clear();
        
        for (const loc of locations.values()) {
            store.put(loc);
        }
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Rebuild aggregate activity totals from all dailySummaries.
 * Stores the result in the metadata store under key 'activityTotals'.
 * Structure: { walking: { count, duration, distance }, car: { ... }, ... }
 * Called after rebuild and after incremental import updates.
 */
async function rebuildActivityTotals() {
    if (!db || !db.objectStoreNames.contains('dailySummaries')) return;

    const totals = {};

    await new Promise((resolve, reject) => {
        const tx = db.transaction(['dailySummaries'], 'readonly');
        const req = tx.objectStore('dailySummaries').openCursor();

        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const stats = cursor.value.activityStats || {};
                for (const [activity, s] of Object.entries(stats)) {
                    if (!totals[activity]) {
                        totals[activity] = { count: 0, duration: 0, distance: 0 };
                    }
                    totals[activity].count += s.count || 0;
                    totals[activity].duration += s.duration || 0;
                    totals[activity].distance += s.distance || 0;
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
        req.onerror = () => reject(req.error);
    });

    await saveMetadata('activityTotals', totals);
    logDebug('📊 Activity totals updated:', Object.keys(totals).length, 'types');
}

// Analysis helper functions
function normalizeActivityTypeForAnalysis(type) {
    if (!type) return 'unknown';
    const t = type.toLowerCase();
    return t === 'automotive' ? 'car' : t;
}

function getDurationSecondsForAnalysis(start, end) {
    if (!start || !end) return 0;
    try { return Math.max(0, (new Date(end) - new Date(start)) / 1000); }
    catch { return 0; }
}

function calculateDistanceForAnalysis(samples) {
    if (!samples || samples.length < 2) return 0;
    
    // Extract valid GPS points (samples use sample.location.latitude/longitude)
    const validPoints = [];
    for (const sample of samples) {
        if (sample.location && 
            sample.location.latitude != null && 
            sample.location.longitude != null) {
            validPoints.push(sample.location);
        }
    }
    
    if (validPoints.length < 2) return 0;
    
    let total = 0;
    for (let i = 1; i < validPoints.length; i++) {
        const p1 = validPoints[i - 1], p2 = validPoints[i];
        const R = 6371000;
        const dLat = (p2.latitude - p1.latitude) * Math.PI / 180;
        const dLon = (p2.longitude - p1.longitude) * Math.PI / 180;
        const a = Math.sin(dLat/2) ** 2 + 
                  Math.cos(p1.latitude * Math.PI / 180) * Math.cos(p2.latitude * Math.PI / 180) * 
                  Math.sin(dLon/2) ** 2;
        total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }
    return total;
}

// Expose rebuild function to UI
window.rebuildAnalysisFromUI = async function() {
    // Analysis is now in a separate tab
    console.log('Analysis is now in a separate tab. Click the Analysis button.');
    window.toggleAnalysisPanel();
};

/**
 * Safer rebuild that continues on errors and reports progress per-day
 */
async function rebuildAnalysisDataSafe(onProgress) {
    if (!db) throw new Error('Database not initialized');
    if (!db.objectStoreNames.contains('dailySummaries')) throw new Error('dailySummaries store missing');
    
    logInfo('🔄 Safe rebuild starting...');
    
    // Clear existing
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['dailySummaries', 'locationVisits', 'locations'], 'readwrite');
        tx.objectStore('dailySummaries').clear();
        tx.objectStore('locationVisits').clear();
        tx.objectStore('locations').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    
    // Get all day keys only (not full data)
    const dayKeys = await new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const keys = [];
        const cursor = tx.objectStore('days').openCursor();
        cursor.onsuccess = (e) => {
            const c = e.target.result;
            if (c) {
                keys.push(c.key);
                c.continue();
            }
        };
        tx.oncomplete = () => resolve(keys.sort());
        tx.onerror = () => reject(tx.error);
    });
    
    const total = dayKeys.length;
    let processed = 0;
    let errors = 0;
    
    // Process one day at a time
    for (const dayKey of dayKeys) {
        try {
            // Load this day's data
            const dayRecord = await new Promise((resolve, reject) => {
                const tx = db.transaction(['days'], 'readonly');
                const req = tx.objectStore('days').get(dayKey);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            
            if (dayRecord && dayRecord.data) {
                await updateAnalysisDataForDaySafe(dayKey, dayRecord.data);
            }
            
            processed++;
            if (onProgress) onProgress(processed, total, dayKey, null);
            
        } catch (e) {
            processed++;
            errors++;
            logError(`Error processing ${dayKey}:`, e);
            if (onProgress) onProgress(processed, total, dayKey, e.message);
        }
        
        // Yield every 5 days (distance calculation is CPU-intensive)
        if (processed % 5 === 0) {
            await new Promise(r => setTimeout(r, 10));
        }
    }
    
    // Rebuild locations aggregate from location visits
    await rebuildLocationsAggregate();
    
    logInfo(`✅ Safe rebuild complete: ${processed} days, ${errors} errors`);
}

/**
 * Safe version that won't throw on bad data
 */
async function updateAnalysisDataForDaySafe(dayKey, dayData) {
    const items = dayData?.timelineItems || [];
    
    const summary = {
        dayKey,
        totalDistance: 0,
        totalDuration: 0,
        activityStats: {}
    };
    
    // Collect location visits
    const locationVisits = [];
    const locationMap = new Map();
    
    // Use shared containment detection
    const containedItemIds = findContainedItems(items);
    
    // Process items, skipping contained ones
    for (const item of items) {
        // Skip contained items
        if (containedItemIds.has(item.itemId || item.startDate)) {
            continue;
        }
        
        try {
            if (item.isVisit) {
                // Process location visit
                const name = item.place?.name || item.customTitle || item.streetAddress;
                if (!name) continue;
                
                const duration = getDurationSecondsForAnalysis(item.startDate, item.endDate);
                const visitTime = item.startDate ? new Date(item.startDate).toTimeString().slice(0, 5) : null;
                
                if (locationMap.has(name)) {
                    const existing = locationMap.get(name);
                    existing.duration += duration;
                    existing.visitCount++;
                } else {
                    locationMap.set(name, {
                        dayKey,
                        locationName: name,
                        duration,
                        visitCount: 1,
                        firstVisit: visitTime
                    });
                }
            } else {
                const activityType = normalizeActivityTypeForAnalysis(item.activityType);
                if (activityType === 'stationary' || activityType === 'unknown') continue;
                
                const duration = getDurationSecondsForAnalysis(item.startDate, item.endDate);
                // Calculate distance from samples (Arc doesn't store distance directly)
                const distance = item.samples ? calculateDistanceForAnalysis(item.samples) : 0;
                
                if (!summary.activityStats[activityType]) {
                    summary.activityStats[activityType] = { count: 0, duration: 0, distance: 0 };
                }
                
                summary.activityStats[activityType].count++;
                summary.activityStats[activityType].duration += duration;
                summary.activityStats[activityType].distance += distance;
                
                summary.totalDistance += distance;
                summary.totalDuration += duration;
            }
        } catch (e) {
            // Skip bad items
        }
    }
    
    // Convert location map to array
    for (const visit of locationMap.values()) {
        locationVisits.push(visit);
    }
    
    // Store summary and location visits
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['dailySummaries', 'locationVisits'], 'readwrite');
        tx.objectStore('dailySummaries').put(summary);
        
        // Add location visits
        const visitStore = tx.objectStore('locationVisits');
        for (const visit of locationVisits) {
            visitStore.add(visit);
        }
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Diagnostic function to check data structure
window.diagnoseAnalysisData = async function() {
    if (!db) { console.log('DB not initialized'); return; }
    
    // Get one day from days store
    const dayRecord = await new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const cursor = tx.objectStore('days').openCursor();
        cursor.onsuccess = (e) => {
            if (e.target.result) resolve(e.target.result.value);
            else resolve(null);
        };
        cursor.onerror = () => reject(cursor.error);
    });
    
    if (dayRecord) {
        console.log('=== SAMPLE DAY RECORD ===');
        console.log('dayKey:', dayRecord.dayKey);
        const items = dayRecord.data?.timelineItems || [];
        console.log('timelineItems count:', items.length);
        
        // Count visits vs activities
        const visits = items.filter(i => i.isVisit);
        const activities = items.filter(i => !i.isVisit);
        console.log('Visits (isVisit=true):', visits.length);
        console.log('Activities (isVisit=false/undefined):', activities.length);
        
        // Check for place data
        const withPlace = items.filter(i => i.place);
        console.log('Items with place property:', withPlace.length);
        
        const firstActivity = items.find(i => !i.isVisit);
        if (firstActivity) {
            console.log('=== FIRST ACTIVITY ===');
            console.log('All keys:', Object.keys(firstActivity));
            console.log('activityType:', firstActivity.activityType);
            console.log('samples count:', firstActivity.samples?.length);
            
            // Show first sample structure
            if (firstActivity.samples?.length > 0) {
                console.log('=== FIRST SAMPLE STRUCTURE ===');
                console.log('Sample keys:', Object.keys(firstActivity.samples[0]));
                console.log('Full sample:', JSON.stringify(firstActivity.samples[0], null, 2));
            }
            
            // TEST: Calculate distance from samples
            if (firstActivity.samples?.length > 1) {
                const calcDist = calculateDistanceForAnalysis(firstActivity.samples);
                console.log('=== CALCULATED DISTANCE ===');
                console.log('From samples:', calcDist, 'meters');
                console.log('In km:', (calcDist / 1000).toFixed(2), 'km');
            }
        }
        
        // Show first visit
        const firstVisit = visits[0];
        if (firstVisit) {
            console.log('=== FIRST VISIT ===');
            console.log('All keys:', Object.keys(firstVisit));
            console.log('isVisit:', firstVisit.isVisit);
            console.log('place:', firstVisit.place);
            console.log('customTitle:', firstVisit.customTitle);
            console.log('streetAddress:', firstVisit.streetAddress);
        } else {
            console.log('=== NO VISITS FOUND ===');
            // Check if any items have place data even without isVisit
            if (withPlace.length > 0) {
                console.log('But found item with place:', withPlace[0]);
            }
        }
    }
    
    // Get one summary
    const summary = await new Promise((resolve, reject) => {
        const tx = db.transaction(['dailySummaries'], 'readonly');
        const cursor = tx.objectStore('dailySummaries').openCursor();
        cursor.onsuccess = (e) => {
            if (e.target.result) resolve(e.target.result.value);
            else resolve(null);
        };
        cursor.onerror = () => reject(cursor.error);
    });
    
    if (summary) {
        console.log('=== SAMPLE SUMMARY ===');
        console.log('dayKey:', summary.dayKey);
        console.log('totalDistance:', summary.totalDistance);
        console.log('totalDuration:', summary.totalDuration);
        console.log('activityStats:', summary.activityStats);
    } else {
        console.log('No summaries found - run Rebuild');
    }
    
    // Check location stores
    const locationCount = await new Promise((resolve, reject) => {
        const tx = db.transaction(['locations'], 'readonly');
        const req = tx.objectStore('locations').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    console.log('=== LOCATIONS STORE ===');
    console.log('Total locations:', locationCount);
    
    const visitCount = await new Promise((resolve, reject) => {
        const tx = db.transaction(['locationVisits'], 'readonly');
        const req = tx.objectStore('locationVisits').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    console.log('Total location visits:', visitCount);
    
    return { dayRecord, summary, locationCount, visitCount };
};

// Inspect raw data for a specific day - helps diagnose GPS data issues
window.inspectDay = async function(dayKey) {
    if (!db) { console.log('DB not initialized'); return; }
    if (!dayKey) {
        console.log('Usage: inspectDay("2016-01-05")');
        return;
    }

    // Get day record from DB
    const dayRecord = await new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const req = tx.objectStore('days').get(dayKey);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (!dayRecord) {
        console.log(`❌ No data found for ${dayKey}`);
        return null;
    }

    console.log(`\n========== RAW DATA FOR ${dayKey} ==========`);
    console.log('Source file:', dayRecord.sourceFile || 'unknown');
    console.log('Last updated:', dayRecord.lastUpdated ? new Date(dayRecord.lastUpdated).toISOString() : 'unknown');

    const items = dayRecord.data?.timelineItems || [];
    console.log(`\nTotal timeline items: ${items.length}`);

    // Analyze each item
    console.log('\n--- TIMELINE ITEMS ---');
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const type = item.isVisit ? 'VISIT' : 'ACTIVITY';
        const actType = item.activityType || 'unknown';
        const name = item.place?.name || item.customTitle || item.streetAddress || '(unnamed)';
        const samplesCount = item.samples?.length || 0;
        const hasCenter = item.center ? 'yes' : 'no';

        console.log(`\n[${i}] ${type}: ${actType}`);
        console.log(`    Name: ${name}`);
        console.log(`    Start: ${item.startDate}`);
        console.log(`    End: ${item.endDate}`);
        console.log(`    Samples: ${samplesCount}`);
        console.log(`    Has center: ${hasCenter}`);
        if (item.center) {
            console.log(`    Center: ${item.center.latitude?.toFixed(6)}, ${item.center.longitude?.toFixed(6)}`);
        }
        console.log(`    itemId: ${item.itemId}`);

        // Show sample details for activities
        if (!item.isVisit) {
            if (samplesCount > 0) {
                const firstSample = item.samples[0];
                const lastSample = item.samples[samplesCount - 1];
                console.log(`    First sample keys: ${Object.keys(firstSample).join(', ')}`);

                // Check sample structure
                if (firstSample.location) {
                    console.log(`    Sample format: location.latitude/longitude`);
                    console.log(`    First: ${firstSample.location.latitude?.toFixed(6)}, ${firstSample.location.longitude?.toFixed(6)}`);
                    console.log(`    Last: ${lastSample.location.latitude?.toFixed(6)}, ${lastSample.location.longitude?.toFixed(6)}`);
                } else if (firstSample.latitude) {
                    console.log(`    Sample format: direct latitude/longitude`);
                    console.log(`    First: ${firstSample.latitude?.toFixed(6)}, ${firstSample.longitude?.toFixed(6)}`);
                    console.log(`    Last: ${lastSample.latitude?.toFixed(6)}, ${lastSample.longitude?.toFixed(6)}`);
                } else {
                    console.log(`    ⚠️ Unknown sample format!`);
                    console.log(`    Raw first sample:`, JSON.stringify(firstSample, null, 2));
                }
            } else {
                console.log(`    ⚠️ NO GPS SAMPLES - this will show [NO GPS] tag`);
            }
        }
    }

    // Summary
    const visits = items.filter(i => i.isVisit);
    const activities = items.filter(i => !i.isVisit);
    const activitiesWithSamples = activities.filter(i => i.samples?.length > 0);
    const activitiesWithoutSamples = activities.filter(i => !i.samples || i.samples.length === 0);

    console.log('\n--- SUMMARY ---');
    console.log(`Visits: ${visits.length}`);
    console.log(`Activities: ${activities.length}`);
    console.log(`  - With GPS samples: ${activitiesWithSamples.length}`);
    console.log(`  - Without GPS samples: ${activitiesWithoutSamples.length} ⚠️`);

    if (activitiesWithoutSamples.length > 0) {
        console.log('\n--- ACTIVITIES WITHOUT GPS ---');
        activitiesWithoutSamples.forEach((item, i) => {
            console.log(`  ${i + 1}. ${item.activityType || 'unknown'} at ${item.startDate}`);
        });
    }

    // Return the raw data for further inspection
    console.log('\n💡 Full data returned - access with: data = await inspectDay("' + dayKey + '")');
    return dayRecord;
};

console.log('💡 Run diagnoseAnalysisData() in console to check data structure');
console.log('💡 Run inspectDay("2016-01-05") to inspect raw data for a specific day');
console.log('💡 Run inspectBackupDay("2016-01-05") after selecting backup folder to inspect raw backup files');
console.log('💡 Run diagnosePlaces("2016-01-05") to check place name resolution for a day');
console.log('💡 Run deleteDay("2016-01-05") to delete a specific day from the database');

// Diagnose place name resolution for a specific day
window.diagnosePlaces = async function(dayKey) {
    if (!db) { console.log('DB not initialized'); return; }
    if (!dayKey) {
        console.log('Usage: diagnosePlaces("2025-09-06")');
        return;
    }

    const dayRecord = await new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const req = tx.objectStore('days').get(dayKey);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (!dayRecord) {
        console.log(`❌ No data found for ${dayKey}`);
        return;
    }

    console.log(`\n========== PLACE DIAGNOSIS FOR ${dayKey} ==========`);
    console.log(`placesById has ${Object.keys(placesById).length} entries`);

    const items = dayRecord.data?.timelineItems || [];
    const visits = items.filter(i => i.isVisit);

    console.log(`\n--- VISITS (${visits.length}) ---`);
    for (const item of visits) {
        const pid = item.placeId;
        const placeName = item.place?.name;
        const customTitle = item.customTitle;
        const streetAddress = item.streetAddress;
        const inPlacesById = pid ? (placesById[pid] || placesById[String(pid)]) : null;

        console.log(`\nVisit at ${item.startDate}:`);
        console.log(`  placeId: ${pid || 'NONE'}`);
        console.log(`  item.place?.name: ${placeName || 'NONE'}`);
        console.log(`  customTitle: ${customTitle || 'NONE'}`);
        console.log(`  streetAddress: ${streetAddress || 'NONE'}`);
        console.log(`  placesById[placeId]: ${inPlacesById || 'NOT FOUND'}`);

        if (pid && !inPlacesById && !placeName && !customTitle && !streetAddress) {
            console.log(`  ⚠️ NO NAME RESOLUTION - will show "Location X"`);
        }
    }

    // Check activities too
    const activities = items.filter(i => !i.isVisit);
    console.log(`\n--- ACTIVITIES (${activities.length}) ---`);
    for (const item of activities) {
        const actType = item.activityType || 'unknown';
        const samples = item.samples?.length || 0;
        console.log(`${item.startDate}: ${actType} (${samples} samples)`);
    }

    return { dayRecord, placesById };
};

// Delete a specific day from the database
window.deleteDay = async function(dayKey) {
    if (!db) { console.log('❌ DB not initialized'); return; }
    if (!dayKey) {
        console.log('Usage: deleteDay("2025-09-06")');
        return;
    }

    // Check if day exists
    const dayRecord = await new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const req = tx.objectStore('days').get(dayKey);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    if (!dayRecord) {
        console.log(`❌ No data found for ${dayKey}`);
        return;
    }

    const items = dayRecord.data?.timelineItems || [];
    const visits = items.filter(i => i.isVisit).length;
    const activities = items.filter(i => !i.isVisit).length;

    console.log(`\n⚠️ About to delete ${dayKey}:`);
    console.log(`   ${visits} visits, ${activities} activities`);
    console.log(`\nTo confirm deletion, run: confirmDeleteDay("${dayKey}")`);

    // Set up confirmation function
    window.confirmDeleteDay = async function(confirmKey) {
        if (confirmKey !== dayKey) {
            console.log(`❌ Key mismatch. Expected "${dayKey}", got "${confirmKey}"`);
            return;
        }

        try {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(['days'], 'readwrite');
                const req = tx.objectStore('days').delete(dayKey);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });

            console.log(`✅ Successfully deleted ${dayKey}`);
            console.log('💡 Refresh the page or select another date to see changes');

            // Clean up confirmation function
            delete window.confirmDeleteDay;
        } catch (err) {
            console.log(`❌ Error deleting ${dayKey}:`, err);
        }
    };
};

// Inspect raw backup files for a specific day (must call selectBackupFolder first)
// This reads directly from the iCloud backup without importing
window.inspectBackupDay = async function(dayKey) {
    if (!window._lastBackupDirHandle) {
        console.log('❌ No backup folder selected. Run selectBackupFolder() first, then try again.');
        return;
    }
    if (!dayKey) {
        console.log('Usage: inspectBackupDay("2016-01-05")');
        return;
    }

    const dirHandle = window._lastBackupDirHandle;
    console.log(`\n========== INSPECTING BACKUP FOR ${dayKey} ==========`);

    try {
        // Get TimelineItem directory
        const timelineDir = await dirHandle.getDirectoryHandle('TimelineItem');
        console.log('✅ Found TimelineItem directory');

        // Get LocomotionSample directory
        let sampleDir = null;
        try {
            sampleDir = await dirHandle.getDirectoryHandle('LocomotionSample');
            console.log('✅ Found LocomotionSample directory');
        } catch {
            console.log('⚠️ No LocomotionSample directory found');
        }

        // Find timeline items for this day
        console.log(`\nSearching for timeline items on ${dayKey}...`);
        const dayItems = [];
        let scanned = 0;

        for await (const fileHandle of readJsonFilesFromHexDirs(timelineDir)) {
            const item = await readFileAsJson(fileHandle);
            scanned++;
            if (!item || !item.startDate) continue;

            const itemDayKey = getLocalDayKey(item.startDate);
            if (itemDayKey === dayKey) {
                dayItems.push(item);
            }

            if (scanned % 5000 === 0) {
                console.log(`  Scanned ${scanned} items...`);
            }
        }

        console.log(`\nFound ${dayItems.length} timeline items for ${dayKey}`);

        // Check each item
        for (const item of dayItems) {
            const type = item.isVisit ? 'VISIT' : 'ACTIVITY';
            console.log(`\n[${type}] ${item.activityType || 'stationary'}`);
            console.log(`  itemId: ${item.itemId}`);
            console.log(`  Start: ${item.startDate}`);
            console.log(`  End: ${item.endDate}`);

            // Check if item has embedded samples
            if (item.samples && item.samples.length > 0) {
                console.log(`  ✅ Has ${item.samples.length} EMBEDDED samples in TimelineItem`);
                console.log(`  First sample:`, JSON.stringify(item.samples[0], null, 2));
            } else {
                console.log(`  ❌ No embedded samples in TimelineItem`);
            }

            // Check all properties
            console.log(`  All properties: ${Object.keys(item).join(', ')}`);
        }

        // Check LocomotionSample files for this week
        if (sampleDir && dayItems.length > 0) {
            const weekKey = getISOWeek(dayKey);
            console.log(`\nChecking LocomotionSample for week ${weekKey}...`);

            const itemIds = new Set(dayItems.map(i => i.itemId));
            let foundSamples = 0;
            let samplesForDay = new Map();

            for await (const entry of sampleDir.values()) {
                if (entry.kind !== 'file') continue;

                // Check for both .json.gz and .json files
                const isGz = entry.name.endsWith('.json.gz');
                const isJson = entry.name.endsWith('.json') && !isGz;

                if (!isGz && !isJson) continue;

                // Check if this is the right week
                const weekMatch = entry.name.match(/^(\d{4}-W\d{2})/);
                if (!weekMatch) continue;

                console.log(`  Found sample file: ${entry.name}`);

                let samples;
                if (isGz) {
                    samples = await readGzippedFileAsJson(entry);
                } else {
                    const file = await entry.getFile();
                    const text = await file.text();
                    samples = JSON.parse(text);
                }

                if (Array.isArray(samples)) {
                    console.log(`    Contains ${samples.length} total samples`);

                    for (const sample of samples) {
                        if (sample.timelineItemId && itemIds.has(sample.timelineItemId)) {
                            foundSamples++;
                            if (!samplesForDay.has(sample.timelineItemId)) {
                                samplesForDay.set(sample.timelineItemId, []);
                            }
                            samplesForDay.get(sample.timelineItemId).push(sample);
                        }
                    }
                }
            }

            console.log(`\nFound ${foundSamples} samples for ${dayKey} items`);
            for (const [itemId, samples] of samplesForDay) {
                const item = dayItems.find(i => i.itemId === itemId);
                console.log(`  ${item?.activityType || 'unknown'}: ${samples.length} samples`);
            }

            // List items that have NO samples anywhere
            const itemsWithoutSamples = dayItems.filter(i => !i.isVisit && !samplesForDay.has(i.itemId));
            if (itemsWithoutSamples.length > 0) {
                console.log(`\n⚠️ Activities with NO samples in backup:`);
                for (const item of itemsWithoutSamples) {
                    console.log(`  - ${item.activityType} at ${item.startDate} (${item.itemId})`);
                }
            }
        }

        return dayItems;

    } catch (err) {
        console.error('Error inspecting backup:', err);
        return null;
    }
};

// Rebuild diary notes for a month from stored raw data (no re-import needed)
window.rebuildDiaryNotesFromRawData = async function(monthKey = currentMonth) {
    if (!db) { console.log('DB not initialized'); return; }
    if (!monthKey) { console.log('No month selected'); return; }

    let dayRecords = await getMonthDaysFromDB(monthKey);
    if (!dayRecords || dayRecords.length === 0) {
        // Fallback: month index missing; derive days by key prefix
        const allDayKeys = await getAllDayKeysFromDB();
        const monthDayKeys = allDayKeys.filter(dk => dk.startsWith(monthKey + '-'));
        dayRecords = [];
        for (const dk of monthDayKeys) {
            const rec = await getDayFromDB(dk);
            if (rec) dayRecords.push(rec);
        }
    }
    if (!dayRecords || dayRecords.length === 0) {
        console.log('No day records for', monthKey);
        return;
    }

    let updated = 0;
    for (const rec of dayRecords) {
        const data = rec.data;
        if (!data || !data._rawData) continue;
        const sourceFile = rec.sourceFile || 'json-import';
        const notes = extractNotesFromData(data._rawData, rec.dayKey, sourceFile);
        data.notes = notes;

        await new Promise((resolve, reject) => {
            const tx = db.transaction(['days'], 'readwrite');
            tx.objectStore('days').put({
                dayKey: rec.dayKey,
                monthKey: rec.monthKey,
                lastUpdated: rec.lastUpdated,
                sourceFile: rec.sourceFile,
                contentHash: rec.contentHash,
                data: data
            });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        updated++;
        if (updated % 50 === 0) {
            console.log(`Rebuilt notes: ${updated}/${dayRecords.length}`);
        }
    }

    // Refresh in-memory diary if loaded
    if (_diaries()[monthKey]?.monthData?.days) {
        for (const rec of dayRecords) {
            const dayData = _diaries()[monthKey].monthData.days[rec.dayKey];
            if (dayData) {
                dayData.notes = rec.data?.notes || dayData.notes;
            }
        }
        if (_ui.displayDiary) _ui.displayDiary(monthKey, true);
        if (_ui.updateStatsForCurrentView) setTimeout(() => _ui.updateStatsForCurrentView(), 10);
    }

    console.log(`Rebuilt diary notes for ${updated} days in ${monthKey}`);
};

// Helper: list months present in the days store (derived from day keys)
window.listMonthsFromDays = async function() {
    if (!db) { console.log('DB not initialized'); return; }
    const allDayKeys = await getAllDayKeysFromDB();
    const months = Array.from(new Set(allDayKeys.map(dk => dk.substring(0, 7)))).sort();
    console.log('Months from day keys:', months);
    return months;
};

// Helper: rebuild notes for a single day (for targeted fixes)
window.rebuildDiaryNotesForDay = async function(dayKey) {
    if (!db) { console.log('DB not initialized'); return; }
    if (!dayKey) { console.log('No dayKey provided'); return; }
    const rec = await getDayFromDB(dayKey);
    if (!rec || !rec.data || !rec.data._rawData) {
        console.log('No raw data for day', dayKey);
        return;
    }
    const sourceFile = rec.sourceFile || 'json-import';
    const notes = extractNotesFromData(rec.data._rawData, dayKey, sourceFile);
    rec.data.notes = notes;

    await new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readwrite');
        tx.objectStore('days').put(rec);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    if (_diaries()[rec.monthKey]?.monthData?.days?.[dayKey]) {
        _diaries()[rec.monthKey].monthData.days[dayKey].notes = notes;
        if (_ui.displayDiary) _ui.displayDiary(rec.monthKey, true);
        if (_ui.updateStatsForCurrentView) setTimeout(() => _ui.updateStatsForCurrentView(), 10);
    }

    console.log('Rebuilt notes for day', dayKey);
};

// Rebuild notes for a day using stored timelineItems (backup imports don't keep _rawData)
window.rebuildDiaryNotesForDayFromStoredTimeline = async function(dayKey) {
    if (!db) { console.log('DB not initialized'); return; }
    if (!dayKey) { console.log('No dayKey provided'); return; }
    const rec = await getDayFromDB(dayKey);
    if (!rec || !rec.data || !rec.data.timelineItems) {
        console.log('No timelineItems for day', dayKey);
        return;
    }
    const sourceFile = rec.sourceFile || 'backup-import';
    const notes = extractNotesFromData({ timelineItems: rec.data.timelineItems }, dayKey, sourceFile);
    rec.data.notes = notes;

    await new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readwrite');
        tx.objectStore('days').put(rec);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    if (_diaries()[rec.monthKey]?.monthData?.days?.[dayKey]) {
        _diaries()[rec.monthKey].monthData.days[dayKey].notes = notes;
        if (_ui.displayDiary) _ui.displayDiary(rec.monthKey, true);
        if (_ui.updateStatsForCurrentView) setTimeout(() => _ui.updateStatsForCurrentView(), 10);
    }

    console.log('Rebuilt notes from stored timeline for day', dayKey);
};

// Rebuild notes for a month using stored timelineItems
window.rebuildDiaryNotesFromStoredTimeline = async function(monthKey = currentMonth) {
    if (!db) { console.log('DB not initialized'); return; }
    if (!monthKey) { console.log('No month selected'); return; }

    let dayRecords = await getMonthDaysFromDB(monthKey);
    if (!dayRecords || dayRecords.length === 0) {
        const allDayKeys = await getAllDayKeysFromDB();
        const monthDayKeys = allDayKeys.filter(dk => dk.startsWith(monthKey + '-'));
        dayRecords = [];
        for (const dk of monthDayKeys) {
            const rec = await getDayFromDB(dk);
            if (rec) dayRecords.push(rec);
        }
    }
    if (!dayRecords || dayRecords.length === 0) {
        console.log('No day records for', monthKey);
        return;
    }

    // Build spanning visit index (to restore visits that span into a day)
    const prevMonthKey = getPreviousMonthKey(monthKey);
    let prevMonthRecords = [];
    if (prevMonthKey) {
        prevMonthRecords = await getMonthDaysFromDB(prevMonthKey);
    }

    const spanningVisitsIndex = new Map();
    const addSpanningVisit = (visit) => {
        const startDay = getLocalDayKey(visit.startDate);
        const endDay = getLocalDayKey(visit.endDate);
        if (!startDay || !endDay || endDay <= startDay) return;
        let currentDay = startDay;
        while (true) {
            const nextDate = new Date(currentDay + 'T12:00:00');
            nextDate.setDate(nextDate.getDate() + 1);
            currentDay = nextDate.toISOString().substring(0, 10);
            if (currentDay > endDay) break;
            if (!spanningVisitsIndex.has(currentDay)) spanningVisitsIndex.set(currentDay, []);
            spanningVisitsIndex.get(currentDay).push(visit);
        }
    };

    const collectSpanning = (records) => {
        for (const rec of records) {
            const items = rec?.data?.timelineItems || [];
            for (const item of items) {
                if (!item.isVisit || !item.startDate || !item.endDate) continue;
                const startDay = getLocalDayKey(item.startDate);
                const endDay = getLocalDayKey(item.endDate);
                if (startDay && endDay && endDay > startDay) {
                    addSpanningVisit(item);
                }
            }
        }
    };

    collectSpanning(dayRecords);
    collectSpanning(prevMonthRecords);

    let updated = 0;
    for (const rec of dayRecords) {
        if (!rec.data || !rec.data.timelineItems) continue;
        const sourceFile = rec.sourceFile || 'backup-import';
        const mergedItems = [...rec.data.timelineItems];
        const spanVisits = spanningVisitsIndex.get(rec.dayKey) || [];
        if (spanVisits.length > 0) {
            const existingIds = new Set(mergedItems.map(i => i.itemId));
            for (const v of spanVisits) {
                if (!existingIds.has(v.itemId)) {
                    mergedItems.push(v);
                }
            }
        }

        const notes = extractNotesFromData({ timelineItems: mergedItems }, rec.dayKey, sourceFile);
        rec.data.notes = notes;

        await new Promise((resolve, reject) => {
            const tx = db.transaction(['days'], 'readwrite');
            tx.objectStore('days').put(rec);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        updated++;
        if (updated % 50 === 0) {
            console.log(`Rebuilt notes: ${updated}/${dayRecords.length}`);
        }
    }

    if (_diaries()[monthKey]?.monthData?.days) {
        for (const rec of dayRecords) {
            const dayData = _diaries()[monthKey].monthData.days[rec.dayKey];
            if (dayData) {
                dayData.notes = rec.data?.notes || dayData.notes;
            }
        }
        if (_ui.displayDiary) _ui.displayDiary(monthKey, true);
        if (_ui.updateStatsForCurrentView) setTimeout(() => _ui.updateStatsForCurrentView(), 10);
    }

    console.log(`Rebuilt notes from stored timeline for ${updated} days in ${monthKey}`);
};

// Export database to JSON (for backup/portability)
// Uses cursor streaming to avoid loading 300MB+ at once
async function exportDatabaseToJSON() {
    if (!db) return null;

    // Stream days using cursor - collects into array but yields to UI
    const days = [];
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['days'], 'readonly');
        const store = tx.objectStore('days');
        const req = store.openCursor();

        req.onsuccess = async (event) => {
            const cursor = event.target.result;
            if (cursor) {
                days.push(cursor.value);
                // Yield to main thread every 100 days to prevent UI freeze
                if (days.length % 100 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
        req.onerror = () => reject(req.error);
    });

    const months = await getAllMonthsFromDB();

    // Include events and favorites in backup
    const eventsData = exportEventsData();

    return {
        version: VERSION,
        build: BUILD,
        exportDate: new Date().toISOString(),
        dayCount: days.length,
        monthCount: months.length,
        days,
        months,
        // Include events (new in Build 696+)
        events: eventsData.events,
        eventCategories: eventsData.categories,
        // Include favorites
        favorites: favorites
    };
}

// Clear entire database
async function clearDatabase() {
    if (!db) return;
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['days', 'months', 'metadata'], 'readwrite');
        
        tx.objectStore('days').clear();
        tx.objectStore('months').clear();
        tx.objectStore('metadata').clear();
        
        tx.oncomplete = () => {
            logDebug('✅ Database cleared');
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}

    // ========================================
    // UI Callback Registration
    // ========================================

    /**
     * Called by app.js after load to wire up UI callbacks.
     * Avoids circular dependency (DB layer → UI functions).
     */
    function setUICallbacks(callbacks) {
        if (callbacks.updateDBStatusDisplay) _ui.updateDBStatusDisplay = callbacks.updateDBStatusDisplay;
        if (callbacks.displayDiary) _ui.displayDiary = callbacks.displayDiary;
        if (callbacks.updateStatsForCurrentView) _ui.updateStatsForCurrentView = callbacks.updateStatsForCurrentView;
    }

    // ========================================
    // Module Export
    // ========================================

    window.ArcDB = {
        // Init & config
        initDatabase,
        setUICallbacks,
        getDBStats,

        // Metadata
        saveMetadata,
        getMetadata,

        // Day CRUD
        getDayFromDB,
        getAllDayKeysFromDB,
        getMonthDaysFromDB,
        getAllMonthsFromDB,
        saveMonthToDB,

        // Utility
        getLocalDayKey,
        getPreviousDayKey,
        getPreviousMonthKey,

        // Database operations
        clearDatabase,
        exportDatabaseToJSON,

        // Filtering
        filterGhostItems,
        findContainedItems,
        applyImportFixes,

        // Place names & activity types
        getStoredDisplayNameForTimelineItem,
        getStoredActivityTypeForTimelineItem,
        loadPlacesFromSelectedFiles,
        applyPlaceNamesToDayData,
        applyActivityTypeFixesToDayData,
        inferActivityTypeFromSamples,

        // Analysis
        updateAnalysisDataForDay,
        updateAnalysisDataForDaySafe,
        rebuildAnalysisData,
        rebuildAnalysisDataSafe,
        checkAndRebuildAnalysisData,
        checkAnalysisDataIntegrity,
        startAnalysisRebuild,
        updateAnalysisDataInBackground,
        rebuildLocationsAggregate,
        rebuildActivityTotals,
        updateAnalysisButtonIndicator,
        calculateDistanceForAnalysis,
        normalizeActivityTypeForAnalysis,
        getDurationSecondsForAnalysis,
    };

    logInfo(`📦 Loaded arc-db.js`);

})();
