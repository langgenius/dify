"""Exact-version registry/availability; real reviewed042 contracts, no model calls."""

import json
from copy import deepcopy
from dataclasses import replace
from pathlib import Path

import pytest

from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit
from core.hosting_configuration import HostingProvider, PaidHostingQuota
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_mapping import (
    ModelMapping,
    SelectedSourceVariant,
    SourceParameterContract,
    SourceVariantSettings,
)
from services.model_billing_mapping_service import (
    additional_hosted_availability,
    build_source_adapter_contract,
    hosted_source_variant_fact,
    mappings_for_revision,
    resolve_source_mapping,
    restore_variant_source_contract,
    source_mapping_revision,
    validate_frozen_mapping_evidence,
)
from services.model_billing_openai_provider110_adapter import _REVIEWED_CONTRACTS
from services.model_billing_source_variants import SourceVariantContext, selection_payload
from tests.unit_tests.services.test_model_billing_mapping_service import mapping, section
from tests.unit_tests.services.test_model_billing_openai_chat_adapter import build_inputs

REVISION = "source-variants-new-v2"
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
    with pytest.raises(ValueError, match="Unreviewed V2"):
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
