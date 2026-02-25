/**
 * arc-sprites.js — External sprite/icon data loader
 *
 * Loads arc-sprites.json and exposes window.ArcSprites API for all consumers.
 * Falls back to hardcoded defaults if the JSON file is missing or fetch fails
 * (e.g. file:// protocol). Injects dynamic CSS for replay marker colours.
 *
 * Load order: after arc-state.js, before arc-utils.js
 */
(function () {
  'use strict';

  // ---- Hardcoded defaults (single source of truth for fallback) ----
  var DEFAULTS = {
    walking:       { svg: '<circle cx="32" cy="10" r="6"/><path d="M26 20 L30 20 L34 32 L42 52 L36 54 L30 38 L28 52 L22 52 L26 32 Z"/><path d="M22 24 L30 22 L38 28 L34 34 L28 28 L20 32 Z"/>', emoji: '\u{1F6B6}', routeColour: '#12A656', replayColour: '#2ECC71', label: 'Walking' },
    hiking:        { svg: null, emoji: '\u{1F97E}', routeColour: '#0E8444', replayColour: '#0E8444', label: 'Hiking' },
    running:       { svg: '<circle cx="38" cy="8" r="6"/><path d="M20 26 L32 22 L36 18 L42 22 L38 28 L44 36 L52 34 L54 40 L42 44 L34 36 L30 48 L38 56 L32 60 L22 48 L26 34 L16 32 L14 26 Z"/>', emoji: '\u{1F3C3}', routeColour: '#EB781B', replayColour: '#F1C40F', label: 'Running' },
    cycling:       { svg: '<circle cx="14" cy="44" r="10" fill="none" stroke="white" stroke-width="4"/><circle cx="50" cy="44" r="10" fill="none" stroke="white" stroke-width="4"/><circle cx="38" cy="10" r="5"/><path d="M14 44 L28 26 L38 44" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 26 L34 16" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><circle cx="14" cy="44" r="3"/><circle cx="50" cy="44" r="3"/>', emoji: '\u{1F6B4}', routeColour: '#039FD4', replayColour: '#00B4D8', label: 'Cycling' },
    car:           { svg: '<path d="M14 28 L18 16 C19 14 21 14 24 14 L40 14 C43 14 45 14 46 16 L50 28 Z"/><rect x="10" y="28" width="44" height="20" rx="4"/><circle cx="16" cy="38" r="4" fill-opacity="0.3"/><circle cx="48" cy="38" r="4" fill-opacity="0.3"/><rect x="14" y="46" width="10" height="6" rx="2"/><rect x="40" y="46" width="10" height="6" rx="2"/>', emoji: '\u{1F697}', routeColour: '#4E5268', replayColour: '#5D6B7A', label: 'Car' },
    bus:           { svg: '<rect x="12" y="10" width="40" height="40" rx="6"/><rect x="16" y="14" width="32" height="14" rx="3" fill-opacity="0.3"/><circle cx="20" cy="40" r="4" fill-opacity="0.3"/><circle cx="44" cy="40" r="4" fill-opacity="0.3"/><rect x="16" y="48" width="10" height="6" rx="2"/><rect x="38" y="48" width="10" height="6" rx="2"/>', emoji: '\u{1F68C}', routeColour: '#4056B5', replayColour: '#E67E22', label: 'Bus' },
    train:         { svg: '<rect x="14" y="14" width="36" height="36" rx="6"/><rect x="20" y="18" width="24" height="12" rx="3" fill-opacity="0.3"/><rect x="14" y="34" width="36" height="4"/><circle cx="32" cy="44" r="4" fill-opacity="0.3"/><circle cx="22" cy="50" r="3"/><circle cx="42" cy="50" r="3"/>', emoji: '\u{1F686}', routeColour: '#AA9131', replayColour: '#3498DB', label: 'Train' },
    tram:          { svg: '<rect x="14" y="14" width="36" height="34" rx="6"/><rect x="18" y="18" width="12" height="10" rx="2" fill-opacity="0.3"/><rect x="34" y="18" width="12" height="10" rx="2" fill-opacity="0.3"/><rect x="14" y="32" width="36" height="3"/><circle cx="32" cy="42" r="3" fill-opacity="0.3"/>', emoji: '\u{1F68A}', routeColour: '#AA9131', replayColour: '#9B8B4E', label: 'Tram' },
    motorcycle:    { svg: '<circle cx="12" cy="46" r="10"/><circle cx="12" cy="46" r="4" fill-opacity="0.3"/><circle cx="52" cy="46" r="10"/><circle cx="52" cy="46" r="4" fill-opacity="0.3"/><ellipse cx="30" cy="28" rx="8" ry="5"/><rect x="46" y="20" width="4" height="14"/><rect x="42" y="16" width="14" height="6" rx="2"/>', emoji: '\u{1F3CD}\uFE0F', routeColour: '#E35641', replayColour: '#E74C3C', label: 'Motorcycle' },
    scooter:       { svg: '<circle cx="14" cy="48" r="8"/><circle cx="14" cy="48" r="3" fill-opacity="0.3"/><circle cx="50" cy="48" r="8"/><circle cx="50" cy="48" r="3" fill-opacity="0.3"/><rect x="18" y="34" width="26" height="8" rx="2"/><ellipse cx="26" cy="32" rx="8" ry="4"/><rect x="44" y="18" width="4" height="16"/><rect x="40" y="14" width="14" height="6" rx="2"/>', emoji: '\u{1F6F5}', routeColour: '#E35641', replayColour: '#E07B67', label: 'Scooter' },
    airplane:      { svg: '<path d="M32 4 L28 4 L28 20 L10 30 V36 L28 30 V46 L22 50 V56 L32 52 L42 56 V50 L36 46 V30 L54 36 V30 L36 20 V4 Z"/>', emoji: '\u2708\uFE0F', routeColour: '#8E1DD2', replayColour: '#9B59B6', label: 'Airplane' },
    boat:          { svg: '<path d="M8 44 L14 54 H50 L56 44 Z"/><rect x="20" y="32" width="24" height="12" rx="2"/><circle cx="28" cy="38" r="3" fill-opacity="0.3"/><circle cx="36" cy="38" r="3" fill-opacity="0.3"/><rect x="30" y="20" width="4" height="12"/><path d="M28 20 L32 12 L36 20 Z"/>', emoji: '\u26F4\uFE0F', routeColour: '#3B71F6', replayColour: '#1ABC9C', label: 'Boat' },
    skateboarding: { svg: null, emoji: '\u{1F6F9}', routeColour: '#18A1B1', replayColour: '#18A1B1', label: 'Skateboarding' },
    inlineSkating: { svg: null, emoji: '\u26F8\uFE0F', routeColour: '#D85582', replayColour: '#D85582', label: 'Inline Skating' },
    snowboarding:  { svg: null, emoji: '\u{1F3C2}', routeColour: '#4884AE', replayColour: '#4884AE', label: 'Snowboarding' },
    skiing:        { svg: null, emoji: '\u26F7\uFE0F', routeColour: '#26398B', replayColour: '#26398B', label: 'Skiing' },
    horseback:     { svg: null, emoji: '\u{1F434}', routeColour: '#8B408C', replayColour: '#8B408C', label: 'Horseback' },
    surfing:       { svg: null, emoji: '\u{1F3C4}', routeColour: '#D85582', replayColour: '#D85582', label: 'Surfing' },
    tractor:       { svg: null, emoji: '\u{1F69C}', routeColour: '#2D2F3E', replayColour: '#2D2F3E', label: 'Tractor' },
    tuktuk:        { svg: null, emoji: '\u{1F6FA}', routeColour: '#B4831D', replayColour: '#B4831D', label: 'Tuk-tuk' },
    stationary:    { svg: '<circle cx="32" cy="32" r="8"/><circle cx="32" cy="32" r="16" fill="none" stroke="white" stroke-width="3"/>', emoji: '\u{1F4CD}', routeColour: '#7A3CFC', replayColour: '#808080', label: 'Stationary' },
    unknown:       { svg: '<circle cx="32" cy="32" r="16" fill="none" stroke="white" stroke-width="3"/><text x="32" y="40" text-anchor="middle" font-size="20" fill="white">?</text>', emoji: '\u2753', routeColour: '#808080', replayColour: '#808080', label: 'Unknown' },
    finished:      { svg: '<path d="M20 8 L20 56" stroke="white" stroke-width="4"/><rect x="20" y="8" width="28" height="24"/><rect x="20" y="8" width="7" height="8" fill-opacity="0.3"/><rect x="34" y="8" width="7" height="8" fill-opacity="0.3"/><rect x="27" y="16" width="7" height="8" fill-opacity="0.3"/><rect x="41" y="16" width="7" height="8" fill-opacity="0.3"/><rect x="20" y="24" width="7" height="8" fill-opacity="0.3"/><rect x="34" y="24" width="7" height="8" fill-opacity="0.3"/>', emoji: '\u{1F3C1}', routeColour: '#000000', replayColour: '#000000', label: 'Finished' }
  };

  // ---- Merged data store (defaults + JSON overlay) ----
  var activities = {};

  function deepCloneDefaults() {
    var out = {};
    for (var k in DEFAULTS) {
      out[k] = { svg: DEFAULTS[k].svg, emoji: DEFAULTS[k].emoji, routeColour: DEFAULTS[k].routeColour, replayColour: DEFAULTS[k].replayColour, label: DEFAULTS[k].label };
    }
    return out;
  }

  function mergeExternal(ext) {
    if (!ext || typeof ext !== 'object') return;
    var src = ext.activities || ext;
    for (var k in src) {
      if (!src.hasOwnProperty(k)) continue;
      var entry = src[k];
      if (!activities[k]) activities[k] = { svg: null, emoji: '', routeColour: '#808080', replayColour: '#808080', label: k };
      if (entry.svg !== undefined) activities[k].svg = entry.svg;
      if (entry.emoji !== undefined) activities[k].emoji = entry.emoji;
      if (entry.routeColour !== undefined) activities[k].routeColour = entry.routeColour;
      if (entry.replayColour !== undefined) activities[k].replayColour = entry.replayColour;
      if (entry.label !== undefined) activities[k].label = entry.label;
    }
  }

  // ---- Dynamic CSS injection for replay marker colours ----
  function injectReplayCSS() {
    var rules = [];
    for (var k in activities) {
      if (activities[k].replayColour) {
        rules.push('.replay-marker-icon.activity-' + k + ' { background: ' + activities[k].replayColour + '; }');
      }
    }
    if (!rules.length) return;
    var style = document.createElement('style');
    style.id = 'arc-sprites-replay-css';
    style.textContent = rules.join('\n');
    // Remove previous injection if reloading
    var prev = document.getElementById('arc-sprites-replay-css');
    if (prev) prev.remove();
    document.head.appendChild(style);
  }

  // ---- Public API ----
  window.ArcSprites = {
    get: function (key) { return activities[key]; },
    getSvg: function (key) { var a = activities[key]; return a ? a.svg : null; },
    getEmoji: function (key) { var a = activities[key]; return a ? a.emoji : ''; },
    getRouteColour: function (key) { var a = activities[key]; return a ? a.routeColour : '#808080'; },
    getReplayColour: function (key) { var a = activities[key]; return a ? a.replayColour : '#808080'; },
    getLabel: function (key) { var a = activities[key]; return a ? a.label : key || 'Unknown'; },
    all: function () { return activities; },
    keys: function () { return Object.keys(activities); },
    /** Re-inject CSS after external data changes (used by sprite editor) */
    refreshCSS: function () { injectReplayCSS(); }
  };

  // ---- Bootstrap: clone defaults then merge external data ----
  activities = deepCloneDefaults();

  // arc-sprites-data.js loads before this file and sets window.__ARC_SPRITES_DATA__.
  // Using a <script> tag avoids fetch/XHR which are blocked on file:// protocol.
  if (window.__ARC_SPRITES_DATA__) {
    mergeExternal(window.__ARC_SPRITES_DATA__);
    delete window.__ARC_SPRITES_DATA__; // clean up global
  }
  injectReplayCSS();
})();
