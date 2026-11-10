"""Real frozen Source profiles; target/revision strings are unit-only, never release authority."""

import base64
import gzip
import hashlib
import json
from itertools import starmap
from pathlib import Path
from typing import Any, cast

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_gemini_mapping import GEMINI_SOURCE_UID, gemini_source_operations
from services.entities.model_billing_gemini_v8_mapping import GEMINI_0913_SOURCE_UID
from tests.helpers.unit.model_billing_gemini_profiles import GeminiProfile
from tests.helpers.unit.model_billing_gemini_profiles import profiles as profiles0912

SOURCE_PROVIDER = "langgenius/gemini/google"
REVISION = "offline-gemini-v8-never-published"
SOURCE_UIDS = (GEMINI_SOURCE_UID, GEMINI_0913_SOURCE_UID)


def profiles(source_uid: str) -> list[GeminiProfile]:
    if source_uid == GEMINI_SOURCE_UID:
        return profiles0912()
    if source_uid != GEMINI_0913_SOURCE_UID:
        raise ValueError("Unknown exact source UID")
    path = Path(__file__).resolve().parents[2] / "unit_tests/services/fixtures/gemini0913_source_profiles.packed.json"
    blob = path.read_bytes()
    if hashlib.sha256(blob).hexdigest() != "fd9d76809e7b973da9a1f5081db4880321e88514618ad262459942afef079f81":
        raise ValueError("Frozen0913 packet changed")
    packed = json.loads(blob)
    raw = gzip.decompress(base64.b64decode(packed["payload_base64"], validate=True))
    if hashlib.sha256(raw).hexdigest() != packed["raw_sha256"] or packed["raw_sha256"] != (
        "8c32f42e9a623fae60f0da32633425938fb6557c4c93ea6975b7f9714dfb3dd7"
    ):
        raise ValueError("Frozen0913 raw profile changed")
    rows = cast(list[GeminiProfile], json.loads(raw)["profiles"])
    if len(rows) != 9 or any(row["adapter_id"] != "gemini_credit_source_v2" for row in rows):
        raise ValueError("Frozen0913 profile set changed")
    return rows


def schema(row: GeminiProfile, *, runtime: bool = False) -> AIModelEntity:
    return AIModelEntity.model_validate(row["source_daemon_schema" if runtime else "source_catalog_schema"])


def profile_digest(row: GeminiProfile) -> str:
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


def variant_record(row: GeminiProfile, source_uid: str) -> dict[str, Any]:
    kind = ModelType(row["model_type"])
    return {
        "variant_id": row["profile_id"],
        "source_plugin_uid": source_uid,
        "source_settings": row["source_settings"],
        "source_schema_digest": row["source_schema_digest"],
        "source_runtime_schema_digest": row["source_runtime_schema_digest"],
        "source_profile_id": row["profile_id"],
        "parameter_adapter": {
            "id": row["adapter_id"],
            "revision": row["adapter_revision"],
            "rules_digest": profile_digest(row),
        },
        "target": {
            "plugin_id": "langgenius/tokener",
            "provider": "tokener",
            "model_type": kind.value,
            "model": row["target_model"],
            "catalog_revision": "unit-only-no-target-release",
            "minimum_plugin_version": "999.0.0.dev1",
        },
        "operations": sorted(gemini_source_operations(row["source_model"])),
        "conformance_fixture_ids": ["core-unit-source-profile:" + row["profile_id"]],
    }


def mapping_record(model: str, source_uids: tuple[str, ...] = SOURCE_UIDS) -> dict[str, Any]:
    rows = [next(row for row in profiles(uid) if row["source_model"] == model) for uid in source_uids]
    if not rows:
        raise ValueError("Source profiles required")
    kind = ModelType(rows[0]["model_type"])
    return {
        "schema_version": 8,
        "mapping_revision": REVISION,
        "source": {
            "provider_id": SOURCE_PROVIDER,
            "model_type": kind.value,
            "model": model,
            "mode": "chat" if kind is ModelType.LLM else "text-embedding",
        },
        "settlement_owner": "shared_credit_pool",
        "pool_types": ["paid", "trial"],
        "variants": list(starmap(variant_record, zip(rows, source_uids, strict=True))),
    }


def registry(source_uids: tuple[str, ...] = SOURCE_UIDS) -> str:
    return json.dumps([mapping_record(row["source_model"], source_uids) for row in profiles(SOURCE_UIDS[0])])
