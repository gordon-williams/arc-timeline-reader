/**
 * arc-export.js — SQLite export for the Arc Reader MCP companion server.
 *
 * Loads sql.js on demand, walks every IndexedDB store, flattens the nested
 * timeline structure into a relational schema, and triggers a .db download.
 *
 * Public API: window.ArcExport
 *   - SCHEMA_VERSION       integer
 *   - SCHEMA_SQL           full CREATE TABLE DDL (as a string)
 *   - buildDatabase(idb, opts) -> Uint8Array
 *   - exportAndDownload(idb, opts) -> { filename, bytes, stats }
 *   - getExportStats(idb) -> { dayCount, locationCount, sampleEstimate, lastSync }
 */
(function () {
    'use strict';

    const SCHEMA_VERSION = 4;
    const SQLJS_VERSION = '1.10.3';
    const SQLJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${SQLJS_VERSION}/`;

    // ────────────────────────────────────────────────────────────────────────
    // Schema
    // ────────────────────────────────────────────────────────────────────────

    const SCHEMA_SQL = `
-- One-row table describing this export
CREATE TABLE export_info (
  exported_at         TEXT NOT NULL,
  schema_version      INTEGER NOT NULL,
  app_build           TEXT,
  day_count           INTEGER,
  earliest_day        TEXT,
  latest_day          TEXT,
  includes_gps_samples INTEGER NOT NULL DEFAULT 0,
  includes_raw_json    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE days (
  day_key          TEXT PRIMARY KEY,
  month_key        TEXT NOT NULL,
  last_updated_ms  INTEGER,
  source_file      TEXT,
  content_hash     TEXT,
  raw_json         TEXT  -- NULL unless export was run with includeRawJson:true
);
CREATE INDEX days_month ON days(month_key);

-- Per-day GPS aggregates (bbox_*, *_altitude_m, gps_sample_count) are computed
-- from the timeline's samples during export, even when raw samples are not
-- persisted. They're the source of truth for find_days_in_region and
-- get_elevation_stats when the full gps_samples table is empty.
CREATE TABLE daily_summaries (
  day_key              TEXT PRIMARY KEY,
  total_duration_s     INTEGER,
  total_distance_m     REAL,
  record_count         INTEGER,
  activity_stats_json  TEXT,
  bbox_min_lat         REAL,
  bbox_max_lat         REAL,
  bbox_min_lng         REAL,
  bbox_max_lng         REAL,
  min_altitude_m       REAL,
  max_altitude_m       REAL,
  gps_sample_count     INTEGER
);
CREATE INDEX ds_bbox_lat ON daily_summaries(bbox_min_lat, bbox_max_lat);
CREATE INDEX ds_bbox_lng ON daily_summaries(bbox_min_lng, bbox_max_lng);
CREATE INDEX ds_max_alt  ON daily_summaries(max_altitude_m) WHERE max_altitude_m IS NOT NULL;
CREATE INDEX ds_min_alt  ON daily_summaries(min_altitude_m) WHERE min_altitude_m IS NOT NULL;

CREATE TABLE daily_activity_stats (
  day_key          TEXT NOT NULL,
  activity_type    TEXT NOT NULL,
  count            INTEGER,
  duration_s       INTEGER,
  distance_m       REAL,
  elevation_gain_m REAL,
  PRIMARY KEY (day_key, activity_type)
);
CREATE INDEX das_type ON daily_activity_stats(activity_type);

-- Composite PK (item_id, day_key): Arc itemIds can legitimately appear in
-- multiple days' timelineItems[] when a visit or activity spans midnight, and
-- occasionally appear twice on the same day after import merges. The compound
-- key lets both day instances live in the table; queries filtering by day_key
-- behave naturally, and "find every row for this item" uses the item_id index.
CREATE TABLE timeline_items (
  item_id              TEXT NOT NULL,
  day_key              TEXT NOT NULL,
  is_visit             INTEGER NOT NULL,
  start_date           TEXT NOT NULL,
  end_date             TEXT NOT NULL,
  start_epoch_ms       INTEGER NOT NULL,
  end_epoch_ms         INTEGER NOT NULL,
  duration_s           INTEGER,
  place_id             TEXT,
  place_name           TEXT,
  custom_title         TEXT,
  street_address       TEXT,
  place_radius_m       REAL,
  activity_type        TEXT,
  manual_activity_type INTEGER,
  distance_m           REAL,
  center_lat           REAL,
  center_lng           REAL,
  center_altitude_m    REAL,
  sample_count         INTEGER,
  PRIMARY KEY (item_id, day_key)
);
CREATE INDEX ti_day      ON timeline_items(day_key);
CREATE INDEX ti_item     ON timeline_items(item_id);
CREATE INDEX ti_place    ON timeline_items(place_name)   WHERE place_name   IS NOT NULL;
CREATE INDEX ti_activity ON timeline_items(activity_type) WHERE activity_type IS NOT NULL;
CREATE INDEX ti_start    ON timeline_items(start_date);
CREATE INDEX ti_bbox     ON timeline_items(center_lat, center_lng);

-- Composite PK includes day_key for the same reason as timeline_items: the
-- same item can appear under two days when it spans midnight, and its samples
-- get inserted alongside each instance.
CREATE TABLE gps_samples (
  item_id      TEXT NOT NULL,
  day_key      TEXT NOT NULL,
  sample_idx   INTEGER NOT NULL,
  timestamp    TEXT,
  epoch_ms     INTEGER,
  latitude     REAL NOT NULL,
  longitude    REAL NOT NULL,
  altitude_m   REAL,
  PRIMARY KEY (item_id, day_key, sample_idx)
);
CREATE INDEX gps_day      ON gps_samples(day_key);
CREATE INDEX gps_bbox     ON gps_samples(latitude, longitude);
CREATE INDEX gps_altitude ON gps_samples(altitude_m) WHERE altitude_m IS NOT NULL;

CREATE TABLE locations (
  name             TEXT PRIMARY KEY,
  total_visits     INTEGER,
  total_duration_s INTEGER,
  first_visit      TEXT,
  last_visit       TEXT,
  lat              REAL,
  lng              REAL,
  record_count     INTEGER
);
CREATE INDEX loc_visits   ON locations(total_visits     DESC);
CREATE INDEX loc_duration ON locations(total_duration_s DESC);
CREATE INDEX loc_bbox     ON locations(lat, lng);

CREATE TABLE location_visits (
  id               INTEGER PRIMARY KEY,
  day_key          TEXT NOT NULL,
  location_name    TEXT NOT NULL,
  duration_s       INTEGER,
  visit_count      INTEGER,
  first_visit_time TEXT,
  lat              REAL,
  lng              REAL
);
CREATE INDEX lv_name     ON location_visits(location_name);
CREATE INDEX lv_day      ON location_visits(day_key);
CREATE INDEX lv_name_day ON location_visits(location_name, day_key);

CREATE TABLE notes (
  note_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    TEXT NOT NULL,
  day_key    TEXT NOT NULL,
  note_idx   INTEGER NOT NULL,
  body       TEXT,
  note_date  TEXT,
  UNIQUE (item_id, day_key, note_idx) ON CONFLICT IGNORE
);
CREATE INDEX notes_item ON notes(item_id);
CREATE INDEX notes_day  ON notes(day_key);
-- Note: FTS5 is not available in the CDN sql.js build. The MCP server builds an
-- in-memory FTS5 virtual table over this notes table at startup (better-sqlite3
-- ships with FTS5 compiled in).

CREATE TABLE app_metadata (
  key        TEXT PRIMARY KEY,
  value_json TEXT
);
`;

    // ────────────────────────────────────────────────────────────────────────
    // sql.js loader (lazy)
    // ────────────────────────────────────────────────────────────────────────

    let _sqlPromise = null;
    function loadSqlJs() {
        if (_sqlPromise) return _sqlPromise;
        _sqlPromise = (async () => {
            if (typeof window.initSqlJs !== 'function') {
                await new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    s.src = SQLJS_BASE + 'sql-wasm.js';
                    s.async = true;
                    s.onload = resolve;
                    s.onerror = () => reject(new Error('Failed to load sql.js'));
                    document.head.appendChild(s);
                });
            }
            return window.initSqlJs({ locateFile: f => SQLJS_BASE + f });
        })();
        return _sqlPromise;
    }

    // ────────────────────────────────────────────────────────────────────────
    // IndexedDB helpers
    // ────────────────────────────────────────────────────────────────────────

    function readAll(idb, storeName) {
        return new Promise((resolve, reject) => {
            if (!idb.objectStoreNames.contains(storeName)) {
                resolve([]);
                return;
            }
            const tx = idb.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error || new Error(`read ${storeName} failed`));
        });
    }

    // Stream one day at a time so multi-year archives don't materialize the
    // whole days store in JS heap (a single getAll() can return hundreds of MB).
    // Two-phase pattern (cheap key list, then one short tx per day) sidesteps
    // the IndexedDB auto-commit rule that would invalidate a long-lived cursor
    // any time we yield to the event loop.
    async function forEachDay(idb, onDay) {
        if (!idb.objectStoreNames.contains('days')) return;
        const keys = await new Promise((resolve, reject) => {
            const tx = idb.transaction(['days'], 'readonly');
            const req = tx.objectStore('days').getAllKeys();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
        for (const key of keys) {
            const day = await new Promise((resolve, reject) => {
                const tx = idb.transaction(['days'], 'readonly');
                const req = tx.objectStore('days').get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            if (day) await onDay(day);
        }
    }

    function countStore(idb, storeName) {
        return new Promise((resolve) => {
            if (!idb.objectStoreNames.contains(storeName)) {
                resolve(0);
                return;
            }
            const tx = idb.transaction([storeName], 'readonly');
            const req = tx.objectStore(storeName).count();
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => resolve(0);
        });
    }

    // ────────────────────────────────────────────────────────────────────────
    // Value coercion
    // ────────────────────────────────────────────────────────────────────────

    function num(v) {
        return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
    }

    function epochMs(v) {
        if (v == null) return null;
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        if (typeof v === 'string') {
            const t = Date.parse(v);
            return Number.isFinite(t) ? t : null;
        }
        if (v instanceof Date) return v.getTime();
        return null;
    }

    function isoStr(v) {
        if (v == null) return null;
        if (typeof v === 'string') return v;
        if (typeof v === 'number') return new Date(v).toISOString();
        if (v instanceof Date) return v.toISOString();
        return null;
    }

    function durationSec(start, end) {
        const s = epochMs(start);
        const e = epochMs(end);
        if (s == null || e == null) return null;
        return Math.max(0, Math.round((e - s) / 1000));
    }

    function extractCenter(item) {
        const c = item.center || (item.place && item.place.center) || null;
        if (!c) return { lat: null, lng: null, alt: null };
        return {
            lat: num(c.latitude ?? c.lat),
            lng: num(c.longitude ?? c.lng),
            alt: num(c.altitude ?? c.alt)
        };
    }

    function extractSample(sample) {
        if (!sample) return null;
        const loc = sample.location || null;
        const lat = num(sample.latitude ?? (loc && loc.latitude));
        const lng = num(sample.longitude ?? (loc && loc.longitude));
        if (lat == null || lng == null) return null;
        const alt = num(sample.altitude ?? (loc && loc.altitude));
        const ts = sample.timestamp ?? sample.date ?? sample.time ?? null;
        return { lat, lng, alt, ts: ts == null ? null : String(ts), epoch: epochMs(ts) };
    }

    function isSecretMetadataKey(k) {
        if (k == null) return false;
        const lower = String(k).toLowerCase();
        return /token|secret|api[_-]?key|password|credential/.test(lower);
    }

    function monthKeyFromDayKey(dayKey) {
        return (typeof dayKey === 'string' && dayKey.length >= 7)
            ? dayKey.substring(0, 7)
            : '';
    }

    // ────────────────────────────────────────────────────────────────────────
    // Builder
    // ────────────────────────────────────────────────────────────────────────

    async function buildDatabase(idb, opts = {}) {
        const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
        const appBuild = opts.appBuild || (typeof window !== 'undefined' && window.__ARC_BUILD__) || null;
        // raw_json doubles memory pressure on large archives. Off by default;
        // callers who want it can pass { includeRawJson: true }.
        const includeRawJson = opts.includeRawJson === true;
        // gps_samples is the volume table — tens of millions of rows for heavy
        // multi-year users, easily 1–3 GB once SQLite overhead is added.
        // The browser's contiguous-ArrayBuffer limit (~2 GB) makes the final
        // db.export() call fail on those archives. Default OFF; only 2 of 15
        // server tools (find_days_in_region, get_elevation_stats) need samples.
        const includeGpsSamples = opts.includeGpsSamples === true;

        onProgress({ phase: 'init', message: 'Loading SQLite engine…' });
        const SQL = await loadSqlJs();
        const sqliteDb = new SQL.Database();
        try {
            sqliteDb.exec('PRAGMA journal_mode = MEMORY;');
            sqliteDb.exec('PRAGMA synchronous = OFF;');
            sqliteDb.exec(SCHEMA_SQL);

            onProgress({ phase: 'count', message: 'Counting days…' });
            const dayCount = await countStore(idb, 'days');

            // Read the small tables fully — these never get huge.
            const [dailySummaries, locations, locationVisits, metadata] = await Promise.all([
                readAll(idb, 'dailySummaries'),
                readAll(idb, 'locations'),
                readAll(idb, 'locationVisits'),
                readAll(idb, 'metadata')
            ]);

            sqliteDb.exec('BEGIN');

            // ── days, timeline_items, gps_samples, notes ──────────────────
            const insDay = sqliteDb.prepare(
                `INSERT INTO days (day_key, month_key, last_updated_ms, source_file, content_hash, raw_json)
                 VALUES (?, ?, ?, ?, ?, ?)`
            );
            // INSERT OR IGNORE: same (item_id, day_key) can appear twice after
            // certain import merges. First occurrence wins; second is dropped.
            const insItem = sqliteDb.prepare(
                `INSERT OR IGNORE INTO timeline_items (
                    item_id, day_key, is_visit, start_date, end_date, start_epoch_ms, end_epoch_ms,
                    duration_s, place_id, place_name, custom_title, street_address, place_radius_m,
                    activity_type, manual_activity_type, distance_m,
                    center_lat, center_lng, center_altitude_m, sample_count
                 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
            );
            const insSample = sqliteDb.prepare(
                `INSERT OR IGNORE INTO gps_samples (item_id, day_key, sample_idx, timestamp, epoch_ms, latitude, longitude, altitude_m)
                 VALUES (?,?,?,?,?,?,?,?)`
            );
            const insNote = sqliteDb.prepare(
                `INSERT INTO notes (item_id, day_key, note_idx, body, note_date) VALUES (?,?,?,?,?)`
            );

            let earliestDay = null, latestDay = null;
            let totalItems = 0, totalSamples = 0, totalNotes = 0, totalSkippedItems = 0;
            let dayProgress = 0;
            const progressEvery = Math.max(1, Math.floor(dayCount / 50) || 1);

            // Per-day GPS aggregates. Always computed (free), even when raw
            // samples aren't persisted — so find_days_in_region and
            // get_elevation_stats can answer from day-granularity data alone.
            // ~80 bytes × N days; tiny regardless of archive size.
            const aggregatesByDay = new Map();
            function noteSample(dayKey, lat, lng, alt) {
                let agg = aggregatesByDay.get(dayKey);
                if (!agg) {
                    agg = { minLat: lat, maxLat: lat, minLng: lng, maxLng: lng, minAlt: null, maxAlt: null, count: 0 };
                    aggregatesByDay.set(dayKey, agg);
                } else {
                    if (lat < agg.minLat) agg.minLat = lat;
                    if (lat > agg.maxLat) agg.maxLat = lat;
                    if (lng < agg.minLng) agg.minLng = lng;
                    if (lng > agg.maxLng) agg.maxLng = lng;
                }
                if (alt != null) {
                    if (agg.minAlt == null || alt < agg.minAlt) agg.minAlt = alt;
                    if (agg.maxAlt == null || alt > agg.maxAlt) agg.maxAlt = alt;
                }
                agg.count++;
            }

            await forEachDay(idb, async (day) => {
                const dayKey = day && day.dayKey;
                if (!dayKey) return;
                if (!earliestDay || dayKey < earliestDay) earliestDay = dayKey;
                if (!latestDay   || dayKey > latestDay)   latestDay   = dayKey;

                const monthKey = day.monthKey || monthKeyFromDayKey(dayKey);
                let rawBlob = null;
                if (includeRawJson) {
                    try { rawBlob = day.data ? JSON.stringify(day.data) : '{}'; }
                    catch { rawBlob = null; }
                }
                insDay.run([
                    dayKey,
                    monthKey,
                    num(day.lastUpdated),
                    day.sourceFile || null,
                    day.contentHash || null,
                    rawBlob
                ]);

                const items = (day.data && Array.isArray(day.data.timelineItems)) ? day.data.timelineItems : [];
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (!item) continue;
                    const itemId = item.itemId || `${dayKey}#${i}`;
                    const startDate = isoStr(item.startDate);
                    const endDate   = isoStr(item.endDate || item.startDate);
                    const startMs   = epochMs(item.startDate);
                    const endMs     = epochMs(item.endDate || item.startDate);
                    if (!startDate || startMs == null) {
                        totalSkippedItems++;
                        continue;
                    }
                    const isVisit = item.isVisit ? 1 : 0;
                    const place   = item.place || null;
                    const center  = extractCenter(item);
                    const samples = Array.isArray(item.samples) ? item.samples : [];

                    insItem.run([
                        itemId,
                        dayKey,
                        isVisit,
                        startDate,
                        endDate || startDate,
                        startMs,
                        endMs == null ? startMs : endMs,
                        durationSec(item.startDate, item.endDate || item.startDate),
                        (place && place.placeId) || item.placeId || null,
                        (place && place.name) || item.placeName || null,
                        item.customTitle || null,
                        item.streetAddress || null,
                        num(place && place.radiusMeters),
                        item.activityType || null,
                        item.manualActivityType ? 1 : 0,
                        num(item.distance),
                        center.lat,
                        center.lng,
                        center.alt,
                        samples.length
                    ]);
                    totalItems++;

                    // Always walk samples to compute per-day aggregates, even
                    // if we're not persisting each row. The CPU cost is small
                    // (no allocations) and the aggregates are what powers
                    // bbox / altitude tools on samples-off exports.
                    for (let s = 0; s < samples.length; s++) {
                        const sample = extractSample(samples[s]);
                        if (!sample) continue;
                        noteSample(dayKey, sample.lat, sample.lng, sample.alt);
                        if (includeGpsSamples) {
                            insSample.run([
                                itemId,
                                dayKey,
                                s,
                                sample.ts,
                                sample.epoch,
                                sample.lat,
                                sample.lng,
                                sample.alt
                            ]);
                            totalSamples++;
                        }
                    }
                    // Visits sometimes have no samples — fall back to the
                    // place's center coord so the day still has a bbox.
                    if (samples.length === 0 && center.lat != null && center.lng != null) {
                        noteSample(dayKey, center.lat, center.lng, center.alt);
                    }

                    const itemNotes = collectNotes(item);
                    for (let n = 0; n < itemNotes.length; n++) {
                        const note = itemNotes[n];
                        insNote.run([
                            itemId,
                            dayKey,
                            n,
                            note.body,
                            note.date
                        ]);
                        totalNotes++;
                    }
                }

                dayProgress++;
                if (dayProgress % progressEvery === 0) {
                    onProgress({
                        phase: 'days',
                        message: `Flattening days… ${dayProgress.toLocaleString()} of ${dayCount.toLocaleString()}`,
                        percent: dayCount ? dayProgress / dayCount : 0
                    });
                    // Yield to the event loop so the UI can paint and GC can run.
                    await new Promise(r => setTimeout(r, 0));
                }
            });

            insDay.free();
            insItem.free();
            insSample.free();
            insNote.free();

            // ── daily_summaries + daily_activity_stats ────────────────────
            onProgress({ phase: 'summaries', message: 'Writing daily summaries…' });
            const insSummary = sqliteDb.prepare(
                `INSERT OR REPLACE INTO daily_summaries (
                    day_key, total_duration_s, total_distance_m, record_count, activity_stats_json,
                    bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
                    min_altitude_m, max_altitude_m, gps_sample_count
                 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
            );
            const insStat = sqliteDb.prepare(
                `INSERT OR REPLACE INTO daily_activity_stats (day_key, activity_type, count, duration_s, distance_m, elevation_gain_m)
                 VALUES (?,?,?,?,?,?)`
            );
            const writtenDays = new Set();
            function aggArgs(dayKey) {
                const a = aggregatesByDay.get(dayKey);
                if (!a) return [null, null, null, null, null, null, 0];
                return [a.minLat, a.maxLat, a.minLng, a.maxLng, a.minAlt, a.maxAlt, a.count];
            }
            for (const row of dailySummaries) {
                const dayKey = row.dayKey;
                if (!dayKey) continue;
                const stats = (row.activityStats && typeof row.activityStats === 'object') ? row.activityStats : null;
                insSummary.run([
                    dayKey,
                    num(row.totalDuration),
                    num(row.totalDistance),
                    num(row.recordCount),
                    stats ? JSON.stringify(stats) : null,
                    ...aggArgs(dayKey)
                ]);
                writtenDays.add(dayKey);
                if (stats) {
                    for (const [type, s] of Object.entries(stats)) {
                        if (!s || typeof s !== 'object') continue;
                        insStat.run([
                            dayKey,
                            type,
                            num(s.count),
                            num(s.duration),
                            num(s.distance),
                            num(s.elevationGain ?? s.elevation_gain ?? s.elevation)
                        ]);
                    }
                }
            }
            // Days that have GPS aggregates but no entry in the dailySummaries
            // store still need a daily_summaries row so bbox / elevation tools
            // can find them.
            for (const dayKey of aggregatesByDay.keys()) {
                if (writtenDays.has(dayKey)) continue;
                insSummary.run([dayKey, null, null, null, null, ...aggArgs(dayKey)]);
            }
            insSummary.free();
            insStat.free();

            // ── locations ─────────────────────────────────────────────────
            onProgress({ phase: 'locations', message: 'Writing locations…' });
            const insLoc = sqliteDb.prepare(
                `INSERT OR REPLACE INTO locations (name, total_visits, total_duration_s, first_visit, last_visit, lat, lng, record_count)
                 VALUES (?,?,?,?,?,?,?,?)`
            );
            for (const loc of locations) {
                if (!loc || !loc.name) continue;
                insLoc.run([
                    loc.name,
                    num(loc.totalVisits),
                    num(loc.totalDuration),
                    loc.firstVisit || null,
                    loc.lastVisit || null,
                    num(loc.lat ?? loc.latitude),
                    num(loc.lng ?? loc.longitude),
                    num(loc.recordCount)
                ]);
            }
            insLoc.free();

            // ── location_visits ───────────────────────────────────────────
            onProgress({ phase: 'visits', message: 'Writing location visits…' });
            const insLV = sqliteDb.prepare(
                `INSERT OR REPLACE INTO location_visits (id, day_key, location_name, duration_s, visit_count, first_visit_time, lat, lng)
                 VALUES (?,?,?,?,?,?,?,?)`
            );
            for (const v of locationVisits) {
                if (!v || !v.dayKey || !v.locationName) continue;
                insLV.run([
                    num(v.id),
                    v.dayKey,
                    v.locationName,
                    num(v.duration),
                    num(v.visitCount),
                    v.firstVisit || null,
                    num(v.lat ?? v.latitude),
                    num(v.lng ?? v.longitude)
                ]);
            }
            insLV.free();

            // ── app_metadata (non-secret keys only) ───────────────────────
            onProgress({ phase: 'metadata', message: 'Writing app metadata…' });
            const insMeta = sqliteDb.prepare(
                `INSERT OR REPLACE INTO app_metadata (key, value_json) VALUES (?,?)`
            );
            for (const m of metadata) {
                if (!m || !m.key) continue;
                if (isSecretMetadataKey(m.key)) continue;
                let valueJson;
                try {
                    valueJson = JSON.stringify(m.value ?? null);
                } catch {
                    valueJson = 'null';
                }
                insMeta.run([m.key, valueJson]);
            }
            insMeta.free();

            // ── export_info ───────────────────────────────────────────────
            sqliteDb.run(
                `INSERT INTO export_info (exported_at, schema_version, app_build, day_count, earliest_day, latest_day, includes_gps_samples, includes_raw_json)
                 VALUES (?,?,?,?,?,?,?,?)`,
                [
                    new Date().toISOString(),
                    SCHEMA_VERSION,
                    appBuild,
                    dayCount,
                    earliestDay,
                    latestDay,
                    includeGpsSamples ? 1 : 0,
                    includeRawJson ? 1 : 0
                ]
            );

            sqliteDb.exec('COMMIT');
            sqliteDb.exec('ANALYZE;');

            const bytes = sqliteDb.export();

            onProgress({ phase: 'done', message: 'Export complete.', percent: 1 });
            return {
                bytes,
                stats: {
                    dayCount,
                    itemCount: totalItems,
                    sampleCount: totalSamples,
                    noteCount: totalNotes,
                    locationCount: locations.length,
                    locationVisitCount: locationVisits.length,
                    skippedItemCount: totalSkippedItems,
                    earliestDay,
                    latestDay,
                    schemaVersion: SCHEMA_VERSION,
                    sizeBytes: bytes.byteLength
                }
            };
        } finally {
            sqliteDb.close();
        }
    }

    function collectNotes(item) {
        const out = [];
        if (!item) return out;
        const itemDate = item.startDate || item.endDate || null;
        if (typeof item.notes === 'string') {
            const trimmed = item.notes.trim();
            if (trimmed) out.push({ body: trimmed, date: isoStr(itemDate) });
        } else if (Array.isArray(item.notes)) {
            for (const n of item.notes) {
                if (!n) continue;
                const body = (typeof n === 'string' ? n : n.body || '').toString();
                if (!body.trim()) continue;
                const date = (typeof n === 'object' && n.date) ? isoStr(n.date) : isoStr(itemDate);
                out.push({ body, date });
            }
        }
        return out;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Download helper
    // ────────────────────────────────────────────────────────────────────────

    function suggestedFilename() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `arc-timeline-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.db`;
    }

    function triggerDownload(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/vnd.sqlite3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoke after the click has had a chance to start
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }

    async function exportAndDownload(idb, opts = {}) {
        const { bytes, stats } = await buildDatabase(idb, opts);
        const filename = opts.filename || suggestedFilename();
        triggerDownload(bytes, filename);
        return { filename, bytes, stats };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Pre-export stats (cheap counts for the UI)
    // ────────────────────────────────────────────────────────────────────────

    async function getExportStats(idb) {
        const [dayCount, locationCount, lastSyncMeta] = await Promise.all([
            countStore(idb, 'days'),
            countStore(idb, 'locations'),
            readMetadataKey(idb, 'lastSync')
        ]);
        return {
            dayCount,
            locationCount,
            lastSync: lastSyncMeta?.value || null
        };
    }

    function readMetadataKey(idb, key) {
        return new Promise((resolve) => {
            if (!idb.objectStoreNames.contains('metadata')) {
                resolve(null);
                return;
            }
            const tx = idb.transaction(['metadata'], 'readonly');
            const req = tx.objectStore('metadata').get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }

    // ────────────────────────────────────────────────────────────────────────

    window.ArcExport = {
        SCHEMA_VERSION,
        SCHEMA_SQL,
        buildDatabase,
        exportAndDownload,
        getExportStats,
        loadSqlJs
    };
})();
