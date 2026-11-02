"""Pure reviewed profile fixtures for revision/route/readiness tests; no I/O ports."""

import hashlib
import json
from pathlib import Path
from typing import TypedDict, cast

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType

GPT55_REVISION = "source-variants-gpt55-new-v1"
EMBEDDING_REVISION = "source-variants-embedding-new-v1"
SOURCE_PROVIDER = "langgenius/openai/openai"
GPT55_IDENTITY = (SOURCE_PROVIDER, ModelType.LLM, "gpt-5.5")
EMBEDDING_MODELS = ("text-embedding-3-large", "text-embedding-3-small", "text-embedding-ada-002")
_FIXTURES = Path(__file__).parents[2] / "unit_tests/services/fixtures"


class SourceProfile(TypedDict):
    profile_id: str
    source_plugin_uid: str
    source_model: str
    source_schema_digest: str
    source_runtime_schema_digest: str
    source_catalog_schema: dict[str, object]
    source_schema: dict[str, object]
    source_settings: dict[str, bool]
    source_protocol_selectors: list[str]
    source_endpoint_class: str
    source_endpoint_classes: list[str]
    source_version: str
    source_operations: list[str]
    adapter_id: str
    adapter_revision: str


def _document(name: str) -> dict[str, object]:
    return cast(dict[str, object], json.loads((_FIXTURES / name).read_text()))


def profile_digest(profile: object) -> str:
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


def gpt55_profiles() -> list[SourceProfile]:
    return cast(list[SourceProfile], _document("model_billing_openai_provider042_profiles.json")["profiles"])


def embedding_profiles() -> list[SourceProfile]:
    return cast(list[SourceProfile], _document("model_billing_openai_embedding_profiles.json")["profiles"])


def _schemas(profile: SourceProfile) -> tuple[AIModelEntity, AIModelEntity]:
    return (
        AIModelEntity.model_validate(profile["source_catalog_schema"]),
        AIModelEntity.model_validate(profile["source_schema"]),
    )


def gpt55_schemas() -> tuple[AIModelEntity, AIModelEntity]:
    return _schemas(gpt55_profiles()[0])


def embedding_schemas(model: str, version: str = "042") -> tuple[AIModelEntity, AIModelEntity]:
    return _schemas(
        next(p for p in embedding_profiles() if (p["source_model"], p["source_version"]) == (model, version))
    )


def _target(model: str, kind: ModelType) -> dict[str, object]:
    return {
        "plugin_id": "langgenius/tokener",
        "provider": "tokener",
        "model_type": kind.value,
        "model": model,
        "catalog_revision": "catalog",
        "minimum_plugin_version": "0.4.3-dev12",
    }


def _envelope(model: str, kind: ModelType, revision: str, rows: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schema_version": 3 if kind is ModelType.TEXT_EMBEDDING else 2,
        "mapping_revision": revision,
        "source": {
            "provider_id": SOURCE_PROVIDER,
            "model_type": kind.value,
            "model": model,
            "mode": "text-embedding" if kind is ModelType.TEXT_EMBEDDING else "chat",
        },
        "settlement_owner": "shared_credit_pool",
        "pool_types": ["paid", "trial"],
        "variants": rows,
    }


def _row(
    profile: SourceProfile,
    *,
    variant_id: str,
    settings: dict[str, object],
    adapter: str,
    revision: str,
    kind: ModelType,
) -> dict[str, object]:
    return {
        "variant_id": variant_id,
        "source_plugin_uid": profile["source_plugin_uid"],
        "source_settings": settings,
        "source_schema_digest": profile["source_schema_digest"],
        "source_runtime_schema_digest": profile["source_runtime_schema_digest"],
        "source_profile_id": profile["profile_id"],
        "parameter_adapter": {"id": adapter, "revision": revision, "rules_digest": profile_digest(profile)},
        "target": _target(profile["source_model"], kind),
        "operations": ["model/schema", "text_embedding/invoke", "text_embedding/num_tokens"]
        if kind is ModelType.TEXT_EMBEDDING
        else ["model/schema", "llm/invoke", "llm/num_tokens"],
        "conformance_fixture_ids": ["exact-reviewed-source-profile-schema-and-wire"],
    }


def gpt55_variant_record() -> dict[str, object]:
    rows = []
    for profile in gpt55_profiles():
        official = profile["source_endpoint_class"] == "official_root"
        for selector in profile["source_protocol_selectors"]:
            rows.append(
                _row(
                    profile,
                    variant_id="openai042-gpt55-" + ("official-root-" if official else "") + selector,
                    settings={"protocol_selector": selector, **profile["source_settings"]},
                    adapter=profile["adapter_id"],
                    revision=profile["adapter_revision"],
                    kind=ModelType.LLM,
                )
            )
    return _envelope("gpt-5.5", ModelType.LLM, GPT55_REVISION, rows)


def _mini_record() -> dict[str, object]:
    profiles = [
        cast(SourceProfile, _document("model_billing_openai_chat_runtime_profile.json")),
        *cast(list[SourceProfile], _document("model_billing_openai_provider110_profiles.json")["profiles"]),
        *cast(list[SourceProfile], _document("model_billing_openai_official_root_profiles.json")["profiles"]),
    ]
    rows = []
    for profile in profiles:
        version = "042" if ":0.4.2@" in profile["source_plugin_uid"] else "110"
        official = "-official-root-" in profile["profile_id"]
        selectors = (
            ("absent", "chat")
            if version == "042"
            else (("chat",) if "-chat-" in profile["profile_id"] else ("absent", "responses"))
        )
        adapter = "openai_chat_source_v1" if version == "042" else "openai_provider110_source_v1"
        revision = ("3" if official else "2") if version == "042" else ("2" if official else "1")
        for selector in selectors:
            rows.append(
                _row(
                    profile,
                    variant_id="openai" + version + ("-official-root-" if official else "-") + selector,
                    settings={
                        "protocol_selector": selector,
                        "source_base_is_set": official,
                        "request_metadata_enabled": False,
                    },
                    adapter=adapter,
                    revision=revision,
                    kind=ModelType.LLM,
                )
            )
    return _envelope("gpt-4o-mini", ModelType.LLM, GPT55_REVISION, rows)


def full_gpt55_registry() -> list[dict[str, object]]:
    return [_mini_record(), gpt55_variant_record()]


def embedding_variant_record(model: str) -> dict[str, object]:
    rows = []
    for profile in embedding_profiles():
        if profile["source_model"] != model:
            continue
        for endpoint in profile["source_endpoint_classes"]:
            rows.append(
                _row(
                    profile,
                    variant_id="openai" + profile["source_version"] + "-embedding-" + endpoint + ":" + model,
                    settings={"source_endpoint_class": endpoint, "request_metadata_behavior": "not_used"},
                    adapter=profile["adapter_id"],
                    revision=profile["adapter_revision"],
                    kind=ModelType.TEXT_EMBEDDING,
                )
            )
    return _envelope(model, ModelType.TEXT_EMBEDDING, EMBEDDING_REVISION, rows)


def full_embedding_registry() -> list[dict[str, object]]:
    records = full_gpt55_registry()
    for item in records:
        item["mapping_revision"] = EMBEDDING_REVISION
    return [*records, *(embedding_variant_record(model) for model in EMBEDDING_MODELS)]
