import logging
from collections.abc import Callable
from functools import partial

from flask import Flask
from sqlalchemy.orm import Session, scoped_session

from configs import dify_config
from dify_app import DifyApp
from libs.key_providers.base import BaseKeyProvider
from libs.key_providers.key_provider_type import KeyProviderType
from models.engine import db
from repositories.tenant_public_key_repository import TenantPublicKeyRepository

logger = logging.getLogger(__name__)


def _current_session() -> Session:
    """Resolve request state without beginning a new SQL transaction."""
    return db.session() if isinstance(db.session, scoped_session) else db.session


class KeyProviderManager:
    _provider: BaseKeyProvider | None = None

    def init_app(self, app: Flask):
        with app.app_context():
            self._provider = self._build_provider()

    @property
    def provider(self) -> BaseKeyProvider:
        if self._provider is None:
            self._provider = self._build_provider()
        return self._provider

    def _build_provider(self) -> BaseKeyProvider:
        provider_factory = self.get_provider_factory(dify_config.KEY_PROVIDER_TYPE)
        return provider_factory()

    @staticmethod
    def get_provider_factory(provider_type: str) -> Callable[[], BaseKeyProvider]:
        match provider_type:
            case KeyProviderType.LOCAL:
                from libs.key_providers.rsa_key_provider import RSAKeyProvider

                reader = TenantPublicKeyRepository(
                    create_session=lambda: Session(db.engine), current_session=_current_session
                )
                return partial(RSAKeyProvider, public_key_reader=reader.read)
            case KeyProviderType.AZURE_KEYVAULT:
                from libs.key_providers.azure_keyvault_key_provider import AzureKeyVaultKeyProvider

                return AzureKeyVaultKeyProvider
            case _:
                raise ValueError(f"unsupported key provider type {provider_type}")


key_provider_manager = KeyProviderManager()


def init_app(app: DifyApp):
    key_provider_manager.init_app(app)
