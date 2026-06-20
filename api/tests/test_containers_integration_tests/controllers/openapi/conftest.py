from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Literal
from unittest.mock import patch

import pytest
from faker import Faker
from flask import Flask
from sqlalchemy.orm import Session

from controllers.openapi.auth.data import AuthData
from extensions.ext_database import db
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType, reset_auth_ctx, set_auth_ctx
from models import Account, Tenant
from services.account_service import AccountService, TenantService
from tests.test_containers_integration_tests.helpers import generate_valid_password


@pytest.fixture
def app(flask_app_with_containers: Flask) -> Flask:
    return flask_app_with_containers


@pytest.fixture
def make_account(db_session_with_containers: Session) -> Callable[..., Account]:
    """Factory that registers a real Account and gives it an owner workspace.

    System feature gates are stubbed (registration / workspace creation
    allowed) exactly like the AppDslService integration tests, so this stays a
    pure account+tenant setup helper.
    """

    # Depend on db_session_with_containers so the app context / DB session is
    # active for the real AccountService/TenantService calls below.
    assert db_session_with_containers is not None

    def _make(*, with_owner_tenant: bool = True) -> Account:
        fake = Faker()
        with patch("services.account_service.FeatureService") as mock_feature_service:
            mock_feature_service.get_system_features.return_value.is_allow_register = True
            account = AccountService.create_account(
                email=fake.email(),
                name=fake.name(),
                interface_language="en-US",
                password=generate_valid_password(fake),
            )
            if with_owner_tenant:
                TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        return account

    return _make


def add_tenant_for_account(account: Account, *, role: str = "normal", name: str = "Second WS") -> Tenant:
    """Create an additional tenant and join ``account`` to it (real service calls)."""
    with patch("services.account_service.FeatureService") as mock_feature_service:
        mock_feature_service.get_system_features.return_value.is_allow_create_workspace = True
        tenant = TenantService.create_tenant(name=name)
    TenantService.create_tenant_member(tenant, account, db.session, role=role)
    return tenant


def auth_for(
    account: Account,
    *,
    app_model: object | None = None,
    token_id: uuid.UUID | None = None,
    caller_kind: Literal["account", "end_user"] | None = None,
) -> AuthData:
    """Build an AuthData for ``account`` (and optionally an app context).

    ``token_id`` is needed by the self-revoke endpoint, and ``caller_kind`` by
    any handler calling ``require_app_context`` (e.g. file upload / task stop).
    """
    return AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        account_id=uuid.UUID(str(account.id)),
        token_hash="integration-test",
        token_id=token_id,
        scopes=frozenset({Scope.FULL}),
        caller=account,
        caller_kind=caller_kind,
        app=app_model,  # type: ignore[arg-type]
    )


@contextmanager
def account_auth_context(
    account: Account,
    *,
    token_id: uuid.UUID,
    client_id: str = "integration-cli",
) -> Iterator[AuthContext]:
    """Publish an account ``AuthContext`` for handlers that read ``get_auth_ctx()``.

    The auth pipeline normally sets this ContextVar; the integration suite
    bypasses the pipeline via ``inspect.unwrap``, so endpoints that resolve the
    caller through ``get_auth_ctx()`` (the ``/account/sessions*`` family) need it
    set explicitly. Resets on exit so the worker thread can't leak identity.
    """
    ctx = AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email=account.email,
        subject_issuer=None,
        account_id=uuid.UUID(str(account.id)),
        client_id=client_id,
        scopes=frozenset({Scope.FULL}),
        token_id=token_id,
        token_type=TokenType.OAUTH_ACCOUNT,
        expires_at=None,
        token_hash="integration-test",
    )
    reset_token = set_auth_ctx(ctx)
    try:
        yield ctx
    finally:
        reset_auth_ctx(reset_token)
