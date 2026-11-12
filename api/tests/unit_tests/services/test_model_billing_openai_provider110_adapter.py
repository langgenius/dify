"""Pure immutable OpenAI1.1.0 source binding; no model/DB/network calls."""

import hashlib
import json
from dataclasses import FrozenInstanceError, replace
from pathlib import Path
from typing import Literal, cast

import pytest
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_mapping import model_schema_digest
from services.model_billing_openai_provider110_adapter import (
    _REVIEWED_CONTRACTS,
    OPENAI_PROVIDER110_SOURCE_ADAPTER_ID,
    OPENAI_PROVIDER110_SOURCE_PROVIDER,
    OpenAI110SourceSettings,
    OpenAIProvider110SourceAdapterError,
    OpenAIProvider110SourceContract,
    build_openai_provider110_source_contract,
    openai_provider110_source_marker,
    restore_openai_provider110_source_contract,
)
from tests.helpers.unit.model_billing_openai110_artifact_profiles import ArtifactProfile
from tests.helpers.unit.model_billing_openai110_artifact_profiles import cases as _artifact_cases
from tests.helpers.unit.model_billing_openai110_artifact_profiles import verify_factory_case as _verify_artifact_case

_DOCUMENT = json.loads((Path(__file__).parent / "fixtures/model_billing_openai_provider110_profiles.json").read_text())
_PROFILES = cast(list[dict[str, object]], _DOCUMENT["profiles"])
Selector = Literal["absent", "chat", "responses"]


class Mutation(TypedDict, total=False, closed=True):
    uid: str
    rules: str
    catalog_digest: str
    target: str
    provider: str
    model: str
    revision: str
    adapter: str


def build(
    index: int,
    selector: Selector,
    *,
    base: bool = False,
    metadata: bool = False,
    uid: str | None = None,
    rules: str | None = None,
    catalog_digest: str | None = None,
    schema: AIModelEntity | None = None,
    target: str = "gpt-4o-mini",
    provider: str = OPENAI_PROVIDER110_SOURCE_PROVIDER,
    model: str = "gpt-4o-mini",
    revision: str = "1",
    adapter: str = OPENAI_PROVIDER110_SOURCE_ADAPTER_ID,
) -> OpenAIProvider110SourceContract:
    profile, contract = _PROFILES[index], _REVIEWED_CONTRACTS[index]
    return build_openai_provider110_source_contract(
        adapter_id=adapter,
        adapter_revision=revision,
        expected_rules_digest=rules or contract.rules_digest,
        source_provider=provider,
        source_model=model,
        source_plugin_unique_identifier=uid or contract.source_plugin_unique_identifier,
        source_schema=schema or AIModelEntity.model_validate(profile["source_catalog_schema"]),
        expected_source_schema_digest=catalog_digest or contract.source_schema_digest,
        target_model=target,
        source_settings=OpenAI110SourceSettings(selector, base, metadata),
    )


def marker(index: int) -> dict[str, object]:
    return openai_provider110_source_marker(
        _REVIEWED_CONTRACTS[index],
        source_provider=OPENAI_PROVIDER110_SOURCE_PROVIDER,
        source_model="gpt-4o-mini",
        model_type=ModelType.LLM,
        target_model="gpt-4o-mini",
    )


@pytest.mark.parametrize(("index", "selector"), [(0, "chat"), (1, "absent"), (1, "responses")])
def test_available_typed_facts_choose_only_reviewed_exact_source_protocol(index: int, selector: Selector) -> None:
    assert build(index, selector) == _REVIEWED_CONTRACTS[index]
    assert (
        restore_openai_provider110_source_contract(
            marker(index),
            source_provider=OPENAI_PROVIDER110_SOURCE_PROVIDER,
            source_model="gpt-4o-mini",
            model_type=ModelType.LLM,
            target_model="gpt-4o-mini",
            source_settings=OpenAI110SourceSettings(selector, False, False),
        )
        == _REVIEWED_CONTRACTS[index]
    )
    assert len(marker(index)) == 6


@pytest.mark.parametrize(("index", "selector"), [(0, "absent"), (0, "responses"), (1, "chat")])
def test_no_silent_default_or_protocol_coercion(index: int, selector: Selector) -> None:
    with pytest.raises(OpenAIProvider110SourceAdapterError):
        build(index, selector)
    with pytest.raises(OpenAIProvider110SourceAdapterError):
        restore_openai_provider110_source_contract(
            marker(index),
            source_provider=OPENAI_PROVIDER110_SOURCE_PROVIDER,
            source_model="gpt-4o-mini",
            model_type=ModelType.LLM,
            target_model="gpt-4o-mini",
            source_settings=OpenAI110SourceSettings(selector, False, False),
        )


@pytest.mark.parametrize(("base", "metadata"), [(True, False), (False, True), (True, True)])
@pytest.mark.parametrize(("index", "selector"), [(0, "chat"), (1, "absent")])
def test_unknown_source_identity_or_metadata_mode_denies_managed_path(
    index: int, selector: Selector, base: bool, metadata: bool
) -> None:
    with pytest.raises(OpenAIProvider110SourceAdapterError):
        build(index, selector, base=base, metadata=metadata)


@pytest.mark.parametrize("selector", [None, "default_chat", "", False, [], {}])
def test_unavailable_or_malformed_protocol_is_not_literal_absent(selector: object) -> None:
    with pytest.raises(OpenAIProvider110SourceAdapterError):
        build(1, cast(Selector, selector))


def test_settings_are_frozen_and_require_both_boolean_facts() -> None:
    settings = OpenAI110SourceSettings("absent", False, False)
    field = "protocol_selector"
    with pytest.raises(FrozenInstanceError):
        setattr(settings, field, "chat")
    with pytest.raises(TypeError):
        OpenAI110SourceSettings("absent")  # type: ignore[missing-argument]
    with pytest.raises(OpenAIProvider110SourceAdapterError):
        build(1, "absent", base=cast(bool, 0))


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("uid", "langgenius/openai:0.4.2@" + "a" * 64),
        ("uid", "langgenius/openai:1.1.0@" + "a" * 64),
        ("rules", "sha256:" + "a" * 64),
        ("catalog_digest", "sha256:" + "a" * 64),
        ("target", "gpt-4o"),
        ("provider", "langgenius/anthropic/anthropic"),
        ("model", "gpt-4o"),
        ("revision", "2"),
        ("adapter", "identity_v1"),
    ],
)
def test_every_binding_dimension_is_exact(name: str, value: str) -> None:
    arguments = cast(Mutation, {name: value})
    with pytest.raises(OpenAIProvider110SourceAdapterError):
        build(1, "absent", **arguments)


@pytest.mark.parametrize("index", [0, 1])
def test_actual_catalog_runtime_and_rules_body_are_independent_immutable_evidence(index: int) -> None:
    profile, contract = _PROFILES[index], _REVIEWED_CONTRACTS[index]
    assert model_schema_digest(AIModelEntity.model_validate(profile["source_catalog_schema"])) == (
        contract.source_schema_digest
    )
    assert model_schema_digest(AIModelEntity.model_validate(profile["source_schema"])) == (
        contract.source_runtime_schema_digest
    )
    assert contract.source_schema_digest != contract.source_runtime_schema_digest
    assert (
        contract.rules_digest
        == "sha256:"
        + hashlib.sha256(
            json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )
    with pytest.raises(OpenAIProvider110SourceAdapterError):
        build(index, "chat" if index == 0 else "absent", schema=AIModelEntity.model_validate(profile["source_schema"]))


@pytest.mark.parametrize(
    "key", ["profile_id", "source_plugin_uid", "source_model", "source_schema_digest", "rules_digest", "schema_version"]
)
def test_restore_revalidates_every_marker_field(key: str) -> None:
    value = marker(1)
    value[key] = "wrong"
    with pytest.raises(OpenAIProvider110SourceAdapterError):
        restore_openai_provider110_source_contract(
            value,
            source_provider=OPENAI_PROVIDER110_SOURCE_PROVIDER,
            source_model="gpt-4o-mini",
            model_type=ModelType.LLM,
            target_model="gpt-4o-mini",
            source_settings=OpenAI110SourceSettings("absent", False, False),
        )


def test_constructed_contract_cannot_add_unreviewed_profile_or_runtime_hash() -> None:
    invalid = replace(_REVIEWED_CONTRACTS[1], source_runtime_schema_digest="sha256:" + "a" * 64)
    with pytest.raises(OpenAIProvider110SourceAdapterError):
        openai_provider110_source_marker(
            invalid,
            source_provider=OPENAI_PROVIDER110_SOURCE_PROVIDER,
            source_model="gpt-4o-mini",
            model_type=ModelType.LLM,
            target_model="gpt-4o-mini",
        )


@pytest.mark.parametrize(
    ("row", "selector", "endpoint"),
    _artifact_cases("provider110"),
    ids=[r["profile_id"] + "|" + s + "|" + e for r, s, e in _artifact_cases("provider110")],
)
def test_exact1ded_additive_factory_marker_restore_and_cross_uid_denials(
    row: ArtifactProfile, selector: str, endpoint: str
) -> None:
    _verify_artifact_case("provider110", row, selector, endpoint)
