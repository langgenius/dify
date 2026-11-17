"""Guards for a route whose workspace is optional (`get.console_app`).

The membership check runs only when the request names a workspace, and then answers exactly as
`CheckWorkspaceMember`. A personal token on a discovery route needs no workspace. An external SSO
login carries `apps:read`, which no route that checks it admits through its subject check.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from constants.oauth_bearer import Scope, SubjectType, TokenType
from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi import bp as openapi_bp
from controllers.openapi._catalog import iter_handlers
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.personal_access import CheckPersonalAccess
from controllers.openapi.auth.requirements import (
    CheckNamedWorkspaceMember,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
)
from controllers.openapi.auth.spec import spec_of
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from services.personal_access_token_service import PersonalAccessTokenGrant
from tests.helpers.unit.controllers.openapi.auth._world import (
    ACCOUNT_ID,
    OTHER_TENANT_ID,
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


def _outcome(requirement: CheckWorkspaceMember, subject: AccountSubject, session: Session) -> str:
    ctx = make_ctx(session, subject)
    try:
        requirement.run(subject, ctx, session)
    except NotFound as error:
        return f"404 {error.description}"
    return f"admitted {ctx.loaded_workspace_id}"


@pytest.mark.parametrize(
    "query",
    [
        f"workspace_id={TENANT_ID}",
        f"workspace_id={OTHER_TENANT_ID}",
        "workspace_id=00000000-0000-4000-8000-000000000000",
        "workspace_id=not-a-uuid",
        "workspace_id=",
    ],
    ids=["member", "non-member", "unknown", "not a uuid", "empty"],
)
@pytest.mark.parametrize("status", [AccountStatus.ACTIVE, AccountStatus.BANNED])
def test_a_named_workspace_is_checked_exactly_as_the_membership_check(
    app: Flask, sqlite_session: Session, query: str, status: AccountStatus
) -> None:
    persist(
        sqlite_session,
        make_tenant(),
        make_tenant(tenant_id=OTHER_TENANT_ID),
        make_account(status=status),
        make_membership(TenantAccountRole.EDITOR),
    )
    subject = account_subject()
    outcomes = []
    for requirement in (CheckWorkspaceMember(), CheckNamedWorkspaceMember()):
        with app.test_request_context(f"{APPS}?{query}"):
            outcomes.append(_outcome(requirement, subject, sqlite_session))
    assert outcomes[0] == outcomes[1]
    expected = f"admitted {TENANT_ID}" if query.endswith(TENANT_ID) and status is AccountStatus.ACTIVE else None
    assert outcomes[1] == (expected or "404 workspace not found")


def test_an_archived_named_workspace_is_refused_as_before(app: Flask, sqlite_session: Session) -> None:
    persist(sqlite_session, make_tenant(status=TenantStatus.ARCHIVE), make_account(), make_membership())
    subject = account_subject()
    with app.test_request_context(f"{APPS}?workspace_id={TENANT_ID}"):
        with pytest.raises(NotFound, match="workspace not found"):
            CheckNamedWorkspaceMember().run(subject, make_ctx(sqlite_session, subject), sqlite_session)


def test_no_workspace_named_loads_and_checks_nothing(app: Flask, sqlite_session: Session) -> None:
    """Nothing is persisted: any read of a workspace, a role or the caller would find nothing and refuse."""
    subject = account_subject()
    ctx = make_ctx(sqlite_session, subject)
    with app.test_request_context(f"{APPS}?page=1&limit=20"):
        CheckNamedWorkspaceMember().run(subject, ctx, sqlite_session)
    assert ctx.loaded_workspace_id is None


def test_an_sso_login_naming_a_workspace_gets_it_loaded_without_a_membership_check(
    app: Flask, sqlite_session: Session
) -> None:
    persist(sqlite_session, make_tenant())
    subject = sso_subject()
    ctx = make_ctx(sqlite_session, subject)
    with app.test_request_context(f"{APPS}?workspace_id={TENANT_ID}"):
        CheckNamedWorkspaceMember().run(subject, ctx, sqlite_session)
    assert ctx.loaded_workspace_id == TENANT_ID


def test_the_loaded_workspace_is_read_without_raising(sqlite_session: Session) -> None:
    persist(sqlite_session, make_tenant())
    ctx = make_ctx(sqlite_session)
    assert ctx.loaded_workspace_id is None
    ctx._workspace = make_tenant()
    assert ctx.loaded_workspace_id == TENANT_ID


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
    assert ctx.loaded_workspace_id is None


@pytest.mark.parametrize(
    "policy", [PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS, PersonalAccessTokenPolicy.RESOURCE_CALLS]
)
def test_other_personal_token_policies_still_need_the_workspace(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, policy: PersonalAccessTokenPolicy
) -> None:
    grants = PersonalTokenGrants()
    monkeypatch.setitem(app.extensions, "application_services", GrantServices(grants))
    subject = AccountSubject(make_auth(TokenType.PERSONAL_ACCESS))
    ctx = Context(subject, sqlite_session, {}, pat_policy=policy)
    with app.test_request_context(f"{APPS}?page=1"):
        with pytest.raises(NotFound, match="workspace not found"):
            CheckPersonalAccess().run(subject, ctx, sqlite_session)
    assert grants.calls == []


def test_an_external_sso_login_carries_apps_read() -> None:
    assert Scope.APPS_READ in SubjectType.EXTERNAL_SSO.scopes
    assert TokenType.OAUTH_EXTERNAL_SSO.subject.scopes == frozenset(
        {Scope.APPS_RUN, Scope.APPS_READ_PERMITTED_EXTERNAL, Scope.APPS_READ}
    )


# The ops whose apps:read check an external SSO login can reach. Every other op that checks apps:read refuses the
# login at its subject check, which runs first, so carrying the scope makes no other op callable.
SSO_APPS_READ_OPS: frozenset[str] = frozenset({"get.console_app"})


def test_apps_read_admits_an_external_sso_login_only_where_pinned() -> None:
    app = Flask(__name__)
    app.register_blueprint(openapi_bp)
    reachable = set()
    for _, _, handler in iter_handlers(app):
        spec = spec_of(handler)
        if spec is None:
            continue
        checks_apps_read = any(isinstance(r, CheckScope) and r.scope is Scope.APPS_READ for r in spec.requirements)
        subject_checks = [r for r in spec.requirements if isinstance(r, CheckSubject)]
        admits_sso = all(issubclass(ExternalSsoSubject, tuple(r.allowed)) for r in subject_checks)
        if checks_apps_read and admits_sso:
            reachable.add(spec.catalog.op)
    assert reachable == SSO_APPS_READ_OPS
