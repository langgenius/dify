import datetime
from unittest.mock import MagicMock, patch

import pytest

from services.retention.conversation.messages_clean_policy import (
    BillingDisabledPolicy,
)
from services.retention.conversation.messages_clean_service import MessagesCleanService


class TestMessagesCleanService:
    @pytest.fixture(autouse=True)
    def mock_db_engine(self):
        with patch("services.retention.conversation.messages_clean_service.db") as mock_db:
            mock_db.engine = MagicMock()
            yield mock_db.engine

    @pytest.fixture
    def mock_db_session(self, mock_db_engine):
        with patch("services.retention.conversation.messages_clean_service.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session_cls.return_value.__enter__.return_value = mock_session
            yield mock_session

    @pytest.fixture
    def mock_policy(self):
        policy = MagicMock(spec=BillingDisabledPolicy)
        return policy

    def test_run_calls_clean_messages(self, mock_policy):
        service = MessagesCleanService(
            policy=mock_policy,
            end_before=datetime.datetime.now(),
            batch_size=10,
        )
        with patch.object(service, "_clean_messages_by_time_range") as mock_clean:
            mock_clean.return_value = {"total_deleted": 5}
            result = service.run()
            assert result == {"total_deleted": 5}
            mock_clean.assert_called_once()

    def test_clean_messages_by_time_range_basic(self, mock_db_session, mock_policy):
        # Arrange
        end_before = datetime.datetime(2024, 1, 1, 12, 0, 0)
        service = MessagesCleanService(
            policy=mock_policy,
            end_before=end_before,
            batch_size=10,
        )

        mock_db_session.execute.side_effect = [
            MagicMock(all=lambda: [("msg1", "app1", datetime.datetime(2024, 1, 1, 10, 0, 0))]),  # messages
            MagicMock(all=lambda: [MagicMock(id="app1", tenant_id="tenant1")]),  # apps
            MagicMock(
                rowcount=1
            ),  # delete relations (this is wrong, relations delete doesn't use rowcount here, but execute)
            MagicMock(rowcount=1),  # delete relations
            MagicMock(rowcount=1),  # delete relations
            MagicMock(rowcount=1),  # delete relations
            MagicMock(rowcount=1),  # delete relations
            MagicMock(rowcount=1),  # delete relations
            MagicMock(rowcount=1),  # delete relations
            MagicMock(rowcount=1),  # delete relations
            MagicMock(rowcount=1),  # delete messages
            MagicMock(all=lambda: []),  # next batch empty
        ]

        # Reset side_effect to be more robust
        # The service calls session.execute for:
        # 1. Fetch messages
        # 2. Fetch apps
        # 3. Batch delete relations (8 calls if IDs exist)
        # 4. Delete messages

        mock_returns = [
            MagicMock(all=lambda: [("msg1", "app1", datetime.datetime(2024, 1, 1, 10, 0, 0))]),  # fetch messages
            MagicMock(all=lambda: [MagicMock(id="app1", tenant_id="tenant1")]),  # fetch apps
        ]
        # 8 deletes for relations
        mock_returns.extend([MagicMock() for _ in range(8)])
        # 1 delete for messages
        mock_returns.append(MagicMock(rowcount=1))
        # Final fetch messages (empty)
        mock_returns.append(MagicMock(all=lambda: []))

        mock_db_session.execute.side_effect = mock_returns
        mock_policy.filter_message_ids.return_value = ["msg1"]

        # Act
        with patch("services.retention.conversation.messages_clean_service.time.sleep"):
            stats = service.run()

        # Assert
        assert stats["total_messages"] == 1
        assert stats["total_deleted"] == 1
        assert stats["batches"] == 2

    def test_clean_messages_by_time_range_with_start_from(self, mock_db_session, mock_policy):
        start_from = datetime.datetime(2024, 1, 1, 0, 0, 0)
        end_before = datetime.datetime(2024, 1, 1, 12, 0, 0)
        service = MessagesCleanService(
            policy=mock_policy,
            start_from=start_from,
            end_before=end_before,
            batch_size=10,
        )

        mock_db_session.execute.side_effect = [
            MagicMock(all=lambda: []),  # No messages
        ]

        stats = service.run()
        assert stats["total_messages"] == 0

    def test_clean_messages_by_time_range_with_cursor(self, mock_db_session, mock_policy):
        # Test pagination with cursor
        end_before = datetime.datetime(2024, 1, 1, 12, 0, 0)
        service = MessagesCleanService(
            policy=mock_policy,
            end_before=end_before,
            batch_size=1,
        )

        msg1_time = datetime.datetime(2024, 1, 1, 10, 0, 0)
        msg2_time = datetime.datetime(2024, 1, 1, 11, 0, 0)

        mock_returns = []
        # Batch 1
        mock_returns.append(MagicMock(all=lambda: [("msg1", "app1", msg1_time)]))
        mock_returns.append(MagicMock(all=lambda: [MagicMock(id="app1", tenant_id="tenant1")]))
        mock_returns.extend([MagicMock() for _ in range(8)])  # relations
        mock_returns.append(MagicMock(rowcount=1))  # messages

        # Batch 2
        mock_returns.append(MagicMock(all=lambda: [("msg2", "app1", msg2_time)]))
        mock_returns.append(MagicMock(all=lambda: [MagicMock(id="app1", tenant_id="tenant1")]))
        mock_returns.extend([MagicMock() for _ in range(8)])  # relations
        mock_returns.append(MagicMock(rowcount=1))  # messages

        # Batch 3
        mock_returns.append(MagicMock(all=lambda: []))

        mock_db_session.execute.side_effect = mock_returns
        mock_policy.filter_message_ids.return_value = ["msg1"]  # Simplified

        with patch("services.retention.conversation.messages_clean_service.time.sleep"):
            stats = service.run()

        assert stats["batches"] == 3
        assert stats["total_messages"] == 2

    def test_clean_messages_by_time_range_dry_run(self, mock_db_session, mock_policy):
        service = MessagesCleanService(
            policy=mock_policy,
            end_before=datetime.datetime.now(),
            batch_size=10,
            dry_run=True,
        )

        mock_db_session.execute.side_effect = [
            MagicMock(all=lambda: [("msg1", "app1", datetime.datetime.now())]),  # messages
            MagicMock(all=lambda: [MagicMock(id="app1", tenant_id="tenant1")]),  # apps
            MagicMock(all=lambda: []),  # next batch empty
        ]
        mock_policy.filter_message_ids.return_value = ["msg1"]

        with patch("services.retention.conversation.messages_clean_service.random.sample") as mock_sample:
            mock_sample.return_value = ["msg1"]
            stats = service.run()
            assert stats["filtered_messages"] == 1
            assert stats["total_deleted"] == 0  # Dry run
            mock_sample.assert_called()

    def test_clean_messages_by_time_range_no_apps_found(self, mock_db_session, mock_policy):
        service = MessagesCleanService(
            policy=mock_policy,
            end_before=datetime.datetime.now(),
            batch_size=10,
        )

        mock_db_session.execute.side_effect = [
            MagicMock(all=lambda: [("msg1", "app1", datetime.datetime.now())]),  # messages
            MagicMock(all=lambda: []),  # apps NOT found
            MagicMock(all=lambda: []),  # next batch empty
        ]

        stats = service.run()
        assert stats["total_messages"] == 1
        assert stats["total_deleted"] == 0

    def test_clean_messages_by_time_range_no_app_ids(self, mock_db_session, mock_policy):
        service = MessagesCleanService(
            policy=mock_policy,
            end_before=datetime.datetime.now(),
            batch_size=10,
        )

        mock_db_session.execute.side_effect = [
            MagicMock(all=lambda: [("msg1", "app1", datetime.datetime.now())]),  # messages
            MagicMock(all=lambda: []),  # next batch empty
        ]

        # We need to successfully execute line 228 and 229, then return empty at 251.
        # line 228: raw_messages = list(session.execute(msg_stmt).all())
        # line 251: app_ids = list({msg.app_id for msg in messages})

        calls = []

        def list_side_effect(arg):
            calls.append(arg)
            if len(calls) == 2:  # This is the second call to list() in the loop
                return []
            return list(arg)

        with patch("services.retention.conversation.messages_clean_service.list", side_effect=list_side_effect):
            stats = service.run()
            assert stats["batches"] == 2
            assert stats["total_messages"] == 1

    def test_from_time_range_validation(self, mock_policy):
        now = datetime.datetime.now()
        # Test start_from >= end_before
        with pytest.raises(ValueError, match="start_from .* must be less than end_before"):
            MessagesCleanService.from_time_range(mock_policy, now, now)

        # Test batch_size <= 0
        with pytest.raises(ValueError, match="batch_size .* must be greater than 0"):
            MessagesCleanService.from_time_range(mock_policy, now - datetime.timedelta(days=1), now, batch_size=0)

    def test_from_time_range_success(self, mock_policy):
        start = datetime.datetime(2024, 1, 1)
        end = datetime.datetime(2024, 2, 1)
        # Mock logger to avoid actual logging if needed, though it's fine
        service = MessagesCleanService.from_time_range(mock_policy, start, end)
        assert service._start_from == start
        assert service._end_before == end

    def test_from_days_validation(self, mock_policy):
        # Test days < 0
        with pytest.raises(ValueError, match="days .* must be greater than or equal to 0"):
            MessagesCleanService.from_days(mock_policy, days=-1)

        # Test batch_size <= 0
        with pytest.raises(ValueError, match="batch_size .* must be greater than 0"):
            MessagesCleanService.from_days(mock_policy, days=30, batch_size=0)

    def test_from_days_success(self, mock_policy):
        with patch("services.retention.conversation.messages_clean_service.naive_utc_now") as mock_now:
            fixed_now = datetime.datetime(2024, 6, 1)
            mock_now.return_value = fixed_now

            service = MessagesCleanService.from_days(mock_policy, days=10)
            assert service._start_from is None
            assert service._end_before == fixed_now - datetime.timedelta(days=10)

    def test_clean_messages_by_time_range_no_messages_to_delete(self, mock_db_session, mock_policy):
        service = MessagesCleanService(
            policy=mock_policy,
            end_before=datetime.datetime.now(),
            batch_size=10,
        )

        mock_db_session.execute.side_effect = [
            MagicMock(all=lambda: [("msg1", "app1", datetime.datetime.now())]),  # messages
            MagicMock(all=lambda: [MagicMock(id="app1", tenant_id="tenant1")]),  # apps
            MagicMock(all=lambda: []),  # next batch empty
        ]
        mock_policy.filter_message_ids.return_value = []  # Policy says NO

        stats = service.run()
        assert stats["total_messages"] == 1
        assert stats["filtered_messages"] == 0
        assert stats["total_deleted"] == 0

    def test_batch_delete_message_relations_empty(self, mock_db_session):
        MessagesCleanService._batch_delete_message_relations(mock_db_session, [])
        mock_db_session.execute.assert_not_called()

    def test_batch_delete_message_relations_with_ids(self, mock_db_session):
        MessagesCleanService._batch_delete_message_relations(mock_db_session, ["msg1", "msg2"])
        assert mock_db_session.execute.call_count == 8  # 8 tables to clean up

    def test_clean_messages_interval_from_env(self, mock_db_session, mock_policy):
        service = MessagesCleanService(
            policy=mock_policy,
            end_before=datetime.datetime.now(),
            batch_size=10,
        )

        mock_returns = [
            MagicMock(all=lambda: [("msg1", "app1", datetime.datetime.now())]),  # messages
            MagicMock(all=lambda: [MagicMock(id="app1", tenant_id="tenant1")]),  # apps
        ]
        mock_returns.extend([MagicMock() for _ in range(8)])  # relations
        mock_returns.append(MagicMock(rowcount=1))  # messages
        mock_returns.append(MagicMock(all=lambda: []))  # next batch empty

        mock_db_session.execute.side_effect = mock_returns
        mock_policy.filter_message_ids.return_value = ["msg1"]

        with patch(
            "services.retention.conversation.messages_clean_service.dify_config.SANDBOX_EXPIRED_RECORDS_CLEAN_BATCH_MAX_INTERVAL",
            500,
        ):
            with patch("services.retention.conversation.messages_clean_service.time.sleep") as mock_sleep:
                with patch("services.retention.conversation.messages_clean_service.random.uniform") as mock_uniform:
                    mock_uniform.return_value = 300.0
                    service.run()
                    mock_uniform.assert_called_with(0, 500)
                    mock_sleep.assert_called_with(0.3)
