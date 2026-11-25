"""Guards for a route whose workspace is optional (`get.console_app`).

The membership check runs only when the request addresses a workspace. An external SSO login that names one
is refused as a non-member. A personal token that names none is authorized without one. An external SSO login
carries `apps:read`, which no route that checks it admits through its subject check.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from constants.oauth_bearer import Scope, TokenType
from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi import bp as openapi_bp
from controllers.openapi._catalog import iter_handlers
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.personal_access import CheckPersonalAccess
from controllers.openapi.auth.requirements import CheckScope, CheckSubject, CheckWorkspaceMember
from controllers.openapi.auth.spec import spec_of
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject
from models.account import TenantAccountRole
from services.personal_access_token_service import PersonalAccessTokenGrant
from tests.helpers.unit.controllers.openapi.auth._world import (
    ACCOUNT_ID,
    APP_ID,
    TENANT_ID,
    TOKEN_ID,
    account_subject,
    make_account,
    make_auth,
    make_ctx,
    make_membership,
    make_tenant,
    persist,
    sso_subject,
)

APPS = "/openapi/v1/apps"


def test_an_empty_named_workspace_gets_the_membership_check(app: Flask, sqlite_session: Session) -> None:
    persist(sqlite_session, make_tenant(), make_account(), make_membership(TenantAccountRole.EDITOR))
    subject = account_subject()
    with app.test_request_context(f"{APPS}?workspace_id="):
        with pytest.raises(NotFound, match="workspace not found"):
            CheckWorkspaceMember().run(subject, make_ctx(sqlite_session, subject), sqlite_session)


def test_no_workspace_named_loads_and_checks_nothing(app: Flask, sqlite_session: Session) -> None:
    """Nothing is persisted: any read of a workspace, a role or the caller would find nothing and refuse."""
    subject = account_subject()
    ctx = make_ctx(sqlite_session, subject)
    with app.test_request_context(f"{APPS}?page=1&limit=20"):
        CheckWorkspaceMember().run(subject, ctx, sqlite_session)
    assert ctx._workspace is None


@pytest.mark.parametrize("query", [f"workspace_id={TENANT_ID}", "workspace_id="])
def test_an_sso_login_naming_a_workspace_is_refused_as_a_non_member(
    app: Flask, sqlite_session: Session, query: str
) -> None:
    persist(sqlite_session, make_tenant())
    subject = sso_subject()
    with app.test_request_context(f"{APPS}?{query}"):
        with pytest.raises(NotFound, match="workspace not found"):
            CheckWorkspaceMember().run(subject, make_ctx(sqlite_session, subject), sqlite_session)


def test_an_sso_login_on_an_app_route_is_not_refused(app: Flask, sqlite_session: Session) -> None:
    subject = sso_subject()
    ctx = make_ctx(sqlite_session, subject, app_id=APP_ID)
    with app.test_request_context(f"/openapi/v1/apps/{APP_ID}/workflow:run"):
        CheckWorkspaceMember().run(subject, ctx, sqlite_session)
    assert ctx._workspace is None


@dataclass
class PersonalTokenGrants:
    calls: list[dict[str, object]] = field(default_factory=list)

    def authorize(self, **arguments: object) -> PersonalAccessTokenGrant:
        self.calls.append(arguments)
        return PersonalAccessTokenGrant(app_ids=frozenset({"selected-app"}))


@dataclass
class GrantServices:
    personal_access_tokens: PersonalTokenGrants


def test_a_personal_token_on_a_discovery_route_needs_no_workspace(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    grants = PersonalTokenGrants()
    monkeypatch.setitem(app.extensions, "application_services", GrantServices(grants))
    subject = AccountSubject(make_auth(TokenType.PERSONAL_ACCESS))
    ctx = Context(subject, sqlite_session, {}, pat_policy=PersonalAccessTokenPolicy.RESOURCE_DISCOVERY)
    with app.test_request_context(f"{APPS}?page=1"):
        CheckPersonalAccess().run(subject, ctx, sqlite_session)
    assert grants.calls == [
        {
            "account_id": str(UUID(ACCOUNT_ID)),
            "token_id": str(UUID(TOKEN_ID)),
            "policy": PersonalAccessTokenPolicy.RESOURCE_DISCOVERY,
            "workspace_id": None,
            "app_id": None,
        }
    ]
    assert ctx.personal_app_ids == frozenset({"selected-app"})
    assert ctx._workspace is None


def test_a_personal_token_naming_a_workspace_has_it_authorized(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    persist(sqlite_session, make_tenant())
    grants = PersonalTokenGrants()
    monkeypatch.setitem(app.extensions, "application_services", GrantServices(grants))
    subject = AccountSubject(make_auth(TokenType.PERSONAL_ACCESS))
    ctx = Context(subject, sqlite_session, {}, pat_policy=PersonalAccessTokenPolicy.RESOURCE_DISCOVERY)
    with app.test_request_context(f"{APPS}?workspace_id={TENANT_ID}"):
        CheckPersonalAccess().run(subject, ctx, sqlite_session)
    assert [call["workspace_id"] for call in grants.calls] == [TENANT_ID]


# The ops whose apps:read check an external SSO login can reach. Every other op that checks apps:read refuses the
# login at its subject check, which runs first, so carrying the scope makes no other op callable.
SSO_APPS_READ_OPS: frozenset[str] = frozenset({"get.console_app"})


def test_apps_read_admits_an_external_sso_login_only_where_pinned() -> None:
    app = Flask(__name__)
    app.register_blueprint(openapi_bp)
    reachable = set()
    specs = [spec for _, _, handler in iter_handlers(app) if (spec := spec_of(handler)) is not None]
    for spec in specs:
        checks_apps_read = any(isinstance(r, CheckScope) and r.scope is Scope.APPS_READ for r in spec.requirements)
        subject_checks = [r for r in spec.requirements if isinstance(r, CheckSubject)]
        admits_sso = all(issubclass(ExternalSsoSubject, tuple(r.allowed)) for r in subject_checks)
        if checks_apps_read and admits_sso:
            reachable.add(spec.catalog.op)
    assert reachable == SSO_APPS_READ_OPS
