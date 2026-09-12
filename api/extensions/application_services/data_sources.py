"""Composition root for data-source services and shared credential gateways."""

from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.datasource.datasource_manager import DatasourceManager
from core.helper.ssrf_proxy import ssrf_proxy
from core.plugin.impl.datasource import PluginDatasourceManager
from core.plugin.impl.oauth import OAuthHandler
from repositories.data_source.api_key_auth_repository import SQLAlchemyDataSourceApiKeyAuthBindingRepository
from repositories.data_source.credential_repository import SQLAlchemyDatasourceCredentialRepository
from repositories.data_source.oauth_binding_repository import SQLAlchemyDataSourceOAuthBindingRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.auth.data_source_api_key_auth_gateways import (
    ProviderApiKeyAuthCredentialValidator,
    TenantApiKeyAuthCredentialEncryptor,
)
from services.auth.data_source_api_key_auth_service import DataSourceApiKeyAuthService
from services.data_source.binding_application_service import DataSourceBindingApplicationService
from services.data_source.credential_adapters import (
    OAuthDatasourceCredentialRefresher,
    PluginDatasourceCredentialCodec,
    PluginDatasourceOAuthClientResolver,
)
from services.data_source.credential_gateway import (
    ActorAwareDatasourceCredentialGateway,
    TrustedStoredDatasourceCredentialGateway,
)
from services.data_source.notion_import_adapters import PluginNotionSourceGateway
from services.data_source.notion_import_application_service import NotionImportApplicationService
from services.data_source.notion_oauth_gateway import NotionDataSourceGateway
from services.data_source.oauth_service import DataSourceOAuthService, InvalidDataSourceOAuthProviderError
from services.knowledge.dataset_access import DatasetAccessService


@dataclass(frozen=True, slots=True)
class DataSourceServices:
    api_key_auth: DataSourceApiKeyAuthService
    oauth: Mapping[str, DataSourceOAuthService]
    bindings: DataSourceBindingApplicationService
    notion_imports: NotionImportApplicationService

    def resolve_oauth(self, provider: str) -> DataSourceOAuthService:
        service = self.oauth.get(provider)
        if service is None:
            raise InvalidDataSourceOAuthProviderError("Invalid provider")
        return service


@dataclass(frozen=True, slots=True)
class DataSourceCredentials:
    actor: ActorAwareDatasourceCredentialGateway
    stored: TrustedStoredDatasourceCredentialGateway


def build_data_source_credentials(*, database_client: sessionmaker[Session]) -> DataSourceCredentials:
    credentials = SQLAlchemyDatasourceCredentialRepository(session_factory=database_client)
    provider_manager = PluginDatasourceManager()
    codec = PluginDatasourceCredentialCodec(provider_manager=provider_manager)
    refresher = OAuthDatasourceCredentialRefresher(
        oauth_clients=PluginDatasourceOAuthClientResolver(configs=credentials, provider_manager=provider_manager),
        oauth_handler=OAuthHandler(),
    )
    return DataSourceCredentials(
        actor=ActorAwareDatasourceCredentialGateway(credentials=credentials, codec=codec, refresher=refresher),
        stored=TrustedStoredDatasourceCredentialGateway(credentials=credentials, codec=codec, refresher=refresher),
    )


def build_data_source_services(
    *,
    database_client: sessionmaker[Session],
    dataset_access: DatasetAccessService,
    datasets: SQLAlchemyDatasetRepository,
    documents: SQLAlchemyDocumentRepository,
    actor_credentials: ActorAwareDatasourceCredentialGateway,
) -> DataSourceServices:
    oauth_bindings = SQLAlchemyDataSourceOAuthBindingRepository(session_factory=database_client)
    notion_gateway = NotionDataSourceGateway(
        client_id=dify_config.NOTION_CLIENT_ID or "",
        client_secret=dify_config.NOTION_CLIENT_SECRET or "",
        redirect_uri=dify_config.CONSOLE_API_URL + "/console/api/oauth/data-source/callback/notion",
        http_client=ssrf_proxy,
    )
    return DataSourceServices(
        api_key_auth=DataSourceApiKeyAuthService(
            bindings=SQLAlchemyDataSourceApiKeyAuthBindingRepository(session_factory=database_client),
            validator=ProviderApiKeyAuthCredentialValidator(),
            encryptor=TenantApiKeyAuthCredentialEncryptor(),
        ),
        oauth={
            "notion": DataSourceOAuthService(
                provider_name="notion",
                provider_gateway=notion_gateway,
                bindings=oauth_bindings,
                is_internal_provider=dify_config.NOTION_INTEGRATION_TYPE == "internal",
                internal_access_token=dify_config.NOTION_INTERNAL_SECRET,
            )
        },
        bindings=DataSourceBindingApplicationService(bindings=oauth_bindings),
        notion_imports=NotionImportApplicationService(
            dataset_access=dataset_access,
            datasets=datasets,
            documents=documents,
            source=PluginNotionSourceGateway(
                credentials=actor_credentials, runtime_loader=DatasourceManager.get_datasource_runtime
            ),
        ),
    )
