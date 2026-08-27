from __future__ import annotations

import uuid
from collections.abc import Callable, Generator
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from faker import Faker
from flask import Flask
from sqlalchemy.orm import Session

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import subject_from_auth
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType, reset_auth_ctx, set_auth_ctx
from models import Account, Tenant
from services.account_service import AccountService, TenantService
from tests.test_containers_integration_tests.helpers import generate_valid_password

_CLIENT_ID = "integration-cli"


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
        with patch("services.account_service.SystemFeatureService") as mock_feature_service:
            mock_feature_service.is_registration_allowed.return_value = True
            account = AccountService.create_account(
                email=fake.email(),
                name=fake.name(),
                interface_language="en-US",
                password=generate_valid_password(fake),
                session=db_session_with_containers,
            )
            if with_owner_tenant:
                TenantService.create_owner_tenant_if_not_exist(
                    account, name=fake.company(), session=db_session_with_containers
                )
        return account

    return _make


def add_tenant_for_account(
    account: Account, *, session: Session, role: str = "normal", name: str = "Second WS"
) -> Tenant:
    """Create an additional tenant and join ``account`` to it (real service calls)."""
    with patch("services.account_service.SystemFeatureService") as mock_feature_service:
        mock_feature_service.is_workspace_creation_allowed.return_value = True
        tenant = TenantService.create_tenant(name=name, session=session)
    TenantService.create_tenant_member(tenant, account, session, role=role)
    return tenant


def _account_auth(
    account: Account,
    *,
    token_id: uuid.UUID | None = None,
    client_id: str = _CLIENT_ID,
) -> AuthContext:
    """The ``AuthContext`` a live ``dfoa_`` token for ``account`` would carry."""
    return AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email=account.email,
        subject_issuer=None,
        account_id=uuid.UUID(str(account.id)),
        client_id=client_id,
        scopes=frozenset({Scope.FULL}),
        token_id=token_id or uuid.uuid4(),
        token_type=TokenType.OAUTH_ACCOUNT,
        expires_at=None,
    )


def context_for(
    account: Account,
    *,
    session: Session,
    view_args: dict[str, str] | None = None,
    token_id: uuid.UUID | None = None,
) -> Context:
    """Build the ``Context`` the router hands a handler invoked via ``__handler__``.

    The subject comes from a real ``AuthContext`` through ``subject_from_auth``,
    so the helper walks the same resolution path the router does. ``view_args``
    is the route's path params — ``ctx.app`` and ``ctx.workspace`` resolve from
    it, so a route carrying ``<app_id>`` needs ``{"app_id": ...}`` here.
    ``token_id`` only matters to the ``/account/sessions*`` family, which reads
    it back off the subject.
    """
    return Context(subject_from_auth(_account_auth(account, token_id=token_id)), session, view_args or {})


@contextmanager
def account_auth_context(
    account: Account,
    *,
    token_id: uuid.UUID,
    client_id: str = _CLIENT_ID,
) -> Generator[AuthContext]:
    """Publish an account ``AuthContext`` for handlers that read ``get_auth_ctx()``.

    The router's pipeline normally sets this ContextVar; calling ``__handler__``
    bypasses the router, so endpoints that resolve the caller through
    ``get_auth_ctx()`` (the ``/account/sessions*`` family) need it set
    explicitly. Resets on exit so the worker thread can't leak identity.
    """
    ctx = _account_auth(account, token_id=token_id, client_id=client_id)
    reset_token = set_auth_ctx(ctx)
    try:
        yield ctx
    finally:
        reset_auth_ctx(reset_token)
