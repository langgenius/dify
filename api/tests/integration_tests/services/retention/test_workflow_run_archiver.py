import datetime
import io
import json
import uuid
import zipfile
from unittest.mock import MagicMock, patch

import pytest

from services.retention.workflow_run.archive_paid_plan_workflow_run import (
    ArchiveSummary,
    WorkflowRunArchiver,
)
from services.retention.workflow_run.constants import ARCHIVE_SCHEMA_VERSION


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


class TestBuildArchiveBundle:
    def test_bundle_contains_manifest_and_all_tables(self):
        archiver = WorkflowRunArchiver(days=90)

        manifest_data = json.dumps({"schema_version": ARCHIVE_SCHEMA_VERSION}).encode("utf-8")
        table_payloads = dict.fromkeys(archiver.ARCHIVED_TABLES, b"")

        bundle_bytes = archiver._build_archive_bundle(manifest_data, table_payloads)

        with zipfile.ZipFile(io.BytesIO(bundle_bytes), "r") as zf:
            names = set(zf.namelist())
            assert "manifest.json" in names
            for table in archiver.ARCHIVED_TABLES:
                assert f"{table}.jsonl" in names, f"Missing {table}.jsonl in bundle"

    def test_bundle_missing_table_payload_raises(self):
        archiver = WorkflowRunArchiver(days=90)
        manifest_data = b"{}"
        incomplete_payloads = {archiver.ARCHIVED_TABLES[0]: b"data"}

        with pytest.raises(ValueError, match="Missing archive payload"):
            archiver._build_archive_bundle(manifest_data, incomplete_payloads)


class TestGenerateManifest:
    def test_manifest_structure(self):
        archiver = WorkflowRunArchiver(days=90)
        from services.retention.workflow_run.archive_paid_plan_workflow_run import TableStats

        run = MagicMock()
        run.id = str(uuid.uuid4())
        run.tenant_id = str(uuid.uuid4())
        run.app_id = str(uuid.uuid4())
        run.workflow_id = str(uuid.uuid4())
        run.created_at = datetime.datetime(2025, 3, 15, 10, 0, 0)

        stats = [
            TableStats(table_name="workflow_runs", row_count=1, checksum="abc123", size_bytes=512),
            TableStats(table_name="workflow_app_logs", row_count=2, checksum="def456", size_bytes=1024),
        ]

        manifest = archiver._generate_manifest(run, stats)

        assert manifest["schema_version"] == ARCHIVE_SCHEMA_VERSION
        assert manifest["workflow_run_id"] == run.id
        assert manifest["tenant_id"] == run.tenant_id
        assert manifest["app_id"] == run.app_id
        assert "tables" in manifest
        assert manifest["tables"]["workflow_runs"]["row_count"] == 1
        assert manifest["tables"]["workflow_runs"]["checksum"] == "abc123"
        assert manifest["tables"]["workflow_app_logs"]["row_count"] == 2


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


class TestDryRunArchive:
    @patch("services.retention.workflow_run.archive_paid_plan_workflow_run.get_archive_storage")
    def test_dry_run_does_not_call_storage(self, mock_get_storage, flask_req_ctx):
        archiver = WorkflowRunArchiver(days=90, dry_run=True)

        with patch.object(archiver, "_get_runs_batch", return_value=[]):
            summary = archiver.run()

        mock_get_storage.assert_not_called()
        assert isinstance(summary, ArchiveSummary)
        assert summary.runs_failed == 0
