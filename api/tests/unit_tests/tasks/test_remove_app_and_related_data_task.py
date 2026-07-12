import logging
from collections.abc import Generator
from unittest.mock import MagicMock, call, patch

import pytest
from agenton.compositor import CompositorSessionSnapshot
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from libs.archive_storage import ArchiveStorageNotConfiguredError
from models import AgentRuntimeSession, AgentRuntimeSessionOwnerType, AgentRuntimeSessionStatus
from tasks.remove_app_and_related_data_task import (
    _cleanup_active_agent_runtime_sessions_for_app,
    _delete_app_stars,
    _delete_app_workflow_archive_logs,
    _delete_archived_workflow_run_files,
    _delete_draft_variable_offload_data,
    _delete_draft_variables,
    delete_draft_variables_batch,
)


@pytest.fixture(autouse=True)
def _create_agent_runtime_sessions_table() -> Generator[None, None, None]:
    engine = session_factory.get_session_maker().kw["bind"]
    AgentRuntimeSession.__table__.create(bind=engine, checkfirst=True)
    yield
    with session_factory.create_session() as session:
        session.execute(delete(AgentRuntimeSession))
        session.commit()
    AgentRuntimeSession.__table__.drop(bind=engine, checkfirst=True)


def _runtime_session_specs_json() -> str:
    return (
        '[{"name":"execution_context","type":"dify.execution_context","deps":{},"metadata":{},'
        '"config":{"tenant_id":"tenant-1"}},{"name":"history","type":"pydantic_ai.history","deps":{},'
        '"metadata":{},"config":null}]'
    )


def _snapshot_json() -> str:
    return CompositorSessionSnapshot(layers=[]).model_dump_json()


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


class TestDeleteDraftVariableOffloadData:
    """Test the Offload data cleanup functionality."""

    def test_delete_draft_variable_offload_data_empty_file_ids(self):
        """Test handling of empty file_ids list."""
        mock_conn = MagicMock()

        result = _delete_draft_variable_offload_data(mock_conn, [])

        assert result == 0
        mock_conn.execute.assert_not_called()

    def test_delete_draft_variable_offload_data_database_failure(self, caplog: pytest.LogCaptureFixture):
        """Test handling of database operation failures."""
        mock_conn = MagicMock()
        file_ids = ["file-1"]

        # Make execute raise an exception
        mock_conn.execute.side_effect = Exception("Database error")

        # Execute function - should not raise, but log error
        with caplog.at_level(logging.ERROR):
            result = _delete_draft_variable_offload_data(mock_conn, file_ids)

        # Should return 0 when error occurs
        assert result == 0

        # Verify error was logged
        assert "Error deleting draft variable offload data:" in caplog.text


class TestDeleteWorkflowArchiveLogs:
    @patch("tasks.remove_app_and_related_data_task._delete_records")
    @patch("tasks.remove_app_and_related_data_task.db")
    def test_delete_app_workflow_archive_logs_calls_delete_records(self, mock_db, mock_delete_records):
        tenant_id = "tenant-1"
        app_id = "app-1"

        _delete_app_workflow_archive_logs(tenant_id, app_id)

        mock_delete_records.assert_called_once()
        query_sql, params, delete_func, name = mock_delete_records.call_args[0]
        assert "workflow_archive_logs" in query_sql
        assert params == {"tenant_id": tenant_id, "app_id": app_id}
        assert name == "workflow archive log"

        mock_session = MagicMock()

        delete_func(mock_session, "log-1")

        mock_session.execute.assert_called_once()


class TestDeleteAppStars:
    @patch("tasks.remove_app_and_related_data_task._delete_records")
    def test_delete_app_stars_calls_delete_records(self, mock_delete_records):
        tenant_id = "tenant-1"
        app_id = "app-1"

        _delete_app_stars(tenant_id, app_id)

        mock_delete_records.assert_called_once()
        query_sql, params, delete_func, name = mock_delete_records.call_args[0]
        assert "app_stars" in query_sql
        assert params == {"tenant_id": tenant_id, "app_id": app_id}
        assert name == "app star"

        mock_session = MagicMock()

        delete_func(mock_session, "star-1")

        mock_session.execute.assert_called_once()


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


class TestCleanupActiveAgentRuntimeSessionsForApp:
    @patch("tasks.remove_app_and_related_data_task.cleanup_workflow_agent_runtime_session")
    @patch("tasks.remove_app_and_related_data_task.cleanup_conversation_agent_runtime_session")
    def test_enqueues_cleanup_for_active_rows_and_marks_rows_cleaned(
        self,
        mock_conversation_cleanup,
        mock_workflow_cleanup,
    ):
        with session_factory.create_session() as session:
            session.add(
                AgentRuntimeSession(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    owner_type=AgentRuntimeSessionOwnerType.CONVERSATION,
                    agent_id="agent-1",
                    agent_config_snapshot_id="snap-1",
                    conversation_id="conv-1",
                    backend_run_id="run-conv",
                    session_snapshot=_snapshot_json(),
                    composition_layer_specs=_runtime_session_specs_json(),
                    status=AgentRuntimeSessionStatus.ACTIVE,
                )
            )
            session.add(
                AgentRuntimeSession(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    owner_type=AgentRuntimeSessionOwnerType.WORKFLOW_RUN,
                    agent_id="agent-2",
                    workflow_id="wf-1",
                    workflow_run_id="wf-run-1",
                    node_id="node-1",
                    backend_run_id="run-wf",
                    session_snapshot=_snapshot_json(),
                    composition_layer_specs=_runtime_session_specs_json(),
                    status=AgentRuntimeSessionStatus.ACTIVE,
                )
            )
            session.add(
                AgentRuntimeSession(
                    tenant_id="tenant-1",
                    app_id="other-app",
                    owner_type=AgentRuntimeSessionOwnerType.CONVERSATION,
                    agent_id="agent-3",
                    conversation_id="conv-2",
                    backend_run_id="run-other",
                    session_snapshot=_snapshot_json(),
                    composition_layer_specs=_runtime_session_specs_json(),
                    status=AgentRuntimeSessionStatus.ACTIVE,
                )
            )
            session.commit()

        _cleanup_active_agent_runtime_sessions_for_app("tenant-1", "app-1", batch_size=1)

        assert mock_conversation_cleanup.delay.call_count == 1
        assert mock_workflow_cleanup.delay.call_count == 1
        conversation_payload = mock_conversation_cleanup.delay.call_args.args[0]
        workflow_payload = mock_workflow_cleanup.delay.call_args.args[0]
        assert conversation_payload["metadata"]["conversation_id"] == "conv-1"
        assert workflow_payload["metadata"]["workflow_run_id"] == "wf-run-1"
        assert conversation_payload["idempotency_key"].startswith("tenant-1:app-1:conv-1:agent-1:app-delete-cleanup:")
        assert workflow_payload["idempotency_key"].startswith(
            "tenant-1:app-1:wf-run-1:node-1:agent-2:app-delete-cleanup:"
        )
        with session_factory.create_session() as session:
            app_rows = session.scalars(
                select(AgentRuntimeSession).where(
                    AgentRuntimeSession.tenant_id == "tenant-1",
                    AgentRuntimeSession.app_id == "app-1",
                )
            ).all()
            assert {row.status for row in app_rows} == {AgentRuntimeSessionStatus.CLEANED}
            other_row = session.scalar(
                select(AgentRuntimeSession).where(
                    AgentRuntimeSession.tenant_id == "tenant-1",
                    AgentRuntimeSession.app_id == "other-app",
                )
            )
            assert other_row is not None
            assert other_row.status == AgentRuntimeSessionStatus.ACTIVE

    @patch("tasks.remove_app_and_related_data_task.cleanup_workflow_agent_runtime_session")
    @patch("tasks.remove_app_and_related_data_task.cleanup_conversation_agent_runtime_session")
    def test_marks_rows_cleaned_even_when_enqueue_fails(
        self,
        mock_conversation_cleanup,
        mock_workflow_cleanup,
    ):
        mock_conversation_cleanup.delay.side_effect = RuntimeError("queue down")
        with session_factory.create_session() as session:
            session.add(
                AgentRuntimeSession(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    owner_type=AgentRuntimeSessionOwnerType.CONVERSATION,
                    agent_id="agent-1",
                    conversation_id="conv-1",
                    backend_run_id="run-conv",
                    session_snapshot=_snapshot_json(),
                    composition_layer_specs=_runtime_session_specs_json(),
                    status=AgentRuntimeSessionStatus.ACTIVE,
                )
            )
            session.add(
                AgentRuntimeSession(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    owner_type=AgentRuntimeSessionOwnerType.WORKFLOW_RUN,
                    agent_id="agent-2",
                    workflow_id="wf-1",
                    workflow_run_id="wf-run-1",
                    node_id="node-1",
                    backend_run_id="run-wf",
                    session_snapshot=_snapshot_json(),
                    composition_layer_specs=_runtime_session_specs_json(),
                    status=AgentRuntimeSessionStatus.ACTIVE,
                )
            )
            session.commit()

        _cleanup_active_agent_runtime_sessions_for_app("tenant-1", "app-1")

        mock_conversation_cleanup.delay.assert_called_once()
        mock_workflow_cleanup.delay.assert_called_once()
        with session_factory.create_session() as session:
            rows = session.scalars(
                select(AgentRuntimeSession).where(
                    AgentRuntimeSession.tenant_id == "tenant-1",
                    AgentRuntimeSession.app_id == "app-1",
                )
            ).all()
            assert rows
            assert {row.status for row in rows} == {AgentRuntimeSessionStatus.CLEANED}

    @patch("tasks.remove_app_and_related_data_task.cleanup_workflow_agent_runtime_session")
    @patch("tasks.remove_app_and_related_data_task.cleanup_conversation_agent_runtime_session")
    def test_uses_row_identity_to_keep_distinct_app_delete_cleanup_jobs_distinct(
        self,
        mock_conversation_cleanup,
        mock_workflow_cleanup,
    ):
        del mock_workflow_cleanup
        with session_factory.create_session() as session:
            first = AgentRuntimeSession(
                tenant_id="tenant-1",
                app_id="app-1",
                owner_type=AgentRuntimeSessionOwnerType.CONVERSATION,
                agent_id="agent-1",
                agent_config_snapshot_id="snap-1",
                conversation_id="conv-1",
                backend_run_id="run-conv-1",
                session_snapshot=_snapshot_json(),
                composition_layer_specs=_runtime_session_specs_json(),
                status=AgentRuntimeSessionStatus.ACTIVE,
            )
            second = AgentRuntimeSession(
                tenant_id="tenant-1",
                app_id="app-1",
                owner_type=AgentRuntimeSessionOwnerType.CONVERSATION,
                agent_id="agent-1",
                agent_config_snapshot_id="snap-2",
                conversation_id="conv-1",
                backend_run_id="run-conv-2",
                session_snapshot=_snapshot_json(),
                composition_layer_specs=_runtime_session_specs_json(),
                status=AgentRuntimeSessionStatus.ACTIVE,
            )
            session.add(first)
            session.add(second)
            session.commit()

        _cleanup_active_agent_runtime_sessions_for_app("tenant-1", "app-1")

        assert mock_conversation_cleanup.delay.call_count == 2
        payloads = [queued_call.args[0] for queued_call in mock_conversation_cleanup.delay.call_args_list]
        assert payloads[0]["idempotency_key"] != payloads[1]["idempotency_key"]
        assert payloads[0]["idempotency_key"].endswith(first.id)
        assert payloads[1]["idempotency_key"].endswith(second.id)

    @patch("tasks.remove_app_and_related_data_task.cleanup_workflow_agent_runtime_session")
    @patch("tasks.remove_app_and_related_data_task.cleanup_conversation_agent_runtime_session")
    def test_marks_empty_runtime_layer_specs_rows_clean_without_enqueue(
        self,
        mock_conversation_cleanup,
        mock_workflow_cleanup,
    ):
        del mock_workflow_cleanup
        with session_factory.create_session() as session:
            row = AgentRuntimeSession(
                tenant_id="tenant-1",
                app_id="app-1",
                owner_type=AgentRuntimeSessionOwnerType.CONVERSATION,
                agent_id="agent-1",
                conversation_id="conv-1",
                backend_run_id="run-no-specs",
                session_snapshot=_snapshot_json(),
                composition_layer_specs="[]",
                status=AgentRuntimeSessionStatus.ACTIVE,
            )
            session.add(row)
            session.commit()

        _cleanup_active_agent_runtime_sessions_for_app("tenant-1", "app-1")

        mock_conversation_cleanup.delay.assert_not_called()
        with session_factory.create_session() as session:
            stored_row = session.scalar(select(AgentRuntimeSession).where(AgentRuntimeSession.id == row.id))
            assert stored_row is not None
            assert stored_row.status == AgentRuntimeSessionStatus.CLEANED
