"""
Testcontainers integration tests for archived workflow run deletion service.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from core.workflow.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowArchiveLog, WorkflowRun
from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion


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

    def _create_archive_log(self, db_session_with_containers, *, run: WorkflowRun) -> None:
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

    def test_delete_by_run_id_returns_error_when_run_missing(self, db_session_with_containers):
        deleter = ArchivedWorkflowRunDeletion()
        missing_run_id = str(uuid4())

        result = deleter.delete_by_run_id(missing_run_id)

        assert result.success is False
        assert result.error == f"Workflow run {missing_run_id} not found"

    def test_delete_by_run_id_returns_error_when_not_archived(self, db_session_with_containers):
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

    def test_delete_batch_uses_repo(self, db_session_with_containers):
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

        deleter = ArchivedWorkflowRunDeletion()
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

    def test_delete_run_calls_repo(self, db_session_with_containers):
        tenant_id = str(uuid4())
        run = self._create_workflow_run(
            db_session_with_containers,
            tenant_id=tenant_id,
            created_at=datetime.now(UTC),
        )
        run_id = run.id
        deleter = ArchivedWorkflowRunDeletion()

        result = deleter._delete_run(run)

        assert result.success is True
        assert result.deleted_counts["runs"] == 1
        db_session_with_containers.expunge_all()
        deleted_run = db_session_with_containers.get(WorkflowRun, run_id)
        assert deleted_run is None
