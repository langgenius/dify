from fastapi.testclient import TestClient

from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID
from dify_agent.runtime.run_scheduler import RunRequestValidationError, SchedulerStoppingError
from dify_agent.server.routes.runs import create_runs_router
from dify_agent.server.schemas import RunRecord


class FakeScheduler:
    async def create_run(self, request: object) -> object:
        del request
        raise RunRequestValidationError("run.user_prompts must not be empty")


class FakeStore:
    pass


def test_create_run_rejects_effectively_blank_user_prompt_list() -> None:
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

    assert response.status_code == 422
    assert response.json()["detail"] == "run.user_prompts must not be empty"


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
                        "name": "plugin-renamed",
                        "type": "dify.plugin",
                        "config": {"tenant_id": "tenant-1", "plugin_id": "langgenius/openai"},
                    },
                    {
                        "name": DIFY_AGENT_MODEL_LAYER_ID,
                        "type": "dify.plugin.llm",
                        "deps": {"plugin": "plugin-renamed"},
                        "config": {
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


def test_create_run_rejects_unknown_layer_exit_signal_before_scheduling() -> None:
    from fastapi import FastAPI

    class UnknownSignalScheduler:
        async def create_run(self, request: object) -> RunRecord:
            del request
            raise RunRequestValidationError("on_exit.layers references unknown layer ids: missing.")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: UnknownSignalScheduler())  # pyright: ignore[reportArgumentType]
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

    assert response.status_code == 422
    assert "missing" in response.json()["detail"]


def test_create_run_rejects_closed_session_snapshot_with_422() -> None:
    from fastapi import FastAPI

    class ClosedSnapshotScheduler:
        async def create_run(self, request: object) -> RunRecord:
            del request
            raise RunRequestValidationError("Layer 'prompt' is closed; CLOSED snapshots cannot be entered.")

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: ClosedSnapshotScheduler())  # pyright: ignore[reportArgumentType]
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

    assert response.status_code == 422
    assert "CLOSED snapshots cannot be entered" in response.json()["detail"]


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
