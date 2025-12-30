import types
from unittest.mock import MagicMock, patch

import pytest

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import Subscription as TriggerSubscriptionEntity
from core.trigger.entities.entities import UnsubscribeResult
from models.provider_ids import TriggerProviderID
from services.trigger.trigger_provider_service import TriggerProviderService


def _make_mock_session_with_subscription(subscription):
    """Create a MagicMock Session context manager that returns a session with the given subscription."""
    session = MagicMock()

    # session.query(TriggerSubscription).filter_by(...).first() -> subscription
    query = MagicMock()
    filter_result = MagicMock()
    filter_result.first.return_value = subscription
    query.filter_by.return_value = filter_result
    session.query.return_value = query

    # session context manager
    cm = MagicMock()
    cm.__enter__.return_value = session
    cm.__exit__.return_value = None

    return cm, session


@pytest.fixture
def minimal_subscription():
    """A minimal subscription object with required attributes and to_entity()."""
    sub = types.SimpleNamespace()
    sub.id = "sub-123"
    sub.tenant_id = "tenant-abc"
    sub.user_id = "user-xyz"
    sub.provider_id = "acme/plugin/provider"
    sub.endpoint_id = "endpoint-001"
    sub.name = "original-name"
    sub.parameters = {"p": 1}
    sub.properties = {"prop": "v"}
    sub.credentials = {"api_key": "orig"}
    sub.credential_type = CredentialType.API_KEY.value  # "api-key"
    sub.expires_at = -1

    def to_entity():
        return TriggerSubscriptionEntity(
            expires_at=sub.expires_at if isinstance(sub.expires_at, int) else -1,
            endpoint=sub.endpoint_id,
            parameters=sub.parameters,
            properties=sub.properties,
        )

    sub.to_entity = to_entity
    return sub


@pytest.fixture
def common_patches(minimal_subscription):
    """Patch external dependencies used by rebuild_trigger_subscription."""
    with (
        patch("services.trigger.trigger_provider_service.TriggerManager") as mock_tm,
        patch("services.trigger.trigger_provider_service.redis_client") as mock_redis,
        patch(
            "services.trigger.trigger_provider_service.delete_cache_for_subscription",
        ) as mock_delete_cache,
        patch(
            "services.trigger.trigger_provider_service.generate_plugin_trigger_endpoint_url",
            return_value="https://cb",
        ) as _,
        patch(
            "services.trigger.trigger_provider_service.create_trigger_provider_encrypter_for_subscription",
        ) as mock_sub_encr,
        patch(
            "services.trigger.trigger_provider_service.create_provider_encrypter",
        ) as mock_prop_encr,
        patch("services.trigger.trigger_provider_service.Session") as mock_session_cls,
        # Critical: prevent touching Flask-SQLAlchemy's real db.engine property
        patch("services.trigger.trigger_provider_service.db") as mock_db,
    ):
        # Mock provider controller return
        mock_controller = MagicMock()
        mock_tm.get_trigger_provider.return_value = mock_controller

        # Mock redis lock context manager
        lock_cm = MagicMock()
        lock_cm.__enter__.return_value = None
        lock_cm.__exit__.return_value = None
        mock_redis.lock.return_value = lock_cm

        # Encrypters: identity encrypt/decrypt
        cred_encrypter = MagicMock()
        cred_encrypter.decrypt.side_effect = lambda x: x
        cred_encrypter.encrypt.side_effect = lambda x: x
        mock_sub_encr.return_value = (cred_encrypter, MagicMock())

        prop_encrypter = MagicMock()
        prop_encrypter.encrypt.side_effect = lambda x: x
        mock_prop_encr.return_value = (prop_encrypter, MagicMock())

        # Provide a harmless engine so accessing db.engine doesn't require app context
        mock_db.engine = MagicMock()

        # Session returning our subscription
        cm, session = _make_mock_session_with_subscription(minimal_subscription)
        mock_session_cls.return_value = cm

        yield {
            "tm": mock_tm,
            "redis": mock_redis,
            "delete_cache": mock_delete_cache,
            "session": session,
            "controller": mock_controller,
        }


def test_rebuild_raises_when_unsubscribe_fails(common_patches, minimal_subscription):
    provider_id = TriggerProviderID(minimal_subscription.provider_id)

    # unsubscribe returns failure
    common_patches["tm"].unsubscribe_trigger.return_value = UnsubscribeResult(success=False, message="provider-error")

    with pytest.raises(ValueError, match="Failed to unsubscribe"):
        TriggerProviderService.rebuild_trigger_subscription(
            tenant_id=minimal_subscription.tenant_id,
            provider_id=provider_id,
            subscription_id=minimal_subscription.id,
            credentials={"api_key": "new"},
            parameters={"p": 2},
            name="new-name",
        )

    # Should not have attempted to subscribe when unsubscribe failed
    common_patches["tm"].subscribe_trigger.assert_not_called()
    # No commit on failure path
    common_patches["session"].commit.assert_not_called()


def test_rebuild_unsubscribe_then_subscribe_success(common_patches, minimal_subscription):
    provider_id = TriggerProviderID(minimal_subscription.provider_id)

    # unsubscribe OK
    common_patches["tm"].unsubscribe_trigger.return_value = UnsubscribeResult(success=True, message="ok")

    # subscribe returns a new subscription entity
    common_patches["tm"].subscribe_trigger.return_value = TriggerSubscriptionEntity(
        expires_at=123456,
        endpoint="https://cb",
        parameters={"p": 2},
        properties={},
    )

    TriggerProviderService.rebuild_trigger_subscription(
        tenant_id=minimal_subscription.tenant_id,
        provider_id=provider_id,
        subscription_id=minimal_subscription.id,
        credentials={"api_key": "new"},
        parameters={"p": 2},
        name="new-name",
    )

    # Unsubscribe called with expected args; we at least ensure it was invoked
    common_patches["tm"].unsubscribe_trigger.assert_called_once()
    # Subscribe called
    common_patches["tm"].subscribe_trigger.assert_called_once()
    # Transaction committed
    common_patches["session"].commit.assert_called_once()
    # Cache cleared
    common_patches["delete_cache"].assert_called_once()
