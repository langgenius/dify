import datetime
import json
import uuid
from unittest.mock import ANY, MagicMock, patch

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from sqlalchemy.exc import OperationalError

from models.workflow import WorkflowRunArchiveBundle
from services.retention.workflow_run.archive_paid_plan_workflow_run import (
    ArchiveResult,
    ArchiveSummary,
    WorkflowRunArchiver,
)
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_FORMAT, ARCHIVE_BUNDLE_SCHEMA_VERSION


class FakeArchiveStorage:
    def __init__(self, objects: dict[str, bytes] | None = None):
        self.objects = objects or {}

    def object_exists(self, key: str) -> bool:
        return key in self.objects

    def get_object(self, key: str) -> bytes:
        return self.objects[key]

    def put_object(self, key: str, data: bytes) -> str:
        self.objects[key] = data
        return "checksum"

    def list_objects(self, prefix: str) -> list[str]:
        return sorted(key for key in self.objects if key.startswith(prefix))


def _db_disconnect_error() -> OperationalError:
    return OperationalError(
        "select 1",
        {},
        RuntimeError("server closed the connection unexpectedly"),
        connection_invalidated=True,
    )


def _run(run_id: str = "run-1"):
    run = MagicMock()
    run.id = run_id
    run.tenant_id = "tenant-1"
    run.created_at = datetime.datetime(2025, 3, 15, 10, 0, 0)
    return run


def _session_context(session):
    context = MagicMock()
    context.__enter__.return_value = session
    context.__exit__.return_value = False
    return context


class TestWorkflowRunArchiverInit:
    def test_start_from_without_end_before_raises(self):
        with pytest.raises(ValueError, match="start_from and end_before must be provided together"):
            WorkflowRunArchiver(start_from=datetime.datetime(2025, 1, 1))

    def test_end_before_without_start_from_raises(self):
        with pytest.raises(ValueError, match="start_from and end_before must be provided together"):
            WorkflowRunArchiver(end_before=datetime.datetime(2025, 1, 1))

    def test_start_equals_end_raises(self):
        ts = datetime.datetime(2025, 1, 1)
        with pytest.raises(ValueError, match="start_from must be earlier than end_before"):
            WorkflowRunArchiver(start_from=ts, end_before=ts)

    def test_start_after_end_raises(self):
        with pytest.raises(ValueError, match="start_from must be earlier than end_before"):
            WorkflowRunArchiver(
                start_from=datetime.datetime(2025, 6, 1),
                end_before=datetime.datetime(2025, 1, 1),
            )

    def test_workers_zero_raises(self):
        with pytest.raises(ValueError, match="workers must be at least 1"):
            WorkflowRunArchiver(workers=0)

    def test_run_shard_index_without_total_raises(self):
        with pytest.raises(ValueError, match="run_shard_index and run_shard_total must be provided together"):
            WorkflowRunArchiver(run_shard_index=0)

    def test_run_shard_total_without_index_raises(self):
        with pytest.raises(ValueError, match="run_shard_index and run_shard_total must be provided together"):
            WorkflowRunArchiver(run_shard_total=4)

    def test_run_shard_total_above_supported_range_raises(self):
        with pytest.raises(ValueError, match="run_shard_total must be between 1 and 16"):
            WorkflowRunArchiver(run_shard_index=0, run_shard_total=17)

    def test_run_shard_index_must_be_less_than_total(self):
        with pytest.raises(ValueError, match="run_shard_index must be between 0 and run_shard_total - 1"):
            WorkflowRunArchiver(run_shard_index=4, run_shard_total=4)

    def test_valid_init_defaults(self):
        archiver = WorkflowRunArchiver(days=30, batch_size=50)
        assert archiver.days == 30
        assert archiver.batch_size == 50
        assert archiver.dry_run is False
        assert archiver.delete_after_archive is False
        assert archiver.start_from is None

    def test_valid_init_with_time_range(self):
        start = datetime.datetime(2025, 1, 1)
        end = datetime.datetime(2025, 6, 1)
        archiver = WorkflowRunArchiver(start_from=start, end_before=end, workers=2)
        assert archiver.start_from is not None
        assert archiver.end_before is not None
        assert archiver.workers == 2

    def test_delete_after_archive_is_not_supported_for_bundle_archive(self):
        with pytest.raises(ValueError, match="delete_after_archive is not supported by bundle archive"):
            WorkflowRunArchiver(delete_after_archive=True)

    def test_get_runs_batch_passes_shard_options(self):
        repo = MagicMock()
        repo.get_runs_batch_by_time_range.return_value = []
        archiver = WorkflowRunArchiver(
            tenant_prefixes=["0", "a"],
            run_shard_index=1,
            run_shard_total=4,
            workflow_run_repo=repo,
        )

        archiver._get_runs_batch(None)

        repo.get_runs_batch_by_time_range.assert_called_once()
        assert repo.get_runs_batch_by_time_range.call_args.kwargs["tenant_prefixes"] == ["0", "a"]
        assert repo.get_runs_batch_by_time_range.call_args.kwargs["run_shard_index"] == 1
        assert repo.get_runs_batch_by_time_range.call_args.kwargs["run_shard_total"] == 4

    def test_get_runs_batch_prefers_planned_tenant_ids_over_prefix_filter(self):
        repo = MagicMock()
        repo.get_runs_batch_by_time_range.return_value = []
        archiver = WorkflowRunArchiver(
            tenant_ids=["0tenant"],
            tenant_prefixes=["0"],
            paid_tenant_ids=["0tenant"],
            workflow_run_repo=repo,
        )

        archiver._get_runs_batch(None)

        repo.get_runs_batch_by_time_range.assert_called_once()
        assert repo.get_runs_batch_by_time_range.call_args.kwargs["tenant_ids"] == ["0tenant"]
        assert repo.get_runs_batch_by_time_range.call_args.kwargs["tenant_prefixes"] is None

    def test_get_runs_batch_uses_current_tenant_scan_scope(self):
        repo = MagicMock()
        repo.get_runs_batch_by_time_range.return_value = []
        archiver = WorkflowRunArchiver(
            tenant_ids=["tenant-a", "tenant-b"],
            workflow_run_repo=repo,
        )

        archiver._get_runs_batch(None, tenant_scope=["tenant-b"])

        repo.get_runs_batch_by_time_range.assert_called_once()
        assert repo.get_runs_batch_by_time_range.call_args.kwargs["tenant_ids"] == ["tenant-b"]

    def test_get_runs_batch_retries_retryable_db_disconnect(self):
        repo = MagicMock()
        repo.get_runs_batch_by_time_range.side_effect = [_db_disconnect_error(), []]
        archiver = WorkflowRunArchiver(workflow_run_repo=repo)

        with patch("services.retention.workflow_run.db_retry.time.sleep") as sleep:
            runs = archiver._get_runs_batch(None)

        assert runs == []
        assert repo.get_runs_batch_by_time_range.call_count == 2
        sleep.assert_called_once_with(1.0)

    def test_get_runs_batch_does_not_retry_non_db_broken_pipe_error(self):
        repo = MagicMock()
        repo.get_runs_batch_by_time_range.side_effect = RuntimeError("broken pipe")
        archiver = WorkflowRunArchiver(workflow_run_repo=repo)

        with (
            patch("services.retention.workflow_run.db_retry.time.sleep") as sleep,
            pytest.raises(RuntimeError, match="broken pipe"),
        ):
            archiver._get_runs_batch(None)

        repo.get_runs_batch_by_time_range.assert_called_once()
        sleep.assert_not_called()

    def test_start_message_includes_shard(self):
        archiver = WorkflowRunArchiver(tenant_prefixes=["0"], run_shard_index=1, run_shard_total=4)

        message = archiver._build_start_message()

        assert "tenant_prefixes=0" in message
        assert "run_shard=1/4" in message

    def test_start_message_summarizes_large_planned_tenant_list(self):
        tenant_ids = [f"tenant-{index}" for index in range(11)]
        archiver = WorkflowRunArchiver(tenant_ids=tenant_ids, tenant_prefixes=["0"])

        message = archiver._build_start_message()

        assert "tenant_ids=11 planned tenants" in message
        assert "tenant-10" not in message


class TestBuildArchiveBundle:
    def test_bundle_contains_manifest_and_all_table_objects(self):
        archiver = WorkflowRunArchiver(days=90)
        run = MagicMock()
        run.id = str(uuid.uuid4())
        run.tenant_id = str(uuid.uuid4())
        run.created_at = datetime.datetime(2025, 3, 15, 10, 0, 0)
        identity = archiver._build_bundle_identity([run])
        table_data = {"workflow_runs": [{"id": run.id, "tenant_id": run.tenant_id}]}

        table_stats, table_payloads, manifest_data = archiver._build_archive_payload(identity, [run], table_data)
        manifest = json.loads(manifest_data)

        assert manifest["schema_version"] == ARCHIVE_BUNDLE_SCHEMA_VERSION
        assert manifest["archive_format"] == ARCHIVE_BUNDLE_FORMAT
        assert manifest["object_prefix"] == identity.object_prefix
        assert set(table_payloads) == set(archiver.ARCHIVED_TABLES)
        assert {stat.table_name for stat in table_stats} == set(archiver.ARCHIVED_TABLES)
        assert pq.read_table(pa.BufferReader(table_payloads["workflow_runs"])).num_rows == 1


class TestGenerateManifest:
    def test_manifest_structure(self):
        start = datetime.datetime(2025, 1, 1, tzinfo=datetime.UTC)
        end = datetime.datetime(2025, 4, 1, tzinfo=datetime.UTC)
        archiver = WorkflowRunArchiver(start_from=start, end_before=end, run_shard_index=1, run_shard_total=4)
        from services.retention.workflow_run.archive_paid_plan_workflow_run import TableStats

        run = MagicMock()
        run.id = str(uuid.uuid4())
        run.tenant_id = str(uuid.uuid4())
        run.created_at = datetime.datetime(2025, 3, 15, 10, 0, 0)
        identity = archiver._build_bundle_identity([run])

        stats = [
            TableStats(
                table_name="workflow_runs",
                row_count=1,
                checksum="abc123",
                size_bytes=512,
                object_key="workflow_runs.parquet",
            ),
            TableStats(
                table_name="workflow_node_executions",
                row_count=2,
                checksum="def456",
                size_bytes=1024,
                object_key="workflow_node_executions.parquet",
            ),
        ]

        manifest = archiver._generate_manifest(identity, [run], stats)

        assert manifest["schema_version"] == ARCHIVE_BUNDLE_SCHEMA_VERSION
        assert manifest["archive_format"] == ARCHIVE_BUNDLE_FORMAT
        assert manifest["bundle_id"] == identity.bundle_id
        assert manifest["tenant_id"] == run.tenant_id
        assert manifest["workflow_run_count"] == 1
        assert manifest["workflow_node_execution_count"] == 2
        assert manifest["run_ids"] == [run.id]
        assert manifest["campaign_id"] == "2025-01-01T00:00:00Z_2025-04-01T00:00:00Z"
        assert manifest["archive_window_start"] == "2025-01-01T00:00:00Z"
        assert manifest["archive_window_end"] == "2025-04-01T00:00:00Z"
        assert manifest["run_shard"] == "01-of-04"
        assert "tables" in manifest
        assert manifest["tables"]["workflow_runs"]["row_count"] == 1
        assert manifest["tables"]["workflow_runs"]["checksum"] == "abc123"
        assert manifest["tables"]["workflow_node_executions"]["row_count"] == 2


class TestFilterPaidTenants:
    def test_all_tenants_paid_when_billing_disabled(self):
        archiver = WorkflowRunArchiver(days=90)
        tenant_ids = {"t1", "t2", "t3"}

        with patch("services.retention.workflow_run.archive_paid_plan_workflow_run.dify_config") as cfg:
            cfg.BILLING_ENABLED = False
            result = archiver._filter_paid_tenants(tenant_ids)

        assert result == tenant_ids

    def test_empty_tenants_returns_empty(self):
        archiver = WorkflowRunArchiver(days=90)

        with patch("services.retention.workflow_run.archive_paid_plan_workflow_run.dify_config") as cfg:
            cfg.BILLING_ENABLED = True
            result = archiver._filter_paid_tenants(set())

        assert result == set()

    def test_only_paid_plans_returned(self):
        archiver = WorkflowRunArchiver(days=90)

        mock_bulk = {
            "t1": {"plan": "professional"},
            "t2": {"plan": "sandbox"},
            "t3": {"plan": "team"},
        }

        with (
            patch("services.retention.workflow_run.archive_paid_plan_workflow_run.dify_config") as cfg,
            patch("services.retention.workflow_run.archive_paid_plan_workflow_run.BillingService") as billing,
        ):
            cfg.BILLING_ENABLED = True
            billing.get_plan_bulk_with_cache.return_value = mock_bulk
            result = archiver._filter_paid_tenants({"t1", "t2", "t3"})

        assert "t1" in result
        assert "t3" in result
        assert "t2" not in result

    def test_billing_api_failure_returns_empty(self):
        archiver = WorkflowRunArchiver(days=90)

        with (
            patch("services.retention.workflow_run.archive_paid_plan_workflow_run.dify_config") as cfg,
            patch("services.retention.workflow_run.archive_paid_plan_workflow_run.BillingService") as billing,
        ):
            cfg.BILLING_ENABLED = True
            billing.get_plan_bulk_with_cache.side_effect = RuntimeError("API down")
            result = archiver._filter_paid_tenants({"t1"})

        assert result == set()

    def test_planned_paid_tenants_skip_billing_lookup(self):
        archiver = WorkflowRunArchiver(days=90, paid_tenant_ids=["t1", "t3"])

        with (
            patch("services.retention.workflow_run.archive_paid_plan_workflow_run.dify_config") as cfg,
            patch("services.retention.workflow_run.archive_paid_plan_workflow_run.BillingService") as billing,
        ):
            cfg.BILLING_ENABLED = True
            result = archiver._filter_paid_tenants({"t1", "t2", "t3"})

        billing.get_plan_bulk_with_cache.assert_not_called()
        assert result == {"t1", "t3"}


class TestDryRunArchive:
    @patch("services.retention.workflow_run.archive_paid_plan_workflow_run.get_archive_storage")
    def test_dry_run_does_not_call_storage(self, mock_get_storage, flask_req_ctx):
        archiver = WorkflowRunArchiver(days=90, dry_run=True)

        with patch.object(archiver, "_get_runs_batch", return_value=[]):
            summary = archiver.run()

        mock_get_storage.assert_not_called()
        assert isinstance(summary, ArchiveSummary)
        assert summary.runs_failed == 0

    def test_dry_run_estimates_table_and_object_sizes(self):
        archiver = WorkflowRunArchiver(days=90, dry_run=True)
        run = MagicMock()
        run.id = "run-1"
        run.tenant_id = "tenant-1"
        run.app_id = "app-1"
        run.workflow_id = "workflow-1"
        run.created_at = datetime.datetime(2025, 3, 15, 10, 0, 0)
        table_data = {
            "workflow_runs": [{"id": "run-1", "tenant_id": "tenant-1"}],
            "workflow_app_logs": [{"id": "log-1", "workflow_run_id": "run-1"}],
        }

        with patch.object(archiver, "_extract_bundle_data", return_value=table_data):
            result = archiver._archive_bundle(MagicMock(), None, [run])

        stats_by_table = {stat.table_name: stat for stat in result.tables}
        assert result.success is True
        assert result.object_size_bytes > 0
        assert stats_by_table["workflow_runs"].row_count == 1
        assert stats_by_table["workflow_runs"].size_bytes > 0
        assert stats_by_table["workflow_app_logs"].row_count == 1
        assert stats_by_table["workflow_app_logs"].size_bytes > 0
        assert stats_by_table["workflow_node_executions"].row_count == 0
        assert stats_by_table["workflow_node_executions"].size_bytes > 0

    def test_summary_merges_dry_run_estimates(self):
        summary = ArchiveSummary()
        result = MagicMock()
        result.object_size_bytes = 128
        result.tables = [
            MagicMock(table_name="workflow_runs", row_count=1, size_bytes=64),
            MagicMock(table_name="workflow_app_logs", row_count=2, size_bytes=32),
        ]

        WorkflowRunArchiver._merge_result_stats(summary, result)

        assert summary.total_object_size_bytes == 128
        assert summary.table_stats["workflow_runs"].row_count == 1
        assert summary.table_stats["workflow_runs"].size_bytes == 64
        assert summary.table_stats["workflow_app_logs"].row_count == 2
        assert summary.table_stats["workflow_app_logs"].size_bytes == 32


class TestArchiveDbRetry:
    def test_archive_bundle_groups_retries_with_fresh_session(self):
        archiver = WorkflowRunArchiver(days=90)
        run = _run()
        session_maker = MagicMock(
            side_effect=[
                _session_context(MagicMock(name="session-1")),
                _session_context(MagicMock(name="session-2")),
            ]
        )
        success = ArchiveResult(
            bundle_id=archiver._build_bundle_identity([run]).bundle_id,
            tenant_id=run.tenant_id,
            object_prefix=archiver._build_bundle_identity([run]).object_prefix,
            run_count=1,
            success=True,
        )

        with (
            patch.object(archiver, "_archive_bundle", side_effect=[_db_disconnect_error(), success]) as archive_bundle,
            patch("services.retention.workflow_run.db_retry.time.sleep") as sleep,
        ):
            results = archiver._archive_bundle_groups(session_maker, MagicMock(), [[run]])

        assert results == [success]
        assert archive_bundle.call_count == 2
        assert session_maker.call_count == 2
        sleep.assert_called_once_with(1.0)

    def test_archive_bundle_groups_returns_failed_result_after_retry_exhaustion(self):
        archiver = WorkflowRunArchiver(days=90)
        run = _run()
        session_maker = MagicMock(
            side_effect=[
                _session_context(MagicMock(name="session-1")),
                _session_context(MagicMock(name="session-2")),
                _session_context(MagicMock(name="session-3")),
            ]
        )

        with (
            patch.object(archiver, "_archive_bundle", side_effect=[_db_disconnect_error()] * 3) as archive_bundle,
            patch("services.retention.workflow_run.db_retry.time.sleep") as sleep,
        ):
            results = archiver._archive_bundle_groups(session_maker, MagicMock(), [[run]])

        assert len(results) == 1
        assert results[0].success is False
        assert "server closed the connection unexpectedly" in (results[0].error or "")
        assert archive_bundle.call_count == archiver.DB_RETRY_ATTEMPTS
        assert session_maker.call_count == archiver.DB_RETRY_ATTEMPTS
        assert sleep.call_count == archiver.DB_RETRY_ATTEMPTS - 1

    def test_archive_bundle_uses_safe_rollback_when_failure_rolls_back_badly(self):
        archiver = WorkflowRunArchiver(days=90, dry_run=True)
        session = MagicMock()
        session.rollback.side_effect = RuntimeError("rollback failed")

        with patch.object(archiver, "_extract_bundle_data", side_effect=RuntimeError("extract failed")):
            result = archiver._archive_bundle(session, None, [_run()])

        assert result.success is False
        assert result.error == "extract failed"
        session.rollback.assert_called_once()


class TestArchiveRunIdempotency:
    def _index_payload(self, archiver: WorkflowRunArchiver, run_ids: list[str], run) -> tuple[str, bytes]:
        identity = archiver._build_bundle_identity([run])
        index_key = archiver._get_index_object_key(identity)
        payload = json.dumps(
            {
                "schema_version": ARCHIVE_BUNDLE_SCHEMA_VERSION,
                "archive_format": ARCHIVE_BUNDLE_FORMAT,
                "object_prefix": archiver._get_shard_object_prefix(identity),
                "updated_at": "2025-03-15T00:00:00Z",
                "manifest_keys": [],
                "run_ids": run_ids,
            }
        ).encode()
        return index_key, payload

    def test_locked_bundle_is_skipped(self):
        archiver = WorkflowRunArchiver(days=90)
        run = MagicMock()
        run.id = "run-1"
        run.tenant_id = "tenant-1"
        run.created_at = datetime.datetime(2025, 3, 15, 10, 0, 0)

        with (
            patch.object(archiver, "_lock_runs_for_archive", return_value=[]),
        ):
            storage = MagicMock()
            storage.object_exists.return_value = False
            result = archiver._archive_bundle(MagicMock(), storage, [run])

        assert result.success is True
        assert result.skipped is True
        assert result.error == "one or more runs locked or deleted by another archiver"

    def test_already_archived_bundle_is_skipped(self):
        archiver = WorkflowRunArchiver(days=90)
        run = MagicMock()
        run.id = "run-1"
        run.tenant_id = "tenant-1"
        run.created_at = datetime.datetime(2025, 3, 15, 10, 0, 0)
        storage = MagicMock()
        storage.object_exists.return_value = True

        with patch.object(archiver, "_sync_existing_bundle_index") as sync_existing_bundle_index:
            result = archiver._archive_bundle(MagicMock(), storage, [run])

        assert result.success is True
        assert result.skipped is True
        assert result.error == "bundle already archived"
        sync_existing_bundle_index.assert_called_once()

    def test_existing_bundle_catalog_publication_failure_is_not_success(self):
        archiver = WorkflowRunArchiver(days=90)
        run = _run()
        session = MagicMock()
        storage = MagicMock()
        storage.object_exists.return_value = True

        with patch.object(archiver, "_sync_existing_bundle_index", side_effect=RuntimeError("catalog unavailable")):
            result = archiver._archive_bundle(session, storage, [run])

        assert result.success is False
        assert result.error == "catalog unavailable"
        session.rollback.assert_called_once()

    def test_retry_repairs_index_after_catalog_commit_then_index_write_failure(self):
        archiver = WorkflowRunArchiver(days=90)
        run = _run()
        identity = archiver._build_bundle_identity([run])
        index_key = archiver._get_index_object_key(identity)
        manifest_key = archiver._get_manifest_object_key(identity)
        storage = FakeArchiveStorage()
        original_put_object = storage.put_object
        index_write_count = 0

        def put_object(key: str, data: bytes) -> str:
            nonlocal index_write_count
            if key == index_key:
                index_write_count += 1
                if index_write_count == 2:
                    raise RuntimeError("index write failed")
            return original_put_object(key, data)

        storage.put_object = MagicMock(side_effect=put_object)
        first_session = MagicMock()
        first_session.scalar.return_value = None
        table_data = {"workflow_runs": [{"id": run.id, "tenant_id": run.tenant_id}]}

        with (
            patch.object(archiver, "_lock_runs_for_archive", return_value=[run]),
            patch.object(archiver, "_extract_bundle_data", return_value=table_data),
        ):
            first_result = archiver._archive_bundle(first_session, storage, [run])

        assert first_result.success is False
        assert first_result.error == "index write failed"
        assert manifest_key in storage.objects
        assert json.loads(storage.objects[index_key])["run_ids"] == []

        storage.list_objects = MagicMock(wraps=storage.list_objects)
        retry_session = MagicMock()
        retry_session.scalar.return_value = None

        retry_result = archiver._archive_bundle(retry_session, storage, [run])

        assert retry_result.success is True
        assert retry_result.skipped is True
        assert json.loads(storage.objects[index_key])["manifest_keys"] == [manifest_key]
        assert json.loads(storage.objects[index_key])["run_ids"] == [run.id]
        storage.list_objects.assert_not_called()

    def test_existing_manifest_with_missing_index_fails_without_partial_rebuild(self):
        archiver = WorkflowRunArchiver(days=90)
        run = _run()
        identity = archiver._build_bundle_identity([run])
        _, _, manifest_data = archiver._build_archive_payload(
            identity,
            [run],
            {"workflow_runs": [{"id": run.id, "tenant_id": run.tenant_id}]},
        )
        manifest_key = archiver._get_manifest_object_key(identity)
        index_key = archiver._get_index_object_key(identity)
        storage = FakeArchiveStorage({manifest_key: manifest_data})
        storage.list_objects = MagicMock(wraps=storage.list_objects)

        result = archiver._archive_bundle(MagicMock(), storage, [run])

        assert result.success is False
        assert "archive shard index missing" in (result.error or "")
        assert index_key not in storage.objects
        storage.list_objects.assert_not_called()

    def test_successful_bundle_persists_archive_index(self):
        archiver = WorkflowRunArchiver(days=90)
        run = MagicMock()
        run.id = str(uuid.uuid4())
        run.tenant_id = str(uuid.uuid4())
        run.created_at = datetime.datetime(2025, 3, 15, 10, 0, 0)
        session = MagicMock()
        session.scalar.return_value = None
        storage = MagicMock()
        storage.object_exists.return_value = False
        table_data = {
            "workflow_runs": [{"id": run.id, "tenant_id": run.tenant_id}],
            "workflow_node_executions": [{"id": str(uuid.uuid4()), "workflow_run_id": run.id}],
        }

        with (
            patch.object(archiver, "_lock_runs_for_archive", return_value=[run]),
            patch.object(archiver, "_extract_bundle_data", return_value=table_data),
        ):
            result = archiver._archive_bundle(session, storage, [run])

        archived_bundle = session.add.call_args.args[0]
        assert result.success is True
        assert isinstance(archived_bundle, WorkflowRunArchiveBundle)
        assert archived_bundle.tenant_id == run.tenant_id
        assert archived_bundle.year == 2025
        assert archived_bundle.month == 3
        assert archived_bundle.workflow_run_count == 1
        assert archived_bundle.row_count == 2
        session.commit.assert_called_once()

    def test_new_bundle_catalog_commit_failure_is_not_success(self):
        archiver = WorkflowRunArchiver(days=90)
        run = _run(str(uuid.uuid4()))
        run.tenant_id = str(uuid.uuid4())
        session = MagicMock()
        session.scalar.return_value = None
        session.commit.side_effect = RuntimeError("catalog commit failed")
        storage = MagicMock()
        storage.object_exists.return_value = False
        storage.list_objects.return_value = []
        table_data = {"workflow_runs": [{"id": run.id, "tenant_id": run.tenant_id}]}

        with (
            patch.object(archiver, "_lock_runs_for_archive", return_value=[run]),
            patch.object(archiver, "_extract_bundle_data", return_value=table_data),
        ):
            result = archiver._archive_bundle(session, storage, [run])

        assert result.success is False
        assert result.error == "catalog commit failed"
        session.rollback.assert_called_once()

    def test_index_skips_all_already_archived_runs(self):
        archiver = WorkflowRunArchiver(days=90)
        run = MagicMock()
        run.id = "run-1"
        run.tenant_id = "tenant-1"
        run.created_at = datetime.datetime(2025, 3, 15, 10, 0, 0)
        index_key, index_payload = self._index_payload(archiver, ["run-1"], run)
        storage = FakeArchiveStorage({index_key: index_payload})

        result = archiver._archive_bundle(MagicMock(), storage, [run])

        assert result.success is True
        assert result.skipped is True
        assert result.run_count == 0
        assert result.skipped_run_count == 1
        assert result.error == "all runs already archived in shard index"

    def test_index_filters_duplicate_runs_before_archive(self):
        archiver = WorkflowRunArchiver(days=90)
        archived_run = MagicMock()
        archived_run.id = "run-1"
        archived_run.tenant_id = "tenant-1"
        archived_run.created_at = datetime.datetime(2025, 3, 15, 10, 0, 0)
        new_run = MagicMock()
        new_run.id = "run-2"
        new_run.tenant_id = "tenant-1"
        new_run.created_at = datetime.datetime(2025, 3, 15, 11, 0, 0)
        index_key, index_payload = self._index_payload(archiver, ["run-1"], archived_run)
        storage = FakeArchiveStorage({index_key: index_payload})

        with (
            patch.object(archiver, "_lock_runs_for_archive", return_value=[new_run]) as lock_runs,
            patch.object(archiver, "_extract_bundle_data", return_value={"workflow_runs": [{"id": "run-2"}]}),
        ):
            result = archiver._archive_bundle(MagicMock(), storage, [archived_run, new_run])

        assert result.success is True
        assert result.skipped is False
        assert result.run_count == 1
        assert result.skipped_run_count == 1
        lock_runs.assert_called_once_with(ANY, ["run-2"])
        manifest_keys = [key for key in storage.objects if key.endswith("/manifest.json")]
        assert len(manifest_keys) == 1
