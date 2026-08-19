# Golden Question Evidence Editor

## Summary

- Separated the durable Golden Question evidence selection from the transient text used to search
  for candidate evidence.
- Added exact, permission-filtered node resolution to the existing evidence-match operation so an
  editor can render the passages represented by persisted `expectedEvidenceIds`.
- Kept semantic evidence matching unchanged for interactive searches while allowing callers to
  request exact nodes with `nodeIds`.
- Stopped new Console create and update flows from persisting the evidence search text as Golden
  Question metadata.

## User-visible behavior

- Editing a Golden Question displays every selected passage, its section path, and an individual
  remove action instead of only showing the selected count.
- The evidence search field starts empty, clears after a successful lookup, and never becomes part
  of the Golden Question payload.
- Saved node IDs that are no longer visible or no longer exist remain removable and are shown as
  stale instead of silently disappearing from the selection.

## Regression contract

- Exact evidence resolution preserves the requested node order and applies candidate permission
  filtering before returning text.
- Semantic matching and retrieval-test promotion continue to expose selectable candidates.
- Create and update requests persist `expectedEvidenceIds` and `matchPolicy`, but omit transient
  evidence search text.
