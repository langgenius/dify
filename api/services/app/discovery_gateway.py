"""Enterprise visibility adapter for app discovery."""

from typing import override

from configs import dify_config
from machinery.context import RequestContext
from services.app.access import AppAccessFilter, app_access_filter_from_permissions
from services.app.query_service import AppDiscoveryAccess, AppDiscoveryQuery
from services.enterprise.app_permitted_service import list_permitted_apps
from services.enterprise.rbac_service import RBACService
from services.entities.app_entities import PermittedAppsPage


class EnterpriseAppDiscoveryAccess(AppDiscoveryAccess):
    @override
    def visibility(self, context: RequestContext) -> AppAccessFilter:
        if not dify_config.RBAC_ENABLED:
            return AppAccessFilter.unrestricted()
        permissions = RBACService.MyPermissions.get(context.active_workspace_id, context.account_id)
        whitelist = RBACService.AppAccess.whitelist_resources(context.active_workspace_id, context.account_id)
        return app_access_filter_from_permissions(permissions, whitelist)

    @override
    def permitted_apps(self, query: AppDiscoveryQuery) -> PermittedAppsPage:
        return list_permitted_apps(page=query.page, limit=query.limit, mode=query.mode, name=query.name)
