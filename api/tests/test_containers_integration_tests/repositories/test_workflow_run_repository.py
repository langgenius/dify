"""Integration tests for get_paginated_workflow_runs and get_workflow_runs_count using testcontainers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from uuid import uuid4

import pytest
from graphon.entities import WorkflowExecution
from graphon.enums import WorkflowExecutionStatus
from sqlalchemy import Engine, delete
from sqlalchemy import exc as sa_exc
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun, WorkflowType
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository


class _TestWorkflowRunRepository(DifyAPISQLAlchemyWorkflowRunRepository):
    """Concrete repository for tests where save() is not under test."""

    def save(self, execution: WorkflowExecution) -> None:
        return None


@dataclass
class _TestScope:
    """Per-test data scope used to isolate DB rows."""

    tenant_id: str = field(default_factory=lambda: str(uuid4()))
    app_id: str = field(default_factory=lambda: str(uuid4()))
    workflow_id: str = field(default_factory=lambda: str(uuid4()))
    user_id: str = field(default_factory=lambda: str(uuid4()))


def _create_workflow_run(
    session: Session,
    scope: _TestScope,
    *,
    status: WorkflowExecutionStatus,
    triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING,
    created_at_offset: timedelta | None = None,
) -> WorkflowRun:
    """Create and persist a workflow run bound to the current test scope."""
    now = naive_utc_now()
    workflow_run = WorkflowRun(
        id=str(uuid4()),
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        workflow_id=scope.workflow_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=triggered_from,
        version="draft",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=scope.user_id,
        created_at=now + created_at_offset if created_at_offset is not None else now,
    )
    session.add(workflow_run)
    session.commit()
    return workflow_run


def _cleanup_scope_data(session: Session, scope: _TestScope) -> None:
    """Remove test-created DB rows for a test scope."""
    session.execute(
        delete(WorkflowRun).where(
            WorkflowRun.tenant_id == scope.tenant_id,
            WorkflowRun.app_id == scope.app_id,
        )
    )
    session.commit()


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


class TestGetPaginatedWorkflowRuns:
    """Integration tests for get_paginated_workflow_runs."""

    def test_returns_runs_without_status_filter(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Return all runs for the given tenant/app when no status filter is applied."""
        for status in (
            WorkflowExecutionStatus.SUCCEEDED,
            WorkflowExecutionStatus.FAILED,
            WorkflowExecutionStatus.RUNNING,
        ):
            _create_workflow_run(db_session_with_containers, test_scope, status=status)

        result = repository.get_paginated_workflow_runs(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            limit=20,
            last_id=None,
            status=None,
        )

        assert len(result.data) == 3
        assert result.limit == 20
        assert result.has_more is False

    def test_filters_by_status(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Return only runs matching the requested status."""
        _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.SUCCEEDED)
        _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.SUCCEEDED)
        _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.FAILED)

        result = repository.get_paginated_workflow_runs(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            limit=20,
            last_id=None,
            status="succeeded",
        )

        assert len(result.data) == 2
        assert all(run.status == WorkflowExecutionStatus.SUCCEEDED for run in result.data)

    def test_pagination_has_more(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Return has_more=True when more records exist beyond the limit."""
        for i in range(5):
            _create_workflow_run(
                db_session_with_containers,
                test_scope,
                status=WorkflowExecutionStatus.SUCCEEDED,
                created_at_offset=timedelta(seconds=i),
            )

        result = repository.get_paginated_workflow_runs(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            limit=3,
            last_id=None,
            status=None,
        )

        assert len(result.data) == 3
        assert result.has_more is True

    def test_cursor_based_pagination(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Cursor-based pagination returns the next page of results."""
        for i in range(5):
            _create_workflow_run(
                db_session_with_containers,
                test_scope,
                status=WorkflowExecutionStatus.SUCCEEDED,
                created_at_offset=timedelta(seconds=i),
            )

        # First page
        page1 = repository.get_paginated_workflow_runs(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            limit=3,
            last_id=None,
            status=None,
        )
        assert len(page1.data) == 3
        assert page1.has_more is True

        # Second page using cursor
        page2 = repository.get_paginated_workflow_runs(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            limit=3,
            last_id=page1.data[-1].id,
            status=None,
        )
        assert len(page2.data) == 2
        assert page2.has_more is False

        # No overlap between pages
        page1_ids = {r.id for r in page1.data}
        page2_ids = {r.id for r in page2.data}
        assert page1_ids.isdisjoint(page2_ids)

    def test_invalid_last_id_raises(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        test_scope: _TestScope,
    ) -> None:
        """Raise ValueError when last_id refers to a non-existent run."""
        with pytest.raises(ValueError, match="Last workflow run not exists"):
            repository.get_paginated_workflow_runs(
                tenant_id=test_scope.tenant_id,
                app_id=test_scope.app_id,
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                limit=20,
                last_id=str(uuid4()),
                status=None,
            )

    def test_tenant_isolation(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Runs from other tenants are not returned."""
        _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.SUCCEEDED)

        other_scope = _TestScope(app_id=test_scope.app_id)
        try:
            _create_workflow_run(db_session_with_containers, other_scope, status=WorkflowExecutionStatus.SUCCEEDED)

            result = repository.get_paginated_workflow_runs(
                tenant_id=test_scope.tenant_id,
                app_id=test_scope.app_id,
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                limit=20,
                last_id=None,
                status=None,
            )

            assert len(result.data) == 1
            assert result.data[0].tenant_id == test_scope.tenant_id
        finally:
            _cleanup_scope_data(db_session_with_containers, other_scope)


class TestGetWorkflowRunsCount:
    """Integration tests for get_workflow_runs_count."""

    def test_count_without_status_filter(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Count all runs grouped by status when no status filter is applied."""
        for _ in range(3):
            _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.SUCCEEDED)
        for _ in range(2):
            _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.FAILED)
        _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.RUNNING)

        result = repository.get_workflow_runs_count(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            status=None,
        )

        assert result["total"] == 6
        assert result["succeeded"] == 3
        assert result["failed"] == 2
        assert result["running"] == 1
        assert result["stopped"] == 0
        assert result["partial-succeeded"] == 0

    def test_count_with_status_filter(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Count only runs matching the requested status."""
        for _ in range(3):
            _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.SUCCEEDED)
        _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.FAILED)

        result = repository.get_workflow_runs_count(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            status="succeeded",
        )

        assert result["total"] == 3
        assert result["succeeded"] == 3
        assert result["failed"] == 0

    def test_count_with_invalid_status_raises(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Invalid status raises StatementError because the column uses an enum type."""
        _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.SUCCEEDED)

        with pytest.raises(sa_exc.StatementError) as exc_info:
            repository.get_workflow_runs_count(
                tenant_id=test_scope.tenant_id,
                app_id=test_scope.app_id,
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                status="invalid_status",
            )
        assert isinstance(exc_info.value.orig, ValueError)

    def test_count_with_time_range(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Time range filter excludes runs created outside the window."""
        # Recent run (within 1 day)
        _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.SUCCEEDED)
        # Old run (8 days ago)
        _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.SUCCEEDED,
            created_at_offset=timedelta(days=-8),
        )

        result = repository.get_workflow_runs_count(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            status=None,
            time_range="7d",
        )

        assert result["total"] == 1
        assert result["succeeded"] == 1

    def test_count_with_status_and_time_range(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        db_session_with_containers: Session,
        test_scope: _TestScope,
    ) -> None:
        """Both status and time_range filters apply together."""
        # Recent succeeded
        _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.SUCCEEDED)
        # Recent failed
        _create_workflow_run(db_session_with_containers, test_scope, status=WorkflowExecutionStatus.FAILED)
        # Old succeeded (outside time range)
        _create_workflow_run(
            db_session_with_containers,
            test_scope,
            status=WorkflowExecutionStatus.SUCCEEDED,
            created_at_offset=timedelta(days=-8),
        )

        result = repository.get_workflow_runs_count(
            tenant_id=test_scope.tenant_id,
            app_id=test_scope.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            status="succeeded",
            time_range="7d",
        )

        assert result["total"] == 1
        assert result["succeeded"] == 1
        assert result["failed"] == 0
