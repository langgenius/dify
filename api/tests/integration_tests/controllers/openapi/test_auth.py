"""Integration tests for the /openapi/v1 bearer auth surface.

Layer 0 (workspace membership), per-token rate limit, and read-scope (`apps:read`)
acceptance/rejection on app-scoped routes.
"""

from __future__ import annotations

import uuid
from collections.abc import Generator

import pytest
from flask import Flask
from flask.testing import FlaskClient

from extensions.ext_database import db
from models import App, Tenant


def test_expired_token_returns_401_token_expired(
    test_client: FlaskClient,
    expired_account_token: str,
) -> None:
    """An expired bearer is distinguishable from an unknown one: 401 with the
    domain code ``token_expired`` (+ actionable hint), not a generic 401 or 500."""
    res = test_client.get(
        "/openapi/v1/account",
        headers={"Authorization": f"Bearer {expired_account_token}"},
    )
    assert res.status_code == 401
    assert res.json["code"] == "token_expired"
    assert res.json["hint"]


def test_expired_token_replay_stays_token_expired(
    test_client: FlaskClient,
    expired_account_token: str,
) -> None:
    """The distinct ``expired`` negative-cache marker keeps the second hit (served
    from cache, inside NEGATIVE_TTL) reporting ``token_expired`` rather than
    collapsing into a generic unknown-token 401."""
    headers = {"Authorization": f"Bearer {expired_account_token}"}
    first = test_client.get("/openapi/v1/account", headers=headers)
    second = test_client.get("/openapi/v1/account", headers=headers)
    assert first.json["code"] == "token_expired"
    assert second.status_code == 401
    assert second.json["code"] == "token_expired"


def test_unknown_token_returns_401_unauthorized_not_500(
    test_client: FlaskClient,
    workspace_account,
) -> None:
    """An unknown bearer is a clean 401 ``unauthorized`` — not the latent 500 the
    pipeline used to leak for unmapped InvalidBearerError."""
    res = test_client.get(
        "/openapi/v1/account",
        headers={"Authorization": "Bearer dfoa_" + uuid.uuid4().hex},
    )
    assert res.status_code == 401
    assert res.json["code"] == "unauthorized"


def test_info_accepts_account_bearer_with_apps_read_scope(
    test_client: FlaskClient,
    app_in_workspace: App,
    account_token: str,
) -> None:
    res = test_client.get(
        f"/openapi/v1/apps/{app_in_workspace.id}/info",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 200
    assert res.json["id"] == app_in_workspace.id


@pytest.fixture
def other_workspace_app(flask_app: Flask) -> Generator[App, None, None]:
    """A fresh app under a *different* tenant — caller has no membership row."""
    with flask_app.app_context():
        other_tenant = Tenant(name="other", status="normal")
        db.session.add(other_tenant)
        db.session.commit()
        app = App(
            tenant_id=other_tenant.id,
            name="b",
            mode="chat",
            status="normal",
            enable_site=True,
            enable_api=True,
        )
        db.session.add(app)
        db.session.commit()
        yield app
        db.session.delete(app)
        db.session.delete(other_tenant)
        db.session.commit()


def test_layer0_denies_account_bearer_without_membership(
    test_client: FlaskClient,
    account_token: str,
    other_workspace_app: App,
) -> None:
    """Account A bearer hitting an app under tenant B — Layer 0 denies on CE."""
    res = test_client.get(
        f"/openapi/v1/apps/{other_workspace_app.id}/info",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 403
    assert res.json.get("message") == "workspace_membership_revoked"


def test_layer0_skipped_when_enterprise_enabled(
    test_client: FlaskClient,
    account_token: str,
    other_workspace_app: App,
    monkeypatch,
) -> None:
    """On EE, Layer 0 short-circuits — gateway RBAC owns tenant isolation.

    /info uses validate_bearer + require_workspace_member inline (no
    AppAuthzCheck), so a cross-tenant bearer reaches the app lookup and
    gets 200 — gateway is expected to enforce isolation upstream.
    """
    from configs import dify_config

    # Override the conftest autouse default for this test only.
    monkeypatch.setattr(dify_config, "ENTERPRISE_ENABLED", True)

    res = test_client.get(
        f"/openapi/v1/apps/{other_workspace_app.id}/info",
        headers={"Authorization": f"Bearer {account_token}"},
    )
    assert res.status_code == 200
    assert res.json.get("message") != "workspace_membership_revoked"


def test_rate_limit_returns_429_after_60_requests(
    test_client: FlaskClient,
    account_token: str,
) -> None:
    """61st sequential GET to /account on the same bearer → 429 with Retry-After."""
    headers = {"Authorization": f"Bearer {account_token}"}
    for i in range(60):
        r = test_client.get("/openapi/v1/account", headers=headers)
        assert r.status_code == 200, f"unexpected fail at i={i}"

    r = test_client.get("/openapi/v1/account", headers=headers)
    assert r.status_code == 429
    assert r.headers.get("Retry-After"), "Retry-After header missing"
    assert int(r.headers["Retry-After"]) >= 1
    body = r.json or {}
    assert body.get("error") == "rate_limited"
    assert isinstance(body.get("retry_after_ms"), int)
    assert body["retry_after_ms"] >= 1000


def test_rate_limit_bucket_shared_across_surfaces(
    test_client: FlaskClient,
    app_in_workspace: App,
    account_token: str,
) -> None:
    """30 calls to /account + 30 calls to /apps/<id>/info on same token → 61st 429s."""
    headers = {"Authorization": f"Bearer {account_token}"}
    for _ in range(30):
        assert test_client.get("/openapi/v1/account", headers=headers).status_code == 200
    for _ in range(30):
        assert test_client.get(f"/openapi/v1/apps/{app_in_workspace.id}/info", headers=headers).status_code == 200

    r = test_client.get("/openapi/v1/account", headers=headers)
    assert r.status_code == 429
