#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const sharp = require('sharp');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3000', 10);
const CORE_DATA_EPOCH = 978307200; // seconds between Unix epoch (1970) and Core Data epoch (2001)

// Resolve Photos Library path
const LIBRARY_PATH = (function () {
    // CLI arg: --library /path/to/Photos Library.photoslibrary
    const idx = process.argv.indexOf('--library');
    if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
    // Env var
    if (process.env.PHOTOS_LIBRARY) return process.env.PHOTOS_LIBRARY;
    // Default
    return path.join(os.homedir(), 'Pictures', 'Photos Library.photoslibrary');
})();

const DB_PATH = path.join(LIBRARY_PATH, 'database', 'Photos.sqlite');
const ORIGINALS_PATH = path.join(LIBRARY_PATH, 'originals');
const CACHE_DIR = path.join(__dirname, '.cache');
const THUMB_CACHE = path.join(CACHE_DIR, 'thumbnails');
const FULL_CACHE = path.join(CACHE_DIR, 'full');

// Ensure cache directories exist
fs.mkdirSync(THUMB_CACHE, { recursive: true });
fs.mkdirSync(FULL_CACHE, { recursive: true });

// Purge empty/corrupt cached files and stale temp files on startup
for (const dir of [THUMB_CACHE, FULL_CACHE]) {
    let purged = 0;
    for (const file of fs.readdirSync(dir)) {
        const fp = path.join(dir, file);
        try {
            const stat = fs.statSync(fp);
            if (stat.size === 0 || file.endsWith('.tmp')) {
                fs.unlinkSync(fp);
                purged++;
            }
        } catch (_) {}
    }
    if (purged > 0) console.log(`Purged ${purged} corrupt/temp files from ${path.basename(dir)} cache`);
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

let db;

function openDatabase() {
    if (!fs.existsSync(DB_PATH)) {
        console.error(`Photos database not found at: ${DB_PATH}`);
        console.error(`Specify path with --library or PHOTOS_LIBRARY env var`);
        process.exit(1);
    }
    try {
        db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
        db.pragma('journal_mode = WAL');
        db.pragma('query_only = ON');
    } catch (err) {
        console.error(`Failed to open Photos database: ${err.message}`);
        if (err.message.includes('SQLITE_BUSY') || err.message.includes('locked')) {
            console.error('Tip: Quit Photos.app and try again.');
        }
        process.exit(1);
    }
}

function coreDataToISO(timestamp) {
    if (timestamp == null) return null;
    return new Date((timestamp + CORE_DATA_EPOCH) * 1000).toISOString();
}

function isoToCoreData(iso) {
    return new Date(iso).getTime() / 1000 - CORE_DATA_EPOCH;
}

function dayKeyFromISO(iso) {
    // Return YYYY-MM-DD in local time
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Prepared statements (lazy init after DB opens)
// ---------------------------------------------------------------------------

let stmts = {};

function prepareStatements() {
    // Discover which columns exist (schema varies across macOS versions)
    const assetCols = new Set(db.pragma('table_info(ZASSET)').map(c => c.name));
    const attrCols = new Set(
        db.pragma('table_info(ZADDITIONALASSETATTRIBUTES)').map(c => c.name)
    );

    // Build SELECT dynamically — only include columns that exist
    const zCols = [
        ['Z_PK', 'id'],
        ['ZDATECREATED', 'dateCreated'],
        ['ZLATITUDE', 'latitude'],
        ['ZLONGITUDE', 'longitude'],
        ['ZWIDTH', 'width'],
        ['ZHEIGHT', 'height'],
        ['ZDIRECTORY', 'directory'],
        ['ZFILENAME', 'filename'],
        ['ZUNIFORMTYPEIDENTIFIER', 'uti'],
    ].filter(([col]) => assetCols.has(col))
     .map(([col, alias]) => `z.${col} AS ${alias}`);

    const aCols = [
        ['ZORIGINALFILENAME', 'originalFilename'],
        ['ZCAMERAMAKE', 'cameraMake'],
        ['ZCAMERAMODEL', 'cameraModel'],
    ].filter(([col]) => attrCols.has(col))
     .map(([col, alias]) => `a.${col} AS ${alias}`);

    const needJoin = aCols.length > 0;
    const selectCols = [...zCols, ...aCols].join(',\n            ');
    const joinClause = needJoin ? 'LEFT JOIN ZADDITIONALASSETATTRIBUTES a ON a.ZASSET = z.Z_PK' : '';

    // Log discovered schema
    console.log(`Schema:  ZASSET has ${assetCols.size} columns, ZADDITIONALASSETATTRIBUTES has ${attrCols.size} columns`);
    if (!attrCols.has('ZCAMERAMAKE')) console.log('  Note: ZCAMERAMAKE not found — camera info will be unavailable');

    const BASE_SELECT = `
        SELECT
            ${selectCols}
        FROM ZASSET z
        ${joinClause}
        WHERE z.ZTRASHEDSTATE = 0
          AND z.ZHIDDEN = 0
          AND z.ZKIND = 0
    `;

    stmts.count = db.prepare(`
        SELECT COUNT(*) AS count FROM ZASSET
        WHERE ZTRASHEDSTATE = 0 AND ZHIDDEN = 0 AND ZKIND = 0
    `);

    stmts.allMetadata = db.prepare(`${BASE_SELECT} ORDER BY z.ZDATECREATED`);

    stmts.metadataAfter = db.prepare(`
        ${BASE_SELECT} AND z.ZDATECREATED > :afterCoreData ORDER BY z.ZDATECREATED
    `);

    stmts.metadataRange = db.prepare(`
        ${BASE_SELECT} AND z.ZDATECREATED >= :startCoreData AND z.ZDATECREATED < :endCoreData
        ORDER BY z.ZDATECREATED
    `);

    stmts.photoById = db.prepare(`${BASE_SELECT} AND z.Z_PK = :id`);
}

function formatRow(row) {
    const iso = coreDataToISO(row.dateCreated);
    return {
        id: row.id,
        date: iso,
        dayKey: iso ? dayKeyFromISO(iso) : null,
        latitude: row.latitude != null && row.latitude !== -180 ? row.latitude : null,
        longitude: row.longitude != null && row.longitude !== -180 ? row.longitude : null,
        width: row.width || null,
        height: row.height || null,
        filename: row.filename || null,
        originalFilename: row.originalFilename || null,
        cameraMake: row.cameraMake || null,
        cameraModel: row.cameraModel || null,
        _directory: row.directory || null,
        _uti: row.uti || null
    };
}

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

function resolveOriginalPath(row) {
    // Originals are stored at: originals/{ZDIRECTORY}/{ZFILENAME}
    if (!row._directory || !row.filename) return null;
    return path.join(ORIGINALS_PATH, row._directory, row.filename);
}

// Track IDs that permanently failed processing
const failedPhotos = new Set();

// Concurrency limiter — prevent Sharp/sips resource exhaustion under parallel load
const MAX_CONCURRENT_GENERATE = 4;
let activeGenerations = 0;
const generateQueue = [];

function acquireSlot() {
    if (activeGenerations < MAX_CONCURRENT_GENERATE) {
        activeGenerations++;
        return Promise.resolve();
    }
    return new Promise(resolve => generateQueue.push(resolve));
}

function releaseSlot() {
    if (generateQueue.length > 0) {
        const next = generateQueue.shift();
        next();
    } else {
        activeGenerations--;
    }
}

// Use macOS sips as fallback for HEIC and other formats Sharp can't handle
function sipsConvert(inputPath, outputPath, maxSize) {
    return new Promise((resolve, reject) => {
        // sips: resize to fit within maxSize, convert to JPEG
        execFile('sips', [
            '-s', 'format', 'jpeg',
            '-s', 'formatOptions', '80',
            '-Z', String(maxSize),
            inputPath,
            '--out', outputPath
        ], { timeout: 30000 }, (err, stdout, stderr) => {
            if (err) return reject(err);
            if (!fs.existsSync(outputPath)) return reject(new Error('sips produced no output'));
            resolve(outputPath);
        });
    });
}

async function generateThumbnail(photoId, maxSize) {
    // Skip photos that permanently failed
    if (failedPhotos.has(photoId)) return null;

    const isThumb = maxSize <= 200;
    const cacheDir = isThumb ? THUMB_CACHE : FULL_CACHE;
    const cachePath = path.join(cacheDir, `${photoId}.jpg`);

    // Check cache — only trust files with actual content
    if (fs.existsSync(cachePath)) {
        const stat = fs.statSync(cachePath);
        if (stat.size > 0) return cachePath;
        // Remove empty/corrupt cached file
        fs.unlinkSync(cachePath);
    }

    // Look up the photo
    const row = stmts.photoById.get({ id: photoId });
    if (!row) return null;

    const formatted = formatRow(row);
    const originalPath = resolveOriginalPath(formatted);
    if (!originalPath || !fs.existsSync(originalPath)) return null;

    // Write to temp file first, rename on success (prevents corrupt cache entries)
    const tmpPath = cachePath + '.tmp';

    // Limit concurrent image processing to prevent resource exhaustion
    await acquireSlot();
    try {
        // Try Sharp first (fast, handles JPEG/PNG/WebP/TIFF)
        try {
            await sharp(originalPath, { failOn: 'none' })
                .rotate()
                .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: isThumb ? 80 : 85 })
                .toFile(tmpPath);

            // Validate output before caching
            const tmpStat = fs.statSync(tmpPath);
            if (tmpStat.size === 0) {
                fs.unlinkSync(tmpPath);
                throw new Error('Sharp produced 0-byte output');
            }

            fs.renameSync(tmpPath, cachePath);
            return cachePath;
        } catch (sharpErr) {
            // Clean up partial Sharp output
            try { fs.unlinkSync(tmpPath); } catch (_) {}

            // Fallback to macOS sips (handles HEIC and other native formats)
            try {
                await sipsConvert(originalPath, tmpPath, maxSize);

                // Validate output before caching
                const tmpStat = fs.statSync(tmpPath);
                if (tmpStat.size === 0) {
                    fs.unlinkSync(tmpPath);
                    throw new Error('sips produced 0-byte output');
                }

                fs.renameSync(tmpPath, cachePath);
                return cachePath;
            } catch (sipsErr) {
                try { fs.unlinkSync(tmpPath); } catch (_) {}
                failedPhotos.add(photoId);
                const fname = formatted.filename || formatted.originalFilename || `ID ${photoId}`;
                console.warn(`Skipping ${fname}: Sharp: ${sharpErr.message} / sips: ${sipsErr.message}`);
                return null;
            }
        }
    } finally {
        releaseSlot();
    }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());

// Health check
app.get('/api/status', (req, res) => {
    try {
        const { count } = stmts.count.get();
        res.json({
            ok: true,
            photoCount: count,
            libraryPath: LIBRARY_PATH,
            skippedCount: failedPhotos.size
        });
    } catch (err) {
        res.status(503).json({
            ok: false,
            error: err.message,
            hint: err.message.includes('locked') ? 'Quit Photos.app and try again.' : undefined
        });
    }
});

// All metadata (for initial import) or incremental
app.get('/api/photos/metadata/all', (req, res) => {
    try {
        const after = req.query.after;
        let rows;
        if (after) {
            const afterCoreData = isoToCoreData(after);
            rows = stmts.metadataAfter.all({ afterCoreData });
        } else {
            rows = stmts.allMetadata.all();
        }
        const photos = rows.map(formatRow);
        // Strip internal fields before sending
        for (const p of photos) { delete p._directory; delete p._uti; }
        res.json(photos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Metadata for date range
app.get('/api/photos/metadata', (req, res) => {
    try {
        const { start, end } = req.query;
        if (!start || !end) {
            return res.status(400).json({ error: 'start and end query params required (YYYY-MM-DD)' });
        }
        const startCoreData = isoToCoreData(start + 'T00:00:00Z');
        const endCoreData = isoToCoreData(end + 'T23:59:59Z');
        const rows = stmts.metadataRange.all({ startCoreData, endCoreData });
        const photos = rows.map(formatRow);
        for (const p of photos) { delete p._directory; delete p._uti; }
        res.json(photos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Photo count
app.get('/api/photos/count', (req, res) => {
    try {
        const { count } = stmts.count.get();
        res.json({ count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reset failure cache — allows retrying previously failed photos
app.post('/api/reset-failures', (req, res) => {
    const count = failedPhotos.size;
    failedPhotos.clear();
    res.json({ cleared: count });
});

// Batch check which photo IDs have originals on disk (avoids thousands of individual 404s)
app.post('/api/photos/check-available', express.json({ limit: '5mb' }), (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'Expected { ids: number[] }' });

    const available = [];
    const unavailable = { noOriginal: 0, notFound: 0, alreadyCached: 0 };

    for (const id of ids) {
        // Already has a cached thumbnail? Definitely available
        const thumbPath = path.join(THUMB_CACHE, `${id}.jpg`);
        if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
            available.push(id);
            unavailable.alreadyCached++;
            continue;
        }

        // Look up in DB and check original file exists
        const row = stmts.photoById.get({ id });
        if (!row) {
            unavailable.notFound++;
            continue;
        }
        const formatted = formatRow(row);
        const originalPath = resolveOriginalPath(formatted);
        if (!originalPath || !fs.existsSync(originalPath)) {
            unavailable.noOriginal++;
            continue;
        }
        available.push(id);
    }

    res.json({ available, unavailable });
});

// Thumbnail (200px)
app.get('/api/thumbnail/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid photo ID' });

    const cachePath = await generateThumbnail(id, 200);
    if (!cachePath) return res.status(404).json({ error: 'Photo not found or unsupported format' });

    // Safety net: never serve empty files
    try {
        const stat = fs.statSync(cachePath);
        if (stat.size === 0) {
            try { fs.unlinkSync(cachePath); } catch (_) {}
            return res.status(404).json({ error: 'Generated thumbnail was empty' });
        }
    } catch (e) {
        return res.status(404).json({ error: 'Thumbnail file missing' });
    }

    res.set('Cache-Control', 'public, max-age=300');
    res.sendFile(cachePath);
});

// Full resolution (1600px max)
app.get('/api/full/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid photo ID' });

    const cachePath = await generateThumbnail(id, 1600);
    if (!cachePath) return res.status(404).json({ error: 'Photo not found or unsupported format' });

    // Safety net: never serve empty files
    try {
        const stat = fs.statSync(cachePath);
        if (stat.size === 0) {
            try { fs.unlinkSync(cachePath); } catch (_) {}
            return res.status(404).json({ error: 'Generated image was empty' });
        }
    } catch (e) {
        return res.status(404).json({ error: 'Image file missing' });
    }

    res.set('Cache-Control', 'public, max-age=300');
    res.sendFile(cachePath);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

openDatabase();
prepareStatements();

const { count } = stmts.count.get();
console.log(`Arc Photo Server`);
console.log(`Library: ${LIBRARY_PATH}`);
console.log(`Photos:  ${count.toLocaleString()}`);
console.log(`Cache:   ${CACHE_DIR}`);

app.listen(PORT, () => {
    console.log(`Server:  http://localhost:${PORT}`);
    console.log(`\nReady. Keep this running while using Arc Diary Reader.`);
});
