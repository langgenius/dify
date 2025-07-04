import threading
from unittest.mock import Mock, patch

from core.app.entities.app_invoke_entities import ChatAppGenerateEntity
from core.entities.provider_entities import QuotaUnit
from events.event_handlers.update_provider_when_message_created import (
    handle,
    get_update_stats,
)
from models.provider import ProviderType
from sqlalchemy.exc import OperationalError


class TestProviderUpdateDeadlockPrevention:
    """Test suite for deadlock prevention in Provider updates."""

    def setup_method(self):
        """Setup test fixtures."""
        self.mock_message = Mock()
        self.mock_message.answer_tokens = 100

        self.mock_app_config = Mock()
        self.mock_app_config.tenant_id = "test-tenant-123"

        self.mock_model_conf = Mock()
        self.mock_model_conf.provider = "openai"

        self.mock_system_config = Mock()
        self.mock_system_config.current_quota_type = QuotaUnit.TOKENS

        self.mock_provider_config = Mock()
        self.mock_provider_config.using_provider_type = ProviderType.SYSTEM
        self.mock_provider_config.system_configuration = self.mock_system_config

        self.mock_provider_bundle = Mock()
        self.mock_provider_bundle.configuration = self.mock_provider_config

        self.mock_model_conf.provider_model_bundle = self.mock_provider_bundle

        self.mock_generate_entity = Mock(spec=ChatAppGenerateEntity)
        self.mock_generate_entity.app_config = self.mock_app_config
        self.mock_generate_entity.model_conf = self.mock_model_conf

    @patch("events.event_handlers.update_provider_when_message_created.db")
    def test_consolidated_handler_basic_functionality(self, mock_db):
        """Test that the consolidated handler performs both updates correctly."""
        # Setup mock query chain
        mock_query = Mock()
        mock_db.session.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.update.return_value = 1  # 1 row affected

        # Call the handler
        handle(self.mock_message, application_generate_entity=self.mock_generate_entity)

        # Verify db.session.query was called
        assert mock_db.session.query.called

        # Verify commit was called
        mock_db.session.commit.assert_called_once()

        # Verify no rollback was called
        assert not mock_db.session.rollback.called

    @patch("events.event_handlers.update_provider_when_message_created.db")
    def test_deadlock_retry_mechanism(self, mock_db):
        """Test that deadlock errors trigger retry logic."""
        # Setup mock to raise deadlock error on first attempt, succeed on second
        mock_query = Mock()
        mock_db.session.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.update.return_value = 1

        # First call raises deadlock, second succeeds
        mock_db.session.commit.side_effect = [
            OperationalError("deadlock detected", None, None),
            None,  # Success on retry
        ]

        # Call the handler
        handle(self.mock_message, application_generate_entity=self.mock_generate_entity)

        # Verify commit was called twice (original + retry)
        assert mock_db.session.commit.call_count == 2

        # Verify rollback was called once (after first failure)
        mock_db.session.rollback.assert_called_once()

    @patch("events.event_handlers.update_provider_when_message_created.db")
    @patch("events.event_handlers.update_provider_when_message_created.time.sleep")
    def test_exponential_backoff_timing(self, mock_sleep, mock_db):
        """Test that retry delays follow exponential backoff pattern."""
        # Setup mock to fail twice, succeed on third attempt
        mock_query = Mock()
        mock_db.session.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.update.return_value = 1

        mock_db.session.commit.side_effect = [
            OperationalError("deadlock detected", None, None),
            OperationalError("deadlock detected", None, None),
            None,  # Success on third attempt
        ]

        # Call the handler
        handle(self.mock_message, application_generate_entity=self.mock_generate_entity)

        # Verify sleep was called twice with increasing delays
        assert mock_sleep.call_count == 2

        # First delay should be around 0.1s + jitter
        first_delay = mock_sleep.call_args_list[0][0][0]
        assert 0.1 <= first_delay <= 0.3

        # Second delay should be around 0.2s + jitter
        second_delay = mock_sleep.call_args_list[1][0][0]
        assert 0.2 <= second_delay <= 0.4

    def test_concurrent_handler_execution(self):
        """Test that multiple handlers can run concurrently without deadlock."""
        results = []
        errors = []

        def run_handler():
            try:
                with patch(
                    "events.event_handlers.update_provider_when_message_created.db"
                ) as mock_db:
                    mock_query = Mock()
                    mock_db.session.query.return_value = mock_query
                    mock_query.filter.return_value = mock_query
                    mock_query.order_by.return_value = mock_query
                    mock_query.update.return_value = 1

                    handle(
                        self.mock_message,
                        application_generate_entity=self.mock_generate_entity,
                    )
                    results.append("success")
            except Exception as e:
                errors.append(str(e))

        # Run multiple handlers concurrently
        threads = []
        for _ in range(5):
            thread = threading.Thread(target=run_handler)
            threads.append(thread)
            thread.start()

        # Wait for all threads to complete
        for thread in threads:
            thread.join(timeout=5)

        # Verify all handlers completed successfully
        assert len(results) == 5
        assert len(errors) == 0

    def test_performance_stats_tracking(self):
        """Test that performance statistics are tracked correctly."""
        # Reset stats
        stats = get_update_stats()
        initial_total = stats["total_updates"]

        with patch(
            "events.event_handlers.update_provider_when_message_created.db"
        ) as mock_db:
            mock_query = Mock()
            mock_db.session.query.return_value = mock_query
            mock_query.filter.return_value = mock_query
            mock_query.order_by.return_value = mock_query
            mock_query.update.return_value = 1

            # Call handler
            handle(
                self.mock_message, application_generate_entity=self.mock_generate_entity
            )

        # Check that stats were updated
        updated_stats = get_update_stats()
        assert updated_stats["total_updates"] == initial_total + 1
        assert updated_stats["successful_updates"] >= initial_total + 1

    def test_non_chat_entity_ignored(self):
        """Test that non-chat entities are ignored by the handler."""
        # Create a non-chat entity
        mock_non_chat_entity = Mock()
        mock_non_chat_entity.__class__.__name__ = "NonChatEntity"

        with patch(
            "events.event_handlers.update_provider_when_message_created.db"
        ) as mock_db:
            # Call handler with non-chat entity
            handle(self.mock_message, application_generate_entity=mock_non_chat_entity)

            # Verify no database operations were performed
            assert not mock_db.session.query.called
            assert not mock_db.session.commit.called

    @patch("events.event_handlers.update_provider_when_message_created.db")
    def test_quota_calculation_tokens(self, mock_db):
        """Test quota calculation for token-based quotas."""
        # Setup token-based quota
        self.mock_system_config.current_quota_type = QuotaUnit.TOKENS
        self.mock_message.answer_tokens = 150

        mock_query = Mock()
        mock_db.session.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.update.return_value = 1

        # Call handler
        handle(self.mock_message, application_generate_entity=self.mock_generate_entity)

        # Verify update was called with token count
        update_calls = mock_query.update.call_args_list

        # Should have at least one call with quota_used update
        quota_update_found = False
        for call in update_calls:
            values = call[0][0]  # First argument to update()
            if "quota_used" in values:
                quota_update_found = True
                break

        assert quota_update_found

    @patch("events.event_handlers.update_provider_when_message_created.db")
    def test_quota_calculation_times(self, mock_db):
        """Test quota calculation for times-based quotas."""
        # Setup times-based quota
        self.mock_system_config.current_quota_type = QuotaUnit.TIMES

        mock_query = Mock()
        mock_db.session.query.return_value = mock_query
        mock_query.filter.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.update.return_value = 1

        # Call handler
        handle(self.mock_message, application_generate_entity=self.mock_generate_entity)

        # Verify update was called
        assert mock_query.update.called
        assert mock_db.session.commit.called
