"""Composition for personal API-key Connection management."""

from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth import PluginCredentialAuthClient
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connection_adapters import (
    ApiKeyConnectionTargetResolver,
    PluginApiKeyCredentialGateway,
    TenantConnectionCipher,
)
from services.end_user_connections.api_key import ApiKeyConnectionService


def build_end_user_connections(*, database_client: sessionmaker[Session]) -> ApiKeyConnectionService:
    repository = EndUserConnectionRepository(session_factory=database_client)
    providers = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
    return ApiKeyConnectionService(
        store=repository,
        targets=ApiKeyConnectionTargetResolver(workflows=repository, providers=providers),
        credentials=providers,
        cipher=TenantConnectionCipher(),
    )
