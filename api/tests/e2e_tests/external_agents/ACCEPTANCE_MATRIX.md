# BYOA backend acceptance matrix

Evidence snapshot: **2026-11-10**. This matrix maps reviewed product requirements to backend contracts and
reproducible suites. A passing suite means its recorded assertions passed on the recorded candidate; it does
not mean every PR check, frontend flow, deployment configuration, or release gate has passed.

The current implementation candidate is **candidate12**, which uses a dedicated cold-spawn worker bootstrap.
Its final sequential **13-suite business replay passed**, as did the independent stricter 2/3/6 MiB file
profile and actual Linux CLI/storage/timeout probe; default settings were restored. Candidate12's final
fault/admission replay and consumer-ready cancellation cleanup have passed; the worker was restored. The [versioned results](ACCEPTANCE_RESULTS_2026-11-10.md) include
synthetic run IDs and the tested production fingerprint without requiring private-host access.

## Requirement baseline

| Source | Reviewed version |
| --- | --- |
| [BYOA PRD](https://langgenius.feishu.cn/wiki/XPY8w56jeig0Y4kgWnjc20E1njf) | Document `KrNcdfQN6o2p7Wx0bjFczCqMnpc`, revision **777**. |
| [Prototype and interaction specification](https://langgenius.feishu.cn/docx/VFeMdSiHzoFXEoxZ8FRcVbOunMd) | Revision **1177**. Prototype screenshots describe intended behavior, not backend execution evidence. |
| [Figma Agent Roster](https://www.figma.com/design/LM3lbw9ktotWgx3tTVzlRZ/Agent-Roster?node-id=3484-44220) | File `LM3lbw9ktotWgx3tTVzlRZ`, root `3484:44220`, section/frame index reviewed on 2026-11-10. No immutable Figma file revision is claimed. |
| [Backend design](https://langgenius.feishu.cn/wiki/Wu0swoWfriGEoQkPyDTcN3Sfnyf) and the seven user-confirmed decisions | Frozen on **2026-11-09**. Explicit user decisions take precedence over unresolved values or broader behavior in the PRD/prototype. |

The frozen contracts are:

| Decision | Backend acceptance boundary |
| --- | --- |
| 1. Protocol | A2A 1.0, specification v1.0.1; HTTP+JSON; None/Bearer; Task or direct Message; SSE followed by GetTask for a known Task. No business resend to recover a stream. No dependency on Subscribe, 0.3, JSON-RPC, gRPC, or Push. |
| 2. Verify | Read-only network/profile/Card and available read-auth checks; no business Task. Explicit authentication failure cannot produce save evidence. A public Card can be saved with its precise unverified execution-auth scope. |
| 3A/3B. Content | Explicit text/file references only; actual bytes; PDF/TXT/MD/PNG/JPEG intersected with Card default modes. Exact output names and strict types; files must reach Dify storage. Legal typed defaults/Error Handling do not replay the remote Task. |
| 4. Timeout/cancellation | Three policies, default End waiting. A retry creates a new business call only after confirmed Canceled and within the original budget. Unknown submission, rejected/unsupported/unconfirmed cancellation, and output failures do not authorize resend. Late completion cannot reopen ended local execution. |
| 5. Editing/testing | Owner/Admin presentation edits need no Verify and preserve production context. Successful actual edits advance Test generation; inputs remain, old display results/Trace cannot refill it, and old accepted Tasks are not implicitly canceled. All File-valued defaults remain disabled. |
| 6. Context | Reuse only the server-returned context under the same conversation, node, binding epoch, connection revision, and execution frame. New turns omit old Task IDs. Unresolved work is Busy; switching/rebinding cannot resurrect prior context. |
| 7A/7B. Limits/lifecycle | Frozen wait/transport/retry/file/query budgets, source-App production retention, bounded temporary tests/files, old-credential drain, and minimum unresolved-context retention. Deployment limits may be stricter. Long windows require persisted-clock evidence; elapsed time alone never proves remote termination. |

## Figma references

These IDs identify behavior sources. Tests assert their backend consequences, not pixels, copy layout, panel
placement, hover states, or navigation implementation. Imported conventions do not expand the frozen scope.

| Area | Section ID | Representative frames |
| --- | --- | --- |
| Connect external agent | `3569:72021` | `3624:16063` connect; `3629:33302` unreachable; `4084:82202` invalid Card; `4317:84832` auth failure; `4317:85202` unsupported endpoint. |
| Workflow | `3572:28675` | `4084:80360` connected; `4010:34114` Not connected/checklist; `4209:99253` disabled; `4209:19402` wait/error handling; `4529:23266` timeout options; `4529:23268` text-only input. |
| Run logs | `3576:30221` | `4209:92868` Last Run; `4209:93679` canceling; `4209:93791` canceled; `4209:93902` unconfirmed; `4249:103941` partial Trace; `4249:104340` no steps; `4249:104673` unavailable; `4249:105700` tracing off. |
| Output variables | `3611:34896` | `4222:23227` output variables; `4529:29256` duplicate name; `4529:29257` invalid default; `4529:29258` File output; `4278:104466` node default handling. |
| Test agent | `3705:29732` | `4042:36005` Test panel; `4309:124730` node test input; `4308:16509` empty result after a change. |
| Overview/management | `3717:31492` | `4002:33053` Overview; `4762:98097` Edit info; `4705:74605` Editor read-only; `4081:34714` Monitoring; `4081:35386` no calls; `4368:262631` aggregate-only member; `4608:47631` App filter. |
| Edit connection | `3758:36664` | Technical/service changes, save/conflict behavior; `3849:32198` edit conflict. |
| Disable | `3758:36666` | `3759:38873` disable confirmation; `4706:20666` disabled asset. |
| Delete | `3759:37814` | `4813:16539` delete confirmation; `4318:129715` deleted Agent. The replaced `4289:17263` frame is not an additional requirement. |
| Reference designs from other files | `3762:78155` | Design references only; these imported examples do not add backend requirements. Referencing-App visibility comes from the Overview and deletion requirements above. |
| Shared file/status conventions | `4101:37895` | File upload, run-status and state conventions only; no additional OAuth or other product implementation is implied. |

## Contract-to-test mapping

All runner names below are modules under `tests.e2e_tests.external_agents`. Setup and invocation are described
in [README.md](README.md); the official SDK has a [separate pinned environment](official_sdk_README.md).
Suites run sequentially against an isolated migrated deployment with real Console cookies/CSRF, PostgreSQL,
Redis, durable queue consumers, and a controlled HTTPS peer. Reports use synthetic IDs and validation facts.
The MySQL runtime/gateway integration uses its own isolated database and validator processes, rather than
reconfiguring that PostgreSQL Console deployment.

| Backend contract / product source | Suites and assertions | Evidence classification at this snapshot |
| --- | --- | --- |
| Connection admission and precise Verify scope. PRD “Connect External Agent”; Connect section. | `connection_matrix_acceptance`, `acceptance`, `access_acceptance`: required/optional/malformed Cards; unsupported required extension; explicit 401; no business Send on Verify/Save; no invented/failed proof can save; write-only Bearer. | Candidate12 final sequential connection/acceptance/access suites passed (11/18/25 checks). The earlier failed candidate9 connection attempt remains recorded rather than being waived. |
| Technical and business change warnings. PRD “Update Connection”; Edit connection section. | `connection_matrix_acceptance`: independent warning groups, combined changes, warnings do not block valid save, no-op has empty warnings/no generation bump, local Role/name/explicitly cleared Description preserved, unsupported Trace collection disabled. `test_connection_warnings.py`: MIME aliases/parameters and wildcard coverage are compared without rewriting stored declarations. | Candidate12 final sequential connection matrix passed all 11 checks with the corrected worker bootstrap; MIME comparison also has 12 passing focused tests. Earlier worker process failures remain recorded without a speculative C-stack root-cause claim. |
| Asset availability, references and deletion. PRD “Disable, Enable, Delete”; Overview/Disable/Delete/References sections. | `product_acceptance`: references include current graphs before any production history; Editor/Admin App scope; Normal/foreign denial; in-flight warning; two published Workflows and Chatflow stop new Send while disabled; Overview Test remains allowed; enable needs no republish; deleted/same-name new assets do not revive old bindings or rewrite historical identity. | Candidate12 final sequential product report passed. The warning is advisory and may cover hidden work without exposing its App identities/counts; it is not a reservation against a later dispatch. |
| Workflow/Chatflow execution and historical identity. PRD “Node configuration”; Workflow/Run logs sections. | `workflow_acceptance`, `product_acceptance`, `official_sdk_acceptance`: real Start→External→End, durable ExternalWait, exact Node Test/Last Run, published service calls, original Invocation/configuration in node history, metadata edits preserve context, new connection gets fresh context while accepted old work keeps its original revision. | Candidate12 final sequential product, Workflow/Chatflow and official SDK reports all passed after the worker-bootstrap change. |
| Busy, binding epochs and frame isolation. PRD “Chatflow external context”; Workflow section. | `workflow_acceptance`: two turns reuse remote context, omit old Task ID, Busy sends nothing, A→B→A does not resurrect context. `graph_matrix_acceptance`: parallel Iteration, nested Loop, Loop containing parallel Iteration, independent execution/context identities, exact ordered distinct results, stop followed by late result cannot revive graph. | Candidate12 final sequential graph report passed: 3 + 4 + 6 distinct results across its three graph shapes, plus stop/late-result checks. This is execution evidence, not only frame-identity unit coverage. |
| Fixed protocol interoperability. PRD Task/Message behavior; Connect/Workflow/Run logs sections. | `official_sdk_acceptance`: unmodified official `a2a-sdk` 1.3.0 HTTP+JSON routing/validation/serialization, direct Message, asynchronous Task/Get, raw input/output, confirmed Cancel, real 30-second SSE window→Get, Workflow pause/resume. No 0.3 compatibility adapter. | Candidate12 final sequential dev report passed: 11 checks, Send 6, Stream 1, Get 5, Cancel 1, Subscribe 0; seven business messages. The loopback smoke is supplementary, not dev evidence. |
| Explicit input bytes and effective boundaries. PRD Task/files; file/status conventions. | `file_matrix_acceptance`: all five input formats, only referenced files sent, SHA-256 peer proof, exactly 5 files, 15 MiB documents, 10 MiB images, 30 MiB aggregate and rejection beyond each effective limit. `connection_matrix_acceptance`: a Skill accepting PDF cannot widen text-only Card defaults. | Candidate12 final sequential default-file and connection passed (32/11 checks); its independent 2/3/6 MiB profile also passed 32 checks. Strict-worker log observation recorded no native-fatal/SIGSEGV markers; defaults were restored in cleanup. |
| File output attribution and durable materialization. PRD “Output Variables”; Output/file conventions. | `file_matrix_acceptance`, `acceptance`: named Artifact match, unnamed unique target, no fuzzy/multiple-target match, structured/file conflict; actual Workflow downstream reads stored bytes; URL/raw output; credential not forwarded to output URL. Oversized/ambiguous output fails after one authorized Send rather than re-running the Task. | Candidate12 final sequential default-file passed 32 checks, and its separate stricter profile passed 32. The previous repeated-file worker failure is preserved as a failed candidate9 attempt. |
| Strict output validation and node handling. PRD “Output validation and failure handling”; Output variables section. | `output_error_acceptance`: exact/case-sensitive fields, no number/string/boolean coercion, arrays/objects/null, optional omission, legal typed empty defaults, no File/default nested File, ambiguity cannot be hidden by defaults, node default/fail-branch/unhandled failure. Assert node status separately from final Workflow status and one business Send per execution. | Candidate12 final sequential report passed with 28 recorded checks. Expected output failures and handled `partial-succeeded` runs are successful negative assertions, not silent passes or remote retries. |
| Portable configuration and explicit rebinding. PRD “Copy/import/export”; Workflow section. | `dsl_acceptance`: actual same-Workspace copy and YAML import execute; cross-Workspace import remains unconnected, publish denied; matching nodes rebind atomically; current configuration/edges/epochs preserved; no credential/endpoint export, including `include_secret`; actual foreign Workflow executes without old context. | Candidate12 final sequential report passed with 8 checks and 8 fixture business sends across the execution cases. No UI-only or SQLite-only substitute is used for this claim. |
| Three timeout strategies and cancellation uncertainty. PRD “Wait limit / On timeout”; Workflow/Run logs sections. | `timeout_acceptance`: actual 60-second node deadlines, End waiting vs cancellation, confirmed-Canceled-only new Send, preserved retry bytes, late history only. `acceptance`: cancel rejected/unsupported/unconfirmed and unknown submission. Persisted state tests cover original logical budget, retry exhaustion, complete/cancel races and bounded scheduling. | Candidate12 final sequential timeout and original acceptance passed (6 and 18 recorded checks). This matrix does not claim that all long budgets were waited out in wall time. |
| Trace, raw data and export isolation. PRD “Internal trace”; Run logs/Overview sections. | `acceptance`, `access_acceptance`, `export_acceptance`, `product_acceptance`: exact Traceability carrier, owned step/raw queries, real role/tenant/generation fences, missing/zero distinction, asset/App OTLP export and independent destination failure, export-only retry. Trace normalization/duplicate/partial/parent cases have focused persisted regressions. | Candidate12 final sequential product preserves a real reported step zero; acceptance/access/export passed (18/25/6 checks), with no skipped role checks. One tested provider path does not establish an all-provider matrix. |
| Four production metrics under one App scope. PRD “Monitoring”; Overview/Monitoring frames. | `product_acceptance`: one asset in two published Workflows plus Chatflow, real production dispatches, App/total/daily Calls and weighted mean agreement, Overview/NodeDebug exclusion, missing call usage stays null, no-call coverage stays null. `access_acceptance` and observation tests: Normal aggregate-only and revoked/foreign access. | Candidate12 final sequential product report passed: 7 production dispatches vs 10 fixture business messages, with test/debug work excluded from Monitoring. This does not manufacture a call-total token proof. |
| Temporary files, retention, archive/delete fences and old secrets. PRD “Data protection and retention”; Test/Overview/file conventions. | `access_acceptance`: submitted input survives page leave while late output is blocked. `test_file_lifecycle_repository.py`, `test_test_file_repository.py`, `test_observability_repository.py`, `test_trace_delivery_recovery.py`: real persisted leases/tombstones, shared originals, fixed expiry, archive/delete integration hooks, delayed writes/GC, old revision IO drain, current connection survival, unresolved minimum context. | Persisted regression evidence, plus actual API page/file flows. 1h/24h retention and the 60-minute logical budget use controlled-clock persistence/state tests; no real 24-hour soak is claimed. |
| Recovery without duplicate business dispatch. PRD waiting/unknown-result handling; Run logs states. | `fault_acceptance` phases: known Task worker restart continues Get; peer accepted before any receipt, worker process loss, no invented Task identity and no second Send. Runtime repository/Graphon tests cover early Wake, repeated command/fence and original budget. | Candidate12 four-phase fault replay passed: known identity retained, Unknown never guesses a Task ID or repeats Send. Killing/stopping was limited to the isolated external worker; restoration is recorded. |
| Query admission and observed worker progress. Frozen 7A/7B limits. | `capacity_acceptance` phases: real PostgreSQL 20-per-Workspace / 5-per-endpoint lease admission and exact cleanup; this exercise performs no query IO. `load_acceptance`: eight paused graphs, four foreign calls, bounded real 2-second Get IO, Native progress while external work remains pending, twelve original calls finish once. | Candidate12 final sequential real-IO load passed on the cold-spawn deployment. Its final PostgreSQL 20/5 admission and consumer-ready cleanup passed (35 API cancellations confirmed, all 25 leases returned). Startup/per-child costs remain part of the bounded observation, not a throughput/latency SLO. |
| Real MySQL migration, runtime and gateway isolation. Database portability boundary. | `mysql_runtime_acceptance` `sql`/`http_prepare`/`http_resume`, plus independent audit: real Flask migration, idempotency, four-thread single-winner dispatch marker, stale CAS/lease fences, unknown/Busy/frame isolation, fresh-process Get of the same Task, real file bytes/materialization/cancellation, foreign-owner rejection. | MySQL 8.0.46 REPEATABLE-READ passed on the recorded validation9 database-runtime image. Two cold HTTP processes produced six real peer messages, each Send 1; the final read audit passed. This is runtime + HTTPS gateway evidence, not MySQL Console/Graphon/broker E2E or candidate12 worker evidence. |
| Dedicated worker cold reconstruction, native storage and task limits. Deployment/runtime boundary. | Actual Linux CLI entrypoint uses process-local `ExternalSpawnCelery`; Celery's prefork pool machinery starts Billiard cold-spawn children, rebuilding Flask/composition rather than pickling parent resources. A warmed-parent native-storage probe uses default concurrency four, sixteen file tasks, recycling and independent child contexts; reduced-timeout probes verify post-timeout recovery. | Candidate12 CLI probe passed: 16 tasks across 8 storage child PIDs; soft limit observed at 2.093 s and hard at 4.010 s, then storage passed in a new child. Production task limits stay 100/110 s; 60 s governs child startup only. The probe is separate from the now-passed 13-suite candidate12 business replay and does not replace the separately passed fault/admission gate. |
| Existing behavior and deployment contract. Backend compatibility boundary. | `workflow_acceptance` Native Start→End; `packages/graphon/tests/test_external_wait.py`; targeted Native/HITL/runtime/controller/Celery/schema regressions; generated-contract and import-boundary checks. Source manifest/image parity accompanies dev evidence. | Final 52-file local regression: 1,459 collected, 1,457 passed, 2 skipped, zero failures/errors, 25.86 s. The two full-shell tests skip on macOS Bash 3 because they require Bash 4+; both complete Linux shell paths passed separately. Local lint/type/Console mapper/generated-contract types passed. Pushed-head CI remains independent. |

## Evidence snapshot and final-candidate gate

Candidate12's final sequential run covered graph (6 checks), DSL (8), output (28), product (11), load (6),
original API (18), Workflow (10), access (25), export (6), timeout (6), official SDK (11), connection (11),
and default file (32). All 13 passed, starting between 2026-11-10 04:10:28 and 04:22:03 UTC. Counts include
setup/negative assertions and must not be summed into a unit-test count. The full run IDs and completion
window are preserved in [the versioned result summary](ACCEPTANCE_RESULTS_2026-11-10.md).

Earlier candidate9 connection and repeated-file attempts observed worker process failures/SIGSEGV. A minimal
standalone probe did not establish the original C-stack fault; no speculative upstream-library root cause is
claimed. Those failed attempts remain recorded. The process-isolation correction is supported by the actual
CLI/warmed-parent storage probe, both file-limit profiles and the complete final business replay.

The corrected implementation is candidate12: the dedicated `ExternalSpawnCelery` factory reconstructs each
cold child locally, preserves the CLI API import path in its environment, and initializes child fast-trace
state. It retains the prefork pool's soft/hard timeout and recycling mechanisms. Only startup readiness uses
the 60-second allowance; production command soft/hard limits remain 100/110 seconds. The actual Linux CLI,
warmed-parent storage, recycling and timeout probe passed as described above.

Candidate12 connection (11 checks), default-file (32) and stricter 2/3/6 MiB file (32) runs passed. The strict
worker's observed log window contained zero native-fatal/SIGSEGV markers, and cleanup restored default limits.
The later final sequential 13-suite business replay also passed on this worker. Candidate12 fault/admission
checks passed independently of the business replay. Consumer readiness was established by real Get progress before starting the unchanged 30-second cancellation windows; the earlier unconfirmed cleanup is retained as failed evidence.
The completed MySQL runtime/gateway run remains labeled with its validation9 image and narrower integration
scope. A prior candidate's report or the worker probe is not silently relabeled as a final business-suite pass.
The final 52-file local regression completed with 1,457 passed, 2 explicit platform skips, and no failures/errors
out of 1,459 collected tests. The complete Linux shell paths cover both an unset and a preconfigured `PYTHONPATH`;
the macOS Bash-3 skips do not replace those Linux assertions. Do not sum earlier overlapping focused runs.
For each final run, preserve the suite result, run IDs, source/image manifest and relevant operation/byte
proofs in the local evidence report. A mutable report filename alone is not a version identifier.

The final review must check the actual pushed head and its CI. This document does not authorize merge or
production release, and no task is marked complete solely because a fixture or local check passed.

## Limits of the conclusions

- A2A 1.0 has no standardized call-total token proof in the default adapter. A reported Trace **step** total
  of zero is preserved as zero, but is not promoted to Invocation usage. Real product API evidence therefore
  expects call `reported_tokens=null` and coverage zero when calls exist without proof; no calls yield null
  coverage. Trusted call-usage zero/dedup behavior is covered through its explicit adapter/persistence contract.
- Long lifecycle/budget tests manipulate trusted clocks and real persisted state. They do not establish a
  24-hour wall-clock soak, external-service availability, or provider-specific retention guarantees.
- Load reports describe a bounded default-worker experiment and sampled resources. They do not establish a
  production SLO, maximum safe tenant population, all-provider compatibility, or unlimited storage/GC capacity.
- Cold-spawn worker readiness, recycling and native storage have direct Linux CLI evidence. That evidence is
  separate from business-suite completion, and the new startup/per-process memory cost must remain visible in
  deployment capacity planning. The two local macOS Bash-3 shell skips are reported explicitly; both complete
  Linux shell paths passed separately.
- MySQL evidence exercises real migration, repositories/runtime and HTTPS gateway across fresh processes.
  It does not establish MySQL-backed Console login, Graphon recovery, broker delivery or the full user-facing
  PostgreSQL suite on MySQL.
- Cross-App Workflow-as-Tool currently rejects the unsupported profile before Send. That path is not accepted
  as supported by a passing ordinary Workflow/Chatflow test.
- If the process dies after claiming a Native resume checkpoint, the implemented guarantee is to avoid
  replaying Native side effects and fail safely at the original logical deadline. It is not arbitrary-crash
  whole-graph recovery or exactly-once execution of every external side effect.
- UI/browser layout, copy, navigation, selection-panel behavior and frontend integration remain separate
  acceptance work. Backend states/permissions needed by those flows are tested here; no visual pass is implied.
- The default-off rollout, final migration/deployment review, PR review/CI and production release remain
  explicit gates. Dev acceptance does not make a production change.
