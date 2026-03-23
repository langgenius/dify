"""Integration tests for DifyAPISQLAlchemyWorkflowRunRepository using testcontainers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import Engine, delete, select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.entities import WorkflowExecution
from core.workflow.entities.pause_reason import PauseReasonType
from core.workflow.enums import WorkflowExecutionStatus
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowAppLog, WorkflowPause, WorkflowPauseReason, WorkflowRun
from repositories.entities.workflow_pause import WorkflowPauseEntity
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    _WorkflowRunError,
)


class _TestWorkflowRunRepository(DifyAPISQLAlchemyWorkflowRunRepository):
    """Concrete repository for tests where save() is not under test."""

    def save(self, execution: WorkflowExecution) -> None:
        return None


@dataclass
class _TestScope:
    """Per-test data scope used to isolate DB rows and storage keys."""

    tenant_id: str = field(default_factory=lambda: str(uuid4()))
    app_id: str = field(default_factory=lambda: str(uuid4()))
    workflow_id: str = field(default_factory=lambda: str(uuid4()))
    user_id: str = field(default_factory=lambda: str(uuid4()))
    state_keys: set[str] = field(default_factory=set)


def _create_workflow_run(
    session: Session,
    scope: _TestScope,
    *,
    status: WorkflowExecutionStatus,
    created_at: datetime | None = None,
) -> WorkflowRun:
    """Create and persist a workflow run bound to the current test scope."""

    workflow_run = WorkflowRun(
        id=str(uuid4()),
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        workflow_id=scope.workflow_id,
        type="workflow",
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="draft",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=scope.user_id,
        created_at=created_at or naive_utc_now(),
    )
    session.add(workflow_run)
    session.commit()
    return workflow_run


def _cleanup_scope_data(session: Session, scope: _TestScope) -> None:
    """Remove test-created DB rows and storage objects for a test scope."""

    pause_ids_subquery = select(WorkflowPause.id).where(WorkflowPause.workflow_id == scope.workflow_id)
    session.execute(delete(WorkflowPauseReason).where(WorkflowPauseReason.pause_id.in_(pause_ids_subquery)))
    session.execute(delete(WorkflowPause).where(WorkflowPause.workflow_id == scope.workflow_id))
    session.execute(
        delete(WorkflowAppLog).where(
            WorkflowAppLog.tenant_id == scope.tenant_id,
            WorkflowAppLog.app_id == scope.app_id,
        )
    )
    session.execute(
        delete(WorkflowRun).where(
            WorkflowRun.tenant_id == scope.tenant_id,
            WorkflowRun.app_id == scope.app_id,
        )
    )
    session.commit()

    for state_key in scope.state_keys:
        try:
            storage.delete(state_key)
        except FileNotFoundError:
            continue


@pytest.fixture
def repository(db_session_with_containers: Session) -> DifyAPISQLAlchemyWorkflowRunRepository:
    """Build a repository backed by the testcontainers database engine."""

    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    return _TestWorkflowRunRepository(session_maker=sessionmaker(bind=engine, expire_on_commit=False))


@pytest.fixture
def test_scope(db_session_with_containers: Session) -> _TestScope:
    """Provide an isolated scope and clean related data after each test."""

    scope = _TestScope()
    yield scope
    _cleanup_scope_data(db_session_with_containers, scope)


class TestGetRunsBatchByTimeRange:
    """Integration tests for get_runs_batch_by_time_range."""

    def test_get_runs_batch_by_time_range_filters_terminal_statuses(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Return only terminal workflow runs, excluding RUNNING and PAUSED."""

        now = naive_utc_now()
        ended_statuses = [
            WorkflowExecutionStatus.SUCCEEDED,
            WorkflowExecutionStatus.FAILED,
            WorkflowExecutionStatus.STOPPED,
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
        ]
        ended_run_ids = {
            _create_workflow_run(
                db_session_with_containers,
                test_scope,
                status=status,
                created_at=now - timedelta(minutes=3),
            ).id
            for status in ended_statuses
        }
        _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.RUNNING,
            created_at=now - timedelta(minutes=2),
        )
        _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.PAUSED,
            created_at=now - timedelta(minutes=1),
        )

        runs = repository.get_runs_batch_by_time_range(
            start_from=now - timedelta(days=1),
            end_before=now + timedelta(days=1),
            last_seen=None,
            batch_size=50,
            tenant_ids=[test_scope.tenant_id],
        )

        returned_ids = {run.id for run in runs}
        returned_statuses = {run.status for run in runs}

        assert returned_ids == ended_run_ids
        assert returned_statuses == set(ended_statuses)


class TestDeleteRunsWithRelated:
    """Integration tests for delete_runs_with_related."""

    def test_uses_trigger_log_repository(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Delete run-related records and invoke injected trigger-log deleter."""

        workflow_run = _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.SUCCEEDED,
        )
        app_log = WorkflowAppLog(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            workflow_id=test_scope.workflow_id,
            workflow_run_id=workflow_run.id,
            created_from="service-api",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=test_scope.user_id,
        )
        pause = WorkflowPause(
            id=str(uuid4()),
            workflow_id=test_scope.workflow_id,
            workflow_run_id=workflow_run.id,
            state_object_key=f"workflow-state-{uuid4()}.json",
        )
        pause_reason = WorkflowPauseReason(
            pause_id=pause.id,
            type_=PauseReasonType.SCHEDULED_PAUSE,
            message="scheduled pause",
        )
        db_session_with_containers.add_all([app_log, pause, pause_reason])
        db_session_with_containers.commit()

        fake_trigger_repo = Mock()
        fake_trigger_repo.delete_by_run_ids.return_value = 3

        counts = repository.delete_runs_with_related(
            [workflow_run],
            delete_node_executions=lambda session, runs: (2, 1),
            delete_trigger_logs=lambda session, run_ids: fake_trigger_repo.delete_by_run_ids(run_ids),
        )

        fake_trigger_repo.delete_by_run_ids.assert_called_once_with([workflow_run.id])
        assert counts["node_executions"] == 2
        assert counts["offloads"] == 1
        assert counts["trigger_logs"] == 3
        assert counts["app_logs"] == 1
        assert counts["pauses"] == 1
        assert counts["pause_reasons"] == 1
        assert counts["runs"] == 1
        with Session(bind=db_session_with_containers.get_bind()) as verification_session:
            assert verification_session.get(WorkflowRun, workflow_run.id) is None


class TestCountRunsWithRelated:
    """Integration tests for count_runs_with_related."""

    def test_uses_trigger_log_repository(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Count run-related records and invoke injected trigger-log counter."""

        workflow_run = _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.SUCCEEDED,
        )
        app_log = WorkflowAppLog(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            workflow_id=test_scope.workflow_id,
            workflow_run_id=workflow_run.id,
            created_from="service-api",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=test_scope.user_id,
        )
        pause = WorkflowPause(
            id=str(uuid4()),
            workflow_id=test_scope.workflow_id,
            workflow_run_id=workflow_run.id,
            state_object_key=f"workflow-state-{uuid4()}.json",
        )
        pause_reason = WorkflowPauseReason(
            pause_id=pause.id,
            type_=PauseReasonType.SCHEDULED_PAUSE,
            message="scheduled pause",
        )
        db_session_with_containers.add_all([app_log, pause, pause_reason])
        db_session_with_containers.commit()

        fake_trigger_repo = Mock()
        fake_trigger_repo.count_by_run_ids.return_value = 3

        counts = repository.count_runs_with_related(
            [workflow_run],
            count_node_executions=lambda session, runs: (2, 1),
            count_trigger_logs=lambda session, run_ids: fake_trigger_repo.count_by_run_ids(run_ids),
        )

        fake_trigger_repo.count_by_run_ids.assert_called_once_with([workflow_run.id])
        assert counts["node_executions"] == 2
        assert counts["offloads"] == 1
        assert counts["trigger_logs"] == 3
        assert counts["app_logs"] == 1
        assert counts["pauses"] == 1
        assert counts["pause_reasons"] == 1
        assert counts["runs"] == 1


class TestCreateWorkflowPause:
    """Integration tests for create_workflow_pause."""

    def test_create_workflow_pause_success(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Create pause successfully, persist pause record, and set run status to PAUSED."""

        workflow_run = _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.RUNNING,
        )
        state = '{"test": "state"}'

        pause_entity = repository.create_workflow_pause(
            workflow_run_id=workflow_run.id,
            state_owner_user_id=test_scope.user_id,
            state=state,
            pause_reasons=[],
        )

        pause_model = db_session_with_containers.get(WorkflowPause, pause_entity.id)
        assert pause_model is not None
        test_scope.state_keys.add(pause_model.state_object_key)

        db_session_with_containers.refresh(workflow_run)
        assert workflow_run.status == WorkflowExecutionStatus.PAUSED
        assert pause_entity.id == pause_model.id
        assert pause_entity.workflow_execution_id == workflow_run.id
        assert pause_entity.get_pause_reasons() == []
        assert pause_entity.get_state() == state.encode()

    def test_create_workflow_pause_not_found(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        test_scope: _TestScope,
    ) -> None:
        """Raise ValueError when the workflow run does not exist."""

        with pytest.raises(ValueError, match="WorkflowRun not found"):
            repository.create_workflow_pause(
                workflow_run_id=str(uuid4()),
                state_owner_user_id=test_scope.user_id,
                state='{"test": "state"}',
                pause_reasons=[],
            )

    def test_create_workflow_pause_invalid_status(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Raise _WorkflowRunError when pausing a run in non-pausable status."""

        workflow_run = _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.SUCCEEDED,
        )

        with pytest.raises(_WorkflowRunError, match="Only WorkflowRun with RUNNING or PAUSED status can be paused"):
            repository.create_workflow_pause(
                workflow_run_id=workflow_run.id,
                state_owner_user_id=test_scope.user_id,
                state='{"test": "state"}',
                pause_reasons=[],
            )


class TestResumeWorkflowPause:
    """Integration tests for resume_workflow_pause."""

    def test_resume_workflow_pause_success(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Resume pause successfully and switch workflow run status back to RUNNING."""

        workflow_run = _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.RUNNING,
        )
        pause_entity = repository.create_workflow_pause(
            workflow_run_id=workflow_run.id,
            state_owner_user_id=test_scope.user_id,
            state='{"test": "state"}',
            pause_reasons=[],
        )

        pause_model = db_session_with_containers.get(WorkflowPause, pause_entity.id)
        assert pause_model is not None
        test_scope.state_keys.add(pause_model.state_object_key)

        resumed_entity = repository.resume_workflow_pause(
            workflow_run_id=workflow_run.id,
            pause_entity=pause_entity,
        )

        db_session_with_containers.refresh(workflow_run)
        db_session_with_containers.refresh(pause_model)
        assert resumed_entity.id == pause_entity.id
        assert resumed_entity.resumed_at is not None
        assert workflow_run.status == WorkflowExecutionStatus.RUNNING
        assert pause_model.resumed_at is not None

    def test_resume_workflow_pause_not_paused(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Raise _WorkflowRunError when workflow run is not in PAUSED status."""

        workflow_run = _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.RUNNING,
        )
        pause_entity = Mock(spec=WorkflowPauseEntity)
        pause_entity.id = str(uuid4())

        with pytest.raises(_WorkflowRunError, match="WorkflowRun is not in PAUSED status"):
            repository.resume_workflow_pause(
                workflow_run_id=workflow_run.id,
                pause_entity=pause_entity,
            )

    def test_resume_workflow_pause_id_mismatch(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Raise _WorkflowRunError when pause entity ID mismatches persisted pause ID."""

        workflow_run = _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.RUNNING,
        )
        pause_entity = repository.create_workflow_pause(
            workflow_run_id=workflow_run.id,
            state_owner_user_id=test_scope.user_id,
            state='{"test": "state"}',
            pause_reasons=[],
        )

        pause_model = db_session_with_containers.get(WorkflowPause, pause_entity.id)
        assert pause_model is not None
        test_scope.state_keys.add(pause_model.state_object_key)

        mismatched_pause_entity = Mock(spec=WorkflowPauseEntity)
        mismatched_pause_entity.id = str(uuid4())

        with pytest.raises(_WorkflowRunError, match="different id in WorkflowPause and WorkflowPauseEntity"):
            repository.resume_workflow_pause(
                workflow_run_id=workflow_run.id,
                pause_entity=mismatched_pause_entity,
            )


class TestDeleteWorkflowPause:
    """Integration tests for delete_workflow_pause."""

    def test_delete_workflow_pause_success(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Delete pause record and its state object from storage."""

        workflow_run = _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.RUNNING,
        )
        pause_entity = repository.create_workflow_pause(
            workflow_run_id=workflow_run.id,
            state_owner_user_id=test_scope.user_id,
            state='{"test": "state"}',
            pause_reasons=[],
        )
        pause_model = db_session_with_containers.get(WorkflowPause, pause_entity.id)
        assert pause_model is not None
        state_key = pause_model.state_object_key
        test_scope.state_keys.add(state_key)

        repository.delete_workflow_pause(pause_entity=pause_entity)

        with Session(bind=db_session_with_containers.get_bind()) as verification_session:
            assert verification_session.get(WorkflowPause, pause_entity.id) is None
        with pytest.raises(FileNotFoundError):
            storage.load(state_key)

    def test_delete_workflow_pause_not_found(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
    ) -> None:
        """Raise _WorkflowRunError when deleting a non-existent pause."""

        pause_entity = Mock(spec=WorkflowPauseEntity)
        pause_entity.id = str(uuid4())

        with pytest.raises(_WorkflowRunError, match="WorkflowPause not found"):
            repository.delete_workflow_pause(pause_entity=pause_entity)
