"""Integration tests for workflow run cleanup repository queries."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import override
from uuid import uuid4

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from graphon.entities import WorkflowExecution
from graphon.entities.pause_reason import PauseReasonType
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowAppLog, WorkflowAppLogCreatedFrom, WorkflowPause, WorkflowPauseReason, WorkflowRun
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository


class _TestWorkflowRunRepository(DifyAPISQLAlchemyWorkflowRunRepository):
    """Concrete repository for tests where save() is not under test."""

    @override
    def save(self, execution: WorkflowExecution) -> None:
        return None


@dataclass
class _TestScope:
    """Per-test identifiers for rows created by cleanup repository tests."""

    tenant_id: str = field(default_factory=lambda: str(uuid4()))
    app_id: str = field(default_factory=lambda: str(uuid4()))
    workflow_id: str = field(default_factory=lambda: str(uuid4()))
    user_id: str = field(default_factory=lambda: str(uuid4()))


def _repository(db_session_with_containers: Session) -> DifyAPISQLAlchemyWorkflowRunRepository:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    return _TestWorkflowRunRepository(session_maker=sessionmaker(bind=engine, expire_on_commit=False))


def _create_workflow_run(
    session: Session,
    scope: _TestScope,
    *,
    status: WorkflowExecutionStatus = WorkflowExecutionStatus.SUCCEEDED,
    created_at: datetime,
    tenant_id: str | None = None,
    workflow_id: str | None = None,
    workflow_type: str = WorkflowType.WORKFLOW,
) -> WorkflowRun:
    workflow_run = WorkflowRun(
        id=str(uuid4()),
        tenant_id=tenant_id or scope.tenant_id,
        app_id=scope.app_id,
        workflow_id=workflow_id or scope.workflow_id,
        type=workflow_type,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="draft",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=scope.user_id,
        created_at=created_at,
    )
    session.add(workflow_run)
    session.commit()
    return workflow_run


def _add_app_log(session: Session, scope: _TestScope, workflow_run: WorkflowRun) -> None:
    session.add(
        WorkflowAppLog(
            tenant_id=workflow_run.tenant_id,
            app_id=scope.app_id,
            workflow_id=workflow_run.workflow_id,
            workflow_run_id=workflow_run.id,
            created_from=WorkflowAppLogCreatedFrom.SERVICE_API,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=scope.user_id,
        )
    )
    session.commit()


def _add_pause_with_reason(session: Session, _scope: _TestScope, workflow_run: WorkflowRun) -> WorkflowPause:
    pause = WorkflowPause(
        workflow_id=workflow_run.workflow_id,
        workflow_run_id=workflow_run.id,
        state_object_key=f"workflow-state-{uuid4()}.json",
    )
    pause_reason = WorkflowPauseReason(
        pause_id=pause.id,
        type_=PauseReasonType.SCHEDULED_PAUSE,
        message="scheduled pause",
    )
    session.add_all([pause, pause_reason])
    session.commit()
    return pause


class TestGetCleanupRefsBatchByTimeRange:
    def test_applies_cursor_window_and_cleanup_filters(self, db_session_with_containers: Session) -> None:
        repository = _repository(db_session_with_containers)
        scope = _TestScope()
        base = datetime(2024, 1, 1, 12, 0, 0)

        _create_workflow_run(db_session_with_containers, scope, created_at=base - timedelta(minutes=1))
        cursor_run = _create_workflow_run(db_session_with_containers, scope, created_at=base)
        first_target = _create_workflow_run(db_session_with_containers, scope, created_at=base + timedelta(minutes=1))
        second_target = _create_workflow_run(
            db_session_with_containers,
            scope,
            status=WorkflowExecutionStatus.FAILED,
            created_at=base + timedelta(minutes=2),
        )
        _create_workflow_run(
            db_session_with_containers,
            scope,
            status=WorkflowExecutionStatus.RUNNING,
            created_at=base + timedelta(minutes=1),
        )
        _create_workflow_run(
            db_session_with_containers,
            scope,
            created_at=base + timedelta(minutes=1),
            tenant_id=str(uuid4()),
        )
        _create_workflow_run(
            db_session_with_containers,
            scope,
            created_at=base + timedelta(minutes=1),
            workflow_id=str(uuid4()),
        )
        _create_workflow_run(
            db_session_with_containers,
            scope,
            created_at=base + timedelta(minutes=1),
            workflow_type=WorkflowType.CHAT,
        )
        _create_workflow_run(db_session_with_containers, scope, created_at=base + timedelta(minutes=3))

        refs = repository.get_cleanup_refs_batch_by_time_range(
            start_from=base,
            end_before=base + timedelta(minutes=4),
            last_seen=(cursor_run.created_at, cursor_run.id),
            batch_size=10,
            run_types=[WorkflowType.WORKFLOW],
            tenant_ids=[scope.tenant_id],
            workflow_ids=[scope.workflow_id],
            upper_bound=(second_target.created_at, second_target.id),
        )

        assert [(ref.id, ref.tenant_id, ref.created_at) for ref in refs] == [
            (first_target.id, scope.tenant_id, first_target.created_at),
            (second_target.id, scope.tenant_id, second_target.created_at),
        ]

    def test_returns_empty_when_run_type_filter_is_empty(self, db_session_with_containers: Session) -> None:
        repository = _repository(db_session_with_containers)

        refs = repository.get_cleanup_refs_batch_by_time_range(
            start_from=None,
            end_before=datetime(2024, 1, 2),
            last_seen=None,
            batch_size=10,
            run_types=[],
        )

        assert refs == []


class TestCountRunsWithRelatedByIds:
    def test_counts_existing_runs_and_related_rows(self, db_session_with_containers: Session) -> None:
        repository = _repository(db_session_with_containers)
        scope = _TestScope()
        workflow_run = _create_workflow_run(
            db_session_with_containers,
            scope,
            created_at=datetime(2024, 1, 1, 12, 0, 0),
        )
        missing_run_id = str(uuid4())
        _add_app_log(db_session_with_containers, scope, workflow_run)
        _add_pause_with_reason(db_session_with_containers, scope, workflow_run)
        counted_node_run_ids: list[str] = []
        counted_trigger_run_ids: list[str] = []

        counts = repository.count_runs_with_related_by_ids(
            [workflow_run.id, missing_run_id],
            count_node_executions=lambda _session, run_ids: counted_node_run_ids.extend(run_ids) or (2, 1),
            count_trigger_logs=lambda _session, run_ids: counted_trigger_run_ids.extend(run_ids) or 3,
        )

        assert counted_node_run_ids == [workflow_run.id, missing_run_id]
        assert counted_trigger_run_ids == [workflow_run.id, missing_run_id]
        assert counts == {
            "runs": 1,
            "node_executions": 2,
            "offloads": 1,
            "app_logs": 1,
            "trigger_logs": 3,
            "pauses": 1,
            "pause_reasons": 1,
        }

    def test_defaults_optional_related_counts(self, db_session_with_containers: Session) -> None:
        repository = _repository(db_session_with_containers)
        scope = _TestScope()
        workflow_run = _create_workflow_run(
            db_session_with_containers,
            scope,
            created_at=datetime(2024, 1, 1, 12, 0, 0),
        )

        counts = repository.count_runs_with_related_by_ids([workflow_run.id])

        assert counts == {
            "runs": 1,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }


class TestDeleteRunsWithRelatedByIds:
    def test_deletes_runs_and_related_rows(self, db_session_with_containers: Session) -> None:
        repository = _repository(db_session_with_containers)
        scope = _TestScope()
        workflow_run = _create_workflow_run(
            db_session_with_containers,
            scope,
            created_at=datetime(2024, 1, 1, 12, 0, 0),
        )
        _add_app_log(db_session_with_containers, scope, workflow_run)
        pause = _add_pause_with_reason(db_session_with_containers, scope, workflow_run)
        pause_id = pause.id
        deleted_node_run_ids: list[str] = []
        deleted_trigger_run_ids: list[str] = []

        counts = repository.delete_runs_with_related_by_ids(
            [workflow_run.id],
            delete_node_executions=lambda _session, run_ids: deleted_node_run_ids.extend(run_ids) or (2, 1),
            delete_trigger_logs=lambda _session, run_ids: deleted_trigger_run_ids.extend(run_ids) or 3,
        )

        assert deleted_node_run_ids == [workflow_run.id]
        assert deleted_trigger_run_ids == [workflow_run.id]
        assert counts == {
            "runs": 1,
            "node_executions": 2,
            "offloads": 1,
            "app_logs": 1,
            "trigger_logs": 3,
            "pauses": 1,
            "pause_reasons": 1,
        }
        verification_session = Session(bind=db_session_with_containers.get_bind())
        with verification_session:
            assert verification_session.get(WorkflowRun, workflow_run.id) is None
            assert verification_session.get(WorkflowPause, pause_id) is None
            assert (
                verification_session.scalar(
                    select(WorkflowAppLog).where(WorkflowAppLog.workflow_run_id == workflow_run.id)
                )
                is None
            )
            assert (
                verification_session.scalar(select(WorkflowPauseReason).where(WorkflowPauseReason.pause_id == pause_id))
                is None
            )

    def test_defaults_optional_related_counts(self, db_session_with_containers: Session) -> None:
        repository = _repository(db_session_with_containers)
        scope = _TestScope()
        workflow_run = _create_workflow_run(
            db_session_with_containers,
            scope,
            created_at=datetime(2024, 1, 1, 12, 0, 0),
        )

        counts = repository.delete_runs_with_related_by_ids([workflow_run.id])

        assert counts == {
            "runs": 1,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }

    def test_empty_ids_return_empty_counts(self, db_session_with_containers: Session) -> None:
        repository = _repository(db_session_with_containers)

        assert repository.count_runs_with_related_by_ids([]) == {
            "runs": 0,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }
        assert repository.delete_runs_with_related_by_ids([]) == {
            "runs": 0,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }
