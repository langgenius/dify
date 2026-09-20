"""Compose workspace use cases with the shared account and workspace repositories."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.workspace.workspace_member_query_repository import WorkspaceMemberQueryRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.adapters import RedisInvitationTokenStore
from services.file_service import FileService
from services.workspace.gateways import (
    DeploymentWorkspaceCreationPolicy,
    DeploymentWorkspaceFeatureGateway,
    DeploymentWorkspaceMemberAccessGateway,
    DeploymentWorkspaceMemberRoleResolver,
    DeploymentWorkspacePlanGateway,
    WorkspaceFileGateway,
    WorkspaceIdentityGateway,
    WorkspaceInvitationGateway,
    WorkspaceOwnerTransferGateway,
    WorkspaceProvisioningEffectsGateway,
)
from services.workspace.member_service import (
    InvitedAccountRegistration,
    WorkspaceInvitationService,
    WorkspaceMemberQueryService,
    WorkspaceMemberService,
    WorkspaceOwnerTransferService,
)
from services.workspace.provisioning_service import WorkspaceProvisioningService
from services.workspace.service import WorkspaceQueryService, WorkspaceService


@dataclass(frozen=True, slots=True)
class WorkspaceServices:
    queries: WorkspaceQueryService
    management: WorkspaceService
    provisioning: WorkspaceProvisioningService
    members: WorkspaceMemberService
    member_queries: WorkspaceMemberQueryService
    owner_transfer: WorkspaceOwnerTransferService
    invitations: WorkspaceInvitationService
    identity: WorkspaceIdentityGateway


def build_workspace_membership_services(
    *,
    database_client: sessionmaker[Session],
    workspaces: WorkspaceRepository,
    accounts: SQLAlchemyAccountRepository,
) -> tuple[WorkspaceMemberService, WorkspaceProvisioningService]:
    """Build the workspace prerequisites shared by account registration and invitations."""
    members = WorkspaceMemberService(
        workspaces=workspaces,
        accounts=accounts,
        access=DeploymentWorkspaceMemberAccessGateway(session_factory=database_client),
    )
    provisioning = WorkspaceProvisioningService(
        owners=accounts,
        provisioning=workspaces,
        effects=WorkspaceProvisioningEffectsGateway(session_factory=database_client),
        policies=DeploymentWorkspaceCreationPolicy(),
        memberships=workspaces,
        members=members,
    )
    return members, provisioning


def build_workspace_services(
    *,
    database_client: sessionmaker[Session],
    workspaces: WorkspaceRepository,
    accounts: SQLAlchemyAccountRepository,
    files: FileService,
    redis: RedisClientWrapper,
    members: WorkspaceMemberService,
    provisioning: WorkspaceProvisioningService,
    registration: InvitedAccountRegistration,
    invitation_tokens: RedisInvitationTokenStore,
) -> WorkspaceServices:
    return WorkspaceServices(
        queries=WorkspaceQueryService(workspaces=workspaces, plans=DeploymentWorkspacePlanGateway()),
        management=WorkspaceService(
            workspaces=workspaces,
            features=DeploymentWorkspaceFeatureGateway(),
            logos=WorkspaceFileGateway(files=files),
        ),
        provisioning=provisioning,
        members=members,
        member_queries=WorkspaceMemberQueryService(
            members=WorkspaceMemberQueryRepository(session_factory=database_client),
            roles=DeploymentWorkspaceMemberRoleResolver(),
        ),
        owner_transfer=WorkspaceOwnerTransferService(
            accounts=accounts,
            workspaces=workspaces,
            members=members,
            challenges=WorkspaceOwnerTransferGateway(redis=redis),
        ),
        invitations=WorkspaceInvitationService(
            accounts=registration,
            workspaces=workspaces,
            members=members,
            invitations=WorkspaceInvitationGateway(tokens=invitation_tokens, redis=redis),
        ),
        identity=WorkspaceIdentityGateway(workspaces=workspaces),
    )
