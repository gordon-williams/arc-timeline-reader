#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const express = require('express');
const cors = require('cors');
// better-sqlite3 is a native module compiled against a specific Node.js ABI.
// After a Node upgrade it fails to load (ERR_DLOPEN_FAILED / NODE_MODULE_VERSION
// mismatch) — rebuild it automatically instead of requiring a manual npm rebuild.
function requireBetterSqlite3() {
    try {
        return require('better-sqlite3');
    } catch (err) {
        const msg = String((err && err.message) || '');
        if (err.code !== 'ERR_DLOPEN_FAILED' && !msg.includes('NODE_MODULE_VERSION')) throw err;
        console.log(`better-sqlite3 was built for a different Node.js version — rebuilding for ${process.version} (takes a minute)...`);
        require('child_process').execSync('npm rebuild better-sqlite3', {
            cwd: __dirname, stdio: 'inherit', timeout: 300000
        });
        console.log('Rebuild complete.');
        return require('better-sqlite3');
    }
}
const Database = requireBetterSqlite3();
const sharp = require('sharp');

process.on('unhandledRejection', (reason) => {
    console.error('[fatal] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
    console.error('[fatal] uncaughtException:', err && err.stack ? err.stack : err);
});

process.on('exit', (code) => {
    console.error(`[process] exit code=${code}`);
});

process.on('SIGTERM', () => {
    console.error('[process] received SIGTERM');
});

process.on('SIGINT', () => {
    console.error('[process] received SIGINT');
});

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
const MASTERS_PATH = path.join(LIBRARY_PATH, 'Masters'); // legacy Photos/iPhoto libraries
const DERIVATIVES_PATH = path.join(LIBRARY_PATH, 'resources', 'derivatives');
const CACHE_DIR = path.join(__dirname, '.cache');
const THUMB_CACHE = path.join(CACHE_DIR, 'thumbnails');
const FULL_CACHE = path.join(CACHE_DIR, 'full');
const ICLOUD_CACHE = path.join(CACHE_DIR, 'icloud-videos');

// Swift PhotoKit helpers
const PHOTO_FETCH_DIR = path.join(__dirname, 'photo-fetch');
const PHOTO_FETCH_BIN = path.join(PHOTO_FETCH_DIR, 'photo-fetch');
const PHOTO_FETCH_SRC = path.join(PHOTO_FETCH_DIR, 'PhotoFetch.swift');
const PHOTO_FETCH_TIMEOUT = 120; // 2 minutes — derivative shown immediately, original swapped in when ready

// PhotoKit thumbnail helper — gets local cached thumbnail without iCloud download
const PHOTO_THUMB_BIN = path.join(PHOTO_FETCH_DIR, 'photo-thumb');
let photoThumbAvailable = false;

// In-flight iCloud download tracking: UUID → { progress, status, startTime, error, mediaType }
const activeFetches = new Map();
const MAX_CONCURRENT_ICLOUD = 2;
let activeICloudCount = 0;
let photoFetchAvailable = false;

// Failed iCloud fetch cooldown: UUID → timestamp when retry is allowed
const icloudFailCooldown = new Map();
const ICLOUD_FAIL_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes before retrying a failed fetch

// Ensure cache directories exist
fs.mkdirSync(THUMB_CACHE, { recursive: true });
fs.mkdirSync(FULL_CACHE, { recursive: true });
fs.mkdirSync(ICLOUD_CACHE, { recursive: true });

// Full cache version — bump to invalidate when output size/quality changes
const FULL_CACHE_VERSION = '4'; // v1=1600px/q85, v2=3200px/q90, v3=ImageIO via PhotoKit, v4=ImageIO --path for RAW
const versionFile = path.join(FULL_CACHE, '.cache-version');
try {
    const current = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : '';
    if (current !== FULL_CACHE_VERSION) {
        let cleared = 0;
        for (const file of fs.readdirSync(FULL_CACHE)) {
            if (file.startsWith('.')) continue;
            try { fs.unlinkSync(path.join(FULL_CACHE, file)); cleared++; } catch (_) {}
        }
        fs.writeFileSync(versionFile, FULL_CACHE_VERSION);
        if (cleared > 0) console.log(`Full cache cleared (${cleared} files) — version ${FULL_CACHE_VERSION} (3200px, quality 90)`);
    }
} catch (e) {
    console.warn('Failed to check full cache version:', e.message);
}

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
        ['ZKIND', 'kind'],
        ['ZDURATION', 'duration'],
        ['ZMODIFICATIONDATE', 'modDate'],
        ['ZUUID', 'uuid'],
    ].filter(([col]) => assetCols.has(col))
     .map(([col, alias]) => `z.${col} AS ${alias}`);

    const aCols = [
        ['ZORIGINALFILENAME', 'originalFilename'],
        ['ZCAMERAMAKE', 'cameraMake'],
        ['ZCAMERAMODEL', 'cameraModel'],
        ['ZTITLE', 'title'],
    ].filter(([col]) => attrCols.has(col))
     .map(([col, alias]) => `a.${col} AS ${alias}`);

    const needJoin = aCols.length > 0;
    const selectCols = [...zCols, ...aCols].join(',\n            ');
    const joinClause = needJoin ? 'LEFT JOIN ZADDITIONALASSETATTRIBUTES a ON a.ZASSET = z.Z_PK' : '';

    // Log discovered schema
    console.log(`Schema:  ZASSET has ${assetCols.size} columns, ZADDITIONALASSETATTRIBUTES has ${attrCols.size} columns`);
    if (!attrCols.has('ZCAMERAMAKE')) {
        // ZCAMERAMAKE may have been renamed in newer macOS versions — look for alternatives
        const cameraRelated = [...attrCols].filter(c => /camera|make|model|lens|device/i.test(c)).sort();
        console.log('  Note: ZCAMERAMAKE not found in ZADDITIONALASSETATTRIBUTES');
        console.log('  Camera-related columns found:', cameraRelated.length ? cameraRelated.join(', ') : 'none');
    }

    const BASE_SELECT = `
        SELECT
            ${selectCols}
        FROM ZASSET z
        ${joinClause}
        WHERE z.ZTRASHEDSTATE = 0
          AND z.ZHIDDEN = 0
          AND z.ZKIND IN (0, 1)
    `;

    stmts.count = db.prepare(`
        SELECT COUNT(*) AS count FROM ZASSET
        WHERE ZTRASHEDSTATE = 0 AND ZHIDDEN = 0 AND ZKIND IN (0, 1)
    `);

    stmts.countByType = db.prepare(`
        SELECT ZKIND AS kind, COUNT(*) AS count FROM ZASSET
        WHERE ZTRASHEDSTATE = 0 AND ZHIDDEN = 0 AND ZKIND IN (0, 1)
        GROUP BY ZKIND
    `);

    stmts.allMetadata = db.prepare(`${BASE_SELECT} ORDER BY z.ZDATECREATED`);

    // Incremental query: return items that are new, modified, or added since last import
    // ZMODIFICATIONDATE updates when a photo is edited (crop, adjust, etc.)
    // ZADDEDDATE catches photos saved to the library later than their capture date
    // (e.g. photos received via Messages/AirDrop) — without it they'd be skipped
    // when ZDATECREATED predates the last import.
    const afterConds = ['z.ZDATECREATED > :afterCoreData'];
    if (assetCols.has('ZMODIFICATIONDATE')) afterConds.push('z.ZMODIFICATIONDATE > :afterCoreData');
    if (assetCols.has('ZADDEDDATE')) afterConds.push('z.ZADDEDDATE > :afterCoreData');
    const afterClause = `AND (${afterConds.join(' OR ')})`;

    stmts.metadataAfter = db.prepare(`
        ${BASE_SELECT} ${afterClause} ORDER BY z.ZDATECREATED
    `);

    stmts.metadataRange = db.prepare(`
        ${BASE_SELECT} AND z.ZDATECREATED >= :startCoreData AND z.ZDATECREATED <= :endCoreData
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
        title: row.title || null,
        type: row.kind === 1 ? 'video' : 'photo',
        duration: row.duration || null,
        modDate: row.modDate || null,
        // Note: ZDIRECTORY can be numeric 0 (bucket "0") — `|| null` would drop it
        _directory: row.directory != null ? String(row.directory) : null,
        _uti: row.uti || null,
        _uuid: row.uuid || null
    };
}

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

// Library scopes — Messages "Shared with You" (syndication), shared albums, and
// iCloud Shared Library assets store their files under scopes/<name>/ mirroring
// the main library layout (originals/{dir}/{file}, resources/derivatives/...).
const SCOPES_PATH = path.join(LIBRARY_PATH, 'scopes');
const scopeRoots = []; // [{ name, originals }] — populated by discoverScopes()

function discoverScopes() {
    let entries;
    try { entries = fs.readdirSync(SCOPES_PATH, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const originals = path.join(SCOPES_PATH, entry.name, 'originals');
        if (fs.existsSync(originals)) scopeRoots.push({ name: entry.name, originals });
    }
    if (scopeRoots.length) {
        console.log(`Scopes:  ${scopeRoots.map(s => s.name).join(', ')}`);
    }
}

function resolveOriginalPath(row) {
    // Originals are stored at: originals/{ZDIRECTORY}/{ZFILENAME}
    if (row._directory == null || !row.filename) return null;
    const primary = path.join(ORIGINALS_PATH, row._directory, row.filename);
    if (fs.existsSync(primary)) return primary;

    // Scope-local originals (Shared with You, shared albums, shared library)
    for (const scope of scopeRoots) {
        const scoped = path.join(scope.originals, row._directory, row.filename);
        if (fs.existsSync(scoped)) return scoped;
    }

    // Legacy fallback: older/migrated libraries may still store assets under Masters/
    const legacy = path.join(MASTERS_PATH, row._directory, row.filename);
    if (fs.existsSync(legacy)) return legacy;

    // Return primary path for downstream logging/debug even when missing.
    return primary;
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

// Video file extensions (used to route to qlmanage instead of Sharp/sips)
const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v', '.avi', '.3gp']);

function isVideoFile(filePath) {
    return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// ---------------------------------------------------------------------------
// Derivative (proxy) image lookup — Apple Photos keeps local thumbnails even
// when originals are evicted to iCloud. Derivatives live in:
//   resources/derivatives/{0-9}/{UUID}_1_{size}_{suffix}.jpeg
//   resources/renders/{0-9}/{UUID}_1_{suffix}.jpeg (rendered thumbnails)
// We scan these directories once at startup and build a UUID→path map.
// ---------------------------------------------------------------------------

const derivativeMap = new Map(); // UUID (uppercase) → { thumb: path, large: path }

// Image extensions we can process (Sharp handles all of these)
const DERIVATIVE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.heic', '.png', '.tiff', '.tif', '.webp']);

function isImageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return DERIVATIVE_EXTENSIONS.has(ext);
}

function scanDerivativeDir(dirPath) {
    let totalFiles = 0;

    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch (_) { return 0; }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            // Recurse into subdirectories (some buckets have nested UUID folders)
            totalFiles += scanDerivativeDir(path.join(dirPath, entry.name));
            continue;
        }

        if (!isImageFile(entry.name)) continue;
        totalFiles++;

        // Extract UUID from filename: {UUID}_1_{suffix}.jpeg
        // UUID format: 8-4-4-4-12 hex chars = 36 chars
        const uuid = entry.name.substring(0, 36).toUpperCase();
        if (uuid.length !== 36 || uuid[8] !== '-') continue;

        const filePath = path.join(dirPath, entry.name);
        let mapEntry = derivativeMap.get(uuid);
        if (!mapEntry) {
            mapEntry = { thumb: null, large: null };
            derivativeMap.set(uuid, mapEntry);
        }

        // Prefer larger derivatives for better quality thumbnails
        // _105_c = mini thumbnail (~105px), _102_o = larger derivative
        // Pick the best available: large > thumb
        if (entry.name.includes('_102_o') || entry.name.includes('_201_o') || entry.name.includes('_100_o')) {
            mapEntry.large = filePath;
        } else if (!mapEntry.thumb) {
            mapEntry.thumb = filePath;
        }
    }

    return totalFiles;
}

function buildDerivativeMap() {
    const start = Date.now();
    let totalFiles = 0;

    // Scan derivatives/{0-9}/
    if (fs.existsSync(DERIVATIVES_PATH)) {
        for (let bucket = 0; bucket <= 9; bucket++) {
            totalFiles += scanDerivativeDir(path.join(DERIVATIVES_PATH, String(bucket)));
        }
    }

    // Also scan resources/renders/ (rendered thumbnails)
    const rendersPath = path.join(LIBRARY_PATH, 'resources', 'renders');
    if (fs.existsSync(rendersPath)) {
        const beforeRenders = derivativeMap.size;
        try {
            const renderEntries = fs.readdirSync(rendersPath, { withFileTypes: true });
            for (const entry of renderEntries) {
                if (entry.isDirectory()) {
                    totalFiles += scanDerivativeDir(path.join(rendersPath, entry.name));
                }
            }
        } catch (_) {}
        const rendersAdded = derivativeMap.size - beforeRenders;
        if (rendersAdded > 0) console.log(`  + ${rendersAdded.toLocaleString()} from renders/`);
    }

    // Scan resources/cpl/ — CloudPhoto Library thumbnails for iCloud-synced photos
    const cplPath = path.join(LIBRARY_PATH, 'resources', 'cpl');
    if (fs.existsSync(cplPath)) {
        const beforeCpl = derivativeMap.size;
        try {
            const cplEntries = fs.readdirSync(cplPath, { withFileTypes: true });
            for (const entry of cplEntries) {
                if (entry.isDirectory()) {
                    totalFiles += scanDerivativeDir(path.join(cplPath, entry.name));
                }
            }
        } catch (_) {}
        const cplAdded = derivativeMap.size - beforeCpl;
        if (cplAdded > 0) console.log(`  + ${cplAdded.toLocaleString()} from cpl/`);
    }

    // Scan resources/cloudsharing/ — shared iCloud photo thumbnails
    const cloudsharingPath = path.join(LIBRARY_PATH, 'resources', 'cloudsharing');
    if (fs.existsSync(cloudsharingPath)) {
        const beforeSharing = derivativeMap.size;
        try {
            const sharingEntries = fs.readdirSync(cloudsharingPath, { withFileTypes: true });
            for (const entry of sharingEntries) {
                if (entry.isDirectory()) {
                    totalFiles += scanDerivativeDir(path.join(cloudsharingPath, entry.name));
                }
            }
        } catch (_) {}
        const sharingAdded = derivativeMap.size - beforeSharing;
        if (sharingAdded > 0) console.log(`  + ${sharingAdded.toLocaleString()} from cloudsharing/`);
    }

    // Scan scope-local derivatives — scopes/<name>/resources/derivatives/
    // (Shared with You syndication assets keep their previews here)
    for (const scope of scopeRoots) {
        const scopeDerivs = path.join(SCOPES_PATH, scope.name, 'resources', 'derivatives');
        if (!fs.existsSync(scopeDerivs)) continue;
        const beforeScope = derivativeMap.size;
        totalFiles += scanDerivativeDir(scopeDerivs);
        const scopeAdded = derivativeMap.size - beforeScope;
        if (scopeAdded > 0) console.log(`  + ${scopeAdded.toLocaleString()} from scopes/${scope.name}/`);
    }

    if (totalFiles === 0) {
        console.log('Derivs:  none found — derivative fallback disabled');
    } else {
        console.log(`Derivs:  ${totalFiles.toLocaleString()} files, ${derivativeMap.size.toLocaleString()} unique assets (${Date.now() - start}ms)`);
    }
}

function resolveDerivativePath(formatted) {
    if (!formatted._uuid) return null;
    const uuid = formatted._uuid.toUpperCase();
    const entry = derivativeMap.get(uuid);
    if (!entry) return null;
    // Prefer larger derivative for better resize quality
    const derivPath = entry.large || entry.thumb;
    if (!derivPath || !fs.existsSync(derivPath)) return null;
    return derivPath;
}

// Use macOS qlmanage for video thumbnail generation (built-in, no install needed)
function qlmanageThumbnail(videoPath, outputPath, maxSize) {
    return new Promise((resolve, reject) => {
        const tmpDir = path.join(CACHE_DIR, 'ql-tmp');
        fs.mkdirSync(tmpDir, { recursive: true });

        execFile('qlmanage', ['-t', '-s', String(maxSize), '-o', tmpDir, videoPath],
            { timeout: 30000 }, async (err) => {
                if (err) return reject(err);

                // qlmanage outputs {filename}.png in the output directory
                const videoFileName = path.basename(videoPath);
                const qlOutput = path.join(tmpDir, videoFileName + '.png');

                if (!fs.existsSync(qlOutput)) {
                    return reject(new Error('qlmanage produced no output'));
                }

                try {
                    // Convert PNG to JPEG via Sharp (already a dependency)
                    const isThumb = maxSize <= 200;
                    await sharp(qlOutput)
                        .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: isThumb ? 80 : 90 })
                        .toFile(outputPath);

                    // Clean up qlmanage PNG
                    try { fs.unlinkSync(qlOutput); } catch (_) {}

                    // Validate output
                    const stat = fs.statSync(outputPath);
                    if (stat.size === 0) {
                        fs.unlinkSync(outputPath);
                        return reject(new Error('qlmanage→Sharp produced 0-byte output'));
                    }

                    resolve(outputPath);
                } catch (sharpErr) {
                    try { fs.unlinkSync(qlOutput); } catch (_) {}
                    reject(sharpErr);
                }
            });
    });
}

// Use ffmpeg as fallback for video thumbnails (requires Homebrew ffmpeg)
let ffmpegPath = null;
try {
    const { execSync } = require('child_process');
    ffmpegPath = execSync('which ffmpeg 2>/dev/null').toString().trim() || null;
} catch (_) {}

function ffmpegThumbnail(videoPath, outputPath, maxSize) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) return reject(new Error('ffmpeg not installed'));
        // Extract frame at 1 second, scale to fit maxSize, force JPEG output
        // -f image2 ensures JPEG output regardless of file extension (.tmp)
        execFile(ffmpegPath, [
            '-y',
            '-ss', '1',                // seek before input (fast)
            '-i', videoPath,
            '-frames:v', '1',
            '-vf', `scale=${maxSize}:${maxSize}:force_original_aspect_ratio=decrease`,
            '-f', 'image2',             // force image output
            '-update', '1',             // single image mode
            '-c:v', 'mjpeg',            // JPEG codec
            '-q:v', '3',               // quality (2-5 good range)
            outputPath
        ], { timeout: 30000 }, (err) => {
            if (err) return reject(err);
            if (!fs.existsSync(outputPath)) return reject(new Error('ffmpeg produced no output'));
            const stat = fs.statSync(outputPath);
            if (stat.size === 0) {
                fs.unlinkSync(outputPath);
                return reject(new Error('ffmpeg produced 0-byte output'));
            }
            resolve(outputPath);
        });
    });
}

// Use macOS sips as fallback for HEIC and other formats Sharp can't handle
function sipsConvert(inputPath, outputPath, maxSize, quality = 85) {
    return new Promise((resolve, reject) => {
        // sips: resize to fit within maxSize, convert to JPEG
        execFile('sips', [
            '-s', 'format', 'jpeg',
            '-s', 'formatOptions', String(quality),
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

async function generateThumbnail(photoId, maxSize, { forceRerender = false } = {}) {
    // Skip photos that permanently failed (unless force re-rendering)
    if (failedPhotos.has(photoId) && !forceRerender) return null;
    if (forceRerender) failedPhotos.delete(photoId);

    const isThumb = maxSize <= 200;
    const cacheDir = isThumb ? THUMB_CACHE : FULL_CACHE;
    const cachePath = path.join(cacheDir, `${photoId}.jpg`);

    // Look up the photo first — needed for cache staleness check
    const row = stmts.photoById.get({ id: photoId });
    if (!row) return null;

    const formatted = formatRow(row);

    // Check cache — only trust files with actual content that aren't stale
    if (forceRerender && fs.existsSync(cachePath)) {
        try { fs.unlinkSync(cachePath); } catch (_) {}
    }
    if (fs.existsSync(cachePath)) {
        const stat = fs.statSync(cachePath);
        if (stat.size > 0) {
            // If the item has a modification date, check if cache is stale
            if (formatted.modDate) {
                const modTimeMs = (formatted.modDate + CORE_DATA_EPOCH) * 1000;
                if (modTimeMs > stat.mtimeMs) {
                    // Original was modified after cache was written — regenerate
                    fs.unlinkSync(cachePath);
                } else {
                    return cachePath;
                }
            } else {
                return cachePath;
            }
        } else {
            // Remove empty/corrupt cached file
            fs.unlinkSync(cachePath);
        }
    }

    const originalPath = resolveOriginalPath(formatted);
    const hasOriginal = originalPath && fs.existsSync(originalPath);

    // No original? Try derivative (Apple Photos proxy image), then PhotoKit thumbnail
    if (!hasOriginal) {
        const derivPath = resolveDerivativePath(formatted);
        if (derivPath) {
            // Derivative may be JPEG or HEIC — try Sharp first, then sips.
            // Prebuilt Sharp/libvips cannot decode HEIC (only AVIF), so HEIC
            // derivatives need the sips fallback via macOS ImageIO.
            const tmpPath = cachePath + '.tmp';
            await acquireSlot();
            try {
                await sharp(derivPath, { failOn: 'none' })
                    .rotate()
                    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: isThumb ? 80 : 90 })
                    .toFile(tmpPath);

                const tmpStat = fs.statSync(tmpPath);
                if (tmpStat.size > 0) {
                    fs.renameSync(tmpPath, cachePath);
                    return cachePath;
                }
                try { fs.unlinkSync(tmpPath); } catch (_) {}
            } catch (err) {
                try { fs.unlinkSync(tmpPath); } catch (_) {}
                // Fall through to sips (HEIC), then PhotoKit / iCloud cache
            } finally {
                releaseSlot();
            }

            // sips fallback for formats Sharp can't decode (HEIC derivatives)
            await acquireSlot();
            try {
                await sipsConvert(derivPath, tmpPath, maxSize, isThumb ? 80 : 90);
                const tmpStat = fs.statSync(tmpPath);
                if (tmpStat.size > 0) {
                    fs.renameSync(tmpPath, cachePath);
                    const fname = formatted.originalFilename || formatted.filename || `ID ${photoId}`;
                    console.log(`[render] ${fname}: derivative via sips fallback (${maxSize}px)`);
                    return cachePath;
                }
                try { fs.unlinkSync(tmpPath); } catch (_) {}
            } catch (_) {
                try { fs.unlinkSync(tmpPath); } catch (_e) {}
                // Fall through to other fallbacks (PhotoKit, iCloud cache)
            } finally {
                releaseSlot();
            }
        }

        // No derivative either — use PhotoKit to get a local cached thumbnail
        if (photoThumbAvailable && formatted._uuid) {
            const tmpPath = cachePath + '.tmp';
            try {
                await new Promise((resolve, reject) => {
                    execFile(PHOTO_THUMB_BIN, [
                        formatted._uuid,
                        tmpPath,
                        '--size', String(maxSize)
                    ], { timeout: 10000 }, (err, stdout, stderr) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 0) {
                    fs.renameSync(tmpPath, cachePath);
                    return cachePath;
                }
            } catch (_) {
                try { fs.unlinkSync(tmpPath); } catch (_e) {}
            }
        }

        // Last resort: check full-res cache and iCloud cache for a previously
        // downloaded image that can be downscaled for the thumbnail
        const fallbackPaths = [
            path.join(FULL_CACHE, `${photoId}.jpg`),
        ];
        if (formatted._uuid) {
            fallbackPaths.push(path.join(ICLOUD_CACHE, `${formatted._uuid.toUpperCase()}.jpg`));
        }
        // Also try the filename-based UUID (ZFILENAME without extension)
        if (formatted.filename) {
            const fnameUuid = path.basename(formatted.filename, path.extname(formatted.filename)).toUpperCase();
            const fnPath = path.join(ICLOUD_CACHE, `${fnameUuid}.jpg`);
            if (!fallbackPaths.includes(fnPath)) {
                fallbackPaths.push(fnPath);
            }
        }
        for (const fallbackPath of fallbackPaths) {
            if (!fs.existsSync(fallbackPath)) continue;
            try {
                const fbStat = fs.statSync(fallbackPath);
                if (fbStat.size === 0) continue;
                const tmpPath = cachePath + '.tmp';
                await acquireSlot();
                try {
                    await sharp(fallbackPath, { failOn: 'none' })
                        .rotate()
                        .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: isThumb ? 80 : 90 })
                        .toFile(tmpPath);
                    const tmpStat = fs.statSync(tmpPath);
                    if (tmpStat.size > 0) {
                        fs.renameSync(tmpPath, cachePath);
                        return cachePath;
                    }
                    try { fs.unlinkSync(tmpPath); } catch (_) {}
                } catch (_) {
                    try { fs.unlinkSync(tmpPath); } catch (_e) {}
                } finally {
                    releaseSlot();
                }
            } catch (_) {}
        }

        // Everything failed — log why so missing thumbnails are diagnosable
        const fname = formatted.originalFilename || formatted.filename || `ID ${photoId}`;
        console.warn(`[thumbnail] ${fname} (id ${photoId}): no original on disk, derivative=${derivPath ? 'render failed' : 'none'}, PhotoKit=${photoThumbAvailable && formatted._uuid ? 'no result' : 'unavailable'} — returning empty`);
        return null;
    }

    // Write to temp file first, rename on success (prevents corrupt cache entries)
    const tmpPath = cachePath + '.tmp';

    // For full-res RAW files with original on disk, render directly via ImageIO (--path mode)
    // This bypasses PhotoKit which returns a pre-rendered JPEG for edited DNG/CR2 files.
    // ImageIO applies proper camera colour profiles, tone curves, and demosaicing.
    const origExt0 = originalPath ? path.extname(originalPath).slice(1).toLowerCase() : '';
    const RAW_EXTS_SET = new Set(['cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2', 'pef', 'srw', 'dng', 'raw', '3fr', 'mos', 'mrw', 'x3f', 'iiq']);
    if (!isThumb && photoThumbAvailable && hasOriginal && RAW_EXTS_SET.has(origExt0)) {
        const fname = formatted.originalFilename || formatted.filename || `ID ${photoId}`;
        try {
            await new Promise((resolve, reject) => {
                execFile(PHOTO_THUMB_BIN, [
                    '--path', originalPath, tmpPath,
                    '--size', String(maxSize)
                ], { timeout: 30000 }, (err, stdout, stderr) => {
                    if (stderr) {
                        for (const line of stderr.split('\n').filter(l => l.trim())) {
                            console.log(`[render] ${fname}: ${line}`);
                        }
                    }
                    if (err) reject(err);
                    else resolve();
                });
            });
            if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 0) {
                console.log(`[render] ${fname}: ImageIO --path (${maxSize}px, .${origExt0})`);
                fs.renameSync(tmpPath, cachePath);
                return cachePath;
            }
            console.log(`[render] ${fname}: ImageIO --path produced no output, falling back`);
        } catch (pathErr) {
            try { fs.unlinkSync(tmpPath); } catch (_e) {}
            console.log(`[render] ${fname}: ImageIO --path failed: ${pathErr.message}, falling back`);
        }
    }

    // For full-res photos, prefer PhotoKit rendering (best HEIC quality via Core Image)
    if (!isThumb && photoThumbAvailable && formatted._uuid) {
        const fname = formatted.originalFilename || formatted.filename || `ID ${photoId}`;
        try {
            await new Promise((resolve, reject) => {
                execFile(PHOTO_THUMB_BIN, [
                    formatted._uuid,
                    tmpPath,
                    '--size', String(maxSize),
                    '--hq'
                ], { timeout: 30000 }, (err, stdout, stderr) => {
                    if (stderr) {
                        // Log diagnostic info from photo-thumb
                        for (const line of stderr.split('\n').filter(l => l.trim())) {
                            console.log(`[render] ${fname}: ${line}`);
                        }
                    }
                    if (err) reject(err);
                    else resolve();
                });
            });
            if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 0) {
                console.log(`[render] ${fname}: PhotoKit/ImageIO --hq (${maxSize}px)`);
                fs.renameSync(tmpPath, cachePath);
                return cachePath;
            }
            console.log(`[render] ${fname}: PhotoKit --hq produced no output, falling back`);
        } catch (photoKitErr) {
            try { fs.unlinkSync(tmpPath); } catch (_e) {}
            console.log(`[render] ${fname}: PhotoKit --hq failed: ${photoKitErr.message}, falling back`);
            // Fall through to Sharp/sips
        }
    }

    // Limit concurrent image processing to prevent resource exhaustion
    await acquireSlot();
    try {
        // Route videos to qlmanage first, ffmpeg as fallback
        if (isVideoFile(originalPath)) {
            const fname = formatted.filename || formatted.originalFilename || `ID ${photoId}`;
            // Try qlmanage (built-in, no install needed)
            try {
                await qlmanageThumbnail(originalPath, tmpPath, maxSize);
                fs.renameSync(tmpPath, cachePath);
                return cachePath;
            } catch (qlErr) {
                try { fs.unlinkSync(tmpPath); } catch (_) {}
            }
            // Fallback to ffmpeg (Homebrew)
            try {
                await ffmpegThumbnail(originalPath, tmpPath, maxSize);
                fs.renameSync(tmpPath, cachePath);
                return cachePath;
            } catch (ffErr) {
                try { fs.unlinkSync(tmpPath); } catch (_) {}
                failedPhotos.add(photoId);
                console.warn(`Skipping video ${fname}: qlmanage + ffmpeg both failed`);
                return null;
            }
        }

        // Skip Sharp for RAW formats — it produces washed-out images without colour
        // profiles or tone curves. Let sips/PhotoKit handle these via Core Image.
        const RAW_EXTS = new Set(['cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2', 'pef', 'srw', 'dng', 'raw', '3fr', 'mos', 'mrw', 'x3f', 'iiq']);
        const origExt = path.extname(originalPath).slice(1).toLowerCase();
        const isRawFile = RAW_EXTS.has(origExt);

        if (isRawFile) {
            const fname = formatted.originalFilename || formatted.filename || `ID ${photoId}`;
            console.log(`[render] ${fname}: RAW format (.${origExt}) — skipping Sharp, using sips`);
        }

        // Try Sharp first (fast, handles JPEG/PNG/WebP/TIFF — NOT raw formats)
        let sharpFailed = isRawFile; // skip Sharp entirely for RAW
        if (!isRawFile) {
            try {
                await sharp(originalPath, { failOn: 'none' })
                    .rotate()
                    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: isThumb ? 80 : 90 })
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
                try { fs.unlinkSync(tmpPath); } catch (_) {}
                sharpFailed = sharpErr.message;
            }
        }

        // Fallback to macOS sips (handles HEIC, RAW, and other native formats via ImageIO)
        try {
            await sipsConvert(originalPath, tmpPath, maxSize, isThumb ? 80 : 90);

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
            console.warn(`Skipping ${fname}: ${isRawFile ? 'RAW (Sharp skipped)' : 'Sharp: ' + sharpFailed} / sips: ${sipsErr.message}`);
            return null;
        }
    } finally {
        releaseSlot();
    }
}

// ---------------------------------------------------------------------------
// iCloud media fetch via Swift PhotoKit helper
// ---------------------------------------------------------------------------

const { execSync } = require('child_process');

function ensurePhotoFetch() {
    if (!fs.existsSync(PHOTO_FETCH_SRC)) {
        console.log('photo-fetch: Swift source not found — iCloud video fetch disabled');
        return false;
    }

    // Check if binary exists and is newer than source
    if (fs.existsSync(PHOTO_FETCH_BIN)) {
        try {
            const srcStat = fs.statSync(PHOTO_FETCH_SRC);
            const binStat = fs.statSync(PHOTO_FETCH_BIN);
            if (binStat.mtimeMs > srcStat.mtimeMs) {
                return true; // binary up to date
            }
        } catch (_) {}
    }

    // Compile
    console.log('photo-fetch: compiling Swift tool...');
    try {
        execSync(
            `swiftc -O -o "${PHOTO_FETCH_BIN}" "${PHOTO_FETCH_SRC}" -framework Photos -framework AVFoundation -framework AppKit 2>&1`,
            { timeout: 120000, stdio: 'pipe' }
        );
        console.log('photo-fetch: compiled successfully');
        return true;
    } catch (err) {
        const stderr = err.stdout ? err.stdout.toString().substring(0, 500) : err.message;
        console.error(`photo-fetch: compilation failed — ${stderr}`);
        return false;
    }
}

function fetchFromICloud(uuid, outputPath, fetchState) {
    return new Promise((resolve, reject) => {
        const tmpPath = outputPath + '.downloading';
        let settled = false;
        let doneAt = 0;

        const finishOk = () => {
            if (settled) return;
            settled = true;
            clearInterval(watchdog);
            resolve({ success: true, path: outputPath });
        };

        const finishErr = (err) => {
            if (settled) return;
            settled = true;
            clearInterval(watchdog);
            reject(err instanceof Error ? err : new Error(String(err)));
        };

        const tryPromoteTmp = () => {
            try {
                if (fs.existsSync(outputPath)) {
                    const outStat = fs.statSync(outputPath);
                    if (outStat.size > 0) return true;
                }
            } catch (_) {}
            try {
                if (!fs.existsSync(tmpPath)) return false;
                const stat = fs.statSync(tmpPath);
                if (stat.size <= 0) return false;
                fs.renameSync(tmpPath, outputPath);
                return true;
            } catch (_) {
                return false;
            }
        };

        const proc = execFile(
            PHOTO_FETCH_BIN,
            [uuid, tmpPath, '--timeout', String(PHOTO_FETCH_TIMEOUT)],
            { timeout: (PHOTO_FETCH_TIMEOUT + 30) * 1000 }
        );

        // If helper reports DONE but process doesn't exit cleanly, finalize from temp cache.
        const watchdog = setInterval(() => {
            if (settled) return;
            const status = fetchState.status || '';
            if ((status === 'done' || status === 'ready') && doneAt === 0) {
                doneAt = Date.now();
            }
            if (doneAt > 0 && Date.now() - doneAt > 5000) {
                if (tryPromoteTmp()) {
                    try { proc.kill('SIGTERM'); } catch (_) {}
                    finishOk();
                }
            }
        }, 1000);

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('PROGRESS:')) {
                    fetchState.progress = parseFloat(line.substring(9)) || 0;
                    fetchState.status = 'downloading';
                } else if (line.startsWith('STATUS:')) {
                    fetchState.status = line.substring(7).toLowerCase();
                    if (fetchState.status === 'done') {
                        fetchState.progress = 1.0;
                        doneAt = Date.now();
                        if (tryPromoteTmp()) {
                            try { proc.kill('SIGTERM'); } catch (_) {}
                            finishOk();
                            return;
                        }
                    }
                } else if (line.startsWith('ERROR:')) {
                    fetchState.error = line.substring(6);
                }
            }
        });

        proc.stderr.on('data', (data) => {
            // Capture stderr for debugging but don't treat as fatal
            const msg = data.toString().trim();
            if (msg) console.error(`photo-fetch stderr: ${msg}`);
        });

        proc.on('close', (code) => {
            if (settled) return;
            if (code === 0) {
                if (tryPromoteTmp()) {
                    finishOk();
                    return;
                }
                finishErr(new Error('Downloaded file missing or empty'));
                return;
            }
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            const errorMsg = fetchState.error || `photo-fetch exited with code ${code}`;
            finishErr(new Error(errorMsg));
        });

        proc.on('error', (err) => {
            if (settled) return;
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            finishErr(err);
        });
    });
}

function promoteTmpIfComplete(outputPath) {
    const tmpPath = outputPath + '.downloading';
    try {
        if (!fs.existsSync(tmpPath)) return false;
        const stat = fs.statSync(tmpPath);
        if (!stat || stat.size <= 0) return false;
        fs.renameSync(tmpPath, outputPath);
        return true;
    } catch (_) {
        return false;
    }
}

// Stream a video file with Range support (reusable for originals and iCloud cache)
function serveVideoFile(videoPath, req, res) {
    const stat = fs.statSync(videoPath);
    const ext = path.extname(videoPath).toLowerCase();
    const contentType = ext === '.mov' ? 'video/mp4' : (VIDEO_CONTENT_TYPES[ext] || 'video/mp4');

    res.set('Cache-Control', 'public, max-age=300');
    res.set('Accept-Ranges', 'bytes');
    res.set('Content-Disposition', 'inline');

    const range = req.headers.range;
    if (range) {
        const rangeMatch = range.match(/^bytes=(\d+)-(\d*)$/);
        if (!rangeMatch) {
            return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
        }
        const start = parseInt(rangeMatch[1], 10);
        const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : stat.size - 1;

        if (start < 0 || start >= stat.size || end >= stat.size || start > end) {
            return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
        }

        const chunkSize = end - start + 1;

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Content-Length': chunkSize,
            'Content-Type': contentType,
        });
        fs.createReadStream(videoPath, { start, end }).pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': contentType,
        });
        fs.createReadStream(videoPath).pipe(res);
    }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(cors({
    origin: (origin, cb) => {
        // Allow browser file:// pages (origin is null) and local dev hosts.
        if (!origin || origin === 'null') return cb(null, true);
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
        // Allow the published GitHub Pages build.
        if (origin === 'https://gordon-williams.github.io') return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    },
    exposedHeaders: ['X-Full-Res']
}));

// ---------------------------------------------------------------------------
//  REST API — see API.md for the full endpoint and response schema reference
// ---------------------------------------------------------------------------

// Health check
app.get('/api/status', (req, res) => {
    try {
        const { count } = stmts.count.get();
        res.json({
            ok: true,
            photoCount: count,
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

// Diagnostic: library directory structure and derivative coverage
app.get('/api/library-dirs', (req, res) => {
    const resourcesPath = path.join(LIBRARY_PATH, 'resources');
    const dirs = {};

    // List top-level library contents
    try {
        dirs.topLevel = fs.readdirSync(LIBRARY_PATH).map(name => {
            const full = path.join(LIBRARY_PATH, name);
            try {
                const s = fs.statSync(full);
                return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.isDirectory() ? undefined : s.size };
            } catch (_) { return { name, type: 'inaccessible' }; }
        });
    } catch (e) { dirs.topLevel = { error: e.message }; }

    // List resources/ subdirectories with file counts
    try {
        dirs.resources = fs.readdirSync(resourcesPath).map(name => {
            const full = path.join(resourcesPath, name);
            try {
                const s = fs.statSync(full);
                if (!s.isDirectory()) return { name, type: 'file', size: s.size };
                // Count files in first two levels
                let fileCount = 0;
                try {
                    for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
                        if (sub.isFile()) fileCount++;
                        else if (sub.isDirectory()) {
                            try {
                                fileCount += fs.readdirSync(path.join(full, sub.name)).length;
                            } catch (_) {}
                        }
                    }
                } catch (_) {}
                return { name, type: 'dir', approxFiles: fileCount };
            } catch (_) { return { name, type: 'inaccessible' }; }
        });
    } catch (e) { dirs.resources = { error: e.message }; }

    // Derivative map stats
    dirs.derivativeMap = {
        totalUUIDs: derivativeMap.size,
        withLarge: [...derivativeMap.values()].filter(v => v.large).length,
        withThumbOnly: [...derivativeMap.values()].filter(v => v.thumb && !v.large).length,
    };

    // Total photos in DB vs derivatives available
    try {
        const { count } = stmts.count.get();
        dirs.dbPhotoCount = count;
        dirs.derivativeCoverage = `${derivativeMap.size}/${count} (${(derivativeMap.size / count * 100).toFixed(1)}%)`;
    } catch (_) {}

    // Check for iCloud-related columns in ZASSET
    try {
        const assetCols = db.pragma('table_info(ZASSET)').map(c => c.name);
        dirs.icloudColumns = assetCols.filter(c =>
            /cloud|local|thumb|miniature|placeholder|synced/i.test(c)
        ).sort();
    } catch (_) {}

    // Count originals that exist vs iCloud stubs (.icloud files)
    try {
        let origCount = 0, stubCount = 0, missingDirs = 0;
        if (fs.existsSync(ORIGINALS_PATH)) {
            for (const dirEntry of fs.readdirSync(ORIGINALS_PATH, { withFileTypes: true })) {
                if (!dirEntry.isDirectory()) continue;
                const dirPath = path.join(ORIGINALS_PATH, dirEntry.name);
                try {
                    for (const f of fs.readdirSync(dirPath)) {
                        if (f.startsWith('.') && f.endsWith('.icloud')) stubCount++;
                        else origCount++;
                    }
                } catch (_) { missingDirs++; }
            }
        }
        dirs.originals = { localFiles: origCount, icloudStubs: stubCount, inaccessibleDirs: missingDirs };
    } catch (e) { dirs.originals = { error: e.message }; }

    res.json(dirs);
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
        for (const p of photos) { delete p._directory; delete p._uti; delete p._uuid; delete p.modDate; }
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
        // Use local time (no Z suffix) so range boundaries match dayKeyFromISO,
        // which assigns photos to days using local time
        const startCoreData = isoToCoreData(start + 'T00:00:00');
        const endCoreData = isoToCoreData(end + 'T23:59:59.999');
        const rows = stmts.metadataRange.all({ startCoreData, endCoreData });
        const photos = rows.map(formatRow);
        for (const p of photos) { delete p._directory; delete p._uti; delete p._uuid; delete p.modDate; }
        res.json(photos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Photo count (with type breakdown)
app.get('/api/photos/count', (req, res) => {
    try {
        const { count } = stmts.count.get();
        const byType = stmts.countByType.all();
        const photos = byType.find(r => r.kind === 0)?.count || 0;
        const videos = byType.find(r => r.kind === 1)?.count || 0;
        res.json({ count, photos, videos });
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
    const unavailableByType = {};
    const unavailableByUti = {};
    const unavailableSample = [];
    const SAMPLE_LIMIT = 20;
    const TOP_UTI_LIMIT = 20;

    function incCounter(obj, key) {
        const k = key || 'unknown';
        obj[k] = (obj[k] || 0) + 1;
    }

    function pushUnavailableSample(id, reason, formatted = null) {
        if (unavailableSample.length >= SAMPLE_LIMIT) return;
        unavailableSample.push({
            id,
            reason,
            date: formatted?.date || null,
            filename: formatted?.filename || null,
            originalFilename: formatted?.originalFilename || null,
            type: formatted?.type || null,
            uti: formatted?._uti || null,
            uuid: formatted?._uuid || null,
            hasDerivative: formatted?._uuid ? derivativeMap.has(formatted._uuid.toUpperCase()) : false
        });
    }

    for (const id of ids) {
        // Validate ID is a positive integer to prevent path traversal
        if (!Number.isInteger(id) || id <= 0) {
            pushUnavailableSample(id, 'invalidId');
            continue;
        }

        // Already has a cached thumbnail? Definitely available
        const thumbPath = path.join(THUMB_CACHE, `${id}.jpg`);
        if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
            available.push(id);
            unavailable.alreadyCached++;
            continue;
        }

        // Look up in DB and check original or derivative file exists
        const row = stmts.photoById.get({ id });
        if (!row) {
            unavailable.notFound++;
            pushUnavailableSample(id, 'notFound');
            continue;
        }
        const formatted = formatRow(row);
        const originalPath = resolveOriginalPath(formatted);
        if (originalPath && fs.existsSync(originalPath)) {
            available.push(id);
            continue;
        }
        // No original — check if a derivative exists
        const derivPath = resolveDerivativePath(formatted);
        if (derivPath) {
            available.push(id);
            continue;
        }
        // No derivative — if photo-thumb is available, PhotoKit can likely provide a thumbnail
        if (photoThumbAvailable && formatted._uuid) {
            available.push(id);
            continue;
        }
        unavailable.noOriginal++;
        incCounter(unavailableByType, formatted.type || 'unknown');
        incCounter(unavailableByUti, formatted._uti || 'unknown');
        pushUnavailableSample(id, 'noOriginal', formatted);
    }

    const unavailableByUtiTop = Object.entries(unavailableByUti)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_UTI_LIMIT)
        .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

    // Log unavailable photos to server console with filenames
    if (unavailable.noOriginal > 0) {
        console.log(`\n[check-available] ${available.length} available, ${unavailable.noOriginal} unavailable:`);
        for (const s of unavailableSample) {
            const name = s.originalFilename || s.filename || `ID ${s.id}`;
            console.log(`  ✗ ${name} (${s.uti || s.type || '?'}) — ${s.reason}`);
        }
        if (unavailable.noOriginal > unavailableSample.length) {
            console.log(`  ... and ${unavailable.noOriginal - unavailableSample.length} more`);
        }
    }

    res.json({
        available,
        unavailable,
        unavailableByType,
        unavailableByUtiTop,
        unavailableSample
    });
});

// Single photo metadata by ID
app.get('/api/photos/info/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid photo ID' });
    try {
        // Diagnostic mode: return every raw ZASSET column (localhost-only server,
        // used to debug assets that PhotoKit can't resolve)
        if (req.query.raw) {
            const asset = db.prepare('SELECT * FROM ZASSET WHERE Z_PK = ?').get(id);
            if (!asset) return res.status(404).json({ error: 'Photo not found' });
            // Strip null columns and blobs to keep output readable
            const compact = {};
            for (const [k, v] of Object.entries(asset)) {
                if (v == null || Buffer.isBuffer(v)) continue;
                compact[k] = v;
            }
            return res.json(compact);
        }
        const row = stmts.photoById.get({ id });
        if (!row) return res.status(404).json({ error: 'Photo not found' });
        const photo = formatRow(row);
        delete photo._directory; delete photo._uti; delete photo._uuid; delete photo.modDate;
        res.json(photo);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Thumbnail (200px)
app.get('/api/thumbnail/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid photo ID' });

        const cachePath = await generateThumbnail(id, 200);
        // Return 204 instead of 404 to avoid noisy browser console "Failed to load resource"
        // spam during bulk imports where missing originals are expected.
        if (!cachePath) return res.status(204).end();

        // Safety net: never serve empty files
        try {
            const stat = fs.statSync(cachePath);
            if (stat.size === 0) {
                try { fs.unlinkSync(cachePath); } catch (_) {}
                return res.status(204).end();
            }
        } catch (e) {
            return res.status(204).end();
        }

        res.set('Cache-Control', 'public, max-age=300');
        res.sendFile(cachePath);
    } catch (err) {
        console.error(`[thumbnail] unhandled error: ${err?.stack || err}`);
        if (!res.headersSent) res.status(500).json({ error: 'Thumbnail generation failed' });
    }
});

// Content-type mapping for video files
const VIDEO_CONTENT_TYPES = {
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.avi': 'video/x-msvideo',
    '.3gp': 'video/3gpp',
};

// Full resolution (1600px max for photos, or stream original for videos)
app.get('/api/full/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid photo ID' });

        // Look up the media item
        const row = stmts.photoById.get({ id });
        if (!row) return res.status(404).json({ error: 'Media not found' });

        const formatted = formatRow(row);
        const originalPath = resolveOriginalPath(formatted);
        const hasOriginal = originalPath && fs.existsSync(originalPath);
        const fname = formatted.originalFilename || formatted.filename || `ID ${id}`;

        if (req.query.rerender) {
            console.log(`[full] ${fname}: rerender requested — hasOriginal=${hasOriginal}, path=${originalPath || 'null'}`);
        }

        if (!hasOriginal) {
        // No original on disk. Strategy:
        //   Photos: serve derivative immediately + start iCloud fetch in background.
        //           Response header X-Full-Res tells the viewer to poll for the original.
        //   Videos: return 202 and let the viewer show the iCloud download overlay.
        //   ?poster=1: serve derivative only (no iCloud fetch).

        // Try iCloud fetch when UUID is available
        if (photoFetchAvailable && formatted._uuid && !req.query.poster) {
            const uuid = formatted._uuid.toUpperCase();
            const isVideo = formatted.type === 'video';
            const cacheExt = isVideo ? '.mov' : '.jpg';
            const cachedMediaPath = path.join(ICLOUD_CACHE, `${uuid}${cacheExt}`);

            // Already cached from previous iCloud fetch?
            if (fs.existsSync(cachedMediaPath)) {
                try {
                    const stat = fs.statSync(cachedMediaPath);
                    if (stat.size > 0) {
                        if (isVideo) return serveVideoFile(cachedMediaPath, req, res);
                        res.set('Cache-Control', 'public, max-age=300');
                        return res.sendFile(cachedMediaPath);
                    }
                    // Corrupt cache — remove and re-fetch
                    fs.unlinkSync(cachedMediaPath);
                } catch (_) {}
            }

            // Check if fetch is already in progress for this UUID
            if (activeFetches.has(uuid)) {
                const state = activeFetches.get(uuid);
                // Recovery path: helper may have written a complete temp file but not exited yet.
                if ((state.status === 'done' || state.status === 'ready' || (state.progress || 0) >= 1)) {
                    if (promoteTmpIfComplete(cachedMediaPath) || fs.existsSync(cachedMediaPath)) {
                        try {
                            const stat = fs.statSync(cachedMediaPath);
                            if (stat.size > 0) {
                                if (isVideo) return serveVideoFile(cachedMediaPath, req, res);
                                res.set('Cache-Control', 'public, max-age=300');
                                return res.sendFile(cachedMediaPath);
                            }
                        } catch (_) {}
                    }
                }
                // Videos: 202 so viewer shows download overlay
                if (isVideo) {
                    return res.status(202).json({
                        status: state.status || 'downloading',
                        progress: state.progress || 0,
                        message: 'Video is being downloaded from iCloud'
                    });
                }
                // Photos: serve derivative with X-Full-Res so viewer shows image + polls
                const inProgressPoster = await generateThumbnail(id, 2400);
                if (inProgressPoster) {
                    res.set('Cache-Control', 'no-cache');
                    res.set('X-Full-Res', 'downloading');
                    return res.sendFile(inProgressPoster);
                }
                // No derivative — fall back to 202
                return res.status(202).json({
                    status: state.status || 'downloading',
                    progress: state.progress || 0,
                    message: 'Photo is being downloaded from iCloud'
                });
            }

            // Cooldown check — don't retry recently failed fetches
            const cooldownUntil = icloudFailCooldown.get(uuid);
            if (cooldownUntil) {
                if (Date.now() < cooldownUntil) {
                    // Re-check: macOS Photos may have completed the iCloud download in the background
                    // (PhotoKit triggers the download, and macOS continues even after photo-fetch times out)
                    const recheck = resolveOriginalPath(formatted);
                    if (recheck && fs.existsSync(recheck)) {
                        icloudFailCooldown.delete(uuid);
                        console.log(`iCloud: original appeared during cooldown for ${formatted.originalFilename || uuid}`);
                        res.set('Cache-Control', 'public, max-age=300');
                        return res.sendFile(recheck);
                    }
                    // Also check iCloud cache (in case it was downloaded by a concurrent request)
                    if (fs.existsSync(cachedMediaPath)) {
                        try {
                            const stat = fs.statSync(cachedMediaPath);
                            if (stat.size > 0) {
                                icloudFailCooldown.delete(uuid);
                                res.set('Cache-Control', 'public, max-age=300');
                                return res.sendFile(cachedMediaPath);
                            }
                        } catch (_) {}
                    }
                    // Still not available — serve derivative with X-Full-Res: failed
                    const posterPath = await generateThumbnail(id, 2400);
                    if (posterPath) {
                        res.set('Cache-Control', 'no-cache');
                        res.set('X-Full-Res', 'failed');
                        return res.sendFile(posterPath);
                    }
                    return res.status(404).json({ error: 'iCloud fetch recently failed, in cooldown' });
                }
                icloudFailCooldown.delete(uuid); // cooldown expired
            }

            // Concurrency limit check — for photos, still serve derivative; for videos, return 503
            if (activeICloudCount >= MAX_CONCURRENT_ICLOUD) {
                if (!isVideo) {
                    // Photos: serve derivative immediately, skip iCloud fetch this time
                    const posterPath = await generateThumbnail(id, 2400);
                    if (posterPath) {
                        res.set('Cache-Control', 'no-cache');
                        res.set('X-Full-Res', 'busy');
                        return res.sendFile(posterPath);
                    }
                }
                return res.status(503).json({
                    error: 'Too many iCloud downloads in progress',
                    retryAfter: 10
                });
            }

            // Start iCloud fetch in background
            const fetchState = {
                progress: 0,
                status: 'starting',
                startTime: Date.now(),
                error: null,
                mediaType: isVideo ? 'Video' : 'Photo'
            };
            activeFetches.set(uuid, fetchState);
            activeICloudCount++;

            const displayName = formatted.originalFilename || formatted.filename || uuid;
            console.log(`iCloud: fetching ${isVideo ? 'video' : 'photo'} ${displayName}`);

            fetchFromICloud(uuid, cachedMediaPath, fetchState).then(() => {
                console.log(`iCloud: downloaded ${displayName} successfully`);
                fetchState.status = 'ready';
                fetchState.progress = 1.0;
            }).catch((err) => {
                console.error(`iCloud: fetch failed for ${displayName} — ${err.message}`);
                fetchState.status = 'failed';
                fetchState.error = err.message;
                icloudFailCooldown.set(uuid, Date.now() + ICLOUD_FAIL_COOLDOWN_MS);
            }).finally(() => {
                activeFetches.delete(uuid);
                activeICloudCount--;
            });

            // Videos: return 202 so the viewer shows the iCloud download overlay
            if (isVideo) {
                return res.status(202).json({
                    status: 'downloading',
                    progress: 0,
                    message: 'Downloading video from iCloud...'
                });
            }

            // Photos: serve derivative immediately while iCloud fetch runs in background
            const posterPath = await generateThumbnail(id, 2400);
            if (posterPath) {
                res.set('Cache-Control', 'no-cache');
                res.set('X-Full-Res', 'downloading');
                return res.sendFile(posterPath);
            }

            // No derivative available — fall back to 202
            return res.status(202).json({
                status: 'downloading',
                progress: 0,
                message: 'Downloading photo from iCloud...'
            });
        }

        // No original and not fetchable — generate resized derivative (up to 1600px)
            if (formatted.type === 'video' && !req.query.poster) {
                // Only warn when a non-poster request for a video falls through to
                // serving a derivative image — poster requests are expected to land here.
                console.warn(`[video-as-photo] ID ${id} "${formatted.filename}" is ZKIND=1 (video) but serving derivative image.`
                    + ` originalPath=${originalPath}, hasOriginal=${hasOriginal}`
                    + `, photoFetchAvailable=${photoFetchAvailable}, uuid=${formatted._uuid || 'null'}`);
            }
            const posterPath = await generateThumbnail(id, 1600);
            if (!posterPath) {
                return res.status(404).json({ error: 'Original file not found (may be in iCloud)' });
            }
            try {
                const stat = fs.statSync(posterPath);
                if (stat.size === 0) {
                    try { fs.unlinkSync(posterPath); } catch (_) {}
                    return res.status(404).json({ error: 'Generated image was empty' });
                }
            } catch (e) {
                return res.status(404).json({ error: 'Image file missing' });
            }
            res.set('Cache-Control', 'public, max-age=300');
            return res.sendFile(posterPath);
        }

        // Video: stream the original file with Range support for seeking
        if (isVideoFile(originalPath)) {
            return serveVideoFile(originalPath, req, res);
        }

        // Photo: generate resized version (3200px for sharp display on HiDPI screens)
        const forceRerender = req.query.rerender === '1';
        const cachePath = await generateThumbnail(id, 3200, { forceRerender });
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

        res.set('Cache-Control', forceRerender ? 'no-cache' : 'public, max-age=300');
        res.sendFile(cachePath);
    } catch (err) {
        console.error(`[full] unhandled error: ${err?.stack || err}`);
        if (!res.headersSent) res.status(500).json({ error: 'Media fetch failed' });
    }
});

// iCloud download status polling endpoint
app.get('/api/icloud-status/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid photo ID' });

    const row = stmts.photoById.get({ id });
    if (!row) return res.status(404).json({ error: 'Media not found' });

    const formatted = formatRow(row);
    if (!formatted._uuid) return res.json({ status: 'unavailable' });

    const uuid = formatted._uuid.toUpperCase();

    // Check if already cached (photo or video)
    const cachedVideoPath = path.join(ICLOUD_CACHE, `${uuid}.mov`);
    const cachedPhotoPath = path.join(ICLOUD_CACHE, `${uuid}.jpg`);
    const cachedPath = fs.existsSync(cachedVideoPath) ? cachedVideoPath : (fs.existsSync(cachedPhotoPath) ? cachedPhotoPath : null);
    if (cachedPath) {
        try {
            if (fs.statSync(cachedPath).size > 0) {
                return res.json({ status: 'ready', progress: 1.0 });
            }
        } catch (_) {}
    }

    // Check for original on disk (may have been downloaded by Photos.app since last check)
    const originalPath = resolveOriginalPath(formatted);
    if (originalPath && fs.existsSync(originalPath)) {
        return res.json({ status: 'ready', progress: 1.0 });
    }

    // Check if fetch is in progress
    if (activeFetches.has(uuid)) {
        const state = activeFetches.get(uuid);
        // Recovery path for stuck helper process after writing the temp file.
        const outputPath = (state.mediaType === 'Video') ? cachedVideoPath : cachedPhotoPath;
        if ((state.status === 'done' || state.status === 'ready' || (state.progress || 0) >= 1)
            && (promoteTmpIfComplete(outputPath) || (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0))) {
            return res.json({ status: 'ready', progress: 1.0 });
        }
        return res.json({
            status: state.status || 'downloading',
            progress: state.progress || 0,
            elapsed: Math.round((Date.now() - state.startTime) / 1000),
            error: state.error || null
        });
    }

    // Not cached and not downloading
    return res.json({ status: 'not_started', photoFetchAvailable });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

openDatabase();
prepareStatements();
discoverScopes();
buildDerivativeMap();
photoFetchAvailable = ensurePhotoFetch();
photoThumbAvailable = fs.existsSync(PHOTO_THUMB_BIN);

const { count } = stmts.count.get();
const byType = stmts.countByType.all();
const photoCount = byType.find(r => r.kind === 0)?.count || 0;
const videoCount = byType.find(r => r.kind === 1)?.count || 0;
console.log(`Arc Photo Server`);
console.log(`Library: ${LIBRARY_PATH}`);
console.log(`Media:   ${count.toLocaleString()} (${photoCount.toLocaleString()} photos, ${videoCount.toLocaleString()} videos)`);
console.log(`Cache:   ${CACHE_DIR}`);
console.log(`ffmpeg:  ${ffmpegPath || 'not found (video thumbnails may fail)'}`);
console.log(`iCloud:  ${photoFetchAvailable ? 'photo-fetch available — on-demand video download enabled' : 'photo-fetch not available — iCloud videos will show stills only'}`);
console.log(`Thumbs:  ${photoThumbAvailable ? 'photo-thumb available — PhotoKit thumbnail fallback enabled' : 'photo-thumb not found — iCloud-only photos will be unavailable'}`);

app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server:  http://127.0.0.1:${PORT}`);
    console.log(`\nReady. Keep this running while using Arc Diary Reader.`);
});
