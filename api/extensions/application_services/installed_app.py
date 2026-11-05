"""Composition of Installed App use cases."""

from dataclasses import dataclass

from flask import current_app
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth import PluginCredentialAuthClient
from core.app.entities.app_invoke_entities import InvokeFrom
from repositories.credentials.query_repository import CredentialQueryRepository
from repositories.installed_app_connection_repository import SQLAlchemyInstalledConnectionRepository
from repositories.installed_app_conversation_repository import SQLAlchemyInstalledAppConversationRepository
from repositories.installed_app_message_repository import SQLAlchemyInstalledAppMessageRepository
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.conversation_service import ConversationService
from services.end_user_connection_adapters import PluginApiKeyCredentialGateway
from services.installed_app_access_service import InstalledAppAccessService
from services.installed_app_connections import InstalledAppConnectionService
from services.installed_app_conversation_service import InstalledAppConversationService
from services.installed_app_generation_adapters import AppGenerateServiceRuntime
from services.installed_app_generation_service import InstalledAppGenerationService
from services.installed_app_message_adapters import InstalledAppMessageRuntime, emit_installed_app_feedback
from services.installed_app_message_service import InstalledAppMessageService
from services.installed_app_service import InstalledAppService, WorkspaceRoleLookup
from services.webapp_access_query_service import WebAppAccessQueryService
from services.workflow_test_credential_adapters import DraftTestCredentialPlanner, WorkspaceTestCredentialGateway


@dataclass(frozen=True, slots=True)
class InstalledAppServices:
    access: InstalledAppAccessService
    management: InstalledAppService
    generation: InstalledAppGenerationService
    conversations: InstalledAppConversationService
    messages: InstalledAppMessageService
    connections: InstalledAppConnectionService


def _generate_installed_app_conversation_name(
    *, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str
) -> str:
    # Legacy provider and tracing lookups use db.session. Give them their own
    # scope so teardown releases it before the conversation write transaction,
    # without removing a session owned by the surrounding request.
    with current_app.app_context():
        return ConversationService.generate_name(
            tenant_id=tenant_id, app_id=app_id, conversation_id=conversation_id, query=query, app_mode=app_mode
        )


def build_installed_app_services(
    *,
    database_client: sessionmaker[Session],
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
    message_runtime = InstalledAppMessageRuntime(session_factory=database_client)
    return InstalledAppServices(
        connections=InstalledAppConnectionService(
            store=SQLAlchemyInstalledConnectionRepository(session_factory=database_client),
            access=access,
            definitions=app_definitions,
            planner=DraftTestCredentialPlanner(),
            providers=PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient()),
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
            conversations=SQLAlchemyInstalledAppConversationRepository(session_factory=database_client),
            generate_name=_generate_installed_app_conversation_name,
            enqueue_delete_cleanup=ConversationService.enqueue_delete_cleanup,
        ),
        messages=InstalledAppMessageService(
            messages=SQLAlchemyInstalledAppMessageRepository(session_factory=database_client),
            get_extra_contents=message_runtime.get_extra_contents,
            emit_feedback=emit_installed_app_feedback,
        ),
    )
