"""Compose the resource access token service at the application boundary."""

from sqlalchemy.orm import Session, sessionmaker

from repositories.resource_access_token_repository import (
    ResourceAccessTokenCleanupRepository,
    ResourceAccessTokenRepository,
)
from services.resource_access_token_service import ResourceAccessTokenCleanupService, ResourceAccessTokenService


def build_resource_access_token_service(*, database_client: sessionmaker[Session]) -> ResourceAccessTokenService:
    return ResourceAccessTokenService(tokens=ResourceAccessTokenRepository(session_factory=database_client))


def build_resource_access_token_cleanup_service(*, session: Session) -> ResourceAccessTokenCleanupService:
    """Bind cleanup to an existing transaction without taking ownership of its lifetime."""
    return ResourceAccessTokenCleanupService(tokens=ResourceAccessTokenCleanupRepository(session=session))
