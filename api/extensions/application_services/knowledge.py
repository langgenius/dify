"""Composition of knowledge base application services."""

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from repositories.knowledge.dataset_api_key_repository import DatasetApiKeyRepository
from services.api_token_service import ApiTokenCache
from services.knowledge.api_key_service import DatasetApiKeyService


def build_dataset_api_key_service(*, database_client: sessionmaker[Session]) -> DatasetApiKeyService:
    return DatasetApiKeyService(
        keys=DatasetApiKeyRepository(session_factory=database_client),
        cache=ApiTokenCache,
        rbac_enabled=lambda: dify_config.RBAC_ENABLED,
    )
