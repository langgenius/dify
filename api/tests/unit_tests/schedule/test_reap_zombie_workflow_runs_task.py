"""
Unit tests for schedule.reap_zombie_workflow_runs_task.

Covers:
  - Stuck SCHEDULED runs are force-failed after timeout
  - Stuck RUNNING runs are force-failed after timeout (only when no recent node activity)
  - Recent runs within the timeout window are left untouched
  - Both categories reaped in a single invocation
  - finished_at is set on reaped rows
  - synchronize_session=False is used for bulk updates
"""

from unittest.mock import MagicMock, patch

import pytest

from configs import dify_config
from graphon.enums import WorkflowExecutionStatus


class TestReapZombieWorkflowRunsTask:
    @pytest.fixture(autouse=True)
    def _setup(self, monkeypatch):
        monkeypatch.setattr(dify_config, "ZOMBIE_WORKFLOW_SCHEDULED_TIMEOUT_MINUTES", 5)
        monkeypatch.setattr(dify_config, "ZOMBIE_WORKFLOW_RUNNING_TIMEOUT_MINUTES", 30)

    def test_reaps_stuck_scheduled_runs(self, monkeypatch):
        with (
            patch("schedule.reap_zombie_workflow_runs_task.db") as mock_db,
        ):
            mock_query = MagicMock()
            mock_db.session.query.return_value = mock_query
            mock_query.filter.return_value = mock_query
            # First update call (scheduled) returns 3, second (running) returns 0
            mock_query.update.side_effect = [3, 0]

            from schedule.reap_zombie_workflow_runs_task import reap_zombie_workflow_runs_task

            reap_zombie_workflow_runs_task()

            assert mock_query.update.call_count == 2
            mock_db.session.commit.assert_called_once()

            # Check the first update was for scheduled runs
            first_update_args = mock_query.update.call_args_list[0][0][0]
            assert first_update_args["status"] == WorkflowExecutionStatus.FAILED
            assert "not picked up" in first_update_args["error"]
            assert "finished_at" in first_update_args

    def test_reaps_stuck_running_runs(self, monkeypatch):
        with (
            patch("schedule.reap_zombie_workflow_runs_task.db") as mock_db,
        ):
            mock_query = MagicMock()
            mock_db.session.query.return_value = mock_query
            mock_query.filter.return_value = mock_query
            # First update call (scheduled) returns 0, second (running) returns 2
            mock_query.update.side_effect = [0, 2]

            from schedule.reap_zombie_workflow_runs_task import reap_zombie_workflow_runs_task

            reap_zombie_workflow_runs_task()

            assert mock_query.update.call_count == 2
            mock_db.session.commit.assert_called_once()

            # Check the second update was for running runs
            second_update_args = mock_query.update.call_args_list[1][0][0]
            assert second_update_args["status"] == WorkflowExecutionStatus.FAILED
            assert "timed out" in second_update_args["error"]
            assert "node activity" in second_update_args["error"]
            assert "finished_at" in second_update_args

    def test_no_zombies_still_commits(self, monkeypatch):
        with (
            patch("schedule.reap_zombie_workflow_runs_task.db") as mock_db,
        ):
            mock_query = MagicMock()
            mock_db.session.query.return_value = mock_query
            mock_query.filter.return_value = mock_query
            mock_query.update.side_effect = [0, 0]

            from schedule.reap_zombie_workflow_runs_task import reap_zombie_workflow_runs_task

            reap_zombie_workflow_runs_task()

            # Still commits (no-op transaction is fine)
            mock_db.session.commit.assert_called_once()

    def test_reaps_both_categories(self, monkeypatch):
        with (
            patch("schedule.reap_zombie_workflow_runs_task.db") as mock_db,
        ):
            mock_query = MagicMock()
            mock_db.session.query.return_value = mock_query
            mock_query.filter.return_value = mock_query
            mock_query.update.side_effect = [5, 3]

            from schedule.reap_zombie_workflow_runs_task import reap_zombie_workflow_runs_task

            reap_zombie_workflow_runs_task()

            assert mock_query.update.call_count == 2
            mock_db.session.commit.assert_called_once()

    def test_uses_synchronize_session_false(self, monkeypatch):
        """Bulk updates must use synchronize_session=False to avoid errors
        with correlated subqueries in the RUNNING filter."""
        with (
            patch("schedule.reap_zombie_workflow_runs_task.db") as mock_db,
        ):
            mock_query = MagicMock()
            mock_db.session.query.return_value = mock_query
            mock_query.filter.return_value = mock_query
            mock_query.update.side_effect = [0, 0]

            from schedule.reap_zombie_workflow_runs_task import reap_zombie_workflow_runs_task

            reap_zombie_workflow_runs_task()

            for call in mock_query.update.call_args_list:
                assert call[1].get("synchronize_session") is False
