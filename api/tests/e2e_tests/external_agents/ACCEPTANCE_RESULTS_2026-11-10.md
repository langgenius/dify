# BYOA backend acceptance results — 2026-11-10

**Candidate12 passed all 13 sequential business suites** through real Console/service APIs, PostgreSQL,
Redis, dedicated worker processes, owned file storage and verified HTTPS peers. The stricter file profile,
actual Linux worker CLI probe, local regression and the separate MySQL runtime/gateway integration also
passed. **Candidate12 known/unknown process-loss recovery, PostgreSQL admission and consumer-ready cancellation cleanup also passed; the dedicated worker was restored.** These results
do not claim PR CI, frontend/browser acceptance, merge or production release.

## Provenance

- Requirement baseline: PRD revision **777**, prototype revision **1177**, Figma file
  `LM3lbw9ktotWgx3tTVzlRZ`, root `3484:44220`; the seven user-confirmed decisions take precedence.
  Section/frame references and exact contracts are in [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md).
- Tested implementation: **candidate12**. Production Python plus entrypoint source fingerprint:
  `aa53ae1c2d93113fbf90b9f7a3bcd7bc1e3ce9aa30faa15a765729d0a7f5dfaa`.
  This identifies the tested production manifest, not a self-referential commit hash for this document.
- Sequential business run: **2026-11-10 04:10:28–04:22:49 UTC**. Each run below started in that final replay
  window and returned `passed`; earlier candidate reports were not relabeled as final passes.
- Reports contain synthetic resource/run identities, states, operation counts and byte proofs. No credential,
  request/Trace body, host path, private service address or actual database URL is included here.

## Final sequential business run

“Checks” are runner assertions, including setup and expected-negative cases, not independent unit-test counts.
They must not be added to the local regression total.

| Suite | Result | Checks | Synthetic run ID | Recorded contract |
| --- | --- | --- | --- | --- |
| `graph_matrix_acceptance` | Passed | 6 | `03f322eb66d547eab1710653649ce75d` | Parallel Iteration, nested Loop and Loop/parallel Iteration produce 3/4/6 distinct ordered results; stop/late result cannot revive a run. |
| `dsl_acceptance` | Passed | 8 | `11b17fe9c31e438e8929fd341e20fe1f` | Real copy/import/export, cross-Workspace unconnected state, explicit batch rebind, eight actual business dispatches. |
| `output_error_acceptance` | Passed | 28 | `f6352f2a8b274c578cc404b9c8b99e47` | Strict mapping/types, legal defaults, forbidden File defaults, node handlers and no remote replay for invalid output. |
| `product_acceptance` | Passed | 11 | `5768368b674c479c976197e9803bc914` | Two published Workflows plus Chatflow; references, lifecycle, context revisions, production-only Monitoring and historical identity. |
| `load_acceptance` | Passed | 6 | `db9d371d422b41598a1e5ce97a3d8316` | Eight paused graphs plus four foreign calls, real bounded query IO, Native progress and one Send per original call. |
| `acceptance` | Passed | 18 | `7f5df638464348b1afe4ff39d38c6b83` | Original Verify/Overview protocol, files, cancellation, unknown submission, Trace and SSRF checks. |
| `workflow_acceptance` | Passed | 10 | `a8869d5205c548ca9c6a3df9517fa875` | Real Workflow/Node Test/Chatflow, pause/resume, Busy, epochs and Native Start→End. |
| `access_acceptance` | Passed | 25 | `09461f6fadfa441f8d8d4fd483612823` | Five role/tenant contexts, write-only credentials, Test generation and page/file lifecycle; no role check skipped. |
| `export_acceptance` | Passed | 6 | `8e0b3be64d4f4239bc243eddcfcbd713` | Real Phoenix OTLP asset/App targets, destination-failure isolation and export-only retry. |
| `timeout_acceptance` | Passed | 6 | `3127d5212bf746c3b297463d6b172361` | Actual 60-second node deadlines for all three policies and confirmed-Canceled-only retry. |
| `official_sdk_acceptance` | Passed | 11 | `960a44713c7e43f2892c371256a1a109` | Official SDK Message/Task/SSE/Get/Cancel/file/Workflow paths, with 0.3 compatibility disabled. |
| `connection_matrix_acceptance` | Passed | 11 | `17905257b6ef484895cea413d637d1ac` | Invalid/optional Card behavior, auth failure, advisory change groups, generation isolation and default-mode gate. |
| `file_matrix_acceptance` | Passed | 32 | `fab940f997cb42a5b5e2d694f2f4903b` | Exact/over effective input/output limits, explicit references, real byte hashes and downstream stored-file readback. |

The official SDK is pinned to **a2a-sdk 1.3.0**, upstream
`0d9dafb92328144384eca58a6e8ab80cb8f7d445`. Its final run observed **Send 6, Stream 1, Get 5, Cancel 1,
Subscribe 0** for seven business messages. The product run distinguished seven production dispatches from
ten fixture business messages, excluding Overview/NodeDebug from production Monitoring.

## Additional evidence and scope

| Evidence | Observed result | Limit of the conclusion |
| --- | --- | --- |
| Candidate12 stricter file deployment | 32 checks passed, run `4c709c916d594284917f22e32d2be30e`; document/image/aggregate limits were **2/3/6 MiB**, with five files. The observed strict-worker log window had zero native-fatal/SIGSEGV markers; cleanup restored default limits. | Separate from the default **15/10/30 MiB** run above; no limit was silently increased to pass. |
| Actual Linux worker CLI | Default concurrency four; warmed-parent native storage; 16 file tasks across eight recycled child PIDs. Each child rebuilt Flask/composition/storage and verified bytes. Reduced probe limits produced soft timeout at **2.093 s**, hard at **4.010 s**, followed by successful storage in a new child. Both complete shell paths, with absent and existing `PYTHONPATH`, passed. | Validates the actual candidate12 bootstrap and process boundary, not an unlimited-load or all-native-library safety claim. Production command soft/hard limits remain **100/110 s**; **60 s** is cold-child startup readiness only. |
| Local backend regression | **1,901 collected: 1,899 passed, 2 skipped, 0 failures, 0 errors** across 62 files, including Console transport, real command tasks, runtime races and file/trace compensation branches. The two full-shell cases skip on macOS Bash 3 because they require Bash 4+; Linux shell evidence covers both paths separately. | Exact local test result, not a claim that the GitHub check suite is green. Overlapping focused runs are not added to this count. |
| Local quality/contracts | Full lint/type checks, Console mapper comparison, generated-contract type checks and import/response contracts passed. | Must still be checked against the actual pushed PR head. |
| Real MySQL runtime + HTTPS gateway | MySQL **8.0.46**, REPEATABLE-READ, real migration through `c3025a2a1109`; SQL idempotency/CAS/lease/Busy/frame tests passed. Two fresh HTTP processes resumed the same Task, moved real files and exercised cancellation/Unknown. Six peer messages each had Send 1; independent foreign-owner read audit passed. Synthetic run `mysql-bf7fa13af04b4594b6575f31feee5af7`. | Recorded on the separate validation9 database-runtime image. Not MySQL Console login, Graphon/broker E2E, candidate12 worker validation or the full archive/delete matrix. |
| Fault and PostgreSQL 20/5 admission | Candidate12 known-Task restart and accepted-before-receipt process loss passed: one Send each; unknown kept no Task ID and made no Get/Cancel. A fresh admission run `29ed01acbb68481fb748f1ccfdc558bd` admitted owner 20 plus foreign 5, returned all 25 leases, then confirmed all 35 API cancellations within 4.77 s after observing real consumer progress. The worker was restored. | Admission exercises PostgreSQL leases without query IO; real-IO load is separate. Readiness observed Get progress for all 35 known Tasks, without direct harness Task queries. The earlier cold-start cleanup correctly became unconfirmed; its failed evidence and peer-only cleanup are retained, not relabeled as API cancellation success. |

## Corrections validated by these runs

- Protocol streaming comes from the trusted, fixed verified Card; the official SDK run verifies an actual
  Stream request and known-Task Get recovery rather than accepting a non-streaming substitute.
- External nodes retain their execution/frame provenance through nested and parallel graph recovery;
  assertions compare different per-instance results, not identical fixture text.
- File reads honor independent document/image deployment limits. References expose only the same readable
  App scope as Monitoring, with an identity-free possible-in-flight warning. Verify reports independent
  technical/business changes without resetting local presentation overrides or widening Skill input modes.
- The dedicated worker uses a process-local `ExternalSpawnCelery` factory and cold-spawn children while
  retaining Celery's prefork pool timeout/recycling machinery. CLI import-path persistence, child fast-trace
  initialization and bounded cold startup are exercised by the actual Linux entrypoint.

Earlier deployment attempts observed worker process failures/SIGSEGV on file paths. A minimal standalone
probe did **not** establish the original C-stack fault, so this report does not assign a speculative upstream
root cause. The process-isolation correction is supported by the actual warmed-parent CLI/storage probes,
both file-limit profiles and the complete sequential business replay above.

## Boundaries and outstanding gates

- Dev fault/admission and worker restoration passed. PR review, pushed-head CI, rollout and production
  release remain separate gates.
- Default A2A 1.0 has no standardized call-total token proof. A Trace step reporting zero remains zero;
  missing Invocation usage remains null and is not filled from step totals. Trusted call-total zero and
  dedup are tested through their explicit adapter/persistence contract.
- One-hour/24-hour lifecycle, 24-hour/300-query tracking and the 60-minute logical budget use controlled
  clocks with real persisted state. No real 24-hour soak or external-service availability guarantee is claimed.
- The load report is a bounded observation on the tested worker configuration, including cold-start and
  per-child resource costs. It is not a production throughput/latency SLO or an all-provider capacity result.
- Cross-App Workflow-as-Tool remains unsupported before Send. Native resume process loss after checkpoint
  claim avoids replaying Native side effects and fails at the original deadline; arbitrary-crash whole-graph
  recovery/exactly-once effects are not claimed.
- UI/browser layout, copy, navigation and frontend integration remain outside this backend acceptance.

Reproduction entrypoints and required isolated environments are documented in [README.md](README.md).
