"""Offline, test-only V4/V5 declarations from exact frozen evidence bytes.

The synthetic revision/catalog labels below never register or publish anything.
No provider credentials, schema RPC, model call or package UID is acquired here.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Literal, NotRequired, cast

from pydantic import JsonValue
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.model_billing_mapping_service import source_mapping_revision
from services.model_billing_source_variants import ModelMappingRevision

type Endpoint = Literal["unset", "official_root"]


class SourceProfile(TypedDict):
    profile_id: str
    adapter_id: str
    adapter_revision: str
    source_model: str
    target_model: str
    source_plugin_uid: str
    source_schema_digest: str
    source_runtime_schema_digest: str
    source_version: NotRequired[str]
    model_type: NotRequired[str]
    source_catalog_schema: NotRequired[dict[str, JsonValue]]
    source_settings: NotRequired[dict[str, JsonValue]]
    source_daemon_schema: dict[str, JsonValue]
    operations: list[str]


class AudioSourceRow(TypedDict):
    source_version: str
    source_model: str
    source_schema_status: str
    source_catalog_schema: dict[str, JsonValue]
    source_daemon_schema: dict[str, JsonValue]


_FIXTURES = Path(__file__).with_name("fixtures")
REVISION = "offline-audio-xai-variant-test-v1"


def _packed(name: str, expected_sha256: str) -> dict[str, object]:
    raw = (_FIXTURES / name).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == expected_sha256
    packet = cast(dict[str, object], json.loads(raw))
    payload = packet["payload_base64"]
    assert isinstance(payload, str)
    expanded = gzip.decompress(base64.b64decode(payload, validate=True))
    assert hashlib.sha256(expanded).hexdigest() == packet["raw_sha256"]
    return cast(dict[str, object], json.loads(expanded))


_AUDIO_DOCUMENT = _packed(
    "model_billing_openai_audio_profiles.packed.json",
    "1cd309a8f42cf9b38eee58e759463615080cc775900f4142438a55291a456737",
)
_AUDIO_MATRIX = _packed(
    "model_billing_openai_audio_source_matrix.packed.json",
    "d021ba5841b82da9ef9f3efe96b36f1342765b83eaa4c791f6867f92856365ac",
)
_XAI_RAW = (_FIXTURES / "model_billing_xai_credit_source_profiles.json").read_bytes()
assert hashlib.sha256(_XAI_RAW).hexdigest() == "d852462a5d617d492031870af81f0781ec1a13d081339861794dbd706f8d8243"
_XAI_DOCUMENT = cast(dict[str, object], json.loads(_XAI_RAW))
AUDIO_ROWS = {
    (row["source_version"], row["source_model"]): row
    for row in cast(list[AudioSourceRow], _AUDIO_MATRIX["rows"])
    if row["source_schema_status"] == "source_sdk_schema_positive"
}
PROFILES_BY_ID = {
    profile["profile_id"]: profile
    for profile in (
        *cast(list[SourceProfile], _AUDIO_DOCUMENT["profiles"]),
        *cast(list[SourceProfile], _XAI_DOCUMENT["profiles"]),
    )
}
SELECTOR_CASES: tuple[tuple[str, Endpoint], ...] = tuple(
    (profile_id, endpoint)
    for profile_id, profile in PROFILES_BY_ID.items()
    for endpoint in (
        ("official_root",) if profile["adapter_id"] == "xai_credit_llm_source_v1" else ("unset", "official_root")
    )
)


def profile_digest(profile: SourceProfile) -> str:
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


def audio_xai_model_type(profile_id: str) -> ModelType:
    profile = PROFILES_BY_ID[profile_id]
    return ModelType.LLM if profile["adapter_id"] == "xai_credit_llm_source_v1" else ModelType(profile["model_type"])


def audio_xai_provider(profile_id: str) -> str:
    return "langgenius/x/x" if audio_xai_model_type(profile_id) is ModelType.LLM else "langgenius/openai/openai"


def audio_xai_catalog(profile_id: str) -> AIModelEntity:
    profile = PROFILES_BY_ID[profile_id]
    schema = (
        profile["source_catalog_schema"]
        if audio_xai_model_type(profile_id) is ModelType.LLM
        else AUDIO_ROWS[(profile["source_version"], profile["source_model"])]["source_catalog_schema"]
    )
    return AIModelEntity.model_validate(deepcopy(schema))


def audio_xai_runtime(profile_id: str) -> AIModelEntity:
    return AIModelEntity.model_validate(deepcopy(PROFILES_BY_ID[profile_id]["source_daemon_schema"]))


def audio_xai_credentials(profile_id: str, endpoint: Endpoint) -> dict[str, object]:
    profile = PROFILES_BY_ID[profile_id]
    if audio_xai_model_type(profile_id) is ModelType.LLM:
        if endpoint != "official_root":
            raise ValueError("No reviewed unset xAI source selector")
        return {
            "api_key": "offline-not-a-real-key",
            "endpoint_url": "https://api.x.ai/v1",
            "model": profile["source_model"],
        }
    credentials: dict[str, object] = {"openai_api_key": "offline-not-a-real-key"}
    if endpoint == "official_root":
        credentials["openai_api_base"] = "https://api.openai.com"
    return credentials


def audio_xai_records() -> list[dict[str, object]]:
    """Eleven logical declarations / twenty-nine exact source selectors."""
    grouped: dict[tuple[str, ModelType, str], dict[str, object]] = {}
    for profile_id, endpoint in SELECTOR_CASES:
        profile = PROFILES_BY_ID[profile_id]
        kind = audio_xai_model_type(profile_id)
        provider = audio_xai_provider(profile_id)
        identity = (provider, kind, profile["source_model"])
        is_xai = kind is ModelType.LLM
        record = grouped.setdefault(
            identity,
            {
                "schema_version": 5 if is_xai else 4,
                "mapping_revision": REVISION,
                "source": {
                    "provider_id": provider,
                    "model_type": kind.value,
                    "model": profile["source_model"],
                    "mode": "chat" if is_xai else kind.value,
                },
                "settlement_owner": "shared_credit_pool",
                "pool_types": ["paid", "trial"],
                "variants": [],
            },
        )
        variant: dict[str, object] = {
            "variant_id": profile_id + ":" + endpoint,
            "source_plugin_uid": profile["source_plugin_uid"],
            "source_settings": {
                "source_base_is_set": True,
                "request_metadata_enabled": False,
                "protocol_selector": "not_used",
            }
            if is_xai
            else {
                "source_endpoint_class": endpoint,
                "api_protocol_behavior": "not_used",
                "request_metadata_behavior": "not_used",
            },
            "source_schema_digest": profile["source_schema_digest"],
            "source_runtime_schema_digest": profile["source_runtime_schema_digest"],
            "source_profile_id": profile_id,
            "parameter_adapter": {
                "id": profile["adapter_id"],
                "revision": profile["adapter_revision"],
                "rules_digest": profile_digest(profile),
            },
            "target": {
                "plugin_id": "langgenius/tokener",
                "provider": "tokener",
                "model_type": kind.value,
                "model": profile["target_model"],
                "catalog_revision": "offline-audio-xai-test-only",
                "minimum_plugin_version": "0.0.0",
            },
            "operations": list(profile["operations"]),
            "conformance_fixture_ids": [profile_id + ":offline-only"],
        }
        if is_xai:
            variant["source_endpoint_class"] = endpoint
        cast(list[dict[str, object]], record["variants"]).append(variant)
    return list(grouped.values())


def audio_xai_registry(records: list[dict[str, object]] | None = None) -> ModelMappingRevision:
    return source_mapping_revision(json.dumps(audio_xai_records() if records is None else records), REVISION)
