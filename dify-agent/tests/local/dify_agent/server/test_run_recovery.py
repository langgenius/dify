"""HTTP wiring unit cases; concrete Redis admission has separate coverage."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dify_agent.server.auth import create_bearer_token_dependency
from dify_agent.server.routes.runs import create_runs_router


def test_lookup_has_same_bearer_and_returns_only_acceptance_with_no_store():
    from dify_agent.protocol.schemas import CreateRunResponse

    class Store:
        async def lookup_run(self, selection):
            return CreateRunResponse(run_id="original", status="waiting")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: Store(), lambda: None, enable_lookup=True),
        dependencies=[create_bearer_token_dependency("secret")],
    )
    client = TestClient(app)
    body = {"idempotency_key": "key", "request_digest": "a" * 64}
    assert client.post("/runs/lookup", json=body).status_code == 401
    assert client.post("/runs/lookup", json=body, headers={"Authorization": "Bearer wrong"}).status_code == 401
    response = client.post("/runs/lookup", json=body, headers={"Authorization": "Bearer secret"})
    assert response.status_code == 200
    assert response.json() == {"run_id": "original", "status": "waiting"}
    assert response.headers["cache-control"] == "no-store"


def test_lookup_missing_conflict_invalid_and_anonymous_mode_never_dispatch():
    from dify_agent.storage.redis_run_store import RunCreateConflictError, RunNotFoundError

    class Store:
        async def lookup_run(self, selection):
            if selection.idempotency_key == "missing":
                raise RunNotFoundError("missing")
            raise RunCreateConflictError("private detail")

    app = FastAPI()
    app.include_router(create_runs_router(lambda: Store(), lambda: None, enable_lookup=True))
    client = TestClient(app)
    for key, status in [("missing", 404), ("mismatch", 409)]:
        response = client.post("/runs/lookup", json={"idempotency_key": key, "request_digest": "a" * 64})
        assert response.status_code == status
        assert response.headers["cache-control"] == "no-store"
        assert "private detail" not in response.text
    assert (
        client.post("/runs/lookup", json={"idempotency_key": "k" * 257, "request_digest": "a" * 64}).status_code == 422
    )
    anonymous = FastAPI()
    anonymous.include_router(create_runs_router(lambda: Store(), lambda: None))
    assert TestClient(anonymous).post("/runs/lookup", json={}).status_code == 405


def test_lookup_rejects_private_extra_input_without_echo_or_store_access():
    class Store:
        async def lookup_run(self, selection):
            raise AssertionError("invalid private input reached the store")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: Store(), lambda: None, enable_lookup=True),
        dependencies=[create_bearer_token_dependency("secret")],
    )
    client = TestClient(app)
    response = client.post(
        "/runs/lookup",
        json={
            "idempotency_key": "key",
            "request_digest": "a" * 64,
            "composition": {"api_key": "sentinel-private-config"},
        },
        headers={"Authorization": "Bearer secret"},
    )
    assert response.status_code == 422
    assert "sentinel-private-config" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert len(response.content) < 128


def test_lookup_rejects_oversized_and_malformed_private_bodies_with_bounded_errors():
    class Store:
        async def lookup_run(self, selection):
            raise AssertionError("invalid private input reached the store")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: Store(), lambda: None, enable_lookup=True),
        dependencies=[create_bearer_token_dependency("secret")],
    )
    client = TestClient(app)
    for content, status in [
        (b'{"composition":{"api_key":"sentinel-private-config","padding":"' + b"x" * 100000 + b'"}}', 413),
        (b'{"idempotency_key":"sentinel-private-config",', 422),
    ]:
        response = client.post(
            "/runs/lookup",
            content=content,
            headers={"Authorization": "Bearer secret", "Content-Type": "application/json"},
        )
        assert response.status_code == status
        assert "sentinel-private-config" not in response.text
        assert response.headers["cache-control"] == "no-store"
        assert len(response.content) < 128
