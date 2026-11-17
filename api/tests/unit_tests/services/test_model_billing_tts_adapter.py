"""Pure policy tests against the exact reviewed OpenAI 1.0.8 declaration."""

import hashlib
import json
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey
from services.entities.model_billing_mapping import model_schema_digest
from services.model_billing_tts_adapter import (
    REVIEWED_SOURCE_MODEL,
    REVIEWED_SOURCE_PLUGIN_UID,
    REVIEWED_SOURCE_PROVIDER,
    TTS_SOURCE_VOICE_ADAPTER_ID,
    TTS_SOURCE_VOICE_ADAPTER_REVISION,
    TTSVoiceAdapterError,
    TTSVoiceContract,
    build_tts_voice_contract,
    normalize_tts_voice,
    tts_source_voice_rules_digest,
)

SOURCE_PATH = Path(__file__).with_name("fixtures") / "model_billing_tts_adapter_source.yaml"


class _ContractArguments(TypedDict, closed=True):
    adapter_id: str
    adapter_revision: str
    source_provider: str
    source_model: str
    source_plugin_unique_identifier: str
    source_schema: AIModelEntity
    expected_source_schema_digest: str


def source_schema() -> AIModelEntity:
    raw = SOURCE_PATH.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == "a3b13b6e3d2286a032448ae5794bdf59bddbe47f53d8ccfa2abf3830fe0d379b"
    # Captured by dify-plugin 0.10.2 AIModelEntity.model_validate from these
    # exact archive bytes: SDK fills label/fetch_from before Core receives it.
    sdk_schema = SOURCE_PATH.with_name("model_billing_tts_adapter_sdk_source.json")
    return AIModelEntity.model_validate_json(sdk_schema.read_text())


def contract_for(schema: AIModelEntity | None = None) -> TTSVoiceContract:
    schema = schema or source_schema()
    args: _ContractArguments = {
        "adapter_id": TTS_SOURCE_VOICE_ADAPTER_ID,
        "adapter_revision": TTS_SOURCE_VOICE_ADAPTER_REVISION,
        "source_provider": REVIEWED_SOURCE_PROVIDER,
        "source_model": REVIEWED_SOURCE_MODEL,
        "source_plugin_unique_identifier": REVIEWED_SOURCE_PLUGIN_UID,
        "source_schema": schema,
        "expected_source_schema_digest": model_schema_digest(schema),
    }
    result = build_tts_voice_contract(**args, expected_rules_digest=tts_source_voice_rules_digest(**args))
    assert result is not None
    return result


@pytest.mark.parametrize(
    "voice",
    ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse", "marin", "cedar"],
)
def test_all_declared_source_voices_are_preserved(voice: str) -> None:
    assert normalize_tts_voice(contract_for(), voice) == voice


@pytest.mark.parametrize("voice", ["", "unknown", " ALLOY ", "Nova", " "])
def test_empty_or_invalid_voice_uses_reviewed_source_default(voice: str) -> None:
    contract = contract_for()
    assert contract.default_voice == "alloy"
    assert normalize_tts_voice(contract, voice) == "alloy"


@pytest.mark.parametrize("default", [None, ""])
def test_absent_source_default_uses_source_first_voice(default: str | None) -> None:
    schema = source_schema()
    schema.model_properties[ModelPropertyKey.DEFAULT_VOICE] = default
    assert normalize_tts_voice(contract_for(schema), "") == "alloy"


@pytest.mark.parametrize(
    ("property_key", "value"),
    [
        (ModelPropertyKey.DEFAULT_VOICE, "not-declared"),
        (ModelPropertyKey.DEFAULT_VOICE, 0),
        (ModelPropertyKey.VOICES, []),
        (ModelPropertyKey.VOICES, [{"mode": "alloy"}, {"mode": "alloy"}]),
        (ModelPropertyKey.VOICES, [{"mode": ""}]),
        (ModelPropertyKey.VOICES, ["alloy"]),
    ],
)
def test_malformed_source_metadata_fails_closed(property_key: ModelPropertyKey, value: object) -> None:
    schema = source_schema()
    schema.model_properties[property_key] = value
    with pytest.raises(TTSVoiceAdapterError):
        contract_for(schema)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("adapter_id", "unknown"),
        ("adapter_revision", "2"),
        ("source_provider", "langgenius/another/another"),
        ("source_model", "tts-1"),
        ("source_plugin_unique_identifier", "langgenius/openai:1.0.9@" + "a" * 64),
        ("expected_source_schema_digest", "sha256:" + "0" * 64),
        ("expected_rules_digest", "sha256:" + "0" * 64),
    ],
)
def test_each_evidence_binding_is_enforced(field: str, value: str) -> None:
    schema = source_schema()
    valid = contract_for(schema)
    args: dict[str, str] = {
        "adapter_id": valid.adapter_id,
        "adapter_revision": valid.algorithm_revision,
        "source_provider": valid.source_provider,
        "source_model": valid.source_model,
        "source_plugin_unique_identifier": valid.source_plugin_unique_identifier,
        "expected_source_schema_digest": valid.source_schema_digest,
        "expected_rules_digest": valid.rules_digest,
    }
    args[field] = value
    with pytest.raises(TTSVoiceAdapterError):
        build_tts_voice_contract(
            adapter_id=args["adapter_id"],
            adapter_revision=args["adapter_revision"],
            source_provider=args["source_provider"],
            source_model=args["source_model"],
            source_plugin_unique_identifier=args["source_plugin_unique_identifier"],
            source_schema=schema,
            expected_source_schema_digest=args["expected_source_schema_digest"],
            expected_rules_digest=args["expected_rules_digest"],
        )


def test_legacy_identity_does_not_apply_or_reinterpret_voice_rules() -> None:
    assert (
        build_tts_voice_contract(
            adapter_id="identity_v1",
            adapter_revision="old",
            expected_rules_digest="old",
            source_provider="old",
            source_model="old",
            source_plugin_unique_identifier="old",
            source_schema=source_schema(),
            expected_source_schema_digest="old",
        )
        is None
    )


def test_contract_is_frozen_and_changed_evidence_cannot_dispatch() -> None:
    contract = contract_for()
    with pytest.raises(FrozenInstanceError):
        contract.default_voice = "nova"  # type: ignore[misc]
    for changed in [
        replace(contract, default_voice="nova"),
        replace(contract, voices=tuple(reversed(contract.voices))),
    ]:
        with pytest.raises(TTSVoiceAdapterError, match="rules changed"):
            normalize_tts_voice(changed, "")


def test_rules_digest_binds_source_schema_and_resolved_default() -> None:
    schema = source_schema()
    initial = contract_for(schema)
    assert (
        model_schema_digest(schema)
        == "sha256:"
        + hashlib.sha256(
            json.dumps(
                schema.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
            ).encode()
        ).hexdigest()
    )
    schema.model_properties[ModelPropertyKey.DEFAULT_VOICE] = "nova"
    changed = contract_for(schema)
    assert changed.source_schema_digest != initial.source_schema_digest
    assert changed.rules_digest != initial.rules_digest
    assert normalize_tts_voice(changed, "") == "nova"
