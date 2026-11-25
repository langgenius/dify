from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from http import HTTPStatus

from flask import Response, abort
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.rbac import RBACCheck, RBACPermission, Workspace
from controllers.common.wraps import rbac_permission_required
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
)
from libs.login import login_required
from models import Account
from models.account import TenantAccountRole
from services.feature_service import FeatureService


def workspace_channel_api_admission[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Reject Workspace Channel transport when IM is centrally managed before authentication."""

    @wraps(view)
    def admitted(*args: P.args, **kwargs: P.kwargs) -> R:
        if FeatureService.is_im_centrally_managed():
            abort(HTTPStatus.NOT_IMPLEMENTED)
        return view(*args, **kwargs)

    return admitted


def workspace_email_channel_api_admission[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Preserve enabled handlers; reject unavailable tenant Email management with HTTP 501.

    Rejection precedes authentication, validation, persistence and provider I/O.
    Global mail availability does not grant access to tenant Email configuration.
    """

    @wraps(view)
    def admitted(*args: P.args, **kwargs: P.kwargs) -> R:
        if not FeatureService.use_tenant_scoped_email_config():
            abort(HTTPStatus.NOT_IMPLEMENTED)
        return view(*args, **kwargs)

    return admitted


def _workspace_permission_required[**P, R](
    permission: RBACPermission,
    legacy_roles: frozenset[TenantAccountRole],
) -> Callable[[Callable[P, R]], Callable[P, R | Response]]:
    """Authorize an initialized console account using its active Workspace.

    With RBAC enabled, the Workspace locator ignores App resource overrides.
    Otherwise, the endpoint's existing role restriction decides admission.
    """

    def decorate(view: Callable[P, R]) -> Callable[P, R | Response]:
        checked = rbac_permission_required(RBACCheck(permission, Workspace()))(view)

        @wraps(checked)
        def admitted(*args: P.args, **kwargs: P.kwargs) -> R:
            from libs.login import current_user

            user = current_user._get_current_object()
            if not isinstance(user, Account) or (not dify_config.RBAC_ENABLED and user.role not in legacy_roles):
                raise Forbidden()
            return checked(*args, **kwargs)

        return setup_required(login_required(account_initialization_required(admitted)))

    return decorate


_ADMIN_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})
_EDIT_ROLES = _ADMIN_ROLES | {TenantAccountRole.EDITOR}

require_channel_manage = _workspace_permission_required(RBACPermission.CHANNEL_MANAGE, _ADMIN_ROLES)
require_contact_manage = _workspace_permission_required(RBACPermission.CONTACT_MANAGE, _ADMIN_ROLES)
require_contact_view = _workspace_permission_required(RBACPermission.CONTACT_VIEW, _ADMIN_ROLES)
require_contact_options = _workspace_permission_required(RBACPermission.APP_EDIT, _EDIT_ROLES)
