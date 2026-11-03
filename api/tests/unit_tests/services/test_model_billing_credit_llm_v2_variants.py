"""Closed LLM source-v2 ownership through existing V2 registry/settings contracts."""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import replace
from typing import Literal, cast

import pytest

from core.model_billing_migration_protocol import canonical_hash
from graphon.model_runtime.entities.model_entities import ModelType
from services import model_billing_openai_credit_llm_adapter as old
from services import model_billing_openai_credit_llm_v2_adapter as adapter
from services.entities.model_billing_mapping import SelectedSourceVariant, SourceParameterContract, model_schema_digest
from services.model_billing_mapping_service import (
    build_source_adapter_contract,
    hosted_source_variant_fact,
    resolve_source_mapping,
    restore_variant_source_contract,
    source_mapping_revision,
    source_parameter_marker,
    source_variant_context,
    validate_frozen_mapping_evidence,
)
from services.model_billing_source_variants import ModelMappingRevision, selection_payload
from tests.unit_tests.services.model_billing_credit_llm_v2_fixtures import (
    PROFILES_BY_ID,
    REVISION,
    SELECTOR_CASES,
    SOURCE_ROWS,
    V1_REVISION,
    credit_llm_v1_records,
    credit_llm_v2_catalog,
    credit_llm_v2_credentials,
    credit_llm_v2_records,
    credit_llm_v2_registry,
    credit_llm_v2_runtime,
    profile_digest,
)

type Selector = Literal["absent", "chat", "responses"]

_PROVIDER = adapter.OPENAI_CREDIT_LLM_SOURCE_PROVIDER
_REGISTRY = credit_llm_v2_registry()
_PROFILE_IDS = tuple(PROFILES_BY_ID)
_FIRST = _PROFILE_IDS[0]
_OLD_CONTRACTS = {contract.profile_id: contract for contract in old._REVIEWED_CONTRACTS}
_NONE_CASES = tuple(
    (version, model)
    for version in ("042", "110")
    for model in sorted(adapter.OPENAI_CREDIT_LLM_SOURCE_MODELS)
    if (version, model) not in SOURCE_ROWS
)


def _selected(profile_id: str, selector: Selector, registry: ModelMappingRevision = _REGISTRY) -> SelectedSourceVariant:
    profile = PROFILES_BY_ID[profile_id]
    catalog = credit_llm_v2_catalog(profile_id)
    fact = hosted_source_variant_fact(
        provider=_PROVIDER,
        source_uid=profile["source_plugin_uid"],
        models=[catalog],
        credentials=credit_llm_v2_credentials(profile_id, selector),
    )
    selected = resolve_source_mapping(
        registry,
        (_PROVIDER, ModelType.LLM, profile["source_model"]),
        source_uid=profile["source_plugin_uid"],
        fact=fact,
        schema=catalog,
    )
    assert isinstance(selected, SelectedSourceVariant)
    return selected


def _record(profile_id: str = _FIRST) -> dict[str, object]:
    record = next(
        record
        for record in credit_llm_v2_records()
        if cast(dict[str, object], record["source"])["model"] == PROFILES_BY_ID[profile_id]["source_model"]
    )
    variant = next(
        variant
        for variant in cast(list[dict[str, object]], record["variants"])
        if variant["source_profile_id"] == profile_id
    )
    record["variants"] = [variant]
    return record


def _row(record: dict[str, object]) -> dict[str, object]:
    return cast(list[dict[str, object]], record["variants"])[0]


def _parse_and_restore(record: dict[str, object]) -> None:
    registry = credit_llm_v2_registry([record])
    for selected in registry.selected_prospective():
        restore_variant_source_contract(selected)


def _frozen(selected: SelectedSourceVariant, contract: SourceParameterContract) -> None:
    validate_frozen_mapping_evidence(
        selected,
        provider=_PROVIDER,
        model=selected.source.model,
        model_type=ModelType.LLM,
        target_model=selected.target.model,
        operations=tuple(selected.operations),
        source_contract=contract,
        tts_contract=None,
    )


def test_v2_real_packet_census_and_prospective_family_are_closed_without_changing_v2_json_shape() -> None:
    assert len(PROFILES_BY_ID) == 128
    assert len(SOURCE_ROWS) == 32
    assert len(_NONE_CASES) == 8
    assert len(SELECTOR_CASES) == 192
    assert len(_REGISTRY.declarations) == 20
    assert len(_REGISTRY.selected_prospective()) == 192
    assert all(
        selected.parameter_adapter.id == "openai_credit_llm_source_v2" for selected in _REGISTRY.selected_prospective()
    )
    records = credit_llm_v2_records()
    assert canonical_hash(records) == canonical_hash(json.loads(json.dumps(records)))
    assert {
        (profile["source_version"], profile["source_model"], profile["target_model"])
        for profile in PROFILES_BY_ID.values()
        if profile["source_model"] != profile["target_model"]
    } == {("042", "gpt-5-2025-08-07", "gpt-5"), ("042", "gpt-5-mini-2025-08-07", "gpt-5-mini")}
    payload = selection_payload(_selected(_FIRST, "absent"))
    assert set(payload.model_dump()) == {
        "variant_id",
        "source_plugin_uid",
        "source_settings",
        "source_schema_digest",
        "source_runtime_schema_digest",
        "registry_digest",
    }
    assert "schema_version" not in payload.model_dump()


@pytest.mark.parametrize(("profile_id", "selector"), SELECTOR_CASES)
def test_all_192_selectors_parse_context_resolve_build_marker_restore_and_freeze(
    profile_id: str, selector: Selector
) -> None:
    profile = PROFILES_BY_ID[profile_id]
    catalog = credit_llm_v2_catalog(profile_id)
    credentials = credit_llm_v2_credentials(profile_id, selector)
    before = deepcopy(credentials)
    fact = hosted_source_variant_fact(
        provider=_PROVIDER, source_uid=profile["source_plugin_uid"], models=[catalog], credentials=credentials
    )
    context = source_variant_context(fact, provider=_PROVIDER, source_uid=profile["source_plugin_uid"], schema=catalog)
    assert context is not None
    assert context.settings.protocol_selector == selector
    selected = _selected(profile_id, selector)
    assert selected.variant.source_profile_id == profile_id
    assert selected.mapping_revision == REVISION
    assert selected.variant.source_settings == context.settings
    contract = build_source_adapter_contract(
        selected,
        source_provider=_PROVIDER,
        source_plugin_unique_identifier=profile["source_plugin_uid"],
        source_schema=catalog,
        source_credentials=credentials,
    )
    assert type(contract) is adapter.OpenAICreditLLMSourceV2Contract
    assert contract == restore_variant_source_contract(selected)
    assert contract.rules_digest == profile_digest(profile)
    assert contract.source_runtime_schema_digest == model_schema_digest(credit_llm_v2_runtime(profile_id))
    marker = source_parameter_marker(
        contract,
        source_provider=_PROVIDER,
        source_model=profile["source_model"],
        model_type=ModelType.LLM,
        target_model=profile["target_model"],
    )
    assert marker == {
        "schema_version": 1,
        "profile_id": profile_id,
        "source_plugin_uid": profile["source_plugin_uid"],
        "source_model": profile["source_model"],
        "source_schema_digest": profile["source_schema_digest"],
        "rules_digest": profile_digest(profile),
    }
    payload = selection_payload(selected).model_dump(mode="json")
    restored = _REGISTRY.restore_selection(
        (_PROVIDER, ModelType.LLM, profile["source_model"]), json.loads(json.dumps(payload))
    )
    assert restored == selected
    assert isinstance(restored, SelectedSourceVariant)
    assert canonical_hash(selection_payload(restored).model_dump(mode="json")) == canonical_hash(payload)
    _frozen(restored, contract)
    assert credentials == before
    assert "offline-not-a-real-key" not in json.dumps(marker)
    assert "offline-not-a-real-key" not in json.dumps(payload)


@pytest.mark.parametrize("profile_id", _PROFILE_IDS)
def test_v1_contract_marker_and_rules_cannot_cross_the_v2_owner(profile_id: str) -> None:
    profile = PROFILES_BY_ID[profile_id]
    selected = _selected(profile_id, profile["supported_protocol_selectors"][0])
    contract = restore_variant_source_contract(selected)
    old_contract = _OLD_CONTRACTS[profile_id.replace("openai-credit-v2-", "openai-credit-", 1)]
    assert old_contract.source_schema_digest == contract.source_schema_digest
    assert old_contract.source_runtime_schema_digest == contract.source_runtime_schema_digest
    with pytest.raises(ValueError, match="Source parameter mapping changed"):
        _frozen(selected, old_contract)
    old_marker = source_parameter_marker(
        old_contract,
        source_provider=_PROVIDER,
        source_model=profile["source_model"],
        model_type=ModelType.LLM,
        target_model=profile["target_model"],
    )
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
        adapter.restore_openai_credit_llm_source_contract(
            old_marker,
            source_provider=_PROVIDER,
            source_model=profile["source_model"],
            model_type=ModelType.LLM,
            target_model=profile["target_model"],
            source_settings=selected.variant.source_settings,
            source_endpoint_class=profile["source_endpoint_class"],
            expected_source_runtime_schema_digest=profile["source_runtime_schema_digest"],
        )
    with pytest.raises(ValueError, match="[Ss]ource|OpenAI"):
        _frozen(selected, replace(contract, rules_digest=old_contract.rules_digest))
    record = _record(profile_id)
    cast(dict[str, object], _row(record)["parameter_adapter"])["rules_digest"] = old_contract.rules_digest
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
        _parse_and_restore(record)


def test_appending_v2_preserves_old_revision_hashes_declarations_and_selection_payloads() -> None:
    old_records = credit_llm_v1_records()
    old_registry = source_mapping_revision(json.dumps(old_records), V1_REVISION)
    old_digest = old_registry.digest
    old_json = [declaration.model_dump_json() for declaration in old_registry.declarations.values()]
    old_payloads = [selection_payload(selected).model_dump_json() for selected in old_registry.selected_prospective()]
    combined = json.dumps(old_records + credit_llm_v2_records())
    replayed = source_mapping_revision(combined, V1_REVISION)
    assert replayed.digest == old_digest
    assert [declaration.model_dump_json() for declaration in replayed.declarations.values()] == old_json
    assert [
        selection_payload(selected).model_dump_json() for selected in replayed.selected_prospective()
    ] == old_payloads
    fresh = source_mapping_revision(combined, REVISION)
    assert fresh.digest == _REGISTRY.digest
    assert len(fresh.selected_prospective()) == 192
    assert {restore_variant_source_contract(selected).adapter_id for selected in fresh.selected_prospective()} == {
        "openai_credit_llm_source_v2"
    }


def test_one_logical_envelope_cannot_mix_the_immutable_v1_and_new_v2_families() -> None:
    record = _record()
    old_record = next(
        item
        for item in credit_llm_v1_records()
        if cast(dict[str, object], item["source"])["model"] == PROFILES_BY_ID[_FIRST]["source_model"]
    )
    cast(list[dict[str, object]], record["variants"]).append(cast(list[dict[str, object]], old_record["variants"])[0])
    with pytest.raises(ValueError, match="Mixed credit LLM source adapter families"):
        credit_llm_v2_registry([record])


@pytest.mark.parametrize(("version", "model"), _NONE_CASES)
def test_eight_exact_source_none_pairs_still_have_no_new_family_authority(
    version: Literal["042", "110"], model: str
) -> None:
    profile_id = next(profile_id for profile_id, profile in PROFILES_BY_ID.items() if profile["source_model"] == model)
    record = _record(profile_id)
    _row(record)["source_plugin_uid"] = adapter.OPENAI_CREDIT_LLM_SOURCE_UIDS[version]
    with pytest.raises(ValueError, match="not reviewed"):
        credit_llm_v2_registry([record])


@pytest.mark.parametrize(
    "change",
    [
        "source_type",
        "target_type",
        "mode",
        "uid",
        "revision",
        "family",
        "profile",
        "rules",
        "catalog",
        "runtime",
        "unknown_settings",
        "not_used",
        "metadata",
        "bool_base",
        "operation",
        "duplicate_selector",
        "alias",
    ],
)
def test_new_family_finite_declaration_or_restore_rejects_drift(change: str) -> None:
    record = _record()
    row = _row(record)
    source = cast(dict[str, object], record["source"])
    target = cast(dict[str, object], row["target"])
    adapter_settings = cast(dict[str, object], row["parameter_adapter"])
    settings = cast(dict[str, object], row["source_settings"])
    if change == "source_type":
        source["model_type"] = ModelType.TTS.value
    elif change == "target_type":
        target["model_type"] = ModelType.TEXT_EMBEDDING.value
    elif change == "mode":
        source["mode"] = "completion"
    elif change == "uid":
        row["source_plugin_uid"] = "langgenius/openai:1.1.0@" + "0" * 64
    elif change == "revision":
        adapter_settings["revision"] = "2"
    elif change == "family":
        adapter_settings["id"] = "openai_chat_source_v1"
    elif change == "profile":
        row["source_profile_id"] = str(row["source_profile_id"]) + ":unreviewed"
    elif change == "rules":
        adapter_settings["rules_digest"] = "sha256:" + "0" * 64
    elif change in {"catalog", "runtime"}:
        row["source_schema_digest" if change == "catalog" else "source_runtime_schema_digest"] = "sha256:" + "0" * 64
    elif change == "unknown_settings":
        settings["unknown"] = True
    elif change == "not_used":
        settings["protocol_selector"] = "not_used"
    elif change == "metadata":
        settings["request_metadata_enabled"] = True
    elif change == "bool_base":
        settings["source_base_is_set"] = 1
    elif change == "operation":
        row["operations"] = ["model/schema", "llm/invoke"]
    elif change == "duplicate_selector":
        duplicate = deepcopy(row)
        duplicate["variant_id"] = str(row["variant_id"]) + ":duplicate"
        cast(list[dict[str, object]], record["variants"]).append(duplicate)
    else:
        target["model"] = str(target["model"]) + "-unreviewed-alias"
    with pytest.raises(ValueError, match="validation error|source|Source|OpenAI|bounded|Ambiguous"):
        _parse_and_restore(record)
