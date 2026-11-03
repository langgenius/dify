"""Offline V2 credit-LLM variants from lossless, byte-pinned local evidence.

These synthetic revisions and target catalog labels are test-only. The V1
baseline is read independently from its original fixture, never relabelled.
Profile JSON retains Python floats/nulls for its frozen schema/rules hashes;
only the declaration/selection evidence is financial-safe JSON.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Literal, cast

from pydantic import JsonValue
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.model_billing_mapping_service import source_mapping_revision
from services.model_billing_source_variants import ModelMappingRevision

type SourceVersion = Literal["042", "110"]
type ProtocolSelector = Literal["absent", "chat", "responses"]
type SourceEndpoint = Literal["unset", "official_root"]


class CreditLLMProfileSettings(TypedDict):
    source_base_is_set: bool
    request_metadata_enabled: bool


class CreditLLMProfile(TypedDict):
    profile_id: str
    source_version: SourceVersion
    source_model: str
    target_model: str
    source_plugin_uid: str
    source_schema_digest: str
    source_runtime_schema_digest: str
    source_sdk_core_schema_digest: str
    source_codec_schema_digest: str
    source_endpoint_class: SourceEndpoint
    source_settings: CreditLLMProfileSettings
    source_schema: dict[str, JsonValue]
    source_daemon_schema: dict[str, JsonValue]
    source_codec_schema: dict[str, JsonValue]
    supported_protocol_selectors: list[ProtocolSelector]
    adapter_id: str
    adapter_revision: str
    protocol: Literal["chat", "responses"]
    codec_rules: dict[str, JsonValue]
    operations: list[str]


class CreditLLMSourceRow(TypedDict):
    source_version: SourceVersion
    source_model: str
    source_plugin_uid: str
    source_schema_status: str
    source_schema_digest: str
    daemon_runtime_schema_digest: str
    core_runtime_schema_digest: str
    source_catalog_schema: dict[str, JsonValue]
    source_catalog_raw_schema: dict[str, JsonValue]
    source_daemon_schema: dict[str, JsonValue]
    source_daemon_raw_schema: dict[str, JsonValue]
    source_schema: dict[str, JsonValue]
    source_codec_schema: dict[str, JsonValue]


_FIXTURES = Path(__file__).with_name("fixtures")
SOURCE_PROVIDER = "langgenius/openai/openai"
REVISION = "offline-credit-llm-v2-variant-test-v1"
V1_REVISION = "offline-credit-llm-v1-variant-test-v1"


def _packed(name: str, packet_sha256: str, raw_sha256: str) -> dict[str, object]:
    packet_raw = (_FIXTURES / name).read_bytes()
    assert hashlib.sha256(packet_raw).hexdigest() == packet_sha256
    packet = cast(dict[str, object], json.loads(packet_raw))
    payload = packet["payload_base64"]
    assert isinstance(payload, str)
    expanded = gzip.decompress(base64.b64decode(payload, validate=True))
    assert hashlib.sha256(expanded).hexdigest() == packet["raw_sha256"] == raw_sha256
    return cast(dict[str, object], json.loads(expanded))


_V2_DOCUMENT = _packed(
    "model_billing_openai_credit_llm_v2_profiles.packed.json",
    "c8c55ec69956c3b2fb162faccc3819e287e6a31caab9b7f817badd5aeb68221b",
    "34cd19b7ad9afe34fb4830e9be2282859026b53304022c7bf1f02c9b6d33bc8b",
)
_MATRIX = _packed(
    "model_billing_openai_credit_llm_v2_source_matrix.packed.json",
    "1f24902fa6cc317002752d5ef0a13cb004358ca2c94719138986dcd0303b4e81",
    "f0a81d16c8adfc0c81de2dcbd3b9e439b76adfc8083acf3d254adfefc3efe753",
)
_V1_DOCUMENT = _packed(
    "model_billing_openai_credit_llm_profiles.packed.json",
    "784b221610e2c5c3d346f4468bde08324325f63312b7ccb427bc5a81c55d7737",
    "9479ce6c6ebae3bd3b3bf0237d908c7f486b4fd088fd30852ff98d9e68e7dabb",
)
PROFILES_BY_ID = {profile["profile_id"]: profile for profile in cast(list[CreditLLMProfile], _V2_DOCUMENT["profiles"])}
V1_PROFILES_BY_ID = {
    profile["profile_id"]: profile for profile in cast(list[CreditLLMProfile], _V1_DOCUMENT["profiles"])
}
SOURCE_ROWS = {
    (row["source_version"], row["source_model"]): row
    for row in cast(list[CreditLLMSourceRow], _MATRIX["rows"])
    if row["source_schema_status"] == "source_sdk_schema_positive"
}
SELECTOR_CASES: tuple[tuple[str, ProtocolSelector], ...] = tuple(
    (profile_id, selector)
    for profile_id, profile in PROFILES_BY_ID.items()
    for selector in profile["supported_protocol_selectors"]
)
assert len(PROFILES_BY_ID) == len(V1_PROFILES_BY_ID) == 128
assert len(SOURCE_ROWS) == 32
assert len(SELECTOR_CASES) == 192
assert set(PROFILES_BY_ID).isdisjoint(V1_PROFILES_BY_ID)


def profile_digest(value: object) -> str:
    """Frozen profile canonical JSON, not the constrained financial hash."""
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


def credit_llm_v2_catalog(profile_id: str) -> AIModelEntity:
    profile = PROFILES_BY_ID[profile_id]
    row = SOURCE_ROWS[(profile["source_version"], profile["source_model"])]
    return AIModelEntity.model_validate(deepcopy(row["source_catalog_schema"]))


def credit_llm_v2_runtime(profile_id: str) -> AIModelEntity:
    return AIModelEntity.model_validate(deepcopy(PROFILES_BY_ID[profile_id]["source_daemon_schema"]))


def credit_llm_v2_credentials(profile_id: str, selector: ProtocolSelector) -> dict[str, object]:
    """Original platform settings, without a managed key or invented defaults."""
    profile = PROFILES_BY_ID[profile_id]
    credentials: dict[str, object] = {"openai_api_key": "offline-not-a-real-key"}
    if selector != "absent":
        credentials["api_protocol"] = selector
    if profile["source_endpoint_class"] == "official_root":
        credentials["openai_api_base"] = "https://api.openai.com"
    return credentials


def _records(profiles: dict[str, CreditLLMProfile], revision: str) -> list[dict[str, object]]:
    grouped: dict[tuple[str, ModelType, str], dict[str, object]] = {}
    for profile_id, profile in profiles.items():
        identity = (SOURCE_PROVIDER, ModelType.LLM, profile["source_model"])
        record = grouped.setdefault(
            identity,
            {
                "schema_version": 2,
                "mapping_revision": revision,
                "source": {
                    "provider_id": SOURCE_PROVIDER,
                    "model_type": ModelType.LLM.value,
                    "model": profile["source_model"],
                    "mode": "chat",
                },
                "settlement_owner": "shared_credit_pool",
                "pool_types": ["paid", "trial"],
                "variants": [],
            },
        )
        for selector in profile["supported_protocol_selectors"]:
            cast(list[dict[str, object]], record["variants"]).append(
                {
                    "variant_id": profile_id + ":" + selector,
                    "source_plugin_uid": profile["source_plugin_uid"],
                    "source_settings": {"protocol_selector": selector, **profile["source_settings"]},
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
                        "model_type": ModelType.LLM.value,
                        "model": profile["target_model"],
                        "catalog_revision": "offline-credit-llm-test-only",
                        "minimum_plugin_version": "0.0.0",
                    },
                    "operations": list(profile["operations"]),
                    "conformance_fixture_ids": [profile_id + ":offline-only"],
                }
            )
    return list(grouped.values())


def credit_llm_v2_records() -> list[dict[str, object]]:
    """Twenty logical source envelopes containing 192 exact V2 selectors."""
    return _records(PROFILES_BY_ID, REVISION)


def credit_llm_v1_records() -> list[dict[str, object]]:
    """Independent original V1 profiles/selectors under their own revision."""
    return _records(V1_PROFILES_BY_ID, V1_REVISION)


def credit_llm_v2_registry(records: list[dict[str, object]] | None = None) -> ModelMappingRevision:
    return source_mapping_revision(json.dumps(credit_llm_v2_records() if records is None else records), REVISION)
