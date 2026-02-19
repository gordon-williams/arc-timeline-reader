// ════════════════════════════════════════════════════════════════════════
// share.js — Tour Sharing (Create / Open / Guest Viewing)
// ════════════════════════════════════════════════════════════════════════
// Allows users to share trips/holidays as .arctrip files and view
// received tours in a guest mode without touching their own database.
//
// Module pattern: IIFE + window.ArcShare (matches events.js, import.js)
// ════════════════════════════════════════════════════════════════════════

(() => {
    'use strict';

    // ── Constants ──
    const MAX_RANGE_DAYS = 182;
    const MAX_COMPRESSED_SIZE = 50 * 1024 * 1024;   // 50 MB
    const MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024; // 500 MB
    const MAX_DAY_COUNT = 183;
    const MAX_TOTAL_ITEMS = 50000;
    const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
    const AUTHOR_STORAGE_KEY = 'arc_share_author';

    // ── State ──
    let _tourData = null;       // Parsed .arctrip object (in guest mode)
    let _tourActive = false;    // Whether guest viewing mode is active
    let _savedState = null;     // Snapshot of user's real state before tour

    // ── UI Callbacks (set by app.js via init) ──
    const _ui = {
        getDayFromDB: null,
        getAllDayKeysFromDB: null,
        processMonthDayRecords: null,
        buildSpanningVisitsIndex: null,
        displayDiary: null,
        showMonthMap: null,
        updateMonthNavButtons: null,
        populateYearAndMonthSelectors: null,
        populateMonthSelector: null,
        saveBlobToFile: null,
        getState: null,         // Returns { generatedDiaries, monthKeys, currentMonth, currentYear, currentMonthNum, currentDayKey }
        setState: null,         // Sets { generatedDiaries, monthKeys, currentMonth, currentYear, currentMonthNum }
        openDiaryReader: null,
        updateStatsForCurrentView: null,
    };

    // ── Helpers ──

    function slugify(text) {
        return text.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 60) || 'tour';
    }

    function stripHtml(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/<[^>]*>/g, '').substring(0, 200);
    }

    function sanitizeString(str, maxLen = 200) {
        if (typeof str !== 'string') return '';
        return stripHtml(str).substring(0, maxLen).trim();
    }

    // ── Security: Validate tour data from untrusted file ──

    function validateTourData(obj) {
        // Format check
        if (!obj || typeof obj !== 'object') {
            return { valid: false, error: 'Invalid file: not a JSON object' };
        }
        if (obj.format !== 'arctrip') {
            return { valid: false, error: 'Invalid file: not an .arctrip tour file' };
        }
        if (obj.version !== 1) {
            return { valid: false, error: `Unsupported tour version: ${obj.version}` };
        }
        if (!obj.days || typeof obj.days !== 'object' || Array.isArray(obj.days)) {
            return { valid: false, error: 'Invalid file: missing days data' };
        }
        if (!obj.dateRange || !obj.dateRange.start || !obj.dateRange.end) {
            return { valid: false, error: 'Invalid file: missing date range' };
        }

        // Day key validation (blocks __proto__, constructor, etc.)
        const dayKeys = Object.keys(obj.days);
        if (dayKeys.length === 0) {
            return { valid: false, error: 'Tour file contains no days' };
        }
        if (dayKeys.length > MAX_DAY_COUNT) {
            return { valid: false, error: `Tour has ${dayKeys.length} days (maximum: ${MAX_DAY_COUNT})` };
        }

        for (const key of dayKeys) {
            if (!DAY_KEY_PATTERN.test(key)) {
                return { valid: false, error: `Invalid day key: "${key}"` };
            }
        }

        // Date range check
        const sortedKeys = dayKeys.sort();
        const declaredStart = obj.dateRange.start;
        const declaredEnd = obj.dateRange.end;
        if (sortedKeys[0] < declaredStart || sortedKeys[sortedKeys.length - 1] > declaredEnd) {
            return { valid: false, error: 'Day keys outside declared date range' };
        }

        // Item count check
        let totalItems = 0;
        for (const key of dayKeys) {
            const dayData = obj.days[key];
            if (dayData && Array.isArray(dayData.timelineItems)) {
                totalItems += dayData.timelineItems.length;
            }
        }
        if (totalItems > MAX_TOTAL_ITEMS) {
            return { valid: false, error: `Tour has ${totalItems.toLocaleString()} items (maximum: ${MAX_TOTAL_ITEMS.toLocaleString()})` };
        }

        // Sanitise string fields (mutates in place)
        obj.title = sanitizeString(obj.title || 'Untitled Tour');
        obj.author = sanitizeString(obj.author || 'Unknown');

        return { valid: true, dayCount: dayKeys.length, itemCount: totalItems };
    }

    // ── Modal UI ──

    function onEventSelected() {
        const select = document.getElementById('shareEventSelect');
        if (!select || !select.value) return;

        // Find the event
        if (!window.ArcEvents) return;
        const allEvents = window.ArcEvents.getAllEvents();
        const event = allEvents.find(e => e.eventId === select.value);
        if (!event) return;

        // Fill title and dates from event (not author — that's personal)
        const titleInput = document.getElementById('shareTourTitle');
        const startInput = document.getElementById('shareStartDate');
        const endInput = document.getElementById('shareEndDate');
        if (titleInput) titleInput.value = event.name || '';
        if (startInput) startInput.value = event.startDate || '';
        if (endInput) endInput.value = event.endDate || '';

        updateShareRangeInfo();
    }

    function openShareModal() {
        const overlay = document.getElementById('shareModalOverlay');
        if (!overlay) return;

        // Reset to Create tab
        switchShareTab('create');

        // Pre-fill author from localStorage
        const authorInput = document.getElementById('shareTourAuthor');
        if (authorInput) {
            authorInput.value = localStorage.getItem(AUTHOR_STORAGE_KEY) || '';
        }

        // Populate events dropdown
        const eventField = document.getElementById('shareEventField');
        const eventSelect = document.getElementById('shareEventSelect');
        if (eventField && eventSelect && window.ArcEvents) {
            const allEvents = window.ArcEvents.getAllEvents();
            // Clear existing options (keep first placeholder)
            while (eventSelect.options.length > 1) eventSelect.remove(1);

            if (allEvents.length > 0) {
                for (const evt of allEvents) {
                    const opt = document.createElement('option');
                    opt.value = evt.eventId;
                    opt.textContent = `${evt.name}  (${evt.startDate} to ${evt.endDate})`;
                    eventSelect.appendChild(opt);
                }
                eventField.style.display = '';
            } else {
                eventField.style.display = 'none';
            }
        }

        // Pre-fill from Event if current day is within one
        const state = _ui.getState ? _ui.getState() : {};
        const dayKey = state.currentDayKey || '';
        const titleInput = document.getElementById('shareTourTitle');
        const startInput = document.getElementById('shareStartDate');
        const endInput = document.getElementById('shareEndDate');

        let prefilled = false;
        if (dayKey && window.ArcEvents) {
            const dayEvents = window.ArcEvents.getEventsForDay(dayKey);
            if (dayEvents.length > 0) {
                const event = dayEvents[0];
                if (titleInput) titleInput.value = event.name || '';
                if (startInput) startInput.value = event.startDate || dayKey;
                if (endInput) endInput.value = event.endDate || dayKey;
                // Also select it in the dropdown
                if (eventSelect) eventSelect.value = event.eventId;
                prefilled = true;
            }
        }
        if (!prefilled) {
            if (titleInput) titleInput.value = '';
            if (startInput) startInput.value = dayKey || '';
            if (endInput) endInput.value = dayKey || '';
            if (eventSelect) eventSelect.value = '';
        }

        // Reset progress
        const progress = document.getElementById('shareProgress');
        if (progress) progress.style.display = 'none';

        // Reset open tab
        const openPreview = document.getElementById('shareOpenPreview');
        if (openPreview) { openPreview.style.display = 'none'; openPreview.innerHTML = ''; }
        const openZone = document.getElementById('shareOpenZone');
        if (openZone) openZone.style.display = '';
        const fileInput = document.getElementById('shareTourFileInput');
        if (fileInput) fileInput.value = '';

        // Reset error
        const errorEl = document.getElementById('shareError');
        if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

        updateShareRangeInfo();

        // Reset position to centered, then show
        resetShareModalPosition();
        overlay.style.display = 'flex';

        // Ensure drag handler is wired up
        initShareModalDrag();
    }

    function closeShareModal() {
        const overlay = document.getElementById('shareModalOverlay');
        if (overlay) overlay.style.display = 'none';

        // Discard any selected but unopened tour file
        if (!_tourActive) _tourData = null;
    }

    function switchShareTab(tab) {
        document.querySelectorAll('.share-tab').forEach(t => t.classList.remove('active'));
        const activeTab = document.querySelector(`.share-tab[data-tab="${tab}"]`);
        if (activeTab) activeTab.classList.add('active');

        const createTab = document.getElementById('shareTabCreate');
        const openTab = document.getElementById('shareTabOpen');
        if (createTab) createTab.style.display = (tab === 'create') ? '' : 'none';
        if (openTab) openTab.style.display = (tab === 'open') ? '' : 'none';

        const actionBtn = document.getElementById('shareActionBtn');
        if (actionBtn) {
            actionBtn.textContent = 'OK';
            actionBtn.onclick = (tab === 'create') ? createTourFile : openSelectedTour;
            // Disable OK on Open tab until a file is selected and validated
            actionBtn.disabled = (tab === 'open' && !_tourData);
        }
    }

    function updateShareRangeInfo() {
        const start = document.getElementById('shareStartDate')?.value;
        const end = document.getElementById('shareEndDate')?.value;
        const info = document.getElementById('shareRangeInfo');
        if (!info) return;

        if (!start || !end) {
            info.textContent = '';
            info.className = 'share-range-info';
            return;
        }

        const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
        if (days < 1) {
            info.textContent = 'End date must be after start date';
            info.className = 'share-range-info error';
        } else if (days > MAX_RANGE_DAYS) {
            info.textContent = `${days} days selected (maximum: ${MAX_RANGE_DAYS} days)`;
            info.className = 'share-range-info error';
        } else {
            info.textContent = `${days} day${days !== 1 ? 's' : ''} selected`;
            info.className = 'share-range-info';
        }
    }

    function showShareError(msg) {
        const el = document.getElementById('shareError');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
        }
    }

    function setShareProgress(pct, text) {
        const progress = document.getElementById('shareProgress');
        const fill = document.getElementById('shareProgressFill');
        const textEl = document.getElementById('shareProgressText');
        if (progress) progress.style.display = '';
        if (fill) { fill.style.width = pct + '%'; fill.textContent = Math.round(pct) + '%'; }
        if (textEl) textEl.textContent = text || '';
    }

    // ── Create Tour ──

    async function createTourFile() {
        const title = document.getElementById('shareTourTitle')?.value?.trim();
        const author = document.getElementById('shareTourAuthor')?.value?.trim();
        const startDate = document.getElementById('shareStartDate')?.value;
        const endDate = document.getElementById('shareEndDate')?.value;

        // Validation
        if (!title) { showShareError('Please enter a title for the tour'); return; }
        if (!startDate || !endDate) { showShareError('Please enter both start and end dates'); return; }
        if (startDate > endDate) { showShareError('Start date must be before end date'); return; }

        const rangeDays = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
        if (rangeDays > MAX_RANGE_DAYS) {
            showShareError(`Date range is ${rangeDays} days. Maximum is ${MAX_RANGE_DAYS} days.`);
            return;
        }

        if (!_ui.getDayFromDB || !_ui.getAllDayKeysFromDB) {
            showShareError('Database not available');
            return;
        }

        // Save author for next time
        if (author) localStorage.setItem(AUTHOR_STORAGE_KEY, author);

        // Hide error, show progress
        const errorEl = document.getElementById('shareError');
        if (errorEl) errorEl.style.display = 'none';

        const actionBtn = document.getElementById('shareActionBtn');
        if (actionBtn) actionBtn.disabled = true;

        try {
            setShareProgress(0, 'Finding days in range...');

            // Get all day keys and filter to range
            const allDays = await _ui.getAllDayKeysFromDB();
            const tourDayKeys = allDays.filter(dk => dk >= startDate && dk <= endDate).sort();

            if (tourDayKeys.length === 0) {
                showShareError('No days with data found in the selected date range');
                if (actionBtn) actionBtn.disabled = false;
                return;
            }

            setShareProgress(5, `Reading ${tourDayKeys.length} days...`);

            // Fetch day data from IndexedDB
            const days = {};
            for (let i = 0; i < tourDayKeys.length; i++) {
                const dk = tourDayKeys[i];
                const record = await _ui.getDayFromDB(dk);
                if (record && record.data) {
                    days[dk] = record.data;
                }
                if (i % 10 === 0 || i === tourDayKeys.length - 1) {
                    setShareProgress(5 + (i / tourDayKeys.length) * 70, `Reading day ${i + 1} of ${tourDayKeys.length}...`);
                }
            }

            const dayCount = Object.keys(days).length;
            if (dayCount === 0) {
                showShareError('No day data found in the selected range');
                if (actionBtn) actionBtn.disabled = false;
                return;
            }

            setShareProgress(75, 'Building tour file...');

            // Build tour object
            const buildNum = window.__ARC_BUILD__ || '?';
            const tourObj = {
                format: 'arctrip',
                version: 1,
                title: title,
                author: author || 'Anonymous',
                createdAt: new Date().toISOString(),
                createdBy: `Arc Diary Reader Build ${buildNum}`,
                dateRange: { start: startDate, end: endDate },
                days: days
            };

            setShareProgress(80, 'Compressing...');

            // Compress
            const json = JSON.stringify(tourObj);
            const compressed = pako.gzip(json);
            const blob = new Blob([compressed], { type: 'application/octet-stream' });

            const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
            setShareProgress(95, `Downloading (${sizeMB} MB)...`);

            // Download
            const filename = `${slugify(title)}.arctrip`;
            if (_ui.saveBlobToFile) {
                await _ui.saveBlobToFile(blob, filename, [
                    { description: 'Arc Tour File', accept: { 'application/octet-stream': ['.arctrip'] } }
                ]);
            } else {
                // Fallback download
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            setShareProgress(100, `Done! ${dayCount} days, ${sizeMB} MB`);

        } catch (e) {
            showShareError('Failed to create tour: ' + e.message);
            console.error('Create tour error:', e);
        }

        if (actionBtn) actionBtn.disabled = false;
    }

    // ── Open Tour: File Selection ──

    function handleTourFileSelect() {
        const fileInput = document.getElementById('shareTourFileInput');
        if (!fileInput) return;

        // Wire up the change handler and click
        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            await parseTourFile(file);
        };
        fileInput.click();
    }

    async function parseTourFile(file) {
        const errorEl = document.getElementById('shareError');
        if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

        // Size gate
        if (file.size > MAX_COMPRESSED_SIZE) {
            showShareError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum: ${MAX_COMPRESSED_SIZE / 1024 / 1024} MB.`);
            return;
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            const compressed = new Uint8Array(arrayBuffer);

            // Decompress
            let json;
            try {
                json = pako.ungzip(compressed, { to: 'string' });
            } catch (e) {
                showShareError('Not a valid .arctrip file (decompression failed)');
                return;
            }

            // Decompressed size check
            if (json.length > MAX_DECOMPRESSED_SIZE) {
                showShareError(`Decompressed data too large (${(json.length / 1024 / 1024).toFixed(0)} MB). Maximum: ${MAX_DECOMPRESSED_SIZE / 1024 / 1024} MB.`);
                return;
            }

            // Parse
            let tourObj;
            try {
                tourObj = JSON.parse(json);
            } catch (e) {
                showShareError('File is corrupt or not a tour file (JSON parse failed)');
                return;
            }

            // Validate
            const validation = validateTourData(tourObj);
            if (!validation.valid) {
                showShareError(validation.error);
                return;
            }

            // Store for later activation
            _tourData = tourObj;

            // Show preview
            const openZone = document.getElementById('shareOpenZone');
            const preview = document.getElementById('shareOpenPreview');
            if (openZone) openZone.style.display = 'none';
            if (preview) {
                const dayCount = Object.keys(tourObj.days).length;
                const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
                preview.innerHTML = '';

                const info = document.createElement('div');
                info.className = 'share-preview-info';

                const titleEl = document.createElement('div');
                titleEl.className = 'share-preview-title';
                titleEl.textContent = tourObj.title;
                info.appendChild(titleEl);

                const authorEl = document.createElement('div');
                authorEl.className = 'share-preview-author';
                authorEl.textContent = 'by ' + tourObj.author;
                info.appendChild(authorEl);

                const datesEl = document.createElement('div');
                datesEl.className = 'share-preview-dates';
                datesEl.textContent = `${tourObj.dateRange.start} to ${tourObj.dateRange.end}`;
                info.appendChild(datesEl);

                const statsEl = document.createElement('div');
                statsEl.className = 'share-preview-stats';
                statsEl.textContent = `${dayCount} days · ${validation.itemCount.toLocaleString()} items · ${sizeMB} MB`;
                info.appendChild(statsEl);

                preview.appendChild(info);
                preview.style.display = '';
            }

            // Enable the OK button now a valid file is loaded
            const actionBtn = document.getElementById('shareActionBtn');
            if (actionBtn) actionBtn.disabled = false;

        } catch (e) {
            showShareError('Failed to read file: ' + e.message);
            console.error('Open tour error:', e);
        }
    }

    // ── Open Tour: Activate Guest Mode ──

    function openSelectedTour() {
        if (!_tourData) {
            showShareError('Please select a .arctrip file first');
            return;
        }
        activateGuestMode();
    }

    function activateGuestMode() {
        if (!_ui.getState || !_ui.setState) {
            showShareError('Cannot activate tour viewing mode');
            return;
        }

        // 1. Save current state
        const state = _ui.getState();
        _savedState = {
            generatedDiaries: state.generatedDiaries,
            monthKeys: [...state.monthKeys],
            currentMonth: state.currentMonth,
            currentYear: state.currentYear,
            currentMonthNum: state.currentMonthNum,
            currentDayKey: state.currentDayKey,
        };

        // 2. Build tour monthKeys from day keys
        const tourDayKeys = Object.keys(_tourData.days).sort();
        const tourMonthSet = new Set();
        for (const dk of tourDayKeys) {
            tourMonthSet.add(dk.substring(0, 7));
        }
        const tourMonthKeys = [...tourMonthSet].sort();

        if (tourMonthKeys.length === 0) {
            showShareError('Tour contains no valid months');
            return;
        }

        // 3. Replace state
        _ui.setState({
            generatedDiaries: {},
            monthKeys: tourMonthKeys,
            currentMonth: tourMonthKeys[0],
            currentYear: tourMonthKeys[0].split('-')[0],
            currentMonthNum: parseInt(tourMonthKeys[0].split('-')[1]),
        });

        _tourActive = true;

        // 4. Load first month from tour data
        loadMonthFromTourData(tourMonthKeys[0]);

        // 5. Update selectors
        if (_ui.populateYearAndMonthSelectors) {
            _ui.populateYearAndMonthSelectors();
        }

        // 6. Switch Share button to "Close Tour"
        setShareButtonTourMode(true);

        // 7. Disable Analysis (it reads from IndexedDB, not tour data)
        const analysisBtn = document.getElementById('dbButton');
        if (analysisBtn) {
            analysisBtn.disabled = true;
            analysisBtn._savedTitle = analysisBtn.title;
            analysisBtn.title = 'Analysis is not available while viewing a tour';
        }

        // 9. Close modal
        closeShareModal();
    }

    function loadMonthFromTourData(monthKey) {
        if (!_tourData || !_tourData.days) return;

        // Build dayRecords from tour data for this month
        const dayRecords = [];
        const dayDataMap = new Map();
        for (const [dk, data] of Object.entries(_tourData.days)) {
            if (dk.startsWith(monthKey)) {
                dayRecords.push({ dayKey: dk, data: data, sourceFile: 'arctrip' });
                dayDataMap.set(dk, data);
            }
        }
        dayRecords.sort((a, b) => a.dayKey.localeCompare(b.dayKey));

        if (dayRecords.length === 0) return;

        // Build spanning visits index from within tour data
        let spanningVisitsIndex = new Map();
        if (_ui.buildSpanningVisitsIndex) {
            // Also include days from adjacent months in the tour for cross-month spanning
            const allTourRecords = Object.entries(_tourData.days)
                .map(([dk, data]) => ({ dayKey: dk, data }))
                .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
            spanningVisitsIndex = _ui.buildSpanningVisitsIndex(dayRecords, allTourRecords);
        }

        // Process through the shared pipeline
        if (_ui.processMonthDayRecords) {
            _ui.processMonthDayRecords(monthKey, dayRecords, spanningVisitsIndex);
        }

        // Display
        if (_ui.displayDiary) _ui.displayDiary(monthKey);
        if (_ui.showMonthMap) _ui.showMonthMap();
        if (_ui.updateMonthNavButtons) _ui.updateMonthNavButtons();
        if (_ui.updateStatsForCurrentView) {
            setTimeout(() => _ui.updateStatsForCurrentView(), 10);
        }
    }

    function setShareButtonTourMode(active) {
        const btn = document.getElementById('shareBtn');
        if (!btn) return;

        if (active) {
            btn.textContent = 'Close Tour';
            btn.onclick = closeTour;
            btn.classList.add('tour-active');
        } else {
            btn.textContent = 'Share';
            btn.onclick = openShareModal;
            btn.classList.remove('tour-active');
        }

        // Tint the control bar
        const header = document.querySelector('.modal-header');
        if (header) {
            if (active) {
                header.classList.add('tour-mode');
            } else {
                header.classList.remove('tour-mode');
            }
        }
    }

    // ── Close Tour / Restore ──

    function closeTour() {
        if (!_savedState) return;

        // Restore state
        if (_ui.setState) {
            _ui.setState({
                generatedDiaries: _savedState.generatedDiaries,
                monthKeys: _savedState.monthKeys,
                currentMonth: _savedState.currentMonth,
                currentYear: _savedState.currentYear,
                currentMonthNum: _savedState.currentMonthNum,
            });
        }

        _tourActive = false;
        _tourData = null;

        // Restore Share button
        setShareButtonTourMode(false);

        // Restore Analysis button
        const analysisBtn = document.getElementById('dbButton');
        if (analysisBtn) {
            analysisBtn.disabled = false;
            analysisBtn.title = analysisBtn._savedTitle || 'Analysis';
        }

        // Restore display
        if (_ui.populateYearAndMonthSelectors) _ui.populateYearAndMonthSelectors();
        if (_savedState.currentMonth) {
            if (_ui.displayDiary) _ui.displayDiary(_savedState.currentMonth);
            if (_ui.showMonthMap) _ui.showMonthMap();
            if (_ui.updateMonthNavButtons) _ui.updateMonthNavButtons();
        }

        _savedState = null;
    }

    // ── Draggable Modal ──

    let _dragState = { active: false, startX: 0, startY: 0, modalStartX: 0, modalStartY: 0 };

    function initShareModalDrag() {
        const header = document.getElementById('shareModalHeader');
        if (!header || header.dataset.draggableInit) return;

        header.addEventListener('mousedown', shareModalDragStart);
        document.addEventListener('mousemove', shareModalDrag, true);
        document.addEventListener('mouseup', shareModalDragEnd, true);
        header.dataset.draggableInit = 'true';
    }

    function shareModalDragStart(e) {
        // Don't drag when clicking buttons or close
        if (e.target.tagName === 'BUTTON' || e.target.classList.contains('export-modal-close')) return;

        const modal = document.getElementById('shareModal');
        if (!modal) return;

        e.preventDefault();
        e.stopPropagation();

        // On first drag, convert from flex-centered to absolute positioning
        const rect = modal.getBoundingClientRect();
        modal.style.position = 'absolute';
        modal.style.left = rect.left + 'px';
        modal.style.top = rect.top + 'px';
        modal.style.margin = '0';

        _dragState.active = true;
        _dragState.startX = e.clientX;
        _dragState.startY = e.clientY;
        _dragState.modalStartX = rect.left;
        _dragState.modalStartY = rect.top;
    }

    function shareModalDrag(e) {
        if (!_dragState.active) return;
        e.preventDefault();

        const modal = document.getElementById('shareModal');
        if (!modal) return;

        const dx = e.clientX - _dragState.startX;
        const dy = e.clientY - _dragState.startY;
        modal.style.left = (_dragState.modalStartX + dx) + 'px';
        modal.style.top = (_dragState.modalStartY + dy) + 'px';
    }

    function shareModalDragEnd() {
        _dragState.active = false;
    }

    function resetShareModalPosition() {
        const modal = document.getElementById('shareModal');
        if (modal) {
            modal.style.position = '';
            modal.style.left = '';
            modal.style.top = '';
            modal.style.margin = '';
        }
    }

    // ── Public API ──

    window.ArcShare = {
        init(callbacks) {
            Object.assign(_ui, callbacks);
        },

        openShareModal,
        closeShareModal,
        switchShareTab,
        createTourFile,
        handleTourFileSelect,
        openSelectedTour,
        activateGuestMode,
        closeTour,
        updateShareRangeInfo,
        onEventSelected,

        isTourActive() { return _tourActive; },
        getTourData() { return _tourData; },
        loadMonthFromTourData,
    };

    // Global exports for onclick handlers
    window.openShareModal = openShareModal;
    window.closeShareModal = closeShareModal;
    window.switchShareTab = switchShareTab;
    window.closeTour = closeTour;

})();
