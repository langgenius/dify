"""Synthetic V8 shapes only; never a reviewed SDK/profile or release packet."""

import hashlib
import json
from copy import deepcopy
from dataclasses import FrozenInstanceError
from typing import cast

import pytest
from pydantic import ValidationError
from typing_extensions import TypedDict

from services.entities.model_billing_gemini_mapping import (
    GEMINI_SOURCE_EMBEDDING_MODELS,
    GEMINI_SOURCE_LLM_MODELS,
    GEMINI_SOURCE_UID,
    SourceGeminiVariantMapping,
    gemini_source_model_type,
    gemini_source_operations,
)
from services.entities.model_billing_gemini_v8_mapping import (
    GEMINI_0913_SOURCE_UID,
    SelectedGeminiV8SourceVariant,
    SourceGeminiV8VariantMapping,
    SourceGeminiV8VariantSelection,
)
from tests.helpers.unit.model_billing_gemini_profiles import profiles, variant_record


class SyntheticAdapter(TypedDict):
    id: str
    revision: str
    rules_digest: str


class SyntheticTarget(TypedDict):
    plugin_id: str
    provider: str
    model_type: str
    model: str
    catalog_revision: str
    minimum_plugin_version: str


class SyntheticVariant(TypedDict):
    variant_id: str
    source_plugin_uid: str
    source_settings: dict[str, str]
    source_schema_digest: str
    source_runtime_schema_digest: str
    source_profile_id: str
    parameter_adapter: SyntheticAdapter
    target: SyntheticTarget
    operations: list[str]
    conformance_fixture_ids: list[str]


class SyntheticRecord(TypedDict):
    schema_version: int
    mapping_revision: str
    source: dict[str, str]
    settlement_owner: str
    pool_types: list[str]
    variants: list[SyntheticVariant]


def synthetic_record(model: str = "gemini-2.5-flash") -> SyntheticRecord:
    kind = gemini_source_model_type(model)
    llm = model in GEMINI_SOURCE_LLM_MODELS
    settings = (
        {
            "source_base_policy": "unset_or_exact_google_root",
            "request_metadata_policy": "system_false_only",
            "file_url_policy": "actual_system_absent_or_empty_only",
        }
        if llm
        else {"source_base_policy": "not_used", "request_metadata_policy": "not_used", "file_url_policy": "not_used"}
    )
    return {
        "schema_version": 8,
        "mapping_revision": "synthetic-v8-shape-not-published",
        "source": {
            "provider_id": "langgenius/gemini/google",
            "model_type": kind.value,
            "model": model,
            "mode": "chat" if llm else "text-embedding",
        },
        "settlement_owner": "shared_credit_pool",
        "pool_types": ["paid", "trial"],
        "variants": [
            {
                "variant_id": f"synthetic-{version}-{model}",
                "source_plugin_uid": uid,
                "source_settings": deepcopy(settings),
                # Syntax examples, not real source or target digest evidence.
                "source_schema_digest": "sha256:" + "a" * 64,
                "source_runtime_schema_digest": "sha256:" + "b" * 64,
                "source_profile_id": f"gemini{version}-native-v1:{model}",
                "parameter_adapter": {"id": adapter, "revision": "1", "rules_digest": "sha256:" + "c" * 64},
                "target": {
                    "plugin_id": "langgenius/tokener",
                    "provider": "tokener",
                    "model_type": kind.value,
                    "model": model,
                    "catalog_revision": "synthetic-not-a-live-catalog",
                    "minimum_plugin_version": "0.0.0.dev0",
                },
                "operations": sorted(gemini_source_operations(model)),
                "conformance_fixture_ids": ["synthetic-shape-only"],
            }
            for version, uid, adapter in (
                ("0912", GEMINI_SOURCE_UID, "gemini_credit_source_v1"),
                ("0913", GEMINI_0913_SOURCE_UID, "gemini_credit_source_v2"),
            )
        ],
    }


def selection(record: SyntheticRecord) -> dict[str, object]:
    row = record["variants"][0]
    return {
        "schema_version": 8,
        **{
            key: row[key]
            for key in (
                "variant_id",
                "source_plugin_uid",
                "source_settings",
                "source_schema_digest",
                "source_runtime_schema_digest",
            )
        },
        "registry_digest": "sha256:" + "d" * 64,
    }


@pytest.mark.parametrize("model", sorted(GEMINI_SOURCE_LLM_MODELS | GEMINI_SOURCE_EMBEDDING_MODELS))
def test_exact_two_uid_shapes_and_each_single_variant_round_trip(model: str) -> None:
    raw = synthetic_record(model)
    parsed = SourceGeminiV8VariantMapping.model_validate(raw)
    assert parsed.model_dump(mode="json") == raw
    assert SourceGeminiV8VariantMapping.model_validate_json(parsed.model_dump_json()) == parsed
    for row in raw["variants"]:
        one: SyntheticRecord = {**raw, "variants": [row]}
        assert (
            SourceGeminiV8VariantMapping.model_validate(one).variants[0].source_plugin_uid == row["source_plugin_uid"]
        )
        frozen = SourceGeminiV8VariantSelection.model_validate(selection(one))
        assert SourceGeminiV8VariantSelection.model_validate_json(frozen.model_dump_json()) == frozen


@pytest.mark.parametrize("value", [True, False, 8.0, "8", 6, None])
def test_mapping_and_selection_require_integer_eight_without_coercion(value: object) -> None:
    raw = synthetic_record()
    with pytest.raises(ValidationError, match="integer 8"):
        SourceGeminiV8VariantMapping.model_validate({**raw, "schema_version": value})
    with pytest.raises(ValidationError, match="integer 8"):
        SourceGeminiV8VariantSelection.model_validate({**selection(raw), "schema_version": value})


@pytest.mark.parametrize("mutation", ["none", "three", "variant_id", "selector", "pools"])
def test_finite_variant_and_selector_uniqueness(mutation: str) -> None:
    raw = synthetic_record()
    if mutation == "none":
        raw["variants"] = []
    elif mutation == "three":
        raw["variants"].append(deepcopy(raw["variants"][0]))
    elif mutation == "variant_id":
        raw["variants"][1]["variant_id"] = raw["variants"][0]["variant_id"]
    elif mutation == "selector":
        duplicate = deepcopy(raw["variants"][0])
        duplicate["variant_id"] = "different-id-same-selector"
        raw["variants"][1] = duplicate
    else:
        raw["pool_types"] = ["trial", "trial"]
    with pytest.raises(ValidationError):
        SourceGeminiV8VariantMapping.model_validate(raw)


@pytest.mark.parametrize("index", [0, 1])
@pytest.mark.parametrize("field", ["uid", "profile", "adapter", "revision"])
def test_uid_profile_and_adapter_identity_cannot_be_crossed(index: int, field: str) -> None:
    raw = synthetic_record()
    item, other = raw["variants"][index], raw["variants"][1 - index]
    if field == "uid":
        item["source_plugin_uid"] = other["source_plugin_uid"]
    elif field == "profile":
        item["source_profile_id"] = other["source_profile_id"]
    elif field == "adapter":
        item["parameter_adapter"]["id"] = other["parameter_adapter"]["id"]
    else:
        item["parameter_adapter"]["revision"] = "2"
    with pytest.raises(ValidationError):
        SourceGeminiV8VariantMapping.model_validate(raw)


@pytest.mark.parametrize("where", ["root", "source", "variant", "settings", "adapter", "target"])
def test_extra_fields_cannot_add_origin_credentials_or_byok_authority(where: str) -> None:
    raw = synthetic_record()
    row = raw["variants"][0]
    target = cast(
        dict[str, object],
        {
            "root": raw,
            "source": raw["source"],
            "variant": row,
            "settings": row["source_settings"],
            "adapter": row["parameter_adapter"],
            "target": row["target"],
        }[where],
    )
    target["byok_or_origin_override"] = "not-a-routing-authority"
    with pytest.raises(ValidationError, match="Extra inputs"):
        SourceGeminiV8VariantMapping.model_validate(raw)


@pytest.mark.parametrize(
    "mutation",
    [
        "provider",
        "unknown_uid",
        "source_type",
        "source_mode",
        "target_type",
        "target_model",
        "settings",
        "missing_op",
        "extra_op",
        "duplicate_op",
        "duplicate_fixture",
        "bool_digest",
    ],
)
@pytest.mark.parametrize("model", ["gemini-2.5-flash", "gemini-embedding-001", "gemini-embedding-2-preview"])
def test_model_type_mode_operations_and_settings_remain_closed(mutation: str, model: str) -> None:
    raw = synthetic_record(model)
    row = raw["variants"][0]
    if mutation == "provider":
        raw["source"]["provider_id"] = "langgenius/openai/openai"
    elif mutation == "unknown_uid":
        row["source_plugin_uid"] = GEMINI_SOURCE_UID.replace("0.9.12", "0.9.13")
    elif mutation == "source_type":
        raw["source"]["model_type"] = "text-embedding" if model in GEMINI_SOURCE_LLM_MODELS else "llm"
    elif mutation == "source_mode":
        raw["source"]["mode"] = "text-embedding" if model in GEMINI_SOURCE_LLM_MODELS else "chat"
    elif mutation == "target_type":
        row["target"]["model_type"] = "text-embedding" if model in GEMINI_SOURCE_LLM_MODELS else "llm"
    elif mutation == "target_model":
        row["target"]["model"] = "gemini-3.1-flash-lite" if model != "gemini-3.1-flash-lite" else "gemini-2.5-flash"
    elif mutation == "settings":
        row["source_settings"]["source_base_policy"] = (
            "not_used" if model in GEMINI_SOURCE_LLM_MODELS else "unset_or_exact_google_root"
        )
    elif mutation == "missing_op":
        row["operations"].pop()
    elif mutation == "extra_op":
        row["operations"].append("tts/invoke")
    elif mutation == "duplicate_op":
        row["operations"].append(row["operations"][0])
    elif mutation == "duplicate_fixture":
        row["conformance_fixture_ids"] *= 2
    else:
        cast(dict[str, object], row)["source_schema_digest"] = True
    with pytest.raises(ValidationError):
        SourceGeminiV8VariantMapping.model_validate(raw)


def test_selected_wrapper_is_frozen_and_only_projects_its_declaration() -> None:
    parsed = SourceGeminiV8VariantMapping.model_validate(synthetic_record())
    row = parsed.variants[1]
    selected = SelectedGeminiV8SourceVariant(parsed, row, "sha256:" + "d" * 64)
    assert (selected.mapping_revision, selected.source, selected.settlement_owner, selected.pool_types) == (
        parsed.mapping_revision,
        parsed.source,
        parsed.settlement_owner,
        parsed.pool_types,
    )
    assert (
        selected.source_schema_digest,
        selected.parameter_adapter,
        selected.target,
        selected.operations,
        selected.conformance_fixture_ids,
    ) == (row.source_schema_digest, row.parameter_adapter, row.target, row.operations, row.conformance_fixture_ids)
    with pytest.raises(FrozenInstanceError):
        selected.registry_digest = "sha256:" + "e" * 64  # type: ignore[read-only]


def test_existing_v6_real_fixtures_keep_c9_parse_dump_bytes_and_digest() -> None:
    # Captured from unchanged C9 before authoring this DTO, not generated from
    # the new family or made-up 0913 source profiles.
    old = [SourceGeminiVariantMapping.model_validate(variant_record(row)) for row in profiles()]
    canonical = json.dumps(
        [row.model_dump(mode="json") for row in old], sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()
    assert hashlib.sha256(canonical).hexdigest() == "553c65d987506bad246c040a54b74827ec23f56396daa7694f4ecdd14bc8ccd7"
    assert hashlib.sha256("\n".join(row.model_dump_json() for row in old).encode()).hexdigest() == (
        "97acbdb6bfc3fe0914bad33de975ee2959480fdc4ee136119c91b5ea80d78d8b"
    )
    for item in old:
        raw = item.model_dump(mode="json")
        raw["variants"][0]["source_plugin_uid"] = GEMINI_0913_SOURCE_UID
        with pytest.raises(ValidationError):
            SourceGeminiVariantMapping.model_validate(raw)
