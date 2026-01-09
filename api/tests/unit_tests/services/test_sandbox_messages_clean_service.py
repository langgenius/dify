"""
Unit tests for SandboxMessagesCleanService.

This module tests parameter validation, method invocation, and error handling
without database dependencies (using mocks).
"""

import datetime
from unittest.mock import patch

import pytest

from enums.cloud_plan import CloudPlan
from services.sandbox_messages_clean_service import SandboxMessagesCleanService


class MockMessage:
    """Mock message object for testing."""

    def __init__(self, id: str, app_id: str, created_at: datetime.datetime | None = None):
        self.id = id
        self.app_id = app_id
        self.created_at = created_at or datetime.datetime.now()


class TestFilterExpiredSandboxMessages:
    """Unit tests for _filter_expired_sandbox_messages method."""

    def test_filter_missing_tenant_mapping(self):
        """Test that messages with missing app-to-tenant mapping are excluded."""
        # Arrange
        messages = [
            MockMessage("msg1", "app1"),
            MockMessage("msg2", "app2"),
        ]
        app_to_tenant = {}  # No mapping
        tenant_plans = {"tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1}}

        # Act
        result = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
            tenant_whitelist=[],
            graceful_period_days=8,
            current_timestamp=1000000,
        )

        # Assert
        assert result == []

    def test_filter_missing_tenant_plan(self):
        """Test that messages with missing tenant plan are excluded."""
        # Arrange
        messages = [
            MockMessage("msg1", "app1"),
            MockMessage("msg2", "app2"),
        ]
        app_to_tenant = {
            "app1": "tenant1",
            "app2": "tenant2",
        }
        tenant_plans = {}  # No plans

        # Act
        result = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
            tenant_whitelist=[],
            graceful_period_days=8,
            current_timestamp=1000000,
        )

        # Assert
        assert result == []

    def test_filter_no_previous_subscription(self):
        """Test that messages with no previous subscription (expiration_date=-1) are deleted."""
        # Arrange
        messages = [
            MockMessage("msg1", "app1"),
            MockMessage("msg2", "app2"),
            MockMessage("msg3", "app3"),
        ]
        app_to_tenant = {
            "app1": "tenant1",
            "app2": "tenant2",
            "app3": "tenant3",
        }
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant3": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
        }

        # Act
        result = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
            tenant_whitelist=[],
            graceful_period_days=8,
            current_timestamp=1000000,
        )

        # Assert - all messages should be deleted
        assert set(result) == {"msg1", "msg2", "msg3"}

    def test_filter_all_within_grace_period(self):
        """Test that no messages are deleted when all are within grace period."""
        # Arrange
        now = 1000000
        # All expired recently (within 8 day grace period)
        expired_1_day_ago = now - (1 * 24 * 60 * 60)
        expired_3_days_ago = now - (3 * 24 * 60 * 60)
        expired_7_days_ago = now - (7 * 24 * 60 * 60)

        messages = [
            MockMessage("msg1", "app1"),
            MockMessage("msg2", "app2"),
            MockMessage("msg3", "app3"),
        ]
        app_to_tenant = {
            "app1": "tenant1",
            "app2": "tenant2",
            "app3": "tenant3",
        }
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_1_day_ago},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_3_days_ago},
            "tenant3": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_7_days_ago},
        }

        # Act
        result = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
            tenant_whitelist=[],
            graceful_period_days=8,
            current_timestamp=now,
        )

        # Assert - no messages should be deleted
        assert result == []

    def test_filter_partial_expired_beyond_grace_period(self):
        """Test filtering when some messages expired beyond grace period."""
        # Arrange
        now = 1000000
        graceful_period = 8

        # Different expiration scenarios
        expired_5_days_ago = now - (5 * 24 * 60 * 60)  # Within grace - keep
        expired_10_days_ago = now - (10 * 24 * 60 * 60)  # Beyond grace - delete
        expired_30_days_ago = now - (30 * 24 * 60 * 60)  # Beyond grace - delete
        expired_exactly_8_days_ago = now - (8 * 24 * 60 * 60)  # Exactly at boundary - keep
        expired_9_days_ago = now - (9 * 24 * 60 * 60)  # Just beyond - delete

        messages = [
            MockMessage("msg1", "app1"),  # Within grace
            MockMessage("msg2", "app2"),  # Beyond grace
            MockMessage("msg3", "app3"),  # Beyond grace
            MockMessage("msg4", "app4"),  # No subscription - delete
            MockMessage("msg5", "app5"),  # Exactly at boundary
            MockMessage("msg6", "app6"),  # Just beyond grace
        ]
        app_to_tenant = {
            "app1": "tenant1",
            "app2": "tenant2",
            "app3": "tenant3",
            "app4": "tenant4",
            "app5": "tenant5",
            "app6": "tenant6",
        }
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_5_days_ago},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_10_days_ago},
            "tenant3": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_30_days_ago},
            "tenant4": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant5": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_exactly_8_days_ago},
            "tenant6": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_9_days_ago},
        }

        # Act
        result = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
            tenant_whitelist=[],
            graceful_period_days=graceful_period,
            current_timestamp=now,
        )

        # Assert - msg2, msg3, msg4, msg6 should be deleted
        # msg1 and msg5 are within/at grace period boundary
        assert set(result) == {"msg2", "msg3", "msg4", "msg6"}

    def test_filter_complex_mixed_scenario(self):
        """Test complex scenario with mixed plans, expirations, and missing mappings."""
        # Arrange
        now = 1000000
        sandbox_expired_old = now - (15 * 24 * 60 * 60)  # 15 days ago - beyond grace
        sandbox_expired_recent = now - (3 * 24 * 60 * 60)  # 3 days ago - within grace
        future_expiration = now + (30 * 24 * 60 * 60)  # 30 days in future - active paid plan

        messages = [
            MockMessage("msg1", "app1"),  # Sandbox, no subscription - delete
            MockMessage("msg2", "app2"),  # Sandbox, expired old - delete
            MockMessage("msg3", "app3"),  # Sandbox, within grace - keep
            MockMessage("msg4", "app4"),  # Team plan, active - keep
            MockMessage("msg5", "app5"),  # No tenant mapping - keep
            MockMessage("msg6", "app6"),  # No plan info - keep
            MockMessage("msg7", "app7"),  # Sandbox, expired old - delete
        ]
        app_to_tenant = {
            "app1": "tenant1",
            "app2": "tenant2",
            "app3": "tenant3",
            "app4": "tenant4",
            "app6": "tenant6",  # Has mapping but no plan
            "app7": "tenant7",
            # app5 has no mapping
        }
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": sandbox_expired_old},
            "tenant3": {"plan": CloudPlan.SANDBOX, "expiration_date": sandbox_expired_recent},
            "tenant4": {"plan": CloudPlan.TEAM, "expiration_date": future_expiration},
            "tenant7": {"plan": CloudPlan.SANDBOX, "expiration_date": sandbox_expired_old},
            # tenant6 has no plan
        }

        # Act
        result = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
            tenant_whitelist=[],
            graceful_period_days=8,
            current_timestamp=now,
        )

        # Assert - only sandbox expired beyond grace period and no subscription
        assert set(result) == {"msg1", "msg2", "msg7"}

    def test_filter_empty_inputs(self):
        """Test filtering with empty inputs returns empty list."""
        # Arrange - empty messages
        result1 = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=[],
            app_to_tenant={"app1": "tenant1"},
            tenant_plans={"tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1}},
            tenant_whitelist=[],
            graceful_period_days=8,
            current_timestamp=1000000,
        )

        # Assert
        assert result1 == []

    def test_filter_uses_default_timestamp(self):
        """Test that method uses current time when timestamp not provided."""
        # Arrange
        messages = [MockMessage("msg1", "app1")]
        app_to_tenant = {"app1": "tenant1"}
        tenant_plans = {"tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1}}

        # Act - don't provide current_timestamp
        result = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
            tenant_whitelist=[],
            graceful_period_days=8,
            # current_timestamp not provided - should use datetime.now()
        )

        # Assert - should still work and return msg1 (no subscription)
        assert result == ["msg1"]

    def test_filter_with_whitelist(self):
        """Test that messages from whitelisted tenants are excluded from deletion."""
        # Arrange
        messages = [
            MockMessage("msg1", "app1"),  # Whitelisted tenant - should be kept
            MockMessage("msg2", "app2"),  # Not whitelisted - should be deleted
            MockMessage("msg3", "app3"),  # Whitelisted tenant - should be kept
            MockMessage("msg4", "app4"),  # Not whitelisted - should be deleted
        ]
        app_to_tenant = {
            "app1": "tenant1",
            "app2": "tenant2",
            "app3": "tenant3",
            "app4": "tenant4",
        }
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant3": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant4": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
        }
        tenant_whitelist = ["tenant1", "tenant3"]  # Whitelist tenant1 and tenant3

        # Act
        result = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
            tenant_whitelist=tenant_whitelist,
            graceful_period_days=8,
            current_timestamp=1000000,
        )

        # Assert - only msg2 and msg4 should be deleted (not whitelisted)
        assert set(result) == {"msg2", "msg4"}

    def test_filter_with_whitelist_and_grace_period(self):
        """Test whitelist takes precedence over grace period logic."""
        # Arrange
        now = 1000000
        expired_long_ago = now - (30 * 24 * 60 * 60)  # Expired 30 days ago

        messages = [
            MockMessage("msg1", "app1"),  # Whitelisted, expired long ago - should be kept
            MockMessage("msg2", "app2"),  # Not whitelisted, expired long ago - should be deleted
        ]
        app_to_tenant = {
            "app1": "tenant1",
            "app2": "tenant2",
        }
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_long_ago},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_long_ago},
        }
        tenant_whitelist = ["tenant1"]  # Only tenant1 is whitelisted

        # Act
        result = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
            tenant_whitelist=tenant_whitelist,
            graceful_period_days=8,
            current_timestamp=now,
        )

        # Assert - only msg2 should be deleted
        assert result == ["msg2"]

    def test_filter_whitelist_with_non_sandbox_plans(self):
        """Test that whitelist only affects sandbox plan messages."""
        # Arrange
        now = 1000000
        future_expiration = now + (30 * 24 * 60 * 60)

        messages = [
            MockMessage("msg1", "app1"),  # Sandbox, whitelisted - kept
            MockMessage("msg2", "app2"),  # Team plan, whitelisted - kept (not sandbox)
            MockMessage("msg3", "app3"),  # Sandbox, not whitelisted - deleted
        ]
        app_to_tenant = {
            "app1": "tenant1",
            "app2": "tenant2",
            "app3": "tenant3",
        }
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant2": {"plan": CloudPlan.TEAM, "expiration_date": future_expiration},
            "tenant3": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
        }
        tenant_whitelist = ["tenant1", "tenant2"]

        # Act
        result = SandboxMessagesCleanService._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
            tenant_whitelist=tenant_whitelist,
            graceful_period_days=8,
            current_timestamp=now,
        )

        # Assert - only msg3 should be deleted (sandbox, not whitelisted)
        assert result == ["msg3"]


class TestCleanSandboxMessagesByTimeRange:
    """Unit tests for clean_sandbox_messages_by_time_range method."""

    @patch.object(SandboxMessagesCleanService, "_clean_sandbox_messages_by_time_range")
    def test_valid_time_range_and_args(self, mock_clean):
        """Test with valid time range and other parameters."""
        # Arrange
        start_from = datetime.datetime(2024, 1, 1, 0, 0, 0)
        end_before = datetime.datetime(2024, 12, 31, 23, 59, 59)
        batch_size = 500
        dry_run = True

        mock_clean.return_value = {
            "batches": 5,
            "total_messages": 100,
            "total_deleted": 100,
        }

        # Act
        SandboxMessagesCleanService.clean_sandbox_messages_by_time_range(
            start_from=start_from,
            end_before=end_before,
            batch_size=batch_size,
            dry_run=dry_run,
        )

        # Assert, expected no exception raised
        mock_clean.assert_called_once_with(
            start_from=start_from,
            end_before=end_before,
            graceful_period=21,
            batch_size=batch_size,
            dry_run=dry_run,
        )

    @patch.object(SandboxMessagesCleanService, "_clean_sandbox_messages_by_time_range")
    def test_with_default_args(self, mock_clean):
        """Test with default args."""
        # Arrange
        start_from = datetime.datetime(2024, 1, 1)
        end_before = datetime.datetime(2024, 2, 1)

        mock_clean.return_value = {
            "batches": 2,
            "total_messages": 50,
            "total_deleted": 0,
        }

        # Act
        SandboxMessagesCleanService.clean_sandbox_messages_by_time_range(
            start_from=start_from,
            end_before=end_before,
        )

        # Assert
        mock_clean.assert_called_once_with(
            start_from=start_from,
            end_before=end_before,
            graceful_period=21,
            batch_size=1000,
            dry_run=False,
        )

    def test_invalid_time_range(self):
        """Test invalid time range raises ValueError."""
        # Arrange
        same_time = datetime.datetime(2024, 1, 1, 12, 0, 0)

        # Act & Assert start equals end
        with pytest.raises(ValueError, match="start_from .* must be less than end_before"):
            SandboxMessagesCleanService.clean_sandbox_messages_by_time_range(
                start_from=same_time,
                end_before=same_time,
            )

        # Arrange
        start_from = datetime.datetime(2024, 12, 31)
        end_before = datetime.datetime(2024, 1, 1)

        # Act & Assert start after end
        with pytest.raises(ValueError, match="start_from .* must be less than end_before"):
            SandboxMessagesCleanService.clean_sandbox_messages_by_time_range(
                start_from=start_from,
                end_before=end_before,
            )

    def test_invalid_batch_size(self):
        """Test invalid batch_size raises ValueError."""
        # Arrange
        start_from = datetime.datetime(2024, 1, 1)
        end_before = datetime.datetime(2024, 2, 1)

        # Act & Assert batch_size = 0
        with pytest.raises(ValueError, match="batch_size .* must be greater than 0"):
            SandboxMessagesCleanService.clean_sandbox_messages_by_time_range(
                start_from=start_from,
                end_before=end_before,
                batch_size=0,
            )

        # Act & Assert batch_size < 0
        with pytest.raises(ValueError, match="batch_size .* must be greater than 0"):
            SandboxMessagesCleanService.clean_sandbox_messages_by_time_range(
                start_from=start_from,
                end_before=end_before,
                batch_size=-100,
            )


class TestCleanSandboxMessagesByDays:
    """Unit tests for clean_sandbox_messages_by_days method."""

    @patch.object(SandboxMessagesCleanService, "_clean_sandbox_messages_by_time_range")
    def test_default_days(self, mock_clean):
        """Test with default 30 days."""
        # Arrange
        mock_clean.return_value = {"batches": 3, "total_messages": 75, "total_deleted": 75}

        # Act
        with patch("services.sandbox_messages_clean_service.datetime") as mock_datetime:
            fixed_now = datetime.datetime(2024, 6, 15, 10, 30, 0)
            mock_datetime.datetime.now.return_value = fixed_now
            mock_datetime.timedelta = datetime.timedelta  # Keep original timedelta

            SandboxMessagesCleanService.clean_sandbox_messages_by_days()

        # Assert
        expected_end_before = fixed_now - datetime.timedelta(days=30)  # default days=30
        mock_clean.assert_called_once_with(
            end_before=expected_end_before,
            start_from=None,
            graceful_period=21,
            batch_size=1000,
            dry_run=False,
        )

    @patch.object(SandboxMessagesCleanService, "_clean_sandbox_messages_by_time_range")
    def test_custom_days(self, mock_clean):
        """Test with custom number of days."""
        # Arrange
        custom_days = 90
        mock_clean.return_value = {"batches": 10, "total_messages": 500, "total_deleted": 500}

        # Act
        with patch("services.sandbox_messages_clean_service.datetime") as mock_datetime:
            fixed_now = datetime.datetime(2024, 6, 15, 10, 30, 0)
            mock_datetime.datetime.now.return_value = fixed_now
            mock_datetime.timedelta = datetime.timedelta  # Keep original timedelta

            result = SandboxMessagesCleanService.clean_sandbox_messages_by_days(days=custom_days)

        # Assert
        expected_end_before = fixed_now - datetime.timedelta(days=custom_days)
        mock_clean.assert_called_once_with(
            end_before=expected_end_before,
            start_from=None,
            graceful_period=21,
            batch_size=1000,
            dry_run=False,
        )

    @patch.object(SandboxMessagesCleanService, "_clean_sandbox_messages_by_time_range")
    def test_zero_days(self, mock_clean):
        """Test with days=0 (clean all messages before now)."""
        # Arrange
        mock_clean.return_value = {"batches": 0, "total_messages": 0, "total_deleted": 0}

        # Act
        with patch("services.sandbox_messages_clean_service.datetime") as mock_datetime:
            fixed_now = datetime.datetime(2024, 6, 15, 14, 0, 0)
            mock_datetime.datetime.now.return_value = fixed_now
            mock_datetime.timedelta = datetime.timedelta  # Keep original timedelta

            SandboxMessagesCleanService.clean_sandbox_messages_by_days(days=0)

        # Assert
        expected_end_before = fixed_now - datetime.timedelta(days=0)  # same as fixed_now
        mock_clean.assert_called_once_with(
            end_before=expected_end_before,
            start_from=None,
            graceful_period=21,
            batch_size=1000,
            dry_run=False,
        )

    def test_invalid_batch_size(self):
        """Test invalid batch_size raises ValueError."""
        # Act & Assert batch_size = 0
        with pytest.raises(ValueError, match="batch_size .* must be greater than 0"):
            SandboxMessagesCleanService.clean_sandbox_messages_by_days(
                days=30,
                batch_size=0,
            )

        # Act & Assert batch_size < 0
        with pytest.raises(ValueError, match="batch_size .* must be greater than 0"):
            SandboxMessagesCleanService.clean_sandbox_messages_by_days(
                days=30,
                batch_size=-500,
            )
