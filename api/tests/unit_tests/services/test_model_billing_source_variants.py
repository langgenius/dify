"""Exact-version registry/availability; real reviewed042 contracts, no model calls."""

import base64
import gzip
import hashlib
import json
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from typing import TypedDict, cast

import pytest
from pydantic import ValidationError

from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit
from core.hosting_configuration import HostingProvider, PaidHostingQuota
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_embedding_mapping import SelectedEmbeddingSourceVariant
from services.entities.model_billing_mapping import (
    ModelMapping,
    SelectedSourceVariant,
    SourceParameterContract,
    SourceVariantMapping,
    SourceVariantSettings,
)
from services.model_billing_mapping_service import (
    additional_hosted_availability,
    build_source_adapter_contract,
    hosted_embedding_source_fact,
    hosted_source_variant_fact,
    mappings_for_revision,
    resolve_source_mapping,
    restore_variant_source_contract,
    source_mapping_revision,
    source_parameter_marker,
    source_variant_context,
    validate_frozen_mapping_evidence,
)
from services.model_billing_openai_chat_adapter import _OFFICIAL_ROOT_REVIEWED_CONTRACT as OFFICIAL042
from services.model_billing_openai_provider042_adapter import OPENAI_PROVIDER042_SOURCE_UID
from services.model_billing_openai_provider110_adapter import (
    _OFFICIAL_ROOT_REVIEWED_CONTRACTS as OFFICIAL110,
)
from services.model_billing_openai_provider110_adapter import _REVIEWED_CONTRACTS
from services.model_billing_openai_provider110_adapter import _REVIEWED_CONTRACTS as CURRENT_SOURCE_CONTRACTS
from services.model_billing_source_variants import SourceVariantContext, selection_payload, source_endpoint_class
from tests.helpers.unit.model_billing_source_profiles import (
    DAEMON_REVISION,
    EMBEDDING_MODELS,
    EMBEDDING_REVISION,
    GPT55_IDENTITY,
    GPT55_REVISION,
    SOURCE_PROVIDER,
    embedding_profiles,
    embedding_schemas,
    full_daemon_registry,
    full_embedding_registry,
    full_gpt55_registry,
    gpt55_daemon_schemas,
    gpt55_schemas,
    gpt55_variant_record,
    profile_digest,
)
from tests.unit_tests.services.test_model_billing_mapping_service import mapping, schema, section
from tests.unit_tests.services.test_model_billing_openai_chat_adapter import build_inputs

REVISION = "source-variants-new-v2"
OFFICIAL_ROOT_REVISION = "source-variants-official-root-v1"
IDENTITY = ("langgenius/openai/openai", ModelType.LLM, "gpt-4o-mini")


def variant_record() -> dict[str, object]:
    inputs = build_inputs(runtime=True)
    record = mapping(inputs["source_schema"], revision=REVISION, target=inputs["target_model"])
    adapter = {
        "id": inputs["adapter_id"],
        "revision": inputs["adapter_revision"],
        "rules_digest": inputs["expected_rules_digest"],
    }
    variants = [
        {
            "variant_id": "openai042-" + selector,
            "source_plugin_uid": inputs["source_plugin_unique_identifier"],
            "source_settings": {
                "protocol_selector": selector,
                "source_base_is_set": False,
                "request_metadata_enabled": False,
            },
            "source_schema_digest": inputs["expected_source_schema_digest"],
            "source_runtime_schema_digest": "sha256:b068793d31c93e11b44e31374e24f62ce25b7c8744aae708213f7caa41be4783",
            "source_profile_id": "openai-042-chat-runtime-v2:gpt-4o-mini",
            "parameter_adapter": adapter,
            "target": record["target"],
            "operations": record["operations"],
            "conformance_fixture_ids": ["exact-reviewed-042-runtime-profile"],
        }
        for selector in ("absent", "chat")
    ]
    return {
        "schema_version": 2,
        "mapping_revision": REVISION,
        "source": record["source"],
        "settlement_owner": "shared_credit_pool",
        "pool_types": ["paid", "trial"],
        "variants": variants,
    }


def variants(record: dict[str, object]) -> list[dict[str, object]]:
    value = record["variants"]
    assert isinstance(value, list)
    assert all(isinstance(item, dict) for item in value)
    return value


@pytest.mark.parametrize("base", [None, "https://generativelanguage.googleapis.com"])
def test_new_gemini_v6_exact_nine_current_facts_factory_and_restore(base: str | None) -> None:
    from services.entities.model_billing_gemini_mapping import (
        SelectedGeminiSourceVariant,
        SourceGeminiVariantSelection,
    )
    from services.model_billing_mapping_service import hosted_gemini_source_fact
    from tests.helpers.unit import model_billing_gemini_profiles as gemini

    rows = gemini.profiles()
    schemas = [gemini.schema(row) for row in rows]
    registry = source_mapping_revision(gemini.registry(), gemini.REVISION)
    fact = hosted_gemini_source_fact(
        provider=gemini.SOURCE_PROVIDER,
        source_uid=gemini.SOURCE_UID,
        models=schemas,
        credentials={"google_api_key": "synthetic-source-not-forwarded", "google_base_url": base},
    )
    assert fact is not None
    for row in rows:
        source = gemini.schema(row)
        selected = resolve_source_mapping(
            registry,
            (gemini.SOURCE_PROVIDER, source.model_type, source.model),
            source_uid=gemini.SOURCE_UID,
            fact=None,
            gemini_fact=fact,
            schema=source,
        )
        assert type(selected) is SelectedGeminiSourceVariant
        contract = build_source_adapter_contract(
            selected,
            source_provider=gemini.SOURCE_PROVIDER,
            source_plugin_unique_identifier=gemini.SOURCE_UID,
            source_schema=source,
            source_credentials=None,
        )
        assert isinstance(contract, SourceParameterContract)
        assert contract == restore_variant_source_contract(selected)
        frozen = selection_payload(selected)
        assert isinstance(frozen, SourceGeminiVariantSelection)
        assert frozen.schema_version == 6
        assert (
            registry.restore_selection(
                (gemini.SOURCE_PROVIDER, source.model_type, source.model), frozen.model_dump(mode="json")
            )
            == selected
        )
        validate_frozen_mapping_evidence(
            selected,
            provider=gemini.SOURCE_PROVIDER,
            model=source.model,
            model_type=source.model_type,
            target_model=source.model,
            operations=tuple(selected.operations),
            source_contract=contract,
            tts_contract=None,
        )
    assert len(registry.selected_prospective()) == 9


@pytest.mark.parametrize("api_host", [None, "", "   "])
def test_tongyi_v7_exact_fourteen_current_facts_factory_and_restore(api_host: str | None) -> None:
    from services.entities.model_billing_tongyi_mapping import SelectedTongyiSourceVariant, SourceTongyiVariantSelection
    from services.model_billing_mapping_service import hosted_tongyi_source_fact
    from tests.helpers.unit import model_billing_tongyi_profiles as tongyi

    rows = tongyi.profiles()
    schemas = [tongyi.schema(row) for row in rows]
    registry = source_mapping_revision(tongyi.registry(), tongyi.REVISION)
    original = {
        "dashscope_api_key": "SYNTHETIC_SOURCE_KEY_NEVER_RETAIN",
        "use_international_endpoint": "true",
        "api_host": api_host,
    }
    fact = hosted_tongyi_source_fact(
        provider=tongyi.SOURCE_PROVIDER, source_uid=tongyi.SOURCE_UID, models=schemas, credentials=original
    )
    assert fact is not None
    assert fact.endpoint_selector == "string_true"
    assert "SYNTHETIC_SOURCE_KEY" not in repr(fact)
    for row in rows:
        source = tongyi.schema(row)
        selected = resolve_source_mapping(
            registry,
            (tongyi.SOURCE_PROVIDER, source.model_type, source.model),
            source_uid=tongyi.SOURCE_UID,
            fact=None,
            tongyi_fact=fact,
            schema=source,
        )
        assert type(selected) is SelectedTongyiSourceVariant
        contract = build_source_adapter_contract(
            selected,
            source_provider=tongyi.SOURCE_PROVIDER,
            source_plugin_unique_identifier=tongyi.SOURCE_UID,
            source_schema=source,
            source_credentials=None,
        )
        assert isinstance(contract, SourceParameterContract)
        assert contract == restore_variant_source_contract(selected)
        frozen = selection_payload(selected)
        assert type(frozen) is SourceTongyiVariantSelection
        assert frozen.schema_version == 7
        assert (
            registry.restore_selection(
                (tongyi.SOURCE_PROVIDER, source.model_type, source.model), frozen.model_dump(mode="json")
            )
            == selected
        )
        validate_frozen_mapping_evidence(
            selected,
            provider=tongyi.SOURCE_PROVIDER,
            model=source.model,
            model_type=source.model_type,
            target_model=source.model,
            operations=tuple(selected.operations),
            source_contract=contract,
            tts_contract=None,
        )
    assert len(registry.selected_prospective()) == 14


@pytest.mark.parametrize(
    "credentials",
    [
        None,
        {},
        {"use_international_endpoint": False},
        {"use_international_endpoint": True},
        {"use_international_endpoint": "TRUE"},
        {"use_international_endpoint": "false"},
        {"use_international_endpoint": " true "},
        {"use_international_endpoint": "true", "api_host": "https://custom.invalid"},
        {"use_international_endpoint": "true", "api_host": True},
    ],
)
def test_tongyi_v7_unreviewed_endpoint_facts_never_authorize_any_of_three_types(credentials: object) -> None:
    from services.model_billing_mapping_service import hosted_tongyi_source_fact
    from tests.helpers.unit import model_billing_tongyi_profiles as tongyi

    schemas = [tongyi.schema(row) for row in tongyi.profiles()]
    registry = source_mapping_revision(tongyi.registry(), tongyi.REVISION)
    fact = hosted_tongyi_source_fact(
        provider=tongyi.SOURCE_PROVIDER, source_uid=tongyi.SOURCE_UID, models=schemas, credentials=credentials
    )
    for source in schemas:
        with pytest.raises(ValueError, match="Positive source variant facts required"):
            resolve_source_mapping(
                registry,
                (tongyi.SOURCE_PROVIDER, source.model_type, source.model),
                source_uid=tongyi.SOURCE_UID,
                fact=None,
                tongyi_fact=fact,
                schema=source,
            )


@pytest.mark.parametrize("metadata", [None, "disabled", "enabled", "", False, True, "DISABLED"])
def test_tongyi_v7_llm_metadata_policy_is_not_inferred_for_embedding_or_rerank(metadata: object) -> None:
    from services.entities.model_billing_tongyi_mapping import SelectedTongyiSourceVariant
    from services.model_billing_mapping_service import hosted_tongyi_source_fact
    from tests.helpers.unit import model_billing_tongyi_profiles as tongyi

    schemas = [tongyi.schema(row) for row in tongyi.profiles()]
    registry = source_mapping_revision(tongyi.registry(), tongyi.REVISION)
    fact = hosted_tongyi_source_fact(
        provider=tongyi.SOURCE_PROVIDER,
        source_uid=tongyi.SOURCE_UID,
        models=schemas,
        credentials={"use_international_endpoint": "true", "enable_request_metadata": metadata},
    )
    for source in schemas:
        if source.model_type is ModelType.LLM and metadata not in (None, "disabled"):
            with pytest.raises(ValueError, match="Positive source variant facts required"):
                resolve_source_mapping(
                    registry,
                    (tongyi.SOURCE_PROVIDER, source.model_type, source.model),
                    source_uid=tongyi.SOURCE_UID,
                    fact=None,
                    tongyi_fact=fact,
                    schema=source,
                )
        else:
            selected = resolve_source_mapping(
                registry,
                (tongyi.SOURCE_PROVIDER, source.model_type, source.model),
                source_uid=tongyi.SOURCE_UID,
                fact=None,
                tongyi_fact=fact,
                schema=source,
            )
            assert isinstance(selected, SelectedTongyiSourceVariant)
            assert selected.variant.source_settings.request_metadata_policy == (
                "actual_system_disabled" if source.model_type is ModelType.LLM else "not_used"
            )


@pytest.mark.parametrize(
    "mutation", ["type", "model", "operations", "profile", "settings", "multiple", "schema", "rules", "unknown_field"]
)
def test_tongyi_v7_closed_declarations_and_factory_reject_widening(mutation: str) -> None:
    from tests.helpers.unit import model_billing_tongyi_profiles as tongyi

    row = next(row for row in tongyi.profiles() if row["model_type"] == "rerank")
    record = tongyi.variant_record(row)
    variant = record["variants"][0]
    if mutation == "type":
        record["source"]["model_type"] = "llm"
    elif mutation == "model":
        record["source"]["model"] = "qwen-long"
    elif mutation == "operations":
        variant["operations"].append("rerank/num_tokens")
    elif mutation == "profile":
        variant["source_profile_id"] = "unreviewed"
    elif mutation == "settings":
        variant["source_settings"]["request_metadata_policy"] = "actual_system_disabled"
    elif mutation == "multiple":
        record["variants"].append(deepcopy(variant))
    elif mutation == "schema":
        variant["source_schema_digest"] = "sha256:" + "0" * 64
    elif mutation == "rules":
        variant["parameter_adapter"]["rules_digest"] = "sha256:" + "0" * 64
    else:
        variant["source_settings"]["url"] = "https://unreviewed.invalid"
    if mutation in {"schema", "rules"}:
        registry = source_mapping_revision(json.dumps([record]), tongyi.REVISION)
        with pytest.raises(ValueError, match="Tongyi source evidence is not reviewed"):
            restore_variant_source_contract(registry.selected_prospective()[0])
    else:
        with pytest.raises(ValidationError):
            source_mapping_revision(json.dumps([record]), tongyi.REVISION)


@pytest.mark.parametrize("version", [True, False, 7.0, "7", 8])
def test_tongyi_v7_version_is_exact_integer_not_bool_string_or_float(version: object) -> None:
    from tests.helpers.unit import model_billing_tongyi_profiles as tongyi

    records = json.loads(tongyi.registry())
    records[0]["schema_version"] = version
    with pytest.raises(ValidationError):
        source_mapping_revision(json.dumps(records), tongyi.REVISION)


def test_tongyi_v7_append_preserves_every_v1_to_v6_record_selection_and_digest() -> None:
    from tests.helpers.unit import model_billing_gemini_profiles as gemini
    from tests.helpers.unit import model_billing_tongyi_profiles as tongyi
    from tests.unit_tests.services.model_billing_audio_xai_fixtures import REVISION as AUDIO_XAI_REVISION
    from tests.unit_tests.services.model_billing_audio_xai_fixtures import audio_xai_records

    prior = [
        mapping(revision="tongyi-preserved-v1"),
        variant_record(),
        *full_embedding_registry(),
        *full_daemon_registry(),
        *audio_xai_records(),
        *json.loads(gemini.registry()),
    ]
    combined = json.dumps([*prior, *json.loads(tongyi.registry())])
    for revision in (
        "tongyi-preserved-v1",
        REVISION,
        EMBEDDING_REVISION,
        DAEMON_REVISION,
        AUDIO_XAI_REVISION,
        gemini.REVISION,
    ):
        original = source_mapping_revision(json.dumps(prior), revision)
        restored = source_mapping_revision(combined, revision)
        assert restored.digest == original.digest
        assert [item.model_dump_json() for item in restored.declarations.values()] == [
            item.model_dump_json() for item in original.declarations.values()
        ]
        assert [selection_payload(item).model_dump_json() for item in restored.selected_prospective()] == [
            selection_payload(item).model_dump_json() for item in original.selected_prospective()
        ]
    current = source_mapping_revision(combined, tongyi.REVISION)
    assert current.digest == source_mapping_revision(tongyi.registry(), tongyi.REVISION).digest


@pytest.mark.parametrize(
    "credentials",
    [
        None,
        {},
        {"google_base_url": ""},
        {"google_base_url": "https://generativelanguage.googleapis.com/v1beta"},
        {"google_base_url": "https://custom.invalid"},
        {"google_base_url": False},
        {"enable_request_metadata": "enabled"},
        {"enable_request_metadata": False},
        {"file_url": "https://files.invalid"},
        {"file_url": False},
    ],
)
def test_new_gemini_unreviewed_llm_fact_and_ignored_embedding_settings_are_separate(
    credentials: object,
) -> None:
    from services.model_billing_mapping_service import hosted_gemini_source_fact
    from tests.helpers.unit import model_billing_gemini_profiles as gemini

    rows = gemini.profiles()
    schemas = [gemini.schema(row) for row in rows]
    registry = source_mapping_revision(gemini.registry(), gemini.REVISION)
    fact = hosted_gemini_source_fact(
        provider=gemini.SOURCE_PROVIDER, source_uid=gemini.SOURCE_UID, models=schemas, credentials=credentials
    )
    llm = next(item for item in schemas if item.model_type is ModelType.LLM)
    # An existing empty SYSTEM dictionary is positive absent/None evidence.
    if credentials == {}:
        resolve_source_mapping(
            registry,
            (gemini.SOURCE_PROVIDER, llm.model_type, llm.model),
            source_uid=gemini.SOURCE_UID,
            fact=None,
            gemini_fact=fact,
            schema=llm,
        )
    else:
        with pytest.raises(ValueError, match="Positive source variant facts required"):
            resolve_source_mapping(
                registry,
                (gemini.SOURCE_PROVIDER, llm.model_type, llm.model),
                source_uid=gemini.SOURCE_UID,
                fact=None,
                gemini_fact=fact,
                schema=llm,
            )
    embedding = next(item for item in schemas if item.model_type is ModelType.TEXT_EMBEDDING)
    if credentials is not None:
        resolve_source_mapping(
            registry,
            (gemini.SOURCE_PROVIDER, embedding.model_type, embedding.model),
            source_uid=gemini.SOURCE_UID,
            fact=None,
            gemini_fact=fact,
            schema=embedding,
        )


@pytest.mark.parametrize(
    "mutation", ["type", "model", "operations", "profile", "settings", "multiple", "schema", "rules"]
)
def test_new_gemini_v6_closed_declaration_or_factory_rejects_widening(mutation: str) -> None:
    from tests.helpers.unit import model_billing_gemini_profiles as gemini

    row = next(row for row in gemini.profiles() if row["source_model"] == "gemini-embedding-2-preview")
    record = gemini.variant_record(row)
    variant = record["variants"][0]
    if mutation == "type":
        record["source"]["model_type"] = "llm"
    elif mutation == "model":
        record["source"]["model"] = "gemini-3.1-flash-lite-preview"
    elif mutation == "operations":
        variant["operations"].remove("multimodal_embedding/invoke")
    elif mutation == "profile":
        variant["source_profile_id"] = "unreviewed"
    elif mutation == "settings":
        variant["source_settings"]["request_metadata_policy"] = "system_false_only"
    elif mutation == "multiple":
        record["variants"].append(deepcopy(variant))
    elif mutation == "schema":
        variant["source_schema_digest"] = "sha256:" + "0" * 64
    else:
        variant["parameter_adapter"]["rules_digest"] = "sha256:" + "0" * 64
    if mutation in {"schema", "rules"}:
        registry = source_mapping_revision(json.dumps([record]), gemini.REVISION)
        with pytest.raises(ValueError, match="Gemini source evidence is not reviewed"):
            restore_variant_source_contract(registry.selected_prospective()[0])
    else:
        with pytest.raises(ValueError, match="validation error"):
            source_mapping_revision(json.dumps([record]), gemini.REVISION)


def test_gemini_v6_append_keeps_v1_to_v5_declarations_selections_and_revision_digests() -> None:
    from tests.helpers.unit import model_billing_gemini_profiles as gemini
    from tests.unit_tests.services.model_billing_audio_xai_fixtures import REVISION as AUDIO_XAI_REVISION
    from tests.unit_tests.services.model_billing_audio_xai_fixtures import audio_xai_records

    prior = [
        mapping(revision="gemini-preserved-v1"),
        variant_record(),
        *full_embedding_registry(),
        *full_daemon_registry(),
        *audio_xai_records(),
    ]
    revisions = ("gemini-preserved-v1", REVISION, EMBEDDING_REVISION, DAEMON_REVISION, AUDIO_XAI_REVISION)
    combined = json.dumps([*prior, *json.loads(gemini.registry())])
    for revision in revisions:
        original = source_mapping_revision(json.dumps(prior), revision)
        restored = source_mapping_revision(combined, revision)
        assert restored.digest == original.digest
        assert [row.model_dump_json() for row in restored.declarations.values()] == [
            row.model_dump_json() for row in original.declarations.values()
        ]
        assert [selection_payload(row).model_dump_json() for row in restored.selected_prospective()] == [
            selection_payload(row).model_dump_json() for row in original.selected_prospective()
        ]
    current = source_mapping_revision(combined, gemini.REVISION)
    assert current.digest == source_mapping_revision(gemini.registry(), gemini.REVISION).digest
    records = json.loads(gemini.registry())
    records.reverse()
    assert source_mapping_revision(json.dumps(records), gemini.REVISION).digest == current.digest
    selected = current.selected_prospective()[0]
    changed = json.loads(gemini.registry())
    changed[-1]["variants"][0]["conformance_fixture_ids"].append("another-reviewed-fixture")
    drifted = source_mapping_revision(json.dumps(changed), gemini.REVISION)
    assert drifted.digest != current.digest
    with pytest.raises(ValueError, match="Frozen source variant changed"):
        drifted.restore_selection(
            (gemini.SOURCE_PROVIDER, selected.source.model_type, selected.source.model),
            selection_payload(selected).model_dump(mode="json"),
        )


def test_gemini_v6_discriminator_never_coerces_a_float_into_integer_six() -> None:
    from tests.helpers.unit import model_billing_gemini_profiles as gemini

    records = json.loads(gemini.registry())
    records[0]["schema_version"] = 6.0
    with pytest.raises(ValueError, match="Gemini schema version must be integer 6"):
        source_mapping_revision(json.dumps(records), gemini.REVISION)
    registry = source_mapping_revision(gemini.registry(), gemini.REVISION)
    selected = registry.selected_prospective()[0]
    payload = selection_payload(selected).model_dump(mode="json")
    payload["schema_version"] = 6.0
    with pytest.raises(ValueError, match="Gemini schema version must be integer 6"):
        registry.restore_selection((gemini.SOURCE_PROVIDER, selected.source.model_type, selected.source.model), payload)


@pytest.mark.parametrize("byok", [False, True])
@pytest.mark.parametrize(
    "model",
    [
        "gemini-2.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.1-pro-preview",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.7-flash",
        "gemini-3-flash-preview",
        "gemini-embedding-001",
        "gemini-embedding-2-preview",
    ],
)
def test_gemini_late_provider_saved_selection_reads_actual_fresh_binding_and_system_facts(
    model: str, byok: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.entities.provider_entities import RestrictModel
    from tests.helpers.unit import model_billing_gemini_profiles as gemini
    from tests.helpers.unit.config_override import config_overrides_context
    from tests.unit_tests.services.test_model_billing_dependency_runtime import TENANT, runtime_facts

    facts = runtime_facts(monkeypatch, preferred="custom" if byok else None, custom_available=byok)
    row = next(row for row in gemini.profiles() if row["source_model"] == model)
    source = gemini.schema(row)
    stored = facts.query._records.stored_selection_snapshot(TENANT)
    stored = replace(
        stored,
        providers=tuple(replace(item, provider=gemini.SOURCE_PROVIDER) for item in stored.providers),
        preferences=tuple(replace(item, provider=gemini.SOURCE_PROVIDER) for item in stored.preferences),
        defaults=tuple(
            replace(item, provider=gemini.SOURCE_PROVIDER, model=model, model_type=source.model_type.value)
            for item in stored.defaults
        ),
    )
    monkeypatch.setattr(facts.query._records, "stored_selection_snapshot", lambda _: stored)
    binding = facts.bindings[0]
    binding.provider = gemini.SOURCE_PROVIDER
    binding.plugin_id = "langgenius/gemini"
    binding.plugin_unique_identifier = gemini.SOURCE_UID
    binding.version = "0.9.12"
    declaration = facts.declarations[0]
    declaration.provider = gemini.SOURCE_PROVIDER
    declaration.plugin_id = "langgenius/gemini"
    declaration.plugin_unique_identifier = gemini.SOURCE_UID
    declaration.declaration.provider = gemini.SOURCE_PROVIDER
    declaration.declaration.models = [source]
    declaration.declaration.supported_model_types = [source.model_type]
    hosting = facts.hosting.pop(SOURCE_PROVIDER)
    facts.hosting[gemini.SOURCE_PROVIDER] = hosting
    hosting.quotas[0].restrict_models = [RestrictModel(model=model, model_type=source.model_type)]
    original = {"google_api_key": "synthetic-original-system-never-forward"}
    hosting.credentials = original
    before = deepcopy(original)
    monkeypatch.setattr(
        "services.model_billing_dependency_runtime.migration_routing_state",
        lambda _: {
            "phase": "active",
            "persisted_model_billing_source": "tokener",
            "model_mapping_version": gemini.REVISION,
            "source_ownership": {},
        },
    )
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=gemini.registry(),
        TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=json.dumps(
            [
                {
                    "schema_version": 1,
                    "mapping_revision": gemini.REVISION,
                    "inventory_policy": "saved_system_dependencies_v2",
                }
            ]
        ),
    ):
        snapshot = facts.query.selection_snapshot(TENANT)
    provider = snapshot.providers[0]
    assert provider.trustworthy
    assert provider.provider == gemini.SOURCE_PROVIDER
    assert provider.source_plugin_unique_identifier == gemini.SOURCE_UID
    assert provider.system_enabled
    assert provider.preferred == ("custom" if byok else None)
    assert provider.custom_available is byok
    assert provider.quotas[0].models == ((source.model_type.value, model),)
    assert facts.calls == [("declarations", TENANT), ("bindings", TENANT)]
    assert original == before


def current_source_schemas() -> tuple[AIModelEntity, AIModelEntity]:
    document = json.loads(
        (Path(__file__).parent / "fixtures/model_billing_openai_provider110_profiles.json").read_text()
    )
    return (
        AIModelEntity.model_validate(document["profiles"][0]["source_catalog_schema"]),
        AIModelEntity.model_validate(document["profiles"][0]["source_schema"]),
    )


def full_variant_record() -> dict[str, object]:
    """Offline declared profiles; this helper is not live inference evidence."""
    record = variant_record()
    template = variants(record)[0]
    for selector in ("absent", "responses", "chat"):
        contract = _REVIEWED_CONTRACTS[0 if selector == "chat" else 1]
        variants(record).append(
            {
                **template,
                "variant_id": "openai110-" + selector,
                "source_plugin_uid": contract.source_plugin_unique_identifier,
                "source_settings": {
                    "protocol_selector": selector,
                    "source_base_is_set": False,
                    "request_metadata_enabled": False,
                },
                "source_schema_digest": contract.source_schema_digest,
                "source_runtime_schema_digest": contract.source_runtime_schema_digest,
                "source_profile_id": contract.profile_id,
                "parameter_adapter": {
                    "id": contract.adapter_id,
                    "revision": contract.algorithm_revision,
                    "rules_digest": contract.rules_digest,
                },
            }
        )
    return record


def full_official_variant_record() -> dict[str, object]:
    """A NEW revision: preserve all five old rows and append five official rows."""
    record = full_variant_record()
    record["mapping_revision"] = OFFICIAL_ROOT_REVISION
    template = variants(record)[0]
    for contract in (OFFICIAL042, *OFFICIAL110):
        selectors = (
            ("absent", "chat")
            if contract == OFFICIAL042
            else (("chat",) if "-chat-" in contract.profile_id else ("absent", "responses"))
        )
        for selector in selectors:
            variants(record).append(
                {
                    **template,
                    "variant_id": ("openai042" if contract == OFFICIAL042 else "openai110")
                    + "-official-root-"
                    + selector,
                    "source_plugin_uid": contract.source_plugin_unique_identifier,
                    "source_settings": {
                        "protocol_selector": selector,
                        "source_base_is_set": True,
                        "request_metadata_enabled": False,
                    },
                    "source_schema_digest": contract.source_schema_digest,
                    "source_runtime_schema_digest": contract.source_runtime_schema_digest,
                    "source_profile_id": contract.profile_id,
                    "parameter_adapter": {
                        "id": contract.adapter_id,
                        "revision": contract.algorithm_revision,
                        "rules_digest": contract.rules_digest,
                    },
                    "conformance_fixture_ids": ["exact-source-official-root-sdk-wire"],
                }
            )
    return record


def full_official_registry() -> list[dict[str, object]]:
    return [
        full_official_variant_record(),
        mapping(
            schema("text-embedding-3-small", ModelType.TEXT_EMBEDDING),
            revision=OFFICIAL_ROOT_REVISION,
            target="text-embedding-3-small",
        ),
    ]


def test_official_profiles_have_exact_lossless_source_json_not_placeholder_rules() -> None:
    document = json.loads(
        (Path(__file__).parent / "fixtures/model_billing_openai_official_root_profiles.json").read_text()
    )
    contracts = {item.profile_id: item for item in (OFFICIAL042, *OFFICIAL110)}
    assert len(document["profiles"]) == len(contracts) == 3
    for profile in document["profiles"]:
        contract = contracts[profile["profile_id"]]
        assert profile["source_endpoint_requirement"] == "https://api.openai.com"
        assert profile["source_settings"] == {"source_base_is_set": True, "request_metadata_enabled": False}
        assert (
            contract.rules_digest
            == "sha256:"
            + hashlib.sha256(
                json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            ).hexdigest()
        )
        assert profile["source_schema_digest"] == contract.source_schema_digest
        assert profile["source_runtime_schema_digest"] == contract.source_runtime_schema_digest


@pytest.mark.parametrize(
    ("version", "selector"),
    [("042", "absent"), ("042", "chat"), ("110", "absent"), ("110", "chat"), ("110", "responses")],
)
@pytest.mark.parametrize("official", [False, True])
def test_new_full_revision_selects_only_fresh_source_facts_and_matching_profiles(
    version: str, selector: str, official: bool
) -> None:
    source = build_inputs(runtime=True)["source_schema"] if version == "042" else current_source_schemas()[0]
    uid = (
        OFFICIAL042.source_plugin_unique_identifier
        if version == "042"
        else OFFICIAL110[0].source_plugin_unique_identifier
    )
    registry = source_mapping_revision(json.dumps([full_official_variant_record()]), OFFICIAL_ROOT_REVISION)
    fact = hosted_source_variant_fact(
        provider=IDENTITY[0],
        source_uid=uid,
        models=[source],
        credentials={
            "api_protocol": None if selector == "absent" else selector,
            "openai_api_base": "https://api.openai.com" if official else None,
        },
    )
    selected = resolve_source_mapping(registry, IDENTITY, source_uid=uid, fact=fact, schema=source)
    assert isinstance(selected, SelectedSourceVariant)
    assert selected.variant.variant_id == "openai" + version + ("-official-root-" if official else "-") + selector
    contract = restore_variant_source_contract(selected)
    assert ("official-root" in contract.profile_id) == official
    assert (
        build_source_adapter_contract(
            selected,
            source_provider=IDENTITY[0],
            source_plugin_unique_identifier=uid,
            source_schema=source,
            source_credentials=None,
        )
        == contract
    )
    assert registry.restore_selection(IDENTITY, selection_payload(selected).model_dump(mode="json")) == selected
    # Every declared row must restore prospectively even while the installed
    # source fact is False. These are target capability proofs, not source RPCs.
    assert len(registry.selected_prospective()) == 10
    assert all(restore_variant_source_contract(item) for item in registry.selected_prospective())


@pytest.mark.parametrize("official", [False, True])
def test_new_profile_cannot_be_relabelled_as_opposite_base_settings(official: bool) -> None:
    record = full_official_variant_record()
    record["variants"] = [
        row for row in variants(record) if section(row, "source_settings")["source_base_is_set"] is official
    ]
    for row in variants(record):
        section(row, "source_settings")["source_base_is_set"] = not official
    registry = source_mapping_revision(json.dumps([record]), OFFICIAL_ROOT_REVISION)
    for selected in registry.selected_prospective():
        with pytest.raises(ValueError, match="[Ss]ource|[Vv]ariant|[Ee]ndpoint"):
            restore_variant_source_contract(selected)


def test_historical_false_variant_json_and_revision_digests_are_unchanged() -> None:
    assert source_mapping_revision(json.dumps([variant_record()]), REVISION).digest == (
        "sha256:da190033b7d81c777fc43974262135d1a66d29428c10713a9c181cd967e9cdf8"
    )
    assert source_mapping_revision(json.dumps([full_variant_record()]), REVISION).digest == (
        "sha256:5a00d12934280b513c6903c15c04f540207ff5f769f1d28faee6f15812f0739d"
    )
    assert SourceVariantSettings(
        protocol_selector="absent", source_base_is_set=False, request_metadata_enabled=False
    ).model_dump_json() == (
        '{"protocol_selector":"absent","source_base_is_set":false,"request_metadata_enabled":false}'
    )


@pytest.mark.parametrize(
    "source_uid",
    [
        build_inputs(runtime=True)["source_plugin_unique_identifier"],
        _REVIEWED_CONTRACTS[0].source_plugin_unique_identifier,
    ],
)
@pytest.mark.parametrize(
    ("base", "expected"),
    [
        (None, "unset"),
        ("", "unset"),
        ("https://api.openai.com", "official_root"),
        ("https://api.openai.com/", "unreviewed"),
        ("https://api.openai.com/v1", "unreviewed"),
        ("https://api.openai.com:443", "unreviewed"),
        ("https://API.OPENAI.COM", "unreviewed"),
        ("http://api.openai.com", "unreviewed"),
        ("https://api.openai.com.evil.invalid", "unreviewed"),
        ("https://user:secret@api.openai.com", "unreviewed"),
        ("https://api.openai.com?secret=never-exported", "unreviewed"),
        ("https://api.openai.com#fragment", "unreviewed"),
        (" https://api.openai.com", "unreviewed"),
        (True, "unreviewed"),
        (False, "unreviewed"),
        (0, "unreviewed"),
        ({}, "unreviewed"),
    ],
)
def test_endpoint_classification_is_exact_not_url_normalization(source_uid: str, base: object, expected: str) -> None:
    assert source_endpoint_class(source_uid, base) == expected
    fact = hosted_source_variant_fact(
        provider=IDENTITY[0], source_uid=source_uid, models=[], credentials={"openai_api_base": base}
    )
    assert fact is not None
    assert fact.source_endpoint_class == expected
    context = source_variant_context(fact, provider=IDENTITY[0], source_uid=source_uid)
    assert (context is not None) == (expected != "unreviewed")
    assert "never-exported" not in repr(fact)
    assert "user:secret" not in repr(fact)


def test_official_root_requires_the_exact_source_archive_and_an_actual_dictionary() -> None:
    uid = build_inputs(runtime=True)["source_plugin_unique_identifier"]
    for unknown in ("unreviewed", uid + "changed"):
        fact = hosted_source_variant_fact(
            provider=IDENTITY[0],
            source_uid=unknown,
            models=[],
            credentials={"openai_api_base": "https://api.openai.com"},
        )
        assert fact is not None
        assert fact.source_endpoint_class == "unreviewed"
        assert source_variant_context(fact, provider=IDENTITY[0], source_uid=unknown) is None
    for missing in (None, list[object](), ""):
        assert hosted_source_variant_fact(provider=IDENTITY[0], source_uid=uid, models=[], credentials=missing) is None
    fact = hosted_source_variant_fact(
        provider=IDENTITY[0], source_uid=uid, models=[], credentials={"openai_api_base": "https://api.openai.com"}
    )
    assert fact is not None
    assert (
        source_variant_context(replace(fact, source_endpoint_class="unset"), provider=IDENTITY[0], source_uid=uid)
        is None
    )


@pytest.mark.parametrize("metadata", [True, False, 0, 1, "true", "unknown", {}, []])
def test_unknown_metadata_values_are_not_treated_as_reviewed_disabled(metadata: object) -> None:
    assert (
        hosted_source_variant_fact(
            provider=IDENTITY[0],
            source_uid=build_inputs(runtime=True)["source_plugin_unique_identifier"],
            models=[],
            credentials={"enable_request_metadata": metadata},
        )
        is None
    )


def test_global_registry_preserves_old_revision_model_and_bytes_when_new_v2_revision_exists() -> None:
    old = mapping(revision="old-v1")
    raw = json.dumps([old, variant_record()])
    original = mappings_for_revision(json.dumps([old]), "old-v1")
    selected = mappings_for_revision(raw, "old-v1")
    assert selected == original
    assert all(isinstance(item, ModelMapping) for item in selected.values())
    assert [item.model_dump_json() for item in selected.values()] == [
        item.model_dump_json() for item in original.values()
    ]
    with pytest.raises(ValueError, match="explicit saved"):
        mappings_for_revision(raw, REVISION)


def test_variant_pin_covers_complete_selected_revision_not_other_revisions() -> None:
    variant = variant_record()
    mixed_v1 = mapping(revision=REVISION)
    baseline = source_mapping_revision(json.dumps([variant, mixed_v1]), REVISION)
    appended = source_mapping_revision(
        json.dumps([mapping(revision="another-valid-revision"), mixed_v1, variant]), REVISION
    )
    assert baseline.digest == appended.digest
    variants(variant).reverse()
    assert source_mapping_revision(json.dumps([mixed_v1, variant]), REVISION).digest == baseline.digest
    section(mixed_v1, "target")["model"] = "changed-in-same-revision"
    assert source_mapping_revision(json.dumps([mixed_v1, variant]), REVISION).digest != baseline.digest


@pytest.mark.parametrize("selector", ["absent", "chat"])
def test_reviewed_source_variant_selects_by_uid_literal_settings_and_exact_catalog(selector: str) -> None:
    inputs = build_inputs(runtime=True)
    registry = source_mapping_revision(json.dumps([variant_record()]), REVISION)
    fact = hosted_source_variant_fact(
        provider=IDENTITY[0],
        source_uid=inputs["source_plugin_unique_identifier"],
        models=[inputs["source_schema"]],
        credentials={"api_protocol": None if selector == "absent" else "chat"},
    )
    selected = resolve_source_mapping(
        registry,
        IDENTITY,
        source_uid=inputs["source_plugin_unique_identifier"],
        fact=fact,
        schema=inputs["source_schema"],
    )
    assert isinstance(selected, SelectedSourceVariant)
    assert selected.variant.variant_id == "openai042-" + selector
    restored = registry.restore_selection(IDENTITY, selection_payload(selected).model_dump(mode="json"))
    assert restored == selected
    assert restore_variant_source_contract(selected).profile_id == "openai-042-chat-runtime-v2:gpt-4o-mini"


@pytest.mark.parametrize("change", ["uid", "protocol", "base", "metadata", "missing", "schema"])
def test_unknown_source_variant_facts_fail_closed(change: str) -> None:
    inputs = build_inputs(runtime=True)
    uid = (
        inputs["source_plugin_unique_identifier"] + "changed"
        if change == "uid"
        else inputs["source_plugin_unique_identifier"]
    )
    schema = inputs["source_schema"].model_copy(deep=True)
    fact = hosted_source_variant_fact(
        provider=IDENTITY[0],
        source_uid=uid,
        models=[schema],
        credentials={
            "api_protocol": "responses" if change == "protocol" else None,
            "openai_api_base": "https://never-exported.invalid" if change == "base" else None,
            "enable_request_metadata": "enabled" if change == "metadata" else None,
        },
    )
    if change == "missing":
        fact = None
    if change == "schema":
        schema.parameter_rules[0].max = 42
    with pytest.raises(ValueError, match="[Ss]ource|[Vv]ariant"):
        resolve_source_mapping(
            source_mapping_revision(json.dumps([variant_record()]), REVISION),
            IDENTITY,
            source_uid=uid,
            fact=fact,
            schema=schema,
        )


@pytest.mark.parametrize("flag", ["source_base_is_set", "request_metadata_enabled"])
def test_unreviewed_true042_v2_flags_cannot_gain_authority_even_when_the_row_matches(flag: str) -> None:
    inputs = build_inputs(runtime=True)
    record = variant_record()
    for variant in variants(record):
        section(variant, "source_settings")[flag] = True
    settings = {
        "protocol_selector": "absent",
        "source_base_is_set": False,
        "request_metadata_enabled": False,
        flag: True,
    }
    registry = source_mapping_revision(json.dumps([record]), REVISION)
    selected = registry.resolve(
        IDENTITY,
        context=SourceVariantContext(
            inputs["source_plugin_unique_identifier"], SourceVariantSettings.model_validate(settings)
        ),
        schema=inputs["source_schema"],
    )
    assert isinstance(selected, SelectedSourceVariant)
    with pytest.raises(ValueError, match="Unreviewed V2"):
        restore_variant_source_contract(selected)
    credentials = {
        "openai_api_base": "https://private.invalid" if flag == "source_base_is_set" else None,
        "enable_request_metadata": "enabled" if flag == "request_metadata_enabled" else None,
    }
    fact = hosted_source_variant_fact(
        provider=IDENTITY[0],
        source_uid=inputs["source_plugin_unique_identifier"],
        models=[inputs["source_schema"]],
        credentials=credentials,
    )
    with pytest.raises(ValueError, match="Unreviewed V2|Positive source variant"):
        resolve_source_mapping(
            registry,
            IDENTITY,
            source_uid=inputs["source_plugin_unique_identifier"],
            fact=fact,
            schema=inputs["source_schema"],
        )
    # The old V1 042 public protocol contract is intentionally not redefined.
    v1 = mapping(inputs["source_schema"], target=inputs["target_model"])
    v1["parameter_adapter"] = {
        "id": inputs["adapter_id"],
        "revision": inputs["adapter_revision"],
        "rules_digest": inputs["expected_rules_digest"],
    }
    assert (
        build_source_adapter_contract(
            ModelMapping.model_validate(v1),
            source_provider=IDENTITY[0],
            source_plugin_unique_identifier=inputs["source_plugin_unique_identifier"],
            source_schema=inputs["source_schema"],
            source_credentials=credentials,
        )
        is not None
    )


@pytest.mark.parametrize(
    "change",
    ["duplicate_selector", "duplicate_id", "mixed_logical", "bad_bool", "extra_setting", "runtime", "wrong_family"],
)
def test_versioned_registry_rejects_ambiguous_or_open_contracts(change: str) -> None:
    record = variant_record()
    first, second = variants(record)
    records = [record]
    if change == "duplicate_selector":
        second["source_settings"] = deepcopy(first["source_settings"])
    elif change == "duplicate_id":
        second["variant_id"] = first["variant_id"]
    elif change == "mixed_logical":
        records.append(mapping(build_inputs(runtime=True)["source_schema"], revision=REVISION))
    elif change == "bad_bool":
        section(first, "source_settings")["source_base_is_set"] = "false"
    elif change == "extra_setting":
        section(first, "source_settings")["api_key"] = "never-accepted"
    elif change == "runtime":
        first.pop("source_runtime_schema_digest")
    else:
        section(first, "parameter_adapter")["id"] = "arbitrary_plugin_code"
    with pytest.raises(ValueError, match="validation|Duplicate"):
        source_mapping_revision(json.dumps(records), REVISION)


def test_new_adapter_family_cannot_be_encoded_as_old_v1_parameter_adapter() -> None:
    record = mapping()
    section(record, "parameter_adapter")["id"] = "openai_provider110_source_v1"
    with pytest.raises(ValueError, match="validation"):
        mappings_for_revision(json.dumps([record]), "old")


@pytest.mark.parametrize("change", ["valid", "missing", "rules", "target"])
def test_v2_evidence_guard_also_validates_reviewed_v1_042_source_contract(change: str) -> None:
    inputs = build_inputs(runtime=True)
    record = mapping(inputs["source_schema"], target=inputs["target_model"])
    record["parameter_adapter"] = {
        "id": inputs["adapter_id"],
        "revision": inputs["adapter_revision"],
        "rules_digest": inputs["expected_rules_digest"],
    }
    rule = ModelMapping.model_validate(record)
    contract = build_source_adapter_contract(
        rule,
        source_provider=IDENTITY[0],
        source_plugin_unique_identifier=inputs["source_plugin_unique_identifier"],
        source_schema=inputs["source_schema"],
        source_credentials={},
    )
    assert isinstance(contract, SourceParameterContract)
    if change == "missing":
        contract = None
    elif change == "rules":
        contract = replace(contract, rules_digest="sha256:" + "f" * 64)

    def validate() -> None:
        validate_frozen_mapping_evidence(
            rule,
            provider=IDENTITY[0],
            model=IDENTITY[2],
            model_type=ModelType.LLM,
            target_model="wrong" if change == "target" else rule.target.model,
            operations=tuple(rule.operations),
            source_contract=contract,
            tts_contract=None,
        )

    if change == "valid":
        validate()
    else:
        with pytest.raises(ValueError, match="[Ss]ource|[Ff]rozen"):
            validate()


@pytest.mark.parametrize("admitted", [False, True])
@pytest.mark.parametrize("known_source", [False, True])
def test_additional_shared_availability_requires_optin_and_reviewed_source_without_throwing(
    admitted: bool, known_source: bool
) -> None:
    inputs = build_inputs(runtime=True)
    source = inputs["source_schema"]
    hosting = HostingProvider(enabled=True, quota_unit=QuotaUnit.CREDITS, quotas=[PaidHostingQuota()])
    uid = inputs["source_plugin_unique_identifier"] if known_source else "unreviewed"
    fact = hosted_source_variant_fact(provider=IDENTITY[0], source_uid=uid, models=[source], credentials={})
    result = additional_hosted_availability(
        provider=IDENTITY[0],
        hosting=hosting,
        installed_models=[source],
        original_quotas=[],
        raw_registry=json.dumps([variant_record()]),
        revision=REVISION,
        published_balance=True,
        source_uid=uid,
        source_fact=fact,
        allow_source_variants=admitted,
    )
    assert (result is not None) == (admitted and known_source)


def test_selected_variant_inventory_record_rejects_tampered_digest_or_selector() -> None:
    registry = source_mapping_revision(json.dumps([variant_record()]), REVISION)
    selected = registry.resolve(
        IDENTITY,
        context=SourceVariantContext(
            build_inputs(runtime=True)["source_plugin_unique_identifier"],
            SourceVariantSettings(protocol_selector="absent", source_base_is_set=False, request_metadata_enabled=False),
        ),
    )
    assert isinstance(selected, SelectedSourceVariant)
    payload = selection_payload(selected).model_dump(mode="json")
    payload["registry_digest"] = "sha256:" + "f" * 64
    with pytest.raises(ValueError, match="Frozen"):
        registry.restore_selection(IDENTITY, payload)


@pytest.mark.parametrize(
    ("kind", "unit", "limit"),
    [
        (ProviderQuotaType.FREE, QuotaUnit.CREDITS, 100),
        (ProviderQuotaType.PAID, QuotaUnit.TOKENS, 100),
        (ProviderQuotaType.PAID, QuotaUnit.CREDITS, -1),
    ],
)
def test_unknown_managed_source_variant_keeps_original_independent_owner(
    kind: ProviderQuotaType, unit: QuotaUnit, limit: int
) -> None:
    original = QuotaConfiguration(
        quota_type=kind,
        quota_unit=unit,
        quota_limit=limit,
        quota_used=7,
        is_valid=True,
    )
    result = additional_hosted_availability(
        provider=IDENTITY[0],
        hosting=HostingProvider(enabled=True, quota_unit=QuotaUnit.CREDITS, quotas=[PaidHostingQuota()]),
        installed_models=[build_inputs(runtime=True)["source_schema"]],
        original_quotas=[original],
        raw_registry=json.dumps([variant_record()]),
        revision=REVISION,
        published_balance=True,
        source_uid="unknown",
        allow_source_variants=True,
        preserve_independent_units=True,
    )
    assert result is not None
    assert result.current_quota_type == kind
    assert result.quotas == [original]


def test_gpt55_and_mini_prospective_profiles_restore_without_inventing_an_embedding_route() -> None:
    registry = source_mapping_revision(json.dumps(full_gpt55_registry()), GPT55_REVISION)
    assert set(registry.declarations) == {
        (GPT55_IDENTITY[0], ModelType.LLM, "gpt-4o-mini"),
        GPT55_IDENTITY,
    }
    assert registry.has_variants
    selected = registry.selected_prospective()
    assert len(selected) == 16
    assert len([item for item in selected if item.source.model == "gpt-5.5"]) == 6
    for item in selected:
        contract = restore_variant_source_contract(item)
        assert item.registry_digest == registry.digest
        assert contract.source_model == contract.target_model == item.source.model
        assert (
            registry.restore_selection(
                (GPT55_IDENTITY[0], ModelType.LLM, item.source.model), selection_payload(item).model_dump(mode="json")
            )
            == item
        )
    with pytest.raises(ValueError, match="Unmapped"):
        registry.resolve((GPT55_IDENTITY[0], ModelType.TEXT_EMBEDDING, "text-embedding-3-small"), context=None)


@pytest.mark.parametrize("selector", ["absent", "chat", "responses"])
@pytest.mark.parametrize("official", [False, True])
def test_fresh_gpt55_fact_selects_its_protocol_and_exact_profile(selector: str, official: bool) -> None:
    catalog, runtime = gpt55_schemas()
    registry = source_mapping_revision(json.dumps(full_gpt55_registry()), GPT55_REVISION)
    credentials: dict[str, object] = {"api_key": "NEVER_FORWARD_ORIGINAL_SOURCE"}
    if selector != "absent":
        credentials["api_protocol"] = selector
    if official:
        credentials["openai_api_base"] = "https://api.openai.com"
    fact = hosted_source_variant_fact(
        provider=GPT55_IDENTITY[0], source_uid=OPENAI_PROVIDER042_SOURCE_UID, models=[catalog], credentials=credentials
    )
    selected = resolve_source_mapping(
        registry, GPT55_IDENTITY, source_uid=OPENAI_PROVIDER042_SOURCE_UID, fact=fact, schema=catalog
    )
    assert isinstance(selected, SelectedSourceVariant)
    assert selected.variant.variant_id == "openai042-gpt55-" + ("official-root-" if official else "") + selector
    contract = restore_variant_source_contract(selected)
    protocol = "responses" if selector == "responses" else "chat"
    assert contract.profile_id == (
        "openai-042-" + protocol + ("-official-root" if official else "") + "-runtime-v1:gpt-5.5"
    )
    assert contract.adapter_id == "openai_provider042_source_v1"
    assert contract.source_runtime_schema_digest == profile_digest(runtime.model_dump(mode="json"))
    assert contract.source_schema_digest == profile_digest(catalog.model_dump(mode="json"))
    assert contract.source_schema_digest != contract.source_runtime_schema_digest
    assert (
        build_source_adapter_contract(
            selected,
            source_provider=GPT55_IDENTITY[0],
            source_plugin_unique_identifier=OPENAI_PROVIDER042_SOURCE_UID,
            source_schema=catalog,
            source_credentials=credentials,
        )
        == contract
    )
    marker = source_parameter_marker(
        contract,
        source_provider=GPT55_IDENTITY[0],
        source_model=GPT55_IDENTITY[2],
        model_type=GPT55_IDENTITY[1],
        target_model=GPT55_IDENTITY[2],
    )
    assert marker["profile_id"] == contract.profile_id
    assert "NEVER_FORWARD" not in json.dumps(marker)
    validate_frozen_mapping_evidence(
        selected,
        provider=GPT55_IDENTITY[0],
        model=GPT55_IDENTITY[2],
        model_type=GPT55_IDENTITY[1],
        target_model=GPT55_IDENTITY[2],
        operations=tuple(selected.operations),
        source_contract=contract,
        tts_contract=None,
    )


@pytest.mark.parametrize(
    ("version", "selector"),
    [("042", "absent"), ("042", "chat"), ("110", "absent"), ("110", "chat"), ("110", "responses")],
)
@pytest.mark.parametrize("official", [False, True])
def test_new_sibling_does_not_relabel_any_existing_mini_variant(version: str, selector: str, official: bool) -> None:
    catalog = build_inputs(runtime=True)["source_schema"] if version == "042" else current_source_schemas()[0]
    uid = (
        OPENAI_PROVIDER042_SOURCE_UID
        if version == "042"
        else CURRENT_SOURCE_CONTRACTS[0].source_plugin_unique_identifier
    )
    fact = hosted_source_variant_fact(
        provider=GPT55_IDENTITY[0],
        source_uid=uid,
        models=[catalog],
        credentials={
            "api_protocol": None if selector == "absent" else selector,
            "openai_api_base": "https://api.openai.com" if official else None,
        },
    )
    selected = resolve_source_mapping(
        source_mapping_revision(json.dumps(full_gpt55_registry()), GPT55_REVISION),
        (GPT55_IDENTITY[0], ModelType.LLM, "gpt-4o-mini"),
        source_uid=uid,
        fact=fact,
        schema=catalog,
    )
    assert isinstance(selected, SelectedSourceVariant)
    assert selected.variant.variant_id == "openai" + version + ("-official-root-" if official else "-") + selector
    assert restore_variant_source_contract(selected).adapter_id != "openai_provider042_source_v1"


def test_full_revision_digest_changes_for_an_unselected_sibling_but_not_an_unrelated_revision() -> None:
    records = full_gpt55_registry()
    registry = source_mapping_revision(json.dumps(records), GPT55_REVISION)
    frozen = registry.selected_prospective()[0]
    payload = selection_payload(frozen).model_dump(mode="json")
    reordered = deepcopy(records)
    reordered.reverse()
    for record in reordered:
        variants(record).reverse()
    assert source_mapping_revision(json.dumps(reordered), GPT55_REVISION).digest == registry.digest
    assert source_mapping_revision(json.dumps([mapping(revision="unrelated-v1"), *records]), GPT55_REVISION).digest == (
        registry.digest
    )
    changed = deepcopy(records)
    section(variants(changed[1])[-1], "parameter_adapter")["rules_digest"] = profile_digest({"unreviewed": "changed"})
    changed_registry = source_mapping_revision(json.dumps(changed), GPT55_REVISION)
    assert changed_registry.digest != registry.digest
    with pytest.raises(ValueError, match="Frozen source variant changed"):
        changed_registry.restore_selection((GPT55_IDENTITY[0], frozen.source.model_type, frozen.source.model), payload)


def test_appending_gpt55_revision_preserves_old_v1_and_v2_bytes_and_digest() -> None:
    old = variant_record()
    legacy = mapping(revision="legacy-v1")
    old_registry = source_mapping_revision(json.dumps([old]), REVISION)
    legacy_registry = source_mapping_revision(json.dumps([legacy]), "legacy-v1")
    combined = json.dumps([legacy, old, *full_gpt55_registry()])
    restored_old = source_mapping_revision(combined, REVISION)
    restored_legacy = source_mapping_revision(combined, "legacy-v1")
    assert restored_old.digest == old_registry.digest
    assert restored_legacy.digest == legacy_registry.digest
    for before, after in ((old_registry, restored_old), (legacy_registry, restored_legacy)):
        assert [item.model_dump_json() for item in before.declarations.values()] == [
            item.model_dump_json() for item in after.declarations.values()
        ]
    assert all(isinstance(item, ModelMapping) for item in restored_legacy.declarations.values())
    assert all(isinstance(item, SourceVariantMapping) for item in restored_old.declarations.values())


@pytest.mark.parametrize(
    "change", ["uid110", "uid_unknown", "metadata_enabled", "metadata_unknown", "metadata_boolean", "selector", "base"]
)
def test_unreviewed_actual_source_facts_do_not_gain_gpt55_authority(change: str) -> None:
    catalog, _runtime = gpt55_schemas()
    uid = OPENAI_PROVIDER042_SOURCE_UID
    credentials: dict[str, object] = {}
    if change == "uid110":
        uid = CURRENT_SOURCE_CONTRACTS[0].source_plugin_unique_identifier
    elif change == "uid_unknown":
        uid += "changed"
    elif change.startswith("metadata"):
        credentials["enable_request_metadata"] = {
            "metadata_enabled": "enabled",
            "metadata_unknown": "unknown",
            "metadata_boolean": False,
        }[change]
    elif change == "selector":
        credentials["api_protocol"] = "default_chat"
    else:
        credentials["openai_api_base"] = "https://api.openai.com/v1"
    fact = hosted_source_variant_fact(
        provider=GPT55_IDENTITY[0], source_uid=uid, models=[catalog], credentials=credentials
    )
    with pytest.raises(ValueError, match="[Ss]ource|[Vv]ariant"):
        resolve_source_mapping(
            source_mapping_revision(json.dumps(full_gpt55_registry()), GPT55_REVISION),
            GPT55_IDENTITY,
            source_uid=uid,
            fact=fact,
            schema=catalog,
        )


@pytest.mark.parametrize("change", ["mini_family", "110_family", "model", "target", "mode"])
def test_declaration_cannot_mix_gpt55_with_another_model_or_adapter_family(change: str) -> None:
    record = gpt55_variant_record()
    if change in {"mini_family", "110_family"}:
        for row in variants(record):
            section(row, "parameter_adapter")["id"] = (
                "openai_chat_source_v1" if change == "mini_family" else "openai_provider110_source_v1"
            )
    elif change == "model":
        section(record, "source")["model"] = "gpt-5.5-2026-04-23"
    elif change == "target":
        section(variants(record)[0], "target")["model"] = "gpt-4o-mini"
    else:
        section(record, "source")["mode"] = "responses"
    with pytest.raises(ValidationError, match="Invalid bounded source variant"):
        source_mapping_revision(json.dumps([record]), GPT55_REVISION)


@pytest.mark.parametrize("change", ["uid110", "metadata", "revision", "profile_protocol", "runtime_schema"])
def test_matching_prospective_row_is_not_authority_without_its_exact_new042_contract(change: str) -> None:
    record = gpt55_variant_record()
    row = variants(record)[0]
    record["variants"] = [row]
    if change == "uid110":
        row["source_plugin_uid"] = CURRENT_SOURCE_CONTRACTS[0].source_plugin_unique_identifier
    elif change == "metadata":
        section(row, "source_settings")["request_metadata_enabled"] = True
    elif change == "revision":
        section(row, "parameter_adapter")["revision"] = "unreviewed"
    elif change == "profile_protocol":
        section(row, "source_settings")["protocol_selector"] = "responses"
    else:
        row["source_runtime_schema_digest"] = row["source_schema_digest"]
    registry = source_mapping_revision(json.dumps([record]), GPT55_REVISION)
    selected = next(item for item in registry.selected_prospective() if item.variant.variant_id == row["variant_id"])
    with pytest.raises(ValueError, match="[Ss]ource|[Vv]ariant|OpenAI"):
        restore_variant_source_contract(selected)


def test_all_twenty_eight_variants_restore_under_one_complete_revision() -> None:
    registry = source_mapping_revision(json.dumps(full_embedding_registry()), EMBEDDING_REVISION)
    assert len(registry.declarations) == 5
    selected = registry.selected_prospective()
    assert len(selected) == 28
    assert sum(isinstance(item, SelectedEmbeddingSourceVariant) for item in selected) == 12
    for item in selected:
        assert restore_variant_source_contract(item).source_model == item.source.model
        payload = selection_payload(item).model_dump(mode="json")
        assert (payload.get("schema_version") == 3) == isinstance(item, SelectedEmbeddingSourceVariant)
        assert registry.restore_selection((SOURCE_PROVIDER, item.source.model_type, item.source.model), payload) == item


@pytest.mark.parametrize("model", EMBEDDING_MODELS)
@pytest.mark.parametrize("version", ["042", "110"])
@pytest.mark.parametrize("endpoint", ["unset", "official_root"])
@pytest.mark.parametrize("rawflag", [None, "enabled", "unknown", True, 0, {}, []])
def test_embedding_effective_fact_does_not_rewrite_or_interpret_ignored_source_flags(
    model: str, version: str, endpoint: str, rawflag: object
) -> None:
    profile = next(p for p in embedding_profiles() if (p["source_model"], p["source_version"]) == (model, version))
    uid = profile["source_plugin_uid"]
    catalog, _ = embedding_schemas(model, version)
    original = {
        "api_key": "ORIGINAL_SOURCE_NEVER_FORWARD",
        "api_protocol": rawflag,
        "enable_request_metadata": rawflag,
        "openai_api_base": "https://api.openai.com" if endpoint == "official_root" else None,
    }
    before = deepcopy(original)
    fact = hosted_embedding_source_fact(
        provider=SOURCE_PROVIDER, source_uid=uid, models=[catalog], credentials=original
    )
    selected = resolve_source_mapping(
        source_mapping_revision(json.dumps(full_embedding_registry()), EMBEDDING_REVISION),
        (SOURCE_PROVIDER, ModelType.TEXT_EMBEDDING, model),
        source_uid=uid,
        fact=hosted_source_variant_fact(
            provider=SOURCE_PROVIDER, source_uid=uid, models=[catalog], credentials=original
        ),
        embedding_fact=fact,
        schema=catalog,
    )
    assert isinstance(selected, SelectedEmbeddingSourceVariant)
    assert selected.variant.source_settings.source_endpoint_class == endpoint
    assert selected.variant.source_settings.request_metadata_behavior == "not_used"
    contract = build_source_adapter_contract(
        selected,
        source_provider=SOURCE_PROVIDER,
        source_plugin_unique_identifier=uid,
        source_schema=catalog,
        source_credentials=original,
    )
    assert contract == restore_variant_source_contract(selected)
    assert isinstance(contract, SourceParameterContract)
    marker = source_parameter_marker(
        contract,
        source_provider=SOURCE_PROVIDER,
        source_model=model,
        model_type=ModelType.TEXT_EMBEDDING,
        target_model=model,
    )
    assert len(marker) == 6
    assert "ORIGINAL_SOURCE_NEVER_FORWARD" not in json.dumps(marker)
    validate_frozen_mapping_evidence(
        selected,
        provider=SOURCE_PROVIDER,
        model=model,
        model_type=ModelType.TEXT_EMBEDDING,
        target_model=model,
        operations=tuple(selected.operations),
        source_contract=contract,
        tts_contract=None,
    )
    assert original == before


@pytest.mark.parametrize("settings", [None, "malformed", [], False])
def test_no_original_dictionary_never_becomes_a_positive_embedding_fact(settings: object) -> None:
    profile = embedding_profiles()[0]
    catalog, _ = embedding_schemas(EMBEDDING_MODELS[0])
    assert (
        hosted_embedding_source_fact(
            provider=SOURCE_PROVIDER, source_uid=profile["source_plugin_uid"], models=[catalog], credentials=settings
        )
        is None
    )
    with pytest.raises(ValueError, match="Positive source variant facts required"):
        resolve_source_mapping(
            source_mapping_revision(json.dumps(full_embedding_registry()), EMBEDDING_REVISION),
            (SOURCE_PROVIDER, ModelType.TEXT_EMBEDDING, EMBEDDING_MODELS[0]),
            source_uid=profile["source_plugin_uid"],
            fact=None,
            embedding_fact=None,
            schema=catalog,
        )


@pytest.mark.parametrize(
    "base", ["https://api.openai.com/v1", "https://api.openai.com/", "https://custom.invalid", False, {}, []]
)
def test_unknown_or_custom_source_endpoint_does_not_reuse_official_profile(base: object) -> None:
    profile = embedding_profiles()[0]
    catalog, _ = embedding_schemas(EMBEDDING_MODELS[0])
    fact = hosted_embedding_source_fact(
        provider=SOURCE_PROVIDER,
        source_uid=profile["source_plugin_uid"],
        models=[catalog],
        credentials={"openai_api_base": base},
    )
    with pytest.raises(ValueError, match="Positive source variant facts required"):
        resolve_source_mapping(
            source_mapping_revision(json.dumps(full_embedding_registry()), EMBEDDING_REVISION),
            (SOURCE_PROVIDER, ModelType.TEXT_EMBEDDING, EMBEDDING_MODELS[0]),
            source_uid=profile["source_plugin_uid"],
            fact=None,
            embedding_fact=fact,
            schema=catalog,
        )


@pytest.mark.parametrize("change", ["profile", "runtime", "rules", "uid", "fact_catalog", "fact_uid"])
def test_v3_has_no_identity_or_another_source_profile_fallback(change: str) -> None:
    records = full_embedding_registry()
    profile = embedding_profiles()[0]
    uid = profile["source_plugin_uid"]
    catalog, _ = embedding_schemas(EMBEDDING_MODELS[0])
    fact = hosted_embedding_source_fact(provider=SOURCE_PROVIDER, source_uid=uid, models=[catalog], credentials={})
    assert fact is not None
    if change == "fact_catalog":
        fact = replace(fact, catalog_schema_digests=())
    elif change == "fact_uid":
        fact = replace(fact, plugin_unique_identifier=uid + "unreviewed")
    else:
        row = variants(records[2])[0]
        if change == "rules":
            section(row, "parameter_adapter")["rules_digest"] = "sha256:" + "a" * 64
        elif change == "runtime":
            row["source_runtime_schema_digest"] = "sha256:" + "a" * 64
        elif change == "uid":
            row["source_plugin_uid"] = uid + "unreviewed"
        else:
            row["source_profile_id"] = "unreviewed"
    with pytest.raises(ValueError, match="source|Source|Embedding"):
        resolve_source_mapping(
            source_mapping_revision(json.dumps(records), EMBEDDING_REVISION),
            (SOURCE_PROVIDER, ModelType.TEXT_EMBEDDING, EMBEDDING_MODELS[0]),
            source_uid=uid,
            fact=None,
            embedding_fact=fact,
            schema=catalog,
        )


def test_v3_sibling_digest_is_complete_and_old_v1_v2_bytes_are_unchanged() -> None:
    records = full_embedding_registry()
    raw = json.dumps(records)
    registry = source_mapping_revision(raw, EMBEDDING_REVISION)
    first = registry.selected_prospective()[0]
    payload = selection_payload(first).model_dump(mode="json")
    old = variant_record()
    legacy = mapping(revision="old-identity-only")
    old_raw = json.dumps([legacy, old])
    combined = json.dumps([*records, legacy, old])
    assert source_mapping_revision(combined, REVISION).digest == source_mapping_revision(old_raw, REVISION).digest
    for revision in (REVISION, "old-identity-only"):
        assert [d.model_dump_json() for d in source_mapping_revision(combined, revision).declarations.values()] == [
            d.model_dump_json() for d in source_mapping_revision(old_raw, revision).declarations.values()
        ]
    assert source_mapping_revision(combined, EMBEDDING_REVISION).digest == registry.digest
    reversed_records = deepcopy(records)
    reversed_records.reverse()
    for item in reversed_records:
        variants(item).reverse()
    assert source_mapping_revision(json.dumps(reversed_records), EMBEDDING_REVISION).digest == registry.digest
    drifted = deepcopy(records)
    variants(drifted[-1]).pop()
    new_registry = source_mapping_revision(json.dumps(drifted), EMBEDDING_REVISION)
    assert new_registry.digest != registry.digest
    with pytest.raises(ValueError, match="Frozen source variant changed"):
        new_registry.restore_selection((SOURCE_PROVIDER, first.source.model_type, first.source.model), payload)
    # Logical duplicates remain illegal even when one row has legacy shape.
    catalog, _ = embedding_schemas(EMBEDDING_MODELS[0])
    with pytest.raises(ValueError, match="Duplicate source within revision"):
        source_mapping_revision(
            json.dumps([*records, mapping(catalog, revision=EMBEDDING_REVISION, target=EMBEDDING_MODELS[0])]),
            EMBEDDING_REVISION,
        )
    llm = next(s for s in registry.selected_prospective() if isinstance(s, SelectedSourceVariant))
    embedding = next(s for s in registry.selected_prospective() if isinstance(s, SelectedEmbeddingSourceVariant))
    with pytest.raises(ValidationError):
        registry.restore_selection(
            (SOURCE_PROVIDER, llm.source.model_type, llm.source.model),
            selection_payload(embedding).model_dump(mode="json"),
        )


@pytest.mark.parametrize("version", ["042", "110"])
@pytest.mark.parametrize("source_settings", ["valid", "custom", "missing"])
@pytest.mark.parametrize("byok", [False, True])
def test_saved_dependency_selection_uses_the_same_independent_embedding_fact(
    version: str, source_settings: str, byok: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.entities.provider_entities import RestrictModel
    from tests.helpers.unit.config_override import config_overrides_context
    from tests.unit_tests.services.test_model_billing_dependency_runtime import TENANT, runtime_facts

    facts = runtime_facts(monkeypatch, preferred="custom" if byok else None, custom_available=byok)
    catalog, _ = embedding_schemas(EMBEDDING_MODELS[0], version)
    profile = next(
        p for p in embedding_profiles() if (p["source_model"], p["source_version"]) == (EMBEDDING_MODELS[0], version)
    )
    uid = profile["source_plugin_uid"]
    facts.bindings[0].plugin_unique_identifier = uid
    facts.declarations[0].plugin_unique_identifier = uid
    facts.declarations[0].declaration.models = [catalog]
    facts.declarations[0].declaration.supported_model_types = [ModelType.TEXT_EMBEDDING]
    hosting = facts.hosting[SOURCE_PROVIDER]
    hosting.quotas[0].restrict_models = [RestrictModel(model=EMBEDDING_MODELS[0], model_type=ModelType.TEXT_EMBEDDING)]
    original: dict[str, object] = {
        "api_key": "ORIGINAL_SYSTEM_NEVER_FORWARD",
        "api_protocol": {"ignored": True},
        "enable_request_metadata": "enabled",
        "openai_api_base": "https://api.openai.com" if source_settings == "valid" else "https://custom.invalid",
    }
    before = deepcopy(original)
    hosting.credentials = None if source_settings == "missing" else original
    monkeypatch.setattr(
        "services.model_billing_dependency_runtime.migration_routing_state",
        lambda _: {
            "phase": "active",
            "persisted_model_billing_source": "tokener",
            "model_mapping_version": EMBEDDING_REVISION,
            "source_ownership": {},
        },
    )
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps(full_embedding_registry()),
        TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=json.dumps(
            [
                {
                    "schema_version": 1,
                    "mapping_revision": EMBEDDING_REVISION,
                    "inventory_policy": "saved_system_dependencies_v2",
                }
            ]
        ),
    ):
        snapshot = facts.query.selection_snapshot(TENANT)
    provider = snapshot.providers[0]
    assert provider.trustworthy
    assert provider.source_plugin_unique_identifier == uid
    assert provider.system_enabled == (source_settings == "valid")
    assert provider.preferred == ("custom" if byok else None)
    assert provider.custom_available is byok
    if source_settings == "valid":
        assert provider.quotas[0].models == (("text-embedding", EMBEDDING_MODELS[0]),)
    assert original == before
    assert facts.calls == [("declarations", TENANT), ("bindings", TENANT)]


def test_append_only_daemon_revision_keeps_sdk_profiles_and_old_selected_revision_bytes() -> None:
    old = full_embedding_registry()
    fresh = full_daemon_registry()
    old_registry = source_mapping_revision(json.dumps(old), EMBEDDING_REVISION)
    combined = json.dumps([*old, *fresh])
    assert source_mapping_revision(combined, EMBEDDING_REVISION).digest == old_registry.digest
    assert [
        r.model_dump_json() for r in source_mapping_revision(combined, EMBEDDING_REVISION).declarations.values()
    ] == [r.model_dump_json() for r in old_registry.declarations.values()]
    new_registry = source_mapping_revision(combined, DAEMON_REVISION)
    selected = new_registry.selected_prospective()
    assert len(selected) == 28
    assert len(new_registry.declarations) == 5
    for item in selected:
        restored = restore_variant_source_contract(item)
        assert item.target.minimum_plugin_version == "0.4.3-dev13"
        if item.source.model == "gpt-5.5":
            assert restored.algorithm_revision == "2"
            assert "-daemon-runtime-v1:" in restored.profile_id
            assert (
                restored.source_runtime_schema_digest
                == "sha256:4fc3c5dbd760487f02c45818ff75ddc97e778c488837441e32e85220f11e33ae"
            )
        assert (
            new_registry.restore_selection(
                (SOURCE_PROVIDER, item.source.model_type, item.source.model),
                selection_payload(item).model_dump(mode="json"),
            )
            == item
        )


@pytest.mark.parametrize("change", ["sdk_runtime_digest", "old_profile", "old_rules", "old_revision"])
def test_daemon_revision_cannot_be_downgraded_to_the_old_direct_sdk_projection(change: str) -> None:
    old = full_embedding_registry()
    fresh = full_daemon_registry()
    old_row = variants(old[1])[0]
    row = variants(fresh[1])[0]
    if change == "sdk_runtime_digest":
        row["source_runtime_schema_digest"] = old_row["source_runtime_schema_digest"]
    elif change == "old_profile":
        row["source_profile_id"] = old_row["source_profile_id"]
    elif change == "old_rules":
        section(row, "parameter_adapter")["rules_digest"] = section(old_row, "parameter_adapter")["rules_digest"]
    else:
        section(row, "parameter_adapter")["revision"] = "1"
    catalog, _ = gpt55_daemon_schemas()
    fact = hosted_source_variant_fact(
        provider=SOURCE_PROVIDER, source_uid=OPENAI_PROVIDER042_SOURCE_UID, models=[catalog], credentials={}
    )
    with pytest.raises(ValueError, match="[Ss]ource|profile|OpenAI"):
        resolve_source_mapping(
            source_mapping_revision(json.dumps(fresh), DAEMON_REVISION),
            GPT55_IDENTITY,
            source_uid=OPENAI_PROVIDER042_SOURCE_UID,
            fact=fact,
            schema=catalog,
        )


class _CreditLLMProfile(TypedDict):
    profile_id: str
    source_version: str
    source_model: str
    target_model: str
    source_plugin_uid: str
    source_schema_digest: str
    source_runtime_schema_digest: str
    source_sdk_core_schema_digest: str
    source_codec_schema_digest: str
    source_endpoint_class: str
    source_settings: dict[str, bool]
    source_schema: dict[str, object]
    source_daemon_schema: dict[str, object]
    source_codec_schema: dict[str, object]
    supported_protocol_selectors: list[str]
    adapter_id: str
    adapter_revision: str
    protocol: str
    codec_rules: dict[str, object]
    operations: list[str]


class _CreditLLMSourceRow(TypedDict):
    source_version: str
    source_model: str
    source_plugin_uid: str
    source_schema_status: str
    source_schema_digest: str
    daemon_runtime_schema_digest: str
    core_runtime_schema_digest: str
    source_catalog_schema: dict[str, object]
    source_catalog_raw_schema: dict[str, object]
    source_daemon_schema: dict[str, object]
    source_daemon_raw_schema: dict[str, object]
    source_schema: dict[str, object]
    source_codec_schema: dict[str, object]


def _credit_llm_unpack(name: str) -> dict[str, object]:
    packet = json.loads((Path(__file__).parent / "fixtures" / name).read_bytes())
    raw = gzip.decompress(base64.b64decode(packet["payload_base64"], validate=True))
    assert hashlib.sha256(raw).hexdigest() == packet["raw_sha256"]
    document = json.loads(raw)
    assert isinstance(document, dict)
    return document


_CREDIT_LLM_REVISION = "positive-credit-openai-family-new-v1"
_CREDIT_LLM_PROFILES = cast(
    list[_CreditLLMProfile], _credit_llm_unpack("model_billing_openai_credit_llm_profiles.packed.json")["profiles"]
)
_CREDIT_LLM_SOURCE_ROWS = {
    (row["source_version"], row["source_model"]): row
    for row in cast(
        list[_CreditLLMSourceRow],
        _credit_llm_unpack("model_billing_openai_credit_llm_source_matrix.packed.json")["rows"],
    )
    if row["source_schema_status"] == "source_sdk_schema_positive"
}
_CREDIT_LLM_SELECTOR_CASES = [
    (index, selector)
    for index, profile in enumerate(_CREDIT_LLM_PROFILES)
    for selector in profile["supported_protocol_selectors"]
]


def _credit_llm_catalog(index: int) -> AIModelEntity:
    profile = _CREDIT_LLM_PROFILES[index]
    row = _CREDIT_LLM_SOURCE_ROWS[(profile["source_version"], profile["source_model"])]
    return AIModelEntity.model_validate(row["source_catalog_schema"])


def _credit_llm_record(index: int, selector: str) -> dict[str, object]:
    profile = _CREDIT_LLM_PROFILES[index]
    template = mapping(_credit_llm_catalog(index), revision=_CREDIT_LLM_REVISION, target=profile["target_model"])
    target = section(template, "target")
    target["minimum_plugin_version"] = "0.4.3-dev14"
    return {
        "schema_version": 2,
        "mapping_revision": _CREDIT_LLM_REVISION,
        "source": template["source"],
        "settlement_owner": "shared_credit_pool",
        "pool_types": ["paid", "trial"],
        "variants": [
            {
                "variant_id": profile["profile_id"] + ":" + selector,
                "source_plugin_uid": profile["source_plugin_uid"],
                "source_settings": {"protocol_selector": selector, **profile["source_settings"]},
                "source_schema_digest": profile["source_schema_digest"],
                "source_runtime_schema_digest": profile["source_runtime_schema_digest"],
                "source_profile_id": profile["profile_id"],
                "parameter_adapter": {
                    "id": profile["adapter_id"],
                    "revision": profile["adapter_revision"],
                    "rules_digest": profile_digest(profile),
                },
                "target": target,
                "operations": template["operations"],
                "conformance_fixture_ids": ["exact-positive-credit-source-family-offline"],
            }
        ],
    }


def _credit_llm_records() -> list[dict[str, object]]:
    records: dict[str, dict[str, object]] = {}
    for index, selector in _CREDIT_LLM_SELECTOR_CASES:
        item = _credit_llm_record(index, selector)
        model = _CREDIT_LLM_PROFILES[index]["source_model"]
        if model not in records:
            records[model] = item
        else:
            variants(records[model]).extend(variants(item))
    return list(records.values())


def _credit_llm_restore_record(record: dict[str, object]) -> SourceParameterContract:
    registry = source_mapping_revision(json.dumps([record]), _CREDIT_LLM_REVISION)
    return restore_variant_source_contract(registry.selected_prospective()[0])


def _credit_llm_credentials(index: int, selector: str) -> dict[str, object]:
    profile = _CREDIT_LLM_PROFILES[index]
    credentials: dict[str, object] = {"api_key": "ORIGINAL_SOURCE_KEY_MUST_STAY_PRIVATE"}
    if selector != "absent":
        credentials["api_protocol"] = selector
    if profile["source_endpoint_class"] == "official_root":
        credentials["openai_api_base"] = "https://api.openai.com"
    return credentials


@pytest.mark.parametrize(("index", "selector"), _CREDIT_LLM_SELECTOR_CASES)
def test_credit_llm_family_all_192_selectors_parse_resolve_build_restore_and_freeze(index: int, selector: str) -> None:
    from services.model_billing_openai_credit_llm_adapter import OpenAICreditLLMSourceContract

    assert len(_CREDIT_LLM_PROFILES) == 128
    assert len(_CREDIT_LLM_SOURCE_ROWS) == 32
    assert len(_CREDIT_LLM_SELECTOR_CASES) == 192
    profile = _CREDIT_LLM_PROFILES[index]
    catalog = _credit_llm_catalog(index)
    identity = (SOURCE_PROVIDER, ModelType.LLM, profile["source_model"])
    credentials = _credit_llm_credentials(index, selector)
    before = deepcopy(credentials)
    registry = source_mapping_revision(json.dumps(_credit_llm_records()), _CREDIT_LLM_REVISION)
    assert len(registry.declarations) == 20
    assert len(registry.selected_prospective()) == 192
    fact = hosted_source_variant_fact(
        provider=SOURCE_PROVIDER, source_uid=profile["source_plugin_uid"], models=[catalog], credentials=credentials
    )
    selected = resolve_source_mapping(
        registry, identity, source_uid=profile["source_plugin_uid"], fact=fact, schema=catalog
    )
    assert isinstance(selected, SelectedSourceVariant)
    assert selected.variant.source_profile_id == profile["profile_id"]
    assert selected.target.model == profile["target_model"]
    restored = restore_variant_source_contract(selected)
    built = build_source_adapter_contract(
        selected,
        source_provider=SOURCE_PROVIDER,
        source_plugin_unique_identifier=profile["source_plugin_uid"],
        source_schema=catalog,
        source_credentials=credentials,
    )
    assert type(built) is OpenAICreditLLMSourceContract
    assert built == restored
    assert built.source_model == profile["source_model"]
    assert built.target_model == profile["target_model"]
    assert built.rules_digest == profile_digest(profile)
    assert built.source_runtime_schema_digest == profile_digest(profile["source_daemon_schema"])
    marker = source_parameter_marker(
        built,
        source_provider=SOURCE_PROVIDER,
        source_model=profile["source_model"],
        model_type=ModelType.LLM,
        target_model=profile["target_model"],
    )
    assert marker == {
        "schema_version": 1,
        "profile_id": profile["profile_id"],
        "source_plugin_uid": profile["source_plugin_uid"],
        "source_model": profile["source_model"],
        "source_schema_digest": profile["source_schema_digest"],
        "rules_digest": profile_digest(profile),
    }
    assert registry.restore_selection(identity, selection_payload(selected).model_dump(mode="json")) == selected
    validate_frozen_mapping_evidence(
        selected,
        provider=SOURCE_PROVIDER,
        model=profile["source_model"],
        model_type=ModelType.LLM,
        target_model=profile["target_model"],
        operations=tuple(selected.operations),
        source_contract=built,
        tts_contract=None,
    )
    assert credentials == before
    assert "ORIGINAL_SOURCE_KEY" not in json.dumps(marker)
    assert "ORIGINAL_SOURCE_KEY" not in selection_payload(selected).model_dump_json()


@pytest.mark.parametrize(
    "change",
    [
        "source_type",
        "target_type",
        "mode",
        "target_alias",
        "unknown_uid",
        "revision",
        "rules",
        "runtime_pin",
        "catalog_pin",
        "metadata",
        "base",
        "profile",
        "operations",
        "110_missing_gpt-4o",
        "110_missing_gpt-5-2025-08-07",
        "110_missing_gpt-5-mini-2025-08-07",
        "042_missing_gpt-5.6-luna",
        "042_missing_gpt-5.6-sol",
        "042_missing_gpt-5.6-terra",
        "042_missing_gpt-6-luna",
        "042_missing_gpt-6-sol",
    ],
)
def test_credit_llm_family_declarations_fail_closed_on_unreviewed_evidence(change: str) -> None:
    index = 0
    version = ""
    if "_missing_" in change:
        version, model = change.split("_missing_", 1)
        index = next(i for i, profile in enumerate(_CREDIT_LLM_PROFILES) if profile["source_model"] == model)
    record = _credit_llm_record(index, _CREDIT_LLM_PROFILES[index]["supported_protocol_selectors"][0])
    row = variants(record)[0]
    if "_missing_" in change:
        row["source_plugin_uid"] = (
            OPENAI_PROVIDER042_SOURCE_UID
            if version == "042"
            else CURRENT_SOURCE_CONTRACTS[0].source_plugin_unique_identifier
        )
    elif change == "source_type":
        section(record, "source")["model_type"] = "text-embedding"
    elif change == "target_type":
        section(row, "target")["model_type"] = "tts"
    elif change == "mode":
        section(record, "source")["mode"] = "completion"
    elif change == "target_alias":
        section(row, "target")["model"] = "gpt-5"
    elif change == "unknown_uid":
        row["source_plugin_uid"] = OPENAI_PROVIDER042_SOURCE_UID.replace(":0.4.2@", ":0.4.1@")
    elif change in {"revision", "rules"}:
        section(row, "parameter_adapter")["revision" if change == "revision" else "rules_digest"] = (
            "2" if change == "revision" else "sha256:" + "0" * 64
        )
    elif change in {"runtime_pin", "catalog_pin"}:
        row["source_runtime_schema_digest" if change == "runtime_pin" else "source_schema_digest"] = (
            "sha256:" + "0" * 64
        )
    elif change in {"metadata", "base"}:
        section(row, "source_settings")[
            "request_metadata_enabled" if change == "metadata" else "source_base_is_set"
        ] = True
    elif change == "profile":
        row["source_profile_id"] = _CREDIT_LLM_PROFILES[1]["profile_id"]
    else:
        row["operations"] = ["model/schema", "llm/invoke"]
    with pytest.raises(ValueError, match="[Ss]ource|[Vv]ariant|OpenAI|model_type|target|parameter_adapter"):
        _credit_llm_restore_record(record)


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("api_protocol", "default_chat"),
        ("api_protocol", False),
        ("enable_request_metadata", "enabled"),
        ("enable_request_metadata", "unknown"),
        ("enable_request_metadata", False),
        ("openai_api_base", "https://api.openai.com/v1"),
        ("openai_api_base", "https://custom.invalid"),
        ("openai_api_base", False),
        ("source_uid", "langgenius/openai:0.4.1@" + "0" * 64),
    ],
)
def test_credit_llm_family_actual_public_facts_cannot_select_a_fallback(key: str, value: object) -> None:
    profile = _CREDIT_LLM_PROFILES[0]
    catalog = _credit_llm_catalog(0)
    credentials = _credit_llm_credentials(0, "absent")
    uid = profile["source_plugin_uid"]
    if key == "source_uid":
        assert isinstance(value, str)
        uid = value
    else:
        credentials[key] = value
    before = deepcopy(credentials)
    fact = hosted_source_variant_fact(
        provider=SOURCE_PROVIDER, source_uid=uid, models=[catalog], credentials=credentials
    )
    with pytest.raises(ValueError, match="[Ss]ource|[Vv]ariant|OpenAI"):
        resolve_source_mapping(
            source_mapping_revision(json.dumps(_credit_llm_records()), _CREDIT_LLM_REVISION),
            (SOURCE_PROVIDER, ModelType.LLM, profile["source_model"]),
            source_uid=uid,
            fact=fact,
            schema=catalog,
        )
    assert credentials == before


@pytest.mark.parametrize("source_model", ["gpt-5-2025-08-07", "gpt-5-mini-2025-08-07"])
@pytest.mark.parametrize(
    "old_family", ["openai_chat_source_v1", "openai_provider042_source_v1", "openai_provider110_source_v1"]
)
def test_credit_llm_family_two_exact_aliases_cannot_be_injected_into_old_families(
    source_model: str, old_family: str
) -> None:
    aliases = {
        (p["source_model"], p["target_model"]) for p in _CREDIT_LLM_PROFILES if p["source_model"] != p["target_model"]
    }
    assert aliases == {("gpt-5-2025-08-07", "gpt-5"), ("gpt-5-mini-2025-08-07", "gpt-5-mini")}
    index = next(i for i, profile in enumerate(_CREDIT_LLM_PROFILES) if profile["source_model"] == source_model)
    assert _CREDIT_LLM_PROFILES[index]["source_version"] == "042"
    record = _credit_llm_record(index, "chat")
    section(variants(record)[0], "parameter_adapter")["id"] = old_family
    with pytest.raises(ValidationError, match="Invalid bounded source variant"):
        source_mapping_revision(json.dumps([record]), _CREDIT_LLM_REVISION)
    # The new family is V2 only; a legacy-shaped declaration cannot gain it.
    legacy = mapping(_credit_llm_catalog(index), revision="credit-family-v1-denied", target=source_model)
    section(legacy, "parameter_adapter")["id"] = "openai_credit_llm_source_v1"
    with pytest.raises(ValidationError, match="parameter_adapter"):
        source_mapping_revision(json.dumps([legacy]), "credit-family-v1-denied")


@pytest.mark.parametrize(
    "field",
    [
        "rules_digest",
        "algorithm_revision",
        "source_runtime_schema_digest",
        "target_model",
        "source_plugin_unique_identifier",
    ],
)
def test_credit_llm_family_frozen_contract_drift_is_not_reservation_authority(field: str) -> None:
    profile = _CREDIT_LLM_PROFILES[0]
    registry = source_mapping_revision(json.dumps([_credit_llm_record(0, "chat")]), _CREDIT_LLM_REVISION)
    selected = registry.selected_prospective()[0]
    contract = restore_variant_source_contract(selected)
    forged = replace(contract, **{field: "2" if field == "algorithm_revision" else "sha256:" + "0" * 64})
    with pytest.raises(ValueError, match="[Ss]ource|[Vv]ariant|OpenAI|[Ff]rozen"):
        validate_frozen_mapping_evidence(
            selected,
            provider=SOURCE_PROVIDER,
            model=profile["source_model"],
            model_type=ModelType.LLM,
            target_model=profile["target_model"],
            operations=tuple(selected.operations),
            source_contract=forged,
            tts_contract=None,
        )


def test_credit_llm_family_append_preserves_all_prior_registry_shapes_and_digests() -> None:
    prior = [
        mapping(revision="credit-family-preserved-v1"),
        variant_record(),
        *full_embedding_registry(),
        *full_daemon_registry(),
    ]
    revisions = ("credit-family-preserved-v1", REVISION, EMBEDDING_REVISION, DAEMON_REVISION)
    before = {revision: source_mapping_revision(json.dumps(prior), revision) for revision in revisions}
    records = _credit_llm_records()
    combined = json.dumps([*prior, *records])
    for revision, original in before.items():
        restored = source_mapping_revision(combined, revision)
        assert restored.digest == original.digest
        assert [item.model_dump_json() for item in restored.declarations.values()] == [
            item.model_dump_json() for item in original.declarations.values()
        ]
    current = source_mapping_revision(combined, _CREDIT_LLM_REVISION)
    reordered = deepcopy(records)
    reordered.reverse()
    for record in reordered:
        variants(record).reverse()
    assert source_mapping_revision(json.dumps(reordered), _CREDIT_LLM_REVISION).digest == current.digest
    frozen = current.selected_prospective()[0]
    changed = deepcopy(records)
    section(variants(changed[-1])[-1], "target")["catalog_revision"] = "different-unpublished-catalog"
    drifted = source_mapping_revision(json.dumps(changed), _CREDIT_LLM_REVISION)
    assert drifted.digest != current.digest
    with pytest.raises(ValueError, match="Frozen source variant changed"):
        drifted.restore_selection(
            (SOURCE_PROVIDER, ModelType.LLM, frozen.source.model), selection_payload(frozen).model_dump(mode="json")
        )
