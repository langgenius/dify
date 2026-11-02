"""Exact-version registry/availability; real reviewed042 contracts, no model calls."""

import hashlib
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
    source_variant_context,
    validate_frozen_mapping_evidence,
)
from services.model_billing_openai_chat_adapter import _OFFICIAL_ROOT_REVIEWED_CONTRACT as OFFICIAL042
from services.model_billing_openai_provider110_adapter import (
    _OFFICIAL_ROOT_REVIEWED_CONTRACTS as OFFICIAL110,
)
from services.model_billing_openai_provider110_adapter import _REVIEWED_CONTRACTS
from services.model_billing_source_variants import SourceVariantContext, selection_payload, source_endpoint_class
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
    for missing in (None, [], ""):
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
