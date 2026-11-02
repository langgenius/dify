"""Exact source schemas and frozen profile bindings, not upstream conformance."""

import hashlib
import json
from dataclasses import FrozenInstanceError, replace
from pathlib import Path
from typing import TypedDict

import pytest
from pydantic import ValidationError

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_mapping import ModelMapping, model_schema_digest
from services.model_billing_anthropic_adapter import (
    ANTHROPIC_SOURCE_ADAPTER_ID,
    ANTHROPIC_SOURCE_PROVIDER,
    AnthropicSourceAdapterError,
    AnthropicSourceContract,
    anthropic_source_marker,
    build_anthropic_source_contract,
    restore_anthropic_source_contract,
)
from services.model_billing_mapping_service import build_source_adapter_contract, restore_source_parameter_contract
from tests.unit_tests.services.test_model_billing_mapping_service import mapping, section

FIXTURES = Path(__file__).with_name("fixtures")


class _Marker(TypedDict):
    schema_version: int
    profile_id: str
    source_plugin_uid: str
    source_model: str
    source_schema_digest: str
    rules_digest: str


class _Binding(TypedDict):
    target_model: str
    marker: _Marker


def binding(index: int = 0) -> _Binding:
    return json.loads((FIXTURES / "model_billing_anthropic_bindings.json").read_text())["bindings"][index]


def source_schema(index: int = 0) -> AIModelEntity:
    schemas = json.loads((FIXTURES / "model_billing_anthropic_source_schemas.json").read_text())
    digest = binding(index)["marker"]["source_schema_digest"]
    if digest not in schemas["schemas"]:
        schemas = json.loads((FIXTURES / "model_billing_anthropic_source_additional_schemas.json").read_text())
    return AIModelEntity.model_validate(schemas["schemas"][digest])


def peer_binding_index(index: int) -> int:
    current = binding(index)["marker"]
    records = json.loads((FIXTURES / "model_billing_anthropic_bindings.json").read_text())["bindings"]
    return next(
        other
        for other, record in enumerate(records)
        if record["marker"]["source_model"] == current["source_model"]
        and record["marker"]["source_plugin_uid"] != current["source_plugin_uid"]
    )


def model_mapping(index: int = 0) -> ModelMapping:
    evidence = binding(index)
    record = mapping(source_schema(index), revision="anthropic-profile-v1", target=evidence["target_model"])
    section(record, "source")["provider_id"] = ANTHROPIC_SOURCE_PROVIDER
    record["parameter_adapter"] = {
        "id": ANTHROPIC_SOURCE_ADAPTER_ID,
        "revision": "1",
        "rules_digest": evidence["marker"]["rules_digest"],
    }
    return ModelMapping.model_validate(record)


def contract_for(index: int = 0) -> AnthropicSourceContract:
    evidence = binding(index)
    contract = build_source_adapter_contract(
        model_mapping(index),
        source_provider=ANTHROPIC_SOURCE_PROVIDER,
        source_plugin_unique_identifier=evidence["marker"]["source_plugin_uid"],
        source_schema=source_schema(index),
        source_credentials=None,
    )
    assert isinstance(contract, AnthropicSourceContract)
    return contract


def test_literal_semantic_contract_bytes_match_every_pinned_rules_digest() -> None:
    document = json.loads((FIXTURES / "model_billing_anthropic_bindings.json").read_text())
    contracts = document["semantic_rule_contracts"]
    assert len(contracts) == 8
    for expected_digest, payload in contracts.items():
        actual = (
            "sha256:"
            + hashlib.sha256(
                json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            ).hexdigest()
        )
        assert actual == expected_digest
    assert {record["marker"]["rules_digest"] for record in document["bindings"]} == set(contracts)


@pytest.mark.parametrize("index", range(16))
def test_exact_core_projected_schema_and_reviewed_marker_bindings(index: int) -> None:
    evidence = binding(index)
    contract = contract_for(index)
    assert model_schema_digest(source_schema(index)) == evidence["marker"]["source_schema_digest"]
    marker = anthropic_source_marker(
        contract,
        source_provider=ANTHROPIC_SOURCE_PROVIDER,
        source_model=contract.source_model,
        model_type=ModelType.LLM,
        target_model=contract.target_model,
    )
    assert marker == evidence["marker"]
    assert (
        restore_source_parameter_contract(marker, mapping=model_mapping(index), source_public_settings=None) == contract
    )
    with pytest.raises(FrozenInstanceError):
        contract.profile_id = "unreviewed"  # type: ignore[misc]


@pytest.mark.parametrize("index", range(8))
def test_identical_semantics_share_registry_rule_but_keep_exact_source_uid_profile(index: int) -> None:
    first = contract_for(index)
    peer = peer_binding_index(index)
    second = contract_for(peer)
    assert first.rules_digest == second.rules_digest
    assert model_mapping(index) == model_mapping(peer)
    assert first.source_plugin_unique_identifier != second.source_plugin_unique_identifier
    assert first.profile_id != second.profile_id
    assert first != second


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("adapter_id", "identity_v1"),
        ("adapter_revision", "2"),
        ("source_provider", "langgenius/openai/openai"),
        ("source_model", "claude-sonnet-4-5-20250929"),
        ("source_plugin_unique_identifier", "langgenius/anthropic:0.3.40@" + "a" * 64),
        ("expected_source_schema_digest", "sha256:" + "f" * 64),
        ("expected_rules_digest", "sha256:" + "f" * 64),
        ("target_model", "claude-opus-4-5-20251101"),
    ],
)
def test_each_reviewed_evidence_boundary_is_enforced(field: str, value: str) -> None:
    contract = contract_for()
    arguments: dict[str, str] = {
        "adapter_id": contract.adapter_id,
        "adapter_revision": contract.algorithm_revision,
        "expected_rules_digest": contract.rules_digest,
        "source_provider": ANTHROPIC_SOURCE_PROVIDER,
        "source_model": contract.source_model,
        "source_plugin_unique_identifier": contract.source_plugin_unique_identifier,
        "expected_source_schema_digest": contract.source_schema_digest,
        "target_model": contract.target_model,
    }
    arguments[field] = value
    with pytest.raises(AnthropicSourceAdapterError):
        build_anthropic_source_contract(
            adapter_id=arguments["adapter_id"],
            adapter_revision=arguments["adapter_revision"],
            expected_rules_digest=arguments["expected_rules_digest"],
            source_provider=arguments["source_provider"],
            source_model=arguments["source_model"],
            source_plugin_unique_identifier=arguments["source_plugin_unique_identifier"],
            expected_source_schema_digest=arguments["expected_source_schema_digest"],
            target_model=arguments["target_model"],
            source_schema=source_schema(),
        )


@pytest.mark.parametrize("case", ["model", "type", "mode", "context"])
def test_changed_actual_source_schema_cannot_satisfy_a_frozen_profile(case: str) -> None:
    schema = source_schema()
    if case == "model":
        schema.model = "different"
    elif case == "type":
        schema.model_type = ModelType.TTS
    elif case == "mode":
        schema.model_properties[ModelPropertyKey.MODE] = "completion"
    else:
        schema.model_properties[ModelPropertyKey.CONTEXT_SIZE] = 128000
    evidence = binding()
    with pytest.raises(AnthropicSourceAdapterError):
        build_source_adapter_contract(
            model_mapping(),
            source_provider=ANTHROPIC_SOURCE_PROVIDER,
            source_plugin_unique_identifier=evidence["marker"]["source_plugin_uid"],
            source_schema=schema,
            source_credentials=None,
        )


@pytest.mark.parametrize(
    "marker",
    [None, {}, {"schema_version": 1}, {"schema_version": True}, {"forged": "source"}],
)
def test_malformed_markers_cannot_restore_contract(marker: object) -> None:
    with pytest.raises(AnthropicSourceAdapterError):
        restore_anthropic_source_contract(
            marker,
            source_provider=ANTHROPIC_SOURCE_PROVIDER,
            source_model=source_schema().model,
            model_type=ModelType.LLM,
            target_model=binding()["target_model"],
        )


@pytest.mark.parametrize("case", ["boolean_version", "extra", "rules", "uid", "target", "model_type"])
def test_marker_restore_checks_exact_types_keys_identity_and_target(case: str) -> None:
    marker: dict[str, object] = {**binding()["marker"]}
    if case == "boolean_version":
        marker["schema_version"] = True
    elif case == "extra":
        marker["api_key"] = "forged"
    elif case == "rules":
        marker["rules_digest"] = "sha256:" + "f" * 64
    elif case == "uid":
        marker["source_plugin_uid"] = binding()["marker"]["source_plugin_uid"] + "changed"
    with pytest.raises(AnthropicSourceAdapterError):
        restore_anthropic_source_contract(
            marker,
            source_provider=ANTHROPIC_SOURCE_PROVIDER,
            source_model=source_schema().model,
            model_type=ModelType.TTS if case == "model_type" else ModelType.LLM,
            target_model="different" if case == "target" else binding()["target_model"],
        )


def test_frozen_profile_cannot_be_rewritten_after_preparation() -> None:
    contract = contract_for()
    for changed in [
        replace(contract, rules_digest="sha256:" + "f" * 64),
        replace(contract, target_model="another-model"),
        replace(contract, algorithm_revision="2"),
    ]:
        with pytest.raises(AnthropicSourceAdapterError):
            anthropic_source_marker(
                changed,
                source_provider=ANTHROPIC_SOURCE_PROVIDER,
                source_model=changed.source_model,
                model_type=ModelType.LLM,
                target_model=changed.target_model,
            )


@pytest.mark.parametrize("kind", [ModelType.TTS, ModelType.TEXT_EMBEDDING, ModelType.RERANK])
def test_mapping_contract_rejects_anthropic_adapter_on_non_llm(kind: ModelType) -> None:
    data = model_mapping().model_dump(mode="json")
    data["source"]["model_type"] = kind.value
    data["target"]["model_type"] = kind.value
    with pytest.raises(ValidationError, match="LLM"):
        ModelMapping.model_validate(data)


class _RuntimeBinding(_Binding):
    adapter_revision: str
    source_runtime_schema_digest: str


def runtime_binding(index: int = 0) -> _RuntimeBinding:
    return json.loads((FIXTURES / "model_billing_anthropic_runtime_v2_bindings.json").read_text())["bindings"][index]


def runtime_schema(index: int = 0) -> AIModelEntity:
    schemas = json.loads((FIXTURES / "model_billing_anthropic_runtime_v2_schemas.json").read_text())["schemas"]
    return AIModelEntity.model_validate(schemas[runtime_binding(index)["source_runtime_schema_digest"]])


def runtime_mapping(index: int = 0) -> ModelMapping:
    data = model_mapping(runtime_legacy_index(index)).model_dump(mode="json")
    data["mapping_revision"] = "anthropic-runtime-v2-unpublished-test"
    data["parameter_adapter"] = {
        "id": ANTHROPIC_SOURCE_ADAPTER_ID,
        "revision": "2",
        "rules_digest": runtime_binding(index)["marker"]["rules_digest"],
    }
    data["target"]["minimum_plugin_version"] = "0.4.3-dev9"
    return ModelMapping.model_validate(data)


def runtime_contract(index: int = 0) -> AnthropicSourceContract:
    contract = build_source_adapter_contract(
        runtime_mapping(index),
        source_provider=ANTHROPIC_SOURCE_PROVIDER,
        source_plugin_unique_identifier=runtime_binding(index)["marker"]["source_plugin_uid"],
        source_schema=source_schema(runtime_legacy_index(index)),
        source_credentials=None,
    )
    assert isinstance(contract, AnthropicSourceContract)
    return contract


def runtime_legacy_index(index: int) -> int:
    return index + 8 if index < 8 else index - 8


@pytest.mark.parametrize("index", range(16))
def test_runtime_v2_exact_profile_keeps_inventory_and_runtime_boundaries_distinct(index: int) -> None:
    evidence = runtime_binding(index)
    contract = runtime_contract(index)
    assert contract.algorithm_revision == "2"
    assert contract.source_schema_digest == model_schema_digest(source_schema(runtime_legacy_index(index)))
    assert contract.source_schema_digest == evidence["marker"]["source_schema_digest"]
    assert contract.source_runtime_schema_digest == model_schema_digest(runtime_schema(index))
    assert contract.source_runtime_schema_digest == evidence["source_runtime_schema_digest"]
    if index % 8 == 2:
        assert contract.source_schema_digest == contract.source_runtime_schema_digest
    else:
        assert contract.source_schema_digest != contract.source_runtime_schema_digest
    marker = anthropic_source_marker(
        contract,
        source_provider=ANTHROPIC_SOURCE_PROVIDER,
        source_model=contract.source_model,
        model_type=ModelType.LLM,
        target_model=contract.target_model,
    )
    assert marker == evidence["marker"]
    assert len(marker) == 6
    assert (
        restore_anthropic_source_contract(
            marker,
            source_provider=ANTHROPIC_SOURCE_PROVIDER,
            source_model=contract.source_model,
            model_type=ModelType.LLM,
            target_model=contract.target_model,
        )
        == contract
    )
    assert (
        restore_source_parameter_contract(marker, mapping=runtime_mapping(index), source_public_settings=None)
        == contract
    )


@pytest.mark.parametrize("index", range(16))
def test_v1_and_v2_same_uid_model_select_exact_revision_rules_and_inventory_hash(index: int) -> None:
    old = contract_for(runtime_legacy_index(index))
    new = runtime_contract(index)
    assert old.source_plugin_unique_identifier == new.source_plugin_unique_identifier
    assert old.source_model == new.source_model
    assert old.source_schema_digest == new.source_schema_digest
    assert old.rules_digest != new.rules_digest
    assert old.source_runtime_schema_digest is None
    assert new.source_runtime_schema_digest is not None
    assert old.algorithm_revision == "1"
    assert new.algorithm_revision == "2"
    for revision, rules in (("1", new.rules_digest), ("2", old.rules_digest)):
        data = runtime_mapping(index).model_dump(mode="json")
        data["parameter_adapter"] = {"id": ANTHROPIC_SOURCE_ADAPTER_ID, "revision": revision, "rules_digest": rules}
        with pytest.raises(AnthropicSourceAdapterError):
            build_source_adapter_contract(
                ModelMapping.model_validate(data),
                source_provider=ANTHROPIC_SOURCE_PROVIDER,
                source_plugin_unique_identifier=new.source_plugin_unique_identifier,
                source_schema=source_schema(runtime_legacy_index(index)),
                source_credentials=None,
            )


@pytest.mark.parametrize("index", range(8))
def test_unattested_source_uid_never_reuses_shared_runtime_rules(index: int) -> None:
    with pytest.raises(AnthropicSourceAdapterError):
        build_source_adapter_contract(
            runtime_mapping(index),
            source_provider=ANTHROPIC_SOURCE_PROVIDER,
            source_plugin_unique_identifier="langgenius/anthropic:0.3.37@" + "0" * 64,
            source_schema=source_schema(index),
            source_credentials=None,
        )


@pytest.mark.parametrize("index", [0, 1, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15])
def test_predefined_runtime_schema_is_not_relabeled_as_inventory_evidence(index: int) -> None:
    # The exact runtime schema belongs to the distinct RPC boundary. The
    # factory still accepts only actual inventory/catalog evidence here.
    with pytest.raises(AnthropicSourceAdapterError):
        build_source_adapter_contract(
            runtime_mapping(index),
            source_provider=ANTHROPIC_SOURCE_PROVIDER,
            source_plugin_unique_identifier=runtime_binding(index)["marker"]["source_plugin_uid"],
            source_schema=runtime_schema(index),
            source_credentials=None,
        )


def test_runtime_marker_never_accepts_caller_supplied_runtime_digest_or_rewritten_contract() -> None:
    contract = runtime_contract()
    forged = replace(contract, source_runtime_schema_digest="sha256:" + "f" * 64)
    with pytest.raises(AnthropicSourceAdapterError):
        anthropic_source_marker(
            forged,
            source_provider=ANTHROPIC_SOURCE_PROVIDER,
            source_model=forged.source_model,
            model_type=ModelType.LLM,
            target_model=forged.target_model,
        )
    marker: dict[str, object] = {
        **runtime_binding()["marker"],
        "source_runtime_schema_digest": contract.source_runtime_schema_digest,
    }
    with pytest.raises(AnthropicSourceAdapterError):
        restore_anthropic_source_contract(
            marker,
            source_provider=ANTHROPIC_SOURCE_PROVIDER,
            source_model=contract.source_model,
            model_type=ModelType.LLM,
            target_model=contract.target_model,
        )


def test_runtime_binding_and_schema_fixture_share_exact_source_rpc_evidence() -> None:
    bindings = json.loads((FIXTURES / "model_billing_anthropic_runtime_v2_bindings.json").read_text())
    schemas = json.loads((FIXTURES / "model_billing_anthropic_runtime_v2_schemas.json").read_text())
    assert len(bindings["bindings"]) == 16
    assert len(schemas["schemas"]) == 8
    assert bindings["runtime_artifact_sha256_by_source_uid"] == schemas["evidence_sha256_by_source_uid"]
    assert len(bindings["runtime_artifact_sha256_by_source_uid"]) == 2
    assert len(bindings["shared_semantic_contracts"]) == 8
    assert {item["adapter_revision"] for item in bindings["bindings"]} == {"2"}


@pytest.mark.parametrize("index", range(8))
def test_independent_0338_0339_runtime_profiles_share_logical_mapping_not_identity(index: int) -> None:
    left, right = runtime_contract(index), runtime_contract(index + 8)
    assert left.rules_digest == right.rules_digest
    assert left.source_model == right.source_model
    assert left.source_schema_digest == right.source_schema_digest
    assert left.source_runtime_schema_digest == right.source_runtime_schema_digest
    assert left.source_plugin_unique_identifier != right.source_plugin_unique_identifier
    assert left.profile_id != right.profile_id
    assert runtime_mapping(index).model_dump(mode="json") == runtime_mapping(index + 8).model_dump(mode="json")
