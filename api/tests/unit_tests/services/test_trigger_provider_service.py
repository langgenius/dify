from __future__ import annotations

import contextlib
import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from constants import HIDDEN_VALUE
from core.plugin.entities.plugin_daemon import CredentialType
from models.provider_ids import TriggerProviderID
from services.trigger.trigger_provider_service import TriggerProviderService


def _patch_redis_lock(mocker: MockerFixture) -> None:
    mock_redis = mocker.patch("services.trigger.trigger_provider_service.redis_client")
    mock_redis.lock.return_value = contextlib.nullcontext()


def _mock_get_trigger_provider(mocker: MockerFixture, provider: object | None) -> None:
    mocker.patch(
        "services.trigger.trigger_provider_service.TriggerManager.get_trigger_provider",
        return_value=provider,
    )


def _encrypter_mock(
    *,
    decrypted: dict[str, Any] | None = None,
    encrypted: dict[str, Any] | None = None,
    masked: dict[str, Any] | None = None,
) -> MagicMock:
    enc = MagicMock()
    enc.decrypt.return_value = decrypted or {}
    enc.encrypt.return_value = encrypted or {}
    enc.mask_credentials.return_value = masked or {}
    enc.mask_plugin_credentials.return_value = masked or {}
    return enc


@pytest.fixture
def provider_id() -> TriggerProviderID:
    # Arrange
    return TriggerProviderID("langgenius/github/github")


@pytest.fixture(autouse=True)
def mock_db_engine(mocker: MockerFixture) -> SimpleNamespace:
    # Arrange
    mocked_db = SimpleNamespace(engine=object())
    mocker.patch("services.trigger.trigger_provider_service.db", mocked_db)
    return mocked_db


@pytest.fixture
def mock_session(mocker: MockerFixture) -> MagicMock:
    """Mocks the database session context manager used by TriggerProviderService."""
    # Arrange
    mock_session_instance = MagicMock()
    mock_session_cm = MagicMock()
    mock_session_cm.__enter__.return_value = mock_session_instance
    mock_session_cm.__exit__.return_value = False
    mocker.patch("services.trigger.trigger_provider_service.Session", return_value=mock_session_cm)
    mock_begin_cm = MagicMock()
    mock_begin_cm.__enter__.return_value = mock_session_instance
    mock_begin_cm.__exit__.return_value = False
    mock_sessionmaker_instance = MagicMock()
    mock_sessionmaker_instance.begin.return_value = mock_begin_cm
    mocker.patch("services.trigger.trigger_provider_service.sessionmaker", return_value=mock_sessionmaker_instance)
    return mock_session_instance


@pytest.fixture
def provider_controller() -> MagicMock:
    # Arrange
    controller = MagicMock()
    controller.get_credential_schema_config.return_value = []
    controller.get_properties_schema.return_value = []
    controller.get_oauth_client_schema.return_value = []
    controller.plugin_unique_identifier = "langgenius/github:0.0.1"
    return controller


def test_get_trigger_provider_should_return_api_entity_from_manager(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
) -> None:
    # Arrange
    provider = MagicMock()
    provider.to_api_entity.return_value = {"provider": "ok"}
    _mock_get_trigger_provider(mocker, provider)

    # Act
    result = TriggerProviderService.get_trigger_provider("tenant-1", provider_id)

    # Assert
    assert result == {"provider": "ok"}


def test_list_trigger_providers_should_return_api_entities_from_manager(mocker: MockerFixture) -> None:
    # Arrange
    provider_a = MagicMock()
    provider_b = MagicMock()
    provider_a.to_api_entity.return_value = {"id": "a"}
    provider_b.to_api_entity.return_value = {"id": "b"}
    mocker.patch(
        "services.trigger.trigger_provider_service.TriggerManager.list_all_trigger_providers",
        return_value=[provider_a, provider_b],
    )

    # Act
    result = TriggerProviderService.list_trigger_providers("tenant-1")

    # Assert
    assert result == [{"id": "a"}, {"id": "b"}]


def test_list_trigger_provider_subscriptions_should_return_empty_list_when_no_subscriptions(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
) -> None:
    # Arrange
    mock_session.scalars.return_value.all.return_value = []

    # Act
    result = TriggerProviderService.list_trigger_provider_subscriptions("tenant-1", provider_id)

    # Assert
    assert result == []


def test_list_trigger_provider_subscriptions_should_mask_fields_and_attach_workflow_counts(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    api_sub = SimpleNamespace(
        id="sub-1",
        credentials={"token": "enc"},
        properties={"hook": "enc"},
        parameters={"event": "push"},
        workflows_in_use=0,
    )
    db_sub = SimpleNamespace(to_api_entity=lambda: api_sub)
    usage_row = SimpleNamespace(subscription_id="sub-1", app_count=2)

    mock_session.scalars.return_value.all.return_value = [db_sub]
    mock_session.execute.return_value.all.return_value = [usage_row]

    _mock_get_trigger_provider(mocker, provider_controller)
    cred_enc = _encrypter_mock(decrypted={"token": "plain"}, masked={"token": "****"})
    prop_enc = _encrypter_mock(decrypted={"hook": "plain"}, masked={"hook": "****"})
    mocker.patch(
        "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_subscription",
        return_value=(cred_enc, MagicMock()),
    )
    mocker.patch(
        "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_properties",
        return_value=(prop_enc, MagicMock()),
    )

    # Act
    result = TriggerProviderService.list_trigger_provider_subscriptions("tenant-1", provider_id)

    # Assert
    assert len(result) == 1
    assert result[0].credentials == {"token": "****"}
    assert result[0].properties == {"hook": "****"}
    assert result[0].workflows_in_use == 2


def test_add_trigger_subscription_should_create_subscription_successfully_for_api_key(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    _patch_redis_lock(mocker)
    mock_session.scalar.side_effect = [0, None]  # count=0, no existing name

    _mock_get_trigger_provider(mocker, provider_controller)
    cred_enc = _encrypter_mock(encrypted={"api_key": "enc"})
    prop_enc = _encrypter_mock(encrypted={"project": "enc"})
    mocker.patch(
        "services.trigger.trigger_provider_service.create_provider_encrypter",
        side_effect=[(cred_enc, MagicMock()), (prop_enc, MagicMock())],
    )

    # Act
    result = TriggerProviderService.add_trigger_subscription(
        tenant_id="tenant-1",
        user_id="user-1",
        name="main",
        provider_id=provider_id,
        endpoint_id="endpoint-1",
        credential_type=CredentialType.API_KEY,
        parameters={"event": "push"},
        properties={"project": "demo"},
        credentials={"api_key": "plain"},
    )

    # Assert
    assert result["result"] == "success"
    mock_session.add.assert_called_once()


def test_add_trigger_subscription_should_store_empty_credentials_for_unauthorized_type(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    _patch_redis_lock(mocker)
    mock_session.scalar.side_effect = [0, None]  # count=0, no existing name

    _mock_get_trigger_provider(mocker, provider_controller)
    prop_enc = _encrypter_mock(encrypted={"p": "enc"})
    mocker.patch(
        "services.trigger.trigger_provider_service.create_provider_encrypter",
        return_value=(prop_enc, MagicMock()),
    )

    # Act
    result = TriggerProviderService.add_trigger_subscription(
        tenant_id="tenant-1",
        user_id="user-1",
        name="main",
        provider_id=provider_id,
        endpoint_id="endpoint-1",
        credential_type=CredentialType.UNAUTHORIZED,
        parameters={},
        properties={"p": "v"},
        credentials={},
        subscription_id="sub-fixed",
    )

    # Assert
    assert result == {"result": "success", "id": "sub-fixed"}


def test_add_trigger_subscription_should_raise_error_when_provider_limit_reached(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    _patch_redis_lock(mocker)
    mock_session.scalar.return_value = TriggerProviderService.__MAX_TRIGGER_PROVIDER_COUNT__
    _mock_get_trigger_provider(mocker, provider_controller)
    mock_logger = mocker.patch("services.trigger.trigger_provider_service.logger")

    # Act + Assert
    with pytest.raises(ValueError, match="Maximum number of providers"):
        TriggerProviderService.add_trigger_subscription(
            tenant_id="tenant-1",
            user_id="user-1",
            name="main",
            provider_id=provider_id,
            endpoint_id="endpoint-1",
            credential_type=CredentialType.API_KEY,
            parameters={},
            properties={},
            credentials={},
        )
    mock_logger.exception.assert_called_once()


def test_add_trigger_subscription_should_raise_error_when_name_exists(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    _patch_redis_lock(mocker)
    mock_session.scalar.side_effect = [0, object()]  # count=0, existing name conflict
    _mock_get_trigger_provider(mocker, provider_controller)

    # Act + Assert
    with pytest.raises(ValueError, match="Credential name 'main' already exists"):
        TriggerProviderService.add_trigger_subscription(
            tenant_id="tenant-1",
            user_id="user-1",
            name="main",
            provider_id=provider_id,
            endpoint_id="endpoint-1",
            credential_type=CredentialType.API_KEY,
            parameters={},
            properties={},
            credentials={},
        )


def test_update_trigger_subscription_should_raise_error_when_subscription_not_found(
    mocker: MockerFixture,
    mock_session: MagicMock,
) -> None:
    # Arrange
    _patch_redis_lock(mocker)
    mock_session.scalar.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="not found"):
        TriggerProviderService.update_trigger_subscription("tenant-1", "sub-1")


def test_update_trigger_subscription_should_raise_error_when_name_conflicts(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    _patch_redis_lock(mocker)
    subscription = SimpleNamespace(
        id="sub-1",
        name="old",
        provider_id="langgenius/github/github",
        credential_type=CredentialType.API_KEY,
    )
    mock_session.scalar.side_effect = [subscription, object()]  # found sub, name conflict
    _mock_get_trigger_provider(mocker, provider_controller)

    # Act + Assert
    with pytest.raises(ValueError, match="already exists"):
        TriggerProviderService.update_trigger_subscription("tenant-1", "sub-1", name="new-name")


def test_update_trigger_subscription_should_update_fields_and_clear_cache(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    _patch_redis_lock(mocker)
    subscription = SimpleNamespace(
        id="sub-1",
        name="old",
        tenant_id="tenant-1",
        provider_id="langgenius/github/github",
        properties={"project": "enc-old"},
        parameters={"event": "old"},
        credentials={"api_key": "enc-old"},
        credential_type=CredentialType.API_KEY,
        credential_expires_at=0,
        expires_at=0,
    )
    mock_session.scalar.side_effect = [subscription, None]  # found sub, no name conflict

    _mock_get_trigger_provider(mocker, provider_controller)
    prop_enc = _encrypter_mock(decrypted={"project": "old-value"}, encrypted={"project": "new-value"})
    cred_enc = _encrypter_mock(encrypted={"api_key": "new-key"})
    mocker.patch(
        "services.trigger.trigger_provider_service.create_provider_encrypter",
        side_effect=[(prop_enc, MagicMock()), (cred_enc, MagicMock())],
    )
    mock_delete_cache = mocker.patch("services.trigger.trigger_provider_service.delete_cache_for_subscription")

    # Act
    TriggerProviderService.update_trigger_subscription(
        tenant_id="tenant-1",
        subscription_id="sub-1",
        name="new",
        properties={"project": HIDDEN_VALUE, "region": "us"},
        parameters={"event": "new"},
        credentials={"api_key": "plain-key"},
        credential_expires_at=100,
        expires_at=200,
    )

    # Assert
    assert subscription.name == "new"
    assert subscription.parameters == {"event": "new"}
    assert subscription.credentials == {"api_key": "new-key"}
    assert subscription.credential_expires_at == 100
    assert subscription.expires_at == 200

    mock_delete_cache.assert_called_once()


def test_get_subscription_by_id_should_return_none_when_missing(mocker: MockerFixture, mock_session: MagicMock) -> None:
    # Arrange
    mock_session.scalar.return_value = None

    # Act
    result = TriggerProviderService.get_subscription_by_id("tenant-1", "sub-1")

    # Assert
    assert result is None


def test_get_subscription_by_id_should_decrypt_credentials_and_properties(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(
        id="sub-1",
        tenant_id="tenant-1",
        provider_id="langgenius/github/github",
        credentials={"token": "enc"},
        properties={"project": "enc"},
    )
    mock_session.scalar.return_value = subscription
    _mock_get_trigger_provider(mocker, provider_controller)
    cred_enc = _encrypter_mock(decrypted={"token": "plain"})
    prop_enc = _encrypter_mock(decrypted={"project": "plain"})
    mocker.patch(
        "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_subscription",
        return_value=(cred_enc, MagicMock()),
    )
    mocker.patch(
        "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_properties",
        return_value=(prop_enc, MagicMock()),
    )

    # Act
    result = TriggerProviderService.get_subscription_by_id("tenant-1", "sub-1")

    # Assert
    assert result is subscription
    assert subscription.credentials == {"token": "plain"}
    assert subscription.properties == {"project": "plain"}


def test_delete_trigger_provider_should_raise_error_when_subscription_missing(
    mocker: MockerFixture,
    mock_session: MagicMock,
) -> None:
    # Arrange
    mock_session.scalar.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="not found"):
        TriggerProviderService.delete_trigger_provider(mock_session, "tenant-1", "sub-1")


def test_delete_trigger_provider_should_delete_and_clear_cache_even_if_unsubscribe_fails(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(
        id="sub-1",
        user_id="user-1",
        provider_id=str(provider_id),
        credential_type=CredentialType.OAUTH2,
        credentials={"token": "enc"},
        to_entity=lambda: SimpleNamespace(id="sub-1"),
    )
    mock_session.scalar.return_value = subscription
    _mock_get_trigger_provider(mocker, provider_controller)
    cred_enc = _encrypter_mock(decrypted={"token": "plain"})
    mocker.patch(
        "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_subscription",
        return_value=(cred_enc, MagicMock()),
    )
    mocker.patch(
        "services.trigger.trigger_provider_service.TriggerManager.unsubscribe_trigger",
        side_effect=RuntimeError("remote fail"),
    )
    mock_delete_cache = mocker.patch("services.trigger.trigger_provider_service.delete_cache_for_subscription")

    # Act
    TriggerProviderService.delete_trigger_provider(mock_session, "tenant-1", "sub-1")

    # Assert
    mock_session.delete.assert_called_once_with(subscription)
    mock_delete_cache.assert_called_once()


def test_delete_trigger_provider_should_skip_unsubscribe_for_unauthorized(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(
        id="sub-2",
        user_id="user-1",
        provider_id=str(provider_id),
        credential_type=CredentialType.UNAUTHORIZED,
        credentials={},
        to_entity=lambda: SimpleNamespace(id="sub-2"),
    )
    mock_session.scalar.return_value = subscription
    _mock_get_trigger_provider(mocker, provider_controller)
    mock_unsubscribe = mocker.patch("services.trigger.trigger_provider_service.TriggerManager.unsubscribe_trigger")
    mocker.patch(
        "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_subscription",
        return_value=(_encrypter_mock(decrypted={}), MagicMock()),
    )

    # Act
    TriggerProviderService.delete_trigger_provider(mock_session, "tenant-1", "sub-2")

    # Assert
    mock_unsubscribe.assert_not_called()
    mock_session.delete.assert_called_once_with(subscription)


def test_refresh_oauth_token_should_raise_error_when_subscription_missing(
    mocker: MockerFixture, mock_session: MagicMock
) -> None:
    # Arrange
    mock_session.scalar.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="not found"):
        TriggerProviderService.refresh_oauth_token("tenant-1", "sub-1")


def test_refresh_oauth_token_should_raise_error_for_non_oauth_credentials(
    mocker: MockerFixture, mock_session: MagicMock
) -> None:
    # Arrange
    subscription = SimpleNamespace(credential_type=CredentialType.API_KEY)
    mock_session.scalar.return_value = subscription

    # Act + Assert
    with pytest.raises(ValueError, match="Only OAuth credentials can be refreshed"):
        TriggerProviderService.refresh_oauth_token("tenant-1", "sub-1")


def test_refresh_oauth_token_should_refresh_and_persist_new_credentials(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(
        provider_id=str(provider_id),
        user_id="user-1",
        credential_type=CredentialType.OAUTH2,
        credentials={"access_token": "enc"},
        credential_expires_at=0,
    )
    mock_session.scalar.return_value = subscription
    _mock_get_trigger_provider(mocker, provider_controller)
    cache = MagicMock()
    cred_enc = _encrypter_mock(decrypted={"access_token": "old"}, encrypted={"access_token": "new"})
    mocker.patch(
        "services.trigger.trigger_provider_service.create_provider_encrypter",
        return_value=(cred_enc, cache),
    )
    mocker.patch.object(TriggerProviderService, "get_oauth_client", return_value={"client_id": "id"})
    refreshed = SimpleNamespace(credentials={"access_token": "new"}, expires_at=12345)
    oauth_handler = MagicMock()
    oauth_handler.refresh_credentials.return_value = refreshed
    mocker.patch("services.trigger.trigger_provider_service.OAuthHandler", return_value=oauth_handler)

    # Act
    result = TriggerProviderService.refresh_oauth_token("tenant-1", "sub-1")

    # Assert
    assert result == {"result": "success", "expires_at": 12345}
    assert subscription.credentials == {"access_token": "new"}
    assert subscription.credential_expires_at == 12345

    cache.delete.assert_called_once()


def test_refresh_subscription_should_raise_error_when_subscription_missing(
    mocker: MockerFixture, mock_session: MagicMock
) -> None:
    # Arrange
    mock_session.scalar.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="not found"):
        TriggerProviderService.refresh_subscription("tenant-1", "sub-1", now=100)


def test_refresh_subscription_should_skip_when_not_due(mocker: MockerFixture, mock_session: MagicMock) -> None:
    # Arrange
    subscription = SimpleNamespace(expires_at=200)
    mock_session.scalar.return_value = subscription

    # Act
    result = TriggerProviderService.refresh_subscription("tenant-1", "sub-1", now=100)

    # Assert
    assert result == {"result": "skipped", "expires_at": 200}


def test_refresh_subscription_should_refresh_and_persist_properties(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(
        id="sub-1",
        tenant_id="tenant-1",
        endpoint_id="endpoint-1",
        expires_at=50,
        provider_id=str(provider_id),
        parameters={"event": "push"},
        properties={"p": "enc"},
        credentials={"c": "enc"},
        credential_type=CredentialType.API_KEY,
    )
    mock_session.scalar.return_value = subscription
    _mock_get_trigger_provider(mocker, provider_controller)
    cred_enc = _encrypter_mock(decrypted={"c": "plain"})
    prop_cache = MagicMock()
    prop_enc = _encrypter_mock(decrypted={"p": "plain"}, encrypted={"p": "new-enc"})
    mocker.patch(
        "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_subscription",
        return_value=(cred_enc, MagicMock()),
    )
    mocker.patch(
        "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_properties",
        return_value=(prop_enc, prop_cache),
    )
    mocker.patch(
        "services.trigger.trigger_provider_service.generate_plugin_trigger_endpoint_url",
        return_value="https://endpoint",
    )
    provider_controller.refresh_trigger.return_value = SimpleNamespace(properties={"p": "new"}, expires_at=999)

    # Act
    result = TriggerProviderService.refresh_subscription("tenant-1", "sub-1", now=100)

    # Assert
    assert result == {"result": "success", "expires_at": 999}
    assert subscription.properties == {"p": "new-enc"}
    assert subscription.expires_at == 999

    prop_cache.delete.assert_called_once()


def test_get_oauth_client_should_return_tenant_client_when_available(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    tenant_client = SimpleNamespace(oauth_params={"client_id": "enc"})
    mock_session.scalar.return_value = tenant_client
    _mock_get_trigger_provider(mocker, provider_controller)
    enc = _encrypter_mock(decrypted={"client_id": "plain"})
    mocker.patch("services.trigger.trigger_provider_service.create_provider_encrypter", return_value=(enc, MagicMock()))

    # Act
    result = TriggerProviderService.get_oauth_client("tenant-1", provider_id)

    # Assert
    assert result == {"client_id": "plain"}


def test_get_oauth_client_should_return_none_when_plugin_not_verified(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    mock_session.scalar.return_value = None  # no tenant client; plugin not verified → early return
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch("services.trigger.trigger_provider_service.PluginService.is_plugin_verified", return_value=False)

    # Act
    result = TriggerProviderService.get_oauth_client("tenant-1", provider_id)

    # Assert
    assert result is None


def test_get_oauth_client_should_return_decrypted_system_client_when_verified(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    mock_session.scalar.side_effect = [None, SimpleNamespace(encrypted_oauth_params="enc")]
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch("services.trigger.trigger_provider_service.PluginService.is_plugin_verified", return_value=True)
    mocker.patch(
        "services.trigger.trigger_provider_service.decrypt_system_params",
        return_value={"client_id": "system"},
    )

    # Act
    result = TriggerProviderService.get_oauth_client("tenant-1", provider_id)

    # Assert
    assert result == {"client_id": "system"}


def test_get_oauth_client_should_raise_error_when_system_decryption_fails(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    mock_session.scalar.side_effect = [None, SimpleNamespace(encrypted_oauth_params="enc")]
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch("services.trigger.trigger_provider_service.PluginService.is_plugin_verified", return_value=True)
    mocker.patch(
        "services.trigger.trigger_provider_service.decrypt_system_params",
        side_effect=RuntimeError("bad data"),
    )

    # Act + Assert
    with pytest.raises(ValueError, match="Error decrypting system oauth params"):
        TriggerProviderService.get_oauth_client("tenant-1", provider_id)


def test_is_oauth_system_client_exists_should_return_false_when_unverified(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch("services.trigger.trigger_provider_service.PluginService.is_plugin_verified", return_value=False)

    # Act
    result = TriggerProviderService.is_oauth_system_client_exists("tenant-1", provider_id)

    # Assert
    assert result is False


@pytest.mark.parametrize("has_client", [True, False])
def test_is_oauth_system_client_exists_should_reflect_database_record(
    has_client: bool,
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    mock_session.scalar.return_value = object() if has_client else None
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch("services.trigger.trigger_provider_service.PluginService.is_plugin_verified", return_value=True)

    # Act
    result = TriggerProviderService.is_oauth_system_client_exists("tenant-1", provider_id)

    # Assert
    assert result is has_client


def test_save_custom_oauth_client_params_should_return_success_when_nothing_to_update(
    provider_id: TriggerProviderID,
) -> None:
    # Arrange
    # Act
    result = TriggerProviderService.save_custom_oauth_client_params("tenant-1", provider_id, None, None)

    # Assert
    assert result == {"result": "success"}


def test_save_custom_oauth_client_params_should_create_record_and_clear_params_when_client_params_none(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    mock_session.scalar.return_value = None
    _mock_get_trigger_provider(mocker, provider_controller)
    fake_model = SimpleNamespace(encrypted_oauth_params="", enabled=False, oauth_params={})
    # Also mock select() so SQLAlchemy doesn't validate the patched TriggerOAuthTenantClient.
    mocker.patch("services.trigger.trigger_provider_service.select", MagicMock(return_value=MagicMock()))
    mocker.patch("services.trigger.trigger_provider_service.TriggerOAuthTenantClient", return_value=fake_model)

    # Act
    result = TriggerProviderService.save_custom_oauth_client_params(
        tenant_id="tenant-1",
        provider_id=provider_id,
        client_params=None,
        enabled=True,
    )

    # Assert
    assert result == {"result": "success"}
    assert fake_model.encrypted_oauth_params == "{}"
    assert fake_model.enabled is True
    mock_session.add.assert_called_once_with(fake_model)


def test_save_custom_oauth_client_params_should_merge_hidden_values_and_delete_cache(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    custom_client = SimpleNamespace(oauth_params={"client_id": "enc-old"}, enabled=False)
    mock_session.scalar.return_value = custom_client
    _mock_get_trigger_provider(mocker, provider_controller)
    cache = MagicMock()
    enc = _encrypter_mock(decrypted={"client_id": "old-id"}, encrypted={"client_id": "new-id"})
    mocker.patch(
        "services.trigger.trigger_provider_service.create_provider_encrypter",
        return_value=(enc, cache),
    )

    # Act
    result = TriggerProviderService.save_custom_oauth_client_params(
        tenant_id="tenant-1",
        provider_id=provider_id,
        client_params={"client_id": HIDDEN_VALUE, "client_secret": "new"},
        enabled=None,
    )

    # Assert
    assert result == {"result": "success"}
    assert json.loads(custom_client.encrypted_oauth_params) == {"client_id": "new-id"}
    cache.delete.assert_called_once()


def test_get_custom_oauth_client_params_should_return_empty_when_record_missing(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
) -> None:
    # Arrange
    mock_session.scalar.return_value = None

    # Act
    result = TriggerProviderService.get_custom_oauth_client_params("tenant-1", provider_id)

    # Assert
    assert result == {}


def test_get_custom_oauth_client_params_should_return_masked_decrypted_values(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    custom_client = SimpleNamespace(oauth_params={"client_id": "enc"})
    mock_session.scalar.return_value = custom_client
    _mock_get_trigger_provider(mocker, provider_controller)
    enc = _encrypter_mock(decrypted={"client_id": "plain"}, masked={"client_id": "pl***id"})
    mocker.patch("services.trigger.trigger_provider_service.create_provider_encrypter", return_value=(enc, MagicMock()))

    # Act
    result = TriggerProviderService.get_custom_oauth_client_params("tenant-1", provider_id)

    # Assert
    assert result == {"client_id": "pl***id"}


def test_delete_custom_oauth_client_params_should_delete_record_and_commit(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
) -> None:
    # Act
    result = TriggerProviderService.delete_custom_oauth_client_params("tenant-1", provider_id)

    # Assert
    assert result == {"result": "success"}


@pytest.mark.parametrize("exists", [True, False])
def test_is_oauth_custom_client_enabled_should_return_expected_boolean(
    exists: bool,
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
) -> None:
    # Arrange
    mock_session.scalar.return_value = object() if exists else None

    # Act
    result = TriggerProviderService.is_oauth_custom_client_enabled("tenant-1", provider_id)

    # Assert
    assert result is exists


def test_get_subscription_by_endpoint_should_return_none_when_not_found(
    mocker: MockerFixture, mock_session: MagicMock
) -> None:
    # Arrange
    mock_session.scalar.return_value = None

    # Act
    result = TriggerProviderService.get_subscription_by_endpoint("endpoint-1")

    # Assert
    assert result is None


def test_get_subscription_by_endpoint_should_decrypt_credentials_and_properties(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(
        tenant_id="tenant-1",
        provider_id="langgenius/github/github",
        credentials={"token": "enc"},
        properties={"hook": "enc"},
    )
    mock_session.scalar.return_value = subscription
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch(
        "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_subscription",
        return_value=(_encrypter_mock(decrypted={"token": "plain"}), MagicMock()),
    )
    mocker.patch(
        "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_properties",
        return_value=(_encrypter_mock(decrypted={"hook": "plain"}), MagicMock()),
    )

    # Act
    result = TriggerProviderService.get_subscription_by_endpoint("endpoint-1")

    # Assert
    assert result is subscription
    assert subscription.credentials == {"token": "plain"}
    assert subscription.properties == {"hook": "plain"}


def test_verify_subscription_credentials_should_raise_when_provider_not_found(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
) -> None:
    # Arrange
    _mock_get_trigger_provider(mocker, None)

    # Act + Assert
    with pytest.raises(ValueError, match="Provider .* not found"):
        TriggerProviderService.verify_subscription_credentials(
            tenant_id="tenant-1",
            user_id="user-1",
            provider_id=provider_id,
            subscription_id="sub-1",
            credentials={},
        )


def test_verify_subscription_credentials_should_raise_when_subscription_not_found(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch.object(TriggerProviderService, "get_subscription_by_id", return_value=None)

    # Act + Assert
    with pytest.raises(ValueError, match="Subscription sub-1 not found"):
        TriggerProviderService.verify_subscription_credentials(
            tenant_id="tenant-1",
            user_id="user-1",
            provider_id=provider_id,
            subscription_id="sub-1",
            credentials={},
        )


def test_verify_subscription_credentials_should_raise_when_api_key_validation_fails(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(credential_type=CredentialType.API_KEY, credentials={"api_key": "old"})
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch.object(TriggerProviderService, "get_subscription_by_id", return_value=subscription)
    provider_controller.validate_credentials.side_effect = RuntimeError("bad credentials")

    # Act + Assert
    with pytest.raises(ValueError, match="Invalid credentials: bad credentials"):
        TriggerProviderService.verify_subscription_credentials(
            tenant_id="tenant-1",
            user_id="user-1",
            provider_id=provider_id,
            subscription_id="sub-1",
            credentials={"api_key": HIDDEN_VALUE},
        )


def test_verify_subscription_credentials_should_return_verified_when_api_key_validation_succeeds(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(credential_type=CredentialType.API_KEY, credentials={"api_key": "old"})
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch.object(TriggerProviderService, "get_subscription_by_id", return_value=subscription)

    # Act
    result = TriggerProviderService.verify_subscription_credentials(
        tenant_id="tenant-1",
        user_id="user-1",
        provider_id=provider_id,
        subscription_id="sub-1",
        credentials={"api_key": HIDDEN_VALUE},
    )

    # Assert
    assert result == {"verified": True}


def test_verify_subscription_credentials_should_return_verified_for_non_api_key_credentials(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(credential_type=CredentialType.OAUTH2, credentials={})
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch.object(TriggerProviderService, "get_subscription_by_id", return_value=subscription)

    # Act
    result = TriggerProviderService.verify_subscription_credentials(
        tenant_id="tenant-1",
        user_id="user-1",
        provider_id=provider_id,
        subscription_id="sub-1",
        credentials={},
    )

    # Assert
    assert result == {"verified": True}


def test_rebuild_trigger_subscription_should_raise_when_provider_not_found(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
) -> None:
    # Arrange
    _mock_get_trigger_provider(mocker, None)

    # Act + Assert
    with pytest.raises(ValueError, match="Provider .* not found"):
        TriggerProviderService.rebuild_trigger_subscription(
            tenant_id="tenant-1",
            provider_id=provider_id,
            subscription_id="sub-1",
            credentials={},
            parameters={},
        )


def test_rebuild_trigger_subscription_should_raise_when_subscription_not_found(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch.object(TriggerProviderService, "get_subscription_by_id", return_value=None)

    # Act + Assert
    with pytest.raises(ValueError, match="Subscription sub-1 not found"):
        TriggerProviderService.rebuild_trigger_subscription(
            tenant_id="tenant-1",
            provider_id=provider_id,
            subscription_id="sub-1",
            credentials={},
            parameters={},
        )


def test_rebuild_trigger_subscription_should_raise_for_unsupported_credential_type(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(credential_type=CredentialType.UNAUTHORIZED)
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch.object(TriggerProviderService, "get_subscription_by_id", return_value=subscription)

    # Act + Assert
    with pytest.raises(ValueError, match="not supported for auto creation"):
        TriggerProviderService.rebuild_trigger_subscription(
            tenant_id="tenant-1",
            provider_id=provider_id,
            subscription_id="sub-1",
            credentials={},
            parameters={},
        )


def test_rebuild_trigger_subscription_should_raise_when_unsubscribe_fails(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(
        id="sub-1",
        user_id="user-1",
        endpoint_id="endpoint-1",
        credential_type=CredentialType.API_KEY,
        credentials={"api_key": "old"},
        to_entity=lambda: SimpleNamespace(id="sub-1"),
    )
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch.object(TriggerProviderService, "get_subscription_by_id", return_value=subscription)
    mocker.patch(
        "services.trigger.trigger_provider_service.TriggerManager.unsubscribe_trigger",
        return_value=SimpleNamespace(success=False, message="remote error"),
    )

    # Act + Assert
    with pytest.raises(ValueError, match="Failed to delete previous subscription"):
        TriggerProviderService.rebuild_trigger_subscription(
            tenant_id="tenant-1",
            provider_id=provider_id,
            subscription_id="sub-1",
            credentials={},
            parameters={},
        )


def test_rebuild_trigger_subscription_should_resubscribe_and_update_existing_subscription(
    mocker: MockerFixture,
    mock_session: MagicMock,
    provider_id: TriggerProviderID,
    provider_controller: MagicMock,
) -> None:
    # Arrange
    subscription = SimpleNamespace(
        id="sub-1",
        user_id="user-1",
        endpoint_id="endpoint-1",
        credential_type=CredentialType.API_KEY,
        credentials={"api_key": "old-key"},
        to_entity=lambda: SimpleNamespace(id="sub-1"),
    )
    new_subscription = SimpleNamespace(properties={"project": "new"}, expires_at=888)
    _mock_get_trigger_provider(mocker, provider_controller)
    mocker.patch.object(TriggerProviderService, "get_subscription_by_id", return_value=subscription)
    mocker.patch(
        "services.trigger.trigger_provider_service.TriggerManager.unsubscribe_trigger",
        return_value=SimpleNamespace(success=True, message="ok"),
    )
    mock_subscribe = mocker.patch(
        "services.trigger.trigger_provider_service.TriggerManager.subscribe_trigger",
        return_value=new_subscription,
    )
    mocker.patch(
        "services.trigger.trigger_provider_service.generate_plugin_trigger_endpoint_url",
        return_value="https://endpoint",
    )
    mock_update = mocker.patch.object(TriggerProviderService, "update_trigger_subscription")

    # Act
    TriggerProviderService.rebuild_trigger_subscription(
        tenant_id="tenant-1",
        provider_id=provider_id,
        subscription_id="sub-1",
        credentials={"api_key": HIDDEN_VALUE, "region": "us"},
        parameters={"event": "push"},
        name="updated",
    )

    # Assert
    call_kwargs = mock_subscribe.call_args.kwargs
    assert call_kwargs["credentials"]["api_key"] == "old-key"
    assert call_kwargs["credentials"]["region"] == "us"
    mock_update.assert_called_once_with(
        tenant_id="tenant-1",
        subscription_id="sub-1",
        name="updated",
        parameters={"event": "push"},
        credentials={"api_key": "old-key", "region": "us"},
        properties={"project": "new"},
        expires_at=888,
    )
