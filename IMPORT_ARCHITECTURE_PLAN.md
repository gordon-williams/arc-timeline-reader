# Import Architecture Plan (Arc Timeline + Arc Editor)

## Purpose
Define a maintainable, format-agnostic import pipeline that supports:
- Arc Timeline (legacy)
- Arc Editor (in development)
- Multiple import methods (Safari file input, Chrome File System Access, JSON exports)

This plan is intentionally staged and defers deeper refactors until Arc Editor stabilizes on the App Store.

---

## Constraints
- Multiple formats must be supported for the foreseeable future.
- Safari file APIs are restricted; Chrome can use File System Access API.
- JSON exports remain a supported input.
- Arc Editor format may change before release.

---

## Guiding Principles
1. **Single canonical data model**
   - Use `entries` + `itemNotes` as the authoritative in-memory model.
   - Legacy `notes/locations/tracks` should be derived, not primary.

2. **Format adapters are thin**
   - Arc Timeline vs Arc Editor differences are handled in the adapter layer only.
   - Downstream pipeline does not care about source format.

3. **Import method is orthogonal**
   - Safari vs Chrome vs JSON should converge into the same normalization pipeline.

4. **Sample attachment is centralized**
   - One function attaches GPS samples by time range using robust week-key logic.
   - All import paths call it.

---

## Proposed Architecture

### A) Input Layer (Method-specific)
- Chrome: File System Access API
- Safari: File input + `webkitRelativePath`
- JSON exports: direct JSON files

**Responsibility:** enumerate files and read raw JSON.

### B) Format Adapter Layer (Source-specific)
- `normalizeBackupItem(rawItem)`
- `normalizeBackupPlace(rawPlace)`
- `normalizeBackupNote(rawNote)`
- `normalizeBackupSample(rawSample)`

**Responsibility:** transform format-specific shapes into a common schema.

### C) Canonical Pipeline (Shared)
1. Normalize data
2. Attach samples by time range (week boundary safe)
3. Build canonical `entries` + `itemNotes`
4. Derive legacy `notes/locations/tracks` for UI compatibility
5. Write to IndexedDB

---

## Implementation Stages

### Stage 1 (Now)
- Keep behavior stable.
- Avoid invasive refactors until Arc Editor format stabilizes.
- Patch fixes in adapters and sample attachment logic only.

### Stage 2 (Post Arc Editor App Store release)
- Consolidate all import paths to call a shared canonical pipeline.
- Make `entries/itemNotes` authoritative for rendering.
- Deprecate legacy data structures in new features.

### Stage 3 (Optional, if Arc Timeline is dropped)
- Remove Arc Timeline adapter logic.
- Remove fallback assumptions in normalization.
- Simplify importer branching.

---

## Drop-AT Decision Criteria
Consider removing Arc Timeline support when:
- Arc Editor is stable on the App Store for several months.
- User migration confirms Arc Timeline data is largely historical.
- Support cost outweighs benefit.

---

## Risks
- Arc Editor format changes before release.
- Safari API limits constrain some refactors.
- Legacy UI still depends on `notes/locations/tracks`.

---

## Next Review
Revisit this plan **2–3 months after Arc Editor App Store release**, when the format and adoption stabilize.
