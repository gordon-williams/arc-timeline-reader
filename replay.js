// =====================================================
// Replay System - Arc Timeline Diary Reader
// Extracted from app.js for modularity (Build 696)
// =====================================================

/**
 * ReplayController - Manages day replay animation
 *
 * Dependencies (passed via init):
 * - getMap: Getter function for Leaflet map instance
 * - getGeneratedDiaries: Getter function for data cache object
 * - getCurrentDayKey: Getter function for current day key
 * - getMapPadding: Function returning map padding object
 * - clearMapLayers: Function to clear map layers
 * - showDayMap: Function to show day on map
 * - calculateDistance: Haversine distance calculation (meters)
 * - calculateDistanceMeters: Distance calculation (meters)
 * - getPointTime: Get timestamp from GPS point
 * - cancelMeasurement: Cancel measurement tool
 */

class ReplayController {
    constructor() {
        // State
        this.state = {
            active: false,
            playing: false,
            currentIndex: 0,
            routeData: null,
            cumulativeDistances: null,
            totalDistance: 0,
            currentDistance: 0,
            animationFrame: null,
            lastFrameTime: 0,
            speed: 5,
            marker: null,
            zoomLevel: 17,
            dayLocations: [],
            currentLocationName: null,
            locationPopup: null,
            pauseUntil: 0,
            approachingStop: false,
            selectedDayKey: null,
            availableDates: new Set(),
            visitedLocations: new Set(),
            diaryWasHidden: false,
            lastHighlightedEntry: null,
            locationClearTime: 0,
            lastLocationEndTime: 0,
            eventsSetup: false,
            nextStopLocation: null,
            orderedStops: [],      // Pre-computed array of locations in route order with distances
            nextStopIndex: 0       // Index into orderedStops for next location to visit
        };

        // Activity icons for replay (pictogram style)
        this.activityIcons = {
            walking: `<circle cx="32" cy="10" r="6"/><path d="M26 20 L30 20 L34 32 L42 52 L36 54 L30 38 L28 52 L22 52 L26 32 Z"/><path d="M22 24 L30 22 L38 28 L34 34 L28 28 L20 32 Z"/>`,
            running: `<circle cx="38" cy="8" r="6"/><path d="M20 26 L32 22 L36 18 L42 22 L38 28 L44 36 L52 34 L54 40 L42 44 L34 36 L30 48 L38 56 L32 60 L22 48 L26 34 L16 32 L14 26 Z"/>`,
            cycling: `<circle cx="14" cy="44" r="10" fill="none" stroke="white" stroke-width="4"/><circle cx="50" cy="44" r="10" fill="none" stroke="white" stroke-width="4"/><circle cx="38" cy="10" r="5"/><path d="M14 44 L28 26 L38 44" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 26 L34 16" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><circle cx="14" cy="44" r="3"/><circle cx="50" cy="44" r="3"/>`,
            car: `<path d="M14 28 L18 16 C19 14 21 14 24 14 L40 14 C43 14 45 14 46 16 L50 28 Z"/><rect x="10" y="28" width="44" height="20" rx="4"/><circle cx="16" cy="38" r="4" fill-opacity="0.3"/><circle cx="48" cy="38" r="4" fill-opacity="0.3"/><rect x="14" y="46" width="10" height="6" rx="2"/><rect x="40" y="46" width="10" height="6" rx="2"/>`,
            bus: `<rect x="12" y="10" width="40" height="40" rx="6"/><rect x="16" y="14" width="32" height="14" rx="3" fill-opacity="0.3"/><circle cx="20" cy="40" r="4" fill-opacity="0.3"/><circle cx="44" cy="40" r="4" fill-opacity="0.3"/><rect x="16" y="48" width="10" height="6" rx="2"/><rect x="38" y="48" width="10" height="6" rx="2"/>`,
            train: `<rect x="14" y="14" width="36" height="36" rx="6"/><rect x="20" y="18" width="24" height="12" rx="3" fill-opacity="0.3"/><rect x="14" y="34" width="36" height="4"/><circle cx="32" cy="44" r="4" fill-opacity="0.3"/><circle cx="22" cy="50" r="3"/><circle cx="42" cy="50" r="3"/>`,
            tram: `<rect x="14" y="14" width="36" height="34" rx="6"/><rect x="18" y="18" width="12" height="10" rx="2" fill-opacity="0.3"/><rect x="34" y="18" width="12" height="10" rx="2" fill-opacity="0.3"/><rect x="14" y="32" width="36" height="3"/><circle cx="32" cy="42" r="3" fill-opacity="0.3"/>`,
            airplane: `<path d="M32 4 L28 4 L28 20 L10 30 V36 L28 30 V46 L22 50 V56 L32 52 L42 56 V50 L36 46 V30 L54 36 V30 L36 20 V4 Z"/>`,
            boat: `<path d="M8 44 L14 54 H50 L56 44 Z"/><rect x="20" y="32" width="24" height="12" rx="2"/><circle cx="28" cy="38" r="3" fill-opacity="0.3"/><circle cx="36" cy="38" r="3" fill-opacity="0.3"/><rect x="30" y="20" width="4" height="12"/><path d="M28 20 L32 12 L36 20 Z"/>`,
            motorcycle: `<circle cx="12" cy="46" r="10"/><circle cx="12" cy="46" r="4" fill-opacity="0.3"/><circle cx="52" cy="46" r="10"/><circle cx="52" cy="46" r="4" fill-opacity="0.3"/><ellipse cx="30" cy="28" rx="8" ry="5"/><rect x="46" y="20" width="4" height="14"/><rect x="42" y="16" width="14" height="6" rx="2"/>`,
            scooter: `<circle cx="14" cy="48" r="8"/><circle cx="14" cy="48" r="3" fill-opacity="0.3"/><circle cx="50" cy="48" r="8"/><circle cx="50" cy="48" r="3" fill-opacity="0.3"/><rect x="18" y="34" width="26" height="8" rx="2"/><ellipse cx="26" cy="32" rx="8" ry="4"/><rect x="44" y="18" width="4" height="16"/><rect x="40" y="14" width="14" height="6" rx="2"/>`,
            stationary: `<circle cx="32" cy="32" r="8"/><circle cx="32" cy="32" r="16" fill="none" stroke="white" stroke-width="3"/>`,
            unknown: `<circle cx="32" cy="32" r="16" fill="none" stroke="white" stroke-width="3"/><text x="32" y="40" text-anchor="middle" font-size="20" fill="white">?</text>`,
            finished: `<path d="M20 8 L20 56" stroke="white" stroke-width="4"/><rect x="20" y="8" width="28" height="24"/><rect x="20" y="8" width="7" height="8" fill-opacity="0.3"/><rect x="34" y="8" width="7" height="8" fill-opacity="0.3"/><rect x="27" y="16" width="7" height="8" fill-opacity="0.3"/><rect x="41" y="16" width="7" height="8" fill-opacity="0.3"/><rect x="20" y="24" width="7" height="8" fill-opacity="0.3"/><rect x="34" y="24" width="7" height="8" fill-opacity="0.3"/>`
        };

        // Dependencies (set via init)
        this.getMap = null;  // Getter because map is created asynchronously
        this.getGeneratedDiaries = null;
        this.getCurrentDayKey = null;
        this.getMapPadding = null;
        this.clearMapLayers = null;
        this.showDayMap = null;
        this.calculateDistance = null;
        this.calculateDistanceMeters = null;
        this.getPointTime = null;
        this.cancelMeasurement = null;
    }

    /**
     * Initialize with dependencies from app.js
     */
    init(deps) {
        this.getMap = deps.getMap;  // Getter because map is created asynchronously
        this.getGeneratedDiaries = deps.getGeneratedDiaries;  // Getter function to handle reassignment
        this.getCurrentDayKey = deps.getCurrentDayKey;
        this.getMapPadding = deps.getMapPadding;
        this.clearMapLayers = deps.clearMapLayers;
        this.showDayMap = deps.showDayMap;
        this.calculateDistance = deps.calculateDistance;
        this.calculateDistanceMeters = deps.calculateDistanceMeters;
        this.getPointTime = deps.getPointTime;
        this.cancelMeasurement = deps.cancelMeasurement;

        // Expose state and key methods globally for compatibility
        window.replayState = this.state;
        window.toggleReplayController = () => this.toggle();
        window.closeReplayController = () => this.close();
        window.replayTogglePlay = () => this.togglePlay();
        window.replaySeekTo = (e) => this.seekTo(e);
        window.replaySeekToTime = (t) => this.seekToTime(t);
        window.replaySetSpeed = (v) => this.setSpeed(v);
        window.replaySetSpeedFromSlider = (v) => this.setSpeedFromSlider(v);
        window.replayZoom = (d) => this.zoom(d);
        window.replayRestart = () => this.restart();
        window.replayDateSelected = (d) => this.dateSelected(d);
        window.updateReplayDateDisplay = (d) => this.updateDateDisplay(d);
        window.loadReplayDay = (d) => this.loadDay(d);
        window.positionReplayController = () => this.positionController();
    }

    // ===== Map Control Management =====

    disableMapControls() {
        const yearSelector = document.getElementById('yearSelector');
        const monthSelector = document.getElementById('monthSelector');
        const prevMonthBtn = document.getElementById('prevMonthBtn');
        const nextMonthBtn = document.getElementById('nextMonthBtn');
        const toolsBtn = document.getElementById('toolsBtn');

        if (yearSelector) yearSelector.disabled = true;
        if (monthSelector) monthSelector.disabled = true;
        if (prevMonthBtn) prevMonthBtn.disabled = true;
        if (nextMonthBtn) nextMonthBtn.disabled = true;
        if (toolsBtn) toolsBtn.style.display = 'none';

        // Close any open popups
        const searchPopup = document.getElementById('searchPopup');
        if (searchPopup) searchPopup.style.display = 'none';
        const toolsMenu = document.getElementById('toolsDropdownMenu');
        if (toolsMenu) toolsMenu.classList.remove('open');

        if (this.cancelMeasurement) {
            this.cancelMeasurement();
        }
    }

    enableMapControls() {
        const yearSelector = document.getElementById('yearSelector');
        const monthSelector = document.getElementById('monthSelector');
        const prevMonthBtn = document.getElementById('prevMonthBtn');
        const nextMonthBtn = document.getElementById('nextMonthBtn');
        const toolsBtn = document.getElementById('toolsBtn');

        if (yearSelector) yearSelector.disabled = false;
        if (monthSelector) monthSelector.disabled = false;
        if (prevMonthBtn) prevMonthBtn.disabled = false;
        if (nextMonthBtn) nextMonthBtn.disabled = false;
        if (toolsBtn) toolsBtn.style.display = '';
    }

    // ===== Controller UI =====

    toggle() {
        const controller = document.getElementById('replayController');
        if (!controller) return;

        if (controller.style.display === 'none' || !controller.style.display) {
            // Close elevation panel if open (mutually exclusive)
            if (typeof closeElevationPanel === 'function') {
                closeElevationPanel();
            }

            // Position controller BEFORE making visible (prevents Safari flash)
            controller.style.opacity = '0';
            controller.style.display = 'flex';
            this.positionController();

            // Force layout calculation, then reveal
            controller.offsetHeight; // Force reflow
            controller.style.opacity = '1';

            this.disableMapControls();
            this.setupControllerEvents(controller);
            this.setupDatePicker();

            const currentDayKey = this.getCurrentDayKey();
            if (currentDayKey) {
                this.state.selectedDayKey = currentDayKey;
                this.updateDateDisplay(currentDayKey);
                this.loadDay(currentDayKey);
            }
        } else {
            this.close();
        }
    }

    close() {
        const controller = document.getElementById('replayController');
        if (controller) {
            controller.style.display = 'none';
        }
        this.stopAnimation();
        this.cleanup();
        this.state.active = false;
        this.enableMapControls();

        document.querySelectorAll('.diary-highlight').forEach(el => {
            el.classList.remove('diary-highlight');
        });
    }

    positionController() {
        const controller = document.getElementById('replayController');
        if (!controller || !this.getMap()) return;

        const diaryPanel = document.querySelector('.diary-panel');
        const statsPanel = document.querySelector('.stats-panel');
        const mapContainer = document.getElementById('mapContainer');
        if (!mapContainer) return;

        const mapRect = mapContainer.getBoundingClientRect();
        let leftEdge = 0;
        let rightEdge = mapRect.width;

        if (diaryPanel && diaryPanel.style.display !== 'none') {
            const diaryRect = diaryPanel.getBoundingClientRect();
            leftEdge = diaryRect.right - mapRect.left;
        }

        if (statsPanel && statsPanel.style.display !== 'none') {
            const statsRect = statsPanel.getBoundingClientRect();
            rightEdge = statsRect.left - mapRect.left;
        }

        const usableCenter = (leftEdge + rightEdge) / 2;
        controller.style.left = usableCenter + 'px';
        controller.style.transform = 'translateX(-50%)';
        controller.style.bottom = '20px';
    }

    setupControllerEvents(controller) {
        // Prevent duplicate event listener attachment
        if (this.state.eventsSetup) return;
        this.state.eventsSetup = true;

        const stopMapEvents = (e) => {
            e.stopPropagation();
        };

        controller.addEventListener('mousedown', stopMapEvents);
        controller.addEventListener('touchstart', stopMapEvents, { passive: false });
        controller.addEventListener('wheel', stopMapEvents, { passive: false });
        controller.addEventListener('dblclick', stopMapEvents);

        if (L && L.DomEvent) {
            L.DomEvent.disableClickPropagation(controller);
            L.DomEvent.disableScrollPropagation(controller);
        }

        const timelineBar = document.getElementById('replayTimelineBar');
        const tooltip = document.getElementById('replayHoverTooltip');

        if (timelineBar && tooltip) {
            timelineBar.addEventListener('mousemove', (e) => {
                const rect = timelineBar.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const percent = x / rect.width;

                const nearestLoc = this.findNearestLocationAtPercent(percent);
                if (nearestLoc) {
                    tooltip.textContent = nearestLoc.name || nearestLoc.location || 'Unknown';
                    tooltip.style.left = `${x}px`;
                    tooltip.style.opacity = '1';
                } else {
                    tooltip.style.opacity = '0';
                }
            });

            timelineBar.addEventListener('mouseleave', () => {
                tooltip.style.opacity = '0';
            });

            timelineBar.addEventListener('click', (e) => {
                this.seekTo(e);
            });
        }

        // Click on "Next: location" to skip to that location
        const nextNameEl = document.getElementById('replayNextName');
        if (nextNameEl) {
            nextNameEl.addEventListener('click', () => {
                this.skipToNextStop();
            });
        }
    }

    findNearestLocationAtPercent(percent) {
        if (!this.state.routeData || !this.state.dayLocations || this.state.dayLocations.length === 0) {
            return null;
        }
        if (!this.state.cumulativeDistances || this.state.totalDistance <= 0) return null;

        // Find nearest location by DISTANCE (matching timeline marker positions)
        const targetDistance = percent * this.state.totalDistance;

        let nearest = null;
        let nearestDistDiff = Infinity;

        for (const loc of this.state.dayLocations) {
            if (!loc.lat || !loc.lng) continue;

            // Find closest route point to this location
            let closestIdx = -1;
            let closestDist = Infinity;
            for (let i = 0; i < this.state.routeData.length; i++) {
                const point = this.state.routeData[i];
                const dist = this.calculateDistanceMeters(point.lat, point.lng, loc.lat, loc.lng);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestIdx = i;
                }
            }

            if (closestIdx < 0 || closestDist > 200) continue;

            const locationDistance = this.state.cumulativeDistances[closestIdx];
            const distDiff = Math.abs(targetDistance - locationDistance);

            if (distDiff < nearestDistDiff) {
                nearestDistDiff = distDiff;
                nearest = loc;
            }
        }

        // Only show tooltip if within 10% of total distance
        const threshold = this.state.totalDistance * 0.1;
        return nearestDistDiff < threshold ? nearest : null;
    }

    // ===== Date Picker =====

    setupDatePicker() {
        const picker = document.getElementById('replayDatePicker');
        if (!picker) return;

        const availableDates = new Set();

        const generatedDiaries = this.getGeneratedDiaries();
        for (const monthKey of Object.keys(generatedDiaries)) {
            const diary = generatedDiaries[monthKey];
            if (diary?.routesByDay) {
                for (const dayKey of Object.keys(diary.routesByDay)) {
                    availableDates.add(dayKey);
                }
            }
            if (diary?.locationsByDay) {
                for (const dayKey of Object.keys(diary.locationsByDay)) {
                    availableDates.add(dayKey);
                }
            }
            if (diary?.days) {
                for (const dayKey of Object.keys(diary.days)) {
                    availableDates.add(dayKey);
                }
            }
        }

        const currentDayKey = this.getCurrentDayKey();
        if (currentDayKey) picker.value = currentDayKey;

        this.state.availableDates = availableDates;
    }

    updateDateDisplay(dayKey) {
        const picker = document.getElementById('replayDatePicker');
        if (!picker) return;
        picker.value = dayKey || '';
    }

    dateSelected(targetDate) {
        if (!targetDate) return;

        const currentDayKey = this.getCurrentDayKey();
        const startDate = this.state.selectedDayKey || currentDayKey;
        if (!startDate || startDate === targetDate) {
            this.state.selectedDayKey = targetDate;
            this.updateDateDisplay(targetDate);
            this.loadDay(targetDate);
            return;
        }

        // Direct transition (no animation)
        this.state.selectedDayKey = targetDate;
        this.updateDateDisplay(targetDate);
        this.loadDay(targetDate);
    }

    // ===== Day Loading =====

    loadDay(dayKey) {
        if (!dayKey) {
            this.showNoDataMessage('No day selected');
            return;
        }

        const monthKey = dayKey.substring(0, 7);
        const generatedDiaries = this.getGeneratedDiaries();

        if (!generatedDiaries) {
            this.showNoDataMessage('Data not loaded yet');
            return;
        }

        const diary = generatedDiaries[monthKey];

        if (!diary || !diary.routesByDay || !diary.routesByDay[dayKey]) {
            this.state.routeData = null;
            this.showNoDataMessage('No route data for ' + dayKey);
            return;
        }

        const routeData = diary.routesByDay[dayKey];
        if (!routeData || routeData.length < 2) {
            this.state.routeData = null;
            this.showNoDataMessage('Not enough route points for ' + dayKey);
            return;
        }

        this.state.routeData = routeData
            .filter(p => p.lat && p.lng && this.getPointTime(p))
            .sort((a, b) => this.getPointTime(a) - this.getPointTime(b));

        if (this.state.routeData.length < 2) {
            this.showNoDataMessage('Not enough valid route points for ' + dayKey);
            return;
        }

        this.state.selectedDayKey = dayKey;
        this.state.dayLocations = diary.locationsByDay?.[dayKey] || [];

        // Clear any "no data" message
        this.hideNoDataMessage();

        this.state.active = true;
        this.initReplay();
    }

    showNoDataMessage(message) {
        const container = document.getElementById('replayLocationMarkers');
        if (container) {
            container.innerHTML = `<div style="color: #999; font-size: 12px; text-align: center; padding: 5px;">${message}</div>`;
        }
    }

    hideNoDataMessage() {
        // Will be cleared by createTimelineMarkers
    }

    // ===== Replay Initialization =====

    initReplay() {
        if (!this.getMap() || !this.state.routeData) return;

        // Calculate cumulative distances
        this.state.cumulativeDistances = [0];
        let totalDist = 0;
        for (let i = 1; i < this.state.routeData.length; i++) {
            const prev = this.state.routeData[i - 1];
            const curr = this.state.routeData[i];
            const dist = this.calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);
            totalDist += dist;
            this.state.cumulativeDistances.push(totalDist);
        }
        this.state.totalDistance = totalDist;
        this.state.currentDistance = 0;
        this.state.pauseUntil = 0;
        this.state.approachingStop = false;

        this.createTimelineMarkers();
        this.clearMapLayers();

        // Remove existing replay marker
        if (this.state.marker && this.getMap()) {
            this.getMap().removeLayer(this.state.marker);
            this.state.marker = null;
        }

        // Create animated marker
        const firstPoint = this.state.routeData[0];
        const activity = (firstPoint.activityType || 'unknown').toLowerCase();
        this.state.marker = L.marker([firstPoint.lat, firstPoint.lng], {
            icon: this.createMarkerIcon(activity),
            zIndexOffset: 1000
        }).addTo(this.getMap());

        // Reset state
        this.state.currentIndex = 0;
        this.state.currentLocationName = null;
        this.state.visitedLocations.clear();
        this.state.lastHighlightedEntry = null;
        this.state.lastLocationEndTime = 0;

        // Build ordered stops array - locations in chronological order with their route distances
        this.buildOrderedStops();

        this.centerOnPoint(firstPoint.lat, firstPoint.lng);
        this.showLocationPopupAtStart();

        this.updateTimeDisplay();
        this.updateProgress();
        this.updateSpeedometer(0);
    }

    /**
     * Build ordered stops array - locations in chronological visit order (like railway stations).
     * Each stop records its distance along the route for positioning on the timeline.
     * The array order is the visit order, NOT sorted by distance.
     */
    buildOrderedStops() {
        this.state.orderedStops = [];
        this.state.nextStopIndex = 0;

        if (!this.state.dayLocations.length || !this.state.routeData || !this.state.cumulativeDistances) {
            return;
        }

        // Process locations in their original chronological order
        for (let locIndex = 0; locIndex < this.state.dayLocations.length; locIndex++) {
            const loc = this.state.dayLocations[locIndex];
            if (!loc.lat || !loc.lng) continue;

            const locationName = loc.name || loc.location || 'Unknown';
            const visitStart = loc.startDate ? new Date(loc.startDate).getTime() : null;
            const visitKey = visitStart ? `${locationName}_${visitStart}` : locationName;

            // Find the route point for this location using TIME, not just distance
            // This correctly handles loop routes where we pass the same place twice
            let closestIdx = -1;
            let closestDist = Infinity;

            if (visitStart) {
                // Find route point closest in TIME to when we visited this location
                let closestTimeDiff = Infinity;
                for (let i = 0; i < this.state.routeData.length; i++) {
                    const point = this.state.routeData[i];
                    const pointTime = this.getPointTime(point);
                    if (!pointTime) continue;

                    const timeDiff = Math.abs(pointTime - visitStart);
                    if (timeDiff < closestTimeDiff) {
                        closestTimeDiff = timeDiff;
                        closestIdx = i;
                        // Also track distance for logging
                        closestDist = this.calculateDistanceMeters(point.lat, point.lng, loc.lat, loc.lng);
                    }
                }
            } else {
                // Fallback: no time info, use spatial distance
                for (let i = 0; i < this.state.routeData.length; i++) {
                    const point = this.state.routeData[i];
                    const dist = this.calculateDistanceMeters(point.lat, point.lng, loc.lat, loc.lng);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closestIdx = i;
                    }
                }
            }

            if (closestIdx < 0 || closestDist > 500) continue;

            const distanceOnRoute = this.state.cumulativeDistances[closestIdx];
            const point = this.state.routeData[closestIdx];
            const pointTime = this.getPointTime(point);

            this.state.orderedStops.push({
                locIndex: locIndex,
                name: locationName,
                visitKey: visitKey,
                distance: distanceOnRoute,
                routeIndex: closestIdx,
                lat: loc.lat,
                lng: loc.lng,
                time: pointTime || Date.now(),
                loc: loc
            });
        }
    }

    createTimelineMarkers() {
        const container = document.getElementById('replayLocationMarkers');
        if (!container) return;

        container.innerHTML = '';

        if (!this.state.routeData || !this.state.dayLocations || this.state.dayLocations.length === 0) {
            return;
        }

        if (!this.state.cumulativeDistances || this.state.totalDistance <= 0) return;

        // Timeline markers are DISTANCE-based - position by where location is on route
        for (const loc of this.state.dayLocations) {
            if (!loc.lat || !loc.lng) continue;

            // Find closest route point to this location (for accurate positioning)
            let closestIdx = -1;
            let closestDist = Infinity;
            for (let i = 0; i < this.state.routeData.length; i++) {
                const point = this.state.routeData[i];
                const dist = this.calculateDistanceMeters(point.lat, point.lng, loc.lat, loc.lng);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestIdx = i;
                }
            }

            // Skip if location isn't near the route
            if (closestIdx < 0 || closestDist > 200) continue;

            // Position marker by distance along route
            const locationDistance = this.state.cumulativeDistances[closestIdx];
            const position = (locationDistance / this.state.totalDistance) * 100;

            if (position < 0 || position > 100) continue;

            const marker = document.createElement('div');
            marker.className = 'replay-location-marker';
            marker.style.left = `${position}%`;
            marker.setAttribute('data-name', loc.name || loc.location || 'Unknown');
            container.appendChild(marker);
        }
    }

    showLocationPopupAtStart() {
        const firstPoint = this.state.routeData[0];
        const startTime = this.getPointTime(firstPoint);

        let startLocation = null;
        for (const loc of this.state.dayLocations) {
            const visitStart = loc.startDate ? new Date(loc.startDate).getTime() : null;
            const visitEnd = loc.endDate ? new Date(loc.endDate).getTime() : null;

            if (visitStart && visitEnd && startTime >= visitStart && startTime <= visitEnd) {
                startLocation = loc;
                break;
            }
        }

        if (startLocation) {
            this.showLocationPopup(firstPoint.lat, firstPoint.lng, startLocation.name || startLocation.location, startTime);
        }
    }

    // ===== Marker Icon =====

    createMarkerIcon(activity) {
        const svg = this.activityIcons[activity] || this.activityIcons.unknown;
        return L.divIcon({
            className: 'replay-marker',
            html: `<div class="replay-marker-icon activity-${activity}"><svg viewBox="0 0 64 64" fill="white">${svg}</svg></div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });
    }

    // ===== Location Popup =====

    showLocationPopup(lat, lng, name, timestamp, skipVisited = false) {
        if (this.state.locationPopup && this.getMap()) {
            this.getMap().removeLayer(this.state.locationPopup);
        }

        const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '';

        let durationStr = '';
        let locStartTime = null;
        let locEndTime = null;
        let bestTimeDiff = Infinity;

        for (const loc of this.state.dayLocations) {
            const locName = loc.name || loc.location;
            if (locName === name && loc.startDate && loc.endDate) {
                const start = new Date(loc.startDate).getTime();
                const end = new Date(loc.endDate).getTime();

                const timeDiff = timestamp ? Math.min(Math.abs(timestamp - start), Math.abs(timestamp - end)) : Infinity;
                if (timeDiff < bestTimeDiff) {
                    bestTimeDiff = timeDiff;
                    locStartTime = start;
                    locEndTime = end;
                    const durationMs = end - start;
                    const durationMins = Math.round(durationMs / 60000);

                    if (durationMins >= 60) {
                        const hours = Math.floor(durationMins / 60);
                        const mins = durationMins % 60;
                        durationStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
                    } else if (durationMins > 0) {
                        durationStr = `${durationMins}m`;
                    }
                }
            }
        }

        if (locEndTime) {
            this.state.lastLocationEndTime = locEndTime;
        }

        let metaHtml = '';
        if (timeStr || durationStr) {
            const parts = [];
            if (timeStr) parts.push(timeStr);
            if (durationStr) parts.push(durationStr);
            metaHtml = `<div class="location-time">${parts.join(' • ')}</div>`;
        }

        const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;

        const popupContent = `
            <div class="replay-location-popup replay-popup-animate">
                <div class="location-name">${name}</div>
                ${metaHtml}
                <a href="${streetViewUrl}" target="_blank" class="streetview-link" title="Open in Google Street View">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M12 2C8.14 2 5 5.14 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 10.5c-2.67-3-5-6.5-5-8.5a5 5 0 0 1 10 0c0 2-2.33 5.5-5 8.5z"/>
                        <circle cx="12" cy="9" r="2.5"/>
                    </svg>
                    Street View
                </a>
            </div>
        `;

        this.state.locationPopup = L.popup({
            closeButton: false,
            autoClose: false,
            closeOnClick: false,
            className: 'replay-popup',
            offset: [0, -20]
        })
        .setLatLng([lat, lng])
        .setContent(popupContent)
        .openOn(this.getMap());

        this.state.currentLocationName = name;

        const visitKey = locStartTime ? `${name}_${locStartTime}` : name;

        if (!skipVisited) {
            this.state.visitedLocations.add(visitKey);
        }

        const entryKey = visitKey;
        this.state.lastHighlightedEntry = entryKey;
        this.highlightDiaryEntryByName(name, locStartTime);
    }

    hideLocationPopup() {
        if (this.state.locationPopup && this.getMap()) {
            this.getMap().removeLayer(this.state.locationPopup);
            this.state.locationPopup = null;
        }
    }

    showDestinationSign(lastPoint) {
        const endTime = this.getPointTime(lastPoint);
        if (!endTime) return;

        let finalLocation = null;
        for (const loc of this.state.dayLocations) {
            const visitStart = loc.startDate ? new Date(loc.startDate).getTime() : null;
            const visitEnd = loc.endDate ? new Date(loc.endDate).getTime() : null;

            if (visitStart && visitEnd) {
                if (endTime >= visitStart - 60000 && endTime <= visitEnd + 60000) {
                    finalLocation = loc;
                }
            }
        }

        if (!finalLocation && this.state.dayLocations.length > 0) {
            let closestDiff = Infinity;
            for (const loc of this.state.dayLocations) {
                const visitStart = loc.startDate ? new Date(loc.startDate).getTime() : null;
                if (visitStart) {
                    const diff = Math.abs(endTime - visitStart);
                    if (diff < closestDiff) {
                        closestDiff = diff;
                        finalLocation = loc;
                    }
                }
            }
        }

        if (finalLocation) {
            const name = finalLocation.name || finalLocation.location || 'Destination';
            this.showLocationPopup(lastPoint.lat, lastPoint.lng, name, endTime);
        }
    }

    // ===== Map Centering =====

    centerOnPoint(lat, lng, smooth = true) {
        const padding = this.getMapPadding();
        const leftPad = padding.paddingTopLeft[0];
        const rightPad = padding.paddingBottomRight[0];
        const offsetX = (leftPad - rightPad) / 2;

        const targetPoint = this.getMap().project([lat, lng], this.state.zoomLevel);
        const centeredPoint = L.point(targetPoint.x - offsetX, targetPoint.y);
        const centeredLatLng = this.getMap().unproject(centeredPoint, this.state.zoomLevel);

        this.getMap().setView(centeredLatLng, this.state.zoomLevel, {
            animate: smooth,
            duration: smooth ? 0.1 : 0
        });
    }

    // ===== Playback Control =====

    togglePlay() {
        if (!this.state.routeData || this.state.routeData.length < 2 || !this.state.marker) {
            alert('Please select a day with route data first');
            return;
        }

        const btn = document.getElementById('replayPlayBtn');
        const icon = document.getElementById('replayPlayIcon');

        if (this.state.playing) {
            this.state.playing = false;
            btn.classList.remove('playing');
            icon.textContent = '▶';
            if (this.state.animationFrame) {
                cancelAnimationFrame(this.state.animationFrame);
            }
        } else {
            this.state.playing = true;
            btn.classList.add('playing');
            icon.textContent = '⏸';
            this.state.lastFrameTime = performance.now();

            if (this.state.currentDistance === 0) {
                this.state.pauseUntil = performance.now() + 3000;
            }

            this.animate();
        }
    }

    // ===== Animation Loop =====

    animate() {
        if (!this.state.playing || !this.state.routeData || !this.state.marker) return;

        const now = performance.now();

        if (this.state.pauseUntil > now) {
            this.state.lastFrameTime = now;
            this.state.animationFrame = requestAnimationFrame(() => this.animate());
            return;
        }

        if (this.state.pauseUntil > 0 && this.state.pauseUntil <= now) {
            this.state.pauseUntil = 0;
            this.hideLocationPopup();
            this.state.locationClearTime = now + 500;
        }

        if (this.state.locationClearTime && now >= this.state.locationClearTime) {
            this.state.currentLocationName = null;
            this.state.locationClearTime = 0;
        }

        const deltaMs = now - this.state.lastFrameTime;
        this.state.lastFrameTime = now;

        let speedMultiplier = 1.0;
        let nearestStop = this.findNearestStop();

        if (nearestStop) {
            const distToStop = nearestStop.distanceMeters;
            const SLOW_DISTANCE = 150;
            const MIN_SPEED = 0.15;

            if (distToStop < SLOW_DISTANCE) {
                const t = distToStop / SLOW_DISTANCE;

                if (nearestStop.direction === 'approaching') {
                    speedMultiplier = MIN_SPEED + (1 - MIN_SPEED) * (t * t);
                    this.state.approachingStop = true;
                } else if (nearestStop.direction === 'leaving') {
                    speedMultiplier = MIN_SPEED + (1 - MIN_SPEED) * (1 - (1 - t) * (1 - t));
                    this.state.approachingStop = false;
                }
            } else {
                this.state.approachingStop = false;
            }
        } else {
            this.state.approachingStop = false;
        }

        const metersPerSecond = this.state.speed * 50 * speedMultiplier;
        const distanceAdvance = (deltaMs / 1000) * metersPerSecond;

        const proposedDistance = this.state.currentDistance + distanceAdvance;

        // Find the route index for the proposed distance
        let proposedRouteIndex = 0;
        for (let i = 1; i < this.state.cumulativeDistances.length; i++) {
            if (this.state.cumulativeDistances[i] >= proposedDistance) {
                proposedRouteIndex = i - 1;
                break;
            }
            proposedRouteIndex = i;
        }

        const locationStop = this.checkForLocationInPath(this.state.currentIndex, proposedRouteIndex);

        if (locationStop) {
            this.state.currentDistance = locationStop.distance;
            this.state.currentIndex = locationStop.index;
            const point = this.state.routeData[locationStop.index];
            this.state.marker.setLatLng([point.lat, point.lng]);

            this.state.visitedLocations.add(locationStop.visitKey);

            const distanceToEnd = this.state.totalDistance - locationStop.distance;
            const isFinalDestination = distanceToEnd < 100;

            const popupLat = locationStop.lat ?? point.lat;
            const popupLng = locationStop.lng ?? point.lng;
            this.showLocationPopup(popupLat, popupLng, locationStop.name, locationStop.time, true);

            this.updatePosition(locationStop.index);
            this.centerOnPoint(point.lat, point.lng);

            if (isFinalDestination) {
                this.state.marker.setIcon(this.createMarkerIcon('finished'));
                this.state.playing = false;
                document.getElementById('replayPlayBtn').classList.remove('playing');
                document.getElementById('replayPlayIcon').textContent = '▶';
            } else {
                this.state.pauseUntil = performance.now() + 3000;
                this.state.animationFrame = requestAnimationFrame(() => this.animate());
            }
            return;
        }

        this.state.currentDistance += distanceAdvance;

        if (this.state.currentDistance >= this.state.totalDistance) {
            this.state.currentDistance = this.state.totalDistance;
            this.state.currentIndex = this.state.routeData.length - 1;
            const lastPoint = this.state.routeData[this.state.currentIndex];
            this.state.marker.setLatLng([lastPoint.lat, lastPoint.lng]);
            this.updatePosition(this.state.currentIndex);

            this.state.marker.setIcon(this.createMarkerIcon('finished'));
            this.showDestinationSign(lastPoint);

            this.state.playing = false;
            document.getElementById('replayPlayBtn').classList.remove('playing');
            document.getElementById('replayPlayIcon').textContent = '▶';
            return;
        }

        let segmentIndex = 0;
        for (let i = 1; i < this.state.cumulativeDistances.length; i++) {
            if (this.state.cumulativeDistances[i] >= this.state.currentDistance) {
                segmentIndex = i - 1;
                break;
            }
            segmentIndex = i - 1;
        }

        const segmentStart = this.state.cumulativeDistances[segmentIndex];
        const segmentEnd = this.state.cumulativeDistances[segmentIndex + 1] || segmentStart;
        const segmentLength = segmentEnd - segmentStart;

        const prevPoint = this.state.routeData[segmentIndex];
        const nextPoint = this.state.routeData[segmentIndex + 1] || prevPoint;

        let lat, lng;
        if (segmentLength > 0) {
            const t = (this.state.currentDistance - segmentStart) / segmentLength;
            lat = prevPoint.lat + (nextPoint.lat - prevPoint.lat) * t;
            lng = prevPoint.lng + (nextPoint.lng - prevPoint.lng) * t;
        } else {
            lat = prevPoint.lat;
            lng = prevPoint.lng;
        }

        this.state.marker.setLatLng([lat, lng]);

        const prevIndex = this.state.currentIndex;
        this.state.currentIndex = segmentIndex;
        this.checkLocationArrival(prevIndex, segmentIndex, lat, lng);

        this.centerOnPoint(lat, lng);
        this.updatePosition(segmentIndex);

        this.state.animationFrame = requestAnimationFrame(() => this.animate());
    }

    // ===== Location Detection =====

    /**
     * Check if we've reached the next stop.
     * Uses routeIndex - have we passed the point on the route where this location is?
     */
    checkForLocationInPath(currentRouteIndex, proposedRouteIndex) {
        // No stops left
        if (this.state.nextStopIndex >= this.state.orderedStops.length) return null;

        const stop = this.state.orderedStops[this.state.nextStopIndex];

        // Have we reached or passed this stop's position on the route?
        if (proposedRouteIndex >= stop.routeIndex) {
            this.state.nextStopIndex++;
            return {
                distance: stop.distance,
                index: stop.routeIndex,
                name: stop.name,
                time: stop.time,
                visitKey: stop.visitKey,
                lat: stop.lat,
                lng: stop.lng
            };
        }

        return null;
    }

    /**
     * Find the nearest upcoming stop - just returns the next stop in the array.
     */
    findNearestStop() {
        if (this.state.nextStopIndex >= this.state.orderedStops.length) return null;

        const stop = this.state.orderedStops[this.state.nextStopIndex];
        const distanceToStop = stop.distance - this.state.currentDistance;

        return {
            loc: stop.loc,
            direction: distanceToStop > 0 ? 'approaching' : 'leaving',
            distanceMeters: Math.abs(distanceToStop),
            name: stop.name
        };
    }

    checkLocationArrival(prevIndex, currentIndex, lat, lng) {
        const currentTime = this.getPointTime(this.state.routeData[currentIndex]);
        if (!currentTime) return;

        for (const loc of this.state.dayLocations) {
            const visitStart = loc.startDate ? new Date(loc.startDate).getTime() : null;
            const visitEnd = loc.endDate ? new Date(loc.endDate).getTime() : null;

            const locationName = loc.name || loc.location || 'Unknown';

            if (visitStart && visitEnd && loc.lat && loc.lng) {
                if (currentTime >= visitStart && currentTime <= visitEnd) {
                    const distMeters = this.calculateDistanceMeters(lat, lng, loc.lat, loc.lng);
                    if (distMeters < 100) {
                        const visitKey = `${locationName}_${visitStart}`;
                        if (!this.state.visitedLocations.has(visitKey)) {
                            this.state.visitedLocations.add(visitKey);
                            this.showLocationPopup(loc.lat, loc.lng, locationName, currentTime);
                            this.state.pauseUntil = performance.now() + 3000;
                        }
                        return;
                    }
                }
            } else if (visitStart && loc.lat && loc.lng) {
                const timeDiff = Math.abs(currentTime - visitStart);
                const distMeters = this.calculateDistanceMeters(lat, lng, loc.lat, loc.lng);

                if (distMeters < 100 && timeDiff < 120000) {
                    const visitKey = `${locationName}_${visitStart}`;
                    if (!this.state.visitedLocations.has(visitKey)) {
                        this.state.visitedLocations.add(visitKey);
                        this.showLocationPopup(loc.lat, loc.lng, locationName, visitStart);
                        this.state.pauseUntil = performance.now() + 3000;
                    }
                    return;
                }
            } else if (loc.lat && loc.lng) {
                const distMeters = this.calculateDistanceMeters(lat, lng, loc.lat, loc.lng);
                if (distMeters < 50) {
                    if (!this.state.visitedLocations.has(locationName)) {
                        this.state.visitedLocations.add(locationName);
                        this.showLocationPopup(loc.lat, loc.lng, locationName, currentTime);
                        this.state.pauseUntil = performance.now() + 3000;
                    }
                    return;
                }
            }
        }

        if (this.state.currentLocationName && !this.state.locationClearTime) {
            this.hideLocationPopup();
            this.state.currentLocationName = null;
        }
    }

    // ===== UI Updates =====

    updatePosition(index) {
        const point = this.state.routeData[index];
        const activity = (point.activityType || 'unknown').toLowerCase();

        const currentClass = this.state.marker?._icon?.querySelector('.replay-marker-icon')?.className || '';
        if (!currentClass.includes(`activity-${activity}`) && !currentClass.includes('activity-finished')) {
            this.state.marker.setIcon(this.createMarkerIcon(activity));
        }

        this.updateTimeDisplay();
        this.updateProgress();
        this.updateActivityInfo(index);
        this.updateNextStop(index);

        const speedKmh = this.calculateActualSpeed(index);
        this.updateSpeedometer(speedKmh);

        this.highlightActivityEntry(index);
    }

    highlightActivityEntry(index) {
        const diaryFloat = document.querySelector('.diary-float');

        if (!diaryFloat || diaryFloat.style.display === 'none') {
            return;
        }

        if (this.state.currentLocationName) {
            return;
        }
        if (this.state.locationClearTime > 0) {
            return;
        }

        const point = this.state.routeData[index];
        if (!point) return;

        const currentTime = this.getPointTime(point);
        if (!currentTime) return;

        const timeKey = `activity_${Math.floor(currentTime / 60000)}`;
        if (timeKey !== this.state.lastHighlightedEntry) {
            if (this.highlightReplayDiaryEntryByTime(currentTime)) {
                this.state.lastHighlightedEntry = timeKey;
            }
        }
    }

    highlightDiaryEntryByName(locationName, timestamp = null) {
        const markdownEl = document.getElementById('markdownContent');
        if (!markdownEl) return;

        markdownEl.querySelectorAll('li.diary-highlight').forEach(el => {
            el.classList.remove('diary-highlight');
        });

        const currentDayKey = this.state.selectedDayKey;

        const locationDataElements = markdownEl.querySelectorAll('.location-data');
        let bestMatch = null;
        let bestTimeDiff = Infinity;

        for (const locData of locationDataElements) {
            if (currentDayKey) {
                const entryDayKey = locData.getAttribute('data-daykey');
                if (entryDayKey !== currentDayKey) continue;
            }

            const dataLocation = locData.getAttribute('data-location');
            if (dataLocation !== locationName) continue;

            const li = locData.closest('li');
            if (!li) continue;

            if (timestamp) {
                const startDateStr = locData.getAttribute('data-start-date');
                if (startDateStr) {
                    const entryTime = new Date(startDateStr).getTime();
                    const timeDiff = Math.abs(entryTime - timestamp);

                    if (timeDiff < bestTimeDiff) {
                        bestTimeDiff = timeDiff;
                        bestMatch = li;
                    }
                } else if (!bestMatch) {
                    bestMatch = li;
                }
            } else {
                bestMatch = li;
                break;
            }
        }

        if (bestMatch) {
            bestMatch.classList.add('diary-highlight');

            const diaryPanel = document.querySelector('.diary-panel');
            if (diaryPanel) {
                const entryRect = bestMatch.getBoundingClientRect();
                const panelRect = diaryPanel.getBoundingClientRect();

                if (entryRect.top < panelRect.top + 50 || entryRect.bottom > panelRect.bottom - 50) {
                    const scrollTop = entryRect.top - panelRect.top + diaryPanel.scrollTop - 80;
                    diaryPanel.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
                }
            }
        }
    }

    highlightReplayDiaryEntryByTime(timestamp) {
        const markdownEl = document.getElementById('markdownContent');
        if (!markdownEl || !timestamp) return false;

        markdownEl.querySelectorAll('li.diary-highlight').forEach(el => {
            el.classList.remove('diary-highlight');
        });

        const currentDayKey = this.state.selectedDayKey;

        const activityElements = markdownEl.querySelectorAll('.location-data[data-type="activity"]');

        let bestMatch = null;
        let bestTimeDiff = Infinity;

        for (const locData of activityElements) {
            if (currentDayKey) {
                const entryDayKey = locData.getAttribute('data-daykey');
                if (entryDayKey !== currentDayKey) continue;
            }

            const startDateStr = locData.getAttribute('data-start-date');
            if (!startDateStr) continue;

            const startTime = new Date(startDateStr).getTime();

            const endDateStr = locData.getAttribute('data-end-date');
            let endTime = endDateStr ? new Date(endDateStr).getTime() : null;

            if (!endTime) {
                endTime = startTime + (2 * 60 * 60 * 1000);
            }

            if (this.state.lastLocationEndTime && endTime < this.state.lastLocationEndTime) {
                continue;
            }

            const buffer = 60000;
            if (timestamp >= startTime - buffer && timestamp <= endTime + buffer) {
                const timeDiff = Math.abs(startTime - timestamp);
                if (timeDiff < bestTimeDiff) {
                    bestTimeDiff = timeDiff;
                    const li = locData.closest('li');
                    if (li) bestMatch = li;
                }
            }
        }

        if (bestMatch) {
            bestMatch.classList.add('diary-highlight');

            const diaryPanel = document.querySelector('.diary-panel');
            if (diaryPanel) {
                const entryRect = bestMatch.getBoundingClientRect();
                const panelRect = diaryPanel.getBoundingClientRect();

                if (entryRect.top < panelRect.top + 50 || entryRect.bottom > panelRect.bottom - 50) {
                    const scrollTop = entryRect.top - panelRect.top + diaryPanel.scrollTop - 80;
                    diaryPanel.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
                }
            }
            return true;
        }
        return false;
    }

    updateActivityInfo(index) {
        const point = this.state.routeData[index];
        if (!point) return;

        const timeEl = document.getElementById('replayActivityTime');
        const typeEl = document.getElementById('replayActivityType');
        const statsEl = document.getElementById('replayActivityStats');

        const timestamp = this.getPointTime(point);
        if (timeEl && timestamp) {
            timeEl.textContent = new Date(timestamp).toLocaleTimeString('en-AU', {
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        const activity = (point.activityType || 'unknown').toLowerCase();
        if (typeEl) {
            const activityNames = {
                'car': 'Car',
                'walking': 'Walking',
                'running': 'Running',
                'cycling': 'Cycling',
                'bus': 'Bus',
                'train': 'Train',
                'airplane': 'Airplane',
                'boat': 'Boat',
                'stationary': 'Stationary',
                'unknown': 'Moving'
            };
            typeEl.textContent = activityNames[activity] || activity;
        }

        if (statsEl) {
            const distKm = (this.state.currentDistance / 1000).toFixed(1);
            const firstTime = this.getPointTime(this.state.routeData[0]);
            const durationMs = timestamp - firstTime;
            const durationMins = Math.round(durationMs / 60000);
            const durationStr = durationMins >= 60
                ? `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`
                : `${durationMins}m`;
            statsEl.textContent = `• ${distKm} km • ${durationStr}`;
        }
    }

    updateNextStop(index) {
        const nameEl = document.getElementById('replayNextName');
        if (!nameEl) return;

        const point = this.state.routeData[index];
        const currentTime = this.getPointTime(point);
        if (!currentTime) {
            nameEl.textContent = '--';
            this.state.nextStopLocation = null;
            return;
        }

        let nextStop = null;
        for (const loc of this.state.dayLocations) {
            const visitStart = loc.startDate ? new Date(loc.startDate).getTime() : null;
            if (visitStart && visitStart > currentTime) {
                if (!nextStop || visitStart < new Date(nextStop.startDate).getTime()) {
                    nextStop = loc;
                }
            }
        }

        // Store reference for click handler
        this.state.nextStopLocation = nextStop;

        if (nextStop) {
            nameEl.textContent = nextStop.name || nextStop.location || 'Unknown';
        } else {
            nameEl.textContent = 'End';
        }
    }

    skipToNextStop() {
        const nextStop = this.state.nextStopLocation;
        if (!nextStop) return;

        const visitStart = nextStop.startDate ? new Date(nextStop.startDate).getTime() : null;
        if (visitStart) {
            this.seekToTime(visitStart);
        }
    }

    calculateActualSpeed(index) {
        if (index <= 0 || index >= this.state.routeData.length) {
            return 0;
        }

        const lookback = Math.min(3, index);
        const prevPoint = this.state.routeData[index - lookback];
        const currPoint = this.state.routeData[index];

        const prevTime = this.getPointTime(prevPoint);
        const currTime = this.getPointTime(currPoint);

        if (!prevTime || !currTime || currTime <= prevTime) {
            return 0;
        }

        const dist = this.calculateDistance(prevPoint.lat, prevPoint.lng, currPoint.lat, currPoint.lng);
        const timeSec = (currTime - prevTime) / 1000;

        if (timeSec <= 0) return 0;

        const speedMs = dist / timeSec;
        return Math.min(200, speedMs * 3.6);
    }

    updateSpeedometer(speedKmh) {
        const speed = Math.round(speedKmh);
        const speedText = document.getElementById('speedText');
        if (speedText) {
            speedText.textContent = speed;
        }
    }

    setSpeedFromSlider(value) {
        const speed = 1 + (value - 1) * 59 / 99;
        this.state.speed = speed;

        const mult = document.getElementById('replaySpeedMult');
        if (mult) {
            mult.textContent = Math.round(speed) + '×';
        }
    }

    updateTimeDisplay() {
        if (!this.state.routeData || this.state.routeData.length === 0) return;

        const current = this.state.routeData[this.state.currentIndex];
        const last = this.state.routeData[this.state.routeData.length - 1];

        const currentEl = document.getElementById('replayCurrentTime');
        const totalEl = document.getElementById('replayTotalTime');

        if (currentEl) currentEl.textContent = this.formatTime(this.getPointTime(current));
        if (totalEl) totalEl.textContent = this.formatTime(this.getPointTime(last));
    }

    formatTime(timestamp) {
        if (!timestamp) return '--:--';
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    }

    updateProgress() {
        if (!this.state.routeData || this.state.routeData.length === 0) return;
        if (this.state.totalDistance <= 0) return;

        // Progress bar is DISTANCE-based to match timeline markers and seeking
        const progress = (this.state.currentDistance / this.state.totalDistance) * 100;

        const progressEl = document.getElementById('replayProgress');
        if (progressEl) progressEl.style.width = Math.max(0, Math.min(100, progress)) + '%';
    }

    // ===== Seeking =====

    seekTo(event) {
        if (!this.state.routeData || this.state.routeData.length === 0) return;
        if (!this.state.cumulativeDistances || this.state.totalDistance <= 0) return;

        const bar = event.currentTarget;
        const rect = bar.getBoundingClientRect();
        const percent = (event.clientX - rect.left) / rect.width;

        // Timeline is DISTANCE-based - find the route point at this distance percentage
        const targetDistance = percent * this.state.totalDistance;

        // Find the route point closest to this target distance
        let bestIdx = 0;
        let bestDistDiff = Infinity;
        for (let i = 0; i < this.state.cumulativeDistances.length; i++) {
            const distDiff = Math.abs(this.state.cumulativeDistances[i] - targetDistance);
            if (distDiff < bestDistDiff) {
                bestDistDiff = distDiff;
                bestIdx = i;
            }
        }

        this.state.currentDistance = this.state.cumulativeDistances[bestIdx];
        this.state.currentIndex = bestIdx;

        const point = this.state.routeData[bestIdx];
        this.state.marker.setLatLng([point.lat, point.lng]);
        this.updatePosition(bestIdx);

        // Hide any current popup and clear pause state
        this.hideLocationPopup();
        this.state.currentLocationName = null;
        this.state.pauseUntil = 0;
        this.state.locationClearTime = 0;

        // Rebuild visitedLocations based on new position
        this.state.visitedLocations.clear();
        this.state.lastLocationEndTime = 0;
        this.state.lastHighlightedEntry = null;

        // Reset nextStopIndex - find the first stop we haven't passed yet
        // Use routeIndex (position in GPS breadcrumb trail) to determine which stops we've passed
        this.state.nextStopIndex = 0;
        for (let i = 0; i < this.state.orderedStops.length; i++) {
            if (this.state.orderedStops[i].routeIndex > bestIdx) {
                this.state.nextStopIndex = i;
                break;
            }
            // Mark passed stops as visited
            this.state.visitedLocations.add(this.state.orderedStops[i].visitKey);
            this.state.nextStopIndex = i + 1;
        }

        const currentTime = this.getPointTime(point);
        let currentLocation = null;

        for (const loc of this.state.dayLocations) {
            if (!loc.lat || !loc.lng) continue;
            const visitStart = loc.startDate ? new Date(loc.startDate).getTime() : null;
            const visitEnd = loc.endDate ? new Date(loc.endDate).getTime() : null;

            // Track last location end time
            if (visitEnd && currentTime && visitEnd < currentTime) {
                if (visitEnd > this.state.lastLocationEndTime) {
                    this.state.lastLocationEndTime = visitEnd;
                }
            }

            // Check if we're currently at a location
            if (visitStart && visitEnd && currentTime >= visitStart && currentTime <= visitEnd) {
                currentLocation = loc;
            }
        }

        // If we landed at a location, show its popup and center on it
        if (currentLocation) {
            const locName = currentLocation.name || currentLocation.location || 'Unknown';
            this.showLocationPopup(currentLocation.lat, currentLocation.lng, locName, currentTime);
            this.centerOnPoint(currentLocation.lat, currentLocation.lng);
        } else {
            this.centerOnPoint(point.lat, point.lng);
        }
    }

    seekToTime(targetTime) {
        if (!this.state.routeData || this.state.routeData.length === 0) return;

        if (this.state.playing) {
            this.state.playing = false;
            const btn = document.getElementById('replayPlayBtn');
            const icon = document.getElementById('replayPlayIcon');
            if (btn) btn.classList.remove('playing');
            if (icon) icon.textContent = '▶';
            if (this.state.animationFrame) {
                cancelAnimationFrame(this.state.animationFrame);
            }
        }

        let bestIdx = 0;
        let bestTimeDiff = Infinity;
        for (let i = 0; i < this.state.routeData.length; i++) {
            const pointTime = this.getPointTime(this.state.routeData[i]);
            const timeDiff = Math.abs(pointTime - targetTime);
            if (timeDiff < bestTimeDiff) {
                bestTimeDiff = timeDiff;
                bestIdx = i;
            }
        }

        this.state.currentDistance = this.state.cumulativeDistances[bestIdx];
        this.state.currentIndex = bestIdx;

        const point = this.state.routeData[bestIdx];
        this.state.marker.setLatLng([point.lat, point.lng]);

        const activity = (point.activityType || 'unknown').toLowerCase();
        this.state.marker.setIcon(this.createMarkerIcon(activity));

        this.updatePosition(bestIdx);

        this.hideLocationPopup();
        this.state.currentLocationName = null;
        this.state.pauseUntil = 0;
        this.state.locationClearTime = 0;

        this.state.visitedLocations.clear();
        this.state.lastLocationEndTime = 0;
        this.state.lastHighlightedEntry = null;

        // Reset nextStopIndex - find the first stop we haven't passed yet
        // Use routeIndex (position in GPS breadcrumb trail) to determine which stops we've passed
        this.state.nextStopIndex = 0;
        for (let i = 0; i < this.state.orderedStops.length; i++) {
            if (this.state.orderedStops[i].routeIndex > bestIdx) {
                this.state.nextStopIndex = i;
                break;
            }
            // Mark passed stops as visited
            this.state.visitedLocations.add(this.state.orderedStops[i].visitKey);
            this.state.nextStopIndex = i + 1;
        }

        const currentTime = this.getPointTime(point);

        let currentLocation = null;

        for (const loc of this.state.dayLocations) {
            if (!loc.lat || !loc.lng) continue;
            const visitStart = loc.startDate ? new Date(loc.startDate).getTime() : null;
            const visitEnd = loc.endDate ? new Date(loc.endDate).getTime() : null;

            // Track last location end time
            if (visitEnd && currentTime && visitEnd < currentTime) {
                if (visitEnd > this.state.lastLocationEndTime) {
                    this.state.lastLocationEndTime = visitEnd;
                }
            }

            if (visitStart && visitEnd && targetTime >= visitStart && targetTime <= visitEnd) {
                currentLocation = loc;
            }
        }

        if (currentLocation) {
            const locName = currentLocation.name || currentLocation.location || 'Unknown';
            this.showLocationPopup(currentLocation.lat, currentLocation.lng, locName, targetTime);
            this.centerOnPoint(currentLocation.lat, currentLocation.lng);
        } else {
            this.centerOnPoint(point.lat, point.lng);
        }
    }

    // ===== Control Methods =====

    restart() {
        if (!this.state.routeData || this.state.routeData.length < 2) return;

        this.state.currentDistance = 0;
        this.state.currentIndex = 0;
        this.state.pauseUntil = 0;
        this.state.currentLocationName = null;
        this.state.visitedLocations.clear();
        this.state.lastHighlightedEntry = null;
        this.state.lastLocationEndTime = 0;
        this.state.nextStopIndex = 0;  // Reset to first stop

        this.hideLocationPopup();

        const firstPoint = this.state.routeData[0];
        this.state.marker.setLatLng([firstPoint.lat, firstPoint.lng]);
        this.centerOnPoint(firstPoint.lat, firstPoint.lng);

        this.showLocationPopupAtStart();

        this.updateTimeDisplay();
        this.updateProgress();
        this.updateSpeedometer(0);
    }

    setSpeed(value) {
        this.state.speed = parseFloat(value);
    }

    zoom(delta) {
        this.state.zoomLevel = Math.max(13, Math.min(19, this.state.zoomLevel + delta));
        const point = this.state.routeData?.[this.state.currentIndex];
        if (point) {
            this.centerOnPoint(point.lat, point.lng);
        }
    }

    stopAnimation() {
        this.state.playing = false;
        if (this.state.animationFrame) {
            cancelAnimationFrame(this.state.animationFrame);
            this.state.animationFrame = null;
        }

        const btn = document.getElementById('replayPlayBtn');
        const icon = document.getElementById('replayPlayIcon');
        if (btn) btn.classList.remove('playing');
        if (icon) icon.textContent = '▶';
    }

    cleanup() {
        if (this.state.marker && this.getMap()) {
            this.getMap().removeLayer(this.state.marker);
        }

        this.hideLocationPopup();

        this.state.marker = null;
        this.state.routeData = null;
        this.state.cumulativeDistances = null;
        this.state.totalDistance = 0;
        this.state.currentDistance = 0;
        this.state.currentIndex = 0;
        this.state.dayLocations = [];
        this.state.currentLocationName = null;
        this.state.pauseUntil = 0;
        this.state.selectedDayKey = null;

        const timeEl = document.getElementById('replayActivityTime');
        const typeEl = document.getElementById('replayActivityType');
        const statsEl = document.getElementById('replayActivityStats');
        const nextEl = document.getElementById('replayNextName');
        if (timeEl) timeEl.textContent = '--:--';
        if (typeEl) typeEl.textContent = '--';
        if (statsEl) statsEl.textContent = '';
        if (nextEl) nextEl.textContent = '--';

        const markersEl = document.getElementById('replayLocationMarkers');
        if (markersEl) markersEl.innerHTML = '';

        const currentDayKey = this.getCurrentDayKey();
        if (currentDayKey && this.showDayMap) {
            this.showDayMap(currentDayKey);
        }
    }
}

// Create global instance
window.replayController = new ReplayController();
