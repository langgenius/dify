import datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from enums.cloud_plan import CloudPlan
from services.retention.conversation.messages_clean_app_scan import EligibleAppRoundRobinScanner, EligibleAppScanBatch
from services.retention.conversation.messages_clean_policy import (
    BillingDisabledPolicy,
    BillingSandboxPolicy,
    SimpleMessage,
    create_message_clean_policy,
)
from services.retention.conversation.messages_clean_service import MessagesCleanService


def make_simple_message(msg_id: str, app_id: str) -> SimpleMessage:
    """Helper to create a SimpleMessage with a fixed created_at timestamp."""
    return SimpleMessage(id=msg_id, app_id=app_id, created_at=datetime.datetime(2024, 1, 1))


def make_plan_provider(tenant_plans: dict[str, Any]) -> MagicMock:
    """Helper to create a mock plan_provider that returns the given tenant_plans."""
    provider = MagicMock()
    provider.return_value = tenant_plans
    return provider


class TestBillingSandboxPolicyFilterMessageIds:
    """Unit tests for BillingSandboxPolicy.filter_message_ids method."""

    # Fixed timestamp for deterministic tests
    CURRENT_TIMESTAMP = 1000000
    GRACEFUL_PERIOD_DAYS = 8
    GRACEFUL_PERIOD_SECONDS = GRACEFUL_PERIOD_DAYS * 24 * 60 * 60

    def test_missing_tenant_mapping_excluded(self):
        """Test that messages with missing app-to-tenant mapping are excluded."""
        # Arrange
        messages = [
            make_simple_message("msg1", "app1"),
            make_simple_message("msg2", "app2"),
        ]
        app_to_tenant = {}  # No mapping
        tenant_plans = {"tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1}}
        plan_provider = make_plan_provider(tenant_plans)

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            current_timestamp=self.CURRENT_TIMESTAMP,
        )

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert
        assert list(result) == []

    def test_missing_tenant_plan_excluded(self):
        """Test that messages with missing tenant plan are excluded (safe default)."""
        # Arrange
        messages = [
            make_simple_message("msg1", "app1"),
            make_simple_message("msg2", "app2"),
        ]
        app_to_tenant = {"app1": "tenant1", "app2": "tenant2"}
        tenant_plans = {}  # No plans
        plan_provider = make_plan_provider(tenant_plans)

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            current_timestamp=self.CURRENT_TIMESTAMP,
        )

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert
        assert list(result) == []

    def test_non_sandbox_plan_excluded(self):
        """Test that messages from non-sandbox plans (PROFESSIONAL/TEAM) are excluded."""
        # Arrange
        messages = [
            make_simple_message("msg1", "app1"),
            make_simple_message("msg2", "app2"),
            make_simple_message("msg3", "app3"),
        ]
        app_to_tenant = {"app1": "tenant1", "app2": "tenant2", "app3": "tenant3"}
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.PROFESSIONAL, "expiration_date": -1},
            "tenant2": {"plan": CloudPlan.TEAM, "expiration_date": -1},
            "tenant3": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},  # Only this one
        }
        plan_provider = make_plan_provider(tenant_plans)

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            current_timestamp=self.CURRENT_TIMESTAMP,
        )

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert - only msg3 (sandbox tenant) should be included
        assert set(result) == {"msg3"}

    def test_whitelist_skip(self):
        """Test that whitelisted tenants are excluded even if sandbox + expired."""
        # Arrange
        messages = [
            make_simple_message("msg1", "app1"),  # Whitelisted - excluded
            make_simple_message("msg2", "app2"),  # Not whitelisted - included
            make_simple_message("msg3", "app3"),  # Whitelisted - excluded
        ]
        app_to_tenant = {"app1": "tenant1", "app2": "tenant2", "app3": "tenant3"}
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant3": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
        }
        plan_provider = make_plan_provider(tenant_plans)
        tenant_whitelist = ["tenant1", "tenant3"]

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            tenant_whitelist=tenant_whitelist,
            current_timestamp=self.CURRENT_TIMESTAMP,
        )

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert - only msg2 should be included
        assert set(result) == {"msg2"}

    def test_no_previous_subscription_included(self):
        """Test that messages with expiration_date=-1 (no previous subscription) are included."""
        # Arrange
        messages = [
            make_simple_message("msg1", "app1"),
            make_simple_message("msg2", "app2"),
        ]
        app_to_tenant = {"app1": "tenant1", "app2": "tenant2"}
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
        }
        plan_provider = make_plan_provider(tenant_plans)

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            current_timestamp=self.CURRENT_TIMESTAMP,
        )

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert - all messages should be included
        assert set(result) == {"msg1", "msg2"}

    def test_within_grace_period_excluded(self):
        """Test that messages within grace period are excluded."""
        # Arrange
        now = self.CURRENT_TIMESTAMP
        expired_1_day_ago = now - (1 * 24 * 60 * 60)
        expired_5_days_ago = now - (5 * 24 * 60 * 60)
        expired_7_days_ago = now - (7 * 24 * 60 * 60)

        messages = [
            make_simple_message("msg1", "app1"),
            make_simple_message("msg2", "app2"),
            make_simple_message("msg3", "app3"),
        ]
        app_to_tenant = {"app1": "tenant1", "app2": "tenant2", "app3": "tenant3"}
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_1_day_ago},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_5_days_ago},
            "tenant3": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_7_days_ago},
        }
        plan_provider = make_plan_provider(tenant_plans)

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,  # 8 days
            current_timestamp=now,
        )

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert - all within 8-day grace period, none should be included
        assert list(result) == []

    def test_exactly_at_boundary_excluded(self):
        """Test that messages exactly at grace period boundary are excluded (code uses >)."""
        # Arrange
        now = self.CURRENT_TIMESTAMP
        expired_exactly_8_days_ago = now - self.GRACEFUL_PERIOD_SECONDS  # Exactly at boundary

        messages = [make_simple_message("msg1", "app1")]
        app_to_tenant = {"app1": "tenant1"}
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_exactly_8_days_ago},
        }
        plan_provider = make_plan_provider(tenant_plans)

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            current_timestamp=now,
        )

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert - exactly at boundary (==) should be excluded (code uses >)
        assert list(result) == []

    def test_beyond_grace_period_included(self):
        """Test that messages beyond grace period are included."""
        # Arrange
        now = self.CURRENT_TIMESTAMP
        expired_9_days_ago = now - (9 * 24 * 60 * 60)  # Just beyond 8-day grace
        expired_30_days_ago = now - (30 * 24 * 60 * 60)  # Well beyond

        messages = [
            make_simple_message("msg1", "app1"),
            make_simple_message("msg2", "app2"),
        ]
        app_to_tenant = {"app1": "tenant1", "app2": "tenant2"}
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_9_days_ago},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_30_days_ago},
        }
        plan_provider = make_plan_provider(tenant_plans)

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            current_timestamp=now,
        )

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert - both beyond grace period, should be included
        assert set(result) == {"msg1", "msg2"}

    def test_empty_messages_returns_empty(self):
        """Test that empty messages returns empty list."""
        # Arrange
        messages: list[SimpleMessage] = []
        app_to_tenant = {"app1": "tenant1"}
        plan_provider = make_plan_provider({"tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1}})

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            current_timestamp=self.CURRENT_TIMESTAMP,
        )

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert
        assert list(result) == []

    def test_plan_provider_called_with_correct_tenant_ids(self):
        """Test that plan_provider is called with correct tenant_ids."""
        # Arrange
        messages = [
            make_simple_message("msg1", "app1"),
            make_simple_message("msg2", "app2"),
            make_simple_message("msg3", "app3"),
        ]
        app_to_tenant = {"app1": "tenant1", "app2": "tenant2", "app3": "tenant1"}  # tenant1 appears twice
        plan_provider = make_plan_provider({})

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            current_timestamp=self.CURRENT_TIMESTAMP,
        )

        # Act
        policy.filter_message_ids(messages, app_to_tenant)

        # Assert - plan_provider should be called once with unique tenant_ids
        plan_provider.assert_called_once()
        called_tenant_ids = set(plan_provider.call_args[0][0])
        assert called_tenant_ids == {"tenant1", "tenant2"}

    def test_plan_provider_reuses_job_level_cache(self):
        """Test that repeated tenants are not fetched from billing more than once."""
        # Arrange
        now = self.CURRENT_TIMESTAMP
        tenant_plans = {
            "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
        }
        plan_provider = MagicMock(
            side_effect=lambda tenant_ids: {tenant_id: tenant_plans[tenant_id] for tenant_id in tenant_ids}
        )
        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            current_timestamp=now,
        )

        # Act
        first_result = policy.filter_message_ids(
            [make_simple_message("msg1", "app1")],
            {"app1": "tenant1"},
        )
        second_result = policy.filter_message_ids(
            [
                make_simple_message("msg2", "app1"),
                make_simple_message("msg3", "app2"),
            ],
            {"app1": "tenant1", "app2": "tenant2"},
        )

        # Assert
        assert set(first_result) == {"msg1"}
        assert set(second_result) == {"msg2", "msg3"}
        assert plan_provider.call_count == 2
        assert set(plan_provider.call_args_list[0].args[0]) == {"tenant1"}
        assert set(plan_provider.call_args_list[1].args[0]) == {"tenant2"}

    def test_whitelisted_tenants_are_not_fetched_from_plan_provider(self):
        """Test that whitelisted tenants are skipped before billing plan lookup."""
        # Arrange
        plan_provider = make_plan_provider({})
        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            tenant_whitelist=["tenant1"],
            current_timestamp=self.CURRENT_TIMESTAMP,
        )

        # Act
        result = policy.filter_message_ids(
            [make_simple_message("msg1", "app1")],
            {"app1": "tenant1"},
        )

        # Assert
        assert list(result) == []
        plan_provider.assert_not_called()

    def test_filter_app_to_tenant_returns_only_eligible_apps(self):
        """Test eligible-app discovery filters out paid, grace-period, and whitelisted tenants."""
        now = self.CURRENT_TIMESTAMP
        expired_old = now - (15 * 24 * 60 * 60)
        expired_recent = now - (3 * 24 * 60 * 60)
        plan_provider = make_plan_provider(
            {
                "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
                "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_old},
                "tenant3": {"plan": CloudPlan.SANDBOX, "expiration_date": expired_recent},
                "tenant4": {"plan": CloudPlan.PROFESSIONAL, "expiration_date": -1},
                "tenant5": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            }
        )
        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            tenant_whitelist=["tenant5"],
            current_timestamp=now,
        )

        result = policy.filter_app_to_tenant(
            {
                "app1": "tenant1",
                "app2": "tenant2",
                "app3": "tenant3",
                "app4": "tenant4",
                "app5": "tenant5",
            }
        )

        assert result == {"app1": "tenant1", "app2": "tenant2"}

    def test_revalidate_message_ids_uses_fresh_provider(self):
        """Test delete-time revalidation bypasses the job-level cached provider."""
        cached_plan_provider = make_plan_provider(
            {
                "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
                "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
            }
        )
        fresh_plan_provider = make_plan_provider(
            {
                "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
                "tenant2": {"plan": CloudPlan.PROFESSIONAL, "expiration_date": -1},
            }
        )
        policy = BillingSandboxPolicy(
            plan_provider=cached_plan_provider,
            fresh_plan_provider=fresh_plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            current_timestamp=self.CURRENT_TIMESTAMP,
        )
        messages = [
            make_simple_message("msg1", "app1"),
            make_simple_message("msg2", "app2"),
        ]
        app_to_tenant = {"app1": "tenant1", "app2": "tenant2"}

        discovery_result = policy.filter_message_ids(messages, app_to_tenant)
        revalidated_result = policy.revalidate_message_ids(messages, app_to_tenant)

        assert set(discovery_result) == {"msg1", "msg2"}
        assert set(revalidated_result) == {"msg1"}
        fresh_plan_provider.assert_called_once()

    def test_complex_mixed_scenario(self):
        """Test complex scenario with mixed plans, expirations, whitelist, and missing mappings."""
        # Arrange
        now = self.CURRENT_TIMESTAMP
        sandbox_expired_old = now - (15 * 24 * 60 * 60)  # Beyond grace
        sandbox_expired_recent = now - (3 * 24 * 60 * 60)  # Within grace
        future_expiration = now + (30 * 24 * 60 * 60)

        messages = [
            make_simple_message("msg1", "app1"),  # Sandbox, no subscription - included
            make_simple_message("msg2", "app2"),  # Sandbox, expired old - included
            make_simple_message("msg3", "app3"),  # Sandbox, within grace - excluded
            make_simple_message("msg4", "app4"),  # Team plan, active - excluded
            make_simple_message("msg5", "app5"),  # No tenant mapping - excluded
            make_simple_message("msg6", "app6"),  # No plan info - excluded
            make_simple_message("msg7", "app7"),  # Sandbox, expired old, whitelisted - excluded
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
        plan_provider = make_plan_provider(tenant_plans)
        tenant_whitelist = ["tenant7"]

        policy = BillingSandboxPolicy(
            plan_provider=plan_provider,
            graceful_period_days=self.GRACEFUL_PERIOD_DAYS,
            tenant_whitelist=tenant_whitelist,
            current_timestamp=now,
        )

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert - only msg1 and msg2 should be included
        assert set(result) == {"msg1", "msg2"}


class TestBillingDisabledPolicyFilterMessageIds:
    """Unit tests for BillingDisabledPolicy.filter_message_ids method."""

    def test_returns_all_message_ids(self):
        """Test that all message IDs are returned (order-preserving)."""
        # Arrange
        messages = [
            make_simple_message("msg1", "app1"),
            make_simple_message("msg2", "app2"),
            make_simple_message("msg3", "app3"),
        ]
        app_to_tenant = {"app1": "tenant1", "app2": "tenant2"}

        policy = BillingDisabledPolicy()

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert - all message IDs returned in order
        assert list(result) == ["msg1", "msg2", "msg3"]

    def test_ignores_app_to_tenant(self):
        """Test that app_to_tenant mapping is ignored."""
        # Arrange
        messages = [
            make_simple_message("msg1", "app1"),
            make_simple_message("msg2", "app2"),
        ]
        app_to_tenant: dict[str, str] = {}  # Empty - should be ignored

        policy = BillingDisabledPolicy()

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert - all message IDs still returned
        assert list(result) == ["msg1", "msg2"]

    def test_empty_messages_returns_empty(self):
        """Test that empty messages returns empty list."""
        # Arrange
        messages: list[SimpleMessage] = []
        app_to_tenant = {"app1": "tenant1"}

        policy = BillingDisabledPolicy()

        # Act
        result = policy.filter_message_ids(messages, app_to_tenant)

        # Assert
        assert list(result) == []


class TestCreateMessageCleanPolicy:
    """Unit tests for create_message_clean_policy factory function."""

    @patch("services.retention.conversation.messages_clean_policy.dify_config")
    def test_billing_disabled_returns_billing_disabled_policy(self, mock_config):
        """Test that BILLING_ENABLED=False returns BillingDisabledPolicy."""
        # Arrange
        mock_config.BILLING_ENABLED = False

        # Act
        policy = create_message_clean_policy(graceful_period_days=21)

        # Assert
        assert isinstance(policy, BillingDisabledPolicy)

    @patch("services.retention.conversation.messages_clean_policy.BillingService", autospec=True)
    @patch("services.retention.conversation.messages_clean_policy.dify_config")
    def test_billing_enabled_policy_has_correct_internals(self, mock_config, mock_billing_service):
        """Test that BillingSandboxPolicy is created with correct internal values."""
        # Arrange
        mock_config.BILLING_ENABLED = True
        whitelist = ["tenant1", "tenant2"]
        mock_billing_service.get_expired_subscription_cleanup_whitelist.return_value = whitelist
        mock_plan_provider = MagicMock()
        mock_billing_service.get_plan_bulk_with_cache = mock_plan_provider

        # Act
        policy = create_message_clean_policy(graceful_period_days=14, current_timestamp=1234567)

        # Assert
        mock_billing_service.get_expired_subscription_cleanup_whitelist.assert_called_once()
        assert isinstance(policy, BillingSandboxPolicy)
        assert policy._graceful_period_days == 14
        assert list(policy._tenant_whitelist) == whitelist
        assert policy._plan_provider == mock_plan_provider
        assert policy._fresh_plan_provider == mock_billing_service.get_plan_bulk
        assert policy._current_timestamp == 1234567


class TestMessagesCleanServiceFromTimeRange:
    """Unit tests for MessagesCleanService.from_time_range factory method."""

    def test_start_from_end_before_raises_value_error(self):
        """Test that start_from == end_before raises ValueError."""
        policy = BillingDisabledPolicy()

        # Arrange
        same_time = datetime.datetime(2024, 1, 1, 12, 0, 0)

        # Act & Assert
        with pytest.raises(ValueError, match="start_from .* must be less than end_before"):
            MessagesCleanService.from_time_range(
                policy=policy,
                start_from=same_time,
                end_before=same_time,
            )

        # Arrange
        start_from = datetime.datetime(2024, 12, 31)
        end_before = datetime.datetime(2024, 1, 1)

        # Act & Assert
        with pytest.raises(ValueError, match="start_from .* must be less than end_before"):
            MessagesCleanService.from_time_range(
                policy=policy,
                start_from=start_from,
                end_before=end_before,
            )

    def test_batch_size_raises_value_error(self):
        """Test that batch_size=0 raises ValueError."""
        # Arrange
        start_from = datetime.datetime(2024, 1, 1)
        end_before = datetime.datetime(2024, 2, 1)
        policy = BillingDisabledPolicy()

        # Act & Assert
        with pytest.raises(ValueError, match="batch_size .* must be greater than 0"):
            MessagesCleanService.from_time_range(
                policy=policy,
                start_from=start_from,
                end_before=end_before,
                batch_size=0,
            )

        start_from = datetime.datetime(2024, 1, 1)
        end_before = datetime.datetime(2024, 2, 1)
        policy = BillingDisabledPolicy()

        # Act & Assert
        with pytest.raises(ValueError, match="batch_size .* must be greater than 0"):
            MessagesCleanService.from_time_range(
                policy=policy,
                start_from=start_from,
                end_before=end_before,
                batch_size=-100,
            )

        with pytest.raises(ValueError, match="max_candidate_batch_size .* must be greater than 0"):
            MessagesCleanService.from_time_range(
                policy=policy,
                start_from=start_from,
                end_before=end_before,
                max_candidate_batch_size=0,
            )

        with pytest.raises(ValueError, match="delete_batch_size .* must be greater than 0"):
            MessagesCleanService.from_time_range(
                policy=policy,
                start_from=start_from,
                end_before=end_before,
                delete_batch_size=0,
            )

        with pytest.raises(ValueError, match="per_app_batch_size .* must be greater than 0"):
            MessagesCleanService.from_time_range(
                policy=policy,
                start_from=start_from,
                end_before=end_before,
                per_app_batch_size=0,
            )

        with pytest.raises(ValueError, match="app_page_size .* must be greater than 0"):
            MessagesCleanService.from_time_range(
                policy=policy,
                start_from=start_from,
                end_before=end_before,
                app_page_size=0,
            )

    def test_valid_params_creates_instance(self):
        """Test that valid parameters create a correctly configured instance."""
        # Arrange
        start_from = datetime.datetime(2024, 1, 1, 0, 0, 0)
        end_before = datetime.datetime(2024, 12, 31, 23, 59, 59)
        policy = BillingDisabledPolicy()
        batch_size = 500
        dry_run = True

        # Act
        service = MessagesCleanService.from_time_range(
            policy=policy,
            start_from=start_from,
            end_before=end_before,
            batch_size=batch_size,
            max_candidate_batch_size=5000,
            delete_batch_size=200,
            per_app_batch_size=100,
            app_page_size=50,
            scan_strategy="global",
            dry_run=dry_run,
        )

        # Assert
        assert isinstance(service, MessagesCleanService)
        assert service._policy is policy
        assert service._start_from == start_from
        assert service._end_before == end_before
        assert service._batch_size == batch_size
        assert service._candidate_batch_size == batch_size
        assert service._max_candidate_batch_size == 5000
        assert service._delete_batch_size == 200
        assert service._per_app_batch_size == 100
        assert service._app_page_size == 50
        assert service._scan_strategy == "global"
        assert service._dry_run == dry_run

    def test_default_params(self):
        """Test that default parameters are applied correctly."""
        # Arrange
        start_from = datetime.datetime(2024, 1, 1)
        end_before = datetime.datetime(2024, 2, 1)
        policy = BillingDisabledPolicy()

        # Act
        service = MessagesCleanService.from_time_range(
            policy=policy,
            start_from=start_from,
            end_before=end_before,
        )

        # Assert
        assert service._batch_size == 1000  # default
        assert service._candidate_batch_size == 1000  # default
        assert service._max_candidate_batch_size == 1000  # default
        assert service._delete_batch_size == 1000  # default
        assert service._per_app_batch_size == 1000  # default
        assert service._app_page_size == 500  # default
        assert service._scan_strategy == "auto"  # default
        assert service._dry_run is False  # default

    def test_explicit_task_label(self):
        start_from = datetime.datetime(2024, 1, 1)
        end_before = datetime.datetime(2024, 1, 2)
        policy = BillingDisabledPolicy()

        service = MessagesCleanService.from_time_range(
            policy=policy,
            start_from=start_from,
            end_before=end_before,
            task_label="60to30",
        )

        assert service._metrics._base_attributes["task_label"] == "60to30"


class TestMessagesCleanServiceFromDays:
    """Unit tests for MessagesCleanService.from_days factory method."""

    def test_days_raises_value_error(self):
        """Test that days < 0 raises ValueError."""
        # Arrange
        policy = BillingDisabledPolicy()

        # Act & Assert
        with pytest.raises(ValueError, match="days .* must be greater than or equal to 0"):
            MessagesCleanService.from_days(policy=policy, days=-1)

        # Act
        with patch("services.retention.conversation.messages_clean_service.naive_utc_now") as mock_now:
            fixed_now = datetime.datetime(2024, 6, 15, 14, 0, 0)
            mock_now.return_value = fixed_now
            service = MessagesCleanService.from_days(policy=policy, days=0)

        # Assert
        assert service._end_before == fixed_now

    def test_batch_size_raises_value_error(self):
        """Test that batch_size=0 raises ValueError."""
        # Arrange
        policy = BillingDisabledPolicy()

        # Act & Assert
        with pytest.raises(ValueError, match="batch_size .* must be greater than 0"):
            MessagesCleanService.from_days(policy=policy, days=30, batch_size=0)

        # Act & Assert
        with pytest.raises(ValueError, match="batch_size .* must be greater than 0"):
            MessagesCleanService.from_days(policy=policy, days=30, batch_size=-500)

        with pytest.raises(ValueError, match="max_candidate_batch_size .* must be greater than 0"):
            MessagesCleanService.from_days(policy=policy, days=30, max_candidate_batch_size=0)

        with pytest.raises(ValueError, match="delete_batch_size .* must be greater than 0"):
            MessagesCleanService.from_days(policy=policy, days=30, delete_batch_size=0)

        with pytest.raises(ValueError, match="per_app_batch_size .* must be greater than 0"):
            MessagesCleanService.from_days(policy=policy, days=30, per_app_batch_size=0)

        with pytest.raises(ValueError, match="app_page_size .* must be greater than 0"):
            MessagesCleanService.from_days(policy=policy, days=30, app_page_size=0)

    def test_valid_params_creates_instance(self):
        """Test that valid parameters create a correctly configured instance."""
        # Arrange
        policy = BillingDisabledPolicy()
        days = 90
        batch_size = 500
        dry_run = True

        # Act
        with patch("services.retention.conversation.messages_clean_service.naive_utc_now") as mock_now:
            fixed_now = datetime.datetime(2024, 6, 15, 10, 30, 0)
            mock_now.return_value = fixed_now
            service = MessagesCleanService.from_days(
                policy=policy,
                days=days,
                batch_size=batch_size,
                max_candidate_batch_size=2500,
                delete_batch_size=250,
                per_app_batch_size=125,
                app_page_size=25,
                scan_strategy="global",
                dry_run=dry_run,
            )

        # Assert
        expected_end_before = fixed_now - datetime.timedelta(days=days)
        assert isinstance(service, MessagesCleanService)
        assert service._policy is policy
        assert service._start_from is None
        assert service._end_before == expected_end_before
        assert service._batch_size == batch_size
        assert service._candidate_batch_size == batch_size
        assert service._max_candidate_batch_size == 2500
        assert service._delete_batch_size == 250
        assert service._per_app_batch_size == 125
        assert service._app_page_size == 25
        assert service._scan_strategy == "global"
        assert service._dry_run == dry_run

    def test_default_params(self):
        """Test that default parameters are applied correctly."""
        # Arrange
        policy = BillingDisabledPolicy()

        # Act
        with patch("services.retention.conversation.messages_clean_service.naive_utc_now") as mock_now:
            fixed_now = datetime.datetime(2024, 6, 15, 10, 30, 0)
            mock_now.return_value = fixed_now
            service = MessagesCleanService.from_days(policy=policy)

        # Assert
        expected_end_before = fixed_now - datetime.timedelta(days=30)  # default days=30
        assert service._end_before == expected_end_before
        assert service._batch_size == 1000  # default
        assert service._dry_run is False  # default
        assert service._metrics._base_attributes["task_label"] == "custom"


class TestMessagesCleanServiceBatchHelpers:
    """Unit tests for cache and adaptive batch helpers."""

    def test_load_app_to_tenant_mapping_reuses_cache(self):
        class ExecuteResult:
            def __init__(self, rows: list[tuple[str, str]]) -> None:
                self._rows = rows

            def all(self) -> list[tuple[str, str]]:
                return self._rows

        class FakeSession:
            execute_calls: int

            def __init__(self) -> None:
                self.execute_calls = 0

            def execute(self, _stmt: object) -> ExecuteResult:
                self.execute_calls += 1
                return ExecuteResult([("app1", "tenant1")])

        session = FakeSession()
        cache: dict[str, str | None] = {}

        first_mapping, first_cache_misses, first_found = MessagesCleanService._load_app_to_tenant_mapping(
            session=session,  # type: ignore[arg-type]
            app_ids=["app1"],
            app_to_tenant_cache=cache,
        )
        second_mapping, second_cache_misses, second_found = MessagesCleanService._load_app_to_tenant_mapping(
            session=session,  # type: ignore[arg-type]
            app_ids=["app1"],
            app_to_tenant_cache=cache,
        )

        assert first_mapping == {"app1": "tenant1"}
        assert second_mapping == {"app1": "tenant1"}
        assert first_cache_misses == 1
        assert first_found == 1
        assert second_cache_misses == 0
        assert second_found == 0
        assert session.execute_calls == 1

    def test_candidate_batch_size_grows_for_low_hit_rate(self):
        service = MessagesCleanService(
            policy=BillingDisabledPolicy(),
            start_from=datetime.datetime(2024, 1, 1),
            end_before=datetime.datetime(2024, 1, 2),
            batch_size=1000,
            max_candidate_batch_size=50000,
            delete_batch_size=1000,
        )

        smoothed_hit_rate, next_batch_size = service._adjust_candidate_batch_size(
            smoothed_hit_rate=None,
            candidate_count=10000,
            eligible_count=55,
        )

        assert smoothed_hit_rate == 0.0055
        assert next_batch_size == 50000

    def test_candidate_batch_size_shrinks_when_hit_rate_is_high(self):
        service = MessagesCleanService(
            policy=BillingDisabledPolicy(),
            start_from=datetime.datetime(2024, 1, 1),
            end_before=datetime.datetime(2024, 1, 2),
            batch_size=10000,
            max_candidate_batch_size=50000,
            delete_batch_size=1000,
        )

        _smoothed_hit_rate, next_batch_size = service._adjust_candidate_batch_size(
            smoothed_hit_rate=None,
            candidate_count=10000,
            eligible_count=10000,
        )

        assert next_batch_size == 1000

    def test_iter_message_id_chunks_uses_delete_batch_size(self):
        chunks = list(MessagesCleanService._iter_message_id_chunks(["msg1", "msg2", "msg3", "msg4", "msg5"], 2))

        assert chunks == [["msg1", "msg2"], ["msg3", "msg4"], ["msg5"]]

    def test_eligible_app_scanner_filters_apps_and_round_robins(self):
        class ExecuteResult:
            def __init__(self, rows: list[tuple[str, str] | tuple[str, str, datetime.datetime]]) -> None:
                self._rows = rows

            def all(self) -> list[tuple[str, str] | tuple[str, str, datetime.datetime]]:
                return self._rows

        class FakeSession:
            def __init__(self) -> None:
                self.rows_by_call: list[list[tuple[str, str] | tuple[str, str, datetime.datetime]]] = [
                    [
                        ("app1", "tenant1"),
                        ("app2", "tenant2"),
                        ("app3", "tenant3"),
                    ],
                    [("msg1", "app1", datetime.datetime(2024, 1, 1, 0, 0, 0))],
                    [("msg2", "app2", datetime.datetime(2024, 1, 1, 0, 0, 1))],
                ]

            def execute(self, _stmt: object) -> ExecuteResult:
                return ExecuteResult(self.rows_by_call.pop(0))

            def __enter__(self) -> "FakeSession":
                return self

            def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
                return None

        class FakeSessionFactory:
            def __init__(self) -> None:
                self.session = FakeSession()

            def __call__(self) -> FakeSession:
                return self.session

        plan_provider = make_plan_provider(
            {
                "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
                "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
                "tenant3": {"plan": CloudPlan.PROFESSIONAL, "expiration_date": -1},
            }
        )
        policy = BillingSandboxPolicy(plan_provider=plan_provider, current_timestamp=1000)
        scanner = EligibleAppRoundRobinScanner(
            policy=policy,
            start_from=datetime.datetime(2023, 12, 1),
            end_before=datetime.datetime(2024, 2, 1),
            app_page_size=10,
            per_app_batch_size=1,
        )

        batch = scanner.fetch_batch(FakeSessionFactory(), target_message_count=2)  # type: ignore[arg-type]

        assert [message.id for message in batch.messages] == ["msg1", "msg2"]
        assert batch.app_to_tenant == {"app1": "tenant1", "app2": "tenant2"}
        assert batch.app_fetches == 2
        assert scanner.scanned_apps == 3
        assert scanner.eligible_apps == 2


class TestMessagesCleanServiceRun:
    """Unit tests for MessagesCleanService.run instrumentation behavior."""

    def test_run_records_completion_metrics_on_success(self):
        # Arrange
        service = MessagesCleanService(
            policy=BillingDisabledPolicy(),
            start_from=datetime.datetime(2024, 1, 1),
            end_before=datetime.datetime(2024, 1, 2),
            batch_size=100,
            dry_run=False,
        )
        expected_stats = {
            "batches": 1,
            "total_messages": 10,
            "filtered_messages": 5,
            "total_deleted": 5,
        }
        service._clean_messages_by_time_range = MagicMock(return_value=expected_stats)  # type: ignore[method-assign]
        completion_calls: list[dict[str, object]] = []
        service._metrics.record_completion = lambda **kwargs: completion_calls.append(kwargs)  # type: ignore[method-assign]

        # Act
        result = service.run()

        # Assert
        assert result == expected_stats
        assert len(completion_calls) == 1
        assert completion_calls[0]["status"] == "success"

    def test_run_uses_eligible_app_strategy_for_sandbox_policy(self):
        service = MessagesCleanService(
            policy=BillingSandboxPolicy(plan_provider=make_plan_provider({})),
            start_from=datetime.datetime(2024, 1, 1),
            end_before=datetime.datetime(2024, 1, 2),
        )
        expected_stats = {
            "batches": 1,
            "total_messages": 10,
            "filtered_messages": 5,
            "total_deleted": 5,
        }
        service._clean_messages_by_eligible_apps = MagicMock(return_value=expected_stats)  # type: ignore[method-assign]
        service._clean_messages_by_time_range = MagicMock()  # type: ignore[method-assign]

        result = service.run()

        assert result == expected_stats
        service._clean_messages_by_eligible_apps.assert_called_once()
        service._clean_messages_by_time_range.assert_not_called()

    def test_global_strategy_forces_global_scan(self):
        service = MessagesCleanService(
            policy=BillingSandboxPolicy(plan_provider=make_plan_provider({})),
            start_from=datetime.datetime(2024, 1, 1),
            end_before=datetime.datetime(2024, 1, 2),
            scan_strategy="global",
        )
        expected_stats = {
            "batches": 1,
            "total_messages": 10,
            "filtered_messages": 5,
            "total_deleted": 5,
        }
        service._clean_messages_by_time_range = MagicMock(return_value=expected_stats)  # type: ignore[method-assign]
        service._clean_messages_by_eligible_apps = MagicMock()  # type: ignore[method-assign]

        result = service.run()

        assert result == expected_stats
        service._clean_messages_by_time_range.assert_called_once()
        service._clean_messages_by_eligible_apps.assert_not_called()

    def test_eligible_app_strategy_requires_supported_policy(self):
        service = MessagesCleanService(
            policy=BillingDisabledPolicy(),
            start_from=datetime.datetime(2024, 1, 1),
            end_before=datetime.datetime(2024, 1, 2),
            scan_strategy="eligible_apps",
        )

        with pytest.raises(ValueError, match="eligible-app cleanup policy"):
            service.run()

    def test_eligible_app_strategy_revalidates_before_dry_run_counting(self):
        class FakeSessionFactory:
            pass

        class FakeScanner:
            scanned_apps = 2
            eligible_apps = 2
            empty_apps = 0

            def __init__(self, **_kwargs: object) -> None:
                self.call_count = 0

            def fetch_batch(self, _session_factory: object, *, target_message_count: int) -> EligibleAppScanBatch:
                del target_message_count
                self.call_count += 1
                if self.call_count == 1:
                    return EligibleAppScanBatch(
                        messages=[
                            make_simple_message("msg1", "app1"),
                            make_simple_message("msg2", "app2"),
                        ],
                        app_to_tenant={"app1": "tenant1", "app2": "tenant2"},
                        app_fetches=2,
                        exhausted_apps=2,
                    )
                return EligibleAppScanBatch(messages=[], app_to_tenant={}, app_fetches=0, exhausted_apps=0)

        policy = BillingSandboxPolicy(
            plan_provider=make_plan_provider(
                {
                    "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
                    "tenant2": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
                }
            ),
            fresh_plan_provider=make_plan_provider(
                {
                    "tenant1": {"plan": CloudPlan.SANDBOX, "expiration_date": -1},
                    "tenant2": {"plan": CloudPlan.PROFESSIONAL, "expiration_date": -1},
                }
            ),
            current_timestamp=1000,
        )
        service = MessagesCleanService(
            policy=policy,
            start_from=datetime.datetime(2024, 1, 1),
            end_before=datetime.datetime(2024, 1, 2),
            dry_run=True,
        )

        fake_db = MagicMock()
        fake_db.engine = object()
        with (
            patch(
                "services.retention.conversation.messages_clean_service.sessionmaker",
                return_value=FakeSessionFactory(),
            ),
            patch("services.retention.conversation.messages_clean_service.EligibleAppRoundRobinScanner", FakeScanner),
            patch("services.retention.conversation.messages_clean_service.db", fake_db),
        ):
            stats = service.run()

        assert stats["batches"] == 2
        assert stats["total_messages"] == 2
        assert stats["filtered_messages"] == 1
        assert stats["total_deleted"] == 0

    def test_run_records_completion_metrics_on_failure(self):
        # Arrange
        service = MessagesCleanService(
            policy=BillingDisabledPolicy(),
            start_from=datetime.datetime(2024, 1, 1),
            end_before=datetime.datetime(2024, 1, 2),
            batch_size=100,
            dry_run=False,
        )
        service._clean_messages_by_time_range = MagicMock(side_effect=RuntimeError("clean failed"))  # type: ignore[method-assign]
        completion_calls: list[dict[str, object]] = []
        service._metrics.record_completion = lambda **kwargs: completion_calls.append(kwargs)  # type: ignore[method-assign]

        # Act & Assert
        with pytest.raises(RuntimeError, match="clean failed"):
            service.run()
        assert len(completion_calls) == 1
        assert completion_calls[0]["status"] == "failed"
