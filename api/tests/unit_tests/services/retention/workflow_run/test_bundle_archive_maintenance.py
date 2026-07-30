import json
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, call, patch

import pytest

from services.retention.workflow_run.bundle_archive_maintenance import (
    ARCHIVED_TABLES,
    ArchiveBundleCatalogEntry,
    BundleManifest,
    BundleOperationResult,
    BundleReference,
    WorkflowRunBundleArchiveMaintenance,
)
from services.retention.workflow_run.constants import (
    ARCHIVE_BUNDLE_DELETE_STARTED_MARKER_NAME,
    ARCHIVE_BUNDLE_DELETED_MARKER_NAME,
    ARCHIVE_BUNDLE_FORMAT,
    ARCHIVE_BUNDLE_RESTORE_STARTED_MARKER_NAME,
    ARCHIVE_BUNDLE_RESTORED_MARKER_NAME,
    ARCHIVE_BUNDLE_SCHEMA_VERSION,
)

TENANT_ID = "1251fe32-c0c7-4fe2-a7bd-a8105267faf5"
CATALOG_ID = "019f63b7-5ca4-7681-9ce0-800283608f39"
BUNDLE_ID = "bundle-a"


def _table_records(
    **overrides: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    records = {table_name: [] for table_name in ARCHIVED_TABLES}
    records.update(overrides)
    return records


def _catalog_entry(*, catalog_id: str = CATALOG_ID, shard: str = "00-of-01") -> ArchiveBundleCatalogEntry:
    return ArchiveBundleCatalogEntry(
        catalog_id=catalog_id,
        tenant_id=TENANT_ID,
        year=2025,
        month=3,
        shard=shard,
        bundle_id=BUNDLE_ID,
        workflow_run_count=0,
        row_count=0,
        archive_bytes=0,
    )


def _manifest(
    entry: ArchiveBundleCatalogEntry,
    *,
    bundle_id: str = BUNDLE_ID,
    table_records: dict[str, list[dict[str, Any]]] | None = None,
) -> bytes:
    object_prefix = WorkflowRunBundleArchiveMaintenance._catalog_object_prefix(entry)
    records = table_records or _table_records()
    tables = {
        table_name: {
            "row_count": len(records[table_name]),
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
            "workflow_run_count": len(records["workflow_runs"]),
            "workflow_node_execution_count": len(records["workflow_node_executions"]),
            "tables": tables,
            "run_ids": [str(record["id"]) for record in records["workflow_runs"]],
        }
    ).encode()


def _session_factory(session: MagicMock) -> MagicMock:
    factory = MagicMock()
    factory.return_value.__enter__.return_value = session
    return factory


def _bundle_reference(
    entry: ArchiveBundleCatalogEntry,
    *,
    table_records: dict[str, list[dict[str, Any]]] | None = None,
) -> BundleReference:
    manifest = cast(BundleManifest, json.loads(_manifest(entry, table_records=table_records)))
    return BundleReference(
        catalog=entry,
        object_prefix=manifest["object_prefix"],
        manifest_key=f"{manifest['object_prefix']}/manifest.json",
        manifest_size_bytes=0,
        manifest=manifest,
    )


def _sample_archive_records() -> dict[str, list[dict[str, Any]]]:
    return _table_records(
        workflow_runs=[
            {"id": "run-1", "status": "succeeded"},
            {"id": "run-2", "status": "failed"},
        ],
        workflow_app_logs=[
            {"id": "app-log-1", "workflow_run_id": "run-1"},
        ],
        workflow_node_executions=[
            {"id": "node-1", "workflow_run_id": "run-1"},
        ],
        workflow_node_execution_offload=[
            {"id": "offload-1", "node_execution_id": "node-1"},
        ],
        workflow_pauses=[
            {"id": "pause-1", "workflow_run_id": "run-1"},
        ],
        workflow_pause_reasons=[
            {"id": "reason-1", "pause_id": "pause-1"},
        ],
        workflow_trigger_logs=[
            {"id": "trigger-1", "workflow_run_id": "run-1"},
        ],
    )


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
    session.get.return_value = bundle
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


def test_catalog_discovery_filters_and_validates_the_requested_shard() -> None:
    entry = _catalog_entry(shard="03-of-16")
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
    session.get.return_value = bundle
    session.scalars.return_value = [bundle]
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, MagicMock()),
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    entries = maintenance._list_catalog_entries(
        tenant_ids=None,
        target_year=2025,
        target_month=3,
        after_catalog_id=CATALOG_ID,
        limit=2,
        shard="03-of-16",
    )

    statement = session.scalars.call_args.args[0]
    rendered = str(statement)
    assert "workflow_run_archive_bundles.shard =" in rendered
    assert entries == [entry]

    session.get.return_value = SimpleNamespace(
        year=2025,
        month=3,
        tenant_id=TENANT_ID,
        shard="04-of-16",
    )
    with pytest.raises(ValueError, match="requested archive shard"):
        maintenance._list_catalog_entries(
            tenant_ids=None,
            target_year=2025,
            target_month=3,
            after_catalog_id=CATALOG_ID,
            limit=2,
            shard="03-of-16",
        )


def test_catalog_shard_preflight_rejects_mixed_layout_before_delete() -> None:
    session = MagicMock()
    session.scalars.return_value = ["00-of-01"]
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, MagicMock()),
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    with pytest.raises(ValueError, match=r"unexpected shards.*00-of-01"):
        maintenance.validate_catalog_shards(
            target_year=2025,
            target_month=3,
            shard_total=16,
        )

    statement = session.scalars.call_args.args[0]
    rendered = str(statement)
    assert "workflow_run_archive_bundles.year" in rendered
    assert "workflow_run_archive_bundles.month" in rendered
    assert "workflow_run_archive_bundles.shard NOT IN" in rendered


def test_catalog_shard_preflight_accepts_an_expected_subset() -> None:
    session = MagicMock()
    session.scalars.return_value = []
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, MagicMock()),
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    maintenance.validate_catalog_shards(
        target_year=2025,
        target_month=3,
        shard_total=16,
    )


def test_catalog_shard_preflight_uses_requested_tenant_scope() -> None:
    session = MagicMock()
    session.scalars.return_value = []
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, MagicMock()),
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    maintenance.validate_catalog_shards(
        target_year=2025,
        target_month=3,
        shard_total=16,
        tenant_ids=[TENANT_ID],
    )

    statement = session.scalars.call_args.args[0]
    assert "workflow_run_archive_bundles.tenant_id IN" in str(statement)


@pytest.mark.parametrize(
    ("cursor_bundle", "tenant_ids", "error_message"),
    [
        (None, None, "does not exist"),
        (
            SimpleNamespace(year=2024, month=3, tenant_id=TENANT_ID),
            None,
            "requested archive month",
        ),
        (
            SimpleNamespace(year=2025, month=3, tenant_id="other-tenant"),
            [TENANT_ID],
            "requested tenant scope",
        ),
    ],
)
def test_catalog_discovery_rejects_cursor_outside_requested_scope(
    cursor_bundle: SimpleNamespace | None,
    tenant_ids: list[str] | None,
    error_message: str,
) -> None:
    session = MagicMock()
    session.get.return_value = cursor_bundle
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, MagicMock()),
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    with pytest.raises(ValueError, match=error_message):
        maintenance._list_catalog_entries(
            tenant_ids=tenant_ids,
            target_year=2025,
            target_month=3,
            after_catalog_id=CATALOG_ID,
            limit=1,
        )

    session.scalars.assert_not_called()


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


def test_bundle_maintenance_locks_the_existing_catalog_row() -> None:
    entry = _catalog_entry()
    session = MagicMock()
    session.scalar.return_value = entry.catalog_id

    WorkflowRunBundleArchiveMaintenance._lock_catalog_entry(session, entry)

    statement = session.scalar.call_args.args[0]
    rendered = str(statement)
    assert "workflow_run_archive_bundles.id" in rendered
    assert "workflow_run_archive_bundles.tenant_id" in rendered
    assert "FOR UPDATE" in rendered


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


def test_live_archive_subset_accepts_full_partial_and_absent_live_data() -> None:
    archive_records = _sample_archive_records()
    manifest = _bundle_reference(_catalog_entry(), table_records=archive_records).manifest
    partial_records = _table_records(
        workflow_node_execution_offload=archive_records["workflow_node_execution_offload"],
        workflow_pause_reasons=archive_records["workflow_pause_reasons"],
    )

    for live_records in (archive_records, partial_records, _table_records()):
        WorkflowRunBundleArchiveMaintenance._validate_live_archive_subset(
            manifest,
            archive_records,
            live_records,
        )


def test_live_archive_subset_rejects_extra_rows() -> None:
    archive_records = _sample_archive_records()
    manifest = _bundle_reference(_catalog_entry(), table_records=archive_records).manifest
    live_records = _table_records(
        workflow_app_logs=[
            {"id": "extra-app-log", "workflow_run_id": "run-1"},
        ]
    )

    with pytest.raises(ValueError, match="rows missing from archive for workflow_app_logs"):
        WorkflowRunBundleArchiveMaintenance._validate_live_archive_subset(
            manifest,
            archive_records,
            live_records,
        )


def test_live_archive_subset_rejects_content_mismatch() -> None:
    archive_records = _sample_archive_records()
    manifest = _bundle_reference(_catalog_entry(), table_records=archive_records).manifest
    live_records = _table_records(
        workflow_runs=[
            {"id": "run-1", "status": "failed"},
        ]
    )

    with pytest.raises(ValueError, match="subset content checksum mismatch for workflow_runs"):
        WorkflowRunBundleArchiveMaintenance._validate_live_archive_subset(
            manifest,
            archive_records,
            live_records,
        )


def test_live_bundle_scope_includes_archived_ids_and_indirect_children() -> None:
    archive_records = _sample_archive_records()
    manifest = _bundle_reference(_catalog_entry(), table_records=archive_records).manifest
    session = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    def select_live_parent_ids(_session, model, _run_ids):
        if model.__tablename__ == "workflow_node_executions":
            return ["live-node"]
        if model.__tablename__ == "workflow_pauses":
            return ["live-pause"]
        raise AssertionError(f"unexpected model: {model}")

    with (
        patch.object(maintenance, "_select_ids_by_run_ids", side_effect=select_live_parent_ids),
        patch.object(maintenance, "_load_records_by_column", return_value=[]) as load_records,
    ):
        maintenance._load_live_bundle_records(
            session,
            manifest,
            archive_records,
            lock=True,
        )

    queries = [
        (
            call.args[1].__tablename__,
            call.args[2].key,
            set(call.args[3]),
            call.kwargs["lock"],
        )
        for call in load_records.call_args_list
    ]
    assert ("workflow_pause_reasons", "pause_id", {"pause-1", "live-pause"}, True) in queries
    assert ("workflow_pause_reasons", "id", {"reason-1"}, True) in queries
    assert ("workflow_node_execution_offload", "node_execution_id", {"node-1", "live-node"}, True) in queries
    assert ("workflow_node_execution_offload", "id", {"offload-1"}, True) in queries
    assert ("workflow_app_logs", "workflow_run_id", {"run-1", "run-2"}, True) in queries
    assert ("workflow_app_logs", "id", {"app-log-1"}, True) in queries


def test_delete_bundle_accepts_matching_partial_rows_and_deletes_only_that_subset() -> None:
    entry = _catalog_entry()
    archive_records = _sample_archive_records()
    bundle_ref = _bundle_reference(entry, table_records=archive_records)
    partial_records = _table_records(
        workflow_node_execution_offload=archive_records["workflow_node_execution_offload"],
        workflow_pause_reasons=archive_records["workflow_pause_reasons"],
    )
    expected_deleted_counts = {table_name: len(partial_records[table_name]) for table_name in ARCHIVED_TABLES}
    session = MagicMock()
    storage = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    with (
        patch.object(maintenance, "_is_restore_started", return_value=False),
        patch.object(maintenance, "_is_deleted", return_value=False),
        patch.object(
            maintenance,
            "_validate_archive_object",
            return_value=(bundle_ref.manifest, archive_records, 123),
        ),
        patch.object(
            maintenance,
            "_load_live_bundle_records",
            side_effect=[partial_records, _table_records()],
        ),
        patch.object(
            maintenance,
            "_delete_bundle_rows",
            return_value=expected_deleted_counts,
        ) as delete_bundle_rows,
        patch.object(maintenance, "_put_marker"),
        patch.object(maintenance, "_mark_deleted") as mark_deleted,
        patch.object(maintenance, "_delete_marker"),
    ):
        result = maintenance._delete_bundle(session, storage, bundle_ref)

    assert result.success
    delete_bundle_rows.assert_called_once_with(session, partial_records)
    session.commit.assert_called_once_with()
    session.rollback.assert_not_called()
    mark_deleted.assert_called_once_with(storage, bundle_ref.object_prefix)


def test_delete_bundle_marks_an_already_absent_source_without_deleting_rows() -> None:
    entry = _catalog_entry()
    archive_records = _sample_archive_records()
    bundle_ref = _bundle_reference(entry, table_records=archive_records)
    session = MagicMock()
    storage = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    with (
        patch.object(maintenance, "_is_restore_started", return_value=False),
        patch.object(maintenance, "_is_deleted", return_value=False),
        patch.object(
            maintenance,
            "_validate_archive_object",
            return_value=(bundle_ref.manifest, archive_records, 123),
        ),
        patch.object(maintenance, "_load_live_bundle_records", return_value=_table_records()),
        patch.object(maintenance, "_delete_bundle_rows") as delete_bundle_rows,
        patch.object(maintenance, "_mark_deleted") as mark_deleted,
        patch.object(maintenance, "_delete_marker") as delete_marker,
    ):
        result = maintenance._delete_bundle(session, storage, bundle_ref)

    assert result.success
    delete_bundle_rows.assert_not_called()
    session.commit.assert_not_called()
    session.rollback.assert_not_called()
    mark_deleted.assert_called_once_with(storage, bundle_ref.object_prefix)
    assert delete_marker.call_count == 2


def test_delete_bundle_with_deleted_marker_rejects_remaining_orphan_children() -> None:
    entry = _catalog_entry()
    archive_records = _sample_archive_records()
    bundle_ref = _bundle_reference(entry, table_records=archive_records)
    live_records = _table_records(
        workflow_node_execution_offload=archive_records["workflow_node_execution_offload"],
    )
    session = MagicMock()
    storage = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    with (
        patch.object(maintenance, "_is_restore_started", return_value=False),
        patch.object(maintenance, "_is_deleted", return_value=True),
        patch.object(
            maintenance,
            "_validate_archive_object",
            return_value=(bundle_ref.manifest, archive_records, 123),
        ),
        patch.object(maintenance, "_load_live_bundle_records", return_value=live_records),
        patch.object(maintenance, "_delete_bundle_rows") as delete_bundle_rows,
    ):
        result = maintenance._delete_bundle(session, storage, bundle_ref)

    assert not result.success
    assert "Live rows exist for bundle with deleted marker" in result.error
    delete_bundle_rows.assert_not_called()
    session.commit.assert_not_called()
    session.rollback.assert_called_once_with()


def test_delete_bundle_rejects_an_in_progress_restore() -> None:
    entry = _catalog_entry()
    bundle_ref = _bundle_reference(entry)
    session = MagicMock()
    storage = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    with (
        patch.object(maintenance, "_is_restore_started", return_value=True),
        patch.object(maintenance, "_validate_archive_object") as validate_archive,
    ):
        result = maintenance._delete_bundle(session, storage, bundle_ref)

    assert not result.success
    assert "reconcile restore before delete" in result.error
    validate_archive.assert_not_called()
    session.commit.assert_not_called()
    session.rollback.assert_called_once_with()


def test_delete_bundle_rows_use_only_verified_primary_keys() -> None:
    live_records = _sample_archive_records()
    session = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    with patch.object(
        maintenance,
        "_delete_by_column",
        side_effect=lambda _session, _model, _column, values: len(values),
    ) as delete_by_column:
        deleted_counts = maintenance._delete_bundle_rows(session, live_records)

    expected_table_order = [
        "workflow_pause_reasons",
        "workflow_node_execution_offload",
        "workflow_trigger_logs",
        "workflow_app_logs",
        "workflow_node_executions",
        "workflow_pauses",
        "workflow_runs",
    ]
    assert [call.args[1].__tablename__ for call in delete_by_column.call_args_list] == expected_table_order
    assert all(call.args[2].key == "id" for call in delete_by_column.call_args_list)
    assert deleted_counts == {table_name: len(live_records[table_name]) for table_name in ARCHIVED_TABLES}


def test_restore_does_not_skip_an_interrupted_delete_without_deleted_marker() -> None:
    entry = _catalog_entry()
    session = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, MagicMock()),
        session_factory=cast(MagicMock, _session_factory(session)),
    )

    with (
        patch.object(maintenance, "_is_deleted", return_value=False),
        patch.object(maintenance, "_is_delete_started", return_value=True),
        patch.object(maintenance, "_validate_live_counts") as validate_live_counts,
    ):
        result = maintenance._restore_bundle(session, MagicMock(), _bundle_reference(entry))

    assert not result.success
    assert "reconcile delete first" in result.error
    validate_live_counts.assert_not_called()
    session.commit.assert_not_called()


def test_restore_does_not_skip_missing_source_rows_without_deleted_marker() -> None:
    entry = _catalog_entry()
    session = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, MagicMock()),
        session_factory=cast(MagicMock, _session_factory(session)),
    )
    bundle_ref = _bundle_reference(entry)

    with (
        patch.object(maintenance, "_is_deleted", return_value=False),
        patch.object(maintenance, "_is_delete_started", return_value=False),
        patch.object(
            maintenance,
            "_validate_live_counts",
            side_effect=ValueError("source rows are missing"),
        ) as validate_live_counts,
    ):
        result = maintenance._restore_bundle(session, MagicMock(), bundle_ref)

    assert not result.success
    assert "source rows are missing" in result.error
    validate_live_counts.assert_called_once_with(session, bundle_ref.manifest, expected_present=True)
    session.commit.assert_not_called()


def test_restore_reconciles_a_started_marker_after_the_source_commit() -> None:
    entry = _catalog_entry()
    session = MagicMock()
    storage = MagicMock()
    maintenance = WorkflowRunBundleArchiveMaintenance(
        storage=cast(MagicMock, storage),
        session_factory=cast(MagicMock, _session_factory(session)),
    )
    bundle_ref = _bundle_reference(entry)

    with (
        patch.object(maintenance, "_is_deleted", return_value=False),
        patch.object(maintenance, "_is_delete_started", return_value=False),
        patch.object(maintenance, "_is_restore_started", return_value=True),
        patch.object(maintenance, "_validate_live_counts") as validate_live_counts,
        patch.object(maintenance, "_mark_restored") as mark_restored,
    ):
        result = maintenance._restore_bundle(session, storage, bundle_ref)

    assert result.success
    validate_live_counts.assert_called_once_with(session, bundle_ref.manifest, expected_present=True)
    mark_restored.assert_called_once_with(storage, bundle_ref.object_prefix)
    session.commit.assert_not_called()


def test_mark_restored_clears_stale_delete_marker_before_releasing_restore_fence() -> None:
    storage = MagicMock()
    object_prefix = "bundle-prefix"
    operations = MagicMock()

    with (
        patch.object(WorkflowRunBundleArchiveMaintenance, "_delete_marker") as delete_marker,
        patch.object(WorkflowRunBundleArchiveMaintenance, "_put_marker") as put_marker,
    ):
        operations.attach_mock(delete_marker, "delete")
        operations.attach_mock(put_marker, "put")
        WorkflowRunBundleArchiveMaintenance._mark_restored(storage, object_prefix)

    assert operations.mock_calls == [
        call.delete(storage, object_prefix, ARCHIVE_BUNDLE_DELETED_MARKER_NAME),
        call.put(storage, object_prefix, ARCHIVE_BUNDLE_RESTORED_MARKER_NAME),
        call.delete(storage, object_prefix, ARCHIVE_BUNDLE_DELETE_STARTED_MARKER_NAME),
        call.delete(storage, object_prefix, ARCHIVE_BUNDLE_RESTORE_STARTED_MARKER_NAME),
    ]
