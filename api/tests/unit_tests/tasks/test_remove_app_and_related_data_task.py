import logging
from collections.abc import Iterator, Sequence
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from unittest.mock import MagicMock, call, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

import tasks.remove_app_and_related_data_task as remove_app_task_module
from enums import DeploymentEdition
from graphon.enums import WorkflowExecutionStatus
from libs.archive_storage import ArchiveStorageNotConfiguredError
from models import AppStar
from models.agent import WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowArchiveLog
from tasks.remove_app_and_related_data_task import (
    _delete_app_stars,
    _delete_app_workflow_archive_logs,
    _delete_archived_workflow_run_files,
    _delete_draft_variable_offload_data,
    _delete_draft_variables,
    _delete_workflow_agent_node_bindings,
    delete_draft_variables_batch,
)
from tests.unit_tests.config_override import apply_config_overrides


def test_delete_workflow_agent_node_bindings_is_scoped_to_tenant_and_app(sqlite_session: Session) -> None:
    target = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config={},
    )
    kept = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-2",
        workflow_id="workflow-2",
        workflow_version="draft",
        node_id="node-2",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-2",
        current_snapshot_id="snapshot-2",
        node_job_config={},
    )
    other_tenant = WorkflowAgentNodeBinding(
        tenant_id="tenant-2",
        app_id="app-1",
        workflow_id="workflow-3",
        workflow_version="draft",
        node_id="node-3",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-3",
        current_snapshot_id="snapshot-3",
        node_job_config={},
    )
    sqlite_session.add_all([target, kept, other_tenant])
    sqlite_session.commit()
    target_id = target.id
    kept_id = kept.id
    other_tenant_id = other_tenant.id

    _delete_workflow_agent_node_bindings("tenant-1", "app-1")

    sqlite_session.expire_all()
    assert sqlite_session.get(WorkflowAgentNodeBinding, target_id) is None
    assert sqlite_session.get(WorkflowAgentNodeBinding, kept_id) is not None
    assert sqlite_session.get(WorkflowAgentNodeBinding, other_tenant_id) is not None


def test_app_cleanup_removes_agent_bindings_before_workflows(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    other_cleanup_names = (
        "_delete_app_model_configs",
        "_delete_app_site",
        "_delete_app_mcp_servers",
        "_delete_app_api_tokens",
        "_delete_installed_apps",
        "_delete_app_stars",
        "_delete_recommended_apps",
        "_delete_app_annotation_data",
        "_delete_app_dataset_joins",
        "_delete_app_workflow_runs",
        "_delete_app_workflow_node_executions",
        "_delete_app_workflow_app_logs",
        "_delete_app_conversations",
        "_delete_app_messages",
        "_delete_workflow_tool_providers",
        "_delete_app_tag_bindings",
        "_delete_end_users",
        "_delete_trace_app_configs",
        "_delete_conversation_variables",
        "_delete_draft_variables",
        "_delete_app_triggers",
        "_delete_workflow_plugin_triggers",
        "_delete_workflow_webhook_triggers",
        "_delete_workflow_schedule_plans",
        "_delete_workflow_trigger_logs",
    )
    for name in other_cleanup_names:
        monkeypatch.setattr(remove_app_task_module, name, MagicMock())

    delete_bindings = MagicMock(side_effect=lambda *_args: events.append("bindings"))
    delete_workflows = MagicMock(side_effect=lambda *_args: events.append("workflows"))
    monkeypatch.setattr(remove_app_task_module, "_delete_workflow_agent_node_bindings", delete_bindings)
    monkeypatch.setattr(remove_app_task_module, "_delete_app_workflows", delete_workflows)
    monkeypatch.setattr(
        remove_app_task_module, "_delete_app_workflow_node_executions", lambda *_args: events.append("executions")
    )
    monkeypatch.setattr(remove_app_task_module, "_delete_app_workflow_runs", lambda *_args: events.append("runs"))

    remove_app_task_module.remove_app_and_related_data_task.run(tenant_id="tenant-1", app_id="app-1")

    assert events == ["bindings", "workflows", "executions", "runs"]
    delete_bindings.assert_called_once_with("tenant-1", "app-1")
    delete_workflows.assert_called_once_with("tenant-1", "app-1")


class TestDeleteDraftVariablesBatch:
    def test_delete_draft_variables_batch_invalid_batch_size(self):
        """Test that invalid batch size raises ValueError."""
        app_id = "test-app-id"

        with pytest.raises(ValueError, match="batch_size must be positive"):
            delete_draft_variables_batch(app_id, -1)

        with pytest.raises(ValueError, match="batch_size must be positive"):
            delete_draft_variables_batch(app_id, 0)

    @patch("tasks.remove_app_and_related_data_task.delete_draft_variables_batch")
    def test_delete_draft_variables_calls_batch_function(self, mock_batch_delete):
        """Test that _delete_draft_variables calls the batch function correctly."""
        app_id = "test-app-id"
        expected_return = 42
        mock_batch_delete.return_value = expected_return

        result = _delete_draft_variables(app_id)

        assert result == expected_return
        mock_batch_delete.assert_called_once_with(app_id, batch_size=1000)


class _FakeResult:
    """Minimal stand-in for a SQLAlchemy ``Result``."""

    def __init__(self, rows: Sequence[Sequence[object]] = (), rowcount: int = 0) -> None:
        self._rows = [tuple(row) for row in rows]
        self.rowcount = rowcount

    def __iter__(self) -> Iterator[Sequence[object]]:
        return iter(self._rows)


class _FakeSessionFactory:
    """Session factory stub that counts open sessions and hands out queued results.

    Lets the tests assert that object storage cleanup runs with no session open.
    """

    def __init__(self, results: list[_FakeResult] | None = None) -> None:
        self._results = list(results or [])
        self.open_count = 0
        self.open_count_at_storage_delete: list[int] = []

    def create_session(self) -> AbstractContextManager[MagicMock]:
        factory = self

        class _TransactionContext:
            def __init__(self, session: MagicMock) -> None:
                self._session = session

            def __enter__(self) -> MagicMock:
                factory.open_count += 1
                return self._session

            def __exit__(self, *_exc_info: object) -> bool:
                factory.open_count -= 1
                return False

        class _SessionContext:
            def __enter__(self) -> MagicMock:
                factory.open_count += 1
                session = MagicMock()
                session.execute.side_effect = factory.next_result
                session.begin.return_value = _TransactionContext(session)
                return session

            def __exit__(self, *_exc_info: object) -> bool:
                factory.open_count -= 1
                return False

        return _SessionContext()

    def next_result(self, *_args: object, **_kwargs: object) -> _FakeResult:
        if self._results:
            return self._results.pop(0)
        return _FakeResult([])


class TestDeleteDraftVariableOffloadData:
    """Test the Offload data cleanup functionality."""

    def test_delete_draft_variable_offload_data_empty_file_ids(self):
        """An empty file_ids list must not open a session or touch object storage."""
        with (
            patch("tasks.remove_app_and_related_data_task.session_factory") as mock_session_factory,
            patch("extensions.ext_storage.storage") as mock_storage,
        ):
            result = _delete_draft_variable_offload_data([])

        assert result == 0
        mock_session_factory.create_session.assert_not_called()
        mock_storage.delete.assert_not_called()

    def test_delete_draft_variable_offload_data_database_failure(self, caplog: pytest.LogCaptureFixture):
        """Test handling of database operation failures."""
        mock_session_factory = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value.execute.side_effect = Exception(
            "Database error"
        )

        with patch("tasks.remove_app_and_related_data_task.session_factory", mock_session_factory):
            with caplog.at_level(logging.ERROR):
                result = _delete_draft_variable_offload_data(["file-1"])

        assert result == 0
        assert "Error deleting draft variable offload data:" in caplog.text

    def test_storage_delete_runs_with_no_open_transaction(self, monkeypatch: pytest.MonkeyPatch):
        """Object storage cleanup must not run while a database transaction is open."""
        factory = _FakeSessionFactory([_FakeResult([("vf-1", "key-1", "uf-1"), ("vf-2", "key-2", "uf-2")])])
        mock_storage = MagicMock()
        mock_storage.delete.side_effect = lambda _key: factory.open_count_at_storage_delete.append(factory.open_count)

        monkeypatch.setattr(remove_app_task_module, "session_factory", factory)
        monkeypatch.setattr("extensions.ext_storage.storage", mock_storage)

        result = _delete_draft_variable_offload_data(["vf-1", "vf-2"])

        assert result == 2
        assert mock_storage.delete.call_count == 2
        assert factory.open_count_at_storage_delete == [0, 0]
        assert factory.open_count == 0

    def test_storage_failure_is_logged_and_not_counted(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ):
        """A failing object is logged and not counted, and the DB cleanup still runs."""
        factory = _FakeSessionFactory([_FakeResult([("vf-1", "key-1", "uf-1"), ("vf-2", "key-2", "uf-2")])])
        mock_storage = MagicMock()
        mock_storage.delete.side_effect = [Exception("Storage error"), None]

        monkeypatch.setattr(remove_app_task_module, "session_factory", factory)
        monkeypatch.setattr("extensions.ext_storage.storage", mock_storage)

        with caplog.at_level(logging.ERROR):
            result = _delete_draft_variable_offload_data(["vf-1", "vf-2"])

        assert result == 1
        assert "Failed to delete storage object key-1" in caplog.text
        assert factory.open_count == 0

    def test_file_ids_with_no_matching_rows_delete_nothing(self, monkeypatch: pytest.MonkeyPatch):
        """file_ids that no longer resolve to rows must not raise or touch storage."""
        factory = _FakeSessionFactory([_FakeResult([])])
        mock_storage = MagicMock()

        monkeypatch.setattr(remove_app_task_module, "session_factory", factory)
        monkeypatch.setattr("extensions.ext_storage.storage", mock_storage)

        result = _delete_draft_variable_offload_data(["vf-gone"])

        assert result == 0
        mock_storage.delete.assert_not_called()
        assert factory.open_count == 0


class TestDeleteDraftVariablesBatchTransactionScope:
    """The batch loop must not hold a transaction while object storage is cleaned up."""

    def test_offload_cleanup_is_called_with_no_session_open(self, monkeypatch: pytest.MonkeyPatch):
        factory = _FakeSessionFactory([_FakeResult([("var-1", "vf-1")]), _FakeResult([], rowcount=1)])
        observed_open_counts: list[int] = []

        def _record_cleanup(file_ids: list[str]) -> int:
            observed_open_counts.append(factory.open_count)
            return len(file_ids)

        monkeypatch.setattr(remove_app_task_module, "session_factory", factory)
        monkeypatch.setattr(remove_app_task_module, "_delete_draft_variable_offload_data", _record_cleanup)

        total_deleted = delete_draft_variables_batch("app-1", batch_size=10)

        assert total_deleted == 1
        assert observed_open_counts == [0]
        assert factory.open_count == 0

    def test_rows_without_offloaded_files_skip_cleanup(self, monkeypatch: pytest.MonkeyPatch):
        """A batch whose rows carry no file_id must not invoke the offload cleanup."""
        factory = _FakeSessionFactory([_FakeResult([("var-1", None)]), _FakeResult([], rowcount=1)])
        cleanup = MagicMock(return_value=0)

        monkeypatch.setattr(remove_app_task_module, "session_factory", factory)
        monkeypatch.setattr(remove_app_task_module, "_delete_draft_variable_offload_data", cleanup)

        total_deleted = delete_draft_variables_batch("app-1", batch_size=10)

        assert total_deleted == 1
        cleanup.assert_not_called()
        assert factory.open_count == 0


class TestDeleteWorkflowArchiveLogs:
    @pytest.mark.parametrize("sqlite_session", [(WorkflowArchiveLog,)], indirect=True)
    @patch("tasks.remove_app_and_related_data_task._delete_records")
    @patch("tasks.remove_app_and_related_data_task.db")
    def test_delete_app_workflow_archive_logs_calls_delete_records(
        self, mock_db, mock_delete_records, sqlite_session: Session
    ):
        tenant_id = "tenant-1"
        app_id = "app-1"

        _delete_app_workflow_archive_logs(tenant_id, app_id)

        mock_delete_records.assert_called_once()
        query_sql, params, delete_func, name = mock_delete_records.call_args[0]
        assert "workflow_archive_logs" in query_sql
        assert params == {"tenant_id": tenant_id, "app_id": app_id}
        assert name == "workflow archive log"

        archive_log = WorkflowArchiveLog(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_run_id=str(uuid4()),
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid4()),
            log_id=None,
            log_created_at=None,
            log_created_from=None,
            run_version="1",
            run_status=WorkflowExecutionStatus.SUCCEEDED,
            run_triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            run_error=None,
            run_elapsed_time=0,
            run_total_tokens=0,
            run_total_steps=1,
            run_created_at=datetime.now(UTC),
            run_finished_at=datetime.now(UTC),
            run_exceptions_count=0,
            trigger_metadata=None,
        )
        sqlite_session.add(archive_log)
        sqlite_session.commit()

        delete_func(sqlite_session, archive_log.id)
        sqlite_session.commit()
        sqlite_session.expunge_all()

        assert sqlite_session.get(WorkflowArchiveLog, archive_log.id) is None


class TestDeleteAppStars:
    @pytest.mark.parametrize("sqlite_session", [(AppStar,)], indirect=True)
    @patch("tasks.remove_app_and_related_data_task._delete_records")
    def test_delete_app_stars_calls_delete_records(self, mock_delete_records, sqlite_session: Session):
        tenant_id = "tenant-1"
        app_id = "app-1"

        _delete_app_stars(tenant_id, app_id)

        mock_delete_records.assert_called_once()
        query_sql, params, delete_func, name = mock_delete_records.call_args[0]
        assert "app_stars" in query_sql
        assert params == {"tenant_id": tenant_id, "app_id": app_id}
        assert name == "app star"

        app_star = AppStar(tenant_id=str(uuid4()), app_id=str(uuid4()), account_id=str(uuid4()))
        sqlite_session.add(app_star)
        sqlite_session.commit()

        delete_func(sqlite_session, app_star.id)
        sqlite_session.commit()
        sqlite_session.expunge_all()

        assert sqlite_session.get(AppStar, app_star.id) is None


class TestDeleteArchivedWorkflowRunFiles:
    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    def test_delete_archived_workflow_run_files_not_configured(
        self, mock_get_storage, caplog: pytest.LogCaptureFixture
    ):
        mock_get_storage.side_effect = ArchiveStorageNotConfiguredError("missing config")

        with caplog.at_level(logging.INFO, logger="tasks.remove_app_and_related_data_task"):
            _delete_archived_workflow_run_files("tenant-1", "app-1")

        assert caplog.text.count("Archive storage not configured") == 1

    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    def test_delete_archived_workflow_run_files_list_failure(self, mock_get_storage, caplog: pytest.LogCaptureFixture):
        storage = MagicMock()
        storage.list_objects.side_effect = Exception("list failed")
        mock_get_storage.return_value = storage

        with caplog.at_level(logging.ERROR, logger="tasks.remove_app_and_related_data_task"):
            _delete_archived_workflow_run_files("tenant-1", "app-1")

        storage.list_objects.assert_called_once_with("tenant-1/app_id=app-1/")
        storage.delete_object.assert_not_called()
        assert "Failed to list archive files for app app-1" in caplog.text

    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    def test_delete_archived_workflow_run_files_success(self, mock_get_storage, caplog: pytest.LogCaptureFixture):
        storage = MagicMock()
        storage.list_objects.return_value = ["key-1", "key-2"]
        mock_get_storage.return_value = storage

        with caplog.at_level(logging.INFO, logger="tasks.remove_app_and_related_data_task"):
            _delete_archived_workflow_run_files("tenant-1", "app-1")

        storage.list_objects.assert_called_once_with("tenant-1/app_id=app-1/")
        storage.delete_object.assert_has_calls([call("key-1"), call("key-2")], any_order=False)
        assert "Deleted 2 archive objects for app app-1" in caplog.text
