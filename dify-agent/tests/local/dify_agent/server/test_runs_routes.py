from fastapi.testclient import TestClient

from dify_agent.runtime.run_scheduler import SchedulerStoppingError
from dify_agent.server.routes.runs import create_runs_router
from dify_agent.server.schemas import RunRecord


class FakeScheduler:
    async def create_run(self, request: object) -> object:
        raise AssertionError("blank prompt requests must be rejected before scheduling")


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
            "compositor": {
                "schema_version": 1,
                "layers": [{"name": "prompt", "type": "plain.prompt", "config": {"user": ["", "   "]}}],
            }
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "compositor.user_prompts must not be empty"


def test_create_run_returns_running_from_scheduler() -> None:
    from fastapi import FastAPI

    class CapturingScheduler:
        async def create_run(self, request: object) -> RunRecord:
            del request
            return RunRecord(run_id="run-1", status="running", request=_request())

    app = FastAPI()
    app.include_router(
        create_runs_router(lambda: FakeStore(), lambda: CapturingScheduler())  # pyright: ignore[reportArgumentType]
    )
    client = TestClient(app)

    response = client.post(
        "/runs",
        json={
            "compositor": {
                "schema_version": 1,
                "layers": [{"name": "prompt", "type": "plain.prompt", "config": {"user": "hello"}}],
            }
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
            "compositor": {
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
            "compositor": {
                "schema_version": 1,
                "layers": [{"name": "prompt", "type": "plain.prompt", "config": {"user": "hello"}}],
            }
        },
    )

    assert response.status_code == 500


def _request():
    from agenton.compositor import CompositorConfig, LayerNodeConfig
    from dify_agent.server.schemas import CreateRunRequest

    return CreateRunRequest(
        compositor=CompositorConfig(
            layers=[LayerNodeConfig(name="prompt", type="plain.prompt", config={"user": "hello"})]
        )
    )
