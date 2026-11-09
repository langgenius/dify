"""Exact accepted Source packet, normal Core schemas, synthetic target only."""

import base64
import gzip
import hashlib
import json
from pathlib import Path
from typing import Any, Literal, cast

from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType

SOURCE_PROVIDER = "langgenius/gemini/google"
SOURCE_UID = "langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed"
REVISION = "offline-gemini-v6-never-published"
# No new release UID/version is known. These deliberately synthetic test-only
# values are not a declaration that cached dev14 understands the new family.
TARGET_VERSION = "999.0.0.dev1"
TARGET_UID = "langgenius/tokener:" + TARGET_VERSION + "@" + "a" * 64


class SourceSettings(TypedDict, closed=True):
    source_base_policy: Literal["unset_or_exact_google_root", "not_used"]
    request_metadata_policy: Literal["system_false_only", "not_used"]
    file_url_policy: Literal["actual_system_absent_or_empty_only", "not_used"]


class GeminiProfile(TypedDict):
    source_model: str
    target_model: str
    model_type: Literal["llm", "text-embedding"]
    profile_id: str
    adapter_id: str
    adapter_revision: str
    source_schema_digest: str
    source_runtime_schema_digest: str
    source_settings: SourceSettings
    source_catalog_schema: dict[str, Any]
    source_daemon_schema: dict[str, Any]


def profiles() -> list[GeminiProfile]:
    path = Path(__file__).resolve().parents[2] / "unit_tests/services/fixtures/gemini0912_source_profiles.packed.json"
    assert (
        hashlib.sha256(path.read_bytes()).hexdigest()
        == "674708df806c26170880916266ac49685371bcb20a80b250a0b39093d7187aaa"
    )
    packet = json.loads(path.read_bytes())
    raw = gzip.decompress(base64.b64decode(packet["payload_base64"], validate=True))
    assert (
        hashlib.sha256(raw).hexdigest()
        == packet["raw_sha256"]
        == "67c0ae62dd93a4b4a0be5e1cc1262030cf4227142cca622456a1c4428f6fb9c1"
    )
    rows = cast(list[GeminiProfile], json.loads(raw)["profiles"])
    assert len(rows) == 9
    return rows


def schema(row: GeminiProfile, *, runtime: bool = False) -> AIModelEntity:
    return AIModelEntity.model_validate(row["source_daemon_schema" if runtime else "source_catalog_schema"])


def variant_record(row: GeminiProfile) -> dict[str, Any]:
    kind = ModelType(row["model_type"])
    operations = (
        ["model/schema", "llm/invoke", "llm/num_tokens"]
        if kind is ModelType.LLM
        else ["model/schema", "text_embedding/invoke", "text_embedding/num_tokens"]
    )
    if row["source_model"] == "gemini-embedding-2-preview":
        operations.append("multimodal_embedding/invoke")
    rules = (
        "sha256:"
        + hashlib.sha256(
            json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )
    return {
        "schema_version": 6,
        "mapping_revision": REVISION,
        "source": {
            "provider_id": SOURCE_PROVIDER,
            "model_type": kind.value,
            "model": row["source_model"],
            "mode": "chat" if kind is ModelType.LLM else "text-embedding",
        },
        "settlement_owner": "shared_credit_pool",
        "pool_types": ["paid", "trial"],
        "variants": [
            {
                "variant_id": row["profile_id"],
                "source_plugin_uid": SOURCE_UID,
                "source_settings": row["source_settings"],
                "source_schema_digest": row["source_schema_digest"],
                "source_runtime_schema_digest": row["source_runtime_schema_digest"],
                "source_profile_id": row["profile_id"],
                "parameter_adapter": {
                    "id": row["adapter_id"],
                    "revision": row["adapter_revision"],
                    "rules_digest": rules,
                },
                "target": {
                    "plugin_id": "langgenius/tokener",
                    "provider": "tokener",
                    "model_type": kind.value,
                    "model": row["target_model"],
                    "catalog_revision": "offline-not-a-release",
                    "minimum_plugin_version": TARGET_VERSION,
                },
                "operations": operations,
                "conformance_fixture_ids": ["offline-reviewed-source0912:" + row["source_model"]],
            }
        ],
    }


def registry() -> str:
    return json.dumps([variant_record(row) for row in profiles()])
