"""The subscription codec uses the existing workspace key provider and schema semantics."""

from core.entities.provider_entities import BasicProviderConfig, ProviderConfigType
from services.trigger.subscription_codec import ProviderTriggerSubscriptionCodec
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness


def test_codec_round_trips_secret_fields_and_preserves_other_values(harness: _Harness) -> None:
    schema = [
        BasicProviderConfig(name="token", type=ProviderConfigType.SECRET_INPUT),
        BasicProviderConfig(name="label", type=ProviderConfigType.TEXT_INPUT),
    ]
    values: dict[str, object] = {"token": "secret-token", "label": "public", "count": 0}
    with harness.app.app_context():
        cipher = ProviderTriggerSubscriptionCodec().for_schema(tenant_id=harness.tenant_id, schema=schema)
        encrypted = cipher.encrypt(values)
        assert encrypted["token"] != values["token"]
        assert encrypted["label"] == "public"
        assert encrypted["count"] == 0
        assert cipher.decrypt(encrypted) == values
    assert values == {"token": "secret-token", "label": "public", "count": 0}


def test_codec_with_empty_schema_keeps_values(harness: _Harness) -> None:
    values = {"token": "unmodified", "empty": ""}
    cipher = ProviderTriggerSubscriptionCodec().for_schema(tenant_id=harness.tenant_id, schema=[])
    assert cipher.encrypt(values) == values
    assert cipher.decrypt(values) == values
