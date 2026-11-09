"""Frozen dev15 staging candidate/Core pins; never a real installed target UID."""

import base64
import gzip
import hashlib
import json
from pathlib import Path
from typing import Any, Literal, cast

from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_tongyi_mapping import tongyi_source_operations

SOURCE_PROVIDER = "langgenius/tongyi/tongyi"
SOURCE_UID = "langgenius/tongyi:0.2.26@6c75a6b95954ef3c97f0d3225bad7cbfbff7cdbc82d9425074aae121cc056a64"
REVISION = "offline-tongyi-v7-never-published"
TARGET_VERSION = "999.0.0"
# Synthetic unit binding only, never the actual unbuilt dev15 package identity.
TARGET_UID = "langgenius/tokener:" + TARGET_VERSION + "@" + "9" * 64


class SourceSettings(TypedDict, closed=True):
    source_endpoint_policy: Literal["reviewed_shared_international_string_true"]
    api_host_policy: Literal["actual_absent_or_blank"]
    request_metadata_policy: Literal["actual_system_disabled", "not_used"]


class TongyiProfile(TypedDict):
    source_model: str
    target_model: str
    model_type: Literal["llm", "text-embedding", "rerank"]
    profile_id: str
    adapter_id: str
    adapter_revision: str
    source_schema_digest: str
    source_runtime_schema_digest: str
    source_codec_schema_digest: str
    source_settings: SourceSettings
    source_catalog_schema: dict[str, Any]
    source_daemon_schema: dict[str, Any]
    rules_digest: str
    release_status: Literal["STAGING_PACKAGE_CANDIDATE"]
    previous_unreleased_rules_digest: str


def profiles() -> list[TongyiProfile]:
    path = Path(__file__).resolve().parents[2] / "unit_tests/services/fixtures/tongyi0226_source_profiles.packed.json"
    assert (
        hashlib.sha256(path.read_bytes()).hexdigest()
        == "223c9184d680f01fbdaed3d2c285b851d28e8e4214862413fab679187e7b097a"
    )
    packet = json.loads(path.read_bytes())
    raw = gzip.decompress(base64.b64decode(packet["payload_base64"], validate=True))
    assert (
        hashlib.sha256(raw).hexdigest()
        == packet["raw_sha256"]
        == "0abd1480cc43473a14ee94cd65807e0b8aa95726644328196f13927804449577"
    )
    rows = cast(list[TongyiProfile], json.loads(raw)["profiles"])
    assert len(rows) == 14
    return rows


def schema(row: TongyiProfile, *, runtime: bool = False) -> AIModelEntity:
    return AIModelEntity.model_validate(row["source_daemon_schema" if runtime else "source_catalog_schema"])


def variant_record(row: TongyiProfile) -> dict[str, Any]:
    kind = ModelType(row["model_type"])
    return {
        "schema_version": 7,
        "mapping_revision": REVISION,
        "source": {
            "provider_id": SOURCE_PROVIDER,
            "model_type": kind.value,
            "model": row["source_model"],
            "mode": "chat" if kind is ModelType.LLM else kind.value,
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
                    "rules_digest": row["rules_digest"],
                },
                "target": {
                    "plugin_id": "langgenius/tokener",
                    "provider": "tokener",
                    "model_type": kind.value,
                    "model": row["target_model"],
                    "catalog_revision": "offline-not-a-release",
                    "minimum_plugin_version": TARGET_VERSION,
                },
                "operations": sorted(tongyi_source_operations(row["source_model"])),
                "conformance_fixture_ids": ["offline-reviewed-staging-candidate-tongyi0226:" + row["source_model"]],
            }
        ],
    }


def registry() -> str:
    return json.dumps([variant_record(row) for row in profiles()])
