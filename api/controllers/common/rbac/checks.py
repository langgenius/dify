from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from flask import request
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from core.rbac import RBACPermission, RBACResourceScope
from services.enterprise.rbac_service import RBACService

from .locators import ResourceLocator, Workspace

__all__ = ["RBAC_CHECKS_ATTR", "RBACCheck", "enforce_rbac_checks"]

RBAC_CHECKS_ATTR = "rbac_checks"


@dataclass(frozen=True)
class RBACCheck:
    scene: RBACPermission
    locator: ResourceLocator

    def __post_init__(self) -> None:
        if isinstance(self.locator, Workspace) or self.scene.scope is RBACResourceScope.WORKSPACE:
            return
        if self.locator.scope is not self.scene.scope:
            raise ValueError(
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
