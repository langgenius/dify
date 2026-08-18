"""Composition root for application services used by transport adapters."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import cast

from flask import Flask, current_app
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.db.session_factory import get_session_maker
from core.helper.ssrf_proxy import ssrf_proxy
from core.schemas.schema_manager import SchemaManager
from enums import DeploymentEdition
from extensions.ext_redis import RedisClientWrapper, redis_client
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.data_source_api_key_auth_repository import SQLAlchemyDataSourceApiKeyAuthBindingRepository
from repositories.data_source_oauth_binding_repository import SQLAlchemyDataSourceOAuthBindingRepository
from repositories.explore_banner_query_repository import ExploreBannerQueryRepository
from repositories.installation_state_repository import InstallationStateRepository
from repositories.oauth_server_repository import RedisOAuthServerTokenRepository, SQLAlchemyOAuthServerRepository
from repositories.workspace_member_query_repository import WorkspaceMemberQueryRepository
from repositories.workspace_query_repository import WorkspaceQueryRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.auth.data_source_api_key_auth_gateways import (
    ProviderApiKeyAuthCredentialValidator,
    TenantApiKeyAuthCredentialEncryptor,
)
from services.auth.data_source_api_key_auth_service import DataSourceApiKeyAuthService
from services.data_source_oauth_service import DataSourceOAuthService, InvalidDataSourceOAuthProviderError
from services.explore_banner_query_service import ExploreBannerQueryService
from services.feature_query_service import FeatureQueryService
from services.feature_service import FeatureService
from services.feature_service_gateway import FeatureServiceGateway
from services.init_validation_service import InitValidationService
from services.notion_data_source_gateway import NotionDataSourceGateway
from services.oauth_server_service import OAUTH_ACCESS_TOKEN_EXPIRES_IN, OAuthServerService
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
    app_definitions: AppDefinitionQueryService
    data_source_api_key_auth: DataSourceApiKeyAuthService
    data_source_oauth: Mapping[str, DataSourceOAuthService]
    explore_banner_queries: ExploreBannerQueryService
    schema_definitions: SchemaDefinitionService
    setup: SetupService
    feature_queries: FeatureQueryService
    oauth_server: OAuthServerService
    init_validation: InitValidationService
    workspace_queries: WorkspaceQueryService
    workspace_member_queries: WorkspaceMemberQueryService

    def resolve_data_source_oauth(self, provider: str) -> DataSourceOAuthService:
        service = self.data_source_oauth.get(provider)
        if service is None:
            raise InvalidDataSourceOAuthProviderError("Invalid provider")
        return service


def _build_data_source_oauth_services(
    *,
    database_client: sessionmaker[Session],
) -> Mapping[str, DataSourceOAuthService]:
    notion_data_source = NotionDataSourceGateway(
        client_id=dify_config.NOTION_CLIENT_ID or "",
        client_secret=dify_config.NOTION_CLIENT_SECRET or "",
        redirect_uri=dify_config.CONSOLE_API_URL + "/console/api/oauth/data-source/callback/notion",
        http_client=ssrf_proxy,
    )
    bindings = SQLAlchemyDataSourceOAuthBindingRepository(session_factory=database_client)
    return {
        "notion": DataSourceOAuthService(
            provider_name="notion",
            provider_gateway=notion_data_source,
            bindings=bindings,
            is_internal_provider=dify_config.NOTION_INTEGRATION_TYPE == "internal",
            internal_access_token=dify_config.NOTION_INTERNAL_SECRET,
        )
    }


def _build_oauth_server_service(
    *,
    database_client: sessionmaker[Session],
    redis: RedisClientWrapper,
) -> OAuthServerService:
    return OAuthServerService(
        repository=SQLAlchemyOAuthServerRepository(session_factory=database_client),
        tokens=RedisOAuthServerTokenRepository(redis=redis),
        access_token_expires_in=OAUTH_ACCESS_TOKEN_EXPIRES_IN,
    )


def build_application_services(
    *,
    database_client: sessionmaker[Session],
    deployment_edition: DeploymentEdition,
    initialization_password: str,
    redis: RedisClientWrapper,
) -> ApplicationServices:
    installation_state = InstallationStateRepository(client=database_client)
    data_source_api_key_auth_bindings = SQLAlchemyDataSourceApiKeyAuthBindingRepository(session_factory=database_client)
    return ApplicationServices(
        app_definitions=AppDefinitionQueryService(
            definitions=AppDefinitionQueryRepository(session_factory=database_client),
            builtin_icon_url_prefix=(
                dify_config.CONSOLE_API_URL + "/console/api/workspaces/current/tool-provider/builtin/"
            ),
        ),
        data_source_api_key_auth=DataSourceApiKeyAuthService(
            bindings=data_source_api_key_auth_bindings,
            validator=ProviderApiKeyAuthCredentialValidator(),
            encryptor=TenantApiKeyAuthCredentialEncryptor(),
        ),
        data_source_oauth=_build_data_source_oauth_services(database_client=database_client),
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
        oauth_server=_build_oauth_server_service(database_client=database_client, redis=redis),
        init_validation=InitValidationService(
            state=installation_state,
            validation_required=(deployment_edition != DeploymentEdition.CLOUD and bool(initialization_password)),
            expected_password=initialization_password,
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
        initialization_password=dify_config.INIT_PASSWORD,
        redis=redis_client,
    )


def application_services() -> ApplicationServices:
    """Return the application services bound to the current Flask app."""
    return cast(ApplicationServices, current_app.extensions[_EXTENSION_KEY])
