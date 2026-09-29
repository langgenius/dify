"""Unit tests for workflow node execution conflict handling."""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

import psycopg2.errors
import pytest
from sqlalchemy import Engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.workflow_writers import build_workflow_offload_uploader
from graphon.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
)
from graphon.enums import BuiltinNodeTypes
from libs.datetime_utils import naive_utc_now
from models import Account, WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.workflow.node_execution_writer import (
    SQLAlchemyWorkflowNodeExecutionRepository,
)
from tests.unit_tests.model_factories import make_account, make_tenant


@dataclass(frozen=True)
class ConflictDatabase:
    engine: Engine
    session: Session
    session_factory: sessionmaker[Session]


@dataclass(frozen=True)
class ConflictEvents:
    insert_attempts: list[str]


@pytest.fixture
def conflict_database(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> ConflictDatabase:
    """Use the shared SQLite fixtures for repository-owned sessions and assertions."""
    engine = sqlite_session.get_bind()
    assert isinstance(engine, Engine)
    return ConflictDatabase(
        engine=engine,
        session=sqlite_session,
        session_factory=sqlite_session_factory,
    )


def _account() -> Account:
    return make_account(
        account_id="test-user-id",
        name="Conflict User",
        email="conflict@example.com",
        tenant=make_tenant(tenant_id="test-tenant-id", name="Conflict Tenant"),
    )


@pytest.fixture
def repository(conflict_database: ConflictDatabase) -> SQLAlchemyWorkflowNodeExecutionRepository:
    return SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=conflict_database.session_factory,
        tenant_id="test-tenant-id",
        user=_account(),
        app_id="test-app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        upload_file=build_workflow_offload_uploader(
            session_factory=conflict_database.session_factory, tenant_id="test-tenant-id", user=_account()
        ),
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

    event.listen(engine, "before_cursor_execute", fail_insert)
    try:
        yield ConflictEvents(insert_attempts=insert_attempts)
    finally:
        event.remove(engine, "before_cursor_execute", fail_insert)


class TestWorkflowNodeExecutionConflictHandling:
    """Test cases for handling duplicate key conflicts in workflow node execution."""

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

    @pytest.mark.parametrize("duplicate", [False, True])
    def test_save_integrity_error_without_a_conflicting_row_preserves_the_error(
        self,
        repository: SQLAlchemyWorkflowNodeExecutionRepository,
        conflict_database: ConflictDatabase,
        duplicate: bool,
    ) -> None:
        execution = _execution(execution_id="test-id")

        with _fail_inserts(conflict_database.engine, failure_count=1, duplicate=duplicate) as conflicts:
            with pytest.raises(IntegrityError):
                repository.save(execution)

        assert execution.id == "test-id"
        assert len(conflicts.insert_attempts) == 1
        assert conflict_database.session.get(WorkflowNodeExecutionModel, execution.id) is None
