"""
Unit tests for schedule.reap_zombie_workflow_runs_task.

Covers:
  - Stuck SCHEDULED runs are force-failed after timeout
  - Stuck RUNNING runs are force-failed after timeout
  - Recent runs within the timeout window are left untouched
  - Both categories reaped in a single invocation
"""

from unittest.mock import MagicMock, patch

import pytest

from configs import dify_config


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
            assert first_update_args["status"] == "failed"
            assert "not picked up" in first_update_args["error"]

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
            assert second_update_args["status"] == "failed"
            assert "timed out" in second_update_args["error"]

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
