// =====================================================
// Logging (Build 287): keep only essential logs by default
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
        // IndexedDB Storage Layer (v3.0)
        // ========================================
        
        const DB_NAME = 'ArcTimelineDiary';
        const DB_VERSION = 2;  // Must stay at v2 - can't downgrade
        let db = null;
        let _dbReadyResolve = null;
        const dbReadyPromise = new Promise(resolve => { _dbReadyResolve = resolve; });
        
        // Initialize IndexedDB
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
        let placesById = {}; // { placeId: "Display Name" }

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
            ready: dbReadyPromise,
            
            // Get a single day by dayKey (YYYY-MM-DD)
            async getDay(dayKey) {
                await dbReadyPromise;
                return getDayFromDB(dayKey);
            },
            
            // Get all days in a range (inclusive, YYYY-MM-DD format)
            async getDaysInRange(startDayKey, endDayKey) {
                await dbReadyPromise;
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
                await dbReadyPromise;
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
                await dbReadyPromise;
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(['days', 'metadata'], 'readwrite');
                    const daysStore = tx.objectStore('days');
                    const metaStore = tx.objectStore('metadata');
                    
                    const deleteRequest = daysStore.delete(dayKey);
                    
                    deleteRequest.onsuccess = () => {
                        logDebug(`🗑️ Deleted ${dayKey} from IndexedDB`);
                        
                        // Also clear from generatedDiaries cache
                        const monthKey = dayKey.substring(0, 7);
                        if (generatedDiaries[monthKey]) {
                            delete generatedDiaries[monthKey].days[dayKey];
                            delete generatedDiaries[monthKey].locationsByDay[dayKey];
                            delete generatedDiaries[monthKey].routesByDay[dayKey];
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
                await dbReadyPromise;
                const monthKey = dayKey.substring(0, 7);
                const routes = generatedDiaries[monthKey]?.routesByDay?.[dayKey];
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
                await dbReadyPromise;
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
                await dbReadyPromise;
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
        
        /**
         * Generate a simple content hash for a day's timeline items
         * Captures user-editable properties: item count, activity types, place IDs, notes
         * This detects changes like car→walk, place reassignment, merging/deleting, adding notes
         */
        function generateDayHash(dayData) {
            const items = dayData?.timelineItems || [];
            if (items.length === 0) return 'empty';

            // Build a string from properties that users can edit in Arc:
            // - Activity type (car, walk, cycling, etc.)
            // - Place assignment (placeId)
            // - Notes (noteId presence indicates a note exists)
            // - Item count (changes when merging/deleting)
            const parts = items.map(item => {
                const type = item.activityType || (item.isVisit ? 'visit' : 'trip');
                const placeId = item.placeId ?? item.place?.placeId ?? item.place?.id;
                const place = placeId ? String(placeId).slice(0, 8) : '';
                const hasNote = item.noteId ? 'N' : '';
                return `${type}:${place}:${hasNote}`;
            });

            return parts.join('|');
        }

        // Import day data to IndexedDB (with content hash comparison)
        // existingMetadata: optional Map<dayKey, {lastUpdated, contentHash}> for O(1) lookups
        // If not provided, falls back to individual DB query (slower)
        // Content comparison: uses hash to detect actual changes
        async function importDayToDB(dayKey, monthKey, dayData, sourceFile, lastUpdated, existingMetadata = null) {
            if (!db) throw new Error('Database not initialized');

            // Check if day exists and compare content hash
            // Use pre-loaded Map if available (fast), otherwise query DB (slow)
            let existingMeta = null;
            let dayExists = false;

            if (existingMetadata) {
                // O(1) Map lookup - fast!
                existingMeta = existingMetadata.get(dayKey);
                dayExists = existingMeta !== undefined;
            } else {
                // Individual DB query - slow fallback
                const existing = await getDayFromDB(dayKey);
                if (existing) {
                    existingMeta = {
                        lastUpdated: existing.lastUpdated,
                        // Use stored hash if available, compute for old records without it
                        contentHash: existing.contentHash || generateDayHash(existing.data)
                    };
                    dayExists = true;
                }
            }

            if (dayExists) {
                const newHash = generateDayHash(dayData);

                // Skip only if content hash matches - no meaningful changes
                // Hash captures: item count, activity types, place IDs, notes
                // This detects: car→walk, place reassignment, merging/deleting, adding notes
                if (existingMeta.contentHash === newHash) {
                    return { action: 'skipped', dayKey, reason: 'content unchanged' };
                }
            }

            // Compute hash for the new data to store with the record
            const contentHash = generateDayHash(dayData);

            return new Promise((resolve, reject) => {
                const tx = db.transaction(['days'], 'readwrite');
                const store = tx.objectStore('days');

                const dayRecord = {
                    dayKey,
                    monthKey,
                    lastUpdated,
                    sourceFile,
                    contentHash,
                    data: dayData // Store entire day's notes/routes
                };

                store.put(dayRecord);

                tx.oncomplete = () => {
                    const action = dayExists ? 'updated' : 'added';
                    resolve({ action, dayKey });
                };

                tx.onerror = () => reject(tx.error);
            });
        }
        
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
        
        // Get day metadata from IndexedDB for import comparison
        // Uses stored contentHash when available, falls back to computing for old records
        // Returns Map<dayKey, {lastUpdated, contentHash}> for O(1) lookups
        async function getDayMetadataFromDB() {
            if (!db) return new Map();

            return new Promise((resolve, reject) => {
                const metadata = new Map();
                const tx = db.transaction(['days'], 'readonly');
                const store = tx.objectStore('days');
                const req = store.openCursor();

                req.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const day = cursor.value;
                        metadata.set(day.dayKey, {
                            lastUpdated: day.lastUpdated,
                            // Use stored hash if available, compute for old records without it
                            contentHash: day.contentHash || generateDayHash(day.data)
                        });
                        cursor.continue();
                    } else {
                        resolve(metadata);
                    }
                };
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

            // If no items without samples, return original
            if (withoutSamples.length === 0) return items;

            // Check each 0-sample item for overlap with items that have samples
            const ghostIds = new Set();

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

            // Return items with ghosts filtered out
            if (ghostIds.size === 0) return items;

            return items.filter(item => {
                const itemId = item.itemId || item.startDate;
                return !ghostIds.has(itemId);
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

            let lastSignificantEnd = 0;

            // Main pass: Track containers and mark contained items
            // Any item can be a container - Arc defines what's meaningful
            // Contained = item that STARTS AND ENDS within the container's timespan
            // Items that start inside but end outside are departure trips (show them!)
            // This hides: brief stops during trips, GPS gaps, noise inside visits, etc.
            for (let i = 0; i < sortedItems.length; i++) {
                const item = sortedItems[i];
                if (!item.startDate) continue;

                const itemId = item.itemId || item.startDate;
                const itemStart = new Date(item.startDate).getTime();
                const itemEnd = item.endDate ? new Date(item.endDate).getTime() : itemStart;
                const durationMs = itemEnd - itemStart;

                // Check if this item is contained (skip items with customTitle)
                // Only check if a container has been established (lastSignificantEnd > 0)
                // Key rule: item must START AND END within the container to be hidden
                // If item starts inside but ends outside, it's a departure trip (show it!)
                // E.g., walking inside Garden City = hidden, car trip leaving Garden City = shown
                if (!item.customTitle && lastSignificantEnd > 0 && itemStart < lastSignificantEnd) {
                    // Only hide if the item ALSO ends within the container
                    if (itemEnd <= lastSignificantEnd) {
                        containedIds.add(itemId);
                        continue; // Don't let contained items become containers
                    }
                    // Item ends after container - it's a departure, show it
                    // Update container end to this item's start to allow subsequent items
                    lastSignificantEnd = itemStart;
                }

                // This item becomes a container - any item Arc defines can contain noise
                if (itemEnd > lastSignificantEnd) {
                    lastSignificantEnd = itemEnd;
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
            
            // Rebuild locations aggregate
            await rebuildLocationsAggregate();
            
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
                updateDBStatusDisplay();
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
                    
                    // Update locations aggregate after all visits are processed
                    await rebuildLocationsAggregate();
                    
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
        // End IndexedDB Layer
        // ========================================
        
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
        
        // Import files to IndexedDB with sync logic
        async function importFilesToDatabase() {
            // Delegate to import module if available
            if (window.ArcImport?.importFilesToDatabase) {
                return window.ArcImport.importFilesToDatabase();
            }

            // Fallback: original implementation (kept for compatibility)
            if (!selectedFiles.length) {
                alert('Please select a folder containing daily JSON files');
                return;
            }

            cancelProcessing = false;

            // Hide the import tile and show the log report
            const fileInputSection = document.getElementById('fileInputSection');
            if (fileInputSection) fileInputSection.style.display = 'none';

            progress.style.display = 'block';
            cancelBtn.style.display = 'block';
            logDiv.style.display = 'block'; // Show the log!
            logDiv.innerHTML = '';

            // Clear previous import tags (will be replaced with new ones)
            importAddedDays = [];
            importUpdatedDays = [];
            importChangedItemIds = new Set();

            // Memory flush: encourage GC before import to help Safari keep file handles
            // Safari may release blob URLs when under memory pressure
            if (typeof window.gc === 'function') {
                window.gc();  // Only works in debug builds
            }
            // Give browser time to release memory before starting import
            await new Promise(r => setTimeout(r, 100));

            addLog(`Starting import to database...`);
            addLog(`Found ${selectedFiles.length} daily JSON files`);
            
            // Check if force full rescan is enabled
            const forceFullRescan = document.getElementById('forceFullRescan')?.checked || false;
            
            // Get last successful scan time
            const lastScanTime = forceFullRescan ? null : await getMetadata('lastSync');
            if (forceFullRescan) {
                addLog(`⚠️ Force full rescan enabled - ignoring last scan time`);
            } else if (lastScanTime) {
                const lastScanDate = new Date(lastScanTime).toLocaleString();
                addLog(`Last scan: ${lastScanDate}`);
            } else {
                addLog(`First scan - importing all files`);
            }
            
            // Filter files by valid date format
            const validFiles = selectedFiles.filter(file => {
                const match = file.name.match(/(\d{4}-\d{2}-\d{2})\.json\.gz/);
                return !!match;
            });
            
            addLog(`${validFiles.length} valid daily JSON files found`);
            
            // ⚡ OPTIMIZATION: Only process files modified since last scan
            const filesToProcess = lastScanTime 
                ? validFiles.filter(file => file.lastModified > lastScanTime)
                : validFiles; // First scan - process all files
            
            const skippedByModDate = validFiles.length - filesToProcess.length;
            
            // 📋 Always report what was found during scan
            addLog(`\n📋 Scan Results:`);
            addLog(`  Total files scanned: ${validFiles.length}`);
            addLog(`  Files to import: ${filesToProcess.length}`);
            addLog(`  Files skipped (unchanged): ${skippedByModDate}`);
            
            if (filesToProcess.length === 0) {
                // Nothing to import - show what was checked
                addLog(`\n✅ All files up to date - nothing to import`);
                
                // Show date range of scanned files
                if (validFiles.length > 0) {
                    const dates = validFiles.map(f => f.name.match(/(\d{4}-\d{2}-\d{2})/)[1]).sort();
                    const oldestDate = dates[0];
                    const newestDate = dates[dates.length - 1];
                    addLog(`  Date range: ${oldestDate} to ${newestDate}`);
                }
                
                // Only update lastSync if we weren't forcing a rescan
                // (If force was used and nothing found, don't update the timestamp)
                if (!forceFullRescan) {
                    await saveMetadata('lastSync', Date.now());
                }
                
                // Reset force rescan checkbox
                const forceCheckbox = document.getElementById('forceFullRescan');
                if (forceCheckbox) forceCheckbox.checked = false;
                
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                // Keep log visible so user can see the scan report!
                return;
            }
            
            // Show details of files that will be imported
            addLog(`\n📂 Files to import (sorted by date):`);
            
            // Sort files by date for better readability
            const sortedFiles = [...filesToProcess].sort((a, b) => {
                const dateA = a.name.match(/(\d{4}-\d{2}-\d{2})/)[1];
                const dateB = b.name.match(/(\d{4}-\d{2}-\d{2})/)[1];
                return dateA.localeCompare(dateB);
            });
            
            // Show all files if 20 or fewer, otherwise show first/last 10
            if (sortedFiles.length <= 20) {
                sortedFiles.forEach(file => {
                    const modDate = new Date(file.lastModified).toLocaleString();
                    addLog(`  • ${file.name} (modified: ${modDate})`);
                });
            } else {
                // Show first 10
                for (let i = 0; i < 10; i++) {
                    const file = sortedFiles[i];
                    const modDate = new Date(file.lastModified).toLocaleString();
                    addLog(`  • ${file.name} (modified: ${modDate})`);
                }
                
                // Show count of middle files
                const middleCount = sortedFiles.length - 20;
                addLog(`  ... ${middleCount} more file${middleCount === 1 ? '' : 's'} ...`);
                
                // Show last 10
                for (let i = sortedFiles.length - 10; i < sortedFiles.length; i++) {
                    const file = sortedFiles[i];
                    const modDate = new Date(file.lastModified).toLocaleString();
                    addLog(`  • ${file.name} (modified: ${modDate})`);
                }
            }
            
            addLog(`\n⏳ Starting import...`);

            // ⚡ OPTIMIZATION: Load existing day metadata ONCE before the loop
            // Uses cursor to extract only dayKey + lastUpdated + itemCount (not full data)
            // This changes O(n) DB queries to O(1) query + O(n) Map lookups
            addLog(`  Loading existing day metadata...`);
            const existingMetadata = await getDayMetadataFromDB();
            addLog(`  Found ${existingMetadata.size} existing days in database`);

            let syncStats = { added: 0, updated: 0, skipped: 0 };
            let addedDays = [];
            let updatedDays = [];
            let processedFiles = 0;
            let failedFiles = [];  // Track files that failed to read (Safari blob expiry)

            for (const file of filesToProcess) {
                if (cancelProcessing) {
                    addLog('Import cancelled', 'error');
                    break;
                }

                try {
                    const match = file.name.match(/(\d{4}-\d{2}-\d{2})\.json\.gz/);
                    const fileDate = match[1];
                    const [year, month, day] = fileDate.split('-');
                    const monthKey = `${year}-${month}`;
                    const dayKey = fileDate;

                    // Decompress file
                    const data = await decompressFile(file);
                    // Apply place-name and activity-type fixes before saving
                    applyImportFixes(data);

                    // Debug: Check if data has timeline items (first file only)
                    if (processedFiles === 0) {
                        // Log all place names in the file
                        const placeNames = data.timelineItems?.filter(i => i.place?.name).map(i => i.place.name) || [];
                        logDebug(`📦 First file structure check:`, {
                            hasTimelineItems: !!data.timelineItems,
                            itemCount: data.timelineItems?.length || 0,
                            placeNames: placeNames,
                            firstItem: data.timelineItems?.[0] ? {
                                isVisit: data.timelineItems[0].isVisit,
                                activityType: data.timelineItems[0].activityType,
                                hasSamples: !!data.timelineItems[0].samples,
                                sampleCount: data.timelineItems[0].samples?.length || 0,
                                hasPlace: !!data.timelineItems[0].place,
                                placeName: data.timelineItems[0].place?.name || null
                            } : 'none'
                        });
                    }

                    // Use file modification time as lastUpdated
                    // This ensures we track when the file was actually changed
                    const lastUpdated = file.lastModified;

                    // Import to database (pass pre-loaded metadata for O(1) lookup)
                    const result = await importDayToDB(dayKey, monthKey, data, file.name, lastUpdated, existingMetadata);

                    syncStats[result.action]++;
                    if (result.action === 'added') {
                        addedDays.push(dayKey);
                    } else if (result.action === 'updated') {
                        updatedDays.push(dayKey);
                    }

                    processedFiles++;
                    const percent = Math.round((processedFiles / filesToProcess.length) * 100);
                    progressFill.style.width = percent + '%';
                    progressFill.textContent = percent + '%';
                    progressText.textContent = `Processing: ${file.name} (${processedFiles}/${filesToProcess.length})`;

                } catch (error) {
                    // Track failed files (Safari blob URL expiry causes ProgressEvent errors)
                    failedFiles.push(file.name);
                    logError(`Error importing ${file.name}:`, error);
                    // Continue processing other files
                }
            }

            // Report failed files at end (Safari blob expiry issue)
            if (failedFiles.length > 0) {
                addLog(`\n⚠️ ${failedFiles.length} files failed to read (Safari may have released file handles):`, 'error');
                if (failedFiles.length <= 10) {
                    failedFiles.forEach(f => addLog(`  • ${f}`, 'error'));
                } else {
                    failedFiles.slice(0, 5).forEach(f => addLog(`  • ${f}`, 'error'));
                    addLog(`  ... and ${failedFiles.length - 5} more`, 'error');
                }
                addLog(`\nTip: Re-select the folder and import again to retry failed files.`, 'info');
            }
            
            // Save last sync time (now!)
            await saveMetadata('lastSync', Date.now());
            
            // Reset force rescan checkbox
            const forceCheckbox = document.getElementById('forceFullRescan');
            if (forceCheckbox) forceCheckbox.checked = false;
            
            // Sort days chronologically
            addedDays.sort();
            updatedDays.sort();
            
            // Update global tracking for diary display
            importAddedDays = addedDays.slice();
            importUpdatedDays = updatedDays.slice();
            
            // CRITICAL: Invalidate in-memory cache for affected months
            // Without this, stale data would be shown until page refresh
            const affectedMonths = new Set();
            [...addedDays, ...updatedDays].forEach(dayKey => {
                affectedMonths.add(dayKey.substring(0, 7));
            });
            affectedMonths.forEach(monthKey => {
                if (generatedDiaries[monthKey]) {
                    logDebug(`🗑️ Invalidating cache for ${monthKey}`);
                    delete generatedDiaries[monthKey];
                }
            });
            
            // Save to IndexedDB for persistence across sessions
            await saveMetadata('importAddedDays', addedDays);
            await saveMetadata('importUpdatedDays', updatedDays);
            
            // Update analysis data for imported days (in background)
            if (addedDays.length > 0 || updatedDays.length > 0) {
                const daysToUpdate = [...addedDays, ...updatedDays];
                updateAnalysisDataInBackground(daysToUpdate);
            }
            
            const totalSkipped = skippedByModDate + syncStats.skipped;
            
            // Format dates for display
            const formatDateForReport = (dayKey) => {
                const date = new Date(dayKey + 'T00:00:00');
                return date.toLocaleDateString('en-AU', { 
                    weekday: 'short', 
                    day: 'numeric', 
                    month: 'short', 
                    year: 'numeric' 
                });
            };
            
            // Build markdown report for clipboard
            let reportLines = [];
            reportLines.push('# Arc Timeline Import Report');
            reportLines.push(`**Date:** ${new Date().toLocaleString('en-AU')}`);
            reportLines.push(`**Files scanned:** ${validFiles.length}`);
            reportLines.push('');
            
            if (addedDays.length > 0) {
                reportLines.push(`## 📥 Added (${addedDays.length} days)`);
                addedDays.forEach(d => reportLines.push(`- ${formatDateForReport(d)}`));
                reportLines.push('');
            }
            
            if (updatedDays.length > 0) {
                reportLines.push(`## 🔄 Updated (${updatedDays.length} days)`);
                updatedDays.forEach(d => reportLines.push(`- ${formatDateForReport(d)}`));
                reportLines.push('');
            }
            
            if (totalSkipped > 0) {
                reportLines.push(`## ⏭️ Skipped`);
                reportLines.push(`${totalSkipped} unchanged files`);
            }
            
            lastImportReport = reportLines.join('\n');
            
            // Build HTML report for display
            let reportHtml = `
                <div style="padding: 20px;">
                    <h3 style="margin: 0 0 16px 0; color: #333; font-size: 18px;">✅ Import Complete</h3>
                    <div style="font-size: 13px; color: #666; margin-bottom: 20px;">
                        ${new Date().toLocaleString('en-AU')} • ${validFiles.length} files scanned
                    </div>`;
            
            if (addedDays.length > 0) {
                reportHtml += `
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin: 0 0 10px 0; color: #2e7d32; font-size: 15px;">📥 Added (${addedDays.length} days)</h4>
                        <ul style="margin: 0; padding-left: 20px; color: #333;">
                            ${addedDays.map(d => `<li style="margin: 4px 0;">${formatDateForReport(d)}</li>`).join('')}
                        </ul>
                    </div>`;
            }
            
            if (updatedDays.length > 0) {
                reportHtml += `
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin: 0 0 10px 0; color: #ef6c00; font-size: 15px;">🔄 Updated (${updatedDays.length} days)</h4>
                        <ul style="margin: 0; padding-left: 20px; color: #333;">
                            ${updatedDays.map(d => `<li style="margin: 4px 0;">${formatDateForReport(d)}</li>`).join('')}
                        </ul>
                    </div>`;
            }
            
            if (totalSkipped > 0) {
                reportHtml += `
                    <div style="color: #666; font-size: 13px;">
                        ⏭️ Skipped ${totalSkipped} unchanged files
                    </div>`;
            }
            
            if (addedDays.length === 0 && updatedDays.length === 0) {
                reportHtml += `
                    <div style="color: #666; font-size: 14px;">
                        No changes detected. All files are up to date.
                    </div>`;
            }
            
            // Add copy button
            if (addedDays.length > 0 || updatedDays.length > 0) {
                reportHtml += `
                    <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e0e0e0;">
                        <button id="copyReportBtn" style="background: #007AFF; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;">
                            📋 Copy Report to Clipboard
                        </button>
                        <span id="copyReportStatus" style="margin-left: 12px; color: #388e3c; display: none;">✓ Copied!</span>
                    </div>`;
            }
            
            reportHtml += '</div>';
            
            // Replace log content with formatted report
            logDiv.innerHTML = reportHtml;
            logDiv.style.display = 'block';
            
            // Add copy button handler
            const copyBtn = document.getElementById('copyReportBtn');
            if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                    try {
                        await navigator.clipboard.writeText(lastImportReport);
                        const status = document.getElementById('copyReportStatus');
                        status.style.display = 'inline';
                        setTimeout(() => { status.style.display = 'none'; }, 2000);
                    } catch (err) {
                        logError('Failed to copy:', err);
                        alert('Failed to copy to clipboard');
                    }
                });
            }
            
            // Update UI
            await updateDBStatusDisplay();

            // Refresh monthKeys and selectors after import
            await loadMostRecentMonth();

            // Notify analysis page that data has changed
            if (addedDays.length > 0 || updatedDays.length > 0) {
                try {
                    const dataChannel = new BroadcastChannel('arc-data-update');
                    dataChannel.postMessage({
                        type: 'dataImported',
                        addedDays: addedDays.length,
                        updatedDays: updatedDays.length,
                        timestamp: Date.now()
                    });
                    dataChannel.close();
                } catch (e) {
                    // BroadcastChannel not supported or failed
                }
            }

            progress.style.display = 'none';
            cancelBtn.style.display = 'none';

            // Reset file input so the same folder can be selected again
            fileInput.value = '';
            selectedFiles = [];
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
        
        // Confirm before clearing database
        function confirmClearDatabase() {
            if (confirm('Are you sure you want to clear the entire database? This cannot be undone.')) {
                clearDatabaseAndReset();
            }
        }
        
        // Clear database and reset UI
        async function clearDatabaseAndReset() {
            await clearDatabase();
            generatedDiaries = {};
            monthKeys = [];
            currentMonth = null;
            
            await updateDBStatusDisplay();
            
            // Close diary reader if open
            if (modalOverlay.style.display === 'block') {
                modalOverlay.style.display = 'none';
            }
            
            addLog('✅ Database cleared');
        }
        
        let selectedFiles = [];
        let selectedBackupFiles = []; // For backup import
        let currentImportType = 'json'; // 'json' or 'backup'
        let generatedDiaries = {};
        let currentMonth = null;
        let monthKeys = [];
        
        // Import type selector
        window.selectImportType = function(type) {
            currentImportType = type;
            const jsonTab = document.getElementById('jsonImportTab');
            const backupTab = document.getElementById('backupImportTab');
            const jsonPanel = document.getElementById('jsonImportPanel');
            const backupPanel = document.getElementById('backupImportPanel');
            
            if (type === 'json') {
                jsonTab.style.background = '#007AFF';
                jsonTab.style.color = 'white';
                jsonTab.style.borderColor = '#007AFF';
                backupTab.style.background = 'white';
                backupTab.style.color = '#1d1d1f';
                backupTab.style.borderColor = '#d1d1d6';
                jsonPanel.style.display = 'block';
                backupPanel.style.display = 'none';
            } else {
                backupTab.style.background = '#34C759';
                backupTab.style.color = 'white';
                backupTab.style.borderColor = '#34C759';
                jsonTab.style.background = 'white';
                jsonTab.style.color = '#1d1d1f';
                jsonTab.style.borderColor = '#d1d1d6';
                jsonPanel.style.display = 'none';
                backupPanel.style.display = 'block';
            }
        };
        
        // Backup folder input handler - setup after DOM ready
        function setupBackupImportHandler() {
            // Check if File System Access API is available
            const backupWarning = document.getElementById('backupBrowserWarning');
            if (!window.showDirectoryPicker) {
                // Show Safari warning but allow fallback
                if (backupWarning) backupWarning.style.display = 'block';
            }
        }

        // Select backup folder - uses File System Access API (Chrome/Edge) or webkitdirectory fallback (Safari)
        window.selectBackupFolder = async function() {
            // Use File System Access API if available (Chrome, Edge)
            if (window.showDirectoryPicker) {
                await selectBackupFolderModern();
            } else {
                // Fallback for Safari - use webkitdirectory input
                const backupInput = document.getElementById('backupFolderInput');
                if (backupInput) {
                    backupInput.click();
                } else {
                    alert('Backup import is not available in this browser.');
                }
            }
        };

        // Handle files selected via webkitdirectory (Safari fallback)
        window.handleBackupFolderSelected = async function(files) {
            if (!files || files.length === 0) return;

            const backupFileCount = document.getElementById('backupFileCount');
            backupFileCount.innerHTML = `<div style="color: #666;">Validating ${files.length.toLocaleString()} files...</div>`;

            // Yield to let UI update before validation
            await new Promise(r => setTimeout(r, 50));

            // Quick validation: sample files from throughout the list for TimelineItem folder
            // Safari may order files differently on subsequent selections, so we sample broadly
            let hasTimelineItem = false;
            const totalFiles = files.length;

            // Check up to 10000 files, sampling evenly throughout
            const samplesToCheck = Math.min(totalFiles, 10000);
            const step = Math.max(1, Math.floor(totalFiles / samplesToCheck));

            for (let i = 0; i < totalFiles && !hasTimelineItem; i += step) {
                if (files[i].webkitRelativePath.includes('/TimelineItem/')) {
                    hasTimelineItem = true;
                }
            }

            // If not found with sampling, do a full scan (string checks are cheap)
            if (!hasTimelineItem) {
                backupFileCount.innerHTML = `<div style="color: #666;">Full validation scan...</div>`;
                await new Promise(r => setTimeout(r, 10));

                for (let i = 0; i < totalFiles; i++) {
                    if (files[i].webkitRelativePath.includes('/TimelineItem/')) {
                        hasTimelineItem = true;
                        break;
                    }
                }
            }

            if (!hasTimelineItem) {
                backupFileCount.innerHTML = '<div style="color: #d32f2f;">Not a valid backup folder. Expected TimelineItem/ subdirectory.</div>';
                return;
            }

            backupFileCount.innerHTML = `<div style="color: #388e3c;">✓ Valid backup folder (${files.length.toLocaleString()} files)</div>`;

            // Start import with FileList directly (don't convert to array)
            await importFromBackupFiles(files);
        };

        // Modern backup folder selection using File System Access API (Chrome/Edge)
        async function selectBackupFolderModern() {
            const backupFileCount = document.getElementById('backupFileCount');

            try {
                backupFileCount.innerHTML = '<div style="color: #666;">Selecting folder...</div>';

                const dirHandle = await window.showDirectoryPicker({
                    mode: 'read'
                });

                // Store for debug inspection
                window._lastBackupDirHandle = dirHandle;

                backupFileCount.innerHTML = '<div style="color: #666;">Validating backup structure...</div>';

                // Validate it has the expected subdirectories
                const expectedDirs = ['TimelineItem', 'LocomotionSample', 'Place', 'Note'];
                const foundDirs = [];

                for await (const entry of dirHandle.values()) {
                    if (entry.kind === 'directory' && expectedDirs.includes(entry.name)) {
                        foundDirs.push(entry.name);
                    }
                }

                if (!foundDirs.includes('TimelineItem')) {
                    backupFileCount.innerHTML = '<div style="color: #d32f2f;">Not a valid backup folder. Expected TimelineItem/ subdirectory.</div>';
                    return;
                }

                backupFileCount.innerHTML = `<div style="color: #388e3c;">✓ Found: ${foundDirs.join(', ')}</div>`;

                // Start import with directory handle
                await importFromBackupDir(dirHandle);

            } catch (err) {
                if (err.name === 'AbortError') {
                    backupFileCount.innerHTML = '<div style="color: #666;">Folder selection cancelled</div>';
                } else {
                    backupFileCount.innerHTML = `<div style="color: #d32f2f;">Error: ${err.message}</div>`;
                    console.error('Backup folder error:', err);
                }
            }
        };

        // Helper: Read all JSON files from a directory with hex subdirs (TimelineItem, Place, Note)
        async function* readJsonFilesFromHexDirs(parentDirHandle, progressCallback) {
            let fileCount = 0;

            for await (const subEntry of parentDirHandle.values()) {
                if (subEntry.kind === 'directory') {
                    const subDirHandle = await parentDirHandle.getDirectoryHandle(subEntry.name);

                    for await (const fileEntry of subDirHandle.values()) {
                        if (fileEntry.kind === 'file' && fileEntry.name.endsWith('.json')) {
                            fileCount++;
                            if (progressCallback && fileCount % 1000 === 0) {
                                progressCallback(fileCount);
                            }
                            yield fileEntry;
                        }
                    }
                }
            }
        }

        // Helper: Read file as JSON
        async function readFileAsJson(fileHandle) {
            try {
                const file = await fileHandle.getFile();
                const text = await file.text();
                return JSON.parse(text);
            } catch (err) {
                return null;
            }
        }
        
        // Helper: Order items by linked list (previousItemId/nextItemId)
        // This is the ONLY correct way to order TimelineItems per Arc's data model
        function orderItemsByLinkedList(items) {
            if (!items || items.length === 0) return [];
            if (items.length === 1) return items;
            
            // Build lookup maps
            const byId = new Map();
            const byPrevId = new Map(); // Map from previousItemId -> item
            
            for (const item of items) {
                if (item.itemId) {
                    byId.set(item.itemId, item);
                }
                if (item.previousItemId) {
                    byPrevId.set(item.previousItemId, item);
                }
            }
            
            // Find chain heads (items with no previous, or whose previous isn't in our set)
            const heads = [];
            for (const item of items) {
                if (!item.previousItemId || !byId.has(item.previousItemId)) {
                    heads.push(item);
                }
            }
            
            // If no heads found (circular?), just use first item
            if (heads.length === 0) {
                heads.push(items[0]);
            }
            
            // Walk chains from each head
            const ordered = [];
            const visited = new Set();
            
            for (const head of heads) {
                let current = head;
                while (current && !visited.has(current.itemId)) {
                    visited.add(current.itemId);
                    ordered.push(current);
                    
                    // Find next item in chain
                    if (current.nextItemId && byId.has(current.nextItemId)) {
                        current = byId.get(current.nextItemId);
                    } else {
                        // Try to find item whose previousItemId is current
                        current = byPrevId.get(current.itemId);
                    }
                }
            }
            
            // Add any items not reached by walking (broken links)
            for (const item of items) {
                if (!visited.has(item.itemId)) {
                    ordered.push(item);
                }
            }
            
            return ordered;
        }
        
        // Helper: Read gzipped file as JSON
        async function readGzippedFileAsJson(fileHandle) {
            try {
                const file = await fileHandle.getFile();
                const arrayBuffer = await file.arrayBuffer();
                const decompressed = pako.ungzip(new Uint8Array(arrayBuffer), { to: 'string' });
                return JSON.parse(decompressed);
            } catch {
                return null;
            }
        }
        
        // Import from backup using File System Access API
        async function importFromBackupDir(dirHandle) {
            cancelProcessing = false;

            const fileInputSection = document.getElementById('fileInputSection');
            if (fileInputSection) fileInputSection.style.display = 'none';

            progress.style.display = 'block';
            cancelBtn.style.display = 'block';
            logDiv.style.display = 'block';
            logDiv.innerHTML = '';

            importAddedDays = [];
            importUpdatedDays = [];
            importChangedItemIds = new Set();

            addLog('🔄 Starting backup import (File System Access API)...');

            const forceRescan = document.getElementById('backupForceRescan')?.checked || false;
            const missingOnly = document.getElementById('backupMissingOnly')?.checked || false;
            const lastBackupSync = forceRescan ? null : await getMetadata('lastBackupSync');

            if (missingOnly) {
                addLog('🛡️ Missing days only - existing data will not be modified');
            }
            if (forceRescan) {
                addLog('⚠️ Force rescan enabled - reimporting all data');
            } else if (lastBackupSync) {
                addLog(`📅 Last backup sync: ${lastBackupSync}`);
            }

            try {
                // Get directory handles
                const timelineDir = await dirHandle.getDirectoryHandle('TimelineItem');
                const placeDir = await dirHandle.getDirectoryHandle('Place').catch(() => null);
                const noteDir = await dirHandle.getDirectoryHandle('Note').catch(() => null);
                const sampleDir = await dirHandle.getDirectoryHandle('LocomotionSample').catch(() => null);

                // For "missing only" mode: get existing days first
                let existingDays = new Set();
                if (missingOnly) {
                    const allDayKeys = await getAllDayKeysFromDB();
                    existingDays = new Set(allDayKeys);
                    addLog(`  Database has ${existingDays.size.toLocaleString()} existing days`);
                }

                // Step 1: Load Places (0-5%)
                addLog('\n📍 Loading Places...');
                progressFill.style.width = '0%';
                progressFill.textContent = '0%';
                const placeLookup = new Map();
                if (placeDir) {
                    let placeCount = 0;
                    for await (const fileHandle of readJsonFilesFromHexDirs(placeDir)) {
                        if (cancelProcessing) break;
                        const place = await readFileAsJson(fileHandle);
                        if (place && place.placeId && !place.deleted) {
                            placeLookup.set(place.placeId, place);
                            placeCount++;
                        }
                        if (placeCount % 500 === 0) {
                            progressText.textContent = `Loading places: ${placeCount.toLocaleString()}...`;
                            await new Promise(r => setTimeout(r, 0));
                        }
                    }
                    addLog(`  Loaded ${placeLookup.size.toLocaleString()} places`);

                    // Update global placesById for display name lookups
                    for (const [placeId, place] of placeLookup) {
                        if (place.name) {
                            placesById[placeId] = place.name;
                        }
                    }
                    await saveMetadata('placesById', placesById);
                    logInfo(`📍 Updated placesById with ${Object.keys(placesById).length} place names`);
                }
                
                // Step 2: Load Notes indexed by date (5-10%)
                addLog('\n📝 Loading Notes...');
                progressFill.style.width = '5%';
                progressFill.textContent = '5%';
                const notesByDate = new Map();
                if (noteDir) {
                    let noteCount = 0;
                    for await (const fileHandle of readJsonFilesFromHexDirs(noteDir)) {
                        if (cancelProcessing) break;
                        const note = await readFileAsJson(fileHandle);
                        if (note && note.date && note.body && !note.deleted) {
                            // Convert UTC date to local date for proper day matching
                            const noteDate = new Date(note.date);
                            const dayKey = noteDate.getFullYear() + '-' + 
                                String(noteDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                String(noteDate.getDate()).padStart(2, '0');
                            if (!notesByDate.has(dayKey)) {
                                notesByDate.set(dayKey, []);
                            }
                            notesByDate.get(dayKey).push(note);
                            noteCount++;
                        }
                        if (noteCount % 500 === 0) {
                            progressText.textContent = `Loading notes: ${noteCount.toLocaleString()}...`;
                            await new Promise(r => setTimeout(r, 0));
                        }
                    }
                    addLog(`  Loaded ${noteCount.toLocaleString()} notes`);
                }
                
                // Step 3: Scan TimelineItems (10-60%)
                addLog('\n🗓️ Scanning Timeline Items...');
                progressFill.style.width = '10%';
                progressFill.textContent = '10%';
                const changedItems = [];
                const changedItemIds = new Set();
                const changedDays = new Set();
                const changedWeeks = new Set();
                
                let scannedCount = 0;
                let skippedExisting = 0;
                let skippedUnchanged = 0;
                let skippedDeleted = 0;
                let includedForSpanning = 0;
                let maxLastSaved = lastBackupSync || '';
                
                // Batch reading for speed
                const BATCH_SIZE = 50;
                let batch = [];
                
                for await (const fileHandle of readJsonFilesFromHexDirs(timelineDir, (count) => {
                    progressText.textContent = `Scanning timeline: ${count.toLocaleString()}...`;
                })) {
                    if (cancelProcessing) break;
                    
                    batch.push(fileHandle);
                    
                    if (batch.length >= BATCH_SIZE) {
                        const results = await Promise.all(batch.map(fh => readFileAsJson(fh)));
                        
                        for (const item of results) {
                            scannedCount++;
                            if (!item) continue;
                            
                            if (item.deleted) {
                                skippedDeleted++;
                                continue;
                            }
                            
                            if (item.lastSaved && item.lastSaved > maxLastSaved) {
                                maxLastSaved = item.lastSaved;
                            }
                            
                            if (!item.startDate) continue;
                            
                            const startDayKey = getLocalDayKey(item.startDate);
                            const endDayKey = item.endDate ? getLocalDayKey(item.endDate) : startDayKey;
                            
                            // In missingOnly mode, check if this item spans into any missing days
                            let spansIntoMissingDay = false;
                            if (missingOnly && item.isVisit && endDayKey > startDayKey) {
                                let checkDay = startDayKey;
                                while (checkDay <= endDayKey) {
                                    if (!existingDays.has(checkDay)) {
                                        spansIntoMissingDay = true;
                                        break;
                                    }
                                    const nextDate = new Date(checkDay + 'T12:00:00');
                                    nextDate.setDate(nextDate.getDate() + 1);
                                    checkDay = nextDate.toISOString().substring(0, 10);
                                }
                            }
                            
                            if (missingOnly && existingDays.has(startDayKey) && !spansIntoMissingDay) {
                                skippedExisting++;
                                continue;
                            }
                            
                            // Skip unchanged items UNLESS they span into missing days
                            if (lastBackupSync && item.lastSaved && item.lastSaved <= lastBackupSync && !spansIntoMissingDay) {
                                skippedUnchanged++;
                                continue;
                            }
                            
                            // Attach place info
                            if (item.placeId && placeLookup.has(item.placeId)) {
                                const place = placeLookup.get(item.placeId);
                                item.place = { 
                                    name: place.name, 
                                    center: place.center,
                                    radiusMeters: place.radiusMeters || place.radius || 50
                                };
                                if (!item.center && place.center) {
                                    item.center = place.center;
                                }
                            }
                            
                            changedItems.push(item);
                            changedItemIds.add(item.itemId);
                            changedDays.add(startDayKey);
                            changedWeeks.add(getISOWeek(item.startDate));

                            // Track if this was included because it spans into missing days
                            if (spansIntoMissingDay) {
                                includedForSpanning++;
                            }
                        }
                        
                        batch = [];
                        
                        if (scannedCount % 5000 < BATCH_SIZE) {
                            // Estimate progress 10-60% based on typical 50k items
                            const scanPercent = Math.min(50, Math.round((scannedCount / 50000) * 50));
                            const totalPercent = 10 + scanPercent;
                            progressFill.style.width = totalPercent + '%';
                            progressFill.textContent = totalPercent + '%';
                            progressText.textContent = `Scanning timeline: ${scannedCount.toLocaleString()}...`;
                            await new Promise(r => setTimeout(r, 0));
                        }
                    }
                }
                
                // Process remaining batch
                if (batch.length > 0) {
                    const results = await Promise.all(batch.map(fh => readFileAsJson(fh)));
                    for (const item of results) {
                        scannedCount++;
                        if (!item || item.deleted || !item.startDate) continue;
                        
                        const startDayKey = getLocalDayKey(item.startDate);
                        const endDayKey = item.endDate ? getLocalDayKey(item.endDate) : startDayKey;
                        
                        // In missingOnly mode, check if this item spans into any missing days
                        let spansIntoMissingDay = false;
                        if (missingOnly && item.isVisit && endDayKey > startDayKey) {
                            let checkDay = startDayKey;
                            while (checkDay <= endDayKey) {
                                if (!existingDays.has(checkDay)) {
                                    spansIntoMissingDay = true;
                                    break;
                                }
                                const nextDate = new Date(checkDay + 'T12:00:00');
                                nextDate.setDate(nextDate.getDate() + 1);
                                checkDay = nextDate.toISOString().substring(0, 10);
                            }
                        }
                        
                        if (missingOnly && existingDays.has(startDayKey) && !spansIntoMissingDay) continue;
                        // Skip unchanged items UNLESS they span into missing days
                        if (lastBackupSync && item.lastSaved && item.lastSaved <= lastBackupSync && !spansIntoMissingDay) continue;
                        
                        if (item.placeId && placeLookup.has(item.placeId)) {
                            const place = placeLookup.get(item.placeId);
                            item.place = { 
                                name: place.name, 
                                center: place.center,
                                radiusMeters: place.radiusMeters || place.radius || 50
                            };
                            if (!item.center && place.center) item.center = place.center;
                        }
                        
                        changedItems.push(item);
                        changedItemIds.add(item.itemId);
                        changedDays.add(startDayKey);
                        changedWeeks.add(getISOWeek(item.startDate));
                        if (spansIntoMissingDay) includedForSpanning++;
                    }
                }
                
                addLog(`  Scanned ${scannedCount.toLocaleString()} items`);
                addLog(`  To import: ${changedItems.length.toLocaleString()} items across ${changedDays.size.toLocaleString()} days`);
                if (skippedExisting > 0) addLog(`  Skipped: ${skippedExisting.toLocaleString()} (days exist)`);
                if (skippedUnchanged > 0) addLog(`  Skipped: ${skippedUnchanged.toLocaleString()} unchanged`);
                if (includedForSpanning > 0) addLog(`  Included: ${includedForSpanning.toLocaleString()} spanning visits into missing days`);
                
                if (changedItems.length === 0) {
                    addLog('\n✅ No new data to import');
                    progress.style.display = 'none';
                    cancelBtn.style.display = 'none';
                    return;
                }
                
                // Step 4: Load GPS samples for needed weeks only (60-80%)
                addLog('\n📍 Loading GPS samples...');
                progressFill.style.width = '60%';
                progressFill.textContent = '60%';
                const samplesByItemId = new Map();
                
                if (sampleDir) {
                    let weekCount = 0;
                    let sampleCount = 0;

                    for await (const entry of sampleDir.values()) {
                        if (cancelProcessing) break;
                        if (entry.kind !== 'file') continue;

                        // Support both gzipped (.json.gz) and plain (.json) sample files
                        // Older data (e.g., MOVES imports) may use uncompressed JSON
                        const isGz = entry.name.endsWith('.json.gz');
                        const isJson = entry.name.endsWith('.json') && !isGz;
                        if (!isGz && !isJson) continue;

                        // Check if this week is needed
                        const weekMatch = entry.name.match(/^(\d{4}-W\d{2})/);
                        if (weekMatch && !changedWeeks.has(weekMatch[1])) continue;

                        let samples;
                        if (isGz) {
                            samples = await readGzippedFileAsJson(entry);
                        } else {
                            // Plain JSON file
                            const file = await entry.getFile();
                            const text = await file.text();
                            try {
                                samples = JSON.parse(text);
                            } catch (e) {
                                console.warn(`Failed to parse ${entry.name}:`, e);
                                continue;
                            }
                        }

                        if (Array.isArray(samples)) {
                            for (const sample of samples) {
                                if (sample.timelineItemId && sample.location && changedItemIds.has(sample.timelineItemId)) {
                                    if (!samplesByItemId.has(sample.timelineItemId)) {
                                        samplesByItemId.set(sample.timelineItemId, []);
                                    }
                                    samplesByItemId.get(sample.timelineItemId).push({
                                        location: sample.location,
                                        date: sample.date,
                                        movingState: sample.movingState,
                                        classifiedType: sample.classifiedType
                                    });
                                    sampleCount++;
                                }
                            }
                        }
                        weekCount++;

                        if (weekCount % 20 === 0) {
                            progressText.textContent = `Loading GPS samples: ${weekCount} weeks, ${sampleCount.toLocaleString()} samples...`;
                            await new Promise(r => setTimeout(r, 0));
                        }
                    }
                    addLog(`  Loaded ${sampleCount.toLocaleString()} GPS samples from ${weekCount} week files`);
                }
                
                // Step 5: Order items by linked list, then group by day (80-100%)
                // CRITICAL: Use previousItemId/nextItemId order, NEVER sort by startDate
                addLog('\n🔗 Ordering by timeline links...');
                progressFill.style.width = '80%';
                progressFill.textContent = '80%';
                const orderedItems = orderItemsByLinkedList(changedItems);
                addLog(`  Ordered ${orderedItems.length} items by linked list`);
                
                // Group items by day (preserving linked list order)
                // For spanning visits, add them to ALL days they cover
                addLog('\n💾 Saving to database...');
                
                const itemsByDate = new Map();
                let spanningVisitCount = 0;
                let extraDaysFromSpanning = 0;
                
                for (const item of orderedItems) {
                    const startDayKey = getLocalDayKey(item.startDate);
                    const endDayKey = item.endDate ? getLocalDayKey(item.endDate) : startDayKey;
                    
                    // Add to start day
                    if (!itemsByDate.has(startDayKey)) {
                        itemsByDate.set(startDayKey, []);
                    }
                    itemsByDate.get(startDayKey).push(item);
                    
                    // For multi-day visits, also add to intermediate and end days
                    if (item.isVisit && endDayKey > startDayKey) {
                        spanningVisitCount++;
                        let currentDay = startDayKey;
                        while (true) {
                            // Get next day
                            const nextDate = new Date(currentDay + 'T12:00:00');
                            nextDate.setDate(nextDate.getDate() + 1);
                            currentDay = nextDate.toISOString().substring(0, 10);
                            
                            if (currentDay > endDayKey) break;
                            
                            const isNewDay = !itemsByDate.has(currentDay);
                            if (isNewDay) {
                                itemsByDate.set(currentDay, []);
                                extraDaysFromSpanning++;
                            }
                            // Add reference to this spanning visit
                            itemsByDate.get(currentDay).push(item);
                        }
                    }
                }
                
                if (spanningVisitCount > 0) {
                    addLog(`  Found ${spanningVisitCount} spanning visits → ${extraDaysFromSpanning} extra days`);
                }
                
                const sortedDays = Array.from(itemsByDate.keys()).sort();
                let savedDays = 0;
                let addedDays = [];
                let updatedDays = [];

                // Load existing day metadata for content comparison
                addLog('\n💾 Saving to database...');
                const existingMetadata = await getDayMetadataFromDB();
                addLog(`  Comparing against ${existingMetadata.size} existing days`);

                for (const dayKey of sortedDays) {
                    if (cancelProcessing) break;

                    let items = itemsByDate.get(dayKey);
                    const monthKey = dayKey.substring(0, 7);

                    // CRITICAL: For incremental updates, merge new items with existing items
                    // Otherwise new items get skipped because existing day has more items
                    if (existingMetadata.has(dayKey) && !forceRescan) {
                        const existingDay = await getDayFromDB(dayKey);
                        if (existingDay?.data?.timelineItems) {
                            const existingItems = existingDay.data.timelineItems;
                            const newItemIds = new Set(items.map(i => i.itemId));

                            // Add existing items that aren't being replaced
                            for (const existingItem of existingItems) {
                                if (!newItemIds.has(existingItem.itemId)) {
                                    items.push(existingItem);
                                }
                            }

                            // Re-order merged items by linked list
                            items = orderItemsByLinkedList(items);
                        }
                    }

                    // DO NOT sort by startDate - linked list order is authoritative
                    // Items are already in correct order from orderItemsByLinkedList()
                    
                    // Attach samples (from LocomotionSample files or preserve existing embedded samples)
                    for (const item of items) {
                        if (samplesByItemId.has(item.itemId)) {
                            // Samples from LocomotionSample directory
                            item.samples = samplesByItemId.get(item.itemId);
                            item.samples.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                        } else if (item.samples && item.samples.length > 0) {
                            // Preserve existing embedded samples (e.g., from MOVES import)
                            // Normalize format if needed
                            item.samples = item.samples.map(s => ({
                                location: s.location || { latitude: s.latitude, longitude: s.longitude, altitude: s.altitude },
                                date: s.date,
                                movingState: s.movingState,
                                classifiedType: s.classifiedType
                            }));
                            item.samples.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                        }
                    }
                    
                    const dayNotes = notesByDate.get(dayKey) || [];
                    const dayData = {
                        timelineItems: items.map(item => ({
                            itemId: item.itemId,
                            isVisit: item.isVisit,
                            activityType: item.activityType || (item.isVisit ? 'stationary' : 'unknown'),
                            manualActivityType: item.manualActivityType || false,
                            startDate: item.startDate,
                            endDate: item.endDate,
                            center: item.center,
                            place: item.place,
                            placeId: item.placeId || null,
                            samples: item.samples || [],
                            streetAddress: item.streetAddress,
                            customTitle: item.customTitle || null,
                            previousItemId: item.previousItemId || null,
                            nextItemId: item.nextItemId || null,
                            notes: dayNotes.filter(n => {
                                const noteTime = new Date(n.date).getTime();
                                const itemStart = new Date(item.startDate).getTime();
                                const itemEnd = item.endDate ? new Date(item.endDate).getTime() : itemStart + 86400000;
                                return noteTime >= itemStart && noteTime <= itemEnd;
                            }).map(n => ({ body: n.body, date: n.date }))
                        }))
                    };
                    
                    const dayLastSaved = items.reduce((max, item) =>
                        item.lastSaved && item.lastSaved > max ? item.lastSaved : max, '');
                    const lastUpdated = dayLastSaved ? new Date(dayLastSaved).getTime() : Date.now();

                    // Pass metadata for content hash comparison (skips if hash unchanged)
                    const result = await importDayToDB(dayKey, monthKey, dayData, 'backup-import', lastUpdated, existingMetadata);
                    
                    if (result.action === 'added') addedDays.push(dayKey);
                    else if (result.action === 'updated') updatedDays.push(dayKey);
                    
                    savedDays++;
                    if (savedDays % 50 === 0) {
                        // Scale progress from 80% to 100%
                        const savePercent = Math.round((savedDays / sortedDays.length) * 20);
                        const totalPercent = 80 + savePercent;
                        progressFill.style.width = totalPercent + '%';
                        progressFill.textContent = totalPercent + '%';
                        progressText.textContent = `Saving: ${savedDays}/${sortedDays.length} days`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
                
                // Save sync time
                await saveMetadata('lastBackupSync', maxLastSaved);
                
                // Reset checkbox
                const forceCheckbox = document.getElementById('backupForceRescan');
                if (forceCheckbox) forceCheckbox.checked = false;
                
                importAddedDays = addedDays;
                importUpdatedDays = updatedDays;
                
                // Invalidate cache
                const affectedMonths = new Set();
                [...addedDays, ...updatedDays].forEach(dk => affectedMonths.add(dk.substring(0, 7)));
                affectedMonths.forEach(mk => {
                    if (generatedDiaries[mk]) delete generatedDiaries[mk];
                });
                
                await saveMetadata('importAddedDays', addedDays);
                await saveMetadata('importUpdatedDays', updatedDays);
                
                if (addedDays.length > 0 || updatedDays.length > 0) {
                    updateAnalysisDataInBackground([...addedDays, ...updatedDays]);
                }
                
                addLog('\n✅ Backup import complete!');
                addLog(`  Days added: ${addedDays.length.toLocaleString()}`);
                addLog(`  Days updated: ${updatedDays.length.toLocaleString()}`);

                if (addedDays.length > 0) {
                    addLog(`  New data range: ${addedDays[0]} to ${addedDays[addedDays.length - 1]}`);
                }

                progress.style.display = 'none';
                cancelBtn.style.display = 'none';

                const results = document.getElementById('results');
                if (results) {
                    results.style.display = 'block';
                    const resultsList = document.getElementById('resultsList');
                    if (resultsList) {
                        resultsList.innerHTML = `
                            <p><strong>${addedDays.length}</strong> days added</p>
                            <p><strong>${updatedDays.length}</strong> days updated</p>
                            <p>Total: <strong>${sortedDays.length}</strong> days processed</p>
                        `;
                    }
                }

                // Refresh monthKeys and selectors after import
                await updateDBStatusDisplay();
                await loadMostRecentMonth();
                
            } catch (err) {
                addLog(`\n❌ Error: ${err.message}`, 'error');
                console.error('Backup import error:', err);
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
            }
        }

        // Import from backup using FileList (Safari fallback via webkitdirectory)
        // Uses controlled batching to avoid overwhelming Safari's memory
        async function importFromBackupFiles(files) {
            cancelProcessing = false;

            const fileInputSection = document.getElementById('fileInputSection');
            if (fileInputSection) fileInputSection.style.display = 'none';

            progress.style.display = 'block';
            cancelBtn.style.display = 'block';
            logDiv.style.display = 'block';
            logDiv.innerHTML = '';

            importAddedDays = [];
            importUpdatedDays = [];
            importChangedItemIds = new Set();

            addLog('🔄 Starting backup import (Safari compatibility mode)...');
            addLog('⚠️ This may take longer than Chrome/Edge. Please be patient.');
            addLog('📂 Indexing files...');

            // Yield to let UI render before heavy file indexing
            await new Promise(r => setTimeout(r, 50));

            const forceRescan = document.getElementById('backupForceRescan')?.checked || false;
            const missingOnly = document.getElementById('backupMissingOnly')?.checked || false;
            const lastBackupSync = forceRescan ? null : await getMetadata('lastBackupSync');

            if (missingOnly) {
                addLog('🛡️ Missing days only - existing data will not be modified');
            }
            if (forceRescan) {
                addLog('⚠️ Force rescan enabled - reimporting all data');
            }

            try {
                // Categorize files by subdirectory (yield periodically to keep UI responsive)
                // Note: Iterate FileList directly - don't use Array.from() which blocks on 200k+ files
                const placeFiles = [];
                const noteFiles = [];
                const timelineFiles = [];
                const sampleFiles = [];

                const totalFiles = files.length;
                const CHUNK_SIZE = 5000;

                for (let i = 0; i < totalFiles; i++) {
                    const file = files[i];
                    const path = file.webkitRelativePath;
                    if (path.includes('/TimelineItem/') && file.name.endsWith('.json')) {
                        timelineFiles.push(file);
                    } else if (path.includes('/Place/') && file.name.endsWith('.json')) {
                        placeFiles.push(file);
                    } else if (path.includes('/Note/') && file.name.endsWith('.json')) {
                        noteFiles.push(file);
                    } else if (path.includes('/LocomotionSample/') && (file.name.endsWith('.json') || file.name.endsWith('.json.gz'))) {
                        sampleFiles.push(file);
                    }

                    // Yield every CHUNK_SIZE files to keep UI responsive
                    if (i > 0 && i % CHUNK_SIZE === 0) {
                        const pct = Math.round((i / totalFiles) * 5); // 0-5% for indexing
                        if (progressFill) {
                            progressFill.style.width = pct + '%';
                            progressFill.textContent = pct + '%';
                        }
                        if (progressText) {
                            progressText.textContent = `Indexing files: ${i.toLocaleString()}/${totalFiles.toLocaleString()}...`;
                        }
                        await new Promise(r => setTimeout(r, 0));
                    }
                }

                addLog(`📂 Indexed ${totalFiles.toLocaleString()} files`);
                addLog(`  Timeline items: ${timelineFiles.length.toLocaleString()} files`);
                addLog(`  Places: ${placeFiles.length.toLocaleString()} files`);
                addLog(`  Notes: ${noteFiles.length.toLocaleString()} files`);
                addLog(`  GPS samples: ${sampleFiles.length.toLocaleString()} files`);

                // For "missing only" mode: get existing days first
                let existingDays = new Set();
                if (missingOnly) {
                    const allDayKeys = await getAllDayKeysFromDB();
                    existingDays = new Set(allDayKeys);
                    addLog(`  Database has ${existingDays.size.toLocaleString()} existing days`);
                }

                // Safari-specific: smaller batch size and explicit pauses
                const SAFARI_BATCH_SIZE = 10;
                const SAFARI_PAUSE_MS = 5;

                // Track failed files for reporting
                const failedFiles = [];

                // Helper to read file as JSON (with Safari memory management)
                async function readFileAsJsonSafari(file) {
                    try {
                        const text = await file.text();
                        const result = JSON.parse(text);
                        return result;
                    } catch (err) {
                        failedFiles.push({ path: file.webkitRelativePath || file.name, error: err.message });
                        return null;
                    }
                }

                // Helper to read gzipped file as JSON
                async function readGzippedFileAsJsonSafari(file) {
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        const decompressed = pako.ungzip(new Uint8Array(arrayBuffer), { to: 'string' });
                        return JSON.parse(decompressed);
                    } catch (err) {
                        failedFiles.push({ path: file.webkitRelativePath || file.name, error: err.message });
                        return null;
                    }
                }

                // Step 1: Load Places (0-5%)
                addLog('\n📍 Loading Places...');
                progressFill.style.width = '0%';
                progressFill.textContent = '0%';
                const placeLookup = new Map();

                for (let i = 0; i < placeFiles.length; i += SAFARI_BATCH_SIZE) {
                    if (cancelProcessing) break;
                    const batch = placeFiles.slice(i, i + SAFARI_BATCH_SIZE);
                    const results = await Promise.all(batch.map(f => readFileAsJsonSafari(f)));

                    for (const place of results) {
                        if (place && place.placeId && !place.deleted) {
                            placeLookup.set(place.placeId, place);
                        }
                    }

                    if (i % 100 === 0) {
                        progressText.textContent = `Loading places: ${Math.min(i + SAFARI_BATCH_SIZE, placeFiles.length).toLocaleString()}/${placeFiles.length.toLocaleString()}...`;
                        await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                    }
                }
                addLog(`  Loaded ${placeLookup.size.toLocaleString()} places`);

                // Update global placesById
                for (const [placeId, place] of placeLookup) {
                    if (place.name) {
                        placesById[placeId] = place.name;
                    }
                }
                await saveMetadata('placesById', placesById);

                // Step 2: Load Notes (5-10%)
                addLog('\n📝 Loading Notes...');
                progressFill.style.width = '5%';
                progressFill.textContent = '5%';
                const notesByDate = new Map();

                for (let i = 0; i < noteFiles.length; i += SAFARI_BATCH_SIZE) {
                    if (cancelProcessing) break;
                    const batch = noteFiles.slice(i, i + SAFARI_BATCH_SIZE);
                    const results = await Promise.all(batch.map(f => readFileAsJsonSafari(f)));

                    for (const note of results) {
                        if (note && note.date && note.body && !note.deleted) {
                            const noteDate = new Date(note.date);
                            const dayKey = noteDate.getFullYear() + '-' +
                                String(noteDate.getMonth() + 1).padStart(2, '0') + '-' +
                                String(noteDate.getDate()).padStart(2, '0');
                            if (!notesByDate.has(dayKey)) {
                                notesByDate.set(dayKey, []);
                            }
                            notesByDate.get(dayKey).push(note);
                        }
                    }

                    if (i % 100 === 0) {
                        progressText.textContent = `Loading notes: ${Math.min(i + SAFARI_BATCH_SIZE, noteFiles.length).toLocaleString()}/${noteFiles.length.toLocaleString()}...`;
                        await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                    }
                }
                addLog(`  Loaded notes for ${notesByDate.size.toLocaleString()} days`);

                // Step 3: Scan Timeline Items (10-60%)
                addLog('\n🗓️ Scanning Timeline Items...');
                progressFill.style.width = '10%';
                progressFill.textContent = '10%';
                const changedItems = [];
                const changedDays = new Set();
                const changedWeeks = new Set();

                let scannedCount = 0;
                let skippedExisting = 0;
                let skippedUnchanged = 0;
                let skippedDeleted = 0;
                let maxLastSaved = lastBackupSync || '';

                for (let i = 0; i < timelineFiles.length; i += SAFARI_BATCH_SIZE) {
                    if (cancelProcessing) break;
                    const batch = timelineFiles.slice(i, i + SAFARI_BATCH_SIZE);
                    const results = await Promise.all(batch.map(f => readFileAsJsonSafari(f)));

                    for (const item of results) {
                        scannedCount++;
                        if (!item) continue;

                        if (item.deleted) {
                            skippedDeleted++;
                            continue;
                        }

                        if (item.lastSaved && item.lastSaved > maxLastSaved) {
                            maxLastSaved = item.lastSaved;
                        }

                        if (!item.startDate) continue;

                        const startDayKey = getLocalDayKey(item.startDate);
                        const endDayKey = item.endDate ? getLocalDayKey(item.endDate) : startDayKey;

                        // In missingOnly mode, check if this item spans into any missing days
                        let spansIntoMissingDay = false;
                        if (missingOnly && item.isVisit && endDayKey > startDayKey) {
                            let checkDay = startDayKey;
                            while (checkDay <= endDayKey) {
                                if (!existingDays.has(checkDay)) {
                                    spansIntoMissingDay = true;
                                    break;
                                }
                                const nextDate = new Date(checkDay + 'T12:00:00');
                                nextDate.setDate(nextDate.getDate() + 1);
                                checkDay = nextDate.toISOString().substring(0, 10);
                            }
                        }

                        if (missingOnly && existingDays.has(startDayKey) && !spansIntoMissingDay) {
                            skippedExisting++;
                            continue;
                        }

                        if (lastBackupSync && item.lastSaved && item.lastSaved <= lastBackupSync && !spansIntoMissingDay) {
                            skippedUnchanged++;
                            continue;
                        }

                        // Attach place info
                        if (item.placeId && placeLookup.has(item.placeId)) {
                            const place = placeLookup.get(item.placeId);
                            item.place = {
                                name: place.name,
                                center: place.center,
                                radiusMeters: place.radiusMeters || place.radius || 50
                            };
                            if (!item.center && place.center) {
                                item.center = place.center;
                            }
                        }

                        changedItems.push(item);
                        changedDays.add(startDayKey);
                        changedWeeks.add(getISOWeek(item.startDate));
                    }

                    // Update progress (10-60%)
                    const scanPercent = Math.min(50, Math.round((i / timelineFiles.length) * 50));
                    const totalPercent = 10 + scanPercent;
                    progressFill.style.width = totalPercent + '%';
                    progressFill.textContent = totalPercent + '%';
                    progressText.textContent = `Scanning timeline: ${scannedCount.toLocaleString()}/${timelineFiles.length.toLocaleString()}...`;

                    // Safari pause for GC
                    await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                }

                addLog(`  Scanned ${scannedCount.toLocaleString()} items`);
                addLog(`  Found ${changedItems.length.toLocaleString()} changed items in ${changedDays.size.toLocaleString()} days`);
                if (skippedExisting > 0) addLog(`  Skipped ${skippedExisting.toLocaleString()} (existing days)`);
                if (skippedUnchanged > 0) addLog(`  Skipped ${skippedUnchanged.toLocaleString()} (unchanged)`);
                if (skippedDeleted > 0) addLog(`  Skipped ${skippedDeleted.toLocaleString()} (deleted)`);

                if (cancelProcessing) {
                    addLog('\n⚠️ Import cancelled');
                    progress.style.display = 'none';
                    cancelBtn.style.display = 'none';
                    return;
                }

                if (changedItems.length === 0) {
                    addLog('\n✅ No new or changed items found');
                    progress.style.display = 'none';
                    cancelBtn.style.display = 'none';
                    await updateDBStatusDisplay();
                    return;
                }

                // Step 4: Load GPS Samples (60-80%)
                addLog('\n📍 Loading GPS samples...');
                progressFill.style.width = '60%';
                progressFill.textContent = '60%';
                const samplesByWeek = new Map();

                // Filter to only needed weeks
                const neededSampleFiles = sampleFiles.filter(file => {
                    const weekMatch = file.name.match(/^(\d{4}-W\d{2})/);
                    return weekMatch && changedWeeks.has(weekMatch[1]);
                });

                addLog(`  Loading ${neededSampleFiles.length} week files (of ${sampleFiles.length} total)`);

                for (let i = 0; i < neededSampleFiles.length; i++) {
                    if (cancelProcessing) break;
                    const file = neededSampleFiles[i];
                    const weekMatch = file.name.match(/^(\d{4}-W\d{2})/);
                    if (!weekMatch) continue;
                    const weekKey = weekMatch[1];

                    let samples = null;
                    if (file.name.endsWith('.gz')) {
                        samples = await readGzippedFileAsJsonSafari(file);
                    } else {
                        samples = await readFileAsJsonSafari(file);
                    }

                    if (samples && Array.isArray(samples)) {
                        samplesByWeek.set(weekKey, samples);
                    }

                    // Update progress (60-80%)
                    const samplePercent = Math.round((i / neededSampleFiles.length) * 20);
                    const totalPercent = 60 + samplePercent;
                    progressFill.style.width = totalPercent + '%';
                    progressFill.textContent = totalPercent + '%';
                    progressText.textContent = `Loading GPS samples: ${i + 1}/${neededSampleFiles.length}...`;

                    await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                }
                addLog(`  Loaded ${samplesByWeek.size.toLocaleString()} weeks of GPS data`);

                // Step 5: Order items and group by day (80-100%)
                addLog('\n💾 Saving to database...');
                progressFill.style.width = '80%';
                progressFill.textContent = '80%';

                const itemsByDay = new Map();
                for (const item of changedItems) {
                    const dayKey = getLocalDayKey(item.startDate);
                    if (!itemsByDay.has(dayKey)) {
                        itemsByDay.set(dayKey, []);
                    }
                    itemsByDay.get(dayKey).push(item);
                }

                const sortedDays = [...itemsByDay.keys()].sort();
                addLog(`  Processing ${sortedDays.length.toLocaleString()} days`);

                // Get existing metadata for comparison (must be a Map for importDayToDB)
                const existingMetadata = new Map();
                if (missingOnly) {
                    for (const dayKey of sortedDays) {
                        if (existingDays.has(dayKey)) {
                            const existing = await getDayFromDB(dayKey);
                            if (existing) {
                                existingMetadata.set(dayKey, {
                                    itemCount: existing.data?.timelineItems?.length || 0,
                                    lastUpdated: existing.lastUpdated || 0
                                });
                            }
                        }
                    }
                }

                const addedDays = [];
                const updatedDays = [];
                let savedDays = 0;

                for (const dayKey of sortedDays) {
                    if (cancelProcessing) break;

                    let items = itemsByDay.get(dayKey);
                    const monthKey = dayKey.substring(0, 7);

                    // CRITICAL: For incremental updates, merge new items with existing items
                    // This prevents losing existing items when only some items changed
                    if (existingDays.has(dayKey) && !forceRescan) {
                        const existingDay = await getDayFromDB(dayKey);
                        if (existingDay?.data?.timelineItems) {
                            const existingItems = existingDay.data.timelineItems;
                            const newItemIds = new Set(items.map(i => i.itemId));

                            // Add existing items that aren't being replaced by new items
                            for (const existingItem of existingItems) {
                                if (!newItemIds.has(existingItem.itemId)) {
                                    items.push(existingItem);
                                }
                            }
                        }
                    }

                    const orderedItems = orderItemsByLinkedList(items);

                    // Attach GPS samples
                    for (const item of orderedItems) {
                        if (!item.isVisit && item.startDate) {
                            const weekKey = getISOWeek(item.startDate);
                            const weekSamples = samplesByWeek.get(weekKey);
                            if (weekSamples) {
                                const itemStart = new Date(item.startDate).getTime();
                                const itemEnd = item.endDate ? new Date(item.endDate).getTime() : itemStart + 3600000;
                                item.samples = weekSamples.filter(s => {
                                    if (!s.date) return false;
                                    const sampleTime = new Date(s.date).getTime();
                                    return sampleTime >= itemStart && sampleTime <= itemEnd;
                                });
                                item.samples.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                            }
                        }
                    }

                    const dayNotes = notesByDate.get(dayKey) || [];
                    const dayData = {
                        timelineItems: orderedItems.map(item => ({
                            itemId: item.itemId,
                            isVisit: item.isVisit,
                            activityType: item.activityType || (item.isVisit ? 'stationary' : 'unknown'),
                            manualActivityType: item.manualActivityType || false,
                            startDate: item.startDate,
                            endDate: item.endDate,
                            center: item.center,
                            place: item.place,
                            placeId: item.placeId || null,
                            samples: item.samples || [],
                            streetAddress: item.streetAddress,
                            customTitle: item.customTitle || null,
                            previousItemId: item.previousItemId || null,
                            nextItemId: item.nextItemId || null,
                            notes: dayNotes.filter(n => {
                                const noteTime = new Date(n.date).getTime();
                                const itemStart = new Date(item.startDate).getTime();
                                const itemEnd = item.endDate ? new Date(item.endDate).getTime() : itemStart + 86400000;
                                return noteTime >= itemStart && noteTime <= itemEnd;
                            }).map(n => ({ body: n.body, date: n.date }))
                        }))
                    };

                    const dayLastSaved = orderedItems.reduce((max, item) =>
                        item.lastSaved && item.lastSaved > max ? item.lastSaved : max, '');
                    const lastUpdated = dayLastSaved ? new Date(dayLastSaved).getTime() : Date.now();

                    const result = await importDayToDB(dayKey, monthKey, dayData, 'backup-import', lastUpdated, existingMetadata);

                    if (result.action === 'added') addedDays.push(dayKey);
                    else if (result.action === 'updated') updatedDays.push(dayKey);

                    savedDays++;
                    if (savedDays % 20 === 0) {
                        const savePercent = Math.round((savedDays / sortedDays.length) * 20);
                        const totalPercent = 80 + savePercent;
                        progressFill.style.width = totalPercent + '%';
                        progressFill.textContent = totalPercent + '%';
                        progressText.textContent = `Saving: ${savedDays}/${sortedDays.length} days`;
                        await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                    }
                }

                // Save sync time
                await saveMetadata('lastBackupSync', maxLastSaved);

                // Reset checkbox
                const forceCheckbox = document.getElementById('backupForceRescan');
                if (forceCheckbox) forceCheckbox.checked = false;

                importAddedDays = addedDays;
                importUpdatedDays = updatedDays;

                // Invalidate cache
                const affectedMonths = new Set();
                [...addedDays, ...updatedDays].forEach(dk => affectedMonths.add(dk.substring(0, 7)));
                affectedMonths.forEach(mk => {
                    if (generatedDiaries[mk]) delete generatedDiaries[mk];
                });

                await saveMetadata('importAddedDays', addedDays);
                await saveMetadata('importUpdatedDays', updatedDays);

                if (addedDays.length > 0 || updatedDays.length > 0) {
                    updateAnalysisDataInBackground([...addedDays, ...updatedDays]);
                }

                addLog('\n✅ Backup import complete!');
                addLog(`  Days added: ${addedDays.length.toLocaleString()}`);
                addLog(`  Days updated: ${updatedDays.length.toLocaleString()}`);

                if (addedDays.length > 0) {
                    addLog(`  New data range: ${addedDays[0]} to ${addedDays[addedDays.length - 1]}`);
                }

                // Report any files that failed to read
                if (failedFiles.length > 0) {
                    addLog(`\n⚠️ ${failedFiles.length} files could not be read:`);
                    // Show first 10 failed files
                    const showCount = Math.min(failedFiles.length, 10);
                    for (let i = 0; i < showCount; i++) {
                        addLog(`  • ${failedFiles[i].path}`);
                    }
                    if (failedFiles.length > 10) {
                        addLog(`  ... and ${failedFiles.length - 10} more`);
                    }
                }

                progress.style.display = 'none';
                cancelBtn.style.display = 'none';

                const results = document.getElementById('results');
                if (results) {
                    results.style.display = 'block';
                    const resultsList = document.getElementById('resultsList');
                    if (resultsList) {
                        resultsList.innerHTML = `
                            <p><strong>${addedDays.length}</strong> days added</p>
                            <p><strong>${updatedDays.length}</strong> days updated</p>
                            <p>Total: <strong>${sortedDays.length}</strong> days processed</p>
                            ${failedFiles.length > 0 ? `<p style="color: #856404;"><strong>${failedFiles.length}</strong> files unreadable</p>` : ''}
                        `;
                    }
                }

                // Refresh display
                await updateDBStatusDisplay();
                await loadMostRecentMonth();

            } catch (err) {
                addLog(`\n❌ Error: ${err.message}`, 'error');
                console.error('Backup import error:', err);
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
            }
        }

        // Import from Arc Timeline iCloud backup
        // Helper: get ISO week string from date (e.g., "2025-W03")
        function getISOWeek(dateStr) {
            const date = new Date(dateStr);
            const thursday = new Date(date);
            thursday.setDate(date.getDate() + (4 - (date.getDay() || 7)));
            // Normalize to midnight to avoid time-of-day affecting week calculation
            thursday.setHours(0, 0, 0, 0);
            const yearStart = new Date(thursday.getFullYear(), 0, 1);
            const weekNum = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
            return `${thursday.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
        }
        // Track days added/updated in last import (for diary display)
        let importAddedDays = [];
        let importUpdatedDays = [];
        let importChangedItemIds = new Set(); // itemIds changed in last import (for + bullet)
        let lastImportReport = ''; // For copy to clipboard
        
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
        // Events Management (Multi-day date ranges)
        // ========================================

        const EVENTS_STORAGE_KEY = 'arcDiaryEvents';
        const CATEGORIES_STORAGE_KEY = 'arcDiaryEventCategories';
        let events = [];
        let eventCategories = [];

        // Default categories
        const DEFAULT_CATEGORIES = [
            { id: 'vacation', name: 'Vacation', color: '#4CAF50' },
            { id: 'conference', name: 'Conference', color: '#2196F3' },
            { id: 'trip', name: 'Trip', color: '#FF9800' },
            { id: 'business', name: 'Business', color: '#607D8B' },
            { id: 'family', name: 'Family', color: '#E91E63' },
            { id: 'other', name: 'Other', color: '#9C27B0' }
        ];

        // Event creation state
        let eventCreationState = {
            active: false,
            editingEventId: null,  // null for new event, ID for editing
            startDate: null,
            startTime: null,
            startItemId: null,
            endDate: null,
            endTime: null,
            endItemId: null
        };

        /**
         * Load events from localStorage
         */
        function loadEvents() {
            try {
                const stored = localStorage.getItem(EVENTS_STORAGE_KEY);
                events = stored ? JSON.parse(stored) : [];
                logDebug(`📅 Loaded ${events.length} events`);
            } catch (error) {
                logError('Error loading events:', error);
                events = [];
            }
        }

        /**
         * Save events to localStorage
         */
        function saveEvents() {
            try {
                localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
                logDebug(`📅 Saved ${events.length} events`);
            } catch (error) {
                logError('Error saving events:', error);
            }
        }

        /**
         * Load event categories from localStorage
         */
        function loadEventCategories() {
            try {
                const stored = localStorage.getItem(CATEGORIES_STORAGE_KEY);
                eventCategories = stored ? JSON.parse(stored) : [...DEFAULT_CATEGORIES];
                logDebug(`📅 Loaded ${eventCategories.length} event categories`);
            } catch (error) {
                logError('Error loading event categories:', error);
                eventCategories = [...DEFAULT_CATEGORIES];
            }
        }

        /**
         * Save event categories to localStorage
         */
        function saveEventCategories() {
            try {
                localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(eventCategories));
                logDebug(`📅 Saved ${eventCategories.length} event categories`);
            } catch (error) {
                logError('Error saving event categories:', error);
            }
        }

        /**
         * Generate unique event ID
         */
        function generateEventId() {
            return 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }

        /**
         * Create a new event
         * @param {Object} eventData - Event data
         * @returns {Object} The created event
         */
        function createEvent(eventData) {
            const event = {
                eventId: generateEventId(),
                name: eventData.name || 'Untitled Event',
                startDate: eventData.startDate,
                startTime: eventData.startTime || null,
                startItemId: eventData.startItemId || null,
                endDate: eventData.endDate,
                endTime: eventData.endTime || null,
                endItemId: eventData.endItemId || null,
                description: eventData.description || '',
                category: eventData.category || 'other',
                color: eventData.color || '#9C27B0',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            events.push(event);
            saveEvents();
            logInfo(`📅 Created event: ${event.name} (${event.startDate} to ${event.endDate})`);
            return event;
        }

        /**
         * Update an existing event
         * @param {string} eventId - Event ID to update
         * @param {Object} updates - Fields to update
         * @returns {Object|null} Updated event or null if not found
         */
        function updateEvent(eventId, updates) {
            const index = events.findIndex(e => e.eventId === eventId);
            if (index === -1) {
                logError(`Event not found: ${eventId}`);
                return null;
            }

            events[index] = {
                ...events[index],
                ...updates,
                updatedAt: new Date().toISOString()
            };

            saveEvents();
            logInfo(`📅 Updated event: ${events[index].name}`);
            return events[index];
        }

        /**
         * Delete an event
         * @param {string} eventId - Event ID to delete
         * @returns {boolean} True if deleted
         */
        function deleteEvent(eventId) {
            const index = events.findIndex(e => e.eventId === eventId);
            if (index === -1) {
                return false;
            }

            const deletedEvent = events.splice(index, 1)[0];
            saveEvents();
            logInfo(`📅 Deleted event: ${deletedEvent.name}`);
            return true;
        }

        /**
         * Get event by ID
         * @param {string} eventId - Event ID
         * @returns {Object|null} Event or null
         */
        function getEventById(eventId) {
            return events.find(e => e.eventId === eventId) || null;
        }

        /**
         * Get all events sorted by start date (newest first)
         * @returns {Array} Sorted events
         */
        function getAllEvents() {
            return [...events].sort((a, b) => b.startDate.localeCompare(a.startDate));
        }

        /**
         * Check if a day falls within any event's date range
         * @param {string} dayKey - Day key (YYYY-MM-DD)
         * @returns {Array} Events that contain this day
         */
        function getEventsForDay(dayKey) {
            return events.filter(event => {
                return dayKey >= event.startDate && dayKey <= event.endDate;
            });
        }

        /**
         * Check if a specific datetime falls within an event (considering time bounds)
         * @param {string} dayKey - Day key (YYYY-MM-DD)
         * @param {string} time - Time (HH:MM)
         * @returns {Array} Events that contain this datetime
         */
        function getEventsForDateTime(dayKey, time) {
            return events.filter(event => {
                // Check date bounds first
                if (dayKey < event.startDate || dayKey > event.endDate) {
                    return false;
                }

                // If on start day, check start time
                if (dayKey === event.startDate && event.startTime && time) {
                    if (time < event.startTime) {
                        return false;
                    }
                }

                // If on end day, check end time
                if (dayKey === event.endDate && event.endTime && time) {
                    if (time > event.endTime) {
                        return false;
                    }
                }

                return true;
            });
        }

        /**
         * Get events within a date range (for Analysis)
         * @param {string} startDate - Start date (YYYY-MM-DD)
         * @param {string} endDate - End date (YYYY-MM-DD)
         * @returns {Array} Events that overlap with the range
         */
        function getEventsInRange(startDate, endDate) {
            return events.filter(event => {
                // Event overlaps if it starts before range ends AND ends after range starts
                return event.startDate <= endDate && event.endDate >= startDate;
            });
        }

        /**
         * Add a new category
         * @param {string} name - Category name
         * @param {string} color - Category color (hex)
         * @returns {Object} The created category
         */
        function addEventCategory(name, color = '#9C27B0') {
            const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');

            // Check for duplicate
            if (eventCategories.some(c => c.id === id)) {
                logError(`Category already exists: ${name}`);
                return null;
            }

            const category = { id, name, color };
            eventCategories.push(category);
            saveEventCategories();
            logInfo(`📅 Added category: ${name}`);
            return category;
        }

        /**
         * Update a category
         * @param {string} categoryId - Category ID
         * @param {Object} updates - Fields to update (name, color)
         * @returns {Object|null} Updated category or null
         */
        function updateEventCategory(categoryId, updates) {
            const index = eventCategories.findIndex(c => c.id === categoryId);
            if (index === -1) {
                return null;
            }

            eventCategories[index] = { ...eventCategories[index], ...updates };
            saveEventCategories();
            return eventCategories[index];
        }

        /**
         * Delete a category (moves events to 'other')
         * @param {string} categoryId - Category ID to delete
         * @returns {boolean} True if deleted
         */
        function deleteEventCategory(categoryId) {
            if (categoryId === 'other') {
                logError('Cannot delete the "other" category');
                return false;
            }

            const index = eventCategories.findIndex(c => c.id === categoryId);
            if (index === -1) {
                return false;
            }

            // Move events with this category to 'other'
            events.forEach(event => {
                if (event.category === categoryId) {
                    event.category = 'other';
                }
            });
            saveEvents();

            eventCategories.splice(index, 1);
            saveEventCategories();
            logInfo(`📅 Deleted category: ${categoryId}`);
            return true;
        }

        /**
         * Get category by ID
         * @param {string} categoryId - Category ID
         * @returns {Object|null} Category or null
         */
        function getEventCategory(categoryId) {
            return eventCategories.find(c => c.id === categoryId) || null;
        }

        /**
         * Export events data for backup
         * @returns {Object} Events export data
         */
        function exportEventsData() {
            return {
                events: events,
                categories: eventCategories,
                exportedAt: new Date().toISOString()
            };
        }

        /**
         * Import events data from backup
         * @param {Object} data - Events data to import
         * @param {boolean} merge - If true, merge with existing; if false, replace
         * @returns {Object} Import result with counts
         */
        function importEventsData(data, merge = true) {
            const result = { eventsAdded: 0, eventsUpdated: 0, categoriesAdded: 0 };

            if (!data) return result;

            // Import categories first
            if (data.categories && Array.isArray(data.categories)) {
                data.categories.forEach(cat => {
                    if (!eventCategories.some(c => c.id === cat.id)) {
                        eventCategories.push(cat);
                        result.categoriesAdded++;
                    }
                });
                saveEventCategories();
            }

            // Import events
            if (data.events && Array.isArray(data.events)) {
                if (merge) {
                    data.events.forEach(importedEvent => {
                        const existingIndex = events.findIndex(e => e.eventId === importedEvent.eventId);
                        if (existingIndex === -1) {
                            events.push(importedEvent);
                            result.eventsAdded++;
                        } else {
                            // Update if imported version is newer
                            if (importedEvent.updatedAt > events[existingIndex].updatedAt) {
                                events[existingIndex] = importedEvent;
                                result.eventsUpdated++;
                            }
                        }
                    });
                } else {
                    // Replace all
                    result.eventsAdded = data.events.length;
                    events = data.events;
                }
                saveEvents();
            }

            logInfo(`📅 Imported events: ${result.eventsAdded} added, ${result.eventsUpdated} updated, ${result.categoriesAdded} categories`);
            return result;
        }

        // Initialize events on load
        loadEvents();
        loadEventCategories();

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
        
        // Raw timeline toggle - shows uncoalesced view
        const rawTimelineEl = document.getElementById('rawTimeline');
        if (rawTimelineEl) {
            rawTimelineEl.addEventListener('change', () => {
                COALESCE_SETTINGS.showRawTimeline = rawTimelineEl.checked;
                if (currentMonth) {
                    // Must regenerate from source data, not just re-render
                    regenerateCurrentMonthDiary();
                }
            });
        }
        
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
        
        // Setup backup import handler
        setupBackupImportHandler();

        // Initialize import module (if loaded)
        if (window.ArcImportModule) {
            window.ArcImportModule.init({
                // Database access
                getDB: () => db,
                getDayFromDB: getDayFromDB,

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
            async selectMonth(monthKey) {
                if (!this.#internalCall) {
                    this.#renderVersion++;
                }
                const version = this.#renderVersion;
                
                logDebug(`🎯 NavigationController.selectMonth(${monthKey})`);
                
                // Clear route search if active (user is returning to diary mode)
                if (window.routeSearchLayer) {
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
            selectDay(dayKey) {
                this.#renderVersion++;
                logDebug(`🎯 NavigationController.selectDay(${dayKey})`);
                
                // Clear route search if active (user is returning to diary mode)
                if (window.routeSearchLayer) {
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
                highlightAndScrollToDay(dayKey);
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
                if (window.routeSearchLayer) {
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
                
                const days = getDaysFromModel(monthKey);
                if (days.length === 0) return false;
                
                // No selection state - conceptually "before" the month
                if (this.#dayKey === null && this.#entryId === null) {
                    if (delta > 0) {
                        // Right → first day
                        this.selectDay(days[0]);
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
                            this.selectDay(prevDays[prevDays.length - 1]);
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
                        this.selectDay(days[currentIdx]);
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
                        this.selectDay(prevDays[prevDays.length - 1]);
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
                        this.selectDay(nextDays[0]);
                    }
                    return true;
                }
                
                // Same month
                this.selectDay(days[newIdx]);
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
        
        async function navigateDay(direction) {
            const days = getDaysInCurrentMonth();
            if (days.length === 0) return;
            
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
                        highlightAndScrollToDay(prevMonthDays[currentDayIndex]);
                    }
                    return;
                } else {
                    // Already at first month, wrap to last day of current month
                    currentDayIndex = days.length - 1;
                    highlightAndScrollToDay(days[currentDayIndex]);
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
                        highlightAndScrollToDay(nextMonthDays[0]);
                    }
                    return;
                } else {
                    // Already at last month, wrap to first day of current month
                    currentDayIndex = 0;
                    highlightAndScrollToDay(days[0]);
                }
            } else {
                // Normal navigation within same month
                currentDayIndex = newIndex;
                highlightAndScrollToDay(days[currentDayIndex]);
            }
            
            // Update day nav button states
            updateDayNavButtons();
            
            // Update stats panel if it's open
            updateStatsForCurrentView();
        }
        
        function highlightAndScrollToDay(dayKey) {
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
                    diaryPanel.scrollTo({
                        top: Math.max(0, targetScroll),
                        behavior: 'smooth'
                    });
                } else {
                    // Fallback to standard scrollIntoView
                    dayTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
                            if (eventCreationState.active && eventBoundMode) {
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
                        if (eventCreationState.active && eventBoundMode) {
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
                
                if (activity !== currentActivity) {
                    // Different activity type - always split
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
        
        function getActivityFilterType(activity) {
            activity = (activity || '').toLowerCase();
            
            if (activity.includes('stationary')) return 'stationary';
            if (activity.includes('walk') || activity.includes('golf') || activity.includes('wheelchair')) return 'walking';
            if (activity.includes('hiking')) return 'hiking';
            if (activity.includes('running')) return 'running';
            if (activity.includes('cycling') || activity.includes('bicycle') || activity.includes('rowing') || 
                activity.includes('swimming') || activity.includes('kayaking')) return 'cycling';
            if (activity.includes('car') || activity.includes('automotive') || activity.includes('taxi')) return 'car';
            if (activity.includes('bus')) return 'bus';
            if (activity.includes('motorcycle') || activity.includes('scooter')) return 'motorcycle';
            if (activity.includes('airplane') || activity.includes('aircraft') || activity.includes('flight') || 
                activity.includes('hotairballoon')) return 'airplane';
            if (activity.includes('boat') || activity.includes('ferry')) return 'boat';
            if (activity.includes('train') || activity.includes('metro') || activity.includes('tram') || 
                activity.includes('cablecar') || activity.includes('funicular') || activity.includes('chairlift') || 
                activity.includes('skilift') || activity.includes('railway')) return 'train';
            if (activity.includes('skateboard')) return 'skateboarding';
            if (activity.includes('inlineskating') || activity.includes('rollerblade')) return 'inlineSkating';
            if (activity.includes('snowboard')) return 'snowboarding';
            if (activity.includes('skiing') || activity.includes('ski')) return 'skiing';
            if (activity.includes('horseback') || activity.includes('horse')) return 'horseback';
            if (activity.includes('surfing') || activity.includes('surf')) return 'surfing';
            if (activity.includes('tractor')) return 'tractor';
            if (activity.includes('tuktuk') || activity.includes('songthaew')) return 'tuktuk';
            
            return 'unknown';
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
        
        // ============================
        // LocalStorage Diary Persistence
        // ============================
        
        const STORAGE_KEY_DIARIES = 'arcDiaryGeneratedDiaries';
        const STORAGE_KEY_METADATA = 'arcDiaryMetadata';
        
        function saveDiariesToLocalStorage() {
            try {
                const dataStr = JSON.stringify(generatedDiaries);
                const sizeInMB = (dataStr.length / (1024 * 1024)).toFixed(2);
                
                logDebug(`💾 Attempting to save ${sizeInMB}MB of diary data to localStorage...`);
                
                // Check if data is too large for localStorage (typical limit is 5-10MB)
                if (parseFloat(sizeInMB) > 10) {
                    logWarn(`⚠️ Data size (${sizeInMB}MB) exceeds recommended localStorage limit (10MB)`);
                    logDebug(`💡 Tip: Select a smaller date range (6 months or less) to enable auto-save`);
                    addLog(`Diary data (${sizeInMB}MB) is too large to save for quick reload. Select a smaller date range to enable this feature.`, 'error');
                    return false;
                }
                
                // Save the diaries
                localStorage.setItem(STORAGE_KEY_DIARIES, dataStr);
                
                // Save metadata
                const metadata = {
                    savedDate: new Date().toISOString(),
                    monthCount: monthKeys.length,
                    noteCount: Object.values(generatedDiaries).reduce((sum, d) => sum + d.noteCount, 0),
                    months: monthKeys,
                    sizeInMB: parseFloat(sizeInMB)
                };
                localStorage.setItem(STORAGE_KEY_METADATA, JSON.stringify(metadata));
                
                logDebug(`✅ Saved ${monthKeys.length} months, ${metadata.noteCount} notes (${sizeInMB}MB)`);
                addLog(`✅ Diary data saved for quick reload next time (${sizeInMB}MB)`, 'success');
                return true;
            } catch (error) {
                logError('❌ Failed to save to localStorage:', error);
                if (error.name === 'QuotaExceededError') {
                    addLog('Storage quota exceeded! Your diary data is too large. Try selecting a smaller date range (6 months or less).', 'error');
                } else {
                    addLog(`Failed to save diary data: ${error.message}`, 'error');
                }
                return false;
            }
        }
        
        function loadDiariesFromLocalStorage() {
            try {
                const dataStr = localStorage.getItem(STORAGE_KEY_DIARIES);
                if (!dataStr) {
                    logDebug('📂 No saved diary data found');
                    return false;
                }
                
                logDebug(`📂 Loading diary data from localStorage...`);
                generatedDiaries = JSON.parse(dataStr);
                monthKeys = Object.keys(generatedDiaries).sort();
                currentMonth = monthKeys[0] || null;
                
                const metadata = JSON.parse(localStorage.getItem(STORAGE_KEY_METADATA) || '{}');
                logDebug(`✅ Loaded ${monthKeys.length} months, ${metadata.noteCount || 0} notes`);
                
                return true;
            } catch (error) {
                logError('❌ Failed to load from localStorage:', error);
                return false;
            }
        }
        
        function getSavedDiaryInfo() {
            try {
                const metadataStr = localStorage.getItem(STORAGE_KEY_METADATA);
                if (!metadataStr) return null;
                return JSON.parse(metadataStr);
            } catch (error) {
                return null;
            }
        }
        
        function clearSavedDiary() {
            localStorage.removeItem(STORAGE_KEY_DIARIES);
            localStorage.removeItem(STORAGE_KEY_METADATA);
            logDebug('🗑️ Cleared saved diary data');
        }
        
        function loadSavedDiary() {
            if (loadDiariesFromLocalStorage()) {
                fileCount.textContent = `Loaded saved diary from localStorage`;
                fileCount.style.color = '#388e3c';
                fileCount.style.fontWeight = '600';
                
                // Populate month selector (legacy localStorage path)
                populateSelectorsLegacy();
                
                openDiaryReader();
            } else {
                alert('Failed to load saved diary. Please select your diary folder again.');
                showFileSelector();
            }
        }
        
        function showFileSelector() {
            document.getElementById('savedDiarySection').style.display = 'none';
            document.getElementById('fileInputSection').style.display = 'block';
        }
        
        function confirmClearSavedDiary() {
            if (confirm('Are you sure you want to clear the saved diary? You will need to reload your diary files next time.')) {
                clearSavedDiary();
                updateSavedDiaryUI();
                alert('Saved diary cleared');
            }
        }
        
        function updateSavedDiaryUI() {
            const info = getSavedDiaryInfo();
            const savedSection = document.getElementById('savedDiarySection');
            const fileSection = document.getElementById('fileInputSection');
            const savedInfo = document.getElementById('savedDiaryInfo');
            
            if (info) {
                // Show saved diary section
                const savedDate = new Date(info.savedDate);
                const dateStr = savedDate.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                savedInfo.textContent = `${info.monthCount} months, ${info.noteCount} notes • Saved ${dateStr} • ${info.sizeInMB}MB`;
                savedSection.style.display = 'block';
                fileSection.style.display = 'none';
            } else {
                // Show file selector
                savedSection.style.display = 'none';
                fileSection.style.display = 'block';
            }
        }
        
        // Add saved diary HTML to page
        function initializeSavedDiaryUI() {
            const fileInputSection = document.getElementById('fileInputSection');
            if (!fileInputSection) return;
            
            const savedDiaryHTML = `
                <div id="savedDiarySection" style="display: none; margin-bottom: 30px;">
                    <div style="background: #f0f7ff; border: 2px solid #667eea; border-radius: 12px; padding: 20px;">
                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                            <span style="font-size: 32px; margin-right: 15px;">💾</span>
                            <div style="flex: 1;">
                                <div style="font-weight: 600; font-size: 16px; color: #667eea;">Saved Diary Found</div>
                                <div id="savedDiaryInfo" style="font-size: 13px; color: #666; margin-top: 3px;"></div>
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <button onclick="loadSavedDiary()" style="flex: 1; min-width: 150px; background: #667eea; color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;">
                                📂 Load Saved Diary
                            </button>
                            <button onclick="showFileSelector()" style="flex: 1; min-width: 150px; background: white; color: #667eea; border: 2px solid #667eea; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;">
                                🔄 Load Different Diary
                            </button>
                            <button onclick="confirmClearSavedDiary()" style="background: #d32f2f; color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;">
                                🗑️ Clear Saved
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            fileInputSection.insertAdjacentHTML('beforebegin', savedDiaryHTML);
            
            // Check if saved diary exists and update UI
            updateSavedDiaryUI();
        }
        
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
        
        function calculateDistance(lat1, lon1, lat2, lon2) {
            const R = 6371000;
            const φ1 = lat1 * Math.PI / 180;
            const φ2 = lat2 * Math.PI / 180;
            const Δφ = (lat2 - lat1) * Math.PI / 180;
            const Δλ = (lon2 - lon1) * Math.PI / 180;
            
            const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                      Math.cos(φ1) * Math.cos(φ2) *
                      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            
            return R * c;
        }
        
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

        function toggleElevationPanel() {
            if (elevationPanelVisible) {
                closeElevationPanel();
            } else {
                openElevationPanel();
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

            // Apply current diary transparency to elevation panel
            applyElevationPanelTransparency();

            // Position panel in safe space
            positionElevationPanel();

            // Register bottom margin with NavigationController so map content avoids the panel
            // Panel is ~200px tall + 20px bottom margin
            // Allow refit so map adjusts to show content above the panel
            NavigationController.updateViewportMargins({ bottom: 220 }, { delay: 100 });

            // Update chart with visible routes
            updateElevationChart();

            // Listen for map move events to update chart
            if (map) {
                map.on('moveend', updateElevationChart);
            }
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

            // Clear bottom margin from NavigationController
            // Allow refit so map can reclaim the space
            NavigationController.updateViewportMargins({ bottom: 0 }, { delay: 100 });

            // Remove elevation marker from map
            hideElevationMapMarker();

            // Stop listening for map moves
            if (map) {
                map.off('moveend', updateElevationChart);
            }
        }

        function updateElevationChart() {
            const canvas = document.getElementById('elevationCanvas');
            const noDataEl = document.getElementById('elevationNoData');
            if (!canvas || !map) return;

            const ctx = canvas.getContext('2d');
            const bounds = map.getBounds();

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
                        activityType: 'driving'
                    };
                });

                // Hide no-data message, show canvas
                if (noDataEl) noDataEl.style.display = 'none';
                canvas.style.display = 'block';

                // Store data for tooltip interaction
                elevationChartData = elevationPoints;

                // Render the chart
                renderElevationChart(ctx, canvas, elevationPoints);
                return;
            }

            // Check if we're in day mode - elevation only works for specific days
            if (mapMode !== 'day' || !currentDayKey) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (noDataEl) {
                    noDataEl.innerHTML = '<span>Select a specific day to view elevation profile</span>';
                    noDataEl.style.display = 'block';
                }
                canvas.style.display = 'none';
                elevationChartData = null;
                return;
            }

            // Get visible routes with elevation data
            const visibleElevationData = getVisibleElevationData(bounds);

            if (visibleElevationData.length === 0) {
                // No data - show message
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (noDataEl) {
                    noDataEl.innerHTML = '<span>No elevation data for visible routes</span>';
                    noDataEl.style.display = 'block';
                }
                canvas.style.display = 'none';
                elevationChartData = null;
                return;
            }

            // Hide no-data message, show canvas
            if (noDataEl) noDataEl.style.display = 'none';
            canvas.style.display = 'block';

            // Store data for tooltip interaction
            elevationChartData = visibleElevationData;

            // Render the chart
            renderElevationChart(ctx, canvas, visibleElevationData);
        }

        function getVisibleElevationData(bounds) {
            // Collect elevation points from visible route segments
            const elevationPoints = [];

            if (!allRouteSegments || allRouteSegments.length === 0) return elevationPoints;

            allRouteSegments.forEach(segObj => {
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
                                    timestamp: point.timestamp
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
            const padding = { top: 10, right: 15, bottom: 25, left: 45 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;

            // Clear canvas
            ctx.clearRect(0, 0, width, height);

            // Find min/max values
            const altitudes = data.map(d => d.altitude);
            const minAlt = Math.min(...altitudes);
            const maxAlt = Math.max(...altitudes);
            const maxDist = data[data.length - 1]?.distance || 0;

            // Add padding to altitude range
            const altRange = maxAlt - minAlt || 1;
            const altPadding = altRange * 0.1;
            const yMin = Math.max(0, minAlt - altPadding);
            const yMax = maxAlt + altPadding;

            // Scale functions
            const xScale = (dist) => padding.left + (dist / maxDist) * chartWidth;
            const yScale = (alt) => padding.top + chartHeight - ((alt - yMin) / (yMax - yMin)) * chartHeight;

            // Store scale info for tooltip
            canvas._chartInfo = {
                padding, chartWidth, chartHeight, xScale, yScale,
                maxDist, yMin, yMax, data
            };

            // Draw grid lines
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
            ctx.lineWidth = 1;

            // Horizontal grid lines (altitude)
            const yTicks = 4;
            for (let i = 0; i <= yTicks; i++) {
                const y = padding.top + (chartHeight / yTicks) * i;
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();

                // Y-axis labels
                const altVal = yMax - ((yMax - yMin) / yTicks) * i;
                ctx.fillStyle = '#86868b';
                ctx.font = '10px -apple-system, sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(`${Math.round(altVal)}m`, padding.left - 5, y + 3);
            }

            // X-axis labels
            const xTicks = 5;
            for (let i = 0; i <= xTicks; i++) {
                const dist = (maxDist / xTicks) * i;
                const x = xScale(dist);

                ctx.fillStyle = '#86868b';
                ctx.font = '10px -apple-system, sans-serif';
                ctx.textAlign = 'center';
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

        function setupElevationCanvasEvents(canvas) {
            // Remove existing handlers
            canvas.onmousemove = null;
            canvas.onmouseleave = null;

            const cursor = document.getElementById('elevationCursor');

            canvas.onmousemove = (e) => {
                if (!canvas._chartInfo || !elevationChartData) return;

                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const { padding, chartWidth, chartHeight, maxDist, yScale, data } = canvas._chartInfo;

                // Check if mouse is in chart area
                if (x < padding.left || x > padding.left + chartWidth) {
                    hideElevationTooltip();
                    hideElevationMapMarker();
                    hideElevationCursor();
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

                // Calculate grade if possible
                const idx = data.indexOf(nearest);
                let grade = null;
                if (idx > 0) {
                    const prev = data[idx - 1];
                    const distDiff = (nearest.distance - prev.distance) * 1000; // in meters
                    if (distDiff > 0) {
                        const altDiff = nearest.altitude - prev.altitude;
                        grade = (altDiff / distDiff) * 100;
                    }
                }

                // Show cursor line from chart top to 0m baseline
                showElevationCursor(x, padding.top, chartHeight);

                // Show tooltip
                showElevationTooltip(e.clientX, e.clientY, nearest, grade);

                // Show marker on map
                showElevationMapMarker(nearest.lat, nearest.lng);
            };

            canvas.onmouseleave = () => {
                hideElevationTooltip();
                hideElevationMapMarker();
                hideElevationCursor();
            };
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

        function showElevationTooltip(clientX, clientY, point, grade) {
            const tooltip = document.getElementById('elevationTooltip');
            const valueEl = document.getElementById('elevationTooltipValue');
            if (!tooltip || !valueEl) return;

            const distStr = point.distance < 1
                ? `${(point.distance * 1000).toFixed(0)}m`
                : `${point.distance.toFixed(2)}km`;

            let html = `<div><strong>${Math.round(point.altitude)}m</strong> at ${distStr}</div>`;
            if (grade !== null) {
                const gradeStr = grade >= 0 ? `+${grade.toFixed(1)}%` : `${grade.toFixed(1)}%`;
                html += `<div style="font-size: 11px; opacity: 0.8;">Grade: ${gradeStr}</div>`;
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
                            let locationName = item.customTitle || '';
                            
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
                            
                            const activityType = item.activityType || '';
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
                resultsList.innerHTML = '<div class="search-results-empty">No matches found for "' + query + '"</div>';
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
                displayText = displayText.replace(highlightRegex, '<mark>$1</mark>');
                
                const icon = match.type === 'note' ? '📝' : (match.type === 'visit' ? '📍' : '🚶');
                
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.dataset.index = i;
                div.onclick = () => navigateToSearchResultByIndex(i);
                div.innerHTML = `
                    <div class="search-result-date">${dateStr}</div>
                    <div class="search-result-time">${match.time} ${icon} ${match.name}</div>
                    <div class="search-result-text">${displayText}</div>
                `;
                
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
            
            let html = '';
            
            if (isTruncated) {
                html += `<div class="search-results-warning">⚠️ Showing first ${MAX_RESULTS} results. Narrow your search.</div>`;
            }
            
            html += matches.map((match, index) => {
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
                displayText = displayText.replace(regex, '<mark>$1</mark>');
                
                const icon = match.type === 'note' ? '📝' : (match.type === 'visit' ? '📍' : '🚶');
                
                return `<div class="search-result-item" data-index="${index}" onclick="navigateToSearchResultByIndex(${index})">
                    <div class="search-result-date">${dateStr}</div>
                    <div class="search-result-time">${match.time} ${icon} ${match.name}</div>
                    <div class="search-result-text">${displayText}</div>
                </div>`;
            }).join('');
            
            resultsList.innerHTML = html;
            
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

        // ========================================
        // Event Slider UI Functions
        // ========================================

        let eventBoundMode = null; // 'start' | 'end' | null

        /**
         * Open the event slider (for creating or editing)
         * @param {string|null} eventId - Event ID to edit, or null for new event
         */
        function openEventSlider(eventId = null) {
            const slider = document.getElementById('eventSlider');
            const content = document.querySelector('.event-slider-content');
            const listContainer = document.getElementById('eventListContainer');
            const title = document.getElementById('eventSliderTitle');
            const deleteBtn = document.getElementById('eventDeleteBtn');

            if (!slider) return;

            // Check if slider is already open (switching from list to edit)
            const wasAlreadyOpen = slider.classList.contains('open');

            // Close search slider if open
            closeSearchResults();

            // Position slider like search results
            positionEventSlider();

            // Reset state
            eventCreationState = {
                active: true,
                editingEventId: eventId,
                startDate: null,
                startTime: null,
                startItemId: null,
                endDate: null,
                endTime: null,
                endItemId: null
            };
            eventBoundMode = null;

            // Populate category dropdown
            populateEventCategories();

            if (eventId) {
                // Editing existing event
                const event = getEventById(eventId);
                if (event) {
                    title.textContent = 'Edit Event';
                    deleteBtn.style.display = 'block';

                    document.getElementById('eventName').value = event.name;
                    document.getElementById('eventDescription').value = event.description || '';
                    document.getElementById('eventCategory').value = event.category;

                    // Set start/end from event
                    eventCreationState.startDate = event.startDate;
                    eventCreationState.startTime = event.startTime;
                    eventCreationState.startItemId = event.startItemId;
                    eventCreationState.endDate = event.endDate;
                    eventCreationState.endTime = event.endTime;
                    eventCreationState.endItemId = event.endItemId;

                    updateEventDateTimeDisplay('start');
                    updateEventDateTimeDisplay('end');
                }
            } else {
                // New event
                title.textContent = 'New Event';
                deleteBtn.style.display = 'none';

                document.getElementById('eventName').value = '';
                document.getElementById('eventDescription').value = '';
                document.getElementById('eventCategory').value = 'vacation';

                // Clear date/time inputs
                document.getElementById('eventStartDate').value = '';
                document.getElementById('eventStartTime').value = '';
                document.getElementById('eventEndDate').value = '';
                document.getElementById('eventEndTime').value = '';
            }

            // Show content, hide list
            content.style.display = 'block';
            listContainer.style.display = 'none';

            // Open slider (only update map padding if slider wasn't already open)
            slider.classList.add('open');
            if (!wasAlreadyOpen) {
                updateMapPaddingForSlider(true);
            }

            // Focus name input
            setTimeout(() => {
                document.getElementById('eventName')?.focus();
            }, 300);
        }

        /**
         * Open event slider showing list of events (or close if already open)
         */
        function openEventList() {
            const slider = document.getElementById('eventSlider');
            const content = document.querySelector('.event-slider-content');
            const listContainer = document.getElementById('eventListContainer');
            const title = document.getElementById('eventSliderTitle');

            if (!slider) return;

            // Toggle: if already open, close it
            if (slider.classList.contains('open')) {
                closeEventSlider();
                return;
            }

            // Close search slider if open
            closeSearchResults();

            // Position slider
            positionEventSlider();

            // Reset creation state
            eventCreationState.active = false;
            eventBoundMode = null;
            clearEventBoundMarkers();

            title.textContent = 'Events';

            // Populate event list
            populateEventList();

            // Show list, hide content
            content.style.display = 'none';
            listContainer.style.display = 'block';

            // Open slider
            slider.classList.add('open');
            updateMapPaddingForSlider(true);
        }

        /**
         * Close the event slider
         */
        function closeEventSlider() {
            const slider = document.getElementById('eventSlider');
            if (slider) slider.classList.remove('open');

            // Reset state
            eventCreationState.active = false;
            eventBoundMode = null;
            clearEventBoundMarkers();
            document.body.classList.remove('event-bound-mode-active');

            // Update map padding
            updateMapPaddingForSlider(false);
        }

        /**
         * Cancel event edit and return to list view
         */
        function cancelEventEdit() {
            const content = document.querySelector('.event-slider-content');
            const listContainer = document.getElementById('eventListContainer');
            const title = document.getElementById('eventSliderTitle');

            // Reset state
            eventCreationState.active = false;
            eventBoundMode = null;
            clearEventBoundMarkers();
            document.body.classList.remove('event-bound-mode-active');

            // Switch to list view
            title.textContent = 'Events';
            content.style.display = 'none';
            listContainer.style.display = 'block';

            // Refresh list
            populateEventList();
        }

        /**
         * Position event slider to match diary position
         */
        function positionEventSlider() {
            const slider = document.getElementById('eventSlider');
            const diaryFloat = document.querySelector('.diary-float');
            const modalHeader = document.querySelector('.modal-header');

            if (!slider || !diaryFloat) return;

            const diaryRect = diaryFloat.getBoundingClientRect();
            const headerBottom = modalHeader ? modalHeader.getBoundingClientRect().bottom + 15 : 0;

            const sliderTop = Math.max(diaryRect.top, headerBottom);

            slider.style.left = (diaryRect.right - 20) + 'px';
            slider.style.top = sliderTop + 'px';
            slider.style.bottom = (window.innerHeight - diaryRect.bottom) + 'px';
            slider.style.height = 'auto';
        }

        /**
         * Escape HTML special characters to prevent XSS
         */
        function escapeHtml(text) {
            if (!text) return '';
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        /**
         * Populate category dropdown
         */
        function populateEventCategories() {
            const select = document.getElementById('eventCategory');
            if (!select) return;

            select.innerHTML = eventCategories.map(cat =>
                `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`
            ).join('');
        }

        /**
         * Populate event list
         */
        function populateEventList() {
            const list = document.getElementById('eventList');
            if (!list) return;

            const allEvents = getAllEvents();

            if (allEvents.length === 0) {
                list.innerHTML = '<div class="event-list-empty">No events defined yet.<br>Create one to get started!</div>';
                return;
            }

            list.innerHTML = allEvents.map(event => {
                const category = getEventCategory(event.category);
                const startFormatted = formatEventDate(event.startDate, event.startTime);
                const endFormatted = formatEventDate(event.endDate, event.endTime);

                return `
                    <div class="event-list-item" onclick="navigateToEvent('${event.eventId}')">
                        <div class="event-list-item-name">${escapeHtml(event.name)}</div>
                        <div class="event-list-item-dates">${startFormatted} → ${endFormatted}</div>
                        <div class="event-list-item-footer">
                            <div class="event-list-item-category">${category ? category.name : 'Other'}</div>
                            <button class="event-list-edit-btn" onclick="event.stopPropagation(); openEventSlider('${event.eventId}')">Edit</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        /**
         * Navigate to an event's start date
         */
        async function navigateToEvent(eventId) {
            const event = getEventById(eventId);
            if (!event || !event.startDate) return;

            // Close the event slider
            closeEventSlider();

            // Navigate to the start date
            // startDate is in YYYY-MM-DD format
            const dayKey = event.startDate;
            const monthKey = dayKey.substring(0, 7); // YYYY-MM

            // Check if we need to change month
            if (monthKey !== currentMonth) {
                await NavigationController.selectMonth(monthKey);
            }

            // Navigate to the day
            NavigationController.selectDay(dayKey);
        }

        /**
         * Format event date for display
         */
        function formatEventDate(date, time) {
            if (!date) return '—';
            const d = new Date(date + 'T12:00:00');
            const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            return time ? `${formatted} ${time}` : formatted;
        }

        /**
         * Update the start or end datetime input fields from state
         */
        function updateEventDateTimeDisplay(bound) {
            const dateInput = document.getElementById(bound === 'start' ? 'eventStartDate' : 'eventEndDate');
            const timeInput = document.getElementById(bound === 'start' ? 'eventStartTime' : 'eventEndTime');

            const date = bound === 'start' ? eventCreationState.startDate : eventCreationState.endDate;
            const time = bound === 'start' ? eventCreationState.startTime : eventCreationState.endTime;

            if (dateInput) dateInput.value = date || '';
            if (timeInput) timeInput.value = time || '';
        }

        /**
         * Update event bound from manual input
         */
        function updateEventBoundFromInput(bound) {
            const dateInput = document.getElementById(bound === 'start' ? 'eventStartDate' : 'eventEndDate');
            const timeInput = document.getElementById(bound === 'start' ? 'eventStartTime' : 'eventEndTime');

            const date = dateInput?.value || null;
            const time = timeInput?.value || null;

            if (bound === 'start') {
                eventCreationState.startDate = date;
                eventCreationState.startTime = time;
                eventCreationState.startItemId = null; // Clear item association when manually set
            } else {
                eventCreationState.endDate = date;
                eventCreationState.endTime = time;
                eventCreationState.endItemId = null;
            }
        }

        /**
         * Enter bound selection mode (pick from diary)
         */
        function setEventBoundMode(mode) {
            const startBtn = document.getElementById('eventSetStartBtn');
            const endBtn = document.getElementById('eventSetEndBtn');

            // Ensure we're in active creation mode
            if (!eventCreationState.active) {
                eventCreationState.active = true;
            }

            // Toggle mode
            if (eventBoundMode === mode) {
                eventBoundMode = null;
                document.body.classList.remove('event-bound-mode-active');
                startBtn?.classList.remove('active');
                endBtn?.classList.remove('active');
            } else {
                eventBoundMode = mode;
                document.body.classList.add('event-bound-mode-active');
                startBtn?.classList.toggle('active', mode === 'start');
                endBtn?.classList.toggle('active', mode === 'end');
            }
        }

        /**
         * Handle diary entry click when in event bound mode
         * Called from diary entry click handlers
         */
        function handleEventBoundSelection(dayKey, time, itemId) {
            if (!eventCreationState.active || !eventBoundMode) return false;

            if (eventBoundMode === 'start') {
                eventCreationState.startDate = dayKey;
                eventCreationState.startTime = time || null;
                eventCreationState.startItemId = itemId || null;
                updateEventDateTimeDisplay('start');
                highlightEventBound('start', dayKey, itemId);
            } else if (eventBoundMode === 'end') {
                eventCreationState.endDate = dayKey;
                eventCreationState.endTime = time || null;
                eventCreationState.endItemId = itemId || null;
                updateEventDateTimeDisplay('end');
                highlightEventBound('end', dayKey, itemId);
            }

            // Exit bound mode
            setEventBoundMode(null);
            return true;
        }

        /**
         * Highlight the selected start/end entry in diary
         */
        function highlightEventBound(bound, dayKey, itemId) {
            // Remove existing marker of this type
            document.querySelectorAll(`.event-${bound}-marker`).forEach(el => {
                el.classList.remove(`event-${bound}-marker`);
            });

            // Find and highlight the entry
            if (itemId) {
                const entry = document.querySelector(`[data-item-id="${itemId}"]`);
                if (entry) {
                    entry.closest('li')?.classList.add(`event-${bound}-marker`);
                }
            }
        }

        /**
         * Clear all event bound markers
         */
        function clearEventBoundMarkers() {
            document.querySelectorAll('.event-start-marker, .event-end-marker').forEach(el => {
                el.classList.remove('event-start-marker', 'event-end-marker');
            });
        }

        /**
         * Save the current event (create or update)
         */
        function saveEvent() {
            const name = document.getElementById('eventName')?.value.trim();
            const description = document.getElementById('eventDescription')?.value.trim();
            const category = document.getElementById('eventCategory')?.value;
            // Get color from category
            const categoryObj = getEventCategory(category);
            const color = categoryObj?.color || '#9C27B0';

            // Read dates/times directly from input fields
            const startDate = document.getElementById('eventStartDate')?.value || null;
            const startTime = document.getElementById('eventStartTime')?.value || null;
            const endDate = document.getElementById('eventEndDate')?.value || null;
            const endTime = document.getElementById('eventEndTime')?.value || null;

            if (!name) {
                alert('Please enter an event name.');
                document.getElementById('eventName')?.focus();
                return;
            }

            if (!startDate) {
                alert('Please set a start date.');
                document.getElementById('eventStartDate')?.focus();
                return;
            }

            if (!endDate) {
                alert('Please set an end date.');
                document.getElementById('eventEndDate')?.focus();
                return;
            }

            // Validate start <= end
            const startDT = startDate + (startTime || '00:00');
            const endDT = endDate + (endTime || '23:59');
            if (startDT > endDT) {
                alert('End date/time must be after start date/time.');
                return;
            }

            const eventData = {
                name,
                description,
                category,
                color,
                startDate: startDate,
                startTime: startTime,
                startItemId: eventCreationState.startItemId,
                endDate: endDate,
                endTime: endTime,
                endItemId: eventCreationState.endItemId
            };

            if (eventCreationState.editingEventId) {
                updateEvent(eventCreationState.editingEventId, eventData);
            } else {
                createEvent(eventData);
            }

            // Refresh diary to show [EVENT] tags
            if (typeof renderMonth === 'function') {
                renderMonth();
            }

            // Return to event list
            cancelEventEdit();
        }

        /**
         * Delete the current event being edited
         */
        function deleteCurrentEvent() {
            if (!eventCreationState.editingEventId) return;

            const event = getEventById(eventCreationState.editingEventId);
            if (!event) return;

            if (confirm(`Delete event "${event.name}"?`)) {
                deleteEvent(eventCreationState.editingEventId);

                // Refresh diary to remove [EVENT] tags
                if (typeof renderMonth === 'function') {
                    renderMonth();
                }

                // Return to event list
                cancelEventEdit();
            }
        }

        /**
         * Start creating a new event (from event list view)
         */
        function startNewEvent() {
            openEventSlider(null);
        }

        // ========================================
        // Category Manager Functions
        // ========================================

        /**
         * Open the category manager modal
         */
        function openCategoryManager() {
            const backdrop = document.getElementById('categoryManagerBackdrop');
            const modal = document.getElementById('categoryManagerModal');

            if (backdrop) backdrop.classList.add('open');
            if (modal) modal.classList.add('open');

            populateCategoryList();
        }

        /**
         * Close the category manager modal
         */
        function closeCategoryManager() {
            const backdrop = document.getElementById('categoryManagerBackdrop');
            const modal = document.getElementById('categoryManagerModal');

            if (backdrop) backdrop.classList.remove('open');
            if (modal) modal.classList.remove('open');

            // Clear the new category input
            const nameInput = document.getElementById('newCategoryName');
            if (nameInput) nameInput.value = '';

            // Refresh the category dropdown in the event form
            populateEventCategories();
        }

        /**
         * Populate the category list in the manager
         */
        function populateCategoryList() {
            const list = document.getElementById('categoryList');
            if (!list) return;

            list.innerHTML = eventCategories.map(cat => `
                <div class="category-item" data-category-id="${cat.id}">
                    <input type="color" class="category-item-color" value="${cat.color}"
                           onchange="updateCategoryColor('${cat.id}', this.value)">
                    <input type="text" class="category-item-name" value="${escapeHtml(cat.name)}"
                           onblur="updateCategoryName('${cat.id}', this.value)"
                           onkeypress="if(event.key==='Enter') this.blur()">
                    <button class="category-item-delete" onclick="deleteCategoryFromManager('${cat.id}')"
                            title="${cat.id === 'other' ? 'Cannot delete "Other" category' : 'Delete category'}"
                            ${cat.id === 'other' ? 'disabled' : ''}>✕</button>
                </div>
            `).join('');
        }

        /**
         * Update a category's color
         */
        function updateCategoryColor(categoryId, newColor) {
            updateEventCategory(categoryId, { color: newColor });
            populateCategoryList();
        }

        /**
         * Update a category's name
         */
        function updateCategoryName(categoryId, newName) {
            if (!newName.trim()) {
                populateCategoryList(); // Reset to original
                return;
            }
            updateEventCategory(categoryId, { name: newName.trim() });
        }

        /**
         * Delete a category from the manager
         */
        function deleteCategoryFromManager(categoryId) {
            const category = getEventCategory(categoryId);
            if (!category) return;

            // Count events using this category
            const eventsUsingCategory = events.filter(e => e.category === categoryId).length;

            let message = `Delete category "${category.name}"?`;
            if (eventsUsingCategory > 0) {
                message += `\n\n${eventsUsingCategory} event(s) using this category will be moved to "Other".`;
            }

            if (confirm(message)) {
                deleteEventCategory(categoryId);
                populateCategoryList();
            }
        }

        /**
         * Add a new category from the form
         */
        function addNewCategory() {
            const nameInput = document.getElementById('newCategoryName');
            const colorInput = document.getElementById('newCategoryColor');

            const name = nameInput?.value.trim();
            const color = colorInput?.value || '#9C27B0';

            if (!name) {
                nameInput?.focus();
                return;
            }

            const result = addEventCategory(name, color);
            if (result) {
                nameInput.value = '';
                populateCategoryList();
            } else {
                alert('A category with this name already exists.');
            }
        }

        // Expose event functions globally
        window.openEventSlider = openEventSlider;
        window.openEventList = openEventList;
        window.closeEventSlider = closeEventSlider;
        window.cancelEventEdit = cancelEventEdit;
        window.navigateToEvent = navigateToEvent;
        window.setEventBoundMode = setEventBoundMode;
        window.handleEventBoundSelection = handleEventBoundSelection;
        window.updateEventBoundFromInput = updateEventBoundFromInput;
        window.saveEvent = saveEvent;
        window.deleteCurrentEvent = deleteCurrentEvent;
        window.startNewEvent = startNewEvent;
        window.getEventsForDay = getEventsForDay;
        window.getAllEvents = getAllEvents;
        window.exportEventsData = exportEventsData;
        window.openCategoryManager = openCategoryManager;
        window.closeCategoryManager = closeCategoryManager;
        window.updateCategoryColor = updateCategoryColor;
        window.updateCategoryName = updateCategoryName;
        window.deleteCategoryFromManager = deleteCategoryFromManager;
        window.addNewCategory = addNewCategory;
        window.importEventsData = importEventsData;

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
                const span = document.createElement('span');
                span.innerHTML = textNode.textContent.replace(regex, '<mark class="search-highlight">$1</mark>');
                textNode.parentNode.replaceChild(span, textNode);
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
                const span = document.createElement('span');
                span.innerHTML = node.textContent.replace(regex, match => {
                    return `<span class="search-highlight">${match}</span>`;
                });
                node.parentNode.replaceChild(span, node);
            });
            
            currentMonthMatches = Array.from(markdownContent.querySelectorAll('.search-highlight'));
            
            // Re-add event listeners (use shared function to avoid duplication)
            attachDiaryClickHandlers();

            let globalMatchesBeforeThisMonth = 0;
            for (let i = 0; i < monthKeys.length; i++) {
                if (monthKeys[i] === currentMonth) break;
                const monthMatches = allSearchMatches.filter(m => m.monthKey === monthKeys[i]);
                globalMatchesBeforeThisMonth += monthMatches.length;
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
        
        // Utility functions
        function addLog(message, type = 'info') {
            const entry = document.createElement('div');
            entry.className = `log-entry ${type}`;
            
            // Check if message contains HTML (e.g., buttons)
            if (message.includes('<button') || message.includes('<a')) {
                // For HTML content, don't add timestamp and use innerHTML
                entry.innerHTML = message;
            } else {
                // For regular text, add timestamp and use textContent
                entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
            }
            
            logDiv.appendChild(entry);
            logDiv.scrollTop = logDiv.scrollHeight;
        }
        
        function formatTime(date) {
            if (!date) return 'Unknown Time';
            const d = new Date(date);
            if (isNaN(d.getTime())) return 'Unknown Time';
            const hours = d.getHours();
            const minutes = d.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const hour12 = hours % 12 || 12;
            return `${hour12}:${minutes} ${ampm}`;
        }
        
        function formatDate(dateStr) {
            const d = new Date(dateStr);
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            return d.toLocaleDateString('en-US', options);
        }
        
        function formatDuration(seconds) {
            if (!seconds || seconds <= 0) return '0m';
            
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            
            if (hours > 0) {
                return `${hours}h ${minutes}m`;
            } else if (minutes > 0) {
                return `${minutes}m`;
            } else {
                return `${secs}s`;
            }
        }
        
        function formatDistance(meters) {
            if (!meters || meters < 1) return '0 m';
            
            if (meters >= 1000) {
                const km = (meters / 1000).toFixed(1);
                return `${km} km`;
            } else {
                return `${Math.round(meters)} m`;
            }
        }
        
        // Expose formatting functions for analysis.js
        window.formatDistance = formatDistance;
        window.formatDuration = formatDuration;
        window.calculatePathDistance = calculatePathDistance;
        window.calculateDistance = calculateDistance;
        
        function calculatePathDistance(samples) {
            if (!samples || samples.length < 2) return null;
            
            // First, extract all valid GPS points (skip nulls)
            const validPoints = [];
            for (const sample of samples) {
                if (sample.location && 
                    sample.location.latitude != null && 
                    sample.location.longitude != null) {
                    validPoints.push({
                        lat: sample.location.latitude,
                        lng: sample.location.longitude
                    });
                }
            }
            
            // Need at least 2 valid points to calculate distance
            if (validPoints.length < 2) return null;
            
            // Calculate total distance between consecutive valid points
            let totalDistance = 0;
            for (let i = 1; i < validPoints.length; i++) {
                const prev = validPoints[i - 1];
                const curr = validPoints[i];
                
                const segmentDistance = calculateDistance(
                    prev.lat,
                    prev.lng,
                    curr.lat,
                    curr.lng
                );
                
                totalDistance += segmentDistance;
            }
            
            return totalDistance > 0 ? totalDistance : null;
        }
        
        function calculateElevationGain(samples) {
            if (!samples || samples.length < 2) return null;
            
            // Extract altitude values from samples
            const altitudes = [];
            for (const sample of samples) {
                const altitude = sample.location?.altitude || sample.altitude;
                if (altitude != null && !isNaN(altitude)) {
                    altitudes.push(altitude);
                }
            }
            
            // Need at least 2 valid altitude points
            if (altitudes.length < 2) return null;
            
            // Calculate net elevation gain (positive changes only)
            let gain = 0;
            for (let i = 1; i < altitudes.length; i++) {
                const change = altitudes[i] - altitudes[i - 1];
                if (change > 0) {
                    gain += change;
                }
            }
            
            return gain > 0 ? gain : null;
        }
        
        async function decompressFile(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const compressed = new Uint8Array(e.target.result);
                        const decompressed = pako.ungzip(compressed, { to: 'string' });
                        resolve(JSON.parse(decompressed));
                    } catch (error) {
                        reject(error);
                    }
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });
        }
        
        // ========== Display-Only Timeline Coalescer ==========
        // Applies ONLY to iCloud backup imports - JSON exports work correctly without coalescing
        // Never modifies canonical chain - display purposes only
        // Rules:
        // 1. Items with customTitle are ALWAYS shown (user intentionally named them)
        // 2. Items contained within a longer visit's timespan are marked _contained and hidden
        // 3. Items without GPS samples are marked _dataGap (shown with [NO GPS] tag if not contained)
        // 4. Merge adjacent visits: same placeId, gap ≤ MAX_MERGE_GAP_MS, no intervening locomotion
        // 5. Short visits (0 seconds) without customTitle may be suppressed
        
        const COALESCE_SETTINGS = {
            enabled: true,                    // Master toggle
            maxMergeGapMs: 15 * 60 * 1000,   // 15 minutes max gap for merging visits
            showRawTimeline: false            // User toggle to see uncoalesced view
        };
        
        function coalesceTimelineForDisplay(items) {
            if (!items || items.length === 0) return items;
            if (!COALESCE_SETTINGS.enabled || COALESCE_SETTINGS.showRawTimeline) {
                return items; // Return unmodified
            }
            
            // Use shared containment detection
            const containedIds = findContainedItems(items);
            
            // Build map of named places with coordinates and radius
            const namedPlaces = [];
            for (const item of items) {
                if (item.isVisit && item.placeId && item.center) {
                    const radius = item.place?.radiusMeters || 50; // Default 50m if not specified
                    namedPlaces.push({
                        placeId: item.placeId,
                        lat: item.center.latitude,
                        lng: item.center.longitude,
                        radius: radius,
                        name: item.place?.name || ''
                    });
                }
            }
            
            // Helper: Get effective placeId for an item (by placeId or coordinate proximity)
            function getEffectivePlaceId(item) {
                // If item has placeId, use it
                if (item.placeId) return item.placeId;
                
                // For visits without placeId, check if within radius of a named place
                if (item.isVisit && item.center) {
                    const itemLat = item.center.latitude;
                    const itemLng = item.center.longitude;
                    
                    for (const place of namedPlaces) {
                        const dist = calculateDistanceMeters(itemLat, itemLng, place.lat, place.lng);
                        if (dist <= place.radius) {
                            return place.placeId; // Item is within this place's radius
                        }
                    }
                }
                
                return null;
            }
            
            // Helper: Check if item has GPS data
            function hasGpsData(item) {
                if (item.samples && item.samples.length > 0) return true;
                if (item.center && item.center.latitude && item.center.longitude) return true;
                // Arc may have distance/duration metadata even without raw samples
                // This proves the item has location data from Arc's processing
                if (item.distance && item.distance > 0) return true;
                return false;
            }
            
            // Helper: Get item duration in milliseconds
            function getDurationMs(item) {
                if (!item.startDate || !item.endDate) return 0;
                return new Date(item.endDate).getTime() - new Date(item.startDate).getTime();
            }
            
            // Sort items chronologically before processing
            const sortedItems = [...items].sort((a, b) => {
                const aStart = a.startDate ? new Date(a.startDate).getTime() : 0;
                const bStart = b.startDate ? new Date(b.startDate).getTime() : 0;
                return aStart - bStart;
            });
            
            // Process items - skip contained, apply display annotations
            const result = [];
            
            for (let i = 0; i < sortedItems.length; i++) {
                const item = { ...sortedItems[i] }; // Shallow copy for annotations
                const itemId = item.itemId || item.startDate;
                
                // Mark data gaps
                if (!hasGpsData(item)) {
                    item._dataGap = true;
                }
                
                // Skip contained items (using shared detection)
                if (containedIds.has(itemId)) {
                    item._contained = true;
                    continue;
                }
                
                // Rule: Suppress zero-duration visits without customTitle
                // (but allow visits with > 0 seconds duration)
                if (item.isVisit && !item.customTitle && getDurationMs(item) === 0) {
                    // Check if it's noise between same-place visits
                    const prev = result.length > 0 ? result[result.length - 1] : null;
                    const next = sortedItems[i + 1] || null;
                    
                    if (prev && next) {
                        const prevEffective = prev.isVisit ? getEffectivePlaceId(prev) : null;
                        const nextEffective = next.isVisit ? getEffectivePlaceId(next) : null;
                        const currEffective = getEffectivePlaceId(item);
                        
                        // Suppress if sandwiched between same place visits and is different place
                        if (prevEffective && prevEffective === nextEffective && currEffective !== prevEffective) {
                            item._suppressed = true;
                            if (!prev._suppressedVisits) prev._suppressedVisits = [];
                            prev._suppressedVisits.push(item);
                            continue;
                        }
                    }
                }
                
                // Rule: Merge adjacent visits within same effective place
                const currentEffectivePlace = item.isVisit ? getEffectivePlaceId(item) : null;
                
                if (item.isVisit && currentEffectivePlace && result.length > 0) {
                    const prev = result[result.length - 1];
                    const prevEffectivePlace = prev.isVisit ? getEffectivePlaceId(prev) : null;
                    
                    if (prevEffectivePlace === currentEffectivePlace) {
                        // Check gap between prev.endDate and current.startDate
                        const gap = getGapMs(prev, item);
                        
                        if (gap >= 0 && gap <= COALESCE_SETTINGS.maxMergeGapMs) {
                            // Merge: extend previous item's endDate, keep original items
                            if (!prev._mergedItems) {
                                prev._mergedItems = [{ ...prev }]; // Store original
                            }
                            prev._mergedItems.push(item);
                            prev._hasCollapsedSegments = true;
                            
                            // Extend the display endDate
                            if (item.endDate && (!prev._displayEndDate || item.endDate > (prev._displayEndDate || prev.endDate))) {
                                prev._displayEndDate = item.endDate;
                            }
                            
                            // Merge notes arrays
                            if (item.notes) {
                                if (!prev.notes) prev.notes = [];
                                if (Array.isArray(item.notes)) {
                                    prev.notes = [...(Array.isArray(prev.notes) ? prev.notes : [prev.notes].filter(Boolean)), ...item.notes];
                                } else if (typeof item.notes === 'string' && item.notes.trim()) {
                                    if (Array.isArray(prev.notes)) {
                                        prev.notes.push({ body: item.notes, date: item.startDate });
                                    } else {
                                        prev.notes = [prev.notes, { body: item.notes, date: item.startDate }].filter(Boolean);
                                    }
                                }
                            }
                            
                            continue;
                        }
                    }
                }
                
                // No coalescing applied - add item
                result.push(item);
            }
            
            return result;
        }
        
        // Calculate distance in meters between two lat/lng points
        function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
            const R = 6371000; // Earth radius in meters
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return R * c;
        }
        
        function getItemDurationMs(item) {
            if (!item.startDate || !item.endDate) return 0;
            const start = new Date(item.startDate).getTime();
            const end = new Date(item.endDate).getTime();
            return end - start;
        }
        
        function getGapMs(item1, item2) {
            if (!item1.endDate || !item2.startDate) return -1;
            const end1 = new Date(item1.endDate).getTime();
            const start2 = new Date(item2.startDate).getTime();
            return start2 - end1;
        }
        
        function extractNotesFromData(data, dayKey, sourceFile = 'json-import') {
            const notes = [];
            
            if (!data.timelineItems) return notes;
            
            // Apply display-only coalescing ONLY for iCloud backup imports
            // JSON exports already produce correct diary output without coalescing
            const shouldCoalesce = sourceFile === 'backup-import';
            const displayItems = shouldCoalesce 
                ? coalesceTimelineForDisplay(data.timelineItems)
                : data.timelineItems;
            
            // 🎯 Option B: Group nearby unnamed locations intelligently
            // First pass: Build location clusters (use original items for accurate clustering)
            const locationClusters = buildLocationClusters(data.timelineItems);
            
            for (const item of displayItems) {
                // Process ALL timeline items to show complete activity timeline
                // This includes visits (stationary) and routes (movements)
                const hasNotes = item.notes && (
                    (typeof item.notes === 'string' && item.notes.trim() !== '') ||
                    (Array.isArray(item.notes) && item.notes.length > 0)
                );

                let notesToProcess = [];
                
                if (hasNotes) {
                    if (typeof item.notes === 'string') {
                        notesToProcess.push({
                            body: item.notes,
                            date: item.startDate || item.endDate
                        });
                    } else if (Array.isArray(item.notes)) {
                        notesToProcess = item.notes;
                    }
                } else {
                    // Create entry for timeline item even without notes
                    // This shows all activities (visits and routes) in the timeline
                    notesToProcess.push({
                        body: '', // Empty body
                        date: item.startDate || item.endDate
                    });
                }
                
                // Calculate distance and duration ONCE per timeline item (not per note)
                let duration = null;
                
                // Check if this is a midnight-spanning visit
                // IMPORTANT: Arc stores dates in UTC - must convert to local for day comparison
                const itemStartDay = getLocalDayKey(item.startDate);
                // Use _displayEndDate for merged items (coalesced visits)
                const effectiveEndDate = item._displayEndDate || item.endDate;
                const itemEndDay = getLocalDayKey(effectiveEndDate);
                const spansFromPreviousDay = itemStartDay && dayKey && itemStartDay < dayKey && itemEndDay >= dayKey;
                const spansIntoNextDay = itemEndDay && dayKey && itemEndDay > dayKey && itemStartDay <= dayKey;
                
                if (item.startDate && effectiveEndDate) {
                    let start = new Date(item.startDate);
                    let end = new Date(effectiveEndDate);
                    
                    // For spanning visits, clamp duration to this day's portion
                    if (item.isVisit && (spansFromPreviousDay || spansIntoNextDay)) {
                        const dayStart = new Date(dayKey + 'T00:00:00');
                        const dayEnd = new Date(dayKey + 'T23:59:59');
                        
                        if (start < dayStart) start = dayStart;
                        if (end > dayEnd) end = dayEnd;
                    }
                    
                    const durationMs = end - start;
                    duration = durationMs / 1000;
                }
                
                let distance = null;
                let elevationGain = null;
                if (!item.isVisit && item.samples) {
                    // Calculate distance from GPS samples
                    distance = calculatePathDistance(item.samples);
                    
                    // Calculate elevation gain (sum of positive altitude changes)
                    elevationGain = calculateElevationGain(item.samples);
                }
                
                // Only assign distance to the FIRST note to avoid double-counting in stats
                let isFirstNote = true;
                
                for (const note of notesToProcess) {
                    // Allow empty bodies (so we see all activities)
                    // But skip completely empty/invalid dates
                    if (!note.date) continue;
                    
                    // 🎯 Multi-day visit handling: Only show note on the day it belongs to
                    // For items with notes, the note has its own date - only show on that day
                    // For items without notes (empty entries), use startDate to determine which day
                    // Exception: spanning visits should appear on both days
                    if (dayKey) {
                        const noteDate = new Date(note.date);
                        // Get date in local timezone (Arc uses local time)
                        const noteDayKey = noteDate.getFullYear() + '-' + 
                            String(noteDate.getMonth() + 1).padStart(2, '0') + '-' +
                            String(noteDate.getDate()).padStart(2, '0');
                        
                        // Skip notes that don't belong to this day
                        // UNLESS this is a spanning visit with no actual note (empty body)
                        if (noteDayKey !== dayKey) {
                            // Allow through if this is a spanning visit showing continuation
                            if (!(spansFromPreviousDay && item.isVisit && note.body === '')) {
                                continue;
                            }
                        }
                    }
                    
                    // 🎯 Intelligent location naming
                    let locationName = getSmartLocationName(item, locationClusters);
                    
                    // Get latitude/longitude/altitude for clicking
                    let lat = item.center?.latitude;
                    let lng = item.center?.longitude;
                    let altitude = item.center?.altitude;

                    // For routes without a center point, find the first sample with valid location
                    if ((lat == null || lng == null) && item.samples && item.samples.length > 0) {
                        // Find first sample with valid location data (don't assume samples[0] is valid)
                        const validSample = item.samples.find(s =>
                            s.location && s.location.latitude != null && s.location.longitude != null
                        );
                        if (validSample) {
                            lat = validSample.location.latitude;
                            lng = validSample.location.longitude;
                            altitude = validSample.location.altitude;
                        }
                    }

                    // Even if we have center lat/lng, try to get altitude from samples if not in center
                    if ((altitude === null || altitude === undefined) && item.samples && item.samples.length > 0) {
                        const sampleWithAlt = item.samples.find(s =>
                            s.location?.altitude != null || s.altitude != null
                        );
                        if (sampleWithAlt) {
                            altitude = sampleWithAlt.location?.altitude ?? sampleWithAlt.altitude;
                        }
                    }
                    
                    // Determine the display date for this entry
                    // For spanning visits from previous day, show midnight of current day
                    let displayDate = note.date;
                    if (spansFromPreviousDay && item.isVisit && note.body === '') {
                        displayDate = dayKey + 'T00:00:00';
                    }
                    
                    // Use effective end date for merged items
                    const noteEndDate = spansIntoNextDay ? dayKey + 'T23:59:59' : (item._displayEndDate || item.endDate);
                    
                    notes.push({
                        noteId: note.noteId,
                        date: displayDate,
                        body: note.body || '', // Ensure string
                        location: locationName,
                        isVisit: item.isVisit || false,
                        activityType: item.activityType || null,
                        latitude: lat,
                        longitude: lng,
                        altitude: altitude ?? null,  // Include altitude
                        duration: isFirstNote ? duration : null,  // Only first note gets duration
                        distance: isFirstNote ? distance : null,  // Only first note gets distance
                        elevationGain: isFirstNote ? elevationGain : null,  // Only first note gets elevation gain
                        radiusMeters: item.place?.radiusMeters || null,
                        startDate: spansFromPreviousDay ? dayKey + 'T00:00:00' : item.startDate,
                        endDate: noteEndDate,
                        timelineItemId: item.itemId || `${item.startDate}_${locationName}`,
                        // Coalescing indicators
                        _hasCollapsedSegments: item._hasCollapsedSegments || false,
                        _mergedCount: item._mergedItems?.length || 0,
                        _suppressedCount: (item._suppressedVisits?.length || 0) + (item._collapsedUnknowns?.length || 0),
                        _dataGap: item._dataGap || false,
                        _contained: item._contained || false
                    });
                    
                    isFirstNote = false;  // Subsequent notes don't get distance/duration
                }
            }
            
            return notes;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 1: Normalized Data Model (entries + notes tables)
        // ═══════════════════════════════════════════════════════════════════
        
        /**
         * Extract normalized entries and notes from raw Arc data
         * @param {Object} data - Raw Arc Timeline JSON for a day
         * @param {string} dayKey - The day being processed (YYYY-MM-DD)
         * @returns {{entries: Array, notes: Array}} - Normalized entries and notes
         */
        function extractEntriesAndNotesFromData(data, dayKey) {
            const entries = [];
            const notes = [];
            
            if (!data?.timelineItems) return { entries, notes };
            
            // Build location clusters for consistent naming
            const locationClusters = buildLocationClusters(data.timelineItems);
            
            for (const item of data.timelineItems) {
                // Generate stable entryId
                const entryId = item.itemId || `${item.startDate || ''}_${item.center?.latitude || 0}_${item.center?.longitude || 0}`;
                
                // Get location name
                const locationName = getSmartLocationName(item, locationClusters);
                
                // Get coordinates
                let lat = item.center?.latitude ?? null;
                let lng = item.center?.longitude ?? null;
                let altitude = item.center?.altitude ?? null;
                
                // For routes without center, use first sample
                if ((lat == null || lng == null) && item.samples?.length > 0) {
                    const first = item.samples[0];
                    lat = first.location?.latitude ?? first.latitude ?? null;
                    lng = first.location?.longitude ?? first.longitude ?? null;
                    altitude = first.location?.altitude ?? first.altitude ?? null;
                }
                
                // Try to get altitude from samples if not in center
                if (altitude == null && item.samples?.length > 0) {
                    const first = item.samples[0];
                    altitude = first.location?.altitude ?? first.altitude ?? null;
                }
                
                // Calculate duration
                let duration = null;
                if (item.startDate && item.endDate) {
                    duration = (new Date(item.endDate) - new Date(item.startDate)) / 1000;
                }
                
                // Calculate distance and elevation for activities
                let distance = null;
                let elevationGain = null;
                if (!item.isVisit && item.samples) {
                    distance = calculatePathDistance(item.samples);
                    elevationGain = calculateElevationGain(item.samples);
                }
                
                // Determine if entry belongs to this day
                // For multi-day visits, we include the entry but filter notes by date
                // IMPORTANT: Arc stores dates in UTC - must convert to local for day comparison
                const entryStartDay = item.startDate ? 
                    getLocalDayKey(item.startDate) : dayKey;
                const entryEndDay = item.endDate ? 
                    getLocalDayKey(item.endDate) : dayKey;
                const spansThisDay = entryStartDay <= dayKey && entryEndDay >= dayKey;
                
                if (!spansThisDay) continue;
                
                // Extract notes for this item
                const itemNotes = extractItemNotes(item, entryId, dayKey);
                
                // For visits that span midnight, always include on each day they touch
                // For activities (trips), only include if starts on this day or has notes
                const hasNotesThisDay = itemNotes.length > 0;
                const startsThisDay = entryStartDay === dayKey;
                const endsThisDay = entryEndDay === dayKey;
                const isVisit = item.isVisit;
                
                // Visits always show on all days they span; activities only if starts here or has notes
                if (!isVisit && !hasNotesThisDay && !startsThisDay) continue;
                
                // Calculate effective start/end times for this day (midnight splitting)
                let effectiveStartDate = item.startDate;
                let effectiveEndDate = item.endDate;
                let effectiveDuration = duration;
                
                if (isVisit && (entryStartDay !== dayKey || entryEndDay !== dayKey)) {
                    // Visit spans multiple days - split at midnight
                    const dayStart = new Date(dayKey + 'T00:00:00');
                    const dayEnd = new Date(dayKey + 'T23:59:59');
                    
                    const actualStart = item.startDate ? new Date(item.startDate) : dayStart;
                    const actualEnd = item.endDate ? new Date(item.endDate) : dayEnd;
                    
                    // Clamp to this day's boundaries
                    const clampedStart = actualStart < dayStart ? dayStart : actualStart;
                    const clampedEnd = actualEnd > dayEnd ? dayEnd : actualEnd;
                    
                    effectiveStartDate = clampedStart.toISOString();
                    effectiveEndDate = clampedEnd.toISOString();
                    effectiveDuration = (clampedEnd - clampedStart) / 1000;
                }
                
                // Build entry object
                const entry = {
                    entryId: entryId,
                    dayKey: dayKey,
                    startDate: effectiveStartDate || null,
                    endDate: effectiveEndDate || null,
                    duration: effectiveDuration,
                    type: item.isVisit ? 'visit' : 'activity',
                    activityType: item.activityType || (item.isVisit ? 'stationary' : 'unknown'),
                    location: locationName,
                    lat: lat,
                    lng: lng,
                    altitude: altitude,
                    placeId: item.place?.id || null,
                    radiusMeters: item.place?.radiusMeters || null,
                    distance: distance,
                    elevationGain: elevationGain,
                    timelineItemId: item.itemId || entryId,
                    hasNote: itemNotes.length > 0
                };
                
                entries.push(entry);
                notes.push(...itemNotes);
            }
            
            // Sort entries by startDate (chronological)
            entries.sort((a, b) => {
                const aTime = a.startDate ? new Date(a.startDate).getTime() : 0;
                const bTime = b.startDate ? new Date(b.startDate).getTime() : 0;
                return aTime - bTime;
            });
            
            return { entries, notes };
        }
        
        /**
         * Extract notes from a single timeline item, filtered by dayKey
         * @param {Object} item - Timeline item from Arc data
         * @param {string} entryId - Parent entry ID (FK)
         * @param {string} dayKey - Only include notes from this day
         * @returns {Array} - Array of note objects
         */
        function extractItemNotes(item, entryId, dayKey) {
            const notes = [];
            
            if (!item.notes) return notes;
            
            // Normalize to array
            let rawNotes = [];
            if (typeof item.notes === 'string') {
                if (item.notes.trim()) {
                    rawNotes.push({
                        body: item.notes,
                        date: item.startDate || item.endDate,
                        noteId: `${entryId}_note_0`
                    });
                }
            } else if (Array.isArray(item.notes)) {
                rawNotes = item.notes.map((n, idx) => ({
                    body: n.body || '',
                    date: n.date || item.startDate || item.endDate,
                    noteId: n.noteId || `${entryId}_note_${idx}`
                }));
            }
            
            // Filter to notes belonging to this day
            for (const note of rawNotes) {
                if (!note.date || !note.body?.trim()) continue;
                
                const noteDate = new Date(note.date);
                const noteDayKey = noteDate.getFullYear() + '-' +
                    String(noteDate.getMonth() + 1).padStart(2, '0') + '-' +
                    String(noteDate.getDate()).padStart(2, '0');
                
                if (noteDayKey !== dayKey) continue;
                
                notes.push({
                    noteId: note.noteId,
                    entryId: entryId,
                    date: note.date,
                    body: note.body
                });
            }
            
            return notes;
        }
        
        /**
         * Get days from data model (not DOM)
         * @param {string} monthKey - Month to query (YYYY-MM)
         * @returns {Array<string>} - Sorted array of dayKeys
         */
        function getDaysFromModel(monthKey) {
            const diary = generatedDiaries[monthKey];
            if (!diary?.monthData?.days) return [];
            return Object.keys(diary.monthData.days).sort();
        }
        
        // 🎯 Build location clusters to intelligently name nearby visits
        function buildLocationClusters(timelineItems) {
            const clusters = [];
            const CLUSTER_RADIUS = 100; // meters - visits within 100m are considered same location
            
            // Get all visits with coordinates
            const visits = timelineItems.filter(item => 
                item.isVisit && item.center?.latitude && item.center?.longitude
            );
            
            // Debug: Log all visits and their place names
            logDebug(`📍 buildLocationClusters: Found ${visits.length} visits`);
            visits.forEach((v, i) => {
                logDebug(`  Visit ${i}: place.name="${v.place?.name || 'NONE'}", lat=${v.center.latitude.toFixed(4)}, lng=${v.center.longitude.toFixed(4)}`);
            });
            
            for (const visit of visits) {
                const lat = visit.center.latitude;
                const lng = visit.center.longitude;
                // Check for name: place.name, then customTitle, then streetAddress
                const name = visit.place?.name || visit.customTitle || visit.streetAddress || null;
                const hasName = !!name;
                
                // Find if this visit belongs to an existing cluster
                let foundCluster = null;
                for (const cluster of clusters) {
                    const distance = calculateDistance(
                        lat, lng,
                        cluster.centerLat, cluster.centerLng
                    );
                    
                    if (distance <= CLUSTER_RADIUS) {
                        foundCluster = cluster;
                        break;
                    }
                }
                
                if (foundCluster) {
                    // Add to existing cluster
                    foundCluster.visits.push(visit);
                    
                    // If this visit has a name and cluster doesn't, use it
                    if (hasName && !foundCluster.name) {
                        foundCluster.name = name;
                    }
                    
                    // Update cluster center (average of all visits)
                    const totalLat = foundCluster.visits.reduce((sum, v) => sum + v.center.latitude, 0);
                    const totalLng = foundCluster.visits.reduce((sum, v) => sum + v.center.longitude, 0);
                    foundCluster.centerLat = totalLat / foundCluster.visits.length;
                    foundCluster.centerLng = totalLng / foundCluster.visits.length;
                } else {
                    // Create new cluster
                    clusters.push({
                        centerLat: lat,
                        centerLng: lng,
                        name: hasName ? name : null,
                        visits: [visit]
                    });
                }
            }
            
            // Assign names to unnamed clusters
            let unnamedCount = 0;
            for (const cluster of clusters) {
                if (!cluster.name) {
                    unnamedCount++;
                    cluster.name = `Location ${String.fromCharCode(64 + unnamedCount)}`; // A, B, C, etc.
                    logDebug(`📍 Cluster unnamed -> assigned "${cluster.name}" at (${cluster.centerLat.toFixed(4)}, ${cluster.centerLng.toFixed(4)}) with ${cluster.visits.length} visits`);
                }
            }
            
            // Debug: Log final clusters
            logDebug(`📍 Final clusters: ${clusters.length}`);
            clusters.forEach((c, i) => {
                logDebug(`  Cluster ${i}: name="${c.name}", visits=${c.visits.length}`);
            });
            
            return clusters;
        }
        
        // 🎯 Get smart location name using clusters
        function getSmartLocationName(item, locationClusters) {
            // Priority 1: PlaceId mapping from places folder (most authoritative, refreshed on each import)
            const mappedPid = item?.place?.placeId || item?.place?.id || item?.placeId || item?.placeUUID;
            if (mappedPid && placesById && placesById[String(mappedPid)]) {
                return placesById[String(mappedPid)].trim();
            }

            // Priority 2: Place name from embedded place object
            if (item.place?.name) {
                logDebug(`📍 getSmartLocationName: Using place.name = "${item.place.name}"`);
                return item.place.name.trim();
            }

            // Priority 3: Custom title (only used if no place mapping exists)
            // Note: customTitle may have stale data from old imports, so place mappings take precedence
            if (item.customTitle) {
                logDebug(`📍 getSmartLocationName: Using customTitle = "${item.customTitle}"`);
                return item.customTitle.trim();
            }

            // Priority 4: Street address (for visits without place name)
            if (item.isVisit && item.streetAddress) {
                logDebug(`📍 getSmartLocationName: Using streetAddress = "${item.streetAddress}"`);
                return item.streetAddress.trim();
            }
            
            // Debug: Log when no name source found for visits
            if (item.isVisit) {
                logDebug(`📍 getSmartLocationName: Visit missing name sources`, {
                    hasPlace: !!item.place,
                    placeKeys: item.place ? Object.keys(item.place) : [],
                    streetAddress: item.streetAddress,
                    center: item.center
                });
            }
            
            // Priority 4: Activity type (for non-visits)
            if (item.activityType) {
                return item.activityType.charAt(0).toUpperCase() + item.activityType.slice(1);
            }
            
            // Priority 4: Find cluster for this visit
            if (item.isVisit && item.center?.latitude && item.center?.longitude) {
                const lat = item.center.latitude;
                const lng = item.center.longitude;
                
                for (const cluster of locationClusters) {
                    // Check if this visit is in this cluster
                    if (cluster.visits.includes(item)) {
                        return cluster.name;
                    }
                }
            }
            
            // Fallback
            return 'Unknown Location';
        }
                
        function extractPinsFromData(data) {
            const pins = [];
            if (!data || !data.timelineItems) return pins;

            // 🎯 Build location clusters for consistent naming
            const locationClusters = buildLocationClusters(data.timelineItems);

            for (const item of data.timelineItems) {
                // Must be a visit. 
                // Removed "!item.place" check because one-time locations might not have a place object.
                if (!item.isVisit) continue;

                let hasNote = false;
                if (item.notes) {
                    if (typeof item.notes === 'string') {
                        hasNote = item.notes.trim() !== '';
                    } else if (Array.isArray(item.notes)) {
                        hasNote = item.notes.some(n => (n?.body || '').trim() !== '');
                    }
                }

                // 🎯 Use smart location naming
                const locationName = getSmartLocationName(item, locationClusters);

                const lat = item.center?.latitude;
                const lng = item.center?.longitude;
                let altitude = item.center?.altitude; // Try center first
                
                // If no altitude in center, try to get from samples (first sample)
                if ((altitude === null || altitude === undefined) && item.samples && item.samples.length > 0) {
                    const firstSample = item.samples[0];
                    altitude = firstSample?.location?.altitude || firstSample?.altitude;
                }
                
                // If no coordinates, we can't map it anyway
                if (!lat || !lng) continue;

                pins.push({
                    location: locationName,
                    lat: lat,
                    lng: lng,
                    altitude: altitude ?? null, // Store altitude (can be null)
                    hasNote: hasNote,
                    isVisit: true,
                    startDate: item.startDate || null,
                    endDate: item.endDate || null,
                    timelineItemId: item.itemId || `${item.startDate || ''}_${locationName}_${lat}_${lng}`
                });
            }

            return pins;
        }

        function extractTracksFromData(data) {
            const tracks = [];
            if (!data || !data.timelineItems) return tracks;

            for (const item of data.timelineItems) {
                if (item.isVisit) continue;
                if (!Array.isArray(item.samples) || item.samples.length < 2) {
                    if (item.activityType === 'walking') {
                        logDebug(`🚶 Walking skipped: samples=${item.samples?.length || 0}, startDate=${item.startDate}`);
                    }
                    continue;
                }

                const pts = [];
                for (const s of item.samples) {
                    const lat = s?.location?.latitude;
                    const lng = s?.location?.longitude;
                    const alt = s?.location?.altitude;
                    const ts = s?.location?.timestamp || s?.timestamp || s?.date;
                    if (!lat || !lng) continue;
                    pts.push({ lat, lng, alt: alt ?? null, t: ts ?? null });
                }

                if (pts.length < 2) {
                    if (item.activityType === 'walking') {
                        logDebug(`🚶 Walking skipped after filtering: valid_pts=${pts.length}, samples=${item.samples.length}, startDate=${item.startDate}`);
                    }
                    continue;
                }

                logDebug(`🚶 Track extracted: ${item.activityType}, ${pts.length} points, startDate=${item.startDate}`);
                
                tracks.push({
                    activityType: item.activityType || 'activity',
                    startDate: item.startDate || null,
                    endDate: item.endDate || null,
                    points: pts
                });
            }

            return tracks;
        }

		  function calculateMonthlyActivityStats(monthData) {
            // Calculate cumulative statistics for each activity type in the month
            const stats = {};
            
            const notesOnly = document.getElementById('notesOnly')?.checked ?? false;
            const includeAll = !notesOnly;
            
            // Track ALL activities to detect midnight-spanning duplicates (not just airplanes!)
            const seenActivities = new Map(); // key: "activityType-startTime-duration-distance", value: true
            
            const days = Object.keys(monthData.days).sort(); // Sort to process in chronological order
            for (const day of days) {
                const dayData = monthData.days[day];
                
                // Get filtered notes (same filtering as diary display)
                const visibleNotes = getFilteredNotesForDay(dayData, includeAll, includeAll);
                
                for (const note of visibleNotes) {
                    // Only process activities (non-visits)
                    if (note.isVisit) continue;
                    if (!note.activityType) continue;
                    
                    const activityType = getActivityFilterType(note.activityType);
                    
                    // Skip Stationary and Unknown
                    if (activityType === 'stationary' || activityType === 'unknown') continue;
                    
                    // Check if this is a duplicate of a midnight-spanning activity (any type!)
                    if (note.startDate && note.duration && note.distance) {
                        // Create a unique key based on activity type, start time, duration, and distance
                        // Round to avoid floating point precision issues
                        const startTime = new Date(note.startDate).getTime();
                        const duration = Math.round(note.duration);
                        const distance = Math.round(note.distance);
                        const activityKey = `${activityType}-${startTime}-${duration}-${distance}`;
                        
                        // Check if we've already seen this exact activity
                        if (seenActivities.has(activityKey)) {
                            // This is a duplicate - skip it
                            logDebug(`Skipping duplicate midnight-spanning activity: ${note.activityType} at ${note.startDate} (${distance}m, ${duration}s)`);
                            continue;
                        }
                        
                        // Record this activity so we can detect duplicates later
                        seenActivities.set(activityKey, true);
                    }
                    
                    // Initialize stats for this activity type if not exists
                    if (!stats[activityType]) {
                        stats[activityType] = {
                            distance: 0,      // in meters
                            duration: 0,      // in seconds
                            count: 0,         // number of activities
                            activityName: note.activityType
                        };
                    }
                    
                    // Add to totals
                    if (note.distance) stats[activityType].distance += note.distance;
                    if (note.duration) stats[activityType].duration += note.duration;
                    stats[activityType].count += 1;
                }
            }
            
            // Remove activities with zero distance
            const filteredStats = {};
            for (const activityType in stats) {
                if (stats[activityType].distance > 0) {
                    filteredStats[activityType] = stats[activityType];
                }
            }
            
            return filteredStats;
        }
        
        function getFilteredNotesForDay(dayData, includeAllLocations, includeAllActivities) {
            // Apply the same filtering logic as generateMarkdown
            let visibleNotes = dayData.notes.filter(note => {
                if (note.isVisit) {
                    // Location/visit filtering
                    if (includeAllLocations) return true;
                    return (note.body && note.body.trim().length > 0);
                } else {
                    // Activity/route filtering
                    if (!includeAllActivities) {
                        return (note.body && note.body.trim().length > 0);
                    }
                    return true;
                }
            });
            
            // Filter out activities inside location GPS radius
            const locationVisits = visibleNotes.filter(n => n.isVisit && n.radiusMeters && n.latitude && n.longitude);
            
            if (locationVisits.length > 0) {
                visibleNotes = visibleNotes.filter(note => {
                    if (note.isVisit) return true;
                    if (!note.latitude || !note.longitude) return true;
                    
                    for (const visit of locationVisits) {
                        const distance = calculateDistance(
                            note.latitude, note.longitude,
                            visit.latitude, visit.longitude
                        );
                        
                        if (distance <= visit.radiusMeters) {
                            return false;
                        }
                    }
                    
                    return true;
                });
            }
            
            return visibleNotes;
        }
        
        function calculateDailyActivityStats(notes) {
            // Calculate statistics for activities in a single day
            const stats = {};
            
            for (const note of notes) {
                // Only process activities (non-visits)
                if (note.isVisit) continue;
                if (!note.activityType) continue;
                
                const activityType = getActivityFilterType(note.activityType);
                
                // Skip Stationary and Unknown
                if (activityType === 'stationary' || activityType === 'unknown') continue;
                
                // Initialize stats for this activity type if not exists
                if (!stats[activityType]) {
                    stats[activityType] = {
                        distance: 0,
                        duration: 0,
                        elevationGain: 0,
                        count: 0
                    };
                }
                
                // Add to totals
                if (note.distance) stats[activityType].distance += note.distance;
                if (note.duration) stats[activityType].duration += note.duration;
                if (note.elevationGain) stats[activityType].elevationGain += note.elevationGain;
                stats[activityType].count += 1;
            }
            
            // Remove activities with zero distance
            const filteredStats = {};
            for (const activityType in stats) {
                if (stats[activityType].distance > 0) {
                    filteredStats[activityType] = stats[activityType];
                }
            }
            
            return filteredStats;
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
                
                if (locationVisits.length > 0) {
                    visibleNotes = visibleNotes.filter(note => {
                        // Keep all visits
                        if (note.isVisit) return true;
                        
                        // For activities, check if they're inside any location's radius
                        if (!note.latitude || !note.longitude) return true; // Keep if no coordinates
                        
                        // Check if activity is inside any location's radius
                        for (const visit of locationVisits) {
                            const distance = calculateDistance(
                                note.latitude, note.longitude,
                                visit.latitude, visit.longitude
                            );
                            
                            // If activity is inside this location's radius, exclude it
                            if (distance <= visit.radiusMeters) {
                                return false;
                            }
                        }
                        
                        return true; // Keep activity if not inside any location
                    });
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
                        
        function resetGenerateButton() {
            cancelProcessing = false;
            cancelBtn.style.display = 'none';
        }
        
        // LEGACY FUNCTION - Not used in v3.0 (IndexedDB version)
        // Kept for backward compatibility but should not be called
        async function generateDiaries() {
            logWarn('generateDiaries() is deprecated in v3.0 - use importFilesToDatabase() instead');
            alert('This function is no longer supported in v3.0. Please use the Import JSON button.');
            return;
            
            // Old code below - disabled
            /*
            const startMonth = document.getElementById('startMonth').value;
            const endMonth = document.getElementById('endMonth').value;
            
            if (!startMonth || !endMonth) {
                alert('Please select start and end months');
                return;
            }
            
            if (!selectedFiles.length) {
                alert('Please select a folder containing daily JSON files');
                return;
            }
            
            cancelProcessing = false;
            
            const startTime = Date.now();
            
            progress.style.display = 'block';
            cancelBtn.style.display = 'block';
            results.style.display = 'none';
            modalOverlay.style.display = 'none';
            resultsList.innerHTML = '';
            logDiv.innerHTML = '';
            
            addLog(`Starting diary generation for ${startMonth} to ${endMonth}...`);
            addLog(`Found ${selectedFiles.length} daily JSON files in folder`);
            
            const filesInRange = selectedFiles.filter(file => {
                const match = file.name.match(/(\d{4}-\d{2}-\d{2})\.json\.gz/);
                if (!match) return false;
                
                const fileDate = match[1];
                const [year, month] = fileDate.split('-');
                const monthKey = `${year}-${month}`;
                
                return monthKey >= startMonth && monthKey <= endMonth;
            });
            
            addLog(`${filesInRange.length} files are within the date range`);
            
            if (filesInRange.length === 0) {
                addLog('No files found in the selected date range', 'error');
                resetGenerateButton();
                return;
            }
            
            const monthsData = {};
            const seenNoteIds = new Set();
            let processedFiles = 0;
            let notesFound = 0;
            let lastUIUpdate = Date.now();
            const UI_UPDATE_INTERVAL = 100; // Update UI every 100ms instead of every file
            
            for (const file of filesInRange) {
                if (cancelProcessing) {
                    addLog('Processing cancelled by user', 'error');
                    resetGenerateButton();
                    return;
                }
                
                try {
                    const match = file.name.match(/(\d{4}-\d{2}-\d{2})\.json\.gz/);
                    const fileDate = match[1];
                    const [year, month, day] = fileDate.split('-');
                    const monthKey = `${year}-${month}`;

                    const data = await decompressFile(file);

                    // Filter out ghost items (0-sample duplicates) before extraction
                    if (data.timelineItems) {
                        data.timelineItems = filterGhostItems(data.timelineItems);
                    }

                    const notes = extractNotesFromData(data, fileDate);
                    const pins = extractPinsFromData(data);
                    const tracks = extractTracksFromData(data);
                    
                    const hasData = notes.length > 0 || (pins && pins.length > 0) || (tracks && tracks.length > 0);
                    
                    if (hasData) {
                        if (!monthsData[monthKey]) {
                            monthsData[monthKey] = {
                                month: monthKey,
                                days: {}
                            };
                        }
                        
                        if (!monthsData[monthKey].days[fileDate]) {
                            monthsData[monthKey].days[fileDate] = {
                                notes: [],
                                pins: [],
                                tracks: []
                            };
                        }
                        
                        if (pins && pins.length > 0) {
                            monthsData[monthKey].days[fileDate].pins.push(...pins);
                        }
                        
                        if (tracks && tracks.length > 0) {
                            monthsData[monthKey].days[fileDate].tracks.push(...tracks);
                        }
                        
                        if (notes.length > 0) {
                            let addedNotes = 0;
                            let duplicateNotes = 0;
                            
                            for (const note of notes) {
                                if (note.noteId && seenNoteIds.has(note.noteId)) {
                                    duplicateNotes++;
                                    continue;
                                }
                                
                                if (note.noteId) {
                                    seenNoteIds.add(note.noteId);
                                }
                                
										  // Use the file's date to ensure notes stay with their timeline day
                                // and match the map/location data (fixes timezone/UTC mismatches)
                                const noteDayKey = fileDate;
                                const noteMonthKey = noteDayKey.substring(0, 7);
                                                                
                                if (!monthsData[noteMonthKey]) {
                                    monthsData[noteMonthKey] = {
                                        month: noteMonthKey,
                                        days: {}
                                    };
                                }
                                
                                if (!monthsData[noteMonthKey].days[noteDayKey]) {
                                    monthsData[noteMonthKey].days[noteDayKey] = {
                                        notes: [],
                                        pins: [],
                                        tracks: []
                                    };
                                }
                                
                                monthsData[noteMonthKey].days[noteDayKey].notes.push(note);
                                addedNotes++;
                                notesFound++;
                            }
                        }
                    }
                    
                    processedFiles++;
                    
                    // Update UI only every 100ms to improve performance
                    const now = Date.now();
                    if (now - lastUIUpdate > UI_UPDATE_INTERVAL || processedFiles === filesInRange.length) {
                        const percent = Math.round((processedFiles / filesInRange.length) * 100);
                        progressFill.style.width = percent + '%';
                        progressFill.textContent = percent + '%';
                        progressText.textContent = `Processed ${processedFiles} of ${filesInRange.length} files in date range`;
                        lastUIUpdate = now;
                        
                        // Allow browser to update UI
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                    
                } catch (error) {
                    addLog(`Error processing ${file.name}: ${error.message}`, 'error');
                }
            }
            
            if (cancelProcessing) {
                addLog('Processing cancelled by user', 'error');
                resetGenerateButton();
                return;
            }
            
            const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
            addLog(`Processed ${processedFiles} files in ${elapsedTime}s`, 'success');
            addLog(`Found ${notesFound} notes across ${Object.keys(monthsData).length} months`, 'success');
            
            generatedDiaries = {};
            monthSelector.innerHTML = '';
            
            for (const monthKey of Object.keys(monthsData).sort()) {
                const monthData = monthsData[monthKey];
                const markdown = generateMarkdown(monthData, true); // default: include empty days when first loaded
                
                const noteCount = Object.values(monthData.days)
                    .reduce((sum, day) => sum + day.notes.length, 0);
                const dayCount = Object.keys(monthData.days).length;
                
                const locationsByDay = {};
                const routesByDay = {};
                for (const dayKey of Object.keys(monthData.days)) {
                    const dayPins = monthData.days[dayKey].pins || [];
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

                    if (locs.length) locationsByDay[dayKey] = locs;

                    const dayTracks = monthData.days[dayKey].tracks || [];
                    if (dayTracks.length) {
                        const routePts = [];
                        for (const tr of dayTracks) {
                            for (const pt of (tr.points || [])) {
                                routePts.push({ lat: pt.lat, lng: pt.lng, alt: pt.alt ?? null, t: pt.t, activityType: tr.activityType });
                            }
                        }
                        routePts.sort((a,b) => {
                            if (a.t == null && b.t == null) return 0;
                            if (a.t == null) return 1;
                            if (b.t == null) return -1;
                            const ta = (typeof a.t === 'number') ? a.t : Date.parse(a.t);
                            const tb = (typeof b.t === 'number') ? b.t : Date.parse(b.t);
                            return (ta || 0) - (tb || 0);
                        });
                        if (routePts.length >= 2) routesByDay[dayKey] = routePts;
                    }
                }

				generatedDiaries[monthKey] = {
					 monthData: monthData,         // keep raw data so we can regenerate markdown based on checkbox
					 markdown: markdown,           // initial markdown (include empty days)
					 noteCount: noteCount,
					 dayCount: dayCount,
					 locationsByDay: locationsByDay,
					 routesByDay: routesByDay
				};
                
                const option = document.createElement('option');
                option.value = monthKey;
                const [year, month] = monthKey.split('-');
                const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
                option.textContent = `${monthName} ${year}`;
                monthSelector.appendChild(option);
                
                addLog(`Generated ${monthKey} (${noteCount} notes, ${dayCount} days)`, 'success');
            }
            
            if (Object.keys(generatedDiaries).length > 0) {
                monthKeys = Object.keys(generatedDiaries).sort();
                currentMonth = monthKeys[monthKeys.length - 1];
                monthSelector.value = currentMonth;
                displayDiary(currentMonth);
                results.style.display = 'block';
                
                resultsList.innerHTML = `
                    <div style="padding: 15px; background: #f0f7ff; border-radius: 8px; text-align: center;">
                        <div style="font-size: 18px; font-weight: 600; color: #667eea; margin-bottom: 5px;">
                            ✓ Generated ${monthKeys.length} month${monthKeys.length !== 1 ? 's' : ''} of diary entries
                        </div>
                        <div style="font-size: 14px; color: #666;">
                            ${Object.values(generatedDiaries).reduce((sum, d) => sum + d.noteCount, 0)} total notes
                        </div>
                    </div>
                `;
                
                // Save to localStorage for quick reload next time
                saveDiariesToLocalStorage();
                
                openDiaryReader();
            } else {
                addLog('No notes found in the selected date range', 'error');
            }
            
            resetGenerateButton();
            addLog('Generation complete!', 'success');
            */
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

                // Initialize database
                await initDatabase();
                _dbReadyResolve(db); // Signal that DB is ready

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
                if (savedPlaces) placesById = savedPlaces;

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
        
        // Initialize saved diary UI on page load
        initializeSavedDiaryUI();
        
        // Legacy function for localStorage backwards compatibility
        function populateSelectorsLegacy() {
            // Extract years and set up tracking
            availableYears = [...new Set(monthKeys.map(mk => mk.split('-')[0]))].sort();
            
            if (monthKeys.length > 0) {
                currentMonth = monthKeys[monthKeys.length - 1];
                currentYear = currentMonth.split('-')[0];
                currentMonthNum = parseInt(currentMonth.split('-')[1]);
            }
            
            // Populate year selector
            yearSelector.innerHTML = '';
            for (const year of availableYears) {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                yearSelector.appendChild(option);
            }
            if (currentYear) yearSelector.value = currentYear;
            
            // Populate month selector
            monthSelector.innerHTML = '';
            const monthsInYear = monthKeys
                .filter(mk => mk.startsWith(currentYear + '-'))
                .map(mk => parseInt(mk.split('-')[1]));
            
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
            if (currentMonthNum) monthSelector.value = currentMonthNum;
        }


// === Expose UI handlers required by inline HTML (consolidated) ===
if (typeof analysisNavigateTo === 'function') window.analysisNavigateTo = analysisNavigateTo;
if (typeof changeMapStyle === 'function') window.changeMapStyle = changeMapStyle;
if (typeof clearSearch === 'function') window.clearSearch = clearSearch;
if (typeof closeAnalysisPanel === 'function') window.closeAnalysisPanel = closeAnalysisPanel;
if (typeof closeDiaryReader === 'function') window.closeDiaryReader = closeDiaryReader;
if (typeof closeFilterModal === 'function') window.closeFilterModal = closeFilterModal;
if (typeof closeSearchResults === 'function') window.closeSearchResults = closeSearchResults;
if (typeof closeStatsPanel === 'function') window.closeStatsPanel = closeStatsPanel;
if (typeof confirmClearDatabase === 'function') window.confirmClearDatabase = confirmClearDatabase;
if (typeof confirmClearSavedDiary === 'function') window.confirmClearSavedDiary = confirmClearSavedDiary;
if (typeof downloadCurrentMonth === 'function') window.downloadCurrentMonth = downloadCurrentMonth;
if (typeof exportDatabaseBackup === 'function') window.exportDatabaseBackup = exportDatabaseBackup;
if (typeof getMapPadding === 'function') window.getMapPadding = getMapPadding;
if (typeof handleSearchKeyup === 'function') window.handleSearchKeyup = handleSearchKeyup;
if (typeof hideDiaryRoutes === 'function') window.hideDiaryRoutes = hideDiaryRoutes;
if (typeof hideSearchDropdownDelayed === 'function') window.hideSearchDropdownDelayed = hideSearchDropdownDelayed;
if (typeof importMoreFiles === 'function') window.importMoreFiles = importMoreFiles;
if (typeof loadSavedDiary === 'function') window.loadSavedDiary = loadSavedDiary;
if (typeof navigateDay === 'function') window.navigateDay = navigateDay;
if (typeof navigateMonth === 'function') window.navigateMonth = navigateMonth;
if (typeof navigateSearch === 'function') window.navigateSearch = navigateSearch;
if (typeof navigateToSearchResultByIndex === 'function') window.navigateToSearchResultByIndex = navigateToSearchResultByIndex;
if (typeof openDiaryFromDatabase === 'function') window.openDiaryFromDatabase = openDiaryFromDatabase;
if (typeof openDiaryReader === 'function') window.openDiaryReader = openDiaryReader;
if (typeof performFindSearch === 'function') window.performFindSearch = performFindSearch;
if (typeof printDiary === 'function') window.printDiary = printDiary;
if (typeof resetTransparencySetting === 'function') window.resetTransparencySetting = resetTransparencySetting;
if (typeof saveMapAsImage === 'function') window.saveMapAsImage = saveMapAsImage;
if (typeof saveTransparencySetting === 'function') window.saveTransparencySetting = saveTransparencySetting;
if (typeof showCredits === 'function') window.showCredits = showCredits;
if (typeof showDiaryRoutes === 'function') window.showDiaryRoutes = showDiaryRoutes;
if (typeof showFileSelector === 'function') window.showFileSelector = showFileSelector;
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
if (typeof toggleFavoriteFromPopup === 'function') window.toggleFavoriteFromPopup = toggleFavoriteFromPopup;
if (typeof toggleMapFilters === 'function') window.toggleMapFilters = toggleMapFilters;
if (typeof toggleToolsDropdown === 'function') window.toggleToolsDropdown = toggleToolsDropdown;
if (typeof toggleTransparencySlider === 'function') window.toggleTransparencySlider = toggleTransparencySlider;
if (typeof selectToolFromDropdown === 'function') window.selectToolFromDropdown = selectToolFromDropdown;
if (typeof closeElevationPanel === 'function') window.closeElevationPanel = closeElevationPanel;
// Route search functions are now in map-tools.js (no exports needed - they're global)
if (typeof closeTransparencyPopup === 'function') window.closeTransparencyPopup = closeTransparencyPopup;
if (typeof startDragModal === 'function') window.startDragModal = startDragModal;
if (typeof updateAnimationSpeed === 'function') window.updateAnimationSpeed = updateAnimationSpeed;
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
