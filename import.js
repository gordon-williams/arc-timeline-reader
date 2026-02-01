// =====================================================
// Import Module - Handles all data import functionality
// Separated from app.js for maintainability
// =====================================================

(() => {
    'use strict';

    // Dependencies injected from app.js
    let deps = null;

    // Module state
    let importAddedDays = [];
    let importUpdatedDays = [];
    let importChangedItemIds = new Set(); // itemIds that were added or modified in last import
    let lastImportReport = '';

    /**
     * Initialize the import module with dependencies from app.js
     * @param {Object} dependencies - Required dependencies
     */
    function init(dependencies) {
        deps = dependencies;

        // Expose public API
        // Note: Backup import functions (importFromBackupDir, importFromBackupFiles) remain in app.js
        // because they have complex incremental sync logic that's tightly coupled to app state
        window.ArcImport = {
            importFilesToDatabase,
            importMoreFiles,
            getImportAddedDays: () => importAddedDays,
            getImportUpdatedDays: () => importUpdatedDays,
            getImportChangedItemIds: () => importChangedItemIds,
            isItemChanged: (itemId) => importChangedItemIds.has(itemId)
        };

        logInfo('📦 Import module initialized');
    }

    // ========================================
    // Core Import Functions
    // ========================================

    /**
     * Generate a hash for a single timeline item to detect changes
     * Uses actual stored values (not normalized) to detect real differences
     */
    function generateItemHash(item) {
        // Use actual stored values - don't normalize, so we detect real changes
        const type = item.activityType || '';
        const place = item.placeId || '';
        const hasNote = item.noteId ? 'N' : '';
        return `${type}:${place}:${hasNote}`;
    }

    /**
     * Compute the differences between old and new day data
     * @param {Object} oldData - Previous day data
     * @param {Object} newData - New day data
     * @param {boolean} trackItemChanges - Only track item-level changes for JSON-to-JSON imports
     * @returns {{ summary: string, changedItemIds: string[] }}
     */
    function computeDayDiff(oldData, newData, trackItemChanges = false) {
        const changes = [];
        const changedItemIds = [];

        const oldItems = oldData?.timelineItems || [];
        const newItems = newData?.timelineItems || [];

        // Build maps by itemId for comparison
        const oldById = new Map(oldItems.map(i => [i.itemId, i]));
        const newById = new Map(newItems.map(i => [i.itemId, i]));

        // Only track item-level changes for JSON-to-JSON imports
        // Backup imports normalize data differently, causing false positives
        if (trackItemChanges) {
            // Find new items (added)
            for (const [id, newItem] of newById) {
                if (!oldById.has(id)) {
                    changedItemIds.push(id);
                }
            }

            // Find modified items (changed hash)
            for (const [id, newItem] of newById) {
                const oldItem = oldById.get(id);
                if (oldItem) {
                    const oldHash = generateItemHash(oldItem);
                    const newHash = generateItemHash(newItem);
                    if (oldHash !== newHash) {
                        changedItemIds.push(id);
                    }
                }
            }
        }

        // Item count changes (for summary)
        if (oldItems.length !== newItems.length) {
            const diff = newItems.length - oldItems.length;
            if (diff > 0) {
                changes.push(`+${diff} item${diff > 1 ? 's' : ''}`);
            } else {
                changes.push(`${diff} item${diff < -1 ? 's' : ''}`);
            }
        }

        // Check for activity type changes (for summary)
        const typeChanges = [];
        for (const [id, newItem] of newById) {
            const oldItem = oldById.get(id);
            if (oldItem) {
                const oldType = oldItem.activityType || (oldItem.isVisit ? 'visit' : 'unknown');
                const newType = newItem.activityType || (newItem.isVisit ? 'visit' : 'unknown');
                if (oldType !== newType) {
                    typeChanges.push(`${oldType}→${newType}`);
                }
            }
        }
        if (typeChanges.length > 0) {
            if (typeChanges.length <= 2) {
                changes.push(typeChanges.join(', '));
            } else {
                changes.push(`${typeChanges.length} type changes`);
            }
        }

        // Check for place changes (for summary)
        let placeChanges = 0;
        for (const [id, newItem] of newById) {
            const oldItem = oldById.get(id);
            if (oldItem && oldItem.placeId !== newItem.placeId) {
                placeChanges++;
            }
        }
        if (placeChanges > 0) {
            changes.push(`${placeChanges} place${placeChanges > 1 ? 's' : ''} reassigned`);
        }

        // Check for note changes (for summary)
        let notesAdded = 0;
        let notesRemoved = 0;
        for (const [id, newItem] of newById) {
            const oldItem = oldById.get(id);
            if (oldItem) {
                const hadNote = !!oldItem.noteId;
                const hasNote = !!newItem.noteId;
                if (!hadNote && hasNote) notesAdded++;
                if (hadNote && !hasNote) notesRemoved++;
            }
        }
        if (notesAdded > 0) changes.push(`+${notesAdded} note${notesAdded > 1 ? 's' : ''}`);
        if (notesRemoved > 0) changes.push(`-${notesRemoved} note${notesRemoved > 1 ? 's' : ''}`);

        // If no specific changes detected but hash differs, generic message
        if (changes.length === 0) {
            changes.push('content updated');
        }

        return {
            summary: changes.join(', '),
            changedItemIds
        };
    }

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
            const place = item.placeId?.substring(0, 8) || '';
            const hasNote = item.noteId ? 'N' : '';
            return `${type}:${place}:${hasNote}`;
        });

        return parts.join('|');
    }

    /**
     * Import day data to IndexedDB (with timestamp and content comparison)
     * @param {string} dayKey - Day key (YYYY-MM-DD)
     * @param {string} monthKey - Month key (YYYY-MM)
     * @param {Object} dayData - Day data to import
     * @param {string} sourceFile - Source filename
     * @param {number} lastUpdated - File modification timestamp
     * @param {Map} existingMetadata - Pre-loaded metadata for O(1) lookups
     * @returns {Promise<{action: string, dayKey: string, diff?: string}>}
     */
    async function importDayToDB(dayKey, monthKey, dayData, sourceFile, lastUpdated, existingMetadata = null) {
        const db = deps.getDB();
        if (!db) throw new Error('Database not initialized');

        // Check if day exists and compare timestamps + content
        let existingMeta = null;
        let dayExists = false;
        let existingData = null;
        let existingSourceFile = null;

        if (existingMetadata) {
            existingMeta = existingMetadata.get(dayKey);
            dayExists = existingMeta !== undefined;
            if (existingMeta) {
                existingSourceFile = existingMeta.sourceFile;
            }
        } else {
            const existing = await deps.getDayFromDB(dayKey);
            if (existing) {
                existingMeta = {
                    lastUpdated: existing.lastUpdated,
                    // Use stored hash if available, compute for old records without it
                    contentHash: existing.contentHash || generateDayHash(existing.data)
                };
                existingData = existing.data;
                existingSourceFile = existing.sourceFile;
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

            // Fetch existing data for diff if we don't have it yet
            if (!existingData) {
                const existing = await deps.getDayFromDB(dayKey);
                existingData = existing?.data;
                existingSourceFile = existing?.sourceFile;
            }
        }

        // Compute hash for the new data to store with the record
        const contentHash = generateDayHash(dayData);

        // Compute diff if updating - only track item-level changes for JSON-to-JSON imports
        // Backup imports normalize data differently, causing false positives
        const isJsonToJson = existingSourceFile &&
            !existingSourceFile.includes('backup') &&
            !sourceFile.includes('backup');
        const diff = (dayExists && existingData) ? computeDayDiff(existingData, dayData, isJsonToJson) : null;

        return new Promise((resolve, reject) => {
            const tx = db.transaction(['days'], 'readwrite');
            const store = tx.objectStore('days');

            const dayRecord = {
                dayKey,
                monthKey,
                lastUpdated,
                sourceFile,
                contentHash,
                data: dayData
            };

            store.put(dayRecord);

            tx.oncomplete = () => {
                const action = dayExists ? 'updated' : 'added';
                resolve({ action, dayKey, diff });
            };

            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Get day metadata from IndexedDB for import comparison
     * Uses stored contentHash when available, falls back to computing for old records
     * @returns {Promise<Map>} Map<dayKey, {lastUpdated, contentHash}>
     */
    async function getDayMetadataFromDB() {
        const db = deps.getDB();
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
                        contentHash: day.contentHash || generateDayHash(day.data),
                        // Track source for JSON-to-JSON change detection
                        sourceFile: day.sourceFile || null
                    });
                    cursor.continue();
                } else {
                    resolve(metadata);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Get all day keys from IndexedDB (lightweight)
     */
    async function getAllDayKeysFromDB() {
        const db = deps.getDB();
        if (!db) return [];

        return new Promise((resolve, reject) => {
            const tx = db.transaction(['days'], 'readonly');
            const store = tx.objectStore('days');
            const req = store.getAllKeys();

            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    // ========================================
    // Daily JSON Import (from Arc Export folder)
    // ========================================

    /**
     * Import files to IndexedDB with sync logic
     * Main entry point for daily JSON import
     */
    async function importFilesToDatabase() {
        const selectedFiles = deps.getSelectedFiles();

        if (!selectedFiles.length) {
            alert('Please select a folder containing daily JSON files');
            return;
        }

        deps.setCancelProcessing(false);

        // Get UI elements
        const fileInputSection = document.getElementById('fileInputSection');
        const progress = document.getElementById('progress');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const cancelBtn = document.getElementById('cancelBtn');
        const logDiv = document.getElementById('log');
        const results = document.getElementById('results');

        // Hide the import tile and legacy results panel, show the log report
        if (fileInputSection) fileInputSection.style.display = 'none';
        if (results) results.style.display = 'none';

        progress.style.display = 'block';
        cancelBtn.style.display = 'block';
        logDiv.style.display = 'block';
        logDiv.innerHTML = '';

        // Clear previous import tags
        importAddedDays = [];
        importUpdatedDays = [];

        // Memory flush
        if (typeof window.gc === 'function') {
            window.gc();
        }
        await new Promise(r => setTimeout(r, 100));

        deps.addLog(`Starting import to database...`);
        deps.addLog(`Found ${selectedFiles.length} daily JSON files`);

        // Check if force full rescan is enabled
        const forceFullRescan = document.getElementById('forceFullRescan')?.checked || false;

        // Get last successful scan time
        const lastScanTime = forceFullRescan ? null : await deps.getMetadata('lastSync');
        if (forceFullRescan) {
            deps.addLog(`⚠️ Force full rescan enabled - ignoring last scan time`);
        } else if (lastScanTime) {
            const lastScanDate = new Date(lastScanTime).toLocaleString();
            deps.addLog(`Last scan: ${lastScanDate}`);
        } else {
            deps.addLog(`First scan - importing all files`);
        }

        // Filter files by valid date format
        const validFiles = selectedFiles.filter(file => {
            const match = file.name.match(/(\d{4}-\d{2}-\d{2})\.json\.gz/);
            return !!match;
        });

        deps.addLog(`${validFiles.length} valid daily JSON files found`);

        // Only process files modified since last scan
        const filesToProcess = lastScanTime
            ? validFiles.filter(file => file.lastModified > lastScanTime)
            : validFiles;

        const skippedByModDate = validFiles.length - filesToProcess.length;

        // Report scan results
        deps.addLog(`\n📋 Scan Results:`);
        deps.addLog(`  Total files scanned: ${validFiles.length}`);
        deps.addLog(`  Files to import: ${filesToProcess.length}`);
        deps.addLog(`  Files skipped (unchanged): ${skippedByModDate}`);

        if (filesToProcess.length === 0) {
            deps.addLog(`\n✅ All files up to date - nothing to import`);

            if (validFiles.length > 0) {
                const dates = validFiles.map(f => f.name.match(/(\d{4}-\d{2}-\d{2})/)[1]).sort();
                deps.addLog(`  Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
            }

            if (!forceFullRescan) {
                await deps.saveMetadata('lastSync', Date.now());
            }

            const forceCheckbox = document.getElementById('forceFullRescan');
            if (forceCheckbox) forceCheckbox.checked = false;

            progress.style.display = 'none';
            cancelBtn.style.display = 'none';
            return;
        }

        // Show files to import
        deps.addLog(`\n📂 Files to import (sorted by date):`);

        const sortedFiles = [...filesToProcess].sort((a, b) => {
            const dateA = a.name.match(/(\d{4}-\d{2}-\d{2})/)[1];
            const dateB = b.name.match(/(\d{4}-\d{2}-\d{2})/)[1];
            return dateA.localeCompare(dateB);
        });

        if (sortedFiles.length <= 20) {
            sortedFiles.forEach(file => {
                const modDate = new Date(file.lastModified).toLocaleString();
                deps.addLog(`  • ${file.name} (modified: ${modDate})`);
            });
        } else {
            for (let i = 0; i < 10; i++) {
                const file = sortedFiles[i];
                const modDate = new Date(file.lastModified).toLocaleString();
                deps.addLog(`  • ${file.name} (modified: ${modDate})`);
            }
            deps.addLog(`  ... ${sortedFiles.length - 20} more files ...`);
            for (let i = sortedFiles.length - 10; i < sortedFiles.length; i++) {
                const file = sortedFiles[i];
                const modDate = new Date(file.lastModified).toLocaleString();
                deps.addLog(`  • ${file.name} (modified: ${modDate})`);
            }
        }

        deps.addLog(`\n⏳ Starting import...`);

        // Load existing metadata for O(1) lookups
        deps.addLog(`  Loading existing day metadata...`);
        const existingMetadata = await getDayMetadataFromDB();
        deps.addLog(`  Found ${existingMetadata.size} existing days in database`);

        let syncStats = { added: 0, updated: 0, skipped: 0 };
        let addedDays = [];
        let updatedDays = [];
        let updateDiffs = new Map(); // dayKey -> diff description
        let changedItemIds = new Set(); // itemIds that were added or modified
        let processedFiles = 0;
        let failedFiles = [];

        for (const file of filesToProcess) {
            if (deps.getCancelProcessing()) {
                deps.addLog('Import cancelled', 'error');
                break;
            }

            try {
                const match = file.name.match(/(\d{4}-\d{2}-\d{2})\.json\.gz/);
                const fileDate = match[1];
                const [year, month] = fileDate.split('-');
                const monthKey = `${year}-${month}`;
                const dayKey = fileDate;

                // Decompress and apply fixes
                const data = await deps.decompressFile(file);
                deps.applyImportFixes(data);

                const lastUpdated = file.lastModified;
                const result = await importDayToDB(dayKey, monthKey, data, file.name, lastUpdated, existingMetadata);

                syncStats[result.action]++;
                if (result.action === 'added') {
                    addedDays.push(dayKey);
                } else if (result.action === 'updated') {
                    updatedDays.push(dayKey);
                    if (result.diff) {
                        updateDiffs.set(dayKey, result.diff.summary);
                        // Collect changed itemIds
                        if (result.diff.changedItemIds && result.diff.changedItemIds.length > 0) {
                            for (const itemId of result.diff.changedItemIds) {
                                changedItemIds.add(itemId);
                            }
                        }
                    }
                }

                processedFiles++;
                const percent = Math.round((processedFiles / filesToProcess.length) * 100);
                progressFill.style.width = percent + '%';
                progressFill.textContent = percent + '%';
                progressText.textContent = `Processing: ${file.name} (${processedFiles}/${filesToProcess.length})`;

            } catch (error) {
                failedFiles.push(file.name);
                logError(`Error importing ${file.name}:`, error);
            }
        }

        // Report failed files
        if (failedFiles.length > 0) {
            deps.addLog(`\n⚠️ ${failedFiles.length} files failed to read:`, 'error');
            if (failedFiles.length <= 10) {
                failedFiles.forEach(f => deps.addLog(`  • ${f}`, 'error'));
            } else {
                failedFiles.slice(0, 5).forEach(f => deps.addLog(`  • ${f}`, 'error'));
                deps.addLog(`  ... and ${failedFiles.length - 5} more`, 'error');
            }
            deps.addLog(`\nTip: Re-select the folder and import again to retry failed files.`, 'info');
        }

        // Save last sync time
        await deps.saveMetadata('lastSync', Date.now());

        // Reset force rescan checkbox
        const forceCheckbox = document.getElementById('forceFullRescan');
        if (forceCheckbox) forceCheckbox.checked = false;

        // Sort days chronologically
        addedDays.sort();
        updatedDays.sort();

        // Update module state
        importAddedDays = addedDays.slice();
        importUpdatedDays = updatedDays.slice();
        importChangedItemIds = changedItemIds; // Already a Set

        // Sync to app.js variables (for generateMarkdown to use)
        if (deps.updateImportTracking) {
            logInfo(`📊 Syncing import tracking: ${importAddedDays.length} added, ${importUpdatedDays.length} updated, ${importChangedItemIds.size} changed items`);
            deps.updateImportTracking(importAddedDays, importUpdatedDays, importChangedItemIds);
        }

        // Invalidate cache for affected months
        const affectedMonths = new Set();
        [...addedDays, ...updatedDays].forEach(dayKey => {
            affectedMonths.add(dayKey.substring(0, 7));
        });
        deps.invalidateMonthCache(affectedMonths);

        // Save to IndexedDB for persistence
        await deps.saveMetadata('importAddedDays', addedDays);
        await deps.saveMetadata('importUpdatedDays', updatedDays);
        // Convert Set to Array for JSON storage
        await deps.saveMetadata('importChangedItemIds', [...changedItemIds]);

        // Update analysis data in background
        if (addedDays.length > 0 || updatedDays.length > 0) {
            deps.updateAnalysisDataInBackground([...addedDays, ...updatedDays]);
        }

        // Build and display report with skip breakdown and diffs
        displayImportReport(validFiles.length, addedDays, updatedDays, skippedByModDate, syncStats.skipped, logDiv, updateDiffs);

        // Update UI
        await deps.updateDBStatusDisplay();
        await deps.loadMostRecentMonth();

        // Notify other tabs
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
                // BroadcastChannel not supported
            }
        }

        progress.style.display = 'none';
        cancelBtn.style.display = 'none';

        // Reset file input
        deps.resetFileInput();
    }

    /**
     * Display formatted import report
     * @param {Map} updateDiffs - Map of dayKey -> diff description for updated days
     */
    function displayImportReport(filesScanned, addedDays, updatedDays, skippedByModDate, skippedByHash, logDiv, updateDiffs = new Map()) {
        const formatDateForReport = (dayKey) => {
            const date = new Date(dayKey + 'T00:00:00');
            return date.toLocaleDateString('en-AU', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        };

        const totalSkipped = skippedByModDate + skippedByHash;

        // Build markdown report
        let reportLines = [];
        reportLines.push('# Arc Timeline Import Report');
        reportLines.push(`**Date:** ${new Date().toLocaleString('en-AU')}`);
        reportLines.push(`**Files scanned:** ${filesScanned}`);
        reportLines.push('');

        if (addedDays.length > 0) {
            reportLines.push(`## 📥 Added (${addedDays.length} days)`);
            addedDays.forEach(d => reportLines.push(`- ${formatDateForReport(d)}`));
            reportLines.push('');
        }

        if (updatedDays.length > 0) {
            reportLines.push(`## 🔄 Updated (${updatedDays.length} days)`);
            updatedDays.forEach(d => {
                const diff = updateDiffs.get(d);
                if (diff) {
                    reportLines.push(`- ${formatDateForReport(d)} — ${diff}`);
                } else {
                    reportLines.push(`- ${formatDateForReport(d)}`);
                }
            });
            reportLines.push('');
        }

        if (totalSkipped > 0) {
            reportLines.push(`## ⏭️ Skipped`);
            if (skippedByModDate > 0) {
                reportLines.push(`- ${skippedByModDate} files unchanged since last scan`);
            }
            if (skippedByHash > 0) {
                reportLines.push(`- ${skippedByHash} files with identical content (hash match)`);
            }
        }

        lastImportReport = reportLines.join('\n');

        // Build HTML report
        let reportHtml = `
            <div style="padding: 20px;">
                <h3 style="margin: 0 0 16px 0; color: #333; font-size: 18px;">✅ Import Complete</h3>
                <div style="font-size: 13px; color: #666; margin-bottom: 20px;">
                    ${new Date().toLocaleString('en-AU')} • ${filesScanned} files scanned
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
                        ${updatedDays.map(d => {
                            const diff = updateDiffs.get(d);
                            if (diff) {
                                return `<li style="margin: 4px 0;">${formatDateForReport(d)} <span style="color: #666; font-size: 12px;">— ${diff}</span></li>`;
                            }
                            return `<li style="margin: 4px 0;">${formatDateForReport(d)}</li>`;
                        }).join('')}
                    </ul>
                </div>`;
        }

        if (totalSkipped > 0) {
            let skipDetails = [];
            if (skippedByModDate > 0) {
                skipDetails.push(`${skippedByModDate} unchanged since last scan`);
            }
            if (skippedByHash > 0) {
                skipDetails.push(`${skippedByHash} identical content (hash match)`);
            }
            reportHtml += `
                <div style="color: #666; font-size: 13px;">
                    ⏭️ Skipped: ${skipDetails.join(', ')}
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
    }

    /**
     * Import More Files button handler
     */
    function importMoreFiles() {
        // Close location search popup if open
        if (typeof window.closeSearchPopup === 'function') {
            window.closeSearchPopup();
        }

        const logDiv = document.getElementById('log');
        if (logDiv) logDiv.style.display = 'none';

        deps.resetFileInput();
        document.getElementById('fileInputSection').style.display = 'block';
        document.getElementById('fileInputSection').scrollIntoView({ behavior: 'smooth' });
    }

    // ========================================
    // Backup Import (from Arc iCloud backup)
    // ========================================

    /**
     * Helper: Order items by linked list (previousItemId/nextItemId)
     */
    function orderItemsByLinkedList(items) {
        if (!items || items.length === 0) return [];
        if (items.length === 1) return items;

        const byId = new Map();
        const byPrevId = new Map();

        for (const item of items) {
            if (item.itemId) {
                byId.set(item.itemId, item);
            }
            if (item.previousItemId) {
                byPrevId.set(item.previousItemId, item);
            }
        }

        const heads = [];
        for (const item of items) {
            if (!item.previousItemId || !byId.has(item.previousItemId)) {
                heads.push(item);
            }
        }

        if (heads.length === 0) {
            heads.push(items[0]);
        }

        const ordered = [];
        const visited = new Set();

        for (const head of heads) {
            let current = head;
            while (current && !visited.has(current.itemId)) {
                visited.add(current.itemId);
                ordered.push(current);

                if (current.nextItemId && byId.has(current.nextItemId)) {
                    current = byId.get(current.nextItemId);
                } else {
                    current = byPrevId.get(current.itemId);
                }
            }
        }

        for (const item of items) {
            if (!visited.has(item.itemId)) {
                ordered.push(item);
            }
        }

        return ordered;
    }

    /**
     * Helper: Read gzipped file as JSON (File System Access API)
     */
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

    /**
     * Helper: Read file as JSON (File System Access API)
     */
    async function readFileAsJson(fileHandle) {
        try {
            const file = await fileHandle.getFile();
            const text = await file.text();
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    /**
     * Helper: Iterate JSON files from hex-structured directories
     */
    async function* readJsonFilesFromHexDirs(dirHandle) {
        for await (const [name, handle] of dirHandle.entries()) {
            if (handle.kind === 'directory' && /^[0-9A-Fa-f]$/.test(name)) {
                for await (const [fileName, fileHandle] of handle.entries()) {
                    if (fileHandle.kind === 'file' && fileName.endsWith('.json')) {
                        yield fileHandle;
                    }
                }
            }
        }
    }

    /**
     * Import from backup using File System Access API (Chrome/Edge)
     */
    async function importFromBackupDir(dirHandle) {
        deps.setCancelProcessing(false);

        const fileInputSection = document.getElementById('fileInputSection');
        const progress = document.getElementById('progress');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const cancelBtn = document.getElementById('cancelBtn');
        const logDiv = document.getElementById('log');

        if (fileInputSection) fileInputSection.style.display = 'none';

        progress.style.display = 'block';
        cancelBtn.style.display = 'block';
        logDiv.style.display = 'block';
        logDiv.innerHTML = '';

        importAddedDays = [];
        importUpdatedDays = [];

        deps.addLog('🔄 Starting backup import (File System Access API)...');

        const forceRescan = document.getElementById('backupForceRescan')?.checked || false;
        const missingOnly = document.getElementById('backupMissingOnly')?.checked || false;
        const lastBackupSync = forceRescan ? null : await deps.getMetadata('lastBackupSync');

        if (missingOnly) {
            deps.addLog('🛡️ Missing days only - existing data will not be modified');
        }
        if (forceRescan) {
            deps.addLog('⚠️ Force rescan enabled - reimporting all data');
        } else if (lastBackupSync) {
            deps.addLog(`📅 Last backup sync: ${lastBackupSync}`);
        }

        try {
            // Get directory handles
            const timelineDir = await dirHandle.getDirectoryHandle('TimelineItem');
            const placeDir = await dirHandle.getDirectoryHandle('Place').catch(() => null);
            const noteDir = await dirHandle.getDirectoryHandle('Note').catch(() => null);
            const sampleDir = await dirHandle.getDirectoryHandle('LocomotionSample').catch(() => null);

            // For "missing only" mode
            let existingDays = new Set();
            if (missingOnly) {
                const allDayKeys = await getAllDayKeysFromDB();
                existingDays = new Set(allDayKeys);
                deps.addLog(`  Database has ${existingDays.size.toLocaleString()} existing days`);
            }

            // Step 1: Load Places (0-5%)
            deps.addLog('\n📍 Loading Places...');
            progressFill.style.width = '0%';
            progressFill.textContent = '0%';
            const placeLookup = new Map();
            if (placeDir) {
                let placeCount = 0;
                for await (const fileHandle of readJsonFilesFromHexDirs(placeDir)) {
                    if (deps.getCancelProcessing()) break;
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
                deps.addLog(`  Loaded ${placeLookup.size.toLocaleString()} places`);

                // Update global placesById
                deps.updatePlacesById(placeLookup);
            }

            if (deps.getCancelProcessing()) {
                deps.addLog('Import cancelled', 'error');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                return;
            }

            // Step 2: Load Notes (5-10%)
            deps.addLog('\n📝 Loading Notes...');
            progressFill.style.width = '5%';
            progressFill.textContent = '5%';
            const noteLookup = new Map();
            if (noteDir) {
                let noteCount = 0;
                for await (const fileHandle of readJsonFilesFromHexDirs(noteDir)) {
                    if (deps.getCancelProcessing()) break;
                    const note = await readFileAsJson(fileHandle);
                    if (note && note.noteId && !note.deleted) {
                        noteLookup.set(note.noteId, note);
                        noteCount++;
                    }
                    if (noteCount % 200 === 0) {
                        progressText.textContent = `Loading notes: ${noteCount.toLocaleString()}...`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
                deps.addLog(`  Loaded ${noteLookup.size.toLocaleString()} notes`);
            }

            if (deps.getCancelProcessing()) {
                deps.addLog('Import cancelled', 'error');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                return;
            }

            // Step 3: Index Timeline Items by day (10-30%)
            deps.addLog('\n📅 Indexing Timeline Items...');
            progressFill.style.width = '10%';
            progressFill.textContent = '10%';

            const itemsByDay = new Map();
            let itemCount = 0;

            for await (const fileHandle of readJsonFilesFromHexDirs(timelineDir)) {
                if (deps.getCancelProcessing()) break;

                const item = await readFileAsJson(fileHandle);
                if (!item || item.deleted) continue;

                // Determine day from startDate
                const startDate = item.startDate;
                if (!startDate) continue;

                const dayKey = startDate.substring(0, 10);

                // Skip if missingOnly and day exists
                if (missingOnly && existingDays.has(dayKey)) continue;

                if (!itemsByDay.has(dayKey)) {
                    itemsByDay.set(dayKey, []);
                }
                itemsByDay.get(dayKey).push(item);
                itemCount++;

                if (itemCount % 1000 === 0) {
                    const pct = 10 + Math.round((itemCount / 100000) * 20);
                    progressFill.style.width = Math.min(pct, 30) + '%';
                    progressFill.textContent = Math.min(pct, 30) + '%';
                    progressText.textContent = `Indexing items: ${itemCount.toLocaleString()}...`;
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            deps.addLog(`  Indexed ${itemCount.toLocaleString()} items across ${itemsByDay.size.toLocaleString()} days`);

            if (deps.getCancelProcessing()) {
                deps.addLog('Import cancelled', 'error');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                return;
            }

            // Step 4: Load GPS samples (30-50%)
            deps.addLog('\n📍 Loading GPS samples...');
            progressFill.style.width = '30%';
            progressFill.textContent = '30%';

            const samplesByItemId = new Map();
            if (sampleDir) {
                let sampleFileCount = 0;
                let totalSamples = 0;

                for await (const [name, handle] of sampleDir.entries()) {
                    if (deps.getCancelProcessing()) break;
                    if (handle.kind !== 'directory' || !/^[0-9A-Fa-f]$/.test(name)) continue;

                    for await (const [fileName, fileHandle] of handle.entries()) {
                        if (deps.getCancelProcessing()) break;
                        if (fileHandle.kind !== 'file') continue;
                        if (!fileName.endsWith('.json') && !fileName.endsWith('.json.gz')) continue;

                        let samples = null;
                        if (fileName.endsWith('.json.gz')) {
                            samples = await readGzippedFileAsJson(fileHandle);
                        } else {
                            samples = await readFileAsJson(fileHandle);
                        }

                        if (samples && Array.isArray(samples)) {
                            for (const sample of samples) {
                                if (sample.timelineItemId && sample.location) {
                                    if (!samplesByItemId.has(sample.timelineItemId)) {
                                        samplesByItemId.set(sample.timelineItemId, []);
                                    }
                                    samplesByItemId.get(sample.timelineItemId).push(sample);
                                    totalSamples++;
                                }
                            }
                        }

                        sampleFileCount++;
                        if (sampleFileCount % 100 === 0) {
                            const pct = 30 + Math.round((sampleFileCount / 5000) * 20);
                            progressFill.style.width = Math.min(pct, 50) + '%';
                            progressFill.textContent = Math.min(pct, 50) + '%';
                            progressText.textContent = `Loading GPS samples: ${sampleFileCount.toLocaleString()} files, ${totalSamples.toLocaleString()} samples...`;
                            await new Promise(r => setTimeout(r, 0));
                        }
                    }
                }

                deps.addLog(`  Loaded ${totalSamples.toLocaleString()} GPS samples from ${sampleFileCount.toLocaleString()} files`);
            }

            if (deps.getCancelProcessing()) {
                deps.addLog('Import cancelled', 'error');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                return;
            }

            // Step 5: Build and save days (50-100%)
            deps.addLog('\n💾 Building and saving days...');
            progressFill.style.width = '50%';
            progressFill.textContent = '50%';

            const sortedDays = Array.from(itemsByDay.keys()).sort();
            let savedCount = 0;
            let addedDays = [];
            let updatedDays = [];

            for (const dayKey of sortedDays) {
                if (deps.getCancelProcessing()) break;

                const items = itemsByDay.get(dayKey);

                // Order by linked list
                const orderedItems = orderItemsByLinkedList(items);

                // Enrich items with place names, notes, samples
                for (const item of orderedItems) {
                    // Place name
                    if (item.placeId && placeLookup.has(item.placeId)) {
                        const place = placeLookup.get(item.placeId);
                        item.place = {
                            placeId: item.placeId,
                            name: place.name,
                            center: place.center
                        };
                    }

                    // Note
                    if (item.noteId && noteLookup.has(item.noteId)) {
                        const note = noteLookup.get(item.noteId);
                        item.note = note.body;
                    }

                    // GPS samples
                    if (samplesByItemId.has(item.itemId)) {
                        item.samples = samplesByItemId.get(item.itemId)
                            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                    }
                }

                // Build day structure
                const dayData = {
                    timelineItems: orderedItems
                };

                // Save to DB
                const monthKey = dayKey.substring(0, 7);
                const result = await importDayToDB(dayKey, monthKey, dayData, 'backup', Date.now(), null);

                if (result.action === 'added') {
                    addedDays.push(dayKey);
                } else if (result.action === 'updated') {
                    updatedDays.push(dayKey);
                }

                savedCount++;
                const pct = 50 + Math.round((savedCount / sortedDays.length) * 50);
                progressFill.style.width = pct + '%';
                progressFill.textContent = pct + '%';
                progressText.textContent = `Saving day ${savedCount}/${sortedDays.length}: ${dayKey}`;

                if (savedCount % 10 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            // Update state
            importAddedDays = addedDays;
            importUpdatedDays = updatedDays;

            // Save metadata
            await deps.saveMetadata('lastBackupSync', new Date().toISOString());
            await deps.saveMetadata('importAddedDays', addedDays);
            await deps.saveMetadata('importUpdatedDays', updatedDays);

            // Invalidate cache
            const affectedMonths = new Set();
            [...addedDays, ...updatedDays].forEach(d => affectedMonths.add(d.substring(0, 7)));
            deps.invalidateMonthCache(affectedMonths);

            // Final report
            deps.addLog(`\n✅ Backup import complete!`);
            deps.addLog(`  Added: ${addedDays.length} days`);
            deps.addLog(`  Updated: ${updatedDays.length} days`);

            // Reset checkboxes
            const forceCheckbox = document.getElementById('backupForceRescan');
            if (forceCheckbox) forceCheckbox.checked = false;
            const missingCheckbox = document.getElementById('backupMissingOnly');
            if (missingCheckbox) missingCheckbox.checked = false;

            // Update UI
            await deps.updateDBStatusDisplay();
            await deps.loadMostRecentMonth();

        } catch (error) {
            deps.addLog(`\n❌ Error during import: ${error.message}`, 'error');
            logError('Backup import error:', error);
        } finally {
            progress.style.display = 'none';
            cancelBtn.style.display = 'none';
        }
    }

    /**
     * Import from backup using FileList (Safari fallback via webkitdirectory)
     */
    async function importFromBackupFiles(files) {
        deps.setCancelProcessing(false);

        const fileInputSection = document.getElementById('fileInputSection');
        const progress = document.getElementById('progress');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const cancelBtn = document.getElementById('cancelBtn');
        const logDiv = document.getElementById('log');

        if (fileInputSection) fileInputSection.style.display = 'none';

        progress.style.display = 'block';
        cancelBtn.style.display = 'block';
        logDiv.style.display = 'block';
        logDiv.innerHTML = '';

        importAddedDays = [];
        importUpdatedDays = [];

        deps.addLog('🔄 Starting backup import (Safari compatibility mode)...');
        deps.addLog('⚠️ This may take longer than Chrome/Edge. Please be patient.');
        deps.addLog('📂 Indexing files...');

        await new Promise(r => setTimeout(r, 50));

        const forceRescan = document.getElementById('backupForceRescan')?.checked || false;
        const missingOnly = document.getElementById('backupMissingOnly')?.checked || false;

        if (missingOnly) {
            deps.addLog('🛡️ Missing days only - existing data will not be modified');
        }
        if (forceRescan) {
            deps.addLog('⚠️ Force rescan enabled - reimporting all data');
        }

        try {
            // Categorize files by subdirectory
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

                if (i > 0 && i % CHUNK_SIZE === 0) {
                    const pct = Math.round((i / totalFiles) * 5);
                    progressFill.style.width = pct + '%';
                    progressFill.textContent = pct + '%';
                    progressText.textContent = `Indexing files: ${i.toLocaleString()}/${totalFiles.toLocaleString()}...`;
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            deps.addLog(`📂 Indexed ${totalFiles.toLocaleString()} files`);
            deps.addLog(`  Timeline items: ${timelineFiles.length.toLocaleString()} files`);
            deps.addLog(`  Places: ${placeFiles.length.toLocaleString()} files`);
            deps.addLog(`  Notes: ${noteFiles.length.toLocaleString()} files`);
            deps.addLog(`  GPS samples: ${sampleFiles.length.toLocaleString()} files`);

            // For "missing only" mode
            let existingDays = new Set();
            if (missingOnly) {
                const allDayKeys = await getAllDayKeysFromDB();
                existingDays = new Set(allDayKeys);
                deps.addLog(`  Database has ${existingDays.size.toLocaleString()} existing days`);
            }

            const SAFARI_BATCH_SIZE = 10;
            const SAFARI_PAUSE_MS = 5;
            const failedFiles = [];

            // Helper to read file as JSON (Safari)
            async function readFileAsJsonSafari(file) {
                try {
                    const text = await file.text();
                    return JSON.parse(text);
                } catch {
                    failedFiles.push(file.name);
                    return null;
                }
            }

            // Helper to read gzipped file (Safari)
            async function readGzippedFileSafari(file) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const decompressed = pako.ungzip(new Uint8Array(arrayBuffer), { to: 'string' });
                    return JSON.parse(decompressed);
                } catch {
                    failedFiles.push(file.name);
                    return null;
                }
            }

            // Step 1: Load Places (5-15%)
            deps.addLog('\n📍 Loading Places...');
            progressFill.style.width = '5%';
            progressFill.textContent = '5%';

            const placeLookup = new Map();
            for (let i = 0; i < placeFiles.length; i += SAFARI_BATCH_SIZE) {
                if (deps.getCancelProcessing()) break;

                const batch = placeFiles.slice(i, i + SAFARI_BATCH_SIZE);
                const results = await Promise.all(batch.map(f => readFileAsJsonSafari(f)));

                for (const place of results) {
                    if (place && place.placeId && !place.deleted) {
                        placeLookup.set(place.placeId, place);
                    }
                }

                if (i % 100 === 0) {
                    const pct = 5 + Math.round((i / placeFiles.length) * 10);
                    progressFill.style.width = pct + '%';
                    progressFill.textContent = pct + '%';
                    progressText.textContent = `Loading places: ${i.toLocaleString()}/${placeFiles.length.toLocaleString()}...`;
                    await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                }
            }
            deps.addLog(`  Loaded ${placeLookup.size.toLocaleString()} places`);
            deps.updatePlacesById(placeLookup);

            if (deps.getCancelProcessing()) {
                deps.addLog('Import cancelled', 'error');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                return;
            }

            // Step 2: Load Notes (15-20%)
            deps.addLog('\n📝 Loading Notes...');
            progressFill.style.width = '15%';
            progressFill.textContent = '15%';

            const noteLookup = new Map();
            for (let i = 0; i < noteFiles.length; i += SAFARI_BATCH_SIZE) {
                if (deps.getCancelProcessing()) break;

                const batch = noteFiles.slice(i, i + SAFARI_BATCH_SIZE);
                const results = await Promise.all(batch.map(f => readFileAsJsonSafari(f)));

                for (const note of results) {
                    if (note && note.noteId && !note.deleted) {
                        noteLookup.set(note.noteId, note);
                    }
                }

                if (i % 50 === 0) {
                    await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                }
            }
            deps.addLog(`  Loaded ${noteLookup.size.toLocaleString()} notes`);

            if (deps.getCancelProcessing()) {
                deps.addLog('Import cancelled', 'error');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                return;
            }

            // Step 3: Index Timeline Items (20-40%)
            deps.addLog('\n📅 Indexing Timeline Items...');
            progressFill.style.width = '20%';
            progressFill.textContent = '20%';

            const itemsByDay = new Map();
            for (let i = 0; i < timelineFiles.length; i += SAFARI_BATCH_SIZE) {
                if (deps.getCancelProcessing()) break;

                const batch = timelineFiles.slice(i, i + SAFARI_BATCH_SIZE);
                const results = await Promise.all(batch.map(f => readFileAsJsonSafari(f)));

                for (const item of results) {
                    if (!item || item.deleted || !item.startDate) continue;

                    const dayKey = item.startDate.substring(0, 10);
                    if (missingOnly && existingDays.has(dayKey)) continue;

                    if (!itemsByDay.has(dayKey)) {
                        itemsByDay.set(dayKey, []);
                    }
                    itemsByDay.get(dayKey).push(item);
                }

                if (i % 500 === 0) {
                    const pct = 20 + Math.round((i / timelineFiles.length) * 20);
                    progressFill.style.width = pct + '%';
                    progressFill.textContent = pct + '%';
                    progressText.textContent = `Indexing items: ${i.toLocaleString()}/${timelineFiles.length.toLocaleString()}...`;
                    await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                }
            }
            deps.addLog(`  Indexed ${itemsByDay.size.toLocaleString()} days`);

            if (deps.getCancelProcessing()) {
                deps.addLog('Import cancelled', 'error');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                return;
            }

            // Step 4: Load GPS samples (40-60%)
            deps.addLog('\n📍 Loading GPS samples...');
            progressFill.style.width = '40%';
            progressFill.textContent = '40%';

            const samplesByItemId = new Map();
            let totalSamples = 0;

            for (let i = 0; i < sampleFiles.length; i += SAFARI_BATCH_SIZE) {
                if (deps.getCancelProcessing()) break;

                const batch = sampleFiles.slice(i, i + SAFARI_BATCH_SIZE);

                for (const file of batch) {
                    let samples = null;
                    if (file.name.endsWith('.json.gz')) {
                        samples = await readGzippedFileSafari(file);
                    } else {
                        samples = await readFileAsJsonSafari(file);
                    }

                    if (samples && Array.isArray(samples)) {
                        for (const sample of samples) {
                            if (sample.timelineItemId && sample.location) {
                                if (!samplesByItemId.has(sample.timelineItemId)) {
                                    samplesByItemId.set(sample.timelineItemId, []);
                                }
                                samplesByItemId.get(sample.timelineItemId).push(sample);
                                totalSamples++;
                            }
                        }
                    }
                }

                if (i % 100 === 0) {
                    const pct = 40 + Math.round((i / sampleFiles.length) * 20);
                    progressFill.style.width = pct + '%';
                    progressFill.textContent = pct + '%';
                    progressText.textContent = `Loading GPS samples: ${i.toLocaleString()}/${sampleFiles.length.toLocaleString()}...`;
                    await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                }
            }
            deps.addLog(`  Loaded ${totalSamples.toLocaleString()} GPS samples`);

            if (deps.getCancelProcessing()) {
                deps.addLog('Import cancelled', 'error');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                return;
            }

            // Step 5: Build and save days (60-100%)
            deps.addLog('\n💾 Building and saving days...');
            progressFill.style.width = '60%';
            progressFill.textContent = '60%';

            const sortedDays = Array.from(itemsByDay.keys()).sort();
            let savedCount = 0;
            let addedDays = [];
            let updatedDays = [];

            for (const dayKey of sortedDays) {
                if (deps.getCancelProcessing()) break;

                const items = itemsByDay.get(dayKey);
                const orderedItems = orderItemsByLinkedList(items);

                // Enrich items
                for (const item of orderedItems) {
                    if (item.placeId && placeLookup.has(item.placeId)) {
                        const place = placeLookup.get(item.placeId);
                        item.place = {
                            placeId: item.placeId,
                            name: place.name,
                            center: place.center
                        };
                    }

                    if (item.noteId && noteLookup.has(item.noteId)) {
                        const note = noteLookup.get(item.noteId);
                        item.note = note.body;
                    }

                    if (samplesByItemId.has(item.itemId)) {
                        item.samples = samplesByItemId.get(item.itemId)
                            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                    }
                }

                const dayData = { timelineItems: orderedItems };
                const monthKey = dayKey.substring(0, 7);
                const result = await importDayToDB(dayKey, monthKey, dayData, 'backup', Date.now(), null);

                if (result.action === 'added') {
                    addedDays.push(dayKey);
                } else if (result.action === 'updated') {
                    updatedDays.push(dayKey);
                }

                savedCount++;
                const pct = 60 + Math.round((savedCount / sortedDays.length) * 40);
                progressFill.style.width = pct + '%';
                progressFill.textContent = pct + '%';
                progressText.textContent = `Saving day ${savedCount}/${sortedDays.length}: ${dayKey}`;

                if (savedCount % 10 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            // Update state
            importAddedDays = addedDays;
            importUpdatedDays = updatedDays;

            // Save metadata
            await deps.saveMetadata('lastBackupSync', new Date().toISOString());
            await deps.saveMetadata('importAddedDays', addedDays);
            await deps.saveMetadata('importUpdatedDays', updatedDays);

            // Invalidate cache
            const affectedMonths = new Set();
            [...addedDays, ...updatedDays].forEach(d => affectedMonths.add(d.substring(0, 7)));
            deps.invalidateMonthCache(affectedMonths);

            // Report failed files
            if (failedFiles.length > 0) {
                deps.addLog(`\n⚠️ ${failedFiles.length} files failed to read`, 'error');
            }

            // Final report
            deps.addLog(`\n✅ Backup import complete!`);
            deps.addLog(`  Added: ${addedDays.length} days`);
            deps.addLog(`  Updated: ${updatedDays.length} days`);

            // Reset checkboxes
            const forceCheckbox = document.getElementById('backupForceRescan');
            if (forceCheckbox) forceCheckbox.checked = false;
            const missingCheckbox = document.getElementById('backupMissingOnly');
            if (missingCheckbox) missingCheckbox.checked = false;

            // Update UI
            await deps.updateDBStatusDisplay();
            await deps.loadMostRecentMonth();

        } catch (error) {
            deps.addLog(`\n❌ Error during import: ${error.message}`, 'error');
            logError('Backup import error:', error);
        } finally {
            progress.style.display = 'none';
            cancelBtn.style.display = 'none';
        }
    }

    // ========================================
    // Module Initialization
    // ========================================
    window.ArcImportModule = { init };

})();
