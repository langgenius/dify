from collections.abc import Callable
from functools import wraps

from configs import dify_config
from controllers.common.rbac import RBAC_CHECKS_ATTR, RBACCheck, enforce_rbac_checks
from libs.login import current_account_with_tenant

__all__ = ["rbac_permission_required"]


def rbac_permission_required[**P, R](*checks: RBACCheck) -> Callable[[Callable[P, R]], Callable[P, R]]:
    if not checks:
        raise ValueError("rbac_permission_required requires at least one RBACCheck")

    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view, updated=())
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            if not dify_config.RBAC_ENABLED:
                return view(*args, **kwargs)
            current_user, current_tenant_id = current_account_with_tenant()
            enforce_rbac_checks(
                tenant_id=current_tenant_id,
                account_id=current_user.id,
                checks=checks,
                path_args=kwargs,
            )
            return view(*args, **kwargs)

        setattr(decorated, RBAC_CHECKS_ATTR, checks)
        return decorated

    return decorator
