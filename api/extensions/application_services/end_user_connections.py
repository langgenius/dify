"""Composition for personal API-key Connection management."""

from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth import PluginCredentialAuthClient
from core.plugin.impl.oauth import OAuthHandler
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connection_adapters import (
    PluginApiKeyCredentialGateway,
    PublishedConnectionTargetResolver,
    TenantConnectionCipher,
)
from services.end_user_connection_oauth_adapters import PluginConnectionOAuthGateway, RedisConnectionOAuthAttempts
from services.end_user_connections.api_key import ApiKeyConnectionService
from services.end_user_connections.oauth import OAuthConnectionService


def build_end_user_connections(*, database_client: sessionmaker[Session]) -> ApiKeyConnectionService:
    repository = EndUserConnectionRepository(session_factory=database_client)
    providers = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
    return ApiKeyConnectionService(
        store=repository,
        targets=PublishedConnectionTargetResolver(workflows=repository, providers=providers),
        credentials=providers,
        cipher=TenantConnectionCipher(),
    )


def build_end_user_connection_oauth(*, database_client: sessionmaker[Session]) -> OAuthConnectionService:
    repository = EndUserConnectionRepository(session_factory=database_client)
    providers = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
    return OAuthConnectionService(
        store=repository,
        targets=PublishedConnectionTargetResolver(workflows=repository, providers=providers),
        gateway=PluginConnectionOAuthGateway(clients=repository, providers=providers, handler=OAuthHandler()),
        attempts=RedisConnectionOAuthAttempts(),
        cipher=TenantConnectionCipher(),
    )
