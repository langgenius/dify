"""Closed V4/V5 registry/fact/frozen-policy integration; no runtime/model I/O."""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import asdict, replace
from typing import Literal, cast

import pytest
from typing_extensions import TypedDict

from core.entities.provider_entities import (
    HostedAudioSourceFact,
    HostedEmbeddingSourceFact,
    HostedXAISourceFact,
)
from core.model_billing_migration_protocol import canonical_hash
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_audio_mapping import SelectedAudioSourceVariant
from services.entities.model_billing_mapping import SourceParameterContract, SourceVariantSettings, model_schema_digest
from services.entities.model_billing_xai_mapping import SelectedXAISourceVariant
from services.model_billing_mapping_service import (
    _xai_factory_settings,
    audio_source_variant_context,
    build_source_adapter_contract,
    hosted_audio_source_fact,
    hosted_source_variant_fact,
    hosted_xai_source_fact,
    resolve_source_mapping,
    restore_variant_source_contract,
    source_mapping_revision,
    source_parameter_marker,
    source_schema_matches_mapping,
    validate_frozen_mapping_evidence,
    xai_source_variant_context,
)
from services.model_billing_openai_audio_adapter import OPENAI_AUDIO_SOURCE_UIDS, OpenAIAudioSourceContract
from services.model_billing_source_variants import (
    AudioSourceVariantContext,
    ModelMappingRevision,
    SourceVariantContext,
    XAISourceVariantContext,
    selection_payload,
)
from services.model_billing_xai_credit_source_adapter import XAICreditSourceContract, XAICreditSourceSettings
from tests.unit_tests.services.model_billing_audio_xai_fixtures import (
    AUDIO_ROWS,
    PROFILES_BY_ID,
    REVISION,
    SELECTOR_CASES,
    Endpoint,
    audio_xai_catalog,
    audio_xai_credentials,
    audio_xai_model_type,
    audio_xai_provider,
    audio_xai_records,
    audio_xai_registry,
    audio_xai_runtime,
    profile_digest,
)

type Selected = SelectedAudioSourceVariant | SelectedXAISourceVariant
type SourceFact = HostedAudioSourceFact | HostedXAISourceFact


class _FactArguments(TypedDict, closed=True):
    provider: str
    source_uid: str
    models: list[AIModelEntity]
    credentials: object


_REGISTRY = audio_xai_registry()
_AUDIO_IDS = tuple(profile_id for profile_id in PROFILES_BY_ID if audio_xai_model_type(profile_id) is not ModelType.LLM)
_XAI_IDS = tuple(profile_id for profile_id in PROFILES_BY_ID if audio_xai_model_type(profile_id) is ModelType.LLM)
_AUDIO_ID = _AUDIO_IDS[0]
_XAI_ID = _XAI_IDS[0]


def _identity(profile_id: str) -> tuple[str, ModelType, str]:
    return audio_xai_provider(profile_id), audio_xai_model_type(profile_id), PROFILES_BY_ID[profile_id]["source_model"]


def _fact(profile_id: str, endpoint: Endpoint) -> SourceFact:
    profile = PROFILES_BY_ID[profile_id]
    arguments: _FactArguments = {
        "provider": audio_xai_provider(profile_id),
        "source_uid": profile["source_plugin_uid"],
        "models": [audio_xai_catalog(profile_id)],
        "credentials": audio_xai_credentials(profile_id, endpoint),
    }
    if audio_xai_model_type(profile_id) is ModelType.LLM:
        fact = hosted_xai_source_fact(**arguments)
        assert isinstance(fact, HostedXAISourceFact)
        return fact
    fact = hosted_audio_source_fact(**arguments)
    assert isinstance(fact, HostedAudioSourceFact)
    return fact


def _resolve(profile_id: str, endpoint: Endpoint, *, registry: ModelMappingRevision = _REGISTRY) -> Selected:
    fact = _fact(profile_id, endpoint)
    selected = resolve_source_mapping(
        registry,
        _identity(profile_id),
        source_uid=PROFILES_BY_ID[profile_id]["source_plugin_uid"],
        fact=None,
        audio_fact=fact if isinstance(fact, HostedAudioSourceFact) else None,
        xai_fact=fact if isinstance(fact, HostedXAISourceFact) else None,
        schema=audio_xai_catalog(profile_id),
    )
    assert isinstance(selected, (SelectedAudioSourceVariant, SelectedXAISourceVariant))
    return selected


def _record(profile_id: str) -> dict[str, object]:
    return next(
        record
        for record in audio_xai_records()
        if cast(dict[str, object], record["source"])["model"] == PROFILES_BY_ID[profile_id]["source_model"]
    )


def _variant(record: dict[str, object]) -> dict[str, object]:
    return cast(list[dict[str, object]], record["variants"])[0]


def _parse_and_restore(record: dict[str, object]) -> None:
    registry = audio_xai_registry([record])
    for selected in registry.selected_prospective():
        restore_variant_source_contract(selected)


def _frozen_arguments(selected: Selected, contract: SourceParameterContract | None) -> dict[str, object]:
    return {
        "provider": str(selected.source.provider_id),
        "model": selected.source.model,
        "model_type": selected.source.model_type,
        "target_model": selected.target.model,
        "operations": tuple(selected.operations),
        "source_contract": contract,
        "tts_contract": None,
    }


def _validate_frozen(selected: Selected, contract: SourceParameterContract | None, **changes: object) -> None:
    values = _frozen_arguments(selected, contract) | changes
    validate_frozen_mapping_evidence(
        selected,
        provider=cast(str, values["provider"]),
        model=cast(str, values["model"]),
        model_type=cast(ModelType, values["model_type"]),
        target_model=cast(str, values["target_model"]),
        operations=cast(tuple[str, ...], values["operations"]),
        source_contract=cast(SourceParameterContract | None, values["source_contract"]),
        tts_contract=None,
    )


def test_eleven_logical_declarations_twenty_nine_exact_selectors_are_prospective_only() -> None:
    records = audio_xai_records()
    assert len(records) == len(_REGISTRY.declarations) == 11
    assert len(AUDIO_ROWS) == len(_AUDIO_IDS) == 13
    assert len(_XAI_IDS) == 3
    assert len(SELECTOR_CASES) == 29
    assert canonical_hash(records) == canonical_hash(audio_xai_records())
    assert sum(record["schema_version"] == 4 for record in records) == 8
    prospective = _REGISTRY.selected_prospective()
    assert len(prospective) == 29
    assert {selected.mapping_revision for selected in prospective} == {REVISION}
    assert len({selected.variant.variant_id for selected in prospective}) == 29
    assert {selected.variant.source_profile_id for selected in prospective} == set(PROFILES_BY_ID)
    assert _REGISTRY.digest == audio_xai_registry(list(reversed(records))).digest
    for selected in prospective:
        assert isinstance(selected, (SelectedAudioSourceVariant, SelectedXAISourceVariant))
        assert (
            restore_variant_source_contract(selected).source_runtime_schema_digest
            == selected.variant.source_runtime_schema_digest
        )


@pytest.mark.parametrize(("profile_id", "endpoint"), SELECTOR_CASES)
def test_every_selector_real_fact_resolve_build_restore_marker_and_frozen_evidence(
    profile_id: str, endpoint: Endpoint
) -> None:
    profile = PROFILES_BY_ID[profile_id]
    selected = _resolve(profile_id, endpoint)
    assert selected.variant.source_profile_id == profile_id
    assert selected.registry_digest == _REGISTRY.digest
    assert source_schema_matches_mapping(audio_xai_catalog(profile_id), selected)
    contract = build_source_adapter_contract(
        selected,
        source_provider=audio_xai_provider(profile_id),
        source_plugin_unique_identifier=profile["source_plugin_uid"],
        source_schema=audio_xai_catalog(profile_id),
        source_credentials=None,
    )
    assert isinstance(contract, (OpenAIAudioSourceContract, XAICreditSourceContract))
    assert contract == restore_variant_source_contract(selected)
    assert contract.profile_id == profile_id
    assert contract.rules_digest == profile_digest(profile)
    assert contract.source_runtime_schema_digest == profile["source_runtime_schema_digest"]
    assert model_schema_digest(audio_xai_runtime(profile_id)) == contract.source_runtime_schema_digest
    marker = source_parameter_marker(
        contract,
        source_provider=audio_xai_provider(profile_id),
        source_model=profile["source_model"],
        model_type=audio_xai_model_type(profile_id),
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
    payload = selection_payload(selected)
    assert payload.model_dump()["schema_version"] == (5 if isinstance(selected, SelectedXAISourceVariant) else 4)
    serialized = json.loads(payload.model_dump_json())
    restored = _REGISTRY.restore_selection(_identity(profile_id), serialized)
    assert restored == selected
    assert isinstance(restored, (SelectedAudioSourceVariant, SelectedXAISourceVariant))
    assert canonical_hash(serialized) == canonical_hash(selection_payload(restored).model_dump(mode="json"))
    _validate_frozen(selected, contract)


@pytest.mark.parametrize("profile_id", _XAI_IDS)
def test_xai_outer_financial_sentinel_has_one_bridge_to_unchanged_null_source_policy(profile_id: str) -> None:
    selected = _resolve(profile_id, "official_root")
    assert isinstance(selected, SelectedXAISourceVariant)
    assert selected.variant.source_settings.protocol_selector == "not_used"
    profile = PROFILES_BY_ID[profile_id]
    assert profile["source_settings"]["protocol_selector"] is None
    factory_settings = _xai_factory_settings(selected.variant.source_settings)
    assert type(factory_settings) is XAICreditSourceSettings
    assert factory_settings == XAICreditSourceSettings(True, False, None)
    credentials = audio_xai_credentials(profile_id, "official_root")
    before = deepcopy(credentials)
    fact = hosted_xai_source_fact(
        provider=audio_xai_provider(profile_id),
        source_uid=profile["source_plugin_uid"],
        models=[audio_xai_catalog(profile_id)],
        credentials=credentials,
    )
    assert isinstance(fact, HostedXAISourceFact)
    assert fact.protocol_selector == "not_used"
    assert credentials == before
    assert set(credentials) == {"api_key", "endpoint_url", "model"}
    assert restore_variant_source_contract(selected).rules_digest == profile_digest(profile)


@pytest.mark.parametrize("selector", [None, "missing", "absent", "chat", False, 0])
def test_xai_outer_null_or_llm_selector_is_never_financial_safe_authority(selector: object) -> None:
    record = _record(_XAI_ID)
    settings = cast(dict[str, object], _variant(record)["source_settings"])
    if selector == "missing":
        settings.pop("protocol_selector")
    else:
        settings["protocol_selector"] = selector
    with pytest.raises(ValueError, match="protocol_selector"):
        audio_xai_registry([record])
    payload = selection_payload(_resolve(_XAI_ID, "official_root")).model_dump(mode="json")
    settings = cast(dict[str, object], payload["source_settings"])
    if selector == "missing":
        settings.pop("protocol_selector")
    else:
        settings["protocol_selector"] = selector
    with pytest.raises(ValueError, match="protocol_selector"):
        _REGISTRY.restore_selection(_identity(_XAI_ID), payload)


@pytest.mark.parametrize("selector", [None, "absent", "chat", False])
def test_xai_current_fact_requires_the_outer_not_used_sentinel(selector: object) -> None:
    fact = _fact(_XAI_ID, "official_root")
    assert isinstance(fact, HostedXAISourceFact)
    changed = replace(fact, protocol_selector=cast(Literal["not_used"], selector))
    profile = PROFILES_BY_ID[_XAI_ID]
    assert (
        xai_source_variant_context(
            changed,
            provider=audio_xai_provider(_XAI_ID),
            source_uid=profile["source_plugin_uid"],
            schema=audio_xai_catalog(_XAI_ID),
        )
        is None
    )
    with pytest.raises(ValueError, match="Positive source variant facts required"):
        resolve_source_mapping(
            _REGISTRY,
            _identity(_XAI_ID),
            source_uid=profile["source_plugin_uid"],
            fact=None,
            xai_fact=changed,
            schema=audio_xai_catalog(_XAI_ID),
        )


def test_not_used_is_not_injected_into_the_historical_llm_family() -> None:
    with pytest.raises(ValueError, match="protocol_selector"):
        SourceVariantSettings.model_validate(
            {"protocol_selector": "not_used", "source_base_is_set": True, "request_metadata_enabled": False}
        )
    assert (
        hosted_source_variant_fact(
            provider=audio_xai_provider(_AUDIO_ID),
            source_uid=PROFILES_BY_ID[_AUDIO_ID]["source_plugin_uid"],
            models=[audio_xai_catalog(_AUDIO_ID)],
            credentials={"api_protocol": "not_used"},
        )
        is None
    )


@pytest.mark.parametrize("profile_id", _AUDIO_IDS)
def test_audio_outer_endpoint_siblings_remain_distinct_despite_identical_codec_marker(profile_id: str) -> None:
    unset, root = _resolve(profile_id, "unset"), _resolve(profile_id, "official_root")
    assert isinstance(unset, SelectedAudioSourceVariant)
    assert isinstance(root, SelectedAudioSourceVariant)
    assert restore_variant_source_contract(unset) == restore_variant_source_contract(root)
    assert unset.variant.variant_id != root.variant.variant_id
    assert selection_payload(unset) != selection_payload(root)
    for source, other in ((unset, root), (root, unset)):
        payload = selection_payload(source).model_dump(mode="json")
        payload["source_settings"] = other.variant.source_settings.model_dump(mode="json")
        with pytest.raises(ValueError, match="Frozen source variant changed"):
            _REGISTRY.restore_selection(_identity(profile_id), payload)


@pytest.mark.parametrize(("profile_id", "endpoint"), SELECTOR_CASES)
def test_frozen_selection_and_contract_cannot_drift(profile_id: str, endpoint: Endpoint) -> None:
    selected = _resolve(profile_id, endpoint)
    payload = selection_payload(selected).model_dump(mode="json")
    for key in (
        "variant_id",
        "source_plugin_uid",
        "source_schema_digest",
        "source_runtime_schema_digest",
        "registry_digest",
    ):
        changed = payload | {key: "sha256:" + "0" * 64 if key.endswith("digest") else "unreviewed"}
        with pytest.raises(ValueError, match="validation error|Unknown or ambiguous|Frozen source variant changed"):
            _REGISTRY.restore_selection(_identity(profile_id), changed)
    contract = restore_variant_source_contract(selected)
    with pytest.raises(ValueError, match="Missing source parameter evidence"):
        _validate_frozen(selected, None)
    for changes in (
        {"operations": tuple(reversed(selected.operations))},
        {"target_model": selected.target.model + "-alias"},
        {"source_contract": replace(contract, rules_digest="sha256:" + "0" * 64)},
        {"source_contract": replace(contract, source_runtime_schema_digest="sha256:" + "0" * 64)},
        {
            "source_contract": restore_variant_source_contract(
                _resolve(_XAI_ID if profile_id in _AUDIO_IDS else _AUDIO_ID, "official_root")
            )
        },
    ):
        with pytest.raises(ValueError, match="Frozen mapping|source|Source|xAI"):
            _validate_frozen(selected, contract, **changes)
    changed_catalog = audio_xai_catalog(profile_id).model_copy(update={"model": selected.source.model + "-drift"})
    with pytest.raises(ValueError, match="schema identity"):
        build_source_adapter_contract(
            selected,
            source_provider=audio_xai_provider(profile_id),
            source_plugin_unique_identifier=selected.variant.source_plugin_uid,
            source_schema=changed_catalog,
            source_credentials=None,
        )


@pytest.mark.parametrize(
    "raw_flags",
    [
        {},
        {"api_protocol": None, "enable_request_metadata": None},
        {"api_protocol": "responses", "enable_request_metadata": "enabled"},
        {"api_protocol": True, "enable_request_metadata": {"arbitrary": "ignored"}},
    ],
)
@pytest.mark.parametrize("endpoint", ["unset", "official_root"])
def test_audio_facts_preserve_raw_flags_and_record_effective_not_used(
    raw_flags: dict[str, object], endpoint: Endpoint
) -> None:
    profile = PROFILES_BY_ID[_AUDIO_ID]
    credentials = audio_xai_credentials(_AUDIO_ID, endpoint) | raw_flags
    before = deepcopy(credentials)
    fact = hosted_audio_source_fact(
        provider=audio_xai_provider(_AUDIO_ID),
        source_uid=profile["source_plugin_uid"],
        models=[audio_xai_catalog(_AUDIO_ID)],
        credentials=credentials,
    )
    assert isinstance(fact, HostedAudioSourceFact)
    assert credentials == before
    assert fact.api_protocol_behavior == fact.request_metadata_behavior == "not_used"
    assert fact.source_endpoint_class == endpoint
    assert "offline-not-a-real-key" not in repr(fact)
    assert "https://" not in repr(fact)
    assert not {"source_base_is_set", "request_metadata_enabled", "protocol_selector"} & asdict(fact).keys()
    assert _resolve(_AUDIO_ID, endpoint).variant.source_settings.model_dump() == {
        "source_endpoint_class": endpoint,
        "api_protocol_behavior": "not_used",
        "request_metadata_behavior": "not_used",
    }


@pytest.mark.parametrize("profile_id", [_AUDIO_ID, _XAI_ID])
@pytest.mark.parametrize(
    "base",
    [
        None,
        "",
        "https://api.openai.com/v1",
        "https://api.openai.com/",
        "https://api.x.ai",
        "https://api.x.ai/v1/",
        " https://api.x.ai/v1",
        "https://unreviewed.invalid",
        True,
    ],
)
def test_endpoint_fact_acceptance_is_exact_not_truthiness(profile_id: str, base: object) -> None:
    profile = PROFILES_BY_ID[profile_id]
    catalog = audio_xai_catalog(profile_id)
    if profile_id == _AUDIO_ID:
        credentials = {"openai_api_key": "offline", "openai_api_base": base}
        fact = hosted_audio_source_fact(
            provider=audio_xai_provider(profile_id),
            source_uid=profile["source_plugin_uid"],
            models=[catalog],
            credentials=credentials,
        )
        context = audio_source_variant_context(
            fact, provider=audio_xai_provider(profile_id), source_uid=profile["source_plugin_uid"], schema=catalog
        )
        assert (context is not None) is (base is None or base == "")
    else:
        credentials = {"api_key": "offline", "endpoint_url": base, "model": profile["source_model"]}
        fact = hosted_xai_source_fact(
            provider=audio_xai_provider(profile_id),
            source_uid=profile["source_plugin_uid"],
            models=[catalog],
            credentials=credentials,
        )
        assert (
            xai_source_variant_context(
                fact, provider=audio_xai_provider(profile_id), source_uid=profile["source_plugin_uid"], schema=catalog
            )
            is None
        )


@pytest.mark.parametrize("profile_id", [_AUDIO_ID, _XAI_ID])
@pytest.mark.parametrize(
    "change",
    [
        "provider",
        "uid",
        "credentials_none",
        "credentials_list",
        "missing_catalog",
        "duplicate_catalog",
        "catalog_drift",
        "wrong_type",
    ],
)
def test_source_fact_owner_and_exact_single_catalog_proof_are_required(profile_id: str, change: str) -> None:
    profile = PROFILES_BY_ID[profile_id]
    catalog = audio_xai_catalog(profile_id)
    provider = audio_xai_provider(profile_id)
    source_uid = profile["source_plugin_uid"]
    credentials: object = audio_xai_credentials(profile_id, "official_root")
    models: list[AIModelEntity] = [catalog]
    if change == "provider":
        provider = "langgenius/anthropic/anthropic"
    elif change == "uid":
        source_uid = source_uid.split("@")[0] + "@" + "0" * 64
    elif change == "credentials_none":
        credentials = None
    elif change == "credentials_list":
        credentials = cast(list[object], [])
    elif change == "missing_catalog":
        models = []
    elif change == "duplicate_catalog":
        models = [catalog, catalog]
    elif change == "catalog_drift":
        models = [catalog.model_copy(update={"model_properties": {}})]
    else:
        models = [catalog.model_copy(update={"model_type": ModelType.TEXT_EMBEDDING})]
    if profile_id == _AUDIO_ID:
        audio_fact = hosted_audio_source_fact(
            provider=provider, source_uid=source_uid, models=models, credentials=credentials
        )
        assert (
            audio_source_variant_context(
                audio_fact,
                provider=audio_xai_provider(profile_id),
                source_uid=profile["source_plugin_uid"],
                schema=catalog,
            )
            is None
        )
    else:
        xai_fact = hosted_xai_source_fact(
            provider=provider, source_uid=source_uid, models=models, credentials=credentials
        )
        assert (
            xai_source_variant_context(
                xai_fact,
                provider=audio_xai_provider(profile_id),
                source_uid=profile["source_plugin_uid"],
                schema=catalog,
            )
            is None
        )


@pytest.mark.parametrize(
    "extra_key", ["api_protocol", "protocol_selector", "enable_request_metadata", "openai_api_base", "extra"]
)
def test_xai_does_not_manufacture_settings_from_unknown_source_credentials(extra_key: str) -> None:
    credentials = audio_xai_credentials(_XAI_ID, "official_root") | {extra_key: "not_used"}
    before = deepcopy(credentials)
    assert (
        hosted_xai_source_fact(
            provider=audio_xai_provider(_XAI_ID),
            source_uid=PROFILES_BY_ID[_XAI_ID]["source_plugin_uid"],
            models=[audio_xai_catalog(_XAI_ID)],
            credentials=credentials,
        )
        is None
    )
    assert credentials == before


@pytest.mark.parametrize("profile_id", [_AUDIO_ID, _XAI_ID])
def test_wrong_fact_family_and_populated_other_slots_never_fall_back(profile_id: str) -> None:
    profile = PROFILES_BY_ID[profile_id]
    identity = _identity(profile_id)
    catalog = audio_xai_catalog(profile_id)
    audio_fact = cast(HostedAudioSourceFact, _fact(_AUDIO_ID, "official_root"))
    xai_fact = cast(HostedXAISourceFact, _fact(_XAI_ID, "official_root"))
    llm_fact = hosted_source_variant_fact(
        provider=audio_xai_provider(_AUDIO_ID),
        source_uid=PROFILES_BY_ID[_AUDIO_ID]["source_plugin_uid"],
        models=[audio_xai_catalog(_AUDIO_ID)],
        credentials=audio_xai_credentials(_AUDIO_ID, "official_root"),
    )
    with pytest.raises(ValueError, match="Positive source variant facts required"):
        resolve_source_mapping(
            _REGISTRY,
            identity,
            source_uid=profile["source_plugin_uid"],
            fact=llm_fact,
            audio_fact=None if profile_id == _AUDIO_ID else audio_fact,
            xai_fact=xai_fact if profile_id == _AUDIO_ID else None,
            schema=catalog,
        )
    wrong_context = (
        XAISourceVariantContext(
            xai_fact.plugin_unique_identifier,
            cast(SelectedXAISourceVariant, _resolve(_XAI_ID, "official_root")).variant.source_settings,
            "official_root",
        )
        if profile_id == _AUDIO_ID
        else AudioSourceVariantContext(
            audio_fact.plugin_unique_identifier,
            cast(SelectedAudioSourceVariant, _resolve(_AUDIO_ID, "official_root")).variant.source_settings,
        )
    )
    for context in (
        wrong_context,
        SourceVariantContext(
            profile["source_plugin_uid"],
            SourceVariantSettings(protocol_selector="absent", source_base_is_set=True, request_metadata_enabled=False),
        ),
    ):
        with pytest.raises(ValueError, match="Source audio fact family changed|Source xAI fact family changed"):
            _REGISTRY.resolve(identity, context=context, schema=catalog)
    embedding_fact = HostedEmbeddingSourceFact(
        provider=audio_xai_provider(profile_id),
        plugin_unique_identifier=profile["source_plugin_uid"],
        catalog_schema_digests=((catalog.model_type, catalog.model, profile["source_schema_digest"]),),
        source_endpoint_class="official_root",
        request_metadata_behavior="not_used",
    )
    if profile_id == _AUDIO_ID:
        assert (
            audio_source_variant_context(
                cast(HostedAudioSourceFact, cast(object, embedding_fact)),
                provider=identity[0],
                source_uid=profile["source_plugin_uid"],
                schema=catalog,
            )
            is None
        )
    else:
        assert (
            xai_source_variant_context(
                cast(HostedXAISourceFact, cast(object, embedding_fact)),
                provider=identity[0],
                source_uid=profile["source_plugin_uid"],
                schema=catalog,
            )
            is None
        )


@pytest.mark.parametrize(
    "model", ["gpt-4o-mini-transcribe-2025-12-15", "gpt-4o-transcribe-diarize", "gpt-4o-mini-tts-2025-12-15"]
)
def test_three_exact_042_source_none_pairs_never_receive_profiles(model: str) -> None:
    profile_id = next(profile_id for profile_id in _AUDIO_IDS if PROFILES_BY_ID[profile_id]["source_model"] == model)
    record = _record(profile_id)
    _variant(record)["source_plugin_uid"] = OPENAI_AUDIO_SOURCE_UIDS["042"]
    _variant(record)["source_profile_id"] = profile_id.replace("110", "042")
    with pytest.raises(ValueError, match="source identity is not reviewed"):
        audio_xai_registry([record])


@pytest.mark.parametrize("profile_id", [_AUDIO_ID, _XAI_ID])
@pytest.mark.parametrize(
    "change",
    [
        "kind",
        "mode",
        "uid",
        "revision",
        "alias",
        "cross_model",
        "operation_missing",
        "operation_extra",
        "operation_duplicate",
        "selector_duplicate",
        "variant_id_duplicate",
        "pool_duplicate",
        "unknown_settings",
        "bool_setting",
        "family",
        "profile",
        "rules",
        "runtime",
        "catalog",
        "endpoint",
    ],
)
def test_declaration_or_finite_restore_rejects_unreviewed_authority(profile_id: str, change: str) -> None:
    record = _record(profile_id)
    variant = _variant(record)
    source = cast(dict[str, object], record["source"])
    settings = cast(dict[str, object], variant["source_settings"])
    target = cast(dict[str, object], variant["target"])
    adapter = cast(dict[str, object], variant["parameter_adapter"])
    if change == "kind":
        source["model_type"] = ModelType.TEXT_EMBEDDING.value
    elif change == "mode":
        source["mode"] = "completion"
    elif change == "uid":
        variant["source_plugin_uid"] = "langgenius/openai:1.1.0@" + "0" * 64
    elif change == "revision":
        adapter["revision"] = "2"
    elif change == "alias":
        target["model"] = str(target["model"]) + "-alias"
    elif change == "cross_model":
        target["model"] = "grok-4.5" if profile_id == _XAI_ID else "tts-1-hd"
    elif change.startswith("operation"):
        operations = cast(list[str], variant["operations"])
        variant["operations"] = (
            operations[:-1]
            if change == "operation_missing"
            else operations + [operations[0] if change == "operation_duplicate" else "unreviewed/invoke"]
        )
    elif change in {"selector_duplicate", "variant_id_duplicate"}:
        duplicate = deepcopy(variant)
        if change == "selector_duplicate":
            duplicate["variant_id"] = str(variant["variant_id"]) + ":different-id"
        cast(list[dict[str, object]], record["variants"]).append(duplicate)
    elif change == "pool_duplicate":
        record["pool_types"] = ["paid", "paid"]
    elif change == "unknown_settings":
        settings["unknown"] = True
    elif change == "bool_setting":
        settings["request_metadata_enabled" if profile_id == _XAI_ID else "request_metadata_behavior"] = 0
    elif change == "family":
        record["schema_version"] = 4 if profile_id == _XAI_ID else 5
    elif change == "profile":
        variant["source_profile_id"] = str(variant["source_profile_id"]) + ":unreviewed"
    elif change == "rules":
        adapter["rules_digest"] = "sha256:" + "0" * 64
    elif change in {"runtime", "catalog"}:
        variant["source_runtime_schema_digest" if change == "runtime" else "source_schema_digest"] = (
            "sha256:" + "0" * 64
        )
    else:
        if profile_id == _XAI_ID:
            variant["source_endpoint_class"] = "unset"
        else:
            settings["source_endpoint_class"] = "custom"
    with pytest.raises(ValueError, match="validation error|source|Source|OpenAI|xAI"):
        _parse_and_restore(record)


def test_new_revision_never_falls_back_and_duplicate_logical_models_are_rejected() -> None:
    records = audio_xai_records()
    with pytest.raises(ValueError, match="Unknown mapping revision"):
        source_mapping_revision(json.dumps(records), REVISION + "-unknown")
    with pytest.raises(ValueError, match="Duplicate source within revision"):
        audio_xai_registry(records + [records[0]])
    for profile_id in (_AUDIO_ID, _XAI_ID):
        with pytest.raises(ValueError, match="Positive source variant facts required"):
            _REGISTRY.resolve(_identity(profile_id), context=None)
