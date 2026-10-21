"""Resolve real stored OAuth credentials before entering provider operations."""

from collections.abc import Iterator
from dataclasses import dataclass, field
from tempfile import TemporaryDirectory
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.tools.utils.system_encryption import encrypt_system_params
from extensions.ext_key_provider import key_provider_manager
from extensions.ext_storage import storage
from models.account import Tenant
from models.engine import db
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerOAuthSystemClient, TriggerOAuthTenantClient
from repositories.trigger.oauth_client_repository import TriggerOAuthClientRepository
from services.plugin.dispatch_identity import PluginOAuthClientConfig
from services.trigger.oauth_client_service import (
    TriggerOAuthClientConfigError,
    TriggerOAuthClientService,
    TriggerOAuthProviderMetadata,
)
from tests.unit_tests.config_override import config_overrides_context

_IDENTIFIER = "langgenius/github:1.0.0@test"
_PROVIDER = TriggerProviderID("langgenius/github/github")
_SCHEMA = [
    ProviderConfig(name="client_id", type=ProviderConfigType.TEXT_INPUT),
    ProviderConfig(name="client_secret", type=ProviderConfigType.SECRET_INPUT),
]


@dataclass
class _PluginMetadata:
    """Only metadata from the plugin daemon is supplied by this external boundary."""

    tenant_id: str
    sessions: list[Session] = field(default_factory=list)
    verified: bool = True
    verification_calls: int = 0

    def assert_sessions_closed(self) -> None:
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)

    def get_metadata(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerOAuthProviderMetadata:
        self.assert_sessions_closed()
        assert tenant_id == self.tenant_id
        assert provider_id == _PROVIDER
        return TriggerOAuthProviderMetadata(schema=_SCHEMA, plugin_unique_identifier=_IDENTIFIER)

    def is_verified(self, *, tenant_id: str, plugin_unique_identifier: str) -> bool:
        self.assert_sessions_closed()
        assert tenant_id == self.tenant_id
        assert plugin_unique_identifier == _IDENTIFIER
        self.verification_calls += 1
        return self.verified


@dataclass(frozen=True)
class _Harness:
    service: TriggerOAuthClientService
    session_factory: sessionmaker[Session]
    metadata: _PluginMetadata

    @property
    def tenant_id(self) -> str:
        return self.metadata.tenant_id

    def add_system(self, *, encrypted_params: str) -> None:
        with self.session_factory.begin() as session:
            session.add(
                TriggerOAuthSystemClient(
                    plugin_id=_PROVIDER.plugin_id,
                    provider=_PROVIDER.provider_name,
                    encrypted_oauth_params=encrypted_params,
                )
            )

    def add_custom(self, *, encrypted_params: str, enabled: bool) -> None:
        with self.session_factory.begin() as session:
            session.add(
                TriggerOAuthTenantClient(
                    tenant_id=self.tenant_id,
                    plugin_id=_PROVIDER.plugin_id,
                    provider=_PROVIDER.provider_name,
                    encrypted_oauth_params=encrypted_params,
                    enabled=enabled,
                )
            )

    def resolve(self) -> PluginOAuthClientConfig | None:
        result = self.service.resolve(tenant_id=self.tenant_id, provider_id=_PROVIDER)
        self.metadata.assert_sessions_closed()
        return result


@pytest.fixture
def harness(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    previous_storage = storage.__dict__.copy()
    previous_key_provider = key_provider_manager._provider
    with (
        TemporaryDirectory(prefix="trigger-oauth-resolution-keys-") as storage_path,
        config_overrides_context(
            KEY_PROVIDER_TYPE="local",
            STORAGE_TYPE="local",
            STORAGE_LOCAL_PATH=storage_path,
        ),
    ):
        app = Flask(__name__)
        app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
        db.init_app(app)
        storage.init_app(app)
        key_provider_manager.init_app(app)
        with sqlite_session_factory.begin() as session:
            tenant = Tenant(name="OAuth workspace")
            session.add(tenant)
            session.flush()
            tenant_id = tenant.id
        metadata = _PluginMetadata(tenant_id)
        service = TriggerOAuthClientService(
            clients=TriggerOAuthClientRepository(session_factory=sqlite_session_factory), providers=metadata
        )

        def observe_repository_session(
            session: Session, _transaction: SessionTransaction, _connection: Connection
        ) -> None:
            metadata.sessions.append(session)

        def assert_repository_closed_for_key_lookup(
            _session: Session, _transaction: SessionTransaction, _connection: Connection
        ) -> None:
            metadata.assert_sessions_closed()

        event.listen(sqlite_session_factory.class_, "after_begin", observe_repository_session)
        event.listen(db.session.session_factory.class_, "after_begin", assert_repository_closed_for_key_lookup)
        try:
            with app.app_context():
                yield _Harness(service, sqlite_session_factory, metadata)
        finally:
            event.remove(sqlite_session_factory.class_, "after_begin", observe_repository_session)
            event.remove(db.session.session_factory.class_, "after_begin", assert_repository_closed_for_key_lookup)
            with app.app_context():
                db.session.remove()
                db.engine.dispose()
            storage.__dict__.clear()
            storage.__dict__.update(previous_storage)
            key_provider_manager._provider = previous_key_provider


def test_resolve_without_configuration_returns_none_without_verification(harness: _Harness) -> None:
    assert harness.resolve() is None
    assert harness.metadata.verification_calls == 0


def test_enabled_custom_credentials_decrypt_with_real_rsa_and_take_priority(harness: _Harness) -> None:
    with harness.session_factory.begin() as session:
        tenant = session.get(Tenant, harness.tenant_id)
        assert tenant is not None
        tenant.encrypt_public_key = key_provider_manager.provider.generate_key_pair(tenant.id)
    harness.add_system(encrypted_params=encrypt_system_params({"client_secret": "system-secret"}))
    harness.metadata.verified = False
    harness.service.save(
        tenant_id=harness.tenant_id,
        provider_id=_PROVIDER,
        client_params={"client_id": "tenant-id", "client_secret": "tenant-secret"},
        enabled=True,
    )

    assert harness.resolve() == PluginOAuthClientConfig(
        _IDENTIFIER, {"client_id": "tenant-id", "client_secret": "tenant-secret"}
    )
    assert harness.metadata.verification_calls == 0


def test_enabled_empty_custom_client_does_not_fall_back_to_system(harness: _Harness) -> None:
    harness.add_custom(encrypted_params="{}", enabled=True)
    harness.add_system(encrypted_params=encrypt_system_params({"client_id": "system-id"}))

    assert harness.resolve() == PluginOAuthClientConfig(_IDENTIFIER, {})
    assert harness.metadata.verification_calls == 0


@pytest.mark.parametrize("custom_enabled", [None, False])
def test_verified_system_credentials_are_used_without_enabled_custom_client(
    harness: _Harness, custom_enabled: bool | None
) -> None:
    if custom_enabled is not None:
        harness.add_custom(encrypted_params="invalid-but-disabled", enabled=custom_enabled)
    harness.add_system(encrypted_params=encrypt_system_params({"client_id": "system-id", "client_secret": "secret"}))

    assert harness.resolve() == PluginOAuthClientConfig(
        _IDENTIFIER, {"client_id": "system-id", "client_secret": "secret"}
    )
    assert harness.metadata.verification_calls == 1


def test_unverified_plugin_cannot_read_system_credentials(harness: _Harness) -> None:
    harness.add_system(encrypted_params="invalid-system-ciphertext")
    harness.metadata.verified = False

    assert harness.resolve() is None
    assert harness.metadata.verification_calls == 1


@pytest.mark.parametrize("invalid_params", ['{"client_secret": "private-value"', '["private-value"]'])
def test_invalid_enabled_custom_config_raises_domain_error_without_exposing_contents(
    harness: _Harness, invalid_params: str
) -> None:
    harness.add_custom(encrypted_params=invalid_params, enabled=True)

    with pytest.raises(TriggerOAuthClientConfigError) as raised:
        harness.resolve()

    assert str(_PROVIDER) in str(raised.value)
    assert "private-value" not in str(raised.value)
    harness.metadata.assert_sessions_closed()


@pytest.mark.parametrize("invalid_params", ["", "invalid-system-ciphertext"])
def test_invalid_system_config_raises_domain_error_without_exposing_ciphertext(
    harness: _Harness, invalid_params: str
) -> None:
    harness.add_system(encrypted_params=invalid_params)

    with pytest.raises(TriggerOAuthClientConfigError) as raised:
        harness.resolve()

    assert "system OAuth client" in str(raised.value)
    assert "invalid-system-ciphertext" not in str(raised.value)
    harness.metadata.assert_sessions_closed()


def test_disabled_custom_without_system_client_returns_none(harness: _Harness) -> None:
    harness.add_custom(encrypted_params="invalid-but-disabled", enabled=False)

    assert harness.resolve() is None
    assert harness.metadata.verification_calls == 0


@pytest.mark.parametrize("other_scope", ["tenant", "plugin", "provider"])
def test_resolution_does_not_read_custom_credentials_from_other_scope(harness: _Harness, other_scope: str) -> None:
    with harness.session_factory.begin() as session:
        session.add(
            TriggerOAuthTenantClient(
                tenant_id=str(uuid4()) if other_scope == "tenant" else harness.tenant_id,
                plugin_id="langgenius/other" if other_scope == "plugin" else _PROVIDER.plugin_id,
                provider="other" if other_scope == "provider" else _PROVIDER.provider_name,
                encrypted_oauth_params='{"client_id": "other-scope"}',
                enabled=True,
            )
        )

    assert harness.resolve() is None
