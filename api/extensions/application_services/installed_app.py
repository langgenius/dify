"""Composition of Installed App use cases."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from repositories.installed_app_message_repository import SQLAlchemyInstalledAppMessageRepository
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.conversation_name_service import ConversationNameService
from services.conversation_service import ConversationService
from services.installed_app_access_service import InstalledAppAccessService
from services.installed_app_conversation_service import InstalledAppConversationService, InstalledAppConversationStore
from services.installed_app_generation_adapters import AppGenerateServiceRuntime
from services.installed_app_generation_service import InstalledAppGenerationService
from services.installed_app_message_adapters import InstalledAppMessageRuntime, emit_installed_app_feedback
from services.installed_app_message_service import InstalledAppMessageService
from services.installed_app_service import InstalledAppService, WorkspaceRoleLookup
from services.webapp_access_query_service import WebAppAccessQueryService


@dataclass(frozen=True, slots=True)
class InstalledAppServices:
    access: InstalledAppAccessService
    management: InstalledAppService
    generation: InstalledAppGenerationService
    conversations: InstalledAppConversationService
    messages: InstalledAppMessageService


def build_installed_app_services(
    *,
    database_client: sessionmaker[Session],
    conversations: InstalledAppConversationStore,
    conversation_names: ConversationNameService,
    webapp_access: WebAppAccessQueryService,
    get_workspace_role: WorkspaceRoleLookup,
    webapp_auth_enabled: bool,
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
            conversations=conversations,
            names=conversation_names,
            enqueue_delete_cleanup=ConversationService.enqueue_delete_cleanup,
        ),
        messages=InstalledAppMessageService(
            messages=SQLAlchemyInstalledAppMessageRepository(session_factory=database_client),
            get_extra_contents=message_runtime.get_extra_contents,
            emit_feedback=emit_installed_app_feedback,
        ),
    )
