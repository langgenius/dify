"""Compose Account consumer operations using existing App and Connection owners."""

from sqlalchemy.orm import Session, sessionmaker

from repositories.app.console_repository import ConsoleAppRepository
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.consumer_adapters import SharedConsumerAppDiscovery
from services.consumer_service import ConsumerAppAccess, ConsumerService
from services.end_user_connections.management import ConnectionService
from services.end_user_connections.oauth import OAuthConnectionService
from services.web_identity_service import WebIdentityService
from services.web_passport_service import WebPassportTokenGateway


def build_consumer_service(
    *,
    database_client: sessionmaker[Session],
    access: ConsumerAppAccess,
    shared_apps_enabled: bool,
    management: ConnectionService,
    oauth: OAuthConnectionService,
    identities: WebIdentityService,
    tokens: WebPassportTokenGateway,
) -> ConsumerService:
    return ConsumerService(
        apps=ConsoleAppRepository(session_factory=database_client),
        connections=EndUserConnectionRepository(session_factory=database_client),
        access=access,
        shared_apps=SharedConsumerAppDiscovery(enabled=shared_apps_enabled),
        management=management,
        oauth=oauth,
        identities=identities,
        tokens=tokens,
    )
