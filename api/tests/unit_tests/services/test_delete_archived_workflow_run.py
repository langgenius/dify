"""
Unit tests for archived workflow run deletion service.
"""

from unittest.mock import MagicMock, patch


class TestArchivedWorkflowRunDeletion:
    def test_delete_by_run_id_returns_error_when_run_missing(self):
        from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion

        deleter = ArchivedWorkflowRunDeletion()
        repo = MagicMock()
        session = MagicMock()
        session.get.return_value = None

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
        ):
            result = deleter.delete_by_run_id("run-1")

        assert result.success is False
        assert result.error == "Workflow run run-1 not found"
        repo.get_archived_run_ids.assert_not_called()

    def test_delete_by_run_id_returns_error_when_not_archived(self):
        from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion

        deleter = ArchivedWorkflowRunDeletion()
        repo = MagicMock()
        repo.get_archived_run_ids.return_value = set()
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
            patch.object(deleter, "_delete_run") as mock_delete_run,
        ):
            result = deleter.delete_by_run_id("run-1")

        assert result.success is False
        assert result.error == "Workflow run run-1 is not archived"
        mock_delete_run.assert_not_called()

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

    def test_delete_batch_uses_repo(self):
        from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion

        deleter = ArchivedWorkflowRunDeletion()
        repo = MagicMock()
        run1 = MagicMock()
        run1.id = "run-1"
        run1.tenant_id = "tenant-1"
        run2 = MagicMock()
        run2.id = "run-2"
        run2.tenant_id = "tenant-1"
        repo.get_archived_runs_by_time_range.return_value = [run1, run2]

        session = MagicMock()
        session_maker = MagicMock()
        session_maker.return_value.__enter__.return_value = session
        session_maker.return_value.__exit__.return_value = None
        start_date = MagicMock()
        end_date = MagicMock()
        mock_db = MagicMock()
        mock_db.engine = MagicMock()

        with (
            patch("services.retention.workflow_run.delete_archived_workflow_run.db", mock_db),
            patch(
                "services.retention.workflow_run.delete_archived_workflow_run.sessionmaker", return_value=session_maker
            ),
            patch.object(deleter, "_get_workflow_run_repo", return_value=repo),
            patch.object(
                deleter, "_delete_run", side_effect=[MagicMock(success=True), MagicMock(success=True)]
            ) as mock_delete_run,
        ):
            results = deleter.delete_batch(
                tenant_ids=["tenant-1"],
                start_date=start_date,
                end_date=end_date,
                limit=2,
            )

        assert len(results) == 2
        repo.get_archived_runs_by_time_range.assert_called_once_with(
            session=session,
            tenant_ids=["tenant-1"],
            start_date=start_date,
            end_date=end_date,
            limit=2,
        )
        assert mock_delete_run.call_count == 2

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

    def test_delete_run_calls_repo(self):
        from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion

        deleter = ArchivedWorkflowRunDeletion()
        run = MagicMock()
        run.id = "run-1"
        run.tenant_id = "tenant-1"

        repo = MagicMock()
        repo.delete_runs_with_related.return_value = {"runs": 1}

        with patch.object(deleter, "_get_workflow_run_repo", return_value=repo):
            result = deleter._delete_run(run)

        assert result.success is True
        assert result.deleted_counts == {"runs": 1}
        repo.delete_runs_with_related.assert_called_once()
