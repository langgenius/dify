"""Shared fixtures for /openapi/v1/* integration tests."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from flask import Flask

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models import Account, App, OAuthAccessToken, Tenant, TenantAccountJoin
from models.account import AccountStatus


def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@pytest.fixture(autouse=True)
def disable_enterprise(monkeypatch):
    """Default to CE behaviour for /openapi/v1 tests. Tests that exercise the
    EE branch override this with their own monkeypatch in-test."""
    from configs import dify_config

    monkeypatch.setattr(dify_config, "ENTERPRISE_ENABLED", False)


@pytest.fixture
def workspace_account(flask_app: Flask) -> Generator[tuple[Account, Tenant, TenantAccountJoin], None, None]:
    with flask_app.app_context():
        tenant = Tenant(name="t1", status="normal")
        account = Account(email="u@example.com", name="u")
        db.session.add_all([tenant, account])
        db.session.commit()
        account.status = AccountStatus.ACTIVE
        join = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role="owner")
        db.session.add(join)
        db.session.commit()
        yield account, tenant, join
        db.session.delete(join)
        db.session.delete(account)
        db.session.delete(tenant)
        db.session.commit()


@pytest.fixture
def app_in_workspace(flask_app: Flask, workspace_account) -> Generator[App, None, None]:
    _, tenant, _ = workspace_account
    with flask_app.app_context():
        app = App(tenant_id=tenant.id, name="a", mode="chat", status="normal", enable_site=True, enable_api=True)
        db.session.add(app)
        db.session.commit()
        yield app
        db.session.delete(app)
        db.session.commit()


@pytest.fixture
def mint_token(flask_app: Flask):
    """Factory fixture; tracks minted rows and deletes them on teardown so
    the auth-related test runs don't accumulate `oauth_access_tokens` rows."""
    minted: list[OAuthAccessToken] = []

    def _mint(
        token: str,
        *,
        account_id: str | None,
        prefix: str,
        subject_email: str,
        subject_issuer: str | None,
    ) -> OAuthAccessToken:
        with flask_app.app_context():
            row = OAuthAccessToken(
                token_hash=_sha256(token),
                prefix=prefix,
                account_id=account_id,
                subject_email=subject_email,
                subject_issuer=subject_issuer,
                client_id="difyctl",
                device_label="test-device",
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
            db.session.add(row)
            db.session.commit()
            minted.append(row)
            return row

    yield _mint

    with flask_app.app_context():
        for row in minted:
            db.session.delete(db.session.merge(row))
        db.session.commit()


@pytest.fixture
def account_token(workspace_account, mint_token) -> str:
    account, _, _ = workspace_account
    token = "dfoa_" + uuid.uuid4().hex
    mint_token(
        token,
        account_id=account.id,
        prefix="dfoa_",
        subject_email=account.email,
        subject_issuer="dify:account",
    )
    return token


@pytest.fixture(autouse=True)
def _flush_auth_redis(flask_app: Flask) -> Generator[None, None, None]:
    def _flush():
        with flask_app.app_context():
            for k in redis_client.keys("auth:*"):
                redis_client.delete(k)
            for k in redis_client.keys("rl:*"):
                redis_client.delete(k)

    _flush()
    yield
    _flush()
