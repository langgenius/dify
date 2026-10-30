import hashlib
import json
from collections.abc import Sequence
from contextlib import nullcontext
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pytest_mock import MockerFixture

from core.entities.provider_entities import (
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
    SystemConfiguration,
)
from core.hosting_configuration import HostingProvider, PaidHostingQuota, TrialHostingQuota
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
from services.model_billing_mapping_service import (
    additional_hosted_availability,
    additional_model_is_authorized,
    hosted_migration_sources,
    mapping_has_required_operations,
    mapping_supports_installed_plugin,
    mappings_for_revision,
    migration_policy_allows_empty_sources,
    model_schema_digest,
    partition_hosted_migration_sources,
    provider_has_prepared_ownership,
    published_original_quotas,
    retirement_policy_for_revision,
    uses_published_tokener_balance,
)


@pytest.mark.parametrize("policy", [None, "", "paid-legacy-v1", "free-legacy-v2", " free-legacy-v1", "free-legacy-v1 "])
def test_only_exact_free_policy_allows_an_empty_inventory(policy: str | None) -> None:
    assert migration_policy_allows_empty_sources(policy) is False
    assert migration_policy_allows_empty_sources("free-legacy-v1") is True


def schema(model: str = "gpt-4o", model_type: ModelType = ModelType.LLM) -> AIModelEntity:
    return AIModelEntity(
        model=model,
        label=I18nObject(en_US=model),
        model_type=model_type,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.MODE: "chat"} if model_type == ModelType.LLM else {},
    )


@pytest.mark.parametrize(
    ("selected", "unmetered", "free_valid"), [("free", False, True), ("free", False, False), ("trial", True, True)]
)
def test_published_balance_preserves_independent_owner_not_old_shared_wallet(
    selected: str, unmetered: bool, free_valid: bool
) -> None:
    from core.hosting_configuration import FreeHostingQuota

    original = [
        QuotaConfiguration(
            quota_type=ProviderQuotaType.PAID,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=200,
            quota_used=0,
            is_valid=True,
        ),
        QuotaConfiguration(
            quota_type=ProviderQuotaType.FREE,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=20,
            quota_used=0 if free_valid else 20,
            is_valid=free_valid,
        ),
        QuotaConfiguration(
            quota_type=ProviderQuotaType.TRIAL,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=200,
            quota_used=0,
            is_valid=True,
        ),
    ]
    state = {
        "source_ownership": {
            "langgenius/openai/openai": {
                "current_quota_type": selected,
                "quotas": {
                    "paid": {"unmetered": False},
                    "trial": {"unmetered": unmetered},
                    "free": {"unmetered": False},
                },
            }
        }
    }
    before = deepcopy(state)
    normalized, preserved = published_original_quotas("langgenius/openai/openai", original, state)
    assert normalized[0].quota_limit == 0
    assert normalized[0].is_valid is False
    assert original[0].quota_limit == 200
    assert original[0].is_valid is True
    result = additional_hosted_availability(
        provider="langgenius/openai/openai",
        hosting=HostingProvider(
            enabled=True,
            quota_unit=QuotaUnit.CREDITS,
            quotas=[PaidHostingQuota(), TrialHostingQuota(), FreeHostingQuota()],
        ),
        installed_models=[schema()],
        original_quotas=normalized,
        raw_registry=json.dumps([mapping()]),
        revision="old",
        published_balance=True,
        preserve_independent_pool=preserved,
    )
    assert result is not None
    assert result.current_quota_type == (
        ProviderQuotaType.TRIAL if unmetered else ProviderQuotaType.FREE if free_valid else ProviderQuotaType.PAID
    )
    assert state == before


@pytest.mark.parametrize("phase", ["preparing", "prepared", "claimed", "granting", "activating", "blocked"])
def test_prepublish_phase_never_enables_balance_model_union(phase: str) -> None:
    assert not uses_published_tokener_balance(
        {"phase": phase, "persisted_model_billing_source": "tokener", "ever_activated": True}
    )


def mapping(
    source: AIModelEntity | None = None,
    revision: str = "old",
    target: str = "old-target",
    pool_types: list[str] | None = None,
) -> dict[str, object]:
    source = source or schema()
    return {
        "schema_version": 1,
        "mapping_revision": revision,
        "source": {
            "provider_id": "langgenius/openai/openai",
            "model_type": source.model_type.value,
            "model": source.model,
            "mode": source.model_properties.get(ModelPropertyKey.MODE, source.model_type.value),
        },
        "source_schema_digest": "sha256:"
        + hashlib.sha256(
            json.dumps(
                source.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
            ).encode()
        ).hexdigest(),
        "settlement_owner": "shared_credit_pool",
        "pool_types": ["paid", "trial"] if pool_types is None else pool_types,
        "target": {
            "plugin_id": "langgenius/tokener",
            "provider": "tokener",
            "model_type": source.model_type.value,
            "model": target,
            "catalog_revision": "catalog",
            "minimum_plugin_version": "0.1.2",
        },
        "parameter_adapter": {"id": "identity_v1", "revision": "v1", "rules_digest": "sha256:" + "a" * 64},
        "operations": (
            ["model/schema", "llm/invoke", "llm/num_tokens"]
            if source.model_type == ModelType.LLM
            else ["model/schema", "text_embedding/invoke", "text_embedding/num_tokens"]
            if source.model_type == ModelType.TEXT_EMBEDDING
            else ["model/schema", f"{source.model_type.value}/invoke"]
        ),
        "conformance_fixture_ids": ["fixture"],
    }


def section(record: dict[str, object], key: str) -> dict[str, object]:
    value = record[key]
    assert isinstance(value, dict)
    return value


def test_explicit_retirement_skips_only_missing_schema_and_preserves_source_ownership() -> None:
    original = system(
        [
            RestrictModel(model="gpt-4o", model_type=ModelType.LLM),
            RestrictModel(model="gpt-3.5-turbo", model_type=ModelType.LLM),
        ]
    )
    before = original.model_dump()
    partition = partition_hosted_migration_sources(original, [schema()], frozenset({(ModelType.LLM, "gpt-3.5-turbo")}))

    def forbidden_lookup(*_args: object) -> None:
        raise AssertionError("Retired schema must not be resolved")

    active = hosted_migration_sources(partition.system, partition.models, [ModelType.LLM], forbidden_lookup)
    assert set(active) == {(ModelType.LLM, "gpt-4o")}
    assert partition.retired == {(ModelType.LLM, "gpt-3.5-turbo"): {ProviderQuotaType.PAID}}
    assert original.model_dump() == before


def test_retirement_does_not_turn_empty_restriction_into_unrestricted_inventory() -> None:
    original = system([RestrictModel(model="retired", model_type=ModelType.LLM)])
    partition = partition_hosted_migration_sources(original, [schema()], frozenset({(ModelType.LLM, "retired")}))
    assert partition.system.quota_configurations == []
    assert hosted_migration_sources(partition.system, partition.models, [ModelType.LLM], lambda *_args: None) == {}
    assert len(partition.retired) == 1


@pytest.mark.parametrize("retired_type", [ModelType.LLM, ModelType.TEXT_EMBEDDING])
def test_an_unlisted_missing_source_still_fails(retired_type: ModelType) -> None:
    original = system([RestrictModel(model="unlisted", model_type=ModelType.LLM)])
    partition = partition_hosted_migration_sources(original, [], frozenset({(retired_type, "retired")}))
    with pytest.raises(ValueError, match="Missing or ambiguous"):
        hosted_migration_sources(partition.system, partition.models, [ModelType.LLM], lambda *_args: None)


def test_unknown_unrestricted_inventory_is_not_excused_by_retirement_policy() -> None:
    partition = partition_hosted_migration_sources(system(), [], frozenset({(ModelType.LLM, "retired")}))
    with pytest.raises(ValueError, match="Unrestricted source inventory"):
        hosted_migration_sources(partition.system, partition.models, [ModelType.LLM], lambda *_args: None)


def test_known_all_retired_unrestricted_inventory_is_represented_explicitly() -> None:
    partition = partition_hosted_migration_sources(
        system(), [schema("retired")], frozenset({(ModelType.LLM, "retired")})
    )
    assert partition.models == []
    assert partition.system.quota_configurations == []
    assert partition.retired == {(ModelType.LLM, "retired"): {ProviderQuotaType.PAID}}


def test_retirement_does_not_hide_ambiguous_installed_model_types() -> None:
    original = system([RestrictModel(model="shared-name", model_type=ModelType.LLM)])
    with pytest.raises(ValueError, match="Ambiguous"):
        partition_hosted_migration_sources(
            original,
            [schema("shared-name"), schema("shared-name", ModelType.TEXT_EMBEDDING)],
            frozenset({(ModelType.LLM, "shared-name")}),
        )


@pytest.mark.parametrize(
    ("pool", "unit", "limit"),
    [
        (ProviderQuotaType.FREE, QuotaUnit.CREDITS, 100),
        (ProviderQuotaType.TRIAL, QuotaUnit.CREDITS, -1),
        (ProviderQuotaType.PAID, QuotaUnit.TOKENS, 100),
    ],
)
def test_retirement_does_not_reclassify_independent_or_unmetered_pools(
    pool: ProviderQuotaType, unit: QuotaUnit, limit: int
) -> None:
    original = system([RestrictModel(model="retired", model_type=ModelType.LLM)], pool=pool, unit=unit, limit=limit)
    partition = partition_hosted_migration_sources(
        original, [schema("retired")], frozenset({(ModelType.LLM, "retired")})
    )
    assert partition.retired == {}
    assert partition.system.model_dump() == original.model_dump()


def test_retired_source_cannot_also_have_a_route_in_same_revision() -> None:
    policy = json.dumps(
        [
            {
                "schema_version": 1,
                "mapping_revision": "old",
                "provider_id": "langgenius/openai/openai",
                "model_type": "llm",
                "model": "gpt-4o",
            }
        ]
    )
    registry = mappings_for_revision(json.dumps([mapping()]), "old")
    with pytest.raises(ValueError, match="both retired and routed"):
        retirement_policy_for_revision(policy, "old", registry)
    assert not retirement_policy_for_revision(policy, "new", registry).identities


def system(
    restrictions: Sequence[RestrictModel] = (),
    *,
    pool: ProviderQuotaType = ProviderQuotaType.PAID,
    unit: QuotaUnit = QuotaUnit.CREDITS,
    limit: int = 100,
) -> SystemConfiguration:
    return SystemConfiguration(
        enabled=True,
        current_quota_type=pool,
        credentials={"api_key": "TEST_KEY"},
        quota_configurations=[
            QuotaConfiguration(
                quota_type=pool,
                quota_unit=unit,
                quota_limit=limit,
                quota_used=0,
                is_valid=True,
                restrict_models=list(restrictions),
            )
        ],
    )


@pytest.mark.parametrize("reverse", [False, True])
def test_revisions_coexist_without_order_dependent_target(reverse: bool) -> None:
    records = [mapping(), mapping(revision="new", target="new-target")]
    raw = json.dumps(list(reversed(records)) if reverse else records)
    key = ("langgenius/openai/openai", ModelType.LLM, "gpt-4o")
    assert mappings_for_revision(raw, "old")[key].target.model == "old-target"
    assert mappings_for_revision(raw, "new")[key].target.model == "new-target"


@pytest.mark.parametrize("revision", ["", "missing"])
def test_missing_revision_never_selects_only_or_latest_revision(revision: str) -> None:
    with pytest.raises(ValueError, match="mapping revision"):
        mappings_for_revision(json.dumps([mapping()]), revision)


def test_single_existing_revision_has_unchanged_contract() -> None:
    record = mapping()
    selected = mappings_for_revision(json.dumps([record]), "old")
    assert next(iter(selected.values())).model_dump(mode="json") == record


def test_legacy_mapping_contract_import_remains_compatible() -> None:
    from core.model_invocation_routing import ModelMapping as LegacyMapping
    from services.entities.model_billing_mapping import ModelMapping

    assert LegacyMapping is ModelMapping


def test_canonical_provider_alias_is_a_duplicate_within_revision() -> None:
    alias = mapping()
    section(alias, "source")["provider_id"] = "openai"
    with pytest.raises(ValueError, match="Duplicate"):
        mappings_for_revision(json.dumps([mapping(), alias]), "old")


def test_invalid_other_revision_is_not_ignored() -> None:
    with pytest.raises(ValueError, match="Duplicate"):
        mappings_for_revision(json.dumps([mapping(), mapping(revision="new"), mapping(revision="new")]), "old")


def test_identical_model_names_are_type_qualified_in_registry() -> None:
    records = [mapping(), mapping(schema(model_type=ModelType.TEXT_EMBEDDING))]
    assert len(mappings_for_revision(json.dumps(records), "old")) == 2


def test_cross_type_mapping_fails_closed() -> None:
    record = mapping()
    section(record, "target")["model_type"] = "text-embedding"
    with pytest.raises(ValueError, match="incompatible model type"):
        mappings_for_revision(json.dumps([record]), "old")


@pytest.mark.parametrize("ownership", [None, "bad", [], {"langgenius/openai/openai": None}, {}])
def test_only_a_missing_provider_key_is_new_ownership(ownership: object) -> None:
    assert provider_has_prepared_ownership("openai", {"source_ownership": ownership}) == (ownership != {})
    assert provider_has_prepared_ownership("openai", {})


def test_additional_provider_has_typed_zero_quota_without_legacy_records() -> None:
    source = schema("embedding-model", ModelType.TEXT_EMBEDDING)
    hosting = HostingProvider(
        enabled=True,
        quota_unit=QuotaUnit.CREDITS,
        quotas=[PaidHostingQuota(restrict_models=[RestrictModel(model=source.model, model_type=ModelType.LLM)])],
    )
    result = additional_hosted_availability(
        provider="openai",
        hosting=hosting,
        installed_models=[source],
        original_quotas=[],
        raw_registry=json.dumps([mapping(source)]),
        revision="old",
    )
    assert result is not None
    assert result.current_quota_type == ProviderQuotaType.PAID
    assert len(result.quotas) == 1
    quota = result.quotas[0]
    assert (quota.quota_limit, quota.quota_used, quota.is_valid) == (0, 0, False)
    assert [(item.model_type, item.model) for item in quota.restrict_models] == [
        (ModelType.TEXT_EMBEDDING, source.model)
    ]
    config = SystemConfiguration(
        enabled=True, current_quota_type=result.current_quota_type, quota_configurations=result.quotas
    )
    rule = next(iter(mappings_for_revision(json.dumps([mapping(source)]), "old").values()))
    assert additional_model_is_authorized(system=config, installed_models=[source], mapping=rule)
    assert not additional_model_is_authorized(system=config, installed_models=[source, source], mapping=rule)
    config.quota_configurations[0].restrict_models = []
    assert not additional_model_is_authorized(system=config, installed_models=[source], mapping=rule)


@pytest.mark.parametrize(
    "invalid", ["revision", "pool", "digest", "mode", "ops", "hosting", "unit", "unlimited", "provider"]
)
def test_additional_provider_requires_exact_frozen_server_contract(invalid: str) -> None:
    source = schema()
    record = mapping()
    hosting = HostingProvider(enabled=True, quota_unit=QuotaUnit.CREDITS, quotas=[PaidHostingQuota()])
    if invalid == "revision":
        record["mapping_revision"] = "newer"
    elif invalid == "pool":
        record["pool_types"] = ["trial"]
    elif invalid == "digest":
        record["source_schema_digest"] = "sha256:" + "0" * 64
    elif invalid == "mode":
        section(record, "source")["mode"] = "completion"
    elif invalid == "ops":
        record["operations"] = ["model/schema", "llm/invoke"]
    elif invalid == "hosting":
        hosting.quotas[0].restrict_models = [RestrictModel(model="different", model_type=ModelType.LLM)]
    elif invalid == "unit":
        hosting.quota_unit = QuotaUnit.TOKENS
    elif invalid == "unlimited":
        hosting.quotas = [TrialHostingQuota(quota_limit=-1)]
    elif invalid == "provider":
        section(record, "source")["provider_id"] = "anthropic"
    original_hosting = hosting.model_dump()
    assert (
        additional_hosted_availability(
            provider="openai",
            hosting=hosting,
            installed_models=[source],
            original_quotas=[],
            raw_registry=json.dumps([record]),
            revision="old",
        )
        is None
    )
    assert hosting.model_dump() == original_hosting


def test_additional_provider_pool_intersection_never_uses_unrelated_new_revision() -> None:
    old_source, new_source = schema(), schema("new-model")
    hosting = HostingProvider(
        enabled=True, quota_unit=QuotaUnit.CREDITS, quotas=[PaidHostingQuota(), TrialHostingQuota()]
    )
    result = additional_hosted_availability(
        provider="openai",
        hosting=hosting,
        installed_models=[old_source, new_source],
        original_quotas=[],
        raw_registry=json.dumps([mapping(pool_types=["paid"]), mapping(new_source, revision="new")]),
        revision="old",
    )
    assert result is not None
    assert len(result.quotas) == 1
    assert result.quotas[0].quota_type == ProviderQuotaType.PAID
    assert [entry.model for entry in result.quotas[0].restrict_models] == [old_source.model]


@pytest.mark.parametrize("trial_only_hosting", [False, True])
def test_trial_only_hosting_or_mapping_never_synthesizes_paid(trial_only_hosting: bool) -> None:
    hosting = HostingProvider(
        enabled=True,
        quota_unit=QuotaUnit.CREDITS,
        quotas=[TrialHostingQuota()] if trial_only_hosting else [PaidHostingQuota(), TrialHostingQuota()],
    )
    result = additional_hosted_availability(
        provider="openai",
        hosting=hosting,
        installed_models=[schema()],
        original_quotas=[],
        raw_registry=json.dumps([mapping(pool_types=["paid", "trial"] if trial_only_hosting else ["trial"])]),
        revision="old",
    )
    assert result is not None
    assert result.current_quota_type == ProviderQuotaType.TRIAL
    assert [quota.quota_type for quota in result.quotas] == [ProviderQuotaType.TRIAL]


@pytest.mark.parametrize("explicit", ["placeholder", "non_llm", "deployment"])
def test_additional_provider_reuses_preparation_ambiguity_rules(explicit: str) -> None:
    llm, embedding = schema("shared-name"), schema("shared-name", ModelType.TEXT_EMBEDDING)
    restricted = RestrictModel(model="shared-name", model_type=ModelType.LLM)
    if explicit == "non_llm":
        restricted.model_type = ModelType.TEXT_EMBEDDING
    elif explicit == "deployment":
        restricted.base_model_name = "base-model"
    result = additional_hosted_availability(
        provider="openai",
        hosting=HostingProvider(
            enabled=True, quota_unit=QuotaUnit.CREDITS, quotas=[PaidHostingQuota(restrict_models=[restricted])]
        ),
        installed_models=[llm, embedding],
        original_quotas=[],
        raw_registry=json.dumps([mapping(llm), mapping(embedding)]),
        revision="old",
    )
    if explicit == "placeholder":
        assert result is None
    else:
        assert result is not None
        assert result.quotas[0].restrict_models[0].model_type == restricted.model_type


@pytest.mark.parametrize(("pool", "limit"), [(ProviderQuotaType.FREE, 200), (ProviderQuotaType.TRIAL, -1)])
def test_additional_provider_preserves_independent_allowances_without_mutation(
    pool: ProviderQuotaType, limit: int
) -> None:
    original = system(pool=pool, limit=limit).quota_configurations
    original[0].quota_used = 25
    snapshot = [quota.model_dump() for quota in original]
    result = additional_hosted_availability(
        provider="openai",
        hosting=HostingProvider(enabled=True, quota_unit=QuotaUnit.CREDITS, quotas=[PaidHostingQuota()]),
        installed_models=[schema()],
        original_quotas=original,
        raw_registry=json.dumps([mapping()]),
        revision="old",
    )
    assert result is not None
    assert result.current_quota_type == pool
    assert result.quotas[0].model_dump() == snapshot[0]
    assert [quota.model_dump() for quota in original] == snapshot


def test_additional_provider_does_not_let_free_pool_displace_existing_valid_paid_pool() -> None:
    original = [*system().quota_configurations, *system(pool=ProviderQuotaType.FREE).quota_configurations]
    result = additional_hosted_availability(
        provider="openai",
        hosting=HostingProvider(enabled=True, quota_unit=QuotaUnit.CREDITS, quotas=[PaidHostingQuota()]),
        installed_models=[schema()],
        original_quotas=original,
        raw_registry=json.dumps([mapping()]),
        revision="old",
    )
    assert result is not None
    assert result.current_quota_type == ProviderQuotaType.PAID
    assert (
        additional_hosted_availability(
            provider="openai",
            hosting=HostingProvider(enabled=True, quota_unit=QuotaUnit.CREDITS, quotas=[PaidHostingQuota()]),
            installed_models=[schema()],
            original_quotas=original,
            raw_registry="[]",
            revision="old",
        )
        is None
    )


@pytest.mark.parametrize("model_type", list(ModelType))
def test_additional_mapping_requires_type_specific_daemon_operations(model_type: ModelType) -> None:
    record = mapping(schema(model_type=model_type))
    rule = next(iter(mappings_for_revision(json.dumps([record]), "old").values()))
    assert mapping_has_required_operations(rule)
    assert not mapping_has_required_operations(rule.model_copy(update={"operations": ["model/schema"]}))


@pytest.mark.parametrize(
    ("uid", "expected"),
    [
        ("langgenius/tokener:0.4.1-dev3@hash", True),
        ("langgenius/tokener:0.1.1@hash", False),
        ("evil/tokener:9.9.9@hash", False),
        ("invalid", False),
        ("langgenius/tokener:invalid@hash", False),
    ],
)
def test_additional_mapping_checks_pinned_target_plugin(uid: str, expected: bool) -> None:
    rule = next(iter(mappings_for_revision(json.dumps([mapping()]), "old").values()))
    assert mapping_supports_installed_plugin(rule, uid) is expected
    assert rule.source_schema_digest == model_schema_digest(schema())


# Production allowlist inventory observed on 2026-10-27. This tests type
# resolution, not claims of Tokener support for any of these models.
NON_LLM_MODELS = [
    ("gpt-4o-mini-transcribe", ModelType.SPEECH2TEXT),
    ("gpt-4o-mini-transcribe-2025-12-15", ModelType.SPEECH2TEXT),
    ("gpt-4o-transcribe", ModelType.SPEECH2TEXT),
    ("gpt-4o-transcribe-diarize", ModelType.SPEECH2TEXT),
    ("whisper-1", ModelType.SPEECH2TEXT),
    ("gpt-4o-mini-tts-2025-12-15", ModelType.TTS),
    ("tts-1", ModelType.TTS),
    ("tts-1-hd", ModelType.TTS),
    ("qwen3-tts-flash", ModelType.TTS),
    ("text-embedding-3-large", ModelType.TEXT_EMBEDDING),
    ("text-embedding-3-small", ModelType.TEXT_EMBEDDING),
    ("text-embedding-ada-002", ModelType.TEXT_EMBEDDING),
    ("gemini-embedding-001", ModelType.TEXT_EMBEDDING),
    ("gemini-embedding-2-preview", ModelType.TEXT_EMBEDDING),
    ("text-embedding-v3", ModelType.TEXT_EMBEDDING),
    ("text-embedding-v4", ModelType.TEXT_EMBEDDING),
    ("qwen3-rerank", ModelType.RERANK),
]


@pytest.mark.parametrize(("model", "model_type"), NON_LLM_MODELS)
def test_legacy_allowlist_placeholder_resolves_real_non_llm_type(model: str, model_type: ModelType) -> None:
    restriction = RestrictModel(model=model, model_type=ModelType.LLM)
    config = system([restriction])
    original = deepcopy(config)
    expected = schema(model, model_type)
    lookup = Mock()
    result = hosted_migration_sources(config, [expected], list(ModelType), lookup)
    assert list(result) == [(model_type, model)]
    assert result[(model_type, model)].schema is expected
    assert result[(model_type, model)].pool_types == {ProviderQuotaType.PAID}
    assert config == original  # Do not change shared hosting/admission policy.
    lookup.assert_not_called()


def test_paid_trial_ownership_is_unioned_without_free_or_unmetered() -> None:
    config = system()
    config.quota_configurations.extend(system(pool=ProviderQuotaType.TRIAL).quota_configurations)
    config.quota_configurations.extend(system(pool=ProviderQuotaType.FREE).quota_configurations)
    config.quota_configurations.extend(system(unit=QuotaUnit.TOKENS).quota_configurations)
    config.quota_configurations.extend(system(limit=-1).quota_configurations)
    result = hosted_migration_sources(config, [schema()], [ModelType.LLM], Mock())
    assert result[(ModelType.LLM, "gpt-4o")].pool_types == {ProviderQuotaType.PAID, ProviderQuotaType.TRIAL}


@pytest.mark.parametrize(
    "config", [system(pool=ProviderQuotaType.FREE), system(unit=QuotaUnit.TOKENS), system(limit=-1)]
)
def test_independent_or_unlimited_quotas_do_not_enter_inventory(config: SystemConfiguration) -> None:
    lookup = Mock()
    assert hosted_migration_sources(config, [], [], lookup) == {}
    lookup.assert_not_called()


def test_unrestricted_source_inventory_cannot_silently_be_empty() -> None:
    with pytest.raises(ValueError, match="Unrestricted"):
        hosted_migration_sources(system(), [], [ModelType.LLM], Mock())


def test_untyped_ambiguous_name_fails_even_if_llm_schema_matches_placeholder() -> None:
    with pytest.raises(ValueError, match="ambiguous"):
        hosted_migration_sources(
            system([RestrictModel(model="gpt-4o", model_type=ModelType.LLM)]),
            [schema(), schema(model_type=ModelType.TEXT_EMBEDDING)],
            [ModelType.LLM, ModelType.TEXT_EMBEDDING],
            Mock(),
        )


def test_explicit_non_llm_restriction_retains_type() -> None:
    model_type = ModelType.TEXT_EMBEDDING
    selected = hosted_migration_sources(
        system([RestrictModel(model="gpt-4o", model_type=model_type)]),
        [schema(), schema(model_type=model_type)],
        [ModelType.LLM, model_type],
        Mock(),
    )
    assert list(selected) == [(model_type, "gpt-4o")]


def test_explicit_deployment_binding_keeps_base_model_credentials() -> None:
    restriction = RestrictModel(model="deployment", model_type=ModelType.TEXT_EMBEDDING, base_model_name="base")
    lookup = Mock(return_value=schema("deployment", ModelType.TEXT_EMBEDDING))
    config = system([restriction])
    hosted_migration_sources(config, [], [ModelType.TEXT_EMBEDDING], lookup)
    lookup.assert_called_once_with(
        ModelType.TEXT_EMBEDDING, "deployment", {"api_key": "TEST_KEY", "base_model_name": "base"}
    )
    assert config.credentials is not None
    assert "base_model_name" not in config.credentials


def test_missing_static_schema_queries_supported_types() -> None:
    target = schema("embedding", ModelType.TEXT_EMBEDDING)
    lookup = Mock(side_effect=[None, target])
    result = hosted_migration_sources(
        system([RestrictModel(model="embedding", model_type=ModelType.LLM)]),
        [],
        [ModelType.LLM, ModelType.TEXT_EMBEDDING],
        lookup,
    )
    assert result[(ModelType.TEXT_EMBEDDING, "embedding")].schema is target
    assert [call.args[0] for call in lookup.call_args_list] == [ModelType.LLM, ModelType.TEXT_EMBEDDING]


@pytest.mark.parametrize("responses", [[None, None], [schema(), schema(model_type=ModelType.TEXT_EMBEDDING)]])
def test_missing_or_ambiguous_dynamic_schema_fails(responses: list[AIModelEntity | None]) -> None:
    with pytest.raises(ValueError, match="ambiguous"):
        hosted_migration_sources(
            system([RestrictModel(model="gpt-4o", model_type=ModelType.LLM)]),
            [],
            [ModelType.LLM, ModelType.TEXT_EMBEDDING],
            Mock(side_effect=responses),
        )


def test_plugin_schema_cannot_change_requested_identity() -> None:
    with pytest.raises(ValueError, match="identity mismatch"):
        hosted_migration_sources(
            system([RestrictModel(model="unknown", model_type=ModelType.LLM)]),
            [],
            [ModelType.LLM],
            Mock(return_value=schema()),
        )


def install_inventory(
    mocker: MockerFixture,
    schemas: list[AIModelEntity],
    records: list[dict[str, object]],
    restrictions: Sequence[RestrictModel] = (),
) -> None:
    from configs import dify_config

    mocker.patch.object(dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps(records))
    manager = Mock()
    manager.get_configurations.return_value = [
        (
            "langgenius/openai/openai",
            SimpleNamespace(
                system_configuration=system(restrictions),
                provider=SimpleNamespace(models=schemas, supported_model_types=list(ModelType)),
            ),
        )
    ]
    mocker.patch("core.plugin.impl.model_runtime_factory.create_plugin_provider_manager", return_value=manager)


@pytest.mark.parametrize(("model", "model_type"), NON_LLM_MODELS)
def test_inventory_uses_real_type_operations_digest_and_dimensions(
    mocker: MockerFixture, model: str, model_type: ModelType
) -> None:
    from core.model_invocation_routing import embedding_dimensions_contract, migration_inventory

    source = schema(model, model_type)
    old = mapping(source)
    install_inventory(
        mocker,
        [source],
        [mapping(source, revision="new", target="new-target"), old],
        [RestrictModel(model=model, model_type=ModelType.LLM)],
    )
    result = migration_inventory("tenant", "old")
    item = result["models"][0]
    assert result["model_mapping_version"] == "old"
    assert item["model_type"] == model_type.value
    assert item["target_model"] == "old-target"
    assert item["source_schema_digest"] == old["source_schema_digest"]
    if model_type == ModelType.TEXT_EMBEDDING:
        assert item["embedding_dimensions"] == embedding_dimensions_contract(source)
    else:
        assert "embedding_dimensions" not in item


@pytest.mark.parametrize("fault", ["digest", "mode", "pool", "operations", "revision"])
def test_inventory_keeps_all_compatibility_gates(mocker: MockerFixture, fault: str) -> None:
    from core.model_invocation_routing import ModelRouteUnmapped, migration_inventory

    record = mapping()
    if fault == "digest":
        record["source_schema_digest"] = "sha256:" + "0" * 64
    elif fault == "mode":
        section(record, "source")["mode"] = "completion"
    elif fault == "pool":
        record["pool_types"] = ["trial"]
    elif fault == "operations":
        record["operations"] = ["model/schema", "llm/invoke"]
    else:
        record["mapping_revision"] = "new"
    install_inventory(mocker, [schema()], [record])
    with pytest.raises(ModelRouteUnmapped):
        migration_inventory("tenant", "old")


@pytest.mark.parametrize("revision", ["old", "new"])
def test_active_tenant_selects_its_own_revision_and_freezes_it(mocker: MockerFixture, revision: str) -> None:
    from configs import dify_config
    from core.model_invocation_routing import redirect_payload, routed_credentials
    from models.provider import ProviderType

    mocker.patch.object(
        dify_config,
        "TOKENER_LEGACY_MODEL_MAPPING_JSON",
        json.dumps([mapping(), mapping(revision="new", target="new-target")]),
    )
    state = {
        "phase": "active",
        "persisted_model_billing_source": "tokener",
        "model_mapping_version": revision,
        "route_epoch": 1,
        "preparation": {
            "tenant_id": "tenant",
            "provider_name": "langgenius/tokener/tokener",
            "provider_credential_id": "credential",
            "credential_fingerprint": "sha256:" + "a" * 64,
        },
    }
    mocker.patch("core.model_invocation_routing.migration_routing_state", return_value=state)
    session = Mock()
    session.scalar.return_value = SimpleNamespace(
        status="ready", provider_credential_id="credential", plugin_unique_identifier="langgenius/tokener:0.1.2@hash"
    )
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(session))
    config = Mock(
        tenant_id="tenant",
        provider=SimpleNamespace(provider="openai", models=[schema()]),
        system_configuration=system([RestrictModel(model="gpt-4o", model_type=ModelType.LLM)]),
        using_provider_type=ProviderType.SYSTEM,
    )
    credentials = routed_credentials(config, ModelType.LLM, "gpt-4o")
    assert credentials is not None
    assert credentials.plan.mapping_revision == revision
    assert credentials.plan.target_model == f"{revision}-target"
    # Registry publications cannot retarget a request frozen before dispatch.
    mocker.patch.object(dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", "[]")
    mocker.patch("core.model_invocation_routing.managed_credentials", return_value={"api_key": "TEST_KEY"})
    payload = redirect_payload(credentials.plan, {"provider": "openai", "model_type": "llm", "model": "gpt-4o"})
    assert payload["target"]["model"] == f"{revision}-target"


def test_active_revision_missing_cannot_fall_forward_to_new(mocker: MockerFixture) -> None:
    from configs import dify_config
    from core.model_invocation_routing import ModelRouteUnmapped, routed_credentials
    from models.provider import ProviderType

    mocker.patch.object(dify_config, "TOKENER_LEGACY_MODEL_MAPPING_JSON", json.dumps([mapping(revision="new")]))
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state",
        return_value={"phase": "active", "model_mapping_version": "old", "persisted_model_billing_source": "tokener"},
    )
    session = mocker.patch("core.model_invocation_routing.session_factory.create_session")
    with pytest.raises(ModelRouteUnmapped):
        routed_credentials(
            Mock(
                tenant_id="tenant",
                provider=SimpleNamespace(provider="openai"),
                system_configuration=system(),
                using_provider_type=ProviderType.SYSTEM,
            ),
            ModelType.LLM,
            "gpt-4o",
        )
    session.assert_not_called()
