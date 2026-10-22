"""Compose workspace use cases with the shared account and workspace repositories."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from core.plugin.impl.oauth import OAuthHandler
from extensions.ext_redis import RedisClientWrapper
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.trigger.oauth_client_repository import TriggerOAuthClientRepository
from repositories.workspace.resource_cleanup_repository import WorkspaceResourceCleanupRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.adapters import RedisInvitationTokenStore
from services.file_service import FileService
from services.trigger.oauth_client_service import TriggerOAuthClientService
from services.trigger.oauth_gateway import (
    OAuthProxyContextGateway,
    PluginTriggerOAuthGateway,
    TriggerOAuthBuilderGateway,
)
from services.trigger.oauth_service import TriggerOAuthService
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
    trigger_oauth_clients: TriggerOAuthClientService
    trigger_oauth: TriggerOAuthService


def build_workspace_membership_services(
    *,
    workspaces: WorkspaceRepository,
    accounts: SQLAlchemyAccountRepository,
) -> tuple[WorkspaceMemberService, WorkspaceProvisioningService]:
    """Build the workspace prerequisites shared by account registration and invitations."""
    members = WorkspaceMemberService(
        workspaces=workspaces,
        accounts=accounts,
        access=DeploymentWorkspaceMemberAccessGateway(),
    )
    provisioning = WorkspaceProvisioningService(
        owners=accounts,
        provisioning=workspaces,
        effects=WorkspaceProvisioningEffectsGateway(),
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
    trigger_providers = PluginTriggerOAuthGateway(oauth=OAuthHandler())
    trigger_oauth_clients = TriggerOAuthClientService(
        clients=TriggerOAuthClientRepository(session_factory=database_client),
        providers=trigger_providers,
    )
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
            invitations=WorkspaceInvitationGateway(tokens=invitation_tokens, redis=redis),
        ),
        identity=WorkspaceIdentityGateway(workspaces=workspaces),
        resource_cleanup=WorkspaceResourceCleanupService(
            session_factory=database_client,
            apps=ConsoleAppRepository(session_factory=database_client),
            datasets=SQLAlchemyDatasetRepository(session_factory=database_client),
            agent_resources=WorkspaceResourceCleanupRepository(session_factory=database_client),
        ),
        trigger_oauth_clients=trigger_oauth_clients,
        trigger_oauth=TriggerOAuthService(
            clients=trigger_oauth_clients,
            providers=trigger_providers,
            contexts=OAuthProxyContextGateway(),
            builders=TriggerOAuthBuilderGateway(),
        ),
    )
