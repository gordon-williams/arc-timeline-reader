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
    let currentImportType = 'backup'; // 'json' or 'backup'

    /**
     * Initialize the import module with dependencies from app.js
     * @param {Object} dependencies - Required dependencies
     */
    function init(dependencies) {
        deps = dependencies;

        // Expose public API
        window.ArcImport = {
            // JSON daily import
            importFilesToDatabase,
            importMoreFiles,
            // Backup import
            importFromBackupDir,
            importFromBackupFiles,
            selectBackupFolder,
            handleBackupFolderSelected,
            selectImportType,
            setupBackupImportHandler,
            orderItemsByLinkedList,
            // State getters
            getImportAddedDays: () => importAddedDays,
            getImportUpdatedDays: () => importUpdatedDays,
            getImportChangedItemIds: () => importChangedItemIds,
            isItemChanged: (itemId) => importChangedItemIds.has(itemId)
        };

        // Window exposures for inline onclick handlers in index.html
        window.selectImportType = selectImportType;
        window.selectBackupFolder = selectBackupFolder;
        window.handleBackupFolderSelected = handleBackupFolderSelected;

        // Initialize import UI
        selectImportType('backup');
        restoreBackupImportMode();
        setupBackupImportHandler();

        logInfo('📦 Import module initialized');
    }

    // Restore last-used backup import mode from localStorage
    function restoreBackupImportMode() {
        try {
            const savedMode = localStorage.getItem('backupImportMode');
            if (savedMode) {
                const radio = document.querySelector(`input[name="backupImportMode"][value="${savedMode}"]`);
                if (radio) radio.checked = true;
            }
        } catch (e) {}
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
    // IMPORTANT: This must match arc-db.js generateDayHash exactly,
    // otherwise stored hashes won't match computed hashes on re-import.
    function generateDayHash(dayData) {
        const items = dayData?.timelineItems || [];
        if (items.length === 0) return 'empty';

        // Build a string from properties that users can edit in Arc:
        // - Activity type (car, walk, cycling, etc.)
        // - Place assignment (placeId)
        // - Notes (noteId presence indicates a note exists)
        // - Display name (custom titles, place names)
        // - Item count (changes when merging/deleting)
        const parts = items.map(item => {
            const type = item.activityType || (item.isVisit ? 'visit' : 'trip');
            const placeId = item.placeId ?? item.place?.placeId ?? item.place?.id;
            const place = placeId ? String(placeId).slice(0, 8) : '';
            const hasNote = item.noteId ? 'N' : '';
            const label = item.displayName || '';
            return `${type}:${place}:${hasNote}:${label}`;
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
    // Backup Import — UI Handlers
    // ========================================

    function selectImportType(type) {
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
    }

    function setupBackupImportHandler() {
        // Check if File System Access API is available
        const backupWarning = document.getElementById('backupBrowserWarning');
        if (!window.showDirectoryPicker) {
            // Show Safari warning but allow fallback
            if (backupWarning) backupWarning.style.display = 'block';
        }
    }

    // Select backup folder - uses File System Access API (Chrome/Edge) or webkitdirectory fallback (Safari)
    async function selectBackupFolder() {
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
    }

    // Handle files selected via webkitdirectory (Safari fallback)
    async function handleBackupFolderSelected(files) {
        if (!files || files.length === 0) return;

        const backupFileCount = document.getElementById('backupFileCount');
        backupFileCount.innerHTML = `<div style="color: #666;">Validating ${files.length.toLocaleString()} files...</div>`;

        // Yield to let UI update before validation
        await new Promise(r => setTimeout(r, 50));

        // Quick validation: sample files from throughout the list for known backup folders
        let hasLegacyTimelineItem = false;
        let hasArcEditorItems = false;
        const totalFiles = files.length;

        // Check up to 10000 files, sampling evenly throughout
        const samplesToCheck = Math.min(totalFiles, 10000);
        const step = Math.max(1, Math.floor(totalFiles / samplesToCheck));

        for (let i = 0; i < totalFiles && !(hasLegacyTimelineItem || hasArcEditorItems); i += step) {
            const rp = files[i].webkitRelativePath;
            if (rp.includes('/TimelineItem/')) hasLegacyTimelineItem = true;
            if (rp.includes('/items/')) hasArcEditorItems = true;
        }

        // If not found with sampling, do a full scan (string checks are cheap)
        if (!(hasLegacyTimelineItem || hasArcEditorItems)) {
            backupFileCount.innerHTML = `<div style="color: #666;">Full validation scan...</div>`;
            await new Promise(r => setTimeout(r, 10));

            for (let i = 0; i < totalFiles; i++) {
                const rp = files[i].webkitRelativePath;
                if (rp.includes('/TimelineItem/')) hasLegacyTimelineItem = true;
                if (rp.includes('/items/')) hasArcEditorItems = true;
                if (hasLegacyTimelineItem || hasArcEditorItems) {
                    break;
                }
            }
        }

        if (!(hasLegacyTimelineItem || hasArcEditorItems)) {
            backupFileCount.innerHTML = '<div style="color: #d32f2f;">Not a valid backup folder. Expected TimelineItem/ or items/ subdirectory.</div>';
            return;
        }

        backupFileCount.innerHTML = `<div style="color: #388e3c;">✓ Valid backup folder (${files.length.toLocaleString()} files)</div>`;

        // Start import with FileList directly (don't convert to array)
        await importFromBackupFiles(files);
    }

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

            // Validate it has the expected subdirectories (legacy Arc Timeline or Arc Editor)
            const expectedDirs = ['TimelineItem', 'LocomotionSample', 'Place', 'Note', 'items', 'samples', 'places', 'notes'];
            const foundDirs = [];

            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'directory' && expectedDirs.includes(entry.name)) {
                    foundDirs.push(entry.name);
                }
            }

            const hasLegacy = foundDirs.includes('TimelineItem');
            const hasArcEditor = foundDirs.includes('items');
            if (!hasLegacy && !hasArcEditor) {
                backupFileCount.innerHTML = '<div style="color: #d32f2f;">Not a valid backup folder. Expected TimelineItem/ or items/ subdirectory.</div>';
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
    }

    // ========================================
    // Backup Import — Helper Functions
    // ========================================

    // Helper: Read all JSON files from a directory with hex subdirs (TimelineItem, Place, Note)
    async function* readJsonFilesFromHexDirs(parentDirHandle, progressCallback) {
        let fileCount = 0;

        // Support Arc Editor bucket files stored directly in directory root.
        for await (const entry of parentDirHandle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                fileCount++;
                if (progressCallback && fileCount % 1000 === 0) {
                    progressCallback(fileCount);
                }
                yield entry;
            }
        }

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

    // Helper: Get the last N month keys as a Set (e.g. {"2026-02","2026-01"})
    function getRecentMonthKeys(n = 2) {
        const keys = new Set();
        const now = new Date();
        for (let i = 0; i < n; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        return keys;
    }

    // Helper: Get the last N ISO week keys as a Set (e.g. {"2026-W07","2026-W06",...})
    function getRecentWeekKeys(n = 4) {
        const keys = new Set();
        const now = new Date();
        for (let i = 0; i < n; i++) {
            const d = new Date(now.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
            keys.add(getISOWeek(d.toISOString()));
        }
        return keys;
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

    function toRecordArray(jsonValue) {
        if (Array.isArray(jsonValue)) return jsonValue;
        if (jsonValue && typeof jsonValue === 'object') return [jsonValue];
        return [];
    }

    function mapArcEditorActivityType(code) {
        // LocoKit2 ActivityType enum → display activity type
        // Source: https://github.com/sobri909/LocoKit2
        const map = {
            // Special
            '-1': 'unknown',    // unknown
            0: 'unknown',       // bogus
            // Base types
            1: 'stationary',
            2: 'walking',
            3: 'running',
            4: 'cycling',
            5: 'car',
            6: 'airplane',
            // Transport types
            20: 'train',
            21: 'bus',
            22: 'motorcycle',
            23: 'boat',
            24: 'train',        // tram → train
            25: 'tractor',
            26: 'tuktuk',
            27: 'tuktuk',       // songthaew → tuktuk
            28: 'motorcycle',   // scooter → motorcycle
            29: 'train',        // metro → train
            30: 'train',        // cableCar → train
            31: 'train',        // funicular → train
            32: 'train',        // chairlift → train
            33: 'train',        // skiLift → train
            34: 'car',          // taxi → car
            35: 'airplane',     // hotAirBalloon → airplane
            // Active types
            50: 'skateboarding',
            51: 'inlineSkating',
            52: 'snowboarding',
            53: 'skiing',
            54: 'horseback',
            55: 'cycling',      // swimming → cycling
            56: 'walking',      // golf → walking
            57: 'walking',      // wheelchair → walking
            58: 'cycling',      // rowing → cycling
            59: 'cycling',      // kayaking → cycling
            60: 'surfing',
            61: 'hiking'
        };
        return map[code] || 'unknown';
    }

    function normalizeBackupItem(rawItem) {
        if (!rawItem || typeof rawItem !== 'object') return null;

        // Arc Editor schema: { base, trip? | visit? }
        if (rawItem.base && typeof rawItem.base === 'object') {
            const base = rawItem.base;
            const trip = rawItem.trip || null;
            const visit = rawItem.visit || null;
            const activityCode = trip?.confirmedActivityType ?? trip?.classifiedActivityType;
            const center = (visit && visit.latitude != null && visit.longitude != null)
                ? { latitude: visit.latitude, longitude: visit.longitude }
                : null;
            return {
                itemId: base.id || trip?.itemId || visit?.itemId || null,
                isVisit: !!base.isVisit,
                activityType: base.isVisit ? 'stationary' : mapArcEditorActivityType(activityCode),
                manualActivityType: trip?.confirmedActivityType != null,
                startDate: base.startDate || null,
                endDate: base.endDate || null,
                placeId: visit?.placeId || null,
                streetAddress: visit?.streetAddress || null,
                customTitle: visit?.customTitle || null,
                previousItemId: base.previousItemId || null,
                nextItemId: base.nextItemId || null,
                lastSaved: visit?.lastSaved || trip?.lastSaved || base.lastSaved || null,
                deleted: !!base.deleted,
                center
            };
        }

        // Legacy schema (already flattened)
        return {
            ...rawItem,
            itemId: rawItem.itemId || rawItem.id || null,
            isVisit: !!rawItem.isVisit,
            deleted: !!rawItem.deleted
        };
    }

    function normalizeBackupPlace(rawPlace) {
        if (!rawPlace || typeof rawPlace !== 'object') return null;
        if (rawPlace.deleted) return null;
        // Arc Editor: {id, latitude, longitude, radiusMean, name}
        if (rawPlace.id && rawPlace.latitude != null && rawPlace.longitude != null) {
            return {
                placeId: rawPlace.id,
                name: rawPlace.name || '',
                center: { latitude: rawPlace.latitude, longitude: rawPlace.longitude },
                radiusMeters: rawPlace.radiusMean || 50
            };
        }
        // Legacy
        if (rawPlace.placeId) {
            return {
                placeId: rawPlace.placeId,
                name: rawPlace.name || '',
                center: rawPlace.center || null,
                radiusMeters: rawPlace.radiusMeters || rawPlace.radius || 50
            };
        }
        return null;
    }

    function normalizeBackupNote(rawNote) {
        if (!rawNote || typeof rawNote !== 'object') return null;
        if (rawNote.deleted) return null;
        const date = rawNote.date || rawNote.startDate || rawNote.creationDate || null;
        if (!date || !rawNote.body) return null;
        return {
            date,
            body: rawNote.body,
            timelineItemId: rawNote.timelineItemId || null
        };
    }

    function normalizeBackupSample(rawSample, requireTimelineItemId = true) {
        if (!rawSample || typeof rawSample !== 'object') return null;
        const location = rawSample.location || (
            rawSample.latitude != null && rawSample.longitude != null
                ? {
                    latitude: rawSample.latitude,
                    longitude: rawSample.longitude,
                    altitude: rawSample.altitude
                }
                : null
        );
        // Location is always required; timelineItemId is required for Chrome path but
        // optional for Safari path (which matches samples to items by date/time range)
        if (!location) return null;
        if (requireTimelineItemId && !rawSample.timelineItemId) return null;
        return {
            timelineItemId: rawSample.timelineItemId || null,
            location,
            date: rawSample.date,
            movingState: rawSample.movingState,
            classifiedType: rawSample.classifiedType ?? rawSample.classifiedActivityType
        };
    }

    function createBackupImportDiagnostics(mode) {
        return {
            mode,
            format: 'Unknown',
            places: { files: 0, seen: 0, accepted: 0, rejected: 0 },
            notes: { files: 0, seen: 0, accepted: 0, rejected: 0 },
            timeline: { files: 0, seen: 0, accepted: 0, rejected: 0, deleted: 0 },
            samples: { files: 0, seen: 0, accepted: 0, rejected: 0, invalid: 0, outOfScope: 0 }
        };
    }

    function logBackupImportDiagnostics(diag) {
        deps.addLog('\n🧪 Import diagnostics');
        deps.addLog(`  Mode/format: ${diag.mode} / ${diag.format}`);
        deps.addLog(`  Places: files ${diag.places.files}, records ${diag.places.accepted}/${diag.places.seen} accepted (${diag.places.rejected} rejected)`);
        deps.addLog(`  Notes: files ${diag.notes.files}, records ${diag.notes.accepted}/${diag.notes.seen} accepted (${diag.notes.rejected} rejected)`);
        deps.addLog(`  Timeline: files ${diag.timeline.files}, records ${diag.timeline.accepted}/${diag.timeline.seen} accepted (${diag.timeline.rejected} rejected, ${diag.timeline.deleted} deleted)`);
        deps.addLog(`  Samples: files ${diag.samples.files}, records ${diag.samples.accepted}/${diag.samples.seen} accepted (${diag.samples.rejected} rejected: ${diag.samples.invalid} invalid, ${diag.samples.outOfScope} out-of-scope)`);
        // Mirror diagnostics to browser console for easier copy/paste during testing.
        console.log('🧪 Import diagnostics');
        console.log(`  Mode/format: ${diag.mode} / ${diag.format}`);
        console.log(`  Places: files ${diag.places.files}, records ${diag.places.accepted}/${diag.places.seen} accepted (${diag.places.rejected} rejected)`);
        console.log(`  Notes: files ${diag.notes.files}, records ${diag.notes.accepted}/${diag.notes.seen} accepted (${diag.notes.rejected} rejected)`);
        console.log(`  Timeline: files ${diag.timeline.files}, records ${diag.timeline.accepted}/${diag.timeline.seen} accepted (${diag.timeline.rejected} rejected, ${diag.timeline.deleted} deleted)`);
        console.log(`  Samples: files ${diag.samples.files}, records ${diag.samples.accepted}/${diag.samples.seen} accepted (${diag.samples.rejected} rejected: ${diag.samples.invalid} invalid, ${diag.samples.outOfScope} out-of-scope)`);
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

    // ISO week using UTC (prevents local-time week shifts near boundaries)
    function getISOWeekUTC(dateStr) {
        if (!dateStr) return null;
        const date = new Date(dateStr);
        const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        thursday.setUTCDate(thursday.getUTCDate() + (4 - (thursday.getUTCDay() || 7)));
        thursday.setUTCHours(0, 0, 0, 0);
        const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
        const weekNum = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
        return `${thursday.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    }

    function getAdjacentWeekKeys(weekKey) {
        if (!weekKey || !/^\d{4}-W\d{2}$/.test(weekKey)) return [];
        const [yStr, wStr] = weekKey.split('-W');
        const year = Number(yStr);
        const week = Number(wStr);
        if (!year || !week) return [];

        // Compute Monday of the ISO week in UTC
        const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
        const dow = simple.getUTCDay() || 7;
        const isoMonday = new Date(simple);
        isoMonday.setUTCDate(simple.getUTCDate() + (1 - dow));

        const prev = new Date(isoMonday);
        prev.setUTCDate(prev.getUTCDate() - 7);
        const next = new Date(isoMonday);
        next.setUTCDate(next.getUTCDate() + 7);

        return [getISOWeekUTC(prev.toISOString()), getISOWeekUTC(next.toISOString())];
    }

    function getCandidateWeekKeysForItem(itemStartDate) {
        const keys = new Set();
        const localKey = getISOWeek(itemStartDate);
        if (localKey) keys.add(localKey);
        const utcKey = getISOWeekUTC(itemStartDate);
        if (utcKey) keys.add(utcKey);
        for (const k of [localKey, utcKey]) {
            if (!k) continue;
            for (const adj of getAdjacentWeekKeys(k)) {
                if (adj) keys.add(adj);
            }
        }
        return [...keys];
    }

    // ========================================
    // Backup Import — Main Functions
    // ========================================

    // Import from backup using File System Access API
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
        importChangedItemIds = new Set();

        deps.addLog('🔄 Starting backup import (File System Access API)...');

        // Read import mode from radio group
        const importModeEl = document.querySelector('input[name="backupImportMode"]:checked');
        const importMode = importModeEl ? importModeEl.value : 'full';
        try { localStorage.setItem('backupImportMode', importMode); } catch (e) {}
        const forceRescan = (importMode === 'force');
        const recentOnly = (importMode === 'recent');
        const lastBackupSync = forceRescan ? null : await deps.getMetadata('lastBackupSync');

        if (forceRescan) {
            deps.addLog('⚠️ Force rescan enabled - reimporting all data');
        } else if (recentOnly) {
            deps.addLog('⚡ Recent only mode — last 2 months');
        } else if (lastBackupSync) {
            deps.addLog(`📅 Last backup sync: ${lastBackupSync}`);
        }

        try {
            const importDiag = createBackupImportDiagnostics('File System Access API');

            // Get directory handles
            const timelineDir = await dirHandle.getDirectoryHandle('TimelineItem').catch(() => null);
            const arcEditorItemsDir = await dirHandle.getDirectoryHandle('items').catch(() => null);
            const placeDir = await dirHandle.getDirectoryHandle('Place').catch(async () =>
                await dirHandle.getDirectoryHandle('places').catch(() => null)
            );
            const noteDir = await dirHandle.getDirectoryHandle('Note').catch(async () =>
                await dirHandle.getDirectoryHandle('notes').catch(() => null)
            );
            const sampleDir = await dirHandle.getDirectoryHandle('LocomotionSample').catch(async () =>
                await dirHandle.getDirectoryHandle('samples').catch(() => null)
            );
            const activeTimelineDir = timelineDir || arcEditorItemsDir;
            if (!activeTimelineDir) {
                throw new Error('Backup missing TimelineItem/ or items/ folder');
            }
            const backupFormat = arcEditorItemsDir ? 'Arc Editor' : 'Arc Timeline';
            importDiag.format = backupFormat;
            deps.addLog(`📦 Detected backup format: ${backupFormat}`);

            // For "missing only" mode: get existing days first
            let existingDays = new Set();

            // Step 1: Load Places (0-5%)
            deps.addLog('\n📍 Loading Places...');
            progressFill.style.width = '0%';
            progressFill.textContent = '0%';
            const placeLookup = new Map();
            if (placeDir) {
                let placeCount = 0;
                for await (const fileHandle of readJsonFilesFromHexDirs(placeDir)) {
                    if (deps.getCancelProcessing()) break;
                    importDiag.places.files++;
                    const jsonValue = await readFileAsJson(fileHandle);
                    for (const rawPlace of toRecordArray(jsonValue)) {
                        importDiag.places.seen++;
                        const place = normalizeBackupPlace(rawPlace);
                        if (place && place.placeId) {
                            placeLookup.set(place.placeId, place);
                            placeCount++;
                            importDiag.places.accepted++;
                        } else {
                            importDiag.places.rejected++;
                        }
                    }
                    if (placeCount % 500 === 0) {
                        progressText.textContent = `Loading places: ${placeCount.toLocaleString()}...`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
                deps.addLog(`  Loaded ${placeLookup.size.toLocaleString()} places`);

                // Update global placesById for display name lookups
                deps.updatePlacesById(placeLookup);
                logInfo(`📍 Updated placesById with ${placeLookup.size} place names`);
            }

            // Step 2: Load Notes indexed by date (5-10%)
            deps.addLog('\n📝 Loading Notes...');
            progressFill.style.width = '5%';
            progressFill.textContent = '5%';
            const notesByDate = new Map();
            const recentMonths = recentOnly ? getRecentMonthKeys(2) : null;
            if (noteDir) {
                let noteCount = 0;
                let noteFilesSkipped = 0;
                for await (const fileHandle of readJsonFilesFromHexDirs(noteDir)) {
                    if (deps.getCancelProcessing()) break;
                    // In recent-only mode for Arc Editor, skip non-recent month files
                    if (recentMonths && arcEditorItemsDir) {
                        const monthMatch = fileHandle.name.match(/^(\d{4}-\d{2})\.json$/);
                        if (monthMatch && !recentMonths.has(monthMatch[1])) {
                            noteFilesSkipped++;
                            continue;
                        }
                    }
                    importDiag.notes.files++;
                    const jsonValue = await readFileAsJson(fileHandle);
                    for (const rawNote of toRecordArray(jsonValue)) {
                        importDiag.notes.seen++;
                        const note = normalizeBackupNote(rawNote);
                        if (note) {
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
                            importDiag.notes.accepted++;
                        } else {
                            importDiag.notes.rejected++;
                        }
                    }
                    if (noteCount % 500 === 0) {
                        progressText.textContent = `Loading notes: ${noteCount.toLocaleString()}...`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
                deps.addLog(`  Loaded ${noteCount.toLocaleString()} notes`);
                if (noteFilesSkipped > 0) deps.addLog(`  Skipped ${noteFilesSkipped} older month files (recent-only)`);
            }

            // Step 3: Scan TimelineItems (10-60%)
            deps.addLog('\n🗓️ Scanning Timeline Items...');
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
            let itemFilesSkipped = 0;

            // Batch reading for speed
            const BATCH_SIZE = 50;
            let batch = [];

            for await (const fileHandle of readJsonFilesFromHexDirs(activeTimelineDir, (count) => {
                progressText.textContent = `Scanning timeline: ${count.toLocaleString()}...`;
            })) {
                if (deps.getCancelProcessing()) break;

                // In recent-only mode for Arc Editor, skip non-recent month files
                if (recentMonths && arcEditorItemsDir) {
                    const monthMatch = fileHandle.name.match(/^(\d{4}-\d{2})\.json$/);
                    if (monthMatch && !recentMonths.has(monthMatch[1])) {
                        itemFilesSkipped++;
                        continue;
                    }
                }

                batch.push(fileHandle);

                if (batch.length >= BATCH_SIZE) {
                    const results = await Promise.all(batch.map(fh => readFileAsJson(fh)));
                    importDiag.timeline.files += results.length;

                    for (const jsonValue of results) {
                        for (const rawItem of toRecordArray(jsonValue)) {
                            importDiag.timeline.seen++;
                            scannedCount++;
                            const item = normalizeBackupItem(rawItem);
                            if (!item) {
                                importDiag.timeline.rejected++;
                                continue;
                            }

                            if (item.deleted) {
                                skippedDeleted++;
                                importDiag.timeline.deleted++;
                                continue;
                            }

                            if (item.lastSaved && item.lastSaved > maxLastSaved) {
                                maxLastSaved = item.lastSaved;
                            }

                            if (!item.startDate) continue;

                            const startDayKey = deps.getLocalDayKey(item.startDate);
                            const endDayKey = item.endDate ? deps.getLocalDayKey(item.endDate) : startDayKey;

                            // Skip unchanged items, EXCEPT visits that carry naming metadata.
                            // Arc can preserve lastSaved while visit naming fields/place linkage change.
                            const preserveVisitNaming = !!(
                                item.isVisit &&
                                (item.customTitle || item.placeId || item.streetAddress)
                            );
                            const preserveUnresolvedActivity = !!(
                                !item.isVisit &&
                                (!item.activityType || String(item.activityType).toLowerCase() === 'unknown')
                            );
                            if (!(preserveVisitNaming || preserveUnresolvedActivity) && lastBackupSync && item.lastSaved && item.lastSaved <= lastBackupSync) {
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
                                if ((!item.center || item.center.latitude == null || item.center.longitude == null) && place.center) {
                                    item.center = place.center;
                                }
                            }

                            changedItems.push(item);
                            changedItemIds.add(item.itemId);
                            changedDays.add(startDayKey);
                            changedWeeks.add(getISOWeek(item.startDate));
                            importDiag.timeline.accepted++;
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
                importDiag.timeline.files += results.length;
                    for (const jsonValue of results) {
                        for (const rawItem of toRecordArray(jsonValue)) {
                            importDiag.timeline.seen++;
                            scannedCount++;
                            const item = normalizeBackupItem(rawItem);
                        if (!item) {
                            importDiag.timeline.rejected++;
                            continue;
                        }
                            if (item.deleted) {
                                importDiag.timeline.deleted++;
                                continue;
                            }
                            if (item.lastSaved && item.lastSaved > maxLastSaved) {
                                maxLastSaved = item.lastSaved;
                            }
                            if (!item.startDate) continue;

                            const startDayKey = deps.getLocalDayKey(item.startDate);
                            const endDayKey = item.endDate ? deps.getLocalDayKey(item.endDate) : startDayKey;

                            // Keep parity with the main batch path:
                            // skip unchanged items, except visits with naming metadata.
                            const preserveVisitNaming = !!(
                                item.isVisit &&
                                (item.customTitle || item.placeId || item.streetAddress)
                            );
                            const preserveUnresolvedActivity = !!(
                                !item.isVisit &&
                                (!item.activityType || String(item.activityType).toLowerCase() === 'unknown')
                            );
                            if (!(preserveVisitNaming || preserveUnresolvedActivity) && lastBackupSync && item.lastSaved && item.lastSaved <= lastBackupSync) {
                                skippedUnchanged++;
                                continue;
                            }

                            // Attach place info (name/center/radius)
                            if (item.placeId && placeLookup.has(item.placeId)) {
                                const place = placeLookup.get(item.placeId);
                                item.place = {
                                    name: place.name,
                                    center: place.center,
                                    radiusMeters: place.radiusMeters || place.radius || 50
                                };
                                if ((!item.center || item.center.latitude == null || item.center.longitude == null) && place.center) {
                                    item.center = place.center;
                                }
                            }

                            changedItems.push(item);
                            changedItemIds.add(item.itemId);
                            changedDays.add(startDayKey);
                            changedWeeks.add(getISOWeek(item.startDate));
                        importDiag.timeline.accepted++;
                    }
                }
            }

            deps.addLog(`  Scanned ${scannedCount.toLocaleString()} items`);
            if (itemFilesSkipped > 0) deps.addLog(`  Skipped ${itemFilesSkipped} older month files (recent-only)`);
            deps.addLog(`  To import: ${changedItems.length.toLocaleString()} items across ${changedDays.size.toLocaleString()} days`);
            if (skippedExisting > 0) deps.addLog(`  Skipped: ${skippedExisting.toLocaleString()} (days exist)`);
            if (skippedUnchanged > 0) deps.addLog(`  Skipped: ${skippedUnchanged.toLocaleString()} unchanged`);
            if (includedForSpanning > 0) deps.addLog(`  Included: ${includedForSpanning.toLocaleString()} spanning visits into missing days`);

            if (changedItems.length === 0) {
                deps.addLog('\n✅ No new data to import');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                return;
            }

            // Step 4: Load GPS samples for needed weeks only (60-80%)
            deps.addLog('\n📍 Loading GPS samples...');
            progressFill.style.width = '60%';
            progressFill.textContent = '60%';
            const samplesByItemId = new Map();

            if (sampleDir) {
                let weekCount = 0;
                let sampleCount = 0;

                for await (const entry of sampleDir.values()) {
                    if (deps.getCancelProcessing()) break;
                    if (entry.kind !== 'file') continue;

                    // Support both gzipped (.json.gz) and plain (.json) sample files
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
                    importDiag.samples.files++;

                    if (Array.isArray(samples)) {
                        for (const sample of samples) {
                            importDiag.samples.seen++;
                            const normalizedSample = normalizeBackupSample(sample);
                            if (!normalizedSample) {
                                importDiag.samples.rejected++;
                                importDiag.samples.invalid++;
                                continue;
                            }
                            if (!changedItemIds.has(normalizedSample.timelineItemId)) {
                                importDiag.samples.rejected++;
                                importDiag.samples.outOfScope++;
                                continue;
                            }
                            if (!samplesByItemId.has(normalizedSample.timelineItemId)) {
                                samplesByItemId.set(normalizedSample.timelineItemId, []);
                            }
                            samplesByItemId.get(normalizedSample.timelineItemId).push({
                                location: normalizedSample.location,
                                date: normalizedSample.date,
                                movingState: normalizedSample.movingState,
                                classifiedType: normalizedSample.classifiedType
                            });
                            sampleCount++;
                            importDiag.samples.accepted++;
                        }
                    }
                    weekCount++;

                    if (weekCount % 20 === 0) {
                        progressText.textContent = `Loading GPS samples: ${weekCount} weeks, ${sampleCount.toLocaleString()} samples...`;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
                deps.addLog(`  Loaded ${sampleCount.toLocaleString()} GPS samples from ${weekCount} week files`);
            }

            // Step 5: Order items by linked list, then group by day (80-100%)
            // CRITICAL: Use previousItemId/nextItemId order, NEVER sort by startDate
            deps.addLog('\n🔗 Ordering by timeline links...');
            progressFill.style.width = '80%';
            progressFill.textContent = '80%';
            const orderedItems = orderItemsByLinkedList(changedItems);
            deps.addLog(`  Ordered ${orderedItems.length} items by linked list`);

            // Group items by day (preserving linked list order)
            // For spanning visits, add them to ALL days they cover
            deps.addLog('\n💾 Saving to database...');

            const itemsByDate = new Map();
            let spanningVisitCount = 0;
            let extraDaysFromSpanning = 0;

            for (const item of orderedItems) {
                const startDayKey = deps.getLocalDayKey(item.startDate);
                const endDayKey = item.endDate ? deps.getLocalDayKey(item.endDate) : startDayKey;

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
                deps.addLog(`  Found ${spanningVisitCount} spanning visits → ${extraDaysFromSpanning} extra days`);
            }

            const sortedDays = Array.from(itemsByDate.keys()).sort();
            let savedDays = 0;
            let addedDays = [];
            let updatedDays = [];

            // Load existing day metadata for content comparison
            deps.addLog('\n💾 Saving to database...');
            const existingMetadata = await getDayMetadataFromDB();
            deps.addLog(`  Comparing against ${existingMetadata.size} existing days`);

            for (const dayKey of sortedDays) {
                if (deps.getCancelProcessing()) break;

                let items = itemsByDate.get(dayKey);
                const monthKey = dayKey.substring(0, 7);

                // CRITICAL: For incremental updates, merge new items with existing items
                // Otherwise new items get skipped because existing day has more items
                if (existingMetadata.has(dayKey) && !forceRescan) {
                    const existingDay = await deps.getDayFromDB(dayKey);
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
                        activityType: deps.getStoredActivityTypeForTimelineItem(item),
                        displayName: deps.getStoredDisplayNameForTimelineItem(item),
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
                            // Prefer direct timelineItemId match (Arc Editor v2)
                            if (n.timelineItemId) {
                                return n.timelineItemId === item.itemId;
                            }
                            // Fall back to time-range matching (older notes)
                            const noteTime = new Date(n.date).getTime();
                            const itemStart = new Date(item.startDate).getTime();
                            const itemEnd = item.endDate ? new Date(item.endDate).getTime() : itemStart + 86400000;
                            return noteTime >= itemStart && noteTime < itemEnd;
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
            await deps.saveMetadata('lastBackupSync', maxLastSaved);


            importAddedDays = addedDays;
            importUpdatedDays = updatedDays;

            // Invalidate cache
            const affectedMonths = new Set();
            [...addedDays, ...updatedDays].forEach(dk => affectedMonths.add(dk.substring(0, 7)));
            deps.invalidateMonthCache(affectedMonths);

            await deps.saveMetadata('importAddedDays', addedDays);
            await deps.saveMetadata('importUpdatedDays', updatedDays);

            if (addedDays.length > 0 || updatedDays.length > 0) {
                deps.updateAnalysisDataInBackground([...addedDays, ...updatedDays]);
            }

            // Sync to app.js variables (for generateMarkdown to use)
            if (deps.updateImportTracking) {
                deps.updateImportTracking(importAddedDays, importUpdatedDays, importChangedItemIds);
            }

            logBackupImportDiagnostics(importDiag);

            if (addedDays.length === 0 && updatedDays.length === 0) {
                deps.addLog('\n✅ Import complete — no new or changed days');
            } else {
                const parts = [];
                if (addedDays.length > 0) parts.push(`${addedDays.length} added`);
                if (updatedDays.length > 0) parts.push(`${updatedDays.length} updated`);
                deps.addLog(`\n✅ Import complete — ${parts.join(', ')}`);
                if (addedDays.length > 0) {
                    deps.addLog(`  New data range: ${addedDays[0]} to ${addedDays[addedDays.length - 1]}`);
                }
            }

            progress.style.display = 'none';
            cancelBtn.style.display = 'none';

            // Refresh DB stats — dbStatusSection shows the "Open Diary Reader" button
            await deps.updateDBStatusDisplay();

        } catch (err) {
            deps.addLog(`\n❌ Error: ${err.message}`, 'error');
            console.error('Backup import error:', err);
            progress.style.display = 'none';
            cancelBtn.style.display = 'none';
        }
    }

    // Import from backup using FileList (Safari fallback via webkitdirectory)
    // Uses controlled batching to avoid overwhelming Safari's memory
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
        importChangedItemIds = new Set();

        deps.addLog('🔄 Starting backup import (Safari compatibility mode)...');
        deps.addLog('⚠️ This may take longer than Chrome/Edge. Please be patient.');
        deps.addLog('📂 Indexing files...');

        // Yield to let UI render before heavy file indexing
        if (progressFill) {
            progressFill.style.width = '0%';
            progressFill.textContent = '0%';
        }
        if (progressText) {
            progressText.textContent = 'Indexing files...';
        }
        if (logDiv) {
            logDiv.scrollTop = logDiv.scrollHeight;
            logDiv.getBoundingClientRect(); // force layout before yielding
        }
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => setTimeout(r, 0));

        // Read import mode from radio group
        const safariImportModeEl = document.querySelector('input[name="backupImportMode"]:checked');
        const safariImportMode = safariImportModeEl ? safariImportModeEl.value : 'full';
        try { localStorage.setItem('backupImportMode', safariImportMode); } catch (e) {}
        const forceRescan = (safariImportMode === 'force');
        const recentOnly = (safariImportMode === 'recent');
        const lastBackupSync = forceRescan ? null : await deps.getMetadata('lastBackupSync');

        if (forceRescan) {
            deps.addLog('⚠️ Force rescan enabled - reimporting all data');
        } else if (recentOnly) {
            deps.addLog('⚡ Recent only mode — last 2 months');
        }

        try {
            const importDiag = createBackupImportDiagnostics('Safari File Input');

            // Categorize files by subdirectory (yield periodically to keep UI responsive)
            const placeFiles = [];
            let noteFiles = [];
            let timelineFiles = [];
            let sampleFiles = [];

            const totalFiles = files.length;
            const CHUNK_SIZE = 5000;

            for (let i = 0; i < totalFiles; i++) {
                const file = files[i];
                const path = file.webkitRelativePath;
                if ((path.includes('/TimelineItem/') || path.includes('/items/')) && file.name.endsWith('.json')) {
                    timelineFiles.push(file);
                } else if ((path.includes('/Place/') || path.includes('/places/')) && file.name.endsWith('.json')) {
                    placeFiles.push(file);
                } else if ((path.includes('/Note/') || path.includes('/notes/')) && file.name.endsWith('.json')) {
                    noteFiles.push(file);
                } else if ((path.includes('/LocomotionSample/') || path.includes('/samples/')) && (file.name.endsWith('.json') || file.name.endsWith('.json.gz'))) {
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

            const hasArcEditorPath = timelineFiles.some(f => (f.webkitRelativePath || '').includes('/items/'));
            importDiag.format = hasArcEditorPath ? 'Arc Editor' : 'Arc Timeline';
            deps.addLog(`📦 Detected backup format: ${importDiag.format}`);

            // In recent-only mode for Arc Editor, filter to recent month/week files
            if (recentOnly && hasArcEditorPath) {
                const recentMonths = getRecentMonthKeys(2);
                const origItems = timelineFiles.length;
                const origNotes = noteFiles.length;
                const origSamples = sampleFiles.length;
                timelineFiles = timelineFiles.filter(f => {
                    const m = f.name.match(/^(\d{4}-\d{2})\.json$/);
                    return !m || recentMonths.has(m[1]);
                });
                noteFiles = noteFiles.filter(f => {
                    const m = f.name.match(/^(\d{4}-\d{2})\.json$/);
                    return !m || recentMonths.has(m[1]);
                });
                // Samples are already filtered later by changedWeeks, but pre-filter too
                const recentWeeks = getRecentWeekKeys(4);
                sampleFiles = sampleFiles.filter(f => {
                    const m = f.name.match(/^(\d{4}-W\d{2})/);
                    return !m || recentWeeks.has(m[1]);
                });
                deps.addLog(`⚡ Filtered to ${timelineFiles.length}/${origItems} item files, ${noteFiles.length}/${origNotes} note files, ${sampleFiles.length}/${origSamples} sample files`);
            }

            deps.addLog(`📂 Indexed ${totalFiles.toLocaleString()} files`);
            deps.addLog(`  Timeline items: ${timelineFiles.length.toLocaleString()} files`);
            deps.addLog(`  Places: ${placeFiles.length.toLocaleString()} files`);
            deps.addLog(`  Notes: ${noteFiles.length.toLocaleString()} files`);
            deps.addLog(`  GPS samples: ${sampleFiles.length.toLocaleString()} files`);

            // For "missing only" mode: get existing days first
            let existingDays = new Set();

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
            deps.addLog('\n📍 Loading Places...');
            progressFill.style.width = '0%';
            progressFill.textContent = '0%';
            const placeLookup = new Map();

            for (let i = 0; i < placeFiles.length; i += SAFARI_BATCH_SIZE) {
                if (deps.getCancelProcessing()) break;
                const batch = placeFiles.slice(i, i + SAFARI_BATCH_SIZE);
                const results = await Promise.all(batch.map(f => readFileAsJsonSafari(f)));
                importDiag.places.files += results.length;

                for (const jsonValue of results) {
                    for (const rawPlace of toRecordArray(jsonValue)) {
                        importDiag.places.seen++;
                        const place = normalizeBackupPlace(rawPlace);
                        if (place && place.placeId) {
                            placeLookup.set(place.placeId, place);
                            importDiag.places.accepted++;
                        } else {
                            importDiag.places.rejected++;
                        }
                    }
                }

                if (i % 100 === 0) {
                    progressText.textContent = `Loading places: ${Math.min(i + SAFARI_BATCH_SIZE, placeFiles.length).toLocaleString()}/${placeFiles.length.toLocaleString()}...`;
                    await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                }
            }
            deps.addLog(`  Loaded ${placeLookup.size.toLocaleString()} places`);

            // Update global placesById
            deps.updatePlacesById(placeLookup);

            // Step 2: Load Notes (5-10%)
            deps.addLog('\n📝 Loading Notes...');
            progressFill.style.width = '5%';
            progressFill.textContent = '5%';
            const notesByDate = new Map();

            for (let i = 0; i < noteFiles.length; i += SAFARI_BATCH_SIZE) {
                if (deps.getCancelProcessing()) break;
                const batch = noteFiles.slice(i, i + SAFARI_BATCH_SIZE);
                const results = await Promise.all(batch.map(f => readFileAsJsonSafari(f)));
                importDiag.notes.files += results.length;

                for (const jsonValue of results) {
                    for (const rawNote of toRecordArray(jsonValue)) {
                        importDiag.notes.seen++;
                        const note = normalizeBackupNote(rawNote);
                        if (note) {
                            const noteDate = new Date(note.date);
                            const dayKey = noteDate.getFullYear() + '-' +
                                String(noteDate.getMonth() + 1).padStart(2, '0') + '-' +
                                String(noteDate.getDate()).padStart(2, '0');
                            if (!notesByDate.has(dayKey)) {
                                notesByDate.set(dayKey, []);
                            }
                            notesByDate.get(dayKey).push(note);
                            importDiag.notes.accepted++;
                        } else {
                            importDiag.notes.rejected++;
                        }
                    }
                }

                if (i % 100 === 0) {
                    progressText.textContent = `Loading notes: ${Math.min(i + SAFARI_BATCH_SIZE, noteFiles.length).toLocaleString()}/${noteFiles.length.toLocaleString()}...`;
                    await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
                }
            }
            deps.addLog(`  Loaded notes for ${notesByDate.size.toLocaleString()} days`);

            // Step 3: Scan Timeline Items (10-60%)
            deps.addLog('\n🗓️ Scanning Timeline Items...');
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
                if (deps.getCancelProcessing()) break;
                const batch = timelineFiles.slice(i, i + SAFARI_BATCH_SIZE);
                const results = await Promise.all(batch.map(f => readFileAsJsonSafari(f)));
                importDiag.timeline.files += results.length;

                for (const jsonValue of results) {
                    for (const rawItem of toRecordArray(jsonValue)) {
                        importDiag.timeline.seen++;
                        const item = normalizeBackupItem(rawItem);
                        scannedCount++;
                        if (!item) {
                            importDiag.timeline.rejected++;
                            continue;
                        }

                        if (item.deleted) {
                            skippedDeleted++;
                            importDiag.timeline.deleted++;
                            continue;
                        }

                        if (item.lastSaved && item.lastSaved > maxLastSaved) {
                            maxLastSaved = item.lastSaved;
                        }

                        if (!item.startDate) continue;

                        const startDayKey = deps.getLocalDayKey(item.startDate);
                        const endDayKey = item.endDate ? deps.getLocalDayKey(item.endDate) : startDayKey;

                        if (lastBackupSync && item.lastSaved && item.lastSaved <= lastBackupSync) {
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
                            if ((!item.center || item.center.latitude == null || item.center.longitude == null) && place.center) {
                                item.center = place.center;
                            }
                        }

                        changedItems.push(item);
                        changedDays.add(startDayKey);
                        changedWeeks.add(getISOWeek(item.startDate));
                        importDiag.timeline.accepted++;
                    }
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

            deps.addLog(`  Scanned ${scannedCount.toLocaleString()} items`);
            deps.addLog(`  Found ${changedItems.length.toLocaleString()} changed items in ${changedDays.size.toLocaleString()} days`);
            if (skippedExisting > 0) deps.addLog(`  Skipped ${skippedExisting.toLocaleString()} (existing days)`);
            if (skippedUnchanged > 0) deps.addLog(`  Skipped ${skippedUnchanged.toLocaleString()} (unchanged)`);
            if (skippedDeleted > 0) deps.addLog(`  Skipped ${skippedDeleted.toLocaleString()} (deleted)`);

            if (deps.getCancelProcessing()) {
                deps.addLog('\n⚠️ Import cancelled');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                return;
            }

            if (changedItems.length === 0) {
                deps.addLog('\n✅ No new or changed items found');
                progress.style.display = 'none';
                cancelBtn.style.display = 'none';
                await deps.updateDBStatusDisplay();
                return;
            }

            // Step 4: Load GPS Samples (60-80%)
            deps.addLog('\n📍 Loading GPS samples...');
            progressFill.style.width = '60%';
            progressFill.textContent = '60%';
            const samplesByWeek = new Map();

            // Filter to only needed weeks
            const neededSampleFiles = sampleFiles.filter(file => {
                const weekMatch = file.name.match(/^(\d{4}-W\d{2})/);
                return weekMatch && changedWeeks.has(weekMatch[1]);
            });

            deps.addLog(`  Loading ${neededSampleFiles.length} week files (of ${sampleFiles.length} total)`);

            for (let i = 0; i < neededSampleFiles.length; i++) {
                if (deps.getCancelProcessing()) break;
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
                importDiag.samples.files++;

                if (samples) {
                    const normalizedSamples = [];
                    for (const rawSample of toRecordArray(samples)) {
                        importDiag.samples.seen++;
                        // Safari path matches samples by date/time, not timelineItemId
                        const sample = normalizeBackupSample(rawSample, false);
                        if (sample) {
                            normalizedSamples.push(sample);
                            importDiag.samples.accepted++;
                        } else {
                            importDiag.samples.rejected++;
                            importDiag.samples.invalid++;
                        }
                    }
                    if (normalizedSamples.length > 0) {
                        samplesByWeek.set(weekKey, normalizedSamples);
                    }
                }

                // Update progress (60-80%)
                const samplePercent = Math.round((i / neededSampleFiles.length) * 20);
                const totalPercent = 60 + samplePercent;
                progressFill.style.width = totalPercent + '%';
                progressFill.textContent = totalPercent + '%';
                progressText.textContent = `Loading GPS samples: ${i + 1}/${neededSampleFiles.length}...`;

                await new Promise(r => setTimeout(r, SAFARI_PAUSE_MS));
            }
            deps.addLog(`  Loaded ${samplesByWeek.size.toLocaleString()} weeks of GPS data`);

            // Step 5: Order items and group by day (80-100%)
            deps.addLog('\n💾 Saving to database...');
            progressFill.style.width = '80%';
            progressFill.textContent = '80%';

            const itemsByDay = new Map();
            for (const item of changedItems) {
                const dayKey = deps.getLocalDayKey(item.startDate);
                if (!itemsByDay.has(dayKey)) {
                    itemsByDay.set(dayKey, []);
                }
                itemsByDay.get(dayKey).push(item);
            }

            const sortedDays = [...itemsByDay.keys()].sort();
            deps.addLog(`  Processing ${sortedDays.length.toLocaleString()} days`);

            // Get existing metadata for comparison (must be a Map for importDayToDB)
            const existingMetadata = new Map();

            const addedDays = [];
            const updatedDays = [];
            let savedDays = 0;

            for (const dayKey of sortedDays) {
                if (deps.getCancelProcessing()) break;

                let items = itemsByDay.get(dayKey);
                const monthKey = dayKey.substring(0, 7);

                // CRITICAL: For incremental updates, merge new items with existing items
                if (existingDays.has(dayKey) && !forceRescan) {
                    const existingDay = await deps.getDayFromDB(dayKey);
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
                        const itemStart = new Date(item.startDate).getTime();
                        const itemEnd = item.endDate ? new Date(item.endDate).getTime() : itemStart + 3600000;
                        const candidateWeeks = getCandidateWeekKeysForItem(item.startDate);

                        const mergedSamples = [];
                        for (const wk of candidateWeeks) {
                            const weekSamples = samplesByWeek.get(wk);
                            if (!weekSamples) continue;

                            for (const s of weekSamples) {
                                if (!s.date) continue;
                                const sampleTime = new Date(s.date).getTime();
                                if (sampleTime >= itemStart && sampleTime <= itemEnd) {
                                    mergedSamples.push(s);
                                }
                            }
                        }

                        if (mergedSamples.length > 0) {
                            const seen = new Set();
                            item.samples = mergedSamples.filter(s => {
                                const key = s.sampleId || s.id || s.date;
                                if (seen.has(key)) return false;
                                seen.add(key);
                                return true;
                            });
                            item.samples.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                        } else {
                            item.samples = [];
                        }
                    }
                }

                const dayNotes = notesByDate.get(dayKey) || [];
                const dayData = {
                    timelineItems: orderedItems.map(item => ({
                        itemId: item.itemId,
                        isVisit: item.isVisit,
                        activityType: deps.getStoredActivityTypeForTimelineItem(item),
                        displayName: deps.getStoredDisplayNameForTimelineItem(item),
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
                            // Prefer direct timelineItemId match (Arc Editor v2)
                            if (n.timelineItemId) {
                                return n.timelineItemId === item.itemId;
                            }
                            // Fall back to time-range matching (older notes)
                            const noteTime = new Date(n.date).getTime();
                            const itemStart = new Date(item.startDate).getTime();
                            const itemEnd = item.endDate ? new Date(item.endDate).getTime() : itemStart + 86400000;
                            return noteTime >= itemStart && noteTime < itemEnd;
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
            await deps.saveMetadata('lastBackupSync', maxLastSaved);


            importAddedDays = addedDays;
            importUpdatedDays = updatedDays;

            // Invalidate cache
            const affectedMonths = new Set();
            [...addedDays, ...updatedDays].forEach(dk => affectedMonths.add(dk.substring(0, 7)));
            deps.invalidateMonthCache(affectedMonths);

            await deps.saveMetadata('importAddedDays', addedDays);
            await deps.saveMetadata('importUpdatedDays', updatedDays);

            if (addedDays.length > 0 || updatedDays.length > 0) {
                deps.updateAnalysisDataInBackground([...addedDays, ...updatedDays]);
            }

            // Sync to app.js variables (for generateMarkdown to use)
            if (deps.updateImportTracking) {
                deps.updateImportTracking(importAddedDays, importUpdatedDays, importChangedItemIds);
            }

            logBackupImportDiagnostics(importDiag);

            if (addedDays.length === 0 && updatedDays.length === 0) {
                deps.addLog('\n✅ Import complete — no new or changed days');
            } else {
                const parts = [];
                if (addedDays.length > 0) parts.push(`${addedDays.length} added`);
                if (updatedDays.length > 0) parts.push(`${updatedDays.length} updated`);
                deps.addLog(`\n✅ Import complete — ${parts.join(', ')}`);
                if (addedDays.length > 0) {
                    deps.addLog(`  New data range: ${addedDays[0]} to ${addedDays[addedDays.length - 1]}`);
                }
            }

            // Report any files that failed to read
            if (failedFiles.length > 0) {
                deps.addLog(`\n⚠️ ${failedFiles.length} files could not be read:`);
                // Show first 10 failed files
                const showCount = Math.min(failedFiles.length, 10);
                for (let i = 0; i < showCount; i++) {
                    deps.addLog(`  • ${failedFiles[i].path}`);
                }
                if (failedFiles.length > 10) {
                    deps.addLog(`  ... and ${failedFiles.length - 10} more`);
                }
            }

            progress.style.display = 'none';
            cancelBtn.style.display = 'none';

            // Refresh DB stats — dbStatusSection shows the "Open Diary Reader" button
            await deps.updateDBStatusDisplay();

        } catch (err) {
            deps.addLog(`\n❌ Error: ${err.message}`, 'error');
            console.error('Backup import error:', err);
            progress.style.display = 'none';
            cancelBtn.style.display = 'none';
        }
    }

    // ========================================
    // Module Initialization
    // ========================================
    window.ArcImportModule = { init };

})();
