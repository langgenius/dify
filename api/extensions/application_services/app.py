from models.tool_runtime_contracts import WorkflowToolQueries
from services.tools.provider_queries import ToolProviders

"""Composition of App use cases."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.workflow import build_app_dsl_service
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.app.api_key_repository import AppApiKeyRepository
from repositories.app.console_repository import ConsoleAppRepository
from services.agent.roster_package_exporter import RosterAgentPackageExporter
from services.agent.roster_package_importer import RosterAgentPackageImporter
from services.api_token_service import ApiTokenCache
from services.app.api_key_service import AppApiKeyService
from services.app.console_gateway import AppLifecycleGateway, AppTransferGateway, EnterpriseConsoleAppAccess
from services.app.console_service import ConsoleAppService
from services.app.creators_platform_gateway import CreatorsPlatformGateway
from services.app.import_service import AppImportService
from services.app.query_service import AppQueryService
from services.app_package_service import AppPackageService
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.oauth_server_service import OAuthServerService
from services.recommended_app_package_service import RecommendedAppPackageService


@dataclass(frozen=True, slots=True)
class AppServices:
    imports: AppImportService
    console: ConsoleAppService
    queries: AppQueryService


def build_app_services(
    *,
    database_client: sessionmaker[Session],
    oauth: OAuthServerService,
    tool_providers: ToolProviders,
    workflow_queries: WorkflowToolQueries,
    recommended_packages: RecommendedAppPackageService,
) -> AppServices:
    repository = ConsoleAppRepository(session_factory=database_client)
    transfers = AppTransferGateway(
        session_factory=database_client,
        dsl_factory=build_app_dsl_service,
        packages=AppPackageService(),
        agent_packages=RosterAgentPackageExporter(),
        agent_importer=RosterAgentPackageImporter(),
        recommended_packages=recommended_packages,
    )
    return AppServices(
        imports=AppImportService(accounts=SQLAlchemyAccountRepository(database_client), definitions=transfers),
        console=ConsoleAppService(
            apps=repository,
            access=EnterpriseConsoleAppAccess(session_factory=database_client),
            transfers=transfers,
            creators=CreatorsPlatformGateway(oauth=oauth),
            tracing=OpsTraceManagerGateway(),
            lifecycle=AppLifecycleGateway(
                session_factory=database_client, tool_providers=tool_providers, workflow_queries=workflow_queries
            ),
        ),
        queries=AppQueryService(apps=repository),
    )


def build_app_api_key_service(*, database_client: sessionmaker[Session]) -> AppApiKeyService:
    return AppApiKeyService(
        keys=AppApiKeyRepository(session_factory=database_client),
        cache=ApiTokenCache,
    )
