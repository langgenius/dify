"""
Delete Archived Workflow Run Service.

This service deletes archived workflow run data from the database while keeping
archive logs intact.
"""

import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from models.workflow import WorkflowRun
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository


@dataclass
class DeleteResult:
    run_id: str
    tenant_id: str
    success: bool
    deleted_counts: dict[str, int] = field(default_factory=dict)
    error: str | None = None
    elapsed_time: float = 0.0


class ArchivedWorkflowRunDeletion:
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.workflow_run_repo: APIWorkflowRunRepository | None = None

    def delete_by_run_id(self, run_id: str) -> DeleteResult:
        start_time = time.time()
        result = DeleteResult(run_id=run_id, tenant_id="", success=False)

        repo = self._get_workflow_run_repo()
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        with session_maker() as session:
            run = session.get(WorkflowRun, run_id)
            if not run:
                result.error = f"Workflow run {run_id} not found"
                result.elapsed_time = time.time() - start_time
                return result

            result.tenant_id = run.tenant_id
            if not repo.get_archived_run_ids(session, [run.id]):
                result.error = f"Workflow run {run_id} is not archived"
                result.elapsed_time = time.time() - start_time
                return result

        result = self._delete_run(run)
        result.elapsed_time = time.time() - start_time
        return result

    def delete_batch(
        self,
        tenant_ids: list[str] | None,
        start_date: datetime,
        end_date: datetime,
        limit: int = 100,
    ) -> list[DeleteResult]:
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        results: list[DeleteResult] = []

        repo = self._get_workflow_run_repo()
        with session_maker() as session:
            runs = list(
                repo.get_archived_runs_by_time_range(
                    session=session,
                    tenant_ids=tenant_ids,
                    start_date=start_date,
                    end_date=end_date,
                    limit=limit,
                )
            )
        for run in runs:
            results.append(self._delete_run(run))

        return results

    def _delete_run(self, run: WorkflowRun) -> DeleteResult:
        start_time = time.time()
        result = DeleteResult(run_id=run.id, tenant_id=run.tenant_id, success=False)
        if self.dry_run:
            result.success = True
            result.elapsed_time = time.time() - start_time
            return result

        repo = self._get_workflow_run_repo()
        try:
            deleted_counts = repo.delete_runs_with_related(
                [run],
                delete_node_executions=self._delete_node_executions,
                delete_trigger_logs=self._delete_trigger_logs,
            )
            result.deleted_counts = deleted_counts
            result.success = True
        except Exception as e:
            result.error = str(e)
        result.elapsed_time = time.time() - start_time
        return result

    @staticmethod
    def _delete_trigger_logs(session: Session, run_ids: Sequence[str]) -> int:
        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        return trigger_repo.delete_by_run_ids(run_ids)

    @staticmethod
    def _delete_node_executions(
        session: Session,
        runs: Sequence[WorkflowRun],
    ) -> tuple[int, int]:
        from repositories.factory import DifyAPIRepositoryFactory

        run_ids = [run.id for run in runs]
        repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        )
        return repo.delete_by_runs(session, run_ids)

    def _get_workflow_run_repo(self) -> APIWorkflowRunRepository:
        if self.workflow_run_repo is not None:
            return self.workflow_run_repo

        from repositories.factory import DifyAPIRepositoryFactory

        self.workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(
            sessionmaker(bind=db.engine, expire_on_commit=False)
        )
        return self.workflow_run_repo
