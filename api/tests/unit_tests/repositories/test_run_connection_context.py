import importlib.util
import json
from datetime import datetime
from pathlib import Path
from typing import Protocol, cast
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.orm import Session, sessionmaker

from context.connection_execution import ConnectionExecutionContext, ExecutionConnectionSelection
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from graphon.entities import WorkflowExecution as LegacyExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import EndUser
from models.workflow import WorkflowRun
from repositories.entities.workflow_execution import WorkflowExecution
from tasks.workflow_execution_tasks import _create_workflow_run_from_execution, _update_workflow_run_from_execution


@pytest.fixture
def execution() -> WorkflowExecution:
    context = ConnectionExecutionContext(
        tenant_id="tenant",
        app_id="app",
        end_user_id="user",
        account_id="account",
        workflow_id="workflow",
        selections=(
            ExecutionConnectionSelection(node_id="root", provider="vendor/tool/tool", connection_id="connection"),
        ),
    )
    return WorkflowExecution(
        id_=str(uuid4()),
        workflow_id="workflow",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="published",
        graph={"nodes": []},
        inputs={},
        started_at=datetime(2026, 1, 1),
        connection_context=context,
    )


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyWorkflowExecutionRepository:
    user = EndUser(
        tenant_id="tenant", app_id="app", type=EndUserType.BROWSER, account_id="account", session_id="browser"
    )
    user.id = "user"
    return SQLAlchemyWorkflowExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id="tenant",
        app_id="app",
        user=user,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )


def test_run_choices_survive_updates_and_legacy_payloads(
    repository: SQLAlchemyWorkflowExecutionRepository,
    execution: WorkflowExecution,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository.save(execution)
    for status in (WorkflowExecutionStatus.PAUSED, WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.SUCCEEDED):
        execution.status = status
        repository.save(execution)
    repository.save(LegacyExecution.model_validate(execution.model_dump()))
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        assert run.connection_context is not None
        assert ConnectionExecutionContext.model_validate_json(run.connection_context) == execution.connection_context
        assert repository._to_domain_model(run).connection_context == execution.connection_context
        assert "connection_context" not in run.to_dict()


def test_run_choices_cannot_be_replaced(
    repository: SQLAlchemyWorkflowExecutionRepository,
    execution: WorkflowExecution,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository.save(execution)
    assert execution.connection_context is not None
    changed = execution.model_copy(
        update={"connection_context": execution.connection_context.model_copy(update={"selections": ()})}
    )
    with pytest.raises(ValueError, match="immutable"):
        repository.save(changed)
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        assert run.connection_context == execution.connection_context.model_dump_json()


@pytest.mark.parametrize("persistence", ["sql", "celery"])
def test_stale_connection_snapshot_cannot_resurrect_stopped_run(
    repository: SQLAlchemyWorkflowExecutionRepository,
    execution: WorkflowExecution,
    sqlite_session_factory: sessionmaker[Session],
    persistence: str,
) -> None:
    repository.save(execution)
    with sqlite_session_factory.begin() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        run.status = WorkflowExecutionStatus.STOPPED
        run.stop_requested_at = datetime(2026, 1, 2)

    assert execution.connection_context is not None
    stale = execution.model_copy(
        update={
            "status": WorkflowExecutionStatus.RUNNING,
            "connection_context": execution.connection_context.model_copy(update={"selections": ()}),
        }
    )
    if persistence == "sql":
        repository.save(stale)
    else:
        with sqlite_session_factory.begin() as session:
            run = session.get(WorkflowRun, execution.id_)
            assert run is not None
            _update_workflow_run_from_execution(run, stale)

    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        assert run.status == WorkflowExecutionStatus.STOPPED
        assert run.connection_context == execution.connection_context.model_dump_json()


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "workflow_id", "end_user_id"])
def test_stored_context_must_match_execution_owner(
    repository: SQLAlchemyWorkflowExecutionRepository, execution: WorkflowExecution, field: str
) -> None:
    assert execution.connection_context is not None
    mismatched = execution.model_copy(
        update={"connection_context": execution.connection_context.model_copy(update={field: "foreign"})}
    )
    with pytest.raises(ValueError, match="identity"):
        repository.save(mismatched)


def test_celery_serialization_preserves_references_and_rejects_replacement(execution: WorkflowExecution) -> None:
    restored = WorkflowExecution.model_validate_json(execution.model_dump_json())
    run = _create_workflow_run_from_execution(
        restored, "tenant", "app", WorkflowRunTriggeredFrom.APP_RUN, "user", CreatorUserRole.END_USER
    )
    assert run.connection_context is not None
    assert json.loads(run.connection_context)["selections"][0]["connection_id"] == "connection"
    _update_workflow_run_from_execution(run, restored)
    legacy = restored.model_copy(update={"connection_context": None})
    _update_workflow_run_from_execution(run, legacy)
    assert restored.connection_context is not None
    assert run.connection_context == restored.connection_context.model_dump_json()
    changed = restored.model_copy(
        update={"connection_context": restored.connection_context.model_copy(update={"selections": ()})}
    )
    with pytest.raises(ValueError, match="immutable"):
        _update_workflow_run_from_execution(run, changed)


class ContextMigration(Protocol):
    op: Operations

    def upgrade(self) -> None: ...
    def downgrade(self) -> None: ...


def test_nullable_context_migration_preserves_existing_runs() -> None:
    path = (
        Path(__file__).resolve().parents[3]
        / "migrations/versions/2026_10_22_1000-d64a3c92f810_add_run_connection_context.py"
    )
    spec = importlib.util.spec_from_file_location("run_context_migration", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    migration = cast(ContextMigration, module)
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, graph TEXT)")
        connection.exec_driver_sql("INSERT INTO workflow_runs VALUES ('legacy', '{}')")
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert connection.exec_driver_sql("SELECT connection_context FROM workflow_runs").scalar() is None
        migration.downgrade()
        assert connection.exec_driver_sql("SELECT graph FROM workflow_runs").scalar() == "{}"
        assert "connection_context" not in {
            column["name"] for column in sa.inspect(connection).get_columns("workflow_runs")
        }
    engine.dispose()


def test_logstore_keeps_the_same_secret_free_run_snapshot(
    execution: WorkflowExecution,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import MagicMock

    from extensions.logstore.repositories import logstore_workflow_execution_repository as logstore
    from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run

    monkeypatch.setattr(logstore, "AliyunLogStore", MagicMock())
    user = EndUser(
        tenant_id="tenant", app_id="app", type=EndUserType.BROWSER, account_id="account", session_id="browser"
    )
    user.id = "user"
    repository = logstore.LogstoreWorkflowExecutionRepository(
        session_factory=sqlite_session_factory,
        tenant_id="tenant",
        user=user,
        app_id="app",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )
    payload = dict(repository._to_logstore_model(execution, log_version=0))
    assert execution.connection_context is not None
    assert payload["connection_context"] == execution.connection_context.model_dump_json()
    run = _dict_to_workflow_run(payload)
    assert run.connection_context == payload["connection_context"]


def test_legacy_run_can_initialize_its_snapshot_once(
    repository: SQLAlchemyWorkflowExecutionRepository,
    execution: WorkflowExecution,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository.save(LegacyExecution.model_validate(execution.model_dump(exclude={"connection_context"})))
    execution.status = WorkflowExecutionStatus.SUCCEEDED
    repository.save(execution)
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        assert execution.connection_context is not None
        assert run.connection_context == execution.connection_context.model_dump_json()
        assert run.status == WorkflowExecutionStatus.SUCCEEDED
    changed = execution.model_copy(
        update={
            "connection_context": execution.connection_context.model_copy(update={"selections": ()}),
        }
    )
    with pytest.raises(ValueError, match="immutable"):
        repository.save(changed)


@pytest.mark.parametrize("scope", ["workflow", "creator"])
def test_legacy_initialization_must_match_stored_run_identity(
    repository: SQLAlchemyWorkflowExecutionRepository,
    execution: WorkflowExecution,
    sqlite_session_factory: sessionmaker[Session],
    scope: str,
) -> None:
    repository.save(LegacyExecution.model_validate(execution.model_dump(exclude={"connection_context"})))
    assert execution.connection_context is not None
    if scope == "workflow":
        incoming = execution.model_copy(
            update={
                "workflow_id": "foreign-workflow",
                "connection_context": execution.connection_context.model_copy(
                    update={"workflow_id": "foreign-workflow"}
                ),
            }
        )
    else:
        user = EndUser(
            tenant_id="tenant", app_id="app", type=EndUserType.BROWSER, account_id="account", session_id="other"
        )
        user.id = "foreign-user"
        repository = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant",
            app_id="app",
            user=user,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        incoming = execution.model_copy(
            update={
                "connection_context": execution.connection_context.model_copy(update={"end_user_id": user.id}),
            }
        )
    with pytest.raises(ValueError, match="identity"):
        repository.save(incoming)
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        assert run.connection_context is None


def test_async_legacy_run_can_initialize_snapshot_and_remains_immutable(execution: WorkflowExecution) -> None:
    legacy = execution.model_copy(update={"connection_context": None})
    run = _create_workflow_run_from_execution(
        legacy,
        "tenant",
        "app",
        WorkflowRunTriggeredFrom.APP_RUN,
        "user",
        CreatorUserRole.END_USER,
    )
    execution.status = WorkflowExecutionStatus.SUCCEEDED
    _update_workflow_run_from_execution(run, execution)
    assert execution.connection_context is not None
    assert run.connection_context == execution.connection_context.model_dump_json()
    assert run.status == WorkflowExecutionStatus.SUCCEEDED
    _update_workflow_run_from_execution(run, legacy)
    assert run.connection_context == execution.connection_context.model_dump_json()
    changed = execution.model_copy(
        update={
            "connection_context": execution.connection_context.model_copy(update={"selections": ()}),
        }
    )
    with pytest.raises(ValueError, match="immutable"):
        _update_workflow_run_from_execution(run, changed)
