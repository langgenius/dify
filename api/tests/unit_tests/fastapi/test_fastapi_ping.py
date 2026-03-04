from fastapi.testclient import TestClient

from fastapi_app import app


def test_fastapi_ping_returns_pong():
    client = TestClient(app)

    response = client.get("/console/api/ping")

    assert response.status_code == 200
    assert response.json() == {"result": "pong"}
