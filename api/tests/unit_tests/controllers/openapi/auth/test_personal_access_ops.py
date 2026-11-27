"""Operations open to personal access tokens, checked with a real token inside its scope and one outside.

Each case runs the real ``CheckPersonalAccess`` over the op's own policy, with tokens created through the real
token service on SQLite. A token inside its scope is admitted; one outside is refused with 403. Node types name no
app or workspace, so no scope leaves them out: identity discovery admits every live token, and a token without
workspace access carries no workspace in its grant.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from constants.oauth_bearer import TokenType
from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi import bp as openapi_bp
from controllers.openapi._catalog import iter_handlers
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.personal_access import CheckPersonalAccess
from controllers.openapi.auth.spec import EndpointSpec, spec_of
from controllers.openapi.auth.subjects import AccountSubject
from extensions.ext_application_services import ApplicationServices
from machinery.context import AccountRequestContext
from models.account import TenantAccountRole
from services.personal_access_token_service import PersonalAccessTokenResourceRef, PersonalAccessTokenScopes
from tests.helpers.unit.controllers.openapi.auth._world import (
    APP_ID,
    TENANT_ID,
    make_account,
    make_app,
    make_auth,
    make_membership,
    make_tenant,
    persist,
)

OTHER_APP_ID = "00000000-0000-0000-0000-0000000000a1"
OTHER_TENANT_ID = "00000000-0000-0000-0000-0000000000a2"
APP_PARAM = "app_id"
WORKSPACE_PARAM = "workspace_id"
SIGNING_KEY = "test-only-pat-signing-key-of-32-bytes"

# The ops this change opens, by the policy each takes.
OPENED: dict[str, PersonalAccessTokenPolicy] = {
    "get.node_type": PersonalAccessTokenPolicy.IDENTITY_DISCOVERY,
    "describe.node_type": PersonalAccessTokenPolicy.IDENTITY_DISCOVERY,
    "test.node.workflow": PersonalAccessTokenPolicy.RESOURCE_CALLS,
    "test.node.advanced_chat": PersonalAccessTokenPolicy.RESOURCE_CALLS,
    "get.run": PersonalAccessTokenPolicy.RESOURCE_CALLS,
    "describe.run": PersonalAccessTokenPolicy.RESOURCE_CALLS,
    "get.run.node": PersonalAccessTokenPolicy.RESOURCE_CALLS,
    "get.skill": PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
    "describe.skill": PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
    "get.skill.version": PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
    "export.skill": PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
    "publish.skill": PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
    "import.skill": PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
    "get.knowledge_base": PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
    "describe.workspace": PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
}


@dataclass(frozen=True)
class Scoped:
    """A token whose scope holds the addressed app or workspace, and one whose scope leaves it out."""

    inside: PersonalAccessTokenScopes
    outside: PersonalAccessTokenScopes


SCOPES: dict[PersonalAccessTokenPolicy, Scoped] = {
    PersonalAccessTokenPolicy.IDENTITY_DISCOVERY: Scoped(
        inside=PersonalAccessTokenScopes(resource_mode="none", workspace_mode="all"),
        outside=PersonalAccessTokenScopes(
            resource_mode="selected",
            resources=(PersonalAccessTokenResourceRef("app", APP_ID),),
            workspace_mode="none",
        ),
    ),
    PersonalAccessTokenPolicy.RESOURCE_CALLS: Scoped(
        inside=PersonalAccessTokenScopes(
            resource_mode="selected", resources=(PersonalAccessTokenResourceRef("app", APP_ID),), workspace_mode="none"
        ),
        outside=PersonalAccessTokenScopes(
            resource_mode="selected",
            resources=(PersonalAccessTokenResourceRef("app", OTHER_APP_ID),),
            workspace_mode="none",
        ),
    ),
    PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS: Scoped(
        inside=PersonalAccessTokenScopes(resource_mode="none", workspace_mode="selected", workspace_ids=(TENANT_ID,)),
        outside=PersonalAccessTokenScopes(
            resource_mode="none", workspace_mode="selected", workspace_ids=(OTHER_TENANT_ID,)
        ),
    ),
}


@pytest.fixture
def specs() -> dict[str, EndpointSpec]:
    app = Flask(__name__)
    app.register_blueprint(openapi_bp)
    return {spec.catalog.op: spec for _, _, handler in iter_handlers(app) if (spec := spec_of(handler)) is not None}


@pytest.fixture
def world(
    app: Flask,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> Iterator[ApplicationServices]:
    """One account that is an owner of two workspaces, each with one app; the token service is the real one."""
    config_overrides(SECRET_KEY=SIGNING_KEY)
    other_tenant = make_tenant(tenant_id=OTHER_TENANT_ID)
    persist(
        sqlite_session,
        make_tenant(),
        other_tenant,
        make_account(),
        make_membership(TenantAccountRole.OWNER),
        make_app(),
        make_app(app_id=OTHER_APP_ID, tenant_id=OTHER_TENANT_ID),
    )
    other_membership = make_membership(TenantAccountRole.OWNER)
    other_membership.tenant_id = OTHER_TENANT_ID
    other_membership.current = False
    persist(sqlite_session, other_membership)
    monkeypatch.setitem(app.extensions, "application_services", account_application_services)
    with app.test_request_context():
        yield account_application_services


def _token(services: ApplicationServices, scopes: PersonalAccessTokenScopes) -> AccountSubject:
    account_id = str(make_auth(TokenType.PERSONAL_ACCESS).account_id)
    context = AccountRequestContext(request_id=str(uuid.uuid4()), trace_id=None, account_id=account_id)
    created = services.personal_access_tokens.create(context, name="test", expiration_days=None, scopes=scopes)
    return AccountSubject(make_auth(TokenType.PERSONAL_ACCESS, token_id=uuid.UUID(created.token.id)))


# The path value each policy's routes address: an app for resource calls, a workspace for workspace operations,
# nothing for node types.
ADDRESSED: dict[PersonalAccessTokenPolicy, dict[str, str]] = {
    PersonalAccessTokenPolicy.IDENTITY_DISCOVERY: {},
    PersonalAccessTokenPolicy.RESOURCE_CALLS: {APP_PARAM: APP_ID},
    PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS: {WORKSPACE_PARAM: TENANT_ID},
}


def test_each_op_takes_the_policy_it_was_opened_with(specs: dict[str, EndpointSpec]) -> None:
    assert {op: specs[op].pat_policy for op in OPENED} == OPENED


@pytest.mark.parametrize("op", sorted(OPENED))
def test_a_token_inside_its_scope_is_admitted(
    op: str, world: ApplicationServices, sqlite_session: Session, specs: dict[str, EndpointSpec]
) -> None:
    spec = specs[op]
    subject = _token(world, SCOPES[OPENED[op]].inside)
    ctx = Context(subject, sqlite_session, dict(ADDRESSED[OPENED[op]]), pat_policy=spec.pat_policy)

    CheckPersonalAccess().run(subject, ctx, sqlite_session)


SCOPED_OPS = sorted(op for op, policy in OPENED.items() if policy is not PersonalAccessTokenPolicy.IDENTITY_DISCOVERY)
IDENTITY_OPS = sorted(op for op, policy in OPENED.items() if policy is PersonalAccessTokenPolicy.IDENTITY_DISCOVERY)


@pytest.mark.parametrize("op", SCOPED_OPS)
def test_a_token_outside_its_scope_is_refused(
    op: str, world: ApplicationServices, sqlite_session: Session, specs: dict[str, EndpointSpec]
) -> None:
    spec = specs[op]
    subject = _token(world, SCOPES[OPENED[op]].outside)
    ctx = Context(subject, sqlite_session, dict(ADDRESSED[OPENED[op]]), pat_policy=spec.pat_policy)

    with pytest.raises(Forbidden):
        CheckPersonalAccess().run(subject, ctx, sqlite_session)


@pytest.mark.parametrize("op", IDENTITY_OPS)
def test_a_token_without_workspace_access_reads_node_types_with_no_workspace(
    op: str, world: ApplicationServices, sqlite_session: Session, specs: dict[str, EndpointSpec]
) -> None:
    spec = specs[op]
    subject = _token(world, SCOPES[OPENED[op]].outside)
    ctx = Context(subject, sqlite_session, {}, pat_policy=spec.pat_policy)

    CheckPersonalAccess().run(subject, ctx, sqlite_session)

    assert ctx.personal_workspace_ids == frozenset()
