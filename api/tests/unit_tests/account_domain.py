"""Account test composition with real persistence and explicit external ports."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from unittest.mock import Mock, create_autospec

from sqlalchemy.orm import Session, sessionmaker

from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.login_service import AccountSessionGateway, ConsoleAuthSecurityGateway
from services.account.service import AccountLifecyclePolicy, AccountService
from services.account_password_hasher import DefaultAccountPasswordHasher
from services.workspace.gateways import WorkspaceProvisioningEffectsGateway
from services.workspace.member_service import (
    WorkspaceInvitationDelivery,
    WorkspaceInvitationService,
    WorkspaceMemberAccessGateway,
    WorkspaceMemberService,
)
from services.workspace.provisioning_service import WorkspaceCreationPolicy, WorkspaceProvisioningService
from services.workspace.quota import (
    DeploymentQuotaSnapshot,
    WorkspaceMemberQuotaGateway,
    WorkspaceMemberQuotaSnapshot,
)


class AccountWorkspacePolicy(AccountLifecyclePolicy, WorkspaceCreationPolicy, Protocol):
    pass


@dataclass
class AccountDomain:
    accounts: AccountService
    members: WorkspaceMemberService
    provisioning: WorkspaceProvisioningService
    invitations: WorkspaceInvitationService
    repository: SQLAlchemyAccountRepository
    workspaces: WorkspaceRepository
    policy: Mock
    access: Mock
    delivery: Mock
    member_quotas: Mock
    sessions: Mock
    security: Mock


def build_account_domain(session_factory: sessionmaker[Session]) -> AccountDomain:
    repository = SQLAlchemyAccountRepository(session_factory)
    workspaces = WorkspaceRepository(session_factory)
    policy = create_autospec(AccountWorkspacePolicy, instance=True)
    policy.is_registration_allowed.return_value = True
    policy.is_workspace_creation_allowed.return_value = True
    policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(
        seat_limit=None,
        seat_usage=0,
        workspace_limit=None,
        workspace_usage=0,
    )
    policy.get_email_freeze_type.return_value = None
    policy.validate_timezone.side_effect = lambda timezone: timezone
    access = create_autospec(WorkspaceMemberAccessGateway, instance=True)
    access.rbac_enabled = False
    access.permission_keys.return_value = {"workspace.member.manage", "workspace.role.manage"}
    access.is_owner.return_value = False
    member_quotas = create_autospec(WorkspaceMemberQuotaGateway, instance=True)
    member_quotas.snapshot.return_value = WorkspaceMemberQuotaSnapshot(None, 0, None, 0)
    members = WorkspaceMemberService(
        workspaces=workspaces,
        accounts=repository,
        access=access,
        quotas=member_quotas,
    )
    provisioning = WorkspaceProvisioningService(
        owners=repository,
        provisioning=workspaces,
        effects=WorkspaceProvisioningEffectsGateway(),
        policies=policy,
        memberships=workspaces,
        members=members,
    )
    sessions = create_autospec(AccountSessionGateway, instance=True)
    security = create_autospec(ConsoleAuthSecurityGateway, instance=True)
    accounts = AccountService(
        accounts=repository,
        policies=policy,
        passwords=DefaultAccountPasswordHasher(),
        workspaces=provisioning,
        sessions=sessions,
        security=security,
        now=lambda: datetime(2026, 1, 1),
    )
    delivery = create_autospec(WorkspaceInvitationDelivery, instance=True)
    delivery.requires_capacity_check = False
    delivery.create.return_value = "invitation-token"
    invitations = WorkspaceInvitationService(
        accounts=accounts, workspaces=workspaces, members=members, invitations=delivery
    )
    return AccountDomain(
        accounts,
        members,
        provisioning,
        invitations,
        repository,
        workspaces,
        policy,
        access,
        delivery,
        member_quotas,
        sessions,
        security,
    )
