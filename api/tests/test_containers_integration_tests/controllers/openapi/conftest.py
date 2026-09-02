from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Literal
from unittest.mock import patch

import pytest
from faker import Faker
from flask import Flask
from sqlalchemy.orm import Session

from controllers.openapi.auth.data import AuthData
from libs.oauth_bearer import Scope, TokenType
from machinery.context import RequestContext
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


def request_context_for(
    account: Account,
    *,
    token_id: uuid.UUID | None = None,
) -> RequestContext:
    return RequestContext(
        request_id="integration-request",
        trace_id="integration-trace",
        account_id=str(account.id),
        active_workspace_id=account.current_tenant_id,
        access_token_id=str(token_id) if token_id is not None else None,
    )
