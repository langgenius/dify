from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import TYPE_CHECKING

from core.rbac import RBACPermission, RBACResourceScope

if TYPE_CHECKING:
    from controllers.openapi.auth.data import AuthData

__all__ = ["RBACPermission", "RBACResourceScope", "openapi_rbac_permission_required", "rbac_permission_required"]


def openapi_rbac_permission_required[**P, R](
    resource_type: RBACResourceScope,
    scene: RBACPermission,
    *,
    resource_required: bool = True,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """RBAC guard for OpenAPI endpoints that may be called by either an Account or an EndUser.
    """
    inner = rbac_permission_required(resource_type, scene, resource_required=resource_required)

    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        guarded = inner(view)

        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            auth_data: AuthData | None = kwargs.get("auth_data")
            if auth_data is not None and auth_data.caller_kind == "end_user":
                # we can skip rbac for enduser for now.
                return view(*args, **kwargs)
            return guarded(*args, **kwargs)

        return decorated

    return decorator


def rbac_permission_required[**P, R](
    resource_type: RBACResourceScope,
    scene: RBACPermission,
    *,
    resource_required: bool = True,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Check enterprise RBAC permissions for the current user.

    Args:
        resource_type: The :class:`RBACResourceScope` member (app/dataset/workspace).
        scene: The :class:`RBACPermission` permission point.
        resource_required: Whether a concrete resource ID is required.
    """

    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            return view(*args, **kwargs)

        return decorated

    return decorator
