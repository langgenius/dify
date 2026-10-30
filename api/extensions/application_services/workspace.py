"""Compose workspace use cases with the shared account and workspace repositories."""

from dataclasses import dataclass
from functools import partial

from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.workspace.resource_cleanup_repository import WorkspaceResourceCleanupRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.adapters import RedisInvitationTokenStore
from services.api_token_service import ApiTokenCache
from services.file_service import FileService
from services.workspace.gateways import (
    DeploymentWorkspaceCreationPolicy,
    DeploymentWorkspaceFeatureGateway,
    DeploymentWorkspaceMemberAccessGateway,
    DeploymentWorkspaceMemberRoleResolver,
    DeploymentWorkspacePlanGateway,
    RedisWorkspaceQuotaGuard,
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
from services.workspace.resource_cleanup_service import WorkspaceResourceCleanupService
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
    resource_cleanup: WorkspaceResourceCleanupService


def build_workspace_membership_services(
    *,
    workspaces: WorkspaceRepository,
    accounts: SQLAlchemyAccountRepository,
    redis: RedisClientWrapper,
) -> tuple[WorkspaceMemberService, WorkspaceProvisioningService]:
    """Build the workspace prerequisites shared by account registration and invitations."""
    members = WorkspaceMemberService(
        workspaces=workspaces,
        accounts=accounts,
        access=DeploymentWorkspaceMemberAccessGateway(invitations=RedisInvitationTokenStore(redis=redis)),
    )
    provisioning = WorkspaceProvisioningService(
        owners=accounts,
        provisioning=workspaces,
        effects=WorkspaceProvisioningEffectsGateway(),
        policies=DeploymentWorkspaceCreationPolicy(),
        quota_guard=RedisWorkspaceQuotaGuard(redis=redis),
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
    invitation_gateway: WorkspaceInvitationGateway,
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
            members=workspaces,
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
            invitations=invitation_gateway,
        ),
        identity=WorkspaceIdentityGateway(workspaces=workspaces),
        resource_cleanup=WorkspaceResourceCleanupService(
            session_factory=database_client,
            apps=ConsoleAppRepository(session_factory=database_client),
            datasets=SQLAlchemyDatasetRepository(
                session_factory=database_client,
                revoke_keys_after_commit=partial(ApiTokenCache.delete_after_commit, scope="dataset"),
            ),
            agent_resources=WorkspaceResourceCleanupRepository(session_factory=database_client),
        ),
    )
