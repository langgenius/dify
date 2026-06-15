"""Shared decorators for controllers."""

from collections.abc import Callable
from functools import wraps
from typing import Literal

from flask import request
from sqlalchemy import select
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models import App, Dataset
from services.enterprise.rbac_service import RBACService


def rbac_permission_required[**P, R](
    resource_type: Literal["app", "dataset", "workspace"],
    scene: str,
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
        resource_type: ``"app"``, ``"dataset"``, or ``"workspace"``.
        scene: The RBAC scene name, e.g. ``"app_delete"``.
        resource_required: Whether a concrete resource ID is required.
    """

    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            if not dify_config.RBAC_ENABLED:
                return view(*args, **kwargs)

            current_user, current_tenant_id = current_account_with_tenant()
            check_resource_type = None if resource_type == "workspace" else resource_type
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


def _is_resource_owned_by_current_user(tenant_id: str, account_id: str, resource_type: str, resource_id: str) -> bool:
    if resource_type == "app":
        created_by = db.session.scalar(
            select(App.created_by).where(
                App.id == resource_id,
                App.tenant_id == tenant_id,
                App.status == "normal",
            )
        )
        return created_by == account_id

    if resource_type == "dataset":
        created_by = db.session.scalar(
            select(Dataset.created_by).where(
                Dataset.id == resource_id,
                Dataset.tenant_id == tenant_id,
            )
        )
        return created_by == account_id

    return False


def _extract_resource_id(resource_type: str, path_args: dict[str, object] | None = None) -> str:
    """Extract the resource ID from matched path arguments.

    For dataset endpoints behind a rag-pipeline route the URL contains
    ``pipeline_id`` instead of ``dataset_id``.  In that case we look up the
    associated ``Dataset`` row via ``Dataset.pipeline_id``.
    """
    view_args = request.view_args or {}
    matched_args = {**view_args, **(path_args or {})}

    if resource_type == "app":
        app_id = matched_args.get("app_id")
        if not app_id:
            raise ValueError("Missing app_id in request path")
        return str(app_id)

    if resource_type == "dataset":
        dataset_id = matched_args.get("dataset_id")
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
