from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from http import HTTPStatus

from flask import Response, abort
from werkzeug.exceptions import Forbidden

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


def require_admin_or_owner[**P, R](view: Callable[P, R]) -> Callable[P, R | Response]:
    """Apply the complete Console workspace owner/administrator guard stack."""

    @wraps(view)
    def admin_or_owner_required(*args: P.args, **kwargs: P.kwargs) -> R:
        from libs.login import current_user

        user = current_user._get_current_object()
        # Keep this check synchronized with the non-RBAC branch in
        # controllers.console.wraps.is_admin_or_owner_required.
        # TODO(QuantumGhost): Introduce RBAC authorization for Human Input channel management.
        if not isinstance(user, Account) or not TenantAccountRole.is_privileged_role(user.role):
            raise Forbidden()
        return view(*args, **kwargs)

    return setup_required(
        login_required(
            account_initialization_required(
                admin_or_owner_required,
            )
        )
    )


def require_editor[**P, R](view: Callable[P, R]) -> Callable[P, R | Response]:
    """Require an editing workspace role independently of RBAC configuration."""

    @wraps(view)
    def editor_required(*args: P.args, **kwargs: P.kwargs) -> R:
        from libs.login import current_user

        user = current_user._get_current_object()
        # Contact selection follows workspace roles even when RBAC is enabled.
        if not isinstance(user, Account) or not TenantAccountRole.is_editing_role(user.role):
            raise Forbidden()
        return view(*args, **kwargs)

    return setup_required(login_required(account_initialization_required(editor_required)))


__all__ = ["require_admin_or_owner", "require_editor", "workspace_channel_api_admission"]
