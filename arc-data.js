/**
 * Arc Timeline Diary Reader — Data Extraction & Transformation
 *
 * Transforms raw timeline data into displayable structures.
 * Contains: timeline coalescing, note/pin/track extraction, location clustering,
 * activity classification, and daily stats calculation.
 *
 * Depends on: arc-state.js (ArcState), arc-utils.js (ArcUtils), arc-db.js (ArcDB)
 */
(() => {
    'use strict';

    const S = window.ArcState;
    const { calculateDistance, calculatePathDistance, calculateElevationGain } = window.ArcUtils;
    const { findContainedItems, getLocalDayKey } = window.ArcDB;

    // Alias — backward compat
    const calculateDistanceMeters = calculateDistance;

    // ========================================
    // Activity Type Classification
    // ========================================

        function getActivityFilterType(activity) {
            activity = (activity || '').toLowerCase();
            
            if (activity.includes('stationary')) return 'stationary';
            if (activity.includes('walk') || activity.includes('golf') || activity.includes('wheelchair')) return 'walking';
            if (activity.includes('hiking')) return 'hiking';
            if (activity.includes('running')) return 'running';
            if (activity.includes('cycling') || activity.includes('bicycle') || activity.includes('rowing') || 
                activity.includes('swimming') || activity.includes('kayaking')) return 'cycling';
            if (activity.includes('car') || activity.includes('automotive') || activity.includes('taxi')) return 'car';
            if (activity.includes('bus')) return 'bus';
            if (activity.includes('motorcycle') || activity.includes('scooter')) return 'motorcycle';
            if (activity.includes('airplane') || activity.includes('aircraft') || activity.includes('flight') || 
                activity.includes('hotairballoon')) return 'airplane';
            if (activity.includes('boat') || activity.includes('ferry')) return 'boat';
            if (activity.includes('train') || activity.includes('metro') || activity.includes('tram') || 
                activity.includes('cablecar') || activity.includes('funicular') || activity.includes('chairlift') || 
                activity.includes('skilift') || activity.includes('railway')) return 'train';
            if (activity.includes('skateboard')) return 'skateboarding';
            if (activity.includes('inlineskating') || activity.includes('rollerblade')) return 'inlineSkating';
            if (activity.includes('snowboard')) return 'snowboarding';
            if (activity.includes('skiing') || activity.includes('ski')) return 'skiing';
            if (activity.includes('horseback') || activity.includes('horse')) return 'horseback';
            if (activity.includes('surfing') || activity.includes('surf')) return 'surfing';
            if (activity.includes('tractor')) return 'tractor';
            if (activity.includes('tuktuk') || activity.includes('songthaew')) return 'tuktuk';
            
            return 'unknown';
        }


    // ========================================
    // Display-Only Timeline Coalescer
    // ========================================

        // ========== Display-Only Timeline Coalescer ==========
        // Applies ONLY to iCloud backup imports - JSON exports work correctly without coalescing
        // Never modifies canonical chain - display purposes only
        // Rules:
        // 1. Items with customTitle are ALWAYS shown (user intentionally named them)
        // 2. Items contained within a longer visit's timespan are marked _contained and hidden
        // 3. Items without GPS samples are marked _dataGap (shown with [NO GPS] tag if not contained)
        // 4. Merge adjacent visits: same placeId, gap ≤ MAX_MERGE_GAP_MS, no intervening locomotion
        // 5. Short visits (0 seconds) without customTitle may be suppressed
        
        const COALESCE_SETTINGS = {
            enabled: true,                    // Master toggle
            maxMergeGapMs: 15 * 60 * 1000,   // 15 minutes max gap for merging visits
            // showRawTimeline removed
        };
        
        function coalesceTimelineForDisplay(items) {
            if (!items || items.length === 0) return items;
            if (!COALESCE_SETTINGS.enabled) {
                return items; // Return unmodified
            }
            
            // Use shared containment detection
            const containedIds = findContainedItems(items);
            
            // Build map of named places with coordinates and radius
            const namedPlaces = [];
            for (const item of items) {
                if (item.isVisit && item.placeId && item.center) {
                    const radius = item.place?.radiusMeters || 50; // Default 50m if not specified
                    namedPlaces.push({
                        placeId: item.placeId,
                        lat: item.center.latitude,
                        lng: item.center.longitude,
                        radius: radius,
                        name: item.place?.name || ''
                    });
                }
            }
            
            // Helper: Get effective placeId for an item (by placeId or coordinate proximity)
            function getEffectivePlaceId(item) {
                // If item has placeId, use it
                if (item.placeId) return item.placeId;
                
                // For visits without placeId, check if within radius of a named place
                if (item.isVisit && item.center) {
                    const itemLat = item.center.latitude;
                    const itemLng = item.center.longitude;
                    
                    for (const place of namedPlaces) {
                        const dist = calculateDistanceMeters(itemLat, itemLng, place.lat, place.lng);
                        if (dist <= place.radius) {
                            return place.placeId; // Item is within this place's radius
                        }
                    }
                }
                
                return null;
            }
            
            // Helper: Check if item has GPS data
            function hasGpsData(item) {
                if (item.samples && item.samples.length > 0) return true;
                if (item.center && item.center.latitude && item.center.longitude) return true;
                // Arc may have distance/duration metadata even without raw samples
                // This proves the item has location data from Arc's processing
                if (item.distance && item.distance > 0) return true;
                return false;
            }
            
            // Helper: Get item duration in milliseconds
            function getDurationMs(item) {
                if (!item.startDate || !item.endDate) return 0;
                return new Date(item.endDate).getTime() - new Date(item.startDate).getTime();
            }

            // Helper: Is this item a GPS drift noise candidate?
            // Visits: unnamed, no placeId/customTitle/streetAddress/place name
            // Trips: ≤120s duration AND ≤50m distance (activityType unreliable
            //        because inferActivityTypeFromSamples maps drift to 'walking')
            function isDriftNoiseCandidate(item) {
                if (item.isVisit) {
                    return !item.placeId && !item.customTitle && !item.streetAddress
                        && !(item.place?.name);
                }
                const durSec = getDurationMs(item) / 1000;
                const dist = Array.isArray(item.samples) && item.samples.length > 1
                    ? calculatePathDistance(item.samples) : 0;
                return durSec <= 120 && dist <= 50;
            }

            // Sort items chronologically before processing
            const sortedItems = [...items].sort((a, b) => {
                const aStart = a.startDate ? new Date(a.startDate).getTime() : 0;
                const bStart = b.startDate ? new Date(b.startDate).getTime() : 0;
                return aStart - bStart;
            });

            // Pre-pass: detect GPS drift noise clusters.
            // A cluster = 3+ consecutive drift-noise candidates with gaps ≤30s.
            // Keep the first item of each cluster; mark the rest for skipping.
            const driftNoiseIds = new Set();
            let clusterStart = 0;
            while (clusterStart < sortedItems.length) {
                if (!isDriftNoiseCandidate(sortedItems[clusterStart])) {
                    clusterStart++;
                    continue;
                }
                // Grow cluster while consecutive items are noise candidates with small gaps
                let clusterEnd = clusterStart;
                for (let j = clusterStart + 1; j < sortedItems.length; j++) {
                    if (!isDriftNoiseCandidate(sortedItems[j])) break;
                    const prevEnd = sortedItems[j - 1].endDate
                        ? new Date(sortedItems[j - 1].endDate).getTime() : 0;
                    const currStart = sortedItems[j].startDate
                        ? new Date(sortedItems[j].startDate).getTime() : 0;
                    const gapMs = currStart - prevEnd;
                    if (gapMs > 30000) break; // >30s gap breaks the cluster
                    clusterEnd = j;
                }
                const clusterSize = clusterEnd - clusterStart + 1;
                if (clusterSize >= 3) {
                    // Mark all but first for skipping
                    sortedItems[clusterStart]._driftClusterSize = clusterSize;
                    for (let k = clusterStart + 1; k <= clusterEnd; k++) {
                        const id = sortedItems[k].itemId || sortedItems[k].startDate;
                        driftNoiseIds.add(id);
                    }
                }
                clusterStart = clusterEnd + 1;
            }

            // Process items - skip contained, apply display annotations
            const result = [];
            
            for (let i = 0; i < sortedItems.length; i++) {
                const item = { ...sortedItems[i] }; // Shallow copy for annotations
                const itemId = item.itemId || item.startDate;
                
                // Mark data gaps
                if (!hasGpsData(item)) {
                    item._dataGap = true;
                }
                
                // Skip contained items (using shared detection)
                if (containedIds.has(itemId)) {
                    item._contained = true;
                    continue;
                }

                // Skip GPS drift noise cluster members (keep first item only)
                if (driftNoiseIds.has(itemId)) {
                    continue;
                }
                
                // Rule: Suppress zero-duration visits without customTitle
                // (but allow visits with > 0 seconds duration)
                if (item.isVisit && !item.customTitle && getDurationMs(item) === 0) {
                    // Check if it's noise between same-place visits
                    const prev = result.length > 0 ? result[result.length - 1] : null;
                    const next = sortedItems[i + 1] || null;
                    
                    if (prev && next) {
                        const prevEffective = prev.isVisit ? getEffectivePlaceId(prev) : null;
                        const nextEffective = next.isVisit ? getEffectivePlaceId(next) : null;
                        const currEffective = getEffectivePlaceId(item);
                        
                        // Suppress if sandwiched between same place visits and is different place
                        if (prevEffective && prevEffective === nextEffective && currEffective !== prevEffective) {
                            item._suppressed = true;
                            if (!prev._suppressedVisits) prev._suppressedVisits = [];
                            prev._suppressedVisits.push(item);
                            continue;
                        }
                    }
                }

                // Rule: Suppress low-signal activity sandwiched between same-place visits.
                // This specifically handles escaped drift fragments after Arc visit edits
                // while preserving legitimate splits between different places.
                if (!item.isVisit && result.length > 0) {
                    const prev = result[result.length - 1];
                    const next = sortedItems[i + 1] || null;

                    if (prev?.isVisit && next?.isVisit) {
                        const prevEffective = getEffectivePlaceId(prev);
                        const nextEffective = getEffectivePlaceId(next);

                        if (prevEffective && nextEffective && prevEffective === nextEffective) {
                            const durationMs = getDurationMs(item);
                            const durationSec = durationMs > 0 ? durationMs / 1000 : 0;
                            const act = (item.activityType || 'unknown').toLowerCase();
                            const distanceM = Array.isArray(item.samples) && item.samples.length > 1
                                ? calculatePathDistance(item.samples)
                                : 0;
                            const speedKmh = durationSec > 0 ? (distanceM / durationSec) * 3.6 : 0;
                            const hasUserNote = !!(
                                (typeof item.notes === 'string' && item.notes.trim()) ||
                                (Array.isArray(item.notes) && item.notes.some(n => (n?.body || '').trim()))
                            );
                            const isLowSignal =
                                (act === 'stationary' || act === 'unknown') ||
                                // Keep legitimate short out-and-back walks (e.g. to a bin);
                                // only suppress tiny walking jitter.
                                (act === 'walking' && durationSec <= 2 * 60 && distanceM <= 35 && speedKmh <= 4);
                            const isShort = durationSec > 0 && durationSec <= 15 * 60;

                            if (!hasUserNote && isShort && isLowSignal) {
                                item._suppressed = true;
                                if (!prev._collapsedUnknowns) prev._collapsedUnknowns = [];
                                prev._collapsedUnknowns.push(item);
                                continue;
                            }
                        }
                    }
                }
                
                // Rule: Merge adjacent visits within same effective place
                const currentEffectivePlace = item.isVisit ? getEffectivePlaceId(item) : null;
                
                if (item.isVisit && currentEffectivePlace && result.length > 0) {
                    const prev = result[result.length - 1];
                    const prevEffectivePlace = prev.isVisit ? getEffectivePlaceId(prev) : null;
                    
                    if (prevEffectivePlace === currentEffectivePlace) {
                        // Check gap between prev.endDate and current.startDate
                        const gap = getGapMs(prev, item);
                        
                        if (gap >= 0 && gap <= COALESCE_SETTINGS.maxMergeGapMs) {
                            // Merge: extend previous item's endDate, keep original items
                            if (!prev._mergedItems) {
                                prev._mergedItems = [{ ...prev }]; // Store original
                            }
                            prev._mergedItems.push(item);
                            prev._hasCollapsedSegments = true;
                            
                            // Extend the display endDate
                            if (item.endDate && (!prev._displayEndDate || item.endDate > (prev._displayEndDate || prev.endDate))) {
                                prev._displayEndDate = item.endDate;
                            }
                            
                            // Merge notes arrays
                            if (item.notes) {
                                if (!prev.notes) prev.notes = [];
                                if (Array.isArray(item.notes)) {
                                    prev.notes = [...(Array.isArray(prev.notes) ? prev.notes : [prev.notes].filter(Boolean)), ...item.notes];
                                } else if (typeof item.notes === 'string' && item.notes.trim()) {
                                    if (Array.isArray(prev.notes)) {
                                        prev.notes.push({ body: item.notes, date: item.startDate });
                                    } else {
                                        prev.notes = [prev.notes, { body: item.notes, date: item.startDate }].filter(Boolean);
                                    }
                                }
                            }
                            
                            continue;
                        }
                    }
                }
                
                // No coalescing applied - add item
                result.push(item);
            }
            
            return result;
        }
        
        // calculateDistanceMeters — defined in module header

        function getItemDurationMs(item) {
            if (!item.startDate || !item.endDate) return 0;
            const start = new Date(item.startDate).getTime();
            const end = new Date(item.endDate).getTime();
            return end - start;
        }
        
        function getGapMs(item1, item2) {
            if (!item1.endDate || !item2.startDate) return -1;
            const end1 = new Date(item1.endDate).getTime();
            const start2 = new Date(item2.startDate).getTime();
            return start2 - end1;
        }
        
        function extractNotesFromData(data, dayKey, sourceFile = 'json-import') {
            const notes = [];
            
            if (!data.timelineItems) return notes;
            
            // Apply display-only coalescing ONLY for iCloud backup imports
            // JSON exports already produce correct diary output without coalescing
            const shouldCoalesce = sourceFile === 'backup-import';
            const displayItems = shouldCoalesce 
                ? coalesceTimelineForDisplay(data.timelineItems)
                : data.timelineItems;

            // Precompute visit windows for containment checks (start/end in ms)
            const visitWindows = displayItems
                .filter(i => i.isVisit && i.startDate && (i._displayEndDate || i.endDate))
                .map(i => ({
                    start: new Date(i.startDate).getTime(),
                    end: new Date(i._displayEndDate || i.endDate).getTime()
                }))
                .filter(v => !isNaN(v.start) && !isNaN(v.end) && v.end >= v.start);
            
            // 🎯 Option B: Group nearby unnamed locations intelligently
            // First pass: Build location clusters (use original items for accurate clustering)
            const locationClusters = buildLocationClusters(data.timelineItems);
            
            for (const item of displayItems) {
                // Process ALL timeline items to show complete activity timeline
                // This includes visits (stationary) and routes (movements)
                const hasNotes = item.notes && (
                    (typeof item.notes === 'string' && item.notes.trim() !== '') ||
                    (Array.isArray(item.notes) && item.notes.length > 0)
                );

                let notesToProcess = [];
                
                if (hasNotes) {
                    if (typeof item.notes === 'string') {
                        notesToProcess.push({
                            body: item.notes,
                            date: item.startDate || item.endDate
                        });
                    } else if (Array.isArray(item.notes)) {
                        notesToProcess = item.notes;
                    }
                } else {
                    // Create entry for timeline item even without notes
                    // This shows all activities (visits and routes) in the timeline
                    notesToProcess.push({
                        body: '', // Empty body
                        date: item.startDate || item.endDate
                    });
                }
                
                // Calculate distance and duration ONCE per timeline item (not per note)
                let duration = null;
                
                // Check if this is a midnight-spanning visit
                // IMPORTANT: Arc stores dates in UTC - must convert to local for day comparison
                const itemStartDay = getLocalDayKey(item.startDate);
                // Use _displayEndDate for merged items (coalesced visits)
                const effectiveEndDate = item._displayEndDate || item.endDate;
                const itemEndDay = getLocalDayKey(effectiveEndDate);
                const spansFromPreviousDay = itemStartDay && dayKey && itemStartDay < dayKey && itemEndDay >= dayKey;
                const spansIntoNextDay = itemEndDay && dayKey && itemEndDay > dayKey && itemStartDay <= dayKey;
                
                if (item.startDate && effectiveEndDate) {
                    let start = new Date(item.startDate);
                    let end = new Date(effectiveEndDate);
                    
                    // For spanning visits, clamp duration to this day's portion
                    if (item.isVisit && (spansFromPreviousDay || spansIntoNextDay)) {
                        const dayStart = new Date(dayKey + 'T00:00:00');
                        const dayEnd = new Date(dayKey + 'T23:59:59');
                        
                        if (start < dayStart) start = dayStart;
                        if (end > dayEnd) end = dayEnd;
                    }
                    
                    const durationMs = end - start;
                    duration = durationMs / 1000;
                }
                
                let distance = null;
                let elevationGain = null;
                if (!item.isVisit && item.samples) {
                    // Calculate distance from GPS samples
                    distance = calculatePathDistance(item.samples);
                    
                    // Calculate elevation gain (sum of positive altitude changes)
                    elevationGain = calculateElevationGain(item.samples);
                }
                
                // Only assign distance to the FIRST note to avoid double-counting in stats
                let isFirstNote = true;
                
                for (const note of notesToProcess) {
                    // Allow empty bodies (so we see all activities)
                    // But skip completely empty/invalid dates
                    if (!note.date) continue;
                    
                    // 🎯 Multi-day visit handling: Only show note on the day it belongs to
                    // For items with notes, the note has its own date - only show on that day
                    // For items without notes (empty entries), use startDate to determine which day
                    // Exception: spanning visits should appear on both days
                    if (dayKey) {
                        const noteDate = new Date(note.date);
                        // Get date in local timezone (Arc uses local time)
                        const noteDayKey = noteDate.getFullYear() + '-' + 
                            String(noteDate.getMonth() + 1).padStart(2, '0') + '-' +
                            String(noteDate.getDate()).padStart(2, '0');
                        
                        // Skip notes that don't belong to this day
                        // UNLESS this is a spanning visit with no actual note (empty body)
                        if (noteDayKey !== dayKey) {
                            // Allow through if this is a spanning visit showing continuation
                            if (!(spansFromPreviousDay && item.isVisit && note.body === '')) {
                                continue;
                            }
                        }
                    }
                    
                    // 🎯 Intelligent location naming
                    let locationName = getSmartLocationName(item, locationClusters);
                    // Align with Arc Editor labeling for unknown no-GPS activity spans.
                    if (!item.isVisit) {
                        const act = (item.activityType || '').toLowerCase();
                        const hasNoGpsSamples = !Array.isArray(item.samples) || item.samples.length === 0;
                        if ((act === 'unknown' || act === '') && hasNoGpsSamples) {
                            locationName = 'Data Gap';
                        }
                    }
                    
                    // Get latitude/longitude/altitude for clicking
                    let lat = item.center?.latitude;
                    let lng = item.center?.longitude;
                    let altitude = item.center?.altitude;

                    // For visits, fall back to place center when item center is missing
                    if ((lat == null || lng == null) && item.place?.center) {
                        lat = item.place.center.latitude;
                        lng = item.place.center.longitude;
                        altitude = item.place.center.altitude ?? altitude;
                    }

                    // For routes without a center point, find the first sample with valid location
                    if ((lat == null || lng == null) && item.samples && item.samples.length > 0) {
                        // Find first sample with valid location data (don't assume samples[0] is valid)
                        const validSample = item.samples.find(s =>
                            (s.location && s.location.latitude != null && s.location.longitude != null) ||
                            (s.latitude != null && s.longitude != null)
                        );
                        if (validSample) {
                            lat = validSample.location?.latitude ?? validSample.latitude;
                            lng = validSample.location?.longitude ?? validSample.longitude;
                            altitude = validSample.location?.altitude ?? validSample.altitude;
                        }
                    }

                    // Even if we have center lat/lng, try to get altitude from samples if not in center
                    if ((altitude === null || altitude === undefined) && item.samples && item.samples.length > 0) {
                        const sampleWithAlt = item.samples.find(s =>
                            s.location?.altitude != null || s.altitude != null
                        );
                        if (sampleWithAlt) {
                            altitude = sampleWithAlt.location?.altitude ?? sampleWithAlt.altitude;
                        }
                    }
                    
                    // Determine the display date for this entry
                    // For spanning visits from previous day, show midnight of current day
                    let displayDate = note.date;
                    if (spansFromPreviousDay && item.isVisit && note.body === '') {
                        displayDate = dayKey + 'T00:00:00';
                    }

                    // Suppress low-signal activities fully contained within a visit window
                    if (!item.isVisit && item.startDate && item.endDate) {
                        const activityType = (item.activityType || '').toLowerCase();
                        const isUnknown = activityType === 'unknown';
                        const isNoGps = !item.samples || item.samples.length === 0;
                        const durationSec = duration || 0;
                        const distanceM = distance || 0;
                        const isTiny = durationSec > 0 && durationSec <= 60;
                        const hasNoNote = !note.body || note.body.trim() === '';
                        const hasNoDistance = distanceM <= 0;

                        const isLowSignal = isUnknown || isNoGps || isTiny || hasNoDistance;

                        if (isLowSignal && hasNoNote) {
                            const activityStart = new Date(item.startDate).getTime();
                            const activityEnd = new Date(item.endDate).getTime();
                            if (visitWindows.some(v => activityStart >= v.start && activityEnd <= v.end)) {
                                continue;
                            }
                        }

                    }
                    
                    // Use effective end date for merged items
                    const noteEndDate = spansIntoNextDay ? dayKey + 'T23:59:59' : (item._displayEndDate || item.endDate);
                    
                    notes.push({
                        noteId: note.noteId,
                        date: displayDate,
                        body: note.body || '', // Ensure string
                        location: locationName,
                        isVisit: item.isVisit || false,
                        activityType: item.activityType || null,
                        latitude: lat,
                        longitude: lng,
                        altitude: altitude ?? null,  // Include altitude
                        duration: isFirstNote ? duration : null,  // Only first note gets duration
                        distance: isFirstNote ? distance : null,  // Only first note gets distance
                        elevationGain: isFirstNote ? elevationGain : null,  // Only first note gets elevation gain
                        radiusMeters: item.place?.radiusMeters || null,
                        startDate: spansFromPreviousDay ? dayKey + 'T00:00:00' : item.startDate,
                        endDate: noteEndDate,
                        timelineItemId: item.itemId || `${item.startDate}_${locationName}`,
                        // Coalescing indicators
                        _hasCollapsedSegments: item._hasCollapsedSegments || false,
                        _mergedCount: item._mergedItems?.length || 0,
                        _suppressedCount: (item._suppressedVisits?.length || 0) + (item._collapsedUnknowns?.length || 0),
                        _dataGap: item._dataGap || false,
                        _contained: item._contained || false
                    });
                    
                    isFirstNote = false;  // Subsequent notes don't get distance/duration
                }
            }
            
            return notes;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 1: Normalized Data Model (entries + notes tables)
        // ═══════════════════════════════════════════════════════════════════
        
        /**
         * Extract normalized entries and notes from raw Arc data
         * @param {Object} data - Raw Arc Timeline JSON for a day
         * @param {string} dayKey - The day being processed (YYYY-MM-DD)
         * @returns {{entries: Array, notes: Array}} - Normalized entries and notes
         */
        function extractEntriesAndNotesFromData(data, dayKey) {
            const entries = [];
            const notes = [];
            
            if (!data?.timelineItems) return { entries, notes };
            
            // Build location clusters for consistent naming
            const locationClusters = buildLocationClusters(data.timelineItems);
            
            for (const item of data.timelineItems) {
                // Generate stable entryId
                const entryId = item.itemId || `${item.startDate || ''}_${item.center?.latitude || 0}_${item.center?.longitude || 0}`;
                
                // Get location name
                const locationName = getSmartLocationName(item, locationClusters);
                
                // Get coordinates
                let lat = item.center?.latitude ?? null;
                let lng = item.center?.longitude ?? null;
                let altitude = item.center?.altitude ?? null;

                // For visits, fall back to place center when item center is missing
                if ((lat == null || lng == null) && item.place?.center) {
                    lat = item.place.center.latitude;
                    lng = item.place.center.longitude;
                    altitude = item.place.center.altitude ?? altitude;
                }
                
                // For routes without center, use first sample
                if ((lat == null || lng == null) && item.samples?.length > 0) {
                    const first = item.samples[0];
                    lat = first.location?.latitude ?? first.latitude ?? null;
                    lng = first.location?.longitude ?? first.longitude ?? null;
                    altitude = first.location?.altitude ?? first.altitude ?? null;
                }
                
                // Try to get altitude from samples if not in center
                if (altitude == null && item.samples?.length > 0) {
                    const first = item.samples[0];
                    altitude = first.location?.altitude ?? first.altitude ?? null;
                }
                
                // Calculate duration
                let duration = null;
                if (item.startDate && item.endDate) {
                    duration = (new Date(item.endDate) - new Date(item.startDate)) / 1000;
                }
                
                // Calculate distance and elevation for activities
                let distance = null;
                let elevationGain = null;
                if (!item.isVisit && item.samples) {
                    distance = calculatePathDistance(item.samples);
                    elevationGain = calculateElevationGain(item.samples);
                }
                
                // Determine if entry belongs to this day
                // For multi-day visits, we include the entry but filter notes by date
                // IMPORTANT: Arc stores dates in UTC - must convert to local for day comparison
                const entryStartDay = item.startDate ? 
                    getLocalDayKey(item.startDate) : dayKey;
                const entryEndDay = item.endDate ? 
                    getLocalDayKey(item.endDate) : dayKey;
                const spansThisDay = entryStartDay <= dayKey && entryEndDay >= dayKey;
                
                if (!spansThisDay) continue;
                
                // Extract notes for this item
                const itemNotes = extractItemNotes(item, entryId, dayKey);
                
                // For visits that span midnight, always include on each day they touch
                // For activities (trips), only include if starts on this day or has notes
                const hasNotesThisDay = itemNotes.length > 0;
                const startsThisDay = entryStartDay === dayKey;
                const endsThisDay = entryEndDay === dayKey;
                const isVisit = item.isVisit;
                
                // Visits always show on all days they span; activities only if starts here or has notes
                if (!isVisit && !hasNotesThisDay && !startsThisDay) continue;
                
                // Calculate effective start/end times for this day (midnight splitting)
                let effectiveStartDate = item.startDate;
                let effectiveEndDate = item.endDate;
                let effectiveDuration = duration;
                
                if (isVisit && (entryStartDay !== dayKey || entryEndDay !== dayKey)) {
                    // Visit spans multiple days - split at midnight
                    const dayStart = new Date(dayKey + 'T00:00:00');
                    const dayEnd = new Date(dayKey + 'T23:59:59');
                    
                    const actualStart = item.startDate ? new Date(item.startDate) : dayStart;
                    const actualEnd = item.endDate ? new Date(item.endDate) : dayEnd;
                    
                    // Clamp to this day's boundaries
                    const clampedStart = actualStart < dayStart ? dayStart : actualStart;
                    const clampedEnd = actualEnd > dayEnd ? dayEnd : actualEnd;
                    
                    effectiveStartDate = clampedStart.toISOString();
                    effectiveEndDate = clampedEnd.toISOString();
                    effectiveDuration = (clampedEnd - clampedStart) / 1000;
                }
                
                // Build entry object
                const entry = {
                    entryId: entryId,
                    dayKey: dayKey,
                    startDate: effectiveStartDate || null,
                    endDate: effectiveEndDate || null,
                    duration: effectiveDuration,
                    type: item.isVisit ? 'visit' : 'activity',
                    activityType: item.activityType || (item.isVisit ? 'stationary' : 'unknown'),
                    location: locationName,
                    lat: lat,
                    lng: lng,
                    altitude: altitude,
                    placeId: item.place?.id || null,
                    radiusMeters: item.place?.radiusMeters || null,
                    distance: distance,
                    elevationGain: elevationGain,
                    timelineItemId: item.itemId || entryId,
                    hasNote: itemNotes.length > 0
                };
                
                entries.push(entry);
                notes.push(...itemNotes);
            }
            
            // Sort entries by startDate (chronological)
            entries.sort((a, b) => {
                const aTime = a.startDate ? new Date(a.startDate).getTime() : 0;
                const bTime = b.startDate ? new Date(b.startDate).getTime() : 0;
                return aTime - bTime;
            });
            
            return { entries, notes };
        }
        
        /**
         * Extract notes from a single timeline item, filtered by dayKey
         * @param {Object} item - Timeline item from Arc data
         * @param {string} entryId - Parent entry ID (FK)
         * @param {string} dayKey - Only include notes from this day
         * @returns {Array} - Array of note objects
         */
        function extractItemNotes(item, entryId, dayKey) {
            const notes = [];
            
            if (!item.notes) return notes;
            
            // Normalize to array
            let rawNotes = [];
            if (typeof item.notes === 'string') {
                if (item.notes.trim()) {
                    rawNotes.push({
                        body: item.notes,
                        date: item.startDate || item.endDate,
                        noteId: `${entryId}_note_0`
                    });
                }
            } else if (Array.isArray(item.notes)) {
                rawNotes = item.notes.map((n, idx) => ({
                    body: n.body || '',
                    date: n.date || item.startDate || item.endDate,
                    noteId: n.noteId || `${entryId}_note_${idx}`
                }));
            }
            
            // Filter to notes belonging to this day
            for (const note of rawNotes) {
                if (!note.date || !note.body?.trim()) continue;
                
                const noteDate = new Date(note.date);
                const noteDayKey = noteDate.getFullYear() + '-' +
                    String(noteDate.getMonth() + 1).padStart(2, '0') + '-' +
                    String(noteDate.getDate()).padStart(2, '0');
                
                if (noteDayKey !== dayKey) continue;
                
                notes.push({
                    noteId: note.noteId,
                    entryId: entryId,
                    date: note.date,
                    body: note.body
                });
            }
            
            return notes;
        }
        
        /**
         * Get days from data model (not DOM)
         * @param {string} monthKey - Month to query (YYYY-MM)
         * @returns {Array<string>} - Sorted array of dayKeys
         */
        function getDaysFromModel(monthKey) {
            const diary = S.generatedDiaries[monthKey];
            if (!diary?.monthData?.days) return [];
            return Object.keys(diary.monthData.days).sort();
        }
        
        // 🎯 Build location clusters to intelligently name nearby visits
        function buildLocationClusters(timelineItems) {
            const clusters = [];
            const CLUSTER_RADIUS = 100; // meters - visits within 100m are considered same location
            
            // Get all visits with coordinates
            const visits = timelineItems.filter(item => 
                item.isVisit && item.center?.latitude && item.center?.longitude
            );
            
            // Debug: Log all visits and their place names
            logDebug(`📍 buildLocationClusters: Found ${visits.length} visits`);
            visits.forEach((v, i) => {
                logDebug(`  Visit ${i}: place.name="${v.place?.name || 'NONE'}", lat=${v.center.latitude.toFixed(4)}, lng=${v.center.longitude.toFixed(4)}`);
            });
            
            for (const visit of visits) {
                const lat = visit.center.latitude;
                const lng = visit.center.longitude;
                // Check for name: place.name, then customTitle, then streetAddress
                const name = visit.place?.name || visit.customTitle || visit.streetAddress || null;
                const hasName = !!name;
                
                // Find if this visit belongs to an existing cluster
                let foundCluster = null;
                for (const cluster of clusters) {
                    const distance = calculateDistance(
                        lat, lng,
                        cluster.centerLat, cluster.centerLng
                    );
                    
                    if (distance <= CLUSTER_RADIUS) {
                        foundCluster = cluster;
                        break;
                    }
                }
                
                if (foundCluster) {
                    // Add to existing cluster
                    foundCluster.visits.push(visit);
                    
                    // If this visit has a name and cluster doesn't, use it
                    if (hasName && !foundCluster.name) {
                        foundCluster.name = name;
                    }
                    
                    // Update cluster center (average of all visits)
                    const totalLat = foundCluster.visits.reduce((sum, v) => sum + v.center.latitude, 0);
                    const totalLng = foundCluster.visits.reduce((sum, v) => sum + v.center.longitude, 0);
                    foundCluster.centerLat = totalLat / foundCluster.visits.length;
                    foundCluster.centerLng = totalLng / foundCluster.visits.length;
                } else {
                    // Create new cluster
                    clusters.push({
                        centerLat: lat,
                        centerLng: lng,
                        name: hasName ? name : null,
                        visits: [visit]
                    });
                }
            }
            
            // Assign names to unnamed clusters
            let unnamedCount = 0;
            for (const cluster of clusters) {
                if (!cluster.name) {
                    unnamedCount++;
                    cluster.name = `Location ${String.fromCharCode(64 + unnamedCount)}`; // A, B, C, etc.
                    logDebug(`📍 Cluster unnamed -> assigned "${cluster.name}" at (${cluster.centerLat.toFixed(4)}, ${cluster.centerLng.toFixed(4)}) with ${cluster.visits.length} visits`);
                }
            }
            
            // Debug: Log final clusters
            logDebug(`📍 Final clusters: ${clusters.length}`);
            clusters.forEach((c, i) => {
                logDebug(`  Cluster ${i}: name="${c.name}", visits=${c.visits.length}`);
            });
            
            return clusters;
        }
        
        // 🎯 Get smart location name using clusters
        function getSmartLocationName(item, locationClusters) {
            if (item?.displayName) {
                return String(item.displayName).trim();
            }

            // Priority 1: PlaceId mapping from places folder (most authoritative, refreshed on each import)
            const mappedPid = item?.place?.placeId || item?.place?.id || item?.placeId || item?.placeUUID;
            if (mappedPid && S.placesById) {
                const pid = String(mappedPid);
                const mappedName =
                    S.placesById[pid] ||
                    S.placesById[pid.toUpperCase()] ||
                    S.placesById[pid.toLowerCase()];
                if (mappedName) return mappedName.trim();
            }

            // Priority 2: Place name from embedded place object
            if (item.place?.name) {
                logDebug(`📍 getSmartLocationName: Using place.name = "${item.place.name}"`);
                return item.place.name.trim();
            }

            // Priority 3: Custom title (only used if no place mapping exists)
            // Note: customTitle may have stale data from old imports, so place mappings take precedence
            if (item.customTitle) {
                logDebug(`📍 getSmartLocationName: Using customTitle = "${item.customTitle}"`);
                return item.customTitle.trim();
            }

            // Priority 4: Street address (for visits without place name)
            if (item.isVisit && item.streetAddress) {
                logDebug(`📍 getSmartLocationName: Using streetAddress = "${item.streetAddress}"`);
                return item.streetAddress.trim();
            }
            
            // Debug: Log when no name source found for visits
            if (item.isVisit) {
                logDebug(`📍 getSmartLocationName: Visit missing name sources`, {
                    hasPlace: !!item.place,
                    placeKeys: item.place ? Object.keys(item.place) : [],
                    placeId: item.placeId || item.place?.placeId || item.place?.id || null,
                    streetAddress: item.streetAddress,
                    center: item.center
                });
            }

            // Priority 5: Find cluster for visits without explicit names
            if (item.isVisit && item.center?.latitude && item.center?.longitude) {
                for (const cluster of locationClusters) {
                    // Check if this visit is in this cluster
                    if (cluster.visits.includes(item)) {
                        return cluster.name;
                    }
                }
            }

            // Priority 6: Activity type (for non-visits)
            if (!item.isVisit && item.activityType) {
                return item.activityType.charAt(0).toUpperCase() + item.activityType.slice(1);
            }

            // Priority 7: Last-resort label for unnamed visits
            if (item.isVisit) {
                return 'Unnamed Location';
            }
            
            // Fallback
            return 'Unknown Location';
        }
                
        function extractPinsFromData(data) {
            const pins = [];
            if (!data || !data.timelineItems) return pins;

            // 🎯 Build location clusters for consistent naming
            const locationClusters = buildLocationClusters(data.timelineItems);

            for (const item of data.timelineItems) {
                // Must be a visit. 
                // Removed "!item.place" check because one-time locations might not have a place object.
                if (!item.isVisit) continue;

                let hasNote = false;
                if (item.notes) {
                    if (typeof item.notes === 'string') {
                        hasNote = item.notes.trim() !== '';
                    } else if (Array.isArray(item.notes)) {
                        hasNote = item.notes.some(n => (n?.body || '').trim() !== '');
                    }
                }

                // 🎯 Use smart location naming
                const locationName = getSmartLocationName(item, locationClusters);

                let lat = item.center?.latitude;
                let lng = item.center?.longitude;
                let altitude = item.center?.altitude; // Try center first

                // For visits, fall back to place center when item center is missing
                if ((lat == null || lng == null) && item.place?.center) {
                    lat = item.place.center.latitude;
                    lng = item.place.center.longitude;
                    altitude = item.place.center.altitude ?? altitude;
                }
                
                // If no altitude in center, try to get from samples (first sample)
                if ((altitude === null || altitude === undefined) && item.samples && item.samples.length > 0) {
                    const firstSample = item.samples[0];
                    altitude = firstSample?.location?.altitude || firstSample?.altitude;
                }
                
                // If no coordinates, we can't map it anyway
                if (!lat || !lng) continue;

                pins.push({
                    location: locationName,
                    lat: lat,
                    lng: lng,
                    altitude: altitude ?? null, // Store altitude (can be null)
                    hasNote: hasNote,
                    isVisit: true,
                    startDate: item.startDate || null,
                    endDate: item.endDate || null,
                    timelineItemId: item.itemId || `${item.startDate || ''}_${locationName}_${lat}_${lng}`
                });
            }

            return pins;
        }

        function extractTracksFromData(data) {
            const tracks = [];
            if (!data || !data.timelineItems) return tracks;

            for (const item of data.timelineItems) {
                if (item.isVisit) continue;
                if (!Array.isArray(item.samples) || item.samples.length < 2) {
                    if (item.activityType === 'walking') {
                        logDebug(`🚶 Walking skipped: samples=${item.samples?.length || 0}, startDate=${item.startDate}`);
                    }
                    continue;
                }

                const pts = [];
                for (const s of item.samples) {
                    const lat = s?.location?.latitude ?? s?.latitude;
                    const lng = s?.location?.longitude ?? s?.longitude;
                    const alt = s?.location?.altitude ?? s?.altitude;
                    const ts = s?.location?.timestamp || s?.timestamp || s?.date;
                    if (!lat || !lng) continue;
                    pts.push({
                        lat,
                        lng,
                        alt: alt ?? null,
                        t: ts ?? null,
                        timelineItemId: item.itemId || null
                    });
                }

                if (pts.length < 2) {
                    if (item.activityType === 'walking') {
                        logDebug(`🚶 Walking skipped after filtering: valid_pts=${pts.length}, samples=${item.samples.length}, startDate=${item.startDate}`);
                    }
                    continue;
                }

                logDebug(`🚶 Track extracted: ${item.activityType}, ${pts.length} points, startDate=${item.startDate}`);
                
                tracks.push({
                    timelineItemId: item.itemId || null,
                    activityType: item.activityType || 'activity',
                    startDate: item.startDate || null,
                    endDate: item.endDate || null,
                    points: pts
                });
            }

            return tracks;
        }

		  function calculateMonthlyActivityStats(monthData) {
            // Calculate cumulative statistics for each activity type in the month
            const stats = {};
            
            const notesOnly = document.getElementById('notesOnly')?.checked ?? false;
            const includeAll = !notesOnly;
            
            // Track ALL activities to detect midnight-spanning duplicates (not just airplanes!)
            const seenActivities = new Map(); // key: "activityType-startTime-duration-distance", value: true
            
            const days = Object.keys(monthData.days).sort(); // Sort to process in chronological order
            for (const day of days) {
                const dayData = monthData.days[day];
                
                // Get filtered notes (same filtering as diary display)
                const visibleNotes = getFilteredNotesForDay(dayData, includeAll, includeAll);
                
                for (const note of visibleNotes) {
                    // Only process activities (non-visits)
                    if (note.isVisit) continue;
                    if (!note.activityType) continue;
                    
                    const activityType = getActivityFilterType(note.activityType);
                    
                    // Skip Stationary and Unknown
                    if (activityType === 'stationary' || activityType === 'unknown') continue;
                    
                    // Check if this is a duplicate of a midnight-spanning activity (any type!)
                    if (note.startDate && note.duration && note.distance) {
                        // Create a unique key based on activity type, start time, duration, and distance
                        // Round to avoid floating point precision issues
                        const startTime = new Date(note.startDate).getTime();
                        const duration = Math.round(note.duration);
                        const distance = Math.round(note.distance);
                        const activityKey = `${activityType}-${startTime}-${duration}-${distance}`;
                        
                        // Check if we've already seen this exact activity
                        if (seenActivities.has(activityKey)) {
                            // This is a duplicate - skip it
                            logDebug(`Skipping duplicate midnight-spanning activity: ${note.activityType} at ${note.startDate} (${distance}m, ${duration}s)`);
                            continue;
                        }
                        
                        // Record this activity so we can detect duplicates later
                        seenActivities.set(activityKey, true);
                    }
                    
                    // Initialize stats for this activity type if not exists
                    if (!stats[activityType]) {
                        stats[activityType] = {
                            distance: 0,      // in meters
                            duration: 0,      // in seconds
                            count: 0,         // number of activities
                            activityName: note.activityType
                        };
                    }
                    
                    // Add to totals
                    if (note.distance) stats[activityType].distance += note.distance;
                    if (note.duration) stats[activityType].duration += note.duration;
                    stats[activityType].count += 1;
                }
            }
            
            // Remove activities with zero distance
            const filteredStats = {};
            for (const activityType in stats) {
                if (stats[activityType].distance > 0) {
                    filteredStats[activityType] = stats[activityType];
                }
            }
            
            return filteredStats;
        }
        
        function getFilteredNotesForDay(dayData, includeAllLocations, includeAllActivities) {
            // Apply the same filtering logic as generateMarkdown
            let visibleNotes = dayData.notes.filter(note => {
                if (note.isVisit) {
                    // Location/visit filtering
                    if (includeAllLocations) return true;
                    return (note.body && note.body.trim().length > 0);
                } else {
                    // Activity/route filtering
                    if (!includeAllActivities) {
                        return (note.body && note.body.trim().length > 0);
                    }
                    return true;
                }
            });
            
            // Filter out activities inside location GPS radius
            const locationVisits = visibleNotes.filter(n => n.isVisit && n.radiusMeters && n.latitude && n.longitude);
            const MAX_VISIT_FILTER_RADIUS_M = 150; // Prevent oversized place radii from swallowing real trips
            
            if (locationVisits.length > 0) {
                visibleNotes = visibleNotes.filter(note => {
                    if (note.isVisit) return true;
                    if (!note.latitude || !note.longitude) return true;

                    // Never suppress motorized/long-distance trips by visit radius.
                    const activityType = getActivityFilterType(note.activityType || '');
                    if (['car', 'bus', 'train', 'motorcycle', 'boat', 'airplane'].includes(activityType)) {
                        return true;
                    }
                    
                    for (const visit of locationVisits) {
                        const distance = calculateDistance(
                            note.latitude, note.longitude,
                            visit.latitude, visit.longitude
                        );
                        const effectiveRadius = Math.min(Math.max(Number(visit.radiusMeters) || 50, 1), MAX_VISIT_FILTER_RADIUS_M);

                        // If activity distance is materially larger than radius, keep it.
                        if ((note.distance || 0) > effectiveRadius * 2) {
                            continue;
                        }
                        
                        if (distance <= effectiveRadius) {
                            return false;
                        }
                    }
                    
                    return true;
                });
            }
            
            return visibleNotes;
        }
        
        function calculateDailyActivityStats(notes) {
            // Calculate statistics for activities in a single day
            const stats = {};
            
            for (const note of notes) {
                // Only process activities (non-visits)
                if (note.isVisit) continue;
                if (!note.activityType) continue;
                
                const activityType = getActivityFilterType(note.activityType);
                
                // Skip Stationary and Unknown
                if (activityType === 'stationary' || activityType === 'unknown') continue;
                
                // Initialize stats for this activity type if not exists
                if (!stats[activityType]) {
                    stats[activityType] = {
                        distance: 0,
                        duration: 0,
                        elevationGain: 0,
                        count: 0
                    };
                }
                
                // Add to totals
                if (note.distance) stats[activityType].distance += note.distance;
                if (note.duration) stats[activityType].duration += note.duration;
                if (note.elevationGain) stats[activityType].elevationGain += note.elevationGain;
                stats[activityType].count += 1;
            }
            
            // Remove activities with zero distance
            const filteredStats = {};
            for (const activityType in stats) {
                if (stats[activityType].distance > 0) {
                    filteredStats[activityType] = stats[activityType];
                }
            }
            
            return filteredStats;
        }

    // ========================================
    // Module Export
    // ========================================

    window.ArcData = {
        // Activity classification
        getActivityFilterType,

        // Timeline coalescing
        coalesceTimelineForDisplay,

        // Data extraction
        extractNotesFromData,
        extractEntriesAndNotesFromData,
        extractItemNotes,
        extractPinsFromData,
        extractTracksFromData,

        // Location helpers
        getDaysFromModel,
        buildLocationClusters,
        getSmartLocationName,

        // Filtering & stats
        getFilteredNotesForDay,
        calculateDailyActivityStats,
        calculateMonthlyActivityStats,

        // Utility
        getItemDurationMs,
        getGapMs,
    };

    logInfo(`📦 Loaded arc-data.js`);

})();
