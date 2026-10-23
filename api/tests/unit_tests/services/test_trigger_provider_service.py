"""Legacy ORM subscription reads; renewal coverage uses the injected service tests."""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType
from models.base import TypeBase
from models.provider_ids import TriggerProviderID
from models.trigger import (
    TriggerOAuthSystemClient,
    TriggerOAuthTenantClient,
    TriggerSubscription,
    WorkflowPluginTrigger,
)
from services.trigger import trigger_provider_service as service_module
from services.trigger.trigger_provider_service import TriggerProviderService


@dataclass(frozen=True)
class _DatabaseBinding:
    engine: Engine


@dataclass(frozen=True)
class TriggerDatabase:
    """Factory and identifiers for persisted subscription lifecycle state."""

    session_maker: sessionmaker[Session]
    tenant_id: str
    other_tenant_id: str
    user_id: str
    provider_id: TriggerProviderID

    def add_subscription(
        self,
        *,
        tenant_id: str | None = None,
        subscription_id: str | None = None,
        name: str = "main",
        endpoint_id: str | None = None,
        credential_type: CredentialType = CredentialType.API_KEY,
        credentials: dict[str, str] | None = None,
        properties: dict[str, object] | None = None,
        parameters: dict[str, object] | None = None,
        credential_expires_at: int = -1,
        expires_at: int = -1,
    ) -> TriggerSubscription:
        subscription = TriggerSubscription(
            tenant_id=tenant_id or self.tenant_id,
            user_id=self.user_id,
            name=name,
            endpoint_id=endpoint_id or f"endpoint-{uuid4()}",
            provider_id=str(self.provider_id),
            parameters=parameters or {"event": "push"},
            properties=properties or {"project": "encrypted"},
            credentials=credentials or {"token": "encrypted"},
            credential_type=credential_type,
            credential_expires_at=credential_expires_at,
            expires_at=expires_at,
        )
        if subscription_id is not None:
            subscription.id = subscription_id
        with self.session_maker.begin() as session:
            session.add(subscription)
        return subscription

    def get_subscription(self, subscription_id: str) -> TriggerSubscription | None:
        with self.session_maker() as session:
            return session.get(TriggerSubscription, subscription_id)


@pytest.fixture
def trigger_db(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> TriggerDatabase:
    """Create trigger tables and bind every service-owned session to SQLite."""

    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[
            TriggerSubscription.__table__,
            WorkflowPluginTrigger.__table__,
            TriggerOAuthTenantClient.__table__,
            TriggerOAuthSystemClient.__table__,
        ],
    )
    monkeypatch.setattr(service_module, "db", _DatabaseBinding(engine=sqlite_engine))
    return TriggerDatabase(
        session_maker=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
        tenant_id=str(uuid4()),
        other_tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        provider_id=TriggerProviderID("langgenius/github/github"),
    )


@pytest.fixture
def provider_controller() -> Mock:
    controller = Mock()
    controller.get_credential_schema_config.return_value = []
    controller.get_properties_schema.return_value = []
    controller.get_oauth_client_schema.return_value = []
    controller.plugin_unique_identifier = "langgenius/github:0.0.1@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    return controller


def _patch_provider(mocker, provider: object) -> None:
    mocker.patch.object(service_module.TriggerManager, "get_trigger_provider", return_value=provider)


def _encrypter(
    *,
    decrypted: dict[str, object] | None = None,
    encrypted: dict[str, object] | None = None,
    masked: dict[str, object] | None = None,
) -> Mock:
    result = Mock()
    result.decrypt.side_effect = lambda value: decrypted if decrypted is not None else dict(value)
    result.encrypt.side_effect = lambda value: encrypted if encrypted is not None else dict(value)
    result.mask_credentials.side_effect = lambda value: masked if masked is not None else dict(value)
    result.mask_plugin_credentials.side_effect = lambda value: masked if masked is not None else dict(value)
    return result


def test_get_subscription_scopes_tenant_and_decrypts(
    mocker, trigger_db: TriggerDatabase, provider_controller: Mock
) -> None:
    subscription = trigger_db.add_subscription()
    _patch_provider(mocker, provider_controller)
    credential = _encrypter(decrypted={"token": "plain"})
    properties = _encrypter(decrypted={"project": "plain"})
    mocker.patch.object(
        service_module, "create_trigger_provider_encrypter_for_subscription", return_value=(credential, Mock())
    )
    mocker.patch.object(
        service_module, "create_trigger_provider_encrypter_for_properties", return_value=(properties, Mock())
    )

    assert TriggerProviderService.get_subscription_by_id(trigger_db.other_tenant_id, subscription.id) is None
    result = TriggerProviderService.get_subscription_by_id(trigger_db.tenant_id, subscription.id)
    assert result is not None
    assert (
        TriggerProviderService.get_subscription_by_id(
            trigger_db.tenant_id, subscription.id, provider_id=TriggerProviderID("langgenius/other/other")
        )
        is None
    )
    assert result.credentials == {"token": "plain"}
    assert result.properties == {"project": "plain"}
