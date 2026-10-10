import json
from unittest.mock import MagicMock, create_autospec

import pytest

from services.retention.workflow_run.archive_paid_plan_workflow_run import (
    ArchiveBundleIdentity,
    ArchiveBundleIndexDict,
    WorkflowRunArchiver,
)
from services.retention.workflow_run.constants import (
    ARCHIVE_BUNDLE_FORMAT,
    ARCHIVE_BUNDLE_MANIFEST_NAME,
    ARCHIVE_BUNDLE_SCHEMA_VERSION,
)

TENANT_ID = "1251fe32-c0c7-4fe2-a7bd-a8105267faf5"
SHARD_PREFIX = "workflow-runs/v2/1/2025/03/00-of-01"
MANIFEST_KEY = f"{SHARD_PREFIX}/{ARCHIVE_BUNDLE_MANIFEST_NAME}"


def _identity() -> ArchiveBundleIdentity:
    return ArchiveBundleIdentity(
        tenant_prefix="1",
        tenant_id=TENANT_ID,
        year=2025,
        month=3,
        shard="00-of-01",
        bundle_id="bundle-a",
        object_prefix=SHARD_PREFIX,
    )


def _archiver() -> WorkflowRunArchiver:
    """Bound methods under test run against this mock self; only lookups are stubbed."""
    service = create_autospec(WorkflowRunArchiver, instance=True)
    service._get_index_object_key.return_value = f"{SHARD_PREFIX}/index.json"
    service._get_shard_object_prefix.return_value = SHARD_PREFIX
    return service


def _index_payload() -> dict[str, str | list[str]]:
    return {
        "schema_version": ARCHIVE_BUNDLE_SCHEMA_VERSION,
        "archive_format": ARCHIVE_BUNDLE_FORMAT,
        "object_prefix": SHARD_PREFIX,
        "updated_at": "2026-01-01T00:00:00+00:00",
        "manifest_keys": [MANIFEST_KEY],
        "run_ids": ["run-1"],
    }


def _load_index(payload: dict[str, str | list[str]]) -> ArchiveBundleIndexDict:
    storage = MagicMock()
    storage.get_object.return_value = json.dumps(payload).encode()
    return WorkflowRunArchiver._load_bundle_index(_archiver(), storage, _identity())


def _build_index(payload: dict[str, str | list[str]]) -> ArchiveBundleIndexDict:
    storage = MagicMock()
    storage.list_objects.return_value = [MANIFEST_KEY]
    storage.get_object.return_value = json.dumps(payload).encode()
    return WorkflowRunArchiver._build_bundle_index(_archiver(), storage, _identity())


def test_load_bundle_index_defaults_missing_campaign_ids_to_empty() -> None:
    """Callers do set(index.get("campaign_ids", [])), so a None default would raise TypeError."""
    index = _load_index(_index_payload())

    assert index["run_ids"] == ["run-1"]
    assert set(index.get("campaign_ids", [])) == set()


def test_load_bundle_index_rejects_missing_mandatory_field() -> None:
    payload = _index_payload()
    del payload["manifest_keys"]

    with pytest.raises(ValueError, match="archive index is not valid"):
        _load_index(payload)


def test_load_bundle_index_rejects_prefix_mismatch() -> None:
    payload = _index_payload()
    payload["object_prefix"] = "workflow-runs/v2/9/2025/03/00-of-01"

    with pytest.raises(ValueError, match="object_prefix does not match"):
        _load_index(payload)


def test_build_bundle_index_collects_run_ids_and_campaign_id() -> None:
    index = _build_index(
        {
            "schema_version": ARCHIVE_BUNDLE_SCHEMA_VERSION,
            "archive_format": ARCHIVE_BUNDLE_FORMAT,
            "run_ids": ["run-1", "run-2"],
            "campaign_id": "campaign-a",
        }
    )

    assert index["run_ids"] == ["run-1", "run-2"]
    assert index.get("campaign_ids") == ["campaign-a"]


def test_build_bundle_index_rejects_manifest_without_run_ids() -> None:
    with pytest.raises(ValueError, match="archive manifest is not valid"):
        _build_index(
            {
                "schema_version": ARCHIVE_BUNDLE_SCHEMA_VERSION,
                "archive_format": ARCHIVE_BUNDLE_FORMAT,
            }
        )


def test_build_bundle_index_rejects_unsupported_manifest_schema_version() -> None:
    with pytest.raises(ValueError, match="unsupported bundle schema_version"):
        _build_index(
            {
                "schema_version": "v1",
                "archive_format": ARCHIVE_BUNDLE_FORMAT,
                "run_ids": ["run-1"],
            }
        )


def test_build_bundle_index_rejects_unsupported_manifest_archive_format() -> None:
    with pytest.raises(ValueError, match="unsupported bundle archive_format"):
        _build_index(
            {
                "schema_version": ARCHIVE_BUNDLE_SCHEMA_VERSION,
                "archive_format": "unknown-format",
                "run_ids": ["run-1"],
            }
        )


def test_build_bundle_index_omits_missing_campaign_id() -> None:
    index = _build_index(
        {
            "schema_version": ARCHIVE_BUNDLE_SCHEMA_VERSION,
            "archive_format": ARCHIVE_BUNDLE_FORMAT,
            "run_ids": ["run-1"],
        }
    )

    assert index.get("campaign_ids") == []
