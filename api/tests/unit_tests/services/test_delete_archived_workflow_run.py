"""
Unit tests for archived workflow run deletion service.
"""

from unittest.mock import MagicMock, patch


class TestArchivedWorkflowRunDeletion:
    def test_delete_by_run_id_calls_delete_run(self):
        from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion

        deleter = ArchivedWorkflowRunDeletion()
        repo = MagicMock()
        repo.get_archived_run_ids.return_value = {"run-1"}
        run = MagicMock()
        run.id = "run-1"
        run.tenant_id = "tenant-1"

        session = MagicMock()
        session.get.return_value = run

        session_maker = MagicMock()
        session_maker.return_value.__enter__.return_value = session
        session_maker.return_value.__exit__.return_value = None
        mock_db = MagicMock()
        mock_db.engine = MagicMock()

        with (
            patch("services.retention.workflow_run.delete_archived_workflow_run.db", mock_db),
            patch(
                "services.retention.workflow_run.delete_archived_workflow_run.sessionmaker", return_value=session_maker
            ),
            patch.object(deleter, "_get_workflow_run_repo", return_value=repo),
            patch.object(deleter, "_delete_run", return_value=MagicMock(success=True)) as mock_delete_run,
        ):
            result = deleter.delete_by_run_id("run-1")

        assert result.success is True
        mock_delete_run.assert_called_once_with(run)

    def test_delete_run_dry_run(self):
        from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion

        deleter = ArchivedWorkflowRunDeletion(dry_run=True)
        run = MagicMock()
        run.id = "run-1"
        run.tenant_id = "tenant-1"

        with patch.object(deleter, "_get_workflow_run_repo") as mock_get_repo:
            result = deleter._delete_run(run)

        assert result.success is True
        mock_get_repo.assert_not_called()
