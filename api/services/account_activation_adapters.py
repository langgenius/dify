"""Infrastructure gateways for account invitation activation."""

from collections.abc import Generator
from contextlib import contextmanager
from typing import override

from configs import dify_config
from core.db.session_factory import session_factory
from enums import DeploymentEdition
from libs.workspace_permission import check_workspace_member_invite_permission
from models.account import Account, Tenant
from services.account_activation_service import (
    AccountActivationEligibility,
    InvalidInvitationError,
    InvitationTokenStore,
    WorkspaceInvitePolicy,
)
from services.account_service import RegisterService, TenantService
from services.billing_service import BillingService
from services.enterprise.rbac_service import RBACService
from services.entities.account_activation_entities import AccountInvitation, InvitationLookup, InvitationToken
from services.errors.account import (
    CannotOperateSelfError,
    MemberNotInTenantError,
    NoPermissionError,
    WorkspaceMembersLimitExceededError,
)
from services.errors.enterprise import EnterpriseServiceError
from services.workspace_membership_lock import account_workspace_membership_mutation_lock


class RegisterServiceInvitationTokenStore(InvitationTokenStore):
    @override
    def find(self, invitation: InvitationLookup) -> InvitationToken | None:
        data = RegisterService.get_invitation_by_token(invitation.token)
        if data is None:
            return None
        if invitation.workspace_id is not None and data["workspace_id"] != invitation.workspace_id:
            return None
        if invitation.email is not None and data["email"].casefold() != invitation.email.casefold():
            return None
        return InvitationToken(
            token=invitation.token,
            account_id=data["account_id"],
            email=data["email"],
            workspace_id=data["workspace_id"],
            role=data["role"],
            inviter_id=data["inviter_id"],
            rbac_role_id=data.get("rbac_role_id"),
        )

    @override
    def revoke(self, token: str) -> None:
        RegisterService.revoke_token(token)


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
    with account_workspace_membership_mutation_lock(invitation.account_id, invitation.workspace_id):
        if not RegisterService.is_current_invitation(
            invitation.workspace_id,
            invitation.account_id,
            invitation.token,
        ):
            raise InvalidInvitationError
        with session_factory.create_session() as session:
            membership_exists = TenantService.account_belongs_to_tenant(
                invitation.account_id,
                invitation.workspace_id,
                session=session,
            )
            if not membership_exists:
                tenant = session.get(Tenant, invitation.workspace_id)
                inviter = session.get(Account, invitation.inviter_id)
                account = TenantService.get_membership_eligible_account(invitation.account_id, session=session)
                if tenant is None or inviter is None or account is None:
                    raise InvalidInvitationError
                try:
                    TenantService.check_member_permission(tenant, inviter, account, "add", session=session)
                except (CannotOperateSelfError, NoPermissionError) as exc:
                    raise InvalidInvitationError from exc
        if not membership_exists:
            TenantService.ensure_member_capacity(
                invitation.workspace_id,
                {invitation.account_id: invitation.account_email},
            )
        yield role
        if not membership_exists and dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            BillingService.clean_billing_info_cache(invitation.workspace_id)


@contextmanager
def assign_rbac_invitation_membership(invitation: AccountInvitation, _role: str) -> Generator[str]:
    if not invitation.rbac_role_id:
        raise InvalidInvitationError
    try:
        with RBACService.MemberRoles.invited_member_assignment_scope(
            invitation.workspace_id,
            invitation.inviter_id,
            invitation.account_id,
            invitation.rbac_role_id,
            invitation.token,
        ):
            yield "normal"
    except (WorkspaceMembersLimitExceededError, EnterpriseServiceError):
        raise
    except (MemberNotInTenantError, NoPermissionError, ValueError) as exc:
        raise InvalidInvitationError from exc
