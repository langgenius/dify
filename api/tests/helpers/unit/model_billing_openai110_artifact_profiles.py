"""Frozen README-only identity evidence; no live1ded schema or model-call claim."""

import base64
import gzip
import hashlib
import json
from collections.abc import Callable
from dataclasses import replace
from functools import cache
from pathlib import Path
from typing import Any, Literal, cast

import pytest

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services import model_billing_openai_audio_adapter as audio
from services import model_billing_openai_credit_llm_adapter as credit_v1
from services import model_billing_openai_credit_llm_v2_adapter as credit_v2
from services import model_billing_openai_embedding_adapter as embedding
from services import model_billing_openai_provider110_adapter as provider110
from services.entities.model_billing_mapping import SourceParameterContract, SourceVariantSettings, model_schema_digest

SOURCE_UID = "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340"
OLD_UID = "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c"
PROVIDER = "langgenius/openai/openai"
REVISION = "offline-exact1ded-never-published"
FIXTURES = Path(__file__).parents[2] / "unit_tests/services/fixtures"
COUNTS = {"provider110": 4, "credit_llm_v1": 68, "credit_llm_v2": 68, "audio": 8, "embedding": 3}
type ArtifactProfile = dict[str, Any]
_OWNERS = {
    "provider110": (
        provider110.build_openai_provider110_source_contract,
        provider110.openai_provider110_source_marker,
        provider110.restore_openai_provider110_source_contract,
    ),
    "credit_llm_v1": (
        credit_v1.build_openai_credit_llm_source_contract,
        credit_v1.openai_credit_llm_source_marker,
        credit_v1.restore_openai_credit_llm_source_contract,
    ),
    "credit_llm_v2": (
        credit_v2.build_openai_credit_llm_source_contract,
        credit_v2.openai_credit_llm_source_marker,
        credit_v2.restore_openai_credit_llm_source_contract,
    ),
    "audio": (
        audio.build_openai_audio_source_contract,
        audio.openai_audio_source_marker,
        audio.restore_openai_audio_source_contract,
    ),
    "embedding": (
        embedding.build_openai_embedding_source_contract,
        embedding.openai_embedding_source_marker,
        embedding.restore_openai_embedding_source_contract,
    ),
}


def digest(value: object) -> str:
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


@cache
def document() -> dict[str, Any]:
    raw = (FIXTURES / "openai110_1ded_source_contracts.packed.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != "14fb198cee11e0b18c5da899e1dcd7e101344eba00e54d5f3f4c7cd29f7ba985":
        raise ValueError("Exact1ded packet changed")
    packet = json.loads(raw)
    body = gzip.decompress(base64.b64decode(packet["payload_base64"], validate=True))
    if hashlib.sha256(body).hexdigest() != packet["raw_sha256"] or packet["raw_sha256"] != (
        "0440e619d4c0becc699bc9bb7d42c0d00e8033f6b256a762f6a086181f8aedf8"
    ):
        raise ValueError("Exact1ded raw packet changed")
    result = json.loads(body)
    if {family: len(rows) for family, rows in result["families"].items()} != COUNTS:
        raise ValueError("Exact1ded profile families changed")
    return cast(dict[str, Any], result)


def profiles(family: str) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], document()["families"][family])


@cache
def _llm_catalogs() -> dict[str, dict[str, Any]]:
    # The new packet explicitly inherits the95f catalog proof, not a new RPC.
    raw = (FIXTURES / "model_billing_openai_credit_llm_source_matrix.packed.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != "1f24902fa6cc317002752d5ef0a13cb004358ca2c94719138986dcd0303b4e81":
        raise ValueError("Inherited95f catalog matrix changed")
    packet = json.loads(raw)
    body = gzip.decompress(base64.b64decode(packet["payload_base64"], validate=True))
    if hashlib.sha256(body).hexdigest() != packet["raw_sha256"]:
        raise ValueError("Inherited95f raw catalog matrix changed")
    return {
        row["source_model"]: row["source_catalog_schema"]
        for row in json.loads(body)["rows"]
        if row["source_version"] == "110" and row["source_schema_status"] == "source_sdk_schema_positive"
    }


def schemas(family: str, row: dict[str, Any]) -> tuple[AIModelEntity, AIModelEntity]:
    catalog = (
        _llm_catalogs()[row["source_model"]]
        if family.startswith("credit_llm_")
        else row["source_catalog_schema"]
        if family in {"provider110", "embedding"}
        else row["source_schema"]
    )
    runtime = (
        row["source_daemon_schema"] if family in {"audio", "credit_llm_v1", "credit_llm_v2"} else row["source_schema"]
    )
    return AIModelEntity.model_validate(catalog), AIModelEntity.model_validate(runtime)


def cases(family: str) -> list[tuple[dict[str, Any], str, str]]:
    result = []
    for row in profiles(family):
        selectors = (
            row["source_protocol_selectors"]
            if family == "provider110"
            else row["supported_protocol_selectors"]
            if family.startswith("credit_llm_")
            else ["not_used"]
        )
        endpoints = (
            ["unset", "official_root"]
            if family in {"audio", "embedding"}
            else ["official_root" if row["source_settings"]["source_base_is_set"] else "unset"]
        )
        result.extend((row, selector, endpoint) for selector in selectors for endpoint in endpoints)
    return result


def mapping_record(family: str, row: dict[str, Any], selector: str, endpoint: str) -> dict[str, Any]:
    kind = schemas(family, row)[0].model_type
    if family in {"provider110", "credit_llm_v1", "credit_llm_v2"}:
        version, settings = 2, {"protocol_selector": selector, **row["source_settings"]}
        operations = ["model/schema", "llm/invoke", "llm/num_tokens"]
    elif family == "audio":
        version, settings = (
            4,
            {
                "source_endpoint_class": endpoint,
                "api_protocol_behavior": "not_used",
                "request_metadata_behavior": "not_used",
            },
        )
        operations = (
            ["model/schema", "tts/invoke", "tts/model/voices"]
            if kind is ModelType.TTS
            else ["model/schema", "speech2text/invoke"]
        )
    else:
        version, settings = 3, {"source_endpoint_class": endpoint, "request_metadata_behavior": "not_used"}
        operations = ["model/schema", "text_embedding/invoke", "text_embedding/num_tokens"]
    return {
        "schema_version": version,
        "mapping_revision": REVISION,
        "source": {
            "provider_id": PROVIDER,
            "model_type": kind.value,
            "model": row["source_model"],
            "mode": "chat" if kind is ModelType.LLM else kind.value,
        },
        "settlement_owner": "shared_credit_pool",
        "pool_types": ["paid", "trial"],
        "variants": [
            {
                "variant_id": row["profile_id"] + "|" + selector + "|" + endpoint,
                "source_plugin_uid": SOURCE_UID,
                "source_settings": settings,
                "source_schema_digest": row["source_schema_digest"],
                "source_runtime_schema_digest": row["source_runtime_schema_digest"],
                "source_profile_id": row["profile_id"],
                "parameter_adapter": {
                    "id": row["adapter_id"],
                    "revision": row["adapter_revision"],
                    "rules_digest": digest(row),
                },
                "target": {
                    "plugin_id": "langgenius/tokener",
                    "provider": "tokener",
                    "model_type": kind.value,
                    "model": row["target_model"],
                    "catalog_revision": "unit-only-no-release-authority",
                    "minimum_plugin_version": "999.0.0.dev1",
                },
                "operations": operations,
                "conformance_fixture_ids": ["offline-signed1ded-static-identity"],
            }
        ],
    }


def arguments(family: str, row: dict[str, Any], selector: str, endpoint: str) -> dict[str, Any]:
    catalog, runtime = schemas(family, row)
    settings: object
    if family == "provider110":
        settings = provider110.OpenAI110SourceSettings(
            cast(Literal["absent", "chat", "responses"], selector), **row["source_settings"]
        )
    elif family.startswith("credit_llm_"):
        settings = SourceVariantSettings.model_validate({"protocol_selector": selector, **row["source_settings"]})
    elif family == "audio":
        settings = audio.SourceAudioSettings(cast(Literal["unset", "official_root"], endpoint), "not_used", "not_used")
    else:
        settings = embedding.OpenAIEmbeddingSourceSettings(
            cast(Literal["unset", "official_root"], endpoint), "not_used"
        )
    result = {
        "adapter_id": row["adapter_id"],
        "adapter_revision": row["adapter_revision"],
        "expected_rules_digest": digest(row),
        "source_provider": PROVIDER,
        "source_model": row["source_model"],
        "source_plugin_unique_identifier": SOURCE_UID,
        "source_schema": catalog,
        "expected_source_schema_digest": row["source_schema_digest"],
        "target_model": row["target_model"],
        "source_settings": settings,
    }
    if family in {"audio", "credit_llm_v1", "credit_llm_v2"}:
        result.update(
            expected_source_runtime_schema_digest=row["source_runtime_schema_digest"], source_runtime_schema=runtime
        )
    if family.startswith("credit_llm_"):
        result["source_endpoint_class"] = endpoint
    return result


def build(family: str, args: dict[str, Any]) -> SourceParameterContract:
    return cast(Callable[..., SourceParameterContract], _OWNERS[family][0])(**args)


def marker(family: str, row: dict[str, Any], contract: SourceParameterContract) -> dict[str, object]:
    kind = schemas(family, row)[0].model_type
    return cast(Callable[..., dict[str, object]], _OWNERS[family][1])(
        contract,
        source_provider=PROVIDER,
        source_model=row["source_model"],
        model_type=kind,
        target_model=row["target_model"],
    )


def restore(family: str, row: dict[str, Any], value: object, args: dict[str, Any]) -> SourceParameterContract:
    names = {
        "source_provider",
        "source_model",
        "target_model",
        "source_settings",
        "source_endpoint_class",
        "expected_source_runtime_schema_digest",
        "source_runtime_schema",
    }
    kwargs = {key: val for key, val in args.items() if key in names}
    kwargs["model_type"] = schemas(family, row)[0].model_type
    return cast(Callable[..., SourceParameterContract], _OWNERS[family][2])(value, **kwargs)


def verify_factory_case(family: str, row: dict[str, Any], selector: str, endpoint: str) -> None:
    """Real factories on frozen/inherited data, never actual installed evidence."""
    denial = {
        "provider110": provider110.OpenAIProvider110SourceAdapterError,
        "credit_llm_v1": credit_v1.OpenAICreditLLMSourceAdapterError,
        "credit_llm_v2": credit_v2.OpenAICreditLLMSourceAdapterError,
        "audio": audio.OpenAIAudioSourceAdapterError,
        "embedding": embedding.OpenAIEmbeddingSourceAdapterError,
    }[family]
    args = arguments(family, row, selector, endpoint)
    catalog, runtime = schemas(family, row)
    contract = build(family, args)
    value = marker(family, row, contract)
    if not (
        contract.source_plugin_unique_identifier == SOURCE_UID
        and contract.profile_id == row["profile_id"]
        and contract.rules_digest == digest(row)
        and model_schema_digest(catalog) == row["source_schema_digest"]
        and model_schema_digest(runtime) == row["source_runtime_schema_digest"]
        and restore(family, row, value, args) == contract
    ):
        raise AssertionError("Exact1ded profile failed: " + row["profile_id"])
    for wrong_uid in (OLD_UID, SOURCE_UID[:-1] + "1", "langgenius/openai:1.1.0@" + "d796" + "0" * 60):
        with pytest.raises(denial):
            build(family, {**args, "source_plugin_unique_identifier": wrong_uid})
        with pytest.raises(denial):
            restore(family, row, {**value, "source_plugin_uid": wrong_uid}, args)
    for wrong in (
        {**value, "schema_version": True},
        {**value, "profile_id": row["profile_id"].replace("110-1ded-", "110-")},
        {**value, "rules_digest": "sha256:" + "0" * 64},
        {**value, "extra": "not-authority"},
    ):
        with pytest.raises(denial):
            restore(family, row, wrong, args)
    with pytest.raises(denial):
        marker(family, row, replace(contract, source_plugin_unique_identifier=OLD_UID))
    for key in ("expected_rules_digest", "source_schema", "source_settings"):
        with pytest.raises((ValueError, TypeError, AttributeError)):
            build(family, {**args, key: True})
    changed = catalog.model_copy(deep=True)
    changed.model = "unreviewed-model"
    with pytest.raises(denial):
        build(family, {**args, "source_schema": changed})
