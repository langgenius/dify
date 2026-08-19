"""Infrastructure gateways for account invitation activation."""

from collections.abc import Generator
from contextlib import contextmanager
from typing import override

from core.db.session_factory import session_factory
from libs.workspace_permission import check_workspace_member_invite_permission
from services.account_activation_service import (
    AccountActivationEligibility,
    InvalidInvitationError,
    InvitationTokenStore,
    WorkspaceInvitePolicy,
    WorkspaceMemberCapacityExceededError,
)
from services.account_service import RegisterService, TenantService
from services.billing_service import BillingService
from services.enterprise.rbac_service import RBACService
from services.entities.account_activation_entities import AccountInvitation, InvitationLookup, InvitationToken
from services.errors.account import MemberNotInTenantError, NoPermissionError, WorkspaceMembersLimitExceededError
from services.errors.enterprise import EnterpriseServiceError
from services.workspace_membership_lock import workspace_membership_mutation_lock


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
            rbac_role_id=data.get("rbac_role_id"),
            inviter_id=data.get("inviter_id"),
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
    def is_frozen(self, email: str) -> bool:
        return self._enabled and BillingService.is_email_in_freeze(email)


@contextmanager
def assign_legacy_invitation_membership(invitation: AccountInvitation, role: str) -> Generator[str]:
    with workspace_membership_mutation_lock(invitation.workspace_id):
        with session_factory.create_session() as session:
            membership_exists = TenantService.account_belongs_to_tenant(
                invitation.account_id,
                invitation.workspace_id,
                session=session,
            )
        if not membership_exists:
            try:
                TenantService.ensure_member_capacity(invitation.workspace_id)
            except WorkspaceMembersLimitExceededError as exc:
                raise WorkspaceMemberCapacityExceededError from exc
        yield role


@contextmanager
def assign_rbac_invitation_membership(invitation: AccountInvitation, _role: str) -> Generator[str]:
    if not invitation.rbac_role_id or not invitation.inviter_id:
        raise InvalidInvitationError
    try:
        with RBACService.MemberRoles.invited_member_assignment_scope(
            invitation.workspace_id,
            invitation.inviter_id,
            invitation.account_id,
            invitation.rbac_role_id,
        ):
            yield "normal"
    except WorkspaceMembersLimitExceededError as exc:
        raise WorkspaceMemberCapacityExceededError from exc
    except EnterpriseServiceError:
        raise
    except (MemberNotInTenantError, NoPermissionError, ValueError) as exc:
        raise InvalidInvitationError from exc
