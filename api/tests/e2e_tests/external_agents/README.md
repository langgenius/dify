# BYOA backend acceptance

The [contract matrix](ACCEPTANCE_MATRIX.md) maps the reviewed PRD/Figma baseline to these suites.
The [2026-11-10 result summary](ACCEPTANCE_RESULTS_2026-11-10.md) records tested candidates, run IDs and limits.

Run these tools against an isolated deployment with the feature enabled, migrated PostgreSQL, Redis, beat, a dedicated
`external_agent_worker` and the normal platform worker. The tools create clearly named fixture assets and Apps.

The dedicated worker selects `external_agent_celery_entrypoint.celery`. Celery keeps its `prefork` process-pool
implementation for soft/hard task limits and process recycling, while Billiard starts each child with cold `spawn`.
Each child rebuilds the complete Dify Flask application and composition root from the image/environment; parent
Flask closures, database pools, native storage operators and runtime threads are not serialized into task processes.
Cold process readiness has a bounded 60-second window; command soft/hard timeouts and node/I/O budgets retain their
existing limits. Capacity evidence must include this cold-start and per-process memory cost. The
`external_agent_worker` role also exports the image's API work directory into `PYTHONPATH`, preserving configured
entries, so a fresh interpreter can import the same bootstrap without relying on Celery CLI's temporary
import-from-cwd path. The child initializes Celery's fast-trace cache through its normal process initializer.

The candidate12 Linux CLI probe used the actual image entrypoint, default concurrency four, a parent with a warmed
native storage operator, and 16 file tasks across eight distinct recycled child PIDs. Each child independently
reconstructed Flask/composition/storage and verified its file bytes. Separate probe tasks observed a soft timeout
at 2.093 seconds and a hard timeout at 4.010 seconds, then verified storage from a new child. Those reduced probe
limits do not change the production command's 100/110-second soft/hard limits; the 60-second readiness window
applies only to cold child startup. This worker-bootstrap evidence is not a pass for candidate12's business suites.

`fixture_server.py` is a bounded HTTPS A2A 1.0 server. Set `BYOA_FIXTURE_CERT`, `BYOA_FIXTURE_KEY`,
`BYOA_FIXTURE_PUBLIC_URL` and optionally `BYOA_FIXTURE_BEARER`. Use a test CA with proper CA/key-usage constraints;
configure trust through `SSL_CERT_FILE` and the runner CA variables. TLS verification stays enabled. Any private
network exception belongs to this isolated fixture's proxy policy.

From the repository root, set `PYTHONPATH=api` and run a module through `uv run --project api python -m`:

| Module under `tests.e2e_tests.external_agents` | Coverage |
| --- | --- |
| `acceptance` | Verify/Save, Message/Task/SSE/GetTask, cancellation, strict outputs, files, Trace, unknown submission and SSRF rejection. |
| `workflow_acceptance` | Workflow pause/resume, Node Test/LastRun, Native regression, published Chatflow context reuse, rebinding and Busy. |
| `access_acceptance` | Owner/Admin/Editor/Normal, foreign tenant, display generation, credential scope and page-leave fences. |
| `export_acceptance` | Real Phoenix OTLP asset/App targets, isolated destination failure and export-only retries. |
| `timeout_acceptance` | Real 60-second node deadlines for all three policies, including retry input preservation. |
| `capacity_acceptance prepare\|exercise\|cleanup` | Verified fixture Tasks, real PostgreSQL 20/5 lease admission and exact cleanup. |
| `fault_acceptance known_prepare\|known_assert\|unknown_prepare\|unknown_assert` | Restart after known Task, and process loss after peer acceptance before receipt. |
| `dsl_acceptance` | Actual same-Workspace copy/import and cross-Workspace import, explicit rebinding and execution. |
| `graph_matrix_acceptance` | Parallel/Iteration/Loop external waits and durable frame/result isolation. |
| `output_error_acceptance` | Exact structured mappings, typed defaults and real Workflow node Error Handling. |
| `file_matrix_acceptance` | Effective exact/over limits, explicit Workflow file references and stored byte readback; `BYOA_EXPECT_STRICTER_LIMITS` checks a stricter deployment. |
| `product_acceptance` | Two published Workflows plus Chatflow, four Monitoring metrics, debug exclusion, scoped reference preflight, Edit info/connection context behavior, Disable/Enable/Delete. |
| `connection_matrix_acceptance` | Required/optional/malformed Cards, failed auth/required extensions, technical and business change warnings, saved-generation isolation and default-mode gates. |
| `official_sdk_acceptance` | Real Console and Workflow against pinned official SDK 1.3.0; see [isolated SDK setup](official_sdk_README.md). |
| `load_acceptance` | Bounded real query I/O with eight paused graphs and four foreign-Workspace calls; reports actual resource observations. |
| `mysql_runtime_acceptance sql\|http_prepare\|http_resume` | Isolated real MySQL migration/runtime/CAS/leases and HTTPS gateway across fresh processes; not MySQL Console/Graphon E2E. |

Console tools require `DIFY_TEST_URL`, `DIFY_TEST_EMAIL`, `DIFY_TEST_PASSWORD`, `BYOA_FIXTURE_PUBLIC_URL` and
`BYOA_FIXTURE_ADMIN_URL`. Pass secrets only through transient environment input. `DIFY_TEST_CA_FILE` and
`BYOA_FIXTURE_CA_FILE` select trusted test CAs. Role coverage uses `BYOA_TEST_ACTORS_JSON`; missing actors are reported
as skipped rather than claimed as covered. Reports contain IDs and validation facts, never login/API credentials.
`product_acceptance` requires configured Editor, Normal and foreign Owner actors rather than skipping those checks.

Connection change warnings have independent `technical` and `business` code arrays. They describe verified Card
changes and do not block a valid save or widen the frozen file profile. The fixed `/cards/{case}` peer routes cannot
be changed through admin requests. First and unchanged verified Cards have empty warnings.

The default A2A 1.0 profile has no standardized call-total token proof. Product acceptance preserves a reported
Trace step total of zero while requiring call-level `reported_tokens=null` and coverage zero; it never sums steps
or writes usage directly to make a real-API test pass. Trusted usage-proof/zero aggregation is separately covered
by persistence/adapter contracts.

Run suites sequentially against one fixture because its controlled failure state is shared. Keep one ID-only
`BYOA_CAPACITY_STATE` across capacity phases: prepare, gracefully stop only the dedicated external worker, exercise,
restart that worker in a `finally` path, then cleanup. The exercise phase claims real DB permits without query I/O
and returns only the exact leases it acquired.

Likewise keep `BYOA_FAULT_STATE` across fault phases. Restart the dedicated worker between known prepare/assert.
After unknown prepare confirms the peer's pre-receipt barrier, kill only that dedicated worker, restart it, then run
unknown assert. The server's hidden Task ID is never supplied to Dify to manufacture recovery. Preserve the fixture,
API, platform worker and database throughout these phases.

Individual modules document their output-file variables. The timeout runner can take several minutes while honoring
the real node/cancellation/background-query windows; it does not shorten the logical execution budget.

## MySQL runtime and gateway validation

This separate integration uses a dedicated migrated MySQL database whose name starts with `byoa_`, normal Dify
application composition, owned storage, and the trusted HTTPS peer. Configure database credentials and peer/CA
settings through the validator's transient environment. It does not reuse or reconfigure the PostgreSQL Console
deployment. SQL probes seed synthetic owners and test persisted failure markers without fabricating successful
Task receipts; HTTP phases use real Verify/Save, dispatch, file storage, query and cancellation adapters.

From the repository root in that isolated validator, choose a new state filename for each complete run. Keep the
same state across phases; invoke `http_resume` in a fresh process after `http_prepare` has exited. Coordinate the
HTTP phases with the other suites because they share fixture request counters.

```bash
export BYOA_MYSQL_ACCEPTANCE=1
export BYOA_MYSQL_STATE=/tmp/byoa-mysql-fresh-run-state.json
PYTHONPATH=api uv run --frozen --project api flask --app app db upgrade
BYOA_MYSQL_OUTPUT=/tmp/byoa-mysql-sql.json PYTHONPATH=api uv run --frozen --project api python \
  -m tests.e2e_tests.external_agents.mysql_runtime_acceptance sql
BYOA_MYSQL_OUTPUT=/tmp/byoa-mysql-prepare.json PYTHONPATH=api uv run --frozen --project api python \
  -m tests.e2e_tests.external_agents.mysql_runtime_acceptance http_prepare
BYOA_MYSQL_OUTPUT=/tmp/byoa-mysql-resume.json PYTHONPATH=api uv run --frozen --project api python \
  -m tests.e2e_tests.external_agents.mysql_runtime_acceptance http_resume
```

The recorded MySQL 8.0.46/REPEATABLE-READ run passed the real migration, SQL admission/CAS/lease/Busy/frame tests,
two fresh-process HTTPS phases, and the final foreign-owner audit. The peer observed six business messages with
one Send each; the resumed Task kept its original ID. This establishes MySQL runtime plus gateway integration,
not MySQL-backed Console login, Graphon recovery, broker-worker delivery, UI acceptance, production capacity, or
the full archive/deletion matrix. The recorded database-runtime image predates the candidate12 worker-bootstrap
change; it must not be relabeled as candidate12 business-suite evidence.
