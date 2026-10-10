"""The /openapi/v1 allow/deny matrix, and a snapshot of the generated document.

The matrix is derived from what actually runs, not from what a route declares: a
route's own requirements are merged with the fixed ones its subject's pipeline
carries, a `CheckWorkspaceRole` applies only where RBAC is off and a `CheckRBACPermission` only where it is on,
and `CheckAppAccess` applies the private-app check whether
or not `webapp_auth.enabled` gates the ACL. Reading declarations alone under-counts
every one of those.

Requests run through the real Flask blueprint with the real router, the real
pipeline and real database rows. The only substitutions are at process seams the
router already treats as pluggable: the bound `BearerAuthenticator` (so a token's
subject kind and scope set are chosen per row), the enterprise HTTP clients, and
the flask-login mount. The RBAC backend and the enterprise web-app service are
stubbed per row, so those rows pin how *this* code handles each answer they can
give — never what the real services decide.

Cases are never gated on whether a route declares a check. A row that asserts
`ADMIT` where RBAC, a workspace role check or a licence gate does not fire is pinning the
check's *absence*: losing a check is caught by the deny rows, and gaining one is
caught by these. `files.upload` is the route the design says must never acquire an
RBAC permission, and `files.upload-rbac_on_denied` is the row that says so.

Admission is observed as HTTP 418: a `user_logged_in` receiver raises `ImATeapot`
at the moment the pipeline mounts the caller, which is after every requirement has
passed and before the view body runs. That keeps a row from depending on whether a
view could complete (several stream SSE or invoke a workflow). One route mounts no
caller — `permitted_external.list` resolves no end user because it carries no
`app_id` — so its admission row says so and asserts the view's own 200 instead.

Two answers in the table are worth reading twice, because they are what the code
does rather than what a route's declaration suggests:

* `workspaces.describe` declares no membership requirement, so a non-member is
  *admitted* by auth and refused by the view's own lookup. `workspaces.switch`,
  one path segment away, declares one and is refused by auth.
* No token the shipped registry mints can fail `CheckScope` — `dfoa_` carries
  `Scope.FULL` and `dfoe_` carries exactly the two scopes its routes ask for — so
  the scope rows mint from a deliberately narrowed registry. Those rows are not
  dead weight and must not be simplified away: `CheckScope` is live code on every
  request, and the day a narrower token kind is minted it is the only thing
  standing between that token and every route it was not scoped for.

`Case.NON_MEMBER_AND_INSUFFICIENT_SCOPE` is the one case that combines a real
membership failure with a real scope failure on the same request. Neither
`INSUFFICIENT_SCOPE` nor `NON_MEMBER` alone proves which one a doubly-broken request
hears; membership runs EARLY and scope NORMAL, so it hears membership.

Routes that declare the same requirement tuple answer every case the same way,
so `MATRIX` runs the cases on one representative per tuple and `DECLARED` pins
which tuple each of the 25 routes carries. A route that changes its tuple fails
the wiring test; a tuple that changes its answers fails its representative's rows.
"""

from __future__ import annotations

import contextvars
import uuid
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum, auto
from functools import singledispatch
from typing import Final
from unittest.mock import patch

import pytest
from flask import Flask
from flask_login import LoginManager, user_logged_in
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import ImATeapot
from werkzeug.routing import Rule
from werkzeug.test import TestResponse

import libs.oauth_bearer as oauth_bearer_module
import libs.rate_limit as rate_limit_module
from app_factory import create_flask_app_with_configs
from constants.oauth_bearer import Scope, TokenType
from controllers.common.rbac import AgentBehindApp, PlainApp, RBACCheck, RBACPermission, Workspace
from controllers.openapi import bp as openapi_bp
from controllers.openapi._app_settings import REGULAR_MODES
from controllers.openapi._catalog import CATALOG_HEADER, catalog_for
from controllers.openapi._errors import WebAppAccessRequiresEE
from controllers.openapi.auth import subjects
from controllers.openapi.auth.requirements import (
    CheckAppAccess,
    CheckAppApiEnabled,
    CheckAppMode,
    CheckAppQuota,
    CheckPluginInstallSetting,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWebAppAuthEnterprise,
    CheckWorkspaceInvitationQuota,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
    Requirement,
)
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject
from controllers.openapi.human_input_form import CheckFormSurface
from enums import DeploymentEdition, WebAppAccessMode
from libs.oauth_bearer import BearerAuthenticator, ResolvedRow, sha256_hex
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from models.oauth import OAuthAccessToken
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.feature_entities import LicenseStatus, SystemFeatureModel
from services.rbac_resource_service import RBACResourceService
from services.system_feature_service import SystemFeatureService
from tests.unit_tests.config_override import apply_config_overrides

ADMITTED = 418


class Trait(StrEnum):
    """Structural facts about a route, used only to decide which cases can reach it.

    Every member here is a fact about the *shape* of the request — is there an
    `app_id` in the path, can a `dfoe_` token address this route at all. None is
    read off a route's declared requirements, deliberately: gating a
    case on a declared check means a route that *gains* that check during migration
    simply loses the row, and gaining a check is the hazard this plan cares about
    most. Cases like `RBAC_ON_DENIED` therefore run on every route an account
    caller can reach, and assert `ADMIT` where the check does not exist today.
    """

    APP_SCOPED = auto()
    ACCOUNT_PRIMARY = auto()
    EXTERNAL_REACHABLE = auto()
    ENTERPRISE_ONLY = auto()


class Case(StrEnum):
    NO_BEARER = auto()
    MEMBER = auto()
    WRONG_SUBJECT = auto()
    INSUFFICIENT_SCOPE = auto()
    NON_MEMBER = auto()
    NON_MEMBER_AND_INSUFFICIENT_SCOPE = auto()
    LOW_ROLE = auto()
    APP_API_DISABLED = auto()
    UNKNOWN_APP = auto()
    FOREIGN_WORKSPACE_QUERY = auto()
    EDITION_NOT_ENTERPRISE = auto()
    LICENSE_INVALID = auto()
    EE_LICENSE_INVALID = auto()
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
    """`message` is the canonical ErrorBody message; `None` means it is not pinned."""

    status: int
    message: str | None = None
    note: str = ""


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
DENY_ACCESS_MODE = Expect(403, "subject_not_allowed_for_access_mode")
DENY_MODE_UNRESOLVED = Expect(403, "app or access mode not loaded")
DENY_PRIVATE_APP = Expect(403, "user_not_allowed_for_private_app")
DENY_EDITION = Expect(404, note="endpoint-level edition gate, raised before the bearer is read")
DENY_LICENSE = Expect(403, "license_invalid")
DENY_RBAC = Expect(403, note="bare werkzeug Forbidden from enforce_rbac_checks")
ADMIT_NO_RBAC_PERMISSION = Expect(
    ADMITTED,
    note=(
        "pins a check this route does NOT have: RBAC is on and denying, and the route still "
        "admits because it declares no scene. Attaching one during migration turns this 403. "
        "files.upload is the route the design says must never gain a scene"
    ),
)
ADMIT_NO_WORKSPACE_ROLE = Expect(
    ADMITTED,
    note="pins a check this route does NOT have: RBAC is on and a NORMAL member is still admitted",
)
ADMIT_NO_LICENCE_GATE = Expect(
    ADMITTED,
    note="pins a check this route does NOT have: the licence is dead and the route still admits",
)
ADMIT_NO_MOUNT = Expect(
    200,
    note="external subject mounts no caller on an app-less route, so admission shows as the view's own 200",
)


_RUN_TRAITS = frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE})

ROUTES: tuple[Route, ...] = (
    Route("describe.account", "GET", "/account", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route("account.sessions.revoke_self", "DELETE", "/account/sessions/self", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route("get.account.session", "GET", "/account/sessions", frozenset({Trait.ACCOUNT_PRIMARY})),
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
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
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
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "workspaces.members.remove",
        "DELETE",
        "/workspaces/{workspace_id}/members/{member_id}",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "workspaces.members.update_role",
        "PATCH",
        "/workspaces/{workspace_id}/members/{member_id}",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "plugins.marketplace",
        "GET",
        "/workspaces/{workspace_id}/marketplace/plugins",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route("plugins.list", "GET", "/workspaces/{workspace_id}/plugins", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route("plugins.install", "POST", "/workspaces/{workspace_id}/plugins:install", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route(
        "plugins.task",
        "GET",
        "/workspaces/{workspace_id}/plugin-tasks/{task_id}",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "plugins.delete",
        "DELETE",
        "/workspaces/{workspace_id}/plugins/{plugin_id}",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "model_providers.describe",
        "GET",
        "/workspaces/{workspace_id}/model-providers/{provider}",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "model_providers.credential.create",
        "POST",
        "/workspaces/{workspace_id}/model-providers/{provider}/credentials",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "model_providers.credential.set",
        "PATCH",
        "/workspaces/{workspace_id}/model-providers/{provider}/credentials/{credential_id}",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route("tools.list", "GET", "/workspaces/{workspace_id}/tools", frozenset({Trait.ACCOUNT_PRIMARY})),
    Route(
        "tool_providers.describe",
        "GET",
        "/workspaces/{workspace_id}/tool-providers/{provider}",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "tool_providers.credential.create",
        "POST",
        "/workspaces/{workspace_id}/tool-providers/{provider}/credentials",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "tool_providers.credential.set",
        "PATCH",
        "/workspaces/{workspace_id}/tool-providers/{provider}/credentials/{credential_id}",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "knowledge_bases.list",
        "GET",
        "/workspaces/{workspace_id}/knowledge-bases",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "models.list",
        "GET",
        "/workspaces/{workspace_id}/models",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "models.credential.create",
        "POST",
        "/workspaces/{workspace_id}/model-providers/{provider}/models/credentials",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "models.credential.set",
        "PATCH",
        "/workspaces/{workspace_id}/model-providers/{provider}/models/credentials/{credential_id}",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "app_dsl.import",
        "POST",
        "/workspaces/{workspace_id}/apps/imports",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "app_dsl.check",
        "POST",
        "/workspaces/{workspace_id}/apps/imports:check",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "app_dsl.import_confirm",
        "POST",
        "/workspaces/{workspace_id}/apps/imports/{import_id}:confirm",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "app_dsl.export",
        "GET",
        "/apps/{app_id}/dsl",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_dsl.check_dependencies",
        "GET",
        "/apps/{app_id}/dependencies:check",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route("app_run.workflow", "POST", "/apps/{app_id}/workflow:run", _RUN_TRAITS),
    Route("app_run.chat", "POST", "/apps/{app_id}/chat:run", _RUN_TRAITS),
    Route("app_run.advanced_chat", "POST", "/apps/{app_id}/advanced-chat:run", _RUN_TRAITS),
    Route("app_run.completion", "POST", "/apps/{app_id}/completion:run", _RUN_TRAITS),
    Route(
        "app_run.draft.workflow",
        "POST",
        "/apps/{app_id}/draft/workflow:run",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_run.draft.advanced_chat",
        "POST",
        "/apps/{app_id}/draft/advanced-chat:run",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route("app_workflow.run.list", "GET", "/apps/{app_id}/runs", frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED})),
    Route(
        "app_workflow.run.describe",
        "GET",
        "/apps/{app_id}/runs/{run_id}",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_workflow.run.nodes",
        "GET",
        "/apps/{app_id}/runs/{run_id}/nodes",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_workflow.publish", "POST", "/apps/{app_id}:publish", frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED})
    ),
    Route(
        "app_workflow.version.list",
        "GET",
        "/apps/{app_id}/versions",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_workflow.version.restore",
        "POST",
        "/apps/{app_id}/versions/{version_id}:restore",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_workflow.release_check",
        "GET",
        "/apps/{app_id}/release:check",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route("app_workflow.env.list", "GET", "/apps/{app_id}/env", frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED})),
    Route(
        "app_workflow.env.set",
        "PUT",
        "/apps/{app_id}/env/{env_id}",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_workflow.env.delete",
        "DELETE",
        "/apps/{app_id}/env/{env_id}",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route("node_types.list", "GET", "/node-types", frozenset({Trait.ACCOUNT_PRIMARY, Trait.EXTERNAL_REACHABLE})),
    Route(
        "node_types.describe",
        "GET",
        "/node-types/{node_type}",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.EXTERNAL_REACHABLE}),
    ),
    Route(
        "app_create.workflow", "POST", "/workspaces/{workspace_id}/apps/workflow", frozenset({Trait.ACCOUNT_PRIMARY})
    ),
    Route(
        "app_create.advanced_chat",
        "POST",
        "/workspaces/{workspace_id}/apps/advanced-chat",
        frozenset({Trait.ACCOUNT_PRIMARY}),
    ),
    Route(
        "app_workflow.node_run.workflow",
        "POST",
        "/apps/{app_id}/draft/workflow/nodes/{node_id}:run",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_workflow.node_run.advanced_chat",
        "POST",
        "/apps/{app_id}/draft/advanced-chat/nodes/{node_id}:run",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.describe.workflow",
        "GET",
        "/apps/{app_id}/app-info/workflow",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.set.workflow",
        "PATCH",
        "/apps/{app_id}/app-info/workflow",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "service_api.describe",
        "GET",
        "/apps/{app_id}/service-api",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "service_api.set",
        "PATCH",
        "/apps/{app_id}/service-api",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.describe.advanced_chat",
        "GET",
        "/apps/{app_id}/app-info/advanced-chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.set.advanced_chat",
        "PATCH",
        "/apps/{app_id}/app-info/advanced-chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.describe.chat",
        "GET",
        "/apps/{app_id}/app-info/chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.set.chat",
        "PATCH",
        "/apps/{app_id}/app-info/chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.describe.agent_chat",
        "GET",
        "/apps/{app_id}/app-info/agent-chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.set.agent_chat",
        "PATCH",
        "/apps/{app_id}/app-info/agent-chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.describe.completion",
        "GET",
        "/apps/{app_id}/app-info/completion",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.set.completion",
        "PATCH",
        "/apps/{app_id}/app-info/completion",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.describe.agent",
        "GET",
        "/apps/{app_id}/app-info/agent",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_info.set.agent",
        "PATCH",
        "/apps/{app_id}/app-info/agent",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "service_api.describe.agent",
        "GET",
        "/apps/{app_id}/service-api/agent",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "service_api.set.agent",
        "PATCH",
        "/apps/{app_id}/service-api/agent",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.describe.workflow",
        "GET",
        "/apps/{app_id}/webapp/workflow",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.set.workflow",
        "PATCH",
        "/apps/{app_id}/webapp/workflow",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.reset",
        "POST",
        "/apps/{app_id}/webapp:reset",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp_access.describe",
        "GET",
        "/apps/{app_id}/webapp-access",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp_access.set",
        "PUT",
        "/apps/{app_id}/webapp-access",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.describe.advanced_chat",
        "GET",
        "/apps/{app_id}/webapp/advanced-chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.set.advanced_chat",
        "PATCH",
        "/apps/{app_id}/webapp/advanced-chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.describe.chat",
        "GET",
        "/apps/{app_id}/webapp/chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.set.chat",
        "PATCH",
        "/apps/{app_id}/webapp/chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.describe.agent_chat",
        "GET",
        "/apps/{app_id}/webapp/agent-chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.set.agent_chat",
        "PATCH",
        "/apps/{app_id}/webapp/agent-chat",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.describe.completion",
        "GET",
        "/apps/{app_id}/webapp/completion",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.set.completion",
        "PATCH",
        "/apps/{app_id}/webapp/completion",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.describe.agent",
        "GET",
        "/apps/{app_id}/webapp/agent",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.set.agent",
        "PATCH",
        "/apps/{app_id}/webapp/agent",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp.reset.agent",
        "POST",
        "/apps/{app_id}/webapp/agent:reset",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp_access.describe.agent",
        "GET",
        "/apps/{app_id}/webapp-access/agent",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "webapp_access.set.agent",
        "PUT",
        "/apps/{app_id}/webapp-access/agent",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED}),
    ),
    Route(
        "app_run.stop",
        "POST",
        "/apps/{app_id}/tasks/{task_id}:stop",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
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
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
    ),
    Route(
        "human_input_form.submit",
        "POST",
        "/apps/{app_id}/human-input-forms/{form_token}:submit",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
    ),
    Route(
        "workflow_events.stream",
        "GET",
        "/apps/{app_id}/tasks/{task_id}/events",
        frozenset({Trait.ACCOUNT_PRIMARY, Trait.APP_SCOPED, Trait.EXTERNAL_REACHABLE}),
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
    # frozenset() rather than {ACCOUNT_PRIMARY}: this one also has to reach the
    # SSO-only routes, to pin that they answer on the subject axis, not this one.
    Case.NON_MEMBER_AND_INSUFFICIENT_SCOPE: frozenset(),
    Case.LOW_ROLE: frozenset({Trait.ACCOUNT_PRIMARY}),
    Case.APP_API_DISABLED: frozenset({Trait.APP_SCOPED}),
    Case.UNKNOWN_APP: frozenset({Trait.APP_SCOPED}),
    Case.FOREIGN_WORKSPACE_QUERY: frozenset({Trait.APP_SCOPED}),
    Case.EDITION_NOT_ENTERPRISE: frozenset({Trait.ENTERPRISE_ONLY}),
    Case.LICENSE_INVALID: frozenset(),
    Case.EE_LICENSE_INVALID: frozenset(),
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
    Case.RBAC_ON_LOW_ROLE: frozenset({Trait.ACCOUNT_PRIMARY}),
    Case.RBAC_ON_DENIED: frozenset({Trait.ACCOUNT_PRIMARY}),
}


SCENARIOS: dict[Case, Scenario] = {
    Case.NO_BEARER: Scenario(bearer=Bearer.NONE),
    Case.MEMBER: Scenario(bearer=Bearer.PRIMARY),
    Case.WRONG_SUBJECT: Scenario(bearer=Bearer.OTHER_SUBJECT),
    Case.INSUFFICIENT_SCOPE: Scenario(bearer=Bearer.PRIMARY, narrow_scopes=True),
    Case.NON_MEMBER: Scenario(bearer=Bearer.ACCOUNT_OUTSIDER),
    Case.NON_MEMBER_AND_INSUFFICIENT_SCOPE: Scenario(bearer=Bearer.ACCOUNT_OUTSIDER, narrow_scopes=True),
    Case.LOW_ROLE: Scenario(bearer=Bearer.ACCOUNT_LOW_ROLE),
    Case.APP_API_DISABLED: Scenario(bearer=Bearer.PRIMARY, app_api_enabled=False),
    Case.UNKNOWN_APP: Scenario(bearer=Bearer.PRIMARY, unknown_app=True),
    Case.FOREIGN_WORKSPACE_QUERY: Scenario(bearer=Bearer.PRIMARY, foreign_workspace_query=True),
    Case.EDITION_NOT_ENTERPRISE: Scenario(bearer=Bearer.PRIMARY, edition=DeploymentEdition.COMMUNITY),
    Case.LICENSE_INVALID: Scenario(bearer=Bearer.PRIMARY, license_status=LicenseStatus.EXPIRED),
    Case.EE_LICENSE_INVALID: Scenario(
        bearer=Bearer.PRIMARY, edition=DeploymentEdition.ENTERPRISE, license_status=LicenseStatus.EXPIRED
    ),
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


ROUTER_CASE_ROUTE = "describe.account"
ROUTER_CASES: dict[Case, Expect] = {
    Case.NO_BEARER: DENY_NO_BEARER,
    Case.LICENSE_INVALID: ADMIT_NO_LICENCE_GATE,
    Case.EE_LICENSE_INVALID: DENY_LICENSE,
}
"""Answered by the router before any route-specific requirement runs, so pinned once."""


_ACCOUNT_ONLY_NO_WORKSPACE: dict[Case, Expect] = {
    Case.MEMBER: ADMIT,
    Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
    Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
    Case.NON_MEMBER: ADMIT,
    # No live membership check on this route, so the outsider's only failure is
    # scope — same answer pre- and post-PR.
    Case.NON_MEMBER_AND_INSUFFICIENT_SCOPE: DENY_SCOPE,
    Case.LOW_ROLE: ADMIT,
    Case.RBAC_ON_LOW_ROLE: ADMIT_NO_WORKSPACE_ROLE,
    Case.RBAC_ON_DENIED: ADMIT_NO_RBAC_PERMISSION,
}

_ACCOUNT_MEMBER_NO_ROLE: dict[Case, Expect] = {
    Case.MEMBER: ADMIT,
    Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
    Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
    Case.NON_MEMBER: DENY_NON_MEMBER,
    Case.NON_MEMBER_AND_INSUFFICIENT_SCOPE: DENY_NON_MEMBER,
    Case.LOW_ROLE: ADMIT,
    Case.RBAC_ON_LOW_ROLE: ADMIT_NO_WORKSPACE_ROLE,
    Case.RBAC_ON_DENIED: ADMIT_NO_RBAC_PERMISSION,
}

_ACCOUNT_MEMBER_WITH_ROLE: dict[Case, Expect] = {
    Case.MEMBER: ADMIT,
    Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
    Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
    Case.NON_MEMBER: DENY_NON_MEMBER,
    Case.NON_MEMBER_AND_INSUFFICIENT_SCOPE: DENY_NON_MEMBER,
    Case.LOW_ROLE: DENY_ROLE,
    Case.RBAC_ON_LOW_ROLE: ADMIT,
    Case.RBAC_ON_DENIED: DENY_RBAC,
}

_DUAL_SUBJECT_RUN: dict[Case, Expect] = {
    Case.MEMBER: ADMIT,
    Case.WRONG_SUBJECT: DENY_SSO_NEEDS_EE,
    Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
    Case.NON_MEMBER: DENY_NON_MEMBER,
    Case.NON_MEMBER_AND_INSUFFICIENT_SCOPE: DENY_NON_MEMBER,
    Case.LOW_ROLE: ADMIT,
    Case.APP_API_DISABLED: DENY_API_DISABLED,
    Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
    Case.FOREIGN_WORKSPACE_QUERY: ADMIT,
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
    Case.RBAC_ON_LOW_ROLE: ADMIT_NO_WORKSPACE_ROLE,
}


_ACCOUNT_READER_APP: dict[Case, Expect] = {
    Case.MEMBER: ADMIT,
    Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
    Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
    Case.NON_MEMBER: DENY_NON_MEMBER,
    Case.NON_MEMBER_AND_INSUFFICIENT_SCOPE: DENY_NON_MEMBER,
    Case.LOW_ROLE: ADMIT,
    Case.APP_API_DISABLED: DENY_API_DISABLED,
    Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
    Case.FOREIGN_WORKSPACE_QUERY: ADMIT,
    Case.EE_ACCOUNT_PUBLIC: ADMIT,
    Case.EE_ACCOUNT_SSO_VERIFIED: ADMIT,
    Case.EE_ACCOUNT_PRIVATE_ALL: ADMIT,
    Case.EE_ACCOUNT_PRIVATE_PERMITTED: ADMIT,
    Case.EE_ACCOUNT_PRIVATE_REFUSED: ADMIT,
    Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: ADMIT,
    Case.EE_ACCOUNT_MODE_UNRESOLVED: ADMIT,
    Case.RBAC_ON_DENIED: DENY_RBAC,
    Case.RBAC_ON_LOW_ROLE: ADMIT_NO_WORKSPACE_ROLE,
}

_ACCOUNT_EDITOR_APP: dict[Case, Expect] = {
    **_ACCOUNT_READER_APP,
    Case.LOW_ROLE: DENY_ROLE,
    Case.RBAC_ON_LOW_ROLE: ADMIT,
}

_ACCOUNT_READER_SETTINGS: dict[Case, Expect] = {**_ACCOUNT_READER_APP, Case.APP_API_DISABLED: ADMIT}
_ACCOUNT_EDITOR_SETTINGS: dict[Case, Expect] = {**_ACCOUNT_EDITOR_APP, Case.APP_API_DISABLED: ADMIT}

DENY_NEEDS_WEBAPP_EE = Expect(403, WebAppAccessRequiresEE.description)

_WEBAPP_ACCESS_EDITOR: dict[Case, Expect] = {
    **_ACCOUNT_EDITOR_SETTINGS,
    Case.MEMBER: DENY_NEEDS_WEBAPP_EE,
    Case.APP_API_DISABLED: DENY_NEEDS_WEBAPP_EE,
    Case.FOREIGN_WORKSPACE_QUERY: DENY_NEEDS_WEBAPP_EE,
    Case.EE_ACCOUNT_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_NEEDS_WEBAPP_EE,
    Case.RBAC_ON_LOW_ROLE: DENY_NEEDS_WEBAPP_EE,
}


_ANY_BEARER: dict[Case, Expect] = {
    **{case: ADMIT for case in Case if CASE_REQUIRES[case] <= {Trait.ACCOUNT_PRIMARY, Trait.EXTERNAL_REACHABLE}},
    Case.WRONG_SUBJECT: DENY_SSO_NEEDS_EE,
}
"""A route with no requirements admits every case that carries a valid bearer. The one
exception is the router's own answer: an external-SSO bearer is refused outside enterprise."""

MATRIX: dict[str, dict[Case, Expect]] = {
    "describe.account": dict(_ACCOUNT_ONLY_NO_WORKSPACE),
    "workspaces.list": dict(_ACCOUNT_ONLY_NO_WORKSPACE),
    "apps.list": dict(_ACCOUNT_MEMBER_NO_ROLE),
    "workspaces.switch": dict(_ACCOUNT_MEMBER_NO_ROLE),
    # invite/remove check WORKSPACE_MEMBER_MANAGE; update_role checks WORKSPACE_ROLE_MANAGE
    # (matches check_member_permission's own add/remove vs update split)
    "workspaces.members.invite": dict(_ACCOUNT_MEMBER_WITH_ROLE),
    "workspaces.members.update_role": dict(_ACCOUNT_MEMBER_WITH_ROLE),
    "plugins.install": {**_ACCOUNT_MEMBER_NO_ROLE, Case.RBAC_ON_DENIED: DENY_RBAC},
    "model_providers.credential.create": dict(_ACCOUNT_MEMBER_WITH_ROLE),
    "app_dsl.import": dict(_ACCOUNT_MEMBER_WITH_ROLE),
    "app_dsl.check": dict(_ACCOUNT_MEMBER_WITH_ROLE),
    "app_create.workflow": dict(_ACCOUNT_MEMBER_WITH_ROLE),
    "node_types.list": dict(_ANY_BEARER),
    "app_workflow.node_run.workflow": dict(_ACCOUNT_EDITOR_APP),
    "app_info.describe.workflow": dict(_ACCOUNT_READER_SETTINGS),
    "app_info.set.workflow": dict(_ACCOUNT_EDITOR_SETTINGS),
    "service_api.describe": dict(_ACCOUNT_EDITOR_SETTINGS),
    "service_api.set": dict(_ACCOUNT_EDITOR_SETTINGS),
    "webapp.describe.workflow": dict(_ACCOUNT_READER_SETTINGS),
    "webapp.set.workflow": dict(_ACCOUNT_EDITOR_SETTINGS),
    "webapp.reset": dict(_ACCOUNT_EDITOR_SETTINGS),
    "webapp_access.describe": dict(_WEBAPP_ACCESS_EDITOR),
    "apps.describe": dict(_ACCOUNT_READER_APP),
    "app_dsl.export": dict(_ACCOUNT_EDITOR_APP),
    "app_run.draft.workflow": dict(_ACCOUNT_EDITOR_APP),
    "app_run.draft.advanced_chat": dict(_ACCOUNT_EDITOR_APP),
    "app_workflow.run.list": dict(_ACCOUNT_READER_APP),
    "app_workflow.run.describe": dict(_ACCOUNT_READER_APP),
    "app_workflow.run.nodes": dict(_ACCOUNT_READER_APP),
    "app_workflow.publish": dict(_ACCOUNT_EDITOR_APP),
    "app_workflow.version.list": dict(_ACCOUNT_EDITOR_APP),
    "app_workflow.version.restore": dict(_ACCOUNT_EDITOR_APP),
    "app_workflow.release_check": dict(_ACCOUNT_EDITOR_APP),
    "app_workflow.env.list": dict(_ACCOUNT_EDITOR_APP),
    "app_workflow.env.set": dict(_ACCOUNT_EDITOR_APP),
    "app_workflow.env.delete": dict(_ACCOUNT_EDITOR_APP),
    "app_run.workflow": dict(_DUAL_SUBJECT_RUN),
    "app_run.chat": dict(_DUAL_SUBJECT_RUN),
    "app_run.advanced_chat": dict(_DUAL_SUBJECT_RUN),
    "app_run.completion": dict(_DUAL_SUBJECT_RUN),
    "human_input_form.get": dict(_DUAL_SUBJECT_RUN),
    "files.upload": {
        **_DUAL_SUBJECT_RUN,
        Case.RBAC_ON_DENIED: ADMIT_NO_RBAC_PERMISSION,
    },
    "permitted_external.list": {
        Case.MEMBER: ADMIT_NO_MOUNT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        # An account bearer answers on the subject axis here, before scope or
        # membership: this route's CheckSubject allows only ExternalSsoSubject.
        Case.NON_MEMBER_AND_INSUFFICIENT_SCOPE: DENY_WRONG_SUBJECT,
        Case.EDITION_NOT_ENTERPRISE: DENY_EDITION,
    },
    "permitted_external.describe": {
        Case.MEMBER: ADMIT,
        Case.WRONG_SUBJECT: DENY_WRONG_SUBJECT,
        Case.INSUFFICIENT_SCOPE: DENY_SCOPE,
        Case.NON_MEMBER_AND_INSUFFICIENT_SCOPE: DENY_WRONG_SUBJECT,
        Case.EDITION_NOT_ENTERPRISE: DENY_EDITION,
        Case.APP_API_DISABLED: DENY_API_DISABLED,
        Case.UNKNOWN_APP: DENY_UNKNOWN_APP,
        Case.FOREIGN_WORKSPACE_QUERY: Expect(
            ADMITTED,
            note="a foreign ?workspace_id= is ignored on every app-scoped route (spec 2.9)",
        ),
        Case.EE_EXTERNAL_PUBLIC: ADMIT,
        Case.EE_EXTERNAL_SSO_VERIFIED: ADMIT,
        Case.EE_EXTERNAL_PRIVATE_ALL: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE: DENY_ACCESS_MODE,
        Case.EE_EXTERNAL_PRIVATE_REFUSED_WEBAPP_AUTH_OFF: DENY_PRIVATE_APP,
        Case.EE_EXTERNAL_MODE_UNRESOLVED: DENY_MODE_UNRESOLVED,
    },
}
"""One representative per distinct declared requirement tuple; `DECLARED` pins the rest."""


_ACCOUNT = (AccountSubject,)
_ACCOUNT_OR_EXTERNAL = (AccountSubject, ExternalSsoSubject)
_OWNER_ADMIN = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})
_EDITOR_UP = frozenset({TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER})

_REQ_ACCOUNT_FULL = (CheckSubject(allowed=_ACCOUNT), CheckScope(Scope.FULL))
_REQ_ACCOUNT_WORKSPACE_READ = (CheckSubject(allowed=_ACCOUNT), CheckScope(Scope.WORKSPACE_READ))
_REQ_ACCOUNT_APPS_READ_MEMBER = (
    CheckSubject(allowed=_ACCOUNT),
    CheckScope(Scope.APPS_READ),
    CheckWorkspaceMember(),
)
_REQ_ACCOUNT_WORKSPACE_READ_MEMBER = (
    CheckSubject(allowed=_ACCOUNT),
    CheckScope(Scope.WORKSPACE_READ),
    CheckWorkspaceMember(),
)
_REQ_MEMBER_MANAGE = (
    CheckSubject(allowed=_ACCOUNT),
    CheckScope(Scope.WORKSPACE_WRITE),
    CheckWorkspaceMember(),
    CheckRBACPermission(RBACCheck(RBACPermission.WORKSPACE_MEMBER_MANAGE, Workspace())),
    CheckWorkspaceRole(_OWNER_ADMIN),
)
_REQ_ROLE_MANAGE = (
    CheckSubject(allowed=_ACCOUNT),
    CheckScope(Scope.WORKSPACE_WRITE),
    CheckWorkspaceMember(),
    CheckRBACPermission(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())),
    CheckWorkspaceRole(_OWNER_ADMIN),
)
_REQ_DSL_WORKSPACE = (
    CheckSubject(allowed=_ACCOUNT),
    CheckScope(Scope.WORKSPACE_WRITE),
    CheckWorkspaceMember(),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_IMPORT_EXPORT_DSL, Workspace())),
    CheckWorkspaceRole(_EDITOR_UP),
)
_REQ_DSL_APP = (
    CheckSubject(allowed=_ACCOUNT),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_READ),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_IMPORT_EXPORT_DSL, PlainApp())),
    CheckWorkspaceRole(_EDITOR_UP),
)
_REQ_APP_DESCRIBE = (
    CheckSubject(allowed=_ACCOUNT),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_READ),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())),
)
_REQ_RUN = (
    CheckSubject(allowed=_ACCOUNT_OR_EXTERNAL),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_RUN),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp())),
    CheckAppAccess(),
)
_REQ_RUN_FORM = (*_REQ_RUN, CheckFormSurface())
_REQ_RELEASE = (
    CheckSubject(allowed=_ACCOUNT),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.WORKSPACE_WRITE),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp())),
    CheckWorkspaceRole(_EDITOR_UP),
)
_REQ_VERSION_READ = (
    CheckSubject(allowed=_ACCOUNT),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_READ),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())),
    CheckWorkspaceRole(_EDITOR_UP),
)
_REQ_ENV_WRITE = (
    CheckSubject(allowed=_ACCOUNT),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.WORKSPACE_WRITE),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_EDIT, PlainApp())),
    CheckWorkspaceRole(_EDITOR_UP),
)
_REQ_RUN_HISTORY = (
    CheckSubject(allowed=_ACCOUNT),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_READ),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_CREATE_AND_MANAGEMENT, PlainApp())),
)
_REQ_DRAFT_RUN = (
    CheckSubject(allowed=_ACCOUNT),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_RUN),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp())),
    CheckWorkspaceRole(_EDITOR_UP),
)
_REQ_NODE_TYPES: tuple[Requirement, ...] = ()
_REQ_APP_CREATE = (
    CheckSubject(allowed=_ACCOUNT),
    CheckScope(Scope.WORKSPACE_WRITE),
    CheckWorkspaceMember(),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_CREATE_AND_MANAGEMENT, Workspace())),
    CheckWorkspaceRole(_EDITOR_UP),
    CheckAppQuota(),
)
_REQ_FILES = (
    CheckSubject(allowed=_ACCOUNT_OR_EXTERNAL),
    CheckAppApiEnabled(),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_RUN),
    CheckAppAccess(),
)
_REQ_EXTERNAL_LIST = (
    CheckSubject(allowed=(ExternalSsoSubject,)),
    CheckScope(Scope.APPS_READ_PERMITTED_EXTERNAL),
)
_REQ_EXTERNAL_DESCRIBE = (
    CheckSubject(allowed=(ExternalSsoSubject,)),
    CheckAppApiEnabled(),
    CheckScope(Scope.APPS_READ_PERMITTED_EXTERNAL),
    CheckAppAccess(),
)


def _req_plugin_write(permission: RBACPermission) -> tuple[Requirement, ...]:
    return (
        CheckSubject(allowed=_ACCOUNT),
        CheckScope(Scope.WORKSPACE_WRITE),
        CheckWorkspaceMember(),
        CheckRBACPermission(RBACCheck(permission, Workspace())),
        CheckPluginInstallSetting(),
    )


def _req_admin_write(permission: RBACPermission) -> tuple[Requirement, ...]:
    return (
        CheckSubject(allowed=_ACCOUNT),
        CheckScope(Scope.WORKSPACE_WRITE),
        CheckWorkspaceMember(),
        CheckRBACPermission(RBACCheck(permission, Workspace())),
        CheckWorkspaceRole(_OWNER_ADMIN),
    )


_REQ_PLUGIN_TASK = (
    CheckSubject(allowed=_ACCOUNT),
    CheckScope(Scope.WORKSPACE_READ),
    CheckWorkspaceMember(),
    CheckPluginInstallSetting(),
)


def _settings_req(
    modes: tuple[AppMode, ...],
    perm: RBACPermission,
    locator: PlainApp | AgentBehindApp,
    scope: Scope,
    roles: frozenset[TenantAccountRole] | None,
) -> tuple[Requirement, ...]:
    base: tuple[Requirement, ...] = (
        CheckSubject(allowed=_ACCOUNT),
        CheckWorkspaceMember(),
        CheckAppMode(*modes),
        CheckScope(scope),
        CheckRBACPermission(RBACCheck(perm, locator)),
    )
    return (*base, CheckWorkspaceRole(roles)) if roles is not None else base


DECLARED: dict[str, tuple[Requirement, ...]] = {
    "describe.account": _REQ_ACCOUNT_FULL,
    "account.sessions.revoke_self": _REQ_ACCOUNT_FULL,
    "get.account.session": _REQ_ACCOUNT_FULL,
    "account.sessions.revoke_one": _REQ_ACCOUNT_FULL,
    "apps.describe": _REQ_APP_DESCRIBE,
    "apps.list": _REQ_ACCOUNT_APPS_READ_MEMBER,
    "workspaces.list": _REQ_ACCOUNT_WORKSPACE_READ,
    "workspaces.describe": _REQ_ACCOUNT_WORKSPACE_READ,
    "workspaces.switch": _REQ_ACCOUNT_WORKSPACE_READ_MEMBER,
    "workspaces.members.list": _REQ_ACCOUNT_WORKSPACE_READ_MEMBER,
    "workspaces.members.invite": (*_REQ_MEMBER_MANAGE, CheckWorkspaceInvitationQuota()),
    "workspaces.members.remove": _REQ_MEMBER_MANAGE,
    "workspaces.members.update_role": _REQ_ROLE_MANAGE,
    "plugins.marketplace": _REQ_ACCOUNT_WORKSPACE_READ_MEMBER,
    "plugins.list": _REQ_ACCOUNT_WORKSPACE_READ_MEMBER,
    "plugins.install": _req_plugin_write(RBACPermission.PLUGIN_INSTALL),
    "plugins.task": _REQ_PLUGIN_TASK,
    "plugins.delete": _req_plugin_write(RBACPermission.PLUGIN_DELETE),
    "model_providers.describe": _REQ_ACCOUNT_WORKSPACE_READ_MEMBER,
    "model_providers.credential.create": _req_admin_write(RBACPermission.CREDENTIAL_CREATE),
    "model_providers.credential.set": _req_admin_write(RBACPermission.CREDENTIAL_MANAGE),
    "tools.list": _REQ_ACCOUNT_WORKSPACE_READ_MEMBER,
    "tool_providers.describe": _REQ_ACCOUNT_WORKSPACE_READ_MEMBER,
    "tool_providers.credential.create": _req_admin_write(RBACPermission.CREDENTIAL_CREATE),
    "tool_providers.credential.set": _req_admin_write(RBACPermission.CREDENTIAL_MANAGE),
    "knowledge_bases.list": _REQ_ACCOUNT_WORKSPACE_READ_MEMBER,
    "models.list": _REQ_ACCOUNT_WORKSPACE_READ_MEMBER,
    "models.credential.create": _req_admin_write(RBACPermission.CREDENTIAL_CREATE),
    "models.credential.set": _req_admin_write(RBACPermission.CREDENTIAL_MANAGE),
    "app_dsl.import": _REQ_DSL_WORKSPACE,
    "app_dsl.check": _REQ_DSL_WORKSPACE,
    "app_dsl.import_confirm": _REQ_DSL_WORKSPACE,
    "app_dsl.export": _REQ_DSL_APP,
    "app_dsl.check_dependencies": _REQ_DSL_APP,
    "app_run.workflow": _REQ_RUN,
    "app_run.chat": _REQ_RUN,
    "app_run.advanced_chat": _REQ_RUN,
    "app_run.completion": _REQ_RUN,
    "app_run.draft.workflow": _REQ_DRAFT_RUN,
    "app_run.draft.advanced_chat": _REQ_DRAFT_RUN,
    "app_workflow.run.list": _REQ_RUN_HISTORY,
    "app_workflow.run.describe": _REQ_RUN_HISTORY,
    "app_workflow.run.nodes": _REQ_RUN_HISTORY,
    "app_workflow.publish": _REQ_RELEASE,
    "app_workflow.version.list": _REQ_VERSION_READ,
    "app_workflow.version.restore": _REQ_RELEASE,
    "app_workflow.release_check": _REQ_VERSION_READ,
    "app_workflow.env.list": _REQ_VERSION_READ,
    "app_workflow.env.set": _REQ_ENV_WRITE,
    "app_workflow.env.delete": _REQ_ENV_WRITE,
    "node_types.list": _REQ_NODE_TYPES,
    "node_types.describe": _REQ_NODE_TYPES,
    "app_create.workflow": _REQ_APP_CREATE,
    "app_create.advanced_chat": _REQ_APP_CREATE,
    "app_workflow.node_run.workflow": (*_REQ_DRAFT_RUN, CheckAppMode(AppMode.WORKFLOW)),
    "app_workflow.node_run.advanced_chat": (*_REQ_DRAFT_RUN, CheckAppMode(AppMode.ADVANCED_CHAT)),
    "app_info.describe.workflow": _settings_req(
        (AppMode.WORKFLOW,), RBACPermission.APP_VIEW_LAYOUT, PlainApp(), Scope.APPS_READ, None
    ),
    "app_info.set.workflow": _settings_req(
        (AppMode.WORKFLOW,), RBACPermission.APP_EDIT, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "service_api.describe": _settings_req(
        REGULAR_MODES, RBACPermission.APP_RELEASE_AND_VERSION, PlainApp(), Scope.APPS_READ, _EDITOR_UP
    ),
    "service_api.set": _settings_req(
        REGULAR_MODES, RBACPermission.APP_RELEASE_AND_VERSION, PlainApp(), Scope.WORKSPACE_WRITE, _OWNER_ADMIN
    ),
    "app_info.describe.advanced_chat": _settings_req(
        (AppMode.ADVANCED_CHAT,), RBACPermission.APP_VIEW_LAYOUT, PlainApp(), Scope.APPS_READ, None
    ),
    "app_info.set.advanced_chat": _settings_req(
        (AppMode.ADVANCED_CHAT,), RBACPermission.APP_EDIT, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "app_info.describe.chat": _settings_req(
        (AppMode.CHAT,), RBACPermission.APP_VIEW_LAYOUT, PlainApp(), Scope.APPS_READ, None
    ),
    "app_info.set.chat": _settings_req(
        (AppMode.CHAT,), RBACPermission.APP_EDIT, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "app_info.describe.agent_chat": _settings_req(
        (AppMode.AGENT_CHAT,), RBACPermission.APP_VIEW_LAYOUT, PlainApp(), Scope.APPS_READ, None
    ),
    "app_info.set.agent_chat": _settings_req(
        (AppMode.AGENT_CHAT,), RBACPermission.APP_EDIT, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "app_info.describe.completion": _settings_req(
        (AppMode.COMPLETION,), RBACPermission.APP_VIEW_LAYOUT, PlainApp(), Scope.APPS_READ, None
    ),
    "app_info.set.completion": _settings_req(
        (AppMode.COMPLETION,), RBACPermission.APP_EDIT, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "app_info.describe.agent": _settings_req(
        (AppMode.AGENT,), RBACPermission.AGENT_PREVIEW, AgentBehindApp(), Scope.APPS_READ, None
    ),
    "app_info.set.agent": _settings_req(
        (AppMode.AGENT,), RBACPermission.AGENT_EDIT, AgentBehindApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "service_api.describe.agent": _settings_req(
        (AppMode.AGENT,), RBACPermission.AGENT_ACCESS_POINT_VIEW, AgentBehindApp(), Scope.APPS_READ, _EDITOR_UP
    ),
    "service_api.set.agent": _settings_req(
        (AppMode.AGENT,),
        RBACPermission.AGENT_ACCESS_POINT_MANAGE,
        AgentBehindApp(),
        Scope.WORKSPACE_WRITE,
        _OWNER_ADMIN,
    ),
    "webapp.describe.workflow": _settings_req(
        (AppMode.WORKFLOW,), RBACPermission.APP_VIEW_LAYOUT, PlainApp(), Scope.APPS_READ, None
    ),
    "webapp.set.workflow": _settings_req(
        (AppMode.WORKFLOW,), RBACPermission.APP_RELEASE_AND_VERSION, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "webapp.reset": _settings_req(
        REGULAR_MODES, RBACPermission.APP_RELEASE_AND_VERSION, PlainApp(), Scope.WORKSPACE_WRITE, _OWNER_ADMIN
    ),
    "webapp_access.describe": (
        *_settings_req(REGULAR_MODES, RBACPermission.APP_ACCESS_CONFIG, PlainApp(), Scope.APPS_READ, _EDITOR_UP),
        CheckWebAppAuthEnterprise(),
    ),
    "webapp_access.set": (
        *_settings_req(REGULAR_MODES, RBACPermission.APP_ACCESS_CONFIG, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP),
        CheckWebAppAuthEnterprise(),
    ),
    "webapp.describe.advanced_chat": _settings_req(
        (AppMode.ADVANCED_CHAT,), RBACPermission.APP_VIEW_LAYOUT, PlainApp(), Scope.APPS_READ, None
    ),
    "webapp.set.advanced_chat": _settings_req(
        (AppMode.ADVANCED_CHAT,), RBACPermission.APP_RELEASE_AND_VERSION, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "webapp.describe.chat": _settings_req(
        (AppMode.CHAT,), RBACPermission.APP_VIEW_LAYOUT, PlainApp(), Scope.APPS_READ, None
    ),
    "webapp.set.chat": _settings_req(
        (AppMode.CHAT,), RBACPermission.APP_RELEASE_AND_VERSION, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "webapp.describe.agent_chat": _settings_req(
        (AppMode.AGENT_CHAT,), RBACPermission.APP_VIEW_LAYOUT, PlainApp(), Scope.APPS_READ, None
    ),
    "webapp.set.agent_chat": _settings_req(
        (AppMode.AGENT_CHAT,), RBACPermission.APP_RELEASE_AND_VERSION, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "webapp.describe.completion": _settings_req(
        (AppMode.COMPLETION,), RBACPermission.APP_VIEW_LAYOUT, PlainApp(), Scope.APPS_READ, None
    ),
    "webapp.set.completion": _settings_req(
        (AppMode.COMPLETION,), RBACPermission.APP_RELEASE_AND_VERSION, PlainApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "webapp.describe.agent": _settings_req(
        (AppMode.AGENT,), RBACPermission.AGENT_ACCESS_POINT_VIEW, AgentBehindApp(), Scope.APPS_READ, None
    ),
    "webapp.set.agent": _settings_req(
        (AppMode.AGENT,), RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentBehindApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
    ),
    "webapp.reset.agent": _settings_req(
        (AppMode.AGENT,),
        RBACPermission.AGENT_ACCESS_POINT_MANAGE,
        AgentBehindApp(),
        Scope.WORKSPACE_WRITE,
        _OWNER_ADMIN,
    ),
    "webapp_access.describe.agent": (
        *_settings_req(
            (AppMode.AGENT,), RBACPermission.AGENT_ACCESS_CONFIG, AgentBehindApp(), Scope.APPS_READ, _EDITOR_UP
        ),
        CheckWebAppAuthEnterprise(),
    ),
    "webapp_access.set.agent": (
        *_settings_req(
            (AppMode.AGENT,), RBACPermission.AGENT_ACCESS_CONFIG, AgentBehindApp(), Scope.WORKSPACE_WRITE, _EDITOR_UP
        ),
        CheckWebAppAuthEnterprise(),
    ),
    "app_run.stop": _REQ_RUN,
    "files.upload": _REQ_FILES,
    "human_input_form.get": _REQ_RUN_FORM,
    "human_input_form.submit": _REQ_RUN_FORM,
    "workflow_events.stream": _REQ_RUN,
    "permitted_external.list": _REQ_EXTERNAL_LIST,
    "permitted_external.describe": _REQ_EXTERNAL_DESCRIBE,
}
"""Every route's `@endpoint(requirements=...)`, in declared order. A route that
shares a tuple with a `MATRIX` representative is covered by that representative's
rows only while this table says it still declares the same tuple."""


ROUTES_BY_ID = {route.id: route for route in ROUTES}


def _applicable(route: Route, case: Case) -> bool:
    return CASE_REQUIRES[case] <= route.traits


def _rows(route: Route) -> Iterator[tuple[Route, Case, Expect]]:
    for case in Case:
        if not _applicable(route, case):
            continue
        if case not in ROUTER_CASES:
            yield route, case, MATRIX[route.id][case]
        elif route.id == ROUTER_CASE_ROUTE:
            yield route, case, ROUTER_CASES[case]


ROWS: tuple[tuple[Route, Case, Expect], ...] = tuple(
    row for route in ROUTES if route.id in MATRIX for row in _rows(route)
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
    session_ids: dict[Bearer, str] = field(default_factory=dict)


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


def _authenticator(rows: dict[str, ResolvedRow]) -> BearerAuthenticator:
    resolver = _MemoryResolver(rows)
    return BearerAuthenticator({TokenType.OAUTH_ACCOUNT: resolver, TokenType.OAUTH_EXTERNAL_SSO: resolver})


@pytest.fixture
def token_rows() -> dict[str, ResolvedRow]:
    return {}


@pytest.fixture(scope="module")
def _matrix_app() -> Flask:
    """Register the matrix's unchanging routes once; each case gets a fresh client."""
    app = create_flask_app_with_configs()
    app.config["TESTING"] = True
    app.secret_key = "openapi-auth-matrix"
    LoginManager(app)
    app.register_blueprint(openapi_bp)
    return app


@pytest.fixture
def matrix_app(_matrix_app: Flask, monkeypatch: pytest.MonkeyPatch) -> Iterator[Flask]:
    """Keep rate-limit overrides and the admission probe scoped to each case."""

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
        yield _matrix_app
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

    rows: list[object] = [
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

    def mint(bearer: Bearer, prefix: str, *, account_id: str | None, email: str) -> None:
        """Register a bearer with the fake resolver *and* persist the session row it
        names, so the access service's ownership check has something real to match against.
        """
        raw = prefix + uuid.uuid4().hex
        token_id = uuid.uuid4()
        issuer = "dify:account" if account_id else "https://idp.example"
        token_rows[sha256_hex(raw)] = ResolvedRow(
            subject_email=email,
            subject_issuer=issuer,
            account_id=uuid.UUID(account_id) if account_id else None,
            client_id="difyctl",
            token_id=token_id,
            expires_at=None,
        )
        row = OAuthAccessToken(
            token_hash=sha256_hex(raw),
            prefix=prefix,
            account_id=account_id,
            subject_email=email,
            subject_issuer=issuer,
            client_id="difyctl",
            device_label="matrix",
            expires_at=datetime.now(UTC) + timedelta(days=365),
        )
        row.id = str(token_id)
        rows.append(row)
        built.tokens[bearer] = raw
        built.session_ids[bearer] = str(token_id)

    mint(
        Bearer.ACCOUNT_MEMBER,
        TokenType.OAUTH_ACCOUNT.prefix,
        account_id=built.member_account_id,
        email="owner@example.com",
    )
    mint(
        Bearer.ACCOUNT_LOW_ROLE,
        TokenType.OAUTH_ACCOUNT.prefix,
        account_id=built.low_role_account_id,
        email="normal@example.com",
    )
    mint(
        Bearer.ACCOUNT_OUTSIDER,
        TokenType.OAUTH_ACCOUNT.prefix,
        account_id=built.outsider_account_id,
        email="outsider@example.com",
    )
    mint(Bearer.EXTERNAL, TokenType.OAUTH_EXTERNAL_SSO.prefix, account_id=None, email="external@example.com")
    with sqlite_session_factory.begin() as session:
        session.add_all(rows)
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


def _url(route: Route, world: World, scenario: Scenario, bearer: Bearer | None) -> str:
    if scenario.unknown_app:
        app_id = str(uuid.uuid4())
    elif not scenario.app_api_enabled:
        app_id = world.disabled_app_id
    else:
        app_id = world.app_id
    ids = {
        "app_id": app_id,
        "workspace_id": world.workspace_id,
        # The caller's own session: the access service 404s any other id.
        "session_id": world.session_ids.get(bearer, str(uuid.uuid4())) if bearer else str(uuid.uuid4()),
        "member_id": str(uuid.uuid4()),
        "import_id": str(uuid.uuid4()),
        "task_id": str(uuid.uuid4()),
        "form_token": uuid.uuid4().hex,
        "run_id": str(uuid.uuid4()),
        "version_id": str(uuid.uuid4()),
        "env_id": str(uuid.uuid4()),
        "node_type": "llm",
        "node_id": "node-1",
        "plugin_id": "langgenius/openai",
        "provider": "langgenius/openai/openai",
        "credential_id": str(uuid.uuid4()),
        "model_type": "llm",
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

    edition = scenario.edition or (
        DeploymentEdition.ENTERPRISE if Trait.ENTERPRISE_ONLY in route.traits else DeploymentEdition.COMMUNITY
    )
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=edition, RBAC_ENABLED=scenario.rbac_enabled)
    monkeypatch.setattr(oauth_bearer_module, "_authenticator", _authenticator(token_rows))
    if scenario.narrow_scopes:
        # No shipped token can fail `CheckScope`: `dfoa_` carries `Scope.FULL` and
        # `dfoe_` exactly the scopes its routes ask for. Scopes are a constant of
        # the subject, so the only way to reach the refusal is to blank them here.
        # Keep these rows: they are what catches a third token kind routed
        # somewhere it was not scoped for.
        monkeypatch.setattr(oauth_bearer_module.AuthContext, "scopes", property(lambda _self: frozenset()))

    features = _system_features(
        edition=edition, webapp_auth=scenario.webapp_auth, license_status=scenario.license_status
    )
    settings = _access_mode_settings(scenario.access_mode)

    headers: dict[str, str] = {CATALOG_HEADER: catalog_for(app)[1]}
    bearer = _bearer_for(route, scenario)
    if bearer is not None:
        headers["Authorization"] = f"Bearer {world.tokens[bearer]}"

    with ExitStack() as stack:
        stack.enter_context(patch.object(SystemFeatureService, "get_public_system_features", return_value=features))
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
        services = subjects.application_services()
        stack.enter_context(
            patch.object(
                services.app_scoped_end_users.commands,
                "get_or_create_end_user_by_type",
                side_effect=_end_user,
            )
        )
        stack.enter_context(patch.object(RBACResourceService, "get_app_agent_binding", return_value=None))
        stack.enter_context(patch.object(RBACResourceService, "get_app_maintainer", return_value=None))
        stack.enter_context(
            patch(
                "services.enterprise.rbac_service.RBACService.CheckAccess.check",
                return_value=scenario.rbac_allows,
            )
        )
        stack.enter_context(
            patch.object(
                services.accounts.identity,
                "get_account_by_email",
                return_value=_webapp_account(),
            )
        )
        client = app.test_client()
        return contextvars.copy_context().run(
            lambda: client.open(_url(route, world, scenario, bearer), method=route.method, headers=headers)
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


_PATH_PARAMS: Final = frozenset({"plugin_id", "provider"})


def _rule_path(route: Route) -> str:
    path = route.path
    for name in _PATH_PARAMS:
        path = path.replace(f"{{{name}}}", f"<path:{name}>")
    return "/openapi/v1" + path.replace("{", "<string:").replace("}", ">")


def _endpoint_spec(app: Flask, rule: Rule, method: str) -> EndpointSpec | None:
    """The `EndpointSpec` `@endpoint` attached to this rule's handler, or None.

    Carrying a spec *is* being guarded: `@endpoint` is the only thing that sets
    it, and it sets it on the same object it wraps in `subject_router.guard`.
    """
    view = app.view_functions.get(rule.endpoint)
    resource = view.view_class if hasattr(view, "view_class") else None
    if resource is None:
        return None
    handler = getattr(resource, method.lower(), None)  # guard-ignore: no-new-getattr -- HTTP verb selects the handler
    return handler.__spec__ if hasattr(handler, "__spec__") else None


def test_registered_openapi_routes_match_the_matrix(matrix_app: Flask) -> None:
    """Every guarded /openapi/v1 route is in the table, and nothing else is.

    Guarded-ness is derived from `view.__spec__`, not from a hand-kept list of
    exemptions — so a route that gains a guard without gaining a row fails here,
    and so does a guarded route that quietly stops carrying a spec. Neither can
    be silenced by editing this file.
    """
    guarded: set[tuple[str, str]] = set()
    unguarded: set[tuple[str, str]] = set()
    for rule in matrix_app.url_map.iter_rules():
        if not str(rule).startswith("/openapi/v1") or str(rule) == "/openapi/v1/":
            continue
        for method in rule.methods or set():
            if method in {"HEAD", "OPTIONS"}:
                continue
            entry = (method, str(rule))
            target = guarded if _endpoint_spec(matrix_app, rule, method) is not None else unguarded
            target.add(entry)

    expected = {(route.method, _rule_path(route)) for route in ROUTES}
    assert guarded == expected
    # The remainder is the device-flow, documentation and catalog surface. Its size is
    # pinned rather than enumerated: a list of exemptions rots silently — the one this
    # replaced still named `swagger.json`, a route that is not registered at all.
    assert len(unguarded) == 14


@singledispatch
def _config(_requirement: Requirement) -> object:
    return None


@_config.register
def _(requirement: CheckSubject) -> object:
    return requirement.allowed


@_config.register
def _(requirement: CheckAppMode) -> object:
    return requirement.modes


@_config.register
def _(requirement: CheckScope) -> object:
    return requirement.scope


@_config.register
def _(requirement: CheckRBACPermission) -> object:
    return tuple((check.scene, repr(check.locator)) for check in requirement.checks)


@_config.register
def _(requirement: CheckWorkspaceRole) -> object:
    return requirement.allowed_roles


def _canonical(requirement: Requirement) -> tuple[type[Requirement], object]:
    """`Requirement` has no `__eq__`, so compare by type plus the config that sets it apart."""
    return type(requirement), _config(requirement)


def _spec_for(app: Flask, route: Route) -> EndpointSpec | None:
    for rule in app.url_map.iter_rules():
        if str(rule) == _rule_path(route) and route.method in (rule.methods or set()):
            return _endpoint_spec(app, rule, route.method)
    return None


@pytest.mark.parametrize("route", ROUTES, ids=[route.id for route in ROUTES])
def test_route_declares_expected_requirements(route: Route, matrix_app: Flask) -> None:
    """The guard that lets `MATRIX` run one representative per tuple: a route
    that drifts from the tuple its representative was chosen for fails here.
    """
    spec = _spec_for(matrix_app, route)
    assert spec is not None, route.id
    assert [*map(_canonical, spec.requirements)] == [*map(_canonical, DECLARED[route.id])]


ERROR_DEFAULT_RESPONSE: dict[str, object] = {
    "description": "Error",
    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorBody"}}},
}
"""Exactly what `@returns` registers as `("default", "Error", ErrorBody)`."""

EXPECTED_RESPONSE_CODES: dict[tuple[str, str], frozenset[str]] = {
    ("get", "/_catalog"): frozenset({"200"}),
    ("get", "/workspaces/{workspace_id}/marketplace/plugins"): frozenset({"200", "422", "default"}),
    ("get", "/workspaces/{workspace_id}/plugins"): frozenset({"200", "422", "default"}),
    ("post", "/workspaces/{workspace_id}/plugins:install"): frozenset({"200", "422", "default"}),
    ("get", "/workspaces/{workspace_id}/plugin-tasks/{task_id}"): frozenset({"200", "default"}),
    ("delete", "/workspaces/{workspace_id}/plugins/{plugin_id}"): frozenset({"200", "default"}),
    ("get", "/workspaces/{workspace_id}/tools"): frozenset({"200", "422", "default"}),
    ("get", "/workspaces/{workspace_id}/tool-providers/{provider}"): frozenset({"200", "default"}),
    ("post", "/workspaces/{workspace_id}/tool-providers/{provider}/credentials"): frozenset({"201", "422", "default"}),
    ("patch", "/workspaces/{workspace_id}/tool-providers/{provider}/credentials/{credential_id}"): frozenset(
        {"200", "422", "default"}
    ),
    ("get", "/workspaces/{workspace_id}/model-providers/{provider}"): frozenset({"200", "default"}),
    ("post", "/workspaces/{workspace_id}/model-providers/{provider}/credentials"): frozenset({"201", "422", "default"}),
    ("patch", "/workspaces/{workspace_id}/model-providers/{provider}/credentials/{credential_id}"): frozenset(
        {"200", "422", "default"}
    ),
    ("get", "/workspaces/{workspace_id}/knowledge-bases"): frozenset({"200", "422", "default"}),
    ("get", "/workspaces/{workspace_id}/models"): frozenset({"200", "422", "default"}),
    ("post", "/workspaces/{workspace_id}/model-providers/{provider}/models/credentials"): frozenset(
        {"201", "422", "default"}
    ),
    ("patch", "/workspaces/{workspace_id}/model-providers/{provider}/models/credentials/{credential_id}"): frozenset(
        {"200", "422", "default"}
    ),
    ("get", "/_health"): frozenset({"200", "default"}),
    ("get", "/_version"): frozenset({"200", "default"}),
    ("get", "/account"): frozenset({"200", "default"}),
    ("get", "/account/sessions"): frozenset({"200", "422", "default"}),
    ("delete", "/account/sessions/self"): frozenset({"200", "default"}),
    ("delete", "/account/sessions/{session_id}"): frozenset({"200", "default"}),
    ("get", "/apps"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/app-info/workflow"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/app-info/workflow"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/service-api"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/service-api"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/app-info/advanced-chat"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/app-info/advanced-chat"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/app-info/chat"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/app-info/chat"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/app-info/agent-chat"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/app-info/agent-chat"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/app-info/completion"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/app-info/completion"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/app-info/agent"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/app-info/agent"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/service-api/agent"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/service-api/agent"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/dependencies:check"): frozenset({"200", "default"}),
    ("get", "/apps/{app_id}/dsl"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/files"): frozenset({"201", "400", "401", "413", "415", "422", "default"}),
    ("get", "/apps/{app_id}/human-input-forms/{form_token}"): frozenset({"200", "default"}),
    ("post", "/apps/{app_id}/human-input-forms/{form_token}:submit"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/tasks/{task_id}/events"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/tasks/{task_id}:stop"): frozenset({"200", "default"}),
    ("post", "/apps/{app_id}/workflow:run"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/chat:run"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/advanced-chat:run"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/completion:run"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/draft/workflow:run"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/draft/advanced-chat:run"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/runs"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/runs/{run_id}"): frozenset({"200", "default"}),
    ("get", "/apps/{app_id}/runs/{run_id}/nodes"): frozenset({"200", "default"}),
    ("post", "/apps/{app_id}:publish"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/versions"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/versions/{version_id}:restore"): frozenset({"200", "default"}),
    ("get", "/apps/{app_id}/release:check"): frozenset({"200", "default"}),
    ("get", "/apps/{app_id}/env"): frozenset({"200", "default"}),
    ("put", "/apps/{app_id}/env/{env_id}"): frozenset({"200", "422", "default"}),
    ("delete", "/apps/{app_id}/env/{env_id}"): frozenset({"200", "default"}),
    # The five device-flow rows are the only operations with no `default`: they
    # document their 200 with a raw `openapi_ns.response` rather than `@returns`,
    # so no `ErrorBody` schema is registered for them.
    ("post", "/oauth/device/approve"): frozenset({"200"}),
    ("post", "/oauth/device/code"): frozenset({"200"}),
    ("post", "/oauth/device/deny"): frozenset({"200"}),
    ("get", "/oauth/device/lookup"): frozenset({"200"}),
    ("post", "/oauth/device/token"): frozenset({"200"}),
    ("get", "/node-types"): frozenset({"200", "default"}),
    ("get", "/node-types/{node_type}"): frozenset({"200", "default"}),
    ("post", "/apps/{app_id}/draft/workflow/nodes/{node_id}:run"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/draft/advanced-chat/nodes/{node_id}:run"): frozenset({"200", "422", "default"}),
    ("post", "/workspaces/{workspace_id}/apps/workflow"): frozenset({"201", "422", "default"}),
    ("post", "/workspaces/{workspace_id}/apps/advanced-chat"): frozenset({"201", "422", "default"}),
    ("get", "/permitted-external-apps"): frozenset({"200", "422", "default"}),
    ("get", "/permitted-external-apps/{app_id}"): frozenset({"200", "422", "default"}),
    ("get", "/workspaces"): frozenset({"200", "422", "default"}),
    ("get", "/workspaces/{workspace_id}"): frozenset({"200", "default"}),
    ("post", "/workspaces/{workspace_id}/apps/imports"): frozenset({"200", "202", "400", "422", "default"}),
    ("post", "/workspaces/{workspace_id}/apps/imports:check"): frozenset({"200", "422", "default"}),
    ("post", "/workspaces/{workspace_id}/apps/imports/{import_id}:confirm"): frozenset({"200", "400", "default"}),
    ("get", "/workspaces/{workspace_id}/members"): frozenset({"200", "422", "default"}),
    ("post", "/workspaces/{workspace_id}/members"): frozenset({"201", "422", "default"}),
    ("delete", "/workspaces/{workspace_id}/members/{member_id}"): frozenset({"200", "default"}),
    ("patch", "/workspaces/{workspace_id}/members/{member_id}"): frozenset({"200", "422", "default"}),
    ("post", "/workspaces/{workspace_id}:switch"): frozenset({"200", "default"}),
    ("get", "/apps/{app_id}/webapp/workflow"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/webapp/workflow"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/webapp:reset"): frozenset({"200", "default"}),
    ("get", "/apps/{app_id}/webapp-access"): frozenset({"200", "default"}),
    ("put", "/apps/{app_id}/webapp-access"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/webapp/advanced-chat"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/webapp/advanced-chat"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/webapp/chat"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/webapp/chat"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/webapp/agent-chat"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/webapp/agent-chat"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/webapp/completion"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/webapp/completion"): frozenset({"200", "422", "default"}),
    ("get", "/apps/{app_id}/webapp/agent"): frozenset({"200", "default"}),
    ("patch", "/apps/{app_id}/webapp/agent"): frozenset({"200", "422", "default"}),
    ("post", "/apps/{app_id}/webapp/agent:reset"): frozenset({"200", "default"}),
    ("get", "/apps/{app_id}/webapp-access/agent"): frozenset({"200", "default"}),
    ("put", "/apps/{app_id}/webapp-access/agent"): frozenset({"200", "422", "default"}),
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


def test_file_bearing_bodies_are_documented_as_multipart(openapi_document: dict[str, object]) -> None:
    """The exported contract names the wire form `_multipart.py` accepts: a body of only
    files is multipart alone, a run body is JSON or multipart with its JSON-text parts marked."""
    paths = openapi_document["paths"]
    assert isinstance(paths, dict)
    upload = paths["/apps/{app_id}/files"]["post"]["requestBody"]["content"]
    assert set(upload) == {"multipart/form-data"}
    assert "encoding" not in upload["multipart/form-data"]
    run = paths["/apps/{app_id}/chat:run"]["post"]["requestBody"]["content"]
    assert set(run) == {"application/json", "multipart/form-data"}
    assert run["multipart/form-data"]["schema"] == run["application/json"]["schema"]
    encoding = run["multipart/form-data"]["encoding"]
    assert {"inputs", "query"} <= set(encoding)
    assert {"files", "attachments"}.isdisjoint(encoding)
    assert encoding["inputs"] == {"contentType": "application/json"}


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
    """Every operation's response codes are pinned exactly.

    `@endpoint` routes through `@returns`, which registers `default` -> `ErrorBody`,
    so a route that stops emitting the error schema (or one that starts) moves a row
    here and has to be re-pinned deliberately.
    """
    seen = dict(_operations(openapi_document))
    assert set(seen) == set(EXPECTED_RESPONSE_CODES)
    for key, operation in seen.items():
        responses = operation.get("responses", {})
        assert isinstance(responses, dict)
        assert frozenset(responses) == EXPECTED_RESPONSE_CODES[key], (
            f"{key}: {sorted(responses)} != {sorted(EXPECTED_RESPONSE_CODES[key])}"
        )


def test_every_default_response_is_the_one_returns_registers(openapi_document: dict[str, object]) -> None:
    """A hand-written `default` pointing at some other schema would still satisfy
    the code sets above, which compare codes and not bodies.
    """
    for key, operation in _operations(openapi_document):
        responses = operation["responses"]
        assert isinstance(responses, dict)
        if "default" in responses:
            assert responses["default"] == ERROR_DEFAULT_RESPONSE, key
