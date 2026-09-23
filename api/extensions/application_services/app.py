"""Compose App API access dependencies."""

from sqlalchemy.orm import Session, sessionmaker

from repositories.app.api_key_repository import AppApiKeyRepository
from services.api_token_service import ApiTokenCache
from services.app.api_key_service import AppApiKeyService


def build_app_api_key_service(*, database_client: sessionmaker[Session]) -> AppApiKeyService:
    return AppApiKeyService(
        keys=AppApiKeyRepository(session_factory=database_client),
        cache=ApiTokenCache,
    )
