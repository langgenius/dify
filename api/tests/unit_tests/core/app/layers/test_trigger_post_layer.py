from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from graphon.graph_events import GraphRunFailedEvent, GraphRunSucceededEvent
from graphon.runtime import VariablePool

from core.app.layers.trigger_post_layer import TriggerPostLayer
from core.workflow.system_variables import build_system_variables
from models.enums import WorkflowTriggerStatus


class TestTriggerPostLayer:
    def test_on_event_updates_trigger_log(self):
        trigger_log = SimpleNamespace(
            status=None,
            workflow_run_id=None,
            outputs=None,
            elapsed_time=None,
            total_tokens=None,
            finished_at=None,
        )
        runtime_state = SimpleNamespace(
            outputs={"answer": "ok"},
            variable_pool=VariablePool(system_variables=build_system_variables(workflow_execution_id="run-1")),
            total_tokens=12,
        )

        with (
            patch("core.app.layers.trigger_post_layer.session_factory") as mock_session_factory,
            patch("core.app.layers.trigger_post_layer.SQLAlchemyWorkflowTriggerLogRepository") as mock_repo_cls,
            patch("core.app.layers.trigger_post_layer.datetime") as mock_datetime,
        ):
            mock_datetime.now.return_value = datetime(2026, 2, 20, tzinfo=UTC)

            session = Mock()
            mock_session_factory.create_session.return_value.__enter__.return_value = session

            repo = Mock()
            repo.get_by_id.return_value = trigger_log
            mock_repo_cls.return_value = repo

            layer = TriggerPostLayer(
                cfs_plan_scheduler_entity=Mock(),
                start_time=datetime(2026, 2, 20, tzinfo=UTC) - timedelta(seconds=10),
                trigger_log_id="log-1",
            )
            layer.initialize(runtime_state, Mock())

            layer.on_event(GraphRunSucceededEvent())

        assert trigger_log.status == WorkflowTriggerStatus.SUCCEEDED
        assert trigger_log.workflow_run_id == "run-1"
        assert trigger_log.outputs is not None
        assert trigger_log.elapsed_time is not None
        assert trigger_log.total_tokens == 12
        assert trigger_log.finished_at is not None
        repo.update.assert_called_once_with(trigger_log)
        session.commit.assert_called_once()

    def test_on_event_handles_missing_trigger_log(self):
        runtime_state = SimpleNamespace(
            outputs={},
            variable_pool=VariablePool(system_variables=build_system_variables(workflow_execution_id="run-1")),
            total_tokens=0,
        )

        with (
            patch("core.app.layers.trigger_post_layer.session_factory") as mock_session_factory,
            patch("core.app.layers.trigger_post_layer.SQLAlchemyWorkflowTriggerLogRepository") as mock_repo_cls,
            patch("core.app.layers.trigger_post_layer.logger") as mock_logger,
        ):
            session = Mock()
            mock_session_factory.create_session.return_value.__enter__.return_value = session

            repo = Mock()
            repo.get_by_id.return_value = None
            mock_repo_cls.return_value = repo

            layer = TriggerPostLayer(
                cfs_plan_scheduler_entity=Mock(),
                start_time=datetime(2026, 2, 20, tzinfo=UTC),
                trigger_log_id="missing",
            )
            layer.initialize(runtime_state, Mock())

            layer.on_event(GraphRunFailedEvent(error="boom"))

        mock_logger.exception.assert_called_once()
        session.commit.assert_not_called()

    def test_on_event_ignores_non_status_events(self):
        runtime_state = SimpleNamespace(
            outputs={},
            variable_pool=VariablePool(system_variables=build_system_variables(workflow_execution_id="run-1")),
            total_tokens=0,
        )

        with patch("core.app.layers.trigger_post_layer.session_factory") as mock_session_factory:
            layer = TriggerPostLayer(
                cfs_plan_scheduler_entity=Mock(),
                start_time=datetime(2026, 2, 20, tzinfo=UTC),
                trigger_log_id="log-1",
            )
            layer.initialize(runtime_state, Mock())

            layer.on_event(Mock())

        mock_session_factory.create_session.assert_not_called()
