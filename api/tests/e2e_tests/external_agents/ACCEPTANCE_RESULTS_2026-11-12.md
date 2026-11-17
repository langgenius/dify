# BYOA backend acceptance results — 2026-11-12

The November 12 frontend-feedback contracts passed on isolated candidate14 and candidate15.
The shared Agent dev **origin-only Overview smoke also passed 25 runner assertions**, including
normal authentication, actual file bytes, cancellation confirmation and page-leave revocation.
These are backend results. They do not establish public browser/UI acceptance or completion of
the subsequent full-source registry build, registry promotion or final image-pin rollout.

## Evidence cutoff and version boundaries

- Report cutoff: **2026-11-12 14:10:47 UTC**. Results below retain their own execution windows and scopes.
- Product fix: `dbfac81cac1cab2d7b14edcd306f994ba99c1e7a`, including the queue/server-default correction.
- Shared QA overlay source: `7f6f90c5703373348e51f0a482384bb409ada797`, integrated incrementally over
  the actual Agent dev baseline `a69a8fa067c8f476bf5f507ba47c390e0b02daf7`.
- Candidate14 and candidate15 are separate isolated images. Candidate15 carries the final queue/default
  correction; its success does not relabel candidate14's original 13-suite replay as a candidate15 run.
- The current shared results belong to the **7f QA overlay image**. A full-source image build was running
  at the cutoff. Its success and any future six-service registry pin rollout are **not claimed here**.
- This record identifies the tested product source. The current PR checks track validation of
  subsequent commits; historical CI success is not used as evidence for a later head.
- Delivery remains on [PR #45918](https://github.com/langgenius/dify/pull/45918); this report is not a merge
  or production-release receipt.

## Result summary

| Evidence group | Result | Scope |
| --- | --- | --- |
| Candidate14 frontend-feedback HTTP | Passed | 12 recorded checks, five business messages, verified HTTPS file bytes; backend contracts only. |
| Candidate14 original business replay | Passed | All 13 sequential suites, on candidate14. |
| Candidate14 stricter file profile | Passed | 32 checks at 2/3/6 MiB; effective defaults restored successfully. |
| Candidate15 final queue/default feedback | Passed | 12 checks, five business messages, 11 TLS byte proofs; final product-fix source. |
| Candidate15 dedicated consumer | Observed working | Drain 984/984 received/succeeded; maintenance 16/16. These are task-log counts, not additional business suites. |
| Incremental dev local regression | Passed | 7,558 passed, two macOS platform skips, 136 test modules; separate affected follow-up: 114 passed. |
| Shared QA image and compatibility checks | Passed within scope | 445 existing installed distribution versions retained; Native code and inherited entrypoints preserved. |
| Shared explicit migration | Passed within scope | Targeted default migration applied; 505 existing Native bindings retained with unchanged pre-existing-field snapshot hash. |
| Shared warm replacement | Passed within scope | Six services/seven containers; two ordinary worker replicas and nine old queues retained; no forced kill. |
| Shared authenticated Overview smoke | Passed | 25 assertions, trusted-origin transport, files/cancel/revocation included. |
| Public browser/UI | Not accepted | Four public navigations reached JSON 401 rather than 404; no authenticated UI success. |
| Full-source registry build/promotion/final pins | Not completed by this evidence | Preflight passed; build and later promotion/pin verification are separate gates. |

Checks, task-log counts, byte proofs, modules and unit tests use different denominators.
Overlapping runs are not added together into a new total.

## Candidate14: feedback contracts and original replay

Feedback HTTP run `bc47bda4068144089b47a9ef564adcc7` passed during
**2026-11-12T11:02:45.288494+00:00–2026-11-12T11:03:57.223694+00:00**.
The runner used real Console authentication and CSRF, verified HTTPS peers and actual file bytes.
It explicitly recorded `visual_browser_acceptance=false`.

The feedback checks covered:

- Four stable Verify failure reasons without a business probe or verification proof on failure.
- List sorting/filtering and tab-wide counts; distinct readable App references, with forbidden values
  represented as null rather than fabricated zero.
- PNG icon bytes returned through creation/detail/list and refreshable owned test-file responses.
- Multipart inputs, URL-only paste inference, exact Invocation output refresh and page/generation revocation.
- Empty, active and disabled provider overview responses without exposing secrets.
- A real confirmed-cancellation retry: two attempts, elapsed **68.279298 seconds**, unknown call-total
  tokens preserved as null with coverage 0/2.
- Trace-step zero retained without promoting it into an unproved Invocation-level token total.

The original suites were replayed sequentially on candidate14 during
**2026-11-12 11:21:11.220198–11:33:20.702669 UTC**:

| Suite | Checks | Result |
| --- | ---: | --- |
| `graph_matrix_acceptance` | 6 | Passed |
| `dsl_acceptance` | 8 | Passed |
| `output_error_acceptance` | 28 | Passed |
| `product_acceptance` | 11 | Passed |
| `load_acceptance` | 6 | Passed |
| `acceptance` | 18 | Passed |
| `workflow_acceptance` | 10 | Passed |
| `access_acceptance` | 25 | Passed |
| `export_acceptance` | 6 | Passed |
| `timeout_acceptance` | 6 | Passed |
| `official_sdk_acceptance` | 11 | Passed |
| `connection_matrix_acceptance` | 11 | Passed |
| `file_matrix_acceptance` | 32 | Passed |

The separate strict-file run passed **32 checks** during
**2026-11-12 12:33:30.060289–12:36:46.181424 UTC**.
Document/image/aggregate limits were **2/3/6 MiB** with five files.
The recorded restore succeeded and returned the effective document/image/aggregate defaults to
**15/10/30 MiB**. Neither the limits nor the earlier failures were silently changed into a pass.

Candidate14's source fingerprint was
`64a2f9e23d0c002f8382d86ca71097953ffdf38e462c005d2753014b9896ab52`.
All 2,978 audited source files matched, and the four isolated runtime roles used the same image.

## Candidate15: final queue/default correction

Final receipt: **candidate15**, run `dafa406011274e39822d2036161141ed`,
**2026-11-12T13:35:40.863861+00:00–2026-11-12T13:36:52.792641+00:00**.
The final feedback run passed **12 checks**, **five business messages** and **11 verified TLS byte proofs**.
The confirmed-cancellation retry made two business Sends for two authorized attempts; elapsed time was
**68.234918 seconds**. Missing call-total usage remained null, with coverage 0/2.

- All **2,979 source files** matched the candidate15 manifest: zero missing and zero changed.
- The four isolated runtime roles used the same candidate15 image.
- Source fingerprint:
  `5c4c8d98a811d136907cc99fdaa920a5adc22bf9737e739c3749b073e6ee0377`.
- The isolated default migration retained **228 existing bindings** and their recorded row snapshot.
  This isolated database is distinct from the shared database's 505-binding preservation check.
- The actual dedicated consumer used its own prefork application with concurrency four.
  Drain and maintenance tasks were observed succeeding on that consumer: **984/984** and **16/16**.
- These consumer observations contain no task payloads and do not count as another business E2E run.

Candidate15's receipt explicitly records **`original_13_suites_repeated=false`**.
The original 13-suite replay and strict32 results remain candidate14 evidence; they were not rerun or
renamed as candidate15 passes. Candidate15 also records no visual-browser acceptance.

## Shared Agent dev: actual authenticated origin smoke

Sanitized receipt `main-smoke`, owned run `5b81728f456d451ebf2d0decdb742a13`, passed **25 assertions** during
**2026-11-12T13:57:16.869652+00:00–2026-11-12T13:57:37.004075+00:00**.
The same newly owned test account/workspace was reused after the earlier runner-origin rejection;
there was no second seed or modification of an existing user's identity.

The successful run verified:

1. Normal password login, a fresh CSRF cookie and the exact owned workspace.
2. Authenticated, read-only Features/Summary DTOs, enabled BYOA capabilities and the initial empty list.
3. Server-assigned asset ownership, read-only Verify/Save and the empty provider overview.
4. A real completed Task/GetTask path and truthful unknown-versus-zero statistics.
5. Owned input download, explicit input bytes received by the peer and published output bytes.
6. Refresh/readback and URL-only metadata inference, with four actual 39-byte file/hash proofs.
7. Remote cancellation confirmation without inventing a local `Canceled` result.
8. Page-leave revocation: both relevant owned-file requests subsequently returned **404**.

The peer observed **four owned business messages, each Send exactly once**, and zero Subscribe calls.
The run made **zero model calls** and **zero billing/plan mutations**.
Page-leave was exercised through backend APIs; it is not a browser navigation test.

### Shared file transport boundary

The existing upload host is `agent-upload.dify.dev`. The first runner allowed only the Console origin
and rejected that different upload origin before a file download. That failed receipt was retained.
The correction was confined to the test transport; product file configuration was not changed.

The successful file assertions used **trusted-origin routing for the existing upload Host** with a
separate client. It forwarded no Console cookie, CSRF token, Cloudflare credential or Agent bearer.
The public Cloudflare file path returned **302** and is **not** claimed as an accepted public download
or browser/TLS delivery path by this origin-only result.

### Public browser observation

Four public paths returned JSON **401 — Invalid Authorization token**, with no route 404.
This proves only that those navigations reached the product authentication layer.
It is not authenticated 200, a working UI session, layout/navigation acceptance or public browser E2E.
Both the sanitized shared receipt and the browser observation explicitly exclude visual-browser acceptance.

## Incremental preservation and migration evidence

- Shared source was integrated over the actual dev baseline rather than replacing it with the main PR image.
- The QA image retained all **445 existing installed distribution versions**, 61 audited Native Python files,
  eight legacy provider imports, inherited entrypoints and 4,426 Python files outside the overlay.
- Source preservation separately checked 15,375 files outside BYOA/approved compatibility changes,
  436 domain files and the 114-file trace manifest without unintended changes.
- The native entrypoint's observed ordinary/priority/plugin role selection remained equivalent under
  the existing non-secret configuration. A future full-source image still requires its own image readback.
- Warm replacement preserved two ordinary worker replicas and the existing nine queues; no SIGKILL was used.
- The shared migration advanced only from `e4f9a2c7b681` through `c3025a2a1109` to `c3025dflt1112`.
  It did not upgrade to the unrelated graph head or stamp a revision.
- **505 existing Native bindings** retained their count and pre-existing-field snapshot hash.
  The new binding configuration column had its non-null constraint and empty-object server default.
  No pending KnowledgeFS tables were introduced by this targeted upgrade.
- Shared rendered configuration retained **31 existing service definitions**, adding only the dedicated
  external worker. The separate repository Compose comparison retained **47 existing source definitions**.
  These are different configuration scopes, not competing counts or a combined total.
- Real PostgreSQL **15.19** and MySQL **8.0.46** tests covered fresh/default-repair paths, legacy writes,
  repeated migration and preservation. They are distinct from the shared origin smoke.

## Build, CI and publication gates

The product follow-up passed changed production/strict-test type checks, Ruff, import/response contracts
and introduced-code guards. These local checks remain distinct from the subsequently pushed-head CI.

Full-source Dockerfile preflight passed the lockfile, local-wheel and Docker build-context checks.
The full-source GitHub Actions image build was **still running at the evidence cutoff**; it is not
reported as passed. The running shared QA overlay does not prove a later registry artifact is equivalent.

Registry/source promotion, final six-service image pins, post-pin readback and any remaining temporary
QA configuration cleanup are separate steps. This report does not claim that they have completed.
Pushed-head CI and review status are tracked on PR #45918. Historical CI success belongs to its
original tested head and is not reused for the new head.

## Limits

- Shared acceptance is an **owned Overview origin smoke**, not all BYOA routes or all role/tenant matrices.
  It does not claim nonzero App references, foreign-role reads, configured provider states, NodeDebug file
  links, generic production cancellation or a real call-total-zero transport.
- One-hour/24-hour lifecycle, 24-hour/300-query tracking and the 60-minute logical budget use controlled
  clocks with real persistence. No real 24-hour soak or external-service availability guarantee is claimed.
- Capacity/admission and resource results are bounded observations on the tested configuration, not a
  production throughput/latency SLO, an unlimited-storage result or an all-provider network matrix.
- MySQL evidence covers real database/runtime and gateway behavior. It is not a second complete MySQL
  Console/Graphon/broker E2E deployment or the entire archive/delete matrix.
- Cross-App Workflow-as-Tool remains unsupported before Send. Native process loss after checkpoint claim
  avoids replay and fails at the original deadline; arbitrary-crash whole-graph exactly-once is not claimed.
- Trace-step usage is not Invocation usage proof. Missing totals stay null; zero is retained only where
  the relevant adapter/persistence contract establishes it.
- UI/browser layout, copy, navigation and frontend interaction acceptance remain outside these results.

## Reproduction and safe receipt identifiers

Use the isolated environments and setup in [README.md](README.md) and the contract boundaries in
[ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md). Key entrypoints are
[frontend_feedback_acceptance.py](frontend_feedback_acceptance.py),
[workflow_acceptance.py](workflow_acceptance.py), [access_acceptance.py](access_acceptance.py),
[file_matrix_acceptance.py](file_matrix_acceptance.py), [timeout_acceptance.py](timeout_acceptance.py),
[official_sdk_acceptance.py](official_sdk_acceptance.py) and
[mysql_runtime_acceptance.py](mysql_runtime_acceptance.py).

- Candidate14 feedback: owned run `bc47bda4068144089b47a9ef564adcc7`.
- Candidate14 original replay: 13 sequential suite receipts, November 12 11:21:11–11:33:20 UTC.
- Candidate14 strict profile: `strict14-20261112-file_matrix_acceptance`, restored defaults.
- Candidate15 final receipt: owned run `dafa406011274e39822d2036161141ed`.
- Shared sanitized receipt: `main-smoke`, owned run `5b81728f456d451ebf2d0decdb742a13`.
- Earlier retained runner-origin rejection: owned run `d1a6f91b0ee044d6b532b9697ea2b16f`.

Only synthetic/owned run identifiers, counts and source fingerprints are published here.
Credentials, signed URLs, account identifiers, private transports, machine paths and raw logs are omitted.
