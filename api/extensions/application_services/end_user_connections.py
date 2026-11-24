"""Composition for personal Connection management and OAuth authorization."""

from datetime import timedelta

from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth import PluginCredentialAuthClient
from configs import dify_config
from context.connection_execution import ConnectionExecutionContext
from core.plugin.impl.oauth import OAuthHandler
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.model import Conversation
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
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connection_revision_adapters import PluginConnectionProviderRevisions, PluginConnectionRevisions
from services.end_user_connection_runtime_adapters import get_tool_runtime
from services.end_user_connections.cleanup import ConnectionCleanupService
from services.end_user_connections.guest_expiry import GuestConnectionExpiryService
from services.end_user_connections.management import ConnectionService
from services.end_user_connections.oauth import OAuthConnectionService
from services.end_user_connections.oauth_lifecycle import OAuthConnectionLifecycleService
from services.end_user_connections.preflight import ConnectionPreflightService
from services.end_user_connections.runtime import ConnectionRuntimeService
from services.end_user_connections.selections import ConnectionSelectionService

__all__ = [
    "build_end_user_connection_cleanup",
    "build_end_user_connection_oauth",
    "build_end_user_connection_preflight",
    "build_end_user_connection_runtime",
    "build_end_user_connection_selections",
    "build_end_user_connections",
    "build_guest_connection_expiry",
    "get_tool_runtime",
    "initialize_conversation_connections",
]


def build_end_user_connection_cleanup(*, database_client: sessionmaker[Session]) -> ConnectionCleanupService:
    """Build deletion cleanup with the configured database factory and no external gateways."""
    return ConnectionCleanupService(store=EndUserConnectionRepository(session_factory=database_client))


def build_end_user_connection_selections(*, database_client: sessionmaker[Session]) -> ConnectionSelectionService:
    repository = EndUserConnectionRepository(session_factory=database_client)
    providers = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
    return ConnectionSelectionService(
        store=repository,
        revisions=PluginConnectionRevisions(providers=providers, snapshots=repository),
        requirements=PublishedPreflightRequirements(
            workflows=repository,
            snapshots=repository,
            providers=providers,
            oauth=PluginConnectionOAuthGateway(
                clients=repository, providers=providers, handler=OAuthHandler(), auth=PluginCredentialAuthClient()
            ),
        ),
    )


def _build_oauth_lifecycle(
    repository: EndUserConnectionRepository, providers: PluginApiKeyCredentialGateway, cipher: TenantConnectionCipher
) -> OAuthConnectionLifecycleService:
    """Share the same pinned revocation path for user deletion and scheduled expiry."""
    return OAuthConnectionLifecycleService(
        store=repository,
        cipher=cipher,
        refreshes=RedisOAuthRefreshSingleFlight(redis=redis_client),
        gateway=PluginConnectionOAuthGateway(
            clients=repository,
            providers=providers,
            handler=OAuthHandler(),
            auth=PluginCredentialAuthClient(),
        ),
    )


def build_guest_connection_expiry(*, database_client: sessionmaker[Session]) -> GuestConnectionExpiryService:
    """Wire scheduled expiry to retention policy and the same revoker as personal disconnect."""
    repository = EndUserConnectionRepository(session_factory=database_client)
    providers = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
    return GuestConnectionExpiryService(
        store=repository,
        oauth=_build_oauth_lifecycle(repository, providers, TenantConnectionCipher()),
        inactivity=timedelta(days=dify_config.GUEST_CONNECTION_INACTIVITY_DAYS),
        batch_size=dify_config.GUEST_CONNECTION_CLEANUP_BATCH_SIZE,
        clock=naive_utc_now,
    )


def build_end_user_connections(*, database_client: sessionmaker[Session]) -> ConnectionService:
    repository = EndUserConnectionRepository(session_factory=database_client)
    providers = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
    cipher = TenantConnectionCipher()
    return ConnectionService(
        revisions=PluginConnectionProviderRevisions(providers=providers, snapshots=repository),
        store=repository,
        targets=PublishedConnectionTargetResolver(workflows=repository, snapshots=repository, providers=providers),
        credentials=providers,
        cipher=cipher,
        oauth=_build_oauth_lifecycle(repository, providers, cipher),
    )


def build_end_user_connection_oauth(*, database_client: sessionmaker[Session]) -> OAuthConnectionService:
    repository = EndUserConnectionRepository(session_factory=database_client)
    providers = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
    return OAuthConnectionService(
        revisions=PluginConnectionProviderRevisions(providers=providers, snapshots=repository),
        store=repository,
        targets=PublishedConnectionTargetResolver(workflows=repository, snapshots=repository, providers=providers),
        gateway=PluginConnectionOAuthGateway(
            clients=repository,
            providers=providers,
            handler=OAuthHandler(),
            auth=PluginCredentialAuthClient(),
        ),
        attempts=RedisConnectionOAuthAttempts(),
        cipher=TenantConnectionCipher(),
    )


def build_end_user_connection_preflight(
    *, database_client: sessionmaker[Session], connections: ConnectionService
) -> ConnectionPreflightService:
    repository = EndUserConnectionRepository(session_factory=database_client)
    providers = PluginApiKeyCredentialGateway(auth=PluginCredentialAuthClient())
    return ConnectionPreflightService(
        connections=repository,
        checks=connections,
        requirements=PublishedPreflightRequirements(
            workflows=repository,
            snapshots=repository,
            providers=providers,
            oauth=PluginConnectionOAuthGateway(
                clients=repository,
                providers=providers,
                handler=OAuthHandler(),
                auth=PluginCredentialAuthClient(),
            ),
        ),
    )


def build_end_user_connection_runtime(
    *, database_client: sessionmaker[Session], connections: ConnectionService
) -> ConnectionRuntimeService:
    return ConnectionRuntimeService(
        store=EndUserConnectionRepository(session_factory=database_client),
        checks=connections,
        cipher=TenantConnectionCipher(),
    )


def initialize_conversation_connections(
    session: Session, context: ConnectionExecutionContext, conversation: Conversation
) -> None:
    if context.workspace is not None:
        from repositories.installed_app_connection_repository import SQLAlchemyInstalledConnectionRepository

        SQLAlchemyInstalledConnectionRepository.initialize_conversation(session, context, conversation)
        return
    EndUserConnectionRepository.initialize_conversation_selections(session, context, conversation)
