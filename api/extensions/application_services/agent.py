"""Composition of the Agent App console use cases."""

from collections.abc import Callable
from dataclasses import dataclass
from functools import partial

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from enums import CloudPlan, DeploymentEdition
from extensions.application_services.workflow import build_workflow_execution_dependencies
from repositories.agent_observability_repository import SQLAlchemyAgentObservabilityRepository
from repositories.agent_roster_repository import SQLAlchemyAgentRosterRepository
from repositories.agent_version_repository import SQLAlchemyAgentVersionRepository
from repositories.app.agent_app_repository import AgentAppRepository
from repositories.app.agent_sandbox_repository import AgentSandboxRepository
from repositories.app.generation_repository import AppGenerationRepository
from repositories.tools.provider_repository import ToolProviderRepository
from repositories.tools.workflow_repository import WorkflowToolRepository
from services.agent.invite_options import AgentInviteOptionsService
from services.agent.log_file_gateway import AgentLogFileGateway
from services.agent.log_service import AgentLogService
from services.agent.observability_contracts import AgentObservability
from services.agent.tool_invocation_service import AgentToolInnerService
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
from services.app.response_gateway import AppResponseGateway
from services.feature_service import FeatureService
from services.file_request_service import FileRequestService
from services.rbac.agent_list_gateway import AgentListVisibilityGateway
from services.rbac.members import MemberService
from services.tools.agent_invocation_gateway import AgentToolInvocationGateway
from services.tools.tool_manager import ToolManager
from services.workflow.variable_contracts import WorkflowExecutionVariables


@dataclass(frozen=True, slots=True)
class AgentAppServices:
    access: AgentAppAccessService
    api_access: AgentApiAccessService
    lifecycle: AgentAppDeletionService
    detail: AgentAppDetailService
    collection: AgentAppCollectionService
    features: AgentAppFeatureConfigService
    sandbox: AgentAppSandboxService
    tools: AgentToolInnerService
    logs: AgentLogService


def _can_restore_version(tenant_id: str, *, edition: DeploymentEdition, get_plan: Callable[[str], CloudPlan]) -> bool:
    """Require a paid plan for Cloud restores; other editions do not query billing."""
    return edition != DeploymentEdition.CLOUD or get_plan(tenant_id).is_paid


def build_agent_app_services(
    *, database_client: sessionmaker[Session], rbac_members: MemberService, variables: WorkflowExecutionVariables
) -> AgentAppServices:
    apps = AgentAppRepository(session_factory=database_client)
    providers = ToolProviderRepository(database_client)
    workflow_tools = WorkflowToolRepository(database_client)
    lifecycle = AppLifecycleGateway(
        session_factory=database_client, tool_providers=providers, workflow_queries=workflow_tools
    )
    detail = AgentAppDetailService(
        runtime=lifecycle,
        presentation=AgentAppDetailPresentationGateway(
            members=rbac_members, responses=AppResponseGateway(providers, workflow_tools)
        ),
    )
    return AgentAppServices(
        logs=AgentLogService(
            records=AppGenerationRepository(database_client),
            icons=partial(ToolManager.get_tool_icon, tool_providers=providers),
            files=AgentLogFileGateway(sessions=database_client, access=DatabaseFileAccessController()),
        ),
        tools=AgentToolInnerService(
            apps=apps,
            tools=AgentToolInvocationGateway(
                variables=variables, runtime=build_workflow_execution_dependencies(database_client)
            ),
        ),
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
