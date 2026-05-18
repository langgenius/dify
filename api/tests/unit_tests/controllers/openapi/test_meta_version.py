"""Meta endpoint /openapi/v1/_version — no auth, returns version + edition."""

from __future__ import annotations


def test_version_endpoint_returns_200_without_auth(openapi_app):
    client = openapi_app.test_client()
    response = client.get("/openapi/v1/_version")

    assert response.status_code == 200
    payload = response.get_json()
    assert isinstance(payload, dict)
    assert "version" in payload
    assert "edition" in payload
    assert isinstance(payload["version"], str)
    assert payload["edition"] in ("SELF_HOSTED", "CLOUD")


def test_version_endpoint_ignores_bearer_header(openapi_app):
    """Endpoint is auth-free — a bogus bearer should not break it."""
    client = openapi_app.test_client()
    response = client.get(
        "/openapi/v1/_version",
        headers={"Authorization": "Bearer total-nonsense"},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert "version" in payload
    assert "edition" in payload


def test_version_endpoint_reflects_edition_config(openapi_app, monkeypatch):
    from configs import dify_config

    monkeypatch.setattr(dify_config, "EDITION", "CLOUD")

    client = openapi_app.test_client()
    response = client.get("/openapi/v1/_version")

    assert response.status_code == 200
    assert response.get_json()["edition"] == "CLOUD"


def test_version_endpoint_falls_back_to_self_hosted_on_unexpected_edition(openapi_app, monkeypatch):
    from configs import dify_config

    monkeypatch.setattr(dify_config, "EDITION", "EXPERIMENTAL")

    client = openapi_app.test_client()
    response = client.get("/openapi/v1/_version")

    assert response.status_code == 200
    assert response.get_json()["edition"] == "SELF_HOSTED"
