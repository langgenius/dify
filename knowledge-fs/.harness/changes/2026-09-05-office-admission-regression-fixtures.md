# Office admission regression fixtures and compatibility boundary

## Changes

- Replace successful remote DOCX/XLSX transport test inputs that were arbitrary
  bytes or fabricated ZIP headers with small actual deflated OOXML packages.
  The API app uses a fixed, fflate-generated DOCX ZIP encoded as base64 to avoid
  adding a production or test dependency solely for a fixture.
- Update default parser-version expectations and the Markdown artifact digest
  golden for the explicitly bumped versions. Custom parser versions and
  coordinator fingerprints are not changed.
- Separate successful archive-image extraction from unsafe archive admission.
  DOCX/PPTX/XLSX/ODT/EPUB archives with `../` member paths must fail with a
  terminal input error before the provider is called.
- Preserve malformed ZIP/XML inputs as rejection regressions. The prior
  expectation that provider text remains usable for damaged spreadsheet archives
  is intentionally superseded by preflight admission.
- Keep the original unsafe worksheet metadata fixture in an explicit rejection
  case. A second case uses valid worksheet declarations and coordinates while
  retaining malformed/external optional image relationships and verifies the
  original fail-soft image anchoring and fallback behavior.

## Compatibility boundary

Damaged archives/XML, unsafe member paths, or missing/external worksheet
relationships no longer enter remote Office parsing. These affect safe resource
inspection and are not treated as optional image metadata. Optional image/drawing
relationship failures still leave admitted document text usable; no file is
rewritten before being sent to the provider.

## Verification

The first integrated run exposed 22 failures from obsolete version assertions,
fake archives, and the explicitly tightened admission policy. Both relevant files
now pass all 124 tests. An existing deadline mock hung only in the full suite; it
now retains its Request objects for the lifetime of the simulated transport and
checks an already-aborted signal, matching real fetch behavior. No timeout was
extended, assertion removed, or production deadline logic changed for this test.
Both parser and API-app typechecks pass. Scoped Biome and git whitespace checks
pass. The parent task owns final broader-suite validation and integration notes.
