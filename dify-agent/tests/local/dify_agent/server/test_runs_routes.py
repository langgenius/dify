import pytest
from fastapi.testclient import TestClient

from dify_agent.protocol import CancelRunResponse, DIFY_AGENT_MODEL_LAYER_ID, RunFailureType
from dify_agent.protocol.schemas import CreateRunRequest, RunStatus
from dify_agent.runtime.run_scheduler import RunCancellationConflictError, SchedulerStoppingError
from dify_agent.server.routes.runs import create_runs_router
from dify_agent.server.schemas import RunRecord
from dify_agent.storage.redis_run_store import IdempotencyConflictError, RunNotFoundError


class FakeScheduler:
    async def create_run(self, request: object) -> object:
        del request
        return RunRecord(run_id="run-1", status="running")

    async def cancel_run(self, run_id: str, request: object) -> CancelRunResponse:
        del request
        return CancelRunResponse(run_id=run_id, status="cancelled")


class FakeStore:
    pass


def test_get_run_status_returns_failure_type() -> None:
    from fastapi import FastAPI

    class FailedRunStore:
        async def get_run(self, run_id: str) -> RunRecord:
            return RunRecord(
                run_id=run_id,
                status="failed",
                error="run limit reached",
                error_type=RunFailureType.AGENT_RUN_LIMIT_EXCEEDED,
                idempotency_key_digest="key-digest",
                idempotency_fingerprint="request-fingerprint",
            )

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FailedRunStore(), lambda: FakeScheduler())  # pyright: ignore[reportArgumentType]
    )
    response = TestClient(app).get("/runs/run-1")

    assert response.status_code == 200
    assert response.json()["error"] == "run limit reached"
    assert response.json()["error_type"] == "agent_run_limit_exceeded"
    assert "idempotency_key_digest" not in response.json()
    assert "idempotency_fingerprint" not in response.json()


def test_create_run_accepts_effectively_blank_user_prompt_list() -> None:
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: FakeScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post(
        "/runs",
        json={
            "composition": {
                "schema_version": 2,
                "layers": [{"name": "prompt", "config": {"user": ["", "   "]}}],
            }
        },
    )

    assert response.status_code == 202
    assert response.json() == {"run_id": "run-1", "status": "running"}


def test_create_run_returns_running_from_scheduler() -> None:
    from fastapi import FastAPI

    class CapturingScheduler:
        async def create_run(self, request: object) -> RunRecord:
            del request
            return RunRecord(run_id="run-1", status="running")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: CapturingScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post(
        "/runs",
        json={
            "composition": {
                "schema_version": 2,
                "layers": [{"name": "prompt", "config": {"user": "hello"}}],
            }
        },
    )

    assert response.status_code == 202
    assert response.json() == {"run_id": "run-1", "status": "running"}


def test_create_run_maps_idempotency_conflict_to_409() -> None:
    from fastapi import FastAPI

    class ConflictingScheduler(FakeScheduler):
        async def create_run(self, request: object) -> object:
            del request
            raise IdempotencyConflictError("idempotency key was already used with a different create-run request")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: ConflictingScheduler())  # pyright: ignore[reportArgumentType]
    )
    response = TestClient(app).post(
        "/runs",
        json={
            "composition": {"schema_version": 2, "layers": [{"name": "prompt", "config": {"user": "hello"}}]},
            "idempotency_key": "retry-1",
        },
    )

    assert response.status_code == 409
    assert "different create-run request" in response.json()["detail"]


@pytest.mark.parametrize("key", ["", "   ", "\t\n"])
def test_create_run_rejects_blank_idempotency_key_before_scheduling(key: str) -> None:
    from fastapi import FastAPI

    class UncalledScheduler(FakeScheduler):
        async def create_run(self, request: object) -> object:
            pytest.fail("blank idempotency keys must fail validation before scheduling")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: UncalledScheduler())  # pyright: ignore[reportArgumentType]
    )

    response = TestClient(app).post("/runs", json={"composition": {"layers": []}, "idempotency_key": key})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "idempotency_key"]


@pytest.mark.parametrize("key", [None, "retry-1", "  retry-1\t\n"])
def test_create_run_preserves_nonblank_idempotency_keys(key: str | None) -> None:
    from fastapi import FastAPI

    received: list[CreateRunRequest] = []

    class CapturingScheduler(FakeScheduler):
        async def create_run(self, request: CreateRunRequest) -> RunRecord:
            received.append(request)
            return RunRecord(run_id="run-1", status="running")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: CapturingScheduler())  # pyright: ignore[reportArgumentType]
    )

    response = TestClient(app).post("/runs", json={"composition": {"layers": []}, "idempotency_key": key})

    assert response.status_code == 202
    assert len(received) == 1
    assert received[0].idempotency_key == key


@pytest.mark.parametrize("status", ["succeeded", "failed", "cancelled"])
def test_create_run_returns_current_terminal_status_for_idempotent_replay(status: RunStatus) -> None:
    from fastapi import FastAPI

    class ReplayScheduler(FakeScheduler):
        async def create_run(self, request: object) -> RunRecord:
            return RunRecord(run_id="original-run", status=status)

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: ReplayScheduler())  # pyright: ignore[reportArgumentType]
    )

    response = TestClient(app).post("/runs", json={"composition": {"layers": []}, "idempotency_key": "retry-1"})

    assert response.status_code == 202
    assert response.json() == {"run_id": "original-run", "status": status}


def test_cancel_run_endpoint_returns_scheduler_result() -> None:
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: FakeScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post("/runs/run-1/cancel", json={"reason": "user_cancelled"})

    assert response.status_code == 200
    assert response.json() == {"run_id": "run-1", "status": "cancelled"}


def test_cancel_run_endpoint_maps_conflict() -> None:
    from fastapi import FastAPI

    class ConflictingScheduler(FakeScheduler):
        async def cancel_run(self, run_id: str, request: object) -> CancelRunResponse:
            del run_id, request
            raise RunCancellationConflictError("run already finished with status 'succeeded'")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: ConflictingScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post("/runs/run-1/cancel", json={})

    assert response.status_code == 409
    assert "already finished" in response.json()["detail"]


def test_cancel_run_endpoint_maps_missing_run() -> None:
    from fastapi import FastAPI

    class MissingRunScheduler(FakeScheduler):
        async def cancel_run(self, run_id: str, request: object) -> CancelRunResponse:
            del request
            raise RunNotFoundError(run_id)

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: MissingRunScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post("/runs/missing/cancel", json={})

    assert response.status_code == 404
    assert response.json() == {"detail": "run not found"}


def test_create_run_accepts_valid_full_plugin_graph() -> None:
    from fastapi import FastAPI

    class CapturingScheduler:
        async def create_run(self, request: object) -> RunRecord:
            del request
            return RunRecord(run_id="run-1", status="running")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: CapturingScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post(
        "/runs",
        json={
            "composition": {
                "schema_version": 2,
                "layers": [
                    {"name": "prompt", "config": {"user": "hello"}},
                    {
                        "name": "execution-context-renamed",
                        "config": {
                            "tenant_id": "tenant-1",
                            "user_from": "account",
                            "agent_mode": "workflow_run",
                            "invoke_from": "service-api",
                        },
                    },
                    {
                        "name": DIFY_AGENT_MODEL_LAYER_ID,
                        "config": {
                            "plugin_id": "langgenius/openai",
                            "model_provider": "openai",
                            "model": "gpt-4o-mini",
                            "credentials": {"api_key": "secret"},
                            "model_settings": {"temperature": 0.2},
                        },
                    },
                ],
            }
        },
    )

    assert response.status_code == 202
    assert response.json() == {"run_id": "run-1", "status": "running"}


def test_create_run_rejects_removed_layer_exit_signal_request() -> None:
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: FakeScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post(
        "/runs",
        json={
            "composition": {
                "schema_version": 2,
                "layers": [{"name": "prompt", "config": {"user": "hello"}}],
            },
            "on_exit": {"layers": {"missing": "delete"}},
        },
    )

    assert response.status_code == 422


def test_create_run_accepts_closed_session_snapshot_request() -> None:
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: FakeScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post(
        "/runs",
        json={
            "composition": {
                "schema_version": 2,
                "layers": [{"name": "prompt", "config": {"user": "hello"}}],
            },
            "session_snapshot": {
                "schema_version": 1,
                "layers": [
                    {
                        "name": "prompt",
                        "lifecycle_state": "closed",
                        "runtime_state": {},
                    }
                ],
            },
        },
    )

    assert response.status_code == 202
    assert response.json() == {"run_id": "run-1", "status": "running"}


def test_create_run_returns_503_when_scheduler_is_stopping() -> None:
    from fastapi import FastAPI

    class StoppingScheduler:
        async def create_run(self, request: object) -> RunRecord:
            del request
            raise SchedulerStoppingError("run scheduler is shutting down")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: StoppingScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post(
        "/runs",
        json={
            "composition": {
                "schema_version": 2,
                "layers": [{"name": "prompt", "config": {"user": "hello"}}],
            }
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "run scheduler is shutting down"


def test_create_run_does_not_map_infrastructure_failure_to_422() -> None:
    from fastapi import FastAPI

    class FailingScheduler:
        async def create_run(self, request: object) -> RunRecord:
            del request
            raise RuntimeError("redis unavailable")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: FailingScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app, raise_server_exceptions=False)

    response = client.post(
        "/runs",
        json={
            "composition": {
                "schema_version": 2,
                "layers": [{"name": "prompt", "config": {"user": "hello"}}],
            }
        },
    )

    assert response.status_code == 500
