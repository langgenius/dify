"""Finite audio policy using exact real profiles, catalog and Go/Core schemas."""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
from collections.abc import Callable
from dataclasses import FrozenInstanceError, asdict, fields, replace
from operator import itemgetter
from pathlib import Path
from typing import Literal, cast

import pytest
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services import model_billing_openai_audio_adapter as adapter
from services.entities.model_billing_mapping import (
    SourceParameterContract,
    model_schema_digest,
)
from tests.helpers.unit.model_billing_openai110_artifact_profiles import ArtifactProfile
from tests.helpers.unit.model_billing_openai110_artifact_profiles import cases as _artifact_cases
from tests.helpers.unit.model_billing_openai110_artifact_profiles import verify_factory_case as _verify_artifact_case


class _Profile(TypedDict):
    adapter_id: str
    adapter_revision: str
    source_version: str
    source_model: str
    source_plugin_uid: str
    source_schema_digest: str
    source_runtime_schema_digest: str
    target_model: str
    profile_id: str


class _Row(TypedDict):
    source_version: str
    source_model: str
    source_catalog_schema: object
    source_daemon_schema: object
    source_schema_digest: str
    daemon_runtime_schema_digest: str
    source_schema_status: str


class _SettingsArguments(TypedDict, closed=True):
    source_endpoint_class: Literal["unset", "official_root"]
    api_protocol_behavior: Literal["not_used"]
    request_metadata_behavior: Literal["not_used"]


class _IdentityArguments(TypedDict, closed=True):
    adapter_id: str
    source_provider: str
    source_model: str
    source_plugin_unique_identifier: str
    model_type: ModelType
    target_model: str


class _BuildArguments(TypedDict, closed=True):
    adapter_id: str
    adapter_revision: str
    expected_rules_digest: str
    source_provider: str
    source_model: str
    source_plugin_unique_identifier: str
    source_schema: AIModelEntity
    expected_source_schema_digest: str
    expected_source_runtime_schema_digest: str
    target_model: str
    source_settings: adapter.SourceAudioSettings
    source_runtime_schema: AIModelEntity | None


class _RestoreArguments(TypedDict, closed=True):
    source_provider: str
    source_model: str
    model_type: ModelType
    target_model: str
    source_settings: adapter.SourceAudioSettings
    expected_source_runtime_schema_digest: str
    source_runtime_schema: AIModelEntity | None


def _identity(**arguments: object) -> None:
    adapter.validate_openai_audio_identity(**cast(_IdentityArguments, arguments))


def _build(**arguments: object) -> adapter.OpenAIAudioSourceContract:
    # Negative cases deliberately cross the public signature with malformed facts.
    return adapter.build_openai_audio_source_contract(**cast(_BuildArguments, arguments))


def _restore(marker: object, **arguments: object) -> adapter.OpenAIAudioSourceContract:
    return adapter.restore_openai_audio_source_contract(marker, **cast(_RestoreArguments, arguments))


def _attempt_assignment(instance: object, field: str, value: object) -> None:
    setattr(instance, field, value)


_FIXTURES = Path(__file__).with_name("fixtures")
_PACKET = json.loads((_FIXTURES / "model_billing_openai_audio_source_matrix.packed.json").read_bytes())
_MATRIX = json.loads(gzip.decompress(base64.b64decode(_PACKET["payload_base64"])))
_ROWS = {
    (r["source_version"], r["source_model"]): r
    for r in cast(list[_Row], _MATRIX["rows"])
    if r["source_schema_status"] == "source_sdk_schema_positive"
}


def _kind(model: str) -> ModelType:
    return ModelType.TTS if model in {"tts-1", "tts-1-hd", "gpt-4o-mini-tts-2025-12-15"} else ModelType.SPEECH2TEXT


def _adapter_id(model: str) -> str:
    return (
        adapter.OPENAI_TTS_SOURCE_ADAPTER_ID if _kind(model) is ModelType.TTS else adapter.OPENAI_STT_SOURCE_ADAPTER_ID
    )


def _settings(endpoint: Literal["unset", "official_root"] = "unset") -> adapter.SourceAudioSettings:
    return adapter.SourceAudioSettings(endpoint, "not_used", "not_used")


@pytest.mark.parametrize("endpoint", ["unset", "official_root"])
def test_positive_settings_are_three_required_immutable_facts(endpoint: Literal["unset", "official_root"]) -> None:
    settings = _settings(endpoint)
    adapter.validate_openai_audio_settings(settings)
    assert asdict(settings) == {
        "source_endpoint_class": endpoint,
        "api_protocol_behavior": "not_used",
        "request_metadata_behavior": "not_used",
    }
    with pytest.raises(FrozenInstanceError):
        _attempt_assignment(settings, "source_endpoint_class", "unreviewed")
    constructor = cast(Callable[..., adapter.SourceAudioSettings], cast(object, adapter.SourceAudioSettings))
    with pytest.raises(TypeError):
        constructor()
    with pytest.raises(TypeError):
        constructor(endpoint, "not_used")


@pytest.mark.parametrize(
    "field",
    ["source_endpoint_class", "api_protocol_behavior", "request_metadata_behavior"],
)
@pytest.mark.parametrize(
    "value",
    [None, True, False, 0, 1, "", "unknown", "custom", "https://secret.invalid"],
)
def test_raw_flags_nullable_guesses_and_custom_endpoints_never_become_positive_facts(field: str, value: object) -> None:
    values = {
        "source_endpoint_class": "unset",
        "api_protocol_behavior": "not_used",
        "request_metadata_behavior": "not_used",
        field: value,
    }
    with pytest.raises(adapter.OpenAIAudioSourceAdapterError) as error:
        adapter.SourceAudioSettings(**cast(_SettingsArguments, values))
    assert "secret.invalid" not in str(error.value)


@pytest.mark.parametrize("value", [None, {}, True, "unset"])
def test_foreign_settings_types_are_rejected(value: object) -> None:
    with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
        adapter.validate_openai_audio_settings(cast(adapter.SourceAudioSettings, value))


def test_uninitialized_settings_object_is_not_authority() -> None:
    settings = object.__new__(adapter.SourceAudioSettings)
    with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
        adapter.validate_openai_audio_settings(settings)


@pytest.mark.parametrize("version", ["042", "110"])
@pytest.mark.parametrize("model", sorted(adapter.OPENAI_AUDIO_SOURCE_MODELS))
def test_exact_13_positive_pairs_three_none_and_no_aliases(version: Literal["042", "110"], model: str) -> None:
    arguments = {
        "adapter_id": _adapter_id(model),
        "source_provider": adapter.OPENAI_AUDIO_SOURCE_PROVIDER,
        "source_model": model,
        "source_plugin_unique_identifier": adapter.OPENAI_AUDIO_SOURCE_UIDS[version],
        "model_type": _kind(model),
        "target_model": model,
    }
    if (version, model) in _ROWS:
        _identity(**arguments)
    else:
        with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
            _identity(**arguments)
    with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
        _identity(**{**arguments, "target_model": model + "-alias"})
    with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
        _identity(
            **{
                **arguments,
                "adapter_id": adapter.OPENAI_STT_SOURCE_ADAPTER_ID
                if _kind(model) is ModelType.TTS
                else adapter.OPENAI_TTS_SOURCE_ADAPTER_ID,
            }
        )


@pytest.mark.parametrize(("version", "model"), list(_ROWS))
def test_audio_schema_type_and_name_are_complete_without_chat_mode(version: str, model: str) -> None:
    row = _ROWS[(version, model)]
    schema = AIModelEntity.model_validate(row["source_catalog_schema"])
    assert "mode" not in schema.model_dump(mode="json")["model_properties"]
    assert adapter._schema_digest(schema, model, _kind(model)) == row["source_schema_digest"]
    for invalid in (
        None,
        schema.model_copy(update={"model": model + "-changed"}),
        schema.model_copy(update={"model_type": ModelType.LLM}),
        schema.model_copy(update={"model_type": schema.model_type.value}),
    ):
        with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
            adapter._schema_digest(cast(AIModelEntity, invalid), model, _kind(model))


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("adapter_id", "openai_credit_llm_source_v1"),
        ("source_provider", "openai"),
        ("source_model", "gpt-4o-mini"),
        ("source_plugin_unique_identifier", "langgenius/openai:1.1.0@" + "0" * 64),
        ("model_type", ModelType.LLM),
        ("model_type", "tts"),
        ("target_model", "tts-1-hd"),
    ],
)
def test_other_families_provider_ids_uids_and_types_are_closed(key: str, value: object) -> None:
    values = {
        "adapter_id": adapter.OPENAI_TTS_SOURCE_ADAPTER_ID,
        "source_provider": adapter.OPENAI_AUDIO_SOURCE_PROVIDER,
        "source_model": "tts-1",
        "source_plugin_unique_identifier": adapter.OPENAI_AUDIO_SOURCE_UIDS["042"],
        "model_type": ModelType.TTS,
        "target_model": "tts-1",
        key: value,
    }
    with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
        _identity(**values)


def test_unreviewed_rules_never_authorize_a_contract_or_marker() -> None:
    row = _ROWS[("042", "tts-1")]
    schema = AIModelEntity.model_validate(row["source_catalog_schema"])
    with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
        _build(
            adapter_id=adapter.OPENAI_TTS_SOURCE_ADAPTER_ID,
            adapter_revision="1",
            expected_rules_digest="unreviewed-not-a-placeholder-contract",
            source_provider=adapter.OPENAI_AUDIO_SOURCE_PROVIDER,
            source_model="tts-1",
            source_plugin_unique_identifier=adapter.OPENAI_AUDIO_SOURCE_UIDS["042"],
            source_schema=schema,
            expected_source_schema_digest=model_schema_digest(schema),
            expected_source_runtime_schema_digest=row["daemon_runtime_schema_digest"],
            target_model="tts-1",
            source_settings=_settings(),
        )
    for marker in (
        None,
        cast(dict[str, object], {}),
        {"schema_version": True},
        {"profile_id": "openai-audio-042-tts-runtime-v1:tts-1"},
    ):
        with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
            _restore(
                marker,
                source_provider=adapter.OPENAI_AUDIO_SOURCE_PROVIDER,
                source_model="tts-1",
                model_type=ModelType.TTS,
                target_model="tts-1",
                source_settings=_settings(),
                expected_source_runtime_schema_digest=row["daemon_runtime_schema_digest"],
            )
    assert {field.name for field in fields(adapter.OpenAIAudioSourceContract)} == {
        field.name for field in fields(SourceParameterContract)
    }


_PROFILE_PACKET = json.loads((_FIXTURES / "model_billing_openai_audio_profiles.packed.json").read_bytes())
_PROFILE_RAW = gzip.decompress(base64.b64decode(_PROFILE_PACKET["payload_base64"], validate=True))
_PROFILES = cast(list[_Profile], json.loads(_PROFILE_RAW)["profiles"])


def _arguments(profile: _Profile, endpoint: Literal["unset", "official_root"] = "unset") -> dict[str, object]:
    row = _ROWS[(profile["source_version"], profile["source_model"])]
    return {
        "adapter_id": profile["adapter_id"],
        "adapter_revision": profile["adapter_revision"],
        "expected_rules_digest": "sha256:"
        + hashlib.sha256(
            json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
        "source_provider": adapter.OPENAI_AUDIO_SOURCE_PROVIDER,
        "source_model": profile["source_model"],
        "source_plugin_unique_identifier": profile["source_plugin_uid"],
        "source_schema": AIModelEntity.model_validate(row["source_catalog_schema"]),
        "expected_source_schema_digest": profile["source_schema_digest"],
        "expected_source_runtime_schema_digest": profile["source_runtime_schema_digest"],
        "source_runtime_schema": AIModelEntity.model_validate(row["source_daemon_schema"]),
        "target_model": profile["target_model"],
        "source_settings": _settings(endpoint),
    }


def _restore_arguments(arguments: dict[str, object]) -> dict[str, object]:
    return {
        key: arguments[key]
        for key in (
            "source_provider",
            "source_model",
            "target_model",
            "source_settings",
            "expected_source_runtime_schema_digest",
            "source_runtime_schema",
        )
    } | {"model_type": _kind(cast(str, arguments["source_model"]))}


def test_literal_rules_are_exact_real_thirteen_profile_bytes() -> None:
    assert hashlib.sha256(_PROFILE_RAW).hexdigest() == _PROFILE_PACKET["raw_sha256"]
    assert _PROFILE_PACKET["raw_sha256"] == adapter._PROFILE_DOCUMENT_RAW_SHA256
    assert len(_PROFILES) == len(adapter._REVIEWED_CONTRACTS) == 13
    assert len({p["profile_id"] for p in _PROFILES}) == 13
    for profile in _PROFILES:
        arguments = _arguments(profile)
        contract = _build(**arguments)
        assert contract in adapter._REVIEWED_CONTRACTS
        assert contract.rules_digest == arguments["expected_rules_digest"]


@pytest.mark.parametrize("profile", _PROFILES, ids=itemgetter("profile_id"))
@pytest.mark.parametrize("endpoint", ["unset", "official_root"])
def test_real_profile_build_marker_restore_and_prospective_runtime_distinction(
    profile: _Profile, endpoint: Literal["unset", "official_root"]
) -> None:
    arguments = _arguments(profile, endpoint)
    contract = _build(**arguments)
    marker = adapter.openai_audio_source_marker(
        contract,
        source_provider=cast(str, arguments["source_provider"]),
        source_model=profile["source_model"],
        model_type=_kind(profile["source_model"]),
        target_model=profile["target_model"],
    )
    assert _restore(marker, **_restore_arguments(arguments)) == contract
    # A prospective pin is explicitly required even when there is no observed RPC.
    assert _build(**(arguments | {"source_runtime_schema": None})) == contract
    assert _restore(marker, **(_restore_arguments(arguments) | {"source_runtime_schema": None})) == contract
    with pytest.raises(FrozenInstanceError):
        _attempt_assignment(contract, "rules_digest", "changed")
    forged = replace(contract, rules_digest="sha256:" + "0" * 64)
    with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
        adapter.openai_audio_source_marker(
            forged,
            source_provider=cast(str, arguments["source_provider"]),
            source_model=profile["source_model"],
            model_type=_kind(profile["source_model"]),
            target_model=profile["target_model"],
        )


@pytest.mark.parametrize("profile", _PROFILES, ids=itemgetter("profile_id"))
@pytest.mark.parametrize(
    "field",
    [
        "expected_rules_digest",
        "expected_source_schema_digest",
        "expected_source_runtime_schema_digest",
    ],
)
def test_each_fresh_evidence_pin_is_required_independently(profile: _Profile, field: str) -> None:
    arguments = _arguments(profile)
    for invalid in (None, True, "sha256:" + "0" * 64):
        with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
            _build(**(arguments | {field: invalid}))
    schema_key = "source_runtime_schema" if field == "expected_source_runtime_schema_digest" else "source_schema"
    changed = cast(AIModelEntity, arguments[schema_key]).model_copy(update={"model": "unreviewed-model"})
    with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
        _build(**(arguments | {schema_key: changed}))


@pytest.mark.parametrize("profile", _PROFILES, ids=itemgetter("profile_id"))
def test_marker_field_change_and_runtime_drift_are_not_restore_authority(profile: _Profile) -> None:
    arguments = _arguments(profile)
    contract = _build(**arguments)
    marker = adapter.openai_audio_source_marker(
        contract,
        source_provider=cast(str, arguments["source_provider"]),
        source_model=profile["source_model"],
        model_type=_kind(profile["source_model"]),
        target_model=profile["target_model"],
    )
    for key in marker:
        changed = marker | {key: True if key == "schema_version" else "changed"}
        with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
            _restore(changed, **_restore_arguments(arguments))
    for invalid in (None, True, "sha256:" + "0" * 64):
        with pytest.raises(adapter.OpenAIAudioSourceAdapterError):
            _restore(
                marker,
                **(_restore_arguments(arguments) | {"expected_source_runtime_schema_digest": invalid}),
            )


@pytest.mark.parametrize(
    ("row", "selector", "endpoint"),
    _artifact_cases("audio"),
    ids=[r["profile_id"] + "|" + s + "|" + e for r, s, e in _artifact_cases("audio")],
)
def test_exact1ded_additive_factory_marker_restore_and_cross_uid_denials(
    row: ArtifactProfile, selector: str, endpoint: str
) -> None:
    _verify_artifact_case("audio", row, selector, endpoint)
