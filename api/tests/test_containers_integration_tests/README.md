# Testcontainers Integration Tests

## Scope

| Layer | Coverage |
| --- | --- |
| `commands/` | CLI and migration behavior |
| `controllers/` | Routed HTTP contracts and persistence contracts |
| `core/` | Database- and service-backed core behavior |
| `libs/` | Infrastructure adapters |
| `models/` | ORM behavior and relationships |
| `repositories/` | SQLAlchemy repository contracts |
| `services/` | Service orchestration and persistence |
| `tasks/` | Task behavior with real persistence |
| `trigger/` | Trigger providers and execution |
| `workflow/` | Workflow execution and persistence |

## Requirements

- Docker daemon
- Python 3.12
- API development dependencies: `uv sync --project api --dev`
- Pull access for required container images

## Commands

```bash
# One file
uv run --project api --dev pytest \
  api/tests/test_containers_integration_tests/controllers/console/test_apikey.py

# One test
uv run --project api --dev pytest \
  api/tests/test_containers_integration_tests/controllers/console/test_apikey.py::TestAppApiKeyListResource::test_get_returns_persisted_keys

# Full suite
uv run --project api --dev pytest -p no:benchmark \
  --timeout "${PYTEST_TIMEOUT:-180}" \
  api/tests/test_containers_integration_tests

# Make target with a focused path
make test TARGET_TESTS=api/tests/test_containers_integration_tests/controllers/console/test_apikey.py

# Full backend suite
make test-all
```

- xdist: disabled; `-n`, `-n auto`, and other worker options are rejected before execution

## Execution Model

| Resource | Lifetime | Initialization |
| --- | --- | --- |
| Selected containers | Pytest session | First container-backed fixture |
| Docker network | Pytest session | First selected container |
| PostgreSQL schema | Pytest session | First application fixture |
| Database-only Flask app | Pytest session | `database_app_with_containers` |
| Full Flask app | Pytest session | `flask_app_with_containers` |
| Flask test client | Test | `test_client_with_containers` |
| Test transaction | Test | Transactional session fixture |

- PostgreSQL is always selected.
- The full Flask application is loaded only by fixtures that depend on `flask_app_with_containers`.
- Database-only tests use `database_app_with_containers` and avoid `app_factory.create_app()`.
- Containers stop at Python process exit.
- Persistent cross-process container reuse is not supported.

## Service Selection

- Default: `--tc-services=auto`

| Selection | Services |
| --- | --- |
| `auto` | PostgreSQL plus services inferred from collected tests |
| `all` | PostgreSQL, Redis, Sandbox, Plugin Daemon |
| Comma-separated list | Named services plus PostgreSQL |

```bash
uv run --project api --dev pytest --tc-services=postgres,redis <path>
uv run --project api --dev pytest --tc-services=all <path>
DIFY_TESTCONTAINERS_SERVICES=postgres,redis uv run --project api --dev pytest <path>
```

### Automatic Rules

| Signal | Selected service |
| --- | --- |
| `@pytest.mark.requires_redis` | Redis |
| `@pytest.mark.requires_sandbox` | Sandbox |
| `@pytest.mark.requires_plugin_daemon` | Plugin Daemon and Redis |
| Code-executor test path | Sandbox |
| Direct shared Redis-client import in a selected test file | Redis |

Marker example:

```python
@pytest.mark.requires_redis
def test_cache_invalidation(...) -> None:
    ...
```

- Unselected services: inert loopback endpoints
- Unexpected calls: connection failure; no developer-environment fallback

## Core Fixtures

| Fixture | Application | Isolation | Use |
| --- | --- | --- | --- |
| `database_session_with_containers` | Database-only | Truncate | Database paths incompatible with rollback isolation |
| `db_session_with_containers` | Full | Truncate | Full-application paths incompatible with rollback isolation |
| `database_only_transactional_session` | Database-only | Outer transaction | Models, repositories, database-only services |
| `transactional_db_session` | Full | Outer transaction | Routed controllers and Flask-dependent services |
| `database_state` | Full | Outer transaction | Fresh post-request persistence assertions |
| `test_client_with_containers` | Full | Fixture-dependent | Routed HTTP requests |
| `flask_req_ctx_with_containers` | Full | Fixture-dependent | Request-context-dependent code |

### Console Fixtures

| Fixture | Data |
| --- | --- |
| `authenticated_console_client` | Account, owner tenant, membership, setup record, JWT, CSRF headers |
| `console_account_factory` | Additional account and tenant with selectable role |
| `console_app_factory` | Persisted app owned by the authenticated tenant |
| `authenticated_console_app_client` | Authenticated client plus persisted app |
| `authenticated_console_agent_client` | Authenticated client plus persisted agent app and agent record |

## Database Isolation

### Rollback Isolation

`transactional_db_session` and `database_only_transactional_session`:

- Open one outer transaction.
- Rebind `db.session` to the transaction connection.
- Rebind `core.db.session_factory` to the transaction connection.
- Run application commits below savepoints.
- Apply `no_container_truncate` automatically.
- Roll back the outer transaction after the test.
- Fail when application code ends the outer transaction.

Eligible database paths:

- Injected `Session`
- `db.session`
- `core.db.session_factory`
- `sessionmaker(db.engine)` compatible with the rebound connection

Ineligible database paths:

- `db.engine.begin()` with independently owned transaction boundaries
- Engine-typed service dependencies
- Separately configured engines or session factories
- Connections that bypass the rebound application engine

### Truncate Isolation

- Default fallback for container-backed application fixtures.
- Runs `TRUNCATE ... RESTART IDENTITY CASCADE` after each test.
- Flushes Redis after each test when Redis is selected and initialized.
- Does not clean object storage or ad hoc SQLAlchemy metadata.
- `no_container_truncate` requires another fixture to own cleanup.

### Post-Request Assertions

```python
def test_create(
    authenticated_console_client: AuthenticatedConsoleClient,
    database_state: DatabaseState,
) -> None:
    tenant_id = authenticated_console_client.tenant.id

    with database_state.expect_count_change(MyModel, MyModel.tenant_id == tenant_id, before=0, after=1):
        response = authenticated_console_client.client.post(...)
        assert response.status_code == 201

    persisted = database_state.one(MyModel, MyModel.id == response.json["id"])
    assert persisted.tenant_id == tenant_id
```

- Capture scalar IDs before the request.
- Do not retain setup ORM objects across request teardown.
- Use `database_state.one`, `all`, `count`, or `expect_count_change` after requests.

## Controller Test Contract

- Enter controller behavior through the Flask test client.
- Do not call unwrapped controller methods.
- Seed concrete database rows before positive `GET` requests.
- Assert status, complete stable response payload, ownership filtering, and pagination metadata.
- Assert persisted state after write requests.
- Include same-tenant and foreign-tenant rows for ownership-sensitive paths.
- Use real service and database behavior inside the application boundary.
- Mock only external network, provider, mail, queue, or nondeterministic boundaries.
- Assert external-boundary call arguments when they are part of the contract.
- Keep pure helper tests outside this suite when no real infrastructure contract exists.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `DIFY_TESTCONTAINERS_SERVICES` | `auto` | Default service selection |
| `DIFY_TESTCONTAINERS_STORAGE_ROOT` | `/tmp/dify-storage` | Filesystem-backed test storage |
| `DIFY_SANDBOX_TEST_IMAGE` | `langgenius/dify-sandbox:0.2.14` | Sandbox image override |
| `PYTEST_TIMEOUT` | `180` in Make and CI commands | Per-test timeout |
| `LITELLM_LOCAL_MODEL_COST_MAP` | `true` in Make and CI | Disable repeated remote cost-map fetches |

## CI

| Suite | xdist | Container selection |
| --- | --- | --- |
| Unit tests outside controllers | `-n auto` | None |
| Controller unit tests | `-n auto` | None |
| Legacy integration tests | `-n auto` | Middleware stack |
| Testcontainers integration tests | Disabled | `--tc-services=auto` |

## Diagnostics

```bash
# Slow tests and fixtures
uv run --project api --dev pytest --durations=25 <path>

# Fixture setup and teardown order
uv run --project api --dev pytest --setup-show <path>

# Explicit infrastructure comparison
uv run --project api --dev pytest --tc-services=postgres <path>
uv run --project api --dev pytest --tc-services=all <path>

# Stop after the first failure
uv run --project api --dev pytest -x <path>
```
