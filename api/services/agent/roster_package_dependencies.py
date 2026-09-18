"""Preflight plugin availability and installation permission for package imports."""

from werkzeug.exceptions import Forbidden

from configs import dify_config
from core.db.session_factory import session_factory
from core.plugin.entities.plugin import PluginDependency
from core.rbac import RBACPermission
from models import Account
from models.account import TenantPluginInstallPermission
from services.agent.errors import RosterAgentPackageDependenciesMissingError
from services.enterprise.rbac_service import RBACService
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from services.plugin.plugin_permission_service import PluginPermissionService


def check_package_dependencies(*, tenant_id: str, account: Account, dependencies: list[PluginDependency]) -> None:
    if not dependencies:
        return
    missing = DependenciesAnalysisService.get_leaked_dependencies(tenant_id=tenant_id, dependencies=dependencies)
    if not missing:
        return
    if dify_config.RBAC_ENABLED:
        allowed = RBACService.CheckAccess.check(
            tenant_id, account.id, scene=RBACPermission.PLUGIN_INSTALL, resource_type=None, resource_id=None
        )
        if not allowed:
            raise Forbidden("Plugin installation permission is required to import this Agent package")
    else:
        with session_factory.create_session() as session:
            permission = PluginPermissionService.get_permission(tenant_id, session=session)
            install_permission = permission.install_permission if permission is not None else None
        if install_permission == TenantPluginInstallPermission.NOBODY or (
            install_permission == TenantPluginInstallPermission.ADMINS and not account.is_admin_or_owner
        ):
            raise Forbidden("Plugin installation permission is required to import this Agent package")
    error = RosterAgentPackageDependenciesMissingError()
    assert error.data is not None
    error.data["leaked_dependencies"] = [item.model_dump(mode="json") for item in missing]
    raise error
