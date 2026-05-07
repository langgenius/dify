from fastapi.testclient import TestClient

from dify_agent.server.routes.runs import create_runs_router


class FakeStore:
    async def create_run(self, request: object) -> object:
        raise AssertionError("blank prompt requests must be rejected before enqueue")


def test_create_run_rejects_effectively_blank_user_prompt_list() -> None:
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(create_runs_router(lambda: FakeStore()))  # pyright: ignore[reportArgumentType]
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
