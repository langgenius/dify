"""Workflow collaboration visibility and asset delivery adapters."""

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from graphon.file import helpers as file_helpers
from machinery.context import RequestContext
from services.app.access import resolve_app_access_filter
from services.app.console_service import ConsoleAppAccess


class WorkflowAccessGateway:
    def __init__(self, *, session_factory: sessionmaker[Session], apps: ConsoleAppAccess) -> None:
        self._sessions = session_factory
        self._apps = apps

    def accessible_app_ids(self, context: RequestContext, maintainers: dict[str, str | None]) -> set[str]:
        if not dify_config.RBAC_ENABLED:
            return set(maintainers)
        with self._sessions() as session:
            access = resolve_app_access_filter(context.active_workspace_id, context.account_id, session=session)
        return {
            app_id
            for app_id, maintainer in maintainers.items()
            if access.is_app_accessible(app_id, maintainer, context.account_id)
        }

    def permission_keys(self, context: RequestContext, app_id: str) -> list[str]:
        return self._apps.created_permissions(context, app_id)

    def avatar_url(self, avatar: str) -> str:
        return file_helpers.get_signed_file_url(avatar)
