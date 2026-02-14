/**
 * Arc Timeline Diary Reader — Events System
 *
 * Multi-day event CRUD, categories (localStorage persistence),
 * event slider UI, bound selection, and category manager.
 *
 * Depends on: arc-state.js (logging only)
 */
(() => {
    'use strict';

    // UI callbacks — set by app.js after load
    const _ui = {
        renderMonth: null,
        closeSearchResults: null,
        updateMapPaddingForSlider: null,
    };

        // ========================================
        // Events Management (Multi-day date ranges)
        // ========================================

        const EVENTS_STORAGE_KEY = 'arcDiaryEvents';
        const CATEGORIES_STORAGE_KEY = 'arcDiaryEventCategories';
        let events = [];
        let eventCategories = [];

        // Default categories
        const DEFAULT_CATEGORIES = [
            { id: 'vacation', name: 'Vacation', color: '#4CAF50' },
            { id: 'conference', name: 'Conference', color: '#2196F3' },
            { id: 'trip', name: 'Trip', color: '#FF9800' },
            { id: 'business', name: 'Business', color: '#607D8B' },
            { id: 'family', name: 'Family', color: '#E91E63' },
            { id: 'other', name: 'Other', color: '#9C27B0' }
        ];

        // Event creation state
        let eventCreationState = {
            active: false,
            editingEventId: null,  // null for new event, ID for editing
            startDate: null,
            startTime: null,
            startItemId: null,
            endDate: null,
            endTime: null,
            endItemId: null
        };

        /**
         * Load events from localStorage
         */
        function loadEvents() {
            try {
                const stored = localStorage.getItem(EVENTS_STORAGE_KEY);
                events = stored ? JSON.parse(stored) : [];
                logDebug(`📅 Loaded ${events.length} events`);
            } catch (error) {
                logError('Error loading events:', error);
                events = [];
            }
        }

        /**
         * Save events to localStorage
         */
        function saveEvents() {
            try {
                localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
                logDebug(`📅 Saved ${events.length} events`);
            } catch (error) {
                logError('Error saving events:', error);
            }
        }

        /**
         * Load event categories from localStorage
         */
        function loadEventCategories() {
            try {
                const stored = localStorage.getItem(CATEGORIES_STORAGE_KEY);
                eventCategories = stored ? JSON.parse(stored) : [...DEFAULT_CATEGORIES];
                logDebug(`📅 Loaded ${eventCategories.length} event categories`);
            } catch (error) {
                logError('Error loading event categories:', error);
                eventCategories = [...DEFAULT_CATEGORIES];
            }
        }

        /**
         * Save event categories to localStorage
         */
        function saveEventCategories() {
            try {
                localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(eventCategories));
                logDebug(`📅 Saved ${eventCategories.length} event categories`);
            } catch (error) {
                logError('Error saving event categories:', error);
            }
        }

        /**
         * Generate unique event ID
         */
        function generateEventId() {
            return 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }

        /**
         * Create a new event
         * @param {Object} eventData - Event data
         * @returns {Object} The created event
         */
        function createEvent(eventData) {
            const event = {
                eventId: generateEventId(),
                name: eventData.name || 'Untitled Event',
                startDate: eventData.startDate,
                startTime: eventData.startTime || null,
                startItemId: eventData.startItemId || null,
                endDate: eventData.endDate,
                endTime: eventData.endTime || null,
                endItemId: eventData.endItemId || null,
                description: eventData.description || '',
                category: eventData.category || 'other',
                color: eventData.color || '#9C27B0',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            events.push(event);
            saveEvents();
            logInfo(`📅 Created event: ${event.name} (${event.startDate} to ${event.endDate})`);
            return event;
        }

        /**
         * Update an existing event
         * @param {string} eventId - Event ID to update
         * @param {Object} updates - Fields to update
         * @returns {Object|null} Updated event or null if not found
         */
        function updateEvent(eventId, updates) {
            const index = events.findIndex(e => e.eventId === eventId);
            if (index === -1) {
                logError(`Event not found: ${eventId}`);
                return null;
            }

            events[index] = {
                ...events[index],
                ...updates,
                updatedAt: new Date().toISOString()
            };

            saveEvents();
            logInfo(`📅 Updated event: ${events[index].name}`);
            return events[index];
        }

        /**
         * Delete an event
         * @param {string} eventId - Event ID to delete
         * @returns {boolean} True if deleted
         */
        function deleteEvent(eventId) {
            const index = events.findIndex(e => e.eventId === eventId);
            if (index === -1) {
                return false;
            }

            const deletedEvent = events.splice(index, 1)[0];
            saveEvents();
            logInfo(`📅 Deleted event: ${deletedEvent.name}`);
            return true;
        }

        /**
         * Get event by ID
         * @param {string} eventId - Event ID
         * @returns {Object|null} Event or null
         */
        function getEventById(eventId) {
            return events.find(e => e.eventId === eventId) || null;
        }

        /**
         * Get all events sorted by start date (newest first)
         * @returns {Array} Sorted events
         */
        function getAllEvents() {
            return [...events].sort((a, b) => b.startDate.localeCompare(a.startDate));
        }

        /**
         * Check if a day falls within any event's date range
         * @param {string} dayKey - Day key (YYYY-MM-DD)
         * @returns {Array} Events that contain this day
         */
        function getEventsForDay(dayKey) {
            return events.filter(event => {
                return dayKey >= event.startDate && dayKey <= event.endDate;
            });
        }

        /**
         * Check if a specific datetime falls within an event (considering time bounds)
         * @param {string} dayKey - Day key (YYYY-MM-DD)
         * @param {string} time - Time (HH:MM)
         * @returns {Array} Events that contain this datetime
         */
        function getEventsForDateTime(dayKey, time) {
            return events.filter(event => {
                // Check date bounds first
                if (dayKey < event.startDate || dayKey > event.endDate) {
                    return false;
                }

                // If on start day, check start time
                if (dayKey === event.startDate && event.startTime && time) {
                    if (time < event.startTime) {
                        return false;
                    }
                }

                // If on end day, check end time
                if (dayKey === event.endDate && event.endTime && time) {
                    if (time > event.endTime) {
                        return false;
                    }
                }

                return true;
            });
        }

        /**
         * Get events within a date range (for Analysis)
         * @param {string} startDate - Start date (YYYY-MM-DD)
         * @param {string} endDate - End date (YYYY-MM-DD)
         * @returns {Array} Events that overlap with the range
         */
        function getEventsInRange(startDate, endDate) {
            return events.filter(event => {
                // Event overlaps if it starts before range ends AND ends after range starts
                return event.startDate <= endDate && event.endDate >= startDate;
            });
        }

        /**
         * Add a new category
         * @param {string} name - Category name
         * @param {string} color - Category color (hex)
         * @returns {Object} The created category
         */
        function addEventCategory(name, color = '#9C27B0') {
            const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');

            // Check for duplicate
            if (eventCategories.some(c => c.id === id)) {
                logError(`Category already exists: ${name}`);
                return null;
            }

            const category = { id, name, color };
            eventCategories.push(category);
            saveEventCategories();
            logInfo(`📅 Added category: ${name}`);
            return category;
        }

        /**
         * Update a category
         * @param {string} categoryId - Category ID
         * @param {Object} updates - Fields to update (name, color)
         * @returns {Object|null} Updated category or null
         */
        function updateEventCategory(categoryId, updates) {
            const index = eventCategories.findIndex(c => c.id === categoryId);
            if (index === -1) {
                return null;
            }

            eventCategories[index] = { ...eventCategories[index], ...updates };
            saveEventCategories();
            return eventCategories[index];
        }

        /**
         * Delete a category (moves events to 'other')
         * @param {string} categoryId - Category ID to delete
         * @returns {boolean} True if deleted
         */
        function deleteEventCategory(categoryId) {
            if (categoryId === 'other') {
                logError('Cannot delete the "other" category');
                return false;
            }

            const index = eventCategories.findIndex(c => c.id === categoryId);
            if (index === -1) {
                return false;
            }

            // Move events with this category to 'other'
            events.forEach(event => {
                if (event.category === categoryId) {
                    event.category = 'other';
                }
            });
            saveEvents();

            eventCategories.splice(index, 1);
            saveEventCategories();
            logInfo(`📅 Deleted category: ${categoryId}`);
            return true;
        }

        /**
         * Get category by ID
         * @param {string} categoryId - Category ID
         * @returns {Object|null} Category or null
         */
        function getEventCategory(categoryId) {
            return eventCategories.find(c => c.id === categoryId) || null;
        }

        /**
         * Export events data for backup
         * @returns {Object} Events export data
         */
        function exportEventsData() {
            return {
                events: events,
                categories: eventCategories,
                exportedAt: new Date().toISOString()
            };
        }

        /**
         * Import events data from backup
         * @param {Object} data - Events data to import
         * @param {boolean} merge - If true, merge with existing; if false, replace
         * @returns {Object} Import result with counts
         */
        function importEventsData(data, merge = true) {
            const result = { eventsAdded: 0, eventsUpdated: 0, categoriesAdded: 0 };

            if (!data) return result;

            // Import categories first
            if (data.categories && Array.isArray(data.categories)) {
                data.categories.forEach(cat => {
                    if (!eventCategories.some(c => c.id === cat.id)) {
                        eventCategories.push(cat);
                        result.categoriesAdded++;
                    }
                });
                saveEventCategories();
            }

            // Import events
            if (data.events && Array.isArray(data.events)) {
                if (merge) {
                    data.events.forEach(importedEvent => {
                        const existingIndex = events.findIndex(e => e.eventId === importedEvent.eventId);
                        if (existingIndex === -1) {
                            events.push(importedEvent);
                            result.eventsAdded++;
                        } else {
                            // Update if imported version is newer
                            if (importedEvent.updatedAt > events[existingIndex].updatedAt) {
                                events[existingIndex] = importedEvent;
                                result.eventsUpdated++;
                            }
                        }
                    });
                } else {
                    // Replace all
                    result.eventsAdded = data.events.length;
                    events = data.events;
                }
                saveEvents();
            }

            logInfo(`📅 Imported events: ${result.eventsAdded} added, ${result.eventsUpdated} updated, ${result.categoriesAdded} categories`);
            return result;
        }

        // Initialize events on load
        loadEvents();
        loadEventCategories();

        // ========================================
        // Event Slider UI Functions
        // ========================================

        let eventBoundMode = null; // 'start' | 'end' | null

        /**
         * Open the event slider (for creating or editing)
         * @param {string|null} eventId - Event ID to edit, or null for new event
         */
        function openEventSlider(eventId = null) {
            const slider = document.getElementById('eventSlider');
            const content = document.querySelector('.event-slider-content');
            const listContainer = document.getElementById('eventListContainer');
            const title = document.getElementById('eventSliderTitle');
            const deleteBtn = document.getElementById('eventDeleteBtn');

            if (!slider) return;

            // Check if slider is already open (switching from list to edit)
            const wasAlreadyOpen = slider.classList.contains('open');

            // Close search slider if open
            if (_ui.closeSearchResults) _ui.closeSearchResults();

            // Position slider like search results
            positionEventSlider();

            // Reset state
            eventCreationState = {
                active: true,
                editingEventId: eventId,
                startDate: null,
                startTime: null,
                startItemId: null,
                endDate: null,
                endTime: null,
                endItemId: null
            };
            eventBoundMode = null;

            // Populate category dropdown
            populateEventCategories();

            if (eventId) {
                // Editing existing event
                const event = getEventById(eventId);
                if (event) {
                    title.textContent = 'Edit Event';
                    deleteBtn.style.display = 'block';

                    document.getElementById('eventName').value = event.name;
                    document.getElementById('eventDescription').value = event.description || '';
                    document.getElementById('eventCategory').value = event.category;

                    // Set start/end from event
                    eventCreationState.startDate = event.startDate;
                    eventCreationState.startTime = event.startTime;
                    eventCreationState.startItemId = event.startItemId;
                    eventCreationState.endDate = event.endDate;
                    eventCreationState.endTime = event.endTime;
                    eventCreationState.endItemId = event.endItemId;

                    updateEventDateTimeDisplay('start');
                    updateEventDateTimeDisplay('end');
                }
            } else {
                // New event
                title.textContent = 'New Event';
                deleteBtn.style.display = 'none';

                document.getElementById('eventName').value = '';
                document.getElementById('eventDescription').value = '';
                document.getElementById('eventCategory').value = 'vacation';

                // Clear date/time inputs
                document.getElementById('eventStartDate').value = '';
                document.getElementById('eventStartTime').value = '';
                document.getElementById('eventEndDate').value = '';
                document.getElementById('eventEndTime').value = '';
            }

            // Show content, hide list
            content.style.display = 'block';
            listContainer.style.display = 'none';

            // Open slider (only update map padding if slider wasn't already open)
            slider.classList.add('open');
            if (!wasAlreadyOpen) {
                if (_ui.updateMapPaddingForSlider) _ui.updateMapPaddingForSlider(true);
            }

            // Focus name input
            setTimeout(() => {
                document.getElementById('eventName')?.focus();
            }, 300);
        }

        /**
         * Open event slider showing list of events (or close if already open)
         */
        function openEventList() {
            const slider = document.getElementById('eventSlider');
            const content = document.querySelector('.event-slider-content');
            const listContainer = document.getElementById('eventListContainer');
            const title = document.getElementById('eventSliderTitle');

            if (!slider) return;

            // Toggle: if already open, close it
            if (slider.classList.contains('open')) {
                closeEventSlider();
                return;
            }

            // Close search slider if open
            if (_ui.closeSearchResults) _ui.closeSearchResults();

            // Position slider
            positionEventSlider();

            // Reset creation state
            eventCreationState.active = false;
            eventBoundMode = null;
            clearEventBoundMarkers();

            title.textContent = 'Events';

            // Populate event list
            populateEventList();

            // Show list, hide content
            content.style.display = 'none';
            listContainer.style.display = 'block';

            // Open slider
            slider.classList.add('open');
            if (_ui.updateMapPaddingForSlider) _ui.updateMapPaddingForSlider(true);
        }

        /**
         * Close the event slider
         */
        function closeEventSlider() {
            const slider = document.getElementById('eventSlider');
            if (slider) slider.classList.remove('open');

            // Reset state
            eventCreationState.active = false;
            eventBoundMode = null;
            clearEventBoundMarkers();
            document.body.classList.remove('event-bound-mode-active');

            // Update map padding
            if (_ui.updateMapPaddingForSlider) _ui.updateMapPaddingForSlider(false);
        }

        /**
         * Cancel event edit and return to list view
         */
        function cancelEventEdit() {
            const content = document.querySelector('.event-slider-content');
            const listContainer = document.getElementById('eventListContainer');
            const title = document.getElementById('eventSliderTitle');

            // Reset state
            eventCreationState.active = false;
            eventBoundMode = null;
            clearEventBoundMarkers();
            document.body.classList.remove('event-bound-mode-active');

            // Switch to list view
            title.textContent = 'Events';
            content.style.display = 'none';
            listContainer.style.display = 'block';

            // Refresh list
            populateEventList();
        }

        /**
         * Position event slider to match diary position
         */
        function positionEventSlider() {
            const slider = document.getElementById('eventSlider');
            const diaryFloat = document.querySelector('.diary-float');
            const modalHeader = document.querySelector('.modal-header');

            if (!slider || !diaryFloat) return;

            const diaryRect = diaryFloat.getBoundingClientRect();
            const headerBottom = modalHeader ? modalHeader.getBoundingClientRect().bottom + 15 : 0;

            const sliderTop = Math.max(diaryRect.top, headerBottom);

            slider.style.left = (diaryRect.right - 20) + 'px';
            slider.style.top = sliderTop + 'px';
            slider.style.bottom = (window.innerHeight - diaryRect.bottom) + 'px';
            slider.style.height = 'auto';
        }

        /**
         * Escape HTML special characters to prevent XSS
         */
        function escapeHtml(text) {
            if (!text) return '';
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        /**
         * Populate category dropdown
         */
        function populateEventCategories() {
            const select = document.getElementById('eventCategory');
            if (!select) return;

            select.innerHTML = eventCategories.map(cat =>
                `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`
            ).join('');
        }

        /**
         * Populate event list
         */
        function populateEventList() {
            const list = document.getElementById('eventList');
            if (!list) return;

            const allEvents = getAllEvents();

            if (allEvents.length === 0) {
                list.innerHTML = '<div class="event-list-empty">No events defined yet.<br>Create one to get started!</div>';
                return;
            }

            list.innerHTML = allEvents.map(event => {
                const category = getEventCategory(event.category);
                const startFormatted = formatEventDate(event.startDate, event.startTime);
                const endFormatted = formatEventDate(event.endDate, event.endTime);

                return `
                    <div class="event-list-item" onclick="navigateToEvent('${event.eventId}')">
                        <div class="event-list-item-name">${escapeHtml(event.name)}</div>
                        <div class="event-list-item-dates">${startFormatted} → ${endFormatted}</div>
                        <div class="event-list-item-footer">
                            <div class="event-list-item-category">${category ? category.name : 'Other'}</div>
                            <button class="event-list-edit-btn" onclick="event.stopPropagation(); openEventSlider('${event.eventId}')">Edit</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        /**
         * Navigate to an event's start date
         */
        async function navigateToEvent(eventId) {
            const event = getEventById(eventId);
            if (!event || !event.startDate) return;

            // Close the event slider
            closeEventSlider();

            // Navigate to the start date
            // startDate is in YYYY-MM-DD format
            const dayKey = event.startDate;
            const monthKey = dayKey.substring(0, 7); // YYYY-MM

            // Check if we need to change month
            if (monthKey !== window.ArcState.currentMonth) {
                await window.NavigationController.selectMonth(monthKey);
            }

            // Navigate to the day
            window.NavigationController.selectDay(dayKey);
        }

        /**
         * Format event date for display
         */
        function formatEventDate(date, time) {
            if (!date) return '—';
            const d = new Date(date + 'T12:00:00');
            const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            return time ? `${formatted} ${time}` : formatted;
        }

        /**
         * Update the start or end datetime input fields from state
         */
        function updateEventDateTimeDisplay(bound) {
            const dateInput = document.getElementById(bound === 'start' ? 'eventStartDate' : 'eventEndDate');
            const timeInput = document.getElementById(bound === 'start' ? 'eventStartTime' : 'eventEndTime');

            const date = bound === 'start' ? eventCreationState.startDate : eventCreationState.endDate;
            const time = bound === 'start' ? eventCreationState.startTime : eventCreationState.endTime;

            if (dateInput) dateInput.value = date || '';
            if (timeInput) timeInput.value = time || '';
        }

        /**
         * Update event bound from manual input
         */
        function updateEventBoundFromInput(bound) {
            const dateInput = document.getElementById(bound === 'start' ? 'eventStartDate' : 'eventEndDate');
            const timeInput = document.getElementById(bound === 'start' ? 'eventStartTime' : 'eventEndTime');

            const date = dateInput?.value || null;
            const time = timeInput?.value || null;

            if (bound === 'start') {
                eventCreationState.startDate = date;
                eventCreationState.startTime = time;
                eventCreationState.startItemId = null; // Clear item association when manually set
            } else {
                eventCreationState.endDate = date;
                eventCreationState.endTime = time;
                eventCreationState.endItemId = null;
            }
        }

        /**
         * Enter bound selection mode (pick from diary)
         */
        function setEventBoundMode(mode) {
            const startBtn = document.getElementById('eventSetStartBtn');
            const endBtn = document.getElementById('eventSetEndBtn');

            // Ensure we're in active creation mode
            if (!eventCreationState.active) {
                eventCreationState.active = true;
            }

            // Toggle mode
            if (eventBoundMode === mode) {
                eventBoundMode = null;
                document.body.classList.remove('event-bound-mode-active');
                startBtn?.classList.remove('active');
                endBtn?.classList.remove('active');
            } else {
                eventBoundMode = mode;
                document.body.classList.add('event-bound-mode-active');
                startBtn?.classList.toggle('active', mode === 'start');
                endBtn?.classList.toggle('active', mode === 'end');
            }
        }

        /**
         * Handle diary entry click when in event bound mode
         * Called from diary entry click handlers
         */
        function handleEventBoundSelection(dayKey, time, itemId) {
            if (!eventCreationState.active || !eventBoundMode) return false;

            if (eventBoundMode === 'start') {
                eventCreationState.startDate = dayKey;
                eventCreationState.startTime = time || null;
                eventCreationState.startItemId = itemId || null;
                updateEventDateTimeDisplay('start');
                highlightEventBound('start', dayKey, itemId);
            } else if (eventBoundMode === 'end') {
                eventCreationState.endDate = dayKey;
                eventCreationState.endTime = time || null;
                eventCreationState.endItemId = itemId || null;
                updateEventDateTimeDisplay('end');
                highlightEventBound('end', dayKey, itemId);
            }

            // Exit bound mode
            setEventBoundMode(null);
            return true;
        }

        /**
         * Highlight the selected start/end entry in diary
         */
        function highlightEventBound(bound, dayKey, itemId) {
            // Remove existing marker of this type
            document.querySelectorAll(`.event-${bound}-marker`).forEach(el => {
                el.classList.remove(`event-${bound}-marker`);
            });

            // Find and highlight the entry
            if (itemId) {
                const entry = document.querySelector(`[data-item-id="${itemId}"]`);
                if (entry) {
                    entry.closest('li')?.classList.add(`event-${bound}-marker`);
                }
            }
        }

        /**
         * Clear all event bound markers
         */
        function clearEventBoundMarkers() {
            document.querySelectorAll('.event-start-marker, .event-end-marker').forEach(el => {
                el.classList.remove('event-start-marker', 'event-end-marker');
            });
        }

        /**
         * Save the current event (create or update)
         */
        function saveEvent() {
            const name = document.getElementById('eventName')?.value.trim();
            const description = document.getElementById('eventDescription')?.value.trim();
            const category = document.getElementById('eventCategory')?.value;
            // Get color from category
            const categoryObj = getEventCategory(category);
            const color = categoryObj?.color || '#9C27B0';

            // Read dates/times directly from input fields
            const startDate = document.getElementById('eventStartDate')?.value || null;
            const startTime = document.getElementById('eventStartTime')?.value || null;
            const endDate = document.getElementById('eventEndDate')?.value || null;
            const endTime = document.getElementById('eventEndTime')?.value || null;

            if (!name) {
                alert('Please enter an event name.');
                document.getElementById('eventName')?.focus();
                return;
            }

            if (!startDate) {
                alert('Please set a start date.');
                document.getElementById('eventStartDate')?.focus();
                return;
            }

            if (!endDate) {
                alert('Please set an end date.');
                document.getElementById('eventEndDate')?.focus();
                return;
            }

            // Validate start <= end
            const startDT = startDate + (startTime || '00:00');
            const endDT = endDate + (endTime || '23:59');
            if (startDT > endDT) {
                alert('End date/time must be after start date/time.');
                return;
            }

            const eventData = {
                name,
                description,
                category,
                color,
                startDate: startDate,
                startTime: startTime,
                startItemId: eventCreationState.startItemId,
                endDate: endDate,
                endTime: endTime,
                endItemId: eventCreationState.endItemId
            };

            if (eventCreationState.editingEventId) {
                updateEvent(eventCreationState.editingEventId, eventData);
            } else {
                createEvent(eventData);
            }

            // Refresh diary to show [EVENT] tags
            if (_ui.renderMonth) _ui.renderMonth();

            // Return to event list
            cancelEventEdit();
        }

        /**
         * Delete the current event being edited
         */
        function deleteCurrentEvent() {
            if (!eventCreationState.editingEventId) return;

            const event = getEventById(eventCreationState.editingEventId);
            if (!event) return;

            if (confirm(`Delete event "${event.name}"?`)) {
                deleteEvent(eventCreationState.editingEventId);

                // Refresh diary to remove [EVENT] tags
                if (_ui.renderMonth) _ui.renderMonth();

                // Return to event list
                cancelEventEdit();
            }
        }

        /**
         * Start creating a new event (from event list view)
         */
        function startNewEvent() {
            openEventSlider(null);
        }

        // ========================================
        // Category Manager Functions
        // ========================================

        /**
         * Open the category manager modal
         */
        function openCategoryManager() {
            const backdrop = document.getElementById('categoryManagerBackdrop');
            const modal = document.getElementById('categoryManagerModal');

            if (backdrop) backdrop.classList.add('open');
            if (modal) modal.classList.add('open');

            populateCategoryList();
        }

        /**
         * Close the category manager modal
         */
        function closeCategoryManager() {
            const backdrop = document.getElementById('categoryManagerBackdrop');
            const modal = document.getElementById('categoryManagerModal');

            if (backdrop) backdrop.classList.remove('open');
            if (modal) modal.classList.remove('open');

            // Clear the new category input
            const nameInput = document.getElementById('newCategoryName');
            if (nameInput) nameInput.value = '';

            // Refresh the category dropdown in the event form
            populateEventCategories();
        }

        /**
         * Populate the category list in the manager
         */
        function populateCategoryList() {
            const list = document.getElementById('categoryList');
            if (!list) return;

            list.innerHTML = eventCategories.map(cat => `
                <div class="category-item" data-category-id="${cat.id}">
                    <input type="color" class="category-item-color" value="${cat.color}"
                           onchange="updateCategoryColor('${cat.id}', this.value)">
                    <input type="text" class="category-item-name" value="${escapeHtml(cat.name)}"
                           onblur="updateCategoryName('${cat.id}', this.value)"
                           onkeypress="if(event.key==='Enter') this.blur()">
                    <button class="category-item-delete" onclick="deleteCategoryFromManager('${cat.id}')"
                            title="${cat.id === 'other' ? 'Cannot delete "Other" category' : 'Delete category'}"
                            ${cat.id === 'other' ? 'disabled' : ''}>✕</button>
                </div>
            `).join('');
        }

        /**
         * Update a category's color
         */
        function updateCategoryColor(categoryId, newColor) {
            updateEventCategory(categoryId, { color: newColor });
            populateCategoryList();
        }

        /**
         * Update a category's name
         */
        function updateCategoryName(categoryId, newName) {
            if (!newName.trim()) {
                populateCategoryList(); // Reset to original
                return;
            }
            updateEventCategory(categoryId, { name: newName.trim() });
        }

        /**
         * Delete a category from the manager
         */
        function deleteCategoryFromManager(categoryId) {
            const category = getEventCategory(categoryId);
            if (!category) return;

            // Count events using this category
            const eventsUsingCategory = events.filter(e => e.category === categoryId).length;

            let message = `Delete category "${category.name}"?`;
            if (eventsUsingCategory > 0) {
                message += `\n\n${eventsUsingCategory} event(s) using this category will be moved to "Other".`;
            }

            if (confirm(message)) {
                deleteEventCategory(categoryId);
                populateCategoryList();
            }
        }

        /**
         * Add a new category from the form
         */
        function addNewCategory() {
            const nameInput = document.getElementById('newCategoryName');
            const colorInput = document.getElementById('newCategoryColor');

            const name = nameInput?.value.trim();
            const color = colorInput?.value || '#9C27B0';

            if (!name) {
                nameInput?.focus();
                return;
            }

            const result = addEventCategory(name, color);
            if (result) {
                nameInput.value = '';
                populateCategoryList();
            } else {
                alert('A category with this name already exists.');
            }
        }

        // Expose event functions globally
        window.openEventSlider = openEventSlider;
        window.openEventList = openEventList;
        window.closeEventSlider = closeEventSlider;
        window.cancelEventEdit = cancelEventEdit;
        window.navigateToEvent = navigateToEvent;
        window.setEventBoundMode = setEventBoundMode;
        window.handleEventBoundSelection = handleEventBoundSelection;
        window.updateEventBoundFromInput = updateEventBoundFromInput;
        window.saveEvent = saveEvent;
        window.deleteCurrentEvent = deleteCurrentEvent;
        window.startNewEvent = startNewEvent;
        window.getEventsForDay = getEventsForDay;
        window.getAllEvents = getAllEvents;
        window.exportEventsData = exportEventsData;
        window.openCategoryManager = openCategoryManager;
        window.closeCategoryManager = closeCategoryManager;
        window.updateCategoryColor = updateCategoryColor;
        window.updateCategoryName = updateCategoryName;
        window.deleteCategoryFromManager = deleteCategoryFromManager;
        window.addNewCategory = addNewCategory;
        window.importEventsData = importEventsData;


    // ========================================
    // UI Callback Registration
    // ========================================

    function setUICallbacks(callbacks) {
        if (callbacks.renderMonth) _ui.renderMonth = callbacks.renderMonth;
        if (callbacks.closeSearchResults) _ui.closeSearchResults = callbacks.closeSearchResults;
        if (callbacks.updateMapPaddingForSlider) _ui.updateMapPaddingForSlider = callbacks.updateMapPaddingForSlider;
    }

    // ========================================
    // Module Export
    // ========================================

    window.ArcEvents = {
        setUICallbacks,

        // CRUD
        createEvent,
        updateEvent,
        deleteEvent,
        getEventById,
        getAllEvents,
        getEventsForDay,
        getEventsForDateTime,
        getEventsInRange,

        // Categories
        getEventCategory,
        addEventCategory,
        updateEventCategory,
        deleteEventCategory,

        // Import/Export
        exportEventsData,
        importEventsData,

        // UI
        openEventSlider,
        openEventList,
        closeEventSlider,
        cancelEventEdit,
        navigateToEvent,
        setEventBoundMode,
        handleEventBoundSelection,
        updateEventBoundFromInput,
        saveEvent,
        deleteCurrentEvent,
        startNewEvent,

        // Category Manager
        openCategoryManager,
        closeCategoryManager,
        updateCategoryColor,
        updateCategoryName,
        deleteCategoryFromManager,
        addNewCategory,

        // State access
        getEventCreationState: () => eventCreationState,
        getEventBoundMode: () => eventBoundMode,
    };

    logInfo(`📦 Loaded events.js`);

})();
