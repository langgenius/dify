# BYOA backend acceptance

Run these tools against an isolated deployment with the feature enabled, migrated PostgreSQL, Redis, beat, a dedicated
`external_agent_worker` and the normal platform worker. The tools create clearly named fixture assets and Apps.

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

Console tools require `DIFY_TEST_URL`, `DIFY_TEST_EMAIL`, `DIFY_TEST_PASSWORD`, `BYOA_FIXTURE_PUBLIC_URL` and
`BYOA_FIXTURE_ADMIN_URL`. Pass secrets only through transient environment input. `DIFY_TEST_CA_FILE` and
`BYOA_FIXTURE_CA_FILE` select trusted test CAs. Role coverage uses `BYOA_TEST_ACTORS_JSON`; missing actors are reported
as skipped rather than claimed as covered. Reports contain IDs and validation facts, never login/API credentials.

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
