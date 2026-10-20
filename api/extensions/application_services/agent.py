"""Composition of the Agent App console use cases."""

from dataclasses import dataclass
from functools import partial

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from repositories.app.agent_app_repository import AgentAppRepository
from repositories.app.agent_sandbox_repository import AgentSandboxRepository
from repositories.app.generation_repository import AppGenerationRepository
from repositories.tools.provider_repository import ToolProviderRepository
from services.agent.log_file_gateway import AgentLogFileGateway
from services.agent.log_service import AgentLogService
from services.app.agent_app_feature_gateway import AgentAppFeatureValidator
from services.app.agent_app_sandbox_service import AgentAppSandboxService
from services.app.agent_app_service import AgentAppAccessService, AgentAppFeatureConfigService
from services.app.agent_sandbox_file_gateway import AgentSandboxFileGateway, create_sandbox_client
from services.file_request_service import FileRequestService
from services.tools.tool_manager import ToolManager


@dataclass(frozen=True, slots=True)
class AgentAppServices:
    logs: AgentLogService
    access: AgentAppAccessService
    features: AgentAppFeatureConfigService
    sandbox: AgentAppSandboxService


def build_agent_app_services(*, database_client: sessionmaker[Session]) -> AgentAppServices:
    apps = AgentAppRepository(session_factory=database_client)
    return AgentAppServices(
        logs=AgentLogService(
            records=AppGenerationRepository(database_client),
            icons=partial(ToolManager.get_tool_icon, tool_providers=ToolProviderRepository(database_client)),
            files=AgentLogFileGateway(sessions=database_client, access=DatabaseFileAccessController()),
        ),
        access=AgentAppAccessService(references=apps),
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
