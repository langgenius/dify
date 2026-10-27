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
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
from services.model_billing_mapping_service import hosted_migration_sources, mappings_for_revision


def schema(model: str = "gpt-4o", model_type: ModelType = ModelType.LLM) -> AIModelEntity:
    return AIModelEntity(
        model=model,
        label=I18nObject(en_US=model),
        model_type=model_type,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.MODE: "chat"} if model_type == ModelType.LLM else {},
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
        provider=SimpleNamespace(provider="openai"),
        system_configuration=system(),
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
        return_value={"phase": "active", "model_mapping_version": "old"},
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
