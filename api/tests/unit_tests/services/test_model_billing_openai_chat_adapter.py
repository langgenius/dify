"""Real immutable schemas/profile records; no network or forwarding certificate."""

import hashlib
import json
from dataclasses import FrozenInstanceError, replace
from pathlib import Path
from typing import cast

import pytest
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest
from services.model_billing_openai_chat_adapter import (
    OPENAI_CHAT_SOURCE_ADAPTER_ID,
    OPENAI_CHAT_SOURCE_PROVIDER,
    OpenAIChatSourceAdapterError,
    OpenAIChatSourceContract,
    build_openai_chat_source_contract,
    openai_chat_source_marker,
    restore_openai_chat_source_contract,
)

PROFILE = json.loads(
    Path(__file__).with_name("fixtures").joinpath("model_billing_openai_chat_profile.json").read_text()
)
RULES_DIGEST = (
    "sha256:"
    + hashlib.sha256(
        json.dumps(PROFILE, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
)


class _BuildInputs(TypedDict, closed=True):
    adapter_id: str
    adapter_revision: str
    expected_rules_digest: str
    source_provider: str
    source_model: str
    source_plugin_unique_identifier: str
    source_schema: AIModelEntity
    expected_source_schema_digest: str
    target_model: str
    source_api_protocol: object


class _MarkerInputs(TypedDict, closed=True):
    source_provider: str
    source_model: str
    model_type: ModelType
    target_model: str


class _RestoreInputs(TypedDict, closed=True):
    source_provider: str
    source_model: str
    model_type: ModelType
    target_model: str
    source_api_protocol: object


def build_inputs(protocol: object = None) -> _BuildInputs:
    return {
        "adapter_id": OPENAI_CHAT_SOURCE_ADAPTER_ID,
        "adapter_revision": "1",
        "expected_rules_digest": RULES_DIGEST,
        "source_provider": OPENAI_CHAT_SOURCE_PROVIDER,
        "source_model": PROFILE["source_model"],
        "source_plugin_unique_identifier": PROFILE["source_plugin_uid"],
        "source_schema": AIModelEntity.model_validate(PROFILE["source_schema"]),
        "expected_source_schema_digest": PROFILE["source_schema_digest"],
        "target_model": PROFILE["target_model"],
        "source_api_protocol": protocol,
    }


def marker_fields() -> _MarkerInputs:
    return {
        "source_provider": OPENAI_CHAT_SOURCE_PROVIDER,
        "source_model": PROFILE["source_model"],
        "model_type": ModelType.LLM,
        "target_model": PROFILE["target_model"],
    }


def marker_inputs(protocol: object = None) -> _RestoreInputs:
    return {**marker_fields(), "source_api_protocol": protocol}


@pytest.mark.parametrize("protocol", [None, "chat"])
def test_exact_source_binding_and_public_protocol_build_immutable_contract(protocol: object) -> None:
    contract = build_openai_chat_source_contract(**build_inputs(protocol))
    assert isinstance(contract, OpenAIChatSourceContract)
    assert isinstance(contract, SourceParameterContract)
    assert contract.profile_id == PROFILE["profile_id"]
    assert contract.rules_digest == RULES_DIGEST
    assert contract.source_schema_digest == model_schema_digest(AIModelEntity.model_validate(PROFILE["source_schema"]))
    with pytest.raises(FrozenInstanceError):
        contract.target_model = "different"  # type: ignore[misc]


@pytest.mark.parametrize("protocol", ["responses", "", "chat_completions", False, True, {}, []])
def test_explicit_responses_or_unknown_protocol_is_never_forced_into_chat(protocol: object) -> None:
    with pytest.raises(OpenAIChatSourceAdapterError, match="protocol"):
        build_openai_chat_source_contract(**build_inputs(protocol))


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("adapter_id", "identity_v1"),
        ("adapter_revision", "2"),
        ("expected_rules_digest", "sha256:" + "0" * 64),
        ("source_provider", "langgenius/openai_api_compatible/openai_api_compatible"),
        ("source_model", "gpt-4o-mini-2024-07-18"),
        ("source_plugin_unique_identifier", "langgenius/openai:0.4.1@" + "0" * 64),
        ("expected_source_schema_digest", "sha256:" + "0" * 64),
        ("target_model", "gpt-4o"),
    ],
)
def test_each_unreviewed_binding_field_fails_closed(key: str, value: object) -> None:
    inputs = cast(_BuildInputs, {**build_inputs(), key: value})
    with pytest.raises(OpenAIChatSourceAdapterError):
        build_openai_chat_source_contract(**inputs)


@pytest.mark.parametrize("change", ["range", "mode", "type", "model"])
def test_changed_actual_source_schema_does_not_reuse_old_evidence(change: str) -> None:
    inputs = build_inputs()
    schema = inputs["source_schema"].model_copy(deep=True)
    if change == "range":
        schema.parameter_rules[0].max = 2
    elif change == "mode":
        schema.model_properties[ModelPropertyKey.MODE] = "completion"
    elif change == "type":
        schema.model_type = ModelType.TEXT_EMBEDDING
    else:
        schema.model = "gpt-4o"
    inputs["source_schema"] = schema
    inputs["expected_source_schema_digest"] = model_schema_digest(schema)
    with pytest.raises(OpenAIChatSourceAdapterError):
        build_openai_chat_source_contract(**inputs)


def test_marker_has_only_six_nonsecret_fields_and_restores_fresh_inventory_evidence() -> None:
    contract = build_openai_chat_source_contract(**build_inputs())
    marker = openai_chat_source_marker(contract, **marker_fields())
    assert set(marker) == {
        "schema_version",
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
    }
    assert marker["schema_version"] == 1
    assert restore_openai_chat_source_contract(marker, **marker_inputs()) == contract


@pytest.mark.parametrize("protocol", ["responses", False, {}, ""])
def test_fresh_inventory_restore_requires_the_source_protocol_fact(protocol: object) -> None:
    contract = build_openai_chat_source_contract(**build_inputs())
    marker = openai_chat_source_marker(contract, **marker_fields())
    with pytest.raises(OpenAIChatSourceAdapterError):
        restore_openai_chat_source_contract(marker, **marker_inputs(protocol))


@pytest.mark.parametrize("change", ["missing", "extra", "bool_version", "uid", "digest"])
def test_forged_marker_is_not_restored(change: str) -> None:
    contract = build_openai_chat_source_contract(**build_inputs())
    marker = openai_chat_source_marker(contract, **marker_fields())
    if change == "missing":
        del marker["source_model"]
    elif change == "extra":
        marker["api_key"] = "must-not-be-replayed"
    elif change == "bool_version":
        marker["schema_version"] = True
    elif change == "uid":
        marker["source_plugin_uid"] = "langgenius/openai:1.0.8@" + "0" * 64
    else:
        marker["rules_digest"] = "sha256:" + "0" * 64
    with pytest.raises(OpenAIChatSourceAdapterError):
        restore_openai_chat_source_contract(marker, **marker_inputs())


def test_changed_frozen_contract_cannot_emit_a_private_marker() -> None:
    contract = build_openai_chat_source_contract(**build_inputs())
    with pytest.raises(OpenAIChatSourceAdapterError):
        openai_chat_source_marker(replace(contract, algorithm_revision="2"), **marker_fields())
