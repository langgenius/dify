"""Pure finite factory policy using only the new lossless local source evidence."""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
from dataclasses import FrozenInstanceError, asdict, fields, replace
from pathlib import Path
from typing import TYPE_CHECKING, Literal

import pytest
from pydantic import TypeAdapter

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services import model_billing_openai_credit_llm_adapter as adapter
from services.entities.model_billing_mapping import (
    SourceParameterContract,
    SourceVariantSettings,
    model_schema_digest,
)
from tests.helpers.unit.model_billing_fixture_shapes import fixture_string
from tests.helpers.unit.model_billing_negative_call import call_invalid
from tests.helpers.unit.model_billing_openai110_artifact_profiles import ArtifactProfile
from tests.helpers.unit.model_billing_openai110_artifact_profiles import cases as _artifact_cases
from tests.helpers.unit.model_billing_openai110_artifact_profiles import verify_factory_case as _verify_artifact_case
from tests.unit_tests.services.model_billing_credit_llm_v2_fixtures import (
    CreditLLMProfile,
    CreditLLMSourceRow,
    ProtocolSelector,
    SourceEndpoint,
    SourceVersion,
)

if TYPE_CHECKING:
    from tests.unit_tests.services.test_model_billing_openai_credit_llm_v2_adapter import (
        _BuildArguments,
        _IdentityArguments,
        _RestoreArguments,
    )

_FIXTURES = Path(__file__).with_name("fixtures")


def _unpack(path: Path) -> tuple[dict[str, object], dict[str, object]]:
    packet = TypeAdapter(dict[str, object]).validate_json(path.read_bytes(), strict=True)
    raw = gzip.decompress(base64.b64decode(fixture_string(packet["payload_base64"]), validate=True))
    assert hashlib.sha256(raw).hexdigest() == packet["raw_sha256"]
    return packet, TypeAdapter(dict[str, object]).validate_json(raw, strict=True)


_PROFILE_PACKET, _DOCUMENT = _unpack(_FIXTURES / "model_billing_openai_credit_llm_profiles.packed.json")
_PROFILES = TypeAdapter(list[CreditLLMProfile]).validate_python(_DOCUMENT["profiles"], strict=True, extra="allow")
_, _MATRIX = _unpack(_FIXTURES / "model_billing_openai_credit_llm_source_matrix.packed.json")
_SOURCE_ROWS = {
    (r["source_version"], r["source_model"]): r
    for r in TypeAdapter(list[CreditLLMSourceRow]).validate_python(
        [
            row
            for row in TypeAdapter(list[dict[str, object]]).validate_python(_MATRIX["rows"], strict=True)
            if row["source_schema_status"] == "source_sdk_schema_positive"
        ],
        strict=True,
        extra="allow",
    )
    if r["source_schema_status"] == "source_sdk_schema_positive"
}
_CONTRACTS = {c.profile_id: c for c in adapter._REVIEWED_CONTRACTS}
_SELECTOR_CASES = [
    (index, selector) for index, profile in enumerate(_PROFILES) for selector in profile["supported_protocol_selectors"]
]


def _settings(profile: CreditLLMProfile, selector: ProtocolSelector) -> SourceVariantSettings:
    return SourceVariantSettings.model_validate({"protocol_selector": selector, **profile["source_settings"]})


def _args(index: int = 0, selector: ProtocolSelector | None = None) -> _BuildArguments:
    profile = _PROFILES[index]
    row = _SOURCE_ROWS[(profile["source_version"], profile["source_model"])]
    return {
        "adapter_id": adapter.OPENAI_CREDIT_LLM_SOURCE_ADAPTER_ID,
        "adapter_revision": "1",
        "expected_rules_digest": _CONTRACTS[profile["profile_id"]].rules_digest,
        "source_provider": adapter.OPENAI_CREDIT_LLM_SOURCE_PROVIDER,
        "source_model": profile["source_model"],
        "source_plugin_unique_identifier": profile["source_plugin_uid"],
        "source_schema": AIModelEntity.model_validate(row["source_catalog_schema"]),
        "expected_source_schema_digest": profile["source_schema_digest"],
        "expected_source_runtime_schema_digest": profile["source_runtime_schema_digest"],
        "target_model": profile["target_model"],
        "source_settings": _settings(profile, selector or profile["supported_protocol_selectors"][0]),
        "source_endpoint_class": profile["source_endpoint_class"],
    }


def _build(
    index: int = 0,
    selector: ProtocolSelector | None = None,
    *,
    source_runtime_schema: AIModelEntity | None = None,
    **changes: object,
) -> adapter.OpenAICreditLLMSourceContract:
    args = _args(index, selector)
    args["source_runtime_schema"] = source_runtime_schema
    if changes:
        return call_invalid(adapter.build_openai_credit_llm_source_contract, **{**args, **changes})
    return adapter.build_openai_credit_llm_source_contract(**args)


def _marker(index: int = 0) -> dict[str, object]:
    profile = _PROFILES[index]
    return adapter.openai_credit_llm_source_marker(
        _CONTRACTS[profile["profile_id"]],
        source_provider=adapter.OPENAI_CREDIT_LLM_SOURCE_PROVIDER,
        source_model=profile["source_model"],
        model_type=ModelType.LLM,
        target_model=profile["target_model"],
    )


def _restore(
    index: int = 0,
    marker: object = None,
    selector: ProtocolSelector | None = None,
    *,
    source_runtime_schema: AIModelEntity | None = None,
    **changes: object,
) -> adapter.OpenAICreditLLMSourceContract:
    build = _args(index, selector)
    args: _RestoreArguments = {
        "source_provider": build["source_provider"],
        "source_model": build["source_model"],
        "target_model": build["target_model"],
        "source_settings": build["source_settings"],
        "source_endpoint_class": build["source_endpoint_class"],
        "expected_source_runtime_schema_digest": build["expected_source_runtime_schema_digest"],
        "model_type": ModelType.LLM,
        "source_runtime_schema": source_runtime_schema,
    }
    if changes:
        return call_invalid(
            adapter.restore_openai_credit_llm_source_contract,
            _marker(index) if marker is None else marker,
            **{**args, **changes},
        )
    return adapter.restore_openai_credit_llm_source_contract(_marker(index) if marker is None else marker, **args)


def test_real_128_profiles_exact_32_positive_pairs_and_no_extra_contract_fields() -> None:
    assert _PROFILE_PACKET["raw_sha256"] == adapter._PROFILE_DOCUMENT_RAW_SHA256
    assert len(_PROFILES) == len(_CONTRACTS) == 128
    assert len(_SOURCE_ROWS) == 32
    assert len(_SELECTOR_CASES) == 192
    assert len(adapter.OPENAI_CREDIT_LLM_SOURCE_MODELS) == 20
    assert {(p["source_version"], p["source_model"]) for p in _PROFILES} == set(_SOURCE_ROWS)
    assert {f.name for f in fields(adapter.OpenAICreditLLMSourceContract)} == {
        f.name for f in fields(SourceParameterContract)
    }
    assert all(type(c) is adapter.OpenAICreditLLMSourceContract for c in _CONTRACTS.values())


@pytest.mark.parametrize(("index", "selector"), _SELECTOR_CASES)
def test_all_192_selectors_build_marker_restore_and_optional_observed_runtime(
    index: int, selector: ProtocolSelector
) -> None:
    profile = _PROFILES[index]
    expected = _CONTRACTS[profile["profile_id"]]
    actual = _build(index, selector)
    assert actual == expected == _restore(index, selector=selector)
    row = _SOURCE_ROWS[(profile["source_version"], profile["source_model"])]
    runtime = AIModelEntity.model_validate(row["source_daemon_schema"])
    assert _build(index, selector, source_runtime_schema=runtime) == expected
    assert _restore(index, selector=selector, source_runtime_schema=runtime) == expected
    assert set(_marker(index)) == {
        "schema_version",
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
    }


@pytest.mark.parametrize("index", range(128))
def test_each_literal_canonical_rules_and_three_schema_boundaries_are_exact(index: int) -> None:
    profile = _PROFILES[index]
    contract = _CONTRACTS[profile["profile_id"]]
    row = _SOURCE_ROWS[(profile["source_version"], profile["source_model"])]
    rules = (
        "sha256:"
        + hashlib.sha256(
            json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )
    assert contract.rules_digest == rules
    assert contract.source_schema_digest == row["source_schema_digest"]
    assert contract.source_runtime_schema_digest == row["daemon_runtime_schema_digest"]
    assert contract.source_runtime_schema_digest != row["core_runtime_schema_digest"]
    assert contract.adapter_id == profile["adapter_id"] == "openai_credit_llm_source_v1"
    assert contract.algorithm_revision == profile["adapter_revision"] == "1"
    assert (
        model_schema_digest(AIModelEntity.model_validate(row["source_catalog_schema"])) == contract.source_schema_digest
    )
    assert (
        model_schema_digest(AIModelEntity.model_validate(profile["source_daemon_schema"]))
        == contract.source_runtime_schema_digest
    )
    assert profile["source_endpoint_class"] in {"unset", "official_root"}
    assert profile["source_settings"] == {
        "source_base_is_set": profile["source_endpoint_class"] == "official_root",
        "request_metadata_enabled": False,
    }


@pytest.mark.parametrize(
    ("version", "selector", "expected"),
    [
        ("042", "absent", "chat"),
        ("042", "chat", "chat"),
        ("042", "responses", "responses"),
        ("110", "absent", "responses"),
        ("110", "chat", "chat"),
        ("110", "responses", "responses"),
    ],
)
@pytest.mark.parametrize("endpoint", ["unset", "official_root"])
def test_uid_specific_default_and_positive_endpoint_fact(
    version: SourceVersion, selector: ProtocolSelector, expected: Literal["chat", "responses"], endpoint: SourceEndpoint
) -> None:
    assert (
        adapter.openai_credit_llm_protocol(
            source_plugin_unique_identifier=adapter.OPENAI_CREDIT_LLM_SOURCE_UIDS[version],
            source_settings=SourceVariantSettings(
                protocol_selector=selector,
                source_base_is_set=endpoint == "official_root",
                request_metadata_enabled=False,
            ),
            source_endpoint_class=endpoint,
        )
        == expected
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"protocol_selector": None},
        {"protocol_selector": "unknown"},
        {"protocol_selector": True},
        {"source_base_is_set": 1},
        {"source_base_is_set": None},
        {"request_metadata_enabled": True},
        {"request_metadata_enabled": 0},
        {"request_metadata_enabled": None},
    ],
)
def test_bypassed_or_malformed_settings_are_not_positive_facts(changes: dict[str, object]) -> None:
    values: dict[str, object] = {
        "protocol_selector": "chat",
        "source_base_is_set": False,
        "request_metadata_enabled": False,
        **changes,
    }
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
        adapter.openai_credit_llm_protocol(
            source_plugin_unique_identifier=adapter.OPENAI_CREDIT_LLM_SOURCE_UIDS["042"],
            source_settings=call_invalid(
                SourceVariantSettings.model_construct,
                protocol_selector=values["protocol_selector"],
                source_base_is_set=values["source_base_is_set"],
                request_metadata_enabled=values["request_metadata_enabled"],
            ),
            source_endpoint_class="unset",
        )


@pytest.mark.parametrize("settings", [None, {}, True, "chat"])
def test_other_settings_types_are_never_inferred(settings: object) -> None:
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
        _build(source_settings=settings)


@pytest.mark.parametrize("missing", ["protocol_selector", "source_base_is_set", "request_metadata_enabled"])
def test_model_construct_missing_positive_fact_is_rejected(missing: str) -> None:
    values = {
        "protocol_selector": "chat",
        "source_base_is_set": False,
        "request_metadata_enabled": False,
    }
    del values[missing]
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
        _build(source_settings=call_invalid(SourceVariantSettings.model_construct, **values))


@pytest.mark.parametrize(
    "endpoint",
    [None, "unreviewed", "custom", "https://secret-endpoint.invalid", True, 1],
)
def test_unknown_endpoint_classes_never_authorize_a_contract(endpoint: object) -> None:
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError) as error:
        _build(source_endpoint_class=endpoint)
    assert "secret-endpoint" not in str(error.value)


@pytest.mark.parametrize("index", [0, 1, 2, 3, 60, 61, 62, 63, 124, 125, 126, 127])
def test_endpoint_boolean_or_protocol_drift_rejected_in_build_and_restore(index: int) -> None:
    profile = _PROFILES[index]
    settings = _settings(profile, "responses" if profile["protocol"] == "chat" else "chat")
    for method in (_build, _restore):
        with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
            method(index, source_settings=settings)
        with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
            method(
                index,
                source_endpoint_class="unset"
                if profile["source_endpoint_class"] == "official_root"
                else "official_root",
            )


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("adapter_id", "openai_chat_source_v1"),
        ("adapter_id", "openai_provider110_source_v1"),
        ("adapter_id", "openai_provider042_source_v1"),
        ("adapter_revision", "2"),
        ("source_provider", "openai"),
        ("source_model", "gpt-4.1-nano"),
        (
            "source_plugin_unique_identifier",
            adapter.OPENAI_CREDIT_LLM_SOURCE_UIDS["042"] + "changed",
        ),
        ("target_model", "gpt-5"),
        ("expected_source_schema_digest", "sha256:" + "0" * 64),
        ("expected_rules_digest", "sha256:" + "0" * 64),
        ("expected_rules_digest", "not-a-digest"),
        ("expected_rules_digest", "秘密"),
        ("expected_rules_digest", None),
        ("expected_source_runtime_schema_digest", "sha256:" + "0" * 64),
        ("expected_source_runtime_schema_digest", None),
    ],
)
def test_build_revalidates_every_identity_family_and_independent_pin(key: str, value: object) -> None:
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
        call_invalid(_build, **{key: value})


@pytest.mark.parametrize(
    "kind",
    [
        "model",
        "type",
        "string_type",
        "mode",
        "catalog_as_runtime",
        "sdk_as_runtime",
        "runtime_as_catalog",
        "missing_schema",
    ],
)
def test_schema_boundaries_and_model_type_mode_must_match(kind: str) -> None:
    profile = _PROFILES[0]
    row = _SOURCE_ROWS[(profile["source_version"], profile["source_model"])]
    catalog = AIModelEntity.model_validate(row["source_catalog_schema"])
    schema: AIModelEntity | None = catalog
    source_runtime_schema: AIModelEntity | None = None
    if kind == "model":
        schema = catalog.model_copy(update={"model": "gpt-5"})
    elif kind == "type":
        schema = catalog.model_copy(update={"model_type": ModelType.TEXT_EMBEDDING})
    elif kind == "string_type":
        schema = catalog.model_copy(update={"model_type": "llm"})
    elif kind == "mode":
        schema = catalog.model_copy(update={"model_properties": {"mode": "completion"}})
    elif kind == "catalog_as_runtime":
        source_runtime_schema = schema
    elif kind == "sdk_as_runtime":
        source_runtime_schema = AIModelEntity.model_validate(row["source_schema"])
    elif kind == "runtime_as_catalog":
        schema = AIModelEntity.model_validate(row["source_daemon_schema"])
    else:
        schema = None
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
        _build(source_schema=schema, source_runtime_schema=source_runtime_schema)


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
@pytest.mark.parametrize("value", ["changed", "秘密", None, True])
def test_closed_six_field_marker_rejects_changed_values_without_unicode_type_errors(key: str, value: object) -> None:
    marker = _marker()
    marker[key] = value
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
        _restore(marker=marker)


def test_marker_omission_foreign_dataclass_or_runtime_pin_forgery_is_not_authority() -> None:
    marker = _marker()
    del marker["rules_digest"]
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
        _restore(marker=marker)
    contract = next(iter(_CONTRACTS.values()))
    for forged in (
        SourceParameterContract(**asdict(contract)),
        replace(contract, source_runtime_schema_digest="sha256:" + "0" * 64),
    ):
        with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
            call_invalid(
                adapter.openai_credit_llm_source_marker,
                forged,
                source_provider=adapter.OPENAI_CREDIT_LLM_SOURCE_PROVIDER,
                source_model=contract.source_model,
                model_type=ModelType.LLM,
                target_model=contract.target_model,
            )
    target_field = "target_model"
    with pytest.raises(FrozenInstanceError):
        setattr(contract, target_field, "gpt-5")
    with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
        _restore(expected_source_runtime_schema_digest="sha256:" + "0" * 64)


@pytest.mark.parametrize("version", ["042", "110"])
@pytest.mark.parametrize("model", sorted(adapter.OPENAI_CREDIT_LLM_SOURCE_MODELS))
def test_exact_32_positive_identity_pairs_and_only_two_reviewed_aliases(version: SourceVersion, model: str) -> None:
    target = (
        {"gpt-5-2025-08-07": "gpt-5", "gpt-5-mini-2025-08-07": "gpt-5-mini"}.get(model, model)
        if version == "042"
        else model
    )
    args: _IdentityArguments = {
        "source_provider": adapter.OPENAI_CREDIT_LLM_SOURCE_PROVIDER,
        "source_model": model,
        "source_plugin_unique_identifier": adapter.OPENAI_CREDIT_LLM_SOURCE_UIDS[version],
        "model_type": ModelType.LLM,
        "target_model": target,
    }
    if (version, model) in _SOURCE_ROWS:
        adapter.validate_openai_credit_llm_identity(**args)
    else:
        with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
            adapter.validate_openai_credit_llm_identity(**args)
    if target != model:
        unreviewed: _IdentityArguments = {**args, "target_model": model}
        with pytest.raises(adapter.OpenAICreditLLMSourceAdapterError):
            adapter.validate_openai_credit_llm_identity(**unreviewed)


def test_dated_marker_keeps_source_identity_even_when_target_uses_reviewed_alias() -> None:
    cases = [i for i, p in enumerate(_PROFILES) if p["source_model"] != p["target_model"]]
    assert len(cases) == 8
    for index in cases:
        profile = _PROFILES[index]
        assert profile["source_version"] == "042"
        assert _marker(index)["source_model"] == profile["source_model"]
        assert _build(index).target_model == profile["target_model"]


@pytest.mark.parametrize(
    ("row", "selector", "endpoint"),
    _artifact_cases("credit_llm_v1"),
    ids=[r["profile_id"] + "|" + s + "|" + e for r, s, e in _artifact_cases("credit_llm_v1")],
)
def test_exact1ded_additive_factory_marker_restore_and_cross_uid_denials(
    row: ArtifactProfile, selector: str, endpoint: str
) -> None:
    _verify_artifact_case("credit_llm_v1", row, selector, endpoint)
