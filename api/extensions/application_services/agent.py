"""Composition of the Agent App console use cases."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from repositories.app.agent_app_repository import AgentAppRepository
from repositories.app.agent_sandbox_repository import AgentSandboxRepository
from services.app.agent_app_feature_gateway import AgentAppFeatureValidator
from services.app.agent_app_sandbox_service import AgentAppSandboxService
from services.app.agent_app_service import AgentApiAccessService, AgentAppAccessService, AgentAppFeatureConfigService
from services.app.agent_sandbox_file_gateway import AgentSandboxFileGateway, create_sandbox_client
from services.app.console_gateway import notify_agent_app_updated
from services.file_request_service import FileRequestService


@dataclass(frozen=True, slots=True)
class AgentAppServices:
    access: AgentAppAccessService
    api_access: AgentApiAccessService
    features: AgentAppFeatureConfigService
    sandbox: AgentAppSandboxService


def build_agent_app_services(*, database_client: sessionmaker[Session]) -> AgentAppServices:
    apps = AgentAppRepository(session_factory=database_client)
    return AgentAppServices(
        access=AgentAppAccessService(references=apps),
        api_access=AgentApiAccessService(store=apps, notify_updated=notify_agent_app_updated),
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
