"""Workflow collaboration visibility and asset delivery adapters."""

from configs import dify_config
from graphon.file import helpers as file_helpers
from machinery.context import RequestContext
from services.app.access import resolve_app_access_filter
from services.app.console_service import ConsoleAppAccess
from services.rbac.members import MemberService


class WorkflowAccessGateway:
    def __init__(self, *, apps: ConsoleAppAccess, members: MemberService) -> None:
        self._apps = apps
        self._members = members

    def accessible_app_ids(self, context: RequestContext, maintainers: dict[str, str | None]) -> set[str]:
        if not dify_config.RBAC_ENABLED:
            return set(maintainers)
        permissions = self._members.permissions(context.active_workspace_id, context.account_id)
        access = resolve_app_access_filter(
            context.active_workspace_id,
            context.account_id,
            permissions=permissions,
        )
        return {
            app_id
            for app_id, maintainer in maintainers.items()
            if access.is_app_accessible(app_id, maintainer, context.account_id)
        }

    def permission_keys(self, context: RequestContext, app_id: str) -> list[str]:
        return self._apps.created_permissions(context, app_id)

    def avatar_url(self, avatar: str) -> str:
        return file_helpers.get_signed_file_url(avatar)
