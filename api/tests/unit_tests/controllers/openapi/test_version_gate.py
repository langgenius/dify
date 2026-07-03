"""Tests for the difyctl version gate on /openapi/v1 (HTTP 426 Upgrade Required).

The gate is an app-level ``before_app_request`` hook: it must fire before routing,
so requests to *removed* paths (which no longer match a route) become 426 rather
than a bare 404. It reads the difyctl version from the User-Agent and fails open
for anything it can't confidently identify as an outdated difyctl.
"""

from __future__ import annotations

import uuid

import pytest
from flask import Flask

# 0.1.0 < MIN_DIFYCTL_VERSION (0.2.0); 0.2.0 is exactly the floor (allowed).
OLD_UA = "difyctl/0.1.0 (darwin; arm64; stable)"
CURRENT_UA = "difyctl/0.2.0 (darwin; arm64; stable)"


@pytest.fixture
def client(openapi_app: Flask):
    return openapi_app.test_client()


def _gated_path() -> str:
    """An existing, auth-guarded route on the surface (GET /apps/<id>)."""
    return f"/openapi/v1/apps/{uuid.uuid4()}"


class TestVersionGate:
    def test_old_client_gets_426_with_upgrade_body(self, client):
        res = client.get(_gated_path(), headers={"User-Agent": OLD_UA})

        assert res.status_code == 426
        body = res.get_json()
        assert body["code"] == "upgrade_required"
        assert body["status"] == 426
        assert "0.1.0" in body["message"]
        assert "0.2.0" in body["message"]
        assert "docs.dify.ai" in body["hint"]

    def test_removed_old_path_gets_426_not_404(self, client):
        # /apps/<id>/run was renamed to /apps/<id>:run — the old path matches no
        # route. The app-level gate must still turn it into 426, not a bare 404.
        res = client.post(
            f"/openapi/v1/apps/{uuid.uuid4()}/run",
            headers={"User-Agent": OLD_UA},
            json={"inputs": {}},
        )

        assert res.status_code == 426
        assert res.get_json()["code"] == "upgrade_required"

    def test_current_client_passes_gate(self, client):
        # Gate passes → normal dispatch (auth rejects, never the gate's 426).
        res = client.get(_gated_path(), headers={"User-Agent": CURRENT_UA})

        assert res.status_code != 426

    def test_non_difyctl_ua_passes(self, client):
        res = client.get(_gated_path(), headers={"User-Agent": "curl/8.4.0"})

        assert res.status_code != 426

    def test_missing_ua_passes(self, client):
        res = client.get(_gated_path())

        assert res.status_code != 426

    def test_unparseable_version_passes(self, client):
        res = client.get(_gated_path(), headers={"User-Agent": "difyctl/notaversion (x; y; z)"})

        assert res.status_code != 426

    def test_version_probe_allowlisted(self, client):
        res = client.get("/openapi/v1/_version", headers={"User-Agent": OLD_UA})

        assert res.status_code == 200

    def test_health_allowlisted(self, client):
        res = client.get("/openapi/v1/_health", headers={"User-Agent": OLD_UA})

        assert res.status_code == 200
