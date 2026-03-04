// arc-photos.js — Apple Photos integration for Arc Diary Reader
// Handles import from photo-server, IndexedDB storage, timeline matching, URL management
(() => {
    'use strict';

    const { db: getDB } = ArcState;
    const LS_KEY_SERVER = 'arcPhotoServerUrl';
    const LS_KEY_SHOW_MAP_MARKERS = 'arcPhotoShowMapMarkers';
    const BATCH_SIZE = 50;  // IDB write batch size
    const FETCH_CONCURRENCY = 3;  // concurrent thumbnail fetches

    let serverUrl = localStorage.getItem(LS_KEY_SERVER) || 'http://localhost:3000';
    let serverAvailable = false;
    let activeObjectUrls = new Set();

    function logDebug(...args) {
        if (typeof window.logDebug === 'function') window.logDebug(...args);
        else console.log(...args);
    }

    // ---------------------------------------------------------------------------
    // Database helpers
    // ---------------------------------------------------------------------------

    function getDb() {
        return ArcState.db;
    }

    function getPhotosForDay(dayKey) {
        return new Promise((resolve, reject) => {
            const db = getDb();
            if (!db) return resolve([]);
            try {
                const tx = db.transaction('photos', 'readonly');
                const store = tx.objectStore('photos');
                const index = store.index('dayKey');
                const request = index.getAll(dayKey);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            } catch (e) {
                resolve([]);
            }
        });
    }

    function getPhotoById(id) {
        return new Promise((resolve, reject) => {
            const db = getDb();
            if (!db) return resolve(null);
            try {
                const tx = db.transaction('photos', 'readonly');
                const store = tx.objectStore('photos');
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            } catch (e) {
                resolve(null);
            }
        });
    }

    function getPhotoCount() {
        return new Promise((resolve) => {
            const db = getDb();
            if (!db) return resolve(0);
            try {
                const tx = db.transaction('photos', 'readonly');
                const store = tx.objectStore('photos');
                const request = store.count();
                request.onsuccess = () => resolve(request.result || 0);
                request.onerror = () => resolve(0);
            } catch (e) {
                resolve(0);
            }
        });
    }

    function getPhotoStats() {
        return new Promise((resolve) => {
            const db = getDb();
            if (!db) return resolve(null);
            try {
                const tx = db.transaction('photos', 'readonly');
                const store = tx.objectStore('photos');
                const dateIndex = store.index('date');

                let count = 0, firstDate = null, lastDate = null;

                const countReq = store.count();
                countReq.onsuccess = () => {
                    count = countReq.result || 0;
                    if (count === 0) return resolve({ count: 0, firstDate: null, lastDate: null });

                    // Get first date
                    const firstReq = dateIndex.openCursor();
                    firstReq.onsuccess = () => {
                        if (firstReq.result) firstDate = firstReq.result.value.date;

                        // Get last date
                        const lastReq = dateIndex.openCursor(null, 'prev');
                        lastReq.onsuccess = () => {
                            if (lastReq.result) lastDate = lastReq.result.value.date;
                            resolve({ count, firstDate, lastDate });
                        };
                        lastReq.onerror = () => resolve({ count, firstDate, lastDate: null });
                    };
                    firstReq.onerror = () => resolve({ count, firstDate: null, lastDate: null });
                };
                countReq.onerror = () => resolve({ count: 0, firstDate: null, lastDate: null });
            } catch (e) {
                resolve(null);
            }
        });
    }

    function clearPhotos() {
        return new Promise((resolve, reject) => {
            const db = getDb();
            if (!db) return resolve();
            try {
                const tx = db.transaction('photos', 'readwrite');
                const store = tx.objectStore('photos');
                const request = store.clear();
                request.onsuccess = () => {
                    // Also clear last import timestamp
                    try {
                        const metaTx = db.transaction('metadata', 'readwrite');
                        const metaStore = metaTx.objectStore('metadata');
                        metaStore.delete('lastPhotoImport');
                        metaTx.oncomplete = () => resolve();
                        metaTx.onerror = () => resolve();
                    } catch (e) {
                        resolve();
                    }
                };
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    function storePhotoBatch(photos) {
        return new Promise((resolve, reject) => {
            const db = getDb();
            if (!db) return reject(new Error('No database'));
            const tx = db.transaction('photos', 'readwrite');
            const store = tx.objectStore('photos');
            for (const photo of photos) {
                store.put(photo);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    function saveLastImportTime(isoDate) {
        return new Promise((resolve) => {
            const db = getDb();
            if (!db) return resolve();
            try {
                const tx = db.transaction('metadata', 'readwrite');
                const store = tx.objectStore('metadata');
                store.put({ key: 'lastPhotoImport', value: isoDate });
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    function getLastImportTime() {
        return new Promise((resolve) => {
            const db = getDb();
            if (!db) return resolve(null);
            try {
                const tx = db.transaction('metadata', 'readonly');
                const store = tx.objectStore('metadata');
                const request = store.get('lastPhotoImport');
                request.onsuccess = () => resolve(request.result?.value || null);
                request.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    }

    // ---------------------------------------------------------------------------
    // Server communication
    // ---------------------------------------------------------------------------

    async function checkServer(url) {
        if (url) {
            serverUrl = url.replace(/\/+$/, '');
            localStorage.setItem(LS_KEY_SERVER, serverUrl);
        }
        try {
            const resp = await fetch(`${serverUrl}/api/status`, { signal: AbortSignal.timeout(5000) });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            serverAvailable = data.ok === true;
            return data;
        } catch (e) {
            serverAvailable = false;
            throw e;
        }
    }

    async function resetServerFailures() {
        try {
            await fetch(`${serverUrl}/api/reset-failures`, { method: 'POST' });
        } catch (e) {
            // Server may not be running — that's fine
        }
    }

    async function importPhotos(progressCb, options = {}) {
        if (!serverAvailable) throw new Error('Photo server not connected');

        // Reset server failure cache so previously failed photos get retried
        await resetServerFailures();

        // Build metadata URL — date range or incremental
        let metadataUrl;
        if (options.startDate && options.endDate) {
            metadataUrl = `${serverUrl}/api/photos/metadata?start=${options.startDate}&end=${options.endDate}`;
        } else {
            const lastImport = await getLastImportTime();
            metadataUrl = `${serverUrl}/api/photos/metadata/all`;
            if (lastImport) metadataUrl += `?after=${encodeURIComponent(lastImport)}`;
        }

        // Fetch all metadata
        progressCb?.({ phase: 'metadata', message: 'Fetching photo metadata...' });
        const resp = await fetch(metadataUrl);
        if (!resp.ok) throw new Error(`Metadata fetch failed: HTTP ${resp.status}`);
        const allPhotos = await resp.json();

        if (allPhotos.length === 0) {
            return { imported: 0, skipped: 0, total: 0, message: 'No new photos to import' };
        }

        // Pre-check which photos have originals available on the server
        // This avoids thousands of individual 404 requests that flood the console
        const allIds = allPhotos.map(p => p.id);
        let availableSet = null;
        let unavailableStats = null;
        progressCb?.({ phase: 'metadata', message: 'Checking photo availability...' });
        try {
            const checkResp = await fetch(`${serverUrl}/api/photos/check-available`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: allIds })
            });
            if (checkResp.ok) {
                const checkData = await checkResp.json();
                availableSet = new Set(checkData.available);
                unavailableStats = checkData.unavailable;
            }
        } catch (e) {
            // Server may not support batch check — fall back to individual requests
        }

        // Filter to only available photos (skip unavailable ones upfront)
        const photosToFetch = availableSet
            ? allPhotos.filter(p => availableSet.has(p.id))
            : allPhotos;
        const skippedUpfront = allPhotos.length - photosToFetch.length;

        // Fetch thumbnails with controlled concurrency
        let imported = 0;
        let skipped = skippedUpfront;
        let skipHttp = 0, skipEmptyBlob = 0, skipError = 0;
        const total = allPhotos.length;

        // Fetch one thumbnail — returns record or null
        async function fetchOne(photo) {
            try {
                const thumbResp = await fetch(`${serverUrl}/api/thumbnail/${photo.id}`, { cache: 'no-cache' });
                if (!thumbResp.ok) {
                    skipped++;
                    skipHttp++;
                    return null;
                }
                const blob = await thumbResp.blob();
                if (!blob || blob.size === 0) {
                    skipped++;
                    skipEmptyBlob++;
                    return null;
                }
                return {
                    id: photo.id,
                    dayKey: photo.dayKey,
                    date: photo.date,
                    latitude: photo.latitude,
                    longitude: photo.longitude,
                    width: photo.width,
                    height: photo.height,
                    filename: photo.filename,
                    originalFilename: photo.originalFilename,
                    cameraMake: photo.cameraMake,
                    cameraModel: photo.cameraModel,
                    thumbnail: blob
                };
            } catch (e) {
                skipped++;
                skipError++;
                return null;
            }
        }

        // Process with controlled concurrency + IDB batch writes
        let pendingRecords = [];
        let fetchIndex = 0;

        async function drainToIDB() {
            if (pendingRecords.length > 0) {
                await storePhotoBatch(pendingRecords);
                imported += pendingRecords.length;
                pendingRecords = [];
            }
        }

        // Worker function — pulls next photo, fetches, pushes to pendingRecords
        async function worker() {
            while (fetchIndex < photosToFetch.length) {
                const idx = fetchIndex++;
                const photo = photosToFetch[idx];
                const record = await fetchOne(photo);
                if (record) pendingRecords.push(record);

                // Flush to IDB every BATCH_SIZE records
                if (pendingRecords.length >= BATCH_SIZE) {
                    await drainToIDB();
                }

                // Progress reporting
                const processed = imported + skipped - skippedUpfront;
                if (processed % 500 < FETCH_CONCURRENCY || idx === photosToFetch.length - 1) {
                    progressCb?.({
                        phase: 'thumbnails',
                        imported,
                        skipped,
                        total,
                        percent: Math.round((processed / photosToFetch.length) * 100)
                    });
                }
            }
        }

        // Launch FETCH_CONCURRENCY workers
        const workers = [];
        for (let w = 0; w < Math.min(FETCH_CONCURRENCY, photosToFetch.length); w++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        // Flush remaining records
        await drainToIDB();

        // Save import timestamp
        const now = new Date().toISOString();
        await saveLastImportTime(now);

        // Build skip breakdown from availability check + runtime failures
        const skipBreakdown = {
            noOriginal: unavailableStats?.noOriginal || 0,
            notFound: unavailableStats?.notFound || 0,
            processingFailed: skipHttp,
            emptyBlob: skipEmptyBlob,
            networkError: skipError
        };

        return { imported, skipped, total, skipBreakdown };
    }

    // ---------------------------------------------------------------------------
    // Timeline matching
    // ---------------------------------------------------------------------------

    function matchPhotosToTimeline(photos, timelineItems) {
        if (!photos || photos.length === 0 || !timelineItems || timelineItems.length === 0) {
            return new Map();
        }

        const matches = new Map(); // timelineItemId → Photo[]

        for (const photo of photos) {
            const photoMs = new Date(photo.date).getTime();
            let matched = false;

            // Try direct timestamp overlap
            for (const item of timelineItems) {
                const start = new Date(item.startDate).getTime();
                const end = new Date(item.endDate || item.startDate).getTime();

                if (photoMs >= start && photoMs <= end) {
                    const key = item.itemId || `${item.startDate}_${item.placeId || ''}`;
                    if (!matches.has(key)) matches.set(key, []);
                    matches.get(key).push(photo);
                    matched = true;
                    break;
                }
            }

            // Fallback: nearest item (no distance limit — every photo gets assigned)
            if (!matched) {
                let bestItem = null;
                let bestGap = Infinity;
                for (const item of timelineItems) {
                    const start = new Date(item.startDate).getTime();
                    const end = new Date(item.endDate || item.startDate).getTime();
                    const gap = Math.min(Math.abs(photoMs - start), Math.abs(photoMs - end));
                    if (gap < bestGap) {
                        bestGap = gap;
                        bestItem = item;
                    }
                }
                if (bestItem) {
                    const key = bestItem.itemId || `${bestItem.startDate}_${bestItem.placeId || ''}`;
                    if (!matches.has(key)) matches.set(key, []);
                    matches.get(key).push(photo);
                }
            }
        }

        // Sort photos within each match by date
        for (const [key, arr] of matches) {
            arr.sort((a, b) => new Date(a.date) - new Date(b.date));
        }

        return matches;
    }

    // ---------------------------------------------------------------------------
    // ObjectURL management
    // ---------------------------------------------------------------------------

    function getThumbnailUrl(photo) {
        if (!photo || !photo.thumbnail || photo.thumbnail.size === 0) return null;
        const url = URL.createObjectURL(photo.thumbnail);
        activeObjectUrls.add(url);
        return url;
    }

    function revokeUrls() {
        for (const url of activeObjectUrls) {
            URL.revokeObjectURL(url);
        }
        activeObjectUrls.clear();
    }

    function getFullResUrl(photoId) {
        if (!serverAvailable) return null;
        return `${serverUrl}/api/full/${photoId}`;
    }

    // ---------------------------------------------------------------------------
    // Map marker preference
    // ---------------------------------------------------------------------------

    function showMapMarkers() {
        return localStorage.getItem(LS_KEY_SHOW_MAP_MARKERS) !== 'false';
    }

    function setShowMapMarkers(val) {
        localStorage.setItem(LS_KEY_SHOW_MAP_MARKERS, val ? 'true' : 'false');
    }

    // ---------------------------------------------------------------------------
    // Repair — re-fetch thumbnails that are missing or corrupt
    // ---------------------------------------------------------------------------

    async function repairThumbnails(progressCb) {
        if (!serverAvailable) throw new Error('Photo server not connected');
        const db = getDb();
        if (!db) throw new Error('Database not available');

        // Scan all photos for missing/empty thumbnails
        const allPhotos = await new Promise((resolve, reject) => {
            const tx = db.transaction('photos', 'readonly');
            const store = tx.objectStore('photos');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });

        const broken = allPhotos.filter(p => !p.thumbnail || p.thumbnail.size === 0);
        logDebug(`📷 Repair: ${broken.length} of ${allPhotos.length} photos need thumbnail repair`);

        if (broken.length === 0) return { repaired: 0, failed: 0, total: allPhotos.length };

        let repaired = 0;
        let failed = 0;

        for (let i = 0; i < broken.length; i += BATCH_SIZE) {
            const batch = broken.slice(i, i + BATCH_SIZE);

            const results = await Promise.all(batch.map(async (photo) => {
                try {
                    const resp = await fetch(`${serverUrl}/api/thumbnail/${photo.id}`, { cache: 'no-cache' });
                    if (!resp.ok) return null;
                    const blob = await resp.blob();
                    if (blob.size === 0) return null;
                    return { ...photo, thumbnail: blob };
                } catch (e) {
                    return null;
                }
            }));

            // Write repaired records back to IDB
            const good = results.filter(r => r !== null);
            if (good.length > 0) {
                await new Promise((resolve, reject) => {
                    const tx = db.transaction('photos', 'readwrite');
                    const store = tx.objectStore('photos');
                    for (const r of good) store.put(r);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
                repaired += good.length;
            }
            failed += batch.length - good.length;

            progressCb?.({
                repaired,
                failed,
                total: broken.length,
                percent: Math.round(((i + batch.length) / broken.length) * 100)
            });
        }

        logDebug(`📷 Repair complete: ${repaired} fixed, ${failed} still broken`);
        return { repaired, failed, total: allPhotos.length };
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    window.ArcPhotos = {
        // Server
        checkServer,
        isServerAvailable: () => serverAvailable,
        getServerUrl: () => serverUrl,

        // Import
        importPhotos,
        getLastImportTime,
        repairThumbnails,
        resetServerFailures,

        // Query
        getPhotosForDay,
        getPhotoById,
        getPhotoCount,
        getPhotoStats,
        clearPhotos,

        // Matching
        matchPhotosToTimeline,

        // Display
        getThumbnailUrl,
        getFullResUrl,
        revokeUrls,

        // Preferences
        showMapMarkers,
        setShowMapMarkers
    };
})();
