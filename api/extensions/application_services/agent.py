"""Composition of the Agent App console use cases."""

from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums import CloudPlan, DeploymentEdition
from repositories.agent_observability_repository import SQLAlchemyAgentObservabilityRepository
from repositories.agent_roster_repository import SQLAlchemyAgentRosterRepository
from repositories.agent_version_repository import SQLAlchemyAgentVersionRepository
from repositories.app.agent_app_repository import AgentAppRepository
from repositories.app.agent_sandbox_repository import AgentSandboxRepository
from services.agent.invite_options import AgentInviteOptionsService
from services.agent.observability_contracts import AgentObservability
from services.agent.version_service import AgentVersionService
from services.app.agent_app_feature_gateway import AgentAppFeatureValidator
from services.app.agent_app_sandbox_service import AgentAppSandboxService
from services.app.agent_app_service import (
    AgentApiAccessService,
    AgentAppAccessService,
    AgentAppCollectionService,
    AgentAppDeletionService,
    AgentAppDetailService,
    AgentAppFeatureConfigService,
)
from services.app.agent_sandbox_file_gateway import AgentSandboxFileGateway, create_sandbox_client
from services.app.console_gateway import (
    AgentAppDetailPresentationGateway,
    AppLifecycleGateway,
    notify_agent_app_updated,
)
from services.feature_service import FeatureService
from services.file_request_service import FileRequestService
from services.rbac.agent_list_gateway import AgentListVisibilityGateway
from services.rbac.members import MemberService


@dataclass(frozen=True, slots=True)
class AgentAppServices:
    access: AgentAppAccessService
    api_access: AgentApiAccessService
    lifecycle: AgentAppDeletionService
    detail: AgentAppDetailService
    collection: AgentAppCollectionService
    features: AgentAppFeatureConfigService
    sandbox: AgentAppSandboxService


def _can_restore_version(tenant_id: str, *, edition: DeploymentEdition, get_plan: Callable[[str], CloudPlan]) -> bool:
    """Require a paid plan for Cloud restores; other editions do not query billing."""
    return edition != DeploymentEdition.CLOUD or get_plan(tenant_id).is_paid


def build_agent_app_services(
    *, database_client: sessionmaker[Session], rbac_members: MemberService
) -> AgentAppServices:
    apps = AgentAppRepository(session_factory=database_client)
    lifecycle = AppLifecycleGateway(session_factory=database_client)
    detail = AgentAppDetailService(
        runtime=lifecycle, presentation=AgentAppDetailPresentationGateway(members=rbac_members)
    )
    return AgentAppServices(
        access=AgentAppAccessService(references=apps),
        api_access=AgentApiAccessService(store=apps, notify_updated=notify_agent_app_updated),
        lifecycle=AgentAppDeletionService(lifecycle=lifecycle),
        detail=detail,
        collection=AgentAppCollectionService(
            store=apps,
            access=AgentListVisibilityGateway(members=rbac_members),
            creator=lifecycle,
            detail=detail,
        ),
        features=AgentAppFeatureConfigService(features=apps, validator=AgentAppFeatureValidator()),
        sandbox=AgentAppSandboxService(
            bindings=AgentSandboxRepository(session_factory=database_client, apps=apps),
            files=AgentSandboxFileGateway(
                client_factory=create_sandbox_client,
                file_requests=FileRequestService(),
                files_url=dify_config.FILES_URL,
            ),
        ),
    )


def build_agent_version_service(*, database_client: sessionmaker[Session]) -> AgentVersionService:
    """Wire roster version history with tenant-scoped storage and Cloud plan checks."""
    return AgentVersionService(
        store=SQLAlchemyAgentVersionRepository(session_factory=database_client),
        restore_allowed=lambda tenant_id: _can_restore_version(
            tenant_id, edition=dify_config.DEPLOYMENT_EDITION, get_plan=FeatureService.get_workspace_plan
        ),
    )


def build_agent_invite_options_service(
    *, database_client: sessionmaker[Session], rbac_members: MemberService
) -> AgentInviteOptionsService:
    """Wire the Agent directory query and its shared workspace visibility rules."""
    return AgentInviteOptionsService(
        store=SQLAlchemyAgentRosterRepository(session_factory=database_client),
        visibility=AgentListVisibilityGateway(members=rbac_members),
    )


def build_agent_observability(*, database_client: sessionmaker[Session]) -> AgentObservability:
    """Wire Agent runtime observability for both roster and workflow-only Agents."""
    return SQLAlchemyAgentObservabilityRepository(session_factory=database_client)
