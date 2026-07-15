import json
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

import pytest

from services.retention.workflow_run.bundle_archive_maintenance import (
    ArchiveBundleCatalogEntry,
    BundleManifest,
    BundleOperationResult,
    BundleReference,
    WorkflowRunBundleArchiveMaintenance,
)
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_FORMAT, ARCHIVE_BUNDLE_SCHEMA_VERSION

TENANT_ID = "1251fe32-c0c7-4fe2-a7bd-a8105267faf5"
CATALOG_ID = "019f63b7-5ca4-7681-9ce0-800283608f39"
BUNDLE_ID = "bundle-a"


def _catalog_entry(*, catalog_id: str = CATALOG_ID) -> ArchiveBundleCatalogEntry:
    return ArchiveBundleCatalogEntry(
        catalog_id=catalog_id,
        tenant_id=TENANT_ID,
        year=2025,
        month=3,
        shard="00-of-01",
        bundle_id=BUNDLE_ID,
        workflow_run_count=0,
        row_count=0,
        archive_bytes=0,
    )


def _manifest(entry: ArchiveBundleCatalogEntry, *, bundle_id: str = BUNDLE_ID) -> bytes:
    object_prefix = WorkflowRunBundleArchiveMaintenance._catalog_object_prefix(entry)
    tables = {
        table_name: {
            "row_count": 0,
            "checksum": "",
            "size_bytes": 0,
            "object_key": f"{object_prefix}/{table_name}.parquet",
        }
        for table_name in (
            "workflow_runs",
            "workflow_app_logs",
            "workflow_node_executions",
            "workflow_node_execution_offload",
            "workflow_pauses",
            "workflow_pause_reasons",
            "workflow_trigger_logs",
        )
    }
    return json.dumps(
        {
            "schema_version": ARCHIVE_BUNDLE_SCHEMA_VERSION,
            "archive_format": ARCHIVE_BUNDLE_FORMAT,
            "tenant_id": entry.tenant_id,
            "tenant_prefix": entry.tenant_id[0],
            "year": entry.year,
            "month": entry.month,
            "shard": entry.shard,
            "bundle_id": bundle_id,
            "object_prefix": object_prefix,
            "workflow_run_count": 0,
            "workflow_node_execution_count": 0,
            "tables": tables,
            "run_ids": [],
        }
    ).encode()


def _session_factory(session: MagicMock) -> MagicMock:
    factory = MagicMock()
    factory.return_value.__enter__.return_value = session
    return factory


def test_catalog_discovery_is_ordered_and_limited_before_storage_io() -> None:
    entry = _catalog_entry()
    bundle = SimpleNamespace(
        id=entry.catalog_id,
        tenant_id=entry.tenant_id,
        year=entry.year,
        month=entry.month,
        shard=entry.shard,
        bundle_id=entry.bundle_id,
        workflow_run_count=entry.workflow_run_count,
        row_count=entry.row_count,
        archive_bytes=entry.archive_bytes,
    )
    session = MagicMock()
    session.scalars.return_value = [bundle]
    storage = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, storage),
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    entries = maintenance._list_catalog_entries(
        tenant_ids=[TENANT_ID],
        target_year=2025,
        target_month=3,
        after_catalog_id=CATALOG_ID,
        limit=2,
    )

    statement = session.scalars.call_args.args[0]
    rendered = str(statement)
    assert "workflow_run_archive_bundles.year" in rendered
    assert "workflow_run_archive_bundles.month" in rendered
    assert "workflow_run_archive_bundles.id >" in rendered
    assert "ORDER BY workflow_run_archive_bundles.id ASC" in rendered
    assert "LIMIT" in rendered
    assert entries == [entry]
    storage.list_objects.assert_not_called()


def test_catalog_manifest_identity_mismatch_fails_closed() -> None:
    entry = _catalog_entry()
    storage = MagicMock()
    storage.get_object.return_value = _manifest(entry, bundle_id="other-bundle")
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, storage),
        session_factory=cast(MagicMock, _session_factory(MagicMock())),
    )

    with pytest.raises(ValueError, match="identity does not match catalog"):
        maintenance._build_bundle_reference(cast(MagicMock, storage), entry)


def test_failure_and_dry_run_do_not_return_a_persistable_cursor() -> None:
    entry = _catalog_entry()
    session = MagicMock()
    storage = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, storage),
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    with (
        patch.object(maintenance, "_list_catalog_entries", return_value=[entry]),
        patch.object(maintenance, "_build_bundle_reference", side_effect=RuntimeError("manifest unavailable")),
    ):
        failed_summary = maintenance.delete_batch(
            tenant_ids=None,
            target_year=2025,
            target_month=3,
            after_catalog_id=None,
            limit=1,
        )

    assert failed_summary.bundles_failed == 1
    assert failed_summary.next_catalog_id is None
    assert failed_summary.preview_next_catalog_id is None

    dry_run = WorkflowRunBundleArchiveMaintenance(
        dry_run=True,
        storage=cast(MagicMock, storage),
        session_factory=cast(MagicMock, _session_factory(session)),
    )
    bundle_ref = BundleReference(
        catalog=entry,
        object_prefix="object-prefix",
        manifest_key="manifest.json",
        manifest_size_bytes=0,
        manifest=cast(BundleManifest, {}),
    )
    successful_result = BundleOperationResult(
        catalog_id=entry.catalog_id,
        bundle_id=entry.bundle_id,
        tenant_id=entry.tenant_id,
        object_prefix=bundle_ref.object_prefix,
        success=True,
    )
    with (
        patch.object(dry_run, "_list_catalog_entries", return_value=[entry]),
        patch.object(dry_run, "_build_bundle_reference", return_value=bundle_ref),
        patch.object(dry_run, "_delete_bundle", return_value=successful_result),
    ):
        dry_run_summary = dry_run.delete_batch(
            tenant_ids=None,
            target_year=2025,
            target_month=3,
            after_catalog_id=None,
            limit=1,
        )

    assert dry_run_summary.next_catalog_id is None
    assert dry_run_summary.preview_next_catalog_id == entry.catalog_id
