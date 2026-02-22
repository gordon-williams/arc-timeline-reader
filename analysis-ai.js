// === analysis-ai.js ===
// AI Chat feature for Arc Timeline Analysis
// Depends on globals from analysis.html: db (IndexedDB), escapeHtml(), dailySummaries

(function() {
    'use strict';

    // --- Constants ---
    const MODELS = {
        'claude-sonnet-4-6':       { name: 'Sonnet 4.6',  maxTokens: 4096 },
        'claude-sonnet-4-5':       { name: 'Sonnet 4.5',  maxTokens: 4096 },
        'claude-haiku-4-5':        { name: 'Haiku 4.5',   maxTokens: 4096 },
        'claude-3-haiku-20240307': { name: 'Haiku 3',     maxTokens: 4096 }
    };
    const MAX_TOOL_ITERATIONS = 5;
    const MAX_HISTORY_PAIRS = 20;
    const LS_KEY_API = 'arc_chat_anthropic_key';
    const LS_KEY_MODEL = 'arc_chat_model';
    const LS_KEY_COSTS = 'arc_chat_cost_totals';

    // --- State ---
    let chatHistory = [];
    let isProcessing = false;
    let sessionCost = 0;

    // Cost per million tokens
    const MODEL_COSTS = {
        'claude-sonnet-4-6':       { input: 3.00, output: 15.00 },
        'claude-sonnet-4-5':       { input: 3.00, output: 15.00 },
        'claude-haiku-4-5':        { input: 1.00, output: 5.00 },
        'claude-3-haiku-20240307': { input: 0.25, output: 1.25 }
    };

    // --- Map State ---
    let chatMap = null;
    let chatMapMarkers = [];
    let chatMapPolylines = [];
    let chatMapTileLayer = null;

    // Mapbox token — shared with main Arc Reader via localStorage
    const MAPBOX_TOKEN_KEY = 'arc_mapbox_token';
    function getMapboxToken() { return localStorage.getItem(MAPBOX_TOKEN_KEY) || ''; }

    // Tile layer factory — mirrors getTileLayer() in app.js so chat map
    // uses the exact same styles as the main Arc Reader map.
    function getChatTileLayer(style) {
        const token = getMapboxToken();

        if (token) {
            const mapboxStyles = {
                street:    { style: 'streets-v12',           maxZoom: 20 },
                outdoors:  { style: 'outdoors-v12',          maxZoom: 20 },
                satellite: { style: 'satellite-streets-v12', maxZoom: 20 }
            };
            if (mapboxStyles[style]) {
                const cfg = mapboxStyles[style];
                return L.tileLayer(
                    `https://api.mapbox.com/styles/v1/mapbox/${cfg.style}/tiles/{z}/{x}/{y}?access_token=${token}`,
                    { attribution: '&copy; Mapbox &copy; OpenStreetMap', maxZoom: cfg.maxZoom, tileSize: 512, zoomOffset: -1 }
                );
            }
        }

        // CyclOSM — always free, same with or without Mapbox
        if (style === 'cycle') {
            return L.tileLayer(
                'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
                { attribution: '&copy; OpenStreetMap contributors, CyclOSM', maxZoom: 20 }
            );
        }

        // Free fallbacks (no Mapbox token)
        const free = {
            street:    { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
                         opts: { attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 19 } },
            satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                         opts: { attribution: '&copy; Esri', maxZoom: 19 } }
        };
        const cfg = free[style] || free.street;
        return L.tileLayer(cfg.url, cfg.opts);
    }

    // --- Activity colours — matches getActivityColor() in app.js ---
    const ACTIVITY_COLORS = {
        stationary: '#7A3CFC', walking: '#12A656', hiking: '#0E8444',
        running: '#EB781B', cycling: '#039FD4', car: '#4E5268',
        bus: '#4056B5', motorcycle: '#E35641', airplane: '#8E1DD2',
        boat: '#3B71F6', train: '#AA9131', skateboarding: '#18A1B1',
        inlineskating: '#D85582', snowboarding: '#4884AE', skiing: '#26398B',
        horseback: '#8B408C', surfing: '#D85582', tractor: '#2D2F3E',
        tuktuk: '#B4831D', unknown: '#808080'
    };
    function getActivityColor(type) {
        return ACTIVITY_COLORS[(type || '').toLowerCase()] || '#808080';
    }

    /**
     * Extract GPS tracks from raw day data — mirrors extractTracksFromData() in arc-data.js.
     * Returns [{activityType, points: [{lat, lng, t}]}]
     */
    function extractTracksFromDay(data) {
        const tracks = [];
        if (!data || !data.timelineItems) return tracks;
        for (const item of data.timelineItems) {
            if (item.isVisit) continue;
            if (!Array.isArray(item.samples) || item.samples.length < 2) continue;
            const pts = [];
            for (const s of item.samples) {
                const lat = s?.location?.latitude ?? s?.latitude;
                const lng = s?.location?.longitude ?? s?.longitude;
                const ts = s?.location?.timestamp || s?.timestamp || s?.date;
                if (lat == null || lng == null) continue;
                pts.push({ lat, lng, t: ts ?? null });
            }
            if (pts.length < 2) continue;
            tracks.push({
                activityType: item.activityType || 'unknown',
                points: pts
            });
        }
        return tracks;
    }

    // --- Privacy: local coordinate cache (never sent to API) ---
    const coordsCache = new Map(); // locationName → {lat, lng}
    let lastRegionMarkers = []; // [{name, lat, lng, days}] from last find_days_in_region

    // --- DOM References (set in init) ---
    let elMessages, elInput, elSendBtn, elModelSelect, elApiKey, elSaveKey, elClearBtn, elWelcome;
    let elMapPanel, elMapContainer, elMapTitle, elMapClearBtn, elMapCloseBtn, elMapStyle;
    let elCostBadge, elCostPanel, elCostPanelBody, elCostReset;

    // =========================================================================
    // IDB Helper
    // =========================================================================

    function idbGetAll(storeOrIndex, query) {
        return new Promise((resolve, reject) => {
            const req = query !== undefined ? storeOrIndex.getAll(query) : storeOrIndex.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    function idbGet(store, key) {
        return new Promise((resolve, reject) => {
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // =========================================================================
    // Privacy: strip coordinates/addresses before sending to API
    // =========================================================================

    /**
     * Deep-strip lat, lng, and addr fields from a tool result object.
     * Returns a sanitised clone — the original is not modified.
     * Coordinates should already be cached in coordsCache by the tool executor.
     */
    function stripCoordsForAPI(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(stripCoordsForAPI);
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            if (k === 'lat' || k === 'lng' || k === 'addr') continue;
            out[k] = stripCoordsForAPI(v);
        }
        return out;
    }

    /** Cache coordinates for a location name (local only, never sent to API). */
    function cacheCoords(name, lat, lng) {
        if (name && lat && lng) coordsCache.set(name, { lat, lng });
    }

    /** Convert a UTC/ISO timestamp to a local HH:MM string for display to Claude. */
    function toLocalTime(isoStr) {
        if (!isoStr) return null;
        try {
            const d = new Date(isoStr);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        } catch (e) { return null; }
    }

    // =========================================================================
    // Tool Definitions (Anthropic format)
    // =========================================================================

    const toolDefinitions = [
        {
            name: 'get_activity_summary',
            description: 'Get total distance (m), duration (s), and count for activity types in a date range. Optionally filter to specific activities.',
            input_schema: {
                type: 'object',
                properties: {
                    start_date: { type: 'string', description: 'YYYY-MM-DD' },
                    end_date: { type: 'string', description: 'YYYY-MM-DD' },
                    activity_types: { type: 'array', items: { type: 'string' }, description: 'Filter to these activity types only (optional). Omit for all.' }
                },
                required: ['start_date', 'end_date']
            }
        },
        {
            name: 'get_monthly_summary',
            description: 'Get per-month activity totals across a date range. Returns one row per month with distance/duration/count by activity type. PREFERRED for multi-month questions — avoids needing multiple get_activity_summary calls.',
            input_schema: {
                type: 'object',
                properties: {
                    start_date: { type: 'string', description: 'YYYY-MM-DD' },
                    end_date: { type: 'string', description: 'YYYY-MM-DD' },
                    activity_types: { type: 'array', items: { type: 'string' }, description: 'Filter to these activity types only (optional)' }
                },
                required: ['start_date', 'end_date']
            }
        },
        {
            name: 'get_daily_stats',
            description: 'Get day-by-day activity stats for a date range (max 90 days).',
            input_schema: {
                type: 'object',
                properties: {
                    start_date: { type: 'string', description: 'YYYY-MM-DD' },
                    end_date: { type: 'string', description: 'YYYY-MM-DD' },
                    activity_types: { type: 'array', items: { type: 'string' }, description: 'Filter to these activity types only (optional)' }
                },
                required: ['start_date', 'end_date']
            }
        },
        {
            name: 'find_location_visits',
            description: 'Search for a location by name substring AND return its visits in one call. Combines search + visit lookup. Returns the best match with visit history. PREFERRED for questions like "how often did I go to X?".',
            input_schema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Location name search substring' },
                    start_date: { type: 'string', description: 'YYYY-MM-DD (optional)' },
                    end_date: { type: 'string', description: 'YYYY-MM-DD (optional)' }
                },
                required: ['query']
            }
        },
        {
            name: 'search_locations',
            description: 'Search location names by substring. Returns up to 20 matches with aggregate stats. Use when you need to see all matching locations before picking one.',
            input_schema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search substring' }
                },
                required: ['query']
            }
        },
        {
            name: 'get_top_locations',
            description: 'Get top N locations sorted by visits or duration.',
            input_schema: {
                type: 'object',
                properties: {
                    sort_by: { type: 'string', enum: ['visits', 'duration'], description: 'Sort field (default: visits)' },
                    limit: { type: 'number', description: 'Max results (default 40, max 50)' }
                },
                required: []
            }
        },
        {
            name: 'get_day_timeline',
            description: 'Get full timeline for a specific day — activities, visits, times, places. GPS samples excluded.',
            input_schema: {
                type: 'object',
                properties: {
                    date: { type: 'string', description: 'YYYY-MM-DD' }
                },
                required: ['date']
            }
        },
        {
            name: 'get_location_details',
            description: 'Get full details for a location: aggregate stats + last 100 visits.',
            input_schema: {
                type: 'object',
                properties: {
                    location_name: { type: 'string', description: 'Exact location name' }
                },
                required: ['location_name']
            }
        },
        {
            name: 'find_days_in_region',
            description: 'Find days when the user was in a geographic region (country, city, area) by checking stored location coordinates against a bounding box. Returns matching dates, place names with days (unique days visited — NOT duration of stay) and dur (total seconds spent there). Use this for questions like "when did I go to Japan?" or "which days was I in London?". Claude should supply the bounding box for well-known regions.',
            input_schema: {
                type: 'object',
                properties: {
                    south: { type: 'number', description: 'Southern latitude bound' },
                    north: { type: 'number', description: 'Northern latitude bound' },
                    west: { type: 'number', description: 'Western longitude bound' },
                    east: { type: 'number', description: 'Eastern longitude bound' },
                    label: { type: 'string', description: 'Human-readable region name (e.g. "Japan", "London") for display' }
                },
                required: ['south', 'north', 'west', 'east']
            }
        },
        {
            name: 'get_date_range_places',
            description: 'Get all unique places visited within a date range. Returns place names, visit day counts, and total durations. Coordinates are cached locally for show_map. PREFERRED for "show me where I went" or "what places did I visit" questions — avoids calling get_day_timeline per day.',
            input_schema: {
                type: 'object',
                properties: {
                    start_date: { type: 'string', description: 'YYYY-MM-DD' },
                    end_date: { type: 'string', description: 'YYYY-MM-DD' }
                },
                required: ['start_date', 'end_date']
            }
        },
        {
            name: 'show_map',
            description: 'Display location markers on a map panel. Coordinates are resolved locally from cached data — just provide location names. Set clear_existing=true to remove previous pins first, or false to add to existing pins. If label is omitted, the location name is used as the popup label.',
            input_schema: {
                type: 'object',
                properties: {
                    markers: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Location name (coordinates resolved locally from cache)' },
                                label: { type: 'string', description: 'Marker popup text' },
                                count: { type: 'number', description: 'Visit count to display inside the marker (optional)' }
                            },
                            required: ['name']
                        },
                        description: 'Array of map markers to display'
                    },
                    title: { type: 'string', description: 'Title for the map panel (optional)' },
                    clear_existing: { type: 'boolean', description: 'Clear previous markers before adding new ones (default true)' }
                },
                required: ['markers']
            }
        },
        {
            name: 'show_route',
            description: 'Draw the full GPS route for one or more days on the map, colour-coded by activity type (walking=green, car=grey, cycling=blue, etc.) — matching the main Arc Reader. Reads GPS track data directly from the database. Can be combined with show_map markers. Optionally filter to specific activity types.',
            input_schema: {
                type: 'object',
                properties: {
                    dates: {
                        type: 'array',
                        items: { type: 'string', description: 'YYYY-MM-DD' },
                        description: 'One or more day keys to draw routes for'
                    },
                    activity_types: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Filter to only these activity types (e.g. ["walking","cycling"]). Omit to show all. Valid types: walking, running, hiking, cycling, car, bus, train, motorcycle, airplane, boat, skateboarding, inlineskating, snowboarding, skiing, horseback, surfing, tractor, tuktuk, stationary, unknown'
                    },
                    title: { type: 'string', description: 'Title for the map panel (optional)' },
                    clear_existing: { type: 'boolean', description: 'Clear previous routes before drawing (default true). Markers are NOT affected.' }
                },
                required: ['dates']
            }
        }
    ];

    // =========================================================================
    // Tool Execution Functions
    // =========================================================================

    // Helper: look up coordinates for a location name from the days store
    // Scans timeline items for visits matching the location name and returns first valid center
    async function lookupCoordsFromDays(locationName) {
        const tx = db.transaction(['locationVisits', 'days'], 'readonly');
        const visitIndex = tx.objectStore('locationVisits').index('locationName');
        const visits = await idbGetAll(visitIndex, locationName);
        if (visits.length === 0) return null;

        // Check the most recent visits first (more likely to have coords)
        const recentDays = [...new Set(visits.map(v => v.dayKey))].sort().reverse().slice(0, 10);
        const daysStore = tx.objectStore('days');

        for (const dayKey of recentDays) {
            const day = await idbGet(daysStore, dayKey);
            if (!day || !day.data || !day.data.timelineItems) continue;
            for (const item of day.data.timelineItems) {
                if (!item.isVisit) continue;
                const placeName = item.place?.name || item.customTitle || '';
                if (placeName.toLowerCase().includes(locationName.toLowerCase())) {
                    const lat = item.center?.latitude ?? item.place?.center?.latitude;
                    const lng = item.center?.longitude ?? item.place?.center?.longitude;
                    if (lat && lng) return { lat, lng };
                }
            }
        }
        return null;
    }

    // Helper: aggregate activity stats from dailySummaries, with optional type filter
    function aggregateActivities(days, activityTypes) {
        const totals = {};
        const typeFilter = activityTypes && activityTypes.length > 0
            ? new Set(activityTypes.map(t => t.toLowerCase()))
            : null;
        for (const day of days) {
            if (!day.activityStats) continue;
            for (const [type, stats] of Object.entries(day.activityStats)) {
                if (typeFilter && !typeFilter.has(type.toLowerCase())) continue;
                if (!totals[type]) totals[type] = { n: 0, dur: 0, dist: 0 };
                totals[type].n += stats.count || 0;
                totals[type].dur += stats.duration || 0;
                totals[type].dist += stats.distance || 0;
            }
        }
        // Strip zero-value fields to save tokens
        for (const t of Object.values(totals)) {
            if (!t.n) delete t.n;
            if (!t.dur) delete t.dur;
            if (!t.dist) delete t.dist;
        }
        return totals;
    }

    const toolExecutors = {
        async get_activity_summary({ start_date, end_date, activity_types }) {
            const filtered = dailySummaries.filter(d => d.dayKey >= start_date && d.dayKey <= end_date);
            return {
                r: [start_date, end_date],
                days: filtered.length,
                act: aggregateActivities(filtered, activity_types)
            };
        },

        async get_monthly_summary({ start_date, end_date, activity_types }) {
            const filtered = dailySummaries.filter(d => d.dayKey >= start_date && d.dayKey <= end_date);
            // Group by month
            const months = {};
            for (const day of filtered) {
                const m = day.dayKey.slice(0, 7); // YYYY-MM
                if (!months[m]) months[m] = [];
                months[m].push(day);
            }
            // Aggregate per month
            const result = [];
            for (const [month, days] of Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]))) {
                result.push({ m: month, days: days.length, act: aggregateActivities(days, activity_types) });
            }
            return { months: result };
        },

        async get_daily_stats({ start_date, end_date, activity_types }) {
            const start = new Date(start_date);
            const end = new Date(end_date);
            const daysDiff = Math.floor((end - start) / 86400000) + 1;
            if (daysDiff > 90) {
                return { error: `Range spans ${daysDiff} days, max 90.` };
            }
            const typeFilter = activity_types && activity_types.length > 0
                ? new Set(activity_types.map(t => t.toLowerCase()))
                : null;
            const filtered = dailySummaries
                .filter(d => d.dayKey >= start_date && d.dayKey <= end_date)
                .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
            return {
                days: filtered.map(d => {
                    const stats = {};
                    if (d.activityStats) {
                        for (const [type, s] of Object.entries(d.activityStats)) {
                            if (typeFilter && !typeFilter.has(type.toLowerCase())) continue;
                            const entry = {};
                            if (s.count) entry.n = s.count;
                            if (s.duration) entry.dur = s.duration;
                            if (s.distance) entry.dist = s.distance;
                            if (Object.keys(entry).length) stats[type] = entry;
                        }
                    }
                    return { d: d.dayKey, act: stats };
                })
            };
        },

        async find_location_visits({ query, start_date, end_date }) {
            // Scan raw days store directly (always up-to-date, no Rebuild needed).
            // Default to last 365 days if no date range given.
            const q = query.toLowerCase();
            if (!start_date) {
                const d = new Date();
                d.setFullYear(d.getFullYear() - 1);
                start_date = d.toISOString().slice(0, 10);
            }
            if (!end_date) {
                end_date = new Date().toISOString().slice(0, 10);
            }

            // Build day keys
            const dayKeys = [];
            const cur = new Date(start_date);
            const endD = new Date(end_date);
            while (cur <= endD) {
                dayKeys.push(cur.toISOString().slice(0, 10));
                cur.setDate(cur.getDate() + 1);
            }

            // Scan each day for matching visits
            const matchedPlaces = {}; // name → { daysSet, dur, visitCount }
            for (const dayKey of dayKeys) {
                let day;
                try {
                    const tx = db.transaction(['days'], 'readonly');
                    day = await idbGet(tx.objectStore('days'), dayKey);
                } catch (e) { continue; }
                if (!day || !day.data || !day.data.timelineItems) continue;
                for (const item of day.data.timelineItems) {
                    if (!item.isVisit) continue;
                    const name = item.place?.name || item.customTitle || '';
                    if (!name || !name.toLowerCase().includes(q)) continue;
                    if (!matchedPlaces[name]) matchedPlaces[name] = { daysSet: new Set(), dur: 0, visitCount: 0 };
                    matchedPlaces[name].daysSet.add(dayKey);
                    matchedPlaces[name].visitCount++;
                    if (item.startDate && item.endDate) {
                        const dur = (new Date(item.endDate) - new Date(item.startDate)) / 1000;
                        if (dur > 0) matchedPlaces[name].dur += dur;
                    }
                    // Cache coordinates locally (never sent to API)
                    const lat = item.center?.latitude ?? item.place?.center?.latitude;
                    const lng = item.center?.longitude ?? item.place?.center?.longitude;
                    if (lat && lng) cacheCoords(name, lat, lng);
                }
            }

            const placeNames = Object.keys(matchedPlaces);
            if (placeNames.length === 0) {
                return { query, range: [start_date, end_date], matches: 0, error: 'No locations found matching "' + query + '".' };
            }

            // Pick the best match (most visit days)
            placeNames.sort((a, b) => matchedPlaces[b].daysSet.size - matchedPlaces[a].daysSet.size);
            const bestName = placeNames[0];
            const best = matchedPlaces[bestName];

            // Build per-day visit list for the best match (re-scan for detail)
            const visitDays = [...best.daysSet].sort();
            const result = {
                loc: bestName,
                range: [start_date, end_date],
                visit_days: visitDays.length,
                total_visits: best.visitCount,
                total_dur: Math.round(best.dur),
                recent: visitDays.slice(-20).reverse().map(d => ({ d }))
            };

            if (placeNames.length > 1) {
                result.also_matched = placeNames.slice(1, 5).map(n => ({
                    name: n, days: matchedPlaces[n].daysSet.size
                }));
            }

            return result;
        },

        async search_locations({ query }) {
            const tx = db.transaction(['locations'], 'readonly');
            const all = await idbGetAll(tx.objectStore('locations'));
            const q = query.toLowerCase();
            const filtered = all
                .filter(loc => loc.name && loc.name.toLowerCase().includes(q))
                .slice(0, 20);
            // Cache coordinates locally (never sent to API)
            const matches = [];
            for (const loc of filtered) {
                const e = { name: loc.name };
                if (loc.totalVisits) e.vis = loc.totalVisits;
                if (loc.totalDuration) e.dur = loc.totalDuration;
                if (loc.recordCount) e.days = loc.recordCount;
                if (loc.lat && loc.lng) {
                    cacheCoords(loc.name, loc.lat, loc.lng);
                } else {
                    try {
                        const coords = await lookupCoordsFromDays(loc.name);
                        if (coords) cacheCoords(loc.name, coords.lat, coords.lng);
                    } catch (ex) { /* coords optional */ }
                }
                matches.push(e);
            }
            return { results: matches };
        },

        async get_top_locations({ sort_by, limit }) {
            sort_by = sort_by || 'visits';
            limit = Math.min(limit || 40, 50);
            const tx = db.transaction(['locations'], 'readonly');
            const all = await idbGetAll(tx.objectStore('locations'));
            all.sort((a, b) => {
                if (sort_by === 'duration') return (b.totalDuration || 0) - (a.totalDuration || 0);
                return (b.totalVisits || 0) - (a.totalVisits || 0);
            });
            return {
                locs: all.slice(0, limit).map(loc => {
                    const e = { name: loc.name };
                    if (loc.totalVisits) e.vis = loc.totalVisits;
                    if (loc.totalDuration) e.dur = loc.totalDuration;
                    if (loc.recordCount) e.days = loc.recordCount;
                    // Cache coords locally (never sent to API)
                    if (loc.lat && loc.lng) cacheCoords(loc.name, loc.lat, loc.lng);
                    return e;
                })
            };
        },

        async get_day_timeline({ date }) {
            const tx = db.transaction(['days'], 'readonly');
            const day = await idbGet(tx.objectStore('days'), date);
            if (!day || !day.data) {
                return { error: `No data for ${date}` };
            }
            const items = (day.data.timelineItems || []).map(item => {
                const e = { type: item.activityType || 'unknown' };
                const t0 = toLocalTime(item.startDate);
                const t1 = toLocalTime(item.endDate);
                if (t0) e.start = t0;
                if (t1) e.end = t1;
                if (item.isVisit) e.visit = true;
                const placeName = item.place?.name || item.customTitle || '';
                if (item.place && item.place.name) e.place = item.place.name;
                // Street addresses stripped for privacy (not sent to API)
                if (item.customTitle) e.title = item.customTitle;
                // Cache coordinates locally (never sent to API)
                const lat = item.center?.latitude ?? item.place?.center?.latitude;
                const lng = item.center?.longitude ?? item.place?.center?.longitude;
                if (lat && lng) cacheCoords(placeName, lat, lng);
                return e;
            });
            return { date, items };
        },

        async get_date_range_places({ start_date, end_date }) {
            const start = new Date(start_date);
            const end = new Date(end_date);
            const daysDiff = Math.floor((end - start) / 86400000) + 1;
            if (daysDiff > 90) {
                return { error: `Range spans ${daysDiff} days, max 90.` };
            }
            // Build list of day keys to fetch
            const dayKeys = [];
            const d = new Date(start_date);
            const endD = new Date(end_date);
            while (d <= endD) {
                dayKeys.push(d.toISOString().slice(0, 10));
                d.setDate(d.getDate() + 1);
            }
            // Fetch each day individually (IDB transactions auto-close on await)
            const places = {}; // name → { daysSet: Set, dur: number }
            for (const dayKey of dayKeys) {
                let day;
                try {
                    const tx = db.transaction(['days'], 'readonly');
                    day = await idbGet(tx.objectStore('days'), dayKey);
                } catch (e) { continue; }
                if (!day || !day.data || !day.data.timelineItems) continue;
                for (const item of day.data.timelineItems) {
                    if (!item.isVisit) continue;
                    const name = item.place?.name || item.customTitle || '';
                    if (!name) continue;
                    if (!places[name]) places[name] = { daysSet: new Set(), dur: 0 };
                    places[name].daysSet.add(dayKey);
                    // Calculate duration for this visit
                    if (item.startDate && item.endDate) {
                        const dur = (new Date(item.endDate) - new Date(item.startDate)) / 1000;
                        if (dur > 0) places[name].dur += dur;
                    }
                    // Cache coordinates locally (never sent to API)
                    const lat = item.center?.latitude ?? item.place?.center?.latitude;
                    const lng = item.center?.longitude ?? item.place?.center?.longitude;
                    if (lat && lng) cacheCoords(name, lat, lng);
                }
            }
            // Build compact result sorted by days visited (most first)
            const result = Object.entries(places)
                .map(([name, data]) => {
                    const e = { name, days: data.daysSet.size };
                    if (data.dur > 0) e.dur = Math.round(data.dur);
                    return e;
                })
                .sort((a, b) => b.days - a.days);
            return { range: [start_date, end_date], places: result };
        },

        async find_days_in_region({ south, north, west, east, label }) {
            // Scan locations store for places within the bounding box
            const tx = db.transaction(['locations'], 'readonly');
            const allLocs = await idbGetAll(tx.objectStore('locations'));
            const matchingNames = [];
            let skippedNoCoords = 0;
            for (const loc of allLocs) {
                if (!loc.lat || !loc.lng) { skippedNoCoords++; continue; }
                if (loc.lat >= south && loc.lat <= north && loc.lng >= west && loc.lng <= east) {
                    matchingNames.push(loc.name);
                    cacheCoords(loc.name, loc.lat, loc.lng);
                }
            }
            console.log(`[find_days_in_region] ${allLocs.length} locations total, ${skippedNoCoords} without coords, ${matchingNames.length} in bounding box, coordsCache size: ${coordsCache.size}`);
            if (matchingNames.length === 0) {
                return { region: label || 'region', matches: 0, error: 'No stored locations found in this region.' };
            }
            // Look up visit days and durations for each matching location
            const daySet = new Set();
            const placeVisits = {}; // name → { daysSet, dur }
            for (const name of matchingNames) {
                try {
                    const txV = db.transaction(['locationVisits'], 'readonly');
                    const index = txV.objectStore('locationVisits').index('locationName');
                    const visits = await idbGetAll(index, name);
                    const days = new Set();
                    let dur = 0;
                    for (const v of visits) {
                        if (v.dayKey) { days.add(v.dayKey); daySet.add(v.dayKey); }
                        if (v.duration > 0) dur += v.duration;
                    }
                    if (days.size > 0) placeVisits[name] = { days: days.size, dur };
                } catch (e) { /* skip */ }
            }
            const sortedDays = [...daySet].sort();
            const places = Object.entries(placeVisits)
                .map(([name, info]) => {
                    const e = { name, days: info.days };
                    if (info.dur > 0) e.dur = Math.round(info.dur);
                    return e;
                })
                .sort((a, b) => b.days - a.days)
                .slice(0, 30);
            // Cache resolved markers for show_map fallback
            lastRegionMarkers = places.map(p => {
                const c = coordsCache.get(p.name);
                return c ? { name: p.name, lat: c.lat, lng: c.lng, days: p.days } : null;
            }).filter(Boolean);
            return {
                region: label || 'region',
                total_days: sortedDays.length,
                locations_found: matchingNames.length,
                date_range: sortedDays.length > 0 ? [sortedDays[0], sortedDays[sortedDays.length - 1]] : null,
                days: sortedDays,
                top_places: places
            };
        },

        async show_map({ markers, title, clear_existing }) {
            if (!markers || markers.length === 0) {
                return { error: 'No markers provided.' };
            }
            // Resolve coordinates locally from cache (never sent to API)
            console.log(`[show_map] ${markers.length} markers requested, coordsCache size: ${coordsCache.size}`);
            const resolved = [];
            const unresolved = [];
            for (const m of markers) {
                let coords = coordsCache.get(m.name);
                // Fallback: try trimmed / normalised match
                if (!coords && m.name) {
                    const needle = m.name.trim().toLowerCase();
                    for (const [key, val] of coordsCache) {
                        if (key.trim().toLowerCase() === needle) {
                            coords = val;
                            break;
                        }
                    }
                }
                if (coords) {
                    resolved.push({ lat: coords.lat, lng: coords.lng, label: m.label || m.name, count: m.count });
                } else {
                    unresolved.push(m.name);
                }
            }
            // Fallback: try lookupCoordsFromDays for unresolved markers (max 20 to avoid slow scans)
            if (unresolved.length > 0 && unresolved.length <= 20) {
                const stillUnresolved = [];
                for (const name of unresolved) {
                    try {
                        const coords = await lookupCoordsFromDays(name);
                        if (coords) {
                            cacheCoords(name, coords.lat, coords.lng);
                            resolved.push({ lat: coords.lat, lng: coords.lng, label: name, count: markers.find(m => m.name === name)?.count });
                        } else {
                            stillUnresolved.push(name);
                        }
                    } catch (e) { stillUnresolved.push(name); }
                }
                unresolved.length = 0;
                unresolved.push(...stillUnresolved);
            }
            if (unresolved.length > 0) {
                console.log(`[show_map] ${unresolved.length} unresolved:`, unresolved.slice(0, 5));
            }
            if (resolved.length === 0) {
                return { error: 'No coordinates cached for these locations. Query location data first.', unresolved };
            }
            renderMapMarkers(resolved, title, clear_existing !== false);
            const result = { displayed: resolved.length, title: title || 'Map' };
            if (unresolved.length > 0) result.unresolved = unresolved;
            return result;
        },

        async show_route({ dates, title, clear_existing, activity_types }) {
            if (!dates || dates.length === 0) {
                return { error: 'Provide at least one date.' };
            }
            const typeFilter = activity_types && activity_types.length > 0
                ? new Set(activity_types.map(t => t.toLowerCase()))
                : null;
            // Extract GPS tracks from IDB — keep track boundaries intact so
            // renderRoute draws each track as a separate polyline (no straight
            // lines between unrelated segments).
            const allTracks = [];
            let totalPoints = 0;
            for (const date of dates) {
                let day;
                try {
                    const tx = db.transaction(['days'], 'readonly');
                    day = await idbGet(tx.objectStore('days'), date);
                } catch (e) { continue; }
                if (!day || !day.data) continue;
                const tracks = extractTracksFromDay(day.data);
                for (const track of tracks) {
                    if (typeFilter && !typeFilter.has((track.activityType || 'unknown').toLowerCase())) continue;
                    allTracks.push(track);
                    totalPoints += track.points.length;
                }
            }
            if (totalPoints < 2) {
                const filterMsg = typeFilter ? ` (filtered to: ${activity_types.join(', ')})` : '';
                return { error: 'No GPS track data found for ' + dates.join(', ') + filterMsg + '.' };
            }
            renderRoute(allTracks, title, clear_existing !== false);
            const result = { drawn: totalPoints, days: dates.length, title: title || 'Route' };
            if (typeFilter) result.filtered_to = activity_types;
            return result;
        },

        async get_location_details({ location_name }) {
            const txLoc = db.transaction(['locations'], 'readonly');
            const locInfo = await idbGet(txLoc.objectStore('locations'), location_name);
            if (!locInfo) {
                return { error: `"${location_name}" not found. Use search_locations.` };
            }
            const txVisits = db.transaction(['locationVisits'], 'readonly');
            const index = txVisits.objectStore('locationVisits').index('locationName');
            let visits = await idbGetAll(index, location_name);
            visits.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
            visits = visits.slice(0, 100);
            const result = {
                name: locInfo.name,
                vis: locInfo.totalVisits || 0,
                dur: locInfo.totalDuration || 0,
                days: locInfo.recordCount || 0,
                first: locInfo.firstVisit,
                last: locInfo.lastVisit,
                recent: visits.map(v => {
                    const e = { d: v.dayKey };
                    if (v.duration) e.dur = v.duration;
                    if (v.visitCount > 1) e.n = v.visitCount;
                    return e;
                })
            };
            // Cache coordinates locally (never sent to API)
            if (locInfo.lat && locInfo.lng) {
                cacheCoords(locInfo.name, locInfo.lat, locInfo.lng);
            } else {
                try {
                    const coords = await lookupCoordsFromDays(location_name);
                    if (coords) cacheCoords(locInfo.name, coords.lat, coords.lng);
                } catch (e) { /* coords optional */ }
            }
            return result;
        }
    };

    // =========================================================================
    // Map Rendering
    // =========================================================================

    function initMap() {
        if (chatMap) return;
        if (!elMapContainer) return;

        // Leaflet requires an explicit pixel height on the container
        elMapContainer.style.height = '100%';

        chatMap = L.map(elMapContainer, {
            center: [0, 0],  // Temporary; updated by geolocation or fallback
            zoom: 12,
            zoomControl: true
        });

        // Apply saved or default tile style (matches main Arc Reader maps)
        const savedStyle = localStorage.getItem('arc_chat_map_style') || 'street';
        setMapTileLayer(savedStyle);
        if (elMapStyle) elMapStyle.value = savedStyle;

        // Centre on user's current location (falls back to world view on denial)
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    chatMap.setView([pos.coords.latitude, pos.coords.longitude], 12);
                },
                () => {
                    // Permission denied or error — fall back to world view
                    chatMap.setView([0, 0], 2);
                },
                { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
            );
        } else {
            chatMap.setView([0, 0], 2);
        }
    }

    function setMapTileLayer(styleKey) {
        if (chatMapTileLayer) chatMap.removeLayer(chatMapTileLayer);
        chatMapTileLayer = getChatTileLayer(styleKey);
        chatMapTileLayer.addTo(chatMap);
        localStorage.setItem('arc_chat_map_style', styleKey);
    }

    function showMapPanel(title) {
        if (!elMapPanel) return;
        elMapPanel.classList.add('visible');
        if (title && elMapTitle) elMapTitle.textContent = title;
        // Leaflet needs a resize trigger when container becomes visible
        // Use multiple delays to handle varying render timing
        if (chatMap) {
            setTimeout(() => chatMap.invalidateSize(), 50);
            setTimeout(() => chatMap.invalidateSize(), 200);
        }
    }

    function hideMapPanel() {
        if (elMapPanel) {
            elMapPanel.classList.remove('visible');
            elMapPanel.classList.remove('map-default');
        }
    }

    function clearMapMarkers() {
        for (const marker of chatMapMarkers) {
            chatMap.removeLayer(marker);
        }
        chatMapMarkers = [];
        clearMapPolylines();
    }

    function clearMapPolylines() {
        for (const line of chatMapPolylines) {
            chatMap.removeLayer(line);
        }
        chatMapPolylines = [];
    }

    function createCountIcon(count) {
        // Size the circle based on digit count so numbers always fit
        const digits = String(count).length;
        const size = digits <= 2 ? 28 : digits === 3 ? 34 : 40;
        const fontSize = digits <= 2 ? 13 : digits === 3 ? 11 : 10;
        return L.divIcon({
            className: 'chat-map-count-icon',
            html: `<div style="
                width:${size}px;height:${size}px;border-radius:50%;
                background:var(--accent,#4a9eff);border:3px solid #fff;
                box-shadow:0 2px 6px rgba(0,0,0,0.35);
                display:flex;align-items:center;justify-content:center;
                color:#fff;font-weight:700;font-size:${fontSize}px;
                line-height:1;
            ">${count}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            popupAnchor: [0, -(size / 2 + 2)]
        });
    }

    function renderMapMarkers(markers, title, clearExisting) {
        // Show panel FIRST so container has a computed size, then init map
        if (!elMapPanel.classList.contains('visible')) {
            elMapPanel.classList.add('visible');
        }
        initMap();
        showMapPanel(title || 'Map');

        if (clearExisting) clearMapMarkers();

        const bounds = [];
        for (const m of markers) {
            if (!m.lat || !m.lng) continue;
            const count = m.count || 0;
            const marker = count > 0
                ? L.marker([m.lat, m.lng], { icon: createCountIcon(count) })
                : L.circleMarker([m.lat, m.lng], {
                    radius: 10, fillColor: '#4a9eff', fillOpacity: 1,
                    color: '#fff', weight: 3, opacity: 1
                });
            marker.addTo(chatMap).bindPopup(escapeHtml(m.label));
            chatMapMarkers.push(marker);
            bounds.push([m.lat, m.lng]);
        }

        // Fit map to show all markers
        if (bounds.length === 1) {
            chatMap.setView(bounds[0], 15);
        } else if (bounds.length > 1) {
            chatMap.fitBounds(bounds, { padding: [30, 30] });
        }
    }

    /**
     * Render colour-coded GPS route segments on the chat map.
     * Mirrors drawColorCodedRoute/drawActivitySegment from app.js —
     * each track is drawn as its own polyline with a white border
     * underneath and activity colour on top.
     * @param {Array} tracks - [{activityType, points: [{lat, lng}]}]
     */
    function renderRoute(tracks, title, clearExisting) {
        if (!elMapPanel.classList.contains('visible')) {
            elMapPanel.classList.add('visible');
        }
        initMap();
        if (title) showMapPanel(title);
        if (clearExisting) clearMapPolylines();

        const bounds = [];

        for (const track of tracks) {
            const latlngs = [];
            for (const pt of track.points) {
                if (pt.lat == null || pt.lng == null || !isFinite(pt.lat) || !isFinite(pt.lng)) continue;
                latlngs.push([pt.lat, pt.lng]);
            }
            if (latlngs.length < 2) continue;
            const color = getActivityColor(track.activityType || 'unknown');
            // White border underneath (matches main system)
            const border = L.polyline(latlngs, { color: '#ffffff', weight: 10, opacity: 0.8 }).addTo(chatMap);
            const line = L.polyline(latlngs, { color: color, weight: 7, opacity: 1 }).addTo(chatMap);
            chatMapPolylines.push(border, line);
            bounds.push(...latlngs);
        }

        // Fit map to route bounds
        if (bounds.length >= 2) {
            chatMap.fitBounds(bounds, { padding: [30, 30] });
        } else if (bounds.length === 1) {
            chatMap.setView(bounds[0], 15);
        }
    }

    // =========================================================================
    // Anthropic API
    // =========================================================================

    function buildSystemPrompt() {
        const today = new Date().toISOString().slice(0, 10);

        // Get date range from loaded summaries
        let dateInfo = 'No data loaded.';
        if (dailySummaries && dailySummaries.length > 0) {
            const sorted = dailySummaries.map(d => d.dayKey).sort();
            dateInfo = `${sorted[0]} to ${sorted[sorted.length - 1]} (${sorted.length} days)`;
        }

        // Gather known activity types
        const actTypes = new Set();
        for (const d of (dailySummaries || [])) {
            if (d.activityStats) Object.keys(d.activityStats).forEach(t => actTypes.add(t));
        }

        const locale = navigator.language || 'en';
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';

        return `Timeline assistant. Query user's location/activity data via tools.
Today: ${today}. Locale: ${locale}. Timezone: ${tz}. Data: ${dateInfo}. Activities: ${[...actTypes].join(', ') || 'none'}.
ALWAYS use metric units (km, metres). NEVER use miles or feet. dur values from tools are in seconds — ALWAYS convert and display as hours and minutes (e.g. 3661s → "1 hr 1 min", 120s → "2 min"). NEVER show raw seconds to the user. Times are local (already converted from UTC).
Tool result keys: n=count, dur=duration(s), dist=distance(m), d=date, vis=raw visit segments (NOT unique days), days=unique days visited, m=month, act=activities, loc=location.
IMPORTANT for locations: "days" means the number of UNIQUE CALENDAR DAYS the user visited that place — NOT how long they stayed. A ferry terminal with days=2 means visited on 2 separate days, not stayed for 2 days. Use "dur" (total seconds) to describe actual time spent. Say "visited on X days" not "X days". dur values may be incomplete — many visits lack end times so dur=0. If dur seems very low relative to days, note the data is incomplete.
For multi-month questions use get_monthly_summary. For "how often did I go to X" use find_location_visits.
For "where did I go" or "show me on a map" over a date range, use get_date_range_places (returns all visited places in one call) then show_map. This is much cheaper than calling get_day_timeline per day.
For "when did I go to [country/city]?" or "have I been to [region]?", use find_days_in_region with a bounding box. You know common bounding boxes (e.g. Japan: 24-46°N, 122-146°E). For small areas (islands, neighbourhoods), use a GENEROUS bounding box — add at least 0.05° padding on all sides to account for GPS drift and coastal locations. This searches stored location coordinates — much better than text search which matches restaurant names.
To show locations on a map, use show_map with location names (coordinates are resolved locally). Include count (days count) with each marker when available. Omit label to auto-use the place name. You can proactively show a map when answering location-based questions.
To draw a route on the map, use show_route with one or more YYYY-MM-DD dates. It reads full GPS tracks from the database and renders them colour-coded by activity type (walking=green, car=grey, cycling=blue, etc.) matching the main Arc Reader. Use the activity_types parameter to filter to specific activities (e.g. ["walking"] or ["car","bus","train"]). Combine with show_map markers. Proactively show routes when the user asks about a day's journey, trips, or commutes.
Be concise and friendly.`;
    }

    async function callAnthropic(messages) {
        const apiKey = localStorage.getItem(LS_KEY_API);
        if (!apiKey) throw new Error('No API key set. Please enter your Anthropic API key and click Save Key.');

        const model = elModelSelect.value || 'claude-sonnet-4-6';

        // Use prompt caching: mark system prompt and tool definitions as cacheable.
        // Cached tokens are 90% cheaper on subsequent calls within a conversation,
        // which dramatically reduces cost for multi-tool-call queries.
        const body = {
            model: model,
            max_tokens: MODELS[model]?.maxTokens || 4096,
            system: [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
            messages: messages,
            tools: toolDefinitions.map((tool, i) =>
                i === toolDefinitions.length - 1
                    ? { ...tool, cache_control: { type: 'ephemeral' } }
                    : tool
            )
        };

        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        };

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData.error?.message || response.statusText;
            if (response.status === 529) {
                throw new Error('Anthropic API is temporarily overloaded. Please wait a moment and try again.');
            }
            if (response.status === 429) {
                throw new Error('Rate limit reached. Please wait a minute before sending another message.');
            }
            throw new Error(`API error (${response.status}): ${errMsg}`);
        }

        return response.json();
    }

    // =========================================================================
    // Chat UI Helpers
    // =========================================================================

    function addMessage(type, content) {
        // Hide welcome on first message
        if (elWelcome) {
            elWelcome.style.display = 'none';
        }

        const div = document.createElement('div');
        div.className = `chat-message ${type}`;

        if (type === 'assistant') {
            div.innerHTML = formatAssistantMessage(content);
        } else {
            div.textContent = content;
        }

        elMessages.appendChild(div);
        elMessages.scrollTop = elMessages.scrollHeight;
        return div;
    }

    function formatAssistantMessage(text) {
        // Escape HTML first
        let safe = escapeHtml(text);

        // Code blocks: ```...```
        safe = safe.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code>${code.trim()}</code></pre>`;
        });

        // Inline code: `...`
        safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold: **...**
        safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Italic: *...*
        safe = safe.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

        // Line breaks
        safe = safe.replace(/\n/g, '<br>');

        return safe;
    }

    function showThinking() {
        const div = document.createElement('div');
        div.className = 'chat-thinking';
        div.id = 'chatThinking';
        div.innerHTML = '<div class="chat-thinking-dots"><span></span><span></span><span></span></div> Thinking...';
        elMessages.appendChild(div);
        elMessages.scrollTop = elMessages.scrollHeight;
    }

    function hideThinking() {
        const el = document.getElementById('chatThinking');
        if (el) el.remove();
    }

    function showToolInfo(toolName, args) {
        const div = document.createElement('div');
        div.className = 'chat-message tool-info';
        const argsStr = args && Object.keys(args).length > 0
            ? ': ' + Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
            : '';
        div.textContent = `\u{1F527} ${toolName}${argsStr}`;
        elMessages.appendChild(div);
        elMessages.scrollTop = elMessages.scrollHeight;
    }

    function showUsage(usage) {
        if (!usage) return;
        const input = usage.input_tokens || 0;
        const output = usage.output_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheCreate = usage.cache_creation_input_tokens || 0;
        // Non-cached input tokens = total input minus any cached tokens
        const uncachedInput = input - cacheRead - cacheCreate;

        const model = elModelSelect.value || 'claude-sonnet-4-6';
        const costs = MODEL_COSTS[model] || MODEL_COSTS['claude-sonnet-4-6'];
        // Cached reads cost 90% less, cache writes cost 25% more
        const queryCost = (
            uncachedInput * costs.input +
            cacheRead * costs.input * 0.1 +
            cacheCreate * costs.input * 1.25 +
            output * costs.output
        ) / 1_000_000;
        sessionCost += queryCost;
        addToCostTotals(model, input, output, queryCost);

        const div = document.createElement('div');
        div.className = 'chat-message usage-info';
        let text = `${input.toLocaleString()} in / ${output.toLocaleString()} out`;
        if (cacheRead > 0) text += ` (${cacheRead.toLocaleString()} cached)`;
        text += ` · $${queryCost.toFixed(4)} · Session: $${sessionCost.toFixed(4)}`;
        div.textContent = text;
        elMessages.appendChild(div);
        elMessages.scrollTop = elMessages.scrollHeight;
    }

    // =========================================================================
    // Chat Loop
    // =========================================================================

    async function sendChatMessage(text) {
        if (isProcessing || !text.trim()) return;

        const userMessage = text.trim();
        isProcessing = true;
        elInput.disabled = true;
        elSendBtn.disabled = true;

        // Show user message
        addMessage('user', userMessage);
        elInput.value = '';

        // Add to history
        chatHistory.push({ role: 'user', content: userMessage });

        showThinking();

        try {
            let iterations = 0;
            let queryTokensIn = 0;
            let queryTokensOut = 0;

            // Build messages for API — clone history so we can append tool results within the loop
            const messages = chatHistory.map(m => ({ ...m }));

            while (iterations < MAX_TOOL_ITERATIONS) {
                iterations++;

                const response = await callAnthropic(messages);
                queryTokensIn += (response.usage?.input_tokens || 0);
                queryTokensOut += (response.usage?.output_tokens || 0);

                // Parse response content blocks
                const contentBlocks = response.content || [];
                const toolUseBlocks = contentBlocks.filter(b => b.type === 'tool_use');
                const textBlocks = contentBlocks.filter(b => b.type === 'text');

                // Display any text content
                let textContent = textBlocks.map(b => b.text).join('\n').trim();

                if (toolUseBlocks.length > 0) {
                    // Append assistant message (with all content blocks) to messages
                    messages.push({ role: 'assistant', content: contentBlocks });

                    // Execute each tool
                    const toolResults = [];
                    for (const toolBlock of toolUseBlocks) {
                        hideThinking();
                        showToolInfo(toolBlock.name, toolBlock.input);
                        showThinking();

                        let result;
                        try {
                            const executor = toolExecutors[toolBlock.name];
                            if (!executor) throw new Error(`Unknown tool: ${toolBlock.name}`);
                            result = await executor(toolBlock.input || {});
                        } catch (err) {
                            result = { error: err.message };
                        }

                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolBlock.id,
                            // Strip coords/addresses before sending to API (privacy)
                            content: JSON.stringify(stripCoordsForAPI(result))
                        });
                    }

                    // Append tool results as a user message
                    messages.push({ role: 'user', content: toolResults });

                    // If the stop reason indicates more tool use is needed, continue
                    if (response.stop_reason === 'tool_use') {
                        continue;
                    }
                }

                // We have a final text response (or end_turn with text)
                hideThinking();
                if (textContent) {
                    addMessage('assistant', textContent);
                    // Save to chat history (only text, not tool calls)
                    chatHistory.push({ role: 'assistant', content: textContent });
                }
                showUsage({ input_tokens: queryTokensIn, output_tokens: queryTokensOut });
                break;
            }

            // Trim history to prevent context overflow
            trimHistory();

        } catch (err) {
            hideThinking();
            addMessage('error', `Error: ${err.message}`);
            console.error('AI Chat error:', err);
        } finally {
            isProcessing = false;
            elInput.disabled = false;
            elSendBtn.disabled = false;
            elInput.focus();
        }
    }

    function trimHistory() {
        // Keep max N user/assistant pairs (tool results don't count)
        const userAssistantMessages = chatHistory.filter(m =>
            m.role === 'user' && typeof m.content === 'string' ||
            m.role === 'assistant'
        );
        if (userAssistantMessages.length > MAX_HISTORY_PAIRS * 2) {
            // Remove oldest pairs
            const toRemove = userAssistantMessages.length - MAX_HISTORY_PAIRS * 2;
            let removed = 0;
            chatHistory = chatHistory.filter(m => {
                if (removed >= toRemove) return true;
                if ((m.role === 'user' && typeof m.content === 'string') || m.role === 'assistant') {
                    removed++;
                    return false;
                }
                return true;
            });
        }
    }

    function clearChat() {
        chatHistory = [];
        sessionCost = 0;
        coordsCache.clear();
        lastRegionMarkers = [];
        elMessages.innerHTML = '';
        // Restore welcome
        if (elWelcome) {
            elWelcome.style.display = '';
            elMessages.appendChild(elWelcome);
        }
    }

    // =========================================================================
    // API Key Management
    // =========================================================================

    function loadSettings() {
        const savedKey = localStorage.getItem(LS_KEY_API);
        if (savedKey && elApiKey) {
            elApiKey.value = savedKey;
            elApiKey.type = 'password';
        }
        const savedModel = localStorage.getItem(LS_KEY_MODEL);
        if (savedModel && elModelSelect) {
            elModelSelect.value = savedModel;
        }
    }

    function saveApiKey() {
        const key = elApiKey.value.trim();
        if (key) {
            localStorage.setItem(LS_KEY_API, key);
            elApiKey.type = 'password';
            // Brief visual feedback
            elSaveKey.textContent = 'Saved!';
            setTimeout(() => { elSaveKey.textContent = 'Save Key'; }, 1500);
        }
    }

    // =========================================================================
    // Persistent Cost Tracking
    // =========================================================================

    function loadCostTotals() {
        try { return JSON.parse(localStorage.getItem(LS_KEY_COSTS)) || {}; }
        catch (e) { return {}; }
    }

    function saveCostTotals(totals) {
        localStorage.setItem(LS_KEY_COSTS, JSON.stringify(totals));
    }

    function addToCostTotals(model, inputTokens, outputTokens, queryCost) {
        const totals = loadCostTotals();
        if (!totals[model]) totals[model] = { input: 0, output: 0, cost: 0, queries: 0 };
        totals[model].input += inputTokens;
        totals[model].output += outputTokens;
        totals[model].cost += queryCost;
        totals[model].queries += 1;
        saveCostTotals(totals);
        updateCostBadge();
    }

    function resetCostTotals() {
        localStorage.removeItem(LS_KEY_COSTS);
        updateCostBadge();
    }

    function updateCostBadge() {
        if (!elCostBadge) return;
        const totals = loadCostTotals();
        const total = Object.values(totals).reduce((s, m) => s + m.cost, 0);
        elCostBadge.textContent = `$${total.toFixed(2)}`;
        elCostBadge.classList.toggle('zero', total === 0);
        // Refresh panel if open
        if (elCostPanel && elCostPanel.classList.contains('visible')) renderCostPanel();
    }

    function toggleCostPanel() {
        if (!elCostPanel || !elCostBadge) return;
        const isOpen = elCostPanel.classList.toggle('visible');
        elCostBadge.classList.toggle('active', isOpen);
        if (isOpen) renderCostPanel();
    }

    function renderCostPanel() {
        if (!elCostPanelBody) return;
        const totals = loadCostTotals();
        const models = Object.entries(totals);
        if (models.length === 0) {
            elCostPanelBody.innerHTML = '<div class="chat-cost-row" style="justify-content:center;color:var(--text-muted)">No usage yet</div>';
            return;
        }
        let html = '';
        let grandCost = 0, grandQueries = 0;
        for (const [modelId, data] of models) {
            const name = MODELS[modelId]?.name || modelId;
            grandCost += data.cost;
            grandQueries += data.queries;
            html += `<div class="chat-cost-row">
                <div><span class="model-name">${escapeHtml(name)}</span><br>
                <span class="model-detail">${data.queries} ${data.queries === 1 ? 'query' : 'queries'} · ${data.input.toLocaleString()} in / ${data.output.toLocaleString()} out</span></div>
                <span class="model-cost">$${data.cost.toFixed(4)}</span>
            </div>`;
        }
        html += `<div class="chat-cost-total">
            <span>Total (${grandQueries} ${grandQueries === 1 ? 'query' : 'queries'})</span>
            <span class="total-amount">$${grandCost.toFixed(4)}</span>
        </div>`;
        elCostPanelBody.innerHTML = html;
    }

    // =========================================================================
    // Initialization
    // =========================================================================

    function init() {
        // Get DOM references — chat
        elMessages = document.getElementById('chatMessages');
        elInput = document.getElementById('chatInput');
        elSendBtn = document.getElementById('chatSendBtn');
        elModelSelect = document.getElementById('chatModelSelect');
        elApiKey = document.getElementById('chatApiKey');
        elSaveKey = document.getElementById('chatSaveKey');
        elClearBtn = document.getElementById('chatClearBtn');
        elWelcome = document.getElementById('chatWelcome');

        // Get DOM references — map
        elMapPanel = document.getElementById('chatMapPanel');
        elMapContainer = document.getElementById('chatMap');
        elMapTitle = document.getElementById('chatMapTitle');
        elMapStyle = document.getElementById('chatMapStyle');
        elMapClearBtn = document.getElementById('chatMapClearBtn');
        elMapCloseBtn = document.getElementById('chatMapCloseBtn');

        // Get DOM references — cost tracking
        elCostBadge = document.getElementById('chatCostBadge');
        elCostPanel = document.getElementById('chatCostPanel');
        elCostPanelBody = document.getElementById('chatCostPanelBody');
        elCostReset = document.getElementById('chatCostReset');

        if (!elMessages || !elInput) {
            // Chat tab HTML not present — silently exit
            return;
        }

        // Load saved settings
        loadSettings();

        // Event listeners — chat
        elSendBtn.addEventListener('click', () => sendChatMessage(elInput.value));

        elInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage(elInput.value);
            }
        });

        elSaveKey.addEventListener('click', saveApiKey);

        elModelSelect.addEventListener('change', () => {
            localStorage.setItem(LS_KEY_MODEL, elModelSelect.value);
        });

        elClearBtn.addEventListener('click', clearChat);

        // Event listeners — map
        if (elMapClearBtn) {
            elMapClearBtn.addEventListener('click', () => {
                if (chatMap) clearMapMarkers();
            });
        }
        if (elMapCloseBtn) {
            elMapCloseBtn.addEventListener('click', hideMapPanel);
        }
        if (elMapStyle) {
            elMapStyle.addEventListener('change', () => {
                if (chatMap) setMapTileLayer(elMapStyle.value);
            });
        }

        // Refresh chat map tiles when the page theme changes (dark ↔ light).
        // Only matters for the analysis.html heatmap/location maps that use Mapbox
        // theme-aware styles — the chat map mirrors getTileLayer() from app.js
        // which doesn't theme-switch, so this is a no-op most of the time.
        new MutationObserver(() => {
            if (chatMap) {
                const style = localStorage.getItem('arc_chat_map_style') || 'street';
                setMapTileLayer(style);
            }
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

        // Add Mapbox-only styles to the dropdown when a token is available
        function updateChatMapStyleOptions() {
            if (!elMapStyle) return;
            const hasToken = !!getMapboxToken();
            const existing = elMapStyle.querySelector('option[value="outdoors"]');
            if (hasToken && !existing) {
                const opt = document.createElement('option');
                opt.value = 'outdoors';
                opt.textContent = 'Outdoors';
                elMapStyle.appendChild(opt);
            } else if (!hasToken && existing) {
                existing.remove();
                // Reset to street if currently on a Mapbox-only style
                if ((localStorage.getItem('arc_chat_map_style') || 'street') === 'outdoors') {
                    setMapTileLayer('street');
                    elMapStyle.value = 'street';
                }
            }
        }
        updateChatMapStyleOptions();
        window.addEventListener('storage', (e) => {
            if (e.key === MAPBOX_TOKEN_KEY) updateChatMapStyleOptions();
        });

        // Event listeners — cost tracking
        if (elCostBadge) {
            elCostBadge.addEventListener('click', toggleCostPanel);
        }
        if (elCostReset) {
            elCostReset.addEventListener('click', () => {
                resetCostTotals();
                if (elCostPanel) elCostPanel.classList.remove('visible');
                if (elCostBadge) elCostBadge.classList.remove('active');
            });
        }

        // Initialize cost badge display
        updateCostBadge();

        // Show map by default on wide screens (≥1200px)
        if (elMapPanel && window.innerWidth >= 1200) {
            elMapPanel.classList.add('map-default');
            // Defer map init until the chat tab is visible (Leaflet needs dimensions).
            // Use a ResizeObserver on the map container to trigger init + invalidateSize.
            const mapResizeObs = new ResizeObserver(() => {
                if (elMapContainer && elMapContainer.offsetHeight > 0) {
                    initMap();
                    if (chatMap) chatMap.invalidateSize();
                    mapResizeObs.disconnect();
                }
            });
            mapResizeObs.observe(elMapContainer);
        }

        // Example question buttons
        document.querySelectorAll('.chat-example-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const question = btn.getAttribute('data-question');
                if (question) sendChatMessage(question);
            });
        });
    }

    // Wait for DOM ready then initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
