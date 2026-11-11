from fastapi import FastAPI
from fastapi.testclient import TestClient

from dify_agent.server.auth import create_bearer_token_dependency


def _build_app(expected_token: str | None) -> FastAPI:
    app = FastAPI()
    dep = create_bearer_token_dependency(expected_token)

    @app.get("/protected", dependencies=[dep])
    async def protected() -> dict[str, str]:
        return {"status": "ok"}

    return app


class TestBearerTokenAuthEnabled:
    """Auth is enforced when a non-None token is configured."""

    def test_missing_header_returns_401(self) -> None:
        client = TestClient(_build_app("secret-token"))
        response = client.get("/protected")
        assert response.status_code == 401
        assert "missing" in response.json()["detail"]

    def test_invalid_scheme_returns_401(self) -> None:
        client = TestClient(_build_app("secret-token"))
        response = client.get("/protected", headers={"Authorization": "Basic abc"})
        assert response.status_code == 401
        assert "scheme" in response.json()["detail"]

    def test_wrong_token_returns_401(self) -> None:
        client = TestClient(_build_app("secret-token"))
        response = client.get("/protected", headers={"Authorization": "Bearer wrong"})
        assert response.status_code == 401
        assert "invalid bearer token" in response.json()["detail"]

    def test_correct_token_passes(self) -> None:
        client = TestClient(_build_app("secret-token"))
        response = client.get("/protected", headers={"Authorization": "Bearer secret-token"})
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestBearerTokenAuthDisabled:
    """Auth is a no-op when expected_token is None (backward compatibility)."""

    def test_no_header_passes_when_token_unconfigured(self) -> None:
        client = TestClient(_build_app(None))
        response = client.get("/protected")
        assert response.status_code == 200

    def test_any_header_passes_when_token_unconfigured(self) -> None:
        client = TestClient(_build_app(None))
        response = client.get("/protected", headers={"Authorization": "Bearer anything"})
        assert response.status_code == 200
