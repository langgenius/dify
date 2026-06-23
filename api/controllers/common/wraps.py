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

__all__ = ["RBACPermission", "RBACResourceScope", "enforce_rbac_access", "rbac_permission_required"]


def enforce_rbac_access(
    *,
    tenant_id: str,
    account_id: str,
    resource_type: RBACResourceScope,
    scene: RBACPermission,
    resource_required: bool = True,
    path_args: dict[str, object] | None = None,
) -> None:
    """Enforce enterprise RBAC for an explicit account/tenant pair.

    This is the flask-login-independent core of the RBAC gate so it can run
    inside request-handling layers that resolve the caller themselves (e.g. the
    openapi auth pipeline, which has the account on ``AuthData`` before
    flask-login is mounted).

    No-op when ``RBAC_ENABLED`` is ``False``. For resource-scoped checks the
    resource ID is taken from ``path_args`` merged with ``request.view_args``;
    resource ownership short-circuits the check. Raises ``Forbidden`` when
    access is denied. For workspace-level checks pass ``resource_required=False``
    so the RBAC request omits ``resource_id``.

    Args:
        tenant_id: The tenant the access is evaluated against.
        account_id: The account requesting access.
        resource_type: The :class:`RBACResourceScope` member (app/dataset/workspace).
        scene: The :class:`RBACPermission` permission point, e.g. ``RBACPermission.APP_DELETE``.
        resource_required: Whether a concrete resource ID is required.
        path_args: Extra path arguments to merge with ``request.view_args``.
    """
    if not dify_config.RBAC_ENABLED:
        return

    check_resource_type = None if resource_type == RBACResourceScope.WORKSPACE else resource_type
    resource_id = None
    if resource_required and check_resource_type:
        resource_id = _extract_resource_id(resource_type, path_args)
        if _is_resource_owned_by_current_user(tenant_id, account_id, resource_type, resource_id):
            return
    allowed = RBACService.CheckAccess.check(
        tenant_id,
        account_id,
        scene=scene,
        resource_type=check_resource_type,
        resource_id=resource_id,
    )
    if not allowed:
        raise Forbidden()


def rbac_permission_required[**P, R](
    resource_type: RBACResourceScope,
    scene: RBACPermission,
    *,
    resource_required: bool = True,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Check enterprise RBAC permissions for the current flask-login user.

    When ``RBAC_ENABLED`` is ``False`` the decorator is a no-op and the
    request passes through unchanged. When enabled it resolves the current
    account/tenant and delegates to :func:`enforce_rbac_access`, raising
    ``Forbidden`` if access is denied.

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
            enforce_rbac_access(
                tenant_id=current_tenant_id,
                account_id=current_user.id,
                resource_type=resource_type,
                scene=scene,
                resource_required=resource_required,
                path_args=kwargs,
            )
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
