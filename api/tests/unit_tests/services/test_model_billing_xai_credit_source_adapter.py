"""Finite xAI source policy using exact real profiles and pinned Core schemas."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import asdict, fields, replace
from pathlib import Path
from typing import Literal, cast

import pytest
from pydantic import JsonValue
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services import model_billing_xai_credit_source_adapter as adapter
from services.entities.model_billing_mapping import (
    SourceParameterContract,
    model_schema_digest,
)


class _Schema(TypedDict):
    model: str
    model_type: str
    model_properties: dict[str, JsonValue]
    pricing: dict[str, JsonValue]
    parameter_rules: list[dict[str, JsonValue]]


class _Profile(TypedDict):
    source_model: str
    source_schema_digest: str
    source_runtime_schema_digest: str
    target_schema_digest: str
    source_codec_schema_digest: str
    source_catalog_schema: _Schema
    source_daemon_schema: _Schema
    source_codec_schema: _Schema


class _ProfileDocument(TypedDict):
    profiles: list[_Profile]


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
    source_runtime_schema: AIModelEntity | None
    target_model: str
    source_settings: adapter.XAICreditSourceSettings
    source_endpoint_class: Literal["official_root"]


class _RestoreArguments(TypedDict, closed=True):
    source_provider: str
    source_model: str
    model_type: ModelType
    target_model: str
    source_settings: adapter.XAICreditSourceSettings
    source_endpoint_class: Literal["official_root"]
    expected_source_runtime_schema_digest: str
    source_runtime_schema: AIModelEntity | None


class _ContractArguments(TypedDict, closed=True):
    profile_id: str
    source_plugin_unique_identifier: str
    source_model: str
    source_schema_digest: str
    target_model: str
    rules_digest: str
    adapter_id: str
    algorithm_revision: str
    source_runtime_schema_digest: str | None


_FIXTURES = Path(__file__).with_name("fixtures")
_FIXTURE_RAW = (_FIXTURES / "model_billing_xai_credit_source_profiles.json").read_bytes()
assert hashlib.sha256(_FIXTURE_RAW).hexdigest() == "d852462a5d617d492031870af81f0781ec1a13d081339861794dbd706f8d8243"
DOCUMENT = cast(_ProfileDocument, json.loads(_FIXTURE_RAW))


def _digest(value: object) -> str:
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


PROFILES = {profile["source_model"]: profile for profile in DOCUMENT["profiles"]}
CONTRACTS = {contract.source_model: contract for contract in adapter._REVIEWED_CONTRACTS}
SETTINGS = adapter.XAICreditSourceSettings(True, False, None)


def _arguments(model: str = "grok-4.3") -> _BuildArguments:
    profile = PROFILES[model]
    return {
        "adapter_id": adapter.XAI_CREDIT_SOURCE_ADAPTER_ID,
        "adapter_revision": "1",
        "expected_rules_digest": _digest(profile),
        "source_provider": adapter.XAI_CREDIT_SOURCE_PROVIDER,
        "source_model": model,
        "source_plugin_unique_identifier": adapter.XAI_CREDIT_SOURCE_UID,
        "source_schema": AIModelEntity.model_validate(profile["source_catalog_schema"]),
        "expected_source_schema_digest": profile["source_schema_digest"],
        "expected_source_runtime_schema_digest": profile["source_runtime_schema_digest"],
        "source_runtime_schema": AIModelEntity.model_validate(profile["source_daemon_schema"]),
        "target_model": model,
        "source_settings": SETTINGS,
        "source_endpoint_class": "official_root",
    }


def _build(model: str = "grok-4.3", /, **changes: object) -> adapter.XAICreditSourceContract:
    # Negative evidence deliberately violates the typed API without coercing it.
    arguments = cast(_BuildArguments, {**_arguments(model), **changes})
    return adapter.build_xai_credit_source_contract(**arguments)


def _marker(model: str = "grok-4.3", contract: SourceParameterContract | None = None) -> dict[str, object]:
    return adapter.xai_credit_source_marker(
        CONTRACTS[model] if contract is None else cast(adapter.XAICreditSourceContract, contract),
        source_provider=adapter.XAI_CREDIT_SOURCE_PROVIDER,
        source_model=model,
        model_type=ModelType.LLM,
        target_model=model,
    )


def _restore(model: str = "grok-4.3", marker: object = None, **changes: object) -> adapter.XAICreditSourceContract:
    arguments: _RestoreArguments = {
        "source_provider": adapter.XAI_CREDIT_SOURCE_PROVIDER,
        "source_model": model,
        "model_type": ModelType.LLM,
        "target_model": model,
        "source_settings": SETTINGS,
        "source_endpoint_class": "official_root",
        "expected_source_runtime_schema_digest": PROFILES[model]["source_runtime_schema_digest"],
        "source_runtime_schema": AIModelEntity.model_validate(PROFILES[model]["source_daemon_schema"]),
    }
    # Keep malformed runtime values intact for fail-closed validation tests.
    arguments = cast(_RestoreArguments, {**arguments, **changes})
    return adapter.restore_xai_credit_source_contract(_marker(model) if marker is None else marker, **arguments)


def _invalid_settings(base: object, metadata: object, protocol: object) -> adapter.XAICreditSourceSettings:
    """Pass intentionally invalid values through the real dataclass unchanged."""
    return adapter.XAICreditSourceSettings(cast(bool, base), cast(bool, metadata), cast(None, protocol))


@pytest.mark.parametrize("model", ["grok-4.3", "grok-4.5", "grok-4.6"])
def test_three_real_profiles_build_restore_marker_and_actual_runtime_are_exact(
    model: str,
) -> None:
    profile = PROFILES[model]
    contract = _build(model)
    assert len(PROFILES) == len(CONTRACTS) == 3
    assert type(contract) is adapter.XAICreditSourceContract
    assert contract == CONTRACTS[model] == _restore(model)
    assert contract.rules_digest == _digest(profile)
    assert contract.source_schema_digest == model_schema_digest(
        AIModelEntity.model_validate(profile["source_catalog_schema"])
    )
    assert contract.source_runtime_schema_digest == model_schema_digest(
        AIModelEntity.model_validate(profile["source_daemon_schema"])
    )
    assert profile["target_schema_digest"] == contract.source_runtime_schema_digest
    assert profile["source_codec_schema_digest"] == _digest(profile["source_codec_schema"])
    assert profile["source_codec_schema"]["parameter_rules"][0]["default"] == 1.0
    assert type(profile["source_codec_schema"]["parameter_rules"][0]["default"]) is float
    assert {field.name for field in fields(contract)} == {field.name for field in fields(SourceParameterContract)}
    marker = _marker(model)
    assert set(marker) == {
        "schema_version",
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
    }
    assert marker["source_model"] == contract.source_model == contract.target_model == model
    assert json.loads(json.dumps(marker)) == marker
    # Explicit None is prospective construction, never an asserted runtime read.
    assert _build(model, source_runtime_schema=None) == contract
    assert _restore(model, source_runtime_schema=None) == contract


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("adapter_id", "identity_v1"),
        ("adapter_revision", "2"),
        ("adapter_revision", True),
        ("expected_rules_digest", "sha256:" + "0" * 64),
        ("expected_rules_digest", None),
        ("source_provider", "langgenius/openai/openai"),
        ("source_model", "grok-4.3-alias"),
        ("source_plugin_unique_identifier", "langgenius/x:0.0.26@" + "0" * 64),
        ("source_plugin_unique_identifier", None),
        ("source_plugin_unique_identifier", True),
        ("target_model", "grok-4.5"),
        ("target_model", True),
        ("expected_source_schema_digest", "sha256:" + "0" * 64),
        ("expected_source_runtime_schema_digest", "sha256:" + "0" * 64),
        ("expected_source_runtime_schema_digest", None),
        ("source_schema", {}),
    ],
)
def test_build_rejects_unknown_or_malformed_source_evidence(field: str, value: object) -> None:
    with pytest.raises(adapter.XAICreditSourceAdapterError):
        _build(**{field: value})


@pytest.mark.parametrize(
    "change",
    [
        "type",
        "model",
        "mode",
        "context",
        "price",
        "catalog_as_runtime",
        "runtime_as_catalog",
        "direct_sdk_as_runtime",
    ],
)
def test_real_schema_identity_and_full_catalog_runtime_boundaries_remain_distinct(
    change: str,
) -> None:
    profile = PROFILES["grok-4.3"]
    catalog = deepcopy(profile["source_catalog_schema"])
    runtime = deepcopy(profile["source_daemon_schema"])
    if change == "type":
        catalog["model_type"] = "text-embedding"
    elif change == "model":
        catalog["model"] = "grok-4.5"
    elif change == "mode":
        catalog["model_properties"]["mode"] = "completion"
    elif change == "context":
        runtime["model_properties"]["context_size"] = 4096
    elif change == "price":
        runtime["pricing"]["input"] = "999"
    elif change == "catalog_as_runtime":
        runtime = catalog
    elif change == "runtime_as_catalog":
        catalog = runtime
    else:
        runtime = profile["source_codec_schema"]
    with pytest.raises(adapter.XAICreditSourceAdapterError):
        _build(
            source_schema=AIModelEntity.model_validate(catalog),
            source_runtime_schema=AIModelEntity.model_validate(runtime),
        )


@pytest.mark.parametrize(
    "settings",
    [
        None,
        {},
        "official_root",
        True,
        adapter.XAICreditSourceSettings(False, False, None),
        _invalid_settings(1, False, None),
        adapter.XAICreditSourceSettings(True, True, None),
        _invalid_settings(True, 0, None),
        _invalid_settings(True, False, "chat"),
        _invalid_settings(True, False, "absent"),
    ],
)
def test_settings_require_strict_positive_typed_facts_without_truthy_defaults(
    settings: object,
) -> None:
    with pytest.raises(adapter.XAICreditSourceAdapterError):
        _build(source_settings=settings)
    with pytest.raises(adapter.XAICreditSourceAdapterError):
        _restore(source_settings=settings)


@pytest.mark.parametrize(
    "endpoint",
    [
        None,
        True,
        "unset",
        "unreviewed",
        "https://api.x.ai/v1",
        "https://api.x.ai",
        "official_root/",
    ],
)
def test_only_server_derived_official_endpoint_class_is_admitted(
    endpoint: object,
) -> None:
    with pytest.raises(adapter.XAICreditSourceAdapterError):
        _build(source_endpoint_class=endpoint)
    with pytest.raises(adapter.XAICreditSourceAdapterError):
        _restore(source_endpoint_class=endpoint)


@pytest.mark.parametrize(
    "change",
    [
        "extra",
        "missing",
        "bool_version",
        "unknown_profile",
        "uid",
        "model",
        "schema",
        "rules",
    ],
)
def test_serialized_marker_cannot_extend_or_switch_finite_authority(
    change: str,
) -> None:
    marker = _marker()
    if change == "extra":
        marker["endpoint_url"] = "https://unreviewed.invalid"
    elif change == "missing":
        marker.pop("rules_digest")
    elif change == "bool_version":
        marker["schema_version"] = True
    elif change == "unknown_profile":
        profile_id = marker["profile_id"]
        assert isinstance(profile_id, str)
        marker["profile_id"] = profile_id + ":unreviewed"
    elif change == "uid":
        marker["source_plugin_uid"] = "langgenius/x:0.0.26@" + "0" * 64
    elif change == "model":
        marker["source_model"] = "grok-4.5"
    else:
        marker["source_schema_digest" if change == "schema" else "rules_digest"] = "sha256:" + "0" * 64
    with pytest.raises(adapter.XAICreditSourceAdapterError):
        _restore(marker=marker)


@pytest.mark.parametrize("kind", ["plain_parent", "target", "runtime", "rules", "uid", "revision"])
def test_manual_frozen_contract_construction_does_not_bypass_literal_profiles(
    kind: str,
) -> None:
    contract = CONTRACTS["grok-4.3"]
    if kind == "plain_parent":
        contract_values: object = asdict(contract)
        forged = SourceParameterContract(**cast(_ContractArguments, contract_values))
    else:
        field = {
            "target": "target_model",
            "runtime": "source_runtime_schema_digest",
            "rules": "rules_digest",
            "uid": "source_plugin_unique_identifier",
            "revision": "algorithm_revision",
        }[kind]
        forged = replace(contract, **{field: "2" if kind == "revision" else "changed"})
    with pytest.raises(adapter.XAICreditSourceAdapterError):
        _marker(contract=forged)


@pytest.mark.parametrize("kind", ["llm", ModelType.TEXT_EMBEDDING, ModelType.TTS, None, True])
def test_identity_requires_the_real_llm_enum_and_no_cross_family_model_type(
    kind: object,
) -> None:
    with pytest.raises(adapter.XAICreditSourceAdapterError):
        adapter.validate_xai_credit_source_identity(
            source_provider=adapter.XAI_CREDIT_SOURCE_PROVIDER,
            source_model="grok-4.3",
            source_plugin_unique_identifier=adapter.XAI_CREDIT_SOURCE_UID,
            model_type=cast(ModelType, kind),
            target_model="grok-4.3",
        )
