# Backend Testcontainers Performance and Testability Audit

Date: 2026-07-09

## Scope

This report consolidates an investigation into Dify backend Testcontainers integration tests, with emphasis on:

- The current backend test architecture.
- Local Testcontainers performance.
- Controller tests that are clean enough for concrete behavior coverage, but currently lack the right test shape or pay unnecessary container costs.
- Controller and wrapper code that manages sessions directly and blocks nested transaction/savepoint isolation.
- How much setup and teardown can be shared across Testcontainers runs.
- How local runs should differ from CI.
- Whether non-Postgres services can be started selectively for partial local runs.

The repository backend instructions were read from `AGENTS.md`, `api/AGENTS.md`, and `api/AGENTS_Local.md`. The repo backend code review skill was not used.

## Executive Summary

The Testcontainers suite is slow for three separate reasons:

1. Full local Testcontainers runs currently use `xdist` through `-n auto`, which creates one session-scoped container stack per worker. This multiplies Postgres, Redis, Sandbox, and Plugin Daemon startup/teardown.
2. Every test using `flask_app_with_containers` triggers a global database reset with `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` over all SQLAlchemy tables. On this machine, an empty truncate costs about 1.86-1.91 seconds per test.
3. Many controller tests in the Testcontainers suite are mock-heavy or schema-only tests that do not need live containers at all, while many tests that do need concrete behavior are blocked from fast savepoint isolation by controllers, wrappers, and services that open their own sessions from `db.session()`, `Session(db.engine)`, `sessionmaker(db.engine)`, or `FileService(db.engine)`.

The most important local performance finding is that full Flask app creation plus schema creation works with only a Postgres container. Redis, Sandbox, and Plugin Daemon are not required for application initialization if their environment variables point at inert endpoints. Therefore, always starting all four services is a fixture policy choice, not a hard requirement.

## Implementation Update (2026-07-10)

The first migration pass implemented the highest-impact infrastructure from this audit:

- Testcontainers now default to selective startup through `--tc-services=auto`; explicit service markers, direct Redis imports, and the code-executor path add only the required services.
- Postgres-only controller selections were runtime-verified. A Redis integration selection was also verified to start exactly Postgres and Redis.
- Local Make targets no longer use xdist. The Testcontainers conftest rejects xdist explicitly, and CI runs Testcontainers separately from Compose-backed integration tests with `--tc-services=auto`.
- The default truncate reset remains available, while `no_container_truncate` permits a test-owned isolation strategy.
- `transactional_db_session` now binds Flask-SQLAlchemy and `core.db.session_factory` to one outer transaction with a guard savepoint. It automatically suppresses truncate and rolls back the outer transaction.
- `database_state`, `authenticated_console_client`, and `console_account_factory` provide post-request DB assertions and real account/tenant/auth setup.

Five representative controller files now use transaction isolation: API keys, external knowledge APIs, chat conversation status, message APIs, and the concrete `DataSourceApi` group. The DataSource tests were converted from unwrapped methods, fake accounts, and mocked DB sessions to HTTP requests with persisted before/after state.

Measured together, the five migrated groups completed 38 tests in 12.59 seconds. Their slowest request body was under 0.1 seconds after the API-key deletion test was marked as requiring Redis. By comparison, 13 retained truncate-isolated file-upload and statistic tests completed in 49.56 seconds. Those two paths exposed concrete blockers: `FileService(db.engine)` requires an Engine, while statistic controllers call `db.engine.begin()` directly.

## Deeper Fixed-Cost Profile (2026-07-10)

The 38-test result hides substantial work before and after pytest's reported duration. A profiled run with normal plugin autoload reported 12.74 seconds in pytest but took 27.58 seconds wall time and 672 MiB peak RSS.

| Layer | Measured cost |
| --- | ---: |
| Pytest plugin/conftest imports before session start | 9.77s |
| Postgres and Redis startup | 4.86s |
| `create_app()` | 0.94-1.50s |
| `db.create_all()` | 2.88-4.04s |
| 38 test call phases | 1.00-1.33s |
| Savepoint enter and exit, 35 tests | 0.057-0.068s total |
| Redis flush, 35 tests | 0.018-0.022s total |
| Container shutdown | 0.91s |

The nested transaction implementation is not a material bottleneck. Across the representative run, test SQL took about 0.56 seconds; savepoint control statements accounted for about 0.17 seconds of that total.

### Pytest Plugin Autoload

Disabling automatic third-party plugin discovery and loading only `pytest-env` reduced the same run's wall time from 27.58 to 23.03 seconds and peak RSS from 672 MiB to 469 MiB. The unrelated Opik pytest plugin eagerly imports `opik.evaluation`, LiteLLM, and LangSmith; import-time profiling attributed about 2.06 seconds to the Opik evaluation chain alone.

Local Testcontainers commands should therefore use `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` and explicitly load the small set of required plugins. CI can keep a broader plugin set where coverage, timeout, or reporting plugins are intentional.

### Backend Import Floor

A validator-only test with a 0.00011-second body and no containers took 10.41 seconds wall with minimal pytest plugins, or 14.82 seconds with normal plugin autoload. Isolated warm-process import measurements were:

| Import | Wall time | Peak RSS |
| --- | ---: | ---: |
| Python process only | 0.01s | 13 MiB |
| `pytest` | 0.17s | 29 MiB |
| `core.app.workflow.file_runtime` | 4.90s | 335 MiB |
| `file_runtime.py` with package `__init__` bypassed | 3.25s | 176 MiB |
| `app_factory` | 8.29s | 407 MiB |

`api/tests/conftest.py` universally imports `core.app.workflow.file_runtime`. Importing that submodule first executes `core.app.workflow.__init__`, whose eager `DifyNodeFactory` import loads the workflow node and document-extractor graph. Making that package initializer lazy would save about 1.65 seconds, but the runtime module's own database, storage, and remote-fetch dependencies still cost about 3.25 seconds. The binding fixture should not impose this import on tests that do not exercise workflow files.

The Testcontainers conftest also imports `app_factory` at module load. `app_factory` imports controller route packages eagerly, so even schema-only tests and tests that never request the Flask app pay much of the application import graph. Lazy fixture imports alone will not solve controller test-module imports, because `controllers.console.__init__` also performs aggregate route registration.

### Schema DDL

SQL instrumentation showed that `db.create_all()` emits 351 `CREATE` statements. In a normal ephemeral Postgres container, those statements consumed 2.61-3.72 seconds; schema inspection queries consumed only about 0.07 seconds.

An ephemeral benchmark with `fsync=off`, `synchronous_commit=off`, and `full_page_writes=off` reduced `db.create_all()` from 2.88 to 0.89 seconds and raw `CREATE` execution from 2.61 to 0.68 seconds. Postgres startup remained about 4.9 seconds. Non-durable settings are appropriate only for disposable local/CI test databases, but they provide a concrete two-second setup improvement.

### Persistent Local Database Probe

A temporary Postgres container was kept alive across separate pytest processes. The first process, excluding container startup, created the schema and completed one concrete controller test in 2.78 seconds. A warm-schema process completed in 1.85 seconds:

| Warm process layer | Time |
| --- | ---: |
| `create_app()` | 1.49s |
| Existing-schema `db.create_all()` inspection | 0.087s |
| Request and assertions | 0.035s |
| Container startup/teardown | 0s |

The first reuse attempt failed because `_UUIDv7SQL` unconditionally executes `CREATE FUNCTION`. Persistent mode requires idempotent UUID function setup, for example `CREATE OR REPLACE FUNCTION` or an explicit existence check.

A broader warm Postgres-only selection reached 46 passing tests in 6.10 seconds inside pytest, with 1.24 seconds in test bodies and 0.080 seconds in schema inspection. It also exposed a stale `TestDataSourceNotionListApi.test_get_invalid_dataset_type` patch of the removed `controllers.console.datasets.data_source.sessionmaker` symbol; the patch and its unnecessary `mock_engine` dependency were subsequently removed.

### Local Virtualenv Isolation

This worktree's `api/.venv` was a symlink to `/home/chariri/dify/api/.venv`, shared by multiple checkouts. Concurrent `uv` runs rewrote editable `.pth` files between `/home/chariri/dify`, `/home/chariri/dify-2`, and `/home/chariri/dify-3`; consecutive `--no-sync` test runs reproduced `ImportError` failures from the wrong `dify_agent` checkout.

The symlink was replaced locally with a real `/home/chariri/dify-3/api/.venv` and synchronized from the lockfile. `uv run --no-sync` now resolves the interpreter and all editable workspace packages from this worktree without reinstall churn. Every active worktree should own its virtualenv; sharing `.venv` across worktrees is unsafe.

## Current Backend Test Architecture

Backend tests are distributed across these main areas:

- `api/tests/unit_tests`: ordinary backend unit tests.
- `api/tests/unit_tests/controllers`: controller-focused unit tests, run separately because route registration happens at import time.
- `api/tests/integration_tests`: older integration tests, including workflow and tools tests.
- `api/tests/test_containers_integration_tests`: Docker/Testcontainers-backed tests.
- Provider tests under `api/providers/*/tests`.

Current Makefile behavior after the implementation update:

- `make test` runs backend unit tests and controller unit tests without xdist.
- `make test-all` runs unit tests, controller unit tests, integration tests, Testcontainers tests, and VDB smoke tests.
- `make test-all` runs Compose-backed integration tests and Testcontainers tests as separate, non-xdist pytest processes.
- `TARGET_TESTS=... make test` and `TARGET_TESTS=... make test-all` run the target path directly without xdist.

Current CI behavior:

- Unit tests use `-n auto` except controller unit tests.
- Compose-backed integration tests and Testcontainers tests run separately without xdist; Testcontainers uses `--tc-services=auto`.

The root pytest hook in `api/conftest.py` manages Docker Compose middleware and VDB services for older integration paths via `--start-middleware` and `--start-vdb`. The Testcontainers suite has its own container manager in `api/tests/test_containers_integration_tests/conftest.py`.

## Testcontainers Suite Inventory

Observed Testcontainers suite size:

- `pytest --collect-only -q api/tests/test_containers_integration_tests`: 2508 tests collected in 5.35 seconds; wall time about 21 seconds.
- AST count of `test_*.py` files: 188 files.
- AST count of test functions: 2430 functions.
- Controller Testcontainers files: 46.
- Controller Testcontainers test functions: 504.

Static fixture and mocking inventory across Testcontainers tests:

| Signal | Count |
| --- | ---: |
| `flask_app_with_containers` references | 369 |
| `db_session_with_containers` references | 8064 |
| `test_client_with_containers` references | 227 |
| `flask_req_ctx_with_containers` references | 21 |
| `patch(...)` or `monkeypatch.*` references | 1340 |

Approximate Testcontainers test distribution by directory:

| Directory | Files | Test functions |
| --- | ---: | ---: |
| `controllers` | 46 | 504 |
| `services` | 80 | 1427 |
| `models` | 7 | 41 |
| `tasks` | 27 | 274 |
| `core` | 5 | 44 |
| `workflow` | 5 | 13 |
| `repositories` | 7 | 55 |
| `commands` | 1 | 2 |

## Current Testcontainers Fixture Architecture

The main Testcontainers fixture is in `api/tests/test_containers_integration_tests/conftest.py`.

Current container startup:

- Creates a Docker network.
- Always starts Postgres for app-backed Testcontainers tests.
- Starts Redis, Dify Sandbox, and Dify Plugin Daemon only when collection-time markers or path/source detection select them.
- Sets application environment variables from container host/port details.

Current Flask app creation:

- Clears and reinitializes `dify_config`.
- Calls full `create_app()`.
- Installs UUIDv7 helper SQL.
- Calls `db.create_all()`.

Current DB/session fixtures:

- `flask_app_with_containers` is session-scoped.
- `db_session_with_containers` depends on `flask_app_with_containers`.
- `test_client_with_containers` depends on `flask_app_with_containers`.
- Any test using `flask_app_with_containers` triggers post-test isolation.

Current isolation:

- An autouse fixture checks whether the selected test used `flask_app_with_containers`.
- Unless `no_container_truncate` is set by the transaction fixture or test, it truncates all SQLAlchemy metadata tables:

  ```sql
  TRUNCATE TABLE <all tables> RESTART IDENTITY CASCADE
  ```

- It flushes Redis only when Redis was started.

This gives broad isolation even for application code that commits through global sessions or ad hoc engine-bound sessions. The cost is that every app-backed test pays a full-table truncate.

## Runtime Measurements

Measurements were made locally with Docker CLI emulated by Podman.

### Collection

- Command: `pytest --collect-only -q api/tests/test_containers_integration_tests`
- Pytest reported: 2508 tests in 5.35 seconds.
- Wall time: about 21 seconds.

### Tiny DB Test Runs

Two tiny DB tests, single worker:

- Pytest reported: 40.11 seconds.
- Wall time: 52.93 seconds.
- Actual test call time: about 0.10 seconds.

Same file with `-n2`:

- Pytest reported: 55.92 seconds.
- Wall time: 72.88 seconds.

Two tiny tests from two files with `-n2 --dist=loadfile`:

- Pytest reported: 53.40 seconds.
- Wall time: 67.48 seconds.
- Logs showed two full Testcontainers stacks running concurrently.

`models/test_account.py` with 9 tests:

- Pytest reported: 52.75 seconds.
- Wall time: 66.21 seconds.
- Per-test DB teardown: about 1.85-1.95 seconds.

### Fixture Primitive Timings

Measured with an inline script:

| Operation | Time |
| --- | ---: |
| `start_containers_with_env()` | about 6.91s |
| `_create_app_with_containers()` | about 3.66s |
| `_truncate_container_database(app)` on empty DB | about 1.86-1.91s |
| Redis `flushdb()` | about 0.00-0.004s |
| `stop_containers()` | about 24.97s |

Stop time was dominated by Sandbox and Plugin Daemon under local Podman; each cost roughly 10 seconds.

### cProfile Summary

Two tiny tests under cProfile:

- 43,450,771 calls.
- Profile time: about 60.965 seconds.
- Pytest reported: 41.81 seconds.
- Wall time: 64.39 seconds.

Largest cumulative costs:

| Function/area | Cumulative time |
| --- | ---: |
| `stop_containers` | about 22.962s |
| `_truncate_container_database` | about 3.894s for 2 calls |
| `start_containers_with_env` | about 8.993s under profiler |
| `_create_app_with_containers` | about 5.546s under profiler |
| `db.create_all` | about 3.064s |
| socket `recv_into` | about 27.19s self |
| psycopg2 cursor execute | about 6.516s |
| imports | about 18s cumulative |

## Postgres-Only App Startup Probe

A runtime probe started only a Postgres Testcontainer, configured Redis, Sandbox, and Plugin Daemon environment variables to inert localhost endpoints, then ran full Flask app creation and schema creation.

Result: success.

Measured timings:

| Operation | Time |
| --- | ---: |
| Postgres start | 3.17s |
| `create_app()` | 6.09s |
| schema creation | 2.45s |
| total before stop | 11.71s |
| Postgres stop | 0.59s |

Conclusion: Redis, Sandbox, and Plugin Daemon are not required for app initialization. They should be started only when selected tests actually need them.

## Local vs CI Execution

Local and CI should not use the same Testcontainers parallelism model.

### Local

Local Testcontainers runs should default to no xdist.

Reasons:

- `xdist` creates one session-scoped Testcontainers stack per worker.
- Local Docker/Podman suffers from container lifecycle contention.
- Partial edit-loop runs are usually bottlenecked by fixed setup/teardown, not CPU-bound test execution.
- Local developers and agents need predictable, low fixed cost more than maximum throughput.

Suggested local behavior:

- `make test-all` should not add `-n auto` by default for integration/Testcontainers paths.
- Add an opt-in variable such as `PYTEST_PARALLEL=-n auto` for users who explicitly want it.
- `TARGET_TESTS=...` already avoids `-n auto`; preserve that behavior.

### CI

CI can keep `-n auto`, but the current design multiplies container stacks per worker.

Better CI options:

1. Short term: keep current xdist for throughput and accept multiple stacks.
2. Medium term: split Testcontainers tests by dependency group and run each group with tuned worker counts.
3. Long term: use one external/persistent service stack per CI job, with per-worker isolated DB/schema or per-worker cloned database.

## Selective Container Startup

Postgres should be the baseline for most Testcontainers tests. Redis, Sandbox, and Plugin Daemon should be opt-in.

### Why Static Detection Alone Is Not Enough

The selected Python files and imports can hint at dependencies, but cannot prove runtime usage. Examples:

- Tests may import plugin modules but patch all plugin daemon calls.
- Tests may mention `CloudPlan.SANDBOX`, which is a billing plan and does not require the code-execution Sandbox container.
- A controller test may need Redis indirectly through auth decorators or rate limiters even if the test body does not mention Redis.

### Practical Dependency Model

Use a hybrid:

- Explicit markers:
  - `@pytest.mark.requires_postgres`
  - `@pytest.mark.requires_redis`
  - `@pytest.mark.requires_sandbox`
  - `@pytest.mark.requires_plugin_daemon`
- Conservative static fallback for unmarked selected tests.
- In CI full-suite mode, allow forcing all services until marker coverage matures.
- In local partial mode, default to Postgres-only and start additional services only when markers/static detection requires them.

### Static Classification Findings

Refined static classification of Testcontainers files:

| Dependency signal | Files | Test functions |
| --- | ---: | ---: |
| Actual Redis-looking tests | 29 | 507 |
| Actual code-execution Sandbox tests | 5 | 13 |
| Plugin-looking tests | 9 | 157 |
| Billing-plan `sandbox` mentions only | 8 | 164 |

Actual code-execution Sandbox tests are concentrated under:

- `api/tests/test_containers_integration_tests/workflow/nodes/code_executor/`

Examples:

- `test_code_python3.py`
- `test_code_javascript.py`
- `test_code_jinja2.py`
- `test_code_executor.py`

Many tests mentioning `sandbox` are billing-plan tests, not code-execution tests, and should not start the Sandbox container.

Plugin-looking tests include:

- `api/tests/test_containers_integration_tests/services/plugin/test_plugin_service.py`
- `api/tests/test_containers_integration_tests/services/plugin/test_plugin_parameter_service.py`
- `api/tests/test_containers_integration_tests/services/plugin/test_plugin_permission_service.py`
- `api/tests/test_containers_integration_tests/controllers/console/workspace/test_trigger_providers.py`
- `api/tests/test_containers_integration_tests/trigger/test_trigger_e2e.py`

However, several of these are mock-heavy and likely do not need live Plugin Daemon.

## Controller Test Quality and Performance Traps

Several controller tests are in the Testcontainers suite but primarily test Pydantic models, mocked service behavior, or direct method branches.

These should usually be moved to controller unit tests or to a minimal Flask app/request-context fixture that does not start containers.

### Prime Trap: Service API Dataset Controller Tests

File:

- `api/tests/test_containers_integration_tests/controllers/service_api/dataset/test_dataset.py`

The file states that it was migrated from unit tests, covers Pydantic models and controller-level behavior, and keeps `DatasetService`, `TagService`, and `DocumentService` mocked. This is mostly unit-test work.

Observed signals:

- 60 tests.
- Heavy mock usage.
- Mostly controller/schema behavior.
- Full Testcontainers fixture paid for many assertions that do not need concrete DB or middleware behavior.

Recommendation:

- Move Pydantic payload/query tests back to unit tests.
- Keep only real DB/auth/route behavior in Testcontainers.
- If full route testing is required, isolate a small number of tests that exercise real service paths and database effects.

### Prime Trap: Console App Controller API Tests

File:

- `api/tests/test_containers_integration_tests/controllers/console/app/test_app_apis.py`

Observed signals:

- 37 tests.
- Uses `flask_app_with_containers` fixture.
- Calls unwrapped resource methods directly.
- Uses `MagicMock` sessions and patched services.

Recommendation:

- Move direct-method, mocked-service branch tests to unit tests.
- Keep Testcontainers coverage only for route-level auth, permission, persistence, and serialization flows that actually hit DB and app wiring.

### Other Likely Traps

Files with similar signals:

- `controllers/console/workspace/test_tool_provider.py`
- `controllers/console/datasets/rag_pipeline/test_rag_pipeline_workflow.py`
- `controllers/console/workspace/test_trigger_providers.py`

These files have high patch counts and should be reviewed for whether they need live containers.

## Clean-ish Controller Candidates for Concrete Coverage

These controller modules appear to have meaningful request/permission/serialization behavior and little obvious direct session management in the controller body. They are good candidates for a small number of high-value concrete tests, not broad mock-heavy Testcontainers tests.

Candidates:

- `api/controllers/console/workspace/plugin.py`
- `api/controllers/console/workspace/models.py`
- `api/controllers/console/datasets/rag_pipeline/datasource_auth.py`
- `api/controllers/console/app/generator.py`
- `api/controllers/console/app/agent_drive_inspector.py`
- `api/controllers/console/app/workflow_node_output_inspector.py`
- `api/controllers/console/app/ops_trace.py`
- `api/controllers/web/login.py`
- `api/controllers/web/app.py`
- `api/controllers/web/completion.py`
- `api/controllers/service_api/app/completion.py`

Guidance:

- Add concrete Testcontainers coverage only where the endpoint crosses real auth, DB state, permission, serialization, or external-service boundaries.
- Keep pure payload validation, exception mapping with mocked services, and direct-method branch testing in unit tests.

## Dirty Session and Transaction Blockers

Nested transaction/savepoint isolation requires application code to use the same request-scoped/test-managed connection/session. Many controller and wrapper paths currently escape that model.

### Direct `db.session` in OpenAPI Workspaces

File:

- `api/controllers/openapi/workspaces.py`

Patterns:

- Helpers and methods call `TenantService`, `AccountService`, and `RegisterService` with global `db.session`.
- Some endpoint behavior is integration-worthy, such as workspace list/detail/switch/member management, but the controller is not cleanly injectable.

Effect:

- Tests cannot safely wrap these paths in a single test-managed savepoint without relying on global session behavior.

### Engine-Bound Sessions in OpenAPI App DSL

File:

- `api/controllers/openapi/app_dsl.py`

Patterns:

- `with Session(db.engine, expire_on_commit=False) as session:`
- Explicit `session.commit()` and `session.rollback()` inside controller methods.

Effect:

- The controller opens an independent connection/session.
- Savepoint isolation in the fixture cannot capture the controller's commits unless the engine/session factory is intercepted.

### Engine-Bound Sessions in MCP Controller

File:

- `api/controllers/mcp/mcp.py`

Patterns:

- `with sessionmaker(db.engine, expire_on_commit=False).begin() as session:`
- A helper opens another `sessionmaker(db.engine)` transaction to retrieve end users.

Effect:

- Request handling may use multiple independent sessions.
- This blocks simple outer transaction rollback and makes behavior harder to reason about.

### Human Input Form Controller

File:

- `api/controllers/web/human_input_form.py`

Patterns:

- Builds a repository factory from `sessionmaker(bind=db.engine)`.
- Instantiates `HumanInputService(db.engine)`.
- Uses `db.session.get` and `db.session.scalar` in helper code.

Effect:

- Mixed session acquisition paths make nested transaction isolation fragile.

### Dataset Metadata Controllers

Files:

- `api/controllers/service_api/dataset/metadata.py`
- `api/controllers/console/datasets/metadata.py`

Patterns:

- Mix `db.session` and `db.session()` in endpoint bodies.
- Call services with newly pulled global sessions.

Effect:

- Hard to inject a test-managed session.
- Increases risk of accidental commits escaping test isolation.

### Workflow Draft Variable Controllers

Files:

- `api/controllers/console/app/workflow_draft_variable.py`
- `api/controllers/console/datasets/rag_pipeline/rag_pipeline_draft_variable.py`
- `api/controllers/console/snippets/snippet_workflow_draft_variable.py`

Patterns:

- Mix `sessionmaker(bind=db.engine).begin()`, `db.session()`, and explicit `db.session.commit()`.

Effect:

- These are high-value behavior areas, but currently poor candidates for fast savepoint-based isolation without refactoring.

### Service API Wrappers

File:

- `api/controllers/service_api/wraps.py`

Patterns:

- Auth decorators query `db.session` directly.
- Rate-limit logging creates a new `sessionmaker(bind=db.engine).begin()` session.
- Token validation uses Redis cache and global DB paths.

Effect:

- Even clean endpoint bodies can become dirty through decorators.
- Route-level Testcontainers tests for service API endpoints may require Redis and may escape savepoint isolation through wrapper behavior.

### File Endpoints and FileService

Files:

- `api/controllers/files/image_preview.py`
- `api/controllers/openapi/files.py`
- `api/controllers/web/files.py`
- `api/controllers/web/remote_files.py`
- Related service API upload/download paths.

Patterns:

- Instantiate `FileService(db.engine)`.

Effect:

- File service DB work bypasses a request/test session and opens its own engine-bound sessions.

## Setup/Teardown Sharing Potential

### Current Sharing

Current sharing is limited to one Python process/pytest worker:

- Session-scoped Testcontainers stack is shared within one worker.
- With xdist, every worker gets its own stack.
- Across separate local Python processes, nothing is shared.
- Fixture teardown stops containers at process end.

### Single Setup/Teardown for Whole Suite

A single setup/teardown for the whole suite is possible only if xdist workers do not each own their own Testcontainers stack.

Options:

1. Single worker:
   - One stack for the whole run.
   - Fixed setup/teardown amortized.
   - Still pays about 1.9 seconds truncate per app-backed test.

2. Shared external stack:
   - One Postgres/Redis/Sandbox/Plugin Daemon stack per local or CI job.
   - Workers use separate DBs/schemas or cloned template databases.
   - More complex, but enables CI parallelism without multiplying all containers.

3. Persistent local stack:
   - A developer/agent starts a reusable stack once.
   - Test runs connect to it and skip container stop.
   - Ideal for tight edit loops.

### Persistent Local Environment

Persistent local mode should support:

- Reusing an already-running Postgres container or Docker Compose service.
- Reusing Redis only when required.
- Reusing Sandbox and Plugin Daemon only when selected tests require them.
- Skipping stop/cleanup of persistent containers.
- Reinitializing or cloning DB state cheaply.

Possible command model:

- `make tc-env-up`
- `make tc-env-down`
- `make test-tc TARGET_TESTS=...`
- `DIFY_TESTCONTAINERS_REUSE=1 uv run --project api --dev pytest ...`

## Transaction/Savepoint Optimization Path

Fast test isolation should move from global truncate to transaction rollback where possible.

Target model:

1. Open a test-managed database connection.
2. Begin an outer transaction.
3. Bind Flask-SQLAlchemy/session factory to that connection.
4. Use a nested transaction/savepoint per test.
5. Restart savepoint after application-level commits.
6. Roll back outer transaction at test end.

Blockers:

- Direct `Session(db.engine)`.
- Direct `sessionmaker(db.engine)`.
- Direct `db.engine.begin()`.
- Service constructors that accept `engine` instead of `Session` or `session_factory`.
- Controllers and decorators pulling `db.session` globally.
- Explicit commits in controller code.

Refactoring direction:

- Introduce request-scoped session/provider dependency.
- Make services accept `Session` or an injected session factory.
- Ensure decorators/wrappers use the same session provider as endpoint bodies.
- Keep explicit transaction boundaries in service/application layers, not controllers.
- Add a lint/static check for controller code that imports `Session`, `sessionmaker`, or calls `db.session()`/`db.engine`.

## Recommended Roadmap

### Phase 1: Low-Risk Performance Fixes

- Remove `-n auto` from local Makefile Testcontainers/integration defaults.
- Keep `-n auto` explicit in CI.
- Split Testcontainers startup into independent service methods.
- Add Postgres-only mode.
- Configure inert Redis/Sandbox/Plugin endpoints when skipped.
- Skip Redis cleanup when Redis was not started.
- Skip Sandbox and Plugin Daemon by default for local partial runs.

Expected local win:

- Avoid duplicate stacks.
- Avoid about 20 seconds of Sandbox/Plugin Daemon stop time for Postgres-only runs.
- Avoid starting unused containers for most partial controller/model/service DB tests.

### Phase 2: Markers and Test Classification

- Add pytest markers for external dependencies.
- Mark known Redis tests.
- Mark code executor tests as requiring Sandbox.
- Mark only truly live Plugin Daemon tests as requiring Plugin Daemon.
- Add collection-time dependency summary logging:

  ```text
  Testcontainers services selected: postgres, redis
  Reason:
  - postgres: db_session_with_containers used
  - redis: tests/.../test_api_token_service.py marked requires_redis
  - sandbox: not selected
  - plugin_daemon: not selected
  ```

- Fail fast if a test hits a skipped service unexpectedly, with a message suggesting the marker to add.

### Phase 3: Move Mock-Heavy Tests Out of TC

Move or rework:

- `controllers/service_api/dataset/test_dataset.py`
- `controllers/console/app/test_app_apis.py`
- Similar mock-heavy controller files.

Keep Testcontainers tests focused on:

- Route/auth behavior.
- Persistence behavior.
- Transactional service behavior.
- Serialization against real models.
- Redis behavior when Redis is semantically part of the feature.
- Sandbox/code-execution behavior.
- Plugin Daemon behavior only when truly live.

### Phase 4: Savepoint Isolation for Clean Paths

- Introduce a transaction-aware `db_session_with_containers`.
- Add a separate marker or fixture for savepoint-safe tests.
- Use savepoint isolation for clean paths.
- Fall back to truncate for dirty paths until refactored.

Possible intermediate fixtures:

- `db_session_with_savepoint`
- `flask_app_with_savepoint_db`
- `requires_global_truncate`

This allows gradual migration instead of requiring all controllers/services to be clean at once.

### Phase 5: Controller Session Refactor

Prioritize dirty paths by test value and blast radius:

1. Service API wrappers and auth decorators.
2. Dataset metadata/document/segment controllers.
3. OpenAPI workspace and app DSL controllers.
4. Workflow draft variable controllers.
5. File endpoints and `FileService(db.engine)`.
6. MCP session handling.

## Suggested Follow-Up Experiments

1. Implement a local-only Postgres mode behind an env var and time:

   - one model test file
   - one controller file
   - one service file

2. Add `--tc-services=auto|postgres|postgres,redis|all` and compare:

   - partial controller run
   - partial service run
   - code executor run
   - full suite collection with dependency summary

3. Prototype savepoint isolation on one clean model/service test file.

4. Add a static CI check that flags new controller imports of:

   - `sqlalchemy.orm.Session`
   - `sqlalchemy.orm.sessionmaker`
   - `extensions.ext_database.db` when used for session acquisition
   - `db.engine`

5. Count and shrink per-test explicit cleanup inside Testcontainers tests. Some tests already delete rows manually and commit, even though the autouse truncate cleans afterward.

## Bottom Line

The suite can become much faster locally without sacrificing concrete behavior verification.

The key changes are:

- Do not use xdist by default locally.
- Do not start Redis, Sandbox, or Plugin Daemon unless selected tests require them.
- Move mock-heavy controller tests out of Testcontainers.
- Gradually refactor dirty session paths so clean endpoints can use nested transaction/savepoint isolation.
- Add persistent local environment support for tight agentic edit loops.

The biggest immediate wins are selective service startup and minimal pytest plugin loading. For tight single-test loops, the dominant remaining cost is eager backend import architecture; for database-backed loops, persistent Postgres plus idempotent schema bootstrap removes container lifecycle and repeated DDL while preserving concrete behavior verification.
