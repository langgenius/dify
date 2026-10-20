"""Compose RBAC use cases with the existing workspace, app and dataset repositories."""

from dataclasses import dataclass

from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.enterprise import rbac_service as enterprise
from services.rbac.gateways import (
    CeleryAccessInitializer,
    DeploymentRBACSettings,
    EnterpriseResourceAccessClients,
)
from services.rbac.members import MemberService
from services.rbac.policies import PolicyService
from services.rbac.resource_queries import ResourceQueryService
from services.rbac.resources import ResourceAccessService
from services.rbac.roles import RoleService
from services.workspace.member_service import WorkspaceMemberService


@dataclass(frozen=True, slots=True)
class RBACServices:
    roles: RoleService
    policies: PolicyService
    members: MemberService
    resources: ResourceAccessService
    queries: ResourceQueryService


def build_rbac_services(
    *,
    workspaces: WorkspaceRepository,
    workspace_members: WorkspaceMemberService,
    apps: ConsoleAppRepository,
    datasets: SQLAlchemyDatasetRepository,
) -> RBACServices:
    settings = DeploymentRBACSettings()
    return RBACServices(
        queries=ResourceQueryService(apps=apps, datasets=datasets),
        roles=RoleService(
            roles=enterprise.RBACService.Roles, catalog=enterprise.RBACService.Catalog, settings=settings
        ),
        policies=PolicyService(
            policies=enterprise.RBACService.AccessPolicies, bindings=enterprise.RBACService.AccessPolicyBindings
        ),
        members=MemberService(
            members=workspaces,
            workspace_roles=workspace_members,
            roles=enterprise.RBACService.MemberRoles,
            permissions=enterprise.RBACService.MyPermissions,
            apps=enterprise.RBACService.AppPermissions,
            datasets=enterprise.RBACService.DatasetPermissions,
            settings=settings,
        ),
        resources=ResourceAccessService(
            clients=EnterpriseResourceAccessClients(
                apps=enterprise._APP_ACCESS,
                datasets=enterprise._DATASET_ACCESS,
                agents=enterprise._AGENT_ACCESS,
                workspace_apps=enterprise._WORKSPACE_APP_ACCESS,
                workspace_datasets=enterprise._WORKSPACE_DATASET_ACCESS,
                workspace_agents=enterprise._WORKSPACE_AGENT_ACCESS,
                catalogs=enterprise.RBACService.Catalog,
            ),
            members=workspaces,
            apps=apps,
            datasets=datasets,
            initializer=CeleryAccessInitializer(),
        ),
    )
