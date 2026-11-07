import logging
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from core.app.layers.trigger_post_layer import TriggerPostLayer
from core.workflow.system_variables import build_system_variables
from graphon.engine_events import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunSucceededEvent,
)
from graphon.runtime import VariablePool
from models.enums import AppTriggerType, CreatorUserRole, WorkflowTriggerStatus
from models.trigger import WorkflowTriggerLog


@pytest.fixture
def recorded_statements(sqlite_engine: Engine) -> Iterator[list[str]]:
    """Record the statements the layer issues through the shared SQLite engine."""
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        yield statements
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)


def _persist_trigger_log(session: Session, *, trigger_log_id: str = "log-1") -> WorkflowTriggerLog:
    trigger_log = WorkflowTriggerLog(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id=None,
        root_node_id=None,
        trigger_metadata="{}",
        trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
        trigger_data="{}",
        inputs="{}",
        outputs=None,
        status=WorkflowTriggerStatus.RUNNING,
        error=None,
        queue_name="workflow",
        celery_task_id=None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )
    trigger_log.id = trigger_log_id
    session.add(trigger_log)
    session.commit()
    return trigger_log


class TestTriggerPostLayer:
    def test_on_event_updates_trigger_log(self, sqlite_session: Session) -> None:
        trigger_log = _persist_trigger_log(sqlite_session)
        runtime_state = SimpleNamespace(
            outputs={"answer": "ok"},
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-1")
            ),
            total_tokens=12,
        )

        with (
            patch("core.app.layers.trigger_post_layer.datetime") as mock_datetime,
        ):
            mock_datetime.now.return_value = datetime(2026, 2, 20, tzinfo=UTC)

            layer = TriggerPostLayer(
                cfs_plan_scheduler_entity=Mock(),
                start_time=datetime(2026, 2, 20, tzinfo=UTC) - timedelta(seconds=10),
                trigger_log_id="log-1",
            )
            layer.initialize(runtime_state, Mock())

            layer.on_event(GraphRunSucceededEvent())

        sqlite_session.expire_all()
        persisted_log = sqlite_session.get(WorkflowTriggerLog, trigger_log.id)
        assert persisted_log is not None
        assert persisted_log.status == WorkflowTriggerStatus.SUCCEEDED
        assert persisted_log.workflow_run_id == "run-1"
        assert persisted_log.outputs == '{"answer":"ok"}'
        assert persisted_log.elapsed_time == 10
        assert persisted_log.total_tokens == 12
        assert persisted_log.finished_at is not None

    def test_on_event_updates_trigger_log_for_aborted_event(self, sqlite_session: Session) -> None:
        trigger_log = _persist_trigger_log(sqlite_session)
        runtime_state = SimpleNamespace(
            outputs={"partial": "ok"},
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-1")
            ),
            total_tokens=7,
        )

        with (
            patch("core.app.layers.trigger_post_layer.datetime") as mock_datetime,
        ):
            mock_datetime.now.return_value = datetime(2026, 2, 20, tzinfo=UTC)

            layer = TriggerPostLayer(
                cfs_plan_scheduler_entity=Mock(),
                start_time=datetime(2026, 2, 20, tzinfo=UTC) - timedelta(seconds=10),
                trigger_log_id="log-1",
            )
            layer.initialize(runtime_state, Mock())

            layer.on_event(GraphRunAbortedEvent(reason="timeout"))

        sqlite_session.expire_all()
        persisted_log = sqlite_session.get(WorkflowTriggerLog, trigger_log.id)
        assert persisted_log is not None
        assert persisted_log.status == WorkflowTriggerStatus.FAILED
        assert persisted_log.workflow_run_id == "run-1"
        assert persisted_log.outputs == '{"partial":"ok"}'
        assert persisted_log.error == "timeout"
        assert persisted_log.elapsed_time == 10
        assert persisted_log.total_tokens == 7
        assert persisted_log.finished_at is not None

    def test_on_event_handles_missing_trigger_log(
        self,
        caplog: pytest.LogCaptureFixture,
        sqlite_session: Session,
    ) -> None:
        runtime_state = SimpleNamespace(
            outputs={},
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-1")
            ),
            total_tokens=0,
        )

        layer = TriggerPostLayer(
            cfs_plan_scheduler_entity=Mock(),
            start_time=datetime(2026, 2, 20, tzinfo=UTC),
            trigger_log_id="missing",
        )
        layer.initialize(runtime_state, Mock())

        with caplog.at_level(logging.ERROR, logger="core.app.layers.trigger_post_layer"):
            layer.on_event(GraphRunFailedEvent(error="boom"))

        assert any(record.levelno == logging.ERROR for record in caplog.records)
        assert sqlite_session.get(WorkflowTriggerLog, "missing") is None

    def test_on_event_ignores_non_status_events(self, recorded_statements: list[str]) -> None:
        runtime_state = SimpleNamespace(
            outputs={},
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-1")
            ),
            total_tokens=0,
        )

        layer = TriggerPostLayer(
            cfs_plan_scheduler_entity=Mock(),
            start_time=datetime(2026, 2, 20, tzinfo=UTC),
            trigger_log_id="log-1",
        )
        layer.initialize(runtime_state, Mock())

        recorded_statements.clear()
        layer.on_event(Mock())

        assert recorded_statements == []
