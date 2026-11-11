from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from flask import request
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from core.rbac import RBACPermission, RBACResourceScope
from services.enterprise.rbac_service import RBACService

from .locators import ResourceLocator, Workspace

__all__ = ["RBAC_CHECKS_ATTR", "InvalidRBACCheckError", "RBACCheck", "enforce_rbac_checks"]

RBAC_CHECKS_ATTR = "rbac_checks"


class InvalidRBACCheckError(RuntimeError):
    """A route declares a permission scene with an incompatible resource locator."""


@dataclass(frozen=True)
class RBACCheck:
    scene: RBACPermission
    locator: ResourceLocator

    def __post_init__(self) -> None:
        if isinstance(self.locator, Workspace) or self.scene.scope is RBACResourceScope.WORKSPACE:
            return
        if self.locator.scope is not self.scene.scope:
            raise InvalidRBACCheckError(
                f"{self.scene} is a {self.scene.scope} scene but {self.locator!r} locates {self.locator.scope}"
            )


def enforce_rbac_checks(
    *,
    tenant_id: str,
    account_id: str,
    checks: Sequence[RBACCheck],
    path_args: Mapping[str, object] | None = None,
) -> None:
    if not dify_config.RBAC_ENABLED:
        return
    try:
        view_args = request.view_args or {}
    except RuntimeError:
        view_args = {}
    merged: dict[str, object] = {**view_args, **(path_args or {})}
    applicable = [
        (check, identity) for check in checks if (identity := check.locator.locate(tenant_id, merged)) is not None
    ]
    if not applicable:
        raise NotFound()
    for check, identity in applicable:
        is_workspace = identity.scope is RBACResourceScope.WORKSPACE
        owner = None if is_workspace else check.locator.owner_id(tenant_id, identity)
        if owner is not None and owner == account_id:
            return
        allowed = RBACService.CheckAccess.check(
            tenant_id,
            account_id,
            scene=check.scene,
            resource_type=None if is_workspace else identity.scope,
            resource_id=None if is_workspace else identity.id,
        )
        if allowed:
            return
    raise Forbidden()


# Permission keys reported by the RBAC service for an app. The built-in role
# projections in ``services.rbac.builtin`` are the source of truth for these
# key names. A scene-based check cannot express "may view the app's published
# access points": there is no app-scoped access-point-view scene, so reads of
# the published access-point surface consult the keys instead.
APP_ACCESS_POINT_VIEW_KEY = "app.acl.access_point_view"
APP_VIEW_LAYOUT_KEY = "app.acl.view_layout"


def enforce_app_access_point_read(*, tenant_id: str, account_id: str, app_id: str) -> None:
    """Allow reading an app's published access-point surface.

    Preconditions: ``tenant_id``, ``account_id`` and ``app_id`` identify the
    admitted caller and the app being read.
    Postconditions: returns when the caller holds ``app.acl.access_point_view``
    or ``app.acl.view_layout`` for the app. When RBAC is disabled it returns
    without consulting the RBAC service, preserving legacy behavior (the scene
    check is a no-op there too).
    Failure behavior: raises ``Forbidden`` when RBAC is enabled and the caller
    holds neither key for the app, including when the service reports no keys
    for the app at all. The check fails closed.
    """
    if not dify_config.RBAC_ENABLED:
        return
    permission_keys = RBACService.AppPermissions.batch_get(tenant_id, account_id, [app_id]).get(app_id, [])
    if APP_ACCESS_POINT_VIEW_KEY not in permission_keys and APP_VIEW_LAYOUT_KEY not in permission_keys:
        raise Forbidden()
