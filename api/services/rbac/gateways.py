"""Deployment, Enterprise and task adapters for workspace RBAC."""

from configs import dify_config
from enums import DeploymentEdition
from services.rbac import contracts as dto
from services.rbac.ports import CatalogGateway, ResourceAccessGateway, WorkspaceAccessGateway
from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task


class DeploymentRBACSettings:
    @property
    def enabled(self) -> bool:
        return dify_config.RBAC_ENABLED

    @property
    def billing_enabled(self) -> bool:
        return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD

    @property
    def dataset_operator_enabled(self) -> bool:
        return dify_config.DATASET_OPERATOR_ENABLED


class EnterpriseResourceAccessClients:
    def __init__(
        self,
        *,
        apps: ResourceAccessGateway,
        datasets: ResourceAccessGateway,
        agents: ResourceAccessGateway,
        workspace_apps: WorkspaceAccessGateway,
        workspace_datasets: WorkspaceAccessGateway,
        workspace_agents: WorkspaceAccessGateway,
        catalogs: CatalogGateway,
    ) -> None:
        self._resources = {
            dto.RBACResourceType.APP: apps,
            dto.RBACResourceType.DATASET: datasets,
            dto.RBACResourceType.AGENT: agents,
        }
        self._workspaces = {
            dto.RBACResourceType.APP: workspace_apps,
            dto.RBACResourceType.DATASET: workspace_datasets,
            dto.RBACResourceType.AGENT: workspace_agents,
        }
        self._catalogs = catalogs

    def resource(self, kind: dto.RBACResourceType) -> ResourceAccessGateway:
        return self._resources[kind]

    def workspace(self, kind: dto.RBACResourceType) -> WorkspaceAccessGateway:
        return self._workspaces[kind]

    def catalog(
        self, kind: dto.RBACResourceType, tenant_id: str, account_id: str, *, language: str | None
    ) -> dto.PermissionCatalogResponse:
        catalog = {
            dto.RBACResourceType.APP: self._catalogs.app,
            dto.RBACResourceType.DATASET: self._catalogs.dataset,
            dto.RBACResourceType.AGENT: self._catalogs.agent,
        }[kind]
        return catalog(tenant_id, account_id, language=language)


class CeleryAccessInitializer:
    def initialize(self, tenant_id: str, account_id: str, kind: dto.RBACResourceType, resource_id: str) -> None:
        initialize_created_app_rbac_access_task.delay(tenant_id, account_id, **{kind.route.id_param: resource_id})
