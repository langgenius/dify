from __future__ import annotations

import uuid
from collections.abc import Callable, Sequence
from unittest.mock import patch

import pytest
from faker import Faker
from flask import Flask
from sqlalchemy.orm import Session

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import PathParam, load_app
from controllers.openapi.auth.requirements import Requirement, ResolveCaller
from controllers.openapi.auth.subjects import subject_from_auth
from libs.oauth_bearer import AuthContext, TokenType
from models import Account, Tenant
from tests.test_containers_integration_tests.helpers import accounts as account_fixtures
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
    # active for the composed account and workspace services below.
    assert db_session_with_containers is not None

    def _make(*, with_owner_tenant: bool = True) -> Account:
        fake = Faker()
        with patch("services.account.login_adapters.SystemFeatureService") as mock_feature_service:
            mock_feature_service.is_registration_allowed.return_value = True
            account = account_fixtures.create_account(
                email=fake.email(),
                name=fake.name(),
                interface_language="en-US",
                password=generate_valid_password(fake),
                session=db_session_with_containers,
            )
            if with_owner_tenant:
                account_fixtures.create_owner_workspace(
                    account, name=fake.company(), session=db_session_with_containers
                )
        return account

    return _make


def add_tenant_for_account(
    account: Account, *, session: Session, role: str = "normal", name: str = "Second WS"
) -> Tenant:
    """Create an additional tenant and join ``account`` to it (real service calls)."""
    with patch("services.account.login_adapters.SystemFeatureService") as mock_feature_service:
        mock_feature_service.is_workspace_creation_allowed.return_value = True
        tenant = account_fixtures.create_workspace(name=name, session=session)
    account_fixtures.join_workspace(tenant, account, session, role=role)
    return tenant


def _account_auth(
    account: Account,
    *,
    token_id: uuid.UUID | None = None,
    client_id: str = _CLIENT_ID,
) -> AuthContext:
    """The ``AuthContext`` a live ``dfoa_`` token for ``account`` would carry."""
    return AuthContext(
        subject_email=account.email,
        subject_issuer=None,
        account_id=uuid.UUID(str(account.id)),
        client_id=client_id,
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
    requirements: Sequence[Requirement] = (),
) -> Context:
    """Build the ``Context`` a handler is given after the pipeline ran.

    The subject comes from a real ``AuthContext`` through ``subject_from_auth``,
    so the helper walks the same resolution path the router does. ``view_args``
    is the route's path params — the app and the workspace are loaded from it,
    so a route carrying ``<app_id>`` needs ``{"app_id": ...}`` here.
    ``token_id`` only matters to the ``/account/sessions*`` family, which reads
    it back off the subject.

    Pass the route's context-loading requirements, such as
    ``CheckWorkspaceMember``, to bind the caller to its requested workspace.
    They run alongside the pipeline's fixed ``ResolveCaller`` in rank order;
    the caller is freshly loaded and does not inherit ``account.current_tenant``.
    App routes also load their app, as ``CheckAppApiEnabled`` does before the
    handler runs. Authorization itself is covered by the auth-layer tests.
    """
    ctx = Context(subject_from_auth(_account_auth(account, token_id=token_id)), session, view_args or {})
    if PathParam.APP_ID in ctx.view_args:
        load_app(ctx)
    for requirement in sorted((*requirements, ResolveCaller()), key=lambda item: item.rank):
        requirement.run(ctx.subject, ctx, session)
    return ctx
