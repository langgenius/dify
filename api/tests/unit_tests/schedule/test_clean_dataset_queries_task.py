from unittest.mock import MagicMock, patch

from redis.exceptions import LockError

from schedule.clean_dataset_queries_task import _effective_retention_days, clean_dataset_queries_task


class TestEffectiveRetentionDays:
    def test_returns_requested_when_above_minimum(self):
        """Retention is returned as-is when it exceeds the safe minimum."""
        with (
            patch("schedule.clean_dataset_queries_task.dify_config") as mock_cfg,
        ):
            mock_cfg.CLEAN_DATASET_QUERIES_RETENTION_DAYS = 60
            mock_cfg.PLAN_SANDBOX_CLEAN_DAY_SETTING = 30
            assert _effective_retention_days() == 60

    def test_clamps_when_below_minimum(self):
        """Retention is clamped to PLAN_SANDBOX_CLEAN_DAY_SETTING when too low."""
        with (
            patch("schedule.clean_dataset_queries_task.dify_config") as mock_cfg,
        ):
            mock_cfg.CLEAN_DATASET_QUERIES_RETENTION_DAYS = 10
            mock_cfg.PLAN_SANDBOX_CLEAN_DAY_SETTING = 30
            assert _effective_retention_days() == 30


class TestCleanDatasetQueriesTask:
    @patch("schedule.clean_dataset_queries_task.redis_client")
    @patch("schedule.clean_dataset_queries_task.db")
    @patch("schedule.clean_dataset_queries_task.dify_config")
    def test_deletes_rows_older_than_retention(self, mock_cfg, mock_db, mock_redis):
        """Rows older than the cutoff are deleted in batches until none remain."""
        mock_cfg.CLEAN_DATASET_QUERIES_RETENTION_DAYS = 60
        mock_cfg.PLAN_SANDBOX_CLEAN_DAY_SETTING = 30
        mock_cfg.CLEAN_DATASET_QUERIES_BATCH_SIZE = 2
        mock_cfg.CLEAN_DATASET_QUERIES_LOCK_TTL = 3600

        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock(return_value=mock_lock)
        mock_lock.__exit__ = MagicMock(return_value=False)
        mock_redis.lock.return_value = mock_lock

        session = MagicMock()
        mock_db.session = session

        batch_1 = ["id1", "id2"]
        batch_2 = ["id3"]
        session.scalars.return_value.all.side_effect = [batch_1, batch_2, []]

        clean_dataset_queries_task()

        assert session.execute.call_count == 2
        assert session.commit.call_count == 2

    @patch("schedule.clean_dataset_queries_task.redis_client")
    @patch("schedule.clean_dataset_queries_task.db")
    @patch("schedule.clean_dataset_queries_task.dify_config")
    def test_lock_held_skips(self, mock_cfg, mock_db, mock_redis):
        """When the Redis lock is already held, the task exits cleanly without
        database calls or raising an error."""
        mock_cfg.CLEAN_DATASET_QUERIES_RETENTION_DAYS = 60
        mock_cfg.PLAN_SANDBOX_CLEAN_DAY_SETTING = 30

        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock(side_effect=LockError)
        mock_lock.__exit__ = MagicMock(return_value=False)
        mock_redis.lock.return_value = mock_lock

        session = MagicMock()
        mock_db.session = session

        clean_dataset_queries_task()

        session.scalars.assert_not_called()
        session.execute.assert_not_called()

    @patch("schedule.clean_dataset_queries_task.redis_client")
    @patch("schedule.clean_dataset_queries_task.db")
    @patch("schedule.clean_dataset_queries_task.dify_config")
    def test_retention_clamped_below_minimum(self, mock_cfg, mock_db, mock_redis):
        """When configured retention < PLAN_SANDBOX_CLEAN_DAY_SETTING, the
        effective cutoff uses the larger value."""
        mock_cfg.CLEAN_DATASET_QUERIES_RETENTION_DAYS = 10
        mock_cfg.PLAN_SANDBOX_CLEAN_DAY_SETTING = 30
        mock_cfg.CLEAN_DATASET_QUERIES_BATCH_SIZE = 500
        mock_cfg.CLEAN_DATASET_QUERIES_LOCK_TTL = 3600

        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock(return_value=mock_lock)
        mock_lock.__exit__ = MagicMock(return_value=False)
        mock_redis.lock.return_value = mock_lock

        session = MagicMock()
        mock_db.session = session
        session.scalars.return_value.all.return_value = []

        clean_dataset_queries_task()

        session.scalars.assert_called_once()
