#!/usr/bin/env node
/**
 * Build a synthetic Arc Timeline export for testing the MCP server end-to-end.
 * Mirrors the schema produced by ../../arc-export.js exactly.
 *
 * Usage:  node test/make-fixture.mjs [output.db]
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outPath = path.resolve(process.argv[2] || path.join(__dirname, 'fixture.db'));
try { fs.rmSync(outPath, { force: true }); } catch {}

const SCHEMA_SQL = `
CREATE TABLE export_info (
  exported_at TEXT NOT NULL, schema_version INTEGER NOT NULL, app_build TEXT,
  day_count INTEGER, earliest_day TEXT, latest_day TEXT,
  includes_gps_samples INTEGER NOT NULL DEFAULT 0,
  includes_raw_json INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE days (
  day_key TEXT PRIMARY KEY, month_key TEXT NOT NULL, last_updated_ms INTEGER,
  source_file TEXT, content_hash TEXT, raw_json TEXT NOT NULL
);
CREATE INDEX days_month ON days(month_key);
CREATE TABLE daily_summaries (
  day_key TEXT PRIMARY KEY, total_duration_s INTEGER, total_distance_m REAL,
  record_count INTEGER, activity_stats_json TEXT,
  bbox_min_lat REAL, bbox_max_lat REAL, bbox_min_lng REAL, bbox_max_lng REAL,
  min_altitude_m REAL, max_altitude_m REAL, gps_sample_count INTEGER
);
CREATE INDEX ds_bbox_lat ON daily_summaries(bbox_min_lat, bbox_max_lat);
CREATE INDEX ds_bbox_lng ON daily_summaries(bbox_min_lng, bbox_max_lng);
CREATE INDEX ds_max_alt  ON daily_summaries(max_altitude_m) WHERE max_altitude_m IS NOT NULL;
CREATE INDEX ds_min_alt  ON daily_summaries(min_altitude_m) WHERE min_altitude_m IS NOT NULL;
CREATE TABLE daily_activity_stats (
  day_key TEXT NOT NULL, activity_type TEXT NOT NULL,
  count INTEGER, duration_s INTEGER, distance_m REAL, elevation_gain_m REAL,
  PRIMARY KEY (day_key, activity_type)
);
CREATE INDEX das_type ON daily_activity_stats(activity_type);
CREATE TABLE timeline_items (
  item_id TEXT NOT NULL, day_key TEXT NOT NULL, is_visit INTEGER NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  start_epoch_ms INTEGER NOT NULL, end_epoch_ms INTEGER NOT NULL, duration_s INTEGER,
  place_id TEXT, place_name TEXT, custom_title TEXT, street_address TEXT, place_radius_m REAL,
  activity_type TEXT, manual_activity_type INTEGER, distance_m REAL,
  center_lat REAL, center_lng REAL, center_altitude_m REAL, sample_count INTEGER,
  PRIMARY KEY (item_id, day_key)
);
CREATE INDEX ti_day ON timeline_items(day_key);
CREATE INDEX ti_item ON timeline_items(item_id);
CREATE INDEX ti_place ON timeline_items(place_name) WHERE place_name IS NOT NULL;
CREATE INDEX ti_activity ON timeline_items(activity_type) WHERE activity_type IS NOT NULL;
CREATE INDEX ti_start ON timeline_items(start_date);
CREATE INDEX ti_bbox ON timeline_items(center_lat, center_lng);
CREATE TABLE gps_samples (
  item_id TEXT NOT NULL, day_key TEXT NOT NULL, sample_idx INTEGER NOT NULL,
  timestamp TEXT, epoch_ms INTEGER,
  latitude REAL NOT NULL, longitude REAL NOT NULL, altitude_m REAL,
  PRIMARY KEY (item_id, day_key, sample_idx)
);
CREATE INDEX gps_day ON gps_samples(day_key);
CREATE INDEX gps_bbox ON gps_samples(latitude, longitude);
CREATE INDEX gps_altitude ON gps_samples(altitude_m) WHERE altitude_m IS NOT NULL;
CREATE TABLE locations (
  name TEXT PRIMARY KEY, total_visits INTEGER, total_duration_s INTEGER,
  first_visit TEXT, last_visit TEXT, lat REAL, lng REAL, record_count INTEGER
);
CREATE INDEX loc_visits ON locations(total_visits DESC);
CREATE INDEX loc_duration ON locations(total_duration_s DESC);
CREATE INDEX loc_bbox ON locations(lat, lng);
CREATE TABLE location_visits (
  id INTEGER PRIMARY KEY, day_key TEXT NOT NULL, location_name TEXT NOT NULL,
  duration_s INTEGER, visit_count INTEGER, first_visit_time TEXT, lat REAL, lng REAL
);
CREATE INDEX lv_name ON location_visits(location_name);
CREATE INDEX lv_day ON location_visits(day_key);
CREATE INDEX lv_name_day ON location_visits(location_name, day_key);
CREATE TABLE notes (
  note_id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL,
  day_key TEXT NOT NULL, note_idx INTEGER NOT NULL, body TEXT, note_date TEXT,
  UNIQUE (item_id, day_key, note_idx) ON CONFLICT IGNORE
);
CREATE INDEX notes_item ON notes(item_id);
CREATE INDEX notes_day ON notes(day_key);
CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value_json TEXT);
`;

const db = new Database(outPath);
db.pragma('journal_mode = MEMORY');
db.pragma('synchronous = OFF');
db.exec(SCHEMA_SQL);

const days = [
    { dayKey: '2026-05-19', monthKey: '2026-05' },
    { dayKey: '2026-05-20', monthKey: '2026-05' },
    { dayKey: '2026-05-21', monthKey: '2026-05' }
];

const tx = db.transaction(() => {
    for (const d of days) {
        db.prepare(`INSERT INTO days (day_key, month_key, last_updated_ms, source_file, content_hash, raw_json)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(
            d.dayKey, d.monthKey, Date.now(), 'fixture', 'hash-' + d.dayKey, JSON.stringify({ test: true })
        );
        db.prepare(`INSERT INTO daily_summaries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            d.dayKey, 7200, 8500, 4,
            JSON.stringify({ walking: { count: 2, duration: 3600, distance: 4500, elevationGain: 12 }, cycling: { count: 1, duration: 1800, distance: 4000, elevationGain: 30 } }),
            43.7731, 43.7750, 11.2558, 11.2580, 50, 4200, 3
        );
        db.prepare(`INSERT INTO daily_activity_stats VALUES (?,?,?,?,?,?)`).run(d.dayKey, 'walking', 2, 3600, 4500, 12);
        db.prepare(`INSERT INTO daily_activity_stats VALUES (?,?,?,?,?,?)`).run(d.dayKey, 'cycling', 1, 1800, 4000, 30);
    }

    db.prepare(`INSERT INTO timeline_items (
        item_id, day_key, is_visit, start_date, end_date, start_epoch_ms, end_epoch_ms, duration_s,
        place_id, place_name, custom_title, street_address, place_radius_m,
        activity_type, manual_activity_type, distance_m,
        center_lat, center_lng, center_altitude_m, sample_count
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        'v1', '2026-05-21', 1, '2026-05-21T09:00:00Z', '2026-05-21T10:00:00Z',
        Date.parse('2026-05-21T09:00:00Z'), Date.parse('2026-05-21T10:00:00Z'), 3600,
        'p1', 'Florence Cathedral', null, 'Piazza del Duomo', 30,
        null, 0, null,
        43.7731, 11.2558, 50, 0
    );
    db.prepare(`INSERT INTO timeline_items (
        item_id, day_key, is_visit, start_date, end_date, start_epoch_ms, end_epoch_ms, duration_s,
        place_id, place_name, custom_title, street_address, place_radius_m,
        activity_type, manual_activity_type, distance_m,
        center_lat, center_lng, center_altitude_m, sample_count
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        'a1', '2026-05-21', 0, '2026-05-21T10:00:00Z', '2026-05-21T10:30:00Z',
        Date.parse('2026-05-21T10:00:00Z'), Date.parse('2026-05-21T10:30:00Z'), 1800,
        null, null, null, null, null,
        'walking', 0, 1234,
        null, null, null, 3
    );

    const samples = [
        ['a1', '2026-05-21', 0, '2026-05-21T10:00:00Z', Date.parse('2026-05-21T10:00:00Z'), 43.7731, 11.2558, 50],
        ['a1', '2026-05-21', 1, '2026-05-21T10:15:00Z', Date.parse('2026-05-21T10:15:00Z'), 43.7740, 11.2570, 55],
        ['a1', '2026-05-21', 2, '2026-05-21T10:30:00Z', Date.parse('2026-05-21T10:30:00Z'), 43.7750, 11.2580, 4200]
    ];
    for (const s of samples) {
        db.prepare(`INSERT INTO gps_samples VALUES (?,?,?,?,?,?,?,?)`).run(...s);
    }

    db.prepare(`INSERT INTO locations VALUES (?,?,?,?,?,?,?,?)`).run('Florence Cathedral', 5, 18000, '2026-04-01', '2026-05-21', 43.7731, 11.2558, 5);
    db.prepare(`INSERT INTO locations VALUES (?,?,?,?,?,?,?,?)`).run('Home', 30, 720000, '2026-01-01', '2026-05-21', 51.5, -0.1, 30);

    db.prepare(`INSERT INTO location_visits (day_key, location_name, duration_s, visit_count, first_visit_time, lat, lng)
                VALUES (?,?,?,?,?,?,?)`).run('2026-05-21', 'Florence Cathedral', 3600, 1, '09:00', 43.7731, 11.2558);
    db.prepare(`INSERT INTO location_visits (day_key, location_name, duration_s, visit_count, first_visit_time, lat, lng)
                VALUES (?,?,?,?,?,?,?)`).run('2026-05-20', 'Home', 28800, 2, '20:00', 51.5, -0.1);

    db.prepare(`INSERT INTO notes (item_id, day_key, note_idx, body, note_date)
                VALUES (?,?,?,?,?)`).run('v1', '2026-05-21', 0, 'Visited the Duomo in Florence, climbed to the top', '2026-05-21T09:00:00Z');
    db.prepare(`INSERT INTO notes (item_id, day_key, note_idx, body, note_date)
                VALUES (?,?,?,?,?)`).run('a1', '2026-05-21', 0, 'Walked back along the Arno', '2026-05-21T10:00:00Z');

    db.prepare(`INSERT INTO app_metadata VALUES (?,?)`).run('lastSync', String(Date.now()));

    // Fixture includes samples so the bbox/elevation tests have data to run on.
    db.prepare(`INSERT INTO export_info VALUES (?,?,?,?,?,?,?,?)`).run(
        new Date().toISOString(), 4, '02.281-fixture', days.length, '2026-05-19', '2026-05-21', 1, 0
    );
});
tx();
db.close();
console.log(`Wrote fixture to ${outPath}`);
