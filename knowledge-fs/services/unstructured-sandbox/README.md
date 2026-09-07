# Optional request-isolated Unstructured runtime

Status: **implemented and locally process-tested; not approved for production activation**.
The default deployment is unchanged. This is an override of the existing dedicated
KnowledgeFS Unstructured service, not another per-format service. Legacy Dify's
`unstructured` service is unaffected.

## Boundary and contract

The single supervisor accepts `POST /general/v0/general`, reserves a bounded shared slot,
spools a bounded multipart body, and starts a disposable process group. That process applies
resource limits, checks nested mail and Office archives, and replays the **unchanged** ASGI
request into the pinned original API. Its original API-key check, form interpretation,
response status, and response body remain in that worker. No upstream monkeypatch is used.
All KnowledgeFS API replicas pointing to this one service share its admission queue.
Multiple sandbox replicas still multiply capacity; there is no distributed semaphore.

This internal endpoint accepts exactly one file, at most 128 form parts, and no arbitrary
upstream routes. `/healthcheck` is **supervisor liveness**, not proof that models or every
format are ready. The real-format golden gate below is required for readiness validation.

The optional worker disables upstream HTTP self-recursive PDF parallelism to avoid waiting
on its own service-wide admission slot. Text/layout semantics are retained, but long-PDF
throughput may decrease. This must be measured before replacing the default page-parallel
service. No production default is changed to hide this trade-off.

## Resource protection

| Boundary | Default | Enforcement |
| --- | --- | --- |
| Accepted / waiting requests | 1 / 8 | Atomic supervisor admission, 30 s queue deadline |
| Input / response / metadata | 51 MiB / 32 MiB / 64 KiB | Bounded spool / worker output / metadata |
| Request wall time | 2,400 s | Supervisor kill on expiry; upstream client disconnect also kills |
| Worker address space / CPU / file size | 32 GiB / 2,400 CPU s / 256 MiB | Linux inherited rlimits before provider imports |
| Process-tree RSS / processes / temporary bytes | 4 GiB / 64 / 512 MiB | 50 ms sampled supervisor checks |
| Container RAM / PIDs / temporary filesystem | 6 GiB / 192 / 1 GiB | Docker hard limits and tmpfs; read-only root |
| Attachment depth / count / decoded bytes | 8 / 128 / 128 MiB | Shared admission tree, not fresh limits per attachment |
| Archive entries / expanded bytes | 4,096 / 512 MiB | Declared precheck and actual incremental inflation |
| XML total / member / depth / nodes | 64 MiB / 16 MiB / 128 / 1,000,000 | Streaming Expat admission, no entity expansion |
| Worksheet rows / columns / rectangle | 100,000 / 16,384 / 250,000 cells | Actual explicit and implicit cells; merged ranges included |
| All worksheet rectangles / sheets | 500,000 cells / 256 | Shared across nested attachments |

The supervisor kills the request's process group after success as well as failure, and
observed descendants that changed sessions. Temporary files are removed before admission
is released; a stalled response consumer cannot hold a slot beyond the deadline.
Unknown attachment extensions are **rejected explicitly**, not silently omitted. This is
all-or-nothing admission, not a partial-success attachment extraction implementation.

These limits are not a native-code exploit sandbox. Linux `RLIMIT_AS` limits virtual address
space, not RSS; process-tree RSS/CPU/disk checks are sampled and can overshoot between polls.
`RLIMIT_FSIZE` is per file, not a disk quota; aggregate hard tmpfs/RAM/PID limits belong to
the container, not each request. A process that immediately detaches before being observed
is not proven captured by the process-tree monitor. Do not advertise hard per-request
cgroup isolation or complete protection against arbitrary native-code compromise.

Conversion processes and in-process legacy XLS readers inherit the request resource boundary.
Version-scoped executable adapters intercept the pinned Unstructured DOC/PPT LibreOffice and
RTF/EPUB/ODT Pandoc invocations. The original executable paths are captured into an immutable
build-time manifest before wrapper installation; no Python parser function is monkeypatched.
Generated DOCX/PPTX/HTML stays in a private directory until structural admission succeeds.
Office archives use the same archive/XML/worksheet guards; HTML has node/depth and rectangular
table limits, including rowspan/colspan. A file-locked ledger shares the root/mail admission
budget across all conversions. Products and converter stdout are bounded to 64 MiB; stderr
is bounded to 64 KiB. Validated files are atomically published without overwriting an existing
file, and validated HTML stdout is then returned unchanged.

Unknown invocation shapes, malformed/oversized products, signal-killed converters and budget
failures reject the whole request through a sticky ledger, even if upstream catches an
attachment exception. Ordinary positive converter error statuses retain upstream behavior.
The adapters accept only inspected argument shapes, including Pandoc version/format probes;
the actual pinned image's converter discovery and every real-format fixture remain mandatory
activation gates. Local fake-executable tests alone do not prove image compatibility.

## Local tests

From the Dify repository root, using the existing API development environment:

```sh
PYTHONPATH=knowledge-fs/services/unstructured-sandbox uv run --project api python -m unittest discover -s knowledge-fs/services/unstructured-sandbox/tests
uv run --project api ruff check knowledge-fs/services/unstructured-sandbox
```

Runtime tests need Python 3.12, `psutil`, `uvicorn`, `python-oxmsg`, and `olefile`; they do not
require Unstructured, Torch, Docker, or production access. These dependencies are present in
the existing API environment; the service image reuses its pinned dependencies. For coverage,
use coverage.py >= 7.10 with the
`.coveragerc` subprocess patch, an isolated `COVERAGE_FILE` path, then `coverage combine`.
The latest local run covers 96.90% statements and 92.05% branches (80 tests). Golden-runner
unit tests validate fixture builders; they do not pretend to validate the real provider.

## Real-image gate (requires a working Docker daemon)

Build and run only in a disposable local/staging environment first. The image build checks
the pinned dependency's actual version and original ASGI import, and fails if startup,
shutdown or a custom lifespan hook requires a replay lifecycle this worker does not provide.
The inspected upstream app initializes at import and has no such hooks. The current base
digest is unchanged, and no new unpinned Python dependency is installed during the build.

```sh
docker compose --env-file knowledge-fs/infra/local/.env.example -f knowledge-fs/infra/local/compose.yaml -f knowledge-fs/infra/local/compose.unstructured-sandbox.yaml build unstructured
docker compose --env-file knowledge-fs/infra/local/.env.example -f knowledge-fs/infra/local/compose.yaml -f knowledge-fs/infra/local/compose.unstructured-sandbox.yaml up -d unstructured
docker compose --env-file knowledge-fs/infra/local/.env.example -f knowledge-fs/infra/local/compose.yaml -f knowledge-fs/infra/local/compose.unstructured-sandbox.yaml exec unstructured python3 /opt/kfs-sandbox/golden.py
```

The golden runner generates tiny synthetic PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, ODT, EPUB,
RTF and nested EML fixtures inside the container. It also uses a bundled Apache-licensed
MSG from the exact Unstructured 0.22.18 source revision, with a checked SHA-256 and an explicit
attachment-text assertion; source and license are in `fixtures/`. The real local oxmsg parser
has validated that fixture's attachment, including renamed `.xls` content detection.
The gate verifies actual returned evidence and that a tiny sparse XLSX email attachment is
rejected before pandas processing. It refuses non-loopback URLs and never uploads user
documents. Optional `--msg-fixture /path/to/synthetic.msg` accepts an alternative ≤1 MiB
fixture whose attachment contains `KnowledgeFS Golden Evidence`. A missing/corrupt bundled
fixture fails rather than silently skipping MSG. Trusted tiny fixture generation uses the
manifest's original executables outside request admission; HTTP parsing uses the wrappers.

Required before activation:

1. Build and pass all real-format fixtures under the read-only/tempfs limits. Confirm the
   pinned image's model caches and LibreOffice configuration work without unexpected writes.
2. Verify the converter adapters with the actual image's Pandoc discovery, DOC/PPT conversions,
   RTF/EPUB HTML stdout and ODT DOCX output. Unknown shapes fail closed, never bypass admission.
3. Benchmark ordinary documents and long PDFs against the unchanged default: cold-start
   latency, p50/p95, peak RSS, table/image/text recall, and cancellation behavior.
4. Run a staging canary and promote an immutable built sandbox image. Set the API's
   `UNSTRUCTURED_BACKEND_REVISION` to the tested sandbox image/policy revision, so old
   checkpoints are not mistaken for the new semantic implementation.

Hard per-request RAM/PID/tmp quotas additionally require delegated cgroup/storage enforcement
and deployment authority; this implementation does not claim those protections.

Only after these gates, the production override is
`docker/knowledge-fs-unstructured-sandbox.compose.yaml`, merged with the existing
`docker/docker-compose.yaml`. Its hostname remains `knowledge_fs_unstructured:8000`.
The override itself does not deploy anything.

## Source basis

The boundary was checked against the pinned [EML partitioner](https://github.com/Unstructured-IO/unstructured/blob/0.22.18/unstructured/partition/email.py),
[MSG partitioner and public oxmsg access](https://github.com/Unstructured-IO/unstructured/blob/0.22.18/unstructured/partition/msg.py),
[Office conversion implementation](https://github.com/Unstructured-IO/unstructured/blob/0.22.18/unstructured/partition/common/common.py),
[RTF/EPUB conversion](https://github.com/Unstructured-IO/unstructured/blob/0.22.18/unstructured/file_utils/file_conversion.py),
[ODT conversion](https://github.com/Unstructured-IO/unstructured/blob/0.22.18/unstructured/partition/odt.py),
[pypandoc argument construction](https://github.com/JessicaTegner/pypandoc/blob/v1.15/pypandoc/__init__.py),
and upstream [ASGI API](https://github.com/Unstructured-IO/unstructured-api/blob/main/prepline_general/api/app.py).
The pypandoc source describes the inspected CLI family, not an assertion that its exact version
inside the unavailable image was inspected.
The latter source explains the boundary only; the actual image import/build and golden
contracts, not a moving branch, are the compatibility authority.
