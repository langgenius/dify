"""Exact embedding guards/factories from six real rules bodies; no model I/O."""

import hashlib
import inspect
import json
from dataclasses import FrozenInstanceError, asdict, fields, replace
from operator import itemgetter
from pathlib import Path
from typing import Literal, cast

import pytest
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest
from services.model_billing_openai_embedding_adapter import (
    _REVIEWED_CONTRACTS,
    OPENAI_EMBEDDING_SOURCE_MODELS,
    OPENAI_EMBEDDING_SOURCE_PROVIDER,
    OPENAI_EMBEDDING_SOURCE_UIDS,
    OpenAIEmbeddingSourceAdapterError,
    OpenAIEmbeddingSourceContract,
    OpenAIEmbeddingSourceSettings,
    build_openai_embedding_source_contract,
    openai_embedding_source_marker,
    restore_openai_embedding_source_contract,
    validate_embedding_source_identity,
    validate_embedding_source_operations,
    validate_embedding_source_settings,
)
from tests.helpers.unit.model_billing_openai110_artifact_profiles import ArtifactProfile
from tests.helpers.unit.model_billing_openai110_artifact_profiles import cases as _artifact_cases
from tests.helpers.unit.model_billing_openai110_artifact_profiles import verify_factory_case as _verify_artifact_case


class _Profile(TypedDict):
    profile_id: str
    source_plugin_uid: str
    source_model: str
    target_model: str
    source_schema_digest: str
    source_runtime_schema_digest: str
    source_catalog_schema: dict[str, object]
    source_schema: dict[str, object]
    source_codec_schema: dict[str, object]
    source_codec_schema_digest: str
    adapter_id: str
    adapter_revision: str
    source_endpoint_classes: list[str]
    source_setting_contract: dict[str, str]
    source_operations: list[str]


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
    source_settings: OpenAIEmbeddingSourceSettings


class _ContractFields(TypedDict, closed=True):
    profile_id: str
    source_plugin_unique_identifier: str
    source_model: str
    source_schema_digest: str
    target_model: str
    rules_digest: str
    adapter_id: str
    algorithm_revision: str
    source_runtime_schema_digest: str | None


_PROFILE_PATH = Path(__file__).parent / "fixtures/model_billing_openai_embedding_profiles.json"
_PROFILES = cast(list[_Profile], json.loads(_PROFILE_PATH.read_text())["profiles"])


def _digest(value: object) -> str:
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


def _build_inputs(profile: _Profile, endpoint: Literal["unset", "official_root"]) -> _BuildInputs:
    return {
        "adapter_id": profile["adapter_id"],
        "adapter_revision": profile["adapter_revision"],
        "expected_rules_digest": _digest(profile),
        "source_provider": OPENAI_EMBEDDING_SOURCE_PROVIDER,
        "source_model": profile["source_model"],
        "source_plugin_unique_identifier": profile["source_plugin_uid"],
        "source_schema": AIModelEntity.model_validate(profile["source_catalog_schema"]),
        "expected_source_schema_digest": profile["source_schema_digest"],
        "target_model": profile["target_model"],
        "source_settings": OpenAIEmbeddingSourceSettings(endpoint, "not_used"),
    }


def _contract(profile: _Profile) -> OpenAIEmbeddingSourceContract:
    return next(item for item in _REVIEWED_CONTRACTS if item.profile_id == profile["profile_id"])


def _marker(contract: OpenAIEmbeddingSourceContract) -> dict[str, object]:
    return openai_embedding_source_marker(
        contract,
        source_provider=OPENAI_EMBEDDING_SOURCE_PROVIDER,
        source_model=contract.source_model,
        model_type=ModelType.TEXT_EMBEDDING,
        target_model=contract.target_model,
    )


def _restore(marker: object, contract: OpenAIEmbeddingSourceContract) -> OpenAIEmbeddingSourceContract:
    return restore_openai_embedding_source_contract(
        marker,
        source_provider=OPENAI_EMBEDDING_SOURCE_PROVIDER,
        source_model=contract.source_model,
        model_type=ModelType.TEXT_EMBEDDING,
        target_model=contract.target_model,
        source_settings=OpenAIEmbeddingSourceSettings("unset", "not_used"),
    )


def test_six_exact_real_profiles_bind_core_boundaries_not_raw_sdk_schema() -> None:
    assert hashlib.sha256(_PROFILE_PATH.read_bytes()).hexdigest() == (
        "8ccc96c8f50125f02fc03b89cbfd01a453e927291eb9cc92a4e7d1fe9f2d8972"
    )
    assert len(_PROFILES) == len(_REVIEWED_CONTRACTS) == 6
    assert len({item.profile_id for item in _REVIEWED_CONTRACTS}) == 6
    assert len({item.rules_digest for item in _REVIEWED_CONTRACTS}) == 6
    assert {(item.source_plugin_unique_identifier, item.source_model) for item in _REVIEWED_CONTRACTS} == {
        (uid, model) for uid in OPENAI_EMBEDDING_SOURCE_UIDS for model in OPENAI_EMBEDDING_SOURCE_MODELS
    }
    for profile in _PROFILES:
        contract = _contract(profile)
        assert contract.rules_digest == _digest(profile)
        assert contract.source_schema_digest == _digest(profile["source_catalog_schema"])
        assert contract.source_runtime_schema_digest == _digest(profile["source_schema"])
        raw_digest = _digest(profile["source_codec_schema"])
        assert raw_digest == profile["source_codec_schema_digest"]
        assert raw_digest != contract.source_runtime_schema_digest
        assert model_schema_digest(AIModelEntity.model_validate(profile["source_codec_schema"])) == (
            contract.source_runtime_schema_digest
        )
        assert profile["source_endpoint_classes"] == ["unset", "official_root"]
        assert profile["source_setting_contract"] == {
            "api_protocol_behavior": "not_used",
            "request_metadata_behavior": "not_used",
        }
        validate_embedding_source_operations(tuple(profile["source_operations"]))
    assert fields(OpenAIEmbeddingSourceContract) == fields(SourceParameterContract)


@pytest.mark.parametrize("profile", _PROFILES, ids=itemgetter("profile_id"))
@pytest.mark.parametrize("endpoint", ["unset", "official_root"])
def test_real_embedding_factory_marker_restore_uses_same_profile_for_both_endpoints(
    profile: _Profile, endpoint: Literal["unset", "official_root"]
) -> None:
    inputs = _build_inputs(profile, endpoint)
    # These are actual embedding schemas with no LLM Chat mode attestation.
    assert ModelPropertyKey.MODE not in inputs["source_schema"].model_properties
    contract = build_openai_embedding_source_contract(**inputs)
    assert contract == _contract(profile)
    marker = _marker(contract)
    assert set(marker) == {
        "schema_version",
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
    }
    assert (
        restore_openai_embedding_source_contract(
            marker,
            source_provider=OPENAI_EMBEDDING_SOURCE_PROVIDER,
            source_model=profile["source_model"],
            model_type=ModelType.TEXT_EMBEDDING,
            target_model=profile["target_model"],
            source_settings=inputs["source_settings"],
        )
        == contract
    )
    assert "source_endpoint_class" not in marker
    assert "request_metadata_behavior" not in marker


def test_factory_apis_accept_classified_behavior_not_raw_credentials_or_flags() -> None:
    for function in (build_openai_embedding_source_contract, restore_openai_embedding_source_contract):
        parameters = inspect.signature(function).parameters
        assert "source_settings" in parameters
        assert (
            not {"source_credentials", "api_protocol", "enable_request_metadata", "openai_api_base"} & parameters.keys()
        )
    assert set(OpenAIEmbeddingSourceSettings.__dataclass_fields__) == {
        "source_endpoint_class",
        "request_metadata_behavior",
    }


@pytest.mark.parametrize("uid", sorted(OPENAI_EMBEDDING_SOURCE_UIDS))
@pytest.mark.parametrize("model", sorted(OPENAI_EMBEDDING_SOURCE_MODELS))
@pytest.mark.parametrize("endpoint_class", ["unset", "official_root"])
def test_exact_embedding_family_guards_do_not_mint_profile_authority(
    uid: str, model: str, endpoint_class: Literal["unset", "official_root"]
) -> None:
    settings = OpenAIEmbeddingSourceSettings(endpoint_class, "not_used")
    validate_embedding_source_identity(
        source_provider=OPENAI_EMBEDDING_SOURCE_PROVIDER,
        source_plugin_unique_identifier=uid,
        source_model=model,
        model_type=ModelType.TEXT_EMBEDDING,
        target_model=model,
        source_settings=settings,
    )
    validate_embedding_source_operations(("model/schema", "text_embedding/invoke", "text_embedding/num_tokens"))
    assert not hasattr(settings, "api_protocol")
    assert not hasattr(settings, "api_key")
    with pytest.raises(FrozenInstanceError):
        settings.request_metadata_behavior = "enabled"  # type: ignore[misc]


@pytest.mark.parametrize("endpoint", [None, False, 0, "unreviewed", "https://api.openai.com", "official_root/v1"])
def test_unclassified_or_raw_endpoint_is_not_an_embedding_public_fact(endpoint: object) -> None:
    with pytest.raises(OpenAIEmbeddingSourceAdapterError):
        validate_embedding_source_settings(OpenAIEmbeddingSourceSettings(endpoint, "not_used"))  # type: ignore[arg-type]


@pytest.mark.parametrize("metadata", [None, 0, 1, "disabled", "false", True])
def test_behavior_is_not_a_raw_source_metadata_flag(metadata: object) -> None:
    with pytest.raises(OpenAIEmbeddingSourceAdapterError):
        validate_embedding_source_settings(OpenAIEmbeddingSourceSettings("unset", metadata))  # type: ignore[arg-type]


@pytest.mark.parametrize("change", ["provider", "uid", "model", "type", "target"])
def test_similar_unreviewed_source_identity_remains_closed(change: str) -> None:
    with pytest.raises(OpenAIEmbeddingSourceAdapterError):
        validate_embedding_source_identity(
            source_provider="openai" if change == "provider" else OPENAI_EMBEDDING_SOURCE_PROVIDER,
            source_plugin_unique_identifier="langgenius/openai:1.1.0@unreviewed"
            if change == "uid"
            else min(OPENAI_EMBEDDING_SOURCE_UIDS),
            source_model="text-embedding-3-small-custom" if change == "model" else "text-embedding-3-small",
            model_type=ModelType.LLM if change == "type" else ModelType.TEXT_EMBEDDING,
            target_model="text-embedding-3-large" if change == "target" else "text-embedding-3-small",
            source_settings=OpenAIEmbeddingSourceSettings("unset", "not_used"),
        )


@pytest.mark.parametrize(
    "operations",
    [
        (),
        ("model/schema",),
        ("model/schema", "text-embedding/invoke", "text_embedding/num_tokens"),
        ("model/schema", "text_embedding/invoke", "text_embedding/invoke"),
        ("model/schema", "text_embedding/invoke", "text_embedding/num_tokens", "llm/invoke"),
    ],
)
def test_wrong_missing_duplicate_or_extra_operations_are_rejected(operations: tuple[str, ...]) -> None:
    with pytest.raises(OpenAIEmbeddingSourceAdapterError):
        validate_embedding_source_operations(operations)


@pytest.mark.parametrize("profile", _PROFILES, ids=itemgetter("profile_id"))
@pytest.mark.parametrize("change", ["uid", "rules", "raw_sdk", "runtime_hash"])
def test_matching_model_and_dimensions_cannot_substitute_another_source_or_boundary(
    profile: _Profile, change: str
) -> None:
    inputs = _build_inputs(profile, "unset")
    if change == "uid":
        inputs["source_plugin_unique_identifier"] = next(
            uid for uid in OPENAI_EMBEDDING_SOURCE_UIDS if uid != profile["source_plugin_uid"]
        )
    elif change == "rules":
        inputs["expected_rules_digest"] = next(
            item.rules_digest for item in _REVIEWED_CONTRACTS if item.profile_id != profile["profile_id"]
        )
    elif change == "raw_sdk":
        inputs["expected_source_schema_digest"] = profile["source_codec_schema_digest"]
    else:
        contract = replace(_contract(profile), source_runtime_schema_digest=profile["source_codec_schema_digest"])
        with pytest.raises(OpenAIEmbeddingSourceAdapterError):
            _marker(contract)
        return
    with pytest.raises(OpenAIEmbeddingSourceAdapterError):
        build_openai_embedding_source_contract(**inputs)


@pytest.mark.parametrize(
    "change",
    ["adapter", "revision", "provider", "model", "target", "schema_model", "schema_type", "schema", "settings"],
)
def test_embedding_factory_rejects_unreviewed_identity_schema_or_unclassified_settings(change: str) -> None:
    inputs: dict[str, object] = dict(_build_inputs(_PROFILES[0], "unset"))
    if change == "adapter":
        inputs["adapter_id"] = "identity_v1"
    elif change == "revision":
        inputs["adapter_revision"] = "2"
    elif change == "provider":
        inputs["source_provider"] = "openai"
    elif change == "model":
        inputs["source_model"] = "text-embedding-3-large-custom"
    elif change == "target":
        inputs["target_model"] = "text-embedding-3-small"
    elif change == "settings":
        inputs["source_settings"] = {"openai_api_base": "NEVER_EXPORT_SOURCE_URL", "api_key": "NEVER_EXPORT_SOURCE_KEY"}
    else:
        schema = inputs["source_schema"]
        assert isinstance(schema, AIModelEntity)
        schema = schema.model_copy(deep=True)
        inputs["source_schema"] = schema
        if change == "schema_model":
            schema.model = "text-embedding-3-small"
        elif change == "schema_type":
            schema.model_type = ModelType.LLM
        else:
            schema.model_properties[ModelPropertyKey.CONTEXT_SIZE] = 1
    with pytest.raises(OpenAIEmbeddingSourceAdapterError) as denied:
        build_openai_embedding_source_contract(**cast(_BuildInputs, inputs))
    assert "NEVER_EXPORT" not in str(denied.value)


@pytest.mark.parametrize(
    "field",
    [
        "profile_id",
        "source_plugin_unique_identifier",
        "source_model",
        "source_schema_digest",
        "target_model",
        "rules_digest",
        "adapter_id",
        "algorithm_revision",
        "source_runtime_schema_digest",
    ],
)
def test_concrete_subtype_alone_does_not_authorize_a_modified_frozen_profile(field: str) -> None:
    contract = _contract(_PROFILES[0])
    values = asdict(contract)
    original = values[field]
    assert isinstance(original, str)
    values[field] = original + "-changed"
    forged = OpenAIEmbeddingSourceContract(**cast(_ContractFields, values))
    with pytest.raises(OpenAIEmbeddingSourceAdapterError):
        _marker(forged)


def test_generic_source_parameter_record_cannot_forge_concrete_embedding_profile_authority() -> None:
    contract = _contract(_PROFILES[0])
    generic = SourceParameterContract(**cast(_ContractFields, asdict(contract)))
    with pytest.raises(OpenAIEmbeddingSourceAdapterError):
        openai_embedding_source_marker(
            generic,  # type: ignore[arg-type]
            source_provider=OPENAI_EMBEDDING_SOURCE_PROVIDER,
            source_model=contract.source_model,
            model_type=ModelType.TEXT_EMBEDDING,
            target_model=contract.target_model,
        )


@pytest.mark.parametrize("version", [None, False, True, "1", 0, 2])
def test_marker_version_requires_literal_integer_one(version: object) -> None:
    contract = _contract(_PROFILES[0])
    marker = {**_marker(contract), "schema_version": version}
    with pytest.raises(OpenAIEmbeddingSourceAdapterError):
        _restore(marker, contract)


@pytest.mark.parametrize(
    "change", ["missing", "extra", "profile", "uid", "model", "catalog", "rules", "value_type", "not_dictionary"]
)
def test_marker_restore_never_accepts_extra_fields_tampering_or_another_real_profile(change: str) -> None:
    contract = _contract(_PROFILES[0])
    marker = _marker(contract)
    if change == "missing":
        marker.pop("rules_digest")
    elif change == "extra":
        marker["api_key"] = "NEVER_EXPORT_SOURCE_KEY"
    elif change == "profile":
        marker["profile_id"] = _contract(_PROFILES[-1]).profile_id
    elif change == "uid":
        marker["source_plugin_uid"] = _contract(_PROFILES[-1]).source_plugin_unique_identifier
    elif change == "model":
        marker["source_model"] = "text-embedding-ada-002"
    elif change == "catalog":
        marker["source_schema_digest"] = _PROFILES[0]["source_codec_schema_digest"]
    elif change == "rules":
        marker["rules_digest"] = _contract(_PROFILES[-1]).rules_digest
    elif change == "value_type":
        marker["profile_id"] = None
    else:
        with pytest.raises(OpenAIEmbeddingSourceAdapterError):
            _restore(list(marker.items()), contract)
        return
    with pytest.raises(OpenAIEmbeddingSourceAdapterError) as denied:
        _restore(marker, contract)
    assert "NEVER_EXPORT" not in str(denied.value)


@pytest.mark.parametrize("change", ["provider", "model", "type", "target", "settings"])
def test_valid_marker_cannot_cross_a_different_logical_binding_or_settings(change: str) -> None:
    contract = _contract(_PROFILES[0])
    with pytest.raises(OpenAIEmbeddingSourceAdapterError):
        restore_openai_embedding_source_contract(
            _marker(contract),
            source_provider="openai" if change == "provider" else OPENAI_EMBEDDING_SOURCE_PROVIDER,
            source_model="text-embedding-3-small" if change == "model" else contract.source_model,
            model_type=ModelType.LLM if change == "type" else ModelType.TEXT_EMBEDDING,
            target_model="text-embedding-3-small" if change == "target" else contract.target_model,
            source_settings=OpenAIEmbeddingSourceSettings("unset", "enabled" if change == "settings" else "not_used"),  # type: ignore[arg-type]
        )


@pytest.mark.parametrize(
    ("row", "selector", "endpoint"),
    _artifact_cases("embedding"),
    ids=[r["profile_id"] + "|" + s + "|" + e for r, s, e in _artifact_cases("embedding")],
)
def test_exact1ded_additive_factory_marker_restore_and_cross_uid_denials(
    row: ArtifactProfile, selector: str, endpoint: str
) -> None:
    _verify_artifact_case("embedding", row, selector, endpoint)
