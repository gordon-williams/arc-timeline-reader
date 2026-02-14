/**
 * Arc Timeline Diary Reader — Utility Functions
 *
 * Pure formatting, calculation, and logging functions used across multiple modules.
 * No dependencies — loaded before arc-db.js, import.js, and app.js.
 */
(() => {
    'use strict';

    // ========================================
    // Logging
    // ========================================

    function addLog(message, type = 'info') {
        const logDiv = document.getElementById('log');
        if (!logDiv) return;

        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;

        // Check if message contains HTML (e.g., buttons)
        if (message.includes('<button') || message.includes('<a')) {
            entry.innerHTML = message;
        } else {
            entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
        }

        logDiv.appendChild(entry);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    // ========================================
    // Formatting
    // ========================================

    function formatTime(date) {
        if (!date) return 'Unknown Time';
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'Unknown Time';
        const hours = d.getHours();
        const minutes = d.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 || 12;
        return `${hour12}:${minutes} ${ampm}`;
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr);
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        return d.toLocaleDateString('en-US', options);
    }

    function formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '0m';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m`;
        } else {
            return `${secs}s`;
        }
    }

    function formatDistance(meters) {
        if (!meters || meters < 1) return '0 m';

        if (meters >= 1000) {
            const km = (meters / 1000).toFixed(1);
            return `${km} km`;
        } else {
            return `${Math.round(meters)} m`;
        }
    }

    // ========================================
    // Distance Calculations (Haversine)
    // ========================================

    /**
     * Calculate distance between two coordinates in meters (Haversine formula)
     */
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth radius in meters
        const phi1 = lat1 * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const dPhi = (lat2 - lat1) * Math.PI / 180;
        const dLambda = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    // Alias — both names used across codebase
    const calculateDistanceMeters = calculateDistance;

    /**
     * Calculate total path distance from an array of GPS samples
     */
    function calculatePathDistance(samples) {
        if (!samples || samples.length < 2) return null;

        const validPoints = [];
        for (const sample of samples) {
            const lat = sample.location?.latitude ?? sample.latitude;
            const lng = sample.location?.longitude ?? sample.longitude;
            if (lat != null && lng != null) {
                validPoints.push({ lat, lng });
            }
        }

        if (validPoints.length < 2) return null;

        let totalDistance = 0;
        for (let i = 1; i < validPoints.length; i++) {
            totalDistance += calculateDistance(
                validPoints[i - 1].lat, validPoints[i - 1].lng,
                validPoints[i].lat, validPoints[i].lng
            );
        }

        return totalDistance > 0 ? totalDistance : null;
    }

    /**
     * Calculate elevation gain from GPS samples (positive changes only)
     */
    function calculateElevationGain(samples) {
        if (!samples || samples.length < 2) return null;

        const altitudes = [];
        for (const sample of samples) {
            const altitude = sample.location?.altitude || sample.altitude;
            if (altitude != null && !isNaN(altitude)) {
                altitudes.push(altitude);
            }
        }

        if (altitudes.length < 2) return null;

        let gain = 0;
        for (let i = 1; i < altitudes.length; i++) {
            const change = altitudes[i] - altitudes[i - 1];
            if (change > 0) gain += change;
        }

        return gain > 0 ? gain : null;
    }

    // ========================================
    // File Decompression
    // ========================================

    async function decompressFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const compressed = new Uint8Array(e.target.result);
                    const decompressed = pako.ungzip(compressed, { to: 'string' });
                    resolve(JSON.parse(decompressed));
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    // ========================================
    // Module Export
    // ========================================

    window.ArcUtils = {
        addLog,
        formatTime,
        formatDate,
        formatDuration,
        formatDistance,
        calculateDistance,
        calculateDistanceMeters,
        calculatePathDistance,
        calculateElevationGain,
        decompressFile
    };

    // Also expose on window directly for backward compatibility
    window.addLog = addLog;
    window.formatTime = formatTime;
    window.formatDate = formatDate;
    window.formatDuration = formatDuration;
    window.formatDistance = formatDistance;
    window.calculateDistance = calculateDistance;
    window.calculateDistanceMeters = calculateDistanceMeters;
    window.calculatePathDistance = calculatePathDistance;
    window.calculateElevationGain = calculateElevationGain;
    window.decompressFile = decompressFile;
})();
