"""Self-contained authorization requirements.

Requirements are process-lifetime singletons: built once at import, shared by
every request and every thread. Config belongs in `__init__`, and `run` must
neither cache nor mutate — a cache here would outlive the fact it recorded.
Per-request caching belongs in `loaders.py`, which stores into `Context`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Collection, Sequence
from enum import IntEnum
from typing import ClassVar, Final, override

from flask import request
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from configs import dify_config
from constants.oauth_bearer import Scope
from controllers.common.rbac import PlainApp, RBACCheck, RBACPermission, Workspace, enforce_rbac_checks
from controllers.openapi._audit import emit_wrong_surface
from controllers.openapi._errors import (
    AppModeMismatch,
    MemberLicenseExceeded,
    MemberLimitExceeded,
    PluginInstallForbidden,
    WebAppAccessRequiresEE,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_app, load_caller, load_workspace, load_workspace_role
from controllers.openapi.auth.subjects import AccountSubject, Subject
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from models import AppMode
from models.account import TenantAccountRole, TenantPluginInstallPermission
from models.enums import CreatorUserRole
from services.enterprise.enterprise_service import EnterpriseService, WebAppAccessMode
from services.entities.feature_entities import LicenseStatus
from services.errors.workspace import WorkspaceInvitationQuotaError, WorkspaceMemberLicenseQuotaError
from services.feature_service import FeatureService
from services.plugin.plugin_permission_service import PluginPermissionService
from services.system_feature_service import SystemFeatureService

_DEAD_LICENSE_STATUSES = frozenset({LicenseStatus.INACTIVE, LicenseStatus.EXPIRED, LicenseStatus.LOST})


class Rank(IntEnum):
    """Three bands, coarsest first. Ties fall back to declaration order —
    endpoint-declared ahead of pipeline-fixed — so `Pipeline.run`'s sort stays
    stable rather than needing every requirement in its own band.
    """

    FIRST = 0  # reject the caller before anything touches data
    EARLY = 10  # must precede permission checks
    NORMAL = 20  # default - declared order decides


class Requirement(ABC):
    rank: ClassVar[Rank] = Rank.NORMAL

    @abstractmethod
    def run(self, subject: Subject, ctx: Context, session: Session) -> None: ...


class CheckSubject(Requirement):
    rank = Rank.FIRST

    def __init__(self, *, allowed: Sequence[type[Subject]]) -> None:
        self.allowed = tuple(allowed)

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if isinstance(subject, self.allowed):
            return
        emit_wrong_surface(
            subject_type=subject.subject_type.value,
            attempted_path=request.path,
            client_id=subject.client_id,
            token_id=str(subject.token_id) if subject.token_id else None,
        )
        raise Forbidden("unsupported_token_type")


def assert_license_valid() -> None:
    """The router's deployment-wide gate, answered before `extract_bearer`."""
    if SystemFeatureService.get_public_system_features().license.status in _DEAD_LICENSE_STATUSES:
        raise Forbidden("license_invalid")


class CheckAppApiEnabled(Requirement):
    rank = Rank.EARLY

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if not load_app(ctx).enable_api:
            raise Forbidden("service_api_disabled")


class CheckWorkspaceMember(Requirement):
    """Resolving the role *is* the check: `load_workspace_role` 404s a non-member.

    Which workspace that is follows from the route — the app's on an app-scoped
    one, the path or query parameter otherwise — so this one requirement serves
    both. It cannot be inferred and left implicit: `GET /apps` takes its
    workspace from the query string, and `GET /workspaces/<workspace_id>` has
    the path parameter but gets no membership check.
    """

    rank = Rank.EARLY

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if subject.caller_role is not CreatorUserRole.ACCOUNT:
            return
        load_workspace_role(ctx)


class CheckScope(Requirement):
    def __init__(self, scope: Scope) -> None:
        self.scope = scope

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if Scope.FULL in subject.scopes or self.scope in subject.scopes:
            return
        raise Forbidden("insufficient_scope")


class CheckWorkspaceInvitationQuota(Requirement):
    """Run after workspace membership and permission checks, before the handler."""

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        try:
            application_services().workspaces.invitations.check_invitation_quota(ctx.request_context)
        except WorkspaceMemberLicenseQuotaError as error:
            raise MemberLicenseExceeded() from error
        except WorkspaceInvitationQuotaError as error:
            raise MemberLimitExceeded() from error


class CheckRBACPermission(Requirement):
    """The same check bundles the console's `rbac_permission_required` takes.
    Inert wherever RBAC is off; a route that needs a check there declares a
    `CheckWorkspaceRole` beside this.
    """

    def __init__(self, *checks: RBACCheck) -> None:
        if not checks:
            raise ValueError("CheckRBACPermission requires at least one RBACCheck")
        self.checks = checks

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if subject.caller_role is not CreatorUserRole.ACCOUNT:
            return
        if not dify_config.RBAC_ENABLED:
            return
        enforce_rbac_checks(
            tenant_id=load_workspace(ctx).id,
            account_id=str(subject.account_id),
            checks=self.checks,
            path_args=dict(ctx.view_args),
        )


EDITOR_ROLES: Final = frozenset({TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER})
ADMIN_ROLES: Final = frozenset({TenantAccountRole.ADMIN, TenantAccountRole.OWNER})


class CheckAppMode(Requirement):
    """Ranked ahead of RBAC so a mode mismatch answers 422 whether RBAC is on or off."""

    rank = Rank.EARLY

    def __init__(self, *modes: AppMode) -> None:
        self.modes = frozenset(modes)

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if load_app(ctx).mode not in self.modes:
            raise AppModeMismatch()


class CheckWebAppAuthEnterprise(Requirement):
    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            raise WebAppAccessRequiresEE()
        if not SystemFeatureService.get_public_system_features().webapp_auth.enabled:
            raise WebAppAccessRequiresEE()


class CheckAppQuota(Requirement):
    """The console's `billing_resource="apps"` gate."""

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
            return
        apps = FeatureService.get_features(load_workspace(ctx).id, exclude_vector_space=True).apps
        if 0 < apps.limit <= apps.size:
            raise Forbidden("The number of apps has reached the limit of your subscription.")


class CheckWorkspaceRole(Requirement):
    """The workspace-role gate that predates RBAC. Inert wherever RBAC is on;
    a route that needs a check there declares a `CheckRBACPermission` beside this.
    """

    def __init__(self, allowed_roles: frozenset[TenantAccountRole]) -> None:
        self.allowed_roles = allowed_roles

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if subject.caller_role is not CreatorUserRole.ACCOUNT:
            return
        if dify_config.RBAC_ENABLED:
            return
        if load_workspace_role(ctx) not in self.allowed_roles:
            raise Forbidden("insufficient workspace role")


class CheckPluginInstallSetting(Requirement):
    """The console's `plugin_permission_required(install_required=True)`: the workspace's
    "who can install plugins" setting. Inert wherever RBAC is on, as in the console.
    A setting value this code does not know is refused.
    """

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if subject.caller_role is not CreatorUserRole.ACCOUNT:
            return
        if dify_config.RBAC_ENABLED:
            return
        setting = PluginPermissionService.get_permission(load_workspace(ctx).id, session=session)
        if setting is None:
            return
        match setting.install_permission:
            case TenantPluginInstallPermission.EVERYONE:
                return
            case TenantPluginInstallPermission.ADMINS:
                if load_workspace_role(ctx) in ADMIN_ROLES:
                    return
                raise PluginInstallForbidden("Plugin install is limited to admins in this workspace.")
            case _:
                raise PluginInstallForbidden("Plugin install is turned off in this workspace.")


class CheckAppAccess(Requirement):
    """Run-scope comes from the declaration site, so it is not re-checked here.

    The ACL is gated on `webapp_auth.enabled` and the private-app check is not:
    the asymmetry is deliberate, not an oversight.
    """

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            return
        access_mode = self._access_mode(load_app(ctx).id)
        if SystemFeatureService.get_public_system_features().webapp_auth.enabled:
            self._assert_mode_allowed(subject, access_mode)
        if access_mode == WebAppAccessMode.PRIVATE:
            self._assert_private_app_permission(subject, ctx, session)

    def _access_mode(self, app_id: str) -> WebAppAccessMode | None:
        try:
            settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=app_id)
            if settings is None:
                return None
            return WebAppAccessMode(settings.access_mode)
        except ValueError:
            return None

    def _assert_mode_allowed(self, subject: Subject, access_mode: WebAppAccessMode | None) -> None:
        if access_mode is None:
            raise Forbidden("app or access mode not loaded")
        if access_mode not in subject.webapp_modes:
            raise Forbidden("subject_not_allowed_for_access_mode")

    def _assert_private_app_permission(self, subject: Subject, ctx: Context, session: Session) -> None:
        user_id = subject.webapp_user_id(session)
        if user_id is None:
            raise Forbidden("cannot resolve user for private app check")
        app_id = load_app(ctx).id
        if not EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(user_id=user_id, app_id=app_id):
            raise Forbidden("user_not_allowed_for_private_app")


class ResolveCaller(Requirement):
    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if not subject.mounts_caller(ctx):
            return
        load_caller(ctx)


Roles = frozenset[TenantAccountRole] | None
"""The pre-RBAC workspace-role gate; None declares none."""

WORKSPACE_READ_GUARDS: Final[tuple[Requirement, ...]] = (
    CheckSubject(allowed=(AccountSubject,)),
    CheckScope(Scope.WORKSPACE_READ),
    CheckWorkspaceMember(),
)


def _role_gate(roles: Roles) -> tuple[Requirement, ...]:
    return (CheckWorkspaceRole(roles),) if roles is not None else ()


def workspace_write_guards(
    permission: RBACPermission, *, roles: Roles, extra: tuple[Requirement, ...] = ()
) -> tuple[Requirement, ...]:
    """Guards for an account-only write to the workspace."""
    return (
        CheckSubject(allowed=(AccountSubject,)),
        CheckScope(Scope.WORKSPACE_WRITE),
        CheckWorkspaceMember(),
        CheckRBACPermission(RBACCheck(permission, Workspace())),
        *_role_gate(roles),
        *extra,
    )


def _app_guards(
    head: tuple[Requirement, ...], check: RBACCheck, *, scope: Scope, modes: Collection[AppMode], roles: Roles
) -> tuple[Requirement, ...]:
    return (
        *head,
        *((CheckAppMode(*modes),) if modes else ()),
        CheckScope(scope),
        CheckRBACPermission(check),
        *_role_gate(roles),
    )


def account_app_guards(
    permission: RBACPermission, *, scope: Scope, roles: Roles, modes: Collection[AppMode] = ()
) -> tuple[Requirement, ...]:
    """Guards for an account-only op on one app; `modes` limits it to apps of those modes."""
    head = (CheckSubject(allowed=(AccountSubject,)), CheckAppApiEnabled(), CheckWorkspaceMember())
    return _app_guards(head, RBACCheck(permission, PlainApp()), scope=scope, modes=modes, roles=roles)


def account_settings_guards(
    check: RBACCheck, *, scope: Scope, modes: Collection[AppMode], roles: Roles
) -> tuple[Requirement, ...]:
    """App-settings guards. No `CheckAppApiEnabled`, so an admin can always switch the Service API back on."""
    head = (CheckSubject(allowed=(AccountSubject,)), CheckWorkspaceMember())
    return _app_guards(head, check, scope=scope, modes=modes, roles=roles)
