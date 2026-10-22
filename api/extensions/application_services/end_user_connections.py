"""Composition for personal Connection management and OAuth authorization."""

from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth import PluginCredentialAuthClient
from core.plugin.impl.oauth import OAuthHandler
from extensions.ext_redis import redis_client
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connection_adapters import (
    PluginApiKeyCredentialGateway,
    PublishedConnectionTargetResolver,
    TenantConnectionCipher,
)
from services.end_user_connection_oauth_adapters import (
    PluginConnectionOAuthGateway,
    RedisConnectionOAuthAttempts,
    RedisOAuthRefreshSingleFlight,
)
from services.end_user_connections.management import ConnectionService
from services.end_user_connections.oauth import OAuthConnectionService
from services.end_user_connections.oauth_lifecycle import OAuthConnectionLifecycleService


def build_end_user_connections(*, database_client: sessionmaker[Session]) -> ConnectionService:
    repository = EndUserConnectionRepository(session_factory=database_client)
    providers = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
    cipher = TenantConnectionCipher()
    return ConnectionService(
        store=repository,
        targets=PublishedConnectionTargetResolver(workflows=repository, providers=providers),
        credentials=providers,
        cipher=cipher,
        oauth=OAuthConnectionLifecycleService(
            store=repository,
            cipher=cipher,
            refreshes=RedisOAuthRefreshSingleFlight(redis=redis_client),
            gateway=PluginConnectionOAuthGateway(
                clients=repository,
                providers=providers,
                handler=OAuthHandler(),
                auth=PluginCredentialAuthClient(),
            ),
        ),
    )


def build_end_user_connection_oauth(*, database_client: sessionmaker[Session]) -> OAuthConnectionService:
    repository = EndUserConnectionRepository(session_factory=database_client)
    providers = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
    return OAuthConnectionService(
        store=repository,
        targets=PublishedConnectionTargetResolver(workflows=repository, providers=providers),
        gateway=PluginConnectionOAuthGateway(
            clients=repository,
            providers=providers,
            handler=OAuthHandler(),
            auth=PluginCredentialAuthClient(),
        ),
        attempts=RedisConnectionOAuthAttempts(),
        cipher=TenantConnectionCipher(),
    )
