import json
from collections.abc import Sequence
from copy import deepcopy
from typing import TypedDict
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from core.entities.provider_entities import ProviderQuotaType, QuotaUnit, RestrictModel
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod
from services.entities.model_billing_migration import canonical_hash
from services.model_billing_mapping_service import (
    hosted_migration_sources,
    partition_known_unavailable_sources,
    source_catalog_digest,
)
from services.model_billing_source_capability_policy import resolve_source_capability_policy
from tests.unit_tests.services.test_model_billing_mapping_service import schema, system

PROVIDER = "langgenius/openai/openai"
UID = "langgenius/openai:0.4.2@" + "a" * 64
METHODS = [ConfigurateMethod.PREDEFINED_MODEL, ConfigurateMethod.CUSTOMIZABLE_MODEL]
TYPES = [ModelType.LLM, ModelType.TEXT_EMBEDDING]


class NegativeEvidenceData(TypedDict):
    model_type: str
    model: str
    reason: str
    proof_id: str


class DeclarationData(TypedDict):
    schema_version: int
    mapping_revision: str
    provider_id: str
    plugin_unique_identifier: str
    catalog_digest: str
    original_configurate_methods: list[str]
    supported_model_types: list[str]
    unavailable: list[NegativeEvidenceData]


def declaration(model: str = "absent", revision: str = "new") -> DeclarationData:
    return {
        "schema_version": 1,
        "mapping_revision": revision,
        "provider_id": PROVIDER,
        "plugin_unique_identifier": UID,
        "catalog_digest": source_catalog_digest([schema()], METHODS, TYPES),
        "original_configurate_methods": [method.value for method in METHODS],
        "supported_model_types": [kind.value for kind in TYPES],
        "unavailable": [
            {
                "model_type": kind.value,
                "model": model,
                "reason": "source_schema_unsupported",
                "proof_id": "sha256:" + "b" * 64,
            }
            for kind in TYPES
        ],
    }


def test_default_other_revisions_and_record_order_preserve_contract() -> None:
    original = [{"model": "gpt-4o"}]
    for raw in ("[]", json.dumps([declaration()])):
        empty = resolve_source_capability_policy(raw, "old")
        assert empty.inventory_payload(original, []) is original
        assert canonical_hash(empty.inventory_payload(original, [])) == canonical_hash(original)
    first = resolve_source_capability_policy(json.dumps([declaration()]), "new")
    reordered = declaration()
    reordered["unavailable"] = list(reversed(reordered["unavailable"]))
    reordered["supported_model_types"] = list(reversed(reordered["supported_model_types"]))
    second = resolve_source_capability_policy(json.dumps([reordered]), "new")
    assert first.digest == second.digest
    assert canonical_hash(first.inventory_payload(original, [])) != canonical_hash(original)
    assert canonical_hash(first.inventory_payload(original, [{"model": "absent"}])) != canonical_hash(
        first.inventory_payload(original, [])
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("provider_id", "openai"),
        ("plugin_unique_identifier", "langgenius/other:0.4.2@" + "a" * 64),
        ("plugin_unique_identifier", "langgenius/openai:latest"),
        ("catalog_digest", "unknown"),
        ("original_configurate_methods", []),
        ("supported_model_types", []),
        ("unavailable", []),
        ("mapping_revision", ""),
        ("allow_missing", True),
    ],
)
def test_invalid_evidence_fails_closed(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        resolve_source_capability_policy(json.dumps([{**declaration(), field: value}]), "new")


def test_duplicate_package_or_typed_negative_rejected() -> None:
    with pytest.raises(ValueError, match="Duplicate"):
        resolve_source_capability_policy(json.dumps([declaration(), declaration()]), "new")
    duplicate = declaration()
    duplicate["unavailable"] *= 2
    with pytest.raises(ValueError, match="Duplicate"):
        resolve_source_capability_policy(json.dumps([duplicate]), "new")
    assert (
        len(
            resolve_source_capability_policy(
                json.dumps([declaration(), declaration(revision="later")]), "new"
            ).declarations
        )
        == 1
    )


def test_exact_negative_evidence_only_partitions_inventory_and_pools() -> None:
    original = system([RestrictModel(model=name, model_type=ModelType.LLM) for name in ("gpt-4o", "absent")])
    original.quota_configurations.extend(deepcopy(original.quota_configurations))
    original.quota_configurations[1].quota_type = ProviderQuotaType.TRIAL
    before = original.model_dump()
    evidence = resolve_source_capability_policy(json.dumps([declaration()]), "new").for_package(PROVIDER, UID)
    partition = partition_known_unavailable_sources(original, [schema()], METHODS, TYPES, frozenset(), evidence)
    lookup = Mock(side_effect=AssertionError("Attested absent source must not call RPC"))
    resolved = hosted_migration_sources(partition.system, [schema()], TYPES, lookup)
    assert set(resolved) == {(ModelType.LLM, "gpt-4o")}
    assert resolved[(ModelType.LLM, "gpt-4o")].pool_types == {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}
    assert set(partition.unavailable) == {(kind, "absent") for kind in TYPES}
    assert all(
        pools == {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL} for _, pools in partition.unavailable.values()
    )
    assert original.model_dump() == before
    lookup.assert_not_called()


@pytest.mark.parametrize(
    "case",
    [
        "unknown_uid",
        "unknown_revision",
        "changed_catalog",
        "changed_methods",
        "incomplete_types",
        "partial_negative",
        "ft",
        "base",
        "configured",
        "pure_custom",
    ],
)
def test_nonmatching_or_dynamic_identity_keeps_strict_lookup(case: str) -> None:
    record = declaration("ft:gpt-4o:org:id" if case == "ft" else "absent")
    name = "ft:gpt-4o:org:id" if case == "ft" else "absent"
    if case == "partial_negative":
        record["unavailable"] = [record["unavailable"][0]]
    policy = resolve_source_capability_policy(json.dumps([record]), "other" if case == "unknown_revision" else "new")
    evidence = policy.for_package(PROVIDER, UID + "changed" if case == "unknown_uid" else UID)
    methods = [ConfigurateMethod.CUSTOMIZABLE_MODEL] if case in {"changed_methods", "pure_custom"} else METHODS
    if case == "pure_custom":
        record["original_configurate_methods"] = [ConfigurateMethod.CUSTOMIZABLE_MODEL.value]
        record["catalog_digest"] = source_catalog_digest([schema()], methods, TYPES)
        evidence = resolve_source_capability_policy(json.dumps([record]), "new").for_package(PROVIDER, UID)
    models = [schema("changed")] if case == "changed_catalog" else [schema()]
    types = [*TYPES, ModelType.TTS] if case == "incomplete_types" else TYPES
    configured = frozenset({(ModelType.LLM, name)}) if case == "configured" else frozenset()
    original = system(
        [RestrictModel(model=name, model_type=ModelType.LLM, base_model_name="gpt-4o" if case == "base" else None)]
    )
    partition = partition_known_unavailable_sources(original, models, methods, types, configured, evidence)
    assert not partition.unavailable
    dynamic = schema(name)
    lookup = Mock(side_effect=lambda kind, _model, _credentials: dynamic if kind == ModelType.LLM else None)
    assert set(hosted_migration_sources(partition.system, models, types, lookup)) == {(ModelType.LLM, name)}
    assert lookup.call_count == (1 if case == "base" else len(types))


def test_rpc_error_remains_an_error_not_negative_evidence() -> None:
    original = system([RestrictModel(model="dynamic", model_type=ModelType.LLM)])
    evidence = resolve_source_capability_policy(json.dumps([declaration()]), "new").for_package(PROVIDER, UID)
    partition = partition_known_unavailable_sources(original, [schema()], METHODS, TYPES, frozenset(), evidence)
    with pytest.raises(RuntimeError, match="RPC failed"):
        hosted_migration_sources(partition.system, [schema()], TYPES, Mock(side_effect=RuntimeError("RPC failed")))


@pytest.mark.parametrize("models", [[], [schema(), schema()], [schema(model_type=ModelType.TTS)]])
def test_empty_duplicate_or_wrong_type_catalog_fails_closed(models: Sequence[AIModelEntity]) -> None:
    evidence = resolve_source_capability_policy(json.dumps([declaration()]), "new").for_package(PROVIDER, UID)
    with pytest.raises(ValueError, match="Source capability requires|Source catalog contains"):
        partition_known_unavailable_sources(system(), models, METHODS, TYPES, frozenset(), evidence)


def test_negative_claim_cannot_hide_declared_model_or_ambiguous_name() -> None:
    record = declaration("gpt-4o")
    evidence = resolve_source_capability_policy(json.dumps([record]), "new").for_package(PROVIDER, UID)
    with pytest.raises(ValueError, match="contradicts"):
        partition_known_unavailable_sources(system(), [schema()], METHODS, TYPES, frozenset(), evidence)
    original = system([RestrictModel(model="shared", model_type=ModelType.LLM)])
    models = [schema("shared"), schema("shared", ModelType.TEXT_EMBEDDING)]
    partition = partition_known_unavailable_sources(original, models, METHODS, TYPES, frozenset(), evidence)
    with pytest.raises(ValueError, match="ambiguous"):
        hosted_migration_sources(partition.system, models, TYPES, Mock())


@pytest.mark.parametrize(
    ("pool", "unit", "limit"),
    [
        (ProviderQuotaType.FREE, QuotaUnit.CREDITS, 100),
        (ProviderQuotaType.TRIAL, QuotaUnit.CREDITS, -1),
        (ProviderQuotaType.PAID, QuotaUnit.TOKENS, 100),
    ],
)
def test_independent_pools_unchanged_and_empty_restrictions_never_become_unrestricted(
    pool: ProviderQuotaType, unit: QuotaUnit, limit: int
) -> None:
    evidence = resolve_source_capability_policy(json.dumps([declaration()]), "new").for_package(PROVIDER, UID)
    original = system([RestrictModel(model="absent", model_type=ModelType.LLM)], pool=pool, unit=unit, limit=limit)
    assert (
        partition_known_unavailable_sources(original, [schema()], METHODS, TYPES, frozenset(), evidence).system
        == original
    )
    finite = system([RestrictModel(model="absent", model_type=ModelType.LLM)])
    assert (
        partition_known_unavailable_sources(
            finite, [schema()], METHODS, TYPES, frozenset(), evidence
        ).system.quota_configurations
        == []
    )
