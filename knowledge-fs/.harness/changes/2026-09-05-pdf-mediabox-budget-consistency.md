# Use the actual Poppler MediaBox for local raster admission

## Why

The local rasterizer estimated allocation from `pdfinfo`'s `Page size`, which is
the CropBox, while its existing `pdftoppm` command renders the MediaBox. A tiny
CropBox therefore did not bound a larger backing bitmap. A safe 144 x 144 point
MediaBox with a 72 x 72 CropBox reproduced this: with a 10,000-pixel budget the
old implementation rendered 20,736 pixels and only then failed in Sharp.

## Changes

- Read the requested page's resolved MediaBox endpoints, subtracting nonzero
  origins, and reject missing, duplicate, incomplete, non-finite or reversed
  geometry before starting `pdftoppm`.
- Preserve MediaBox rendering and the established displayed-page coordinate
  contract; do not switch to `-cropbox`. Page rotation only swaps the dimensions
  used for area/long-edge admission. Actual rendered dimensions still drive
  provider pixel, displayed-point and relative crop mapping.
- Account for `pdfinfo` rounding both box endpoints to two decimal places: use
  conservative dimension bounds and the worst-case aspect ratio. The second
  real regression (100.004 x 100 points) otherwise passed the rounded estimate
  and exceeded its allocation budget by one pixel column.
- Preserve the earlier page-pixel/long-edge caps, shared page bitmap/session,
  cancellation, cleanup and provider-fallback semantics. Ordinary uncapped pages
  retain their rendering parameters. A page exactly at a rounded budget boundary
  can be downscaled slightly more conservatively (typically one pixel).

## Verification

- TDD red: five real small-PDF tests failed before the MediaBox fix, including
  the original mismatch and four rotations. They passed after the fix.
- TDD red: the fractional 100.004-point regression then failed against the first
  MediaBox implementation; conservative rounding fixed it.
- 70 focused rasterizer tests pass, including eight real Poppler tests, nine
  rejected geometry cases, existing admission/cancellation/cleanup tests, and
  content-colour checks for nonzero origins with 0/90/180/270-degree rotation.
  Both relative and provider-style pixel/displayed-point crops preserve colour
  and position after downscaling. No unsafe-size raster was generated.
- Focused production-file coverage: statements/lines 95.46%, branches 92.98%,
  functions 98.61%. API package typecheck passes. Scoped Biome and diff checks
  pass after formatting.
- The parent implementation task owns full-workspace build/lint/test and contract
  lock regeneration. They were not repeated for this isolated parallel slice.
  No commit, deployment, database migration or production request was performed.

## Remaining limits

This closes the CropBox/MediaBox allocation mismatch; it is not an arbitrary PDF
object/embedded-image memory sandbox. The API preflight and provider-native pixel
guard remain complementary. Crops retain the pre-existing displayed-page frame;
raw bottom-left PDF user-space coordinates without frame metadata are not newly
supported. Changes to provider page-frame conventions require explicit contract
tests rather than silently switching rendering boxes.
