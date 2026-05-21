#!/usr/bin/env node
/**
 * Arc Timeline MCP Server
 *
 * Exposes a SQLite database produced by the Arc Reader browser export to any
 * MCP-compatible AI client (Claude Code, Codex, Claude Desktop, etc.).
 *
 * Usage:
 *   node index.js /path/to/arc-timeline.db
 *   node index.js /path/to/arc-timeline.db --selftest
 *
 * The server is fully read-only. The `run_sql` tool refuses any statement
 * that isn't a SELECT or WITH ... SELECT.
 */

import Database from 'better-sqlite3';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION_EXPECTED = 4;
const MAX_ROWS = 1000;        // hard cap on rows returned per query
const MAX_RESULT_CHARS = 200_000;

// ─── Argument parsing ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
let dbPath = null;
let selftest = false;
for (const a of args) {
    if (a === '--selftest') selftest = true;
    else if (a === '--help' || a === '-h') {
        console.log('Usage: arc-timeline-mcp <path-to-arc-timeline.db> [--selftest]');
        process.exit(0);
    }
    else if (!dbPath) dbPath = a;
}

if (!dbPath) {
    console.error('Error: missing path to Arc Timeline .db file.');
    console.error('Usage: arc-timeline-mcp <path-to-arc-timeline.db>');
    process.exit(1);
}

const resolvedPath = path.resolve(dbPath);
if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: database file not found: ${resolvedPath}`);
    process.exit(1);
}

// ─── Open DB read-only ──────────────────────────────────────────────────────

// Open without `readonly:true` so we can create a temp FTS5 index over notes
// (better-sqlite3 blocks all writes — including temp.* — when readonly is set).
// We immediately switch to query_only mode below, which blocks writes to main.*
// at the SQLite level. The temp.* database lives in a separate connection-local
// file and is destroyed when the process exits; the user's .db is never modified.
const db = new Database(resolvedPath, { fileMustExist: true });

let ftsReady = false;
try {
    const hasNotes = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='notes'`
    ).get();
    if (hasNotes) {
        db.exec(`CREATE VIRTUAL TABLE temp.notes_fts USING fts5(body, content='')`);
        const insert = db.prepare(`INSERT INTO temp.notes_fts(rowid, body) VALUES (?, ?)`);
        const rows = db.prepare(
            `SELECT note_id, body FROM notes WHERE body IS NOT NULL AND body != ''`
        ).all();
        const tx = db.transaction(() => {
            for (const r of rows) insert.run(r.note_id, r.body);
        });
        tx();
        ftsReady = true;
    }
} catch (err) {
    console.error(`Warning: could not build FTS5 index for notes (${err.message}). search_notes will fall back to LIKE.`);
}

// Lock the connection: from here on, any attempt to write main.* fails at the
// SQLite layer. temp.* remains writable inside this process, but the user's
// .db file on disk is safe.
db.pragma('query_only = ON');

let exportInfo = null;
try {
    exportInfo = db.prepare('SELECT * FROM export_info LIMIT 1').get();
} catch (err) {
    console.error(`Error: ${resolvedPath} does not look like an Arc Timeline export (${err.message}).`);
    process.exit(1);
}

if (!exportInfo) {
    console.error('Error: export_info table is empty — this file is not a valid Arc Timeline export.');
    process.exit(1);
}

if (exportInfo.schema_version !== SCHEMA_VERSION_EXPECTED) {
    console.error(`Warning: schema version mismatch. Server expects v${SCHEMA_VERSION_EXPECTED}, file is v${exportInfo.schema_version}.`);
}

// ─── Self-test mode ─────────────────────────────────────────────────────────

if (selftest) {
    console.log('Arc Timeline MCP — self-test');
    console.log('─────────────────────────────');
    console.log(`File:           ${resolvedPath}`);
    console.log(`Exported at:    ${exportInfo.exported_at}`);
    console.log(`App build:      ${exportInfo.app_build || 'unknown'}`);
    console.log(`Schema version: ${exportInfo.schema_version}`);
    console.log(`Days:           ${exportInfo.day_count} (${exportInfo.earliest_day} → ${exportInfo.latest_day})`);
    console.log(`GPS samples:    ${exportInfo.includes_gps_samples ? 'included' : 'NOT included (re-export with the box ticked to enable bbox / elevation queries)'}`);
    console.log(`Raw JSON blobs: ${exportInfo.includes_raw_json ? 'included' : 'not included'}`);
    console.log('');
    const counts = [
        'timeline_items', 'gps_samples', 'locations',
        'location_visits', 'daily_summaries', 'daily_activity_stats', 'notes'
    ];
    for (const t of counts) {
        const r = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get();
        console.log(`  ${t.padEnd(22)} ${r.c.toLocaleString()}`);
    }
    process.exit(0);
}

// ─── Schema description (for run_sql tool) ──────────────────────────────────

const SCHEMA_DESCRIPTION = `Arc Timeline export schema. All times are ISO 8601 strings; epoch_ms columns are integer milliseconds. Distances are metres, durations are seconds. The database is read-only.

TABLES:

  export_info(exported_at, schema_version, app_build, day_count, earliest_day, latest_day,
              includes_gps_samples, includes_raw_json)
    One row. Tells you how stale this snapshot is and which optional tables
    were populated. When includes_gps_samples = 0 the gps_samples table is
    empty, but find_days_in_region and get_elevation_stats still work via
    per-day aggregates on daily_summaries (slightly less precise; they tell
    you in their response which source they used).

  days(day_key PK, month_key, last_updated_ms, source_file, content_hash, raw_json)
    One row per imported day. day_key is YYYY-MM-DD. raw_json is the original blob (escape hatch).

  daily_summaries(day_key PK, total_duration_s, total_distance_m, record_count, activity_stats_json,
                  bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
                  min_altitude_m, max_altitude_m, gps_sample_count)
    Pre-aggregated per-day totals. activity_stats_json kept for completeness; prefer daily_activity_stats for SQL.
    bbox_* and *_altitude_m are always populated (even when raw gps_samples
    are omitted). gps_sample_count is the count from the source data
    regardless of whether the rows themselves were persisted.

  daily_activity_stats(day_key, activity_type, count, duration_s, distance_m, elevation_gain_m)
    Composite PK (day_key, activity_type). One row per (day, activity_type).
    activity_type: 'car','walking','cycling','bus','train','airplane','boat','hiking','running','motorcycle','scooter','stationary','unknown', and more.

  timeline_items(item_id, day_key, is_visit, start_date, end_date, start_epoch_ms, end_epoch_ms,
                 duration_s, place_id, place_name, custom_title, street_address, place_radius_m,
                 activity_type, manual_activity_type, distance_m,
                 center_lat, center_lng, center_altitude_m, sample_count)
    Every visit and activity from every day. is_visit=1 for stays, 0 for movement.
    Composite PK (item_id, day_key) — multi-day spans appear in BOTH day rows;
    use SELECT DISTINCT item_id … if you want one row per logical item.
    Visit-only fields (place_*, custom_title, street_address) are NULL on activities and vice versa.

  gps_samples(item_id, day_key, sample_idx, timestamp, epoch_ms, latitude, longitude, altitude_m)
    Composite PK (item_id, day_key, sample_idx). The volume table — millions of rows for heavy users.
    Indexed by (latitude, longitude) for bounding-box queries and by day_key for date scans.

  locations(name PK, total_visits, total_duration_s, first_visit, last_visit, lat, lng, record_count)
    Aggregate per named place. first_visit / last_visit are YYYY-MM-DD strings.

  location_visits(id PK, day_key, location_name, duration_s, visit_count, first_visit_time, lat, lng)
    One row per (day, location). first_visit_time is HH:MM.

  notes(note_id PK, item_id, day_key, note_idx, body, note_date)
    Free-text notes attached to timeline items.

  temp.notes_fts  (FTS5 virtual table over notes.body, built in-memory at server start.
                   Use: SELECT rowid FROM temp.notes_fts WHERE notes_fts MATCH 'florence'
                   Note: in the MATCH clause the table name must be UNQUALIFIED
                   even though the table lives in temp.* — schema-qualified
                   forms like "temp.notes_fts MATCH …" parse as a column ref.)

  app_metadata(key PK, value_json)
    Non-secret app metadata. Values are JSON-encoded strings — use json_extract() if needed.

USEFUL QUERIES:
  -- top 10 places by visits
  SELECT name, total_visits FROM locations ORDER BY total_visits DESC LIMIT 10;
  -- walking distance per month last year
  SELECT substr(day_key,1,7) AS month, SUM(distance_m)/1000.0 AS km
    FROM daily_activity_stats WHERE activity_type='walking' AND day_key >= '2025-01-01'
    GROUP BY month ORDER BY month;
  -- highest altitude ever
  SELECT day_key, MAX(altitude_m) AS m FROM gps_samples GROUP BY day_key ORDER BY m DESC LIMIT 5;
  -- notes mentioning a word
  SELECT n.day_key, n.body FROM temp.notes_fts f JOIN notes n ON n.note_id = f.rowid
    WHERE notes_fts MATCH 'birthday' LIMIT 20;`;

// ─── SQL safety guard ───────────────────────────────────────────────────────

const FORBIDDEN_PATTERNS = [
    /\bATTACH\b/i, /\bDETACH\b/i, /\bPRAGMA\b/i, /\bINSERT\b/i, /\bUPDATE\b/i,
    /\bDELETE\b/i, /\bDROP\b/i, /\bCREATE\b/i, /\bALTER\b/i, /\bREPLACE\b/i,
    /\bVACUUM\b/i, /\bREINDEX\b/i
];

function assertReadOnlySql(sql) {
    const trimmed = sql.trim().replace(/;+\s*$/, '');
    if (!trimmed) throw new Error('Empty query.');
    if (trimmed.includes(';')) throw new Error('Multiple statements are not allowed.');
    if (!/^(SELECT|WITH)\b/i.test(trimmed)) throw new Error('Only SELECT (or WITH … SELECT) queries are allowed.');
    for (const pat of FORBIDDEN_PATTERNS) {
        if (pat.test(trimmed)) throw new Error(`Statement contains forbidden keyword (${pat}).`);
    }
    return trimmed;
}

// ─── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'run_sql',
        description: `Run a read-only SQL query against the Arc Timeline database. Only SELECT and WITH … SELECT are allowed. Returns up to ${MAX_ROWS} rows. Use get_schema() first if you don't know the table layout.`,
        inputSchema: {
            type: 'object',
            properties: {
                sql: { type: 'string', description: 'A single SELECT or WITH … SELECT statement.' },
                params: {
                    type: 'array',
                    description: 'Optional parameters for ? placeholders in the SQL.',
                    items: { type: ['string', 'number', 'boolean', 'null'] }
                },
                limit: {
                    type: 'integer',
                    description: `Maximum rows to return. Defaults to ${MAX_ROWS}.`,
                    minimum: 1,
                    maximum: MAX_ROWS
                }
            },
            required: ['sql']
        }
    },
    {
        name: 'get_schema',
        description: 'Return a description of every table and column in the Arc Timeline database, with usage examples.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'get_export_info',
        description: 'Return metadata about the exported database (when it was exported, day range, app build, schema version).',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'get_activity_summary',
        description: 'Get aggregated activity totals (count, distance, duration) for a date range, broken out by activity type.',
        inputSchema: {
            type: 'object',
            properties: {
                start_date: { type: 'string', description: 'YYYY-MM-DD (inclusive)' },
                end_date:   { type: 'string', description: 'YYYY-MM-DD (inclusive)' }
            },
            required: ['start_date', 'end_date']
        }
    },
    {
        name: 'get_monthly_summary',
        description: 'Get per-month activity totals between two dates.',
        inputSchema: {
            type: 'object',
            properties: {
                start_date: { type: 'string', description: 'YYYY-MM-DD' },
                end_date:   { type: 'string', description: 'YYYY-MM-DD' },
                activity_type: { type: 'string', description: 'Optional filter (walking, car, cycling, etc.)' }
            },
            required: ['start_date', 'end_date']
        }
    },
    {
        name: 'get_daily_stats',
        description: 'Get per-day totals over a date range. Max 365 days at once.',
        inputSchema: {
            type: 'object',
            properties: {
                start_date: { type: 'string' },
                end_date:   { type: 'string' }
            },
            required: ['start_date', 'end_date']
        }
    },
    {
        name: 'get_day_timeline',
        description: 'Get the full timeline (every visit and activity, in chronological order) for a single day.',
        inputSchema: {
            type: 'object',
            properties: {
                day_key: { type: 'string', description: 'YYYY-MM-DD' }
            },
            required: ['day_key']
        }
    },
    {
        name: 'get_date_range_places',
        description: 'List every named place visited between two dates, with visit counts and total time.',
        inputSchema: {
            type: 'object',
            properties: {
                start_date: { type: 'string' },
                end_date:   { type: 'string' }
            },
            required: ['start_date', 'end_date']
        }
    },
    {
        name: 'get_top_locations',
        description: 'Top N locations by visits or duration.',
        inputSchema: {
            type: 'object',
            properties: {
                metric: { type: 'string', enum: ['visits', 'duration'], default: 'visits' },
                limit:  { type: 'integer', default: 20, minimum: 1, maximum: 200 }
            }
        }
    },
    {
        name: 'search_locations',
        description: 'Case-insensitive substring search over location names.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                limit: { type: 'integer', default: 50, minimum: 1, maximum: 500 }
            },
            required: ['query']
        }
    },
    {
        name: 'find_location_visits',
        description: 'Find every visit to locations whose name matches the given query. Returns per-day visit records.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                limit: { type: 'integer', default: 100, minimum: 1, maximum: 1000 }
            },
            required: ['query']
        }
    },
    {
        name: 'get_location_details',
        description: 'Full details for one location, including the most recent 100 visits.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Exact location name (use search_locations to find it).' }
            },
            required: ['name']
        }
    },
    {
        name: 'find_days_in_region',
        description: 'Find days where any GPS sample falls inside a lat/lng bounding box. Useful for "when did I visit Japan?" style questions.',
        inputSchema: {
            type: 'object',
            properties: {
                min_lat: { type: 'number' },
                max_lat: { type: 'number' },
                min_lng: { type: 'number' },
                max_lng: { type: 'number' },
                start_date: { type: 'string', description: 'Optional YYYY-MM-DD lower bound' },
                end_date:   { type: 'string', description: 'Optional YYYY-MM-DD upper bound' },
                limit: { type: 'integer', default: 200, minimum: 1, maximum: 2000 }
            },
            required: ['min_lat', 'max_lat', 'min_lng', 'max_lng']
        }
    },
    {
        name: 'get_elevation_stats',
        description: 'Find highest/lowest altitude GPS samples (overall or in a date range).',
        inputSchema: {
            type: 'object',
            properties: {
                order: { type: 'string', enum: ['highest', 'lowest'], default: 'highest' },
                limit: { type: 'integer', default: 10, minimum: 1, maximum: 100 },
                start_date: { type: 'string' },
                end_date:   { type: 'string' }
            }
        }
    },
    {
        name: 'search_notes',
        description: 'Full-text search over notes using SQLite FTS5. Supports MATCH syntax (e.g. "florence", "birthday OR anniversary").',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                limit: { type: 'integer', default: 50, minimum: 1, maximum: 500 }
            },
            required: ['query']
        }
    }
];

// ─── Tool executors ─────────────────────────────────────────────────────────

function truncateForResult(rows) {
    let text = JSON.stringify(rows, null, 2);
    let truncated = false;
    if (text.length > MAX_RESULT_CHARS) {
        text = text.slice(0, MAX_RESULT_CHARS) + '\n... (truncated)';
        truncated = true;
    }
    return { text, truncated };
}

function asText(payload) {
    const { text, truncated } = truncateForResult(payload);
    return {
        content: [
            { type: 'text', text }
        ],
        isError: false,
        _meta: truncated ? { truncated: true } : undefined
    };
}

function asError(message) {
    return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true
    };
}

const executors = {
    run_sql({ sql, params = [], limit = MAX_ROWS }) {
        const cleaned = assertReadOnlySql(sql);
        const effectiveLimit = Math.min(Math.max(1, limit | 0), MAX_ROWS);
        const stmt = db.prepare(cleaned);
        const rows = stmt.all(...(params || []));
        const truncatedByLimit = rows.length > effectiveLimit;
        const out = truncatedByLimit ? rows.slice(0, effectiveLimit) : rows;
        return asText({
            row_count: out.length,
            row_count_truncated: truncatedByLimit ? `Query returned ${rows.length} rows; showing first ${effectiveLimit}.` : undefined,
            rows: out
        });
    },

    get_schema() {
        return {
            content: [{ type: 'text', text: SCHEMA_DESCRIPTION }],
            isError: false
        };
    },

    get_export_info() {
        return asText(exportInfo);
    },

    get_activity_summary({ start_date, end_date }) {
        const rows = db.prepare(`
            SELECT activity_type,
                   SUM(count)            AS count,
                   SUM(duration_s)       AS duration_s,
                   SUM(distance_m)       AS distance_m,
                   SUM(elevation_gain_m) AS elevation_gain_m
            FROM daily_activity_stats
            WHERE day_key BETWEEN ? AND ?
            GROUP BY activity_type
            ORDER BY distance_m DESC NULLS LAST
        `).all(start_date, end_date);
        return asText({ range: { start_date, end_date }, totals_by_activity: rows });
    },

    get_monthly_summary({ start_date, end_date, activity_type }) {
        const whereType = activity_type ? 'AND activity_type = ?' : '';
        const stmt = db.prepare(`
            SELECT substr(day_key, 1, 7) AS month,
                   activity_type,
                   SUM(count)            AS count,
                   SUM(duration_s)       AS duration_s,
                   SUM(distance_m)       AS distance_m,
                   SUM(elevation_gain_m) AS elevation_gain_m
            FROM daily_activity_stats
            WHERE day_key BETWEEN ? AND ? ${whereType}
            GROUP BY month, activity_type
            ORDER BY month, distance_m DESC NULLS LAST
        `);
        const rows = activity_type
            ? stmt.all(start_date, end_date, activity_type)
            : stmt.all(start_date, end_date);
        return asText({ range: { start_date, end_date }, activity_type: activity_type || null, rows });
    },

    get_daily_stats({ start_date, end_date }) {
        const rows = db.prepare(`
            SELECT day_key,
                   total_duration_s,
                   total_distance_m,
                   record_count
            FROM daily_summaries
            WHERE day_key BETWEEN ? AND ?
            ORDER BY day_key
            LIMIT 365
        `).all(start_date, end_date);
        return asText({ range: { start_date, end_date }, rows });
    },

    get_day_timeline({ day_key }) {
        const rows = db.prepare(`
            SELECT item_id, is_visit, start_date, end_date, duration_s,
                   place_name, custom_title, street_address,
                   activity_type, distance_m, sample_count,
                   center_lat, center_lng, center_altitude_m
            FROM timeline_items
            WHERE day_key = ?
            ORDER BY start_epoch_ms
        `).all(day_key);
        return asText({ day_key, items: rows });
    },

    get_date_range_places({ start_date, end_date }) {
        const rows = db.prepare(`
            SELECT location_name,
                   COUNT(DISTINCT day_key) AS days_visited,
                   SUM(visit_count)        AS total_visits,
                   SUM(duration_s)         AS total_duration_s,
                   MIN(day_key)            AS first_seen,
                   MAX(day_key)            AS last_seen
            FROM location_visits
            WHERE day_key BETWEEN ? AND ?
            GROUP BY location_name
            ORDER BY total_duration_s DESC
            LIMIT 500
        `).all(start_date, end_date);
        return asText({ range: { start_date, end_date }, places: rows });
    },

    get_top_locations({ metric = 'visits', limit = 20 }) {
        const col = metric === 'duration' ? 'total_duration_s' : 'total_visits';
        const rows = db.prepare(
            `SELECT name, total_visits, total_duration_s, first_visit, last_visit, lat, lng
             FROM locations
             ORDER BY ${col} DESC NULLS LAST
             LIMIT ?`
        ).all(Math.min(limit | 0, 200));
        return asText({ metric, rows });
    },

    search_locations({ query, limit = 50 }) {
        const rows = db.prepare(`
            SELECT name, total_visits, total_duration_s, first_visit, last_visit
            FROM locations
            WHERE name LIKE ? COLLATE NOCASE
            ORDER BY total_visits DESC NULLS LAST
            LIMIT ?
        `).all(`%${query}%`, Math.min(limit | 0, 500));
        return asText({ query, rows });
    },

    find_location_visits({ query, limit = 100 }) {
        const rows = db.prepare(`
            SELECT day_key, location_name, duration_s, visit_count, first_visit_time, lat, lng
            FROM location_visits
            WHERE location_name LIKE ? COLLATE NOCASE
            ORDER BY day_key DESC
            LIMIT ?
        `).all(`%${query}%`, Math.min(limit | 0, 1000));
        return asText({ query, visits: rows });
    },

    get_location_details({ name }) {
        const loc = db.prepare(`SELECT * FROM locations WHERE name = ?`).get(name);
        if (!loc) return asError(`No location named "${name}". Try search_locations first.`);
        const recent = db.prepare(`
            SELECT day_key, duration_s, visit_count, first_visit_time
            FROM location_visits
            WHERE location_name = ?
            ORDER BY day_key DESC
            LIMIT 100
        `).all(name);
        return asText({ location: loc, recent_visits: recent });
    },

    find_days_in_region({ min_lat, max_lat, min_lng, max_lng, start_date, end_date, limit = 200 }) {
        const lim = Math.min(limit | 0, 2000);
        // Raw samples available → exact answer (each row guaranteed to be a
        // GPS fix inside the query box on that day).
        if (exportInfo.includes_gps_samples) {
            const conds = ['latitude BETWEEN ? AND ?', 'longitude BETWEEN ? AND ?'];
            const params = [min_lat, max_lat, min_lng, max_lng];
            if (start_date) { conds.push('day_key >= ?'); params.push(start_date); }
            if (end_date)   { conds.push('day_key <= ?'); params.push(end_date); }
            params.push(lim);
            const rows = db.prepare(`
                SELECT day_key,
                       COUNT(*) AS sample_count,
                       MIN(latitude)  AS min_lat,  MAX(latitude)  AS max_lat,
                       MIN(longitude) AS min_lng,  MAX(longitude) AS max_lng
                FROM gps_samples
                WHERE ${conds.join(' AND ')}
                GROUP BY day_key
                ORDER BY day_key
                LIMIT ?
            `).all(...params);
            return asText({ bbox: { min_lat, max_lat, min_lng, max_lng }, source: 'raw_samples', days: rows });
        }
        // Fall back to per-day aggregates: any day whose bbox overlaps the
        // query box. Returns false positives (a day with a sprawling bbox
        // touching the corner of the query box even if no actual point is
        // inside), but for "when did I visit <region>?" questions it's
        // accurate enough.
        const conds = [
            'bbox_max_lat IS NOT NULL',
            'bbox_max_lat >= ?', 'bbox_min_lat <= ?',
            'bbox_max_lng >= ?', 'bbox_min_lng <= ?'
        ];
        const params = [min_lat, max_lat, min_lng, max_lng];
        if (start_date) { conds.push('day_key >= ?'); params.push(start_date); }
        if (end_date)   { conds.push('day_key <= ?'); params.push(end_date); }
        params.push(lim);
        const rows = db.prepare(`
            SELECT day_key,
                   gps_sample_count AS sample_count,
                   bbox_min_lat AS min_lat, bbox_max_lat AS max_lat,
                   bbox_min_lng AS min_lng, bbox_max_lng AS max_lng
            FROM daily_summaries
            WHERE ${conds.join(' AND ')}
            ORDER BY day_key
            LIMIT ?
        `).all(...params);
        return asText({
            bbox: { min_lat, max_lat, min_lng, max_lng },
            source: 'daily_bbox_aggregates',
            note: 'This export does not include raw GPS samples, so results are based on per-day bounding boxes. May include false positives where a day\'s overall bbox overlaps the query but no actual point is inside.',
            days: rows
        });
    },

    get_elevation_stats({ order = 'highest', limit = 10, start_date, end_date }) {
        const direction = order === 'lowest' ? 'ASC' : 'DESC';
        const lim = Math.min(limit | 0, 100);
        if (exportInfo.includes_gps_samples) {
            const conds = ['altitude_m IS NOT NULL'];
            const params = [];
            if (start_date) { conds.push('day_key >= ?'); params.push(start_date); }
            if (end_date)   { conds.push('day_key <= ?'); params.push(end_date); }
            params.push(lim);
            const rows = db.prepare(`
                SELECT day_key, item_id, timestamp, latitude, longitude, altitude_m
                FROM gps_samples
                WHERE ${conds.join(' AND ')}
                ORDER BY altitude_m ${direction}
                LIMIT ?
            `).all(...params);
            return asText({ order, source: 'raw_samples', rows });
        }
        // Fall back to per-day extremes from daily_summaries.
        const col = order === 'lowest' ? 'min_altitude_m' : 'max_altitude_m';
        const conds = [`${col} IS NOT NULL`];
        const params = [];
        if (start_date) { conds.push('day_key >= ?'); params.push(start_date); }
        if (end_date)   { conds.push('day_key <= ?'); params.push(end_date); }
        params.push(lim);
        const rows = db.prepare(`
            SELECT day_key,
                   min_altitude_m,
                   max_altitude_m,
                   bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng
            FROM daily_summaries
            WHERE ${conds.join(' AND ')}
            ORDER BY ${col} ${direction}
            LIMIT ?
        `).all(...params);
        return asText({
            order,
            source: 'daily_altitude_aggregates',
            note: 'This export does not include raw GPS samples, so results are per-day extremes (the highest/lowest altitude recorded each day, not the exact moment). Re-export with "Include raw GPS samples" if you need per-sample precision.',
            rows
        });
    },

    search_notes({ query, limit = 50 }) {
        const cap = Math.min(limit | 0, 500);
        if (ftsReady) {
            try {
                // FTS5 requires the virtual-table name to be unqualified in the
                // MATCH clause, even when the table lives in temp.* — qualifying
                // it (temp.notes_fts MATCH …) parses as a column reference.
                const rows = db.prepare(`
                    SELECT n.note_id, n.day_key, n.item_id, n.body, n.note_date
                    FROM temp.notes_fts f
                    JOIN notes n ON n.note_id = f.rowid
                    WHERE notes_fts MATCH ?
                    ORDER BY n.day_key DESC
                    LIMIT ?
                `).all(query, cap);
                return asText({ query, search_mode: 'fts5', matches: rows });
            } catch (err) {
                // Fall through to LIKE on malformed FTS5 syntax
            }
        }
        const rows = db.prepare(`
            SELECT note_id, day_key, item_id, body, note_date
            FROM notes
            WHERE body LIKE ? COLLATE NOCASE
            ORDER BY day_key DESC
            LIMIT ?
        `).all(`%${query}%`, cap);
        return asText({ query, search_mode: 'like', matches: rows });
    }
};

// ─── Resources (let clients read days as URI-addressable docs) ──────────────

const RESOURCE_LIST_LIMIT = 200;

function listDayResources() {
    const rows = db.prepare(`SELECT day_key FROM days ORDER BY day_key DESC LIMIT ?`).all(RESOURCE_LIST_LIMIT);
    return rows.map(r => ({
        uri: `arc://day/${r.day_key}`,
        name: `Day ${r.day_key}`,
        description: `Full timeline blob for ${r.day_key}`,
        mimeType: 'application/json'
    }));
}

function readDayResource(uri) {
    const m = /^arc:\/\/day\/(\d{4}-\d{2}-\d{2})$/.exec(uri);
    if (!m) throw new Error(`Unsupported resource URI: ${uri}`);
    const row = db.prepare(`SELECT raw_json FROM days WHERE day_key = ?`).get(m[1]);
    if (!row) throw new Error(`No day matching ${m[1]}`);
    return {
        contents: [{
            uri,
            mimeType: 'application/json',
            text: row.raw_json
        }]
    };
}

// ─── MCP server wiring ──────────────────────────────────────────────────────

const server = new Server(
    { name: 'arc-timeline-mcp', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const exec = executors[name];
    if (!exec) return asError(`Unknown tool: ${name}`);
    try {
        return exec(rawArgs || {});
    } catch (err) {
        return asError(err.message || String(err));
    }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listDayResources()
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    return readDayResource(req.params.uri);
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Log to stderr only — stdout is reserved for MCP protocol traffic.
console.error(`Arc Timeline MCP serving ${resolvedPath} (exported ${exportInfo.exported_at}, ${exportInfo.day_count} days).`);
