"""Composition root for application services used by transport adapters."""

from dataclasses import dataclass
from typing import cast

from flask import Flask, current_app
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.db.session_factory import get_session_maker
from core.schemas.schema_manager import SchemaManager
from enums.deployment_edition import DeploymentEdition
from extensions.ext_redis import RedisClientWrapper, redis_client
from repositories.explore_banner_query_repository import ExploreBannerQueryRepository
from repositories.installation_state_repository import InstallationStateRepository
from repositories.workspace_member_query_repository import WorkspaceMemberQueryRepository
from repositories.workspace_query_repository import WorkspaceQueryRepository
from services.explore_banner_query_service import ExploreBannerQueryService
from services.feature_query_service import FeatureQueryService
from services.feature_service import FeatureService
from services.feature_service_gateway import FeatureServiceGateway
from services.schema_definition_service import SchemaDefinitionService
from services.setup_adapters import RedisSetupLock, RegisterServiceAccountProvisioner
from services.setup_service import SetupService
from services.workspace_member_query_service import WorkspaceMemberQueryService
from services.workspace_member_role_resolver import DeploymentWorkspaceMemberRoleResolver
from services.workspace_plan_gateway import DeploymentWorkspacePlanGateway
from services.workspace_query_service import WorkspaceQueryService

_EXTENSION_KEY = "application_services"


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    explore_banner_queries: ExploreBannerQueryService
    schema_definitions: SchemaDefinitionService
    setup: SetupService
    feature_queries: FeatureQueryService
    workspace_queries: WorkspaceQueryService
    workspace_member_queries: WorkspaceMemberQueryService


def build_application_services(
    *,
    database_client: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    redis: RedisClientWrapper,
) -> ApplicationServices:
    installation_state = InstallationStateRepository(client=database_client)
    return ApplicationServices(
        explore_banner_queries=ExploreBannerQueryService(
            banners=ExploreBannerQueryRepository(client=database_client),
            is_enabled=FeatureService.is_explore_banner_enabled,
        ),
        schema_definitions=SchemaDefinitionService(source_factory=SchemaManager),
        setup=SetupService(
            state=installation_state,
            accounts=RegisterServiceAccountProvisioner(client=database_client),
            lock=RedisSetupLock(client=redis),
            setup_required=deployment_edition != DeploymentEdition.CLOUD,
        ),
        feature_queries=FeatureQueryService(
            features=FeatureServiceGateway(),
            trial_models=FeatureService.get_trial_models(),
            app_dsl_version=CURRENT_APP_DSL_VERSION,
        ),
        workspace_queries=WorkspaceQueryService(
            workspaces=WorkspaceQueryRepository(
                client=database_client,
            ),
            plans=DeploymentWorkspacePlanGateway(),
        ),
        workspace_member_queries=WorkspaceMemberQueryService(
            members=WorkspaceMemberQueryRepository(
                session_factory=database_client,
            ),
            roles=DeploymentWorkspaceMemberRoleResolver(),
        ),
    )


def init_app(app: Flask) -> None:
    app.extensions[_EXTENSION_KEY] = build_application_services(
        database_client=get_session_maker(),
        deployment_edition=dify_config.DEPLOYMENT_EDITION,
        redis=redis_client,
    )


def application_services() -> ApplicationServices:
    """Return the application services bound to the current Flask app."""
    return cast(ApplicationServices, current_app.extensions[_EXTENSION_KEY])
