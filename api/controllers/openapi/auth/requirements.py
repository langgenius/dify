"""Self-contained authorization requirements.

Requirements are process-lifetime singletons: built once at import, shared by
every request and every thread. Config belongs in `__init__`, and `run` must
neither cache nor mutate — a cache here would outlive the fact it recorded.
Per-request caching belongs on `Context`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
from enum import IntEnum
from typing import ClassVar, override

from flask import request
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.common.wraps import enforce_rbac_access
from controllers.openapi._audit import emit_wrong_surface
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.data import CallerKind
from controllers.openapi.auth.loaders import load_app, load_caller, load_workspace, load_workspace_role
from controllers.openapi.auth.subjects import Subject
from core.rbac import RBACPermission, RBACResourceScope
from enums import DeploymentEdition
from libs.oauth_bearer import Scope
from models.account import TenantAccountRole
from services.enterprise.enterprise_service import EnterpriseService, WebAppAccessMode
from services.entities.feature_entities import LicenseStatus
from services.feature_service import FeatureService
from services.oauth_device_flow import token_belongs_to_subject

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


class SubjectCheck(Requirement):
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


class EditionCheck(Requirement):
    rank = Rank.FIRST

    def __init__(self, editions: frozenset[DeploymentEdition]) -> None:
        self.editions = frozenset(editions)

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if dify_config.DEPLOYMENT_EDITION not in self.editions:
            raise Forbidden("external_sso_requires_ee")


def assert_license_valid() -> None:
    """Shared with the router's endpoint-level gate, which has to answer
    before `extract_bearer` and so cannot be a requirement. One function, so
    the requirement and that gate cannot drift apart.
    """
    if FeatureService.get_system_features().license.status in _DEAD_LICENSE_STATUSES:
        raise Forbidden("license_invalid")


class LicenseCheck(Requirement):
    rank = Rank.FIRST

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        assert_license_valid()


class CheckAppApiEnabled(Requirement):
    rank = Rank.EARLY

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if not ctx.has_app:
            return
        if not load_app(ctx).enable_api:
            raise Forbidden("service_api_disabled")


def _assert_member(subject: Subject, ctx: Context) -> None:
    """Resolving the role *is* the check: `load_workspace_role` 404s a non-member."""
    if subject.caller_kind is not CallerKind.ACCOUNT:
        return
    load_workspace_role(ctx)


class CheckAppWorkspaceMembership(Requirement):
    rank = Rank.EARLY

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if not ctx.has_app:
            return
        _assert_member(subject, ctx)


class RequireWorkspaceMembership(Requirement):
    """Declared by workspace-scoped endpoints. Membership cannot be inferred
    from the request: `GET /apps` takes its workspace from the query string,
    and `GET /workspaces/<workspace_id>` has the path param but gets no check.
    """

    rank = Rank.EARLY

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        _assert_member(subject, ctx)


class TokenScope(Requirement):
    def __init__(self, scope: Scope) -> None:
        self.scope = scope

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if Scope.FULL in subject.scopes or self.scope in subject.scopes:
            return
        raise Forbidden("insufficient_scope")


class RBACCheck(Requirement):
    """The RBAC scene and the legacy role floor, in one requirement.

    They cannot be separate: the role floor stands down as soon as RBAC is
    enabled for a declared scene, so two requirements would double-enforce and
    deny requests that pass today.
    """

    def __init__(
        self,
        *,
        resource_type: RBACResourceScope | None = None,
        scene: RBACPermission | None = None,
        roles: frozenset[TenantAccountRole] | None = None,
        resource_required: bool = True,
    ) -> None:
        if (resource_type is None) != (scene is None):
            raise ValueError("resource_type and scene must be declared together")
        if scene is None and roles is None:
            raise ValueError("RBACCheck must declare a scene, a role floor, or both")
        self.resource_type = resource_type
        self.scene = scene
        self.roles = roles
        self.resource_required = resource_required

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if subject.caller_kind is not CallerKind.ACCOUNT:
            return
        if dify_config.RBAC_ENABLED and self.scene is not None and self.resource_type is not None:
            enforce_rbac_access(
                tenant_id=str(load_workspace(ctx).id),
                account_id=str(subject.account_id),
                resource_type=self.resource_type,
                scene=self.scene,
                resource_required=self.resource_required,
                path_args=dict(request.view_args or {}),
            )
            return
        self._enforce_role_floor(ctx)

    def _enforce_role_floor(self, ctx: Context) -> None:
        if self.roles is None:
            return
        if load_workspace_role(ctx) not in self.roles:
            raise Forbidden("insufficient workspace role")


class CheckSessionOwnership(Requirement):
    """Authorises a named session against the caller's own tokens.

    A token id belonging to another subject answers 404, not 403, exactly like a
    token id that does not exist — a 403 would confirm the id, letting a caller
    enumerate session ids across subjects.
    """

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        session_id = (request.view_args or {})["session_id"]
        if not token_belongs_to_subject(session_id, subject.auth, session=session):
            raise NotFound("session not found")


class RequireWebappAccess(Requirement):
    """Run-scope comes from the declaration site, so it is not re-checked here.

    The ACL is gated on `webapp_auth.enabled` and the private-app check is not:
    the asymmetry is deliberate, not an oversight.
    """

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if not ctx.has_app:
            return
        if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
            return
        access_mode = self._access_mode(str(load_app(ctx).id))
        if FeatureService.get_system_features().webapp_auth.enabled:
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
    """Written last in each pipeline's `fixed` and taking the default rank, so it
    runs after every other requirement — the point at which the caller used to
    resolve, lazily, at mount.

    `ExternalSsoSubject.resolve_caller` reads the workspace, and its pipeline
    carries no membership check, so nothing else on an SSO app route would load
    one. Loading it here is what keeps that route working.
    """

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        if not subject.mounts_caller(ctx):
            return
        if ctx.has_app:
            load_app(ctx)
            load_workspace(ctx)
        load_caller(ctx)
