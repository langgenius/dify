"""Composition of App use cases."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.app.api_key_repository import AppApiKeyRepository
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app.export_repository import AppExportRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.agent.roster_package_exporter import RosterAgentPackageExporter
from services.agent.roster_package_importer import RosterAgentPackageImporter
from services.api_token_service import ApiTokenCache
from services.app.api_key_service import AppApiKeyService
from services.app.console_gateway import AppLifecycleGateway, AppTransferGateway, EnterpriseConsoleAppAccess
from services.app.console_service import ConsoleAppService
from services.app.creators_platform_gateway import CreatorsPlatformGateway
from services.app.discovery_gateway import EnterpriseAppDiscoveryAccess
from services.app.export_service import AppExportService
from services.app.import_service import AppImportService
from services.app.query_service import AppDiscoveryService
from services.app_dsl_service import AppDslService
from services.app_package_service import AppPackageService
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.oauth_server_service import OAuthServerService
from services.rbac.members import MemberService
from services.recommended_app_package_service import RecommendedAppPackageService


@dataclass(frozen=True, slots=True)
class AppServices:
    imports: AppImportService
    exports: AppExportService
    discovery: AppDiscoveryService
    console: ConsoleAppService


def build_app_services(
    *,
    database_client: sessionmaker[Session],
    oauth: OAuthServerService,
    recommended_packages: RecommendedAppPackageService,
    repository: ConsoleAppRepository,
    rbac_members: MemberService,
) -> AppServices:
    transfers = AppTransferGateway(
        session_factory=database_client,
        dsl_factory=AppDslService,
        packages=AppPackageService(),
        agent_packages=RosterAgentPackageExporter(),
        agent_importer=RosterAgentPackageImporter(),
        recommended_packages=recommended_packages,
    )
    return AppServices(
        imports=AppImportService(accounts=SQLAlchemyAccountRepository(database_client), definitions=transfers),
        exports=AppExportService(
            apps=AppExportRepository(session_factory=database_client), serialize=AppDslService.serialize_export_data
        ),
        discovery=AppDiscoveryService(
            apps=repository,
            workspaces=WorkspaceRepository(database_client),
            access=EnterpriseAppDiscoveryAccess(),
        ),
        console=ConsoleAppService(
            apps=repository,
            access=EnterpriseConsoleAppAccess(members=rbac_members),
            transfers=transfers,
            creators=CreatorsPlatformGateway(oauth=oauth),
            tracing=OpsTraceManagerGateway(),
            lifecycle=AppLifecycleGateway(session_factory=database_client),
        ),
    )


def build_app_api_key_service(*, database_client: sessionmaker[Session]) -> AppApiKeyService:
    return AppApiKeyService(
        keys=AppApiKeyRepository(session_factory=database_client),
        cache=ApiTokenCache,
    )
