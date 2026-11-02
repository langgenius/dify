import hashlib
import json
from collections.abc import Sequence
from copy import deepcopy
from typing import NotRequired, TypedDict
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
    system_endpoint: NotRequired[str]


class DeclarationData(TypedDict):
    schema_version: int
    mapping_revision: str
    provider_id: str
    plugin_unique_identifier: str
    catalog_digest: str
    original_configurate_methods: list[str]
    supported_model_types: list[str]
    unavailable: list[NegativeEvidenceData]
    allowed_runtime_types: NotRequired[list[str]]


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


TONGYI_PROVIDER = "langgenius/tongyi/tongyi"
TONGYI_UID = "langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64"
LONG_MODEL = "qwen-long-latest"


def runtime_declaration(models: Sequence[AIModelEntity]) -> DeclarationData:
    record = declaration(LONG_MODEL)
    record.update(
        schema_version=2,
        provider_id=TONGYI_PROVIDER,
        plugin_unique_identifier=TONGYI_UID,
        catalog_digest=source_catalog_digest(models, METHODS, TYPES),
    )
    record["unavailable"][0].update(
        reason="source_runtime_unavailable", system_endpoint="tongyi_international_without_custom_host"
    )
    return record


def test_v1_digest_preserves_preexisting_serialized_evidence() -> None:
    record = declaration()
    record["original_configurate_methods"].sort()
    record["supported_model_types"].sort()
    expected = (
        "sha256:"
        + hashlib.sha256(
            json.dumps([record], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )
    policy = resolve_source_capability_policy(json.dumps([record]), "new")
    assert policy.digest == expected


@pytest.mark.parametrize("declared", [False, True])
@pytest.mark.parametrize("configured_byok", [False, True])
def test_runtime_endpoint_evidence_can_exclude_positive_schema_without_changing_byok(
    declared: bool, configured_byok: bool
) -> None:
    models = [schema(), *([schema(LONG_MODEL)] if declared else [])]
    evidence = resolve_source_capability_policy(json.dumps([runtime_declaration(models)]), "new").for_package(
        TONGYI_PROVIDER, TONGYI_UID
    )
    original = system([RestrictModel(model=name, model_type=ModelType.LLM) for name in ("gpt-4o", LONG_MODEL)])
    original.credentials = {"use_international_endpoint": "true", "dashscope_api_key": "system-test-key"}
    before = original.model_dump()
    configured = frozenset({(ModelType.LLM, LONG_MODEL)}) if configured_byok else frozenset()
    partition = partition_known_unavailable_sources(original, models, METHODS, TYPES, configured, evidence)

    def forbidden_lookup(*_args: object) -> None:
        raise AssertionError("Runtime exclusion must not pretend a daemon schema is absent")

    resolved = hosted_migration_sources(partition.system, models, TYPES, forbidden_lookup)
    assert set(resolved) == {(ModelType.LLM, "gpt-4o")}
    assert partition.unavailable_reasons[(ModelType.LLM, LONG_MODEL)] == "source_runtime_unavailable"
    assert set(partition.unavailable) == (
        {(ModelType.LLM, LONG_MODEL)} if declared else {(kind, LONG_MODEL) for kind in TYPES}
    )
    assert original.model_dump() == before


@pytest.mark.parametrize(
    "credentials",
    [
        None,
        {},
        {"use_international_endpoint": "false"},
        {"use_international_endpoint": True},
        {"use_international_endpoint": "true", "api_host": None},
        {"use_international_endpoint": "true", "api_host": ""},
        {"use_international_endpoint": "true", "api_host": "dashscope.aliyuncs.com"},
    ],
)
def test_runtime_endpoint_mismatch_preserves_dynamic_source_discovery(credentials: dict[str, object] | None) -> None:
    models = [schema()]
    evidence = resolve_source_capability_policy(json.dumps([runtime_declaration(models)]), "new").for_package(
        TONGYI_PROVIDER, TONGYI_UID
    )
    original = system([RestrictModel(model=LONG_MODEL, model_type=ModelType.LLM)])
    original.credentials = credentials
    partition = partition_known_unavailable_sources(original, models, METHODS, TYPES, frozenset(), evidence)
    assert partition.system == original
    assert partition.unavailable == {}
    seen: list[ModelType] = []

    def positive_lookup(kind: ModelType, model: str, _credentials: dict[str, object]) -> AIModelEntity | None:
        seen.append(kind)
        return schema(model) if kind == ModelType.LLM else None

    resolved = hosted_migration_sources(partition.system, models, TYPES, positive_lookup)
    assert set(resolved) == {(ModelType.LLM, LONG_MODEL)}
    assert seen == TYPES


@pytest.mark.parametrize(
    "case", ["v1", "other_provider", "other_model", "wrong_type", "no_endpoint", "schema_endpoint"]
)
def test_runtime_evidence_cannot_impersonate_schema_absence_or_other_source_guards(case: str) -> None:
    record = runtime_declaration([schema()])
    if case == "v1":
        record["schema_version"] = 1
    elif case == "other_provider":
        record.update(provider_id=PROVIDER, plugin_unique_identifier=UID)
    elif case == "other_model":
        record["unavailable"][0]["model"] = "qwen-plus"
    elif case == "wrong_type":
        record["unavailable"][0]["model_type"] = ModelType.TEXT_EMBEDDING.value
        record["unavailable"] = record["unavailable"][:1]
    elif case == "no_endpoint":
        del record["unavailable"][0]["system_endpoint"]
    else:
        record["unavailable"][0]["reason"] = "source_schema_unsupported"
    with pytest.raises(ValidationError):
        resolve_source_capability_policy(json.dumps([record]), "new")


def test_runtime_evidence_digest_and_partial_type_coverage_remain_fail_closed() -> None:
    record = runtime_declaration([schema()])
    policy = resolve_source_capability_policy(json.dumps([record]), "new")
    altered = deepcopy(record)
    altered["unavailable"][0]["proof_id"] = "sha256:" + "d" * 64
    assert resolve_source_capability_policy(json.dumps([altered]), "new").digest != policy.digest
    record["unavailable"] = record["unavailable"][:1]
    evidence = resolve_source_capability_policy(json.dumps([record]), "new").for_package(TONGYI_PROVIDER, TONGYI_UID)
    original = system([RestrictModel(model=LONG_MODEL, model_type=ModelType.LLM)])
    original.credentials = {"use_international_endpoint": "true"}
    partition = partition_known_unavailable_sources(original, [schema()], METHODS, TYPES, frozenset(), evidence)
    assert partition.system == original
    assert partition.unavailable == {}


@pytest.mark.parametrize("case", ["base", "fine_tune", "ambiguous", "configured_other_type"])
def test_runtime_endpoint_evidence_cannot_hide_deployment_or_other_typed_dependency(case: str) -> None:
    models = [
        schema(),
        *([schema(LONG_MODEL), schema(LONG_MODEL, ModelType.TEXT_EMBEDDING)] if case == "ambiguous" else []),
    ]
    record = runtime_declaration(models)
    if case == "ambiguous":
        # Neither schema absence nor endpoint proof can resolve a name shared
        # by multiple actual model types. Preserve the ordinary strict path.
        record["unavailable"] = record["unavailable"][:1]
    evidence = resolve_source_capability_policy(json.dumps([record]), "new").for_package(TONGYI_PROVIDER, TONGYI_UID)
    original = system(
        [
            RestrictModel(
                model="ft:qwen-long:org:id" if case == "fine_tune" else LONG_MODEL,
                model_type=ModelType.LLM,
                base_model_name=LONG_MODEL if case == "base" else None,
            )
        ]
    )
    original.credentials = {"use_international_endpoint": "true"}
    configured = frozenset({(ModelType.TEXT_EMBEDDING, LONG_MODEL)}) if case == "configured_other_type" else frozenset()
    partition = partition_known_unavailable_sources(original, models, METHODS, TYPES, configured, evidence)
    assert partition.system == original
    assert partition.unavailable == {}


@pytest.mark.parametrize(
    ("pool", "unit", "limit"),
    [
        (ProviderQuotaType.FREE, QuotaUnit.CREDITS, 100),
        (ProviderQuotaType.TRIAL, QuotaUnit.CREDITS, -1),
        (ProviderQuotaType.PAID, QuotaUnit.TOKENS, 100),
    ],
)
def test_runtime_evidence_does_not_change_independent_or_unmetered_pools(
    pool: ProviderQuotaType, unit: QuotaUnit, limit: int
) -> None:
    evidence = resolve_source_capability_policy(json.dumps([runtime_declaration([schema()])]), "new").for_package(
        TONGYI_PROVIDER, TONGYI_UID
    )
    original = system([RestrictModel(model=LONG_MODEL, model_type=ModelType.LLM)], pool=pool, unit=unit, limit=limit)
    original.credentials = {"use_international_endpoint": "true"}
    partition = partition_known_unavailable_sources(original, [schema()], METHODS, TYPES, frozenset(), evidence)
    assert partition.system == original
    assert partition.unavailable == {}


def test_runtime_scope_is_explicit_v2_only_and_default_keeps_original_local_digest() -> None:
    original = declaration()
    old = resolve_source_capability_policy(json.dumps([original]), "new")
    assert old.declarations[0].allowed_runtime_types is None
    assert old.declarations[0].allows_runtime("local")
    assert not old.declarations[0].allows_runtime("serverless")
    assert not old.declarations[0].allows_runtime("remote")
    opted = {**original, "schema_version": 2, "allowed_runtime_types": ["local", "serverless"]}
    selected = resolve_source_capability_policy(json.dumps([opted]), "new")
    assert selected.declarations[0].allows_runtime("serverless")
    assert selected.digest != old.digest
    reverse = {**opted, "allowed_runtime_types": ["serverless", "local"]}
    assert resolve_source_capability_policy(json.dumps([reverse]), "new").digest == selected.digest
    # Unknown later revisions cannot change the historical policy/hash.
    later = {**opted, "mapping_revision": "later"}
    assert resolve_source_capability_policy(json.dumps([original, later]), "new").digest == old.digest


@pytest.mark.parametrize("runtimes", [[], ["remote"], ["unknown"], ["local", "local"]])
def test_runtime_scope_cannot_attest_debug_unknown_empty_or_duplicate_kinds(runtimes: list[str]) -> None:
    with pytest.raises(ValidationError):
        resolve_source_capability_policy(
            json.dumps([{**declaration(), "schema_version": 2, "allowed_runtime_types": runtimes}]), "new"
        )


def test_v1_cannot_silently_opt_into_serverless() -> None:
    with pytest.raises(ValueError, match="version 2"):
        resolve_source_capability_policy(
            json.dumps([{**declaration(), "allowed_runtime_types": ["local", "serverless"]}]), "new"
        )


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
