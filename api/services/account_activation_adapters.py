"""Infrastructure gateways for account invitation activation."""

from typing import override

from libs.workspace_permission import check_workspace_member_invite_permission
from services.account_activation_service import (
    AccountActivationEligibility,
    InvitationTokenStore,
    WorkspaceInvitePolicy,
    WorkspaceMembershipCache,
)
from services.account_service import RegisterService
from services.billing_service import BillingService
from services.entities.account_activation_entities import InvitationLookup, InvitationToken


class RegisterServiceInvitationTokenStore(InvitationTokenStore):
    """Compatibility adapter around the existing Redis invitation token owner."""

    @override
    def find(self, invitation: InvitationLookup) -> InvitationToken | None:
        data = RegisterService.get_invitation_by_token(
            invitation.token,
            invitation.workspace_id,
            invitation.email,
        )
        if data is None:
            return None
        return InvitationToken(
            account_id=data["account_id"],
            email=data["email"],
            workspace_id=data["workspace_id"],
            role=data.get("role"),
            requires_setup=data.get("requires_setup"),
        )

    @override
    def revoke(self, invitation: InvitationLookup) -> None:
        RegisterService.revoke_token(
            invitation.workspace_id,
            invitation.email,
            invitation.token,
        )


class DeploymentWorkspaceInvitePolicy(WorkspaceInvitePolicy):
    @override
    def ensure_allowed(self, workspace_id: str) -> None:
        check_workspace_member_invite_permission(workspace_id)


class BillingAccountActivationEligibility(AccountActivationEligibility):
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled

    @override
    def get_freeze_type(self, email: str) -> str | None:
        if not self._enabled:
            return None
        return BillingService.get_email_freeze_type(email)


class BillingWorkspaceMembershipCache(WorkspaceMembershipCache):
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled

    @override
    def invalidate(self, workspace_id: str) -> None:
        if self._enabled:
            BillingService.clean_billing_info_cache(workspace_id)
