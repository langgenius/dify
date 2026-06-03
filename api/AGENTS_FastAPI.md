# AGENTS_FastAPI.md

## Scope

This guide applies to the FastAPI/API v2 migration work in Dify, especially:

- `api/fastapi_app.py`
- `api/api_fastapi/**`
- `api/tests_fastapi/**`
- frontend calls intentionally routed to `/api/v2/**`
- dev runtime wiring for the standalone ASGI process

Also read `AGENTS.md`, `api/AGENTS.md`, and `web/AGENTS.md` when changing shared backend or frontend code.

## Architecture

This project is in the process of migrating to FastAPI from Flask + Flask-RESTX for the performance from ASGI
and the improved documentation infrastructure.
The new APIs are being migrated to `/api/v2` with code in a clean directory `api_fastapi`. Only after the
migration is mature will the directory be flattened.

## Test instructions

- Override the "no intg test" instruction in the global AGENTS.md
- Mock and verify contracts, not behaviors!
  - Bad: mock_service.do_something.assert_called_once()
  - Bad: mock_session.select.assert_called_with(...)
  - Good: Send API request -> Fetch from DB -> Assert DB state changed correctly.
  - Good: Send API request -> Assert response JSON matches expected Pydantic schema (Contract).
- Write high-quality unit tests for the service layer and non-API code/modules
- Write integration tests using the dedicated `tests_fastapi` testcontainers fixtures. They are session-scoped
  and lazy, so only tests that request them should start PostgreSQL/Redis.
  - For most router tests whose code is merely a call into service layer, write integration tests for the whole
    API using TestClient.
  - For complex behavior and write logic, call the API and verify the resulting DB state. Use the local sync and
    async savepoint patterns in `tests_fastapi/test_container_integration.py` when the endpoint commits.
  - For non-API code (doesn't exist yet), also write intg tests
- Only write router-layer unit test for those whose router behavior is very complicated or call expensive
  services (e.g. unmockable external API)

## FastAPI Conventions

- Stick to RESTful conventions. Endpoint should express resource, unless we really need to put action
  into URL. Use standard HTTP status code where possible.
- OpenAPI generation is on. Make sure endpoints are documented.
- Use dependency injection in arguments to access database sessions/transactions, users (if necessary)
- Use Pydantic v2 for complicated query params and annotated arg for simple ones. For common patterns
  like paginations, use reusable ones.
- Use established patterns for request/response and error/HTTP status code patterns.
  Refer to `api/api_fastapi/API_SCHEMA_GUIDE.md` for further instructions.
  Do not wrap normal data response in envelopes like `{"result (or data)": ...}`
  Directly return values. Use 204 for those with an always-empty body
- Use the idiomatic way (TODO: to be defined) to express the requirement for login/permission state.

- The current codebase rely on legacy behavior from Flask-Login for session management. Keep it until
  further instructions.
- For now, mostly business logic get the service layer. If existing ones exist, reuse.
  During migration, if the existing controller code operate DB directly in the controller, then move
  them to the service layer.

## SQLAlchemy Conventions

- API v2 routes should receive sync or async DB sessions through FastAPI dependencies, not by constructing
  sessions in route bodies.
- TODO: Alembic (Testcontainers currently initialize schema with `db.create_all()`)
- Tests that need rollback isolation should override the FastAPI session dependency and wrap endpoint commits in
  an outer transaction plus nested savepoints. This protects dependency-injected sessions only; legacy global
  `db.session` access may need refactoring or separate cleanup.
- TODO: Define auth/current-user/current-tenant dependencies before migrating protected routes.
