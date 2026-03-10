#!/usr/bin/env node
'use strict';

// ==========================================================================
//  Arc Photo Server (Windows)
//  Reads photos from a local folder (e.g. iCloud for Windows Photos folder)
//  and serves the same REST API as the macOS server (server.js).
// ==========================================================================

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const express = require('express');
const cors = require('cors');
const sharp = require('sharp');
const exifr = require('exifr');

// WIC HEIC converter — uses Windows-native HEIF/HEVC codec via PowerShell.
// Same decoder as Microsoft Photos — supports GPU hardware acceleration and
// correctly handles tiled iPhone HEIC files. Preferred over heic-convert.
const { convertHeicToJpeg, convertHeicBatch, checkWicHeicSupport } = require('./heic-wic-converter');
let wicHeicAvailable = false; // set at startup after checking installed extensions

// heic-convert — pure-JS HEIC decoder (WebAssembly-based libheif)
// Falls back gracefully if not installed. Used when WIC extensions are missing.
let heicConvert = null;
try {
    heicConvert = require('heic-convert');
} catch (_) {
    // Will be installed via `npm install` from package.json
}

// ---------------------------------------------------------------------------
// Process safety handlers
// ---------------------------------------------------------------------------

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

const PORT = (function () {
    const idx = process.argv.indexOf('--port');
    if (idx !== -1 && process.argv[idx + 1]) return parseInt(process.argv[idx + 1], 10);
    return parseInt(process.env.PORT || '3000', 10);
})();

const PHOTOS_FOLDER = (function () {
    const idx = process.argv.indexOf('--folder');
    if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
    if (process.env.PHOTOS_FOLDER) return process.env.PHOTOS_FOLDER;
    // Default iCloud for Windows paths (check common locations)
    const candidates = [
        path.join(os.homedir(), 'iCloudPhotos', 'Photos'),
        path.join(os.homedir(), 'iCloudPhotos'),
        path.join(os.homedir(), 'Pictures', 'iCloud Photos', 'Photos'),
        path.join(os.homedir(), 'Pictures', 'iCloud Photos'),
    ];
    for (const dir of candidates) {
        if (fs.existsSync(dir)) return dir;
    }
    return candidates[0];
})();

const CACHE_DIR = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ArcPhotoServer', 'cache')
    : path.join(__dirname, '.cache');
const THUMB_CACHE = path.join(CACHE_DIR, 'thumbnails');
const FULL_CACHE = path.join(CACHE_DIR, 'full');
const INDEX_PATH = path.join(CACHE_DIR, 'index.json');

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

// One-time cache migration: previous versions used ffmpeg for HEIC which grabbed a single
// 512×512 tile from tiled iPhone HEIC files, producing incorrect square thumbnails/full-res.
// If heic-convert is now available, purge ALL cached images so HEIC files get regenerated
// correctly. Non-HEIC images will be re-cached on first access (fast — Sharp handles them).
const HEIC_CACHE_VERSION_FILE = path.join(CACHE_DIR, '.heic-cache-v2');
if (heicConvert && !fs.existsSync(HEIC_CACHE_VERSION_FILE)) {
    let heicPurged = 0;
    for (const dir of [THUMB_CACHE, FULL_CACHE]) {
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.jpg')) continue;
            const fp = path.join(dir, file);
            try { fs.unlinkSync(fp); heicPurged++; } catch (_) {}
        }
    }
    // Write version marker — won't purge again on next startup
    fs.writeFileSync(HEIC_CACHE_VERSION_FILE, `heic-convert cache v2 — purged ${heicPurged} cached images at ${new Date().toISOString()}\n`);
    if (heicPurged > 0) {
        console.log(`Cache migration: purged ${heicPurged} cached images (HEIC files will regenerate with heic-convert)`);
    }
}

// ---------------------------------------------------------------------------
// File type detection
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.heic', '.heif', '.png', '.tiff', '.tif', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v', '.avi', '.3gp']);
const ALL_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

function isVideoExt(ext) {
    return VIDEO_EXTENSIONS.has(ext.toLowerCase());
}

const VIDEO_CONTENT_TYPES = {
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.avi': 'video/x-msvideo',
    '.3gp': 'video/3gpp',
};

// ---------------------------------------------------------------------------
// ffmpeg / ffprobe detection
// ---------------------------------------------------------------------------

let ffmpegPath = null;
let ffprobePath = null;

try {
    const { execSync } = require('child_process');
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    try {
        ffmpegPath = execSync(`${whichCmd} ffmpeg 2>${process.platform === 'win32' ? 'nul' : '/dev/null'}`)
            .toString().trim().split(/\r?\n/)[0] || null;
    } catch (_) {}
    try {
        ffprobePath = execSync(`${whichCmd} ffprobe 2>${process.platform === 'win32' ? 'nul' : '/dev/null'}`)
            .toString().trim().split(/\r?\n/)[0] || null;
    } catch (_) {}
} catch (_) {}

// ---------------------------------------------------------------------------
// In-memory photo index
// ---------------------------------------------------------------------------

const photoIndex = new Map();   // id → PhotoRecord
const fileToId = new Map();     // filename → id
const failedPhotos = new Set(); // IDs that permanently fail thumbnail generation
let nextId = 1;

// ---------------------------------------------------------------------------
// Helper: dayKey from Date
// ---------------------------------------------------------------------------

function dayKeyFromDate(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Helper: format date as timezone-naive local ISO string
// ---------------------------------------------------------------------------
// Format a Date object as the server-local time WITHOUT a 'Z' suffix, so the
// browser always displays the server's local time. Since the server runs on
// the user's machine, server-local IS the user's display timezone.
//
// NOTE: We intentionally do NOT use EXIF OffsetTimeOriginal here. That tag
// records the camera's timezone at capture, but it can be wrong if the
// camera/phone had a misconfigured timezone. Apple Photos on macOS corrects
// this via GPS data, but we don't have that capability. Using server-local
// time is the safest default — it matches what the user expects when their
// server and browser are on the same machine.

function localISO(date) {
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const dy = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${mo}-${dy}T${hh}:${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// Helper: parse date from filename (camera-assigned, never changes with sync)
// ---------------------------------------------------------------------------

function parseDateFromFilename(filename) {
    const base = path.basename(filename, path.extname(filename));

    // Format: IMG_20210315_102345 or 20210315_102345 or VID_20210315_102345
    let m = base.match(/(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[_-](\d{2})(\d{2})(\d{2})/);
    if (m) {
        const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
            parseInt(m[4]), parseInt(m[5]), parseInt(m[6]));
        if (!isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2030) return d;
    }

    // Format: 2021-03-15 10.23.45 or 2021-03-15_10-23-45
    m = base.match(/(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[_ ](\d{2})[.\-](\d{2})[.\-](\d{2})/);
    if (m) {
        const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
            parseInt(m[4]), parseInt(m[5]), parseInt(m[6]));
        if (!isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2030) return d;
    }

    return null;
}

// ---------------------------------------------------------------------------
// Helper: best date from all available sources
// ---------------------------------------------------------------------------
// Priority (highest first):
// 1. Shell "Date taken" — from Windows property store, populated by iCloud
//    without downloading. This is the original camera date.
// 2. Filename-embedded date — set by camera, never changes with sync.
// 3. Earlier of NTFS CreationTime vs LastWriteTime — often both equal the
//    sync date, so this is a last resort.

function bestDateFromTimestamps(creationMs, lastWriteMs, filename, dateTakenMs) {
    // 1. Shell DateTaken — the gold standard for iCloud placeholders
    if (dateTakenMs && dateTakenMs > 0) {
        const d = new Date(dateTakenMs);
        if (!isNaN(d.getTime())) return d;
    }

    // 2. Filename date — set by camera, never changes
    const fnDate = parseDateFromFilename(filename);
    if (fnDate) return fnDate;

    // 3. Earlier of CreationTime vs LastWriteTime
    const cMs = creationMs || 0;
    const lMs = lastWriteMs || 0;
    const bestMs = (cMs > 0 && lMs > 0) ? Math.min(cMs, lMs) : (cMs || lMs);

    return new Date(bestMs);
}

// ---------------------------------------------------------------------------
// EXIF reader
// ---------------------------------------------------------------------------

async function readImageExif(filePath) {
    try {
        const exif = await exifr.parse(filePath, {
            pick: [
                'DateTimeOriginal', 'CreateDate', 'ModifyDate',
                'GPSLatitude', 'GPSLongitude',
                'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight',
                'Make', 'Model', 'ImageDescription', 'title'
            ],
            gps: true,
            tiff: true,
            xmp: true,
            iptc: false,
            icc: false,
        });
        return exif || null;
    } catch (err) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.heic' || ext === '.heif') {
            console.warn(`  [exif-fail] ${path.basename(filePath)}: ${err.message}`);
        }
        return null;
    }
}

/**
 * Read HEIC/HEIF metadata via Sharp (which uses libheif to parse the container)
 * then parse the extracted raw EXIF buffer with exifr. This works even when
 * exifr can't directly parse the HEIC container format.
 */
async function readHeicMetadata(filePath) {
    try {
        const meta = await sharp(filePath).metadata();
        const result = {
            width: meta.width || null,
            height: meta.height || null,
            date: null,
            latitude: null,
            longitude: null,
            cameraMake: null,
            cameraModel: null,
            title: null,
        };

        // Parse EXIF from Sharp's extracted buffer — this is raw TIFF/EXIF format,
        // which exifr CAN parse (it only fails on the HEIC container itself)
        if (meta.exif) {
            try {
                const exif = await exifr.parse(meta.exif, {
                    pick: [
                        'DateTimeOriginal', 'CreateDate', 'ModifyDate',
                        'GPSLatitude', 'GPSLongitude',
                        'Make', 'Model', 'ImageDescription', 'title'
                    ],
                    gps: true,
                    tiff: true,
                });
                if (exif) {
                    result.date = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate || null;
                    result.latitude = exif.latitude || null;
                    result.longitude = exif.longitude || null;
                    result.cameraMake = exif.Make || null;
                    result.cameraModel = exif.Model || null;
                    result.title = exif.ImageDescription || exif.title || null;
                }
            } catch (_) {}
        }

        return result;
    } catch (err) {
        console.warn(`  [sharp-heic] ${path.basename(filePath)}: ${err.message}`);
        return null;
    }
}

async function readImageDimensions(filePath) {
    try {
        const meta = await sharp(filePath).metadata();
        return { width: meta.width || null, height: meta.height || null };
    } catch (err) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.heic' || ext === '.heif') {
            console.warn(`  [sharp-fail] ${path.basename(filePath)}: ${err.message}`);
            // Fallback: try ffprobe for HEIC dimensions
            if (ffprobePath) {
                try {
                    const dims = await readImageDimensionsViaFfprobe(filePath);
                    if (dims) return dims;
                } catch (_) {}
            }
        }
        return null;
    }
}

function readImageDimensionsViaFfprobe(filePath) {
    return new Promise((resolve) => {
        if (!ffprobePath) return resolve(null);
        execFile(ffprobePath, [
            '-v', 'quiet', '-print_format', 'json',
            '-show_streams', filePath
        ], { timeout: 15000 }, (err, stdout) => {
            if (err) return resolve(null);
            try {
                const probe = JSON.parse(stdout);
                const video = probe.streams && probe.streams.find(s => s.codec_type === 'video');
                if (video && video.width && video.height) {
                    return resolve({ width: video.width, height: video.height });
                }
                resolve(null);
            } catch (_) {
                resolve(null);
            }
        });
    });
}

function readVideoMeta(filePath) {
    return new Promise((resolve) => {
        if (!ffprobePath) {
            resolve(null);
            return;
        }
        execFile(ffprobePath, [
            '-v', 'quiet', '-print_format', 'json',
            '-show_format', '-show_streams', filePath
        ], { timeout: 15000 }, (err, stdout) => {
            if (err) return resolve(null);
            try {
                const probe = JSON.parse(stdout);
                const video = probe.streams && probe.streams.find(s => s.codec_type === 'video');
                resolve({
                    width: video ? (video.width || null) : null,
                    height: video ? (video.height || null) : null,
                    duration: probe.format && probe.format.duration
                        ? parseFloat(probe.format.duration) : null,
                    date: probe.format && probe.format.tags && probe.format.tags.creation_time
                        ? new Date(probe.format.tags.creation_time) : null,
                });
            } catch (_) {
                resolve(null);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// iCloud placeholder detection (Windows Cloud Files API via PowerShell)
// ---------------------------------------------------------------------------

// In-flight iCloud hydration tracking: filename → { status, progress, startTime, error }
const activeHydrations = new Map();
const MAX_CONCURRENT_HYDRATIONS = 2;
let activeHydrationCount = 0;

/**
 * Batch-check NTFS attributes for all files in a folder via a single PowerShell call.
 * Returns Map<filename, { size, lastWriteMs, attrs, isPlaceholder }> or null on failure.
 * Does NOT read file content — only metadata. Safe for iCloud placeholders.
 */
function getFileAttributesBatch(folderPath) {
    return new Promise((resolve) => {
        const escapedPath = folderPath.replace(/'/g, "''");
        const psScript = `Get-ChildItem -LiteralPath '${escapedPath}' -File | Select-Object Name, Length, @{N='LastWriteMs';E={[long]($_.LastWriteTimeUtc - [datetime]'1970-01-01').TotalMilliseconds}}, @{N='CreationMs';E={[long]($_.CreationTimeUtc - [datetime]'1970-01-01').TotalMilliseconds}}, @{N='Attrs';E={$_.Attributes.ToString()}} | ConvertTo-Json -Compress`;

        execFile('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command', psScript
        ], { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
            if (err) {
                console.warn('  PowerShell attribute check failed:', err.message);
                resolve(null);
                return;
            }
            try {
                let parsed = JSON.parse(stdout);
                if (!Array.isArray(parsed)) parsed = [parsed];
                const result = new Map();
                for (const entry of parsed) {
                    if (!entry || !entry.Name) continue;
                    result.set(entry.Name, {
                        size: entry.Length || 0,
                        lastWriteMs: entry.LastWriteMs || 0,
                        creationMs: entry.CreationMs || 0,
                        attrs: entry.Attrs || '',
                        isPlaceholder: /ReparsePoint/.test(entry.Attrs) && /Offline/.test(entry.Attrs),
                    });
                }
                resolve(result);
            } catch (parseErr) {
                console.warn('  PowerShell output parse failed:', parseErr.message);
                resolve(null);
            }
        });
    });
}

/**
 * Read "Date taken" from the Windows Shell property store for all files.
 * Works for iCloud placeholders because Windows caches photo metadata in
 * the property store without requiring file content access.
 * Returns Map<filename, epochMs> or null on failure.
 */
function getShellDateTakenBatch(folderPath) {
    return new Promise((resolve) => {
        const escapedPath = folderPath.replace(/'/g, "''");
        // Shell.Application GetDetailsOf column 12 = "Date taken"
        // Parse dates in PowerShell to avoid locale-dependent string parsing in Node.
        // Return as epoch-ms in a JSON object.
        const psScript = [
            "$ErrorActionPreference = 'SilentlyContinue'",
            `$folder = (New-Object -ComObject Shell.Application).Namespace('${escapedPath}')`,
            "if (-not $folder) { Write-Output '{}'; exit }",
            "$result = @{}",
            "foreach ($item in $folder.Items()) {",
            "    $dt = $folder.GetDetailsOf($item, 12)",
            "    if ($dt -and $dt.Trim()) {",
            "        $clean = $dt -replace '[\\u200E\\u200F\\u200B]', ''",
            "        try {",
            "            $parsed = [datetime]::Parse($clean)",
            "            $result[$item.Name] = [long]($parsed.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds",
            "        } catch {}",
            "    }",
            "}",
            "ConvertTo-Json $result -Compress"
        ].join('\n');

        execFile('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command', psScript
        ], { timeout: 300000, maxBuffer: 100 * 1024 * 1024 }, (err, stdout) => {
            if (err) {
                console.warn('  Shell DateTaken extraction failed:', err.message);
                resolve(null);
                return;
            }
            const raw = (stdout || '').trim();
            if (!raw) {
                console.warn('  Shell DateTaken: no output');
                resolve(null);
                return;
            }
            try {
                const parsed = JSON.parse(raw);
                const result = new Map();
                for (const [name, ms] of Object.entries(parsed)) {
                    if (ms && typeof ms === 'number' && ms > 0) {
                        result.set(name, ms);
                    }
                }
                resolve(result);
            } catch (parseErr) {
                console.warn('  Shell DateTaken parse failed:', parseErr.message);
                resolve(null);
            }
        });
    });
}

/**
 * Check a single file's current NTFS attributes. Used for hydration polling.
 */
function checkFileAvailability(filePath) {
    return new Promise((resolve) => {
        const escaped = filePath.replace(/'/g, "''");
        const psScript = `(Get-Item -LiteralPath '${escaped}').Attributes.ToString()`;
        execFile('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command', psScript
        ], { timeout: 5000 }, (err, stdout) => {
            if (err) { resolve(null); return; }
            const attrs = stdout.trim();
            const isPlaceholder = /ReparsePoint/.test(attrs) && /Offline/.test(attrs);
            resolve({ attrs, isPlaceholder });
        });
    });
}

/**
 * Build a minimal record for a cloud-only placeholder file (no content read).
 * dateTakenMs: epoch-ms from the Windows Shell property store (may be 0/null).
 */
function buildPlaceholderRecord(filename, attrInfo, dateTakenMs) {
    const ext = path.extname(filename).toLowerCase();
    const isVideo = isVideoExt(ext);

    // Use the best available date — Shell DateTaken is the most reliable source
    // for iCloud placeholders because it comes from iCloud's metadata cache.
    const date = bestDateFromTimestamps(attrInfo.creationMs, attrInfo.lastWriteMs, filename, dateTakenMs);
    const iso = localISO(date);

    return {
        id: 0,
        date: iso,
        dayKey: iso.slice(0, 10),
        latitude: null,
        longitude: null,
        width: null,
        height: null,
        filename,
        originalFilename: filename,
        title: null,
        cameraMake: null,
        cameraModel: null,
        type: isVideo ? 'video' : 'photo',
        duration: null,
        modDate: attrInfo.lastWriteMs,
        available: false,
        _filePath: path.join(PHOTOS_FOLDER, filename),
    };
}

/**
 * Trigger iCloud download for a placeholder file and monitor completion.
 */
async function hydrateFile(record) {
    const filename = record.filename;
    const filePath = record._filePath;

    if (activeHydrations.has(filename)) {
        return activeHydrations.get(filename);
    }

    if (activeHydrationCount >= MAX_CONCURRENT_HYDRATIONS) {
        return { status: 'queued', progress: 0 };
    }

    const state = {
        status: 'downloading',
        progress: 0,
        startTime: Date.now(),
        error: null,
    };
    activeHydrations.set(filename, state);
    activeHydrationCount++;

    console.log(`[iCloud] hydrating ${record.type}: ${filename}`);

    // Trigger iCloud download by opening a read stream — iCloud for Windows
    // automatically starts downloading the file when its content is accessed
    const triggerStream = fs.createReadStream(filePath, { start: 0, end: 0 });
    triggerStream.on('error', () => {});
    triggerStream.on('data', () => {});
    triggerStream.on('end', () => triggerStream.destroy());

    // Poll for completion in background
    const pollInterval = setInterval(async () => {
        try {
            const avail = await checkFileAvailability(filePath);
            if (!avail) return;

            if (!avail.isPlaceholder) {
                clearInterval(pollInterval);
                state.status = 'ready';
                state.progress = 1.0;

                // Re-read metadata now that file is available
                try {
                    const stat = fs.statSync(filePath);
                    const updatedRecord = await buildRecordForFile(filename, filePath, stat);
                    if (updatedRecord) {
                        updatedRecord.id = record.id;
                        updatedRecord.available = true;
                        photoIndex.set(record.id, updatedRecord);
                        saveIndexCache();
                        console.log(`[iCloud] ${filename} hydrated and re-indexed`);
                    }
                } catch (e) {
                    console.warn(`[iCloud] re-index failed for ${filename}: ${e.message}`);
                }

                setTimeout(() => {
                    activeHydrations.delete(filename);
                    activeHydrationCount--;
                }, 30000);
            }
        } catch (_) {}
    }, 2000);

    // Hard timeout: 5 minutes
    setTimeout(() => {
        if (state.status !== 'ready') {
            clearInterval(pollInterval);
            state.status = 'failed';
            state.error = 'Timeout waiting for iCloud download';
            console.warn(`[iCloud] hydration timeout for ${filename}`);
            setTimeout(() => {
                activeHydrations.delete(filename);
                activeHydrationCount--;
            }, 10000);
        }
    }, 5 * 60 * 1000);

    return state;
}

// ---------------------------------------------------------------------------
// Folder scanner
// ---------------------------------------------------------------------------

async function buildRecordForFile(filename, filePath, stat) {
    const ext = path.extname(filename).toLowerCase();
    const isVideo = isVideoExt(ext);

    let date = null;
    let latitude = null;
    let longitude = null;
    let width = null;
    let height = null;
    let cameraMake = null;
    let cameraModel = null;
    let title = null;
    let duration = null;

    if (isVideo) {
        const meta = await readVideoMeta(filePath);
        if (meta) {
            width = meta.width;
            height = meta.height;
            duration = meta.duration;
            date = meta.date;
        }
    } else {
        // Image: read EXIF
        const exif = await readImageExif(filePath);
        if (exif) {
            date = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate || null;
            latitude = exif.latitude || null;
            longitude = exif.longitude || null;
            width = exif.ImageWidth || exif.ExifImageWidth || null;
            height = exif.ImageHeight || exif.ExifImageHeight || null;
            cameraMake = exif.Make || null;
            cameraModel = exif.Model || null;
            title = exif.ImageDescription || exif.title || null;
        }

        // For HEIC/HEIF where exifr can't parse the container,
        // use Sharp (libheif) to read the container + extract raw EXIF buffer
        const isHeic = ext === '.heic' || ext === '.heif';
        if (!exif && isHeic) {
            const heicMeta = await readHeicMetadata(filePath);
            if (heicMeta) {
                width = heicMeta.width || width;
                height = heicMeta.height || height;
                date = heicMeta.date || date;
                latitude = heicMeta.latitude || latitude;
                longitude = heicMeta.longitude || longitude;
                cameraMake = heicMeta.cameraMake || cameraMake;
                cameraModel = heicMeta.cameraModel || cameraModel;
                title = heicMeta.title || title;
            } else if (ffprobePath) {
                // Final fallback: ffprobe for basic date/dimensions
                const meta = await readVideoMeta(filePath);
                if (meta) {
                    width = meta.width || null;
                    height = meta.height || null;
                    date = meta.date || null;
                }
            }
        }

        // If dimensions still missing, try Sharp metadata
        if (!width || !height) {
            const dims = await readImageDimensions(filePath);
            if (dims) {
                width = dims.width;
                height = dims.height;
            } else {
                // Couldn't read dimensions — still index the file.
                // We may have EXIF date/GPS even without dimensions.
                console.warn(`  [dim-fail] ${filename} (${ext}) — no dimensions, indexing anyway`);
            }
        }
    }

    // Ensure date is a Date object, fall back to file mtime
    if (date && !(date instanceof Date)) {
        date = new Date(date);
    }
    if (!date || isNaN(date.getTime())) {
        date = stat.mtime;
    }

    const iso = localISO(date);

    return {
        id: 0, // assigned by caller
        date: iso,
        dayKey: iso.slice(0, 10),
        latitude,
        longitude,
        width,
        height,
        filename,
        originalFilename: filename,
        title,
        cameraMake,
        cameraModel,
        type: isVideo ? 'video' : 'photo',
        duration,
        modDate: stat.mtimeMs,
        available: true,
        _filePath: filePath,
    };
}

async function scanFolder() {
    const startTime = Date.now();
    console.log(`Scanning: ${PHOTOS_FOLDER}`);

    // Load existing index cache
    let cached = null;
    try {
        if (fs.existsSync(INDEX_PATH)) {
            cached = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
            if (cached.folder !== PHOTOS_FOLDER || cached.version !== 7) {
                cached = null;
            }
        }
    } catch (_) {
        cached = null;
    }

    if (cached) {
        nextId = cached.nextId || 1;
    }

    // *** CRITICAL: Use PowerShell for ALL file discovery and metadata. ***
    // Node.js fs.readdirSync / fs.statSync on iCloud placeholder files triggers
    // Windows to start downloading them. PowerShell Get-ChildItem reads only
    // NTFS metadata without triggering hydration.
    console.log('  Enumerating files via PowerShell (avoids triggering iCloud downloads)...');
    const attrMap = await getFileAttributesBatch(PHOTOS_FOLDER);

    if (!attrMap) {
        console.error('  PowerShell enumeration failed — cannot safely scan iCloud folder.');
        console.error('  Without PowerShell, scanning would trigger downloads of all cloud files.');
        console.error('  Ensure PowerShell is available and try again.');
        return;
    }

    // Filter to media files using the PowerShell results (no fs calls)
    const mediaFiles = [];
    for (const [name, info] of attrMap) {
        const ext = path.extname(name).toLowerCase();
        if (ALL_EXTENSIONS.has(ext)) {
            mediaFiles.push({ name, info });
        }
    }

    const numPlaceholders = mediaFiles.filter(f => f.info.isPlaceholder).length;
    const numHeic = mediaFiles.filter(f => {
        const ext = path.extname(f.name).toLowerCase();
        return ext === '.heic' || ext === '.heif';
    }).length;
    console.log(`  Found ${mediaFiles.length} media files (${numPlaceholders} iCloud placeholders` +
        (numHeic > 0 ? `, ${numHeic} HEIC/HEIF` : '') + ')');

    const cachedFiles = cached ? cached.files : {};
    let newCount = 0;
    let cachedCount = 0;
    let skippedCount = 0;
    let placeholderCount = 0;

    // Process in batches for controlled concurrency
    const BATCH_SIZE = 20;
    for (let i = 0; i < mediaFiles.length; i += BATCH_SIZE) {
        const batch = mediaFiles.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async ({ name: filename, info: attrInfo }) => {
            const filePath = path.join(PHOTOS_FOLDER, filename);

            // --- iCloud placeholder: index without reading content ---
            if (attrInfo.isPlaceholder) {
                const cachedEntry = cachedFiles[filename];
                if (cachedEntry && cachedEntry.metadata
                    && cachedEntry.metadata.available === false
                    && cachedEntry.mtime === attrInfo.lastWriteMs) {
                    const record = Object.assign({}, cachedEntry.metadata, { _filePath: filePath });
                    photoIndex.set(record.id, record);
                    fileToId.set(filename, record.id);
                    cachedCount++;
                    placeholderCount++;
                    return;
                }
                // Use cached Shell DateTaken if available, otherwise timestamps
                const cachedDtMs = (cachedEntry && cachedEntry.metadata && cachedEntry.metadata._shellDateMs) || 0;
                const record = buildPlaceholderRecord(filename, attrInfo, cachedDtMs);
                if (cachedDtMs) record._shellDateMs = cachedDtMs;
                record.id = (cachedEntry && cachedEntry.metadata && cachedEntry.metadata.id) || nextId++;
                photoIndex.set(record.id, record);
                fileToId.set(filename, record.id);
                placeholderCount++;
                newCount++;
                return;
            }

            // --- Locally available file ---
            // Use PowerShell data for size/mtime instead of fs.statSync (avoids triggering downloads)
            const psMtime = attrInfo.lastWriteMs;
            const psSize = attrInfo.size;

            if (psSize < 1024) {
                skippedCount++;
                return;
            }

            // Check cache — if mtime matches and was available, reuse
            const cachedEntry = cachedFiles[filename];
            if (cachedEntry && cachedEntry.mtime === psMtime) {
                const record = Object.assign({}, cachedEntry.metadata, { _filePath: filePath });
                if (record.available !== false) {
                    photoIndex.set(record.id, record);
                    fileToId.set(filename, record.id);
                    cachedCount++;
                    return;
                }
            }

            // New or modified file — build record from PowerShell metadata only.
            // Do NOT open the file here — on iCloud for Windows, files that appear
            // "locally available" may still trigger cloud downloads when opened.
            // EXIF enrichment (GPS, camera, dimensions) happens in the background
            // after the server is already accepting requests.
            const record = buildPlaceholderRecord(filename, attrInfo, 0);
            record.available = true; // locally available, just not EXIF-enriched yet
            record._needsExif = true;

            record.id = (cachedEntry && cachedEntry.metadata && cachedEntry.metadata.id) || nextId++;
            photoIndex.set(record.id, record);
            fileToId.set(filename, record.id);
            newCount++;
        });

        await Promise.all(promises);

        const done = Math.min(i + BATCH_SIZE, mediaFiles.length);
        if (done % 100 === 0 || done === mediaFiles.length) {
            process.stdout.write(`\r  [${done}/${mediaFiles.length}] Indexed...`);
        }
    }

    process.stdout.write('\n');

    // Count types
    let photoCount = 0;
    let videoCount = 0;
    for (const r of photoIndex.values()) {
        if (r.available !== false) {
            if (r.type === 'video') videoCount++;
            else photoCount++;
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ${photoCount} photos, ${videoCount} videos` +
        (placeholderCount > 0 ? `, ${placeholderCount} iCloud placeholders` : '') +
        (skippedCount > 0 ? `, ${skippedCount} skipped` : '') +
        (cachedCount > 0 ? ` (${cachedCount} from cache)` : '') +
        (newCount > 0 ? ` (${newCount} new)` : '') +
        ` in ${elapsed}s`);

    saveIndexCache();
}

function saveIndexCache() {
    const files = {};
    for (const [id, record] of photoIndex) {
        const { _filePath, ...metadata } = record;
        files[record.filename] = {
            id: record.id,
            mtime: record.modDate,
            metadata,
        };
    }
    const cache = {
        version: 7,
        folder: PHOTOS_FOLDER,
        scannedAt: new Date().toISOString(),
        nextId,
        files,
    };
    try {
        fs.writeFileSync(INDEX_PATH, JSON.stringify(cache), 'utf8');
    } catch (err) {
        console.warn(`Warning: could not save index cache: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// Image processing — concurrency limiter
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Thumbnail & full-res generation
// ---------------------------------------------------------------------------

/**
 * Convert HEIC/HEIF to a resized JPEG file using heic-convert (pure-JS libheif decoder) + Sharp.
 * This correctly decodes tiled iPhone HEIC files that ffmpeg mishandles (grabbing one tile instead
 * of the full assembled image).
 *
 * Pipeline: heic-convert (HEIC → full JPEG buffer) → Sharp (resize + rotate) → file
 */
async function heicToJpeg(inputPath, outputPath, maxSize, isThumb = true) {
    if (!heicConvert) throw new Error('heic-convert not installed');

    const inputBuffer = fs.readFileSync(inputPath);
    const jpegBuffer = await heicConvert({
        buffer: inputBuffer,
        format: 'JPEG',
        quality: 0.92, // high quality — Sharp will re-compress after resize
    });

    await sharp(Buffer.from(jpegBuffer), { failOn: 'none' })
        .rotate() // auto-rotate from EXIF orientation
        .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: isThumb ? 80 : 85 })
        .toFile(outputPath);

    const stat = fs.statSync(outputPath);
    if (stat.size === 0) {
        fs.unlinkSync(outputPath);
        throw new Error('heicToJpeg produced 0-byte output');
    }
    return outputPath;
}

/**
 * Convert an image (HEIC/HEIF) to JPEG using ffmpeg as a fallback when Sharp can't decode it.
 * NOTE: ffmpeg often grabs a single 512×512 tile from tiled iPhone HEIC files instead of the
 * full assembled image. Prefer heicToJpeg() when heic-convert is available.
 */
function ffmpegImageConvert(inputPath, outputPath, maxSize) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) return reject(new Error('ffmpeg not installed'));
        execFile(ffmpegPath, [
            '-y',
            '-i', inputPath,
            '-vf', `scale=${maxSize}:${maxSize}:force_original_aspect_ratio=decrease`,
            '-frames:v', '1',
            '-f', 'image2',
            '-c:v', 'mjpeg',
            '-q:v', '3',
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

function ffmpegThumbnail(videoPath, outputPath, maxSize) {
    // Try with -ss 1 first; if that fails (short videos), retry with -ss 0
    function attempt(seekSec) {
        return new Promise((resolve, reject) => {
            if (!ffmpegPath) return reject(new Error('ffmpeg not installed'));
            execFile(ffmpegPath, [
                '-y',
                '-ss', String(seekSec),
                '-i', videoPath,
                '-frames:v', '1',
                '-vf', `scale=${maxSize}:${maxSize}:force_original_aspect_ratio=decrease`,
                '-f', 'image2',
                '-update', '1',
                '-c:v', 'mjpeg',
                '-strict', 'unofficial',   // fix ffmpeg 7+/8+ "Non full-range YUV" error
                '-q:v', '3',
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
    return attempt(1).catch(() => attempt(0));
}

async function generateThumbnail(photoId, maxSize) {
    if (failedPhotos.has(photoId)) return null;

    const record = photoIndex.get(photoId);
    if (!record) return null;

    const isThumb = maxSize <= 200;
    const cacheDir = isThumb ? THUMB_CACHE : FULL_CACHE;
    const cachePath = path.join(cacheDir, `${photoId}.jpg`);

    // Check cache — only trust files with actual content
    if (fs.existsSync(cachePath)) {
        try {
            const stat = fs.statSync(cachePath);
            if (stat.size > 0) {
                // Check staleness against source file mtime
                if (record.modDate && record.modDate > stat.mtimeMs) {
                    fs.unlinkSync(cachePath);
                } else {
                    return cachePath;
                }
            } else {
                fs.unlinkSync(cachePath);
            }
        } catch (_) {
            try { fs.unlinkSync(cachePath); } catch (_) {}
        }
    }

    const filePath = record._filePath;
    if (!filePath || !fs.existsSync(filePath)) return null;

    const tmpPath = cachePath + '.tmp';
    const isVideo = record.type === 'video';

    await acquireSlot();
    try {
        if (isVideo) {
            // Video thumbnail via ffmpeg
            try {
                await ffmpegThumbnail(filePath, tmpPath, maxSize);
                fs.renameSync(tmpPath, cachePath);
                return cachePath;
            } catch (err) {
                try { fs.unlinkSync(tmpPath); } catch (_) {}
                failedPhotos.add(photoId);
                console.warn(`Skipping video ${record.filename}: ${err.message}`);
                return null;
            }
        }

        // Image: resize with Sharp
        try {
            await sharp(filePath, { failOn: 'none', sequentialRead: true })
                .rotate()
                .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: isThumb ? 80 : 85 })
                .toFile(tmpPath);

            const tmpStat = fs.statSync(tmpPath);
            if (tmpStat.size === 0) {
                fs.unlinkSync(tmpPath);
                throw new Error('Sharp produced 0-byte output');
            }
            fs.renameSync(tmpPath, cachePath);
            return cachePath;
        } catch (sharpErr) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}

            // Fallback for HEIC/HEIF: Sharp can't decode tiled iPhone HEIC on Windows
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.heic' || ext === '.heif') {
                // Fallback chain: WIC (Windows-native) → heic-convert (WASM) → ffmpeg
                const errors = [`Sharp: ${sharpErr.message}`];

                // 1. WIC via PowerShell — uses Windows-native HEIF/HEVC codec
                //    Same decoder as Microsoft Photos. Fast, GPU-accelerated.
                if (wicHeicAvailable) {
                    try {
                        await convertHeicToJpeg(filePath, tmpPath, maxSize, isThumb ? 80 : 85);
                        const stat = fs.statSync(tmpPath);
                        if (stat.size === 0) { fs.unlinkSync(tmpPath); throw new Error('WIC produced 0-byte output'); }
                        fs.renameSync(tmpPath, cachePath);
                        return cachePath;
                    } catch (wicErr) {
                        try { fs.unlinkSync(tmpPath); } catch (_) {}
                        errors.push(`WIC: ${wicErr.message}`);
                    }
                }

                // 2. heic-convert — pure-JS WASM libheif (slower but cross-platform)
                if (heicConvert) {
                    try {
                        await heicToJpeg(filePath, tmpPath, maxSize, isThumb);
                        fs.renameSync(tmpPath, cachePath);
                        return cachePath;
                    } catch (heicErr) {
                        try { fs.unlinkSync(tmpPath); } catch (_) {}
                        errors.push(`heic-convert: ${heicErr.message}`);
                    }
                }

                // 3. ffmpeg — last resort (may produce cropped tiles for iPhone HEIC)
                if (ffmpegPath) {
                    try {
                        await ffmpegImageConvert(filePath, tmpPath, maxSize);
                        fs.renameSync(tmpPath, cachePath);
                        return cachePath;
                    } catch (ffErr) {
                        try { fs.unlinkSync(tmpPath); } catch (_) {}
                        errors.push(`ffmpeg: ${ffErr.message}`);
                    }
                }

                console.warn(`Skipping HEIC ${record.filename}: ${errors.join(', ')}`);
            } else {
                console.warn(`Skipping ${record.filename}: ${sharpErr.message}`);
            }

            failedPhotos.add(photoId);
            return null;
        }
    } finally {
        releaseSlot();
    }
}

// ---------------------------------------------------------------------------
// Video streaming with Range support
// ---------------------------------------------------------------------------

function serveVideoFile(videoPath, req, res) {
    const stat = fs.statSync(videoPath);
    const ext = path.extname(videoPath).toLowerCase();
    const contentType = VIDEO_CONTENT_TYPES[ext] || 'video/mp4';

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
// Helper: strip internal fields before sending to client
// ---------------------------------------------------------------------------

function stripInternal(record) {
    const { _filePath, modDate, _shellDateMs, _hasShellDate, _needsExif, ...clean } = record;
    clean.enriched = !_needsExif;
    return clean;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(cors({
    origin: (origin, cb) => {
        if (!origin || origin === 'null') return cb(null, true);
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    }
}));

// ---------------------------------------------------------------------------
//  REST API — see API.md for the full endpoint and response schema reference
// ---------------------------------------------------------------------------

// --- Health check ---
app.get('/api/status', (req, res) => {
    let placeholderCount = 0;
    for (const r of photoIndex.values()) {
        if (r.available === false) placeholderCount++;
    }
    res.json({
        ok: true,
        photoCount: photoIndex.size,
        availableCount: photoIndex.size - placeholderCount,
        placeholderCount,
        skippedCount: failedPhotos.size,
        activeHydrations: activeHydrations.size,
        datesCorrection: datesCorrectionStatus,
        exifEnrichment: exifEnrichmentStatus,
        exifEnrichmentProgress: exifEnrichmentStatus === 'running' ? {
            done: enrichmentDone,
            total: enrichmentTotal,
            priorityRemaining: priorityQueue.length,
            thumbsWarmed,
            thumbsTotal: thumbWarmTotal,
        } : null,
        // Cache version — bump when thumbnail generation changes (e.g. HEIC fix).
        // Client compares this to stored version and clears its photo IDB on mismatch.
        cacheVersion: 2,
    });
});

// --- All metadata (for initial import) or incremental ---
// ?enriched=true — only return records with confirmed EXIF dates (not _needsExif)
app.get('/api/photos/metadata/all', (req, res) => {
    try {
        const after = req.query.after ? new Date(req.query.after).getTime() : null;
        const enrichedOnly = req.query.enriched === 'true';
        const results = [];
        for (const record of photoIndex.values()) {
            if (enrichedOnly && record._needsExif) continue;
            if (after) {
                const recordTime = new Date(record.date).getTime();
                const modTime = record.modDate || 0;
                if (recordTime <= after && modTime <= after) continue;
            }
            results.push(stripInternal(record));
        }
        results.sort((a, b) => new Date(a.date) - new Date(b.date));
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Metadata for date range ---
// ?enriched=true — only return records with confirmed EXIF dates
app.get('/api/photos/metadata', (req, res) => {
    try {
        const { start, end } = req.query;
        if (!start || !end) {
            return res.status(400).json({ error: 'start and end query params required (YYYY-MM-DD)' });
        }
        const enrichedOnly = req.query.enriched === 'true';
        const results = [];
        for (const record of photoIndex.values()) {
            if (enrichedOnly && record._needsExif) continue;
            if (record.dayKey >= start && record.dayKey <= end) {
                results.push(stripInternal(record));
            }
        }
        results.sort((a, b) => new Date(a.date) - new Date(b.date));
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Photo count ---
app.get('/api/photos/count', (req, res) => {
    let photos = 0, videos = 0;
    for (const r of photoIndex.values()) {
        if (r.type === 'video') videos++;
        else photos++;
    }
    res.json({ count: photoIndex.size, photos, videos });
});

// --- Reset failure cache ---
app.post('/api/reset-failures', (req, res) => {
    const count = failedPhotos.size;
    failedPhotos.clear();
    res.json({ cleared: count });
});

// --- Batch check availability ---
app.post('/api/photos/check-available', express.json({ limit: '5mb' }), (req, res) => {
    const ids = req.body && req.body.ids;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'Expected { ids: number[] }' });

    const available = [];
    const unavailable = { noOriginal: 0, notFound: 0 };
    const unavailableSample = [];

    for (const id of ids) {
        const record = photoIndex.get(id);
        if (!record) {
            unavailable.notFound++;
            continue;
        }
        if (record.available === false) {
            unavailable.noOriginal++;
            if (unavailableSample.length < 20) {
                unavailableSample.push({
                    id,
                    reason: 'icloud_placeholder',
                    filename: record.filename,
                    type: record.type,
                });
            }
            continue;
        }
        available.push(id);
    }
    res.json({
        available,
        unavailable,
        unavailableByType: {},
        unavailableByUtiTop: {},
        unavailableSample,
    });
});

// --- Single photo metadata ---
app.get('/api/photos/info/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Invalid photo ID' });
    const record = photoIndex.get(id);
    if (!record) return res.status(404).json({ error: 'Photo not found' });
    res.json(stripInternal(record));
});

// --- Thumbnail (200px) ---
app.get('/api/thumbnail/:id', async (req, res) => {
    onDemandActive++;  // signal pre-warming to pause
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid photo ID' });

        const record = photoIndex.get(id);
        if (record && record.available === false) {
            return res.status(204).end(); // No thumbnail for iCloud placeholders
        }

        const cachePath = await generateThumbnail(id, 200);
        if (!cachePath) return res.status(204).end();

        try {
            const stat = fs.statSync(cachePath);
            if (stat.size === 0) {
                try { fs.unlinkSync(cachePath); } catch (_) {}
                return res.status(204).end();
            }
        } catch (_) {
            return res.status(204).end();
        }

        res.set('Cache-Control', 'public, max-age=300');
        res.sendFile(cachePath);
    } catch (err) {
        console.error('[thumbnail] unhandled error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        onDemandActive--;  // release pressure
    }
});

// --- Full resolution (1600px for photos, stream for videos) ---
app.get('/api/full/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid photo ID' });

        const record = photoIndex.get(id);
        if (!record) return res.status(404).json({ error: 'Media not found' });

        // iCloud placeholder: check if hydrated, otherwise trigger download
        if (record.available === false) {
            const avail = await checkFileAvailability(record._filePath);
            if (avail && !avail.isPlaceholder) {
                // File downloaded since last scan — update and serve
                record.available = true;
                try {
                    const stat = fs.statSync(record._filePath);
                    const updated = await buildRecordForFile(record.filename, record._filePath, stat);
                    if (updated) {
                        updated.id = record.id;
                        updated.available = true;
                        photoIndex.set(record.id, updated);
                        saveIndexCache();
                    }
                } catch (_) {}
                // Fall through to normal serving
            } else {
                // Still a placeholder — initiate hydration
                const state = await hydrateFile(record);
                return res.status(202).json({
                    status: state.status || 'downloading',
                    progress: state.progress || 0,
                    message: `Downloading ${record.type} from iCloud...`,
                });
            }
        }

        const filePath = record._filePath;
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Original file not found' });
        }

        // Video: stream with Range support
        if (record.type === 'video') {
            return serveVideoFile(filePath, req, res);
        }

        // Photo: generate 1600px resized version
        const cachePath = await generateThumbnail(id, 1600);
        if (!cachePath) return res.status(404).json({ error: 'Photo not found or unsupported format' });

        try {
            const stat = fs.statSync(cachePath);
            if (stat.size === 0) {
                try { fs.unlinkSync(cachePath); } catch (_) {}
                return res.status(404).json({ error: 'Generated image was empty' });
            }
        } catch (_) {
            return res.status(404).json({ error: 'Image file missing' });
        }

        res.set('Cache-Control', 'public, max-age=300');
        res.sendFile(cachePath);
    } catch (err) {
        console.error('[full] unhandled error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- iCloud download status ---
app.get('/api/icloud-status/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid photo ID' });

    const record = photoIndex.get(id);
    if (!record) return res.status(404).json({ error: 'Media not found' });

    // Check if hydration is in progress
    if (activeHydrations.has(record.filename)) {
        const state = activeHydrations.get(record.filename);
        return res.json({
            status: state.status || 'downloading',
            progress: state.progress || 0,
            elapsed: Math.round((Date.now() - state.startTime) / 1000),
            error: state.error || null,
        });
    }

    // Already available
    if (record.available === true) {
        return res.json({ status: 'ready', progress: 1.0 });
    }

    // Placeholder — check if downloaded externally (user pinned in iCloud settings)
    const avail = await checkFileAvailability(record._filePath);
    if (avail && !avail.isPlaceholder) {
        record.available = true;
        return res.json({ status: 'ready', progress: 1.0 });
    }

    return res.json({ status: 'not_started' });
});

// --- Priority EXIF enrichment for a date range ---
app.post('/api/photos/enrich', express.json(), (req, res) => {
    const { start, end } = req.body || {};
    if (!start || !end) {
        return res.status(400).json({ error: 'Expected { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }' });
    }
    if (exifEnrichmentStatus !== 'running') {
        // Enrichment already done or idle — nothing to prioritise
        return res.json({
            boosted: 0,
            status: exifEnrichmentStatus,
            message: exifEnrichmentStatus === 'done'
                ? 'EXIF enrichment already complete'
                : 'EXIF enrichment not yet started',
        });
    }
    const boosted = boostEnrichmentForRange(start, end);

    // Immediately batch-warm thumbnails for this month (fire-and-forget)
    const monthKey = start.slice(0, 7); // "YYYY-MM"
    batchWarmMonth(monthKey).catch(err => {
        console.warn(`[thumbs] Month batch-warm failed for ${monthKey}:`, err.message);
    });

    res.json({
        boosted,
        status: exifEnrichmentStatus,
        remaining: priorityQueue.length + enrichmentQueue.length,
        done: enrichmentDone,
        total: enrichmentTotal,
    });
});

// ---------------------------------------------------------------------------
// Background: correct placeholder dates using Windows Shell DateTaken
// ---------------------------------------------------------------------------

let datesCorrectionStatus = 'idle'; // idle | running | done | failed

async function correctPlaceholderDatesInBackground() {
    // Count placeholders that don't yet have Shell dates
    let needCorrection = 0;
    for (const r of photoIndex.values()) {
        if (r.available === false && !r._shellDateMs) needCorrection++;
    }
    if (needCorrection === 0) {
        datesCorrectionStatus = 'done';
        return;
    }

    datesCorrectionStatus = 'running';
    console.log(`\n[background] Extracting DateTaken from Windows Shell for ${needCorrection} placeholders...`);
    const dtStart = Date.now();

    const dateTakenMap = await getShellDateTakenBatch(PHOTOS_FOLDER);
    const dtElapsed = ((Date.now() - dtStart) / 1000).toFixed(1);

    if (!dateTakenMap || dateTakenMap.size === 0) {
        console.warn(`[background] No Shell DateTaken data found (${dtElapsed}s)`);
        console.warn('[background] Placeholder dates are based on NTFS timestamps (may be inaccurate).');
        datesCorrectionStatus = 'failed';
        return;
    }

    console.log(`[background] Shell returned dates for ${dateTakenMap.size} files (${dtElapsed}s)`);

    let corrected = 0;
    let loggedSamples = 0;
    for (const [id, record] of photoIndex) {
        if (record.available !== false) continue;
        const dtMs = dateTakenMap.get(record.filename);
        if (dtMs && dtMs > 0) {
            const d = new Date(dtMs);
            if (!isNaN(d.getTime())) {
                const oldDayKey = record.dayKey;
                const iso = localISO(d);
                record.date = iso;
                record.dayKey = iso.slice(0, 10);
                record._shellDateMs = dtMs;
                if (record.dayKey !== oldDayKey) corrected++;

                // Diagnostic logging for first few corrections
                if (loggedSamples < 5) {
                    loggedSamples++;
                    console.log(`  [date-fix] ${record.filename}: ${oldDayKey} → ${record.dayKey}`);
                }
            }
        }
    }

    console.log(`[background] Corrected ${corrected} placeholder dates, saving cache...`);
    saveIndexCache();
    datesCorrectionStatus = 'done';
    console.log('[background] Date correction complete. Re-import photos in the app to pick up corrected dates.');
}

// ---------------------------------------------------------------------------
// Background: enrich records with EXIF metadata (GPS, camera, dimensions)
// ---------------------------------------------------------------------------
// Uses a two-tier queue: priorityQueue (from API requests for specific date
// ranges) is drained first, then the main enrichmentQueue (all remaining).
// When the client navigates to a month, it calls POST /api/photos/enrich
// with { start, end } — matching records jump to the front so that month's
// GPS/camera data is ready sooner.

let exifEnrichmentStatus = 'idle'; // idle | running | done

// Two-tier queue: priority items (user-requested months) first, then bulk
const priorityQueue = [];      // records boosted by /api/photos/enrich
const enrichmentQueue = [];    // all remaining _needsExif records
const prioritySet = new Set(); // track IDs already in priorityQueue to avoid dupes
let enrichmentTotal = 0;       // total items that needed enrichment at start
let enrichmentDone = 0;        // items processed so far (enriched + failed)

// ---------------------------------------------------------------------------
// Thumbnail pre-warming — runs independently of EXIF enrichment.
// Scans all photos, queues those without cached thumbnails.
// ALL WIC (HEIC) work is serialized through a single global queue — only
// one PowerShell/WIC batch runs at a time. Month-priority batches jump to
// the front of the queue. Sharp (non-HEIC) work runs separately and pauses
// when on-demand thumbnail requests are active.
// ---------------------------------------------------------------------------
let thumbsWarmed = 0;
let thumbsFailed = 0;
let thumbWarmTotal = 0;
let thumbWarmRunning = false;

// Batch size for WIC batch conversion
const WIC_BATCH_SIZE = 20;
const SHARP_CONCURRENT = 4;

// Video extensions to skip during pre-warming
const VIDEO_EXTS = new Set(['.mov', '.mp4', '.m4v', '.avi', '.3gp', '.mkv', '.webm']);

// On-demand pressure tracking — Sharp pre-warming pauses when > 0
let onDemandActive = 0;

// Background queues — populated by preWarmAllThumbnails(), consumed by workers
let heicQueue = [];   // { id, filePath, cachePath }
let sharpQueue = [];  // { id }

// Track which months we've successfully batch-warmed (retry on failure)
const monthBatchDone = new Set();

// ---------------------------------------------------------------------------
// Global WIC batch serialization
// Only ONE WIC PowerShell batch conversion runs at a time. Both month-priority
// and background pre-warming submit jobs to this queue. Month-priority jobs
// are inserted at the front so they run as soon as the current batch finishes.
// ---------------------------------------------------------------------------
const wicJobQueue = [];  // { manifest, onResult, priority, source, resolve, reject }
let wicQueueRunning = false;

/**
 * Submit a WIC batch job to the global serialized queue.
 * Returns a promise that resolves when THIS batch completes conversion.
 * Priority jobs (month batches) are inserted at the front of the queue.
 */
function submitWicBatch(manifest, onResult, { priority = false, source = 'background' } = {}) {
    return new Promise((resolve, reject) => {
        const job = { manifest, onResult, priority, source, resolve, reject };
        if (priority) {
            // Insert after any priority jobs already queued, before background jobs
            const insertIdx = wicJobQueue.findIndex(j => !j.priority);
            if (insertIdx === -1) wicJobQueue.push(job);
            else wicJobQueue.splice(insertIdx, 0, job);
        } else {
            wicJobQueue.push(job);
        }
        // Ensure the queue processor is running
        if (!wicQueueRunning) {
            wicQueueRunning = true;
            drainWicQueue().catch(err => {
                console.warn('[WIC queue] processor error:', err.message);
                wicQueueRunning = false;
            });
        }
    });
}

/**
 * Single WIC queue processor — runs ONE batch at a time, sequentially.
 * No contention: each convertHeicBatch() gets full access to WIC/GPU resources.
 */
async function drainWicQueue() {
    while (wicJobQueue.length > 0) {
        const job = wicJobQueue.shift();

        // Filter out items already cached (on-demand or priority may have done them)
        const uncached = job.manifest.filter(item => {
            try {
                const cachePath = item.output.replace(/\.tmp$/, '');
                return !fs.existsSync(cachePath) || fs.statSync(cachePath).size === 0;
            } catch (_) { return true; }
        });

        if (uncached.length === 0) {
            job.resolve({ succeeded: 0, failed: 0, skipped: job.manifest.length });
            continue;
        }

        const batchStart = Date.now();
        try {
            const result = await convertHeicBatch(uncached, job.onResult);
            const elapsed = Date.now() - batchStart;
            const perFile = uncached.length > 0 ? Math.round(elapsed / uncached.length) : 0;
            console.log(`  🖼️  WIC [${job.source}]: ${result.succeeded}/${uncached.length} OK in ${elapsed}ms (${perFile}ms/file)`);
            job.resolve(result);
        } catch (err) {
            const elapsed = Date.now() - batchStart;
            console.log(`  🖼️  WIC [${job.source}] FAILED after ${elapsed}ms: ${err.message}`);
            job.reject(err);
        }
    }
    wicQueueRunning = false;
}

/**
 * Called when user navigates to a month — batch-converts all uncached
 * thumbnails for that month. HEIC files go through the global WIC queue
 * with priority (they jump to the front). Non-HEIC files use Sharp directly.
 *
 * monthBatchDone is only set on success — failed months can be retried
 * on the next navigation.
 */
async function batchWarmMonth(monthKey) {
    if (!monthKey) return;
    if (monthBatchDone.has(monthKey)) return; // already succeeded

    const [year, month] = monthKey.split('-').map(Number);
    const startDay = `${monthKey}-01`;
    const endDay = `${monthKey}-${new Date(year, month, 0).getDate()}`;

    // Collect uncached photos for this month
    const heicItems = [];  // { id, filePath, cachePath }
    const sharpIds = [];   // photo IDs for Sharp
    const allIds = new Set();

    for (const [id, record] of photoIndex) {
        if (!record._filePath || !record.date) continue;
        if (record.available === false) continue;
        if (record.type === 'video') continue;
        if (failedPhotos.has(id)) continue;

        const d = record.date.slice(0, 10);
        if (d < startDay || d > endDay) continue;

        const cachePath = path.join(THUMB_CACHE, `${id}.jpg`);
        try {
            if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) continue;
        } catch (_) {}

        const ext = path.extname(record._filePath).toLowerCase();
        if (VIDEO_EXTS.has(ext)) continue;

        allIds.add(id);
        if ((ext === '.heic' || ext === '.heif') && wicHeicAvailable) {
            heicItems.push({ id, filePath: record._filePath, cachePath });
        } else {
            sharpIds.push(id);
        }
    }

    if (allIds.size === 0) {
        monthBatchDone.add(monthKey);
        return;
    }

    console.log(`[thumbs] 🎯 Batch-warming ${monthKey}: ${heicItems.length} HEIC + ${sharpIds.length} other = ${allIds.size} photos`);

    // Pause background Sharp so month gets resources. WIC serialization
    // is handled by the global queue — priority insertion, not pausing.
    onDemandActive++;

    // Remove these IDs from the background queues (avoid double-processing)
    heicQueue = heicQueue.filter(item => !allIds.has(item.id));
    sharpQueue = sharpQueue.filter(item => !allIds.has(item.id));

    const startTime = Date.now();
    let heicOk = true;

    // --- HEIC: submit to global WIC queue with priority ---
    const heicPromise = (async () => {
        if (heicItems.length === 0) return;
        for (let i = 0; i < heicItems.length; i += WIC_BATCH_SIZE) {
            const batch = heicItems.slice(i, i + WIC_BATCH_SIZE);
            const manifest = batch.map(item => ({
                id: item.id,
                input: item.filePath,
                output: item.cachePath + '.tmp',
                maxSize: 200,
                quality: 80
            }));

            try {
                await submitWicBatch(manifest, (result) => {
                    const item = batch.find(h => h.id === result.id);
                    if (!item) return;
                    if (result.success) {
                        try {
                            const tmpPath = item.cachePath + '.tmp';
                            if (fs.statSync(tmpPath).size > 0) {
                                fs.renameSync(tmpPath, item.cachePath);
                                thumbsWarmed++;
                            } else {
                                try { fs.unlinkSync(tmpPath); } catch (_) {}
                                thumbsFailed++;
                            }
                        } catch (_) { thumbsFailed++; }
                    } else {
                        try { fs.unlinkSync(item.cachePath + '.tmp'); } catch (_) {}
                        thumbsFailed++;
                    }
                }, { priority: true, source: `month:${monthKey}` });
            } catch (err) {
                console.warn(`[thumbs] 🎯 WIC batch for ${monthKey} failed: ${err.message}`);
                thumbsFailed += batch.length;
                heicOk = false;
            }
        }
    })();

    // --- Non-HEIC: Sharp in parallel ---
    const sharpPromise = (async () => {
        if (sharpIds.length === 0) return;
        for (let i = 0; i < sharpIds.length; i += SHARP_CONCURRENT) {
            const chunk = sharpIds.slice(i, i + SHARP_CONCURRENT);
            await Promise.all(chunk.map(id =>
                generateThumbnail(id, 200).then(() => { thumbsWarmed++; return true; })
                    .catch(() => { thumbsFailed++; return false; })
            ));
        }
    })();

    await Promise.all([heicPromise, sharpPromise]);

    // Resume background Sharp
    onDemandActive--;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[thumbs] 🎯 ${monthKey} done: ${allIds.size} thumbnails in ${elapsed}s`);

    // Only mark as done if WIC batches all succeeded (allow retry on failure)
    if (heicOk) {
        monthBatchDone.add(monthKey);
    } else {
        console.log(`[thumbs] 🎯 ${monthKey} had WIC failures — will retry on next navigation`);
    }

    // Kick off background pre-warming if not already running
    if (!thumbWarmRunning) {
        preWarmAllThumbnails().catch(err => {
            console.warn('[thumbs] Pre-warming failed:', err.message);
        });
    }
}

/**
 * Wait until on-demand thumbnail requests are done, so we don't compete
 * with the user's current view. Yields the event loop briefly.
 */
async function waitForOnDemand() {
    while (onDemandActive > 0) {
        await new Promise(r => setTimeout(r, 50));
    }
}

/**
 * Pre-warm ALL photo thumbnails. Called once at startup after scanFolder().
 * Partitions into HEIC queue (batch WIC) and non-HEIC queue (Sharp),
 * then processes both concurrently. Pauses when on-demand requests arrive.
 */
async function preWarmAllThumbnails() {
    if (thumbWarmRunning) return;
    thumbWarmRunning = true;

    // Build separate queues for HEIC and non-HEIC
    heicQueue = [];
    sharpQueue = [];

    for (const [id, record] of photoIndex) {
        if (!record._filePath) continue;
        if (record.available === false) continue;
        if (record.type === 'video') continue;
        if (failedPhotos.has(id)) continue;

        const cachePath = path.join(THUMB_CACHE, `${id}.jpg`);
        try {
            if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) continue;
        } catch (_) {}

        const ext = path.extname(record._filePath).toLowerCase();
        if (VIDEO_EXTS.has(ext)) continue;

        if ((ext === '.heic' || ext === '.heif') && wicHeicAvailable) {
            heicQueue.push({ id, filePath: record._filePath, cachePath });
        } else {
            sharpQueue.push({ id });
        }
    }

    // Sort by date descending — most recent photos first (user likely viewing recent months)
    const dateSorter = (a, b) => {
        const aRec = photoIndex.get(typeof a === 'object' ? a.id : a);
        const bRec = photoIndex.get(typeof b === 'object' ? b.id : b);
        const aDate = aRec?.date || '0';
        const bDate = bRec?.date || '0';
        return bDate.localeCompare(aDate); // descending — newest first
    };
    heicQueue.sort(dateSorter);
    sharpQueue.sort(dateSorter);

    thumbWarmTotal = heicQueue.length + sharpQueue.length;
    if (thumbWarmTotal === 0) {
        console.log('[thumbs] All thumbnails already cached');
        thumbWarmRunning = false;
        return;
    }

    console.log(`[thumbs] Pre-warming ${thumbWarmTotal} thumbnails (${heicQueue.length} HEIC via WIC batch, ${sharpQueue.length} other via Sharp) — newest first`);

    // --- Process HEIC batches and Sharp queue concurrently ---
    const heicPromise = processHeicBatches();
    const sharpPromise = processSharpQueue();
    await Promise.all([heicPromise, sharpPromise]);

    console.log(`[thumbs] Pre-warming complete: ${thumbsWarmed} cached, ${thumbsFailed} failed`);
    thumbWarmRunning = false;
}

/**
 * Process HEIC queue by submitting batches to the global WIC queue.
 * Each batch is submitted as a background (non-priority) job.
 * The global queue serializes all WIC work — only one batch runs at a time.
 */
async function processHeicBatches() {
    if (heicQueue.length === 0) return;

    let batchNum = 0;
    const totalBatches = Math.ceil(heicQueue.length / WIC_BATCH_SIZE);

    while (heicQueue.length > 0) {
        // Pause for on-demand Sharp requests (WIC serialization handled by queue)
        await waitForOnDemand();

        const batch = heicQueue.splice(0, WIC_BATCH_SIZE);
        if (batch.length === 0) break;

        const myNum = ++batchNum;
        const manifest = batch.map(item => ({
            id: item.id,
            input: item.filePath,
            output: item.cachePath + '.tmp',
            maxSize: 200,
            quality: 80
        }));

        try {
            await submitWicBatch(manifest, (result) => {
                const item = batch.find(h => h.id === result.id);
                if (!item) return;
                if (result.success) {
                    try {
                        const tmpPath = item.cachePath + '.tmp';
                        const stat = fs.statSync(tmpPath);
                        if (stat.size > 0) {
                            fs.renameSync(tmpPath, item.cachePath);
                            thumbsWarmed++;
                        } else {
                            try { fs.unlinkSync(tmpPath); } catch (_) {}
                            thumbsFailed++;
                        }
                    } catch (_) {
                        thumbsFailed++;
                    }
                } else {
                    try { fs.unlinkSync(item.cachePath + '.tmp'); } catch (_) {}
                    thumbsFailed++;
                }
            }, { priority: false, source: `bg:${myNum}/${totalBatches}` });

            const progress = `${thumbsWarmed + thumbsFailed}/${thumbWarmTotal}`;
            console.log(`  🖼️  WIC bg batch ${myNum}/${totalBatches} done [${progress} total]`);
        } catch (batchErr) {
            console.log(`  🖼️  WIC bg batch ${myNum} FAILED: ${batchErr.message}`);
            thumbsFailed += batch.length;
        }
    }
}

/**
 * Process non-HEIC queue via Sharp. Pauses for on-demand requests.
 */
async function processSharpQueue() {
    if (sharpQueue.length === 0) return;

    let sharpDone = 0;
    let lastLogTime = Date.now();

    while (sharpQueue.length > 0) {
        await waitForOnDemand();

        const chunk = sharpQueue.splice(0, SHARP_CONCURRENT);
        if (chunk.length === 0) break;

        const results = await Promise.all(chunk.map(async (item) => {
            // Skip if already cached (on-demand may have done it)
            const cachePath = path.join(THUMB_CACHE, `${item.id}.jpg`);
            try {
                if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) return true;
            } catch (_) {}

            const t0 = Date.now();
            try {
                await generateThumbnail(item.id, 200);
                const ms = Date.now() - t0;
                if (ms > 2000) {
                    const rec = photoIndex.get(item.id);
                    const name = rec?._filePath ? path.basename(rec._filePath) : item.id;
                    console.log(`  🖼️  Sharp SLOW: ${name} took ${ms}ms`);
                }
                return true;
            } catch (err) {
                return false;
            }
        }));
        for (const ok of results) {
            if (ok) thumbsWarmed++;
            else thumbsFailed++;
        }
        sharpDone += chunk.length;

        if (Date.now() - lastLogTime > 10000) {
            const progress = `${thumbsWarmed + thumbsFailed}/${thumbWarmTotal}`;
            console.log(`  🖼️  Sharp progress: ${sharpDone} done [${progress} total]`);
            lastLogTime = Date.now();
        }
    }
}

/**
 * Enrich a single record with EXIF/video metadata.
 * Returns true if successfully enriched, false on failure.
 */
async function enrichRecord(record) {
    try {
        const filePath = record._filePath;
        const ext = path.extname(filePath).toLowerCase();
        const isVideo = record.type === 'video';

        if (isVideo) {
            // Video: use ffprobe for metadata
            if (ffmpegPath || ffprobePath) {
                const meta = await readVideoMeta(filePath);
                if (meta) {
                    if (meta.width) record.width = meta.width;
                    if (meta.height) record.height = meta.height;
                    if (meta.duration) record.duration = meta.duration;
                    if (meta.date) {
                        const d = meta.date instanceof Date ? meta.date : new Date(meta.date);
                        if (!isNaN(d.getTime())) {
                            const iso = localISO(d);
                            record.date = iso;
                            record.dayKey = iso.slice(0, 10);
                        }
                    }
                }
            }
        } else {
            // Image: try exifr first, Sharp for HEIC fallback
            let gotExif = false;
            const exif = await readImageExif(filePath);
            if (exif) {
                gotExif = true;
                const d = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate;
                if (d) {
                    const date = d instanceof Date ? d : new Date(d);
                    if (!isNaN(date.getTime())) {
                        const iso = localISO(date);
                        record.date = iso;
                        record.dayKey = iso.slice(0, 10);
                    }
                }
                if (exif.latitude) record.latitude = exif.latitude;
                if (exif.longitude) record.longitude = exif.longitude;
                if (exif.ImageWidth || exif.ExifImageWidth) record.width = exif.ImageWidth || exif.ExifImageWidth;
                if (exif.ImageHeight || exif.ExifImageHeight) record.height = exif.ImageHeight || exif.ExifImageHeight;
                if (exif.Make) record.cameraMake = exif.Make;
                if (exif.Model) record.cameraModel = exif.Model;
                if (exif.ImageDescription || exif.title) record.title = exif.ImageDescription || exif.title;
            }

            // HEIC fallback via Sharp
            const isHeic = ext === '.heic' || ext === '.heif';
            if (!gotExif && isHeic) {
                const heicMeta = await readHeicMetadata(filePath);
                if (heicMeta) {
                    if (heicMeta.width) record.width = heicMeta.width;
                    if (heicMeta.height) record.height = heicMeta.height;
                    if (heicMeta.date) {
                        const d = heicMeta.date instanceof Date ? heicMeta.date : new Date(heicMeta.date);
                        if (!isNaN(d.getTime())) {
                            const iso = localISO(d);
                            record.date = iso;
                            record.dayKey = iso.slice(0, 10);
                        }
                    }
                    if (heicMeta.latitude) record.latitude = heicMeta.latitude;
                    if (heicMeta.longitude) record.longitude = heicMeta.longitude;
                    if (heicMeta.cameraMake) record.cameraMake = heicMeta.cameraMake;
                    if (heicMeta.cameraModel) record.cameraModel = heicMeta.cameraModel;
                    if (heicMeta.title) record.title = heicMeta.title;
                }
            }

            // Dimensions fallback via Sharp
            if (!record.width || !record.height) {
                const dims = await readImageDimensions(filePath);
                if (dims) {
                    record.width = dims.width;
                    record.height = dims.height;
                }
            }
        }

        delete record._needsExif;
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Boost records matching a date range to the front of the enrichment queue.
 * Called by POST /api/photos/enrich when the client navigates to a month.
 * Returns the number of records boosted.
 */
function boostEnrichmentForRange(startDate, endDate) {
    let boosted = 0;

    // Move matching records from enrichmentQueue to priorityQueue
    for (let i = enrichmentQueue.length - 1; i >= 0; i--) {
        const record = enrichmentQueue[i];
        if (record.dayKey >= startDate && record.dayKey <= endDate && !prioritySet.has(record.id)) {
            enrichmentQueue.splice(i, 1);
            priorityQueue.push(record);
            prioritySet.add(record.id);
            boosted++;
        }
    }

    if (boosted > 0) {
        console.log(`[enrich] Boosted ${boosted} records for ${startDate} → ${endDate}`);
    }
    return boosted;
}

async function enrichExifInBackground() {
    // Populate the main enrichment queue with all records that need EXIF
    for (const [id, record] of photoIndex) {
        if (record._needsExif) enrichmentQueue.push(record);
    }
    enrichmentTotal = enrichmentQueue.length;
    if (enrichmentTotal === 0) {
        exifEnrichmentStatus = 'done';
        return;
    }

    exifEnrichmentStatus = 'running';
    console.log(`\n[background] Reading EXIF metadata for ${enrichmentTotal} files...`);
    console.log('[background] This runs in the background — the server is ready to use now.');
    const startTime = Date.now();
    let enriched = 0;
    let failed = 0;

    // Process in small batches, always draining priorityQueue first
    const BATCH = 5;
    const SAVE_INTERVAL = 200; // save index cache every N records
    let sinceLastSave = 0;

    while (priorityQueue.length > 0 || enrichmentQueue.length > 0) {
        // Pause enrichment when month-batch thumbnail generation is active,
        // so it gets exclusive disk I/O and CPU resources.
        while (onDemandActive > 0) {
            await new Promise(r => setTimeout(r, 200));
        }

        // Build the next batch — priorityQueue items first
        const batch = [];
        while (batch.length < BATCH && priorityQueue.length > 0) {
            batch.push(priorityQueue.shift());
        }
        while (batch.length < BATCH && enrichmentQueue.length > 0) {
            const record = enrichmentQueue.shift();
            // Skip if already processed via priorityQueue
            if (!record._needsExif) continue;
            batch.push(record);
        }
        if (batch.length === 0) break;

        const results = await Promise.all(batch.map(r => enrichRecord(r)));
        for (const ok of results) {
            if (ok) enriched++;
            else failed++;
        }

        // Thumbnail pre-warming now runs independently at startup (preWarmAllThumbnails).
        // No need to queue from enrichment — thumbnails don't depend on EXIF data.

        enrichmentDone += batch.length;
        sinceLastSave += batch.length;

        // Periodic progress logging
        if (enrichmentDone % 100 === 0 || (priorityQueue.length === 0 && enrichmentQueue.length === 0)) {
            const pqLen = priorityQueue.length;
            const pqMsg = pqLen > 0 ? ` [${pqLen} priority remaining]` : '';
            const twMsg = thumbWarmRunning ? ` [${thumbsWarmed}/${thumbWarmTotal} thumbs]` : '';
            process.stdout.write(`\r[background] EXIF: ${enrichmentDone}/${enrichmentTotal} (${enriched} enriched, ${failed} failed)${pqMsg}${twMsg}`);
        }

        // Periodic index save to persist progress
        if (sinceLastSave >= SAVE_INTERVAL) {
            saveIndexCache();
            sinceLastSave = 0;
        }
    }

    // Clean up priority tracking
    prioritySet.clear();

    process.stdout.write('\n');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[background] EXIF enrichment complete: ${enriched} enriched, ${failed} failed in ${elapsed}s`);

    // Thumbnail pre-warming runs independently — no need to wait here.

    console.log('[background] Re-import photos in the app to pick up GPS coordinates and corrected dates.');
    saveIndexCache();
    exifEnrichmentStatus = 'done';
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

(async function main() {
    // Validate photos folder
    if (!fs.existsSync(PHOTOS_FOLDER)) {
        console.error(`\nPhoto folder not found: ${PHOTOS_FOLDER}`);
        console.error('');
        console.error('Specify the path to your photos folder:');
        console.error('  node server-windows.js --folder "C:\\Users\\You\\Pictures\\iCloud Photos\\Photos"');
        console.error('');
        process.exit(1);
    }

    // Check Sharp HEIC support
    let sharpHeicSupported = false;
    try {
        // Probe Sharp for HEIC input format support
        const formats = sharp.format || {};
        if (formats.heif && formats.heif.input && formats.heif.input.file) {
            sharpHeicSupported = true;
        } else {
            // Sharp's built-in libvips should include HEIC via libheif on all platforms
            const sharpMeta = sharp.versions || {};
            // If heif version is reported, it's supported
            if (sharpMeta.heif) sharpHeicSupported = true;
        }
    } catch (_) {}

    // Scan folder and build index
    await scanFolder();

    // Count types
    let photoCount = 0, videoCount = 0, placeholderCount = 0;
    for (const r of photoIndex.values()) {
        if (r.available === false) { placeholderCount++; continue; }
        if (r.type === 'video') videoCount++;
        else photoCount++;
    }

    // Check WIC HEIC support (Windows-native HEIF/HEVC codec)
    try {
        wicHeicAvailable = await checkWicHeicSupport();
    } catch (_) {
        wicHeicAvailable = false;
    }

    // Start server — build HEIC status line showing fallback chain
    const heicDecoders = [];
    if (wicHeicAvailable) heicDecoders.push('WIC (Windows-native, fastest)');
    if (heicConvert) heicDecoders.push('heic-convert (WASM fallback)');
    if (sharpHeicSupported) heicDecoders.push('Sharp/libheif');
    if (ffmpegPath) heicDecoders.push('ffmpeg (last resort)');
    const heicStatus = heicDecoders.length > 0
        ? heicDecoders.join(' → ')
        : 'no HEIC decoder — HEIC photos will fail';

    console.log('');
    console.log('Arc Photo Server (Windows)');
    console.log(`Folder:  ${PHOTOS_FOLDER}`);
    console.log(`Media:   ${photoIndex.size.toLocaleString()} total (${photoCount.toLocaleString()} photos, ${videoCount.toLocaleString()} videos` +
        (placeholderCount > 0 ? `, ${placeholderCount.toLocaleString()} iCloud placeholders` : '') + ')');
    console.log(`Cache:   ${CACHE_DIR}`);
    console.log(`ffmpeg:  ${ffmpegPath || 'not found (video thumbnails will fail)'}`);
    console.log(`HEIC:    ${heicStatus}`);

    app.listen(PORT, '127.0.0.1', () => {
        console.log(`Server:  http://127.0.0.1:${PORT}`);
        console.log('\nReady. Keep this running while using Arc Diary Reader.');

        // Background tasks — run AFTER the server is accepting requests.
        // These do NOT block the server; photos are usable immediately.

        // 1. Correct placeholder dates via Windows Shell DateTaken
        if (placeholderCount > 0) {
            correctPlaceholderDatesInBackground().catch(err => {
                console.warn('[background] Date correction failed:', err.message);
                datesCorrectionStatus = 'failed';
            });
        }

        // 2. Thumbnail pre-warming does NOT auto-start. It begins after the
        //    user's first month navigation (batchWarmMonth triggers it on
        //    completion). This avoids resource contention at startup between
        //    EXIF enrichment, WIC batch conversion, and Sharp processing.

        // 3. Enrich records with EXIF metadata (GPS, camera, dimensions)
        //    This reads actual file content, which may trigger iCloud downloads.
        //    It runs slowly in small batches so it doesn't saturate bandwidth.
        enrichExifInBackground().catch(err => {
            console.warn('[background] EXIF enrichment failed:', err.message);
            exifEnrichmentStatus = 'done';
        });
    });
})();
