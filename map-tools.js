/**
 * Map Tools - Measurement and Location Search
 * Part of Arc Timeline Diary Reader
 * 
 * Contains:
 * - MeasurementTool class - measuring distances on the map
 * - LocationSearch class - location search with OSRM routing
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

// Bridge function for HTML onclick
function toggleMeasureTool() {
    if (window.measurementTool) window.measurementTool.toggle();
}

// ========== Location Search ==========

class LocationSearch {
    #map = null;
    #userLocation = null;
    #userLocationName = null;
    #customStart = null;
    #customStartName = null;
    #startMarker = null;
    #searchTimeout = null;
    #searchMarker = null;
    #routeLine = null;
    #routeCoords = null;
    #routeInfo = null;
    #waypoints = [];
    #waypointMarkers = [];
    #destination = null;
    #popup = null;
    #btn = null;
    #input = null;
    #resultsDiv = null;
    #debugDiv = null;
    #addingWaypoint = false;
    
    constructor(map) {
        this.#map = map;
        this.#popup = document.getElementById('searchPopup');
        this.#btn = document.getElementById('searchBtn');
        this.#input = document.getElementById('locationSearchInput');
        this.#resultsDiv = document.getElementById('searchResults');
    }
    
    get userLocation() {
        return this.#userLocation;
    }
    
    get startLocation() {
        return this.#customStart || this.#userLocation;
    }
    
    get startLocationName() {
        return this.#customStart ? this.#customStartName : this.#userLocationName;
    }
    
    get hasActiveRoute() {
        return this.#routeLine !== null;
    }
    
    toggle() {
        if (!this.#popup) return;
        
        // Close other popups
        const transPopup = document.getElementById('transparencySliderPopup');
        const transBtn = document.getElementById('transparencyBtn');
        if (transPopup && transPopup.style.display === 'block') {
            transPopup.style.display = 'none';
            if (transBtn) transBtn.classList.remove('popup-open');
        }
        const animPopup = document.getElementById('animationSettingsPopup');
        const animBtn = document.getElementById('animationBtn');
        if (animPopup && animPopup.style.display === 'block') {
            animPopup.style.display = 'none';
            if (animBtn) animBtn.classList.remove('popup-open');
        }
        
        if (this.#popup.style.display === 'none' || this.#popup.style.display === '') {
            this.#open();
        } else {
            this.#close();
        }
    }
    
    #open() {
        this.#popup.style.display = 'block';
        if (this.#btn) this.#btn.classList.add('popup-open');
        if (this.#input) this.#input.focus();
        
        // Get user location for distance display
        if (!this.#userLocation) {
            this.#createDebugDiv();
            this.#debugDiv.innerHTML = '📍 Getting your location...';
            this.#debugDiv.style.color = '#888';
            this.#getUserLocation();
        } else {
            this.#updateDebugDisplay();
        }
    }
    
    #close() {
        this.#popup.style.display = 'none';
        if (this.#btn) this.#btn.classList.remove('popup-open');
        
        // Clear any pending search
        if (this.#searchTimeout) {
            clearTimeout(this.#searchTimeout);
            this.#searchTimeout = null;
        }
    }
    
    isOpen() {
        return this.#popup && this.#popup.style.display === 'block';
    }
    
    #createDebugDiv() {
        if (!this.#debugDiv) {
            this.#debugDiv = document.getElementById('locationDebug');
            if (!this.#debugDiv && this.#popup) {
                this.#debugDiv = document.createElement('div');
                this.#debugDiv.id = 'locationDebug';
                this.#debugDiv.style.cssText = 'font-size: 11px; color: #888; margin-bottom: 8px; padding: 6px; background: #f5f5f5; border-radius: 4px;';
                this.#popup.insertBefore(this.#debugDiv, this.#popup.firstChild);
            }
        }
    }
    
    #getUserLocation() {
        if (!navigator.geolocation) return;
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.#userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                logDebug(`📍 Got user location: ${this.#userLocation.lat.toFixed(4)}, ${this.#userLocation.lng.toFixed(4)}`);
                
                // Reverse geocode to get location name
                this.#reverseGeocode(this.#userLocation.lat, this.#userLocation.lng);
                
                // Re-render search results if they exist
                if (this.#input && this.#input.value.trim().length >= 2 && 
                    this.#resultsDiv?.querySelector('.search-result-item')) {
                    this.search();
                }
            },
            (error) => {
                logDebug(`📍 Geolocation error: ${error.message}`);
                this.#createDebugDiv();
                if (this.#debugDiv) {
                    this.#debugDiv.innerHTML = '❌ Location unavailable';
                    this.#debugDiv.style.color = '#f44336';
                }
            },
            { timeout: 10000, maximumAge: 300000 }
        );
    }
    
    async #reverseGeocode(lat, lng) {
        this.#createDebugDiv();
        
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`;
            const response = await fetch(url, {
                headers: { 'User-Agent': 'ArcTimelineDiaryReader/1.0' }
            });
            
            if (!response.ok) throw new Error('Reverse geocode failed');
            
            const data = await response.json();
            const address = data.address || {};
            
            const parts = [];
            if (address.suburb || address.neighbourhood) {
                parts.push(address.suburb || address.neighbourhood);
            }
            if (address.city || address.town || address.village) {
                parts.push(address.city || address.town || address.village);
            }
            
            this.#userLocationName = parts.length > 0 
                ? parts.join(', ') 
                : data.display_name?.split(',').slice(0, 2).join(',') || 'Unknown';
            
            this.#updateDebugDisplay();
            
        } catch (err) {
            this.#userLocationName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            this.#updateDebugDisplay();
        }
    }
    
    #updateDebugDisplay() {
        this.#createDebugDiv();
        if (!this.#debugDiv) return;
        
        if (this.#customStart && this.#customStartName) {
            // Custom start location set
            this.#debugDiv.innerHTML = `🚩 Start: ${this.#customStartName} <a href="#" onclick="event.preventDefault(); locationSearch.clearStart();" style="color:#999;font-size:10px;margin-left:4px;">clear</a>`;
            this.#debugDiv.style.color = '#4caf50';
        } else if (this.#userLocation && this.#userLocationName) {
            // Using GPS location
            this.#debugDiv.innerHTML = `📍 Start: ${this.#userLocationName} <span style="color:#999;font-size:10px;">(GPS)</span>`;
            this.#debugDiv.style.color = '#4caf50';
        } else if (this.#userLocation) {
            // GPS but no name yet
            this.#debugDiv.innerHTML = `📍 Getting location name...`;
            this.#debugDiv.style.color = '#888';
        } else {
            // No location at all
            this.#debugDiv.innerHTML = `⚠️ No start location - search and click "Start"`;
            this.#debugDiv.style.color = '#ff9800';
        }
    }
    
    handleKeydown(e) {
        if (e.key === 'Enter') {
            this.search();
        } else if (e.key === 'Escape') {
            this.toggle();
        } else {
            // Debounced auto-search
            if (this.#searchTimeout) clearTimeout(this.#searchTimeout);
            this.#searchTimeout = setTimeout(() => {
                // Only search if popup is still open
                if (this.isOpen() && this.#input && this.#input.value.trim().length >= 3) {
                    this.search();
                }
            }, 500);
        }
    }
    
    async search() {
        // Don't search if popup is closed
        if (!this.isOpen()) return;
        if (!this.#input || !this.#resultsDiv) return;
        
        const query = this.#input.value.trim();
        if (query.length < 2) {
            this.#resultsDiv.innerHTML = '<div class="search-hint">Type at least 2 characters</div>';
            return;
        }
        
        this.#resultsDiv.innerHTML = '<div class="search-loading">Searching...</div>';
        
        try {
            // Check if Mapbox token is available
            const mapboxToken = localStorage.getItem('arc_mapbox_token');
            let results;
            
            if (mapboxToken) {
                // Use Mapbox geocoding (faster, better results)
                results = await this.#searchMapbox(query, mapboxToken);
            } else {
                // Fall back to Nominatim
                results = await this.#searchNominatim(query);
            }
            
            // Don't render if popup was closed during search
            if (!this.isOpen()) return;
            
            if (results.length === 0) {
                this.#resultsDiv.innerHTML = '<div class="search-no-results">No results found</div>';
                return;
            }
            
            this.#resultsDiv.innerHTML = results.map(r => {
                let distanceHtml = '';
                let actionsHtml = '';
                const start = this.startLocation;
                
                if (start) {
                    const dist = calculateDistanceKm(start.lat, start.lng, r.lat, r.lng);
                    distanceHtml = `<span class="search-result-distance">${formatSearchDistance(dist)}</span>`;
                }
                
                // Always show buttons
                const escapedName = r.name.replace(/'/g, "\\'");
                actionsHtml = `
                    <button class="search-start-btn" onclick="event.stopPropagation(); locationSearch.setStart(${r.lat}, ${r.lng}, '${escapedName}')">Start</button>
                    <button class="search-route-btn" onclick="event.stopPropagation(); locationSearch.getRoute(${r.lat}, ${r.lng}, '${escapedName}')">Route</button>
                `;
                
                return `
                <div class="search-result-item" onclick="locationSearch.selectResult(${r.lat}, ${r.lng}, '${escapedName}')">
                    <div class="search-result-content">
                        <div class="search-result-name">${r.primary}</div>
                        <div class="search-result-detail">${r.secondary}</div>
                    </div>
                    <div class="search-result-actions">
                        ${distanceHtml}
                        <div class="search-result-buttons">
                            ${actionsHtml}
                        </div>
                    </div>
                </div>
            `}).join('');
            
        } catch (err) {
            logError('Search error:', err);
            this.#resultsDiv.innerHTML = '<div class="search-error">Search failed. Try again.</div>';
        }
    }
    
    async #searchMapbox(query, token) {
        // Bias towards Australia
        const bbox = '113.0,-44.0,154.0,-10.0'; // Australia bounding box
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&bbox=${bbox}&limit=5`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('Mapbox search failed');
        
        const data = await response.json();
        
        return data.features.map(f => {
            const [lng, lat] = f.center;
            const contextParts = f.context ? f.context.map(c => c.text) : [];
            return {
                lat,
                lng,
                name: f.place_name,
                primary: f.text || f.place_name.split(',')[0],
                secondary: contextParts.slice(0, 2).join(', ') || f.place_name.split(',').slice(1, 3).join(',').trim()
            };
        });
    }
    
    async #searchNominatim(query) {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=au&limit=5`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'ArcTimelineDiaryReader/1.0' }
        });
        
        if (!response.ok) throw new Error('Nominatim search failed');
        
        const results = await response.json();
        
        return results.map(r => {
            const nameParts = r.display_name.split(',');
            return {
                lat: parseFloat(r.lat),
                lng: parseFloat(r.lon),
                name: r.display_name,
                primary: nameParts.slice(0, 2).join(', '),
                secondary: nameParts.slice(2, 4).join(', ').trim()
            };
        });
    }
    
    selectResult(lat, lng, name) {
        if (!this.#map) return;
        
        // Zoom to location
        this.#map.setView([lat, lng], 16);
        
        // Remove existing search marker
        if (this.#searchMarker) {
            this.#map.removeLayer(this.#searchMarker);
        }
        
        // Show temporary marker
        this.#searchMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'search-result-marker',
                html: '<div style="background:#667eea;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(this.#map);
        
        // Build popup content with distance
        const shortName = name.split(',').slice(0, 2).join(', ');
        let popupContent = `<b>${shortName}</b>`;
        const start = this.startLocation;
        if (start) {
            const dist = calculateDistanceKm(start.lat, start.lng, lat, lng);
            popupContent += `<br><span style="color:#667eea;font-size:12px;">${formatSearchDistance(dist)} away</span>`;
        }
        
        this.#searchMarker.bindPopup(popupContent).openPopup();
        
        // Remove marker after 30 seconds
        setTimeout(() => {
            if (this.#searchMarker) {
                this.#map.removeLayer(this.#searchMarker);
                this.#searchMarker = null;
            }
        }, 30000);
        
        logDebug(`🔍 Search: jumped to ${name.substring(0, 50)}...`);
    }
    
    setStart(lat, lng, name) {
        const shortName = name.split(',').slice(0, 2).join(', ');
        this.#customStart = { lat, lng };
        this.#customStartName = shortName;
        
        // Add/update start marker on map
        if (this.#startMarker) {
            this.#map.removeLayer(this.#startMarker);
        }
        this.#startMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'start-marker',
                html: '<div style="background:#4caf50;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(this.#map);
        
        this.#startMarker.bindPopup(`<b>Start:</b> ${shortName}<br><button onclick="locationSearch.clearStart()" style="margin-top:6px;padding:4px 8px;font-size:11px;background:#f0f0f0;border:1px solid #ccc;border-radius:4px;cursor:pointer;">Clear Start</button>`);
        
        // Update debug display
        this.#updateDebugDisplay();
        
        // Recalculate route if destination exists
        if (this.#destination) {
            this.#calculateRoute();
        }
        
        logDebug(`📍 Start set: ${shortName}`);
    }
    
    clearStart() {
        this.#customStart = null;
        this.#customStartName = null;
        if (this.#startMarker) {
            this.#map.removeLayer(this.#startMarker);
            this.#startMarker = null;
        }
        this.#updateDebugDisplay();
        
        // Recalculate route if destination exists and we have user location
        if (this.#destination && this.#userLocation) {
            this.#calculateRoute();
        }
    }
    
    async getRoute(destLat, destLng, name) {
        if (!this.#map) return;
        
        const start = this.startLocation;
        if (!start) {
            logDebug('🚗 Route: No start location - set a start point first');
            this.#createDebugDiv();
            this.#debugDiv.innerHTML = '⚠️ Set a start location first';
            this.#debugDiv.style.color = '#ff9800';
            return;
        }
        
        // Store destination
        this.#destination = { lat: destLat, lng: destLng, name: name };
        this.#waypoints = [];
        
        // Calculate and draw route
        await this.#calculateRoute();
    }
    
    async #calculateRoute(skipZoom = false) {
        if (!this.#destination) return;
        
        const start = this.startLocation;
        if (!start) return;
        
        // Clear previous route visuals
        this.#clearRouteVisuals();
        
        const shortName = this.#destination.name.split(',').slice(0, 2).join(', ');
        this.#createDebugDiv();
        this.#debugDiv.innerHTML = '🚗 Calculating route...';
        this.#debugDiv.style.color = '#667eea';
        
        try {
            // Build waypoints string for OSRM
            // Format: lng,lat;lng,lat;...
            let coordsStr = `${start.lng},${start.lat}`;
            
            // Add waypoints
            for (const wp of this.#waypoints) {
                coordsStr += `;${wp.lng},${wp.lat}`;
            }
            
            // Add destination
            coordsStr += `;${this.#destination.lng},${this.#destination.lat}`;
            
            const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
            
            const response = await fetch(url);
            if (!response.ok) throw new Error('Route request failed');
            
            const data = await response.json();
            
            if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
                throw new Error('No route found');
            }
            
            const route = data.routes[0];
            const distanceKm = route.distance / 1000;
            const durationMin = Math.round(route.duration / 60);
            
            // Draw route on map
            const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
            this.#routeCoords = coords;
            
            // Hide diary routes and stats panel on initial route (not when editing waypoints)
            if (!skipZoom) {
                if (typeof hideDiaryRoutes === 'function') {
                    hideDiaryRoutes();
                }
                // Close stats panel visually and clear its margin
                const statsFloat = document.getElementById('statsFloat');
                if (statsFloat) {
                    statsFloat.style.display = 'none';
                }
                // Clear right margin so route can use full space (noRefit because showRoutePopup will zoom)
                if (window.NavigationController) {
                    window.NavigationController.updateViewportMargins({ right: 0 }, { delay: 0, noRefit: true });
                }
            }
            
            this.#routeLine = L.polyline(coords, {
                color: '#667eea',
                weight: 5,
                opacity: 0.8
            }).addTo(this.#map);
            
            // Route click handler
            this.#routeLine.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                
                if (e.originalEvent.altKey) {
                    // Option/Alt + click: add waypoint
                    this.#addWaypoint(e.latlng.lat, e.latlng.lng);
                } else {
                    // Normal click: zoom to show whole route and show popup
                    if (this.#routeInfo) {
                        this.#showRoutePopup(this.#routeCoords, this.#routeInfo.distanceKm, 
                            this.#routeInfo.durationStr, this.#routeInfo.startName, this.#routeInfo.destName);
                    }
                }
            });
            
            // Add waypoint markers
            this.#waypoints.forEach((wp, idx) => {
                const marker = L.marker([wp.lat, wp.lng], {
                    icon: L.divIcon({
                        className: 'waypoint-marker',
                        html: `<div style="background:#ff9800;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:8px;color:white;font-weight:bold;">${idx + 1}</div>`,
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                    }),
                    draggable: true
                }).addTo(this.#map);
                
                // Drag to reposition waypoint
                marker.on('dragend', async (e) => {
                    const newPos = e.target.getLatLng();
                    this.#waypoints[idx] = { lat: newPos.lat, lng: newPos.lng };
                    await this.#calculateRoute(true); // Skip zoom to preserve detailed view
                });
                
                // Right-click to remove waypoint
                marker.on('contextmenu', async (e) => {
                    L.DomEvent.stopPropagation(e);
                    this.#waypoints.splice(idx, 1);
                    await this.#calculateRoute(true); // Skip zoom to preserve detailed view
                });
                
                this.#waypointMarkers.push(marker);
            });
            
            // Add destination marker
            if (this.#searchMarker) {
                this.#map.removeLayer(this.#searchMarker);
            }
            this.#searchMarker = L.marker([this.#destination.lat, this.#destination.lng], {
                icon: L.divIcon({
                    className: 'search-result-marker',
                    html: '<div style="background:#667eea;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                })
            }).addTo(this.#map);
            
            // Right-click destination marker to clear route
            this.#searchMarker.on('contextmenu', (e) => {
                L.DomEvent.stopPropagation(e);
                this.clearRoute();
            });
            
            // Format duration
            let durationStr;
            if (durationMin < 60) {
                durationStr = `${durationMin} min`;
            } else {
                const hours = Math.floor(durationMin / 60);
                const mins = durationMin % 60;
                durationStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
            }
            
            // Get start location name
            const startName = this.startLocationName || 'Current location';
            
            // Store route info for reuse on click
            this.#routeInfo = { distanceKm, durationStr, startName, destName: shortName };
            
            // Show route popup and zoom to fit (unless skipZoom)
            this.#showRoutePopup(coords, distanceKm, durationStr, startName, shortName, skipZoom);
            
            // Update debug display
            const wpText = this.#waypoints.length > 0 ? ` (${this.#waypoints.length} stops)` : '';
            this.#debugDiv.innerHTML = `🚗 ${formatSearchDistance(distanceKm)} · ${durationStr}${wpText}`;
            this.#debugDiv.style.color = '#667eea';
            
            logDebug(`🚗 Route: ${formatSearchDistance(distanceKm)}, ${durationStr}, ${this.#waypoints.length} waypoints`);
            
        } catch (err) {
            logError('Route error:', err);
            this.#debugDiv.innerHTML = '❌ Could not calculate route';
            this.#debugDiv.style.color = '#f44336';
        }
    }
    
    #showRoutePopup(coords, distanceKm, durationStr, startName, destName, skipZoom = false) {
        // Skip popup and zoom when just updating route (waypoint add/drag)
        if (skipZoom) return;
        
        // Popup with route info - clean design
        const waypointText = this.#waypoints.length > 0 
            ? `<div style="font-size:11px;color:#888;margin-top:4px;">${this.#waypoints.length} stop${this.#waypoints.length > 1 ? 's' : ''}</div>`
            : '';
        
        const popupContent = `
            <div style="min-width:160px;">
                <div style="font-size:11px;color:#888;margin-bottom:2px;">From</div>
                <div style="font-weight:500;margin-bottom:8px;padding-right:12px;">${startName}</div>
                <div style="font-size:11px;color:#888;margin-bottom:2px;">To</div>
                <div style="font-weight:600;margin-bottom:8px;padding-right:12px;">${destName}</div>
                <div style="color:#667eea;font-size:13px;font-weight:500;">
                    🚗 ${formatSearchDistance(distanceKm)} · ${durationStr}
                </div>
                ${waypointText}
                <div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;font-size:10px;color:#999;">
                    ⌥+click to add stop · Right-click to clear
                </div>
            </div>
        `;
        
        // Calculate midpoint along actual route path (not bounds center)
        const routeMidpoint = this.#getRouteMidpoint(coords);
        
        // Open popup at route midpoint
        L.popup({ className: 'route-popup' })
            .setLatLng(routeMidpoint)
            .setContent(popupContent)
            .openOn(this.#map);
        
        // Zoom to fit entire route
        const bounds = this.#routeLine.getBounds();
        const padding = (typeof getMapPadding === 'function') ? getMapPadding() : { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] };
        this.#map.fitBounds(bounds, { 
            paddingTopLeft: padding.paddingTopLeft,
            paddingBottomRight: padding.paddingBottomRight,
            maxZoom: 14
        });
    }
    
    // Refit route to current viewport (called when panels open/close)
    refitRoute() {
        if (!this.#routeLine) return;
        
        const bounds = this.#routeLine.getBounds();
        const padding = (typeof getMapPadding === 'function') ? getMapPadding() : { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] };
        this.#map.fitBounds(bounds, { 
            paddingTopLeft: padding.paddingTopLeft,
            paddingBottomRight: padding.paddingBottomRight,
            maxZoom: 14,
            animate: true
        });
    }
    
    async #addWaypoint(lat, lng) {
        // Add waypoint at clicked position
        this.#waypoints.push({ lat, lng });
        
        // Recalculate route without zooming (preserve user's detailed view)
        await this.#calculateRoute(true);
    }
    
    #getRouteMidpoint(coords) {
        // Find the point along the route path at the halfway distance
        if (!coords || coords.length < 2) {
            return coords[0] || [0, 0];
        }
        
        // Calculate total route length
        let totalLength = 0;
        const segmentLengths = [];
        
        for (let i = 1; i < coords.length; i++) {
            const dist = calculateDistanceKm(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
            segmentLengths.push(dist);
            totalLength += dist;
        }
        
        // Find the point at half the total distance
        const targetDist = totalLength / 2;
        let accumulated = 0;
        
        for (let i = 0; i < segmentLengths.length; i++) {
            if (accumulated + segmentLengths[i] >= targetDist) {
                // Midpoint is within this segment
                const remaining = targetDist - accumulated;
                const ratio = remaining / segmentLengths[i];
                
                // Interpolate between coords[i] and coords[i+1]
                const lat = coords[i][0] + ratio * (coords[i+1][0] - coords[i][0]);
                const lng = coords[i][1] + ratio * (coords[i+1][1] - coords[i][1]);
                
                return [lat, lng];
            }
            accumulated += segmentLengths[i];
        }
        
        // Fallback to middle coordinate
        return coords[Math.floor(coords.length / 2)];
    }
    
    #clearRouteVisuals() {
        // Remove route line
        if (this.#routeLine) {
            this.#map.removeLayer(this.#routeLine);
            this.#routeLine = null;
        }
        
        // Remove waypoint markers
        this.#waypointMarkers.forEach(m => this.#map.removeLayer(m));
        this.#waypointMarkers = [];
    }
    
    clearRoute() {
        this.#clearRouteVisuals();
        
        // Close any open popup
        this.#map.closePopup();
        
        // Close search popup and clear input
        if (this.#popup) {
            this.#popup.style.display = 'none';
            if (this.#btn) this.#btn.classList.remove('popup-open');
        }
        if (this.#input) {
            this.#input.value = '';
        }
        if (this.#resultsDiv) {
            this.#resultsDiv.innerHTML = '';
        }
        
        // Remove destination marker
        if (this.#searchMarker) {
            this.#map.removeLayer(this.#searchMarker);
            this.#searchMarker = null;
        }
        
        // Remove start marker
        if (this.#startMarker) {
            this.#map.removeLayer(this.#startMarker);
            this.#startMarker = null;
        }
        
        // Clear state
        this.#waypoints = [];
        this.#destination = null;
        this.#routeCoords = null;
        this.#routeInfo = null;
        this.#customStart = null;
        this.#customStartName = null;
        
        // Show diary routes again
        if (typeof showDiaryRoutes === 'function') {
            showDiaryRoutes();
        }
        
        this.#updateDebugDisplay();
    }
}

// Bridge functions for HTML onclick
function toggleSearchPopup() {
    if (window.locationSearch) window.locationSearch.toggle();
}

function handleSearchKeydown(e) {
    if (window.locationSearch) window.locationSearch.handleKeydown(e);
}

function selectSearchResult(lat, lng, name) {
    if (window.locationSearch) window.locationSearch.selectResult(lat, lng, name);
}

function hasActiveLocationRoute() {
    return window.locationSearch && window.locationSearch.hasActiveRoute;
}

