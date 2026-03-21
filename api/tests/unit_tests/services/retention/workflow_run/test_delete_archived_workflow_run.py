from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from models.workflow import WorkflowRun
from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion, DeleteResult


class TestArchivedWorkflowRunDeletion:
    @pytest.fixture
    def mock_db(self):
        with patch("services.retention.workflow_run.delete_archived_workflow_run.db") as mock_db:
            mock_db.engine = MagicMock()
            yield mock_db

    @pytest.fixture
    def mock_sessionmaker(self):
        with patch("services.retention.workflow_run.delete_archived_workflow_run.sessionmaker") as mock_sm:
            mock_session = MagicMock(spec=Session)
            mock_sm.return_value.return_value.__enter__.return_value = mock_session
            yield mock_sm, mock_session

    @pytest.fixture
    def mock_workflow_run_repo(self):
        with patch(
            "services.retention.workflow_run.delete_archived_workflow_run.APIWorkflowRunRepository"
        ) as mock_repo_cls:
            mock_repo = MagicMock()
            yield mock_repo

    def test_delete_by_run_id_success(self, mock_db, mock_sessionmaker):
        mock_sm, mock_session = mock_sessionmaker
        run_id = "run-123"
        tenant_id = "tenant-456"

        mock_run = MagicMock(spec=WorkflowRun)
        mock_run.id = run_id
        mock_run.tenant_id = tenant_id
        mock_session.get.return_value = mock_run

        deletion = ArchivedWorkflowRunDeletion()

        with patch.object(deletion, "_get_workflow_run_repo") as mock_get_repo:
            mock_repo = MagicMock()
            mock_get_repo.return_value = mock_repo
            mock_repo.get_archived_run_ids.return_value = [run_id]

            with patch.object(deletion, "_delete_run") as mock_delete_run:
                expected_result = DeleteResult(run_id=run_id, tenant_id=tenant_id, success=True)
                mock_delete_run.return_value = expected_result

                result = deletion.delete_by_run_id(run_id)

                assert result == expected_result
                mock_session.get.assert_called_once_with(WorkflowRun, run_id)
                mock_repo.get_archived_run_ids.assert_called_once()
                mock_delete_run.assert_called_once_with(mock_run)

    def test_delete_by_run_id_not_found(self, mock_db, mock_sessionmaker):
        mock_sm, mock_session = mock_sessionmaker
        run_id = "run-123"
        mock_session.get.return_value = None

        deletion = ArchivedWorkflowRunDeletion()
        with patch.object(deletion, "_get_workflow_run_repo"):
            result = deletion.delete_by_run_id(run_id)

            assert result.success is False
            assert "not found" in result.error
            assert result.run_id == run_id

    def test_delete_by_run_id_not_archived(self, mock_db, mock_sessionmaker):
        mock_sm, mock_session = mock_sessionmaker
        run_id = "run-123"

        mock_run = MagicMock(spec=WorkflowRun)
        mock_run.id = run_id
        mock_session.get.return_value = mock_run

        deletion = ArchivedWorkflowRunDeletion()
        with patch.object(deletion, "_get_workflow_run_repo") as mock_get_repo:
            mock_repo = MagicMock()
            mock_get_repo.return_value = mock_repo
            mock_repo.get_archived_run_ids.return_value = []

            result = deletion.delete_by_run_id(run_id)

            assert result.success is False
            assert "is not archived" in result.error

    def test_delete_batch(self, mock_db, mock_sessionmaker):
        mock_sm, mock_session = mock_sessionmaker
        deletion = ArchivedWorkflowRunDeletion()

        mock_run1 = MagicMock(spec=WorkflowRun)
        mock_run1.id = "run-1"
        mock_run2 = MagicMock(spec=WorkflowRun)
        mock_run2.id = "run-2"

        with patch.object(deletion, "_get_workflow_run_repo") as mock_get_repo:
            mock_repo = MagicMock()
            mock_get_repo.return_value = mock_repo
            mock_repo.get_archived_runs_by_time_range.return_value = [mock_run1, mock_run2]

            with patch.object(deletion, "_delete_run") as mock_delete_run:
                mock_delete_run.side_effect = [
                    DeleteResult(run_id="run-1", tenant_id="t1", success=True),
                    DeleteResult(run_id="run-2", tenant_id="t1", success=True),
                ]

                results = deletion.delete_batch(tenant_ids=["t1"], start_date=datetime.now(), end_date=datetime.now())

                assert len(results) == 2
                assert results[0].run_id == "run-1"
                assert results[1].run_id == "run-2"
                assert mock_delete_run.call_count == 2

    def test_delete_run_dry_run(self):
        deletion = ArchivedWorkflowRunDeletion(dry_run=True)
        mock_run = MagicMock(spec=WorkflowRun)
        mock_run.id = "run-123"
        mock_run.tenant_id = "tenant-456"

        result = deletion._delete_run(mock_run)

        assert result.success is True
        assert result.run_id == "run-123"

    def test_delete_run_success(self):
        deletion = ArchivedWorkflowRunDeletion(dry_run=False)
        mock_run = MagicMock(spec=WorkflowRun)
        mock_run.id = "run-123"
        mock_run.tenant_id = "tenant-456"

        with patch.object(deletion, "_get_workflow_run_repo") as mock_get_repo:
            mock_repo = MagicMock()
            mock_get_repo.return_value = mock_repo
            mock_repo.delete_runs_with_related.return_value = {"workflow_runs": 1}

            result = deletion._delete_run(mock_run)

            assert result.success is True
            assert result.deleted_counts == {"workflow_runs": 1}

    def test_delete_run_exception(self):
        deletion = ArchivedWorkflowRunDeletion(dry_run=False)
        mock_run = MagicMock(spec=WorkflowRun)
        mock_run.id = "run-123"

        with patch.object(deletion, "_get_workflow_run_repo") as mock_get_repo:
            mock_repo = MagicMock()
            mock_get_repo.return_value = mock_repo
            mock_repo.delete_runs_with_related.side_effect = Exception("Database error")

            result = deletion._delete_run(mock_run)

            assert result.success is False
            assert result.error == "Database error"

    def test_delete_trigger_logs(self):
        mock_session = MagicMock(spec=Session)
        run_ids = ["run-1", "run-2"]

        with patch(
            "services.retention.workflow_run.delete_archived_workflow_run.SQLAlchemyWorkflowTriggerLogRepository"
        ) as mock_repo_cls:
            mock_repo = MagicMock()
            mock_repo_cls.return_value = mock_repo
            mock_repo.delete_by_run_ids.return_value = 5

            count = ArchivedWorkflowRunDeletion._delete_trigger_logs(mock_session, run_ids)

            assert count == 5
            mock_repo_cls.assert_called_once_with(mock_session)
            mock_repo.delete_by_run_ids.assert_called_once_with(run_ids)

    def test_delete_node_executions(self):
        mock_session = MagicMock(spec=Session)
        mock_run = MagicMock(spec=WorkflowRun)
        mock_run.id = "run-1"
        runs = [mock_run]

        with patch(
            "repositories.factory.DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository"
        ) as mock_create_repo:
            mock_repo = MagicMock()
            mock_create_repo.return_value = mock_repo
            mock_repo.delete_by_runs.return_value = (1, 2)

            with patch("services.retention.workflow_run.delete_archived_workflow_run.sessionmaker") as mock_sm:
                result = ArchivedWorkflowRunDeletion._delete_node_executions(mock_session, runs)

                assert result == (1, 2)
                mock_create_repo.assert_called_once()
                mock_repo.delete_by_runs.assert_called_once_with(mock_session, ["run-1"])

    def test_get_workflow_run_repo(self, mock_db):
        deletion = ArchivedWorkflowRunDeletion()

        with patch(
            "repositories.factory.DifyAPIRepositoryFactory.create_api_workflow_run_repository"
        ) as mock_create_repo:
            mock_repo = MagicMock()
            mock_create_repo.return_value = mock_repo

            # First call
            repo1 = deletion._get_workflow_run_repo()
            assert repo1 == mock_repo
            assert deletion.workflow_run_repo == mock_repo

            # Second call (should return cached)
            repo2 = deletion._get_workflow_run_repo()
            assert repo2 == mock_repo
            mock_create_repo.assert_called_once()
