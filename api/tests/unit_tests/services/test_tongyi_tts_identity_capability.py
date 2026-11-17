"""Existing identity TTS admission/redirect, not a new version gate or live call."""

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest

from core.model_invocation_routing import RoutedModelCredentials
from core.plugin.impl.model import PluginModelClient
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_mapping import ModelMapping, model_schema_digest
from services.model_billing_mapping_service import (
    build_source_adapter_contract,
    mapping_has_required_operations,
    validate_frozen_mapping_evidence,
)
from tests.unit_tests.core.test_model_invocation_routing import plan
from tests.unit_tests.services.test_model_billing_mapping_service import mapping

SOURCE_UID = "langgenius/tongyi:0.2.27@d9409c7d4e1ab9358330ee1c9897c29060f739657ec11e4aaab92f4265b376b6"
PROVIDER = "langgenius/tongyi/tongyi"
MODEL = "qwen3-tts-flash"
OPERATIONS = ("model/schema", "tts/invoke", "tts/model/voices")


def source_schema():
    """Load actual latest Source SDK -> normal Go/Core DTO, not target defaults."""
    raw = json.loads((Path(__file__).with_name("fixtures") / "tongyi0227_tts_source_schema.json").read_text())
    return AIModelEntity.model_validate(raw)


def rule():
    """Use the existing identity rule; this unit fixture is not a published revision."""
    source = source_schema()
    record = mapping(source, revision="offline-tts-identity-capability", target=MODEL)
    record["source"]["provider_id"] = PROVIDER
    record["operations"] = list(OPERATIONS)
    evidence = {
        "algorithm": "identity_v1",
        "source_schema_digest": model_schema_digest(source),
        "semantics": "content_text_and_voice_unchanged; native_same_voice_fallback_wav512_golden",
    }
    record["parameter_adapter"]["rules_digest"] = (
        "sha256:" + hashlib.sha256(json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    )
    return ModelMapping.model_validate(record)


def test_existing_tts_identity_needs_no_new_exact_version_factory():
    source = source_schema()
    assert model_schema_digest(source) == "sha256:9c7c55630c909bd1115fef435f0f01a668db008eb06c990da2ee6c67c399c125"
    record = rule()
    assert mapping_has_required_operations(record)
    assert (
        build_source_adapter_contract(
            record,
            source_provider=PROVIDER,
            source_plugin_unique_identifier=SOURCE_UID,
            source_schema=source,
            source_credentials=None,
        )
        is None
    )
    validate_frozen_mapping_evidence(
        record,
        provider=PROVIDER,
        model=MODEL,
        model_type=ModelType.TTS,
        target_model=MODEL,
        operations=OPERATIONS,
        source_contract=None,
        tts_contract=None,
    )
    with pytest.raises(ValueError, match="Frozen mapping identity or target changed"):
        validate_frozen_mapping_evidence(
            record,
            provider=PROVIDER,
            model="different",
            model_type=ModelType.TTS,
            target_model=MODEL,
            operations=OPERATIONS,
            source_contract=None,
            tts_contract=None,
        )


@pytest.mark.parametrize("operation", ["tts/invoke", "tts/model/voices"])
def test_normal_original_provider_payload_is_really_redirected_without_changing_voice(mocker, operation):
    frozen = replace(
        plan(),
        logical_provider=PROVIDER,
        logical_model=MODEL,
        target_model=MODEL,
        model_type=ModelType.TTS,
        operations=OPERATIONS,
        source_parameter_contract=None,
        tts_voice_contract=None,
    )
    mocker.patch("core.model_invocation_routing.managed_credentials", return_value={"api_key": "OFFLINE_MANAGED_TEST"})
    data = {
        "provider": "tongyi",
        "model": MODEL,
        "model_type": "tts",
        "credentials": RoutedModelCredentials(frozen),
        "tenant_id": frozen.tenant_id,
        "content_text": "Original text",
        "voice": None,
    }
    payload = PluginModelClient._dispatch_payload(user_id=None, data=data)
    assert payload["data"]["credentials"] == {}
    assert payload["data"]["voice"] is None
    assert payload["redirect"]["target"]["credentials"] == {"api_key": "OFFLINE_MANAGED_TEST"}
    url, _, body, _, _ = PluginModelClient()._prepare_request(
        f"plugin/{frozen.tenant_id}/dispatch/{operation}",
        {
            "Content-Type": "application/json",
            "X-Plugin-ID": "langgenius/tongyi",
            "X-Plugin-Unique-Identifier": SOURCE_UID,
        },
        payload,
        None,
        None,
    )
    assert url.endswith(f"plugin/{frozen.tenant_id}/dispatch/redirect/v1/{operation}")
    actual = json.loads(body)
    assert actual["data"]["provider"] == "tongyi"
    assert actual["data"]["model"] == MODEL
    assert actual["redirect"]["target"]["model"] == MODEL
    assert "_dify_source_contract" not in actual["redirect"]["target"]["credentials"]


def test_ordinary_byok_dictionary_is_not_a_redirect_capability():
    original = {
        "provider": "tongyi",
        "model": MODEL,
        "model_type": "tts",
        "credentials": {"dashscope_api_key": "OFFLINE_BYOK_TEST"},
        "voice": "Cherry",
    }
    payload = PluginModelClient._dispatch_payload(user_id=None, data=original)
    assert "redirect" not in payload
    assert payload["data"] == original
