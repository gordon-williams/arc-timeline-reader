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
    let mapScopeActive = false; // "Map area" toggle state
    let abortController = null; // AbortController for in-flight API requests
    let sessionCost = 0;

    // Cost per million tokens
    const MODEL_COSTS = {
        'claude-sonnet-4-6':       { input: 3.00, output: 15.00 },
        'claude-sonnet-4-5':       { input: 3.00, output: 15.00 },
        'claude-haiku-4-5':        { input: 1.00, output: 5.00 },
        'claude-3-haiku-20240307': { input: 0.25, output: 1.25 }
    };

    // --- Gemini Constants ---
    const GEMINI_MODELS = {
        'gemini-2.5-flash':      { name: 'Gemini 2.5 Flash',      maxTokens: 8192 },
        'gemini-2.5-flash-lite': { name: 'Gemini 2.5 Flash Lite', maxTokens: 8192 },
        'gemini-2.5-pro':        { name: 'Gemini 2.5 Pro',        maxTokens: 8192 }
    };
    const GEMINI_MODEL_COSTS = {
        'gemini-2.5-flash':      { input: 0.30, output: 2.50 },
        'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
        'gemini-2.5-pro':        { input: 1.25, output: 10.00 }
    };
    const LS_KEY_GEMINI_API = 'arc_chat_gemini_key';
    const LS_KEY_PROVIDER = 'arc_chat_provider';

    // --- Map State ---
    let chatMap = null;
    let chatMapMarkers = [];
    let chatMapPolylines = [];
    let chatMapTileLayer = null;
    let chatHeatLayer = null;

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
    // Overlay from external sprite file if available
    if (window.ArcSprites) {
        for (const [k, v] of Object.entries(window.ArcSprites.all())) {
            if (v.routeColour) ACTIVITY_COLORS[k.toLowerCase()] = v.routeColour;
        }
    }
    function getActivityColor(type) {
        return ACTIVITY_COLORS[(type || '').toLowerCase()] || '#808080';
    }

    // Default chart palette for multi-dataset or pie/doughnut charts (dark-theme friendly)
    const CHART_PALETTE = [
        '#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2',
        '#64d2ff', '#ffd60a', '#ff6482', '#ac8e68', '#5e5ce6'
    ];
    let inlineCharts = [];

    /**
     * Haversine distance between two points in metres.
     */
    function haversineDist(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const toRad = v => v * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Calculate total distance of a track's points array in metres.
     */
    function trackDistance(points) {
        let d = 0;
        for (let i = 1; i < points.length; i++) {
            d += haversineDist(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
        }
        return d;
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
                // Skip bogus samples (confirmedType/classifiedType 0 = bogus in LocoKit2)
                const ct = s.confirmedType;
                if (ct === 0 || ct === '0' || ct === 'bogus') continue;
                const cl = s.classifiedType;
                if (cl === 0 || cl === '0' || cl === 'bogus') continue;
                const lat = s?.location?.latitude ?? s?.latitude;
                const lng = s?.location?.longitude ?? s?.longitude;
                const ts = s?.location?.timestamp || s?.timestamp || s?.date;
                if (lat == null || lng == null) continue;
                // Skip null island (near 0,0)
                if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) continue;
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
    let elMapScopeLabel, elMapScopeCheck;
    let elProviderSelect, elPrivacy;
    let elMapPanel, elMapContainer, elMapTitle, elMapClearBtn, elMapSaveBtn, elMapStyle, elResizeHandle;
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

    /** Convert a UTC/ISO timestamp to a local YYYY-MM-DD day key. */
    function getLocalDayKey(isoStr) {
        if (!isoStr) return null;
        const d = new Date(isoStr);
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    // =========================================================================
    // Tool Definitions (Anthropic format)
    // =========================================================================

    const toolDefinitions = [
        {
            name: 'get_activity_summary',
            description: 'Get total distance (m), duration (s), elevation gain (m), MET-hours, and count for activity types in a date range. Returns "elev" = cumulative elevation gain, "metH" = MET-hours (training load, computed per-segment from ACSM VO₂ then summed). Optionally filter to specific activities.',
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
            description: 'Get per-month activity totals across a date range. Returns one row per month with distance/duration/elevation gain/MET-hours/count by activity type. Includes "elev" = cumulative elevation gain (m), "metH" = MET-hours (training load). PREFERRED for multi-month questions — avoids needing multiple get_activity_summary calls.',
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
            description: 'Get day-by-day activity stats for a date range (max 90 days). Includes distance, duration, elevation gain ("elev" in metres), MET-hours ("metH"), and count per activity type per day.',
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
            description: 'Draw GPS routes on the map, colour-coded by activity type (walking=green, car=grey, cycling=blue, etc.). Use start_date+end_date for date ranges (e.g. a full year), or dates[] for specific days. Reads GPS tracks from the database. Can be combined with show_map markers. When the user mentions a specific city or region, ALWAYS supply a bounding box to filter to that area.',
            input_schema: {
                type: 'object',
                properties: {
                    dates: {
                        type: 'array',
                        items: { type: 'string', description: 'YYYY-MM-DD' },
                        description: 'Specific day keys to draw routes for. Use this OR start_date/end_date, not both.'
                    },
                    start_date: { type: 'string', description: 'Start of date range (YYYY-MM-DD). Use with end_date for ranges like a full month or year.' },
                    end_date: { type: 'string', description: 'End of date range (YYYY-MM-DD). Use with start_date.' },
                    activity_types: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Filter to only these activity types (e.g. ["walking","cycling"]). Omit to show all. Valid types: walking, running, hiking, cycling, car, bus, train, motorcycle, airplane, boat, skateboarding, inlineskating, snowboarding, skiing, horseback, surfing, tractor, tuktuk, stationary, unknown'
                    },
                    south: { type: 'number', description: 'Southern latitude bound — filter GPS points to this region. Use with north/west/east.' },
                    north: { type: 'number', description: 'Northern latitude bound.' },
                    west: { type: 'number', description: 'Western longitude bound.' },
                    east: { type: 'number', description: 'Eastern longitude bound.' },
                    min_distance: { type: 'number', description: 'Minimum track distance in metres. Only draw tracks longer than this (e.g. 100000 for 100 km). Filters individual trip segments, not daily totals.' },
                    title: { type: 'string', description: 'Title for the map panel (optional)' },
                    clear_existing: { type: 'boolean', description: 'Clear previous routes before drawing (default true). Markers are NOT affected.' }
                }
            }
        },
        {
            name: 'show_chart',
            description: 'Display a chart inline in the chat. Supports bar, line, pie, and doughnut types. Use this to visualise data — NEVER generate code to make charts. Pre-compute all data values from tool results before calling.',
            input_schema: {
                type: 'object',
                properties: {
                    chart_type: {
                        type: 'string',
                        enum: ['bar', 'line', 'pie', 'doughnut'],
                        description: 'Chart type. Use "bar" for comparisons/histograms, "line" for time series, "pie" or "doughnut" for proportions.'
                    },
                    title: { type: 'string', description: 'Chart title displayed above the chart.' },
                    labels: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'X-axis labels (or slice labels for pie/doughnut). E.g. ["Jan","Feb","Mar"].'
                    },
                    datasets: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                label: { type: 'string', description: 'Dataset legend label (e.g. "Walking distance")' },
                                data: {
                                    type: 'array',
                                    items: { type: 'number' },
                                    description: 'Data values, one per label. Must match labels array length.'
                                },
                                color: { type: 'string', description: 'CSS colour (e.g. "#12A656"). Optional — defaults to palette.' },
                                y_axis: { type: 'string', enum: ['y', 'y2'], description: 'Which y-axis this dataset uses. "y" = left (default), "y2" = right. Use for dual-axis charts comparing different units.' }
                            },
                            required: ['label', 'data']
                        },
                        description: 'One or more data series.'
                    },
                    x_label: { type: 'string', description: 'X-axis label (ignored for pie/doughnut).' },
                    y_label: { type: 'string', description: 'Y-axis label — left axis (ignored for pie/doughnut).' },
                    y2_label: { type: 'string', description: 'Right y-axis label. Only used when a dataset has y_axis="y2".' },
                    stacked: { type: 'boolean', description: 'Stack bars/lines (default false).' },
                    horizontal: { type: 'boolean', description: 'Horizontal bar chart (default false). Only for bar type.' },
                    y_min: { type: 'number', description: 'Left y-axis minimum value. Use to zoom into narrow data ranges and enhance visible trends. Ignored for pie/doughnut.' },
                    y_max: { type: 'number', description: 'Left y-axis maximum value. Ignored for pie/doughnut.' },
                    y2_min: { type: 'number', description: 'Right y-axis minimum value.' },
                    y2_max: { type: 'number', description: 'Right y-axis maximum value.' }
                },
                required: ['chart_type', 'labels', 'datasets']
            }
        },
        {
            name: 'show_heatmap',
            description: 'Show GPS data as a heat map on the chat map panel. Much better than show_route for large date ranges (months/years) — avoids a mess of overlapping polylines. Shows intensity based on frequency of visits, time spent, or recency. Use this instead of show_route when visualising patterns over long periods. When the user mentions a specific city or region, ALWAYS supply a bounding box to filter to that area.',
            input_schema: {
                type: 'object',
                properties: {
                    start_date: { type: 'string', description: 'Start of date range (YYYY-MM-DD). Required.' },
                    end_date: { type: 'string', description: 'End of date range (YYYY-MM-DD). Required.' },
                    activity_types: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Filter to only these activity types (e.g. ["walking","cycling"]). Omit to show all moving activities. Valid types: walking, running, hiking, cycling, car, bus, train, motorcycle, airplane, boat, skateboarding, inlineskating, snowboarding, skiing, horseback, surfing, tractor, tuktuk, stationary, unknown'
                    },
                    mode: {
                        type: 'string',
                        enum: ['frequency', 'recency', 'time_spent'],
                        description: 'Heat intensity mode. "frequency" = more GPS points = hotter (default). "recency" = recent routes brighter, old routes fade. "time_spent" = time spent at each point.'
                    },
                    south: { type: 'number', description: 'Southern latitude bound — filter GPS points to this region. Use with north/west/east.' },
                    north: { type: 'number', description: 'Northern latitude bound.' },
                    west: { type: 'number', description: 'Western longitude bound.' },
                    east: { type: 'number', description: 'Eastern longitude bound.' },
                    title: { type: 'string', description: 'Title for the map panel (optional).' },
                    min_distance: { type: 'number', description: 'Minimum trip distance in metres. Only include trips longer than this (e.g. 50000 for 50 km). Filters individual trip segments.' },
                    radius: { type: 'integer', description: 'Heat point radius in pixels (default 12). Increase for zoomed-out views.' },
                    blur: { type: 'integer', description: 'Heat blur in pixels (default 18). Higher = smoother.' }
                },
                required: ['start_date', 'end_date']
            }
        },
        {
            name: 'get_elevation_stats',
            description: 'Find highest and/or lowest altitude points from GPS samples. Scans raw GPS data for altitude extremes. Use for questions like "highest altitude walked", "what elevation did I reach hiking", etc. Returns the top N records with date, altitude, activity type, and nearby place name.',
            input_schema: {
                type: 'object',
                properties: {
                    start_date: { type: 'string', description: 'Start of date range (YYYY-MM-DD). Defaults to all data.' },
                    end_date: { type: 'string', description: 'End of date range (YYYY-MM-DD). Defaults to today.' },
                    activity_types: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Filter to these activity types (e.g. ["walking","hiking"]). Omit for all moving activities.'
                    },
                    mode: {
                        type: 'string',
                        enum: ['highest', 'lowest'],
                        description: 'Return highest or lowest altitude points. Default: "highest".'
                    },
                    limit: { type: 'integer', description: 'Number of top records to return (default 5, max 20).' },
                    south: { type: 'number', description: 'Southern latitude bound — filter GPS points to this region.' },
                    north: { type: 'number', description: 'Northern latitude bound.' },
                    west: { type: 'number', description: 'Western longitude bound.' },
                    east: { type: 'number', description: 'Eastern longitude bound.' }
                }
            }
        },
        {
            name: 'get_location_attendance',
            description: 'Get attendance data for a location grouped by month or week — hours spent, days visited, averages. Use for "how often did I go to work", "graph my hours at [place]", sick leave analysis, or any attendance/regularity question. Returns pre-structured arrays for show_chart. Also returns absence_ranges with day-level absence detection.',
            input_schema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Substring search for location name (e.g. "office", "work").' },
                    start_date: { type: 'string', description: 'Start of date range (YYYY-MM-DD). Defaults to first visit.' },
                    end_date: { type: 'string', description: 'End of date range (YYYY-MM-DD). Defaults to last visit.' },
                    group_by: {
                        type: 'string',
                        enum: ['month', 'week'],
                        description: 'Group results by month (default) or week.'
                    },
                    work_days: {
                        type: 'array',
                        items: { type: 'integer', minimum: 0, maximum: 6 },
                        description: 'Which days of the week are workdays, as JS day numbers: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat. Defaults to [1,2,3,4,5] (Mon-Fri). Use when the user specifies a non-standard workweek.'
                    }
                },
                required: ['query']
            }
        }
    ];

    // =========================================================================
    // Tool Execution Functions
    // =========================================================================

    // Levenshtein distance (compact DP implementation) — shared by fuzzy matchers
    function levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
        for (let j = 0; j <= b.length; j++) m[0][j] = j;
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                m[i][j] = a[i - 1] === b[j - 1]
                    ? m[i - 1][j - 1]
                    : 1 + Math.min(m[i - 1][j], m[i][j - 1], m[i - 1][j - 1]);
            }
        }
        return m[a.length][b.length];
    }

    // Fuzzy location matching — handles typos and partial names.
    // Returns locations sorted by match quality (best first).
    // 1. Exact substring → highest priority (sorted by total duration)
    // 2. Fuzzy word match → scored by Levenshtein similarity per query word
    function fuzzyMatchLocations(allLocs, query) {
        const q = query.toLowerCase().replace(/['']/g, '');
        const qWords = q.split(/\s+/).filter(w => w.length > 0);

        // Score a location name against the query (0–1, higher = better)
        function score(name) {
            const n = name.toLowerCase().replace(/['']/g, '');
            // Exact substring gets top score
            if (n.includes(q)) return 1;
            // Word-level fuzzy: for each query word, find best matching word
            const nWords = n.split(/\s+/).filter(w => w.length > 0);
            let total = 0;
            for (const qw of qWords) {
                let bestSim = 0;
                for (const nw of nWords) {
                    // Also check if query word is a substring of location word
                    if (nw.includes(qw) || qw.includes(nw)) {
                        const sim = Math.min(qw.length, nw.length) / Math.max(qw.length, nw.length);
                        bestSim = Math.max(bestSim, sim);
                    } else {
                        const d = levenshtein(qw, nw);
                        const maxLen = Math.max(qw.length, nw.length);
                        const sim = 1 - d / maxLen;
                        bestSim = Math.max(bestSim, sim);
                    }
                }
                total += bestSim;
            }
            return qWords.length > 0 ? total / qWords.length : 0;
        }

        // Score all locations, filter those above threshold
        const scored = allLocs
            .filter(loc => loc.name)
            .map(loc => ({ loc, score: score(loc.name) }))
            .filter(s => s.score >= 0.4)
            .sort((a, b) => b.score - a.score || (b.loc.totalDuration || 0) - (a.loc.totalDuration || 0));

        return scored.map(s => s.loc);
    }

    // Simple fuzzy check for a single name against a query (for inline filtering)
    function fuzzyNameMatch(name, query) {
        const n = name.toLowerCase().replace(/['']/g, '');
        const q = query.toLowerCase().replace(/['']/g, '');
        if (n.includes(q)) return true;
        // Word-level: each query word must match some location word at ≥60% similarity
        const qWords = q.split(/\s+/).filter(w => w.length > 0);
        const nWords = n.split(/\s+/).filter(w => w.length > 0);
        if (qWords.length === 0) return false;
        let matched = 0;
        for (const qw of qWords) {
            for (const nw of nWords) {
                if (nw.includes(qw) || qw.includes(nw)) { matched++; break; }
                const maxLen = Math.max(qw.length, nw.length);
                // Quick reject: if lengths differ too much, skip Levenshtein
                if (Math.abs(qw.length - nw.length) > maxLen * 0.5) continue;
                const d = levenshtein(qw, nw);
                if (1 - d / maxLen >= 0.6) { matched++; break; }
            }
        }
        return matched >= qWords.length * 0.6;
    }

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
                if (!totals[type]) totals[type] = { n: 0, dur: 0, dist: 0, elev: 0, metH: 0 };
                totals[type].n += stats.count || 0;
                totals[type].dur += stats.duration || 0;
                totals[type].dist += stats.distance || 0;
                totals[type].elev += stats.elevationGain || 0;
                totals[type].metH += stats.metHours || 0;
            }
        }
        // Strip zero-value fields to save tokens
        for (const t of Object.values(totals)) {
            if (!t.n) delete t.n;
            if (!t.dur) delete t.dur;
            if (!t.dist) delete t.dist;
            if (!t.elev) delete t.elev; else t.elev = Math.round(t.elev);
            if (!t.metH) delete t.metH; else t.metH = Math.round(t.metH * 10) / 10;
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
                            if (s.elevationGain) entry.elev = Math.round(s.elevationGain);
                            if (s.metHours) entry.metH = Math.round(s.metHours * 10) / 10;
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
                    if (!name || !fuzzyNameMatch(name, q)) continue;
                    if (!matchedPlaces[name]) matchedPlaces[name] = { daysSet: new Set(), dur: 0, visitCount: 0 };
                    matchedPlaces[name].daysSet.add(dayKey);
                    // Don't count spanning continuations (visit started on a previous day)
                    const itemDay = getLocalDayKey(item.startDate);
                    if (!itemDay || itemDay >= dayKey) {
                        matchedPlaces[name].visitCount++;
                    }
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
            const filtered = fuzzyMatchLocations(all, query).slice(0, 20);
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
                return { error: 'No coordinates found for these locations. You must use EXACT place names from query tool results (get_date_range_places, find_location_visits, search_locations, etc.) — do NOT guess or invent location names. Query the data first, then use the returned place names with show_map.', unresolved };
            }
            renderMapMarkers(resolved, title, clear_existing !== false);
            const result = { displayed: resolved.length, title: title || 'Map' };
            if (unresolved.length > 0) result.unresolved = unresolved;
            return result;
        },

        async show_route({ dates, start_date, end_date, title, clear_existing, activity_types, south, north, west, east, min_distance }) {
            // Build date list from either dates[] or start_date/end_date range
            let dateList = dates || [];
            if (start_date && end_date && dateList.length === 0) {
                dateList = [];
                const d = new Date(start_date + 'T00:00:00');
                const endD = new Date(end_date + 'T00:00:00');
                while (d <= endD) {
                    dateList.push(d.toISOString().slice(0, 10));
                    d.setDate(d.getDate() + 1);
                }
            }
            if (dateList.length === 0) {
                return { error: 'Provide dates[] or start_date + end_date.' };
            }
            const typeFilter = activity_types && activity_types.length > 0
                ? new Set(activity_types.map(t => t.toLowerCase()))
                : null;
            const hasBBox = (south != null && north != null && west != null && east != null);
            // Extract GPS tracks from IDB — keep track boundaries intact so
            // renderRoute draws each track as a separate polyline (no straight
            // lines between unrelated segments).
            const allTracks = [];
            let totalPoints = 0;
            let daysWithData = 0;
            for (let di = 0; di < dateList.length; di++) {
                const date = dateList[di];
                // Yield to main thread every 100 days to prevent browser freeze
                if (di > 0 && di % 100 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                    if (abortController && abortController.signal.aborted) {
                        throw new DOMException('The operation was aborted.', 'AbortError');
                    }
                }
                let day;
                try {
                    const tx = db.transaction(['days'], 'readonly');
                    day = await idbGet(tx.objectStore('days'), date);
                } catch (e) { continue; }
                if (!day || !day.data) continue;
                // Cache visit location coordinates so show_map can resolve them later
                for (const item of (day.data.timelineItems || [])) {
                    if (!item.isVisit) continue;
                    const name = item.place?.name || item.customTitle || '';
                    if (!name) continue;
                    const lat = item.center?.latitude ?? item.place?.center?.latitude;
                    const lng = item.center?.longitude ?? item.place?.center?.longitude;
                    if (lat && lng) cacheCoords(name, lat, lng);
                }
                const tracks = extractTracksFromDay(day.data);
                let dayHasData = false;
                for (const track of tracks) {
                    if (typeFilter && !typeFilter.has((track.activityType || 'unknown').toLowerCase())) continue;
                    // Apply bounding box — filter points within each track
                    if (hasBBox) {
                        track.points = track.points.filter(pt =>
                            pt.lat >= south && pt.lat <= north && pt.lng >= west && pt.lng <= east
                        );
                        if (track.points.length < 2) continue;
                    }
                    // Apply minimum distance filter
                    const dist = track.points.length >= 2 ? trackDistance(track.points) : 0;
                    if (min_distance && dist < min_distance) continue;
                    // Attach date and distance for popup display
                    track.date = date;
                    track.distanceKm = Math.round(dist / 100) / 10; // 1 decimal place
                    allTracks.push(track);
                    totalPoints += track.points.length;
                    dayHasData = true;
                }
                if (dayHasData) daysWithData++;
            }
            if (totalPoints < 2) {
                const filterMsg = typeFilter ? ` (filtered to: ${activity_types.join(', ')})` : '';
                const bboxMsg = hasBBox ? ' within the specified region' : '';
                const rangeMsg = start_date ? `${start_date} to ${end_date}` : dateList.join(', ');
                return { error: 'No GPS track data found for ' + rangeMsg + filterMsg + bboxMsg + '.' };
            }
            renderRoute(allTracks, title, clear_existing !== false);
            const result = { drawn: totalPoints, days: daysWithData, title: title || 'Route' };
            if (typeFilter) result.filtered_to = activity_types;
            return result;
        },

        async show_chart(args) {
            let { chart_type, title, labels, datasets, x_label, y_label, y2_label, stacked, horizontal, y_min, y_max, y2_min, y2_max } = args;

            // Support flat Gemini format: data/data_label/data_color → datasets
            if (!datasets && args.data) {
                datasets = [{ label: args.data_label || 'Value', data: args.data, color: args.data_color }];
                if (args.data2 && args.data2.length > 0) {
                    datasets.push({ label: args.data2_label || 'Value 2', data: args.data2, color: args.data2_color, y_axis: args.data2_y_axis });
                }
            }

            if (!labels || labels.length === 0) {
                return { error: 'No labels provided.' };
            }
            if (!datasets || datasets.length === 0) {
                return { error: 'No datasets provided.' };
            }
            for (const ds of datasets) {
                if (!ds.data || ds.data.length !== labels.length) {
                    return { error: `Dataset "${ds.label}" has ${ds.data?.length || 0} values but ${labels.length} labels. They must match.` };
                }
            }

            const isPieType = (chart_type === 'pie' || chart_type === 'doughnut');
            const hasY2 = datasets.some(ds => ds.y_axis === 'y2');
            const coloredDatasets = datasets.map((ds, i) => {
                const out = { label: ds.label, data: ds.data };
                if (isPieType) {
                    out.backgroundColor = labels.map((_, j) =>
                        ds.color ? ds.color : (CHART_PALETTE[j % CHART_PALETTE.length] + 'cc')
                    );
                    out.borderColor = 'rgba(0,0,0,0.2)';
                    out.borderWidth = 1;
                } else {
                    const color = ds.color || CHART_PALETTE[i % CHART_PALETTE.length];
                    out.backgroundColor = chart_type === 'bar' ? color + 'cc' : color + '22';
                    out.borderColor = color;
                    out.borderWidth = chart_type === 'bar' ? 1 : 2;
                    if (chart_type === 'line') {
                        out.tension = 0.3;
                        out.pointRadius = 3;
                        out.pointBackgroundColor = color;
                        out.fill = stacked ? (i === 0 ? 'origin' : '-1') : false;
                    }
                    if (hasY2) {
                        out.yAxisID = ds.y_axis === 'y2' ? 'y2' : 'y';
                    }
                }
                return out;
            });

            renderChart({
                type: chart_type,
                title: title || '',
                labels,
                datasets: coloredDatasets,
                xLabel: x_label,
                yLabel: y_label,
                y2Label: y2_label,
                stacked: !!stacked,
                horizontal: !!horizontal,
                yMin: y_min,
                yMax: y_max,
                y2Min: y2_min,
                y2Max: y2_max,
                hasY2: hasY2
            });

            return {
                displayed: 'chart',
                chart_type,
                title: title || chart_type + ' chart',
                data_points: labels.length,
                datasets: datasets.length
            };
        },

        async show_heatmap({ start_date, end_date, activity_types, mode, title, radius, blur, south, north, west, east, min_distance }) {
            if (!start_date || !end_date) {
                return { error: 'Both start_date and end_date are required.' };
            }
            const heatMode = mode || 'frequency';
            const hasBBox = (south != null && north != null && west != null && east != null);
            const typeFilter = activity_types && activity_types.length > 0
                ? new Set(activity_types.map(t => t.toLowerCase()))
                : null;

            // Enumerate all days in range
            const dateList = [];
            const d = new Date(start_date + 'T00:00:00');
            const endD = new Date(end_date + 'T00:00:00');
            while (d <= endD) {
                dateList.push(d.toISOString().slice(0, 10));
                d.setDate(d.getDate() + 1);
            }
            if (dateList.length === 0) {
                return { error: 'Invalid date range.' };
            }

            const startMs = new Date(start_date).getTime();
            const endMs = new Date(end_date).getTime();
            const dateSpanMs = Math.max(endMs - startMs, 1);

            // Use streaming grid aggregation to cap memory — all points are
            // inserted into a ~30m grid as they are collected, so the array
            // never grows beyond the number of unique grid cells.
            const GRID = 0.0003; // ~30m grid cell
            const grid = new Map();
            let rawPointCount = 0;
            let daysWithData = 0;

            /** Insert a point into the grid (or small-range buffer). */
            function addHeatPoint(lat, lng, weight) {
                if (hasBBox && (lat < south || lat > north || lng < west || lng > east)) return;
                rawPointCount++;
                const key = `${Math.round(lat / GRID)},${Math.round(lng / GRID)}`;
                if (grid.has(key)) {
                    const cell = grid.get(key);
                    cell[2] += weight;
                    cell[3]++;
                } else {
                    grid.set(key, [lat, lng, weight, 1]);
                }
            }

            for (let di = 0; di < dateList.length; di++) {
                const date = dateList[di];
                // Yield to main thread every 100 days to prevent browser freeze
                if (di > 0 && di % 100 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                    if (abortController && abortController.signal.aborted) {
                        throw new DOMException('The operation was aborted.', 'AbortError');
                    }
                }
                let day;
                try {
                    const tx = db.transaction(['days'], 'readonly');
                    day = await idbGet(tx.objectStore('days'), date);
                } catch (e) { continue; }
                if (!day || !day.data || !day.data.timelineItems) continue;

                // Cache visit location coordinates so show_map can resolve them later
                for (const item of day.data.timelineItems) {
                    if (!item.isVisit) continue;
                    const vName = item.place?.name || item.customTitle || '';
                    if (!vName) continue;
                    const vLat = item.center?.latitude ?? item.place?.center?.latitude;
                    const vLng = item.center?.longitude ?? item.place?.center?.longitude;
                    if (vLat && vLng) cacheCoords(vName, vLat, vLng);
                }

                let dayHasData = false;
                const dayMs = new Date(date).getTime();
                const recencyWeight = heatMode === 'recency'
                    ? 0.1 + 0.9 * ((dayMs - startMs) / dateSpanMs)
                    : 1;

                for (const item of day.data.timelineItems) {
                    // Handle visits (stationary)
                    if (item.isVisit) {
                        if (typeFilter && !typeFilter.has('stationary')) continue;
                        if (!typeFilter) continue; // Skip stationary by default when no filter
                        const lat = item.center?.latitude;
                        const lng = item.center?.longitude;
                        if (!lat || !lng) continue;
                        if (heatMode === 'time_spent') {
                            const durSec = (item.startDate && item.endDate)
                                ? Math.max(0, (new Date(item.endDate) - new Date(item.startDate)) / 1000)
                                : 0;
                            addHeatPoint(lat, lng, Math.min(Math.max(durSec, 1), 28800));
                        } else {
                            addHeatPoint(lat, lng, recencyWeight);
                        }
                        dayHasData = true;
                        continue;
                    }

                    // Handle trip items — use GPS samples
                    const type = (item.activityType || 'unknown').toLowerCase();
                    if (typeFilter && !typeFilter.has(type)) continue;
                    if (!Array.isArray(item.samples) || item.samples.length < 2) continue;

                    const samples = [];
                    for (const s of item.samples) {
                        // Skip bogus samples
                        const ct = s.confirmedType;
                        if (ct === 0 || ct === '0' || ct === 'bogus') continue;
                        const cl = s.classifiedType;
                        if (cl === 0 || cl === '0' || cl === 'bogus') continue;
                        const lat = s?.location?.latitude ?? s?.latitude;
                        const lng = s?.location?.longitude ?? s?.longitude;
                        if (lat == null || lng == null) continue;
                        if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) continue;
                        const ts = s?.location?.timestamp || s?.timestamp || s?.date;
                        samples.push({ lat, lng, t: ts ? new Date(ts).getTime() : null });
                    }

                    // Apply minimum distance filter per trip segment
                    if (min_distance && samples.length >= 2 && trackDistance(samples) < min_distance) continue;

                    if (heatMode === 'time_spent') {
                        for (let j = 0; j < samples.length - 1; j++) {
                            const s = samples[j];
                            const next = samples[j + 1];
                            let weight = 1;
                            if (s.t && next.t) {
                                const gapSec = (next.t - s.t) / 1000;
                                weight = Math.min(Math.max(gapSec, 1), 300);
                            }
                            addHeatPoint(s.lat, s.lng, weight);
                        }
                        if (samples.length > 0) {
                            const last = samples[samples.length - 1];
                            addHeatPoint(last.lat, last.lng, 1);
                        }
                    } else {
                        // frequency or recency
                        for (const s of samples) {
                            addHeatPoint(s.lat, s.lng, recencyWeight);
                        }
                    }
                    dayHasData = true;
                }
                if (dayHasData) daysWithData++;
            }

            if (grid.size < 2) {
                const filterMsg = typeFilter ? ` (filtered to: ${activity_types.join(', ')})` : '';
                const bboxMsg = hasBBox ? ' within the specified region' : '';
                return { error: `No GPS data found for ${start_date} to ${end_date}${filterMsg}${bboxMsg}.` };
            }

            const finalPoints = Array.from(grid.values()).map(c => [c[0], c[1], c[2]]);

            // Compute bounds for the result
            let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
            for (const p of finalPoints) {
                if (p[0] < minLat) minLat = p[0];
                if (p[0] > maxLat) maxLat = p[0];
                if (p[1] < minLng) minLng = p[1];
                if (p[1] > maxLng) maxLng = p[1];
            }

            renderHeatmap(finalPoints, title, radius || 12, blur || 18);

            return {
                displayed: 'heatmap',
                mode: heatMode,
                gps_points: rawPointCount,
                grid_cells: finalPoints.length,
                days_with_data: daysWithData,
                date_range: `${start_date} to ${end_date}`,
                title: title || 'Heatmap',
                bounds: { south: +minLat.toFixed(4), north: +maxLat.toFixed(4), west: +minLng.toFixed(4), east: +maxLng.toFixed(4) }
            };
        },

        async get_elevation_stats({ start_date, end_date, activity_types, mode, limit: maxResults, south, north, west, east }) {
            const elevMode = mode || 'highest';
            const resultLimit = Math.min(Math.max(maxResults || 5, 1), 20);
            const typeFilter = activity_types && activity_types.length > 0
                ? new Set(activity_types.map(t => t.toLowerCase()))
                : null;
            const hasBBox = (south != null && north != null && west != null && east != null);

            // Default date range: all data
            if (!start_date && dailySummaries && dailySummaries.length > 0) {
                const sorted = dailySummaries.map(d => d.dayKey).sort();
                start_date = sorted[0];
            }
            if (!end_date) end_date = new Date().toISOString().slice(0, 10);
            if (!start_date) return { error: 'No data available.' };

            // Enumerate days
            const dayKeys = [];
            const d = new Date(start_date + 'T00:00:00');
            const endD = new Date(end_date + 'T00:00:00');
            while (d <= endD) {
                dayKeys.push(d.toISOString().slice(0, 10));
                d.setDate(d.getDate() + 1);
            }

            // Track top N records (min-heap for highest, max-heap for lowest)
            const records = []; // { alt, date, activityType, placeName }

            for (let di = 0; di < dayKeys.length; di++) {
                const date = dayKeys[di];
                // Yield to main thread every 100 days to prevent browser freeze
                if (di > 0 && di % 100 === 0) {
                    await new Promise(r => setTimeout(r, 0));
                    if (abortController && abortController.signal.aborted) {
                        throw new DOMException('The operation was aborted.', 'AbortError');
                    }
                }
                let day;
                try {
                    const tx = db.transaction(['days'], 'readonly');
                    day = await idbGet(tx.objectStore('days'), date);
                } catch (e) { continue; }
                if (!day || !day.data || !day.data.timelineItems) continue;

                for (const item of day.data.timelineItems) {
                    if (item.isVisit) continue; // Skip stationary visits
                    const actType = (item.activityType || 'unknown').toLowerCase();
                    if (typeFilter && !typeFilter.has(actType)) continue;

                    if (!item.samples || item.samples.length === 0) continue;

                    // Find the nearby place name from the preceding/following visit
                    const placeName = item.customTitle || '';

                    for (const sample of item.samples) {
                        // Skip bogus samples
                        const ct = sample.confirmedType;
                        if (ct === 0 || ct === '0' || ct === 'bogus') continue;
                        const cl = sample.classifiedType;
                        if (cl === 0 || cl === '0' || cl === 'bogus') continue;
                        const sLat = sample.location?.latitude ?? sample.latitude;
                        const sLng = sample.location?.longitude ?? sample.longitude;
                        if (sLat == null || sLng == null) continue;
                        if (Math.abs(sLat) < 0.01 && Math.abs(sLng) < 0.01) continue;
                        // Apply bounding box filter
                        if (hasBBox) {
                            if (sLat < south || sLat > north || sLng < west || sLng > east) continue;
                        }
                        const alt = sample.location?.altitude ?? sample.altitude;
                        if (alt == null || alt === 0) continue; // Skip zero/null altitude

                        const dominated = elevMode === 'highest'
                            ? (records.length >= resultLimit && alt <= records[records.length - 1].alt)
                            : (records.length >= resultLimit && alt >= records[records.length - 1].alt);

                        if (dominated) continue;

                        records.push({ alt: Math.round(alt), date, activityType: actType, place: placeName || undefined, lat: sLat, lng: sLng });

                        // Sort and trim
                        if (elevMode === 'highest') {
                            records.sort((a, b) => b.alt - a.alt);
                        } else {
                            records.sort((a, b) => a.alt - b.alt);
                        }
                        if (records.length > resultLimit) records.length = resultLimit;
                    }
                }
            }

            if (records.length === 0) {
                return { error: 'No altitude data found for the specified criteria.' };
            }

            // Deduplicate consecutive same-date entries (keep best per day)
            const seen = new Set();
            const deduped = [];
            for (const r of records) {
                const key = `${r.date}_${r.activityType}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    deduped.push(r);
                }
            }

            // Cache coordinates so show_map can resolve them
            const results = deduped.map((r, i) => {
                const markerName = `Elevation ${r.alt}m (${r.date})`;
                if (r.lat != null && r.lng != null) cacheCoords(markerName, r.lat, r.lng);
                return {
                    altitude_m: r.alt,
                    date: r.date,
                    activity: r.activityType,
                    marker_name: (r.lat != null && r.lng != null) ? markerName : undefined,
                    ...(r.place ? { place: r.place } : {})
                };
            });

            return {
                mode: elevMode,
                date_range: `${start_date} to ${end_date}`,
                records: results,
                hint: 'Use marker_name values with show_map to plot these points on the map.'
            };
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
        },

        async get_location_attendance({ query, start_date, end_date, group_by, work_days }) {
            group_by = group_by || 'month';
            const workDaySet = new Set(work_days && work_days.length > 0 ? work_days : [1, 2, 3, 4, 5]);
            // Find best matching location by fuzzy search
            const txLoc = db.transaction(['locations'], 'readonly');
            const allLocs = await idbGetAll(txLoc.objectStore('locations'));
            const matches = fuzzyMatchLocations(allLocs, query);
            if (matches.length === 0) {
                return { error: `No locations found matching "${query}". Use search_locations to find the exact name.` };
            }
            const best = matches[0];

            // Get all visits for this location via index
            const txVisits = db.transaction(['locationVisits'], 'readonly');
            const index = txVisits.objectStore('locationVisits').index('locationName');
            let visits = await idbGetAll(index, best.name);

            // Filter by date range
            if (start_date) visits = visits.filter(v => v.dayKey >= start_date);
            if (end_date) visits = visits.filter(v => v.dayKey <= end_date);

            if (visits.length === 0) {
                return { location: best.name, error: 'No visits found in the specified date range.' };
            }

            // Determine actual date range from visits
            visits.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
            const firstDay = start_date || visits[0].dayKey;
            const lastDay = end_date || visits[visits.length - 1].dayKey;

            // Bucket visits by period
            const buckets = {}; // periodKey → { hours, daysSet }
            // Local date key helper (avoids toISOString UTC shift in positive-offset timezones)
            function localKey(d) {
                return d.getFullYear() + '-' +
                    String(d.getMonth() + 1).padStart(2, '0') + '-' +
                    String(d.getDate()).padStart(2, '0');
            }

            for (const v of visits) {
                let periodKey;
                if (group_by === 'week') {
                    // ISO week: Monday-based
                    const d = new Date(v.dayKey + 'T00:00:00');
                    const day = d.getDay() || 7; // Monday=1, Sunday=7
                    d.setDate(d.getDate() - day + 1); // Back to Monday
                    periodKey = localKey(d);
                } else {
                    periodKey = v.dayKey.slice(0, 7); // YYYY-MM
                }
                if (!buckets[periodKey]) buckets[periodKey] = { hours: 0, daysSet: new Set() };
                buckets[periodKey].daysSet.add(v.dayKey);
                if (v.duration) buckets[periodKey].hours += v.duration / 3600;
            }

            // Generate continuous period keys to fill gaps with zeroes
            const allPeriods = [];
            if (group_by === 'week') {
                const cur = new Date(firstDay + 'T00:00:00');
                const day = cur.getDay() || 7;
                cur.setDate(cur.getDate() - day + 1); // Back to Monday
                const endD = new Date(lastDay + 'T00:00:00');
                while (cur <= endD) {
                    allPeriods.push(localKey(cur));
                    cur.setDate(cur.getDate() + 7);
                }
            } else {
                const [sy, sm] = firstDay.split('-').map(Number);
                const [ey, em] = lastDay.split('-').map(Number);
                let y = sy, m = sm;
                while (y < ey || (y === ey && m <= em)) {
                    allPeriods.push(`${y}-${String(m).padStart(2, '0')}`);
                    m++;
                    if (m > 12) { m = 1; y++; }
                }
            }

            // Build output arrays
            const periods = [];
            const hours = [];
            const days = [];
            const avgHoursPerDay = [];
            let totalHours = 0;
            let totalDays = 0;

            for (const pk of allPeriods) {
                const b = buckets[pk];
                const h = b ? Math.round(b.hours * 10) / 10 : 0;
                const d = b ? b.daysSet.size : 0;
                const avg = d > 0 ? Math.round((h / d) * 10) / 10 : 0;

                // Format label
                let label;
                if (group_by === 'week') {
                    label = 'w/c ' + pk; // week commencing
                } else {
                    const [yr, mo] = pk.split('-');
                    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    label = monthNames[parseInt(mo, 10) - 1] + ' ' + yr;
                }

                periods.push(label);
                hours.push(h);
                days.push(d);
                avgHoursPerDay.push(avg);
                totalHours += h;
                totalDays += d;
            }

            // Build day-level absence ranges — find every missing workday,
            // coalesce consecutive ones (bridging off-days between absent workdays)
            const absenceRanges = [];
            const visitedDays = new Set();
            for (const v of visits) visitedDays.add(v.dayKey);

            // Walk every workday in the date range
            const absentWorkdays = [];
            const rangeStart = new Date(firstDay + 'T00:00:00');
            const rangeEnd = new Date(lastDay + 'T00:00:00');
            for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
                if (!workDaySet.has(d.getDay())) continue; // skip off-days
                const key = localKey(d);
                if (!visitedDays.has(key)) absentWorkdays.push(key);
            }

            // Compute max gap between consecutive workdays (off-days to bridge).
            // For a standard Mon-Fri week this is 3 (Fri→Mon). For other schedules
            // it's 7 minus the number of workdays (e.g. Tue-Sat with Sun-Mon off = 2).
            const maxOffDayGap = 7 - workDaySet.size + 1;

            // Coalesce: consecutive absent workdays separated only by off-days
            let i = 0;
            while (i < absentWorkdays.length) {
                const from = absentWorkdays[i];
                let to = from;
                let wkDays = 1;
                while (i + 1 < absentWorkdays.length) {
                    const cur = new Date(absentWorkdays[i] + 'T00:00:00');
                    const next = new Date(absentWorkdays[i + 1] + 'T00:00:00');
                    const gap = Math.round((next - cur) / 86400000);
                    if (gap <= maxOffDayGap) {
                        i++;
                        to = absentWorkdays[i];
                        wkDays++;
                    } else break;
                }
                const fromDate = new Date(from + 'T00:00:00');
                const toDate = new Date(to + 'T00:00:00');
                const calDays = Math.round((toDate - fromDate) / 86400000) + 1;
                absenceRanges.push({ from, to, workdays: wkDays, calendar_days: calDays });
                i++;
            }

            // Cache coords
            if (best.lat && best.lng) {
                cacheCoords(best.name, best.lat, best.lng);
            }

            const result = {
                location: best.name,
                range: [firstDay, lastDay],
                group_by,
                periods,
                hours,
                days,
                avg_hours_per_day: avgHoursPerDay,
                absence_ranges: absenceRanges,
                summary: {
                    total_hours: Math.round(totalHours * 10) / 10,
                    total_days: totalDays,
                    periods_with_visits: periods.filter((_, i) => days[i] > 0).length,
                    periods_total: periods.length,
                    periods_absent: absenceRanges.length
                }
            };

            if (matches.length > 1) {
                result.also_matched = matches.slice(1, 5).map(loc => loc.name);
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
            zoomControl: true,
            fadeAnimation: false   // Prevent tile opacity flash on pan/click
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

    let currentTileStyle = null;
    function setMapTileLayer(styleKey, force) {
        // Skip if the style hasn't changed — avoids visible tile flash.
        // Pass force=true when the underlying tile URL may have changed
        // (e.g. theme switch with Mapbox token).
        if (!force && styleKey === currentTileStyle && chatMapTileLayer) return;
        if (chatMapTileLayer) chatMap.removeLayer(chatMapTileLayer);
        chatMapTileLayer = getChatTileLayer(styleKey);
        chatMapTileLayer.addTo(chatMap);
        currentTileStyle = styleKey;
        localStorage.setItem('arc_chat_map_style', styleKey);
    }

    function showMapPanel(title) {
        if (!elMapPanel) return;
        elMapPanel.classList.add('visible');
        if (title && elMapTitle) elMapTitle.textContent = title;
        // Show the "Use map area" checkbox
        if (elMapScopeLabel) elMapScopeLabel.classList.add('visible');
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
        if (elResizeHandle) {
            elResizeHandle.classList.remove('visible');
        }
        // Hide the "Use map area" checkbox and uncheck
        if (elMapScopeLabel) elMapScopeLabel.classList.remove('visible');
        if (elMapScopeCheck) { elMapScopeCheck.checked = false; mapScopeActive = false; }
        // Reset flex overrides so chat container takes full width
        const chatContainer = document.querySelector('.chat-container');
        if (chatContainer) chatContainer.style.flex = '';
        if (elMapPanel) elMapPanel.style.flex = '';
    }

    function clearMapMarkers() {
        for (const marker of chatMapMarkers) {
            chatMap.removeLayer(marker);
        }
        chatMapMarkers = [];
        clearMapPolylines();
        clearHeatLayer();
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

        // Fit map to show all markers.
        // Re-fit after showMapPanel's invalidateSize settles (50ms & 200ms).
        if (bounds.length === 1) {
            chatMap.setView(bounds[0], 15);
            setTimeout(() => { chatMap.invalidateSize(); chatMap.setView(bounds[0], 15); }, 250);
        } else if (bounds.length > 1) {
            chatMap.fitBounds(bounds, { padding: [30, 30] });
            setTimeout(() => { chatMap.invalidateSize(); chatMap.fitBounds(bounds, { padding: [30, 30] }); }, 250);
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
        clearHeatLayer(); // routes and heatmap are mutually exclusive

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
            // Bind popup with date, activity type, and distance if available
            if (track.date) {
                const activity = track.activityType || 'unknown';
                const dateStr = track.date; // YYYY-MM-DD
                const distStr = track.distanceKm != null ? `${track.distanceKm} km` : '';
                const popupHtml = `<div style="font:13px/1.4 -apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;min-width:100px">`
                    + `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(dateStr)}</div>`
                    + `<div style="color:#666">${escapeHtml(activity)}${distStr ? ' · ' + distStr : ''}</div>`
                    + `</div>`;
                line.bindPopup(popupHtml, { closeButton: false, offset: [0, -4] });
            }
            chatMapPolylines.push(border, line);
            bounds.push(...latlngs);
        }

        // Fit map to route bounds.
        // Re-fit after showMapPanel's invalidateSize settles (50ms & 200ms).
        if (bounds.length >= 2) {
            chatMap.fitBounds(bounds, { padding: [30, 30] });
            setTimeout(() => { chatMap.invalidateSize(); chatMap.fitBounds(bounds, { padding: [30, 30] }); }, 250);
        } else if (bounds.length === 1) {
            chatMap.setView(bounds[0], 15);
            setTimeout(() => { chatMap.invalidateSize(); chatMap.setView(bounds[0], 15); }, 250);
        }
    }

    /**
     * Render GPS data as a heat map layer on the chat map.
     * Uses Leaflet.heat (L.heatLayer) which is already loaded.
     * @param {Array} points - [[lat, lng, intensity], ...]
     * @param {string} title - Map panel title
     * @param {number} radius - Heat point radius in pixels
     * @param {number} blur - Heat blur in pixels
     */
    function renderHeatmap(points, title, radius, blur) {
        if (!elMapPanel.classList.contains('visible')) {
            elMapPanel.classList.add('visible');
        }
        initMap();
        if (title) showMapPanel(title);

        // Heatmap and polylines are mutually exclusive
        clearMapPolylines();
        clearHeatLayer();

        // Calculate max intensity using 95th percentile for good colour spread
        const intensities = points.map(p => p[2]).sort((a, b) => a - b);
        const p95 = intensities[Math.floor(intensities.length * 0.95)] || 1;
        const heatMax = Math.max(p95, 0.001);

        chatHeatLayer = L.heatLayer(points, {
            radius: radius,
            blur: blur,
            maxZoom: 17,
            max: heatMax,
            gradient: {
                0.0:  '#3b0764',
                0.05: '#4338ca',
                0.10: '#2563eb',
                0.20: '#0891b2',
                0.30: '#059669',
                0.40: '#16a34a',
                0.50: '#65a30d',
                0.60: '#ca8a04',
                0.70: '#ea580c',
                0.80: '#dc2626',
                0.90: '#e11d48',
                1.0:  '#fef08a'
            }
        }).addTo(chatMap);

        // Fit map to heat data bounds.
        // Defer so it runs after showMapPanel's invalidateSize settles.
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const p of points) {
            if (p[0] < minLat) minLat = p[0];
            if (p[0] > maxLat) maxLat = p[0];
            if (p[1] < minLng) minLng = p[1];
            if (p[1] > maxLng) maxLng = p[1];
        }
        if (minLat < Infinity) {
            const bounds = [[minLat, minLng], [maxLat, maxLng]];
            chatMap.fitBounds(bounds, { padding: [30, 30] });
            // Re-fit after invalidateSize settles (showMapPanel fires at 50ms & 200ms)
            setTimeout(() => {
                chatMap.invalidateSize();
                chatMap.fitBounds(bounds, { padding: [30, 30] });
            }, 250);
        }
    }

    function clearHeatLayer() {
        if (chatHeatLayer && chatMap) {
            chatMap.removeLayer(chatHeatLayer);
            chatHeatLayer = null;
        }
    }

    // =========================================================================
    // Inline Chart Rendering
    // =========================================================================

    function renderChart(config) {
        // Hide welcome message
        if (elWelcome) elWelcome.style.display = 'none';

        // Create chart container as a chat message
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-message chart-message';

        // Header row: title + export button
        const header = document.createElement('div');
        header.className = 'chat-chart-header';
        if (config.title) {
            const titleEl = document.createElement('span');
            titleEl.className = 'chat-chart-title';
            titleEl.textContent = config.title;
            header.appendChild(titleEl);
        }
        const exportBtn = document.createElement('button');
        exportBtn.className = 'chat-export-btn';
        exportBtn.textContent = '📥 PNG';
        exportBtn.title = 'Download chart as PNG';
        header.appendChild(exportBtn);
        wrapper.appendChild(header);

        // Canvas container
        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'chat-chart-container';
        const canvas = document.createElement('canvas');
        canvasContainer.appendChild(canvas);
        wrapper.appendChild(canvasContainer);

        // Append to chat
        elMessages.appendChild(wrapper);
        elMessages.scrollTop = elMessages.scrollHeight;

        // Theme detection
        const style = getComputedStyle(document.body);
        const isDark = (style.getPropertyValue('--bg-app') || '').trim().startsWith('#1');
        const axisColor = isDark ? 'rgba(255,255,255,0.8)' : '#1d1d1f';
        const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
        const legendColor = axisColor;

        const isPieType = (config.type === 'pie' || config.type === 'doughnut');

        // Chart.js configuration
        const chartConfig = {
            type: config.type,
            data: {
                labels: config.labels,
                datasets: config.datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: (config.type === 'bar' && config.horizontal) ? 'y' : 'x',
                plugins: {
                    legend: {
                        display: config.datasets.length > 1 || isPieType,
                        position: isPieType ? 'right' : 'top',
                        labels: {
                            font: { family: '-apple-system, BlinkMacSystemFont, sans-serif', size: 11 },
                            color: legendColor,
                            padding: 8,
                            usePointStyle: true
                        }
                    },
                    title: { display: false },
                    tooltip: {
                        backgroundColor: isDark ? 'rgba(44,44,46,0.95)' : 'rgba(255,255,255,0.95)',
                        titleColor: axisColor,
                        bodyColor: axisColor,
                        borderColor: gridColor,
                        borderWidth: 1,
                        titleFont: { family: '-apple-system, BlinkMacSystemFont, sans-serif', weight: 'bold' },
                        bodyFont: { family: '-apple-system, BlinkMacSystemFont, sans-serif' },
                        padding: 8
                    }
                }
            }
        };

        // Axis configuration (bar/line only)
        if (!isPieType) {
            chartConfig.options.scales = {
                x: {
                    stacked: config.stacked,
                    title: {
                        display: !!config.xLabel,
                        text: config.xLabel || '',
                        font: { family: '-apple-system, BlinkMacSystemFont, sans-serif', size: 11, weight: 'bold' },
                        color: axisColor
                    },
                    grid: { color: gridColor, lineWidth: 0.5 },
                    ticks: {
                        font: { family: '-apple-system, BlinkMacSystemFont, sans-serif', size: 10 },
                        color: axisColor,
                        maxRotation: 45
                    }
                },
                y: {
                    beginAtZero: config.yMin == null,
                    min: config.yMin != null ? config.yMin : undefined,
                    max: config.yMax != null ? config.yMax : undefined,
                    stacked: config.stacked,
                    title: {
                        display: !!config.yLabel,
                        text: config.yLabel || '',
                        font: { family: '-apple-system, BlinkMacSystemFont, sans-serif', size: 11, weight: 'bold' },
                        color: axisColor
                    },
                    grid: { color: gridColor, lineWidth: 0.5 },
                    ticks: {
                        font: { family: '-apple-system, BlinkMacSystemFont, sans-serif', size: 10 },
                        color: axisColor
                    }
                }
            };

            // Add right y-axis for dual-axis charts
            if (config.hasY2) {
                chartConfig.options.scales.y2 = {
                    position: 'right',
                    beginAtZero: config.y2Min == null,
                    min: config.y2Min != null ? config.y2Min : undefined,
                    max: config.y2Max != null ? config.y2Max : undefined,
                    title: {
                        display: !!config.y2Label,
                        text: config.y2Label || '',
                        font: { family: '-apple-system, BlinkMacSystemFont, sans-serif', size: 11, weight: 'bold' },
                        color: axisColor
                    },
                    grid: { drawOnChartArea: false },
                    ticks: {
                        font: { family: '-apple-system, BlinkMacSystemFont, sans-serif', size: 10 },
                        color: axisColor
                    }
                };
            }
        }

        const chart = new Chart(canvas.getContext('2d'), chartConfig);
        inlineCharts.push(chart);

        // PNG export handler — renders title + chart + border onto an offscreen canvas
        exportBtn.addEventListener('click', () => {
            const slug = (config.title || 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const dpr = window.devicePixelRatio || 1;
            const chartImg = chart.toBase64Image('image/png', 1);

            const img = new Image();
            img.onload = () => {
                const style = getComputedStyle(document.body);
                const isDarkExport = (style.getPropertyValue('--bg-app') || '').trim().startsWith('#1');

                const pad = 24;           // padding inside border
                const titleH = config.title ? 28 : 0; // space for title text
                const titleGap = config.title ? 12 : 0;
                const borderR = 12;
                const borderW = 1;

                const imgW = img.naturalWidth;
                const imgH = img.naturalHeight;
                const totalW = imgW + pad * 2;
                const totalH = imgH + pad * 2 + titleH + titleGap;

                const offscreen = document.createElement('canvas');
                offscreen.width = totalW;
                offscreen.height = totalH;
                const ctx = offscreen.getContext('2d');

                // Background fill
                const bgColor = isDarkExport ? '#1c1c1e' : '#ffffff';
                const borderColor = isDarkExport ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
                const titleColor = isDarkExport ? '#f5f5f7' : '#1d1d1f';

                // Rounded rect background
                ctx.beginPath();
                ctx.roundRect(0, 0, totalW, totalH, borderR);
                ctx.fillStyle = bgColor;
                ctx.fill();

                // Border
                ctx.beginPath();
                ctx.roundRect(borderW / 2, borderW / 2, totalW - borderW, totalH - borderW, borderR);
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = borderW;
                ctx.stroke();

                // Title
                if (config.title) {
                    ctx.fillStyle = titleColor;
                    ctx.font = `600 ${14 * dpr}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
                    ctx.textBaseline = 'top';
                    ctx.fillText(config.title, pad, pad);
                }

                // Chart image
                ctx.drawImage(img, pad, pad + titleH + titleGap, imgW, imgH);

                const link = document.createElement('a');
                link.download = slug + '.png';
                link.href = offscreen.toDataURL('image/png');
                link.click();
            };
            img.src = chartImg;
        });
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

        // Include current map viewport bounds ONLY when the user has explicitly toggled "Use map area"
        let mapBoundsInfo = '';
        if (mapScopeActive && chatMap && elMapPanel && (elMapPanel.classList.contains('visible') || elMapPanel.classList.contains('map-default'))) {
            try {
                const b = chatMap.getBounds();
                if (b && b.isValid()) {
                    const boundsStr = `south=${b.getSouth().toFixed(4)}, north=${b.getNorth().toFixed(4)}, west=${b.getWest().toFixed(4)}, east=${b.getEast().toFixed(4)}`;
                    mapBoundsInfo = `\n**MAP AREA FILTER ACTIVE.** The user has toggled "Use map area" ON. You MUST use these bounding box coordinates for ALL show_route, show_heatmap, find_days_in_region, and get_elevation_stats calls: ${boundsStr} (zoom ${chatMap.getZoom()}). Do NOT use wider bounds — restrict results to this exact viewport.`;
                }
            } catch (e) { /* map not ready */ }
        }

        return `Timeline assistant. Query user's location/activity data via tools.
TODAY'S DATE: ${today}. CURRENT YEAR: ${today.slice(0, 4)}. When the user says "last N months" or "last year", ALWAYS calculate dates relative to today (${today}), NOT from the start of the data range.
Locale: ${locale}. Timezone: ${tz}. Data: ${dateInfo}. Activities: ${[...actTypes].join(', ') || 'none'}.${mapBoundsInfo}
ALWAYS use metric units (km, metres). NEVER use miles or feet. dur values from tools are in seconds — ALWAYS convert and display as hours and minutes (e.g. 3661s → "1 hr 1 min", 120s → "2 min"). NEVER show raw seconds to the user. Times are local (already converted from UTC).
Tool result keys: n=count, dur=duration(s), dist=distance(m), d=date, vis=raw visit segments (NOT unique days), days=unique days visited, m=month, act=activities, loc=location.
IMPORTANT for locations: "days" means the number of UNIQUE CALENDAR DAYS the user visited that place — NOT how long they stayed. A ferry terminal with days=2 means visited on 2 separate days, not stayed for 2 days. Use "dur" (total seconds) to describe actual time spent. Say "visited on X days" not "X days". dur values may be incomplete — many visits lack end times so dur=0. If dur seems very low relative to days, note the data is incomplete.
For multi-month questions use get_monthly_summary. For "how often did I go to X" use find_location_visits.
For "where did I go" or "show me on a map" over a date range, use get_date_range_places (returns all visited places in one call) then show_map. This is much cheaper than calling get_day_timeline per day.
For "when did I go to [country/city]?" or "have I been to [region]?", use find_days_in_region with a bounding box. You know common bounding boxes (e.g. Japan: 24-46°N, 122-146°E). For small areas (islands, neighbourhoods), use a GENEROUS bounding box — add at least 0.05° padding on all sides to account for GPS drift and coastal locations. This searches stored location coordinates — much better than text search which matches restaurant names. find_days_in_region only returns dates and place names — it does NOT have GPS tracks. To visualise routes, follow up with show_route or show_heatmap using the dates found.
To show locations on a map, use show_map with location names (coordinates are resolved locally from cache). CRITICAL: You MUST use exact place names returned by query tools (get_date_range_places, find_location_visits, search_locations, etc.) — NEVER guess or invent location names like "Brisbane" or "Sydney". Always query the data FIRST to get real place names, then pass those names to show_map. Include count (days count) with each marker when available. Omit label to auto-use the place name. You can proactively show a map when answering location-based questions.
To draw routes on the map, use show_route — this is the ONLY tool that visualises GPS tracks. Use it for SHORT-to-MEDIUM date ranges (a few days to ~4 weeks). For specific days use dates[] (e.g. dates=["2025-03-15"]). For date ranges use start_date + end_date — the tool will enumerate all days internally. Routes are colour-coded by activity type (walking=green, car=grey, cycling=blue, etc.). Use activity_types to filter (e.g. ["walking"] or ["car"]). When the user mentions a specific city or region, ALWAYS include a bounding box (south/north/west/east) to filter to that area. When the user asks to see routes "outside" a region, use a WIDE bounding box covering the wider area (e.g. the state or country) to capture the trips beyond the city. Combine with show_map markers. Use min_distance (in metres) to filter by trip length (e.g. min_distance=100000 for "trips over 100 km"). Proactively show routes when the user asks about journeys, trips, drives, commutes, or route visualisation.
For LONG date ranges (months or a full year), use show_heatmap instead of show_route — it displays GPS data as a heat map which is much more readable than hundreds of overlapping polylines. Modes: "frequency" (default — more visits = hotter), "recency" (recent routes brighter), "time_spent" (longer stays = hotter). Increase radius for zoomed-out views of large areas. Use show_heatmap when the user asks to see walking/cycling/activity patterns, coverage, or route frequency over extended periods. When the user mentions a specific city or region (e.g. "walking in Brisbane"), ALWAYS include a bounding box (south/north/west/east) to filter GPS data to that area — otherwise data from all locations will appear. You know common city bounding boxes.
To visualise data as a chart, use show_chart. Supported types: bar (comparisons, histograms), line (time series), pie/doughnut (proportions). You must pre-compute the data values from tool results and provide them as arrays — convert distances to km and durations to hours BEFORE passing to show_chart. Use bar charts for monthly breakdowns, line charts for trends over time, pie/doughnut for activity proportions. Set horizontal=true for ranked lists (e.g. top locations by visits). Use y_min and y_max to zoom into narrow data ranges and enhance visible trends (e.g. VO₂ values ranging 10-14 — set y_min=8, y_max=16 to make differences clear). Proactively use y_min/y_max when the data range is small relative to the baseline. For comparing two metrics with different units (e.g. distance vs elevation gain, speed vs VO₂), use DUAL Y-AXES: set y_axis="y2" on the second dataset to assign it to the right-hand axis, and set y2_label for its unit. You can also set y2_min/y2_max to zoom the right axis. The left axis (y) and right axis (y2) scale independently, making trends in both metrics clearly visible. Proactively use dual axes when the user asks to compare or overlay metrics that have different units or very different value ranges. Use activity colours where appropriate: walking=#12A656, cycling=#039FD4, running=#EB781B, car=#4E5268, bus=#4056B5, train=#AA9131, hiking=#0E8444.
For altitude/elevation questions ("highest point walked", "what elevation did I reach"), use get_elevation_stats — it scans raw GPS samples for altitude extremes. Supports bounding box (south/north/west/east) to filter to a region.
For attendance tracking, sick leave analysis, or graphing hours/days at a location over time, use get_location_attendance. It returns pre-structured arrays (periods, hours, days, avg_hours_per_day) ready for show_chart. Follow up with show_chart using periods as labels and hours or days as datasets. Months with zero visits (e.g. sick leave) appear as gaps in the chart. Use group_by="week" for finer granularity.
When the user asks about ABSENCES, gaps, time off, sick leave, or periods NOT at a location, use get_location_attendance. The result includes an absence_ranges array built from day-level analysis: every missing workday is detected and consecutive absent days are coalesced into ranges (off-days between absent workdays are bridged). Each range has: from, to, workdays (absent workdays), and calendar_days (including bridged off-days). This catches single-day absences, partial-week absences, and multi-week spans. Present these ranges as a concise table. If the user specifies a non-standard workweek (e.g. "I work Tuesday to Saturday"), pass work_days with the appropriate day numbers (0=Sun..6=Sat). Default is Mon-Fri [1,2,3,4,5]. You CAN and SHOULD answer absence questions using this data — do NOT say the data only shows when the user WAS somewhere.
For cumulative elevation gain questions ("how much climbing did I do", "elevation gain per month", "total ascent"), use get_activity_summary or get_monthly_summary — activity stats include an "elev" field (metres of cumulative elevation gain, sum of all positive altitude changes). get_daily_stats also includes "elev" per activity per day. Use these for trends, charts, and comparisons — they are pre-aggregated and fast. Do NOT use get_elevation_stats for cumulative gain (it only finds altitude extremes). You can also compute derived metrics from the raw data: elevation density (elev ÷ dist×1000 = m/km, terrain steepness), average speed (dist÷1000 ÷ dur÷3600 = km/h), and estimated VO₂ using the ACSM walking equation: VO₂ = 3.5 + (0.1 × speed_m_per_min) + (1.8 × speed_m_per_min × grade), where speed_m_per_min = dist ÷ (dur/60) and grade = elev/dist. Result is ml/kg/min. Intensity zones: light <14, moderate 14–24, vigorous >24. METs = VO₂ / 3.5 (metabolic equivalent — 1 MET = resting, ~3 METs = normal walking, 4+ = brisk). IMPORTANT: VO₂, METs, and MET-hours are computed using the ACSM walking equation and ONLY apply to walking, hiking, and running. They are zero for cycling, car, bus, train, and other non-foot activities — do not try to compute or display them for those. For training load questions ("how hard am I training", "monthly training load", "exercise volume"), use the pre-computed "metH" field (MET-hours) from activity summaries — this is computed per-segment then summed, not from averages, so it accurately reflects cumulative training load. MET-hours = METs × hours for each walk. Higher values = more training stimulus.
NEVER generate code (Python, JavaScript, or any programming language). NEVER suggest the user run a script. Use the available tools to query data and display results visually.
When presenting numerical data in text, format it as a readable markdown table with headers — NEVER dump raw values as a comma-separated list. Always include context columns (month names, location names, dates) alongside the values. Convert distances from metres to km (divide by 1000, 1 decimal place) and durations from seconds to hours/minutes before displaying.
Be concise and friendly.`;
    }

    // Sanitise messages before sending to API — strip any extra fields the
    // API may have returned on content blocks (e.g. _toolName) that it then
    // rejects on the next request.
    function sanitiseMessages(msgs) {
        return msgs.map(m => {
            if (!Array.isArray(m.content)) return m;
            return {
                ...m,
                content: m.content.map(block => {
                    if (block.type === 'tool_use') {
                        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
                    }
                    if (block.type === 'tool_result') {
                        const clean = { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content };
                        if (block.is_error) clean.is_error = true;
                        return clean;
                    }
                    if (block.type === 'text') {
                        return { type: 'text', text: block.text };
                    }
                    return block;
                })
            };
        });
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
            messages: sanitiseMessages(messages),
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
            body: JSON.stringify(body),
            signal: abortController ? abortController.signal : undefined
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

    // --- Provider Abstraction ---

    function getProvider() {
        return elProviderSelect ? elProviderSelect.value : 'anthropic';
    }

    function updateProviderUI() {
        const provider = getProvider();

        // Update model dropdown
        const models = provider === 'gemini' ? GEMINI_MODELS : MODELS;
        const costTable = provider === 'gemini' ? GEMINI_MODEL_COSTS : MODEL_COSTS;
        const savedModel = localStorage.getItem(LS_KEY_MODEL);
        elModelSelect.innerHTML = '';
        for (const [id, m] of Object.entries(models)) {
            const costs = costTable[id];
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = `${m.name} ($${costs.input}/$${costs.output})`;
            elModelSelect.appendChild(opt);
        }
        if (savedModel && models[savedModel]) {
            elModelSelect.value = savedModel;
        }

        // Update API key input
        const lsKey = provider === 'gemini' ? LS_KEY_GEMINI_API : LS_KEY_API;
        const savedKey = localStorage.getItem(lsKey);
        elApiKey.value = savedKey || '';
        elApiKey.type = savedKey ? 'password' : 'text';
        elApiKey.placeholder = provider === 'gemini' ? 'AIza...' : 'sk-ant-...';

        // Update privacy notice
        if (elPrivacy) {
            elPrivacy.textContent = provider === 'gemini'
                ? 'Your timeline data is sent to Google\'s Gemini API for processing. GPS coordinates and addresses are never sent \u2014 only place names. Your API key is stored locally in your browser.'
                : 'Your timeline data is sent to Anthropic\'s API for processing. API data is not used for model training and is retained for up to 30 days for safety purposes only. GPS coordinates and addresses are never sent \u2014 only place names. Your API key is stored locally in your browser.';
        }
    }

    // --- Gemini Adapter ---

    // Convert Anthropic tool definitions to Gemini format.
    // Gemini struggles with deeply nested object-array schemas (like show_chart
    // datasets), so we flatten show_chart into simple top-level arrays.
    let _geminiToolsCache = null;
    function getGeminiTools() {
        if (_geminiToolsCache) return _geminiToolsCache;
        _geminiToolsCache = [{
            functionDeclarations: toolDefinitions.map(tool => {
                let schema = tool.input_schema;

                // Flatten show_chart for Gemini — replace nested datasets array
                // with simple top-level parameters for up to 2 datasets
                if (tool.name === 'show_chart') {
                    schema = {
                        type: 'object',
                        properties: {
                            chart_type: { type: 'string', enum: ['bar', 'line', 'pie', 'doughnut'], description: 'Chart type.' },
                            title: { type: 'string', description: 'Chart title.' },
                            labels: { type: 'array', items: { type: 'string' }, description: 'X-axis labels array. E.g. ["Jan","Feb","Mar"].' },
                            data: { type: 'array', items: { type: 'number' }, description: 'Data values for the first dataset. One number per label.' },
                            data_label: { type: 'string', description: 'Legend label for the first dataset.' },
                            data_color: { type: 'string', description: 'CSS colour for the first dataset (e.g. "#12A656").' },
                            data2: { type: 'array', items: { type: 'number' }, description: 'Data values for optional second dataset.' },
                            data2_label: { type: 'string', description: 'Legend label for the second dataset.' },
                            data2_color: { type: 'string', description: 'CSS colour for the second dataset.' },
                            data2_y_axis: { type: 'string', enum: ['y', 'y2'], description: 'Y-axis for second dataset. "y2" = right axis for dual-axis charts.' },
                            x_label: { type: 'string', description: 'X-axis label.' },
                            y_label: { type: 'string', description: 'Left y-axis label.' },
                            y2_label: { type: 'string', description: 'Right y-axis label (dual-axis charts).' },
                            stacked: { type: 'boolean', description: 'Stack bars/lines.' },
                            horizontal: { type: 'boolean', description: 'Horizontal bar chart.' },
                            y_min: { type: 'number', description: 'Left y-axis minimum.' },
                            y_max: { type: 'number', description: 'Left y-axis maximum.' },
                            y2_min: { type: 'number', description: 'Right y-axis minimum.' },
                            y2_max: { type: 'number', description: 'Right y-axis maximum.' }
                        },
                        required: ['chart_type', 'labels', 'data', 'data_label']
                    };
                }

                // Strip nested 'required' from all schemas — Gemini handles them poorly
                function stripNestedRequired(obj) {
                    if (!obj || typeof obj !== 'object') return obj;
                    const clone = Array.isArray(obj) ? [...obj] : { ...obj };
                    if (clone.items && typeof clone.items === 'object' && clone.items.required) {
                        clone.items = { ...clone.items };
                        delete clone.items.required;
                    }
                    if (clone.properties) {
                        clone.properties = { ...clone.properties };
                        for (const [k, v] of Object.entries(clone.properties)) {
                            clone.properties[k] = stripNestedRequired(v);
                        }
                    }
                    return clone;
                }

                return {
                    name: tool.name,
                    description: tool.description,
                    parameters: stripNestedRequired(schema)
                };
            })
        }];
        return _geminiToolsCache;
    }

    // Convert Anthropic-shaped messages array to Gemini contents format
    function convertMessagesForGemini(messages) {
        const contents = [];
        for (const msg of messages) {
            if (msg.role === 'user') {
                if (typeof msg.content === 'string') {
                    contents.push({ role: 'user', parts: [{ text: msg.content }] });
                } else if (Array.isArray(msg.content)) {
                    // Tool results → functionResponse parts
                    const parts = msg.content.map(block => {
                        if (block.type === 'tool_result') {
                            let response;
                            try { response = JSON.parse(block.content); }
                            catch (e) { response = { result: block.content }; }
                            return {
                                functionResponse: {
                                    name: block._toolName || '',
                                    response: response
                                }
                            };
                        }
                        return { text: block.content || '' };
                    });
                    contents.push({ role: 'user', parts });
                }
            } else if (msg.role === 'assistant') {
                if (typeof msg.content === 'string') {
                    contents.push({ role: 'model', parts: [{ text: msg.content }] });
                } else if (Array.isArray(msg.content)) {
                    const parts = msg.content.map(block => {
                        if (block.type === 'tool_use') {
                            return { functionCall: { name: block.name, args: block.input } };
                        }
                        return { text: block.text || '' };
                    });
                    contents.push({ role: 'model', parts });
                }
            }
        }
        return contents;
    }

    // Normalise Gemini response to Anthropic shape so sendChatMessage loop works unchanged
    function normalizeGeminiResponse(data) {
        const candidate = data.candidates?.[0];
        if (!candidate) throw new Error('No response from Gemini API.');

        const blockedReasons = {
            'SAFETY': 'safety filters',
            'RECITATION': 'recitation filters',
            'BLOCKLIST': 'blocklist filters',
            'PROHIBITED_CONTENT': 'prohibited content',
            'SPII': 'sensitive personal information filters',
        };
        if (blockedReasons[candidate.finishReason]) {
            throw new Error(`Gemini blocked this response due to ${blockedReasons[candidate.finishReason]}. Try rephrasing your question.`);
        }

        // MALFORMED_FUNCTION_CALL: Gemini generated invalid tool arguments.
        // This often happens with complex schemas (nested objects, arrays).
        // Throw a helpful error so the Retry button appears.
        if (candidate.finishReason === 'MALFORMED_FUNCTION_CALL') {
            const hint = (candidate.content?.parts || [])
                .filter(p => p.text).map(p => p.text).join(' ').trim();
            throw new Error('Gemini generated a malformed tool call'
                + (hint ? ` — ${hint}` : '')
                + '. Try Anthropic Sonnet for complex chart requests, or rephrase with simpler terms.');
        }

        const parts = candidate.content?.parts || [];
        const contentBlocks = [];
        let hasToolUse = false;

        for (const part of parts) {
            if (part.functionCall) {
                hasToolUse = true;
                contentBlocks.push({
                    type: 'tool_use',
                    id: `gemini_${part.functionCall.name}_${Date.now()}`,
                    name: part.functionCall.name,
                    input: part.functionCall.args || {}
                });
            } else if (part.text) {
                contentBlocks.push({ type: 'text', text: part.text });
            }
        }

        // Empty response — surface the finish reason so the user knows why
        if (contentBlocks.length === 0) {
            const reason = candidate.finishReason || 'unknown';
            throw new Error(`Gemini returned an empty response (finishReason: ${reason}). Try a different model or rephrase your question.`);
        }

        const usage = data.usageMetadata || {};
        return {
            content: contentBlocks,
            stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
            usage: {
                input_tokens: usage.promptTokenCount || 0,
                output_tokens: usage.candidatesTokenCount || 0,
                cache_read_input_tokens: usage.cachedContentTokenCount || 0,
                cache_creation_input_tokens: 0
            }
        };
    }

    async function callGemini(messages) {
        const apiKey = localStorage.getItem(LS_KEY_GEMINI_API);
        if (!apiKey) throw new Error('No API key set. Please enter your Google Gemini API key and click Save Key.');

        const model = elModelSelect.value || 'gemini-2.5-flash';

        const body = {
            systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
            contents: convertMessagesForGemini(messages),
            tools: getGeminiTools(),
            generationConfig: {
                maxOutputTokens: GEMINI_MODELS[model]?.maxTokens || 8192
            }
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify(body),
            signal: abortController ? abortController.signal : undefined
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData.error?.message || response.statusText;
            if (response.status === 429) {
                throw new Error('Rate limit reached. Please wait a minute before sending another message.');
            }
            if (response.status === 503) {
                throw new Error('Gemini API is temporarily overloaded. Please wait a moment and try again.');
            }
            throw new Error(`API error (${response.status}): ${errMsg}`);
        }

        const data = await response.json();
        return normalizeGeminiResponse(data);
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
            // Bind CSV export buttons
            div.querySelectorAll('.chat-csv-export').forEach(btn => {
                btn.addEventListener('click', () => {
                    const csv = decodeURIComponent(escape(atob(btn.dataset.csv)));
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = 'chat-table.csv';
                    link.click();
                    URL.revokeObjectURL(link.href);
                });
            });
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

        // Markdown tables: detect consecutive lines starting with |
        safe = safe.replace(/((?:^|\n)\|[^\n]+\|(?:\n\|[^\n]+\|)+)/g, (tableBlock) => {
            const lines = tableBlock.trim().split('\n').filter(l => l.trim());
            if (lines.length < 2) return tableBlock;

            // Parse rows — skip separator row (|---|---|)
            const parseRow = line => line.split('|').slice(1, -1).map(c => c.trim());
            const headers = parseRow(lines[0]);
            const isSep = line => /^\|[\s:*-]+\|/.test(line.trim());
            const dataLines = lines.slice(1).filter(l => !isSep(l));

            // Build HTML table
            let html = '<div class="chat-table-wrapper">';
            html += '<table class="chat-table"><thead><tr>';
            for (const h of headers) html += `<th>${h}</th>`;
            html += '</tr></thead><tbody>';
            for (const row of dataLines) {
                const cells = parseRow(row);
                html += '<tr>';
                for (const c of cells) html += `<td>${c}</td>`;
                html += '</tr>';
            }
            html += '</tbody></table>';

            // CSV export button — encode data in a data attribute
            const csvRows = [headers, ...dataLines.map(parseRow)];
            const csvData = csvRows.map(r => r.map(c => '"' + c.replace(/"/g, '""') + '"').join(',')).join('\n');
            const b64 = btoa(unescape(encodeURIComponent(csvData)));
            html += `<button class="chat-export-btn chat-csv-export" data-csv="${b64}">📥 CSV</button>`;
            html += '</div>';
            return html;
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

        const provider = getProvider();
        const model = elModelSelect.value || (provider === 'gemini' ? 'gemini-2.5-flash' : 'claude-sonnet-4-6');
        let queryCost;

        if (provider === 'gemini') {
            const costs = GEMINI_MODEL_COSTS[model] || GEMINI_MODEL_COSTS['gemini-2.5-flash'];
            // Gemini implicit caching: cached tokens are free
            queryCost = (uncachedInput * costs.input + output * costs.output) / 1_000_000;
        } else {
            const costs = MODEL_COSTS[model] || MODEL_COSTS['claude-sonnet-4-6'];
            // Cached reads cost 90% less, cache writes cost 25% more
            queryCost = (
                uncachedInput * costs.input +
                cacheRead * costs.input * 0.1 +
                cacheCreate * costs.input * 1.25 +
                output * costs.output
            ) / 1_000_000;
        }
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

    function cancelChat() {
        if (!isProcessing) return;
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
    }

    async function sendChatMessage(text) {
        if (isProcessing || !text.trim()) return;

        const userMessage = text.trim();
        isProcessing = true;
        abortController = new AbortController();
        elInput.disabled = true;
        elSendBtn.textContent = 'Cancel';
        elSendBtn.classList.add('cancel-mode');
        elSendBtn.disabled = false; // keep enabled for cancel

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

                // Check if cancelled between iterations
                if (abortController && abortController.signal.aborted) {
                    throw new DOMException('The operation was aborted.', 'AbortError');
                }

                const response = getProvider() === 'gemini'
                    ? await callGemini(messages)
                    : await callAnthropic(messages);
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
                        // Check if cancelled before each tool execution
                        if (abortController && abortController.signal.aborted) {
                            throw new DOMException('The operation was aborted.', 'AbortError');
                        }

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
                            _toolName: toolBlock.name, // Used by Gemini adapter (matches by name, not ID)
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
                } else {
                    // Model returned no text — show error with retry
                    const msg = iterations > 1
                        ? 'The model returned no response after running the tool. Try a different model or rephrase your question.'
                        : 'The model returned an empty response. Try a different model or rephrase your question.';
                    addMessage('error', msg);
                }
                showUsage({ input_tokens: queryTokensIn, output_tokens: queryTokensOut });
                break;
            }

            // Trim history to prevent context overflow
            trimHistory();

        } catch (err) {
            hideThinking();
            if (err.name === 'AbortError') {
                addMessage('error', 'Cancelled.');
                // Remove the unanswered user message from history
                if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
                    chatHistory.pop();
                }
            } else {
                const errDiv = addMessage('error', `Error: ${err.message}`);
                // Add retry button — remove failed exchange and re-send
                const retryBtn = document.createElement('button');
                retryBtn.className = 'chat-retry-btn';
                retryBtn.textContent = 'Retry';
                retryBtn.addEventListener('click', () => {
                    // Pop the failed user message from history
                    const lastMsg = chatHistory.length > 0 && chatHistory[chatHistory.length - 1];
                    const retryText = lastMsg && lastMsg.role === 'user' ? chatHistory.pop().content : null;
                    // Remove everything from the last user message div onwards
                    const allDivs = Array.from(elMessages.querySelectorAll('.chat-message'));
                    const lastUserIdx = allDivs.findLastIndex(d => d.classList.contains('user'));
                    if (lastUserIdx >= 0) {
                        for (let i = allDivs.length - 1; i >= lastUserIdx; i--) allDivs[i].remove();
                    }
                    if (retryText) sendChatMessage(retryText);
                });
                errDiv.appendChild(retryBtn);
            }
            console.error('AI Chat error:', err);
        } finally {
            isProcessing = false;
            abortController = null;
            elInput.disabled = false;
            elSendBtn.disabled = false;
            elSendBtn.textContent = 'Send';
            elSendBtn.classList.remove('cancel-mode');
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
        // Destroy inline charts to prevent memory leaks
        for (const chart of inlineCharts) {
            try { chart.destroy(); } catch (e) { /* already destroyed */ }
        }
        inlineCharts = [];
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
        // Restore provider selection first
        const savedProvider = localStorage.getItem(LS_KEY_PROVIDER);
        if (savedProvider && elProviderSelect) {
            elProviderSelect.value = savedProvider;
        }

        // Populate model dropdown and load provider-specific API key
        updateProviderUI();

        // Restore saved model (after updateProviderUI has populated the options)
        const savedModel = localStorage.getItem(LS_KEY_MODEL);
        if (savedModel && elModelSelect) {
            elModelSelect.value = savedModel;
        }
    }

    function saveApiKey() {
        const key = elApiKey.value.trim();
        if (key) {
            const lsKey = getProvider() === 'gemini' ? LS_KEY_GEMINI_API : LS_KEY_API;
            localStorage.setItem(lsKey, key);
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
            const name = MODELS[modelId]?.name || GEMINI_MODELS[modelId]?.name || modelId;
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

        // Get DOM references — provider
        elProviderSelect = document.getElementById('chatProviderSelect');
        elPrivacy = document.getElementById('chatPrivacy');

        // Get DOM references — map scope checkbox
        elMapScopeLabel = document.getElementById('chatMapScopeLabel');
        elMapScopeCheck = document.getElementById('chatMapScopeCheck');

        // Get DOM references — map
        elMapPanel = document.getElementById('chatMapPanel');
        elMapContainer = document.getElementById('chatMap');
        elMapTitle = document.getElementById('chatMapTitle');
        elMapStyle = document.getElementById('chatMapStyle');
        elMapClearBtn = document.getElementById('chatMapClearBtn');
        elMapSaveBtn = document.getElementById('chatMapSaveBtn');
        elResizeHandle = document.getElementById('chatResizeHandle');

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
        elSendBtn.addEventListener('click', () => {
            if (isProcessing) {
                cancelChat();
            } else {
                sendChatMessage(elInput.value);
            }
        });

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

        // Event listener — provider selector
        if (elProviderSelect) {
            elProviderSelect.addEventListener('change', () => {
                localStorage.setItem(LS_KEY_PROVIDER, elProviderSelect.value);
                updateProviderUI();
                // Clear chat — message formats are incompatible between providers
                clearChat();
                if (elWelcome) elWelcome.style.display = '';
            });
        }

        elClearBtn.addEventListener('click', clearChat);

        // Event listener — map scope checkbox
        if (elMapScopeCheck) {
            elMapScopeCheck.addEventListener('change', () => {
                mapScopeActive = elMapScopeCheck.checked;
            });
        }

        // Event listeners — map
        if (elMapClearBtn) {
            elMapClearBtn.addEventListener('click', () => {
                if (chatMap) clearMapMarkers();
            });
        }
        if (elMapSaveBtn) {
            elMapSaveBtn.addEventListener('click', async () => {
                if (!elMapContainer) return;
                const origText = elMapSaveBtn.textContent;
                elMapSaveBtn.textContent = '⏳';
                elMapSaveBtn.disabled = true;
                try {
                    // Load dom-to-image (same library used by main map page)
                    // — handles Leaflet's CSS translate3d correctly via style override
                    if (typeof window.domtoimage === 'undefined') {
                        await new Promise((resolve, reject) => {
                            const s = document.createElement('script');
                            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/dom-to-image/2.6.0/dom-to-image.min.js';
                            s.integrity = 'sha384-zESinL+vR3OR5XGFqKjneclbVKOL8SfP+fKKO3K9BHAaPtboci56Vu3g5flevHk9';
                            s.crossOrigin = 'anonymous';
                            s.onload = resolve;
                            s.onerror = () => reject(new Error('Failed to load dom-to-image'));
                            document.head.appendChild(s);
                        });
                    }

                    const isDark = (getComputedStyle(document.body).getPropertyValue('--bg-app') || '').trim().startsWith('#1');

                    // Hide Leaflet controls for a clean capture
                    const controls = elMapContainer.querySelector('.leaflet-control-container');
                    const controlsWasVisible = controls && controls.style.display !== 'none';
                    if (controls) controls.style.display = 'none';

                    // Wait for any pending tile loads + rendering
                    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                    await new Promise(r => setTimeout(r, 300));

                    const w = elMapContainer.clientWidth || elMapContainer.offsetWidth;
                    const h = elMapContainer.clientHeight || elMapContainer.offsetHeight;

                    // Capture using dom-to-image with transform:none to fix
                    // Leaflet's translate3d polyline/marker offset issue
                    const mapDataUrl = await window.domtoimage.toPng(elMapContainer, {
                        bgcolor: isDark ? '#1c1c1e' : '#f0f0f2',
                        width: w,
                        height: h,
                        style: { transform: 'none' },
                        filter: (node) => {
                            if (!(node instanceof Element)) return true;
                            if (node.classList.contains('leaflet-control-container')) return false;
                            return true;
                        }
                    });

                    // Restore controls
                    if (controls && controlsWasVisible) controls.style.display = '';

                    // Load captured image to draw onto composition canvas
                    const mapImg = await new Promise((resolve, reject) => {
                        const img = new Image();
                        img.onload = () => resolve(img);
                        img.onerror = () => reject(new Error('Failed to load captured map image'));
                        img.src = mapDataUrl;
                    });

                    // Compose final image: title bar + map with border
                    const title = (elMapTitle && elMapTitle.textContent) || 'Map';
                    const dpr = 2;
                    const pad = 20 * dpr;
                    const titleH = 24 * dpr;
                    const titleGap = 8 * dpr;
                    const borderR = 12 * dpr;
                    const mapW = mapImg.naturalWidth * dpr;
                    const mapH = mapImg.naturalHeight * dpr;
                    const totalW = mapW + pad * 2;
                    const totalH = mapH + pad * 2 + titleH + titleGap;

                    const offscreen = document.createElement('canvas');
                    offscreen.width = totalW;
                    offscreen.height = totalH;
                    const ctx = offscreen.getContext('2d');

                    const bgColor = isDark ? '#1c1c1e' : '#ffffff';
                    const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
                    const titleColor = isDark ? '#f5f5f7' : '#1d1d1f';

                    // Rounded rect background
                    ctx.beginPath();
                    ctx.roundRect(0, 0, totalW, totalH, borderR);
                    ctx.fillStyle = bgColor;
                    ctx.fill();
                    ctx.strokeStyle = borderColor;
                    ctx.lineWidth = dpr;
                    ctx.stroke();

                    // Title
                    ctx.fillStyle = titleColor;
                    ctx.font = `600 ${14 * dpr}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
                    ctx.textBaseline = 'top';
                    ctx.fillText(title, pad, pad);

                    // Map image (clip to rounded rect)
                    const mapY = pad + titleH + titleGap;
                    const mapBorderR = 8 * dpr;
                    ctx.save();
                    ctx.beginPath();
                    ctx.roundRect(pad, mapY, mapW, mapH, mapBorderR);
                    ctx.clip();
                    ctx.drawImage(mapImg, pad, mapY, mapW, mapH);
                    ctx.restore();

                    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
                    const link = document.createElement('a');
                    link.download = slug + '.png';
                    link.href = offscreen.toDataURL('image/png');
                    link.click();
                } catch (err) {
                    console.error('Failed to export map:', err);
                } finally {
                    // Ensure controls are restored even on error
                    const controls = elMapContainer.querySelector('.leaflet-control-container');
                    if (controls) controls.style.display = '';
                    elMapSaveBtn.textContent = origText;
                    elMapSaveBtn.disabled = false;
                }
            });
        }
        // Resize handle — drag to resize chat/map panels
        if (elResizeHandle && elMapPanel) {
            const LS_KEY_SPLIT = 'arc_chat_map_split';
            const chatContainer = document.querySelector('.chat-container');
            const chatSplit = document.querySelector('.chat-split');

            // Restore saved split ratio (default 40% chat, 60% map)
            const savedRatio = parseFloat(localStorage.getItem(LS_KEY_SPLIT)) || 40;
            function applySplitRatio(chatPct) {
                if (!chatContainer || !elMapPanel) return;
                chatContainer.style.flex = `0 0 ${chatPct}%`;
                elMapPanel.style.flex = `0 0 ${100 - chatPct - 2}%`; // 2% for handle+gap
            }

            // Apply on map show
            const origShowMapPanel = showMapPanel;
            showMapPanel = function(title) {
                origShowMapPanel(title);
                elResizeHandle.classList.add('visible');
                const ratio = parseFloat(localStorage.getItem(LS_KEY_SPLIT)) || 40;
                applySplitRatio(ratio);
            };

            let isDragging = false;

            // Overlay covers the map during drag so Leaflet doesn't steal
            // mouse events (which causes the map to pan/flash).
            const dragOverlay = document.createElement('div');
            dragOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:col-resize;display:none;';
            document.body.appendChild(dragOverlay);

            function startDrag(e) {
                e.preventDefault();
                isDragging = true;
                elResizeHandle.classList.add('dragging');
                dragOverlay.style.display = 'block';
                document.body.style.userSelect = 'none';
            }
            function onDrag(clientX) {
                if (!isDragging || !chatSplit) return;
                const rect = chatSplit.getBoundingClientRect();
                const x = clientX - rect.left;
                let pct = (x / rect.width) * 100;
                pct = Math.max(20, Math.min(80, pct)); // Clamp 20-80%
                applySplitRatio(pct);
            }
            function endDrag() {
                if (!isDragging) return;
                isDragging = false;
                elResizeHandle.classList.remove('dragging');
                dragOverlay.style.display = 'none';
                document.body.style.userSelect = '';
                // Save the ratio
                if (chatContainer) {
                    const pct = parseFloat(chatContainer.style.flex.replace(/[^0-9.]/g, '')) || 40;
                    localStorage.setItem(LS_KEY_SPLIT, pct.toFixed(1));
                }
                // Leaflet needs resize after panel change
                if (chatMap) setTimeout(() => chatMap.invalidateSize(), 50);
            }

            // Mouse events — overlay captures moves during drag
            elResizeHandle.addEventListener('mousedown', startDrag);
            dragOverlay.addEventListener('mousemove', (e) => onDrag(e.clientX));
            dragOverlay.addEventListener('mouseup', endDrag);
            // Fallback: also listen on document in case mouse leaves overlay
            document.addEventListener('mouseup', endDrag);

            // Touch events (tablet support)
            elResizeHandle.addEventListener('touchstart', (e) => {
                if (e.touches.length === 1) startDrag(e);
            }, { passive: false });
            document.addEventListener('touchmove', (e) => {
                if (isDragging && e.touches.length === 1) onDrag(e.touches[0].clientX);
            }, { passive: true });
            document.addEventListener('touchend', endDrag);
        }
        if (elMapStyle) {
            elMapStyle.addEventListener('change', () => {
                if (chatMap) setMapTileLayer(elMapStyle.value);
            });
        }

        // Refresh chat map tiles when the page theme changes (dark ↔ light).
        // Only matters when a Mapbox token is set, since free tile providers
        // don't have theme variants. We only care about theme-relevant classes
        // (light-mode, mapbox-active) — Leaflet adds/removes leaflet-dragging
        // on every pan which we must ignore to avoid tile flash.
        let lastThemeKey = (document.body.classList.contains('light-mode') ? 'L' : 'D') +
                           (document.body.classList.contains('mapbox-active') ? 'M' : '');
        new MutationObserver(() => {
            const key = (document.body.classList.contains('light-mode') ? 'L' : 'D') +
                        (document.body.classList.contains('mapbox-active') ? 'M' : '');
            if (key === lastThemeKey) return; // only leaflet-dragging or similar changed
            lastThemeKey = key;
            if (chatMap && getMapboxToken()) {
                const style = localStorage.getItem('arc_chat_map_style') || 'street';
                setMapTileLayer(style, true); // force — theme actually changed
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
            // Show resize handle, map scope button, and apply saved split ratio
            if (elResizeHandle) elResizeHandle.classList.add('visible');
            if (elMapScopeLabel) elMapScopeLabel.classList.add('visible');
            const chatContainer = document.querySelector('.chat-container');
            if (chatContainer) {
                const LS_KEY_SPLIT = 'arc_chat_map_split';
                const ratio = parseFloat(localStorage.getItem(LS_KEY_SPLIT)) || 40;
                chatContainer.style.flex = `0 0 ${ratio}%`;
                elMapPanel.style.flex = `0 0 ${100 - ratio - 2}%`;
            }
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

    // Expose theme update for inline charts so analysis.html toggleTheme can call it
    window._updateChatChartTheme = function() {
        if (inlineCharts.length === 0) return;
        const style = getComputedStyle(document.body);
        const isDark = (style.getPropertyValue('--bg-app') || '').trim().startsWith('#1');
        const axisColor = isDark ? 'rgba(255,255,255,0.8)' : '#1d1d1f';
        const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
        const tooltipBg = isDark ? 'rgba(44,44,46,0.95)' : 'rgba(255,255,255,0.95)';

        for (const chart of inlineCharts) {
            try {
                const opts = chart.options;
                // Update tooltip
                if (opts.plugins?.tooltip) {
                    opts.plugins.tooltip.backgroundColor = tooltipBg;
                    opts.plugins.tooltip.titleColor = axisColor;
                    opts.plugins.tooltip.bodyColor = axisColor;
                    opts.plugins.tooltip.borderColor = gridColor;
                }
                // Update legend
                if (opts.plugins?.legend?.labels) {
                    opts.plugins.legend.labels.color = axisColor;
                }
                // Update axes
                if (opts.scales) {
                    for (const scaleKey of Object.keys(opts.scales)) {
                        const scale = opts.scales[scaleKey];
                        if (scale.title) scale.title.color = axisColor;
                        if (scale.ticks) scale.ticks.color = axisColor;
                        if (scale.grid) scale.grid.color = gridColor;
                    }
                }
                chart.update('none'); // 'none' = no animation for instant redraw
            } catch (e) { /* chart may be destroyed */ }
        }
    };

    // Wait for DOM ready then initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
