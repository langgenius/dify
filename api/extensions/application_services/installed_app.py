"""Composition of Installed App use cases."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth import PluginCredentialAuthClient
from core.app.entities.app_invoke_entities import InvokeFrom
from repositories.credentials.query_repository import CredentialQueryRepository
from repositories.installed_app_connection_repository import SQLAlchemyInstalledConnectionRepository
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.conversation_command_service import ConversationCommandService
from services.conversation_name_service import ConversationNameService
from services.conversation_query_service import ConversationQueryService
from services.installed_app_access_service import InstalledAppAccessService
from services.installed_app_connections import InstalledAppConnectionService
from services.installed_app_conversation_service import InstalledAppConversationService
from services.installed_app_generation_adapters import AppGenerateServiceRuntime
from services.installed_app_generation_service import InstalledAppGenerationService
from services.installed_app_service import InstalledAppService, WorkspaceRoleLookup
from services.webapp_access_query_service import WebAppAccessQueryService
from services.workflow_test_credential_adapters import WorkspaceTestCredentialGateway


@dataclass(frozen=True, slots=True)
class InstalledAppServices:
    access: InstalledAppAccessService
    management: InstalledAppService
    generation: InstalledAppGenerationService
    conversations: InstalledAppConversationService
    connections: InstalledAppConnectionService


def build_installed_app_services(
    *,
    database_client: sessionmaker[Session],
    conversation_queries: ConversationQueryService,
    conversation_names: ConversationNameService,
    conversation_commands: ConversationCommandService,
    webapp_access: WebAppAccessQueryService,
    get_workspace_role: WorkspaceRoleLookup,
    webapp_auth_enabled: bool,
    app_definitions: AppDefinitionQueryService,
) -> InstalledAppServices:
    installed_apps = SQLAlchemyInstalledAppRepository(session_factory=database_client)
    access = InstalledAppAccessService(
        installed_apps=installed_apps,
        is_user_allowed=webapp_access.is_user_allowed,
        get_access_modes=webapp_access.batch_get_access_modes,
        get_user_permissions=webapp_access.batch_get_user_permissions,
    )
    return InstalledAppServices(
        connections=InstalledAppConnectionService(
            store=SQLAlchemyInstalledConnectionRepository(session_factory=database_client),
            access=access,
            definitions=app_definitions,
            credentials=WorkspaceTestCredentialGateway(
                queries=CredentialQueryRepository(session_factory=database_client),
                auth=PluginCredentialAuthClient(),
                invoke_from=InvokeFrom.EXPLORE,
            ),
        ),
        access=access,
        management=InstalledAppService(
            installed_apps=installed_apps,
            get_workspace_role=get_workspace_role,
            get_visible_app_ids=access.get_visible_app_ids if webapp_auth_enabled else None,
        ),
        generation=InstalledAppGenerationService(
            usage=installed_apps,
            runtime=AppGenerateServiceRuntime(session_factory=database_client),
        ),
        conversations=InstalledAppConversationService(
            queries=conversation_queries,
            names=conversation_names,
            commands=conversation_commands,
        ),
    )
