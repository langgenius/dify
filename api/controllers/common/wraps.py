"""Shared decorator utilities for Dify controller layers.

This module provides decorators that are not tied to any single API group (e.g.
console, inner, service).  Currently it exposes the RBAC permission gate, which
can be applied to any blueprint.

Key exports
-----------
``rbac_permission_required`` – decorator that gates enterprise RBAC access
    control.  In the community edition this is always a no-op; enterprise
    editions override the implementation without changing the public interface.

``RBACPermission``, ``RBACResourceScope`` – re-exported from ``core.rbac`` so
    callers only need a single import site.
"""

from collections.abc import Callable
from functools import wraps

from core.rbac import RBACPermission, RBACResourceScope

__all__ = ["RBACPermission", "RBACResourceScope", "rbac_permission_required"]


def rbac_permission_required[**P, R](
    resource_type: RBACResourceScope,
    scene: RBACPermission,
    *,
    resource_required: bool = True,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Check enterprise RBAC permissions for the current user.

    Community edition: always a no-op — the decorated view is called
    unconditionally.  Enterprise edition replaces this with a real gate that
    calls the external ``check-access`` endpoint and raises ``Forbidden`` on
    denial.

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
