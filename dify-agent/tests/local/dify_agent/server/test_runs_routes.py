from fastapi.testclient import TestClient

from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID
from dify_agent.runtime.run_scheduler import SchedulerStoppingError
from dify_agent.server.routes.runs import create_runs_router
from dify_agent.server.schemas import RunRecord


class FakeScheduler:
    async def create_run(self, request: object) -> object:
        del request
        return RunRecord(run_id="run-1", status="running")


class FakeStore:
    pass


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
                "schema_version": 1,
                "layers": [{"name": "prompt", "type": "plain.prompt", "config": {"user": ["", "   "]}}],
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
                "schema_version": 1,
                "layers": [{"name": "prompt", "type": "plain.prompt", "config": {"user": "hello"}}],
            }
        },
    )

    assert response.status_code == 202
    assert response.json() == {"run_id": "run-1", "status": "running"}


def test_cancel_run_endpoint_is_reserved_but_not_implemented() -> None:
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: FakeScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post("/runs/run-1/cancel", json={"reason": "user_cancelled"})

    assert response.status_code == 501
    assert response.json()["detail"] == "run cancellation is not implemented"


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
                "schema_version": 1,
                "layers": [
                    {"name": "prompt", "type": "plain.prompt", "config": {"user": "hello"}},
                    {
                        "name": "execution-context-renamed",
                        "type": "dify.execution_context",
                        "config": {
                            "tenant_id": "tenant-1",
                            "user_from": "account",
                            "agent_mode": "workflow_run",
                            "invoke_from": "service-api",
                        },
                    },
                    {
                        "name": DIFY_AGENT_MODEL_LAYER_ID,
                        "type": "dify.plugin.llm",
                        "deps": {"execution_context": "execution-context-renamed"},
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


def test_create_run_accepts_unknown_layer_exit_signal_request() -> None:
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
                "schema_version": 1,
                "layers": [{"name": "prompt", "type": "plain.prompt", "config": {"user": "hello"}}],
            },
            "on_exit": {"layers": {"missing": "delete"}},
        },
    )

    assert response.status_code == 202
    assert response.json() == {"run_id": "run-1", "status": "running"}


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
                "schema_version": 1,
                "layers": [{"name": "prompt", "type": "plain.prompt", "config": {"user": "hello"}}],
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
                "schema_version": 1,
                "layers": [{"name": "prompt", "type": "plain.prompt", "config": {"user": "hello"}}],
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
                "schema_version": 1,
                "layers": [{"name": "prompt", "type": "plain.prompt", "config": {"user": "hello"}}],
            }
        },
    )

    assert response.status_code == 500
