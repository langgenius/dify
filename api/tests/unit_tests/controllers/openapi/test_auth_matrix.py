"""The /openapi/v1 allow/deny matrix, and a snapshot of the generated document.

Both artifacts are pinned against the auth layer as it stands *before* any route
moves onto `@endpoint`, so a migration that changes an answer fails here rather
than in production.

The matrix is derived from `auth/composition.py`'s two pipelines, not from each
route's guard kwargs: `check_app_api_enabled` and `check_workspace_member` fire
on every app-scoped route through `When(PATH_HAS_APP_ID)`, `check_workspace_member`
fires again on every `guard_workspace` route through `WORKSPACE_MEMBERSHIP_REQUIRED`,
`check_workspace_role` stands down when RBAC is enabled *and* the route declares a
scene, and `check_private_app_permission` is not gated on `webapp_auth.enabled`
while `check_acl` is. Reading kwargs alone under-counts every one of those.

Requests run through the real Flask blueprint with the real router, the real
pipeline and real database rows. The only substitutions are at process seams the
router already treats as pluggable: the bound `BearerAuthenticator` (so a token's
subject kind and scope set are chosen per row), the enterprise HTTP clients, and
the flask-login mount.

Admission is observed as HTTP 418: a `user_logged_in` receiver raises `ImATeapot`
at the moment the pipeline mounts the caller, which is after every requirement has
passed and before the view body runs. That keeps a row from depending on whether a
view could complete (several stream SSE or invoke a workflow), and it is a seam
both the current pipeline and its replacement go through. One route mounts no
caller — `permitted_external.list` resolves no end user because it carries no
`app_id` — so its admission row says so and asserts the view's own 200 instead.

Three answers in the table are worth reading twice, because they are what the
current code does rather than what a route's decorator suggests:

* `workspaces.describe` uses plain `guard`, so a non-member is *admitted* by auth
  and refused by the view's own lookup. `workspaces.switch`, one path segment away,
  uses `guard_workspace` and is refused by auth.
* `permitted_external.describe` carries an `app_id` but runs the external-SSO
  pipeline, which has no `check_workspace_mismatch`; a foreign `workspace_id` query
  is admitted there and answered 422 on every account-pipeline app route.
* No token the shipped registry mints can fail `check_scope` — `dfoa_` carries
  `Scope.FULL` and `dfoe_` carries exactly the two scopes its routes ask for — so
  the scope rows mint from a deliberately narrowed registry. Those rows are not
  dead weight and must not be simplified away: `check_scope` is live code on every
  request, and the day a narrower token kind is minted it is the only thing
  standing between that token and every route it was not scoped for.

Nine rows carry an `accepted_delta`: the `foreign_workspace_query` answer on the
app-scoped routes that run the account pipeline. That 422 comes from
`check_workspace_mismatch`, which the replacement layer deliberately does not have
(spec 2.9, accepted behaviour exception 1). They still assert today's exact status
and message; the migration task that moves each route flips its own row in its own
commit. `test_accepted_behaviour_deltas_are_bounded_and_still_exact` stops that set
from growing quietly, and stops a flipped row from being left loose enough to pass
either way.
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import uuid
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from dataclasses import dataclass, field
from enum import StrEnum, auto
from unittest.mock import patch

import pytest
from flask import Flask
from flask_login import LoginManager, user_logged_in
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import ImATeapot
from werkzeug.test import TestResponse

import libs.oauth_bearer as oauth_bearer_module
import libs.rate_limit as rate_limit_module
from controllers.openapi import bp as openapi_bp
from enums import DeploymentEdition, WebAppAccessMode
from libs.oauth_bearer import (
    BearerAuthenticator,
    ResolvedRow,
    SubjectType,
    TokenKind,
    TokenKindRegistry,
    TokenType,
    sha256_hex,
)
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import EndUserType
from models.model import App, EndUser
from services.account_service import AccountService
from services.end_user_service import EndUserService
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.feature_entities import LicenseStatus, SystemFeatureModel
from services.feature_service import FeatureService

ADMITTED = 418


class Trait(StrEnum):
    """Structural facts about a route, used only to decide which cases can reach it."""

    APP_SCOPED = auto()
    ACCOUNT_PRIMARY = auto()
    EXTERNAL_REACHABLE = auto()
    ROLE_FLOOR = auto()
    RBAC_DECLARED = auto()
    ENTERPRISE_ONLY = auto()


class Case(StrEnum):
    NO_BEARER = auto()
    MEMBER = auto()
    WRONG_SUBJECT = auto()
    INSUFFICIENT_SCOPE = auto()
    NON_MEMBER = auto()
    LOW_ROLE = auto()
    APP_API_DISABLED = auto()
    UNKNOWN_APP = auto()
    FOREIGN_WORKSPACE_QUERY = auto()
    EDITION_NOT_ENTERPRISE = auto()
    LICENSE_INVALID = auto()
    EE_ACCOUNT_PUBLIC = auto()
    EE_ACCOUNT_SSO_VERIFIED = auto()
    EE_ACCOUNT_PRIVATE_ALL = auto()
    EE_ACCOUNT_PRIVATE_PERMITTED = auto()
    EE_ACCOUNT_PRIVATE_REFUSED = auto()
    EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF = auto()
    EE_ACCOUNT_MODE_UNRESOLVED = auto()
    EE_EXTERNAL_PUBLIC = auto()
    EE_EXTERNAL_SSO_VERIFIED = auto()
    EE_EXTERNAL_PRIVATE_ALL = auto()
    EE_EXTERNAL_PRIVATE = auto()
    EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF = auto()
    EE_EXTERNAL_MODE_UNRESOLVED = auto()
    RBAC_ON_LOW_ROLE = auto()
    RBAC_ON_DENIED = auto()


class Bearer(StrEnum):
    NONE = auto()
    ACCOUNT_MEMBER = auto()
    ACCOUNT_LOW_ROLE = auto()
    ACCOUNT_OUTSIDER = auto()
    EXTERNAL = auto()
    OTHER_SUBJECT = auto()
    PRIMARY = auto()


@dataclass(frozen=True, slots=True)
class Route:
    id: str
    method: str
    path: str
    traits: frozenset[Trait]
    query: str = ""


@dataclass(frozen=True, slots=True)
class Expect:
    """`message` is the canonical ErrorBody message; `None` means it is not pinned.

    `accepted_delta` names a behaviour this PR has already agreed to change. A row
    carrying one still asserts today's exact status and message — it is not slack.
    The migration task that moves the route flips that one row, in that one commit,
    under review. `test_accepted_behaviour_deltas_are_bounded_and_still_exact`
    keeps the set from growing quietly.
    """

    status: int
    message: str | None = None
    note: str = ""
    accepted_delta: str = ""


@dataclass(frozen=True, slots=True)
class Scenario:
    """The world a case runs in. `edition=None` means the route's native edition."""

    bearer: Bearer
    edition: DeploymentEdition | None = None
    narrow_scopes: bool = False
    app_api_enabled: bool = True
    unknown_app: bool = False
    foreign_workspace_query: bool = False
    webapp_auth: bool = False
    access_mode: WebAppAccessMode | None = WebAppAccessMode.PUBLIC
    private_app_permitted: bool = True
    license_status: LicenseStatus = LicenseStatus.ACTIVE
    rbac_enabled: bool = False
    rbac_allows: bool = True


ADMIT = Expect(ADMITTED)
DENY_NO_BEARER = Expect(401, "bearer required")
DENY_WRONG_SUBJECT = Expect(403, "unsupported_token_type")
DENY_SSO_NEEDS_EE = Expect(403, "external_sso_requires_ee")
DENY_SCOPE = Expect(403, "insufficient_scope")
DENY_NON_MEMBER = Expect(404, "workspace not found")
DENY_ROLE = Expect(403, "insufficient workspace role")
DENY_API_DISABLED = Expect(403, "service_api_disabled")
DENY_UNKNOWN_APP = Expect(404, "app not found")
ACCEPTED_DELTA_FOREIGN_WORKSPACE = Expect(
    422,
    "workspace_id does not match app's workspace",
    note="check_workspace_mismatch, from When(PATH_HAS_APP_ID) in the account pipeline",
    accepted_delta=(
        "spec 2.9 / accepted behaviour exception 1: the replacement layer has no "
        "check_workspace_mismatch, so a foreign ?workspace_id= is ignored rather than "
        "refused. No app route declares the query param and difyctl never sends it on an "
        "app-scoped path, so only a raw HTTP caller can reach it. Flip this row in the "
        "migration commit that moves this route, not before."
    ),
)
DENY_ACCESS_MODE = Expect(403, "subject_not_allowed_for_access_mode")
DENY_MODE_UNRESOLVED = Expect(403, "app or access mode not loaded")
DENY_PRIVATE_APP = Expect(403, "user_not_allowed_for_private_app")
DENY_EDITION = Expect(404, note="endpoint-level edition gate, raised before the bearer is read")
DENY_LICENSE = Expect(403, "license_invalid")
DENY_RBAC = Expect(403, note="bare werkzeug Forbidden from enforce_rbac_access")
ADMIT_NO_MOUNT = Expect(
    200,
    note="external subject mounts no caller on an app-less route, so admission shows as the view's own 200",
)


ROUTES: tuple[Route, ...] = (
    Route("account.get", "GET", "/account", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route("account.sessions.revoke_self", "DELETE", "/account/sessions/self", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route("account.sessions.list", "GET", "/account/sessions", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route(
        "account.sessions.revoke_one",
        "DELETE",
        "/account/sessions/{session_id}",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "apps.describe",
        "GET",
        "/apps/{app_id}",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.RBAC_DECLARED}),
    ),
    Route("apps.list", "GET", "/apps", frozenset({Trait.ACCOUNT_PRIMARY}), query="workspace_id={workspace_id}"),
    Route("workspaces.list", "GET", "/workspaces", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route("workspaces.describe", "GET", "/workspaces/{workspace_id}", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route("workspaces.switch", "POST", "/workspaces/{workspace_id}:switch", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route("workspaces.members.list", "GET", "/workspaces/{workspace_id}/members", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route(
        "workspaces.members.invite",
        "POST",
        "/workspaces/{workspace_id}/members",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.ROLE_FLOOR}),
    ),
    Route(
        "workspaces.members.remove",
        "DELETE",
        "/workspaces/{workspace_id}/members/{member_id}",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.ROLE_FLOOR}),
    ),
    Route(
        "workspaces.members.update_role",
        "PATCH",
        "/workspaces/{workspace_id}/members/{member_id}",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.ROLE_FLOOR}),
    ),
    Route(
        "app_dsl.import",
        "POST",
        "/workspaces/{workspace_id}/apps/imports",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.ROLE_FLOOR, Trait.RBAC_DECLARED}),
    ),
    Route(
        "app_dsl.import_confirm",
        "POST",
        "/workspaces/{workspace_id}/apps/imports/{import_id}:confirm",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.ROLE_FLOOR, Trait.RBAC_DECLARED}),
    ),
    Route(
        "app_dsl.export",
        "GET",
        "/apps/{app_id}/dsl",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.ROLE_FLOOR, Trait.RBAC_DECLARED}),
    ),
    Route(
        "app_dsl.check_dependencies",
        "GET",
        "/apps/{app_id}/dependencies:check",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.ROLE_FLOOR, Trait.RBAC_DECLARED}),
    ),
    Route(
        "app_run.run",
        "POST",
        "/apps/{app_id}:run",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE, Trait.RBAC_DECLARED}),
    ),
    Route(
        "app_run.stop",
        "POST",
        "/apps/{app_id}/tasks/{task_id}:stop",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE, Trait.RBAC_DECLARED}),
    ),
    Route(
        "files.upload",
        "POST",
        "/apps/{app_id}/files",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
    ),
    Route(
        "human_input_form.get",
        "GET",
        "/apps/{app_id}/human-input-forms/{form_token}",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE, Trait.RBAC_DECLARED}),
    ),
    Route(
        "human_input_form.submit",
        "POST",
        "/apps/{app_id}/human-input-forms/{form_token}:submit",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE, Trait.RBAC_DECLARED}),
    ),
    Route(
        "workflow_events.stream",
        "GET",
        "/apps/{app_id}/tasks/{task_id}/events",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE, Trait.RBAC_DECLARED}),
    ),
    Route(
        "permitted_external.list",
        "GET",
        "/permitted-external-apps",
        frozenset({Trait.EXTERNAL_REACHABLE, Trait.ENTERPRISE_ONLY}),
    ),
    Route(
        "permitted_external.describe",
        "GET",
        "/permitted-external-apps/{app_id}",
        frozenset({Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE, Trait.ENTERPRISE_ONLY}),
    ),
)


CASE_REQUIRES: dict[Case, frozenset[Trait]] = {
    Case.NO_BEARER: frozenset(),
    Case.MEMBER: frozenset(),
    Case.WRONG_SUBJECT: frozenset(),
    Case.INSUFFICIENT_SCOPE: frozenset(),
    Case.NON_MEMBER: frozenset({Trait.ACCOUNT_PRIMARY}),
    Case.LOW_ROLE: frozenset({Trait.ACCOUNT_PRIMARY}),
    Case.APP_API_DISABLED: frozenset({Trait.APP_SCOPED}),
    Case.UNKNOWN_APP: frozenset({Trait.APP_SCOPED}),
    Case.FOREIGN_WORKSPACE_QUERY: frozenset({Trait.APP_SCOPED}),
    Case.EDITION_NOT_ENTERPRISE: frozenset({Trait.ENTERPRISE_ONLY}),
    Case.LICENSE_INVALID: frozenset({Trait.ENTERPRISE_ONLY}),
    Case.EE_ACCOUNT_PUBLIC: frozenset({Trait.APP_SCOPED, Trait.ACCOUNT_PRIMARY}),
    Case.EE_ACCOUNT_SSO_VERIFIED: frozenset({Trait.APP_SCOPED, Trait.ACCOUNT_PRIMARY}),
    Case.EE_ACCOUNT_PRIVATE_ALL: frozenset({Trait.APP_SCOPED, Trait.ACCOUNT_PRIMARY}),
    Case.EE_ACCOUNT_PRIVATE_PERMITTED: frozenset({Trait.APP_SCOPED, Trait.ACCOUNT_PRIMARY}),
    Case.EE_ACCOUNT_PRIVATE_REFUSED: frozenset({Trait.APP_SCOPED, Trait.ACCOUNT_PRIMARY}),
    Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: frozenset({Trait.APP_SCOPED, Trait.ACCOUNT_PRIMARY}),
    Case.EE_ACCOUNT_MODE_UNRESOLVED: frozenset({Trait.APP_SCOPED, Trait.ACCOUNT_PRIMARY}),
    Case.EE_EXTERNAL_PUBLIC: frozenset({Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
    Case.EE_EXTERNAL_SSO_VERIFIED: frozenset({Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
    Case.EE_EXTERNAL_PRIVATE_ALL: frozenset({Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
    Case.EE_EXTERNAL_PRIVATE: frozenset({Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
    Case.EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: frozenset({Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
    Case.EE_EXTERNAL_MODE_UNRESOLVED: frozenset({Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
    Case.RBAC_ON_LOW_ROLE: frozenset({Trait.ROLE_FLOOR}),
    Case.RBAC_ON_DENIED: frozenset({Trait.RBAC_DECLARED}),
}


SCENARIOS: dict[Case, Scenario] = {
    Case.NO_BEARER: Scenario(bearer=Bearer.NONE),
    Case.MEMBER: Scenario(bearer=Bearer.PRIMARY),
    Case.WRONG_SUBJECT: Scenario(bearer=Bearer.OTHER_SUBJECT),
    Case.INSUFFICIENT_SCOPE: Scenario(bearer=Bearer.PRIMARY, narrow_scopes=True),
    Case.NON_MEMBER: Scenario(bearer=Bearer.ACCOUNT_OUTSIDER),
    Case.LOW_ROLE: Scenario(bearer=Bearer.ACCOUNT_LOW_ROLE),
    Case.APP_API_DISABLED: Scenario(bearer=Bearer.PRIMARY, app_api_enabled=False),
    Case.UNKNOWN_APP: Scenario(bearer=Bearer.PRIMARY, unknown_app=True),
    Case.FOREIGN_WORKSPACE_QUERY: Scenario(bearer=Bearer.PRIMARY, foreign_workspace_query=True),
    Case.EDITION_NOT_ENTERPRISE: Scenario(bearer=Bearer.PRIMARY, edition=DeploymentEdition.COMMUNITY),
    Case.LICENSE_INVALID: Scenario(bearer=Bearer.PRIMARY, license_status=LicenseStatus.EXPIRED),
    Case.EE_ACCOUNT_PUBLIC: Scenario(
        bearer=Bearer.ACCOUNT_MEMBER,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=WebAppAccessMode.PUBLIC,
    ),
    Case.EE_ACCOUNT_SSO_VERIFIED: Scenario(
        bearer=Bearer.ACCOUNT_MEMBER,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=WebAppAccessMode.SSO_VERIFIED,
    ),
    Case.EE_ACCOUNT_PRIVATE_ALL: Scenario(
        bearer=Bearer.ACCOUNT_MEMBER,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=WebAppAccessMode.PRIVATE_ALL,
    ),
    Case.EE_ACCOUNT_PRIVATE_PERMITTED: Scenario(
        bearer=Bearer.ACCOUNT_MEMBER,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=WebAppAccessMode.PRIVATE,
        private_app_permitted=True,
    ),
    Case.EE_ACCOUNT_PRIVATE_REFUSED: Scenario(
        bearer=Bearer.ACCOUNT_MEMBER,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=WebAppAccessMode.PRIVATE,
        private_app_permitted=False,
    ),
    Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: Scenario(
        bearer=Bearer.ACCOUNT_MEMBER,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=False,
        access_mode=WebAppAccessMode.PRIVATE,
        private_app_permitted=False,
    ),
    Case.EE_ACCOUNT_MODE_UNRESOLVED: Scenario(
        bearer=Bearer.ACCOUNT_MEMBER,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=None,
    ),
    Case.EE_EXTERNAL_PUBLIC: Scenario(
        bearer=Bearer.EXTERNAL,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=WebAppAccessMode.PUBLIC,
    ),
    Case.EE_EXTERNAL_SSO_VERIFIED: Scenario(
        bearer=Bearer.EXTERNAL,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=WebAppAccessMode.SSO_VERIFIED,
    ),
    Case.EE_EXTERNAL_PRIVATE_ALL: Scenario(
        bearer=Bearer.EXTERNAL,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=WebAppAccessMode.PRIVATE_ALL,
    ),
    Case.EE_EXTERNAL_PRIVATE: Scenario(
        bearer=Bearer.EXTERNAL,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=WebAppAccessMode.PRIVATE,
    ),
    Case.EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: Scenario(
        bearer=Bearer.EXTERNAL,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=False,
        access_mode=WebAppAccessMode.PRIVATE,
        private_app_permitted=False,
    ),
    Case.EE_EXTERNAL_MODE_UNRESOLVED: Scenario(
        bearer=Bearer.EXTERNAL,
        edition=DeploymentEdition.ENTERPRISE,
        webapp_auth=True,
        access_mode=None,
    ),
    Case.RBAC_ON_LOW_ROLE: Scenario(bearer=Bearer.ACCOUNT_LOW_ROLE, rbac_enabled=True, rbac_allows=True),
    Case.RBAC_ON_DENIED: Scenario(bearer=Bearer.ACCOUNT_MEMBER, rbac_enabled=True, rbac_allows=False),
}


_ACCOUNT_ONLY_NO_WORKSPACE: dict[Case, Expect] = {
    Case.NO_BEARER: DENY_NO_BEARER,
    Case.MEMBER: ADMIT,
    Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
    Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
    Case.NON_MEMBER: ADMIT,
    Case.LOW_ROLE: ADMIT,
}


MATRIX: dict[str, dict[Case, Expect]] = {
    "account.get": dict(_ACCOUNT_ONLY_NO_WORKSPACE),
    "account.sessions.revoke_self": dict(_ACCOUNT_ONLY_NO_WORKSPACE),
    "account.sessions.list": dict(_ACCOUNT_ONLY_NO_WORKSPACE),
    "account.sessions.revoke_one": dict(_ACCOUNT_ONLY_NO_WORKSPACE),
    "workspaces.list": dict(_ACCOUNT_ONLY_NO_WORKSPACE),
    "workspaces.describe": dict(_ACCOUNT_ONLY_NO_WORKSPACE),
    "apps.list": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: ADMIT,
    },
    "workspaces.switch": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: ADMIT,
    },
    "workspaces.members.list": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: ADMIT,
    },
    "workspaces.members.invite": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: DENY_ROLE,
        Case.RBAC_ON_LOW_ROLE: DENY_ROLE,
    },
    "workspaces.members.remove": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: DENY_ROLE,
        Case.RBAC_ON_LOW_ROLE: DENY_ROLE,
    },
    "workspaces.members.update_role": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: DENY_ROLE,
        Case.RBAC_ON_LOW_ROLE: DENY_ROLE,
    },
    "app_dsl.import": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: DENY_ROLE,
        Case.RBAC_ON_LOW_ROLE: ADMIT,
        Case.RBAC_ON_DENIED: DENY_RBAC,
    },
    "app_dsl.import_confirm": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: DENY_ROLE,
        Case.RBAC_ON_LOW_ROLE: ADMIT,
        Case.RBAC_ON_DENIED: DENY_RBAC,
    },
    "apps.describe": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: ADMIT,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: ACCEPTED_DELTA_FOREIGN_WORKSPACE,
        Case.EE_ACCOUNT_PUBLIC: ADMIT,
        Case.EE_ACCOUNT_SSO_VERIFIED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_ALL: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_PERMITTED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: ADMIT,
        Case.EE_ACCOUNT_MODE_UNRESOLVED: ADMIT,
        Case.RBAC_ON_DENIED: DENY_RBAC,
    },
    "app_dsl.export": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: DENY_ROLE,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: ACCEPTED_DELTA_FOREIGN_WORKSPACE,
        Case.EE_ACCOUNT_PUBLIC: ADMIT,
        Case.EE_ACCOUNT_SSO_VERIFIED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_ALL: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_PERMITTED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: ADMIT,
        Case.EE_ACCOUNT_MODE_UNRESOLVED: ADMIT,
        Case.RBAC_ON_LOW_ROLE: ADMIT,
        Case.RBAC_ON_DENIED: DENY_RBAC,
    },
    "app_dsl.check_dependencies": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: DENY_ROLE,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: ACCEPTED_DELTA_FOREIGN_WORKSPACE,
        Case.EE_ACCOUNT_PUBLIC: ADMIT,
        Case.EE_ACCOUNT_SSO_VERIFIED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_ALL: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_PERMITTED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: ADMIT,
        Case.EE_ACCOUNT_MODE_UNRESOLVED: ADMIT,
        Case.RBAC_ON_LOW_ROLE: ADMIT,
        Case.RBAC_ON_DENIED: DENY_RBAC,
    },
    "app_run.run": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_SSO_NEEDS_EE,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: ADMIT,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: ACCEPTED_DELTA_FOREIGN_WORKSPACE,
        Case.EE_ACCOUNT_PUBLIC: ADMIT,
        Case.EE_ACCOUNT_SSO_VERIFIED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_ALL: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_PERMITTED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.EE_EXTERNAL_PUBLIC: ADMIT,
        Case.EE_EXTERNAL_SSO_VERIFIED: ADMIT,
        Case.EE_EXTERNAL_PRIVATE_ALL: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_EXTERNAL_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.RBAC_ON_DENIED: DENY_RBAC,
    },
    "app_run.stop": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_SSO_NEEDS_EE,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: ADMIT,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: ACCEPTED_DELTA_FOREIGN_WORKSPACE,
        Case.EE_ACCOUNT_PUBLIC: ADMIT,
        Case.EE_ACCOUNT_SSO_VERIFIED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_ALL: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_PERMITTED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.EE_EXTERNAL_PUBLIC: ADMIT,
        Case.EE_EXTERNAL_SSO_VERIFIED: ADMIT,
        Case.EE_EXTERNAL_PRIVATE_ALL: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_EXTERNAL_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.RBAC_ON_DENIED: DENY_RBAC,
    },
    "files.upload": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_SSO_NEEDS_EE,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: ADMIT,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: ACCEPTED_DELTA_FOREIGN_WORKSPACE,
        Case.EE_ACCOUNT_PUBLIC: ADMIT,
        Case.EE_ACCOUNT_SSO_VERIFIED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_ALL: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_PERMITTED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.EE_EXTERNAL_PUBLIC: ADMIT,
        Case.EE_EXTERNAL_SSO_VERIFIED: ADMIT,
        Case.EE_EXTERNAL_PRIVATE_ALL: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_EXTERNAL_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
    },
    "human_input_form.get": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_SSO_NEEDS_EE,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: ADMIT,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: ACCEPTED_DELTA_FOREIGN_WORKSPACE,
        Case.EE_ACCOUNT_PUBLIC: ADMIT,
        Case.EE_ACCOUNT_SSO_VERIFIED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_ALL: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_PERMITTED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.EE_EXTERNAL_PUBLIC: ADMIT,
        Case.EE_EXTERNAL_SSO_VERIFIED: ADMIT,
        Case.EE_EXTERNAL_PRIVATE_ALL: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_EXTERNAL_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.RBAC_ON_DENIED: DENY_RBAC,
    },
    "human_input_form.submit": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_SSO_NEEDS_EE,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: ADMIT,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: ACCEPTED_DELTA_FOREIGN_WORKSPACE,
        Case.EE_ACCOUNT_PUBLIC: ADMIT,
        Case.EE_ACCOUNT_SSO_VERIFIED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_ALL: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_PERMITTED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.EE_EXTERNAL_PUBLIC: ADMIT,
        Case.EE_EXTERNAL_SSO_VERIFIED: ADMIT,
        Case.EE_EXTERNAL_PRIVATE_ALL: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_EXTERNAL_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.RBAC_ON_DENIED: DENY_RBAC,
    },
    "workflow_events.stream": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_SSO_NEEDS_EE,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER: DENY_NON_MEMBER,
        Case.LOW_ROLE: ADMIT,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: ACCEPTED_DELTA_FOREIGN_WORKSPACE,
        Case.EE_ACCOUNT_PUBLIC: ADMIT,
        Case.EE_ACCOUNT_SSO_VERIFIED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_ALL: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_PERMITTED: ADMIT,
        Case.EE_ACCOUNT_PRIVATE_REFUSED: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_ACCOUNT_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.EE_EXTERNAL_PUBLIC: ADMIT,
        Case.EE_EXTERNAL_SSO_VERIFIED: ADMIT,
        Case.EE_EXTERNAL_PRIVATE_ALL: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_EXTERNAL_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
        Case.RBAC_ON_DENIED: DENY_RBAC,
    },
    "permitted_external.list": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT_NO_MOUNT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.EDITION_NOT_ENTERPRISE: DENY_EDITION,
        Case.LICENSE_INVALID: DENY_LICENSE,
    },
    "permitted_external.describe": {
        Case.NO_BEARER: DENY_NO_BEARER,
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.EDITION_NOT_ENTERPRISE: DENY_EDITION,
        Case.LICENSE_INVALID: DENY_LICENSE,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: Expect(
            ADMITTED,
            note="the external-SSO pipeline runs no check_workspace_mismatch, unlike the account pipeline",
        ),
        Case.EE_EXTERNAL_PUBLIC: ADMIT,
        Case.EE_EXTERNAL_SSO_VERIFIED: ADMIT,
        Case.EE_EXTERNAL_PRIVATE_ALL: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_EXTERNAL_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
    },
}


ROUTES_BY_ID = {route.id: route for route in ROUTES}


def _applicable(route: Route, case: Case) -> bool:
    return CASE_REQUIRES[case] <= route.traits


ROWS: tuple[tuple[Route, Case, Expect], ...] = tuple(
    (route, case, MATRIX[route.id][case]) for route in ROUTES for case in Case if _applicable(route, case)
)


@dataclass(slots=True)
class World:
    """Persisted rows and the tokens that address them."""

    workspace_id: str
    other_workspace_id: str
    app_id: str
    disabled_app_id: str
    member_account_id: str
    low_role_account_id: str
    outsider_account_id: str
    tokens: dict[Bearer, str] = field(default_factory=dict)


def _admit_on_mount(*_args: object, **_kwargs: object) -> None:
    raise ImATeapot("admitted")


class _MemoryResolver:
    """Stands in for the DB-backed token resolver.

    Token resolution is an input to the matrix, not part of it, and the shipped
    resolver compares a timezone-aware expiry against a column SQLite hands back
    naive.
    """

    def __init__(self, rows: dict[str, ResolvedRow]) -> None:
        self._rows = rows

    def resolve(self, token_hash: str) -> ResolvedRow | None:
        return self._rows.get(token_hash)


def _registry(rows: dict[str, ResolvedRow], *, narrow_scopes: bool) -> TokenKindRegistry:
    """`narrow_scopes` mints tokens carrying no scope at all.

    The shipped registry gives `dfoa_` `Scope.FULL` and `dfoe_` exactly the two
    scopes its routes ask for, so no shipped token can fail `check_scope`. That is
    a property of today's two token kinds, not of the check: `check_scope` runs on
    every request, and a narrower kind is the only way to reach its refusal. Do not
    delete the scope rows on the grounds that no real token trips them — they are
    what will catch a third token kind being routed somewhere it was not scoped for.
    """
    return TokenKindRegistry(
        [
            TokenKind(
                prefix=SubjectType.ACCOUNT.prefix,
                subject_type=SubjectType.ACCOUNT,
                scopes=frozenset() if narrow_scopes else SubjectType.ACCOUNT.scopes,
                token_type=TokenType.OAUTH_ACCOUNT,
                resolver=_MemoryResolver(rows),
            ),
            TokenKind(
                prefix=SubjectType.EXTERNAL_SSO.prefix,
                subject_type=SubjectType.EXTERNAL_SSO,
                scopes=frozenset() if narrow_scopes else SubjectType.EXTERNAL_SSO.scopes,
                token_type=TokenType.OAUTH_EXTERNAL_SSO,
                resolver=_MemoryResolver(rows),
            ),
        ]
    )


@pytest.fixture
def token_rows() -> dict[str, ResolvedRow]:
    return {}


@pytest.fixture
def matrix_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[Flask]:
    """The openapi blueprint on a bare app with a login manager and the admission probe."""
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.secret_key = "openapi-auth-matrix"
    LoginManager(app)
    app.register_blueprint(openapi_bp)

    monkeypatch.setattr(
        rate_limit_module,
        "LIMIT_BEARER_PER_TOKEN",
        rate_limit_module.RateLimit(
            0,
            rate_limit_module.LIMIT_BEARER_PER_TOKEN.window,
            rate_limit_module.LIMIT_BEARER_PER_TOKEN.scopes,
        ),
    )

    user_logged_in.connect(_admit_on_mount)
    try:
        yield app
    finally:
        user_logged_in.disconnect(_admit_on_mount)


@pytest.fixture
def world(sqlite_session_factory: sessionmaker[Session], token_rows: dict[str, ResolvedRow]) -> World:
    """One workspace with an owner, a normal member and an outsider; two apps."""
    built = World(
        workspace_id=str(uuid.uuid4()),
        other_workspace_id=str(uuid.uuid4()),
        app_id=str(uuid.uuid4()),
        disabled_app_id=str(uuid.uuid4()),
        member_account_id=str(uuid.uuid4()),
        low_role_account_id=str(uuid.uuid4()),
        outsider_account_id=str(uuid.uuid4()),
    )

    def account(account_id: str, email: str) -> Account:
        row = Account(name=email, email=email, avatar="", status=AccountStatus.ACTIVE)
        row.id = account_id
        return row

    def application(app_id: str, *, enable_api: bool) -> App:
        return App(
            id=app_id,
            tenant_id=built.workspace_id,
            name="matrix app",
            description="",
            mode="workflow",
            enable_site=False,
            enable_api=enable_api,
        )

    workspace = Tenant(name="matrix workspace")
    workspace.id = built.workspace_id
    other_workspace = Tenant(name="other workspace")
    other_workspace.id = built.other_workspace_id

    with sqlite_session_factory() as session:
        session.add_all(
            [
                workspace,
                other_workspace,
                account(built.member_account_id, "owner@example.com"),
                account(built.low_role_account_id, "normal@example.com"),
                account(built.outsider_account_id, "outsider@example.com"),
                application(built.app_id, enable_api=True),
                application(built.disabled_app_id, enable_api=False),
                TenantAccountJoin(
                    tenant_id=built.workspace_id,
                    account_id=built.member_account_id,
                    role=TenantAccountRole.OWNER,
                ),
                TenantAccountJoin(
                    tenant_id=built.workspace_id,
                    account_id=built.low_role_account_id,
                    role=TenantAccountRole.NORMAL,
                ),
            ]
        )
        session.commit()

    def mint(prefix: str, *, account_id: str | None, email: str) -> str:
        raw = prefix + uuid.uuid4().hex
        token_rows[sha256_hex(raw)] = ResolvedRow(
            subject_email=email,
            subject_issuer="dify:account" if account_id else "https://idp.example",
            account_id=uuid.UUID(account_id) if account_id else None,
            client_id="difyctl",
            token_id=uuid.uuid4(),
            expires_at=None,
        )
        return raw

    built.tokens = {
        Bearer.ACCOUNT_MEMBER: mint(
            SubjectType.ACCOUNT.prefix, account_id=built.member_account_id, email="owner@example.com"
        ),
        Bearer.ACCOUNT_LOW_ROLE: mint(
            SubjectType.ACCOUNT.prefix, account_id=built.low_role_account_id, email="normal@example.com"
        ),
        Bearer.ACCOUNT_OUTSIDER: mint(
            SubjectType.ACCOUNT.prefix, account_id=built.outsider_account_id, email="outsider@example.com"
        ),
        Bearer.EXTERNAL: mint(SubjectType.EXTERNAL_SSO.prefix, account_id=None, email="external@example.com"),
    }
    return built


def _system_features(
    *, edition: DeploymentEdition, webapp_auth: bool, license_status: LicenseStatus
) -> SystemFeatureModel:
    features = SystemFeatureModel(deployment_edition=edition)
    features.webapp_auth.enabled = webapp_auth
    features.license.status = license_status
    return features


@dataclass(frozen=True, slots=True)
class _WebAppSettings:
    access_mode: str


def _access_mode_settings(access_mode: WebAppAccessMode | None) -> _WebAppSettings | None:
    if access_mode is None:
        return None
    return _WebAppSettings(access_mode=access_mode.value)


def _webapp_account() -> Account:
    """The account an external-SSO subject's email resolves to for the private-app check."""
    row = Account(name="external", email="external@example.com", avatar="", status=AccountStatus.ACTIVE)
    row.id = str(uuid.uuid4())
    return row


def _end_user(_type: EndUserType, tenant_id: str, app_id: str, user_id: str | None = None) -> EndUser:
    row = EndUser(
        tenant_id=tenant_id,
        app_id=app_id,
        type=EndUserType.OPENAPI,
        is_anonymous=False,
        session_id=user_id or "",
    )
    row.external_user_id = user_id
    return row


def _bearer_for(route: Route, scenario: Scenario) -> Bearer | None:
    account_primary = Trait.ACCOUNT_PRIMARY in route.traits
    match scenario.bearer:
        case Bearer.NONE:
            return None
        case Bearer.PRIMARY:
            return Bearer.ACCOUNT_MEMBER if account_primary else Bearer.EXTERNAL
        case Bearer.OTHER_SUBJECT:
            return Bearer.EXTERNAL if account_primary else Bearer.ACCOUNT_MEMBER
        case _:
            return scenario.bearer


def _url(route: Route, world: World, scenario: Scenario) -> str:
    if scenario.unknown_app:
        app_id = str(uuid.uuid4())
    elif not scenario.app_api_enabled:
        app_id = world.disabled_app_id
    else:
        app_id = world.app_id
    ids = {
        "app_id": app_id,
        "workspace_id": world.workspace_id,
        "session_id": str(uuid.uuid4()),
        "member_id": str(uuid.uuid4()),
        "import_id": str(uuid.uuid4()),
        "task_id": str(uuid.uuid4()),
        "form_token": uuid.uuid4().hex,
    }
    query = route.query.format(**ids)
    if scenario.foreign_workspace_query:
        extra = f"workspace_id={world.other_workspace_id}"
        query = f"{query}&{extra}" if query else extra
    path = route.path.format(**ids)
    return f"/openapi/v1{path}?{query}" if query else f"/openapi/v1{path}"


def _run_case(
    *,
    route: Route,
    scenario: Scenario,
    app: Flask,
    world: World,
    token_rows: dict[str, ResolvedRow],
    monkeypatch: pytest.MonkeyPatch,
) -> TestResponse:
    from configs import dify_config

    edition = scenario.edition or (
        DeploymentEdition.ENTERPRISE if Trait.ENTERPRISE_ONLY in route.traits else DeploymentEdition.COMMUNITY
    )
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", edition)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", scenario.rbac_enabled)
    monkeypatch.setattr(
        oauth_bearer_module,
        "_authenticator",
        BearerAuthenticator(_registry(token_rows, narrow_scopes=scenario.narrow_scopes)),
    )

    features = _system_features(
        edition=edition, webapp_auth=scenario.webapp_auth, license_status=scenario.license_status
    )
    settings = _access_mode_settings(scenario.access_mode)

    headers: dict[str, str] = {}
    bearer = _bearer_for(route, scenario)
    if bearer is not None:
        headers["Authorization"] = f"Bearer {world.tokens[bearer]}"

    with ExitStack() as stack:
        stack.enter_context(patch.object(FeatureService, "get_system_features", return_value=features))
        stack.enter_context(
            patch.object(EnterpriseService.WebAppAuth, "get_app_access_mode_by_id", return_value=settings)
        )
        stack.enter_context(
            patch.object(
                EnterpriseService.WebAppAuth,
                "is_user_allowed_to_access_webapp",
                return_value=scenario.private_app_permitted,
            )
        )
        stack.enter_context(
            patch.object(
                EnterpriseService.WebAppAuth,
                "list_externally_accessible_apps",
                return_value={"data": [], "total": 0, "hasMore": False},
            )
        )
        stack.enter_context(
            patch.object(
                EndUserService,
                "get_or_create_end_user_by_type",
                side_effect=_end_user,
            )
        )
        stack.enter_context(
            patch("controllers.common.wraps._is_resource_owned_by_current_user", return_value=False),
        )
        stack.enter_context(
            patch(
                "services.enterprise.rbac_service.RBACService.CheckAccess.check",
                return_value=scenario.rbac_allows,
            )
        )
        stack.enter_context(patch.object(AccountService, "get_account_by_email", return_value=_webapp_account()))
        client = app.test_client()
        return contextvars.copy_context().run(
            lambda: client.open(_url(route, world, scenario), method=route.method, headers=headers)
        )


@pytest.mark.parametrize(
    ("route", "case", "expected"),
    ROWS,
    ids=[f"{route.id}-{case.value}" for route, case, _ in ROWS],
)
def test_allow_deny_matrix(
    route: Route,
    case: Case,
    expected: Expect,
    matrix_app: Flask,
    world: World,
    token_rows: dict[str, ResolvedRow],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = _run_case(
        route=route,
        scenario=SCENARIOS[case],
        app=matrix_app,
        world=world,
        token_rows=token_rows,
        monkeypatch=monkeypatch,
    )

    body = response.get_json(silent=True) or {}
    assert response.status_code == expected.status, f"{route.id}/{case.value}: body={body}"
    if expected.message is not None:
        assert body.get("message") == expected.message


def test_matrix_covers_every_route_and_case() -> None:
    assert {route.id for route in ROUTES} == set(MATRIX)
    assert len(ROUTES) == 25
    for route in ROUTES:
        declared = set(MATRIX[route.id])
        reachable = {case for case in Case if _applicable(route, case)}
        assert declared == reachable, route.id


def test_accepted_behaviour_deltas_are_bounded_and_still_exact() -> None:
    """Each of the nine delta rows has exactly two legal states, and no third.

    Before its route migrates: marked, asserting 422 and the mismatch message.
    After: unmarked, asserting the admission the route gives once the query param is
    ignored. Nothing in between — a row that is marked *and* no longer asserts 422,
    or unmarked *and* not asserting the post-migration answer, fails here. That is
    what stops a per-route flip from being landed as a row loose enough to pass
    either way.

    The eligible set is rebuilt from route structure — every app-scoped route that
    runs the account pipeline — rather than read back out of the table, so a marker
    on any other row fails too. The set shrinks to empty over Tasks 8-11 as each
    route is moved in its own reviewed commit.
    """
    eligible = {
        (route.id, Case.FOREIGN_WORKSPACE_QUERY)
        for route in ROUTES
        if {Trait.APP_SCOPED, Trait.ACCOUNT_PRIMARY} <= route.traits
    }
    assert len(eligible) == 9

    marked = {(route.id, case) for route, case, expect in ROWS if expect.accepted_delta}
    assert marked <= eligible, sorted(marked - eligible)

    for route, case, expect in ROWS:
        if (route.id, case) not in eligible:
            continue
        if expect.accepted_delta:
            assert (expect.status, expect.message) == (422, "workspace_id does not match app's workspace"), route.id
        else:
            assert (expect.status, expect.message) == (ADMITTED, None), route.id


def test_registered_openapi_routes_match_the_matrix(matrix_app: Flask) -> None:
    """Every guarded /openapi/v1 route is in the table, and nothing else is."""
    unguarded = {
        ("GET", "/openapi/v1/_health"),
        ("GET", "/openapi/v1/_version"),
        ("GET", "/openapi/v1/openapi.json"),
        ("GET", "/openapi/v1/swagger.json"),
        ("POST", "/openapi/v1/oauth/device/code"),
        ("POST", "/openapi/v1/oauth/device/token"),
        ("GET", "/openapi/v1/oauth/device/lookup"),
        ("POST", "/openapi/v1/oauth/device/approve"),
        ("POST", "/openapi/v1/oauth/device/deny"),
        ("GET", "/openapi/v1/oauth/device/approval-context"),
        ("POST", "/openapi/v1/oauth/device/approve-external"),
        ("GET", "/openapi/v1/oauth/device/sso-initiate"),
        ("GET", "/openapi/v1/oauth/device/sso-complete"),
        ("GET", "/openapi/v1/swagger-ui.html"),
    }
    registered: set[tuple[str, str]] = set()
    for rule in matrix_app.url_map.iter_rules():
        if not str(rule).startswith("/openapi/v1"):
            continue
        for method in rule.methods or set():
            if method in {"HEAD", "OPTIONS"}:
                continue
            registered.add((method, str(rule)))

    registered = {entry for entry in registered if entry[1] != "/openapi/v1/"}
    expected = {
        (route.method, "/openapi/v1" + route.path.replace("{", "<string:").replace("}", ">")) for route in ROUTES
    }
    assert registered - unguarded == expected


OPENAPI_DOCUMENT_DIGEST = "7d381ec1cc2fff4fccfe4554c5be6962c84fd928719277eef4711a2ce66ebe0c"

OPERATIONS_MIGRATING_ONTO_RETURNS: frozenset[tuple[str, str]] = frozenset(
    {
        ("post", "/apps/{app_id}:run"),
        ("get", "/apps/{app_id}/human-input-forms/{form_token}"),
        ("get", "/apps/{app_id}/tasks/{task_id}/events"),
    }
)
"""The three raw `openapi_ns.response` sites inside the nine files this PR migrates.

`app_run.py`, `human_input_form.py` and `workflow_events.py` document their 200 by
hand today; routing them through `@returns` adds `("default", "Error", ErrorBody)`.
Nothing changes on the wire — all three return a Flask `Response` or a bare dict
tuple, never a `BaseModel`.
"""

DEVICE_FLOW_OPERATIONS_OUTSIDE_THIS_PR: frozenset[tuple[str, str]] = frozenset(
    {
        ("post", "/oauth/device/code"),
        ("post", "/oauth/device/token"),
        ("get", "/oauth/device/lookup"),
        ("post", "/oauth/device/approve"),
        ("post", "/oauth/device/deny"),
    }
)
"""The other five raw sites — device-flow routes that carry no `auth_router.guard`.

They authenticate through `bearer_feature_required`, are not among the 25 handlers
this PR moves, and must therefore keep their exact response sets. Tolerating a
`default` entry on these too would make the snapshot pass whether or not the
migration happened, which is a snapshot of nothing.
"""

EXPECTED_RESPONSE_CODES: dict[tuple[str, str], frozenset[str]] = {
    ("get", "/_health"): frozenset({"200", "default"}),
    ("get", "/_version"): frozenset({"200", "default"}),
    ("get", "/account"): frozenset({"200", "default"}),
    ("get", "/account/sessions"): frozenset({"200", "422", "default"}),
    ("delete", "/account/sessions/self"): frozenset({"200", "default"}),
    ("delete", "/account/sessions/{session_id}"): frozenset({"200", "default"}),
    ("get", "/apps"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/dependencies:check"): frozenset({"200", "default"}),
    ("get", "/apps/{app_id}/dsl"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/files"): frozenset({"201", "400", "401", "413", "415", "default"}),
    ("get", "/apps/{app_id}/human-input-forms/{form_token}"): frozenset({"200"}),
    ("post", "/apps/{app_id}/human-input-forms/{form_token}:submit"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/tasks/{task_id}/events"): frozenset({"200"}),
    ("post", "/apps/{app_id}/tasks/{task_id}:stop"): frozenset({"200", "default"}),
    ("post", "/apps/{app_id}:run"): frozenset({"200", "422"}),
    ("post", "/oauth/device/approve"): frozenset({"200"}),
    ("post", "/oauth/device/code"): frozenset({"200"}),
    ("post", "/oauth/device/deny"): frozenset({"200"}),
    ("get", "/oauth/device/lookup"): frozenset({"200"}),
    ("post", "/oauth/device/token"): frozenset({"200"}),
    ("get", "/permitted-external-apps"): frozenset({"200", "422", "default"}),
    ("get", "/permitted-external-apps/{app_id}"): frozenset({"200", "422", "default"}),
    ("get", "/workspaces"): frozenset({"200", "default"}),
    ("get", "/workspaces/{workspace_id}"): frozenset({"200", "default"}),
    ("post", "/workspaces/{workspace_id}/apps/imports"): frozenset({"200", "202", "400", "422", "default"}),
    ("post", "/workspaces/{workspace_id}/apps/imports/{import_id}:confirm"): frozenset({"200", "400", "default"}),
    ("get", "/workspaces/{workspace_id}/members"): frozenset({"200", "422", "default"}),
    ("post", "/workspaces/{workspace_id}/members"): frozenset({"201", "422", "default"}),
    ("delete", "/workspaces/{workspace_id}/members/{member_id}"): frozenset({"200", "default"}),
    ("patch", "/workspaces/{workspace_id}/members/{member_id}"): frozenset({"200", "422", "default"}),
    ("post", "/workspaces/{workspace_id}:switch"): frozenset({"200", "default"}),
}

_HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete", "head", "options", "trace"})


@pytest.fixture
def openapi_document(config_overrides: Callable[..., None]) -> dict[str, object]:
    config_overrides(SWAGGER_UI_ENABLED=True)
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    response = app.test_client().get("/openapi/v1/openapi.json")
    assert response.status_code == 200
    return response.get_json()


def _operations(document: dict[str, object]) -> Iterator[tuple[tuple[str, str], dict[str, object]]]:
    paths = document["paths"]
    assert isinstance(paths, dict)
    for path, item in paths.items():
        assert isinstance(item, dict)
        for method, operation in item.items():
            if method in _HTTP_METHODS:
                assert isinstance(operation, dict)
                yield (method, path), operation


def test_openapi_document_operations_and_response_codes(openapi_document: dict[str, object]) -> None:
    """Response codes are pinned; only the three migrating sites may gain `default`.

    The five device-flow sites are asserted exactly, so a snapshot that would pass
    whether or not the migration happened fails instead.
    """
    seen = dict(_operations(openapi_document))
    assert set(seen) == set(EXPECTED_RESPONSE_CODES)
    assert not OPERATIONS_MIGRATING_ONTO_RETURNS & DEVICE_FLOW_OPERATIONS_OUTSIDE_THIS_PR
    for key in DEVICE_FLOW_OPERATIONS_OUTSIDE_THIS_PR:
        assert "default" not in EXPECTED_RESPONSE_CODES[key]
    for key, operation in seen.items():
        responses = operation.get("responses", {})
        assert isinstance(responses, dict)
        codes = frozenset(responses)
        pinned = EXPECTED_RESPONSE_CODES[key]
        allowed = {pinned, pinned | {"default"}} if key in OPERATIONS_MIGRATING_ONTO_RETURNS else {pinned}
        assert codes in allowed, f"{key}: {sorted(codes)} is none of {[sorted(entry) for entry in allowed]}"


def test_openapi_document_is_otherwise_byte_stable(openapi_document: dict[str, object]) -> None:
    """The whole document, with the one tolerated delta normalised away, is pinned.

    `@returns` also registers `("default", "Error", ErrorBody)`, which the three
    sites in `OPERATIONS_MIGRATING_ONTO_RETURNS` lack today and gain on migration.
    Dropping that entry from exactly those three makes the document identical
    before and after, so any *other* drift — a renamed model, a changed
    description, a new parameter — moves the digest and fails here.
    """
    normalised = json.loads(json.dumps(openapi_document))
    for key, operation in _operations(normalised):
        if key in OPERATIONS_MIGRATING_ONTO_RETURNS:
            responses = operation.get("responses")
            if isinstance(responses, dict):
                responses.pop("default", None)
    canonical = json.dumps(normalised, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    assert digest == OPENAPI_DOCUMENT_DIGEST, (
        "The generated /openapi/v1/openapi.json changed in a way this PR does not expect. "
        "difyctl generates its client contract from this document, so do not re-pin "
        "OPENAPI_DOCUMENT_DIGEST until you have diffed the document and confirmed the change "
        "is intended. Adding `default` to the three OPERATIONS_MIGRATING_ONTO_RETURNS sites is "
        "already normalised away and cannot be the cause. "
        f"Re-pin to {digest} only after that check."
    )


def test_error_default_response_shape_is_what_returns_registers(openapi_document: dict[str, object]) -> None:
    """Pins the entry the three migrating sites will gain, so the delta is a known shape."""
    stop = dict(_operations(openapi_document))[("post", "/apps/{app_id}/tasks/{task_id}:stop")]
    responses = stop["responses"]
    assert isinstance(responses, dict)
    assert responses["default"] == {
        "description": "Error",
        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorBody"}}},
    }
