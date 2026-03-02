"""
Workspace permission helper functions.

These helpers check both billing/plan level and workspace-specific policy level permissions.
Checks are performed at two levels:
1. Billing/plan level - via FeatureService (e.g., SANDBOX plan restrictions)
2. Workspace policy level - via EnterpriseService (admin-configured per workspace)
"""

import logging

from werkzeug.exceptions import Forbidden

from configs import dify_config
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


def check_workspace_member_invite_permission(workspace_id: str) -> None:
    """
    Check if workspace allows member invitations at both billing and policy levels.

    Checks performed:
    1. Billing/plan level - For future expansion (currently no plan-level restriction)
    2. Enterprise policy level - Admin-configured workspace permission

    Args:
        workspace_id: The workspace ID to check permissions for

    Raises:
        Forbidden: If either billing plan or workspace policy prohibits member invitations
    """
    # Check enterprise workspace policy level (only if enterprise enabled)
    if dify_config.ENTERPRISE_ENABLED:
        try:
            permission = EnterpriseService.WorkspacePermissionService.get_permission(workspace_id)
            if not permission.allow_member_invite:
                raise Forbidden("Workspace policy prohibits member invitations")
        except Forbidden:
            raise
        except Exception:
            logger.exception("Failed to check workspace invite permission for %s", workspace_id)


def check_workspace_owner_transfer_permission(workspace_id: str) -> None:
    """
    Check if workspace allows owner transfer at both billing and policy levels.

    Checks performed:
    1. Billing/plan level - SANDBOX plan blocks owner transfer
    2. Enterprise policy level - Admin-configured workspace permission

    Args:
        workspace_id: The workspace ID to check permissions for

    Raises:
        Forbidden: If either billing plan or workspace policy prohibits ownership transfer
    """
    features = FeatureService.get_features(workspace_id)
    if not features.is_allow_transfer_workspace:
        raise Forbidden("Your current plan does not allow workspace ownership transfer")

    # Check enterprise workspace policy level (only if enterprise enabled)
    if dify_config.ENTERPRISE_ENABLED:
        try:
            permission = EnterpriseService.WorkspacePermissionService.get_permission(workspace_id)
            if not permission.allow_owner_transfer:
                raise Forbidden("Workspace policy prohibits ownership transfer")
        except Forbidden:
            raise
        except Exception:
            logger.exception("Failed to check workspace transfer permission for %s", workspace_id)
