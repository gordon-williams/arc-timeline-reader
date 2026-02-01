/**
 * Map Tools - Measurement and Route Search
 * Part of Arc Timeline Diary Reader
 *
 * Contains:
 * - MeasurementTool class - measuring distances on the map
 * - Route Search functions - From/To location search with OSRM routing
 * - Utility functions for distance calculation
 */

// ========== Utility Functions ==========

// Haversine formula for distance between two points (returns km)
function calculateDistanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function formatSearchDistance(km) {
    if (km < 1) {
        return `${(km).toFixed(2)} km`;
    } else if (km < 10) {
        return `${km.toFixed(1)} km`;
    } else {
        return `${Math.round(km)} km`;
    }
}

/**
 * Fetch elevation data for route coordinates using Open-Elevation API
 * Samples coordinates for longer routes, batches requests for very long routes
 * @param {Array} coords - Array of [lat, lng] coordinates
 * @returns {Promise<Array>} - Array of {lat, lng, elevation} objects, or null if failed
 */
async function fetchRouteElevation(coords) {
    if (!coords || coords.length === 0) return null;

    // Target ~500 points for good detail, max 200 per API request batch
    const maxPoints = 500;
    const batchSize = 200;

    let sampledCoords;
    if (coords.length <= maxPoints) {
        sampledCoords = coords;
    } else {
        // Sample evenly, always include first and last points
        const step = (coords.length - 1) / (maxPoints - 1);
        sampledCoords = [];
        for (let i = 0; i < maxPoints; i++) {
            const idx = Math.round(i * step);
            sampledCoords.push(coords[idx]);
        }
    }

    try {
        // Use Open-Elevation API (free, no key required)
        // Batch requests if needed
        const allResults = [];

        for (let i = 0; i < sampledCoords.length; i += batchSize) {
            const batch = sampledCoords.slice(i, i + batchSize);
            const locations = batch.map(c => ({ latitude: c[0], longitude: c[1] }));

            const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locations })
            });

            if (!response.ok) throw new Error('Elevation API request failed');

            const data = await response.json();
            if (data.results && data.results.length > 0) {
                allResults.push(...data.results);
            }

            // Small delay between batches to be nice to the API
            if (i + batchSize < sampledCoords.length) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        if (allResults.length > 0) {
            return allResults.map(r => ({
                lat: r.latitude,
                lng: r.longitude,
                elevation: r.elevation
            }));
        }
    } catch (err) {
        console.warn('Elevation fetch failed:', err.message);
    }

    return null;
}

/**
 * Calculate elevation statistics from elevation data
 * @param {Array} elevationData - Array of {elevation} objects
 * @returns {Object} - {gain, loss, min, max}
 */
function calculateElevationStats(elevationData) {
    if (!elevationData || elevationData.length < 2) return null;

    let gain = 0, loss = 0;
    let min = elevationData[0].elevation;
    let max = elevationData[0].elevation;

    for (let i = 1; i < elevationData.length; i++) {
        const prev = elevationData[i - 1].elevation;
        const curr = elevationData[i].elevation;
        const diff = curr - prev;

        if (diff > 0) gain += diff;
        else loss += Math.abs(diff);

        if (curr < min) min = curr;
        if (curr > max) max = curr;
    }

    return { gain: Math.round(gain), loss: Math.round(loss), min: Math.round(min), max: Math.round(max) };
}

// ========== Measurement Tool ==========

class MeasurementTool {
    #map = null;
    #active = false;
    #points = [];
    #markers = [];
    #lines = [];
    #popup = null;
    #rubberBand = null;
    #mouseMoveHandler = null;
    
    constructor(map) {
        this.#map = map;
        
        // Bind handlers
        this.#mouseMoveHandler = (e) => this.#onMouseMove(e);
    }
    
    get isActive() {
        return this.#active;
    }
    
    toggle() {
        if (this.#active) {
            // Currently measuring - stop measuring but keep measurement visible
            this.#deactivate();
        } else if (this.#points.length > 0) {
            // Has existing measurement - clear it
            this.clear();
            // Ensure button is inactive
            const btn = document.getElementById('measureBtn');
            if (btn) btn.classList.remove('active');
        } else {
            // No measurement - start measuring
            this.#activate();
        }
    }
    
    #activate() {
        this.#active = true;
        this.clear();
        
        // Update button state - get fresh reference
        const btn = document.getElementById('measureBtn');
        if (btn) {
            btn.classList.add('active');
        }
        
        // Change cursor
        const mapContainer = this.#map.getContainer();
        mapContainer.style.cursor = 'crosshair';
        
        // Enable rubber band preview
        this.#map.on('mousemove', this.#mouseMoveHandler);
    }
    
    #deactivate() {
        this.#active = false;
        
        // Only remove active class if no measurements exist
        // Button stays active-looking while measurement is displayed
        if (this.#points.length === 0) {
            const btn = document.getElementById('measureBtn');
            if (btn) {
                btn.classList.remove('active');
            }
        }
        
        // Restore cursor
        const mapContainer = this.#map.getContainer();
        mapContainer.style.cursor = '';
        
        // Disable rubber band
        this.#map.off('mousemove', this.#mouseMoveHandler);
        this.#removeRubberBand();
    }
    
    #onMouseMove(e) {
        if (!this.#active || this.#points.length === 0) return;
        
        const lastPoint = this.#points[this.#points.length - 1];
        
        if (!this.#rubberBand) {
            this.#rubberBand = L.polyline([lastPoint, e.latlng], {
                color: '#ff5722',
                weight: 2,
                dashArray: '5, 10',
                opacity: 0.6,
                interactive: false
            }).addTo(this.#map);
        } else {
            this.#rubberBand.setLatLngs([lastPoint, e.latlng]);
        }
    }
    
    #removeRubberBand() {
        if (this.#rubberBand) {
            this.#map.removeLayer(this.#rubberBand);
            this.#rubberBand = null;
        }
    }
    
    handleClick(e) {
        if (!this.#active) return;
        
        const latlng = e.latlng;
        const self = this;
        const mapContainer = this.#map.getContainer();
        
        this.#points.push(latlng);
        
        // Remove rubber band - it will recreate from new point on next mousemove
        this.#removeRubberBand();
        
        // Determine marker color: green for start, orange for intermediate
        const isFirst = this.#points.length === 1;
        const markerColor = isFirst ? '#4caf50' : '#ff5722';
        
        // Add marker
        const marker = L.circleMarker(latlng, {
            radius: 6,
            fillColor: markerColor,
            color: '#fff',
            weight: 2,
            fillOpacity: 1,
            interactive: true
        }).addTo(this.#map);
        this.#markers.push(marker);
        
        // Draw line to previous point
        if (this.#points.length > 1) {
            const prevPoint = this.#points[this.#points.length - 2];
            const line = L.polyline([prevPoint, latlng], {
                color: '#ff5722',
                weight: 4,
                dashArray: '10, 10',
                interactive: true
            }).addTo(this.#map);
            
            // Make line clickable to zoom and show popup
            line.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (!this.#active && this.#points.length > 1) {
                    this.#showDistance();
                    this.zoomToFit();
                }
            });
            
            // Hover effect (use closure - 'self' for class, 'this' for Leaflet)
            line.on('mouseover', function() {
                if (!self.isActive) {
                    this.setStyle({ weight: 6 });
                }
            });
            line.on('mouseout', function() {
                this.setStyle({ weight: 4 });
            });
            
            this.#lines.push(line);
            this.#showDistance();
        }
        
        // Make markers clickable - option/alt-click to undo
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            
            // Option/Alt-click to undo last point (while measuring)
            if (e.originalEvent.altKey && this.#active) {
                this.undoLastPoint();
                return;
            }
            
            // Normal click when finished - zoom to fit and show popup
            if (!this.#active && this.#points.length > 1) {
                this.#showDistance();
                this.zoomToFit();
            }
        });
        
        // Hover effect for markers
        marker.on('mouseover', function() {
            if (!self.isActive) {
                this.setRadius(8);
            } else {
                mapContainer.style.cursor = 'pointer';
            }
        });
        marker.on('mouseout', function() {
            this.setRadius(6);
            if (self.isActive) {
                mapContainer.style.cursor = 'crosshair';
            }
        });
    }
    
    undoLastPoint() {
        if (this.#points.length === 0) return;
        
        // Remove last point
        this.#points.pop();
        
        // Remove last marker
        if (this.#markers.length > 0) {
            const lastMarker = this.#markers.pop();
            this.#map.removeLayer(lastMarker);
        }
        
        // Remove last line
        if (this.#lines.length > 0) {
            const lastLine = this.#lines.pop();
            this.#map.removeLayer(lastLine);
        }
        
        // Update distance display
        if (this.#points.length > 1) {
            this.#showDistance();
        } else {
            // Close popup if less than 2 points
            if (this.#popup) {
                this.#map.closePopup(this.#popup);
                this.#popup = null;
            }
        }
    }
    
    handleDoubleClick(e) {
        if (!this.#active) return;
        this.finish();
    }
    
    finish() {
        if (this.#points.length > 1) {
            this.#showDistance();
            this.zoomToFit();
        }
        this.#deactivate();
    }
    
    cancel() {
        this.clear();
        this.#deactivate();
    }
    
    zoomToFit() {
        if (this.#points.length < 2) return;
        
        const bounds = L.latLngBounds(this.#points);
        
        // Use NavigationController padding if available, otherwise fallback
        let fitOptions = { maxZoom: 18 };
        if (typeof NavigationController !== 'undefined' && NavigationController.mapPadding) {
            fitOptions = { ...NavigationController.mapPadding, maxZoom: 18 };
        } else {
            fitOptions.padding = [50, 50];
        }
        
        this.#map.fitBounds(bounds, fitOptions);
        
        // Re-show popup after zoom (fitBounds closes popups during animation)
        setTimeout(() => {
            if (this.#points.length > 1) {
                this.#showDistance();
            }
        }, 300);
    }
    
    clear() {
        // Remove rubber band
        this.#removeRubberBand();
        
        // Remove all markers
        this.#markers.forEach(m => this.#map.removeLayer(m));
        this.#markers = [];
        
        // Remove all lines
        this.#lines.forEach(l => this.#map.removeLayer(l));
        this.#lines = [];
        
        // Close popup
        if (this.#popup) {
            this.#map.closePopup(this.#popup);
            this.#popup = null;
        }
        
        // Clear points
        this.#points = [];
    }
    
    #showDistance() {
        if (this.#points.length < 2) return;
        
        const totalDist = this.#calculateDistance();
        const lastPoint = this.#points[this.#points.length - 1];
        
        // Format distance
        let distStr;
        if (totalDist < 1) {
            distStr = `${Math.round(totalDist * 1000)} m`;
        } else {
            distStr = `${totalDist.toFixed(2)} km`;
        }
        
        // Add segment count if more than 2 points
        const segmentInfo = this.#points.length > 2 
            ? `<div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">${this.#points.length - 1} segments</div>` 
            : '';
        
        const content = `
            <div class="measure-info">
                <div style="font-size: 16px; font-weight: 600;">${distStr}</div>
                ${segmentInfo}
            </div>
        `;
        
        if (this.#popup) {
            this.#popup.setContent(content).setLatLng(lastPoint);
            // Must re-open popup in case it was closed by fitBounds
            if (!this.#map.hasLayer(this.#popup)) {
                this.#popup.openOn(this.#map);
            }
        } else {
            this.#popup = L.popup({
                closeButton: false,
                className: 'measure-popup',
                autoPan: false
            })
            .setLatLng(lastPoint)
            .setContent(content)
            .openOn(this.#map);
        }
    }
    
    #calculateDistance() {
        let total = 0;
        for (let i = 1; i < this.#points.length; i++) {
            const p1 = this.#points[i - 1];
            const p2 = this.#points[i];
            total += calculateDistanceKm(p1.lat, p1.lng, p2.lat, p2.lng);
        }
        return total;
    }
    
    static isMeasurePopup(popup) {
        return popup && popup.options && popup.options.className === 'measure-popup';
    }
}

// Bridge functions for HTML onclick and external calls
function toggleMeasureTool() {
    if (window.measurementTool) window.measurementTool.toggle();
}

function cancelMeasurement() {
    if (window.measurementTool) window.measurementTool.cancel();
}

// ========== Route Search ==========

// State for route search (exposed globally for elevation panel integration)
const routeSearchState = {
    from: null,  // { lat, lng, name }
    to: null,    // { lat, lng, name }
    activeField: null,  // 'from' or 'to'
    searchTimeout: null,
    routeBounds: null,  // Store route bounds for reset view
    elevationData: null,  // Array of {lat, lng, elevation} from API
    elevationStats: null  // {gain, loss, min, max}
};
window.routeSearchState = routeSearchState;  // Expose for app.js elevation panel

function activateLocationSearch() {
    const popup = document.getElementById('searchPopup');
    const inputFrom = document.getElementById('searchFromInput');
    if (!popup) return;

    // Close transparency popup if open
    const transPopup = document.getElementById('transparencySliderPopup');
    if (transPopup && transPopup.style.display === 'block') {
        closeTransparencyPopup();
    }

    // Reset position to CSS default (centered via transform)
    popup.style.left = '';
    popup.style.top = '';
    popup.style.transform = '';

    // Show the popup (CSS will center it)
    popup.style.display = 'block';

    // Clear map layers for clean search view (like replay does)
    if (window.clearMapLayers) {
        window.clearMapLayers();
    }

    // Enable diary location click mode
    enableDiaryLocationClickMode();

    if (inputFrom) {
        inputFrom.focus();
    }
}

// Enable clicking diary locations to populate search fields
function enableDiaryLocationClickMode() {
    // Target diary entries - these are <li> elements containing .location-data spans
    const locationDataElements = document.querySelectorAll('.location-data[data-lat][data-lng]');
    locationDataElements.forEach(locData => {
        const li = locData.closest('li');
        if (li && !li._routeClickHandler) {
            li.classList.add('route-clickable');
            li._routeClickHandler = (e) => {
                // Don't interfere if clicking on a link or button
                if (e.target.closest('a, button')) return;

                e.stopPropagation();
                e.preventDefault();

                const lat = parseFloat(locData.dataset.lat);
                const lng = parseFloat(locData.dataset.lng);
                const name = locData.dataset.location || 'Unknown location';

                if (!isNaN(lat) && !isNaN(lng)) {
                    setRouteLocationFromDiary(lat, lng, name);
                }
            };
            li.addEventListener('click', li._routeClickHandler);
        }
    });

    // Also handle Analysis mode location sections
    const locationSections = document.querySelectorAll('.location-section');
    locationSections.forEach(section => {
        const nameEl = section.querySelector('.location-name');
        if (nameEl && !nameEl._routeClickHandler) {
            nameEl.classList.add('route-clickable');
            nameEl._routeClickHandler = (e) => {
                e.stopPropagation();
                const lat = parseFloat(section.dataset.lat);
                const lng = parseFloat(section.dataset.lng);
                const name = nameEl.textContent.trim();
                if (!isNaN(lat) && !isNaN(lng)) {
                    setRouteLocationFromDiary(lat, lng, name);
                }
            };
            nameEl.addEventListener('click', nameEl._routeClickHandler);
        }
    });
}

// Disable diary location click mode
function disableDiaryLocationClickMode() {
    // Remove from diary entries
    const diaryEntries = document.querySelectorAll('li.route-clickable');
    diaryEntries.forEach(li => {
        li.classList.remove('route-clickable');
        if (li._routeClickHandler) {
            li.removeEventListener('click', li._routeClickHandler);
            delete li._routeClickHandler;
        }
    });

    // Remove from Analysis mode location names
    const locationNames = document.querySelectorAll('.location-name.route-clickable');
    locationNames.forEach(nameEl => {
        nameEl.classList.remove('route-clickable');
        if (nameEl._routeClickHandler) {
            nameEl.removeEventListener('click', nameEl._routeClickHandler);
            delete nameEl._routeClickHandler;
        }
    });
}

function closeSearchPopup() {
    const popup = document.getElementById('searchPopup');
    if (popup) popup.style.display = 'none';

    // Clear results but keep selections
    document.getElementById('searchResultsFrom')?.replaceChildren();
    document.getElementById('searchResultsTo')?.replaceChildren();

    // Disable diary location click mode
    disableDiaryLocationClickMode();

    // Clear any route search markers and layers
    if (window.routeSearchLayer && window.map) {
        window.map.removeLayer(window.routeSearchLayer);
        window.routeSearchLayer = null;
    }
    if (window.routeSearchMarkerFrom && window.map) {
        window.map.removeLayer(window.routeSearchMarkerFrom);
        window.routeSearchMarkerFrom = null;
    }
    if (window.routeSearchMarkerTo && window.map) {
        window.map.removeLayer(window.routeSearchMarkerTo);
        window.routeSearchMarkerTo = null;
    }

    // Restore map to current day view
    if (window.showDayMap && window.NavigationController?.dayKey) {
        window.showDayMap(window.NavigationController.dayKey);
    }
}
window.closeSearchPopup = closeSearchPopup;  // Expose for app.js to close when returning to import screen

function clearRouteSearch() {
    routeSearchState.from = null;
    routeSearchState.to = null;

    const inputFrom = document.getElementById('searchFromInput');
    const inputTo = document.getElementById('searchToInput');
    const resultsFrom = document.getElementById('searchResultsFrom');
    const resultsTo = document.getElementById('searchResultsTo');
    const btnRoute = document.getElementById('btnGetRoute');

    if (inputFrom) {
        inputFrom.value = '';
        inputFrom.classList.remove('has-selection');
    }
    if (inputTo) {
        inputTo.value = '';
        inputTo.classList.remove('has-selection');
    }
    if (resultsFrom) resultsFrom.replaceChildren();
    if (resultsTo) resultsTo.replaceChildren();
    if (btnRoute) btnRoute.disabled = true;

    // Hide navigation controls
    const btnReset = document.getElementById('btnResetView');
    const waypointSelect = document.getElementById('waypointSelect');
    if (btnReset) btnReset.style.display = 'none';
    if (waypointSelect) waypointSelect.style.display = 'none';

    // Clear waypoints
    routeSearchState.waypoints = [];

    // Clear route bounds and elevation data
    routeSearchState.routeBounds = null;
    routeSearchState.elevationData = null;
    routeSearchState.elevationStats = null;

    // Clear any existing route on map (map is global from app.js)
    if (window.routeSearchLayer && window.map) {
        window.map.removeLayer(window.routeSearchLayer);
        window.routeSearchLayer = null;
    }
    if (window.routeSearchMarkerFrom && window.map) {
        window.map.removeLayer(window.routeSearchMarkerFrom);
        window.routeSearchMarkerFrom = null;
    }
    if (window.routeSearchMarkerTo && window.map) {
        window.map.removeLayer(window.routeSearchMarkerTo);
        window.routeSearchMarkerTo = null;
    }
}

function onSearchFocus(field) {
    routeSearchState.activeField = field;
    // Hide the other results
    const otherResults = document.getElementById(field === 'from' ? 'searchResultsTo' : 'searchResultsFrom');
    if (otherResults) otherResults.replaceChildren();
}

function onSearchInput(field) {
    routeSearchState.activeField = field;
    const input = document.getElementById(field === 'from' ? 'searchFromInput' : 'searchToInput');
    const resultsDiv = document.getElementById(field === 'from' ? 'searchResultsFrom' : 'searchResultsTo');

    if (!input || !resultsDiv) return;

    const query = input.value.trim();

    // Clear previous timeout
    if (routeSearchState.searchTimeout) {
        clearTimeout(routeSearchState.searchTimeout);
    }

    if (query.length < 2) {
        resultsDiv.replaceChildren();
        return;
    }

    // Debounce search
    routeSearchState.searchTimeout = setTimeout(() => {
        performRouteSearch(query, field);
    }, 300);
}

async function performRouteSearch(query, field) {
    const resultsDiv = document.getElementById(field === 'from' ? 'searchResultsFrom' : 'searchResultsTo');
    if (!resultsDiv) return;

    try {
        // Build URL with optional viewbox bias based on current map view
        let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;

        // Add viewbox parameter to bias results towards current map region
        if (window.map) {
            const bounds = window.map.getBounds();
            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();
            // viewbox format: <left>,<top>,<right>,<bottom> (lon1,lat1,lon2,lat2)
            url += `&viewbox=${sw.lng},${ne.lat},${ne.lng},${sw.lat}&bounded=0`;
        }

        const response = await fetch(url, { headers: { 'User-Agent': 'ArcTimelineReader/1.0' } });
        const results = await response.json();

        if (results.length === 0) {
            resultsDiv.innerHTML = '<div class="search-no-results">No results found</div>';
            return;
        }

        resultsDiv.innerHTML = results.map(r => {
            const name = r.display_name.split(',').slice(0, 2).join(',');
            return `<div class="search-result-item" onclick="selectRouteLocation('${field}', ${r.lat}, ${r.lon}, '${name.replace(/'/g, "\\'")}')">
                <div class="search-result-name">${name}</div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('Search error:', err);
        resultsDiv.innerHTML = '<div class="search-no-results">Search failed</div>';
    }
}

function selectRouteLocation(field, lat, lng, name) {
    routeSearchState[field] = { lat, lng, name };

    const input = document.getElementById(field === 'from' ? 'searchFromInput' : 'searchToInput');
    const resultsDiv = document.getElementById(field === 'from' ? 'searchResultsFrom' : 'searchResultsTo');
    const btnRoute = document.getElementById('btnGetRoute');

    if (input) {
        input.value = name;
        input.classList.add('has-selection');
    }
    if (resultsDiv) resultsDiv.replaceChildren();

    // Enable Go button if From is selected (with or without To)
    if (btnRoute) {
        btnRoute.disabled = !routeSearchState.from;
    }

    // Auto-focus the other field if empty
    if (field === 'from' && !routeSearchState.to) {
        document.getElementById('searchToInput')?.focus();
    }
}

async function getRouteFromSearch() {
    if (!routeSearchState.from) return;
    if (!window.map) return;

    const map = window.map;
    const from = routeSearchState.from;
    const to = routeSearchState.to;
    const btnReset = document.getElementById('btnResetView');
    const btnGo = document.getElementById('btnGo');

    // Show loading state
    if (btnGo) {
        btnGo.classList.add('loading');
        btnGo.disabled = true;
    }
    document.body.style.cursor = 'wait';

    // Remove existing route layer and markers
    if (window.routeSearchLayer) {
        map.removeLayer(window.routeSearchLayer);
        window.routeSearchLayer = null;
    }
    if (window.routeSearchMarkerFrom) {
        map.removeLayer(window.routeSearchMarkerFrom);
        window.routeSearchMarkerFrom = null;
    }
    if (window.routeSearchMarkerTo) {
        map.removeLayer(window.routeSearchMarkerTo);
        window.routeSearchMarkerTo = null;
    }

    // If only From is selected, just go to that location
    if (!to) {
        // Add a marker at the location with offset popup
        window.routeSearchMarkerFrom = L.marker([from.lat, from.lng], {
            icon: L.divIcon({
                className: 'route-marker-single',
                html: `<div class="route-marker-pin single">
                    <div class="pin-icon"><span>●</span></div>
                </div>`,
                iconSize: [32, 40],
                iconAnchor: [16, 40]
            })
        }).addTo(map).bindPopup(`<b>${from.name}</b>`, { offset: [0, -35] }).openPopup();

        // Fly to the location
        map.flyTo([from.lat, from.lng], 16, { duration: 1 });

        // Store bounds and waypoints for navigation
        routeSearchState.routeBounds = L.latLngBounds([[from.lat, from.lng]]);
        routeSearchState.waypoints = [{ lat: from.lat, lng: from.lng, name: from.name, marker: window.routeSearchMarkerFrom }];

        // Show controls and populate waypoint dropdown
        if (btnReset) btnReset.style.display = '';
        populateWaypointSelect();
        if (btnGo) {
            btnGo.classList.remove('loading');
            btnGo.disabled = false;
        }
        document.body.style.cursor = '';
        return;
    }

    // Both From and To selected - get route
    try {
        const mapboxToken = localStorage.getItem('arc_mapbox_token');
        let coords, distanceKm, durationMin;

        if (mapboxToken) {
            // Use Mapbox Directions API (better routing, more options)
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&access_token=${mapboxToken}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
                throw new Error('Mapbox routing failed, falling back to OSRM');
            }

            const route = data.routes[0];
            coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
            distanceKm = route.distance / 1000;
            durationMin = Math.round(route.duration / 60);
        } else {
            // Fallback to OSRM (free, no API key)
            const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
                alert('Could not find a route between these locations');
                return;
            }

            const route = data.routes[0];
            coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
            distanceKm = route.distance / 1000;
            durationMin = Math.round(route.duration / 60);
        }

        // Draw route
        window.routeSearchLayer = L.polyline(coords, {
            color: '#667eea',
            weight: 5,
            opacity: 0.8
        }).addTo(map);

        // Add markers with improved pin design and offset popups
        window.routeSearchMarkerFrom = L.marker([from.lat, from.lng], {
            icon: L.divIcon({
                className: 'route-marker-start',
                html: `<div class="route-marker-pin start">
                    <div class="pin-icon"><span>A</span></div>
                </div>`,
                iconSize: [32, 40],
                iconAnchor: [16, 40]
            })
        }).addTo(map).bindPopup(`<b>Start:</b> ${from.name}`, { offset: [0, -35] });

        window.routeSearchMarkerTo = L.marker([to.lat, to.lng], {
            icon: L.divIcon({
                className: 'route-marker-end',
                html: `<div class="route-marker-pin end">
                    <div class="pin-icon"><span>B</span></div>
                </div>`,
                iconSize: [32, 40],
                iconAnchor: [16, 40]
            })
        }).addTo(map).bindPopup(`<b>End:</b> ${to.name}`, { offset: [0, -35] });

        // Store bounds and waypoints
        routeSearchState.routeBounds = window.routeSearchLayer.getBounds();
        routeSearchState.waypoints = [
            { lat: from.lat, lng: from.lng, name: from.name, marker: window.routeSearchMarkerFrom, label: 'A' },
            { lat: to.lat, lng: to.lng, name: to.name, marker: window.routeSearchMarkerTo, label: 'B' }
        ];

        // Fit bounds with proper padding for diary panel
        const padding = (window.NavigationController && window.NavigationController.mapPadding)
            ? window.NavigationController.mapPadding
            : { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] };
        map.fitBounds(routeSearchState.routeBounds, {
            paddingTopLeft: padding.paddingTopLeft,
            paddingBottomRight: padding.paddingBottomRight
        });

        // Show route info popup (basic info first, elevation added async)
        const durationStr = durationMin >= 60
            ? `${Math.floor(durationMin/60)}h ${durationMin%60}m`
            : `${durationMin} min`;

        const routePopup = L.popup()
            .setLatLng(coords[Math.floor(coords.length / 2)])
            .setContent(`
                <div style="text-align:center;">
                    <div style="font-weight:600;margin-bottom:4px;">${distanceKm.toFixed(1)} km</div>
                    <div style="color:#666;font-size:12px;">🚗 ${durationStr}</div>
                </div>
            `)
            .openOn(map);

        // Show controls and populate waypoint dropdown
        if (btnReset) btnReset.style.display = '';
        populateWaypointSelect();
        if (btnGo) {
            btnGo.classList.remove('loading');
            btnGo.disabled = false;
        }
        document.body.style.cursor = '';

        // Fetch elevation data asynchronously (don't block route display)
        fetchRouteElevation(coords).then(elevationData => {
            if (elevationData && elevationData.length > 0) {
                const stats = calculateElevationStats(elevationData);
                if (stats) {
                    // Store elevation data for elevation panel and future use
                    routeSearchState.elevationData = elevationData;
                    routeSearchState.elevationStats = stats;

                    // Update popup with elevation info
                    let elevationHtml = '';
                    if (stats.gain > 0 || stats.loss > 0) {
                        elevationHtml = `<div style="color:#666;font-size:11px;margin-top:4px;">↑${stats.gain}m ↓${stats.loss}m</div>`;
                    }

                    routePopup.setContent(`
                        <div style="text-align:center;">
                            <div style="font-weight:600;margin-bottom:4px;">${distanceKm.toFixed(1)} km</div>
                            <div style="color:#666;font-size:12px;">🚗 ${durationStr}</div>
                            ${elevationHtml}
                        </div>
                    `);

                    // Trigger elevation panel update if it's open
                    if (typeof window.updateElevationChart === 'function') {
                        window.updateElevationChart();
                    }
                }
            }
        }).catch(err => {
            console.warn('Elevation fetch error:', err);
        });

    } catch (err) {
        console.error('Routing error:', err);
        // Restore cursor on error
        if (btnGo) {
            btnGo.classList.remove('loading');
            btnGo.disabled = false;
        }
        document.body.style.cursor = '';
        alert('Failed to get route. Please try again.');
    }
}

// Reset view to show the whole route/location
function resetRouteView() {
    if (!window.map) return;

    if (routeSearchState.routeBounds) {
        const padding = (window.NavigationController && window.NavigationController.mapPadding)
            ? window.NavigationController.mapPadding
            : { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] };

        if (routeSearchState.to) {
            // If route exists, fit to route bounds
            window.map.fitBounds(routeSearchState.routeBounds, {
                paddingTopLeft: padding.paddingTopLeft,
                paddingBottomRight: padding.paddingBottomRight
            });
        } else if (routeSearchState.from) {
            // If single location, fly to it
            window.map.flyTo([routeSearchState.from.lat, routeSearchState.from.lng], 16, { duration: 0.5 });
        }
    }
}

// Populate waypoint dropdown
function populateWaypointSelect() {
    const select = document.getElementById('waypointSelect');
    if (!select) return;

    // Clear existing options
    select.innerHTML = '<option value="">Go to...</option>';

    // Add waypoints
    if (routeSearchState.waypoints && routeSearchState.waypoints.length > 0) {
        routeSearchState.waypoints.forEach((wp, idx) => {
            const option = document.createElement('option');
            option.value = idx;
            const label = wp.label ? `${wp.label}: ` : '';
            // Truncate long names
            const name = wp.name.length > 25 ? wp.name.substring(0, 22) + '...' : wp.name;
            option.textContent = `${label}${name}`;
            select.appendChild(option);
        });
        select.style.display = '';
    } else {
        select.style.display = 'none';
    }
}

// Go to selected waypoint
function gotoWaypoint(index) {
    if (!window.map || index === '' || index === null) return;

    const idx = parseInt(index);
    const waypoint = routeSearchState.waypoints?.[idx];
    if (!waypoint) return;

    const map = window.map;
    const targetZoom = 17;

    // Get the map container size and padding
    const mapSize = map.getSize();
    const padding = (window.NavigationController && window.NavigationController.mapPadding)
        ? window.NavigationController.mapPadding
        : { paddingTopLeft: [0, 0], paddingBottomRight: [0, 0] };

    // Calculate the center of the safe (unobstructed) area
    // Safe area: from paddingTopLeft to (mapSize - paddingBottomRight)
    const safeLeft = padding.paddingTopLeft[0];
    const safeTop = padding.paddingTopLeft[1];
    const safeRight = mapSize.x - padding.paddingBottomRight[0];
    const safeBottom = mapSize.y - padding.paddingBottomRight[1];

    // Center of safe area in pixels
    const safeCenterX = (safeLeft + safeRight) / 2;
    const safeCenterY = (safeTop + safeBottom) / 2;

    // Map center in pixels
    const mapCenterX = mapSize.x / 2;
    const mapCenterY = mapSize.y / 2;

    // Offset needed: how much the safe center differs from map center
    const offsetX = safeCenterX - mapCenterX;
    const offsetY = safeCenterY - mapCenterY;

    // Convert waypoint to pixel at target zoom, apply offset, convert back to latlng
    const targetPoint = map.project([waypoint.lat, waypoint.lng], targetZoom);
    const offsetPoint = L.point(targetPoint.x - offsetX, targetPoint.y - offsetY);
    const offsetLatLng = map.unproject(offsetPoint, targetZoom);

    // Use setView (no animation) to avoid blurry tiles, then let tiles load
    map.setView(offsetLatLng, targetZoom, { animate: false });

    // Wait for tiles to load, then open popup
    setTimeout(() => {
        if (waypoint.marker) {
            waypoint.marker.openPopup();
        }
    }, 400);

    // Reset dropdown to placeholder
    const select = document.getElementById('waypointSelect');
    if (select) select.value = '';
}

// Set location from diary click
function setRouteLocationFromDiary(lat, lng, name) {
    const field = routeSearchState.activeField || 'from';
    selectRouteLocation(field, lat, lng, name);

    // If we just set the From, switch active field to To
    if (field === 'from') {
        routeSearchState.activeField = 'to';
        document.getElementById('searchToInput')?.focus();
    }
}

// Check if route search has an active route
function hasActiveRouteSearch() {
    return window.routeSearchLayer !== null && window.routeSearchLayer !== undefined;
}

