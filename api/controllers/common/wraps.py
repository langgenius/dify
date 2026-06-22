"""Shared decorator utilities for Dify controller layers.

This module provides decorators that are not tied to any single API group (e.g.
console, inner, service).  Currently it exposes the RBAC permission gate, which
can be applied to any blueprint.

Key exports
-----------
``rbac_permission_required`` – decorator that enforces enterprise RBAC access
    control.  When ``RBAC_ENABLED`` is ``False`` it is a no-op.

``RBACPermission``, ``RBACResourceScope`` – re-exported from ``core.rbac`` so
    callers only need a single import site.

Private helpers
---------------
``_extract_resource_id``, ``_is_resource_owned_by_current_user`` – kept module-
    private but accessible via the module namespace for unit-test patching.
"""

from collections.abc import Callable
from functools import wraps

from sqlalchemy import select
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from core.rbac import RBACPermission, RBACResourceScope
from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models.dataset import Dataset
from models.model import App
from services.enterprise.rbac_service import RBACService

__all__ = ["RBACPermission", "RBACResourceScope", "rbac_permission_required"]


def rbac_permission_required[**P, R](
    resource_type: RBACResourceScope,
    scene: RBACPermission,
    *,
    resource_required: bool = True,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Check enterprise RBAC permissions for the current user.

    When ``RBAC_ENABLED`` is ``False`` the decorator is a no-op and the
    request passes through unchanged. When enabled it extracts the resource ID
    from ``request.view_args`` for resource-scoped checks, calls the RBAC
    service ``check-access`` endpoint, and raises ``Forbidden`` if the access
    is denied. For workspace-level checks, set ``resource_required=False`` so
    the RBAC request omits ``resource_id``.

    Args:
        resource_type: The :class:`RBACResourceScope` member (app/dataset/workspace).
        scene: The :class:`RBACPermission` permission point, e.g. ``RBACPermission.APP_DELETE``.
        resource_required: Whether a concrete resource ID is required.
    """

    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            if not dify_config.RBAC_ENABLED:
                return view(*args, **kwargs)

            current_user, current_tenant_id = current_account_with_tenant()
            check_resource_type = None if resource_type == RBACResourceScope.WORKSPACE else resource_type
            resource_id = None
            if resource_required and check_resource_type:
                resource_id = _extract_resource_id(resource_type, kwargs)
                if _is_resource_owned_by_current_user(current_tenant_id, current_user.id, resource_type, resource_id):
                    return view(*args, **kwargs)
            allowed = RBACService.CheckAccess.check(
                current_tenant_id,
                current_user.id,
                scene=scene,
                resource_type=check_resource_type,
                resource_id=resource_id,
            )

            if not allowed:
                raise Forbidden()

            return view(*args, **kwargs)

        return decorated

    return decorator


def _is_resource_owned_by_current_user(
    tenant_id: str, account_id: str, resource_type: RBACResourceScope, resource_id: str
) -> bool:
    if resource_type == RBACResourceScope.APP:
        maintainer = db.session.scalar(
            select(App.maintainer).where(
                App.id == resource_id,
                App.tenant_id == tenant_id,
                App.status == "normal",
            )
        )
        return maintainer == account_id

    if resource_type == RBACResourceScope.DATASET:
        maintainer = db.session.scalar(
            select(Dataset.maintainer).where(
                Dataset.id == resource_id,
                Dataset.tenant_id == tenant_id,
            )
        )
        return maintainer == account_id

    return False


def _extract_resource_id(resource_type: RBACResourceScope, path_args: dict[str, object] | None = None) -> str:
    """Extract the resource ID from matched path arguments.

    Some legacy route classes use neutral names such as ``resource_id`` for
    app/dataset resources, and Agent App routes use ``agent_id`` as the app id.
    Dataset endpoints behind a rag-pipeline route contain ``pipeline_id``
    instead of ``dataset_id``. In that case we look up the associated
    ``Dataset`` row via ``Dataset.pipeline_id``.
    """
    from flask import request

    view_args = request.view_args or {}
    matched_args = {**view_args, **(path_args or {})}

    if resource_type == RBACResourceScope.APP:
        app_id = matched_args.get("app_id") or matched_args.get("agent_id") or matched_args.get("resource_id")
        if not app_id:
            raise ValueError("Missing app_id in request path")
        return str(app_id)

    if resource_type == RBACResourceScope.DATASET:
        dataset_id = matched_args.get("dataset_id") or matched_args.get("resource_id")
        if dataset_id:
            return str(dataset_id)

        pipeline_id = matched_args.get("pipeline_id")
        if pipeline_id:
            dataset = db.session.scalar(select(Dataset).where(Dataset.pipeline_id == str(pipeline_id)))
            if not dataset:
                raise NotFound("Dataset not found for pipeline")
            return str(dataset.id)
        raise ValueError("Missing dataset_id or pipeline_id in request path")
    raise ValueError(f"Unknown resource_type: {resource_type}")
