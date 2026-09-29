"""
Testcontainers integration tests for archived workflow run deletion service.
"""

import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from graphon.enums import WorkflowExecutionStatus
from libs.archive_storage import ArchiveStorage
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowArchiveLog, WorkflowRun
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_NAME, ARCHIVE_SCHEMA_VERSION
from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion

ARCHIVED_TABLES = [
    "workflow_runs",
    "workflow_app_logs",
    "workflow_node_executions",
    "workflow_node_execution_offload",
    "workflow_pauses",
    "workflow_pause_reasons",
    "workflow_trigger_logs",
]


class FakeArchiveStorage:
    def __init__(self, objects: dict[str, bytes]):
        self.objects = objects

    def object_exists(self, key: str) -> bool:
        return key in self.objects

    def get_object(self, key: str) -> bytes:
        return self.objects[key]


class TestArchivedWorkflowRunDeletion:
    def _create_workflow_run(
        self,
        db_session_with_containers,
        *,
        tenant_id: str,
        created_at: datetime,
    ) -> WorkflowRun:
        run = WorkflowRun(
            id=str(uuid4()),
            tenant_id=tenant_id,
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type="workflow",
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            version="1.0.0",
            graph="{}",
            inputs="{}",
            status=WorkflowExecutionStatus.SUCCEEDED,
            outputs="{}",
            elapsed_time=0.1,
            total_tokens=1,
            total_steps=1,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid4()),
            created_at=created_at,
            finished_at=created_at,
            exceptions_count=0,
        )
        db_session_with_containers.add(run)
        db_session_with_containers.commit()
        return run

    def _create_archive_log(self, db_session_with_containers: Session, *, run: WorkflowRun) -> WorkflowArchiveLog:
        archive_log = WorkflowArchiveLog(
            tenant_id=run.tenant_id,
            app_id=run.app_id,
            workflow_id=run.workflow_id,
            workflow_run_id=run.id,
            created_by_role=run.created_by_role,
            created_by=run.created_by,
            log_id=None,
            log_created_at=None,
            log_created_from=None,
            run_version=run.version,
            run_status=run.status,
            run_triggered_from=run.triggered_from,
            run_error=run.error,
            run_elapsed_time=run.elapsed_time,
            run_total_tokens=run.total_tokens,
            run_total_steps=run.total_steps,
            run_created_at=run.created_at,
            run_finished_at=run.finished_at,
            run_exceptions_count=run.exceptions_count,
            trigger_metadata=None,
        )
        db_session_with_containers.add(archive_log)
        db_session_with_containers.commit()
        return archive_log

    def _archive_key(self, run: WorkflowRun) -> str:
        return (
            f"{run.tenant_id}/app_id={run.app_id}/year={run.created_at.strftime('%Y')}/"
            f"month={run.created_at.strftime('%m')}/workflow_run_id={run.id}/{ARCHIVE_BUNDLE_NAME}"
        )

    def _archive_bundle(self, run: WorkflowRun, *, workflow_run_rows: int = 1) -> bytes:
        table_payloads: dict[str, bytes] = {}
        table_counts = {
            "workflow_runs": workflow_run_rows,
            "workflow_app_logs": 0,
            "workflow_node_executions": 0,
            "workflow_node_execution_offload": 0,
            "workflow_pauses": 0,
            "workflow_pause_reasons": 0,
            "workflow_trigger_logs": 0,
        }
        for table_name in ARCHIVED_TABLES:
            records = [{"id": run.id}] if table_name == "workflow_runs" and workflow_run_rows else []
            table_payloads[table_name] = ArchiveStorage.serialize_to_jsonl(records)

        manifest = {
            "schema_version": ARCHIVE_SCHEMA_VERSION,
            "workflow_run_id": run.id,
            "tenant_id": run.tenant_id,
            "app_id": run.app_id,
            "workflow_id": run.workflow_id,
            "created_at": run.created_at.isoformat(),
            "archived_at": datetime.now(UTC).isoformat(),
            "tables": {
                table_name: {
                    "row_count": table_counts[table_name],
                    "checksum": ArchiveStorage.compute_checksum(payload),
                    "size_bytes": len(payload),
                }
                for table_name, payload in table_payloads.items()
            },
        }
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(manifest).encode("utf-8"))
            for table_name, payload in table_payloads.items():
                archive.writestr(f"{table_name}.jsonl", payload)
        return buffer.getvalue()

    def _patch_storage(self, run: WorkflowRun):
        storage = FakeArchiveStorage({self._archive_key(run): self._archive_bundle(run)})
        return patch(
            "services.retention.workflow_run.delete_archived_workflow_run.get_archive_storage",
            return_value=storage,
        )

    def test_delete_by_run_id_returns_error_when_run_missing(self, db_session_with_containers: Session):
        deleter = ArchivedWorkflowRunDeletion()
        missing_run_id = str(uuid4())

        result = deleter.delete_by_run_id(missing_run_id)

        assert result.success is False
        assert result.error == f"Workflow run {missing_run_id} not found"

    def test_delete_by_run_id_returns_error_when_not_archived(self, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        run = self._create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant_id,
            created_at=datetime.now(UTC),
        )
        deleter = ArchivedWorkflowRunDeletion()

        result = deleter.delete_by_run_id(run.id)

        assert result.success is False
        assert result.error == f"Workflow run {run.id} is not archived"

    def test_delete_batch_uses_repo(self, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        base_time = datetime.now(UTC)
        run1 = self._create_workflow_run(db_session_with_containers, tenant_id=tenant_id, created_at=base_time)
        run2 = self._create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant_id,
            created_at=base_time + timedelta(seconds=1),
        )
        self._create_archive_log(db_session_with_containers, run=run1)
        self._create_archive_log(db_session_with_containers, run=run2)
        run_ids = [run1.id, run2.id]

        storage = FakeArchiveStorage(
            {
                self._archive_key(run1): self._archive_bundle(run1),
                self._archive_key(run2): self._archive_bundle(run2),
            }
        )
        deleter = ArchivedWorkflowRunDeletion()
        with patch(
            "services.retention.workflow_run.delete_archived_workflow_run.get_archive_storage",
            return_value=storage,
        ):
            results = deleter.delete_batch(
                tenant_ids=[tenant_id],
                start_date=base_time - timedelta(minutes=1),
                end_date=base_time + timedelta(minutes=1),
                limit=2,
            )

        assert len(results) == 2
        assert all(result.success for result in results)

        remaining_runs = db_session_with_containers.scalars(
            select(WorkflowRun).where(WorkflowRun.id.in_(run_ids))
        ).all()
        assert remaining_runs == []

    def test_delete_run_calls_repo(self, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        run = self._create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant_id,
            created_at=datetime.now(UTC),
        )
        run_id = run.id
        archive_log = self._create_archive_log(db_session_with_containers, run=run)
        deleter = ArchivedWorkflowRunDeletion()

        with self._patch_storage(run):
            result = deleter._delete_run(run, archive_log)

        assert result.success is True
        assert result.deleted_counts["runs"] == 1
        db_session_with_containers.expunge_all()
        deleted_run = db_session_with_containers.get(WorkflowRun, run_id)
        assert deleted_run is None

    def test_delete_run_dry_run(self, db_session_with_containers: Session):
        """Dry run should return success without actually deleting."""
        tenant_id = str(uuid4())
        run = self._create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant_id,
            created_at=datetime.now(UTC),
        )
        run_id = run.id
        archive_log = self._create_archive_log(db_session_with_containers, run=run)
        deleter = ArchivedWorkflowRunDeletion(dry_run=True)

        with self._patch_storage(run):
            result = deleter._delete_run(run, archive_log)

        assert result.success is True
        assert result.run_id == run_id
        # Run should still exist because it's a dry run
        db_session_with_containers.expire_all()
        assert db_session_with_containers.get(WorkflowRun, run_id) is not None

    def test_delete_run_exception_returns_error(self, db_session_with_containers: Session):
        """Exception during deletion should return failure result."""
        tenant_id = str(uuid4())
        run = self._create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant_id,
            created_at=datetime.now(UTC),
        )
        archive_log = self._create_archive_log(db_session_with_containers, run=run)
        deleter = ArchivedWorkflowRunDeletion(dry_run=False)

        expected_counts = {
            "runs": 1,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }
        with patch.object(deleter, "_get_workflow_run_repo") as mock_get_repo:
            mock_repo = MagicMock()
            mock_get_repo.return_value = mock_repo
            mock_repo.get_archived_log_by_run_id.return_value = archive_log
            mock_repo.count_runs_with_related.return_value = expected_counts
            mock_repo.delete_runs_with_related.side_effect = Exception("Database error")

            with self._patch_storage(run):
                result = deleter._delete_run(run, archive_log)

        assert result.success is False
        assert result.error == "Database error"

    def test_delete_by_run_id_success(self, db_session_with_containers: Session):
        """Successfully delete an archived workflow run by ID."""
        tenant_id = str(uuid4())
        base_time = datetime.now(UTC)
        run = self._create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant_id,
            created_at=base_time,
        )
        self._create_archive_log(db_session_with_containers, run=run)
        run_id = run.id

        deleter = ArchivedWorkflowRunDeletion()
        with self._patch_storage(run):
            result = deleter.delete_by_run_id(run_id)

        assert result.success is True
        db_session_with_containers.expunge_all()
        assert db_session_with_containers.get(WorkflowRun, run_id) is None

    def test_get_workflow_run_repo_caches_instance(self, db_session_with_containers: Session):
        """_get_workflow_run_repo should return a cached repo on subsequent calls."""
        deleter = ArchivedWorkflowRunDeletion()

        repo1 = deleter._get_workflow_run_repo()
        repo2 = deleter._get_workflow_run_repo()

        assert repo1 is repo2
        assert deleter.workflow_run_repo is repo1

    def test_delete_run_fails_when_archive_object_missing(self, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        run = self._create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant_id,
            created_at=datetime.now(UTC),
        )
        archive_log = self._create_archive_log(db_session_with_containers, run=run)
        deleter = ArchivedWorkflowRunDeletion()
        storage = FakeArchiveStorage({})

        with patch(
            "services.retention.workflow_run.delete_archived_workflow_run.get_archive_storage",
            return_value=storage,
        ):
            result = deleter._delete_run(run, archive_log)

        assert result.success is False
        assert result.error == f"Archive bundle not found: {self._archive_key(run)}"
        db_session_with_containers.expire_all()
        assert db_session_with_containers.get(WorkflowRun, run.id) is not None

    def test_delete_run_fails_when_manifest_count_differs_from_live_rows(self, db_session_with_containers: Session):
        tenant_id = str(uuid4())
        run = self._create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant_id,
            created_at=datetime.now(UTC),
        )
        archive_log = self._create_archive_log(db_session_with_containers, run=run)
        bundle = self._archive_bundle(run, workflow_run_rows=0)
        storage = FakeArchiveStorage({self._archive_key(run): bundle})
        deleter = ArchivedWorkflowRunDeletion()

        with patch(
            "services.retention.workflow_run.delete_archived_workflow_run.get_archive_storage",
            return_value=storage,
        ):
            result = deleter._delete_run(run, archive_log)

        assert result.success is False
        assert "Archive row count mismatch before delete" in str(result.error)
        db_session_with_containers.expire_all()
        assert db_session_with_containers.get(WorkflowRun, run.id) is not None
