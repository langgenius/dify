"""Unit tests for workflow node execution conflict handling."""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

import psycopg2.errors
import pytest
from sqlalchemy import Engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.sqlalchemy_workflow_node_execution_repository import (
    SQLAlchemyWorkflowNodeExecutionRepository,
)
from graphon.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
)
from graphon.enums import BuiltinNodeTypes
from libs.datetime_utils import naive_utc_now
from models import Account, Tenant, WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom


@dataclass(frozen=True)
class ConflictDatabase:
    engine: Engine
    session: Session
    session_factory: sessionmaker[Session]


@dataclass(frozen=True)
class ConflictEvents:
    insert_attempts: list[str]
    rollbacks: list[bool]


@pytest.fixture
def conflict_database(sqlite_engine: Engine) -> Iterator[ConflictDatabase]:
    """Create the execution table and real repository-owned sessions."""
    WorkflowNodeExecutionModel.metadata.create_all(
        sqlite_engine,
        tables=[WorkflowNodeExecutionModel.__table__],
    )
    sqlite_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sqlite_session_maker() as session:
        yield ConflictDatabase(
            engine=sqlite_engine,
            session=session,
            session_factory=sqlite_session_maker,
        )


def _account() -> Account:
    tenant = Tenant(name="Conflict Tenant")
    tenant.id = "test-tenant-id"
    account = Account(name="Conflict User", email="conflict@example.com")
    account.id = "test-user-id"
    account._current_tenant = tenant
    return account


@pytest.fixture
def repository(conflict_database: ConflictDatabase) -> SQLAlchemyWorkflowNodeExecutionRepository:
    return SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=conflict_database.session_factory,
        tenant_id="test-tenant-id",
        user=_account(),
        app_id="test-app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )


def _execution(
    *,
    execution_id: str,
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING,
) -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
        id=execution_id,
        workflow_id="test-workflow-id",
        workflow_execution_id="test-workflow-execution-id",
        node_execution_id="test-node-execution-id",
        node_id="test-node-id",
        node_type=BuiltinNodeTypes.START,
        title="Test Node",
        index=1,
        status=status,
        created_at=naive_utc_now(),
    )


@contextmanager
def _fail_inserts(
    engine: Engine,
    *,
    failure_count: int,
    duplicate: bool,
) -> Iterator[ConflictEvents]:
    insert_attempts: list[str] = []
    rollbacks: list[bool] = []

    def fail_insert(_connection, _cursor, statement, parameters, _context, _executemany) -> None:
        if not statement.lstrip().upper().startswith("INSERT INTO WORKFLOW_NODE_EXECUTIONS"):
            return
        insert_attempts.append(statement)
        if len(insert_attempts) > failure_count:
            return
        original_error = (
            psycopg2.errors.UniqueViolation("forced duplicate key")
            if duplicate
            else RuntimeError("forced non-duplicate constraint failure")
        )
        raise IntegrityError(statement, parameters, original_error)

    def record_rollback(_connection) -> None:
        rollbacks.append(True)

    event.listen(engine, "before_cursor_execute", fail_insert)
    event.listen(engine, "rollback", record_rollback)
    try:
        yield ConflictEvents(insert_attempts=insert_attempts, rollbacks=rollbacks)
    finally:
        event.remove(engine, "before_cursor_execute", fail_insert)
        event.remove(engine, "rollback", record_rollback)


class TestWorkflowNodeExecutionConflictHandling:
    """Test cases for handling duplicate key conflicts in workflow node execution."""

    def test_save_with_duplicate_key_retries_with_new_uuid(
        self,
        repository: SQLAlchemyWorkflowNodeExecutionRepository,
        conflict_database: ConflictDatabase,
    ) -> None:
        execution = _execution(execution_id="original-id")
        original_id = execution.id

        with _fail_inserts(conflict_database.engine, failure_count=1, duplicate=True) as conflicts:
            repository.save(execution)

        assert len(conflicts.insert_attempts) == 2
        assert len(conflicts.rollbacks) == 1
        assert execution.id != original_id
        assert conflict_database.session.get(WorkflowNodeExecutionModel, original_id) is None
        persisted = conflict_database.session.get(WorkflowNodeExecutionModel, execution.id)
        assert persisted is not None
        assert persisted.node_execution_id == execution.node_execution_id

    def test_save_with_existing_record_updates_instead_of_insert(
        self,
        repository: SQLAlchemyWorkflowNodeExecutionRepository,
        conflict_database: ConflictDatabase,
    ) -> None:
        execution = _execution(execution_id="existing-id")
        repository.save(execution)

        execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
        repository.save(execution)

        conflict_database.session.expire_all()
        persisted = conflict_database.session.get(WorkflowNodeExecutionModel, execution.id)
        assert persisted is not None
        assert persisted.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert conflict_database.session.query(WorkflowNodeExecutionModel).count() == 1

    def test_save_exceeds_max_retries_raises_error(
        self,
        repository: SQLAlchemyWorkflowNodeExecutionRepository,
        conflict_database: ConflictDatabase,
    ) -> None:
        execution = _execution(execution_id="test-id")

        with _fail_inserts(conflict_database.engine, failure_count=3, duplicate=True) as conflicts:
            with pytest.raises(IntegrityError):
                repository.save(execution)

        assert len(conflicts.insert_attempts) == 3
        assert len(conflicts.rollbacks) == 3
        assert conflict_database.session.query(WorkflowNodeExecutionModel).count() == 0

    def test_save_non_duplicate_integrity_error_raises_immediately(
        self,
        repository: SQLAlchemyWorkflowNodeExecutionRepository,
        conflict_database: ConflictDatabase,
    ) -> None:
        execution = _execution(execution_id="test-id")

        with _fail_inserts(conflict_database.engine, failure_count=1, duplicate=False) as conflicts:
            with pytest.raises(IntegrityError):
                repository.save(execution)

        assert len(conflicts.insert_attempts) == 1
        assert len(conflicts.rollbacks) == 1
        assert conflict_database.session.get(WorkflowNodeExecutionModel, execution.id) is None
