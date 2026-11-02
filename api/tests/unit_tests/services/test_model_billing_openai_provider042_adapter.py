"""Exact source042 gpt55 rules, schema layers and immutable marker guards."""

import hashlib
import json
from dataclasses import FrozenInstanceError, replace
from pathlib import Path
from typing import Literal, TypedDict, Unpack, cast

import pytest

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_mapping import model_schema_digest
from services.model_billing_openai_provider042_adapter import (
    _REVIEWED_CONTRACTS,
    OPENAI_PROVIDER042_SOURCE_ADAPTER_ID,
    OPENAI_PROVIDER042_SOURCE_PROVIDER,
    OPENAI_PROVIDER042_SOURCE_UID,
    OpenAI042SourceSettings,
    OpenAIProvider042SourceAdapterError,
    OpenAIProvider042SourceContract,
    build_openai_provider042_source_contract,
    openai_provider042_protocol,
    openai_provider042_source_marker,
    restore_openai_provider042_source_contract,
    validate_openai_provider042_identity,
)
from services.model_billing_openai_provider110_adapter import OpenAI110SourceSettings

_FIXTURE = Path(__file__).parent / "fixtures/model_billing_openai_provider042_profiles.json"
_PROFILES = json.loads(_FIXTURE.read_text())["profiles"]
type Selector = Literal["absent", "chat", "responses"]


def _marker(index: int) -> dict[str, object]:
    return openai_provider042_source_marker(
        _REVIEWED_CONTRACTS[index],
        source_provider=OPENAI_PROVIDER042_SOURCE_PROVIDER,
        source_model="gpt-5.5",
        model_type=ModelType.LLM,
        target_model="gpt-5.5",
    )


class BuildOverrides(TypedDict, total=False):
    adapter_id: str
    adapter_revision: str
    expected_rules_digest: str
    source_provider: str
    source_model: str
    source_plugin_unique_identifier: str
    source_schema: AIModelEntity
    expected_source_schema_digest: str
    target_model: str
    source_settings: OpenAI042SourceSettings


def _build(index: int, selector: Selector, **overrides: Unpack[BuildOverrides]) -> OpenAIProvider042SourceContract:
    profile, contract = _PROFILES[index], _REVIEWED_CONTRACTS[index]
    return build_openai_provider042_source_contract(
        adapter_id=overrides.get("adapter_id", OPENAI_PROVIDER042_SOURCE_ADAPTER_ID),
        adapter_revision=overrides.get("adapter_revision", "1"),
        expected_rules_digest=overrides.get("expected_rules_digest", contract.rules_digest),
        source_provider=overrides.get("source_provider", OPENAI_PROVIDER042_SOURCE_PROVIDER),
        source_model=overrides.get("source_model", "gpt-5.5"),
        source_plugin_unique_identifier=overrides.get("source_plugin_unique_identifier", OPENAI_PROVIDER042_SOURCE_UID),
        source_schema=overrides.get("source_schema", AIModelEntity.model_validate(profile["source_catalog_schema"])),
        expected_source_schema_digest=overrides.get("expected_source_schema_digest", contract.source_schema_digest),
        target_model=overrides.get("target_model", "gpt-5.5"),
        source_settings=overrides.get("source_settings", OpenAI042SourceSettings(selector, index in {1, 3}, False)),
    )


@pytest.mark.parametrize(
    ("index", "selector"), [(0, "absent"), (0, "chat"), (1, "absent"), (1, "chat"), (2, "responses"), (3, "responses")]
)
def test_all_six_exact_source_selectors_build_and_restore(index: int, selector: Selector) -> None:
    assert _build(index, selector) == _REVIEWED_CONTRACTS[index]
    assert (
        restore_openai_provider042_source_contract(
            _marker(index),
            source_provider=OPENAI_PROVIDER042_SOURCE_PROVIDER,
            source_model="gpt-5.5",
            model_type=ModelType.LLM,
            target_model="gpt-5.5",
            source_settings=OpenAI042SourceSettings(selector, index in {1, 3}, False),
        )
        == _REVIEWED_CONTRACTS[index]
    )
    assert len(_marker(index)) == 6


@pytest.mark.parametrize("index", range(4))
def test_lossless_rules_catalog_and_runtime_evidence_are_separate(index: int) -> None:
    profile, contract = _PROFILES[index], _REVIEWED_CONTRACTS[index]
    assert hashlib.sha256(_FIXTURE.read_bytes()).hexdigest() == (
        "5a125649dbf4f85745719b5bd7b7cf0a01d54da960eb4829920e59cbdbce2421"
    )
    assert (
        contract.rules_digest
        == "sha256:"
        + hashlib.sha256(
            json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )
    assert (
        model_schema_digest(AIModelEntity.model_validate(profile["source_catalog_schema"]))
        == contract.source_schema_digest
    )
    assert (
        model_schema_digest(AIModelEntity.model_validate(profile["source_schema"]))
        == contract.source_runtime_schema_digest
    )
    assert contract.source_schema_digest != contract.source_runtime_schema_digest
    assert contract.source_runtime_schema_digest != profile["source_codec_schema_digest"]
    assert profile["adapter_id"] == contract.adapter_id
    assert profile["adapter_revision"] == contract.algorithm_revision
    assert profile["source_settings"]["request_metadata_enabled"] is False
    assert profile["codec_rules"]["transport"]["max_retries"] == 0
    assert profile["codec_rules"]["transport"]["follow_redirects"] is False
    with pytest.raises(OpenAIProvider042SourceAdapterError):
        _build(
            index,
            "responses" if index >= 2 else "chat",
            source_schema=AIModelEntity.model_validate(profile["source_schema"]),
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("adapter_id", "openai_chat_source_v1"),
        ("adapter_id", "openai_provider110_source_v1"),
        ("adapter_revision", "2"),
        ("source_provider", "openai"),
        ("source_model", "gpt-4o-mini"),
        ("target_model", "gpt-4o-mini"),
        ("source_plugin_unique_identifier", OPENAI_PROVIDER042_SOURCE_UID + "changed"),
        ("expected_source_schema_digest", "sha256:" + "a" * 64),
        ("expected_rules_digest", "sha256:" + "a" * 64),
    ],
)
def test_build_revalidates_every_source_identity_and_profile_binding(field: str, value: str) -> None:
    with pytest.raises(OpenAIProvider042SourceAdapterError):
        _build(0, "absent", **cast(BuildOverrides, {field: value}))


@pytest.mark.parametrize("index", range(4))
@pytest.mark.parametrize("change", ["protocol", "base", "metadata"])
def test_settings_cannot_cross_profile_semantics(index: int, change: str) -> None:
    selector: Selector = "responses" if index >= 2 else "chat"
    settings = OpenAI042SourceSettings(
        ("chat" if selector == "responses" else "responses") if change == "protocol" else selector,
        index not in {1, 3} if change == "base" else index in {1, 3},
        change == "metadata",
    )
    with pytest.raises(OpenAIProvider042SourceAdapterError):
        _build(index, selector, source_settings=settings)
    with pytest.raises(OpenAIProvider042SourceAdapterError):
        restore_openai_provider042_source_contract(
            _marker(index),
            source_provider=OPENAI_PROVIDER042_SOURCE_PROVIDER,
            source_model="gpt-5.5",
            model_type=ModelType.LLM,
            target_model="gpt-5.5",
            source_settings=settings,
        )


@pytest.mark.parametrize(
    "key",
    [
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
        "schema_version",
        "extra",
    ],
)
def test_marker_cannot_omit_or_change_any_binding(key: str) -> None:
    marker = _marker(0)
    marker[key] = "changed"
    with pytest.raises(OpenAIProvider042SourceAdapterError):
        restore_openai_provider042_source_contract(
            marker,
            source_provider=OPENAI_PROVIDER042_SOURCE_PROVIDER,
            source_model="gpt-5.5",
            model_type=ModelType.LLM,
            target_model="gpt-5.5",
            source_settings=OpenAI042SourceSettings("absent", False, False),
        )


def test_arbitrary_contract_or_marker_type_is_not_authority() -> None:
    settings = OpenAI042SourceSettings("absent", False, False)
    field = "protocol_selector"
    with pytest.raises(FrozenInstanceError):
        setattr(settings, field, "responses")
    forged = replace(_REVIEWED_CONTRACTS[0], source_runtime_schema_digest="sha256:" + "a" * 64)
    with pytest.raises(OpenAIProvider042SourceAdapterError):
        openai_provider042_source_marker(
            forged,
            source_provider=OPENAI_PROVIDER042_SOURCE_PROVIDER,
            source_model="gpt-5.5",
            model_type=ModelType.LLM,
            target_model="gpt-5.5",
        )
    marker = _marker(0)
    marker["schema_version"] = True
    with pytest.raises(OpenAIProvider042SourceAdapterError):
        restore_openai_provider042_source_contract(
            marker,
            source_provider=OPENAI_PROVIDER042_SOURCE_PROVIDER,
            source_model="gpt-5.5",
            model_type=ModelType.LLM,
            target_model="gpt-5.5",
            source_settings=settings,
        )


def test_malformed_source_schema_is_not_a_catalog_or_runtime_proof() -> None:
    with pytest.raises(OpenAIProvider042SourceAdapterError, match="source schema is not reviewed"):
        _build(0, "absent", source_schema=cast(AIModelEntity, None))


@pytest.mark.parametrize(("selector", "expected"), [("absent", "chat"), ("chat", "chat"), ("responses", "responses")])
@pytest.mark.parametrize("base", [False, True])
def test_source042_literal_protocol_default_is_not_source110_default(
    selector: Literal["absent", "chat", "responses"], expected: str, base: bool
) -> None:
    assert openai_provider042_protocol(OpenAI042SourceSettings(selector, base, False)) == expected
    validate_openai_provider042_identity(
        source_provider=OPENAI_PROVIDER042_SOURCE_PROVIDER,
        source_model="gpt-5.5",
        source_plugin_unique_identifier=OPENAI_PROVIDER042_SOURCE_UID,
        model_type=ModelType.LLM,
        target_model="gpt-5.5",
    )


@pytest.mark.parametrize("selector", [None, False, "", "unknown"])
def test_source042_unknown_or_missing_positive_selector_is_not_absence(selector: object) -> None:
    with pytest.raises(OpenAIProvider042SourceAdapterError):
        openai_provider042_protocol(OpenAI042SourceSettings(selector, False, False))  # type: ignore[arg-type]


@pytest.mark.parametrize("change", ["base", "metadata", "family"])
def test_source042_settings_reject_coercion_metadata_or_another_family(change: str) -> None:
    settings = OpenAI042SourceSettings("absent", False, False)
    if change == "base":
        settings = OpenAI042SourceSettings("absent", 0, False)  # type: ignore[arg-type]
    elif change == "metadata":
        settings = OpenAI042SourceSettings("absent", False, True)
    else:
        with pytest.raises(OpenAIProvider042SourceAdapterError):
            openai_provider042_protocol(OpenAI110SourceSettings("absent", False, False))  # type: ignore[arg-type]
        return
    with pytest.raises(OpenAIProvider042SourceAdapterError):
        openai_provider042_protocol(settings)


@pytest.mark.parametrize("change", ["provider", "uid", "model", "type", "target"])
def test_new_family_cannot_relabel_another_model_or_source(change: str) -> None:
    with pytest.raises(OpenAIProvider042SourceAdapterError):
        validate_openai_provider042_identity(
            source_provider="openai" if change == "provider" else OPENAI_PROVIDER042_SOURCE_PROVIDER,
            source_model="gpt-4o-mini" if change == "model" else "gpt-5.5",
            source_plugin_unique_identifier=OPENAI_PROVIDER042_SOURCE_UID + "changed"
            if change == "uid"
            else OPENAI_PROVIDER042_SOURCE_UID,
            model_type=ModelType.TEXT_EMBEDDING if change == "type" else ModelType.LLM,
            target_model="gpt-4o-mini" if change == "target" else "gpt-5.5",
        )
