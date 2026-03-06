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
const MASTERS_PATH = path.join(LIBRARY_PATH, 'Masters'); // legacy Photos/iPhoto libraries
const DERIVATIVES_PATH = path.join(LIBRARY_PATH, 'resources', 'derivatives');
const CACHE_DIR = path.join(__dirname, '.cache');
const THUMB_CACHE = path.join(CACHE_DIR, 'thumbnails');
const FULL_CACHE = path.join(CACHE_DIR, 'full');
const ICLOUD_CACHE = path.join(CACHE_DIR, 'icloud-videos');

// Swift PhotoKit helper for on-demand iCloud media fetch
const PHOTO_FETCH_DIR = path.join(__dirname, 'photo-fetch');
const PHOTO_FETCH_BIN = path.join(PHOTO_FETCH_DIR, 'photo-fetch');
const PHOTO_FETCH_SRC = path.join(PHOTO_FETCH_DIR, 'PhotoFetch.swift');
const PHOTO_FETCH_TIMEOUT = 300; // 5 minutes max per download

// In-flight iCloud download tracking: UUID → { progress, status, startTime, error, mediaType }
const activeFetches = new Map();
const MAX_CONCURRENT_ICLOUD = 2;
let activeICloudCount = 0;
let photoFetchAvailable = false;

// Ensure cache directories exist
fs.mkdirSync(THUMB_CACHE, { recursive: true });
fs.mkdirSync(FULL_CACHE, { recursive: true });
fs.mkdirSync(ICLOUD_CACHE, { recursive: true });

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

    // Incremental query: return items that are new OR modified since last import
    // ZMODIFICATIONDATE updates when a photo is edited (crop, adjust, etc.)
    const hasModDate = assetCols.has('ZMODIFICATIONDATE');
    const afterClause = hasModDate
        ? `AND (z.ZDATECREATED > :afterCoreData OR z.ZMODIFICATIONDATE > :afterCoreData)`
        : `AND z.ZDATECREATED > :afterCoreData`;

    stmts.metadataAfter = db.prepare(`
        ${BASE_SELECT} ${afterClause} ORDER BY z.ZDATECREATED
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
        type: row.kind === 1 ? 'video' : 'photo',
        duration: row.duration || null,
        modDate: row.modDate || null,
        _directory: row.directory || null,
        _uti: row.uti || null,
        _uuid: row.uuid || null
    };
}

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

function resolveOriginalPath(row) {
    // Originals are stored at: originals/{ZDIRECTORY}/{ZFILENAME}
    if (!row._directory || !row.filename) return null;
    const primary = path.join(ORIGINALS_PATH, row._directory, row.filename);
    if (fs.existsSync(primary)) return primary;

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

    // Also scan resources/renders/{0-9}/ (rendered thumbnails)
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
                        .jpeg({ quality: isThumb ? 80 : 85 })
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

    // Look up the photo first — needed for cache staleness check
    const row = stmts.photoById.get({ id: photoId });
    if (!row) return null;

    const formatted = formatRow(row);

    // Check cache — only trust files with actual content that aren't stale
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

    // No original? Try derivative (Apple Photos proxy image)
    if (!hasOriginal) {
        const derivPath = resolveDerivativePath(formatted);
        if (!derivPath) return null;

        // Derivative is already a JPEG — just resize with Sharp
        const tmpPath = cachePath + '.tmp';
        await acquireSlot();
        try {
            await sharp(derivPath, { failOn: 'none' })
                .rotate()
                .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: isThumb ? 80 : 85 })
                .toFile(tmpPath);

            const tmpStat = fs.statSync(tmpPath);
            if (tmpStat.size === 0) {
                fs.unlinkSync(tmpPath);
                return null;
            }
            fs.renameSync(tmpPath, cachePath);
            return cachePath;
        } catch (err) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            return null;
        } finally {
            releaseSlot();
        }
    }

    // Write to temp file first, rename on success (prevents corrupt cache entries)
    const tmpPath = cachePath + '.tmp';

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
        const proc = execFile(
            PHOTO_FETCH_BIN,
            [uuid, tmpPath, '--timeout', String(PHOTO_FETCH_TIMEOUT)],
            { timeout: (PHOTO_FETCH_TIMEOUT + 30) * 1000 }
        );

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('PROGRESS:')) {
                    fetchState.progress = parseFloat(line.substring(9)) || 0;
                    fetchState.status = 'downloading';
                } else if (line.startsWith('STATUS:')) {
                    fetchState.status = line.substring(7).toLowerCase();
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
            if (code === 0 && fs.existsSync(tmpPath)) {
                try {
                    const stat = fs.statSync(tmpPath);
                    if (stat.size === 0) {
                        try { fs.unlinkSync(tmpPath); } catch (_) {}
                        reject(new Error('Downloaded file is empty'));
                        return;
                    }
                    fs.renameSync(tmpPath, outputPath);
                    resolve({ success: true, path: outputPath });
                } catch (err) {
                    reject(new Error(`Failed to move downloaded video: ${err.message}`));
                }
            } else {
                try { fs.unlinkSync(tmpPath); } catch (_) {}
                const errorMsg = fetchState.error || `photo-fetch exited with code ${code}`;
                reject(new Error(errorMsg));
            }
        });

        proc.on('error', (err) => {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            reject(err);
        });
    });
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
        return cb(new Error('Not allowed by CORS'));
    }
}));

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
        const startCoreData = isoToCoreData(start + 'T00:00:00Z');
        const endCoreData = isoToCoreData(end + 'T23:59:59Z');
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
            uti: formatted?._uti || null
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
        unavailable.noOriginal++;
        incCounter(unavailableByType, formatted.type || 'unknown');
        incCounter(unavailableByUti, formatted._uti || 'unknown');
        pushUnavailableSample(id, 'noOriginal', formatted);
    }

    const unavailableByUtiTop = Object.entries(unavailableByUti)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_UTI_LIMIT)
        .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

    res.json({
        available,
        unavailable,
        unavailableByType,
        unavailableByUtiTop,
        unavailableSample
    });
});

// Thumbnail (200px)
app.get('/api/thumbnail/:id', async (req, res) => {
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
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid photo ID' });

    // Look up the media item
    const row = stmts.photoById.get({ id });
    if (!row) return res.status(404).json({ error: 'Media not found' });

    const formatted = formatRow(row);
    const originalPath = resolveOriginalPath(formatted);
    const hasOriginal = originalPath && fs.existsSync(originalPath);

    if (!hasOriginal) {
        // Try iCloud fetch for both photos and videos when UUID is available.
        // ?poster=1 skips iCloud fetch — serves derivative still image as placeholder
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
                return res.status(202).json({
                    status: state.status || 'downloading',
                    progress: state.progress || 0,
                    message: `${state.mediaType || 'Media'} is being downloaded from iCloud`
                });
            }

            // Concurrency limit check
            if (activeICloudCount >= MAX_CONCURRENT_ICLOUD) {
                return res.status(503).json({
                    error: 'Too many iCloud downloads in progress',
                    retryAfter: 10
                });
            }

            // Launch iCloud fetch in background — return 202 immediately
            const fetchState = {
                progress: 0,
                status: 'starting',
                startTime: Date.now(),
                error: null,
                mediaType: isVideo ? 'Video' : 'Photo'
            };
            activeFetches.set(uuid, fetchState);
            activeICloudCount++;

            console.log(`iCloud: fetching ${isVideo ? 'video' : 'photo'} ${uuid} (${formatted.filename || 'unknown'})`);

            fetchFromICloud(uuid, cachedMediaPath, fetchState).then(() => {
                console.log(`iCloud: downloaded ${uuid} successfully`);
            }).catch((err) => {
                console.error(`iCloud: fetch failed for ${uuid} — ${err.message}`);
            }).finally(() => {
                activeFetches.delete(uuid);
                activeICloudCount--;
            });

            return res.status(202).json({
                status: 'downloading',
                progress: 0,
                message: `Downloading ${isVideo ? 'video' : 'photo'} from iCloud...`
            });
        }

        // No original and not a fetchable video — generate resized derivative (up to 1600px)
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

    // Photo: generate resized version (existing behaviour)
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
buildDerivativeMap();
photoFetchAvailable = ensurePhotoFetch();

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

app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server:  http://127.0.0.1:${PORT}`);
    console.log(`\nReady. Keep this running while using Arc Diary Reader.`);
});
