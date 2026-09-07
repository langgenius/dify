# Optional Unstructured request isolation and release gates

## What / why

- Added an opt-in, single-service supervisor derived from the existing pinned Unstructured
  image, with bounded shared admission, temporary request spooling, disposable process groups,
  disconnect/deadline cleanup, inherited Linux limits, and sampled aggregate resource checks.
- Added shared nested EML/MSG and archive/XML/Excel admission. Implicit XLSX coordinates are
  supported; renamed MSG content is detected through OLE properties rather than trusting `.xls`.
- Added Docker overrides for the existing dedicated service only. Base deployment files and
  legacy Dify Unstructured are unchanged; unverified runtime is not enabled automatically.
- Added a tiny real-image golden runner and a licensed, hash-checked upstream MSG fixture. No fixtures are actual
  user documents; no dangerous OOM payload is sent to an unbounded parser.
- Added client classification for the exact versioned supervisor contract. Confirmed 413/422
  resource/input rejections become nonretryable `provider_input`; confirmed killed-worker 504
  becomes nonretryable, non-ambiguous `provider_timeout`. Unknown errors and 429/503 preserve
  existing behavior. Shared bounded error-body reading also preserves the existing PDF guard.
- Added version-scoped executable adapters for DOC/PPT LibreOffice and RTF/EPUB/ODT Pandoc
  conversions. Products are admitted against the root/mail shared locked budget before
  atomic publication or stdout release. No upstream Python monkeypatch or raw fallback exists.
- Inspected original ASGI lifecycle requirements; image build asserts there are no startup,
  shutdown or custom lifespan hooks before permitting direct request replay.

## TDD / verification

- Initial admission and worker tests failed for absent implementation; targeted sparse Excel,
  nested attachment budget, implicit coordinate, and renamed MSG regressions were then fixed.
- A deterministic yielding semaphore reproduced burst over-admission (20 reservations with
  capacity 1); an atomic pre-await capacity reservation fixes it.
- A blocked response-send test reproduced indefinite admission retention; delivery is now
  bounded by disconnect and the same document deadline, without emitting a second response.
- Conversion TDD covered byte/structure rejection, concurrent shared-budget spend, exact CLI
  shapes, HTML spans, lifecycle deadlines and bounded output. A fake converter creating the
  destination during execution exposed an overwrite race; publish now uses atomic link-if-absent.
- Independent review found signal-killed converters could leave the sticky ledger clear.
  Regression failed for both missing rejection and wrong 422 mapping; negative statuses now
  become sticky `worker_resource_limit` 413. A provider that catches the rejection cannot
  publish an apparent success. Ordinary positive converter error codes remain unchanged.
- 80 Python tests pass, including real child/descendant process cancellation and cleanup.
  Subprocess-aware coverage: 96.90% statements, 92.05% branches, 95.61% combined.
- 37 TypeScript response-guard tests pass; parser package typecheck passes.
- `ruff check` and formatting pass for the new service. Local merged Compose config passes.
- Full workspace verification is performed by the coordinating change; these focused commands
  were not repeatedly rerun without relevant edits.

## Remaining gates / honest limits

Docker daemon is unavailable on this machine (`/Users/jyong/.orbstack/run/docker.sock` missing).
The real pinned image has therefore **not been built, started, or golden-tested**. The pinned
public MSG fixture is now bundled with its full Apache license and SHA-256 attribution; actual
local oxmsg validates its 30-byte attachment, while full HTTP output remains an image gate.

Converted DOCX/PPTX/HTML structural re-admission is implemented and tested with real child
processes plus generated products. Its image-specific discovery/CLI compatibility still needs
the real golden gate. Hard aggregate request-specific cgroups are not present;
RSS/CPU/PID/tmp sampling can overshoot, and a fast-detaching unobserved descendant is not proven
captured. HTTP PDF self-parallelism is disabled inside this optional worker to avoid admission
deadlock; throughput must be benchmarked before promotion. These are release gates, not completed
production protections. See `services/unstructured-sandbox/README.md`.

No production deployment, database change, user-file upload, commit, or push occurred.
